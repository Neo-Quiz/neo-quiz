package com.ahmedmili.neoquiz.code

import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** A pinned language pack. `marker` is a file (relative to the pack directory) whose presence proves the pack is really in place. */
data class Pin(val version: String, val url: String, val sha256: String, val size: Long, val marker: String)

/**
 * The downloadable language packs (Python, C/C++): the Android twin of
 * `apps/windows/electron/langages.ts`, whose rules it copies one for one.
 * The APK embeds NO pack.
 *
 * THE PIN. `PINS` is written HERE, in the app's own code, never read from the
 * release (`npm run check:android-code-pack` ties it to the Windows pins): a
 * download whose bytes hash to anything else is refused before a single byte
 * is written under its final name.
 *
 * THE DOWNLOAD is read into memory, hashed as it arrives, cut at once when it
 * passes the pinned size; the very same bytes are then gunzipped (never a file
 * re-read after hashing). The entries (a "store" ZIP whose payloads are latin1
 * text wrapped in UTF-8, like `buildZip`/`parseZip` in the shared code) go
 * under `<name>.part/`, which becomes `<name>/` by ONE rename; a previous
 * install is renamed aside first and put back if the new one cannot land. On
 * every failure nothing is left behind.
 *
 * EVERY ENTRY NAME IS DISTRUSTED before it becomes a path ([entryNameAllowed],
 * the rule of `nomEntreeAdmis`), and the resolved path is re-checked to fall
 * under the pack directory.
 */
object LanguagePacks {
    val PINS: Map<String, Pin> = mapOf(
        "c" to Pin(
            version = "22.0.0-git20542-10",
            url = "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-22.0.0-git20542-10/language-c-22.0.0-git20542-10.zip.gz",
            sha256 = "aef5e5cc2f9fa27f6cc72d5a1294c2bc7cf3de291a49eb550010f894a3409a16",
            size = 28432790,
            marker = "clang/llvm.core.wasm",
        ),
        "python" to Pin(
            version = "314.0.7",
            url = "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-python-314.0.7/language-python-314.0.7.zip.gz",
            sha256 = "1df5db3471a7f17c4854434eda12a0ae26cd108370c9039b38e10397628fa7b7",
            size = 7019891,
            marker = "pyodide.asm.wasm",
        ),
    )

    /** The hosts a pack download (and every hop of its redirects) may reach: HTTPS only. */
    val ALLOWED_HOSTS = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")

    /** Two real hops (github.com, then release-assets...) plus one: a fourth request would be suspect. */
    const val MAX_HOPS = 3

    /** Everything a pack may unpack to; a bomb is refused, not written. */
    const val MAX_UNPACKED = 1L shl 30

    private const val INACTIVITY_MS = 30_000

    /** The WHOLE download may not take longer than this: inactivity timeouts alone let a host drip bytes and hold the pack lock forever. */
    const val DEADLINE_MS = 10 * 60 * 1000L

    /** The refusal of a pack (hash, size, unsafe or unreadable archive). */
    class Refused(message: String) : Exception(message)

    /** The pack's pack name for a sandbox language: C and C++ share one pack. */
    fun packFor(language: String): String? = when (language) {
        "python" -> "python"
        "c", "cpp" -> "c"
        else -> null
    }

    // ---- state ------------------------------------------------------------

    /** The installed version, read from `<dir>/<name>/manifest.json` alone, or null on ANY failure. Never throws. */
    fun installedVersion(dir: File, name: String): String? {
        if (name !in PINS) return null
        return try {
            org.json.JSONObject(File(File(dir, name), "manifest.json").readText()).opt("version") as? String
        } catch (_: Exception) {
            null
        }
    }

    /** `{installe, version, octets}`, the shape `langages.etat` answers on Windows. */
    fun state(dir: File, name: String): Map<String, Any?> {
        val version = installedVersion(dir, name) ?: return mapOf("installe" to false, "version" to null, "octets" to 0L)
        return mapOf("installe" to true, "version" to version, "octets" to sizeOf(File(dir, name)))
    }

    /** Installed at the pinned version with its marker file still there (an antivirus-less phone can still lose a file): nothing to download. */
    fun inPlace(dir: File, name: String): Boolean {
        val pin = PINS[name] ?: return false
        return installedVersion(dir, name) == pin.version && File(File(dir, name), pin.marker).isFile
    }

    private fun sizeOf(f: File): Long = if (f.isDirectory) (f.listFiles() ?: emptyArray()).sumOf { sizeOf(it) } else f.length()

    // ---- entry names ------------------------------------------------------

    /** The rule of `nomEntreeAdmis`: the name when safe, else null. */
    fun entryNameAllowed(name: String): String? {
        if (name.isEmpty() || name.contains('\u0000') || name.contains('\\')) return null
        if (name.startsWith("/")) return null
        if (Regex("^[a-zA-Z]:").containsMatchIn(name)) return null
        if (name.split("/").any { it.isEmpty() || it == "." || it == ".." }) return null
        return name
    }

    // ---- install ----------------------------------------------------------

    /**
     * Downloads `PINS[name]` through [fetch] (given the pin's URL), verifies its
     * SHA-256, installs it atomically under `<dir>/<name>`. Answers `"ok"`,
     * `"reseau"` (unreachable, a hop outside the list, an unexpected failure)
     * or `"empreinte"` (hash mismatch, truncated or longer body, an unsafe or
     * unreadable archive). [pin] is the test's seam; the app never passes it.
     */
    suspend fun install(
        dir: File,
        name: String,
        fetch: (String) -> InputStream,
        progress: (Long, Long) -> Unit,
        pin: Pin? = PINS[name],
        deadlineMs: Long = DEADLINE_MS,
    ): String = withContext(Dispatchers.IO) {
        if (pin == null || name !in PINS) return@withContext "reseau"
        val target = File(dir, name)
        val part = File(dir, "$name.part")
        val old = File(dir, "$name.old")
        try {
            dir.mkdirs()
            // A `.part` or `.old` left by an aborted install is never reused.
            part.deleteRecursively()
            old.deleteRecursively()
            val body = readBody(fetch, pin, progress, deadlineMs)
            ensureActive()
            if (!MessageDigest.isEqual(sha256(body).toByteArray(), pin.sha256.toByteArray())) {
                throw Refused("SHA-256 of the downloaded pack does not match its pin")
            }
            unpack(body, part)
            ensureActive()
            if (target.exists() && !target.renameTo(old)) throw IOException("previous pack could not be moved aside")
            if (!part.renameTo(target)) {
                if (old.exists() && !target.exists()) old.renameTo(target)
                throw IOException("pack could not take its place")
            }
            "ok"
        } catch (e: Refused) {
            "empreinte"
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            "reseau"
        } catch (e: OutOfMemoryError) {
            // An Error, not an Exception: a clean answer for the bridge, and the `finally` below leaves nothing on disk.
            "reseau"
        } finally {
            // Success or failure: a `.part` never survives; nor the previous install once the new one is in place.
            part.deleteRecursively()
            old.deleteRecursively()
        }
    }

    /** The body, hashed in memory as it arrives, cut as soon as it passes the pinned size. */
    private fun readBody(fetch: (String) -> InputStream, pin: Pin, progress: (Long, Long) -> Unit, deadlineMs: Long): ByteArray {
        val deadline = System.nanoTime() + deadlineMs * 1_000_000L
        val out = ByteArrayOutputStream(pin.size.coerceAtMost(64L * 1024 * 1024).toInt())
        fetch(pin.url).use { input ->
            val buf = ByteArray(64 * 1024)
            var received = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (System.nanoTime() >= deadline) throw IOException("the download took longer than its deadline")
                received += n
                if (received > pin.size) throw Refused("the language pack is larger than its pin")
                out.write(buf, 0, n)
                progress(received, pin.size)
            }
        }
        return out.toByteArray()
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** Gunzips and writes the ZIP entries under [dest]; any unsafe or unreadable archive is [Refused]. */
    private fun unpack(gz: ByteArray, dest: File) {
        val destCanonical = dest.apply { mkdirs() }.canonicalFile
        val zip = try {
            ReadGuard(GZIPInputStream(ByteArrayInputStream(gz)))
        } catch (_: IOException) {
            throw Refused("the downloaded pack's archive could not be read")
        }
        var unpacked = 0L
        zip.use { input ->
            val header = ByteArray(30)
            while (readFully(input, header) == 30 && le32(header, 0) == 0x04034b50L) {
                val method = le16(header, 8)
                val size = le32(header, 18)
                val nameLen = le16(header, 26)
                val extraLen = le16(header, 28)
                val nameBytes = ByteArray(nameLen)
                if (readFully(input, nameBytes) != nameLen) throw Refused("truncated archive")
                if (skip(input, extraLen.toLong()) != extraLen.toLong()) throw Refused("truncated archive")
                val name = String(nameBytes, Charsets.UTF_8)
                unpacked += size
                if (unpacked > MAX_UNPACKED) throw Refused("the archive unpacks to more than the limit")
                if (method != 0 || name.endsWith("/")) {
                    // Like `parseZip`: only "store" files are read; the rest is skipped.
                    if (skip(input, size) != size) throw Refused("truncated archive")
                    continue
                }
                val safe = entryNameAllowed(name) ?: throw Refused("unsafe entry name in the language pack: " + name)
                val file = File(dest, safe.replace('/', File.separatorChar))
                val canonical = file.canonicalFile
                if (!canonical.path.startsWith(destCanonical.path + File.separator)) throw Refused("entry escapes the pack directory: " + name)
                canonical.parentFile?.mkdirs()
                writeLatin1(input, size, canonical)
            }
        }
    }

    /** The payload (UTF-8 wrapping latin1 text) back to its bytes: one byte per decoded character, like `Buffer.from(text, "latin1")`. */
    private fun writeLatin1(input: InputStream, size: Long, file: File) {
        val bounded = BoundedStream(input, size)
        val reader = InputStreamReader(bounded, Charsets.UTF_8)
        val chars = CharArray(32 * 1024)
        val bytes = ByteArray(chars.size)
        BufferedOutputStream(FileOutputStream(file)).use { out ->
            while (true) {
                val n = reader.read(chars)
                if (n < 0) break
                for (i in 0 until n) bytes[i] = chars[i].code.toByte()
                out.write(bytes, 0, n)
            }
        }
        if (bounded.remaining != 0L) throw Refused("truncated archive")
    }

    /** A failing READ of the archive (corrupt gzip) is a refused pack, not a network error. */
    private class ReadGuard(input: InputStream) : java.io.FilterInputStream(input) {
        override fun read(): Int = try { super.read() } catch (e: IOException) { throw Refused("the downloaded pack's archive could not be read") }
        override fun read(b: ByteArray, off: Int, len: Int): Int = try { super.read(b, off, len) } catch (e: IOException) { throw Refused("the downloaded pack's archive could not be read") }
    }

    /** At most [limit] bytes of [input]. */
    private class BoundedStream(private val input: InputStream, var remaining: Long) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0) return -1
            val b = input.read()
            if (b >= 0) remaining--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            val n = input.read(b, off, minOf(len.toLong(), remaining).toInt())
            if (n > 0) remaining -= n
            return n
        }
    }

    private fun readFully(input: InputStream, into: ByteArray): Int {
        var total = 0
        while (total < into.size) {
            val n = input.read(into, total, into.size - total)
            if (n < 0) break
            total += n
        }
        return total
    }

    private fun skip(input: InputStream, count: Long): Long {
        val buf = ByteArray(32 * 1024)
        var left = count
        while (left > 0) {
            val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) break
            left -= n
        }
        return count - left
    }

    private fun le16(b: ByteArray, o: Int): Int = (b[o].toInt() and 0xff) or ((b[o + 1].toInt() and 0xff) shl 8)
    private fun le32(b: ByteArray, o: Int): Long = le16(b, o).toLong() or (le16(b, o + 2).toLong() shl 16)

    // ---- delete -----------------------------------------------------------

    /** Deletes ONE installed pack (`manifest.json` first, so a delete that fails halfway reads as not installed). */
    fun delete(dir: File, name: String) {
        if (name !in PINS) return
        File(File(dir, name), "manifest.json").delete()
        File(dir, name).deleteRecursively()
    }

    // ---- the network ------------------------------------------------------

    /** Whether a URL may be requested: HTTPS only, a listed host, no user info, no port other than 443. */
    fun urlAllowed(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        if (uri.scheme != "https") return false
        if (uri.rawUserInfo != null || (uri.port != -1 && uri.port != 443)) return false
        return uri.host?.lowercase() in ALLOWED_HOSTS
    }

    /** One response, reduced to what the redirect loop reads. */
    class Hop(val status: Int, val location: String?, val body: InputStream?)

    /**
     * Follows redirects BY HAND: every URL, the first included, is re-judged
     * ([urlAllowed]) BEFORE it is requested; at most [MAX_HOPS] requests.
     * [open] makes one request without following redirects.
     */
    fun follow(url: String, allowed: (String) -> Boolean = ::urlAllowed, open: (String) -> Hop): InputStream {
        var current = url
        repeat(MAX_HOPS) {
            if (!allowed(current)) throw IOException("host or scheme outside the list: $current")
            val hop = open(current)
            if (hop.status in 200..299) return hop.body ?: throw IOException("empty response")
            if (hop.status < 300 || hop.status >= 400) {
                hop.body?.close()
                throw IOException("HTTP ${hop.status}")
            }
            hop.body?.close()
            val location = hop.location ?: throw IOException("redirect without a destination")
            current = URI(current).resolve(location).toString()
        }
        throw IOException("too many redirects")
    }

    /** The production fetch: `HttpsURLConnection`, redirects never followed by the platform. */
    fun openHttps(url: String): InputStream = openHttps(url, ::urlAllowed, null)

    /** Same, with the judge of EVERY hop and an optional `Accept` header (the package proxy's). `identity`: the bytes hashed are the bytes published, never a transparently gunzipped copy. */
    fun openHttps(url: String, allowed: (String) -> Boolean, accept: String?): InputStream = follow(url, allowed) { u ->
        val c = URL(u).openConnection() as? HttpsURLConnection ?: throw IOException("not an HTTPS connection")
        c.instanceFollowRedirects = false
        c.connectTimeout = INACTIVITY_MS
        c.readTimeout = INACTIVITY_MS
        c.requestMethod = "GET"
        c.setRequestProperty("Accept-Encoding", "identity")
        if (accept != null) c.setRequestProperty("Accept", accept)
        val status = c.responseCode
        val body: InputStream? = if (status in 200..299) {
            object : java.io.FilterInputStream(c.inputStream) {
                override fun close() {
                    try {
                        super.close()
                    } finally {
                        c.disconnect()
                    }
                }
            }
        } else {
            c.disconnect()
            null
        }
        Hop(status, c.getHeaderField("Location"), body)
    }
}
