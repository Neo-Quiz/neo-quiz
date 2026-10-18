package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A process that exits when [exit] is called. */
private class Fake(val n: Int) { val gone = CountDownLatch(1); fun exit() = gone.countDown() }

class RestartPolicyTest {
    @Test fun delaysGrowThenStayAtTheLastOne() {
        val p = RestartPolicy()
        assertEquals(listOf(2_000L, 5_000L, 15_000L, 60_000L, 300_000L, 300_000L, 300_000L), (1..7).map { p.nextDelayMs(0) })
    }

    @Test fun aHealthyRunStartsOver() {
        val p = RestartPolicy()
        repeat(4) { p.nextDelayMs(1_000) }
        assertEquals(2_000L, p.nextDelayMs(3 * 60_000L))
        assertEquals(5_000L, p.nextDelayMs(1_000))
    }

    @Test fun aShortRunDoesNotReset() {
        val p = RestartPolicy()
        p.nextDelayMs(0); p.nextDelayMs(119_000)
        assertEquals(15_000L, p.nextDelayMs(0))
    }
}

class SupervisorTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val fast = RestartPolicy(listOf(20L, 20L, 40L), healthyMs = 10_000)
    private val launched = AtomicInteger()
    private val up = CopyOnWriteArrayList<Fake>()
    private val downs = AtomicInteger()
    private val events = CopyOnWriteArrayList<String>()
    private var failNext = 0

    @After fun end() = scope.cancel()

    private fun supervisor(policy: RestartPolicy = fast) = Supervisor<Fake>(
        scope, policy,
        launch = { if (failNext > 0) { failNext--; throw java.io.IOException("boom") }; Fake(launched.incrementAndGet()) },
        awaitExit = { it.gone.await() },
        onUp = { up.add(it) },
        onDown = { downs.incrementAndGet() },
        onEvent = { events.add(it) },
    )

    private fun waitUntil(what: String, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + 5_000
        while (!cond() && System.currentTimeMillis() < end) Thread.sleep(10)
        assertTrue("timeout: $what", cond())
    }

    @Test fun exitRelaunchesAndKeepsWatching() {
        val s = supervisor(); val first = Fake(0)
        s.adopt(first)
        first.exit()
        waitUntil("first relaunch") { up.size == 1 }
        assertFalse(s.restarting)
        up[0].exit()
        waitUntil("second relaunch") { up.size == 2 }
        up[1].exit()
        waitUntil("third relaunch (never dead)") { up.size == 3 }
    }

    @Test fun neverGivesUpOnFailedRelaunches() {
        val s = supervisor(); val first = Fake(0)
        failNext = 6
        s.adopt(first); first.exit()
        waitUntil("recovered after 6 failures") { up.size == 1 }
        assertEquals(6, events.count { it.startsWith("relaunch failed") })
        assertFalse(s.restarting)
    }

    @Test fun restartingIsTrueWhileRecovering() {
        val s = supervisor(RestartPolicy(listOf(300L), 10_000)); val first = Fake(0)
        s.adopt(first); first.exit()
        waitUntil("down seen") { s.restarting }
        waitUntil("up again") { up.size == 1 }
        assertFalse(s.restarting)
    }

    @Test fun kickCutsTheWaitShort() {
        val s = supervisor(RestartPolicy(listOf(60_000L), 10_000)); val first = Fake(0)
        s.adopt(first); first.exit()
        waitUntil("down") { s.restarting }
        s.kick()
        waitUntil("relaunched at once") { up.size == 1 }
    }

    @Test fun kickOnAHealthyProcessDoesNothing() {
        val s = supervisor(RestartPolicy(listOf(60_000L), 10_000)); val first = Fake(0)
        s.adopt(first); s.kick()
        first.exit()
        waitUntil("down") { s.restarting }
        Thread.sleep(150)
        assertEquals("the stale kick must not skip the delay", 0, up.size)
        s.stop()
    }

    @Test fun stopEndsTheRestarts() {
        val s = supervisor(RestartPolicy(listOf(300L), 10_000)); val first = Fake(0)
        s.adopt(first); first.exit()
        waitUntil("down") { s.restarting }
        s.stop()
        Thread.sleep(500)
        assertEquals(0, up.size)
        assertEquals(0, launched.get())
    }

    @Test fun stoppedBeforeTheExitDoesNotRelaunch() {
        val s = supervisor(); val first = Fake(0)
        s.adopt(first); s.stop(); first.exit()
        Thread.sleep(300)
        assertEquals(0, launched.get())
        assertEquals(0, downs.get())
    }
}

class RollingLogTest {
    private val dir: File = Files.createTempDirectory("rlog").toFile()

    @Test fun staysBoundedAndKeepsTheNewest() {
        val log = RollingLog(dir, maxBytes = 1_000)
        repeat(200) { log.append("line $it") }
        assertTrue(File(dir, "syncthing.log").length() <= 1_000)
        assertTrue(File(dir, "syncthing.log.1").length() <= 1_000)
        val t = log.tail(1000)
        assertEquals("line 199", t.first().second)
        assertTrue(t.size < 200)
    }

    @Test fun scrubsKeysAndDeviceIds() {
        val log = RollingLog(dir)
        log.append("key=" + "ab".repeat(32) + " dev=ABCDEFG-HIJKLMN-OPQRSTU-VWXYZ23-4567ABC-DEFGHIJ-KLMNOPQ-RSTUVWX\tx")
        val m = log.tail(1).single().second
        assertFalse(m.contains("abab"))
        assertFalse(m, m.contains("HIJKLMN"))
        assertTrue(m.contains("ABCDEFG-…"))
    }
}
