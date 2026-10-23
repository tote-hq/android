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
        newWebView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    popup: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // The popup URL is page-controlled: only browsable http(s)
                    // targets may load or launch, matching the main frame's
                    // policy in WebShellViewClient.
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme == "http" || scheme == "https") {
                        if (isInAppNavigationHost(request.url.host, scopeHostProvider.invoke())) {
                            mainView.loadUrl(request.url.toString())
                        } else {
                            try {
                                val intent = Intent(Intent.ACTION_VIEW, request.url)
                                intent.addCategory(Intent.CATEGORY_BROWSABLE)
                                popup.context.startActivity(intent)
                            } catch (_: ActivityNotFoundException) {
                                if (isDebug) {
                                    Log.w(TAG, "No activity found to handle popup URL: ${request.url}")
                                }
                            }
                        }
                    }
                    popup.post { popup.destroy() }
                    return true
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
