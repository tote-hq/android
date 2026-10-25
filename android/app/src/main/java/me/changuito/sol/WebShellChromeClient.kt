package me.changuito.sol

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Message
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class WebShellChromeClient(
    private val onProgressChanged: (Int) -> Unit,
    private val isDebug: Boolean,
    private val scopeHostProvider: () -> String = { "" },
) : WebChromeClient() {
    override fun onProgressChanged(
        view: WebView,
        newProgress: Int,
    ) {
        onProgressChanged.invoke(newProgress)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        // Console messages are page-controlled and may contain sensitive
        // data — never write them to logcat in release builds.
        if (!isDebug) {
            return true
        }
        val level =
            when (consoleMessage.messageLevel()) {
                ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                else -> Log.INFO
            }
        Log.println(
            level,
            TAG,
            "${consoleMessage.message()} — ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}",
        )
        return true
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        // Handle window.open() and target="_blank". Privy opens Google this
        // way. Login hosts load in the main WebView so the PKCE values written
        // to its localStorage are still there when Google redirects back.
        // Any other http(s) URL still opens in the system browser. The
        // temporary WebView exists only to capture the popup's target URL
        // and is destroyed once that URL has been handed off.
        val mainView = view
        val newWebView = WebView(view.context)
        // A popup can start as about:blank and get its real URL later, so
        // every http(s) navigation of the temporary WebView is routed here,
        // whether it arrives via shouldOverrideUrlLoading or onPageStarted.
        var handled = false
        fun route(popup: WebView, url: String?) {
            if (handled) return
            if (isDebug) Log.d(TAG, "onCreateWindow URL: ${redactUrlForLog(url)}")
            val uri = url?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() } ?: return
            val scheme = uri.scheme?.lowercase()
            // about:blank and other non-web schemes: wait for the real URL.
            if (scheme != "http" && scheme != "https") return
            handled = true
            if (isInAppNavigationHost(uri.host, scopeHostProvider.invoke())) {
                mainView.loadUrl(url)
            } else {
                try {
                    if (isDebug) Log.d(TAG, "launchExternal (popup): ${redactUrlForLog(url)}")
                    val intent = Intent(Intent.ACTION_VIEW, uri)
                    intent.addCategory(Intent.CATEGORY_BROWSABLE)
                    popup.context.startActivity(intent)
                } catch (_: ActivityNotFoundException) {
                    if (isDebug) Log.w(TAG, "No activity found to handle popup URL")
                }
            }
            popup.post {
                popup.stopLoading()
                popup.destroy()
            }
        }
        newWebView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    popup: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // Page-controlled URL: only browsable http(s) targets may
                    // load or launch, matching WebShellViewClient's policy.
                    route(popup, request.url.toString())
                    return true
                }

                override fun onPageStarted(
                    popup: WebView,
                    url: String?,
                    favicon: android.graphics.Bitmap?,
                ) {
                    route(popup, url)
                }
            }
        newWebView.webChromeClient =
            object : WebChromeClient() {
                override fun onCloseWindow(window: WebView) {
                    window.destroy()
                }
            }
        val transport = resultMsg.obj as WebView.WebViewTransport
        transport.webView = newWebView
        resultMsg.sendToTarget()
        return true
    }

    private companion object {
        const val TAG = "WebShell"
    }
}
