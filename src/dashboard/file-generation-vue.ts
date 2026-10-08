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
import { threadItems } from "./chat-thread";
import type { ChatRecord } from "./chat-record";
import { peindreEnAttente, peindrePieces, peindreProgressionDistante, peindreRelais, peindreTourEnregistre } from "./chat-record-vue";
import type { RelaisVue } from "./chat-record-vue";
import { getOwnRequests, getPeerConnected, getRemoteGenerations, onRemoteGenerations, refreshRemoteGenerations } from "./remote-generations";
import { pcReachable } from "./remote-send";
import { peindreQuestions } from "./generation-kind-vue";
import { onChatsChanged } from "./chat-session";
import type { EtapeGeneration, FileGenerationApp, LigneGeneration } from "./file-generation-app";
import type { TransKey } from "../i18n";
import { t } from "../i18n";
import { quizModeLabel } from "./quiz-card";
import type { Transcript } from "./transcript";
import { quizProgress } from "./transcript";
import { renderMarkdownPreview } from "../markdown-preview";
import { mathifyElement } from "../engine/mathjax";

export interface VueFile {
	/** Pose la zone des tours dans `parent` (à chaque rendu de la page). */
	rendre(parent: HTMLElement): void;
	/** Désabonne la vue et arrête l'horloge : la page se démonte. */
	liberer(): void;
	/** Repaints the thread (the page changed what `attente` returns). */
	repeindre(): void;
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
/** How often the Generate page re-reads the other devices' generations files while it is on screen. */
const REMOTE_EVERY_MS = 15_000;
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
	/** The chat on screen and its record (null until something is recorded). */
	chat: () => { id: string; record: ChatRecord | null };
	/** A request waiting for the kind of quiz to be decided (spec
	    2026-10-07-generate-auto-kind): shown last, with a status line. */
	attente?: () => { text: string; documents: { name: string; path?: string }[] } | null;
	/** The answers given to the clarifying cards (a recorded request, nothing live yet). */
	repondre?: (requestId: string, answers: string[][]) => void;
	/** May the pending card of this request still be answered (its state survived)? */
	reprenable?: (requestId: string) => boolean;
	/** The request shared to an AI app (phone relay) waiting for its answer, for the chat on screen; shown last. */
	relais?: () => RelaisVue | null;
}): VueFile {
	const host = currentHost();
	let zone: HTMLElement | null = null;
	let desabonner: (() => void) | null = null;
	let horloge: number | null = null;
	let desabonnerTranscript: (() => void) | null = null;
	/** The key of the last item painted; "" forces the return to the bottom. */
	let dernierPeint = "";
	let desabonnerChats: (() => void) | null = null;
	let desabonnerDistant: (() => void) | null = null;
	/** Re-reads the other devices' generations files while this page is on screen. */
	let relecture: number | null = null;

	const affichee = (): boolean => !!zone?.isConnected;

	function arreterHorloge(): void {
		if (horloge !== null) { window.clearInterval(horloge); horloge = null; }
	}

	function liberer(): void {
		desabonner?.();
		desabonner = null;
		desabonnerTranscript?.();
		desabonnerTranscript = null;
		desabonnerChats?.();
		desabonnerChats = null;
		desabonnerDistant?.();
		desabonnerDistant = null;
		if (relecture !== null) { window.clearInterval(relecture); relecture = null; }
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

	/** Where an "/exam" plan stands, under its request (2026-09-30): ONE
	    message, ONE answer — the plan; its quizzes do not stack up in the
	    conversation (the sidebar lists them). Only the quiz being made shows
	    here, "Quiz 2 of 5: Lists and tuples", with its working line, and a
	    quiz that failed, with its error and Try again. */
	function peindreAvancement(parent: HTMLElement, lot: string, lignes: readonly LigneGeneration[]): void {
		const etapes = lignes.filter(x => x.demande.preparation?.lot === lot && !x.demande.planifier);
		for (const l of etapes) {
			if (l.etat !== "cours" && l.etat !== "enregistrement" && l.etat !== "echouee") continue;
			const p = l.demande.preparation;
			const bloc = ajouter(parent, "div", "qbd-ai-avancement");
			ajouter(bloc, "div", "qbd-ai-avancement-titre", t("ai.exam.planProgress", { n: p?.etape ?? 0, total: p?.etapes ?? etapes.length, title: p?.titre ?? "" }));
			peindreReponse(bloc, l);
		}
	}

	/** Le message de l'utilisateur : vignettes, bulle, mode et modèle. */
	function peindreMessage(parent: HTMLElement, l: LigneGeneration, lignes: readonly LigneGeneration[] = [l]): void {
		const d = l.demande;
		const imgs = lignes.flatMap(x => x.demande.images);
		// Every document of the request, once (a send over several documents
		// can be several lines of the queue).
		const vus = new Set<string>();
		const notes = lignes.flatMap(x => x.demande.notes).filter(n => !vus.has(n.name) && !!vus.add(n.name));
		const message = ajouter(parent, "div", "qbd-ai-message");
		if (notes.length || imgs.length) {
			const pieces = ajouter(message, "div", "qbd-ai-message-pieces");
			for (const img of imgs) {
				const p = ajouter(pieces, "div", "qbd-ai-message-piece qbd-ai-message-piece--image");
				p.title = img.file.name;
				const el = ajouter(p, "img");
				el.src = urlImage(img.file);
				el.alt = img.file.name;
			}
			peindrePieces(pieces, notes);
		}
		if (d.text.trim()) ajouter(message, "div", "qbd-ai-bulle", d.text.trim());
		/* No "Learn · Opus 5.5" under the request any more (2026-09-30): the
		   working line and the result already name the model and the type. */
	}

	/* ── AN ANSWER IN PROSE, written instead of a quiz because the request
	   asked for none (`NoQuizAnswer`), as MonoCode shows one: a line with the
	   model and how long it worked, then the Markdown rendered by
	   `renderMarkdownPreview`, the only HTML it writes, every text through the
	   first gate of the sanitizer — then Copy. While the model writes, the line
	   is an ordinary generation: nobody knows yet whether a quiz comes. */
	function enProse(l: LigneGeneration): boolean {
		return l.etat === "prete" && l.resultat?.texte !== undefined;
	}

	function remplirProse(prose: HTMLElement, l: LigneGeneration): void {
		const texte = l.resultat?.texte ?? "";
		prose.innerHTML = renderMarkdownPreview(texte);
		// $…$ and $…$ are typeset after each repaint (the answer rewrites the HTML as it grows).
		if (texte.includes("$")) void mathifyElement(prose);
	}

	function peindreReponseProse(parent: HTMLElement, l: LigneGeneration): void {
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
		ajouter(tete, "span", undefined, t("ai.chat.worked", { model: nom, time: duree(l.resultat?.dureeMs ?? 0) }));
		const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
		remplirProse(prose, l);
		if (l.resultat?.texte) {
			const pied = ajouter(rep, "div", "qbd-ai-chat-pied");
			const texte = l.resultat.texte;
			if (opts.copier) {
				boutonIcone(pied, "copy", t("ai.chat.copy"), () => {
					void opts.copier?.(texte).then(ok => host.ui.notice(t(ok ? "ai.chat.copied" : "ai.chat.copyFailed")));
				});
			}
		}
	}

	/** La réponse, selon l'état de la ligne. */
	function peindreReponse(parent: HTMLElement, l: LigneGeneration): void {
		if (enProse(l)) {
			peindreReponseProse(parent, l);
			return;
		}
		const rep = ajouter(parent, "div", "qbd-ai-reponse qbd-ai-reponse--" + l.etat);
		if (l.etat === "cours" || l.etat === "enregistrement") {
			/* THE WORKING LINE, as MonoCode shows it (2026-09-30): the
			   provider's logo turning, then "Opus 5.5 working for 0:12" with a
			   light sweeping across. Reading a document and saving the note keep
			   their own words; the model's own work is named after the model. */
			const providerId = l.demande.reglages.aiProvider || "";
			const fournisseur = providerId ? aiProviders.getProvider(providerId) : null;
			const logo = ajouter(rep, "span", "qbd-ai-logo-travail");
			logo.setAttribute("aria-hidden", "true");
			if (fournisseur) aiProviders.setBrandLogo(ajouter(logo, "span", "qbd-provider-logo qbd-provider-logo--" + fournisseur.logo), fournisseur.logo);
			else host.ui.setIcon(logo, "sparkles");
			const etape = l.etat === "enregistrement" ? "enregistrement" : (opts.file.etape(l.id) ?? "preparation");
			const idModele = l.demande.reglages.aiModel || fournisseur?.defaultModel || "";
			const nomModele = fournisseur ? (idModele ? aiProviders.libelleModele(providerId, idModele) : fournisseur.name) : "";
			const texte = etape === "redaction" && nomModele ? t("ai.queue.working", { model: nomModele }) : t(TEXTE_ETAPE[etape]);
			ajouter(rep, "span", "qbd-ai-reponse-etape", texte);
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
			/* ONE PASS (2026-10-01): one card per quiz written, each with its own
			   Open; the close button sits on the last one. */
			const quiz = r.quiz && r.quiz.length > 0 ? r.quiz : [{ titre: r.titre, chemin: r.chemin, questions: r.questions ?? 0 }];
			quiz.forEach((q, i) => {
				const carte = ajouter(rep, "div", "qbd-ai-resultat");
				host.ui.setIcon(ajouter(carte, "span", "qbd-ai-resultat-icone"), "file-check-2");
				const corps = ajouter(carte, "div", "qbd-ai-resultat-corps");
				ajouter(corps, "div", "qbd-ai-resultat-titre", q.titre);
				if (q.questions) ajouter(corps, "div", "qbd-ai-resultat-sous", t(q.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: q.questions }));
				bouton(carte, t("ai.queue.open"), () => opts.ouvrir(q.chemin));
			});
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

	/** The lines a written answer may show before its section folds: about what
	    the box shows without scrolling (320 px). */
	const LIGNES_AVANT_REPLI = 15;
	/** Lines just unfolded by a click: their detail slides in once. */
	const ouvertures = new Set<string>();

	/** One summary line of a transcript block and, when unfolded, its detail:
	    created ONCE and then updated in place (see `remplirTranscript`). */
	interface LigneTranscript {
		bouton: HTMLElement;
		libelle: HTMLElement;
		chevron: HTMLElement;
		detail: HTMLElement | null;
		ouvert: boolean;
		chevronNom: string;
	}
	/** What a block shows now — read by the click handlers, never captured:
	    the transcript object, the live flag and the request change at every chunk. */
	interface BlocTranscript {
		lignes: Map<string, LigneTranscript>;
		tr: Transcript;
		vivant: boolean;
		ligne: LigneGeneration;
		prose: boolean;
	}
	const blocs = new WeakMap<HTMLElement, BlocTranscript>();

	/** "Question 12 of 20 · 214 lines" while a quiz is being written (null when
	    there is nothing to say: a plan, no question begun yet). */
	function libelleProgres(l: LigneGeneration, texte: string, lignes: number): string | null {
		if (l.demande.planifier) return null;
		const lot = !!l.demande.parDocument && l.demande.notes.length >= 2;
		const p = quizProgress(texte, { batch: lot });
		if (p.question === 0 && p.quiz === null) return null;
		const parts: string[] = [];
		if (p.quiz !== null) parts.push(t("ai.transcript.progressQuizOf", { n: p.quiz, total: l.demande.notes.length }));
		const total = l.demande.count;
		parts.push(total ? t("ai.transcript.progressQuestionOf", { n: p.question, total }) : t("ai.transcript.progressQuestion", { n: p.question }));
		parts.push(t(lignes === 1 ? "ai.transcript.progressLinesOne" : "ai.transcript.progressLinesOther", { count: lignes }));
		return parts.join(" · ");
	}

	/**
	 * Brings a transcript block up to date IN PLACE. It used to empty the block
	 * and rebuild every summary button at each chunk (several a second): the
	 * button pressed on mouse-down was gone by mouse-up, so the browser never
	 * fired `click` and the lines did nothing while the model was writing. Now
	 * each line's button exists once for the life of the block; a chunk only
	 * changes its label, its chevron and its detail's text.
	 */
	function remplirTranscript(bloc: HTMLElement, tr: Transcript, vivant: boolean, l: LigneGeneration, prose: boolean): void {
		let etat = blocs.get(bloc);
		if (!etat) { etat = { lignes: new Map(), tr, vivant, ligne: l, prose }; blocs.set(bloc, etat); }
		else { etat.tr = tr; etat.vivant = vivant; etat.ligne = l; etat.prose = prose; }
		synchroniserTranscript(bloc, etat);
	}

	interface SpecLigne {
		cle: string;
		icone: string;
		libelle: string;
		ouvertParDefaut: boolean;
		/** Fills (or refreshes) the detail box of an unfolded line. */
		detail: (corps: HTMLElement) => void;
	}

	function synchroniserTranscript(bloc: HTMLElement, etat: BlocTranscript): void {
		const { tr, vivant, ligne: l } = etat;
		const id = l.id;
		// A chat answer IS its text, shown as prose: only reasoning and tools here.
		const texte = etat.prose ? "" : tr.text;
		// The writing box as it is now, to keep following the end of the text.
		const ancien = etat.lignes.get("writing")?.detail?.querySelector<HTMLElement>(".qbd-ai-transcript-texte") ?? null;
		const hautAncien = ancien ? ancien.scrollTop : 0;
		const suivait = !ancien || ancien.scrollHeight - ancien.scrollTop - ancien.clientHeight < 24;

		const specs: SpecLigne[] = [];
		// Nothing said yet: the working line above already shows the model at work.
		if (tr.thinking || texte || tr.tools.length > 0) {
			const ecrit = !!texte;
			if (tr.thinking) {
				specs.push({
					cle: "thinking", icone: "brain", libelle: t(vivant && !ecrit ? "ai.transcript.thinkingLive" : "ai.transcript.thought"), ouvertParDefaut: vivant && !ecrit,
					// `textContent` (through `ajouter`): the model's text is never HTML here.
					detail: corps => {
						const el = (corps.firstElementChild as HTMLElement | null) ?? ajouter(corps, "div", "qbd-ai-transcript-reflexion");
						const v = tr.thinking.trim();
						if (el.textContent !== v) el.textContent = v;
					},
				});
			}
			if (tr.tools.length) {
				specs.push({
					cle: "tools", icone: "wrench", libelle: t(tr.tools.length === 1 ? "ai.transcript.toolsOne" : "ai.transcript.toolsOther", { count: tr.tools.length }), ouvertParDefaut: false,
					detail: corps => {
						if (corps.childElementCount === tr.tools.length) return;
						corps.replaceChildren();
						for (const nom of tr.tools) ajouter(corps, "div", "qbd-ai-transcript-outil", nom);
					},
				});
			}
			if (ecrit) {
				const lignes = texte.split("\n").length;
				/* The WRITING folds by itself past `LIGNES_AVANT_REPLI` lines (a
				   whole quiz in JSON5 buried the conversation); the heading keeps
				   counting while it is folded, and a click opens it for good. */
				const long = lignes > LIGNES_AVANT_REPLI;
				const progres = vivant ? libelleProgres(l, texte, lignes) : null;
				const libelle = !vivant
					? t(lignes === 1 ? "ai.transcript.wroteOne" : "ai.transcript.wroteOther", { count: lignes })
					: progres ?? (long ? t("ai.transcript.writingLiveCount", { count: lignes }) : t("ai.transcript.writingLive"));
				specs.push({
					cle: "writing", icone: "pen-line", libelle, ouvertParDefaut: !long,
					detail: corps => {
						let pre = corps.firstElementChild as HTMLElement | null;
						const premier = !pre;
						if (!pre) pre = ajouter(corps, "pre", "qbd-ai-transcript-texte");
						if (pre.textContent !== texte) pre.textContent = texte;
						// Follows the writing, unless the user scrolled up to read.
						pre.scrollTop = premier || suivait ? pre.scrollHeight : hautAncien;
					},
				});
			}
		}

		const gardees = new Set(specs.map(s => s.cle));
		for (const [cle, v] of etat.lignes) {
			if (gardees.has(cle)) continue;
			v.bouton.remove();
			v.detail?.remove();
			etat.lignes.delete(cle);
		}
		let rang = 0;
		for (const s of specs) {
			const k = id + ":" + s.cle;
			const ouvert = deplies.has(k) || (s.ouvertParDefaut && !replies.has(k));
			let v = etat.lignes.get(s.cle);
			if (!v) {
				const b = ajouter(bloc, "button", "qbd-ai-transcript-ligne");
				b.type = "button";
				host.ui.setIcon(ajouter(b, "span", "qbd-ai-transcript-titre-icone"), s.icone);
				const libelle = ajouter(b, "span", "qbd-ai-transcript-ligne-texte");
				const chevron = ajouter(b, "span", "qbd-ai-transcript-chevron");
				const neuve: LigneTranscript = { bouton: b, libelle, chevron, detail: null, ouvert, chevronNom: "" };
				v = neuve;
				etat.lignes.set(s.cle, neuve);
				// Reads the CURRENT state of the block: a click toggles what is shown now.
				b.addEventListener("click", () => {
					const courant = blocs.get(bloc);
					const ligneCourante = courant?.lignes.get(s.cle);
					if (!courant || !ligneCourante) return;
					if (ligneCourante.ouvert) { deplies.delete(k); replies.add(k); } else { deplies.add(k); replies.delete(k); ouvertures.add(k); }
					synchroniserTranscript(bloc, courant);
				});
			}
			if (v.libelle.textContent !== s.libelle) v.libelle.textContent = s.libelle;
			if (v.bouton.getAttribute("aria-expanded") !== String(ouvert)) v.bouton.setAttribute("aria-expanded", String(ouvert));
			const chevronNom = ouvert ? "chevron-down" : "chevron-right";
			if (v.chevronNom !== chevronNom) { host.ui.setIcon(v.chevron, chevronNom); v.chevronNom = chevronNom; }
			v.ouvert = ouvert;
			if (!ouvert && v.detail) { v.detail.remove(); v.detail = null; }
			if (ouvert && !v.detail) {
				/* The unfolding slides in only when a click opened it. */
				const anime = ouvertures.delete(k);
				v.detail = document.createElement("div");
				v.detail.className = "qbd-ai-transcript-detail" + (anime ? " qbd-ai-transcript-detail--anime" : "");
				v.bouton.after(v.detail);
			}
			if (v.detail) s.detail(v.detail);
			// Keep the DOM order (thinking, tools, writing) by moving only what is out of place.
			if (bloc.children[rang] !== v.bouton) bloc.insertBefore(v.bouton, bloc.children[rang] ?? null);
			rang++;
			if (v.detail) {
				if (bloc.children[rang] !== v.detail) bloc.insertBefore(v.detail, bloc.children[rang] ?? null);
				rang++;
			}
		}
	}

	function peindreTranscript(parent: HTMLElement, l: LigneGeneration): void {
		const tr = opts.file.transcript(l.id);
		// No transcript: a provider that answers in one piece (Ollama, Antigravity).
		if (!tr) return;
		const vivant = enCours(l);
		/* A chat answer IS its text, shown as prose: the transcript only adds
		   the reasoning and the tools, when the model shared any. */
		const prose = enProse(l);
		if (prose && !tr.thinking && tr.tools.length === 0) return;
		const bloc = ajouter(parent, "div", "qbd-ai-transcript");
		bloc.dataset.ligne = String(l.id);
		if (prose) bloc.dataset.chat = "1";
		bloc.setAttribute("role", "log");
		bloc.setAttribute("aria-label", t("ai.transcript.label"));
		remplirTranscript(bloc, tr, vivant, l, prose);
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
		const bloc = zone.querySelector<HTMLElement>(`.qbd-ai-transcript[data-ligne="${id}"]`);
		// First chunk of a run painted before its transcript existed: one repaint.
		if (!bloc) { if (enCours(l)) peindre(); return; }
		remplirTranscript(bloc, tr, enCours(l), l, enProse(l));
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
		const { id: chatId, record } = opts.chat();
		const remote = getRemoteGenerations();
		const items = threadItems(record, opts.file.lignes(), chatId, remote, Date.now(), getOwnRequests());
		for (const item of items) {
			if (item.kind === "pending") { peindreEnAttente(zone, item, pcReachable(item.target, remote, Date.now(), getPeerConnected())); continue; }
			if (item.kind === "remote") { peindreProgressionDistante(zone, item.entry, item.stale); continue; }
			if (item.kind === "record") { peindreTourEnregistre(zone, item.request, { ouvrir: opts.ouvrir, copier: opts.copier, repondre: opts.repondre, reprenable: opts.reprenable }); continue; }
			// The `arret` state is not shown (for the user the line is cancelled); the
			// quizzes of a plan live in the sidebar, not in the conversation.
			const lignes = item.lines.filter(l => l.etat !== "arret");
			const montrees = lignes.filter(l => !(l.demande.preparation?.lot && !l.demande.planifier));
			if (montrees.length === 0) continue;
			// ONE bubble per request, whatever the number of lines it made.
			const tour = ajouter(zone, "div", "qbd-ai-tour");
			tour.setAttribute("role", "listitem");
			peindreMessage(tour, montrees[0], lignes);
			// The question that was asked before this request generated stays under it, answered.
			const clarify = record?.requests.find(q => q.id === item.key)?.clarify;
			if (clarify) peindreQuestions(tour, clarify, undefined, item.key);
			for (const l of montrees) {
				/* As MonoCode: while the model works, its status line then its
				   activity; once done, the activity summary then the answer. */
				if (l.etat === "cours" || l.etat === "enregistrement") { peindreReponse(tour, l); peindreTranscript(tour, l); }
				else { peindreTranscript(tour, l); peindreReponse(tour, l); }
			}
			const lot = montrees[0].demande.preparation?.lot;
			if (lot) peindreAvancement(tour, lot, lignes);
		}
		const attente = opts.attente?.() ?? null;
		if (attente) {
			const tour = ajouter(zone, "div", "qbd-ai-tour");
			tour.setAttribute("role", "listitem");
			tour.dataset.attente = "1";
			const message = ajouter(tour, "div", "qbd-ai-message");
			if (attente.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), attente.documents);
			if (attente.text.trim()) ajouter(message, "div", "qbd-ai-bulle", attente.text.trim());
			const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--cours");
			const logo = ajouter(rep, "span", "qbd-ai-logo-travail");
			logo.setAttribute("aria-hidden", "true");
			host.ui.setIcon(logo, "sparkles");
			ajouter(rep, "span", "qbd-ai-reponse-etape", t("ai.clarify.deciding"));
		}
		const relais = opts.relais?.() ?? null;
		if (relais) peindreRelais(zone, relais);
		/* A NEW item is read from the key of the last one, not from the count: a
		   reply closed while a request goes out leaves the count unchanged. */
		const dernier = relais ? "relais" : attente ? "waiting" : items.length ? items[items.length - 1].key : "";
		const nouveau = dernier !== dernierPeint;
		dernierPeint = dernier;
		if (fil && (enBas || nouveau)) fil.scrollTop = fil.scrollHeight;
		const visibles = items.flatMap(i => (i.kind === "live" ? i.lines.filter(l => l.etat !== "arret") : []));
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
			if (!desabonnerChats) desabonnerChats = onChatsChanged(peindre);
			if (!desabonnerDistant) desabonnerDistant = onRemoteGenerations(peindre);
			if (relecture === null) relecture = window.setInterval(() => {
				if (!zone?.isConnected) { liberer(); return; }
				void refreshRemoteGenerations();
			}, REMOTE_EVERY_MS);
			void refreshRemoteGenerations();
			dernierPeint = ""; // un rendu neuf de la page : on se cale en bas
			peindre();
		},
		liberer,
		repeindre: peindre,
	};
}
