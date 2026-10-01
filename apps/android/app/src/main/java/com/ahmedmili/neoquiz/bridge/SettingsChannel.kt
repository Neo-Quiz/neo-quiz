package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.io.FileNotFoundException
import java.time.Instant
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * The `reglages.*` channels, mirror of `apps/windows/electron/reglages.ts` plus
 * the key guards of `canaux.ts`: one JSON object in a single file, written
 * atomically, writes queued (two concurrent writes must not rename each
 * other's temp file), and an UNREADABLE file is never taken for an empty one
 * (only a missing file is `{}`; invalid JSON is set aside first).
 *
 * The keys that feed the perimeter on the next start (`folders`, `folder`,
 * `defaultFolder`, `fond.dossier`) are GUARDED at write time: every path must
 * already be inside the perimeter. The two sync keys are written by the
 * app alone. The `ai` key is not guarded because nothing on Android reads it.
 */
class SettingsChannel(
    private val file: File,
    private val perimeter: Perimeter,
    private val allowed: AllowedRoots,
    private val defaultDir: () -> File,
) {
    private val queue = Mutex()

    private fun readAll(): JSONObject {
        val text = try {
            file.readText(Charsets.UTF_8)
        } catch (_: FileNotFoundException) {
            return JSONObject()
        }
        try {
            return JSONObject(text)
        } catch (_: Exception) {
            // Keep the unreadable file under another name before starting from empty.
            val aside = File(file.parentFile, "${file.name}.corrompu-${Instant.now().toString().replace(Regex("[:.]"), "-")}")
            if (!file.renameTo(aside)) throw java.io.IOException("settings unreadable and cannot be set aside")
            return JSONObject()
        }
    }

    suspend fun lire(cle: String): Any? = queue.withLock {
        readAll().opt(cle).let { if (it == JSONObject.NULL) null else it }
    }

    suspend fun ecrire(cle: String, valeur: Any?) {
        guard(cle, valeur)
        queue.withLock {
            val all = readAll()
            all.put(cle, valeur ?: JSONObject.NULL)
            atomicWrite(file, all.toString().toByteArray(Charsets.UTF_8))
        }
    }

    suspend fun supprimer(cle: String) {
        if (reserved(cle)) throw IllegalArgumentException("réglage refusé : $cle n'est supprimé que par le processus principal")
        queue.withLock {
            val all = readAll()
            if (all.has(cle)) {
                all.remove(cle)
                atomicWrite(file, all.toString().toByteArray(Charsets.UTF_8))
            }
        }
    }

    /** The default folder: the one kept in the settings when it is still inside the perimeter, else the app's own. */
    suspend fun dossierDefaut(): String {
        val kept = lire(KEY_DEFAULT_FOLDER) as? String
        if (kept != null && perimeter.contains(kept)) return kept.replace('\\', '/')
        val dir = defaultDir()
        dir.mkdirs()
        allowed.allow(dir)
        return dir.path.replace('\\', '/')
    }

    private fun reserved(cle: String) = cle == "syncActif" || cle == "syncRoot"

    private fun guard(cle: String, valeur: Any?) {
        if (reserved(cle)) throw IllegalArgumentException("réglage refusé : $cle n'est écrit que par le processus principal")
        when (cle) {
            "folders", "folder" -> for (p in folderPaths(valeur)) {
                if (!perimeter.contains(p)) throw IllegalArgumentException("dossier hors périmètre, refusé dans les réglages : $p")
            }
            KEY_DEFAULT_FOLDER -> {
                if (valeur == null || valeur == JSONObject.NULL) return
                if (valeur !is String || valeur.isBlank()) throw IllegalArgumentException("dossier par défaut refusé : valeur invalide : $valeur")
                if (!perimeter.contains(valeur)) throw IllegalArgumentException("dossier par défaut refusé : hors périmètre : $valeur")
            }
            "fond" -> guardBackground(valeur)
        }
    }

    private fun guardBackground(valeur: Any?) {
        if (valeur == null || valeur == JSONObject.NULL) return
        if (valeur !is JSONObject) throw IllegalArgumentException("réglage fond refusé : valeur n'est pas un objet : $valeur")
        if (valeur.has("embarque")) {
            val e = valeur.opt("embarque")
            if (e !is String || e.isBlank()) throw IllegalArgumentException("réglage fond refusé : embarque doit être une chaîne : $e")
            // The embedded form has no path: a `dossier` beside it would be read at the next start (`seedRoots`).
            if (valeur.has("dossier") || valeur.has("image")) throw IllegalArgumentException("réglage fond refusé : embarque n'admet ni dossier ni image")
            return
        }
        val dossier = valeur.opt("dossier")
        val image = valeur.opt("image")
        if (dossier !is String || dossier.isBlank()) throw IllegalArgumentException("réglage fond refusé : dossier invalide : $dossier")
        if (!perimeter.contains(dossier)) throw IllegalArgumentException("réglage fond refusé : dossier hors périmètre : $dossier")
        if (!validImage(image)) throw IllegalArgumentException("réglage fond refusé : image invalide : $image")
    }

    /** `image` is a file NAME from the folder listing, never a path. */
    private fun validImage(image: Any?) = image is String && image.isNotBlank() && "/" !in image && "\\" !in image && ".." !in image

    /**
     * The folder a stored `fond` may add to the perimeter at startup: only a
     * well-formed folder background (no `embarque`, a real `image` name). The stored
     * value is judged again here: the file is not trusted for having passed the
     * write guard once.
     */
    private fun backgroundFolder(fond: JSONObject): String? {
        if (fond.has("embarque")) return null
        val dossier = fond.opt("dossier") as? String ?: return null
        return dossier.takeIf { it.isNotBlank() && validImage(fond.opt("image")) }
    }

    /** The paths of a `folders` value (array of `{ path }`) or of the legacy `folder` (a string). */
    private fun folderPaths(valeur: Any?): List<String> = when (valeur) {
        is String -> listOf(valeur)
        is JSONArray -> (0 until valeur.length()).mapNotNull { (valeur.opt(it) as? JSONObject)?.opt("path") as? String }.filter { it.isNotBlank() }
        else -> emptyList()
    }

    /** Admits the folders kept by a previous session, like `perimetreInitial`; a vanished folder is just absent. */
    suspend fun seedRoots() {
        for (key in listOf("folders", "folder")) folderPaths(lire(key)).forEach { allowed.allow(File(it)) }
        (lire(KEY_DEFAULT_FOLDER) as? String)?.let { allowed.allow(File(it)) }
        (lire("fond") as? JSONObject)?.let(::backgroundFolder)?.let { allowed.allow(File(it)) }
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "reglages.lire" to { a -> lire(a.text(0)) },
        "reglages.ecrire" to { a -> ecrire(a.text(0), a.opt(1)) },
        "reglages.supprimer" to { a -> supprimer(a.text(0)) },
        "systeme.dossierDefaut" to { _ -> dossierDefaut() },
    )

    private companion object {
        const val KEY_DEFAULT_FOLDER = "defaultFolder"
    }
}
