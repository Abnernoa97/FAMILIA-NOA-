package com.familianoa.emergency

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

class LiveLocationService : Service(), LocationListener {
    companion object {
        const val ACTION_START = "com.familianoa.emergency.LIVE_LOCATION_START"
        const val ACTION_STOP = "com.familianoa.emergency.LIVE_LOCATION_STOP"
        const val ACTION_STATUS = "com.familianoa.emergency.LIVE_LOCATION_STATUS"
        const val EXTRA_DURATION_MINUTES = "duration_minutes"
        const val EXTRA_ACTIVE = "active"
        const val EXTRA_ENDS_AT = "ends_at"
        const val EXTRA_UPDATED_AT = "updated_at"
        const val EXTRA_ACCURACY = "accuracy"

        private const val CHANNEL_ID = "familia_noa_live_location"
        private const val NOTIFICATION_ID = 902
        private const val MIN_UPDATE_MS = 15_000L
        private const val HEARTBEAT_MS = 60_000L
        private const val MIN_DISTANCE_M = 10f

        fun start(context: Context, durationMinutes: Int) {
            val intent = Intent(context, LiveLocationService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_DURATION_MINUTES, durationMinutes)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LiveLocationService::class.java).setAction(ACTION_STOP)
            try {
                context.startService(intent)
            } catch (_: Throwable) {
                context.stopService(Intent(context, LiveLocationService::class.java))
            }
        }
    }

    private lateinit var store: SessionStore
    private lateinit var locationManager: LocationManager
    private val handler = Handler(Looper.getMainLooper())
    private val uploading = AtomicBoolean(false)

    private var lastLocation: Location? = null
    private var lastUploadedLocation: Location? = null
    private var lastUploadAt = 0L
    private var sessionStartedAt = 0L
    private var sessionEndsAt = 0L

    private val heartbeat = object : Runnable {
        override fun run() {
            if (!store.liveLocationActive) return
            if (sessionEndsAt > 0L && System.currentTimeMillis() >= sessionEndsAt) {
                stopSession(deactivateRemote = true)
                return
            }
            lastLocation?.let { uploadLocation(it, force = true) }
            updateNotification()
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    private val expiry = Runnable {
        if (store.liveLocationActive) stopSession(deactivateRemote = true)
    }

    override fun onCreate() {
        super.onCreate()
        store = SessionStore(this)
        locationManager = getSystemService(LocationManager::class.java)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            if (store.liveLocationActive) stopSession(deactivateRemote = true)
            else {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return START_NOT_STICKY
        }

        if (!store.configured || !hasLocationPermission()) {
            store.clearLiveLocationSession()
            stopSelf()
            return START_NOT_STICKY
        }

        val now = System.currentTimeMillis()
        if (intent?.action == ACTION_START) {
            val durationMinutes = intent.getIntExtra(EXTRA_DURATION_MINUTES, 15).coerceAtLeast(0)
            sessionStartedAt = now
            sessionEndsAt = if (durationMinutes > 0) now + durationMinutes * 60_000L else 0L
            store.setLiveLocationSession(sessionStartedAt, sessionEndsAt)
        } else {
            if (!store.liveLocationActive) {
                stopSelf()
                return START_NOT_STICKY
            }
            sessionStartedAt = store.liveLocationStartedAt.takeIf { it > 0L } ?: now
            sessionEndsAt = store.liveLocationEndsAt
            if (sessionEndsAt > 0L && sessionEndsAt <= now) {
                stopSession(deactivateRemote = true)
                return START_NOT_STICKY
            }
        }

        try {
            startAsForeground()
            startLocationUpdates()
            scheduleTimers()
            broadcastStatus()
        } catch (_: SecurityException) {
            store.clearLiveLocationSession()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        } catch (_: Throwable) {
            store.clearLiveLocationSession()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        return START_STICKY
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Ubicación en vivo FAMILIA NOA",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Muestra cuándo compartes tu ubicación en vivo con tu familia"
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            903,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this,
            904,
            Intent(this, LiveLocationService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val text = if (sessionEndsAt > 0L) {
            val minutes = ((sessionEndsAt - System.currentTimeMillis()).coerceAtLeast(0L) + 59_999L) / 60_000L
            "Compartiendo en vivo · $minutes min restantes"
        } else {
            "Compartiendo en vivo · hasta que la apagues"
        }
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("FAMILIA NOA · ubicación en vivo")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", stop)
            .build()
    }

    private fun startAsForeground() {
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
    }

    @Suppress("MissingPermission")
    private fun startLocationUpdates() {
        if (!hasLocationPermission()) throw SecurityException("Location permission missing")

        val providers = buildList {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
        }
        if (providers.isEmpty()) error("Location services disabled")

        val lastKnown = providers
            .mapNotNull { provider -> runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time }
        if (lastKnown != null) {
            lastLocation = lastKnown
            uploadLocation(lastKnown, force = true)
        }

        providers.forEach { provider ->
            locationManager.requestLocationUpdates(
                provider,
                MIN_UPDATE_MS,
                MIN_DISTANCE_M,
                this,
                Looper.getMainLooper()
            )
        }
    }

    private fun scheduleTimers() {
        handler.removeCallbacks(heartbeat)
        handler.removeCallbacks(expiry)
        handler.postDelayed(heartbeat, HEARTBEAT_MS)
        if (sessionEndsAt > 0L) {
            handler.postDelayed(expiry, (sessionEndsAt - System.currentTimeMillis()).coerceAtLeast(250L))
        }
    }

    override fun onLocationChanged(location: Location) {
        val current = lastLocation
        if (current == null || location.time >= current.time || location.accuracy < current.accuracy) {
            lastLocation = location
        }
        uploadLocation(location, force = false)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    private fun uploadLocation(location: Location, force: Boolean) {
        if (!store.liveLocationActive || !uploading.compareAndSet(false, true)) return
        val now = System.currentTimeMillis()
        val previous = lastUploadedLocation
        val moved = previous == null || previous.distanceTo(location) >= MIN_DISTANCE_M
        if (!force && !moved && now - lastUploadAt < MIN_UPDATE_MS) {
            uploading.set(false)
            return
        }

        Thread {
            try {
                var token = store.accessToken
                if (store.needsRefresh()) {
                    val refreshed = Api.refreshSession(store.refreshToken)
                    token = refreshed.accessToken
                    store.updateTokens(refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt)
                }
                Api.upsertLiveLocation(
                    accessToken = token,
                    memberId = store.memberId,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = if (location.hasAccuracy()) location.accuracy else null,
                    liveActive = true,
                    liveStartedAtMs = sessionStartedAt,
                    liveUntilMs = sessionEndsAt,
                )
                lastUploadedLocation = Location(location)
                lastUploadAt = System.currentTimeMillis()
                broadcastStatus(location)
            } catch (_: Throwable) {
                // Keep the foreground session alive and retry on the next GPS update/heartbeat.
            } finally {
                uploading.set(false)
            }
        }.start()
    }

    private fun stopSession(deactivateRemote: Boolean) {
        handler.removeCallbacks(heartbeat)
        handler.removeCallbacks(expiry)
        runCatching { locationManager.removeUpdates(this) }

        val memberId = store.memberId
        val tokenAtStop = store.accessToken
        val refreshAtStop = store.refreshToken
        val needsRefresh = store.needsRefresh()
        store.clearLiveLocationSession()
        broadcastStatus()

        Thread {
            if (deactivateRemote && memberId.isNotBlank()) {
                runCatching {
                    var token = tokenAtStop
                    if (needsRefresh && refreshAtStop.isNotBlank()) {
                        val refreshed = Api.refreshSession(refreshAtStop)
                        token = refreshed.accessToken
                        store.updateTokens(refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt)
                    }
                    Api.deactivateLiveLocation(token, memberId)
                }
            }
            handler.post {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }.start()
    }

    private fun broadcastStatus(location: Location? = null) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_ACTIVE, store.liveLocationActive)
                .putExtra(EXTRA_ENDS_AT, store.liveLocationEndsAt)
                .putExtra(EXTRA_UPDATED_AT, System.currentTimeMillis())
                .putExtra(EXTRA_ACCURACY, location?.accuracy ?: -1f)
        )
    }

    override fun onDestroy() {
        handler.removeCallbacks(heartbeat)
        handler.removeCallbacks(expiry)
        runCatching { locationManager.removeUpdates(this) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null
}
