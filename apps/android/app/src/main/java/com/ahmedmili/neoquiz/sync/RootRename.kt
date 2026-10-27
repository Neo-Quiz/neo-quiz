package com.ahmedmili.neoquiz.sync

import android.util.Log
import java.io.File
import java.text.Normalizer
import org.json.JSONObject

/**
 * The synced folder FOLLOWS A RENAME made on the PCs (2026-10-27, the owner renamed `Neo Quiz` to
 * `Efrei` "on all my devices"): each PC publishes the name of its folder in
 * `<root>/.neo-quiz/root-name/<deviceId>.json` (`{ "v": 1, "name": "Efrei" }`, written by the Windows
 * main process), and this phone renames its own folder to the name they ALL agree on.
 *
 * Pure (java.io and org.json only) so the JVM tests break each rule. Same safety as [FolderMove]: a
 * rename on the same storage (instant, nothing copied: `.stfolder` and `.neo-quiz/` move with it),
 * never into a folder that holds something, never a merge, never a deletion of anything but an empty
 * folder. The CALLER runs it only while Syncthing is stopped ([SyncHub.prepareRoot]).
 *
 * The files come from other devices: they are read as hostile (name checked, size bounded, conflict
 * copies and temporary files ignored).
 */
object RootRename {
    private const val TAG = "RootRename"

    /** The folder's name until a rename is followed. */
    const val DEFAULT_NAME = "Neo Quiz"

    /** Where the PCs publish their folder's name, relative to the synced folder. */
    const val DIR = ".neo-quiz/root-name"

    private const val MAX_BYTES = 4096L

    /** `<deviceId>.json` only: a Syncthing conflict copy or a `.tmp` carries more dots. */
    private val FILE_NAME = Regex("^[A-Za-z0-9-]{1,64}\\.json$")
    private val FORBIDDEN = Regex("[/\\\\:*?\"<>|\\p{Cntrl}]")

    /** Standard top-level folders of the shared storage: the synced folder never takes their name. */
    private val RESERVED = setOf(
        "android", "dcim", "download", "documents", "pictures", "music", "movies",
        "alarms", "notifications", "podcasts", "ringtones", "recordings", "audiobooks",
    )

    /** Where a refused rename is told; JVM tests replace it (android.util.Log is not there). */
    var log: (String) -> Unit = { Log.w(TAG, it) }

    /** A name this phone may give its synced folder, directly under the shared storage. */
    fun isValidName(name: String): Boolean {
        if (name.isEmpty() || name.length > 100) return false
        if (name != name.trim()) return false
        if (Normalizer.normalize(name, Normalizer.Form.NFC) != name) return false
        if (FORBIDDEN.containsMatchIn(name)) return false
        if (name.startsWith(".") || name.endsWith(".")) return false
        if (name.lowercase() in RESERVED) return false
        return true
    }

    /**
     * The name every PC publishing one agrees on, or `null`: no entry, or two different names (a PC
     * still on the old name blocks the rename instead of making the phone flip back and forth).
     * An unreadable, oversized or invalid entry is ignored.
     */
    fun desiredName(root: File): String? {
        val files = File(root, DIR).listFiles() ?: return null
        val names = mutableSetOf<String>()
        for (f in files) {
            if (!f.isFile || !FILE_NAME.matches(f.name) || f.length() > MAX_BYTES) continue
            val o = try { JSONObject(f.readText(Charsets.UTF_8)) } catch (e: Exception) { continue }
            if (o.optInt("v", 0) != 1) continue
            val name = o.opt("name") as? String ?: continue
            if (isValidName(name)) names += name
        }
        return names.singleOrNull()
    }

    /**
     * True when [move] may rename [current] to [desired]: a different name (not a change of case only:
     * the storage ignores case), a valid one, an existing current folder, and a target that is absent
     * or an EMPTY folder. Checked before anything is recorded, so a refused target changes nothing.
     */
    fun canMove(storage: File, current: String, desired: String): Boolean {
        if (desired.equals(current, ignoreCase = true) || !isValidName(desired)) return false
        if (!File(storage, current).isDirectory) return false
        val to = File(storage, desired)
        if (!to.exists()) return true
        val empty = to.isDirectory && to.list()?.isEmpty() == true
        if (!empty) log("$desired already holds something: $current is not renamed")
        return empty
    }

    /**
     * Renames the folder [current] directly under [storage] to [desired]. The new folder, or `null`
     * when nothing moved: same name (a change of case only is not followed: the storage ignores case),
     * an invalid name, no current folder, a target holding something, or the rename refused.
     */
    @Synchronized
    fun move(storage: File, current: String, desired: String): File? {
        if (!canMove(storage, current, desired)) return null
        val from = File(storage, current)
        val to = File(storage, desired)
        if (to.exists()) {
            if (!to.delete()) {
                log("the empty folder $desired cannot be replaced")
                return null
            }
        }
        if (!from.renameTo(to)) {
            log("$current cannot be renamed to $desired")
            return null
        }
        return to
    }
}
