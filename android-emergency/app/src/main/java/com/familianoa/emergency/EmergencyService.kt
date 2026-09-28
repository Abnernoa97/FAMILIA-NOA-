package com.familianoa.emergency

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.media.AudioAttributes
import android.os.*
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

class EmergencyService : Service() {
    companion object {
        const val ACTION_LOCAL_RESOLVED = "com.familianoa.emergency.LOCAL_RESOLVED"
        private const val EXTRA_ALERT_ID = "alert_id"
        private const val PROTECTION_CHANNEL = "familia_noa_protection"
        private const val EMERGENCY_CHANNEL = "familia_noa_emergency"
        private const val PROTECTION_NOTIFICATION = 7001
        private const val EMERGENCY_NOTIFICATION = 911

        fun start(context:Context) {
            val intent = Intent(context, EmergencyService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
        fun stop(context:Context) = context.stopService(Intent(context, EmergencyService::class.java))
        fun resolved(context:Context, alertId:String) {
            val intent = Intent(context, EmergencyService::class.java).setAction(ACTION_LOCAL_RESOLVED).putExtra(EXTRA_ALERT_ID, alertId)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
    }

    private lateinit var store: SessionStore
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var overlayView: View? = null
    private var reconnectAttempt = 0
    private var connecting = false
    private val refs = AtomicInteger(2)
    private var heartbeat:Runnable? = null
    private var refreshTask:Runnable? = null
    private var vibrator:android.os.Vibrator? = null

    override fun onCreate() {
        super.onCreate()
        store = SessionStore(this)
        createChannels()
        startAsForeground("Preparando protección…")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_LOCAL_RESOLVED) {
            clearEmergency(intent.getStringExtra(EXTRA_ALERT_ID).orEmpty())
        }
        if (!store.configured) {
            updateProtection("Abre la app para configurar este teléfono")
            return START_STICKY
        }
        ensureConnected()
        return START_STICKY
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NotificationManager::class.java)
        val protection = NotificationChannel(PROTECTION_CHANNEL, "Protección FAMILIA NOA", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Mantiene activa la vigilancia del botón AYUDA"
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        }
        val alarmAudio = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
        val emergency = NotificationChannel(EMERGENCY_CHANNEL, "EMERGENCIA FAMILIA NOA", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Alertas familiares de emergencia"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 700, 250, 700, 250, 1200)
            setSound(Settings.System.DEFAULT_ALARM_ALERT_URI, alarmAudio)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            if (manager.isNotificationPolicyAccessGranted) setBypassDnd(true)
        }
        manager.createNotificationChannel(protection)
        manager.createNotificationChannel(emergency)
    }

    private fun protectionNotification(state:String): Notification {
        val open = PendingIntent.getActivity(
            this, 70, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, PROTECTION_CHANNEL) else Notification.Builder(this)
        return builder
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("FAMILIA NOA · protección activa")
            .setContentText(state)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun startAsForeground(state:String) {
        val notification = protectionNotification(state)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(PROTECTION_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(PROTECTION_NOTIFICATION, notification)
        }
    }

    private fun updateProtection(state:String) {
        getSystemService(NotificationManager::class.java).notify(PROTECTION_NOTIFICATION, protectionNotification(state))
    }

    @Synchronized private fun ensureConnected() {
        if (connecting || socket != null || !store.configured) return
        connecting = true
        Thread {
            try {
                var token = store.accessToken
                if (store.needsRefresh()) token = refreshSession()
                val active = Api.activeEmergency(token)
                if (active != null) showEmergency(active) else if (store.activeAlertId.isNotBlank()) clearEmergency(store.activeAlertId)
                connectRealtime(token)
            } catch (error:Throwable) {
                connecting = false
                updateProtection("Reconectando…")
                scheduleReconnect()
            }
        }.start()
    }

    private fun refreshSession():String {
        val refreshed = Api.refreshSession(store.refreshToken)
        val memberId = refreshed.memberId.ifBlank { store.memberId }
        store.saveSession(memberId, store.memberName, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt)
        return refreshed.accessToken
    }

    private fun connectRealtime(accessToken:String) {
        val url = "wss://${Config.SUPABASE_PROJECT_REF}.supabase.co/realtime/v1/websocket?apikey=${Config.PUBLISHABLE_KEY}&vsn=1.0.0"
        val request = Request.Builder().url(url).build()
        socket = Api.http.newWebSocket(request, object:WebSocketListener() {
            override fun onOpen(webSocket:WebSocket, response:Response) {
                connecting = false
                reconnectAttempt = 0
                updateProtection("Conectado · AYUDA vigilada en tiempo real")
                sendJoin(webSocket, accessToken)
                scheduleHeartbeat(webSocket)
                scheduleTokenRefresh()
            }

            override fun onMessage(webSocket:WebSocket, text:String) {
                processRealtime(text)
            }

            override fun onClosed(webSocket:WebSocket, code:Int, reason:String) {
                socket = null
                connecting = false
                cancelHeartbeat()
                scheduleReconnect()
            }

            override fun onFailure(webSocket:WebSocket, t:Throwable, response:Response?) {
                socket = null
                connecting = false
                cancelHeartbeat()
                updateProtection("Sin conexión · reconectando")
                scheduleReconnect()
            }
        })
    }

    private fun sendJoin(webSocket:WebSocket, accessToken:String) {
        val changes = JSONArray().put(JSONObject()
            .put("event", "*")
            .put("schema", "public")
            .put("table", "help_alerts")
            .put("filter", "emergency=eq.true"))
        val config = JSONObject()
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("enabled", false))
            .put("postgres_changes", changes)
            .put("private", false)
        val payload = JSONObject().put("config", config).put("access_token", accessToken)
        val message = JSONObject()
            .put("topic", Config.REALTIME_TOPIC)
            .put("event", "phx_join")
            .put("payload", payload)
            .put("ref", "1")
            .put("join_ref", "1")
        webSocket.send(message.toString())
    }

    private fun scheduleHeartbeat(webSocket:WebSocket) {
        cancelHeartbeat()
        heartbeat = object:Runnable {
            override fun run() {
                if (socket !== webSocket) return
                val ref = refs.incrementAndGet().toString()
                val msg = JSONObject()
                    .put("topic", "phoenix")
                    .put("event", "heartbeat")
                    .put("payload", JSONObject())
                    .put("ref", ref)
                    .put("join_ref", JSONObject.NULL)
                webSocket.send(msg.toString())
                handler.postDelayed(this, 20_000L)
            }
        }
        handler.postDelayed(heartbeat!!, 20_000L)
    }

    private fun cancelHeartbeat() {
        heartbeat?.let(handler::removeCallbacks)
        heartbeat = null
    }

    private fun scheduleTokenRefresh() {
        refreshTask?.let(handler::removeCallbacks)
        val delay = maxOf(60_000L, store.expiresAt * 1000L - System.currentTimeMillis() - 120_000L)
        refreshTask = Runnable {
            Thread {
                try {
                    refreshSession()
                    socket?.close(1000, "token refresh")
                    socket = null
                    connecting = false
                    ensureConnected()
                } catch (_:Throwable) {
                    updateProtection("Sesión vencida · abre Emergency para renovar")
                    scheduleReconnect()
                }
            }.start()
        }
        handler.postDelayed(refreshTask!!, delay)
    }

    private fun scheduleReconnect() {
        if (!store.configured) return
        val delays = longArrayOf(1_000L, 2_000L, 5_000L, 10_000L, 20_000L)
        val delay = delays[reconnectAttempt.coerceAtMost(delays.lastIndex)]
        reconnectAttempt++
        handler.postDelayed({ ensureConnected() }, delay)
    }

    private fun processRealtime(text:String) {
        try {
            val root = JSONObject(text)
            when (root.optString("event")) {
                "postgres_changes" -> {
                    val data = root.optJSONObject("payload")?.optJSONObject("data") ?: return
                    val record = data.optJSONObject("record") ?: return
                    if (!record.optBoolean("emergency", false)) return
                    val id = record.optString("id")
                    val resolved = !record.isNull("resolved_at") && record.optString("resolved_at").isNotBlank()
                    if (resolved) clearEmergency(id) else showEmergency(Api.parseAlert(record))
                }
                "phx_error", "phx_close" -> {
                    socket?.cancel(); socket = null; connecting = false; scheduleReconnect()
                }
                "phx_reply" -> {
                    val status = root.optJSONObject("payload")?.optString("status")
                    if (status == "error") { socket?.cancel(); socket = null; connecting = false; scheduleReconnect() }
                }
            }
        } catch (_:Throwable) {}
    }

    private fun showEmergency(alert:EmergencyAlert) {
        if (alert.id.isBlank()) return
        store.setActiveAlert(alert.id, alert.memberId, alert.message, alert.createdAt)
        showEmergencyNotification(alert)
        showOverlay(alert)
        startVibration()
    }

    private fun showEmergencyNotification(alert:EmergencyAlert) {
        val intent = Intent(this, EmergencyActivity::class.java)
            .putExtra("alert_id", alert.id)
            .putExtra("member_id", alert.memberId)
            .putExtra("message", alert.message)
            .putExtra("created_at", alert.createdAt)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(
            this, 911, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, EMERGENCY_CHANNEL) else Notification.Builder(this)
        val notification = builder
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("🚨 EMERGENCIA FAMILIA NOA")
            .setContentText(alert.message)
            .setStyle(Notification.BigTextStyle().bigText("${alert.message}\nToca para atender la emergencia."))
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .build()
        getSystemService(NotificationManager::class.java).notify(EMERGENCY_NOTIFICATION, notification)
    }

    private fun showOverlay(alert:EmergencyAlert) {
        handler.post {
            removeOverlay()
            if (!Settings.canDrawOverlays(this)) return@post
            val window = getSystemService(WINDOW_SERVICE) as WindowManager
            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(28), dp(60), dp(28), dp(60))
                setBackgroundColor(Color.rgb(176, 0, 32))
            }
            fun label(value:String, size:Float, bold:Boolean):TextView = TextView(this).apply {
                text=value; textSize=size; setTextColor(Color.WHITE); gravity=Gravity.CENTER
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(0, dp(8), 0, dp(8))
            }
            root.addView(label("🚨", 64f, false))
            root.addView(label("EMERGENCIA", 38f, true))
            root.addView(label(alert.message, 25f, true))
            root.addView(label("FAMILIA NOA · AYUDA", 15f, false))
            root.addView(Button(this).apply {
                text = "ABRIR EMERGENCIA"
                textSize = 18f
                setOnClickListener {
                    val open = Intent(this@EmergencyService, EmergencyActivity::class.java)
                        .putExtra("alert_id", alert.id)
                        .putExtra("member_id", alert.memberId)
                        .putExtra("message", alert.message)
                        .putExtra("created_at", alert.createdAt)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    startActivity(open)
                }
            }, LinearLayout.LayoutParams(-1, dp(62)).apply { topMargin=dp(30) })
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT
            )
            try {
                window.addView(root, params)
                overlayView = root
            } catch (_:Throwable) {}
        }
    }

    private fun removeOverlay() {
        val view = overlayView ?: return
        try { (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view) } catch (_:Throwable) {}
        overlayView = null
    }

    private fun startVibration() {
        vibrator?.cancel()
        @Suppress("DEPRECATION")
        val vib = getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
        vibrator = vib
        val pattern = longArrayOf(0, 700, 250, 700, 250, 1200, 500)
        if (Build.VERSION.SDK_INT >= 26) vib.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0))
        else @Suppress("DEPRECATION") vib.vibrate(pattern, 0)
    }

    private fun clearEmergency(alertId:String) {
        if (alertId.isNotBlank() && store.activeAlertId.isNotBlank() && store.activeAlertId != alertId) return
        store.clearActiveAlert(alertId.ifBlank { null })
        handler.post { removeOverlay() }
        vibrator?.cancel()
        getSystemService(NotificationManager::class.java).cancel(EMERGENCY_NOTIFICATION)
        sendBroadcast(Intent("com.familianoa.emergency.RESOLVED").setPackage(packageName).putExtra("alert_id", alertId))
    }

    override fun onDestroy() {
        socket?.close(1000, "service stop")
        socket = null
        cancelHeartbeat()
        refreshTask?.let(handler::removeCallbacks)
        refreshTask = null
        removeOverlay()
        vibrator?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent:Intent?) = null
    private fun dp(value:Int)=(value*resources.displayMetrics.density).toInt()
}
