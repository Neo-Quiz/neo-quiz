package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.net.URI

/** A file the page may display, with the type it is served as. */
class ResourceFile(val file: File, val mime: String)

/**
 * The images a quiz shows, served under the app's own origin:
 * `https://appassets.androidplatform.net/neo-res/<encoded absolute path>`. The
 * Windows app serves the same paths from `app://neo-res/` (`electron/ressources.ts`);
 * the shim tells the renderer which base to build (`window.neoPlatform.resourceBase`).
 *
 * Same gate as the file channels: the DECODED path goes through [Perimeter.check]
 * (symlinks and `..` followed on the disk, the private and Android data folders
 * refused). On top of it, what is served is an allow-list of image types by
 * extension, looked at on the name AND on the resolved file (a symlink `a.png`
 * to `b.apk` is refused), never a directory, never a listing. A refusal is a
 * `null` here; the WebView answers 403 and no byte of the file is read.
 */
object ResourceRoute {
    const val PREFIX = "/neo-res/"

    /** Only what the renderer puts in an `<img>` or a CSS background: no document, no media, no script. */
    private val MIME = mapOf(
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "gif" to "image/gif",
        "webp" to "image/webp",
        "bmp" to "image/bmp",
        "avif" to "image/avif",
        "svg" to "image/svg+xml",
    )

    /**
     * Headers of EVERY response of the route, served file or refusal. An SVG is harmless
     * as an `<img>`, but loaded as a DOCUMENT (frame, object, navigation) its script would
     * run in the app's origin and reach the bridge: this CSP gives it no script, no
     * network and an opaque origin (`sandbox`), and `nosniff` pins the type.
     */
    fun responseHeaders(@Suppress("UNUSED_PARAMETER") served: ResourceFile?): Map<String, String> = mapOf(
        "Content-Security-Policy" to "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        "X-Content-Type-Options" to "nosniff",
        "Cache-Control" to "no-cache",
    )

    private val WINDOWS_DRIVE = Regex("^[A-Za-z]:/")

    /** True when the URL addresses the resource route of the app's own origin (whatever the path is). */
    fun isResourceUrl(url: String): Boolean {
        val uri = parse(url) ?: return false
        return uri.rawPath?.startsWith(PREFIX) == true
    }

    /** The file to serve for [url], or `null` when it must be refused. */
    fun resolve(url: String, perimeter: Perimeter): ResourceFile? {
        val uri = parse(url) ?: return null
        if (uri.rawPath?.startsWith(PREFIX) != true) return null
        // `URI.path` decodes `%2e%2e`, `%20`, `%23`...; an invalid escape never gets here (parse failed).
        val rest = (uri.path ?: return null).substring(PREFIX.length)
        if (rest.isEmpty() || rest.any { it == '\u0000' }) return null
        val trimmed = rest.trimStart('/')
        // POSIX path ("/storage/..."): one leading slash. A drive path ("C:/...") is kept as it is (the unit tests run on Windows).
        val path = if (WINDOWS_DRIVE.containsMatchIn(trimmed)) trimmed else "/$trimmed"
        if (path.split('/').any { it == ".." }) return null
        val mime = mimeOf(path) ?: return null
        val canonical = try {
            perimeter.check(path)
        } catch (_: SecurityException) {
            return null
        }
        if (!canonical.isFile || mimeOf(canonical.name) == null) return null
        return ResourceFile(canonical, mime)
    }

    private fun mimeOf(name: String): String? {
        val leaf = name.substringAfterLast('/')
        val dot = leaf.lastIndexOf('.')
        if (dot <= 0 || dot == leaf.length - 1) return null
        return MIME[leaf.substring(dot + 1).lowercase()]
    }

    /** The URL when it is on the app's own origin (https, no port, no user info), else `null`. */
    private fun parse(url: String): URI? {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != UrlPolicy.HOST || uri.port != -1 || uri.rawUserInfo != null) return null
        return uri
    }
}
