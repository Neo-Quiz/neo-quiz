package com.ahmedmili.neoquiz.bridge

import org.json.JSONArray

/**
 * The channels that have no Android implementation yet (a later task owns
 * them) or never will (a desktop-only capability). Each answers the
 * "unavailable" value the renderer already handles for the matching Electron
 * handler (`apps/windows/electron/canaux.ts`, `pont.ts`): a refusal envelope,
 * `null`, `false`, `[]`, `"indisponible"`... never an error, so no page breaks
 * on a missing capability. `Channels.ALL` minus the handled channels must be
 * exactly this map (BridgeTest).
 */
object Unavailable {
    private val value: Map<String, () -> Any?> = mapOf(
        "partage.enregistrer" to { null },
        "partage.discord" to { false },
        "systeme.copierTexte" to { null },
        "systeme.vaultsObsidian" to { emptyList<Any>() },
        "systeme.choisirFichiers" to { emptyList<Any>() },
        "systeme.relancer" to { null },
        // Network and CLIs: `null` is the network-failure answer of `reseau.fetch`.
        "reseau.fetch" to { null },
        "reseau.annuler" to { null },
        "processus.run" to { mapOf("ok" to false, "nom" to "indisponible", "message" to "not available on Android") },
        "processus.annuler" to { null },
        "processus.lireCache" to { null },
        "processus.ollamaInstalle" to { false },
        "processus.demarrerOllama" to { false },
        "processus.openTerminal" to { "indisponible" },
        "processus.connecter" to { "indisponible" },
        "processus.attendreFinTerminal" to { null },
        "processus.replacerTerminal" to { null },
        "processus.comptesEtat" to { emptyList<Any>() },
        "processus.comptesUsage" to { mapOf("rows" to emptyList<Any>(), "error" to mapOf("kind" to "unavailable"), "mesureAt" to null) },
        "processus.comptesDeconnecter" to { "indisponible" },
        "processus.comptesUsageTerminal" to { "indisponible" },
        // The window is the activity: nothing to arm, move or close from the page.
        "fenetre.prete" to { null },
        "fenetre.surFermeture" to { null },
        "fenetre.fermetureTerminee" to { null },
        "fenetre.reduire" to { null },
        "fenetre.premierPlan" to { null },
        "fenetre.agrandirOuRestaurer" to { null },
        "fenetre.fermer" to { null },
        "fenetre.pleinEcran" to { null },
        "fenetre.etat" to { mapOf("agrandie" to true, "focus" to true, "pleinEcran" to false) },
        "affichage.zoom" to { null },
        "affichage.recharger" to { null },
        "affichage.outilsDev" to { null },
        "miseAJour.etat" to { mapOf("phase" to "inactif") },
        "miseAJour.verifier" to { false },
        "miseAJour.installer" to { null },
        "collage.attendre" to { false },
        "collage.arreter" to { null },
        "depot.disposer" to { null },
        "depot.ecrire" to { null },
        "depot.preparer" to { null },
        "depot.glisser" to { "impossible" },
        "depot.terminer" to { null },
        "video.etat" to { mapOf("present" to false, "source" to null) },
        "video.infosInstallation" to { mapOf("version" to null, "datePublication" to null, "taille" to null, "url" to "") },
        "video.installer" to { mapOf("ok" to false, "code" to "reseau") },
        "video.transcrire" to { mapOf("ok" to false, "code" to "inconnue", "detail" to "not available on Android") },
        "video.annuler" to { null },
        "code.run" to { mapOf("status" to "unavailable", "stdout" to "", "error" to "not available on Android") },
        "code.warm" to { null },
        "langages.etat" to { mapOf("installe" to false, "version" to null, "octets" to 0) },
        "langages.installer" to { mapOf("ok" to false, "code" to "reseau") },
        "langages.supprimer" to { null },
        // Task 10 implements the sync channels.
        "sync.etat" to { mapOf("actif" to false, "appareil" to null, "appareils" to emptyList<Any>(), "dossier" to mapOf("etat" to "absent", "pourcentage" to null)) },
        "sync.appairer" to { "indisponible" },
        "sync.oublier" to { null },
    )

    val names: Set<String> get() = value.keys

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = value.mapValues { (_, v) -> { _: JSONArray -> v() } }
}
