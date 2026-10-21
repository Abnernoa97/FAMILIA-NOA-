package com.familianoa.emergency

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.Build
import android.os.Handler
import android.os.CancellationSignal
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class FamilyLocationTracker(
    context: Context,
    private val store: SessionStore,
    private val accessTokenProvider: () -> String,
) : LocationListener {
    companion object {
        private const val MIN_UPDATE_MS = 10_000L
        private const val MAX_SILENCE_MS = 20_000L
        private const val HEARTBEAT_MS = 30_000L
        private const val MAX_LAST_KNOWN_AGE_MS = 20_000L
        private const val MIN_DISTANCE_M = 2.5f
    }

    private val appContext = context.applicationContext
    private val locationManager = appContext.getSystemService(LocationManager::class.java)
    private val uploading = AtomicBoolean(false)
    // Invalidates queued upload workers as soon as sharing is stopped.
    private val trackingGeneration = AtomicInteger(0)
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private var heartbeat:Runnable? = null
    private var currentFix:CancellationSignal? = null

    @Volatile
    var running: Boolean = false
        private set

    private var lastUploadedLocation: Location? = null
    @Volatile private var lastUploadAt = 0L

    fun start(): Boolean {
        if (running) return true
        if (!store.configured || store.memberId.isBlank() || !store.locationSharingEnabled || !hasLocationPermission()) return false

        val providers = buildList {
            if (runCatching { locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)) {
                add(LocationManager.GPS_PROVIDER)
            }
            if (runCatching { locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)) {
                add(LocationManager.NETWORK_PROVIDER)
            }
        }
        if (providers.isEmpty()) return false

        return try {
            val lastKnown = providers
                .mapNotNull { provider -> runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull() }
                .maxByOrNull { it.time }

            providers.forEach { provider ->
                locationManager.requestLocationUpdates(
                    provider,
                    MIN_UPDATE_MS,
                    0f, // Keep receiving fixes while stationary; upload() still filters movement.
                    this,
                    Looper.getMainLooper()
                )
            }

            trackingGeneration.incrementAndGet()
            running = true
            if (lastKnown != null && fresh(lastKnown)) upload(lastKnown, force = true)
            beginHeartbeat()
            true
        } catch (_: SecurityException) {
            stop() // Also unregister a GPS provider if NETWORK registration failed.
            false
        } catch (_: Throwable) {
            stop()
            false
        }
    }

    fun stop() {
        heartbeat?.let(heartbeatHandler::removeCallbacks)
        heartbeat = null
        currentFix?.cancel()
        currentFix = null
        // Clear partially registered providers too, even if start() failed.
        trackingGeneration.incrementAndGet()
        runCatching { locationManager.removeUpdates(this) }
        running = false
        lastUploadedLocation = null
        lastUploadAt = 0L
    }

    fun refreshNow() {
        if (!running) {
            if (!start()) return
        }
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        val best = providers
            .mapNotNull { provider -> runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time }
        if (best != null && fresh(best)) upload(best, force = true)
        else requestFreshFix()
    }

    override fun onLocationChanged(location: Location) {
        upload(location, force = false)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    private fun upload(location: Location, force: Boolean) {
        if (!running || !store.locationSharingEnabled || !valid(location) || !fresh(location) || !uploading.compareAndSet(false, true)) return

        val now = System.currentTimeMillis()
        val previous = lastUploadedLocation
        val moved = previous == null || previous.distanceTo(location) >= MIN_DISTANCE_M
        val accuracyImproved = previous != null &&
            location.hasAccuracy() &&
            previous.hasAccuracy() &&
            location.accuracy + 5f < previous.accuracy
        val muchWorseAccuracy = previous != null &&
            location.hasAccuracy() &&
            previous.hasAccuracy() &&
            location.accuracy > maxOf(previous.accuracy * 2f, previous.accuracy + 30f)
        val newerThanPrevious = previous == null || location.time + 5_000L >= previous.time

        if (!newerThanPrevious) {
            uploading.set(false)
            return
        }
        if (!force && previous != null && muchWorseAccuracy && previous.distanceTo(location) < location.accuracy && now - lastUploadAt < MAX_SILENCE_MS) {
            uploading.set(false)
            return
        }

        if (!force && now - lastUploadAt < MIN_UPDATE_MS) {
            uploading.set(false)
            return
        }
        if (!force && previous != null && !moved && !accuracyImproved && now - lastUploadAt < MAX_SILENCE_MS) {
            uploading.set(false)
            return
        }

        val generation = trackingGeneration.get()
        Thread {
            try {
                if (!running || !store.locationSharingEnabled || generation != trackingGeneration.get()) return@Thread
                val token = accessTokenProvider()
                if (!running || !store.locationSharingEnabled || generation != trackingGeneration.get()) return@Thread
                Api.upsertFamilyLocation(
                    accessToken = token,
                    memberId = store.memberId,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = if (location.hasAccuracy()) location.accuracy else null,
                )
                if (running && store.locationSharingEnabled && generation == trackingGeneration.get()) {
                    lastUploadedLocation = Location(location)
                    lastUploadAt = System.currentTimeMillis()
                    store.recordLocationUpload()
                }
            } catch (error: Throwable) {
                Log.w("FamiliaNoaGPS", "Upload failed; the next sample will retry", error)
            } finally {
                uploading.set(false)
            }
        }.start()
    }


    private fun fresh(location: Location): Boolean {
        val ageMs = TimeUnit.NANOSECONDS.toMillis(
            SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos
        )
        return ageMs in -5_000L..MAX_LAST_KNOWN_AGE_MS
    }

    private fun beginHeartbeat() {
        heartbeat?.let(heartbeatHandler::removeCallbacks)
        val task = object:Runnable {
            override fun run() {
                if (!running) return
                if (System.currentTimeMillis() - lastUploadAt >= MAX_SILENCE_MS) {
                    requestFreshFix()
                }
                heartbeatHandler.postDelayed(this, HEARTBEAT_MS)
            }
        }
        heartbeat = task
        heartbeatHandler.postDelayed(task, HEARTBEAT_MS)
    }

    private fun requestFreshFix() {
        if (!running || Build.VERSION.SDK_INT < 30 || currentFix != null) return
        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .firstOrNull { runCatching { locationManager.isProviderEnabled(it) }.getOrDefault(false) }
            ?: return
        val signal = CancellationSignal()
        currentFix = signal
        val timeout = Runnable {
            if (currentFix === signal) {
                currentFix = null
                signal.cancel()
            }
        }
        heartbeatHandler.postDelayed(timeout, 15_000L)
        try {
            locationManager.getCurrentLocation(provider, signal, { task -> heartbeatHandler.post(task) }) { location ->
                heartbeatHandler.removeCallbacks(timeout)
                if (currentFix !== signal) return@getCurrentLocation
                currentFix = null
                if (running && location != null) upload(location, force = true)
            }
        } catch (error: Throwable) {
            heartbeatHandler.removeCallbacks(timeout)
            currentFix = null
            Log.w("FamiliaNoaGPS", "Fresh position request failed", error)
        }
    }

    private fun valid(location: Location): Boolean =
        location.latitude in -90.0..90.0 &&
            location.longitude in -180.0..180.0 &&
            location.latitude.isFinite() &&
            location.longitude.isFinite()

    private fun hasLocationPermission(): Boolean =
        appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            appContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
}
