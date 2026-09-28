package com.familianoa.emergency

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class EmergencyActivity : Activity() {
    private lateinit var store: SessionStore
    private var alertId = ""
    private var alertMemberId = ""
    private var message = "EMERGENCIA FAMILIA NOA"
    private var createdAt = ""
    private lateinit var actionButton: Button

    private val resolvedReceiver = object:BroadcastReceiver() {
        override fun onReceive(context:Context?, intent:Intent?) {
            val resolvedId = intent?.getStringExtra("alert_id").orEmpty()
            if (resolvedId.isBlank() || resolvedId == alertId) finishAndRemoveTask()
        }
    }

    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        configureWindow()
        readAlert(intent)
        render()
    }

    override fun onNewIntent(intent:Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            readAlert(intent)
            render()
        }
    }

    @Suppress("DEPRECATION")
    override fun onStart() {
        super.onStart()
        val filter = IntentFilter("com.familianoa.emergency.RESOLVED")
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(resolvedReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(resolvedReceiver, filter)
    }

    override fun onStop() {
        try { unregisterReceiver(resolvedReceiver) } catch (_:Throwable) {}
        super.onStop()
    }

    private fun configureWindow() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
        window.statusBarColor = Color.rgb(176, 0, 32)
        window.navigationBarColor = Color.rgb(120, 0, 18)
    }

    private fun readAlert(source:Intent) {
        alertId = source.getStringExtra("alert_id").orEmpty().ifBlank { store.activeAlertId }
        alertMemberId = source.getStringExtra("member_id").orEmpty().ifBlank { store.activeAlertMemberId }
        message = source.getStringExtra("message").orEmpty().ifBlank { store.activeAlertMessage.ifBlank { "EMERGENCIA FAMILIA NOA" } }
        createdAt = source.getStringExtra("created_at").orEmpty().ifBlank { store.activeAlertCreatedAt }
    }

    private fun render() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(26), dp(40), dp(26), dp(40))
            setBackgroundColor(Color.rgb(176, 0, 32))
        }
        fun label(value:String, size:Float, bold:Boolean)=TextView(this).apply {
            text=value
            textSize=size
            setTextColor(Color.WHITE)
            gravity=Gravity.CENTER
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(8), 0, dp(8))
        }
        root.addView(label("🚨", 72f, false))
        root.addView(label("EMERGENCIA", 42f, true))
        root.addView(label(message, 28f, true))
        root.addView(label(formatTime(createdAt), 16f, false))
        root.addView(label("Esta pantalla tiene prioridad porque alguien de la familia activó AYUDA.", 15f, false))

        val mine = alertMemberId.isNotBlank() && alertMemberId == store.memberId
        actionButton = Button(this).apply {
            text = if (mine) "CANCELAR EMERGENCIA" else "MARCAR COMO ATENDIDA"
            textSize = 18f
            setOnClickListener { resolveEmergency() }
        }
        root.addView(actionButton, LinearLayout.LayoutParams(-1, dp(66)).apply { topMargin = dp(28) })
        setContentView(root)
    }

    private fun resolveEmergency() {
        if (alertId.isBlank()) return
        actionButton.isEnabled = false
        actionButton.text = "ACTUALIZANDO…"
        Thread {
            try {
                var token = store.accessToken
                if (store.needsRefresh()) {
                    val refreshed = Api.refreshSession(store.refreshToken)
                    store.saveSession(
                        refreshed.memberId.ifBlank { store.memberId },
                        store.memberName,
                        refreshed.accessToken,
                        refreshed.refreshToken,
                        refreshed.expiresAt
                    )
                    token = refreshed.accessToken
                }
                val ok = Api.resolveEmergency(token, alertId)
                runOnUiThread {
                    if (ok) {
                        EmergencyService.resolved(this, alertId)
                        finishAndRemoveTask()
                    } else {
                        actionButton.isEnabled = true
                        actionButton.text = if (alertMemberId == store.memberId) "CANCELAR EMERGENCIA" else "MARCAR COMO ATENDIDA"
                        Toast.makeText(this, "No se pudo cerrar la emergencia todavía.", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (error:Throwable) {
                runOnUiThread {
                    actionButton.isEnabled = true
                    actionButton.text = if (alertMemberId == store.memberId) "CANCELAR EMERGENCIA" else "MARCAR COMO ATENDIDA"
                    Toast.makeText(this, error.message ?: "Sin conexión", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun formatTime(value:String):String {
        if (value.isBlank()) return "AYUDA activa ahora"
        return try {
            val date = OffsetDateTime.parse(value)
            val formatter = DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale("es", "MX"))
            "Activada ${date.format(formatter)}"
        } catch (_:Throwable) { "AYUDA activa" }
    }

    @Deprecated("Emergency screen cannot be dismissed with Back")
    override fun onBackPressed() { }

    private fun dp(value:Int)=(value*resources.displayMetrics.density).toInt()
}
