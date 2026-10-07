package com.ahmedmili.neoquiz.code

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray
import org.json.JSONObject

/**
 * THE PYTHON PACKAGE PROXY, the Android twin of `apps/windows/electron/paquets-python.ts`
 * (read its header; the rules are copied one for one). The sandbox WebView has
 * `blockNetworkLoads`: packages reach it ONLY through this object, run in Kotlin,
 * outside the sandbox.
 *
 *  1. PYODIDE PACKAGES: the pack's `pyodide-lock.json` is the allow-list. A file it
 *     does not name is a 404 and NO request leaves the phone. A listed file is
 *     downloaded from the pinned CDN (<= 50 MB, every hop judged), its SHA-256
 *     compared with the lock's, written `<pack>/paquets/<file>.part` then renamed.
 *  2. PURE PyPI WHEELS (micropip): the index answer is rewritten so every file
 *     points at `file:///pypi/files/...` and only pure wheels stay; their
 *     `hashes.sha256` are recorded; a file is served only if its bytes match.
 *  3. A shared BUDGET (500 MB per run of the app) and an overall DEADLINE per
 *     download (10 min) bound what a looping quiz can cost.
 *
 * Pure or taking an injected [Fetch], so the JVM tests prove it on the real code.
 */
object PythonPackages {
    /** One GET: URL and an optional `Accept` header; throws IOException when a hop is refused or the transport fails. */
    fun interface Fetch {
        fun open(url: String, accept: String?): InputStream
    }

    /** A pure answer; `CodeSandbox` turns it into a `WebResourceResponse`. */
    class Reply(val status: Int, val mime: String, val body: ByteArray) {
        companion object {
            fun empty(status: Int) = Reply(status, "text/plain", ByteArray(0))
        }
    }

    const val MAX_FILE = 50L * 1024 * 1024
    const val MAX_BUDGET = 500L * 1024 * 1024
    private const val MAX_INDEX = 10L * 1024 * 1024
    const val DEADLINE_MS = LanguagePacks.DEADLINE_MS
    private const val FILES_HOST = "https://files.pythonhosted.org/"
    private const val ACCEPT_INDEX = "application/vnd.pypi.simple.v1+json"

    /** The Pyodide CDN of a pack version (`CDN_PYODIDE` of langages.ts). */
    fun cdnBase(version: String) = "https://cdn.jsdelivr.net/pyodide/v$version/full/"

    private val FILE_NAME = Regex("^[A-Za-z0-9_](?:[A-Za-z0-9._+-]*[A-Za-z0-9_])?$")
    private val PROJECT_NAME = Regex("^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$")
    private val PATH_SEGMENT = Regex("^[A-Za-z0-9_](?:[A-Za-z0-9._+~-]*[A-Za-z0-9_])?$")
    private val HEX64 = Regex("^[0-9a-fA-F]{64}$")

    /** Bytes this process may still download. */
    class Budget(total: Long = MAX_BUDGET) {
        private var left = total

        /** Spends [bytes]; false (and nothing spent) if they do not fit. */
        @Synchronized
        fun take(bytes: Long): Boolean {
            if (bytes < 0 || bytes > left) return false
            left -= bytes
            return true
        }
    }

    /** The budget of one run of the app. */
    val globalBudget = Budget()

    // ---- pure rules -------------------------------------------------------

    /** The lock's SHA-256 (lowercase) for this exact file name, or null. */
    fun lockEntry(lock: JSONObject?, file: String): String? {
        val packages = lock?.optJSONObject("packages") ?: return null
        for (key in packages.keys()) {
            val e = packages.optJSONObject(key) ?: continue
            val sha = e.opt("sha256") as? String
            if (e.opt("file_name") == file && sha != null && HEX64.matches(sha)) return sha.lowercase()
        }
        return null
    }

    fun cdnUrl(base: String, file: String): String = base + file

    /** `simple/<name>/` -> the PyPI index, `files/<path>` -> the file host; anything else (`..`, odd segments) null. */
    fun pypiUrl(path: String): String? {
        val segs = path.trimStart('/').split("/")
        if (segs[0] == "simple" && segs.size == 3 && segs[2].isEmpty() && PROJECT_NAME.matches(segs[1])) {
            return "https://pypi.org/simple/${segs[1]}/"
        }
        if (segs[0] == "files" && segs.size >= 2 && segs.drop(1).all { PATH_SEGMENT.matches(it) }) {
            return FILES_HOST + segs.drop(1).joinToString("/")
        }
        return null
    }

    /** Pure wheels only: `py3-none-any`, or a wheel built for Pyodide. A native `cp312-...-manylinux` wheel cannot run here. */
    fun wheelAllowed(name: String): Boolean {
        val n = name.lowercase()
        if (!n.endsWith(".whl")) return false
        if (Regex("-(?:py3|py2\\.py3)-none-any\\.whl$").containsMatchIn(n)) return true
        val platform = n.dropLast(4).split("-").last()
        return Regex("^(?:pyodide|pyemscripten|emscripten)_").containsMatchIn(platform)
    }

    private val HOSTS = setOf("cdn.jsdelivr.net", "pypi.org", "files.pythonhosted.org")

    /** EVERY hop of a package download, redirects included: exactly these three hosts over HTTPS (never the pack hosts). */
    fun hostAllowed(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        if (uri.scheme != "https" || uri.rawUserInfo != null || (uri.port != -1 && uri.port != 443)) return false
        return uri.host?.lowercase() in HOSTS
    }

    /** The production transport: HTTPS, redirects by hand, [hostAllowed] on every hop. */
    val network = Fetch { url, accept -> LanguagePacks.openHttps(url, ::hostAllowed, accept) }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun sameHash(bytes: ByteArray, expected: String) = MessageDigest.isEqual(sha256(bytes).toByteArray(), expected.toByteArray())

    // ---- state ------------------------------------------------------------

    private val locks = ConcurrentHashMap<String, Any>()
    private val lockCache = ConcurrentHashMap<String, Triple<Long, Long, JSONObject>>()

    /** The pack's lock, re-read when the file changes (a pack update or delete must not leave a stale allow-list). */
    private fun readLock(packDir: File): JSONObject? {
        val f = File(packDir, "pyodide-lock.json")
        if (!f.isFile) return null
        val modified = f.lastModified()
        val length = f.length()
        val cached = lockCache[f.path]
        if (cached != null && cached.first == modified && cached.second == length) return cached.third
        val lock = try {
            JSONObject(f.readText())
        } catch (_: Exception) {
            return null
        }
        lockCache[f.path] = Triple(modified, length, lock)
        return lock
    }

    private fun packPresent(packDir: File) = File(packDir, "manifest.json").isFile

    private fun readCache(packDir: File, name: String, sha: String): ByteArray? {
        val f = File(File(packDir, "paquets"), name)
        if (!f.isFile) return null
        try {
            val bytes = f.readBytes()
            if (sameHash(bytes, sha)) return bytes
        } catch (_: Exception) {
            // unreadable: fall through and drop it
        }
        f.delete()
        return null
    }

    /** Atomic (`.part` then rename); a failed write leaves nothing. */
    private fun writeCache(packDir: File, name: String, bytes: ByteArray) {
        val dir = File(packDir, "paquets")
        val target = File(dir, name)
        val part = File(dir, "$name.part")
        try {
            dir.mkdirs()
            part.writeBytes(bytes)
            if (!part.renameTo(target)) part.delete()
        } catch (_: Exception) {
            part.delete()
        }
    }

    private sealed class Read {
        class Bytes(val value: ByteArray) : Read()
        object TooBig : Read()
        object OverBudget : Read()
    }

    /** At most [limit] bytes, spent from [budget] as they arrive (a refused download did use the line), within [deadlineMs] overall. */
    private fun readBounded(input: InputStream, limit: Long, budget: Budget, deadlineMs: Long): Read {
        val deadline = System.nanoTime() + deadlineMs * 1_000_000L
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        input.use {
            while (true) {
                val n = it.read(buf)
                if (n < 0) break
                if (System.nanoTime() >= deadline) throw IOException("the download took longer than its deadline")
                total += n
                if (total > limit) return Read.TooBig
                if (!budget.take(n.toLong())) return Read.OverBudget
                out.write(buf, 0, n)
            }
        }
        return Read.Bytes(out.toByteArray())
    }

    /** A download that never throws: IOException and OutOfMemoryError alike give null (a 503), nothing written. */
    private fun download(fetch: Fetch, url: String, accept: String?, limit: Long, budget: Budget, deadlineMs: Long): Read? {
        return try {
            readBounded(fetch.open(url, accept), limit, budget, deadlineMs)
        } catch (_: Exception) {
            null
        } catch (_: OutOfMemoryError) {
            null
        }
    }

    // ---- 1. Pyodide packages ---------------------------------------------

    /** A file of the Python pack that the pack does not carry: cached, else downloaded from [cdnBase], hash-checked against the lock, cached, served. */
    fun servePackage(
        packDir: File,
        file: String,
        fetch: Fetch,
        cdnBase: String,
        budget: Budget = globalBudget,
        deadlineMs: Long = DEADLINE_MS,
    ): Reply {
        if (!FILE_NAME.matches(file)) return Reply.empty(404)
        val sha = lockEntry(readLock(packDir), file) ?: return Reply.empty(404)
        // One download per file at a time: a second caller waits, then finds it cached.
        synchronized(locks.getOrPut(File(File(packDir, "paquets"), file).path) { Any() }) {
            readCache(packDir, file, sha)?.let { return Reply(200, "application/octet-stream", it) }
            val read = download(fetch, cdnUrl(cdnBase, file), null, MAX_FILE, budget, deadlineMs) ?: return Reply.empty(503)
            val bytes = when (read) {
                is Read.OverBudget -> return Reply.empty(503)
                is Read.TooBig -> return Reply.empty(502)
                is Read.Bytes -> read.value
            }
            if (!sameHash(bytes, sha)) return Reply.empty(502)
            // The pack may have been deleted while this ran: never recreate `paquets/` behind it.
            if (!packPresent(packDir)) return Reply.empty(503)
            writeCache(packDir, file, bytes)
            return Reply(200, "application/octet-stream", bytes)
        }
    }

    // ---- 2. PyPI wheels ---------------------------------------------------

    /** The digests the index answers announced (URL on the file host -> SHA-256), and the memoised rewritten indexes. */
    class Session {
        internal val digests = ConcurrentHashMap<String, String>()
        internal val indexes = ConcurrentHashMap<String, Pair<String, Map<String, String>>>()
    }

    /** `pypi/<path>`: the index (rewritten) or a pure wheel whose bytes match the digest the index announced. */
    fun servePypi(
        path: String,
        session: Session,
        fetch: Fetch,
        packDir: File? = null,
        budget: Budget = globalBudget,
        deadlineMs: Long = DEADLINE_MS,
    ): Reply {
        val url = pypiUrl(path) ?: return Reply.empty(403)
        if (url.startsWith("https://pypi.org/simple/")) return serveIndex(url, session, fetch, budget, deadlineMs)
        val name = url.substringAfterLast('/')
        val expected = session.digests[url]
        if (!wheelAllowed(name) || expected == null) return Reply.empty(403)
        // Content-addressed cache: a repeated request costs no download.
        val cacheName = "pypi-$expected.whl"
        synchronized(locks.getOrPut("pypi:$expected") { Any() }) {
            if (packDir != null) readCache(packDir, cacheName, expected)?.let { return Reply(200, "application/zip", it) }
            val read = download(fetch, url, null, MAX_FILE, budget, deadlineMs) ?: return Reply.empty(503)
            val bytes = when (read) {
                is Read.OverBudget -> return Reply.empty(503)
                is Read.TooBig -> return Reply.empty(403)
                is Read.Bytes -> read.value
            }
            if (!sameHash(bytes, expected)) return Reply.empty(403)
            if (packDir != null) {
                if (!packPresent(packDir)) return Reply.empty(503)
                writeCache(packDir, cacheName, bytes)
            }
            return Reply(200, "application/zip", bytes)
        }
    }

    private fun serveIndex(url: String, session: Session, fetch: Fetch, budget: Budget, deadlineMs: Long): Reply {
        session.indexes[url]?.let { (body, digs) ->
            session.digests.putAll(digs)
            return Reply(200, ACCEPT_INDEX, body.toByteArray())
        }
        val read = download(fetch, url, ACCEPT_INDEX, MAX_INDEX, budget, deadlineMs) ?: return Reply.empty(503)
        val bytes = when (read) {
            is Read.OverBudget -> return Reply.empty(503)
            is Read.TooBig -> return Reply.empty(502)
            is Read.Bytes -> read.value
        }
        val json = try {
            JSONObject(String(bytes, Charsets.UTF_8))
        } catch (_: Exception) {
            return Reply.empty(502)
        }
        val files = json.optJSONArray("files") ?: return Reply.empty(502)
        // Keep only pure wheels with a SHA-256, point them back at the proxy, drop `core-metadata`:
        // micropip then downloads the whole wheel (judged here) instead of asking for a `.metadata` sibling.
        val kept = JSONArray()
        val digs = HashMap<String, String>()
        for (i in 0 until files.length()) {
            val f = files.optJSONObject(i) ?: continue
            val fu = f.opt("url") as? String ?: ""
            val sha = f.optJSONObject("hashes")?.opt("sha256") as? String
            if (!fu.startsWith(FILES_HOST) || sha == null || !HEX64.matches(sha)) continue
            val rel = fu.removePrefix(FILES_HOST)
            val canon = pypiUrl("files/$rel") ?: continue
            if (!wheelAllowed(rel.substringAfterLast('/'))) continue
            digs[canon] = sha.lowercase()
            f.remove("core-metadata")
            f.remove("data-dist-info-metadata")
            f.put("url", "file:///pypi/files/$rel")
            kept.put(f)
        }
        json.put("files", kept)
        val out = json.toString()
        session.digests.putAll(digs)
        session.indexes[url] = Pair(out, digs)
        return Reply(200, ACCEPT_INDEX, out.toByteArray())
    }
}
