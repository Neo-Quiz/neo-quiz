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
import { quizModeLabel } from "./quiz-card";
import type { Transcript } from "./transcript";
import { renderMarkdownPreview } from "../markdown-preview";

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
	/** Copies a chat answer (the host's clipboard). */
	copier?: (texte: string) => Promise<boolean>;
}): VueFile {
	const host = currentHost();
	let zone: HTMLElement | null = null;
	let desabonner: (() => void) | null = null;
	let horloge: number | null = null;
	let desabonnerTranscript: (() => void) | null = null;
	/** L'identifiant du dernier tour peint ; -1 force le retour en bas. */
	let dernierPeint = -1;

	const affichee = (): boolean => !!zone?.isConnected;

	function arreterHorloge(): void {
		if (horloge !== null) { window.clearInterval(horloge); horloge = null; }
	}

	function liberer(): void {
		desabonner?.();
		desabonner = null;
		desabonnerTranscript?.();
		desabonnerTranscript = null;
		arreterHorloge();
		zone = null;
	}

	/** Un bouton-icône, nommé pour le lecteur d'écran. */
	function boutonIcone(parent: HTMLElement, icone: string, libelle: string, action: () => void): void {
		const b = ajouter(parent, "button", "qbd-ai-file-btn");
		b.type = "button";
		host.ui.setIcon(b, icone);
		b.setAttribute("aria-label", libelle);
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
		ajouter(meta, "span", undefined, d.mode === "chat" ? t("ai.chat.label") : quizModeLabel(d.mode));
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

	/* ── A CHAT ANSWER (2026-09-29), as MonoCode shows one: a line with the
	   model and how long it worked, then the answer as PROSE — Markdown
	   rendered by `renderMarkdownPreview`, the only HTML it writes, every
	   text through the first gate of the sanitizer — then Copy. While the
	   model writes, the same prose grows in place (`surTranscript`). */
	function textePourProse(l: LigneGeneration): string {
		return enCours(l) ? (opts.file.transcript(l.id)?.text ?? "") : (l.resultat?.texte ?? "");
	}

	function remplirProse(prose: HTMLElement, l: LigneGeneration): void {
		const texte = textePourProse(l);
		if (!texte.trim()) {
			prose.replaceChildren();
			ajouter(prose, "span", "qbd-ai-chat-attente", t("ai.chat.thinking"));
			return;
		}
		prose.innerHTML = renderMarkdownPreview(texte);
	}

	function peindreReponseChat(parent: HTMLElement, l: LigneGeneration): void {
		const rep = ajouter(parent, "div", "qbd-ai-chat-reponse");
		const tete = ajouter(rep, "div", "qbd-ai-chat-tete");
		const providerId = l.demande.reglages.aiProvider || "";
		const p = providerId ? aiProviders.getProvider(providerId) : null;
		if (p) {
			const logo = ajouter(tete, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
			aiProviders.setBrandLogo(logo, p.logo);
		}
		const id = l.demande.reglages.aiModel || p?.defaultModel || "";
		const nom = p ? (id ? aiProviders.libelleModele(providerId, id) : p.name) : "";
		if (enCours(l)) {
			ajouter(tete, "span", undefined, t("ai.chat.working", { model: nom }));
			const temps = ajouter(tete, "span", "qbd-ai-file-temps", duree(Date.now() - (l.debut ?? Date.now())));
			temps.dataset.debut = String(l.debut ?? Date.now());
			temps.setAttribute("aria-hidden", "true");
		} else {
			ajouter(tete, "span", undefined, t("ai.chat.worked", { model: nom, time: duree(l.resultat?.dureeMs ?? 0) }));
		}
		const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
		prose.dataset.ligne = String(l.id);
		remplirProse(prose, l);
		if (!enCours(l) && l.resultat?.texte) {
			const pied = ajouter(rep, "div", "qbd-ai-chat-pied");
			const texte = l.resultat.texte;
			if (opts.copier) {
				boutonIcone(pied, "copy", t("ai.chat.copy"), () => {
					void opts.copier?.(texte).then(ok => host.ui.notice(t(ok ? "ai.chat.copied" : "ai.chat.copyFailed")));
				});
			}
			boutonIcone(pied, "x", t("ai.queue.close"), () => opts.file.fermer(l.id));
		}
	}

	/** La réponse, selon l'état de la ligne. */
	function peindreReponse(parent: HTMLElement, l: LigneGeneration): void {
		if (l.demande.mode === "chat" && (enCours(l) || (l.etat === "prete" && l.resultat?.texte !== undefined))) {
			peindreReponseChat(parent, l);
			return;
		}
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
				/* Pas de ■ sur la ligne en cours (Ahmed, 2026-09-27) : l'arrêt
				   est celui du composer, comme sur claude.ai. */
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

	/* ── THE LIVE TRANSCRIPT (2026-09-29), as MonoCode shows an agent's work ──
	   Under each request, one SUMMARY LINE per kind of work — "Thought",
	   "Used 2 tools", "Wrote the quiz · 214 lines" — muted, with a chevron;
	   a click unfolds it and shows every detail, a second click folds it.
	   While the model writes, the writing line is unfolded and follows the
	   text; once done it folds back into its summary. Updated IN PLACE on
	   each chunk (`abonnerTranscript`), never by repainting the queue. */
	const enCours = (l: LigneGeneration): boolean => l.etat === "cours" || l.etat === "enregistrement";
	/** The lines the user unfolded, and the live ones they folded: `id:kind`. */
	const deplies = new Set<string>();
	const replies = new Set<string>();

	function remplirTranscript(bloc: HTMLElement, tr: Transcript, vivant: boolean, id: number): void {
		const ancien = bloc.querySelector<HTMLElement>(".qbd-ai-transcript-texte");
		const hautAncien = ancien ? ancien.scrollTop : 0;
		const suivait = !ancien || ancien.scrollHeight - ancien.scrollTop - ancien.clientHeight < 24;
		bloc.replaceChildren();
		if (!tr.thinking && !tr.text && tr.tools.length === 0) {
			if (vivant) ajouter(bloc, "div", "qbd-ai-transcript-attente", t("ai.transcript.waiting"));
			return;
		}
		/** A summary line and, when unfolded, its detail. Live lines start
		    unfolded for the part being written. */
		const ligne = (cle: string, icone: string, libelle: string, ouvertParDefaut: boolean, detail: (corps: HTMLElement) => void): void => {
			const k = id + ":" + cle;
			const ouvert = deplies.has(k) || (ouvertParDefaut && !replies.has(k));
			const b = ajouter(bloc, "button", "qbd-ai-transcript-ligne");
			b.type = "button";
			b.setAttribute("aria-expanded", String(ouvert));
			host.ui.setIcon(ajouter(b, "span", "qbd-ai-transcript-titre-icone"), icone);
			ajouter(b, "span", "qbd-ai-transcript-ligne-texte", libelle);
			host.ui.setIcon(ajouter(b, "span", "qbd-ai-transcript-chevron"), ouvert ? "chevron-down" : "chevron-right");
			b.addEventListener("click", () => {
				if (ouvert) { deplies.delete(k); replies.add(k); } else { deplies.add(k); replies.delete(k); }
				remplirTranscript(bloc, tr, vivant, id);
			});
			if (ouvert) detail(ajouter(bloc, "div", "qbd-ai-transcript-detail"));
		};
		const ecrit = !!tr.text;
		if (tr.thinking) {
			ligne("thinking", "brain", t(vivant && !ecrit ? "ai.transcript.thinkingLive" : "ai.transcript.thought"), vivant && !ecrit, corps => {
				// `textContent` (through `ajouter`): the model's text is never HTML here.
				ajouter(corps, "div", "qbd-ai-transcript-reflexion", tr.thinking.trim());
			});
		}
		if (tr.tools.length) {
			ligne("tools", "wrench", t(tr.tools.length === 1 ? "ai.transcript.toolsOne" : "ai.transcript.toolsOther", { count: tr.tools.length }), false, corps => {
				for (const nom of tr.tools) ajouter(corps, "div", "qbd-ai-transcript-outil", nom);
			});
		}
		if (ecrit) {
			const lignes = tr.text.split("\n").length;
			/* The WRITING is never folded (only the activity is, as
			   MonoCode's "Ran 11 commands"): its heading, then the text. */
			const titre = ajouter(bloc, "div", "qbd-ai-transcript-titre");
			host.ui.setIcon(ajouter(titre, "span", "qbd-ai-transcript-titre-icone"), "pen-line");
			ajouter(titre, "span", undefined, vivant ? t("ai.transcript.writingLive") : t(lignes === 1 ? "ai.transcript.wroteOne" : "ai.transcript.wroteOther", { count: lignes }));
			const texte = ajouter(bloc, "pre", "qbd-ai-transcript-texte", tr.text);
			// Follows the writing, unless the user scrolled up to read.
			texte.scrollTop = suivait ? texte.scrollHeight : hautAncien;
		}
	}

	function peindreTranscript(parent: HTMLElement, l: LigneGeneration): void {
		const tr = opts.file.transcript(l.id);
		// No transcript: a provider that answers in one piece (Ollama, Antigravity).
		if (!tr) return;
		const vivant = enCours(l);
		/* A chat answer IS its text, shown as prose: the transcript only adds
		   the reasoning and the tools, when the model shared any. */
		if (l.demande.mode === "chat" && !tr.thinking && tr.tools.length === 0) return;
		const bloc = ajouter(parent, "div", "qbd-ai-transcript");
		bloc.dataset.ligne = String(l.id);
		if (l.demande.mode === "chat") bloc.dataset.chat = "1";
		bloc.setAttribute("role", "log");
		bloc.setAttribute("aria-label", t("ai.transcript.label"));
		remplirTranscript(bloc, l.demande.mode === "chat" ? { ...tr, text: "" } : tr, vivant, l.id);
	}

	/** Follows the end of the conversation smoothly, as MonoCode does while
	    an agent writes — only when the user was already at the bottom. */
	function suivre(fil: HTMLElement | null, etaitEnBas: boolean): void {
		if (fil && etaitEnBas) fil.scrollTo({ top: fil.scrollHeight, behavior: "smooth" });
	}

	function surTranscript(id: number): void {
		if (!zone?.isConnected) return;
		const l = opts.file.lignes().find(x => x.id === id);
		const tr = opts.file.transcript(id);
		if (!l || !tr) return;
		const fil = defileur();
		const enBas = !fil || fil.scrollHeight - fil.scrollTop - fil.clientHeight < 120;
		const prose = zone.querySelector<HTMLElement>(`.qbd-ai-chat-prose[data-ligne="${id}"]`);
		if (prose && enCours(l)) {
			remplirProse(prose, l);
			const blocChat = zone.querySelector<HTMLElement>(`.qbd-ai-transcript[data-ligne="${id}"]`);
			if (blocChat) remplirTranscript(blocChat, { ...tr, text: "" }, true, id);
			else if (tr.thinking || tr.tools.length) { peindre(); return; }
			suivre(fil, enBas);
			return;
		}
		const bloc = zone.querySelector<HTMLElement>(`.qbd-ai-transcript[data-ligne="${id}"]`);
		// First chunk of a run painted before its transcript existed: one repaint.
		if (!bloc) { if (enCours(l)) peindre(); return; }
		remplirTranscript(bloc, tr, enCours(l), id);
		suivre(fil, enBas);
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
		// Always full width (2026-09-30): no chat layout any more.
		zone.classList.add("qbd-ai-file--full");
		// L'état `arret` ne se montre pas : pour l'utilisateur, la ligne est annulée.
		const visibles = opts.file.lignes().filter(l => l.etat !== "arret");
		for (const l of visibles) {
			const tour = ajouter(zone, "div", "qbd-ai-tour");
			tour.setAttribute("role", "listitem");
			peindreMessage(tour, l);
			/* As MonoCode: while the model works, its status line then its
			   activity; once done, the activity summary then the answer. */
			if (l.etat === "cours" || l.etat === "enregistrement") { peindreReponse(tour, l); peindreTranscript(tour, l); }
			else { peindreTranscript(tour, l); peindreReponse(tour, l); }
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
			/* "Back to the latest" (MonoCode's round chevron above the
			   composer): shown once the user scrolled up from the bottom of
			   the conversation, it glides back down. */
			const bas = ajouter(parent, "button", "qbd-ai-fil-bas");
			bas.type = "button";
			bas.setAttribute("aria-label", t("ai.transcript.toLatest"));
			host.ui.setIcon(bas, "chevron-down");
			bas.hidden = true;
			bas.addEventListener("click", () => parent.scrollTo({ top: parent.scrollHeight, behavior: "smooth" }));
			const majBas = (): void => { bas.hidden = parent.scrollHeight - parent.scrollTop - parent.clientHeight < 120; };
			parent.addEventListener("scroll", majBas, { passive: true });
			new ResizeObserver(majBas).observe(zone);
			zone.setAttribute("role", "list");
			zone.setAttribute("aria-label", t("ai.queue.label"));
			zone.setAttribute("aria-live", "polite");
			if (!desabonner) desabonner = opts.file.abonner(peindre, affichee);
			if (!desabonnerTranscript) desabonnerTranscript = opts.file.abonnerTranscript(surTranscript);
			dernierPeint = -1; // un rendu neuf de la page : on se cale en bas
			peindre();
		},
		liberer,
	};
}
