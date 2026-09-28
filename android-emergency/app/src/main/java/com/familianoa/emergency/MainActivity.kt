package com.familianoa.emergency

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*

class MainActivity : Activity() {
    private lateinit var store: SessionStore
    private lateinit var root: LinearLayout
    private lateinit var permissionBox: LinearLayout
    private var members: List<FamilyMember> = emptyList()
    private var loginStatus: TextView? = null
    private var memberSpinner: Spinner? = null
    private var activateButton: Button? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        render()
        if (!store.configured) loadMembers()
    }

    override fun onResume() {
        super.onResume()
        if (::permissionBox.isInitialized) renderPermissions()
        if (store.configured) EmergencyService.start(this)
    }

    private fun render() {
        val scroll = ScrollView(this)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(34), dp(24), dp(44))
            setBackgroundColor(Color.rgb(247, 244, 237))
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)

        text("FAMILIA NOA", 14, true, Color.rgb(115, 20, 31))
        text("Protección de emergencia", 34, true, Color.rgb(24, 24, 24)).apply { setPadding(0, dp(4), 0, dp(8)) }
        text("Este módulo existe solo para AYUDA. Cuando está activo puede mostrar una alerta roja encima de otras apps y sobre la pantalla bloqueada.", 16, false, Color.DKGRAY)
        spacer(22)

        if (store.configured) renderConfigured() else renderLogin()

        spacer(24)
        text("PERMISOS DE PRIORIDAD", 12, true, Color.DKGRAY)
        permissionBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(permissionBox)
        renderPermissions()
    }

    private fun renderConfigured() {
        card().apply {
            addView(makeText("Protección configurada", 18, true, Color.rgb(20, 90, 48)))
            addView(makeText(store.memberName, 26, true, Color.BLACK))
            addView(makeText("El servicio se inicia automáticamente y vuelve a arrancar después de reiniciar el teléfono.", 14, false, Color.DKGRAY))
        }
        button("ACTIVAR / REINICIAR PROTECCIÓN") { EmergencyService.start(this); toast("Protección activa") }
        button("ABRIR FAMILIA NOA") {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Config.FAMILY_WEB_URL)))
        }
        val change = Button(this).apply {
            text = "Cambiar perfil de este teléfono"
            setOnClickListener {
                EmergencyService.stop(this@MainActivity)
                store.clearAll()
                recreate()
            }
        }
        root.addView(change)
    }

    private fun renderLogin() {
        val status = text("Cargando miembros…", 14, false, Color.DKGRAY)
        loginStatus = status
        val spinner = Spinner(this)
        memberSpinner = spinner
        root.addView(spinner, match())
        val house = EditText(this).apply {
            hint = "Número de la casa de Trinidad"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        val nickname = EditText(this).apply { hint = "Tu apodo en la familia" }
        root.addView(house, match())
        root.addView(nickname, match())
        val activate = Button(this).apply {
            text = "CONFIGURAR PROTECCIÓN"
            isEnabled = false
        }
        activateButton = activate
        root.addView(activate, match())

        activate.setOnClickListener {
            if (members.isEmpty()) return@setOnClickListener
            val index = spinner.selectedItemPosition.coerceIn(0, members.lastIndex)
            val member = members[index]
            val houseValue = house.text.toString().trim()
            val nicknameValue = nickname.text.toString().trim()
            if (houseValue.isBlank() || nicknameValue.isBlank()) {
                status.text = "Completa los dos datos familiares."
                return@setOnClickListener
            }
            activate.isEnabled = false
            status.text = "Verificando acceso familiar…"
            Thread {
                try {
                    val session = Api.login(member.id, houseValue, nicknameValue)
                    store.saveSession(session.memberId, session.memberName, session.accessToken, session.refreshToken, session.expiresAt)
                    runOnUiThread {
                        EmergencyService.start(this)
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 110)
                        }
                        recreate()
                    }
                } catch (error:Throwable) {
                    runOnUiThread {
                        status.text = error.message ?: "No se pudo configurar."
                        activate.isEnabled = true
                    }
                }
            }.start()
        }
    }

    private fun loadMembers() {
        Thread {
            try {
                val loaded = Api.fetchMembers()
                members = loaded
                runOnUiThread {
                    memberSpinner?.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, loaded.map { it.name })
                    loginStatus?.text = if (loaded.isEmpty()) "No hay miembros disponibles." else "Elige quién usa este teléfono."
                    activateButton?.isEnabled = loaded.isNotEmpty()
                }
            } catch (error:Throwable) {
                runOnUiThread {
                    loginStatus?.text = error.message ?: "No se pudo cargar la familia"
                    activateButton?.isEnabled = false
                }
            }
        }.start()
    }

    private fun renderPermissions() {
        if (!::permissionBox.isInitialized) return
        permissionBox.removeAllViews()
        val notificationsOk = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val overlayOk = Settings.canDrawOverlays(this)
        val nm = getSystemService(NotificationManager::class.java)
        val fullScreenOk = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()
        val dndOk = nm.isNotificationPolicyAccessGranted
        val pm = getSystemService(PowerManager::class.java)
        val batteryOk = pm.isIgnoringBatteryOptimizations(packageName)

        permissionBox.addView(permissionButton("Notificaciones", notificationsOk) {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 110)
        })
        permissionBox.addView(permissionButton("Mostrar sobre otras aplicaciones", overlayOk) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        permissionBox.addView(permissionButton("Pantalla completa de emergencia", fullScreenOk) {
            if (Build.VERSION.SDK_INT >= 34) startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
        })
        permissionBox.addView(permissionButton("Ignorar ahorro de batería", batteryOk) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        })
        permissionBox.addView(permissionButton("Atravesar No molestar", dndOk) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        })
        val all = notificationsOk && overlayOk && fullScreenOk && batteryOk
        permissionBox.addView(makeText(if (all) "✓ Protección de máxima prioridad lista" else "Activa todos los permisos posibles para que AYUDA tenga la máxima prioridad.", 14, true, if (all) Color.rgb(20,90,48) else Color.rgb(150,35,35)))
    }

    private fun permissionButton(label:String, ok:Boolean, action:()->Unit): Button = Button(this).apply {
        text = if (ok) "✓ $label" else "ACTIVAR · $label"
        setOnClickListener { action() }
        isAllCaps = false
    }

    private fun card():LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            setBackgroundColor(Color.WHITE)
        }
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(14) })
        return box
    }

    private fun button(label:String, action:()->Unit) {
        root.addView(Button(this).apply { text = label; setOnClickListener { action() } }, match())
    }

    private fun text(value:String, size:Int, bold:Boolean, color:Int):TextView = makeText(value,size,bold,color).also { root.addView(it, match()) }
    private fun makeText(value:String,size:Int,bold:Boolean,color:Int)=TextView(this).apply {
        text=value
        textSize=size.toFloat()
        setTextColor(color)
        if(bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        gravity=Gravity.START
        setPadding(0, dp(5), 0, dp(5))
    }
    private fun spacer(height:Int)=Space(this).also { root.addView(it, LinearLayout.LayoutParams(1,dp(height))) }
    private fun match()=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin=dp(8) }
    private fun dp(value:Int)=(value*resources.displayMetrics.density).toInt()
    private fun toast(value:String)=Toast.makeText(this,value,Toast.LENGTH_SHORT).show()
}
