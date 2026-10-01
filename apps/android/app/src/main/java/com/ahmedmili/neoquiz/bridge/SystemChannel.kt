package com.ahmedmili.neoquiz.bridge

import java.io.File
import org.json.JSONArray

/** Asks the user for a folder; `null` when cancelled. The result is a real path. */
fun interface FolderPicker {
    suspend fun pick(): File?
}

/** Hands a file to the app Android chooses for it; false when nothing can open it. */
fun interface FileOpener {
    fun open(file: File): Boolean
}

/**
 * `dialogue.choisirDossier`, `systeme.choisirDossierDefaut` and
 * `systeme.ouvrir`, mirror of the same handlers in `canaux.ts`.
 *
 * The picked folder is the ONLY way a path the renderer did not already hold
 * enters the perimeter (through [AllowedRoots], never through an argument).
 */
class SystemChannel(
    private val perimeter: Perimeter,
    private val allowed: AllowedRoots,
    private val settings: SettingsChannel,
    private val picker: FolderPicker,
    private val opener: FileOpener,
) {
    suspend fun choisirDossier(): String? {
        val dir = picker.pick() ?: return null
        allowed.allow(dir)
        return dir.path.replace('\\', '/')
    }

    /** Created if missing, admitted to the perimeter, THEN written to the settings (the guard requires it). */
    suspend fun choisirDossierDefaut(): String? {
        val dir = picker.pick() ?: return null
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) throw java.io.IOException("cannot create ${dir.path}")
        allowed.allow(dir)
        val path = dir.path.replace('\\', '/')
        settings.ecrire("defaultFolder", path)
        return path
    }

    /** Bounded like a read, then refused on the extension: `write` + `ouvrir` must never compose an execution. */
    suspend fun ouvrir(abs: String): Boolean {
        val file = perimeter.check(abs)
        if (extensionRefusee(file.path) || extensionRefusee(abs)) return false
        return opener.open(file)
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "dialogue.choisirDossier" to { _ -> choisirDossier() },
        "systeme.choisirDossierDefaut" to { _ -> choisirDossierDefaut() },
        "systeme.ouvrir" to { a -> ouvrir(a.path(0)) },
    )
}
