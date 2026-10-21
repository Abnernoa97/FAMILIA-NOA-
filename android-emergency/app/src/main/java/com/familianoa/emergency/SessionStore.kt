package com.familianoa.emergency

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("familia_noa_emergency", Context.MODE_PRIVATE)

    val configured: Boolean get() = prefs.getBoolean("configured", false)
    val memberId: String get() = prefs.getString("member_id", "") ?: ""
    val memberName: String get() = prefs.getString("member_name", "") ?: ""
    val accessToken: String get() = prefs.getString("access_token", "") ?: ""
    val refreshToken: String get() = prefs.getString("refresh_token", "") ?: ""
    val expiresAt: Long get() = prefs.getLong("expires_at", 0L)
    val biometricEnabled: Boolean get() = prefs.getBoolean("biometric_enabled", false)
    val activeAlertId: String get() = prefs.getString("active_alert_id", "") ?: ""
    val activeAlertMemberId: String get() = prefs.getString("active_alert_member_id", "") ?: ""
    val activeAlertMessage: String get() = prefs.getString("active_alert_message", "") ?: ""
    val activeAlertCreatedAt: String get() = prefs.getString("active_alert_created_at", "") ?: ""
    val locationSharingEnabled: Boolean get() = prefs.getBoolean("location_sharing_enabled", false)
    val lastLocationUploadAtMs: Long get() = prefs.getLong("last_location_upload_at_ms", 0L)
    val lastFamilyActivityId: Long get() = prefs.getLong("last_family_activity_id", 0L)

    fun saveSession(memberId:String, memberName:String, accessToken:String, refreshToken:String, expiresAt:Long) {
        prefs.edit()
            .putBoolean("configured", true)
            .putString("member_id", memberId)
            .putString("member_name", memberName)
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .putLong("expires_at", expiresAt)
            .apply()
    }

    fun updateTokens(accessToken:String, refreshToken:String, expiresAt:Long) {
        prefs.edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .putLong("expires_at", expiresAt)
            .apply()
    }

    fun rememberFamilyActivity(id:Long):Boolean {
        synchronized(this) {
            if (id <= lastFamilyActivityId) return false
            prefs.edit().putLong("last_family_activity_id", id).apply()
            return true
        }
    }

    // Track a bounded collection, not just the highest event ID: Realtime can
    // deliver concurrent notifications out of order. Durable across process restarts.
    fun claimActivityEvent(id:Long):Boolean {
        if (id <= 0L) return false
        synchronized(this) {
            val key="shown_family_activity_ids"
            val ids=(prefs.getString(key,"") ?: "").split(",").filter { it.isNotBlank() }
            if (id.toString() in ids) return false
            val updated=(ids.takeLast(95) + id.toString()).joinToString(",")
            prefs.edit().putString(key,updated).apply()
            return true
        }
    }

    fun setBiometricEnabled(enabled:Boolean) {
        prefs.edit().putBoolean("biometric_enabled", enabled).apply()
    }

    fun setLocationSharingEnabled(enabled:Boolean) {
        // SharedPreferences apply() updates the in-process value immediately;
        // the location worker checks this flag before every network upload.
        prefs.edit().putBoolean("location_sharing_enabled", enabled).apply()
    }

    fun recordLocationUpload() {
        if (locationSharingEnabled) {
            prefs.edit().putLong("last_location_upload_at_ms", System.currentTimeMillis()).apply()
        }
    }

    fun needsRefresh(): Boolean = expiresAt <= (System.currentTimeMillis() / 1000L) + 120L

    fun setActiveAlert(id:String, memberId:String, message:String, createdAt:String) {
        prefs.edit()
            .putString("active_alert_id", id)
            .putString("active_alert_member_id", memberId)
            .putString("active_alert_message", message)
            .putString("active_alert_created_at", createdAt)
            .apply()
    }

    fun clearActiveAlert(id:String? = null) {
        if (id != null && activeAlertId.isNotBlank() && activeAlertId != id) return
        prefs.edit()
            .remove("active_alert_id")
            .remove("active_alert_member_id")
            .remove("active_alert_message")
            .remove("active_alert_created_at")
            .apply()
    }

    fun clearAll() = prefs.edit().clear().apply()
}
