package com.ahmedmili.neoquiz.bridge

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackChannelTest {
    private fun answer(channel: BackChannel, value: Boolean) = runBlocking {
        channel.handlers().getValue("android.retourTraite")(JSONArray().put(value))
    }

    @Test fun thePageHandlingTheKeyIsReportedAsHandled() = runBlocking {
        lateinit var channel: BackChannel
        channel = BackChannel { answer(channel, true) }
        assertTrue(channel.request())
    }

    @Test fun thePageHavingNothingToGoBackToLetsTheAppLeave() = runBlocking {
        lateinit var channel: BackChannel
        channel = BackChannel { answer(channel, false) }
        assertFalse(channel.request())
    }

    @Test fun aSilentPageCountsAsNothingToGoBackTo() = runBlocking {
        assertFalse(BackChannel { }.request(timeoutMs = 50))
    }

    @Test fun aSecondPressWhileOneIsPendingIsSwallowed() = runBlocking {
        val channel = BackChannel { }
        val first = async { channel.request(timeoutMs = 300) }
        kotlinx.coroutines.delay(50)
        assertTrue(channel.request())
        assertFalse(first.await())
    }
}
