package com.ahmedmili.neoquiz.sync

import java.io.File
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * How long to wait before relaunching a process that exited, and when a run counts as healthy.
 * Pure. The delay grows with consecutive failures (2 s, 5 s, 15 s, 60 s, then every 5 min) and
 * starts over once a run stayed up for [healthyMs]; there is no "give up" step, ever.
 */
class RestartPolicy(
    private val delaysMs: List<Long> = DEFAULT_DELAYS_MS,
    private val healthyMs: Long = 2 * 60_000L,
) {
    private var failures = 0

    /** [ranMs]: how long the run that just ended stayed up (0 when a relaunch itself failed). */
    fun nextDelayMs(ranMs: Long): Long {
        if (ranMs >= healthyMs) failures = 0
        val d = delaysMs[minOf(failures, delaysMs.size - 1)]
        failures++
        return d
    }

    companion object {
        val DEFAULT_DELAYS_MS = listOf(2_000L, 5_000L, 15_000L, 60_000L, 300_000L)
    }
}

/**
 * Keeps one process of type [T] running until [stop]: when it exits, [launch] runs again after the
 * [RestartPolicy] delay, as often as needed. A failed launch is retried the same way. [kick] cuts
 * the current wait short (network came back, the app came to the screen) and starts a recovery
 * when the process is already gone. While recovering, [restarting] is true.
 */
class Supervisor<T : Any>(
    private val scope: CoroutineScope,
    private val policy: RestartPolicy,
    private val launch: suspend () -> T,
    /** Blocks until the process has exited. */
    private val awaitExit: (T) -> Unit,
    /** A new process is up (after a recovery). */
    private val onUp: (T) -> Unit,
    /** The process exited: recovery starts (and again after every failed relaunch). */
    private val onDown: () -> Unit,
    private val onEvent: (String) -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
) {
    @Volatile var restarting = false
        private set
    @Volatile private var stopped = false
    private val kicks = Channel<Unit>(Channel.CONFLATED)

    /** Starts watching a process that is already up. */
    fun adopt(t: T) {
        val startedAt = now()
        Thread {
            awaitExit(t)
            if (stopped) return@Thread
            scope.launch(Dispatchers.IO) { recover(now() - startedAt) }
        }.apply { isDaemon = true; start() }
    }

    /** Only meaningful while recovering: a healthy process has nothing to hurry. */
    fun kick() { if (restarting) kicks.trySend(Unit) }

    fun stop() { stopped = true; kicks.trySend(Unit) }

    private suspend fun recover(firstRanMs: Long) {
        restarting = true
        kicks.tryReceive()
        onEvent("process exited after ${firstRanMs / 1000} s")
        onDown()
        var ranMs = firstRanMs
        while (!stopped) {
            val wait = policy.nextDelayMs(ranMs)
            ranMs = 0
            onEvent("relaunch in ${wait / 1000} s")
            withTimeoutOrNull(wait) { kicks.receive() }
            if (stopped) return
            try {
                val next = withContext(Dispatchers.IO) { launch() }
                if (stopped) { onEvent("stopped during relaunch"); return }
                restarting = false
                onEvent("relaunched")
                onUp(next)
                adopt(next)
                return
            } catch (e: Exception) {
                onEvent("relaunch failed: ${e.javaClass.simpleName}")
                onDown()
            }
        }
    }
}

/** Removes what must never be kept in the diagnostic log: API keys and full device ids. */
object LogScrub {
    private val KEY = Regex("[0-9a-fA-F]{32,}")
    private val DEVICE_ID = Regex("\\b([A-Z2-7]{7})(?:-[A-Z2-7]{7}){7}\\b")

    fun clean(line: String): String =
        line.replace(DEVICE_ID) { it.groupValues[1] + "-…" }.replace(KEY, "<key>").replace(Regex("[\r\n\t]+"), " ").take(2000)
}

/**
 * The bounded diagnostic log of the embedded Syncthing: two files of at most [maxBytes] in the app's
 * private directory (never a shared location). One line is `<epoch ms> TAB <text>`; the text is
 * scrubbed ([LogScrub]). Survives the process: it is what is left after a stall.
 */
class RollingLog(private val dir: File, private val maxBytes: Long = 512 * 1024, private val clock: () -> Long = System::currentTimeMillis) {
    private val lock = Any()
    private val cur = File(dir, "syncthing.log")
    private val old = File(dir, "syncthing.log.1")

    fun append(line: String) = synchronized(lock) {
        try {
            dir.mkdirs()
            val text = "${clock()}\t${LogScrub.clean(line)}\n"
            if (cur.length() + text.toByteArray().size > maxBytes) { old.delete(); cur.renameTo(old) }
            cur.appendText(text)
        } catch (_: IOException) { /* diagnostics must never break sync */ }
    }

    /** Newest first, at most [n] lines, as (epoch ms, text). */
    fun tail(n: Int): List<Pair<Long, String>> = synchronized(lock) {
        try {
            (old.takeIf { it.exists() }?.readLines().orEmpty() + cur.takeIf { it.exists() }?.readLines().orEmpty())
                .mapNotNull { l -> val i = l.indexOf('\t'); if (i <= 0) null else (l.substring(0, i).toLongOrNull() ?: return@mapNotNull null) to l.substring(i + 1) }
                .takeLast(n).asReversed()
        } catch (_: IOException) { emptyList() }
    }
}
