package com.ahmedmili.neoquiz.bridge

/**
 * What the file chooser of the page (`<input type=file>`, used by "Import a
 * shared folder" and "Import a shared quiz") may hand back. The page accepts
 * `.zip` and `.md`; the system picker's type filter is only a hint (a phone
 * reports a Markdown file as `application/octet-stream` as often as
 * `text/markdown`), so the NAME of every picked file is checked too, and a
 * file of another kind never reaches the page.
 */
object ChooserRules {
    private val ALLOWED_EXTENSIONS = setOf("zip", "md")

    /** Does a picked file's display name end with an importable extension? */
    fun acceptsName(name: String?): Boolean {
        if (name.isNullOrBlank()) return false
        val dot = name.trim().lastIndexOf('.')
        return dot > 0 && name.trim().substring(dot + 1).lowercase() in ALLOWED_EXTENSIONS
    }

    /** The MIME types offered to the picker for the page's `accept` list. */
    fun mimeTypes(acceptTypes: Array<String>): Array<String> {
        val out = linkedSetOf<String>()
        for (raw in acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }) {
            when (raw) {
                ".zip", "application/zip" -> out += listOf("application/zip", "application/x-zip-compressed")
                ".md", "text/markdown" -> out += listOf("text/markdown", "text/x-markdown", "text/plain")
            }
        }
        // The type hint is unreliable: always allow the generic type, the name check decides.
        out += "application/octet-stream"
        return out.toTypedArray()
    }
}
