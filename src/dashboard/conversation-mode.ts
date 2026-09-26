import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import type { FileGenerationApp } from "./file-generation-app";

/* ══════════════════════════════════════════════════════════
   LA PAGE « GÉNÉRER » EN CONVERSATION (référence claude.ai, 2026-09-26)

   Dès qu'une demande est dans la file, la page devient une conversation ;
   elle redevient la page d'accueil quand la liste se vide — par les croix
   des réponses, ou par « Nouvelle demande » (le « Nouveau » de claude.ai).
   Tout se lit sur l'état de la file : rien ici ne le mémorise.
══════════════════════════════════════════════════════════ */

/** Une demande est-elle dans la file ? (`arret` ne se montre pas.) */
export function enConversation(file: FileGenerationApp): boolean {
	return file.lignes().some(l => l.etat !== "arret");
}

/** « Nouvelle demande » peut-elle vider la liste sans rien perdre ? Pas
    tant qu'une génération tourne ou attend, ni tant qu'un quiz produit
    attend d'être enregistré (le fermer le perdrait). */
export function libreDeRepartir(file: FileGenerationApp): "oui" | "occupee" | "nonEnregistre" {
	const ls = file.lignes();
	if (ls.some(l => l.etat === "attente" || l.etat === "cours" || l.etat === "arret" || l.etat === "enregistrement")) return "occupee";
	if (ls.some(l => l.etat === "echouee" && l.echec === "enregistrement")) return "nonEnregistre";
	return "oui";
}

/** Le bouton « Nouvelle demande » en tête du fil. Rend de quoi le remettre
    à jour quand la file change (désactivé, avec la raison en infobulle). */
export function poserNouvelleDemande(parent: HTMLElement, file: FileGenerationApp): () => void {
	const b = ajouter(parent, "button", "qbd-ai-nouvelle");
	b.type = "button";
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-ai-nouvelle-icone"), "square-pen");
	ajouter(b, "span", undefined, t("ai.queue.newRequest"));
	b.addEventListener("click", () => {
		if (libreDeRepartir(file) !== "oui") return;
		// La liste vidée, la page (abonnée à la file) revient à l'accueil.
		for (const l of [...file.lignes()]) file.fermer(l.id);
	});
	const maj = (): void => {
		if (!b.isConnected) return;
		const etat = libreDeRepartir(file);
		b.disabled = etat !== "oui";
		b.title = etat === "occupee" ? t("ai.queue.newRequestBusy") : etat === "nonEnregistre" ? t("ai.queue.newRequestUnsaved") : "";
	};
	maj();
	return maj;
}
