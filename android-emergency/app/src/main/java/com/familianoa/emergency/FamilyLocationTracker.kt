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
        private const val MAX_FIX_AGE_MS = 12_000L
        private const val MAX_ACCURACY_M = 65f
        private const val MAX_NETWORK_ACCURACY_M = 45f
        // Do not artificially hold precise fresh network fixes for 15 seconds.
        private const val FIRST_NETWORK_SETTLE_MS = 3_000L
        private const val NETWORK_CONFIRM_SEPARATION_MS = 1_200L
        private const val MIN_DISTANCE_M = 2.5f
    }

    private val appContext = context.applicationContext
    private val locationManager = appContext.getSystemService(LocationManager::class.java)
    private val uploading = AtomicBoolean(false)
    // Invalidates queued upload workers as soon as sharing is stopped.
    private val trackingGeneration = AtomicInteger(0)
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private var heartbeat:Runnable? = null
    // GPS and NETWORK one-shot requests can run in parallel: a slow satellite
    // lock must not block a fast, independently corroborated network fix.
    // Confined to main looper together with provider callbacks.
    private val currentFixes = mutableMapOf<String,CancellationSignal>()

    @Volatile
    var running: Boolean = false
        private set

    @Volatile private var lastUploadedLocation: Location? = null
    // A single GPS/network outlier is not proof of a sudden physical jump.
    private var candidateJump: Location? = null
    private var firstNetworkCandidate: Location? = null
    @Volatile private var lastUploadAt = 0L
    @Volatile private var startedElapsedNanos = 0L

    fun start(): Boolean {
        if (running) return true
        if (!store.configured || store.memberId.isBlank() || !store.locationSharingEnabled || !hasLocationPermission()) return false

        val providers = buildList {
            if (appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
                runCatching { locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)) {
                add(LocationManager.GPS_PROVIDER)
            }
            if (runCatching { locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)) {
                add(LocationManager.NETWORK_PROVIDER)
            }
        }
        if (providers.isEmpty()) return false

        return try {
            startedElapsedNanos = SystemClock.elapsedRealtimeNanos()
            // Deliberately do NOT seed the map with cached provider coordinates:
            // the first published fix must be a new, accurate GPS observation.
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
            beginHeartbeat()
            requestFreshFix()
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
        currentFixes.values.forEach { it.cancel() }
        currentFixes.clear()
        // Clear partially registered providers too, even if start() failed.
        trackingGeneration.incrementAndGet()
        runCatching { locationManager.removeUpdates(this) }
        running = false
        lastUploadedLocation = null
        candidateJump = null
        firstNetworkCandidate = null
        lastUploadAt = 0L
        startedElapsedNanos = 0L
    }

    fun refreshNow() {
        if (!running) {
            if (!start()) return
        }
        // A refresh must obtain a new fix; a saved provider estimate can
        // momentarily show a different street even when the user never moved.
        requestFreshFix()
    }

    override fun onLocationChanged(location: Location) {
        upload(location, force = false)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    private fun upload(location: Location, force: Boolean) {
        if (!running || !store.locationSharingEnabled || !valid(location) || !fresh(location) || !trustworthyAccuracy(location) ||
            !uploading.compareAndSet(false, true)) return

        val now = System.currentTimeMillis()
        val previous = lastUploadedLocation
        // On startup, a quick network fix may appear in a different street.
        // Prefer an actual satellite reading. If GPS is unavailable indoors,
        // accept network only after two consistent high-quality observations.
        if (previous == null && location.provider == LocationManager.NETWORK_PROVIDER &&
            appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            runCatching { locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)) {
            val elapsed = TimeUnit.NANOSECONDS.toMillis(
                SystemClock.elapsedRealtimeNanos() - startedElapsedNanos
            )
            val candidate = firstNetworkCandidate
            val independent = candidate != null &&
                location.elapsedRealtimeNanos - candidate.elapsedRealtimeNanos >=
                TimeUnit.MILLISECONDS.toNanos(NETWORK_CONFIRM_SEPARATION_MS)
            if (elapsed < FIRST_NETWORK_SETTLE_MS || candidate == null || !fresh(candidate) ||
                !independent || location.accuracy > 30f || candidate.accuracy > 30f ||
                candidate.distanceTo(location) > 35f) {
                firstNetworkCandidate = Location(location)
                uploading.set(false)
                return
            }
        }
        firstNetworkCandidate = null
        val moved = previous == null || previous.distanceTo(location) >= MIN_DISTANCE_M
        val accuracyImproved = previous != null &&
            location.hasAccuracy() &&
            previous.hasAccuracy() &&
            location.accuracy + 5f < previous.accuracy
        val muchWorseAccuracy = previous != null &&
            location.hasAccuracy() &&
            previous.hasAccuracy() &&
            location.accuracy > maxOf(previous.accuracy * 2f, previous.accuracy + 30f)
        val newerThanPrevious = previous == null ||
            location.elapsedRealtimeNanos >= previous.elapsedRealtimeNanos

        if (!newerThanPrevious) {
            uploading.set(false)
            return
        }
        // Reject implausible single-point teleports. A second accurate fix
        // near the candidate confirms a genuine displacement; elapsed time
        // allows realistic travel after long periods without GPS signal.
        if (previous != null) {
            val elapsedSeconds = TimeUnit.NANOSECONDS.toMillis(
                (location.elapsedRealtimeNanos - previous.elapsedRealtimeNanos).coerceAtLeast(0L)
            ) / 1000f
            val plausibleMeters = maxOf(
                120f,
                elapsedSeconds * 55f + (previous.accuracy + location.accuracy) * 2f
            )
            if (previous.distanceTo(location) > plausibleMeters) {
                val candidate = candidateJump
                if (candidate == null || !fresh(candidate) ||
                    candidate.distanceTo(location) > maxOf(65f, location.accuracy + candidate.accuracy)) {
                    candidateJump = Location(location)
                    uploading.set(false)
                    return
                }
            }
        }
        candidateJump = null

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
        return ageMs in -2_000L..MAX_FIX_AGE_MS &&
            location.elapsedRealtimeNanos >= startedElapsedNanos
    }

    private fun beginHeartbeat() {
        heartbeat?.let(heartbeatHandler::removeCallbacks)
        val task = object:Runnable {
            override fun run() {
                if (!running) return
                val acquiringFirstFix = lastUploadedLocation == null
                if (acquiringFirstFix || System.currentTimeMillis() - lastUploadAt >= MAX_SILENCE_MS) {
                    requestFreshFix()
                }
                // Quick acquisition retries only until the first confirmed
                // upload; background heartbeat returns to 30s thereafter.
                heartbeatHandler.postDelayed(this, if (acquiringFirstFix) 8_000L else HEARTBEAT_MS)
            }
        }
        heartbeat = task
        heartbeatHandler.postDelayed(task, 8_000L)
    }

    private fun requestFreshFix() {
        if (!running || Build.VERSION.SDK_INT < 30) return
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider ->
                // Fine permission is required to request the satellite provider.
                (provider != LocationManager.GPS_PROVIDER ||
                    appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) &&
                    runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)
            }

        providers.forEach { provider ->
            if (currentFixes.containsKey(provider)) return@forEach
            val signal = CancellationSignal()
            currentFixes[provider] = signal
            val timeout = Runnable {
                if (currentFixes[provider] === signal) {
                    currentFixes.remove(provider)
                    signal.cancel()
                }
            }
            // The continuous listener stays active if the one-shot times out.
            // Parallel requests are not serialized behind a satellite timeout.
            val timeoutMs = if (provider == LocationManager.NETWORK_PROVIDER) 6_000L else 9_000L
            heartbeatHandler.postDelayed(timeout, timeoutMs)
            try {
                locationManager.getCurrentLocation(provider, signal, { task -> heartbeatHandler.post(task) }) { location ->
                    heartbeatHandler.removeCallbacks(timeout)
                    if (currentFixes[provider] !== signal) return@getCurrentLocation
                    currentFixes.remove(provider)
                    if (running && location != null) upload(location, force = true)
                }
            } catch (error: Throwable) {
                heartbeatHandler.removeCallbacks(timeout)
                currentFixes.remove(provider)
                signal.cancel()
                Log.w("FamiliaNoaGPS", "Current position request failed for $provider", error)
            }
        }
    }

    private fun trustworthyAccuracy(location: Location): Boolean {
        if (!location.hasAccuracy() || !location.accuracy.isFinite()) return false
        val limit = if (location.provider == LocationManager.NETWORK_PROVIDER)
            MAX_NETWORK_ACCURACY_M else MAX_ACCURACY_M
        return location.accuracy in 0f..limit
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
