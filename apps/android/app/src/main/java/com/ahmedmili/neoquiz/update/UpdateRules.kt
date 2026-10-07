package com.ahmedmili.neoquiz.update

import java.net.URI
import org.json.JSONObject

/** A manifest, or an APK, that does not pass the checks: nothing is installed. */
class UpdateRefused(message: String) : Exception(message)

/** The update manifest `docs/android-latest.json`, once every field passed [UpdateRules.parse]. */
data class UpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val sha256: String,
    val size: Long,
    val notes: String,
)

/**
 * The rules of the in-app updater, all PURE (nothing here touches the network
 * or the disk, so `UpdateRulesTest` runs them on the JVM).
 *
 * THE CHAIN OF TRUST, in the order a download meets it:
 *  1. the manifest comes ONLY from [MANIFEST_URL] (our GitHub Pages site, the
 *     same place the desktop app reads `latest.json`; never api.github.com),
 *     HTTPS, every redirect hop re-judged by [manifestUrlAllowed], 64 KB cap;
 *  2. [parse] accepts a manifest only if every field has the right TYPE and
 *     the URL has the exact release shape of THIS repository, with the
 *     versionName equal to the tag and to the file name;
 *  3. the APK is downloaded only from the release hosts (the redirect rule of
 *     `LanguagePacks`), its size must equal `size` and its SHA-256 `sha256`
 *     before a single byte goes to the installer;
 *  4. SECOND LINE OF DEFENCE, not ours: Android itself refuses to replace the
 *     installed app with a package signed by another key, whatever the
 *     manifest says.
 */
object UpdateRules {
    const val MANIFEST_URL = "https://neo-quiz.github.io/android-latest.json"
    private const val MANIFEST_HOST = "neo-quiz.github.io"

    /** A manifest is a few hundred bytes; anything bigger is not ours. */
    const val MANIFEST_MAX_BYTES = 64 * 1024

    /** An APK larger than this is refused outright (the app weighs about 100 MB). */
    const val APK_MAX_BYTES = 400L * 1024 * 1024

    /** Between two automatic checks. A manual check ignores it. */
    const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L

    private const val SEMVER = """(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"""
    private val APK_URL = Regex(
        """https://github\.com/Neo-Quiz/neo-quiz/releases/download/android-v($SEMVER)/NeoQuiz-($SEMVER)\.apk""",
    )
    private val SHA256 = Regex("[0-9a-f]{64}")
    private val SEMVER_ONLY = Regex(SEMVER)

    /** Whether an automatic check is due. A clock set back counts as due (a negative age proves nothing). */
    fun due(lastCheckMs: Long, nowMs: Long): Boolean =
        lastCheckMs <= 0L || nowMs < lastCheckMs || nowMs - lastCheckMs >= CHECK_INTERVAL_MS

    fun isNewer(installedCode: Int, manifest: UpdateManifest): Boolean = manifest.versionCode > installedCode

    /** The manifest URL and every hop of its redirects: HTTPS, the site's host, no user info, port 443. */
    fun manifestUrlAllowed(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        if (uri.scheme != "https" || uri.rawUserInfo != null || (uri.port != -1 && uri.port != 443)) return false
        return uri.host?.lowercase() == MANIFEST_HOST
    }

    /** Every request of the APK download goes through `LanguagePacks.urlAllowed` (HTTPS, release hosts only). */
    fun apkUrlAllowed(url: String): Boolean = com.ahmedmili.neoquiz.code.LanguagePacks.urlAllowed(url)

    /** Parses and strictly validates a manifest; [UpdateRefused] on anything unexpected. */
    fun parse(raw: String): UpdateManifest {
        val o = try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw UpdateRefused("manifest is not a JSON object")
        }
        val versionCode = o.opt("versionCode").let {
            if (it !is Int && it !is Long) throw UpdateRefused("versionCode is not an integer")
            (it as Number).toLong()
        }
        if (versionCode < 1 || versionCode > 2_000_000_000L) throw UpdateRefused("versionCode out of range")
        val versionName = o.opt("versionName") as? String ?: throw UpdateRefused("versionName is not a string")
        if (!SEMVER_ONLY.matches(versionName)) throw UpdateRefused("versionName is not x.y.z")
        val url = o.opt("url") as? String ?: throw UpdateRefused("url is not a string")
        val match = APK_URL.matchEntire(url) ?: throw UpdateRefused("url is not a Neo Quiz Android release asset")
        if (match.groupValues[1] != versionName || match.groupValues[2] != versionName) {
            throw UpdateRefused("versionName does not match the release tag")
        }
        val sha256 = o.opt("sha256") as? String ?: throw UpdateRefused("sha256 is not a string")
        if (!SHA256.matches(sha256)) throw UpdateRefused("sha256 is not 64 lowercase hex digits")
        val size = o.opt("size").let {
            if (it !is Int && it !is Long) throw UpdateRefused("size is not an integer")
            (it as Number).toLong()
        }
        if (size < 1 || size > APK_MAX_BYTES) throw UpdateRefused("size out of range")
        val notes = o.opt("notes") as? String ?: throw UpdateRefused("notes is not a string")
        if (notes.length > 1000) throw UpdateRefused("notes too long")
        return UpdateManifest(versionCode.toInt(), versionName, url, sha256, size, notes)
    }
}
