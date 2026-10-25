package me.changuito.sol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InAppOAuthNavigationTest {
    private val scope = "sol.changuito.me"

    @Test
    fun keepsShopPrivyAndGoogleHostsInsideTheWebView() {
        listOf(
            "sol.changuito.me",
            "SOL.Changuito.me",
            "changuito.me",
            "www.changuito.me",
            "auth.privy.io",
            "privy.io",
            "foo.privy.io",
            "accounts.google.com",
            "accounts.youtube.com",
            "myaccount.google.com",
            "ogs.google.com",
            "google.com",
            "www.google.com",
            "www.gstatic.com",
            "fonts.gstatic.com",
            "oauth2.googleapis.com",
            "www.googleapis.com",
        ).forEach { host ->
            assertTrue(host, isInAppNavigationHost(host, scope))
        }
        assertTrue(isInAppNavigationHost("preview.example.test", "preview.example.test"))
    }

    @Test
    fun sendsUnrelatedHostsToTheSystemBrowser() {
        listOf(
            null,
            "",
            "   ",
            "evil.com",
            "notchanguito.me",
            "changuito.me.evil.com",
            "notgoogle.com",
            "google.com.evil.com",
            "www.youtube.com",
            "youtube.com",
            "accounts.youtube.com.evil.com",
            "privy.io.evil.com",
        ).forEach { host ->
            assertFalse(host, isInAppNavigationHost(host, scope))
        }
    }

    @Test
    fun stripsWebViewMarkersBeforeAppendingTheSeekerToken() {
        val raw =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.002; wv) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36"
        val ua = appendUserAgentMarker(raw)

        assertFalse(ua.contains("; wv"))
        assertFalse(ua.contains("Version/"))
        assertTrue(ua.contains("Chrome/120.0.6099.230"))
        assertTrue(ua.contains("(Linux; Android 14; Pixel 8 Build/UQ1A.240205.002)"))
        assertTrue(ua.endsWith("Solana Mobile Web Shell"))
        assertEquals(ua, appendUserAgentMarker(ua))
    }

    @Test
    fun stripsAWvTokenThatIsNotImmediatelyBeforeTheParen() {
        val ua = appendUserAgentMarker("Mozilla/5.0 (Linux; wv; Android 14) Version/4.0 Chrome/120.0.0.0 Mobile")

        assertFalse(ua.contains("wv"))
        assertFalse(ua.contains("Version/"))
        assertTrue(ua.contains("Chrome/120.0.0.0"))
        assertTrue(ua.endsWith("Solana Mobile Web Shell"))
    }

    @Test
    fun doesNotDuplicateTheSeekerTokenWhenStrippingAnAlreadyMarkedAgent() {
        val raw =
            "Mozilla/5.0 (Linux; Android 14; wv) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Solana Mobile Web Shell"
        val ua = appendUserAgentMarker(raw)

        assertFalse(ua.contains("wv"))
        assertFalse(ua.contains("Version/"))
        assertEquals(1, Regex("""Solana Mobile Web Shell""").findAll(ua).count())
    }

    @Test
    fun intentFallbackToGoogleStaysInWebView() {
        val url = "https://accounts.google.com/signin/oauth?client_id=x&state=y"
        assertEquals(url, inAppUrlForIntent(null, url, "sol.changuito.me"))
    }

    @Test
    fun intentDataToPrivyStaysInWebView() {
        val url = "https://auth.privy.io/api/v1/oauth/callback?code=c"
        assertEquals(url, inAppUrlForIntent(url, null, "sol.changuito.me"))
    }

    @Test
    fun intentToOtherHostIsNotKept() {
        assertEquals(null, inAppUrlForIntent("https://play.google.com.evil.com/x", "market://details?id=x", "sol.changuito.me"))
        assertEquals(null, inAppUrlForIntent("javascript:alert(1)", null, "sol.changuito.me"))
    }

    @Test
    fun redactedLogKeepsOnlyParamNames() {
        val out = redactUrlForLog("https://accounts.google.com/o/oauth2/v2/auth?code=SECRET&state=ABC#frag")
        assertEquals("https://accounts.google.com/o/oauth2/v2/auth?params=code,state", out)
        assertEquals("<empty>", redactUrlForLog(null))
    }
}

