package com.ahmedmili.neoquiz.bridge

import com.ahmedmili.neoquiz.code.CodeEngine
import org.json.JSONArray

/**
 * `code.run`, `code.warm` and `langages.etat`. The C/C++ pack is BUNDLED in the
 * APK, never downloaded on the phone: `langages.installer` and `langages.supprimer`
 * stay unavailable (`Unavailable.kt`). Job validation is the sandbox's own
 * (`CodeProtocol.parseJob`), the same checks as `canaux.ts`.
 */
class CodeChannel(private val engine: CodeEngine) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "code.run" to { a -> engine.run(a.opt(0)) },
        "code.warm" to { a -> (a.opt(0) as? String)?.let { engine.warm(it) } },
        "langages.etat" to { a -> engine.packState(a.opt(0) as? String ?: "") },
    )
}
