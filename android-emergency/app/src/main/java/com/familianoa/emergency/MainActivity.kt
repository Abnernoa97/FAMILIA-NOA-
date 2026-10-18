package com.familianoa.emergency

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

class MainActivity : Activity() {
    companion object {
        private const val REQ_PROTECTION = 210
        private const val REQ_FILE_CHOOSER = 211
        private const val REQ_CAMERA_FOR_CHOOSER = 212
        private const val REQ_WEB_MEDIA = 213
        private const val REQ_GEOLOCATION = 214
        private const val NATIVE_MARKER = "familia-noa-native-bootstrapped"
    }

    private lateinit var store: SessionStore
    private var webView: WebView? = null
    private var loadingView: TextView? = null
    private var openingProtection = false
    private var loadedMemberId = ""

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var captureUri: Uri? = null
    private var pendingFileChooserParams: WebChromeClient.FileChooserParams? = null

    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        window.statusBarColor = Color.rgb(246, 243, 237)
        window.navigationBarColor = Color.BLACK
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR

        if (store.configured) renderWebApp() else openProtection()
    }

    override fun onResume() {
        super.onResume()
        if (!::store.isInitialized || openingProtection) return

        if (!store.configured) {
            webView?.visibility = View.INVISIBLE
            openProtection()
            return
        }

        EmergencyService.start(this)
        if (webView == null) {
            renderWebApp()
        } else if (loadedMemberId != store.memberId) {
            loadedMemberId = store.memberId
            webView?.evaluateJavascript(
                "try{sessionStorage.removeItem('$NATIVE_MARKER');location.reload()}catch(e){}",
                null
            )
        }
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        pendingWebPermissionRequest?.deny()
        pendingWebPermissionRequest = null
        pendingGeoCallback?.invoke(pendingGeoOrigin, false, false)
        pendingGeoCallback = null
        pendingGeoOrigin = null
        webView?.apply {
            stopLoading()
            webChromeClient = null
            webViewClient = WebViewClient()
            destroy()
        }
        webView = null
        super.onDestroy()
    }

    private fun openProtection() {
        if (openingProtection) return
        openingProtection = true
        startActivityForResult(Intent(this, ProtectionActivity::class.java), REQ_PROTECTION)
    }

    private fun renderWebApp() {
        if (!store.configured || webView != null) return
        loadedMemberId = store.memberId
        EmergencyService.start(this)

        val frame = FrameLayout(this).apply { setBackgroundColor(Color.rgb(246, 243, 237)) }
        val web = WebView(this).apply {
            setBackgroundColor(Color.rgb(246, 243, 237))
            visibility = View.INVISIBLE
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setGeolocationEnabled(true)
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = settings.userAgentString + " FAMILIA-NOA-Android/2.0"
            addJavascriptInterface(NativeBridge(), "FamiliaNoaNative")
        }
        webView = web

        val loading = TextView(this).apply {
            text = "FAMILIA NOA"
            textSize = 20f
            setTextColor(Color.rgb(23, 23, 22))
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(246, 243, 237))
            setOnClickListener { web.reload() }
        }
        loadingView = loading

        frame.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.addView(loading, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(frame)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return openOutsideIfNeeded(request.url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (!url.startsWith(Config.FAMILY_WEB_URL)) {
                    view.visibility = View.VISIBLE
                    loading.visibility = View.GONE
                    return
                }
                injectNativeSession(view)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    loading.text = "Sin conexión · toca para reintentar"
                    loading.visibility = View.VISIBLE
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermissionRequest(request) }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingGeoOrigin = origin
                    pendingGeoCallback = callback
                    requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        REQ_GEOLOCATION
                    )
                }
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                captureUri = null

                if (needsCameraCapture(fileChooserParams) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    pendingFileChooserParams = fileChooserParams
                    requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA_FOR_CHOOSER)
                    return true
                }

                launchFileChooser(fileChooserParams)
                return true
            }
        }

        web.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Throwable) {
                toast("No se pudo abrir el archivo")
            }
        }

        web.loadUrl(Config.FAMILY_WEB_URL)
    }

    private fun injectNativeSession(view: WebView) {
        val auth = JSONObject()
            .put("access_token", store.accessToken)
            .put("refresh_token", store.refreshToken)
            .put("token_type", "bearer")
            .put("expires_at", store.expiresAt)
            .toString()
        val identity = JSONObject()
            .put("memberId", store.memberId)
            .put("name", store.memberName)
            .toString()

        val script = """
            (function(){
              try{
                var marker='$NATIVE_MARKER';
                if(!sessionStorage.getItem(marker)){
                  localStorage.setItem('familia-noa-family-auth', JSON.stringify($auth));
                  sessionStorage.setItem('familia-noa-identity', JSON.stringify($identity));
                  sessionStorage.setItem(marker,'1');
                  location.reload();
                  return 'reload';
                }
                if(!window.__familiaNoaNativeChangeHook){
                  window.__familiaNoaNativeChangeHook=true;
                  document.addEventListener('click',function(event){
                    var target=event.target&&event.target.closest?event.target.closest('#change'):null;
                    if(!target)return;
                    event.preventDefault();
                    event.stopPropagation();
                    if(event.stopImmediatePropagation)event.stopImmediatePropagation();
                    if(window.FamiliaNoaNative)window.FamiliaNoaNative.openProtectionSettings();
                  },true);
                }
                document.documentElement.setAttribute('data-familia-noa-native','1');
                return 'ready';
              }catch(error){return 'error';}
            })();
        """.trimIndent()

        view.evaluateJavascript(script) { result ->
            if (result?.contains("reload") == true) return@evaluateJavascript
            view.visibility = View.VISIBLE
            loadingView?.visibility = View.GONE
        }
    }

    private fun openOutsideIfNeeded(uri: Uri): Boolean {
        val familyHost = Uri.parse(Config.FAMILY_WEB_URL).host
        if ((uri.scheme == "https" || uri.scheme == "http") && uri.host == familyHost) return false
        return try {
            val intent = if (uri.scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
            else Intent(Intent.ACTION_VIEW, uri)
            startActivity(intent)
            true
        } catch (_: Throwable) {
            true
        }
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val supported = request.resources.filter {
            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }.toTypedArray()
        if (supported.isEmpty()) {
            request.deny()
            return
        }

        val permissions = mutableListOf<String>()
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in supported && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions += Manifest.permission.CAMERA
        }
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in supported && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions += Manifest.permission.RECORD_AUDIO
        }

        if (permissions.isEmpty()) {
            request.grant(supported)
        } else {
            pendingWebPermissionRequest?.deny()
            pendingWebPermissionRequest = request
            pendingWebResources = supported
            requestPermissions(permissions.distinct().toTypedArray(), REQ_WEB_MEDIA)
        }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun needsCameraCapture(params: WebChromeClient.FileChooserParams): Boolean {
        if (!params.isCaptureEnabled) return false
        val accept = params.acceptTypes.joinToString(",").lowercase()
        return accept.isBlank() || accept.contains("image") || accept.contains("video")
    }

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams) {
        pendingFileChooserParams = null
        val accept = params.acceptTypes.joinToString(",").lowercase()

        if (params.isCaptureEnabled && (accept.isBlank() || accept.contains("image"))) {
            createCaptureIntent(image = true)?.let {
                startActivityForResult(it, REQ_FILE_CHOOSER)
                return
            }
        }
        if (params.isCaptureEnabled && accept.contains("video")) {
            createCaptureIntent(image = false)?.let {
                startActivityForResult(it, REQ_FILE_CHOOSER)
                return
            }
        }

        val picker = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = when {
                accept.contains("image") && !accept.contains("video") -> "image/*"
                accept.contains("video") && !accept.contains("image") -> "video/*"
                accept.contains("audio") -> "audio/*"
                else -> "*/*"
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        }
        try {
            startActivityForResult(Intent.createChooser(picker, "Seleccionar archivo"), REQ_FILE_CHOOSER)
        } catch (_: Throwable) {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    private fun createCaptureIntent(image: Boolean): Intent? {
        return try {
            val directory = File(cacheDir, "captures").apply { mkdirs() }
            val file = File.createTempFile(if (image) "foto_" else "video_", if (image) ".jpg" else ".mp4", directory)
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            captureUri = uri
            Intent(if (image) MediaStore.ACTION_IMAGE_CAPTURE else MediaStore.ACTION_VIDEO_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri("FAMILIA NOA", uri)
            }.takeIf { it.resolveActivity(packageManager) != null }
        } catch (_: Throwable) {
            null
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_CAMERA_FOR_CHOOSER -> {
                val params = pendingFileChooserParams
                pendingFileChooserParams = null
                if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED && params != null) {
                    launchFileChooser(params)
                } else {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = null
                }
            }
            REQ_WEB_MEDIA -> {
                val request = pendingWebPermissionRequest
                val allowed = pendingWebResources.filter { resource ->
                    when (resource) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                        else -> false
                    }
                }.toTypedArray()
                if (request != null) {
                    if (allowed.isNotEmpty()) request.grant(allowed) else request.deny()
                }
                pendingWebPermissionRequest = null
                pendingWebResources = emptyArray()
            }
            REQ_GEOLOCATION -> {
                val callback = pendingGeoCallback
                val origin = pendingGeoOrigin
                callback?.invoke(origin, hasLocationPermission(), false)
                pendingGeoCallback = null
                pendingGeoOrigin = null
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_PROTECTION -> {
                openingProtection = false
                if (store.configured) {
                    if (webView == null) renderWebApp()
                    else {
                        loadedMemberId = store.memberId
                        webView?.evaluateJavascript(
                            "try{sessionStorage.removeItem('$NATIVE_MARKER');location.reload()}catch(e){}",
                            null
                        )
                    }
                }
            }
            REQ_FILE_CHOOSER -> {
                val callback = filePathCallback ?: return
                val result = if (resultCode == RESULT_OK) {
                    val parsed = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                    parsed ?: captureUri?.let { arrayOf(it) }
                } else null
                callback.onReceiveValue(result)
                filePathCallback = null
                captureUri = null
            }
        }
    }

    override fun onBackPressed() {
        val web = webView
        if (web != null && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun openProtectionSettings() {
            runOnUiThread { openProtection() }
        }
    }

    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_SHORT).show()
}
