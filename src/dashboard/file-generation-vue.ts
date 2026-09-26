/* ══════════════════════════════════════════════════════════
   LES LIGNES DE LA FILE, SOUS LE COMPOSER

   Spec 2026-09-26 : chaque envoi devient une ligne, comme un message
   envoyé — le résumé de la demande, le mode, le fournisseur et le modèle
   avec leur logo, puis l'état. Une ligne est du TEXTE avec une icône
   d'état, pas une carte vitrée : pas de tuile, pas de pastille, pas de
   majuscules. Les actions : « Ouvrir » (prête), ■ (en attente ou en
   cours), « Réessayer » et × (échouée), × (prête).

   La vue s'abonne à la file de l'application et s'en désabonne d'elle-même
   dès que sa zone quitte le document (la coquille peint une autre page) —
   `liberer` le fait aussi au démontage de la page. Le temps écoulé d'une
   ligne en cours se redessine chaque seconde, et seulement tant qu'elle est
   à l'écran.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import * as aiProviders from "./ai-providers";
import { debutDeDemande } from "./ai-sources";
import type { DemandeFile, FileGenerationApp, LigneGeneration } from "./file-generation-app";
import { t } from "../i18n";

export interface VueFile {
	/** Pose la zone des lignes dans `parent` (à chaque rendu de la page). */
	rendre(parent: HTMLElement): void;
	/** Désabonne la vue et arrête l'horloge : la page se démonte. */
	liberer(): void;
}

/** « 0:42 », « 12:05 » — le temps écoulé, sans unité à traduire. */
function duree(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Le résumé : les premiers mots de la demande, sinon le nom des pièces
    jointes — noms entiers, extension comprise, jamais coupés. */
function resume(d: DemandeFile): string {
	const { texte, coupee } = debutDeDemande(d.text);
	if (texte) return coupee ? texte + "…" : texte;
	const noms = [...d.notes.map(n => n.name), ...d.images.map(i => i.file.name)];
	return noms.length ? noms.join(", ") : t("ai.result.untitled");
}

export function creerVueFile(opts: { file: FileGenerationApp; ouvrir: (chemin: string) => void }): VueFile {
	const host = currentHost();
	let zone: HTMLElement | null = null;
	let desabonner: (() => void) | null = null;
	let horloge: number | null = null;

	const affichee = (): boolean => !!zone?.isConnected;

	function arreterHorloge(): void {
		if (horloge !== null) { window.clearInterval(horloge); horloge = null; }
	}

	function liberer(): void {
		desabonner?.();
		desabonner = null;
		arreterHorloge();
		zone = null;
	}

	/** Un bouton-icône de la ligne, nommé pour la souris et le lecteur d'écran. */
	function boutonIcone(parent: HTMLElement, icone: string, libelle: string, action: () => void): void {
		const b = ajouter(parent, "button", "qbd-ai-file-btn");
		b.type = "button";
		host.ui.setIcon(b, icone);
		b.setAttribute("aria-label", libelle);
		b.title = libelle;
		b.addEventListener("click", action);
	}

	function peindreLigne(parent: HTMLElement, l: LigneGeneration): void {
		const d = l.demande;
		const ligne = ajouter(parent, "div", "qbd-ai-file-ligne qbd-ai-file-ligne--" + l.etat);
		ligne.setAttribute("role", "listitem");
		const icone = ajouter(ligne, "span", "qbd-ai-file-etat");
		host.ui.setIcon(icone, l.etat === "attente" ? "clock" : l.etat === "cours" ? "sparkles" : l.etat === "prete" ? "check" : "alert-triangle");

		const corps = ajouter(ligne, "div", "qbd-ai-file-corps");
		ajouter(corps, "div", "qbd-ai-file-resume", resume(d));
		const meta = ajouter(corps, "div", "qbd-ai-file-meta");
		ajouter(meta, "span", undefined, d.mode === "learn" ? t("ai.mode.learn") : t("ai.mode.practice"));
		const providerId = d.reglages.aiProvider || "";
		const p = providerId ? aiProviders.getProvider(providerId) : null;
		if (p) {
			const modele = ajouter(meta, "span", "qbd-ai-file-modele");
			const logo = ajouter(modele, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
			aiProviders.setBrandLogo(logo, p.logo);
			const id = d.reglages.aiModel || p.defaultModel || "";
			ajouter(modele, "span", undefined, id ? aiProviders.libelleModele(providerId, id) : p.name);
		}

		const etat = ajouter(corps, "div", "qbd-ai-file-statut");
		if (l.etat === "attente") etat.textContent = t("ai.queue.waiting");
		else if (l.etat === "cours") {
			ajouter(etat, "span", undefined, t("ai.loading.title"));
			const temps = ajouter(etat, "span", "qbd-ai-file-temps", duree(Date.now() - (l.debut ?? Date.now())));
			temps.dataset.debut = String(l.debut ?? Date.now());
			// Redessiné chaque seconde : un lecteur d'écran ne doit pas l'annoncer.
			temps.setAttribute("aria-hidden", "true");
			const points = ajouter(etat, "span", "qbd-ai-file-points");
			points.setAttribute("aria-hidden", "true");
			for (let i = 0; i < 3; i++) ajouter(points, "span", "qbd-ai-file-point");
		} else if (l.etat === "prete") etat.textContent = l.resultat?.titre ?? "";
		else if (l.etat === "echouee") etat.textContent = l.erreur ?? "";

		const actions = ajouter(ligne, "div", "qbd-ai-file-actions");
		if (l.etat === "prete" && l.resultat) {
			const chemin = l.resultat.chemin;
			const ouvrir = ajouter(actions, "button", "qbd-btn qbd-btn--ghost qbd-ai-file-ouvrir", t("ai.queue.open"));
			ouvrir.type = "button";
			ouvrir.addEventListener("click", () => opts.ouvrir(chemin));
		}
		if (l.etat === "echouee") {
			const reessayer = ajouter(actions, "button", "qbd-btn qbd-btn--ghost qbd-ai-file-ouvrir", t("ai.error.retry"));
			reessayer.type = "button";
			reessayer.addEventListener("click", () => opts.file.reessayer(l.id));
		}
		if (l.etat === "attente" || l.etat === "cours") {
			boutonIcone(actions, "square", l.etat === "cours" ? t("ai.composer.stop") : t("ai.queue.cancel"), () => opts.file.annuler(l.id));
		} else {
			boutonIcone(actions, "x", t("ai.queue.close"), () => opts.file.fermer(l.id));
		}
	}

	function peindre(): void {
		if (!zone) return;
		/* La zone a quitté le document : la page n'est plus à l'écran. La vue
		   se retire d'elle-même ; le prochain rendu la réabonnera. */
		if (!zone.isConnected) { liberer(); return; }
		zone.replaceChildren();
		// L'état `arret` ne se montre pas : pour l'utilisateur, la ligne est annulée.
		const visibles = opts.file.lignes().filter(l => l.etat !== "arret");
		for (const l of visibles) peindreLigne(zone, l);
		const enCours = visibles.some(l => l.etat === "cours");
		if (enCours && horloge === null) {
			horloge = window.setInterval(() => {
				if (!zone?.isConnected) { liberer(); return; }
				zone.querySelectorAll<HTMLElement>(".qbd-ai-file-temps").forEach(el => {
					el.textContent = duree(Date.now() - Number(el.dataset.debut));
				});
			}, 1000);
		} else if (!enCours) arreterHorloge();
	}

	return {
		rendre(parent) {
			zone = ajouter(parent, "div", "qbd-ai-file");
			zone.setAttribute("role", "list");
			zone.setAttribute("aria-label", t("ai.queue.label"));
			zone.setAttribute("aria-live", "polite");
			if (!desabonner) desabonner = opts.file.abonner(peindre, affichee);
			peindre();
		},
		liberer,
	};
}
