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
}
