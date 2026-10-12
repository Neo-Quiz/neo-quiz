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

import type { ModuleInfo } from "./quiz-modules";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import * as aiProviders from "./ai-providers";
import { threadItems } from "./chat-thread";
import type { ChatRecord } from "./chat-record";
import { compterJetons, peindreEnAttente, peindrePieces, peindreProgressionDistante, peindreRelais, peindreTourEnregistre } from "./chat-record-vue";
import type { RelaisVue } from "./chat-record-vue";
import { peindreOrigine, refsOf } from "./request-origin-vue";
import { peindreCarteQuiz } from "./result-card";
import { libelleLectures } from "./question-count";
import { chatDevice } from "./chat-session";
import { getOwnRequests, getPeerConnected, getRemoteGenerations, onRemoteGenerations, refreshRemoteGenerations } from "./remote-generations";
import { pcReachable } from "./remote-send";
import { peindreQuestions } from "./generation-kind-vue";
import { onChatsChanged } from "./chat-session";
import type { EtapeGeneration, FileGenerationApp, LigneGeneration } from "./file-generation-app";
import type { TransKey } from "../i18n";
import { currentLang, t } from "../i18n";
import { formatResume } from "./usage-limit";
import { quizModeLabel } from "./quiz-card";
import type { ToolStep, Transcript } from "./transcript";
import { resumeTravail } from "./transcript";
import { modeleDiffere, quizProgress, tempsRestant } from "./transcript";
import { renderMarkdownPreview } from "../markdown-preview";
import { renderThread, threadHasLiveRow } from "./work-view";
import type { LiveTurnView } from "./live-generation";
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

/** How long each word of the working line stays (`ai.queue.verbs`). */
const MOT_MS = 4000;

/** The rotating word of the working line: it follows the elapsed time, so
    every repaint and the clock's tick agree on it without any state. */
function verbeCourant(ecoule: number): string {
	const mots = t("ai.queue.verbs").split("|").map(m => m.trim()).filter(Boolean);
	return mots.length ? mots[Math.floor(Math.max(0, ecoule) / MOT_MS) % mots.length] : "";
}

/** "Opus 5.5 · Weighing the options…" (a line with no transcript to show). */
function texteTravail(modele: string, ecoule: number): string {
	return t("ai.queue.workingVerb", { model: modele, verb: verbeCourant(ecoule) });
}

/** The full name of the model the request SELECTED, resolved as the chat header
    does; the provider's name when no model resolves, "" with no provider. */
function nomModeleSelectionne(l: LigneGeneration): string {
	const providerId = l.demande.reglages.aiProvider || "";
	const fournisseur = providerId ? aiProviders.getProvider(providerId) : null;
	if (!fournisseur) return "";
	const id = l.demande.reglages.aiModel || fournisseur.defaultModel || "";
	return id ? aiProviders.libelleModele(providerId, id) : fournisseur.name;
}

/** The work line's icon: the provider's brand logo (Claude, Codex...),
    as the chat header shows it; sparkles when the request names no provider. */
function iconeFournisseur(l: LigneGeneration): string {
	const p = l.demande.reglages.aiProvider ? aiProviders.getProvider(l.demande.reglages.aiProvider) : null;
	return p ? "logo:" + p.logo : "sparkles";
}

/** Paints an icon name on the work line: "logo:<id>" is a provider's brand
    logo, anything else a Lucide icon. */
function poserIcone(el: HTMLElement, nom: string): void {
	el.replaceChildren();
	el.className = "qbd-ai-transcript-titre-icone";
	if (nom.startsWith("logo:")) {
		const logo = nom.slice(5) as Parameters<typeof aiProviders.setBrandLogo>[1];
		el.classList.add("qbd-provider-logo", "qbd-provider-logo--" + logo);
		aiProviders.setBrandLogo(el, logo);
	} else currentHost().ui.setIcon(el, nom);
}

/** The folded summary of a finished turn: "Opus 5.5 worked for 0:50". */
function libelleFini(nom: string, ms: number | undefined): string {
	if (ms === undefined) return nom ? t("ai.chat.workedNoTime", { model: nom }) : t("ai.work.worked");
	return nom ? t("ai.chat.worked", { model: nom, time: duree(ms) }) : t("ai.work.workedFor", { time: duree(ms) });
}

/** The model the CLI answered with, when its safeguards switched it off the
    one the request selected (Claude Code only): its label, else null. Both
    sides are labels (`libelleModele`), so the alias `opus` is compared with
    the version it stands for. A sub-agent's model never gets here
    (transcript.ts). */
function modeleRepli(l: LigneGeneration, tr: Transcript | null | undefined): string | null {
	if (!tr?.effectiveModel || l.demande.reglages.aiProvider !== "claude-code") return null;
	const effectif = aiProviders.libelleModele("claude-code", tr.effectiveModel);
	return modeleDiffere(nomModeleSelectionne(l), effectif) ? effectif : null;
}

/** The summary of a running turn: "Opus 5.5 · Weighing the options… 0:12". */
function libelleEnCours(nom: string, activite: string, ecoule: number): string {
	return nom
		? t("ai.work.workingLine", { model: nom, activity: activite, time: duree(ecoule) })
		: t("ai.work.workingNoModel", { activity: activite, time: duree(ecoule) });
}

/** The activity next to the working line: the reasoning's size, while no
    reasoning text is shown (a model that shares it has its own line). */
function texteActivite(tr: Transcript | null | undefined): string {
	if (!tr) return "";
	/* What it read, then how long it has reasoned: a twelve-minute wait over
	   "~180k tokens read" explains itself. Once the answer is being written,
	   the reasoning's size moves to the transcript's own line. */
	const parts: string[] = [];
	if (tr.inputTokens > 0) parts.push(t("ai.queue.inputTokens", { count: compterJetons(tr.inputTokens) }));
	if (!tr.text && !tr.thinking && tr.thinkingTokens > 0) parts.push(t("ai.queue.thinkingTokens", { count: compterJetons(tr.thinkingTokens) }));
	return parts.join(" · ");
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
	/** The folder of a quiz note (its icon and colour, from the module map). Absent: the defaults. */
	dossierDe?: (chemin: string) => Promise<ModuleInfo | null>;
	/** Opens the preview of a document chip of a sent message (no attach). */
	ouvrirPiece?: (n: { name: string; path?: string }) => void;
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
	/** The absolute Neo Quiz root, for the work view's relative paths (null when unknown). */
	racine?: () => string | null;
	/** Opens a file of the work view with its app (only inside the root). */
	ouvrirFichier?: (absolu: string) => void;
}): VueFile {
	const host = currentHost();
	let zone: HTMLElement | null = null;
	let desabonner: (() => void) | null = null;
	let horloge: number | null = null;
	let desabonnerTranscript: (() => void) | null = null;
	/** The key of the last item painted; "" forces the return to the bottom. */
	let dernierPeint = "";
	/* The "scroll to bottom" button and whether a generation runs in the shown chat. */
	let boutonBas: HTMLElement | null = null;
	let travaille = false;
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
			peindrePieces(pieces, notes, opts.ouvrirPiece);
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
		/* A running turn with a transcript has ONE line, the work summary
		   `peindreTranscript` paints under it (model, activity, time): no second
		   status line above it (2026-10-12). Without a transcript (a provider
		   that answers in one piece) the status line below stays alone. */
		if (l.etat === "cours" && opts.file.transcript(l.id) && opts.file.live(l.id)) return;
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
			const debut = l.debut ?? Date.now();
			const travail = etape === "redaction" && !!nomModele;
			const texte = travail ? texteTravail(nomModele, Date.now() - debut) : t(TEXTE_ETAPE[etape]);
			const etiquette = ajouter(rep, "span", "qbd-ai-reponse-etape", texte);
			if (travail && l.etat === "cours") { etiquette.dataset.modele = nomModele; etiquette.dataset.debut = String(debut); }
			/* What the model has done so far, updated with each chunk
			   (`surTranscript`): its reasoning's size while its text stays
			   private. Empty until the CLI says anything. */
			if (l.etat === "cours") {
				const activite = ajouter(rep, "span", "qbd-ai-reponse-activite");
				activite.dataset.ligne = String(l.id);
				activite.textContent = texteActivite(opts.file.transcript(l.id));
			}
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
		if (l.etat === "pause") {
			/* PAUSED ON A USAGE LIMIT: the clock resumes it (reset time + 30 s),
			   the user can resume now or cancel the resume. */
			host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), "pause");
			const corps = ajouter(rep, "div", "qbd-ai-reponse-corps");
			const reprise = l.pause?.reprise ?? null;
			ajouter(corps, "div", "qbd-ai-reponse-texte", reprise !== null ? t("ai.queue.limitPaused", { when: formatResume(reprise, Date.now(), currentLang()) }) : t("ai.queue.limitPausedManual"));
			const actions = ajouter(corps, "div", "qbd-ai-reponse-actions");
			bouton(actions, t("ai.queue.limitResumeNow"), () => opts.file.reprendre(l.id));
			bouton(actions, t("ai.queue.limitCancelResume"), () => opts.file.annulerReprise(l.id));
			return;
		}
		if (l.etat === "prete" && l.resultat) {
			/* La carte du quiz : c'est un CONTENU, elle a donc sa tuile, et la
			   carte entière est le bouton (result-card.ts). */
			const r = l.resultat;
			/* ONE PASS (2026-10-01): one card per quiz written, each with its own
			   Open; the close button sits on the last one. */
			const quiz = r.quiz && r.quiz.length > 0 ? r.quiz : [{ titre: r.titre, chemin: r.chemin, questions: r.questions ?? 0, readings: r.readings ?? 0, mode: r.mode }];
			for (const q of quiz) peindreCarteQuiz(rep, { titre: q.titre, chemin: q.chemin, comptes: { questions: q.questions, readings: q.readings ?? 0 }, mode: q.mode }, () => opts.ouvrir(q.chemin), opts.dossierDe);
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
		icone: HTMLElement;
		iconeNom: string;
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
		/** The Retry under a flagged work line; null while there is none. */
		relance: HTMLElement | null;
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
		if (p.readings > 0) parts.push(libelleLectures(p.readings));
		parts.push(t(lignes === 1 ? "ai.transcript.progressLinesOne" : "ai.transcript.progressLinesOther", { count: lignes }));
		/* The time left, from the pace of the questions already written (one
		   pass over several documents has no single total: none shown). */
		const tr = opts.file.transcript(l.id);
		const reste = p.quiz === null ? tempsRestant(p.question, total, tr?.writingSince, Date.now()) : null;
		if (reste !== null) parts.push(reste < 60_000 ? t("ai.transcript.etaUnderMinute") : t("ai.transcript.etaMinutes", { n: Math.round(reste / 60_000) }));
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
		if (!etat) { etat = { lignes: new Map(), relance: null, tr, vivant, ligne: l, prose }; blocs.set(bloc, etat); }
		else { etat.tr = tr; etat.vivant = vivant; etat.ligne = l; etat.prose = prose; }
		synchroniserTranscript(bloc, etat);
	}

	interface SpecLigne {
		cle: string;
		icone: string;
		libelle: string;
		/** The work line of a turn answered by another model than the one selected. */
		alerte?: boolean;
		/** A running turn's summary: the clock re-writes it each second from these. */
		chrono?: { modele: string; activite: string; debut: number };
		ouvertParDefaut: boolean;
		/** Fills (or refreshes) the detail box of an unfolded line. */
		detail: (corps: HTMLElement) => void;
	}

	/** The heading of the tools, summed up by kind, as MonoCode titles it
	    ("Explored the project · Ran 6 tools", "Ran a command · Edited SKILL.md"). */
	function resumeOutils(tr: Transcript): { libelle: string; icone: string } {
		const r = resumeTravail(tr.tools, tr.toolsHidden);
		const refusees = tr.tools.filter(s => s.status === "refused").length;
		const parts: string[] = [];
		if (r.explore) parts.push(t("ai.transcript.explored"));
		if (r.commandes) parts.push(t(r.commandes === 1 ? "ai.transcript.ranCommandOne" : "ai.transcript.ranCommandOther", { count: r.commandes }));
		if (r.modifs) parts.push(r.fichier ? t("ai.transcript.editedOne", { name: r.fichier }) : t("ai.transcript.editedOther", { count: r.modifs }));
		if (r.autres || (r.explore && !r.commandes && !r.modifs)) parts.push(t(r.total === 1 ? "ai.transcript.ranToolsOne" : "ai.transcript.ranToolsOther", { count: r.total }));
		const libelle = parts.join(" · ")
			+ (refusees ? t(refusees === 1 ? "ai.transcript.workRefusedOne" : "ai.transcript.workRefusedOther", { count: refusees }) : "");
		return { libelle, icone: r.modifs ? "pencil" : r.commandes ? "terminal" : "wrench" };
	}

	/** What a running turn is doing now, for its summary line: its tools summed
	    up, else the writing or the thinking, else the rotating word. */
	function activiteEnCours(l: LigneGeneration, tr: Transcript, lignes: number): string {
		if (tr.tools.length) return resumeOutils(tr).libelle;
		if (tr.text) return libelleProgres(l, tr.text, lignes) ?? t("ai.transcript.writingLive");
		if (tr.thinking) return t("ai.transcript.thinkingLive");
		return verbeCourant(Date.now() - (l.debut ?? Date.now()));
	}

	/** A LIVE turn (2026-10-11): ONE summary line — the tools summed up, or
	    what the model is doing — and under it the FULL work, in order
	    (`work-view.ts`: every message, tool call with its whole input, output
	    previews with "Show all", diffs, permission cards). Folded from the start,
	    whether the turn runs or not: a click opens it. The quiz text
	    the model writes is summarised ("Wrote the quiz · 214 lines"), never shown
	    raw (`summarizeText` in work-view.ts). */
	function specTravail(l: LigneGeneration, tr: Transcript, vue: LiveTurnView | null, vivant: boolean): SpecLigne {
		/* ONE line per turn, MonoCode style (2026-10-12): "Opus 5.5 worked for
		   0:50" folded, "Opus 5.5 · Weighing the options… 0:12" while it runs. What
		   the turn did (its summary, then every step) is written under it. */
		const nom = nomModeleSelectionne(l);
		const debut = l.debut ?? Date.now();
		const lignes = tr.text ? tr.text.split("\n").length : 0;
		const activite = vivant ? activiteEnCours(l, tr, lignes) : "";
		/* A turn the safeguards answered with ANOTHER model (2026-10-12): the
		   finished line says so in orange, with Retry under it (synchroniserTranscript). */
		const repli = vivant ? null : modeleRepli(l, tr);
		const libelle = repli
			? t("ai.safeguard.flagged", { requested: nom, effective: repli })
			: vivant ? libelleEnCours(nom, activite, Date.now() - debut) : libelleFini(nom, l.resultat?.dureeMs);
		const enAttente = !!vue && vue.thread.items.some(i => i.kind === "permission" && i.state === "pending");
		return {
			cle: "work", icone: repli ? "alert-triangle" : iconeFournisseur(l), libelle, alerte: !!repli,
			chrono: vivant ? { modele: nom, activite, debut } : undefined,
			// Folded from the start, even while the turn runs: a click opens it. A pending
				// permission is the one exception: the turn waits for it, so it must show.
			ouvertParDefaut: enAttente,
			detail: corps => {
				/* The summary under the folded line, as MonoCode writes it ("Explored
				   the project · Ran a tool"), then the input the model read. */
				const resume = [tr.tools.length ? resumeOutils(tr).libelle : "", vivant ? texteActivite(tr) : ""].filter(Boolean).join(" · ");
				let entete = corps.querySelector<HTMLElement>(":scope > .qbd-ai-transcript-resume");
				if (!resume) entete?.remove();
				else {
					if (!entete) { entete = document.createElement("div"); entete.className = "qbd-ai-transcript-resume"; corps.prepend(entete); }
					if (entete.textContent !== resume) entete.textContent = resume;
				}
				if (!vue) return;
				let racine = corps.querySelector<HTMLElement>(":scope > .qbd-work");
				if (!racine) racine = ajouter(corps, "div", "qbd-work");
				renderThread(racine, vue.thread, {
					loadOutput: toolId => opts.file.sortieOutil(l.id, toolId),
					answer: (requestId, allow) => opts.file.repondreVivant(l.id, requestId, allow),
					root: opts.racine?.() ?? undefined,
					openFile: opts.ouvrirFichier,
				});
				// Only while no row of the thread is live: a live row carries its own spinner.
				const busy = vue.thread.running && !threadHasLiveRow(vue.thread);
				let marche = corps.querySelector<HTMLElement>(":scope > .qbd-work-running");
				if (busy && !marche) {
					marche = ajouter(corps, "div", "qbd-work-running");
					const dot = ajouter(marche, "span", "qbd-work-dot is-running");
					dot.setAttribute("role", "img");
					dot.setAttribute("aria-label", t("ai.work.dotRunning"));
					ajouter(marche, "span", undefined, t("ai.work.running"));
				} else if (!busy && marche) marche.remove();
			},
		};
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
		const vue = opts.file.live(id);
		if (vue) {
			if (vivant || vue.thread.items.length) specs.push(specTravail(l, tr, vue, vivant));
		} else if (tr.thinking || texte || tr.tools.length > 0 || (tr.thinkingTokens > 0 && !vivant)) {
			// Nothing said yet: the working line above already shows the model at work.
			const ecrit = !!texte;
			/* PRIVATE reasoning (Claude Code with Opus 5.5 sends its size, not
			   its text): one line with the size, and a click says why there is
			   no text. While the model still only thinks, the working line
			   above shows the same count, live. */
			if (!tr.thinking && tr.thinkingTokens > 0 && (ecrit || !vivant)) {
				const count = compterJetons(tr.thinkingTokens);
				specs.push({
					cle: "thinking", icone: "brain", libelle: t(vivant && !ecrit ? "ai.transcript.privateThinkingLive" : "ai.transcript.privateThought", { count }), ouvertParDefaut: false,
					detail: corps => {
						const el = (corps.firstElementChild as HTMLElement | null) ?? ajouter(corps, "div", "qbd-ai-transcript-reflexion");
						const v = t("ai.transcript.privateThinkingNote");
						if (el.textContent !== v) el.textContent = v;
					},
				});
			}
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
				/* THE AI'S WORK (2026-10-09): every tool call as a terminal shows
				   it, `Read(path)` then `└ 120 lines`, folded by default; the
				   refused ones in the warning colour. Text only (`textContent`
				   through `ajouter`): a path or an error is never HTML here. */
				/* The heading sums the work up by kind, as MonoCode does
				   ("Explored the project · Ran 6 tools", "Ran a command · Edited
				   SKILL.md"), and the steps are shown open: the owner wants to see
				   everything the AI did without a click (2026-10-10). */
				const { libelle, icone } = resumeOutils(tr);
				specs.push({
					cle: "tools", icone, libelle, ouvertParDefaut: true,
					detail: corps => peindreEtapes(corps, tr),
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

		// A running turn with no live view yet still shows its one summary line.
		if (!vue && vivant && specs.length === 0) specs.push(specTravail(l, tr, null, vivant));
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
				const icone = ajouter(b, "span", "qbd-ai-transcript-titre-icone");
				poserIcone(icone, s.icone);
				const libelle = ajouter(b, "span", "qbd-ai-transcript-ligne-texte");
				const chevron = ajouter(b, "span", "qbd-ai-transcript-chevron");
				const neuve: LigneTranscript = { bouton: b, icone, iconeNom: s.icone, libelle, chevron, detail: null, ouvert, chevronNom: "" };
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
			if (v.iconeNom !== s.icone) { poserIcone(v.icone, s.icone); v.iconeNom = s.icone; }
			v.bouton.classList.toggle("qbd-ai-transcript-ligne--alerte", !!s.alerte);
			if (v.libelle.textContent !== s.libelle) v.libelle.textContent = s.libelle;
			if (s.chrono) {
				v.libelle.classList.add("qbd-ai-transcript-chrono");
				v.libelle.dataset.modele = s.chrono.modele;
				v.libelle.dataset.activite = s.chrono.activite;
				v.libelle.dataset.debut = String(s.chrono.debut);
			} else if (v.libelle.classList.contains("qbd-ai-transcript-chrono")) {
				v.libelle.classList.remove("qbd-ai-transcript-chrono");
				delete v.libelle.dataset.modele;
				delete v.libelle.dataset.activite;
				delete v.libelle.dataset.debut;
			}
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
		/* The Retry of a turn the safeguards answered with another model: a button of its
		   own, right under the work line (a button cannot sit inside a button), kept
		   there at each chunk. */
		const travail = etat.lignes.get("work");
		const alerte = specs.some(s => s.cle === "work" && s.alerte);
		if (alerte && travail) {
			if (!etat.relance) {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "qbd-ai-reponse-action qbd-ai-transcript-relance";
				b.textContent = t("ai.safeguard.retry");
				b.addEventListener("click", () => { const courant = blocs.get(bloc); if (courant) relancer(courant.ligne); });
				etat.relance = b;
			}
			if (etat.relance.previousElementSibling !== travail.bouton) travail.bouton.after(etat.relance);
		} else if (etat.relance) {
			etat.relance.remove();
			etat.relance = null;
		}
	}

	/** Sends the same request again: a new line at the end of the queue (the
	    model's answer of this one, `produit`, is not carried over). */
	function relancer(l: LigneGeneration): void {
		opts.file.envoyer({ ...l.demande, produit: undefined, sentAt: Date.now() });
	}

	/** The result line under a step: `└ 120 lines`, `└ Refused: …`. */
	function resultatEtape(s: ToolStep): string {
		if (s.status === "running") return t("ai.transcript.stepRunning");
		if (s.status === "refused") return s.detail ? t("ai.transcript.stepRefused", { detail: s.detail }) : t("ai.transcript.stepRefusedBare");
		if (s.status === "error") return s.detail ? t("ai.transcript.stepError", { detail: s.detail }) : t("ai.transcript.stepErrorBare");
		if (s.unit === "image") return t("ai.transcript.stepImage");
		const n = s.count ?? 0;
		if (s.unit === "files") return t(n === 1 ? "ai.transcript.stepFilesOne" : "ai.transcript.stepFilesOther", { count: n });
		return t(n === 1 ? "ai.transcript.stepLinesOne" : "ai.transcript.stepLinesOther", { count: n });
	}

	/** Paints the steps IN PLACE: a chunk only changes the lines that moved. */
	function peindreEtapes(corps: HTMLElement, tr: Transcript): void {
		tr.tools.forEach((s, i) => {
			let el = corps.children[i] as HTMLElement | undefined;
			if (!el || !el.classList.contains("qbd-ai-transcript-etape")) {
				el = document.createElement("div");
				el.className = "qbd-ai-transcript-etape";
				const appel = ajouter(el, "div", "qbd-ai-transcript-etape-appel");
				ajouter(appel, "span", "qbd-ai-transcript-etape-nom");
				ajouter(appel, "span", "qbd-ai-transcript-etape-entree");
				ajouter(el, "div", "qbd-ai-transcript-etape-resultat");
				corps.insertBefore(el, corps.children[i] ?? null);
			}
			if (el.dataset.statut !== s.status) el.dataset.statut = s.status;
			const nom = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-nom");
			const entree = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-entree");
			const res = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-resultat");
			if (nom && nom.textContent !== s.name) nom.textContent = s.name;
			const e = "(" + s.input + ")";
			if (entree && entree.textContent !== e) entree.textContent = e;
			const r = "└ " + resultatEtape(s);
			if (res && res.textContent !== r) res.textContent = r;
		});
		// The steps past the cap: one line that says how many.
		let fin = corps.children[tr.tools.length] as HTMLElement | undefined;
		if (tr.toolsHidden > 0) {
			if (!fin) fin = ajouter(corps, "div", "qbd-ai-transcript-outil");
			const v = t("ai.transcript.stepsHidden", { count: tr.toolsHidden });
			if (fin.textContent !== v) fin.textContent = v;
		}
		while (corps.children.length > tr.tools.length + (tr.toolsHidden > 0 ? 1 : 0)) corps.lastElementChild?.remove();
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
		const activite = zone.querySelector<HTMLElement>(`.qbd-ai-reponse-activite[data-ligne="${id}"]`);
		if (activite) { const v = texteActivite(tr); if (activite.textContent !== v) activite.textContent = v; }
		const bloc = zone.querySelector<HTMLElement>(`.qbd-ai-transcript[data-ligne="${id}"]`);
		/* First chunk of a run painted before its transcript existed, or the AI
		   work of a finished line read back from the store after a reload
		   (2026-10-11): one repaint. */
		if (!bloc) { if (enCours(l) || opts.file.live(id)) peindre(); return; }
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
			if (item.kind === "pending") { peindreEnAttente(zone, item, pcReachable(item.target, remote, Date.now(), getPeerConnected()), opts.ouvrirPiece); continue; }
			if (item.kind === "remote") { peindreProgressionDistante(zone, item.entry, item.stale, item.device); continue; }
			if (item.kind === "record") { peindreTourEnregistre(zone, item.request, { chatOrigin: record?.origin ?? "", racine: opts.racine, ouvrirFichier: opts.ouvrirFichier, ouvrir: opts.ouvrir, ouvrirPiece: opts.ouvrirPiece, copier: opts.copier, repondre: opts.repondre, reprenable: opts.reprenable }); continue; }
			// The `arret` state is not shown (for the user the line is cancelled); the
			// quizzes of a plan live in the sidebar, not in the conversation.
			const lignes = item.lines.filter(l => l.etat !== "arret");
			const montrees = lignes.filter(l => !(l.demande.preparation?.lot && !l.demande.planifier));
			if (montrees.length === 0) continue;
			// ONE bubble per request, whatever the number of lines it made.
			const tour = ajouter(zone, "div", "qbd-ai-tour");
			tour.setAttribute("role", "listitem");
			peindreMessage(tour, montrees[0], lignes);
			const refs = refsOf(montrees[0].demande.fromDevice ?? chatDevice(), montrees[0].demande.fromName, chatDevice());
			peindreOrigine(tour, refs.sender, refs.runner);
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
			if (attente.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), attente.documents, opts.ouvrirPiece);
			if (attente.text.trim()) ajouter(message, "div", "qbd-ai-bulle", attente.text.trim());
			const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--cours");
			const logo = ajouter(rep, "span", "qbd-ai-logo-travail");
			logo.setAttribute("aria-hidden", "true");
			host.ui.setIcon(logo, "sparkles");
			ajouter(rep, "span", "qbd-ai-reponse-etape", t("ai.clarify.deciding"));
		}
		const relais = opts.relais?.() ?? null;
		if (relais) peindreRelais(zone, relais, opts.ouvrirPiece);
		/* A NEW item is read from the key of the last one, not from the count: a
		   reply closed while a request goes out leaves the count unchanged. */
		const dernier = relais ? "relais" : attente ? "waiting" : items.length ? items[items.length - 1].key : "";
		const nouveau = dernier !== dernierPeint;
		dernierPeint = dernier;
		if (fil && (enBas || nouveau)) fil.scrollTop = fil.scrollHeight;
		const visibles = items.flatMap(i => (i.kind === "live" ? i.lines.filter(l => l.etat !== "arret") : []));
		const enCours = visibles.some(l => l.etat === "cours");
		travaille = enCours;
		boutonBas?.classList.toggle("is-working", enCours);
		if (enCours && horloge === null) {
			horloge = window.setInterval(() => {
				if (!zone?.isConnected) { liberer(); return; }
				zone.querySelectorAll<HTMLElement>(".qbd-ai-file-temps").forEach(el => {
					el.textContent = duree(Date.now() - Number(el.dataset.debut));
				});
				zone.querySelectorAll<HTMLElement>(".qbd-ai-transcript-chrono[data-debut]").forEach(el => {
					const texte = libelleEnCours(el.dataset.modele ?? "", el.dataset.activite ?? "", Date.now() - Number(el.dataset.debut));
					if (el.textContent !== texte) el.textContent = texte;
				});
				zone.querySelectorAll<HTMLElement>(".qbd-ai-reponse-etape[data-modele]").forEach(el => {
					const texte = texteTravail(el.dataset.modele ?? "", Date.now() - Number(el.dataset.debut));
					if (el.textContent !== texte) el.textContent = texte;
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
			boutonBas = bas;
			bas.type = "button";
			bas.setAttribute("aria-label", t("ai.transcript.toLatest"));
			bas.tabIndex = -1;
			/* Rest face: three dots (a typing indicator while something runs);
			   hover or focus swaps them for the arrow. */
			const points = ajouter(bas, "span", "qbd-ai-fil-bas-points");
			points.setAttribute("aria-hidden", "true");
			for (let i = 0; i < 3; i++) ajouter(points, "span", "qbd-ai-fil-bas-point");
			host.ui.setIcon(ajouter(bas, "span", "qbd-ai-fil-bas-fleche"), "arrow-down");
			bas.classList.toggle("is-working", travaille);
			bas.addEventListener("click", () => parent.scrollTo({ top: parent.scrollHeight, behavior: "smooth" }));
			/* Shown once the thread is scrolled up by more than a third of its
			   visible height; a hidden button leaves the tab order. */
			const majBas = (): void => {
				const visible = parent.scrollHeight - parent.scrollTop - parent.clientHeight > parent.clientHeight / 3;
				bas.classList.toggle("is-visible", visible);
				bas.tabIndex = visible ? 0 : -1;
			};
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
