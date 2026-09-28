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
    val activeAlertId: String get() = prefs.getString("active_alert_id", "") ?: ""
    val activeAlertMemberId: String get() = prefs.getString("active_alert_member_id", "") ?: ""
    val activeAlertMessage: String get() = prefs.getString("active_alert_message", "") ?: ""
    val activeAlertCreatedAt: String get() = prefs.getString("active_alert_created_at", "") ?: ""

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
