package com.ahmedmili.neoquiz.update

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

/** What the package manager says about an APK (or the installed app): name, code, and signer certificate digests. */
data class ArchiveInfo(val packageName: String, val versionCode: Long, val signers: Set<String>)

/** Pure checks made on the verified file right before it is committed to the system installer. */
object UpdateChecks {
    /**
     * Why the archive must NOT be installed, or null when it may. Same package, same signing
     * certificates as the installed app (compared through the package manager, no key pinned in
     * the app), a versionCode strictly higher than the installed one and equal to the manifest's:
     * a lying manifest, a wrong package or a foreign signature stops here, with no confusing
     * system prompt. Android enforces the same rules again at install time.
     */
    fun rejectArchive(archive: ArchiveInfo?, own: ArchiveInfo, manifest: UpdateManifest): String? {
        if (archive == null) return "the APK could not be read"
        if (archive.packageName != own.packageName) return "the APK is another package"
        if (archive.signers.isEmpty() || own.signers.isEmpty() || archive.signers != own.signers) return "the APK is signed by another key"
        if (archive.versionCode <= own.versionCode) return "the APK is not newer than the installed app"
        if (archive.versionCode != manifest.versionCode.toLong()) return "the APK versionCode differs from the manifest"
        return null
    }

    /**
     * Copies [input] to [out] while hashing it, and refuses unless the byte count and the SHA-256
     * equal the manifest's: the bytes given to the installer are the bytes that were verified.
     */
    fun copyVerified(input: InputStream, out: OutputStream, manifest: UpdateManifest) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > manifest.size) throw UpdateRefused("the APK grew after verification")
            digest.update(buf, 0, n)
            out.write(buf, 0, n)
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (total != manifest.size || !MessageDigest.isEqual(hex.toByteArray(), manifest.sha256.toByteArray())) {
            throw UpdateRefused("the APK changed after verification")
        }
    }
}
