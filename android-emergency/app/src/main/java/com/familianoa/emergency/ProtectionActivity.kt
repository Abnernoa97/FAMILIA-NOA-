package com.familianoa.emergency

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import android.widget.Toast

class ProtectionActivity : Activity() {
    companion object {
        private const val REQ_NOTIFICATIONS = 110
        private const val REQ_MEDIA = 111
        private const val REQ_LOCATION = 112
        private val BG: Int = Color.rgb(247, 244, 237)
        private val INK: Int = Color.rgb(23, 23, 22)
        private val MUTED: Int = Color.rgb(107, 103, 96)
        private val ERROR: Int = Color.rgb(154, 54, 48)
    }

    private lateinit var store: SessionStore
    private lateinit var root: LinearLayout
    private var members: List<FamilyMember> = emptyList()
    private var selectedMember: FamilyMember? = null
    private var currentScreen = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        window.statusBarColor = BG
        window.navigationBarColor = Color.BLACK
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        if (store.configured) renderReady() else {
            renderWhoAreYou()
            loadMembers()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::store.isInitialized) return
        if (store.configured) EmergencyService.start(this)
        if (::root.isInitialized && currentScreen != "security") renderCurrent()
    }

    private fun renderCurrent() {
        when {
            store.configured -> renderReady()
            currentScreen == "security" && selectedMember != null -> renderSecurity(selectedMember!!)
            else -> renderWhoAreYou()
        }
    }

    private fun renderWhoAreYou() {
        currentScreen = "who"
        selectedMember = null
        beginPage()
        brand()
        spacer(34)
        eyebrow("PRIVATE FAMILY SPACE")
        displayTitle("¿Quién eres?")
        body("Un solo lugar para estar cerca, estés donde estés.")
        spacer(24)
        permissionCard()
        spacer(26)
        divider("entra con tu perfil")
        spacer(18)

        if (members.isEmpty()) {
            val loading = text("Cargando familia…", 15, false, MUTED)
            loading.gravity = Gravity.CENTER_HORIZONTAL
        } else {
            members.forEach { member ->
                profileCard(member.name) { renderSecurity(member) }
                spacer(10)
            }
        }
    }

    private fun renderSecurity(member: FamilyMember) {
        currentScreen = "security"
        selectedMember = member
        beginPage()
        backButton { renderWhoAreYou() }
        spacer(14)
        brand()
        spacer(30)
        eyebrow("ACCESO FAMILIAR")
        displayTitle(member.name)
        body("Confirma tus datos una sola vez para conectar este teléfono.")
        spacer(24)

        val status = text("", 13, false, ERROR)
        val house = field("Número de la casa de Trinidad", numeric = true)
        val nickname = field("Tu apodo en la familia", numeric = false)
        spacer(8)
        val enter = primaryButton("ENTRAR") { button ->
            val houseValue = house.text.toString().trim()
            val nicknameValue = nickname.text.toString().trim()
            if (houseValue.isBlank() || nicknameValue.isBlank()) {
                status.text = "Completa los dos datos familiares."
                return@primaryButton
            }
            status.text = "Verificando…"
            button.isEnabled = false
            Thread {
                try {
                    val session = Api.login(member.id, houseValue, nicknameValue)
                    store.saveSession(session.memberId, session.memberName, session.accessToken, session.refreshToken, session.expiresAt)
                    EmergencyService.start(this)
                    runOnUiThread {
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
                        }
                        renderReady()
                    }
                } catch (_: Throwable) {
                    runOnUiThread {
                        status.text = "Datos incorrectos. Comprueba el número de la casa y tu apodo."
                        button.isEnabled = true
                    }
                }
            }.start()
        }
        enter.contentDescription = "Entrar a FAMILIA NOA"
    }

    private fun renderReady() {
        currentScreen = "ready"
        selectedMember = null
        beginPage()
        brand()
        spacer(34)
        eyebrow("PRIVATE FAMILY SPACE")
        displayTitle("Hola, ${store.memberName}")
        body("Este teléfono ya recuerda tu perfil. La próxima vez entrarás directo a FAMILIA NOA.")
        spacer(24)
        permissionCard()
        spacer(22)
        primaryButton("ENTRAR A FAMILIA NOA") { openFamily() }
        spacer(10)
        secondaryButton("Cambiar perfil de este teléfono") {
            EmergencyService.stop(this)
            store.clearAll()
            members = emptyList()
            renderWhoAreYou()
            loadMembers()
        }
    }

    private fun beginPage() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(BG)
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(28), dp(28), dp(44))
            setBackgroundColor(BG)
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
    }

    private fun brand() {
        text("FAMILIA NOA", 18, true, INK).apply { letterSpacing = .13f }
    }

    private fun eyebrow(value: String) {
        text(value, 12, false, Color.rgb(58, 58, 56)).apply { letterSpacing = .04f }
        spacer(10)
    }

    private fun displayTitle(value: String) {
        text(value, 44, false, INK).apply {
            typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
            setLineSpacing(0f, .92f)
        }
        spacer(8)
    }

    private fun body(value: String) {
        text(value, 18, false, MUTED).apply { setLineSpacing(dp(3).toFloat(), 1f) }
    }

    private data class PermissionState(
        val notifications: Boolean,
        val overlay: Boolean,
        val fullScreen: Boolean,
        val battery: Boolean,
        val dnd: Boolean,
        val camera: Boolean,
        val microphone: Boolean,
        val location: Boolean,
    ) {
        val allReady: Boolean get() = notifications && overlay && fullScreen && battery && dnd && camera && microphone && location
    }

    private fun permissions(): PermissionState {
        val manager = getSystemService(NotificationManager::class.java)
        val power = getSystemService(PowerManager::class.java)
        return PermissionState(
            notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
            overlay = Settings.canDrawOverlays(this),
            fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent(),
            battery = power.isIgnoringBatteryOptimizations(packageName),
            dnd = manager.isNotificationPolicyAccessGranted,
            camera = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
            microphone = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
            location = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED,
        )
    }

    private fun permissionCard() {
        val state = permissions()
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(17), dp(18), dp(17))
            background = rounded(Color.WHITE, 22, Color.rgb(225, 219, 209))
        }
        card.addView(makeText("Prepara este teléfono", 15, true, INK))
        card.addView(makeText("Todo se activa desde aquí. AYUDA sigue trabajando por detrás.", 11, false, MUTED).apply { setPadding(0, dp(3), 0, dp(10)) })

        val alerts = listOf(state.notifications, state.overlay, state.fullScreen)
        val power = listOf(state.battery, state.dnd)
        val media = listOf(state.camera, state.microphone)
        card.addView(statusRow("Alertas de emergencia", alerts.count { it }, alerts.size))
        card.addView(statusRow("Batería y No molestar", power.count { it }, power.size))
        card.addView(statusRow("Cámara y voz", media.count { it }, media.size))
        card.addView(statusRow("Ubicación", if (state.location) 1 else 0, 1))

        val action = Button(this).apply {
            text = if (state.allReady) "✓ TELÉFONO LISTO" else "ACTIVAR LO QUE FALTA"
            isAllCaps = false
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (state.allReady) Color.rgb(24, 104, 59) else Color.WHITE)
            background = rounded(if (state.allReady) Color.rgb(238, 247, 241) else INK, 15)
            setPadding(dp(12), dp(11), dp(12), dp(11))
            isEnabled = !state.allReady
            setOnClickListener { activateNextMissing() }
        }
        card.addView(action, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(11) })
        root.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun statusRow(label: String, ready: Int, total: Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(7), 0, dp(7))
        }
        val dot = TextView(this).apply {
            text = if (ready == total) "✓" else "○"
            textSize = 16f
            setTextColor(if (ready == total) Color.rgb(24, 104, 59) else Color.rgb(145, 139, 128))
            gravity = Gravity.CENTER
        }
        row.addView(dot, LinearLayout.LayoutParams(dp(28), dp(28)))
        row.addView(makeText(label, 12, true, INK), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(makeText(if (ready == total) "Listo" else "$ready/$total", 11, true, if (ready == total) Color.rgb(24, 104, 59) else MUTED))
        return row
    }

    private fun activateNextMissing() {
        val state = permissions()
        when {
            !state.notifications && Build.VERSION.SDK_INT >= 33 -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
            !state.overlay -> startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            !state.fullScreen && Build.VERSION.SDK_INT >= 34 -> startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
            !state.battery -> startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            !state.dnd -> startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
            !state.camera || !state.microphone -> {
                val missing = mutableListOf<String>()
                if (!state.camera) missing += Manifest.permission.CAMERA
                if (!state.microphone) missing += Manifest.permission.RECORD_AUDIO
                requestPermissions(missing.toTypedArray(), REQ_MEDIA)
            }
            !state.location -> requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_LOCATION)
            else -> toast("Este teléfono ya está listo")
        }
    }

    private fun loadMembers() {
        Thread {
            try {
                val loaded = Api.fetchMembers()
                members = loaded
                runOnUiThread {
                    if (!store.configured && currentScreen == "who") renderWhoAreYou()
                }
            } catch (error: Throwable) {
                runOnUiThread { toast(error.message ?: "No se pudo cargar la familia") }
            }
        }.start()
    }

    private fun profileCard(name: String, action: () -> Unit) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(Color.WHITE, 20, Color.rgb(230, 225, 217))
            setPadding(dp(18), 0, dp(16), 0)
            isClickable = true
            isFocusable = true
            setOnClickListener { action() }
        }
        card.addView(makeText(name, 18, true, INK), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        card.addView(makeText("›", 28, false, INK))
        root.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76)))
    }

    private fun field(hint: String, numeric: Boolean): EditText {
        val input = EditText(this).apply {
            this.hint = hint
            textSize = 16f
            setTextColor(INK)
            setHintTextColor(Color.rgb(135, 131, 123))
            background = rounded(Color.WHITE, 18, Color.rgb(224, 219, 210))
            setPadding(dp(16), 0, dp(16), 0)
            inputType = if (numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT
            isSingleLine = true
        }
        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)).apply { bottomMargin = dp(11) })
        return input
    }

    private fun primaryButton(label: String, action: (Button) -> Unit): Button {
        val button = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            background = rounded(INK, 18)
            setOnClickListener { action(this) }
        }
        root.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)))
        return button
    }

    private fun secondaryButton(label: String, action: () -> Unit) {
        val button = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(INK)
            background = rounded(Color.WHITE, 18, Color.rgb(224, 219, 210))
            setOnClickListener { action() }
        }
        root.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
    }

    private fun backButton(action: () -> Unit) {
        val button = TextView(this).apply {
            text = "‹ Volver"
            textSize = 14f
            setTextColor(INK)
            setPadding(0, dp(8), 0, dp(8))
            setOnClickListener { action() }
        }
        root.addView(button)
    }

    private fun divider(value: String) {
        val label = text(value, 12, false, Color.rgb(145, 140, 132))
        label.gravity = Gravity.CENTER
    }

    private fun text(value: String, size: Int, bold: Boolean, color: Int): TextView = makeText(value, size, bold, color).also {
        root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun makeText(value: String, size: Int, bold: Boolean, color: Int) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.START
    }

    private fun spacer(height: Int) {
        root.addView(Space(this), LinearLayout.LayoutParams(1, dp(height)))
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fill)
        cornerRadius = dp(radius).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }

    private fun openFamily() {
        EmergencyService.start(this)
        startActivity(Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
        finish()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFICATIONS || requestCode == REQ_MEDIA || requestCode == REQ_LOCATION) renderCurrent()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (currentScreen == "security") renderWhoAreYou() else super.onBackPressed()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_SHORT).show()
}
