package com.ahmedmili.neoquiz.update

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class UpdateChecksTest {
    private val own = ArchiveInfo("com.ahmedmili.neoquiz", 1, setOf("aa"))
    private fun manifest(size: Long = 3, sha: String = "0".repeat(64), code: Int = 2) =
        UpdateManifest(code, "0.2.0", "u", sha, size, "n")

    @Test fun acceptsTheSameAppSignedByTheSameKeyAndNewer() {
        assertNull(UpdateChecks.rejectArchive(ArchiveInfo(own.packageName, 2, setOf("aa")), own, manifest()))
    }

    @Test fun rejectsEverythingElse() {
        val ok = ArchiveInfo(own.packageName, 2, setOf("aa"))
        assertNotNull(UpdateChecks.rejectArchive(null, own, manifest()))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(packageName = "x.y"), own, manifest()))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(signers = setOf("bb")), own, manifest()))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(signers = emptySet()), own, manifest()))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(signers = setOf("aa", "bb")), own, manifest()))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(versionCode = 1), own, manifest(code = 1)))
        assertNotNull(UpdateChecks.rejectArchive(ok.copy(versionCode = 3), own, manifest(code = 2)))
        assertNotNull(UpdateChecks.rejectArchive(ok, own.copy(signers = emptySet()), manifest()))
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    @Test fun copyVerifiedPassesTheExactBytes() {
        val data = byteArrayOf(1, 2, 3)
        val out = ByteArrayOutputStream()
        UpdateChecks.copyVerified(ByteArrayInputStream(data), out, manifest(size = 3, sha = sha(data)))
        assertArrayEquals(data, out.toByteArray())
    }

    @Test fun copyVerifiedRefusesAChangedLongerOrShorterFile() {
        val data = byteArrayOf(1, 2, 3)
        val m = manifest(size = 3, sha = sha(data))
        assertThrows(UpdateRefused::class.java) { UpdateChecks.copyVerified(ByteArrayInputStream(byteArrayOf(1, 2, 4)), ByteArrayOutputStream(), m) }
        assertThrows(UpdateRefused::class.java) { UpdateChecks.copyVerified(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), ByteArrayOutputStream(), m) }
        assertThrows(UpdateRefused::class.java) { UpdateChecks.copyVerified(ByteArrayInputStream(byteArrayOf(1, 2)), ByteArrayOutputStream(), m) }
        assertEquals(3L, m.size)
    }
}
