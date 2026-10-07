package com.ahmedmili.neoquiz.update

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * The two downloads of the updater, with the hardening of `LanguagePacks`:
 * the caller passes `open` (production: `LanguagePacks.openHttps` with the
 * judge of [UpdateRules], i.e. HTTPS, redirects followed by hand and
 * re-judged hop by hop, `Accept-Encoding: identity`).
 */
object UpdateDownload {
    /** The whole APK download may not take longer than this (inactivity timeouts alone let a host drip bytes). */
    const val DEADLINE_MS = 20 * 60 * 1000L

    /** The manifest text, cut as soon as it passes 64 KB. */
    fun readManifest(open: () -> InputStream, deadlineMs: Long = 30_000L): String {
        val deadline = System.nanoTime() + deadlineMs * 1_000_000L
        val out = ByteArrayOutputStream()
        open().use { input ->
            val buf = ByteArray(4096)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (System.nanoTime() >= deadline) throw IOException("the manifest took longer than its deadline")
                if (out.size() + n > UpdateRules.MANIFEST_MAX_BYTES) throw UpdateRefused("manifest larger than 64 KB")
                out.write(buf, 0, n)
            }
        }
        return out.toString(Charsets.UTF_8.name())
    }

    /**
     * Downloads the APK of [manifest] into [dir]: streamed to `*.apk.part`
     * while the SHA-256 is computed, cut when it passes `size`, then size and
     * hash must both match before ONE rename gives the final name. On every
     * failure nothing is left behind (the `.part` and the target are deleted).
     */
    fun fetchApk(
        manifest: UpdateManifest,
        dir: File,
        open: (String) -> InputStream,
        progress: (Long, Long) -> Unit,
        deadlineMs: Long = DEADLINE_MS,
    ): File {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val part = File(dir, "NeoQuiz-${manifest.versionName}.apk.part")
        val target = File(dir, "NeoQuiz-${manifest.versionName}.apk")
        try {
            val deadline = System.nanoTime() + deadlineMs * 1_000_000L
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            open(manifest.url).use { input ->
                FileOutputStream(part).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        if (System.nanoTime() >= deadline) throw IOException("the download took longer than its deadline")
                        received += n
                        if (received > manifest.size) throw UpdateRefused("the APK is larger than the manifest says")
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                        progress(received, manifest.size)
                    }
                }
            }
            if (received != manifest.size) throw UpdateRefused("the APK is shorter than the manifest says")
            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            if (!MessageDigest.isEqual(hex.toByteArray(), manifest.sha256.toByteArray())) throw UpdateRefused("SHA-256 of the APK does not match the manifest")
            if (!part.renameTo(target)) throw IOException("the APK could not take its final name")
            return target
        } catch (t: Throwable) {
            part.delete()
            target.delete()
            throw t
        }
    }
}
