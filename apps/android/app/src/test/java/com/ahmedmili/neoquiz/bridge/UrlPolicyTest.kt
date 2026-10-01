package com.ahmedmili.neoquiz.bridge

import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    @Test fun onlyTheAppAssetsLoadInsideTheWebView() {
        assertEquals(UrlDecision.ALLOW, UrlPolicy.decide("https://appassets.androidplatform.net/assets/web/index.html"))
        assertEquals(UrlDecision.ALLOW, UrlPolicy.decide("https://appassets.androidplatform.net/assets/web/x.css?v=1"))
    }

    @Test fun webLinksGoToTheBrowser() {
        assertEquals(UrlDecision.EXTERNAL, UrlPolicy.decide("https://example.com/page"))
        assertEquals(UrlDecision.EXTERNAL, UrlPolicy.decide("http://example.com/"))
        // Same host, other path: not the app's assets.
        assertEquals(UrlDecision.EXTERNAL, UrlPolicy.decide("https://appassets.androidplatform.net/other"))
        // Look-alike host.
        assertEquals(UrlDecision.EXTERNAL, UrlPolicy.decide("https://appassets.androidplatform.net.evil.com/assets/x"))
    }

    @Test fun everythingElseIsBlocked() {
        for (u in listOf("file:///sdcard/x.html", "content://media/x", "intent://x#Intent;end", "javascript:alert(1)", "data:text/html,x", "about:blank", "ftp://x/y", "", "https:///assets/", "not a url")) {
            assertEquals(u, UrlDecision.BLOCK, UrlPolicy.decide(u))
        }
    }

    @Test fun userinfoCannotSpoofTheHost() {
        assertEquals(UrlDecision.EXTERNAL, UrlPolicy.decide("https://appassets.androidplatform.net@evil.com/assets/x"))
    }

    @Test fun aSubresourceMayOnlyComeFromTheAppOrBeInline() {
        for (u in listOf("https://appassets.androidplatform.net/assets/web/index.html", "https://appassets.androidplatform.net/assets/web/a.js?x=1", "data:image/png;base64,AAAA", "blob:https://appassets.androidplatform.net/1b2c-3d")) {
            assertEquals(u, true, UrlPolicy.mayLoad(u))
        }
        for (u in listOf(
            "http://127.0.0.1:37113/rest/system/ping", "http://localhost:22100/", "https://example.com/x.png", "http://appassets.androidplatform.net/assets/x",
            "https://appassets.androidplatform.net:8443/assets/x", "https://appassets.androidplatform.net.evil.com/assets/x", "https://appassets.androidplatform.net@evil.com/assets/x",
            "blob:https://evil.com/1", "ws://127.0.0.1:1/", "file:///sdcard/x", "ftp://x/y", "", "not a url",
        )) {
            assertEquals(u, false, UrlPolicy.mayLoad(u))
        }
    }
}
