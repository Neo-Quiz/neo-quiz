package com.ahmedmili.neoquiz.bridge

import org.json.JSONArray

/**
 * `android.fichierRecu()` (Android-only group of the bridge): the file another app handed to Neo Quiz
 * ("Open with", "Share to"), once, as `{nom, octets}`; `{erreur}` when it was refused; `null` when
 * nothing is waiting. The page then runs the SAME import as a file picked by hand.
 */
class IncomingChannel(private val inbox: IncomingInbox = IncomingInbox.shared) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.fichierRecu" to { _ -> inbox.takeForPage() },
    )
}
