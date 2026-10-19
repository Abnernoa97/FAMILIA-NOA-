package com.familianoa.emergency

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

class FamilyLocationTracker(
    context: Context,
    private val store: SessionStore,
    private val accessTokenProvider: () -> String,
) : LocationListener {
    companion object {
        private const val MIN_UPDATE_MS = 4_000L
        private const val MAX_SILENCE_MS = 20_000L
        private const val MAX_LAST_KNOWN_AGE_MS = 60_000L
        private const val MIN_DISTANCE_M = 2.5f
    }

    private val appContext = context.applicationContext
    private val locationManager = appContext.getSystemService(LocationManager::class.java)
    private val uploading = AtomicBoolean(false)

    @Volatile
    var running: Boolean = false
        private set

    private var lastUploadedLocation: Location? = null
    private var lastUploadAt = 0L

    fun start(): Boolean {
        if (running) return true
        if (!store.configured || store.memberId.isBlank() || !hasLocationPermission()) return false

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

            running = true
            if (lastKnown != null && System.currentTimeMillis() - lastKnown.time <= MAX_LAST_KNOWN_AGE_MS) {
                upload(lastKnown, force = true)
            }
            true
        } catch (_: SecurityException) {
            running = false
            false
        } catch (_: Throwable) {
            running = false
            false
        }
    }

    fun stop() {
        if (!running) return
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
        if (best != null) upload(best, force = true)
    }

    override fun onLocationChanged(location: Location) {
        upload(location, force = false)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    private fun upload(location: Location, force: Boolean) {
        if (!running || !valid(location) || !uploading.compareAndSet(false, true)) return

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

        Thread {
            try {
                val token = accessTokenProvider()
                Api.upsertFamilyLocation(
                    accessToken = token,
                    memberId = store.memberId,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = if (location.hasAccuracy()) location.accuracy else null,
                )
                lastUploadedLocation = Location(location)
                lastUploadAt = System.currentTimeMillis()
            } catch (_: Throwable) {
                // The next GPS sample retries automatically.
            } finally {
                uploading.set(false)
            }
        }.start()
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
