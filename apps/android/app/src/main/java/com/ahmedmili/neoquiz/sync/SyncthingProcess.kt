package com.ahmedmili.neoquiz.sync

import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.security.SecureRandom

/**
 * What the app may know about processes: our own Syncthing instances, found by
 * `/proc/<pid>/cmdline`. Android hides other apps' processes from an app
 * (`hidepid`), so a scan only ever sees this app's own uid, and a pid is only
 * touched when its command line is OUR binary launched with OUR `--home`.
 */
object ProcTable {
    const val BINARY_NAME = "libsyncthingnative.so"

    /** The NUL-separated command line of a live pid, `null` when there is none (or it is unreadable). */
    fun cmdline(procRoot: File, pid: Int): List<String>? = try {
        val raw = File(procRoot, "$pid/cmdline").readBytes().toString(Charsets.UTF_8)
        if (raw.isEmpty()) null else raw.trimEnd('\u0000').split('\u0000')
    } catch (_: IOException) {
        null
    }

    /** True when [pid] is a live instance of OUR binary launched with [home]. */
    fun isOurs(procRoot: File, pid: Int, home: String): Boolean {
        val args = cmdline(procRoot, pid) ?: return false
        return args.isNotEmpty() && File(args[0]).name == BINARY_NAME && "--home=$home" in args
    }

    /** Every live instance of our binary launched with [home]: the wrapper and its real child look the same. */
    fun findOurs(procRoot: File, home: String): List<Int> =
        procRoot.list().orEmpty().mapNotNull { it.toIntOrNull() }.filter { isOurs(procRoot, it, home) }.sorted()
}

/** A running instance: the child, its REST endpoint (kept in memory only) and how to stop it. */
class SyncthingInstance internal constructor(
    private val process: Process,
    val rest: SyncthingRest,
    private val home: File,
    private val procRoot: File,
    private val kill: (Int) -> Unit,
) {
    val isAlive: Boolean get() = process.isAlive

    /** Blocks until the process has exited. */
    fun waitFor() { process.waitFor() }

    /** REST shutdown, then a kill of every instance of ours with this home if it does not leave in [graceMs]. */
    fun stop(graceMs: Long = 5000) {
        try { rest.shutdown() } catch (_: Exception) { /* it may already be gone */ }
        val deadline = System.currentTimeMillis() + graceMs
        while (System.currentTimeMillis() < deadline && (process.isAlive || ProcTable.findOurs(procRoot, home.path).isNotEmpty())) Thread.sleep(100)
        if (process.isAlive) process.destroyForcibly()
        for (pid in ProcTable.findOurs(procRoot, home.path)) kill(pid)
        File(home, SyncthingProcess.PID_FILE).delete()
    }
}

/**
 * Launches the embedded Syncthing: `nativeLibraryDir/libsyncthingnative.so`
 * (the Syncthing 2.1.5 binary packaged as a native library, see `web/pins.mjs`)
 * with the arguments of [ShareRules.launchArgs] and `STNOUPGRADE=1`.
 *
 * The endpoint (a free loopback port and a random API key) lives in the
 * returned instance, in memory: not in a file, not in the page, not logged.
 * A pid file in the home lets the next start kill a survivor of a hard kill of
 * the app (it would keep the home locked and the listen port taken): only an
 * instance of our binary with our `--home` is ever killed.
 */
class SyncthingProcess(
    private val binary: File,
    private val home: File,
    private val tmpDir: File,
    private val procRoot: File = File("/proc"),
    private val kill: (Int) -> Unit = { android.os.Process.killProcess(it) },
) {
    /** Kills the survivors of a previous run and removes the pid file; waits until they are gone. Returns the killed pids. */
    fun releaseHome(): List<Int> {
        val targets = LinkedHashSet<Int>()
        val pidFile = File(home, PID_FILE)
        val written = try { pidFile.readText().trim().toIntOrNull() } catch (_: IOException) { null }
        if (written != null && written > 0 && ProcTable.isOurs(procRoot, written, home.path)) targets.add(written)
        targets.addAll(ProcTable.findOurs(procRoot, home.path))
        for (pid in targets) kill(pid)
        val deadline = System.currentTimeMillis() + 5000
        while (targets.isNotEmpty() && System.currentTimeMillis() < deadline && targets.any { ProcTable.isOurs(procRoot, it, home.path) }) Thread.sleep(100)
        pidFile.delete()
        return targets.toList()
    }

    /** Spawns the binary and waits for `/rest/system/ping`. Never leaves the process behind a failed start. */
    fun start(): SyncthingInstance {
        if (!binary.canExecute()) throw IOException("syncthing binary not executable: ${binary.path}")
        home.mkdirs()
        tmpDir.mkdirs()
        releaseHome()
        val port = freeLoopbackPort()
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val builder = ProcessBuilder(listOf(binary.path) + ShareRules.launchArgs(home.path, port, key))
        val env = builder.environment()
        val wanted = ShareRules.launchEnv(env.toMap())
        env.clear()
        env.putAll(wanted)
        // Go's os.TempDir falls back to /data/local/tmp, which an app cannot write.
        env["TMPDIR"] = tmpDir.path
        env["HOME"] = home.path
        builder.redirectErrorStream(true)
        // Syncthing logs to stdout: an undrained pipe would block it, and the log never carries the key.
        builder.redirectOutput(ProcessBuilder.Redirect.appendTo(File("/dev/null")))
        val process = builder.start()
        val instance = SyncthingInstance(process, SyncthingRest(port, key), home, procRoot, kill)
        try {
            val deadline = System.currentTimeMillis() + 30_000
            while (true) {
                if (!process.isAlive) throw IOException("syncthing exited during startup (code ${process.exitValue()})")
                try { instance.rest.ping(); break } catch (_: IOException) { /* not listening yet */ }
                if (System.currentTimeMillis() > deadline) throw IOException("syncthing did not answer in time")
                Thread.sleep(250)
            }
            ProcTable.findOurs(procRoot, home.path).firstOrNull()?.let { File(home, PID_FILE).writeText(it.toString()) }
            return instance
        } catch (e: Exception) {
            process.destroyForcibly()
            for (pid in ProcTable.findOurs(procRoot, home.path)) kill(pid)
            throw e
        }
    }

    /** Is the pinned listen port free (all interfaces)? */
    fun listenPortFree(): Boolean = try { ServerSocket(ShareRules.LISTEN_PORT).use { true } } catch (_: IOException) { false }

    private fun freeLoopbackPort(): Int = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }

    companion object {
        const val PID_FILE = "syncthing.pid"
    }
}
