/* ══════════════════════════════════════════════════════════
   LA FILE, EN CONVERSATION (référence claude.ai, 2026-09-26)

   Chaque envoi est un TOUR de conversation, comme sur claude.ai : le
   message de l'utilisateur à droite (ses pièces jointes en vignettes, son
   texte dans une bulle, le mode et le modèle en petit dessous), puis la
   RÉPONSE à gauche. Pendant la génération, la réponse est l'étincelle qui
   s'anime, un texte d'état qui suit l'étape (« Lecture du document… »,
   « Génération des questions… », « Enregistrement… ») et le temps écoulé ;
   en attente, « En attente » ; prête, une carte avec le titre, le nombre
   de questions et « Ouvrir » ; en échec, le message et ses actions.

   Les états et les gestes sont ceux de la file (`file-generation.ts`) :
   ■ retire une demande en attente ou arrête celle qui tourne, × ferme une
   réponse finie, « Réessayer », « Réessayer l'enregistrement » et « Ouvrir
   sans enregistrer » ne changent pas. Pas de majuscules, pas de pastille.

   La vue s'abonne à la file de l'application et s'en désabonne d'elle-même
   dès que sa zone quitte le document. Le temps écoulé se redessine chaque
   seconde, tant qu'une génération tourne et qu'elle est à l'écran. Le
   DÉFILEMENT suit la dernière réponse, comme sur claude.ai : un tour qui
   arrive, ou une réponse qui change alors qu'on lisait le bas, ramène en bas ;
   quelqu'un qui relit plus haut n'est pas déplacé.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import * as aiProviders from "./ai-providers";
import { badgeDeFichier, couperNomAuMilieu } from "./file-icons";
import type { EtapeGeneration, FileGenerationApp, LigneGeneration } from "./file-generation-app";
import type { TransKey } from "../i18n";
import { t } from "../i18n";

export interface VueFile {
	/** Pose la zone des tours dans `parent` (à chaque rendu de la page). */
	rendre(parent: HTMLElement): void;
	/** Désabonne la vue et arrête l'horloge : la page se démonte. */
	liberer(): void;
}

/** « 0:42 », « 12:05 » — le temps écoulé, sans unité à traduire. */
function duree(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const TEXTE_ETAPE: Record<EtapeGeneration, TransKey> = {
	preparation: "ai.queue.stepPreparing",
	lecture: "ai.queue.stepReading",
	redaction: "ai.queue.stepWriting",
	enregistrement: "ai.queue.saving",
};

/* L'URL d'aperçu d'une image partie avec la demande, une par fichier : la
   page a rendu la sienne en vidant le composer. */
const urlsImages = new WeakMap<File, string>();
function urlImage(f: File): string {
	let u = urlsImages.get(f);
	if (!u) { u = URL.createObjectURL(f); urlsImages.set(f, u); }
	return u;
}

export function creerVueFile(opts: {
	file: FileGenerationApp;
	ouvrir: (chemin: string) => void;
	/** Montre le quiz d'une ligne dont l'enregistrement a échoué, sans note. */
	ouvrirSansEnregistrer: (ligne: LigneGeneration) => void;
}): VueFile {
	const host = currentHost();
	let zone: HTMLElement | null = null;
	let desabonner: (() => void) | null = null;
	let horloge: number | null = null;
	/** L'identifiant du dernier tour peint ; -1 force le retour en bas. */
	let dernierPeint = -1;

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

	/** Un bouton-icône, nommé pour la souris et le lecteur d'écran. */
	function boutonIcone(parent: HTMLElement, icone: string, libelle: string, action: () => void): void {
		const b = ajouter(parent, "button", "qbd-ai-file-btn");
		b.type = "button";
		host.ui.setIcon(b, icone);
		b.setAttribute("aria-label", libelle);
		b.title = libelle;
		b.addEventListener("click", action);
	}

	/** Un bouton texte de la réponse (Ouvrir, Réessayer…). */
	function bouton(parent: HTMLElement, libelle: string, action: () => void): void {
		const b = ajouter(parent, "button", "qbd-ai-reponse-action", libelle);
		b.type = "button";
		b.addEventListener("click", action);
	}

	/** Le message de l'utilisateur : vignettes, bulle, mode et modèle. */
	function peindreMessage(parent: HTMLElement, l: LigneGeneration): void {
		const d = l.demande;
		const message = ajouter(parent, "div", "qbd-ai-message");
		if (d.notes.length || d.images.length) {
			const pieces = ajouter(message, "div", "qbd-ai-message-pieces");
			for (const img of d.images) {
				const p = ajouter(pieces, "div", "qbd-ai-message-piece qbd-ai-message-piece--image");
				p.title = img.file.name;
				const el = ajouter(p, "img");
				el.src = urlImage(img.file);
				el.alt = img.file.name;
			}
			for (const n of d.notes) {
				const p = ajouter(pieces, "div", "qbd-ai-message-piece");
				p.title = n.path || n.name;
				if (n.thumb) {
					p.classList.add("qbd-ai-message-piece--image");
					const el = ajouter(p, "img");
					el.src = n.thumb;
					el.alt = n.name;
					continue;
				}
				// Le nom coupé AU MILIEU : l'extension reste toujours visible.
				const { tete, queue } = couperNomAuMilieu(n.name);
				const nom = ajouter(p, "span", "qbd-ai-message-piece-nom");
				ajouter(nom, "span", "qbd-ai-message-piece-tete", tete);
				if (queue) ajouter(nom, "span", "qbd-ai-message-piece-queue", queue);
				ajouter(p, "span", "qbd-ai-note-chip-badge", badgeDeFichier(n.name));
			}
		}
		if (d.text.trim()) ajouter(message, "div", "qbd-ai-bulle", d.text.trim());
		const meta = ajouter(message, "div", "qbd-ai-message-meta");
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
	}

	/** La réponse, selon l'état de la ligne. */
	function peindreReponse(parent: HTMLElement, l: LigneGeneration): void {
		const rep = ajouter(parent, "div", "qbd-ai-reponse qbd-ai-reponse--" + l.etat);
		if (l.etat === "cours" || l.etat === "enregistrement") {
			const etincelle = ajouter(rep, "span", "qbd-ai-etincelle");
			etincelle.setAttribute("aria-hidden", "true");
			host.ui.setIcon(etincelle, "sparkles");
			const etape = l.etat === "enregistrement" ? "enregistrement" : (opts.file.etape(l.id) ?? "preparation");
			ajouter(rep, "span", "qbd-ai-reponse-etape", t(TEXTE_ETAPE[etape]));
			if (l.etat === "cours") {
				const temps = ajouter(rep, "span", "qbd-ai-file-temps", duree(Date.now() - (l.debut ?? Date.now())));
				temps.dataset.debut = String(l.debut ?? Date.now());
				// Redessiné chaque seconde : un lecteur d'écran ne doit pas l'annoncer.
				temps.setAttribute("aria-hidden", "true");
				boutonIcone(ajouter(rep, "span", "qbd-ai-reponse-fin"), "square", t("ai.composer.stop"), () => opts.file.annuler(l.id));
			}
			return;
		}
		if (l.etat === "attente") {
			host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), "clock");
			ajouter(rep, "span", "qbd-ai-reponse-texte", t("ai.queue.waiting"));
			boutonIcone(ajouter(rep, "span", "qbd-ai-reponse-fin"), "square", t("ai.queue.cancel"), () => opts.file.annuler(l.id));
			return;
		}
		if (l.etat === "prete" && l.resultat) {
			/* La carte du quiz : c'est un CONTENU, elle a donc sa tuile ; son
			   action est un texte, pas un bouton encadré dans la carte. */
			const r = l.resultat;
			const carte = ajouter(rep, "div", "qbd-ai-resultat");
			host.ui.setIcon(ajouter(carte, "span", "qbd-ai-resultat-icone"), "file-check-2");
			const corps = ajouter(carte, "div", "qbd-ai-resultat-corps");
			ajouter(corps, "div", "qbd-ai-resultat-titre", r.titre);
			if (r.questions) ajouter(corps, "div", "qbd-ai-resultat-sous", t(r.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: r.questions }));
			bouton(carte, t("ai.queue.open"), () => opts.ouvrir(r.chemin));
			boutonIcone(carte, "x", t("ai.queue.close"), () => opts.file.fermer(l.id));
			return;
		}
		if (l.etat === "echouee") {
			host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), "alert-triangle");
			const corps = ajouter(rep, "div", "qbd-ai-reponse-corps");
			ajouter(corps, "div", "qbd-ai-reponse-erreur", l.erreur ?? "");
			const actions = ajouter(corps, "div", "qbd-ai-reponse-actions");
			if (l.echec === "enregistrement") {
				/* Le quiz est là, seule la note manque : on réécrit sans relancer le
				   modèle, ou on l'ouvre tel quel dans la page résultat. */
				bouton(actions, t("ai.queue.retrySave"), () => opts.file.reessayerEnregistrement(l.id));
				bouton(actions, t("ai.queue.openUnsaved"), () => opts.ouvrirSansEnregistrer(l));
			} else {
				bouton(actions, t("ai.error.retry"), () => opts.file.reessayer(l.id));
			}
			boutonIcone(ajouter(rep, "span", "qbd-ai-reponse-fin"), "x", t("ai.queue.close"), () => opts.file.fermer(l.id));
		}
	}

	/** Le conteneur qui défile (le fil de la page), s'il y en a un. */
	const defileur = (): HTMLElement | null => zone?.closest<HTMLElement>(".qbd-ai-fil") ?? null;

	function peindre(): void {
		if (!zone) return;
		/* La zone a quitté le document : la page n'est plus à l'écran. La vue
		   se retire d'elle-même ; le prochain rendu la réabonnera. */
		if (!zone.isConnected) { liberer(); return; }
		const fil = defileur();
		const enBas = !fil || fil.scrollHeight - fil.scrollTop - fil.clientHeight < 80;
		zone.replaceChildren();
		// L'état `arret` ne se montre pas : pour l'utilisateur, la ligne est annulée.
		const visibles = opts.file.lignes().filter(l => l.etat !== "arret");
		for (const l of visibles) {
			const tour = ajouter(zone, "div", "qbd-ai-tour");
			tour.setAttribute("role", "listitem");
			peindreMessage(tour, l);
			peindreReponse(tour, l);
		}
		/* Un tour NOUVEAU se lit à l'identifiant du dernier, pas au nombre de
		   tours : une réponse fermée pendant qu'une demande part laisse le
		   nombre inchangé. */
		const dernier = visibles.length ? visibles[visibles.length - 1].id : 0;
		const nouveau = dernier !== dernierPeint;
		dernierPeint = dernier;
		if (fil && (enBas || nouveau)) fil.scrollTop = fil.scrollHeight;
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
			dernierPeint = -1; // un rendu neuf de la page : on se cale en bas
			peindre();
		},
		liberer,
	};
}
