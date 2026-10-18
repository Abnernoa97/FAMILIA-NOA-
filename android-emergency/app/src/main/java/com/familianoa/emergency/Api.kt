package com.familianoa.emergency

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class FamilyMember(val id:String, val name:String)
data class FamilySession(
    val memberId:String,
    val memberName:String,
    val accessToken:String,
    val refreshToken:String,
    val expiresAt:Long,
)
data class EmergencyAlert(
    val id:String,
    val memberId:String,
    val message:String,
    val createdAt:String,
)

object Api {
    val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun fetchMembers(): List<FamilyMember> {
        val request = Request.Builder()
            .url("${Config.SUPABASE_URL}/rest/v1/family_members?select=id,name&active=eq.true&order=created_at.asc")
            .header("apikey", Config.PUBLISHABLE_KEY)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("No se pudo cargar la familia (${response.code})")
            val array = JSONArray(response.body?.string().orEmpty())
            return (0 until array.length()).map { index ->
                val row = array.getJSONObject(index)
                FamilyMember(row.getString("id"), row.getString("name"))
            }
        }
    }

    fun login(memberId:String, houseNumber:String, nickname:String): FamilySession {
        val body = JSONObject()
            .put("member_id", memberId)
            .put("house_number", houseNumber)
            .put("nickname", nickname)
        val request = Request.Builder()
            .url("${Config.SUPABASE_URL}/functions/v1/family-session")
            .header("apikey", Config.PUBLISHABLE_KEY)
            .header("x-family-noa-native", Config.NATIVE_HEADER)
            .post(body.toString().toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) error("Acceso familiar rechazado (${response.code})")
            val json = JSONObject(raw)
            if (!json.optBoolean("ok", false)) error("No se pudo iniciar la protección")
            val profile = json.getJSONObject("profile")
            val session = json.getJSONObject("session")
            val expiresAt = session.optLong("expires_at", 0L).takeIf { it > 0L }
                ?: (System.currentTimeMillis() / 1000L + session.optLong("expires_in", 3600L))
            return FamilySession(
                memberId = profile.getString("id"),
                memberName = profile.getString("name"),
                accessToken = session.getString("access_token"),
                refreshToken = session.getString("refresh_token"),
                expiresAt = expiresAt,
            )
        }
    }

    fun refreshSession(refreshToken:String): FamilySession {
        val body = JSONObject().put("refresh_token", refreshToken)
        val request = Request.Builder()
            .url("${Config.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token")
            .header("apikey", Config.PUBLISHABLE_KEY)
            .post(body.toString().toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) error("La sesión de emergencia necesita renovarse")
            val json = JSONObject(raw)
            val user = json.optJSONObject("user")
            val metadata = user?.optJSONObject("app_metadata")
            val memberId = metadata?.optString("member_id").orEmpty()
            val expiresAt = json.optLong("expires_at", 0L).takeIf { it > 0L }
                ?: (System.currentTimeMillis() / 1000L + json.optLong("expires_in", 3600L))
            return FamilySession(
                memberId = memberId,
                memberName = "",
                accessToken = json.getString("access_token"),
                refreshToken = json.optString("refresh_token", refreshToken),
                expiresAt = expiresAt,
            )
        }
    }

    fun activeEmergency(accessToken:String): EmergencyAlert? {
        val url = "${Config.SUPABASE_URL}/rest/v1/help_alerts?select=id,member_id,message,created_at,resolved_at,emergency&emergency=eq.true&resolved_at=is.null&order=created_at.desc&limit=1"
        val request = Request.Builder()
            .url(url)
            .header("apikey", Config.PUBLISHABLE_KEY)
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("No se pudo comprobar AYUDA (${response.code})")
            val array = JSONArray(response.body?.string().orEmpty())
            if (array.length() == 0) return null
            return parseAlert(array.getJSONObject(0))
        }
    }

    fun resolveEmergency(accessToken:String, alertId:String): Boolean {
        val body = JSONObject().put("action", "resolve").put("alert_id", alertId)
        val request = Request.Builder()
            .url("${Config.SUPABASE_URL}/functions/v1/family-emergency")
            .header("apikey", Config.PUBLISHABLE_KEY)
            .header("Authorization", "Bearer $accessToken")
            .header("x-family-noa-native", Config.NATIVE_HEADER)
            .post(body.toString().toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return false
            val json = JSONObject(response.body?.string().orEmpty())
            return json.optBoolean("ok", false)
        }
    }

    fun parseAlert(row:JSONObject): EmergencyAlert = EmergencyAlert(
        id = row.optString("id"),
        memberId = row.optString("member_id"),
        message = row.optString("message", "EMERGENCIA FAMILIA NOA"),
        createdAt = row.optString("created_at"),
    )
}
