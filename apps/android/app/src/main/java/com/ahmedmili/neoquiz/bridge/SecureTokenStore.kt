package com.ahmedmili.neoquiz.bridge

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** The GitHub session of the bug report: one access token and its login (no expiry, no refresh token). */
data class GithubSession(val accessToken: String, val login: String)

interface SessionStore {
    fun read(): GithubSession?
    /** Throws when nothing could be stored: the session is then refused, never kept in clear. */
    fun write(session: GithubSession)
    fun clear()
}

/**
 * AES-GCM with a key that never leaves the AndroidKeyStore (alias `neoquiz.bugreport`); the
 * ciphertext (12-byte IV first) lives in a private file. The token is handed to no caller but
 * `SignalementChannel`, which never passes it to the page.
 */
class SecureTokenStore(private val file: File) : SessionStore {
    private fun key(create: Boolean): SecretKey? {
        val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized override fun read(): GithubSession? = try {
        val raw = file.readBytes()
        val k = key(false)
        if (k == null || raw.size <= IV_BYTES) null else {
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, raw, 0, IV_BYTES))
            val o = JSONObject(String(c.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8))
            val t = o.optString("accessToken")
            val l = o.optString("login")
            if (t.isNotEmpty() && t.length <= 255 && l.isNotEmpty()) GithubSession(t, l) else null
        }
    } catch (_: Exception) {
        null
    }

    @Synchronized override fun write(session: GithubSession) {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key(true))
        val body = c.doFinal(JSONObject().put("accessToken", session.accessToken).put("login", session.login).toString().toByteArray(Charsets.UTF_8))
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeBytes(c.iv + body)
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw java.io.IOException("could not store the session")
        }
    }

    @Synchronized override fun clear() {
        file.delete()
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val ALIAS = "neoquiz.bugreport"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
