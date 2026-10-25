package me.changuito.sol

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.net.toUri

/**
 * Hosts that must stay inside this WebView.
 *
 * Privy writes `privy:oauth:state` and `privy:oauth:code_verifier` into the
 * shell's localStorage before sending the shopper to Google. Opening those
 * hosts in system Chrome drops that PKCE pair and leaves the app. Everything
 * else still goes out: a product link is not a login.
 *
 * [host] is matched case-insensitively against [scopeHost], `changuito.me`,
 * `privy.io`, the Google OAuth hosts, and their subdomains.
 */
internal fun isInAppNavigationHost(host: String?, scopeHost: String): Boolean {
    val normalized = host?.trim()?.lowercase().orEmpty()
    if (normalized.isEmpty()) return false

    val scope = scopeHost.trim().lowercase()
    if (scope.isNotEmpty() && normalized == scope) return true

    return IN_APP_HOST_ROOTS.any { root ->
        normalized == root || normalized.endsWith(".$root")
    }
}

private val IN_APP_HOST_ROOTS =
    listOf(
        "changuito.me",
        "privy.io",
        "google.com",
        "gstatic.com",
        "googleapis.com",
        // Google sometimes sends the account chooser here. Not all of YouTube.
        "accounts.youtube.com",
    )

/**
 * Log-safe form of [url]: scheme, host, path and query parameter names only.
 * Values (OAuth `code`, `state`, tokens) never reach logcat.
 */
internal fun redactUrlForLog(url: String?): String {
    if (url.isNullOrBlank()) return "<empty>"
    return try {
        val uri = java.net.URI(url.substringBefore('#'))
        val names =
            uri.rawQuery
                ?.split('&')
                ?.mapNotNull { it.substringBefore('=').takeIf { n -> n.isNotEmpty() } }
                .orEmpty()
        val base =
            if (uri.isOpaque) {
                "${uri.scheme}:<opaque>"
            } else {
                "${uri.scheme}://${uri.host.orEmpty()}${uri.rawPath.orEmpty()}"
            }
        if (names.isEmpty()) base else "$base?params=${names.joinToString(",")}"
    } catch (_: Exception) {
        "<unparseable>"
    }
}

/**
 * For a parsed `intent://` URL, returns the https URL that must open inside
 * the WebView when the intent targets a login host, or null otherwise.
 * Checks the `browser_fallback_url` extra first, then the intent data
 * (an `intent://host/path#Intent;scheme=https;end` URL carries it there).
 */
internal fun inAppUrlForIntent(
    dataUrl: String?,
    fallbackUrl: String?,
    scopeHost: String,
): String? {
    for (candidate in listOf(fallbackUrl, dataUrl)) {
        if (candidate.isNullOrBlank()) continue
        val uri = runCatching { java.net.URI(candidate) }.getOrNull() ?: continue
        val scheme = uri.scheme?.lowercase()
        if ((scheme == "http" || scheme == "https") && isInAppNavigationHost(uri.host, scopeHost)) {
            return candidate
        }
    }
    return null
}

open class WebShellViewClient(
    private val context: Context,
    private val scopeHostProvider: () -> String,
    private val isDebug: Boolean = false,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val url = request.url
        val scheme = url.scheme ?: return false

        // Never intercept subframe (iframe) navigation — this breaks
        // embedded SDKs like Privy that use cross-origin iframes.
        if (!request.isForMainFrame) return false

        return when (scheme) {
            "solana-wallet" -> {
                if (launchExternal(Intent(Intent.ACTION_VIEW, url))) {
                    // The wallet protocol library uses window.blur to detect that the
                    // wallet app opened.  In a WebView the blur event never fires
                    // naturally, so we dispatch a synthetic one to unblock the
                    // detection promise (3-second timeout in startSession.ts).
                    view.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null)
                }
                true
            }

            "intent" -> {
                handleIntentScheme(view, url.toString())
                true
            }

            "blob", "javascript" -> {
                false
            }

            "http", "https" -> {
                // false: the WebView loads the URL itself. true: we consumed it
                // by handing it to another app.
                if (isInAppNavigationHost(url.host, scopeHostProvider.invoke())) {
                    false
                } else {
                    launchExternal(Intent(Intent.ACTION_VIEW, url))
                    true
                }
            }

            else -> {
                launchExternal(Intent(Intent.ACTION_VIEW, url))
                true
            }
        }
    }

    private fun handleIntentScheme(view: WebView, url: String) {
        try {
            val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            if (isDebug) Log.d(TAG, "intent:// handled: ${redactUrlForLog(intent.dataString)}")
            // Google and Privy must never leave the WebView: the PKCE pair
            // lives in its localStorage. Load the https equivalent here.
            val inApp =
                inAppUrlForIntent(
                    dataUrl = intent.dataString,
                    fallbackUrl = intent.getStringExtra("browser_fallback_url"),
                    scopeHost = scopeHostProvider.invoke(),
                )
            if (inApp != null) {
                if (isDebug) Log.d(TAG, "intent:// kept in WebView: ${redactUrlForLog(inApp)}")
                view.loadUrl(inApp)
                return
            }
            // Sanitize the page-controlled intent: only implicit, browsable
            // targets may launch — never explicit components, selector
            // intents, or URI permission grants.
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.component = null
            intent.selector = null
            intent.removeFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
            if (!launchExternal(intent)) {
                val fallback = intent.getStringExtra("browser_fallback_url")?.toUri()
                if (fallback != null) {
                    // Only honor http/https fallback URLs — anything else
                    // (javascript:, intent:, file:) is an injection vector.
                    val fallbackScheme = fallback.scheme?.lowercase()
                    if (fallbackScheme == "http" || fallbackScheme == "https") {
                        launchExternal(Intent(Intent.ACTION_VIEW, fallback))
                    }
                }
            }
        } catch (_: Exception) {
            // Malformed intent URL — silently ignore
        }
    }

    private fun launchExternal(intent: Intent): Boolean {
        if (isDebug) Log.d(TAG, "launchExternal: ${redactUrlForLog(intent.dataString)}")
        if (context !is Activity) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "No activity found to handle URL with scheme: ${intent.data?.scheme}")
            false
        }
    }

    private companion object {
        const val TAG = "WebShell"
    }
}
