package com.ahmedmili.neoquiz.bridge

import com.ahmedmili.neoquiz.code.CodeEngine
import com.ahmedmili.neoquiz.code.LanguagePacks
import org.json.JSONArray

/**
 * `code.run`, `code.warm` and the language packs (`langages.etat`,
 * `langages.installer`, `langages.supprimer`): the packs are DOWNLOADED, never
 * embedded (`LanguagePacks.kt`). The progress goes back as the pushed event
 * `langages.progression` `{recus, total}`, at most once per percent. Job
 * validation is the sandbox's own (`CodeProtocol.parseJob`), the same checks
 * as `canaux.ts`; a pack name the page invents is refused here AND below.
 */
class CodeChannel(private val engine: CodeEngine, private val emit: (String, Any?) -> Unit = { _, _ -> }) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "code.run" to { a -> engine.run(a.opt(0)) },
        "code.warm" to { a -> (a.opt(0) as? String)?.let { engine.warm(it) } },
        "langages.etat" to { a -> engine.packState(a.opt(0) as? String ?: "") },
        "langages.installer" to { a -> install(a.opt(0)) },
        "langages.supprimer" to { a -> (a.opt(0) as? String)?.takeIf { it in LanguagePacks.PINS }?.let { engine.deletePack(it) } },
    )

    private suspend fun install(raw: Any?): Map<String, Any?> {
        val name = (raw as? String)?.takeIf { it in LanguagePacks.PINS }
            ?: return mapOf("ok" to false, "code" to "reseau", "detail" to "pack refused")
        var lastPercent = -1L
        val code = engine.installPack(name) { received, total ->
            val percent = if (total > 0) received * 100 / total else 0
            if (percent != lastPercent) {
                lastPercent = percent
                emit("langages.progression", mapOf("recus" to received, "total" to total))
            }
        }
        return if (code == "ok") mapOf("ok" to true, "valeur" to null) else mapOf("ok" to false, "code" to code)
    }
}
