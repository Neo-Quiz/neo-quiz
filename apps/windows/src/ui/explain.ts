/* ══════════════════════════════════════════════════════════
   "EXPLAIN" ON A PLAYED QUESTION (2026-09-29)

   One icon button on the quiz card, once the question on screen is
   corrected: it opens a WINDOW beside the quiz. The window is a VIEW of ONE
   saved chat per quiz (2026-10-14, spec 2026-10-14-explain-live-ai-page):
   the chat record marked with the quiz (`chatForQuiz`), then the queue lines
   of that chat not recorded yet (`explainMessages`). Closing the window, the
   quiz page or the app loses nothing; the AI page lists the chat too.
   The window is a chat like claude.ai's: the history above, below a FREE,
   empty composer, the provider, model and effort, and the send arrow. With
   EVERY message the AI receives, behind the scenes, the whole quiz, the
   learner's position on it (the unit on screen when the message leaves), the
   text of the folder's notes and PDFs and its pictures (`explain-prompt.ts`,
   `explain-course.ts`, `explain-cours.ts`). The course is read once per quiz
   page.

   Not in an Exam: the button hides as soon as the test clock shows (the
   engine adds `.quiz-exam-timer` to the host), in Learn and in a Test
   played without exam mode it stays.

   A message is a line of the generation queue (`file-generation-app.ts`,
   `DemandeFile.explication`): a turn of the chat's live session with Claude
   Code or Codex, else one call with the whole conversation. The answer is
   rendered by `renderMarkdownPreview` (every text through the sanitizer's
   first gate).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { LOG_PREFIX } from "../../../../src/branding";
import { ouvrirMenuPlus } from "../../../../src/dashboard/composer-plus";
import { attachMentionPicker } from "../../../../src/dashboard/mention-picker";
import { creerJointesExplain } from "./explain-jointes";
import type { JointesExplain } from "./explain-jointes";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import * as aiProviders from "../../../../src/dashboard/ai-providers";
import { openEffortSlider, openModelMenu, openProviderMenu } from "../../../../src/dashboard/ui-select";
import type { OpenProviderMenuOptions, ProviderBrandOption } from "../../../../src/dashboard/ui-select";
import { renderMarkdownPreview } from "../../../../src/markdown-preview";
import { mathifyElement } from "../../../../src/engine/mathjax";
import { brancherCadres, htmlFrameMarkup } from "../../../../src/engine/html-frame";
import { splitHtmlBlocks } from "../../../../src/engine/html-frame-core";
import { consigneExplication, contexteQuiz, positionCourante } from "../../../../src/explain-prompt";
import { ancrerImagesCitees } from "../../../../src/explain-images";
import type { ImageJointe } from "../../../../src/explain-images";
import { poserImagesCitees } from "./explain-images";
import { CARD_EDIT_MAX_CHARS, consigneEditionCarte, splitCardEdit, validateCardEdit } from "../../../../src/explain-edit";
import type { CardEditResult, CardFields } from "../../../../src/explain-edit";
import { renderInlineText, sanitizeQuizHtml } from "../../../../src/engine/sanitizer";
import { QUESTION_EDIT_ROOM, consigneEditionQuestion, validateQuestionEdit } from "../../../../src/question-edit";
import type { QuestionEditRefusal, QuestionEditResult } from "../../../../src/question-edit";
import { peindreAvantApres } from "./question-edit-view";
import { restoreBlock, saveCardEdit, saveQuestionEdit } from "../../../../src/dashboard/detail-io";
import type { BlockRewrite } from "../../../../src/dashboard/detail-io";
import { QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { lireCours } from "./explain-cours";
import type { Cours } from "./explain-cours";
import { mountUsageLine } from "../../../../src/dashboard/usage-line";
import type { UsageLine, UsageTool } from "../../../../src/dashboard/usage-line";
import type { HostModalHandle } from "../../../../src/host/types";
import { creerBlocTravail } from "../../../../src/dashboard/transcript-steps";
import { suivreLeBas } from "./suivi-bas";
import type { BlocTravail } from "../../../../src/dashboard/transcript-steps";
import { fileDeGeneration, figerReglages, onQueueCreated } from "../../../../src/dashboard/file-generation-app";
import type { DemandeFile, FileGenerationApp, LigneGeneration } from "../../../../src/dashboard/file-generation-app";
import { chatForQuiz, explainMessages } from "../../../../src/dashboard/explain-chat";
import type { ExplainMessage } from "../../../../src/dashboard/explain-chat";
import type { ChatRecord, ChatRequest } from "../../../../src/dashboard/chat-record";
import { getChats } from "../../../../src/dashboard/chat-store";
import { newChatId, onChatsChanged } from "../../../../src/dashboard/chat-session";
import { newRequestId } from "../../../../src/dashboard/chat-requests";
import { suivreConversations } from "../../../../src/dashboard/chat-sidebar";
import { renderThread, threadHasLiveRow } from "../../../../src/dashboard/work-view";
import type { Scanner } from "../../../../src/dashboard/scanner";

/* THE SPLIT VIEW (2026-10-09). The Explain window is a second card, on the
   LEFT of the quiz card, with the same glass, border and radius. The modal host
   still gives it its life cycle (Escape, the close button, focus); the classes
   in quiz-bars.css place it and shrink the quiz card beside it
   (`body.nq-explain-open`). Its width is kept in localStorage. */
const CLE_LARGEUR = "nq-explain-width";
const LARGEUR_MIN = 320;
// No fixed maximum (2026-10-10): a 640 px cap left empty margins in the quiz
// card while the chat stayed narrow. The only limit is the quiz card's own minimum.
const QUIZ_MIN = 360;
// The three gaps around the two cards (`3 * --nq-panel-gap`, quiz-bars.css).
const ECARTS = 48;
const PAS_CLAVIER = 16;

function largeurMax(): number {
	return Math.max(LARGEUR_MIN, window.innerWidth - QUIZ_MIN - ECARTS);
}

function bornerLargeur(w: number): number {
	return Math.round(Math.max(LARGEUR_MIN, Math.min(w, largeurMax())));
}

function largeurInitiale(): number {
	try {
		const v = Number(window.localStorage.getItem(CLE_LARGEUR));
		if (Number.isFinite(v) && v > 0) return bornerLargeur(v);
	} catch { /* storage refused: the default width */ }
	return bornerLargeur(window.innerWidth * 0.38);
}

function poserLargeur(w: number): void {
	document.documentElement.style.setProperty("--nq-explain-w", w + "px");
}

/* THE MOTION (2026-10-09). The quiz card and the chat move together, by FLIP:
   the card's box is measured before and after the layout change, and
   `element.animate` carries it from one to the other with `width` and
   `translateX` (never `scaleX`, which would stretch the text). Nothing else
   animates the card, so no CSS transition fights it. While it runs, the body
   carries `nq-explain-motion`, and ui/quiz-bars.ts holds its slide-height
   refresh until `nq-explain-motion-end`. */
const CARTE_QUIZ = "#neo-quiz-root > .qbd-qz";
const COURBE = "cubic-bezier(0.36, 0.66, 0, 1)";
const DUREE_OUVERTURE_MS = 420;
const DUREE_FERMETURE_MS = 340;
let mouvementCarte: Animation | null = null;

interface BoiteCarte { left: number; width: number }

function mouvementReduit(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function carteQuiz(): HTMLElement | null {
	return document.querySelector<HTMLElement>(CARTE_QUIZ);
}

function mesurerCarte(carte: HTMLElement): BoiteCarte {
	return { left: carte.getBoundingClientRect().left, width: parseFloat(getComputedStyle(carte).width) };
}

function finirMouvement(): void {
	mouvementCarte = null;
	document.body.classList.remove("nq-explain-motion");
	window.dispatchEvent(new Event("nq-explain-motion-end"));
}

/** Plays the quiz card from its box `avant` to its box `apres`. The layout the
    motion runs in is the split one, anchored at `ancrage` (its left edge), so
    the offsets are measured from there: the card's own layout never moves.
    `fin` runs when the motion is over. */
function jouerMouvement(carte: HTMLElement, avant: BoiteCarte, apres: BoiteCarte, ancrage: number, duree: number, fin?: () => void): void {
	mouvementCarte?.cancel();
	mouvementCarte = null;
	const depart = avant.left - ancrage;
	const arrivee = apres.left - ancrage;
	const termine = (): void => { fin?.(); finirMouvement(); };
	if (Math.abs(depart - arrivee) < 0.5 && Math.abs(avant.width - apres.width) < 0.5) { termine(); return; }
	const anim = carte.animate(
		[
			{ transform: `translateX(${depart}px)`, width: `${avant.width}px` },
			{ transform: `translateX(${arrivee}px)`, width: `${apres.width}px` },
		],
		{ duration: duree, easing: COURBE },
	);
	mouvementCarte = anim;
	// A `cancel()` (a new motion, a reopening) never reaches `onfinish`: only the last motion ends the state.
	anim.onfinish = () => { if (mouvementCarte === anim) termine(); };
}

let nettoyagePanneau: (() => void) | null = null;

function monterPanneau(panneau: HTMLElement): void {
	nettoyagePanneau?.();
	const conteneur = panneau.parentElement;
	if (!conteneur) return;
	conteneur.classList.add("nq-explain-conteneur");
	// The quiz card's box BEFORE the split layout (the FLIP starts here).
	const carte = carteQuiz();
	const avant = carte && !mouvementReduit() ? mesurerCarte(carte) : null;
	if (avant) document.body.classList.add("nq-explain-motion");
	// Not a modal: the quiz beside it stays usable.
	panneau.setAttribute("aria-modal", "false");
	poserLargeur(largeurInitiale());
	document.body.classList.add("nq-explain-open");
	document.querySelector(".qz-explain-btn-icone")?.classList.add("is-active");
	// The width handle fills the GAP left of the chat card (the card sits right
	// of the quiz). It hangs on the container, not on the card: the card clips
	// its overflow, which cut the handle down to its inner 4 px.
	const poignee = ajouter(conteneur, "div", "nq-explain-poignee");
	poignee.setAttribute("role", "separator");
	poignee.setAttribute("aria-orientation", "vertical");
	poignee.setAttribute("aria-label", t("ai.explain.resize"));
	poignee.tabIndex = 0;
	ajouter(poignee, "span", "nq-explain-poignee-grip");
	let courante = largeurInitiale();
	// Until the learner drags the handle, the default follows the window (38 %).
	let choisie = false;
	try { choisie = Number(window.localStorage.getItem(CLE_LARGEUR)) > 0; } catch { /* default */ }
	const appliquer = (w: number): void => {
		courante = bornerLargeur(w);
		poserLargeur(courante);
		poignee.setAttribute("aria-valuenow", String(courante));
		poignee.setAttribute("aria-valuemin", String(LARGEUR_MIN));
		poignee.setAttribute("aria-valuemax", String(largeurMax()));
	};
	const garder = (): void => {
		try {
			if (choisie) window.localStorage.setItem(CLE_LARGEUR, String(courante));
			else window.localStorage.removeItem(CLE_LARGEUR);
		} catch { /* storage refused: not kept */ }
	};
	appliquer(courante);
	const surRedim = (): void => appliquer(choisie ? courante : largeurInitiale());
	window.addEventListener("resize", surRedim);
	// The pointer is CAPTURED by the handle: an interactive page's iframe or a
	// button under the pointer can no longer take the drag (or its cursor).
	let idPointeur: number | null = null;
	const bouger = (e: PointerEvent): void => {
		if (e.pointerId !== idPointeur) return;
		choisie = true;
		appliquer(conteneur.getBoundingClientRect().right - e.clientX);
	};
	const finir = (): void => {
		if (idPointeur === null) return;
		if (poignee.hasPointerCapture(idPointeur)) poignee.releasePointerCapture(idPointeur);
		idPointeur = null;
		document.body.classList.remove("nq-explain-redimension");
		garder();
	};
	poignee.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		idPointeur = e.pointerId;
		poignee.setPointerCapture(e.pointerId);
		document.body.classList.add("nq-explain-redimension");
	});
	poignee.addEventListener("pointermove", bouger);
	poignee.addEventListener("pointerup", finir);
	poignee.addEventListener("pointercancel", finir);
	poignee.addEventListener("lostpointercapture", finir);
	// Double click: back to the default width, which follows the window again.
	// The key goes FIRST: `largeurInitiale` reads it and would give back the dragged width.
	poignee.addEventListener("dblclick", () => { choisie = false; garder(); appliquer(largeurInitiale()); });
	// Keyboard: the handle sits on the chat's left edge, so ← widens the chat.
	poignee.addEventListener("keydown", (e) => {
		const cible = e.key === "ArrowLeft" ? courante + PAS_CLAVIER
			: e.key === "ArrowRight" ? courante - PAS_CLAVIER
			: e.key === "Home" ? LARGEUR_MIN
			: e.key === "End" ? largeurMax()
			: null;
		if (cible === null) return;
		e.preventDefault();
		choisie = true;
		appliquer(cible);
		garder();
	});
	if (carte && avant) {
		const ouverte = mesurerCarte(carte);
		jouerMouvement(carte, avant, ouverte, ouverte.left, DUREE_OUVERTURE_MS);
	}
	else if (avant) finirMouvement();
	// The closing: the card goes back to its own width by the same FLIP, and the
	// split class goes only at the END of that motion (`jouerMouvement`'s `fin`).
	const obs = new MutationObserver(() => {
		if (!conteneur.classList.contains("qbd-closing")) return;
		const cadre = carteQuiz();
		if (!cadre || mouvementReduit() || !document.body.classList.contains("nq-explain-open")) {
			document.body.classList.remove("nq-explain-open");
			return;
		}
		// The split layout is the anchor: a running opening is ended first, so the layout is the open one.
		mouvementCarte?.cancel();
		mouvementCarte = null;
		const ouverte = mesurerCarte(cadre);
		document.body.classList.add("nq-explain-motion");
		// The box the card goes back to: measured without the split, then the split is put back in the same task (nothing painted).
		document.body.classList.remove("nq-explain-open");
		const fermee = mesurerCarte(cadre);
		document.body.classList.add("nq-explain-open");
		jouerMouvement(cadre, ouverte, fermee, ouverte.left, DUREE_FERMETURE_MS, () => document.body.classList.remove("nq-explain-open"));
	});
	obs.observe(conteneur, { attributes: true, attributeFilter: ["class"] });
	nettoyagePanneau = () => { obs.disconnect(); window.removeEventListener("resize", surRedim); finir(); poignee.remove(); nettoyagePanneau = null; };
}

function demonterPanneau(): void {
	nettoyagePanneau?.();
	// While the card is still moving back, its own motion removes the split class at the end.
	if (!mouvementCarte) document.body.classList.remove("nq-explain-open");
	document.querySelector(".qz-explain-btn-icone")?.classList.remove("is-active");
}

/** Leaving the quiz page: the window closes at once, without the quiz card's
    motion (the card is about to go, and a motion on a removed card may never
    finish, which would leave the split layout on the next page). */
function fermerSansMouvement(fenetre: HostModalHandle): void {
	if (mouvementCarte) { mouvementCarte.cancel(); finirMouvement(); }
	document.body.classList.remove("nq-explain-open");
	fenetre.close();
}

const LETTRES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NL = String.fromCharCode(10);

/** The default longest explanation, in characters: a full explanation (error
    diagnosis, steps, every wrong option, example, check question) fits. */
export const EXPLAIN_MAX_CHARS_DEFAUT = 4000;

/* What `envoyer` adds to the learner's text for the model. The bubble of a
   recorded message (whose text is the model's) is cut at the first of these. */
const PAR_DEFAUT = "Look at what I attached and help me understand it.";
const MARQUE_PERIME = "\n\n(The question was just changed: its current version is under WHERE THE LEARNER IS NOW.)";
const MARQUE_IMAGES = "\n\nPICTURES attached to this message, in this order (image-1, image-2...): ";
const MARQUE_DOCUMENTS = "\n\n=== DOCUMENTS I ATTACHED ===\n";

/** What the learner wrote, from the text the model read. */
function texteVisible(text: string): string {
	let fin = text.length;
	for (const marque of [MARQUE_PERIME, MARQUE_IMAGES, MARQUE_DOCUMENTS]) {
		const i = text.indexOf(marque);
		if (i >= 0 && i < fin) fin = i;
	}
	const vu = text.slice(0, fin);
	return vu === PAR_DEFAUT ? "" : vu;
}

/** "0:07" — the time the model has worked. */
function duree(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The question on that slide has been CORRECTED (a Learn card once checked, a
    Test once handed in): its verdict or its explanation is on screen. The
    mini composer waits for it, so that nobody is told the answer early. */
function corrigee(slide: HTMLElement): boolean {
	return slide.classList.contains("quiz-learn-revealed")
		|| !!slide.querySelector(".quiz-explain, .quiz-option.correct, .quiz-option.wrong, .quiz-option.missed");
}

/** Was the answer on that slide right? `null` when the slide does not say. */
function estJuste(slide: HTMLElement): boolean | null {
	if (slide.querySelector(".quiz-option.wrong, .quiz-option.missed")) return false;
	return slide.querySelector(".quiz-option.correct") ? true : null;
}

/** What the learner has answered on that slide, as they see it. */
function maReponse(slide: HTMLElement): string {
	const options = [...slide.querySelectorAll<HTMLElement>(".quiz-option[data-orig]")];
	const choisies = options
		.map((o, pos) => ({ o, pos }))
		// Chosen: "selected" before the correction, "correct"/"wrong" after it.
		.filter(({ o }) => o.getAttribute("aria-pressed") === "true" || ["selected", "correct", "wrong"].some(c => o.classList.contains(c)))
		.map(({ o, pos }) => `${LETTRES[pos] ?? pos + 1}. ${o.textContent?.trim() ?? ""}`);
	if (choisies.length) return choisies.join(" ; ");
	const saisies = [...slide.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type=text]")]
		.map(i => i.value.trim()).filter(Boolean);
	return saisies.join(" ; ");
}

/** One message of the thread, as the window shows it: an `ExplainMessage`
    (the record or the queue), or the message being prepared before it enters
    the queue (the course is read). */
interface Message {
	key: string;
	role: "user" | "assistant";
	text: string;
	/** The learner's pictures (object URLs, this page only) and documents (names) sent with this message. */
	images: string[];
	documents: string[];
	modele: string;
	/** The provider that answered: its logo stays when another is picked later. */
	fournisseur: string;
	debut: number;
	duree?: number;
	enCours: boolean;
	/** The course is being read before the question leaves. */
	lecture: boolean;
	erreur?: string;
	arrete: boolean;
	/** The queue line of a turn still in the queue (its AI work, its Stop). */
	lineId?: number;
}

/** The proposal of a new version of a reading card, or of a change of a
    question (`verdict` then has `rows`), from a `<card-edit>` block.
    `verdict` is the app's judgement BEFORE anything is shown. */
interface CardProposal {
	/** The question the proposal is about: the unit on screen when the message left. */
	qi: number;
	/** That question is a reading card. */
	lecture: boolean;
	verdict: CardEditResult | QuestionEditResult;
	/** The card as it was when the proposal was judged: the write expects it,
	    so an older proposal applied after another one is refused as stale. */
	base: Record<string, unknown>;
	etat: "pending" | "applied";
	occupe: boolean;
	message?: string;
	/** The block as it was before the edit, and as the edit wrote it (for the undo). */
	avant?: string;
	apres?: string;
}

/** What the window keeps while the quiz page lives: the chat itself is in the
    chat store and the queue, so closing the window loses nothing. */
interface EtatFenetre {
	/** The chat on screen: the quiz's saved Explain chat, else a new id (recorded at its first answer). */
	chatId: string | null;
	/** What the learner attached and has not sent yet (the composer's cards). */
	jointes: JointesExplain;
	/** Repaints the composer's cards; null while the window is closed. */
	peindrePieces: (() => void) | null;
	/** Repaints the window; null while it is closed. */
	repeindre: (() => void) | null;
	/** The `<card-edit>` proposals, by message key. */
	propositions: Map<string, CardProposal>;
	/** The question each request of this page was sent about (unit on screen at send), by request id. */
	questionDe: Map<string, number>;
	/** The pictures of this page's messages, by request id: shown in their bubble, never stored. */
	vignettes: Map<string, { urls: string[]; noms: string[] }>;
	/** The learner's pictures sent so far (their names are numbered from it). */
	imagesEnvoyees: number;
	/** A question was changed (or put back) since the last message: the next one says so. */
	perime: boolean;
	/** The message being prepared (the course is read) before it enters the queue. */
	envoi: { cle: string; texte: string; documents: string[]; fournisseur: string; modele: string; debut: number; annule: boolean } | null;
}

export function monterBoutonExpliquer(hote: HTMLElement, deps: {
	questions: Record<string, unknown>[];
	titre: string;
	settings: AiSettingsHost;
	/** The catalog, for the generation queue when this window creates it (the AI page never mounted). */
	scanner: Scanner;
	/** The path of the quiz note and its text, to find its folder and what it cites. */
	chemin: string;
	note: string;
	/** Re-renders the quiz page on a rewritten note, on the same screen, and
	    returns its questions again. Absent: neither a reading nor a question
	    can be rewritten. `aReviser`: the right answer of question `qi`
	    changed; `garderEcran`: a handed-in quiz keeps its screen. */
	recharger?: (note: string, qi: number, opts?: { aReviser?: boolean; oublierReponse?: boolean; garderEcran?: boolean }) => Promise<Record<string, unknown>[]>;
	/** The learner's attempts and misses on question `qi`, from the review journal (read only). */
	historique?: (qi: number) => { attempts: number; misses: number } | null;
}): () => void {
	const host = currentHost();
	/* The questions and the note, as the page last read them: a rewritten card
	   replaces both (`appliquerCarte`). */
	let questions = deps.questions;
	let note = deps.note;
	/* One button under EACH answered question, inside its own card (no row above
	   the arrows any more: the card keeps all the room). It only shows once that
	   question has been corrected (Check in a Learn, the hand-in of a Test):
	   before that, the answer is not yet known. */
	/* Every Explain button (the row's, and one under each answered card of a
	   Learn step) is painted from the same provider. */
	const boutons = new Set<{ bouton: HTMLButtonElement; logo: HTMLElement }>();
	const creerBouton = (parent: HTMLElement): HTMLButtonElement => {
		const bouton = ajouter(parent, "button", "qz-explain-btn");
		bouton.type = "button";
		/* Icon only: the provider's logo. The name is the tooltip and the accessible label. */
		bouton.title = t("ai.explain.button");
		bouton.setAttribute("aria-label", t("ai.explain.button"));
		const logo = ajouter(bouton, "span", "qz-explain-btn-logo");
		boutons.add({ bouton, logo });
		return bouton;
	};

	/* The providers that can HOLD a conversation: the four channels that
	   `AiClient.chat` speaks to (the websites cannot be driven from here). */
	const LOCAUX = ["claude-code", "codex", "antigravity-cli", "ollama"];
	/* Channels whose effort has its own button; Antigravity levels and the
	   Ollama thinking level sit inside the model menu, as on the Generate page. */
	const aBoutonEffort = (): boolean => courant === "claude-code" || courant === "codex";
	/* What the last probes said, as the Generate page reads them: a channel in
	   error ("err") is listed but cannot be picked, a stopped Ollama ("warn")
	   can. */
	const statuts: Record<string, string> = {};
	let ollamaLocaux: aiProviders.OllamaDetectedModel[] = [];
	/* The provider of the window: the one of the Settings when it can chat,
	   else the first installed (Claude Code, then Codex), else none — the
	   learner is asked to pick. Written to the Settings only when picked by
	   hand (a message freezes the window's provider and model in its request),
	   so that merely opening a quiz never changes the provider of the AI page. */
	let courant = LOCAUX.includes(deps.settings.get().aiProvider || "") ? (deps.settings.get().aiProvider as string) : "";
	const peutExpliquer = (): boolean => courant !== "";
	/* The Ollama models, as the Generate page lists them: the user's selection,
	   the cloud catalog, then the local models the server reports. */
	interface ModeleOllama { value: string; label: string; cloud: boolean; icon: string | null; thinking: boolean }
	const listeOllama = (): ModeleOllama[] => {
		const r = deps.settings.get();
		const norm = (v: string): string => v.replace(/:latest$/, "");
		const installes = new Set(ollamaLocaux.map(m => norm(m.name)));
		const decorer = (meta: aiProviders.OllamaModelMeta): ModeleOllama =>
			({ value: meta.value, label: meta.label, cloud: meta.cloud, thinking: meta.thinking !== false, icon: meta.cloud ? "cloud" : (installes.has(norm(meta.value)) ? null : "download") });
		const liste = aiProviders.resolveOllamaSelection(r.aiOllamaModels, r.aiOllamaCatalog).map(decorer);
		for (const entry of aiProviders.getOllamaCatalog(r.aiOllamaCatalog)) {
			if (liste.length >= aiProviders.OLLAMA_MAX_MODELS) break;
			if (!aiProviders.isOllamaCloudModel(entry.value) || liste.some(o => o.value === entry.value)) continue;
			liste.push(decorer(aiProviders.getOllamaModelMeta(entry.value, r.aiOllamaCatalog)));
		}
		for (const m of ollamaLocaux) {
			if (liste.some(o => o.value === m.name || norm(o.value) === norm(m.name))) continue;
			liste.push({ value: m.name, label: norm(m.name), cloud: false, icon: null, thinking: (m.capabilities || []).includes("thinking") });
		}
		return liste;
	};
	const modeles = (): aiProviders.ModelDef[] =>
		courant === "claude-code" ? aiProviders.getClaudeModels()
			: courant === "antigravity-cli" ? aiProviders.getAntigravityModels()
			: courant === "ollama" ? listeOllama().map(o => ({ value: o.value, label: o.label }))
			: aiProviders.getDefaultModels("codex");
	/* The model of the Settings belongs to the provider it was chosen for:
	   another provider falls back to its own default. */
	const modeleCourant = (): string => {
		const reglage = deps.settings.get().aiProvider === courant ? deps.settings.get().aiModel : "";
		if (courant === "claude-code") return aiProviders.resolveClaudeModel(reglage);
		if (courant === "antigravity-cli") return aiProviders.resolveAntigravityModel(reglage);
		if (courant === "ollama") {
			/* As in the Generate page: a local model that is installed first. */
			const liste = listeOllama();
			return (reglage && liste.some(o => o.value === reglage) ? reglage : "")
				|| liste.find(o => !o.cloud && o.icon === null)?.value || liste[0]?.value || "";
		}
		return aiProviders.resolveCodexModel(reglage);
	};
	const efforts = () => aiProviders.getEfforts(courant, modeleCourant());
	const effortCourant = (): string => aiProviders.resolveEffort(courant, deps.settings.get().aiEffort, modeleCourant());
	const libelleModele = (): string => {
		const cur = modeleCourant();
		return modeles().find(m => m.value === cur)?.label ?? (courant === "ollama" ? aiProviders.prettyOllamaLabel(cur) : cur);
	};
	const NIVEAU: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
	/** The model menu: Antigravity carries its levels per model, Ollama its thinking levels and plan split. */
	const ouvrirMenuModeles = (ancre: HTMLElement, recharger: () => void): void => {
		const r = deps.settings.get();
		if (courant === "antigravity-cli") {
			const liste = aiProviders.getAntigravityModels();
			if (liste.length === 0) { host.ui.notice(t("ai.model.cliListUnavailable")); return; }
			openModelMenu(ancre, {
				head: t("dashboard.select.modelHead"),
				models: liste.map(m => {
					const niveaux = aiProviders.getEfforts(courant, m.value);
					if (!niveaux.length) return { value: m.value, label: m.label };
					const n = aiProviders.niveauAntigravity(r.aiAntigravityLevels, m.value);
					return { value: m.value, label: m.label, level: NIVEAU[n] || n, levels: niveaux.map(e => ({ value: e.value, label: NIVEAU[e.value] || e.label })), currentLevel: n };
				}),
				currentModel: modeleCourant(),
				efforts: [],
				onPickModel: async (v) => { await deps.settings.save({ aiModel: v }); recharger(); },
				onPickLevel: async (v, niveau) => {
					await deps.settings.save({ aiModel: v, aiAntigravityLevels: { ...(deps.settings.get().aiAntigravityLevels || {}), [v]: niveau } });
					recharger();
				},
			});
			return;
		}
		if (courant === "ollama") {
			const liste = listeOllama();
			const { principal, plus } = aiProviders.repartirParPlan(liste, r.aiOllamaPlanCompte || "", r.aiOllamaPlansAppris || {});
			const cur = liste.find(o => o.value === modeleCourant());
			openModelMenu(ancre, {
				models: principal.map(o => ({ value: o.value, label: o.label, icon: o.icon })),
				moreModels: plus.map(o => ({
					value: o.value, label: o.label, icon: o.icon,
					badge: t("ai.badge.pro"),
					upgrade: { label: t("ai.upgrade.button"), onClick: () => { void host.shell.openUrl(aiProviders.OLLAMA_UPGRADE_URL); } },
				})),
				searchable: true,
				currentModel: modeleCourant(),
				efforts: cur && cur.thinking ? aiProviders.getEfforts("ollama") : [],
				currentEffort: aiProviders.resolveEffort("ollama", r.aiEffort),
				onPickModel: async (v) => { await deps.settings.save({ aiModel: v }); recharger(); },
				onPickEffort: async (v) => { await deps.settings.save({ aiEffort: v }); recharger(); },
			});
			return;
		}
		openModelMenu(ancre, {
			models: modeles(),
			moreModels: courant === "claude-code" ? aiProviders.getClaudeMoreModels() : undefined,
			currentModel: modeleCourant(),
			efforts: [],
			onPickModel: async (v) => { await deps.settings.save({ aiModel: v }); recharger(); },
		});
	};
	/** The subtitle of a provider row: the real tool behind the channel. */
	const sousTitre = (id: string, fixe: string): string => {
		if (id !== "ollama") return fixe;
		if (courant !== "ollama") return "Ollama";
		return t(aiProviders.isOllamaCloudModel(modeleCourant()) ? "ai.explain.ollamaCloud" : "ai.explain.ollamaLocal");
	};

	const peindreLogoBouton = (): void => {
		for (const b of boutons) {
			if (!b.bouton.isConnected) { boutons.delete(b); continue; }
			// The colours of the button follow the provider's logo (CSS on `data-nq-fournisseur`).
			b.bouton.dataset.nqFournisseur = courant;
			b.logo.replaceChildren();
			// No provider picked yet: the Claude logo, as in the composer.
			const p = aiProviders.getProvider(courant || "claude-code");
			const logo = ajouter(b.logo, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
			aiProviders.setBrandLogo(logo, p.logo);
		}
	};
	peindreLogoBouton();
	/* The same probes as the Generate page, run together: Claude Code, Codex,
	   Antigravity and the Ollama server. A missing CLI is "err" (listed, not
	   pickable), a stopped Ollama "warn", a mobile host "warn". */
	const sonder = async (force = false): Promise<void> => {
		const cli = async (id: string, sonde: Promise<aiProviders.ClaudeCodeStatus>): Promise<void> => {
			const res = await sonde;
			statuts[id] = res.ok ? "ok" : res.reason === "mobile" ? "warn" : "err";
		};
		const ollama = async (): Promise<void> => {
			const res = await aiProviders.checkOllama(deps.settings.get().aiOllamaUrl, force);
			if (res.ok) { statuts["ollama"] = "ok"; ollamaLocaux = res.models; return; }
			statuts["ollama"] = (await aiProviders.checkOllamaInstalled(force)).installed ? "warn" : "err";
		};
		await Promise.all([
			cli("claude-code", aiProviders.checkClaudeCode(force)),
			cli("codex", aiProviders.checkCodex(force)),
			cli("antigravity-cli", aiProviders.checkAntigravity(force)),
			ollama(),
		]);
	};
	/* No usable provider in the Settings: the default is the first channel
	   that is installed, in the order of the menu. */
	const detecterDefaut = async (): Promise<void> => {
		if (peutExpliquer()) return;
		await sonder();
		const premier = LOCAUX.find(id => statuts[id] === "ok");
		if (premier) courant = premier;
		peindreLogoBouton();
	};
	void detecterDefaut();
	const choisirFournisseur = async (id: string): Promise<void> => {
		courant = id;
		await deps.settings.save({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
		/* Ollama has no default model in the provider table: keep the one the window shows. */
		if (id === "ollama") await deps.settings.save({ aiModel: modeleCourant() });
		peindreLogoBouton();
	};

	/** The quiz's folder, a contract path: where Claude Code and Codex work. */
	const dossierQuiz = deps.chemin.includes("/") ? deps.chemin.slice(0, deps.chemin.lastIndexOf("/")) : undefined;
	/* The quiz with NO question marked (the position says where the learner
	   is, `positionDe`), the tutor's instructions for the question `qi` the
	   message is about, and, when the app can re-render the page, the
	   instruction to rewrite that reading card or improve that question. */
	const contexteDe = (qi: number): string => {
		const q = questions[qi];
		const dossier = deps.chemin.includes("/") ? deps.chemin.slice(0, deps.chemin.lastIndexOf("/")).split("/").pop() : "";
		const base = contexteQuiz(questions, { quiz: deps.titre, folder: dossier, courant: -1 });
		const avecConsigne = base + "\n" + consigneExplication(q?.role === "read");
		if (!deps.recharger || !q) return avecConsigne;
		return avecConsigne + "\n" + (q.role === "read" ? consigneEditionCarte(q) : consigneEditionQuestion(q));
	};
	/* The element that holds question `qi` now (its card in a step page, else
	   its slide): the page may have been rendered again since it was opened. */
	const elementDe = (qi: number): HTMLElement | null =>
		hote.querySelector<HTMLElement>(`.quiz-card[data-card-qi="${qi}"]:not(.quiz-step-read)`)
		?? hote.querySelector<HTMLElement>(`.quiz-track > .quiz-track-item[data-qi="${qi}"]`);
	/* The order the options of `qi` are shown in (position → index in the question). */
	const ordreDe = (qi: number): number[] =>
		[...(elementDe(qi)?.querySelectorAll<HTMLElement>(".quiz-option[data-orig]") ?? [])].map(o => Number(o.dataset.orig));
	/** Where the learner is on the quiz: question `qi` with its options in the
	    order shown, their answer and its verdict, and their history on it. */
	const positionDe = (qi: number): string => {
		const q = questions[qi];
		if (!q) return "";
		const el = elementDe(qi);
		return positionCourante(questions, {
			courant: qi, ordre: ordreDe(qi), myAnswer: el ? maReponse(el) : "", correct: el ? estJuste(el) : null,
			history: q.role === "read" ? null : deps.historique?.(qi) ?? null,
		});
	};
	/* The course (notes, PDFs, pictures) is read ONCE per quiz page, at the
	   first opening of the window or the first send, then reused. */
	let cours: Promise<Cours> | null = null;
	let coursPret = false;
	/* The pictures attached to the course, which an answer may cite. */
	let jointesCours: ImageJointe[] = [];
	const coursDuQuiz = (): Promise<Cours> => (cours ??= lireCours(deps.chemin, note, questions)
		/* A course that could not be read whole is read again at the next message. */
		.then((c) => { coursPret = true; jointesCours = c.jointes; if (c.incomplet) cours = null; return c; })
		.catch((e): Cours => { console.warn(`${LOG_PREFIX} Explain: course unreadable:`, e); coursPret = true; cours = null; return { texte: "", images: [], nomsImages: [], jointes: [], incomplet: true }; }));

/* Hidden in an Exam (the engine puts its clock straight into the host) and
	   until the question on screen is corrected. ONE icon button, at the top
	   right of the quiz card, tied to the question on screen: the card or slide
	   that overlaps the quiz card the most. */
	type Unite = { carte: HTMLElement; juge: HTMLElement; qi: number; lecture: boolean };
	const carteDuQuiz = (): HTMLElement => hote.closest<HTMLElement>("#neo-quiz-root > .qbd-qz") ?? hote.parentElement ?? hote;
	const boutonQuiz = creerBouton(carteDuQuiz());
	boutonQuiz.classList.add("qz-explain-btn-icone");
	boutonQuiz.hidden = true;
	peindreLogoBouton();
	let uniteCourante: Unite | null = null;
	/* One toggle for both AI buttons (the icon on the quiz card): open the
	   window on the unit on screen, or close it when it is already open. */
	const basculer = (): void => {
		// Open: the window's own close button (the host's, as Escape). Closed: the unit on screen.
		const fermer = document.querySelector<HTMLElement>(".nq-explain-modal .modal-close-button");
		if (fermer) { fermer.click(); return; }
		if (uniteCourante ?? lesUnites()[0]) ouvrirDepuisLaPage();
	};
	boutonQuiz.addEventListener("click", basculer);
	/* The units: each card of a step page of a Learn, and the single card of
	   any other question slide. `juge` is the element whose classes say
	   whether the question is corrected, `qi` the question it holds. */
	const lesUnites = (): Unite[] => {
		const unites: Unite[] = [];
		for (const slide of hote.querySelectorAll<HTMLElement>('.quiz-track > .quiz-track-item[data-slide-kind="question"]')) {
			if (slide.classList.contains("quiz-step-page")) {
				for (const carte of slide.querySelectorAll<HTMLElement>(".quiz-card[data-card-qi].quiz-step-read")) unites.push({ carte, juge: carte, qi: Number(carte.dataset.cardQi), lecture: true });
				for (const carte of slide.querySelectorAll<HTMLElement>(".quiz-card[data-card-qi]:not(.quiz-step-read)")) unites.push({ carte, juge: carte, qi: Number(carte.dataset.cardQi), lecture: false });
			} else {
				const carte = slide.querySelector<HTMLElement>(":scope > .quiz-card");
				if (carte && slide.dataset.qi !== undefined) unites.push({ carte, juge: slide, qi: Number(slide.dataset.qi), lecture: false });
			}
		}
		return unites;
	};
	/* The unit on screen: the one whose box overlaps the quiz card the most. */
	const uniteAffichee = (): Unite | null => {
		const cadre = carteDuQuiz().getBoundingClientRect();
		let meilleure: Unite | null = null;
		let surface = 0;
		for (const u of lesUnites()) {
			const r = u.carte.getBoundingClientRect();
			const s = Math.max(0, Math.min(r.right, cadre.right) - Math.max(r.left, cadre.left)) * Math.max(0, Math.min(r.bottom, cadre.bottom) - Math.max(r.top, cadre.top));
			if (s > surface) { surface = s; meilleure = u; }
		}
		return meilleure;
	};
	const majVisibilite = (): void => {
		const examen = !!hote.querySelector(":scope > .quiz-exam-timer");
		const u = examen ? null : uniteAffichee();
		const q = u ? questions[u.qi] : undefined;
		uniteCourante = u;
		boutonQuiz.hidden = !u || !q || !(u.lecture ? q.role === "read" : corrigee(u.juge));
	};
	const observateur = new MutationObserver(majVisibilite);
	observateur.observe(hote, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-pressed", "aria-hidden"] });
	majVisibilite();

	/* The window's state for the whole quiz page: ONE chat per quiz, kept
	   while the learner moves through it. */
	const etat: EtatFenetre = {
		chatId: null, jointes: creerJointesExplain({ rendre: () => etat.peindrePieces?.() }), peindrePieces: null, repeindre: null,
		propositions: new Map(), questionDe: new Map(), vignettes: new Map(), imagesEnvoyees: 0, perime: false, envoi: null,
	};
	/* The open window, closed with the page (`fermerSansMouvement`). */
	let fenetre: HostModalHandle | null = null;
	/* The window's generation queue: the AI page's, or created here when the
	   AI page never mounted in this window. */
	let file: FileGenerationApp | null = null;
	onQueueCreated(q => { file = q; });
	const laFile = (): FileGenerationApp => {
		file ??= fileDeGeneration({ settings: deps.settings, scanner: deps.scanner });
		// The record follows the queue even when the AI page never mounted (idempotent).
		suivreConversations(file);
		return file;
	};
	/** The chat on screen: the one this page already uses unless it was
	    deleted meanwhile, else the quiz's saved Explain chat, else a new id
	    (the chat is recorded at its first answer). */
	const chatCourant = (): string => {
		const chats = getChats();
		if (etat.chatId && !chats.find(c => c.id === etat.chatId)?.deleted) return etat.chatId;
		etat.chatId = chatForQuiz(chats, deps.chemin)?.id ?? newChatId();
		return etat.chatId;
	};
	/** The request id of a message key (`<request id>:u` or `:a`). */
	const requeteDe = (cle: string): string => cle.slice(0, cle.lastIndexOf(":"));
	/** One message of the thread, from the record or the queue, as the window shows it. */
	const versMessage = (m: ExplainMessage, parLigne: Map<number, LigneGeneration>, parRequete: Map<string, ChatRequest>): Message => {
		const requete = requeteDe(m.key);
		const l = m.lineId !== undefined ? parLigne.get(m.lineId) : undefined;
		const q = parRequete.get(requete);
		const fournisseur = l?.demande.reglages.aiProvider || q?.provider || courant || "claude-code";
		const brut = l?.demande.reglages.aiModel || m.model || "";
		const v = etat.vignettes.get(requete);
		const user = m.role === "user";
		let text = user ? texteVisible(m.text) : m.text;
		// A running answer: the text streamed so far.
		if (!user && !text && l && m.running) text = file?.transcript(l.id)?.text ?? "";
		return {
			key: m.key, role: m.role, text,
			images: user ? v?.urls ?? [] : [],
			// A picture shown as a thumbnail is not listed again by its name.
			documents: v ? m.documents.filter(d => !v.noms.includes(d)) : m.documents,
			modele: brut ? aiProviders.libelleModele(fournisseur, brut) : "",
			fournisseur,
			debut: l?.debut ?? (m.at || Date.now()),
			duree: m.durationMs,
			enCours: !!m.running,
			lecture: false,
			erreur: m.error !== undefined ? (m.error || t("ai.error.checkSettings")) : undefined,
			arrete: !!m.stopped,
			lineId: m.lineId,
		};
	};
	/** The thread: the chat's record, then its queue lines not recorded yet,
	    then the message being prepared. */
	const messages = (): Message[] => {
		const id = chatCourant();
		const record: ChatRecord | null = getChats().find(c => c.id === id && !c.deleted) ?? null;
		const lignes = file?.lignes() ?? [];
		const parLigne = new Map(lignes.map(l => [l.id, l] as const));
		const parRequete = new Map((record?.requests ?? []).map(q => [q.id, q] as const));
		const out = explainMessages(record, lignes, id).map(m => versMessage(m, parLigne, parRequete));
		const e = etat.envoi;
		if (e) {
			out.push({ key: e.cle + ":u", role: "user", text: e.texte, images: etat.vignettes.get(e.cle)?.urls ?? [], documents: e.documents, modele: "", fournisseur: e.fournisseur, debut: e.debut, enCours: false, lecture: false, arrete: false });
			out.push({ key: e.cle + ":a", role: "assistant", text: "", images: [], documents: [], modele: e.modele, fournisseur: e.fournisseur, debut: e.debut, enCours: true, lecture: !coursPret, arrete: false });
		}
		return out;
	};

	/** Opens the window on the quiz's chat. */
	function ouvrirDepuisLaPage(): void {
		if (!questions.length) { host.ui.notice(t("ai.explain.noQuestion")); return; }
		void coursDuQuiz();
		ouvrirFenetre();
	}
	/** The window: the history above, the composer below. Built again at each
	    opening from the chat, which is what survives. */
	function ouvrirFenetre(): void {
		let horloge = 0;
		let detacherMentions: (() => void) | null = null;
		let ligneForfait: UsageLine | null = null;
		let desabonner: (() => void) | null = null;
		const handle = requireHost("modals").open({
			className: "nq-explain-modal",
			title: t("ai.explain.title"),
			onOpen: (m) => {
				const fil = ajouter(m.contentEl, "div", "nq-explain-fil");
				monterPanneau(m.panelEl);
				const q = laFile();
				/* The thread as last painted: the composer reads whether an answer runs. */
				let derniers: Message[] = messages();
				const enCours = (): boolean => !!etat.envoi || derniers.some(x => x.enCours);
				/* The Generate page's composer, as is (dashboard-ai.css): same frame,
				   same bottom row, same send button, same "+" and attachment cards
				   (explain-jointes.ts). No folder row here. */
				const composer = ajouter(m.contentEl, "div", "qbd-ai-composer nq-explain-composer");
				const zone = ajouter(composer, "div", "qbd-ai-composer-textzone");
				// The learner's cards (pictures, documents), above the field as on the Generate page.
				const piecesZone = ajouter(zone, "div", "qbd-ai-composer-pieces");
				const champ = ajouter(zone, "textarea", "qbd-ai-composer-input");
				champ.rows = 1;
				champ.placeholder = t("ai.explain.ownQuestion");
				const majPlaceholder = (): void => { champ.placeholder = t(derniers.length ? "ai.explain.followUp" : "ai.explain.ownQuestion"); };
				const pied = ajouter(composer, "div", "qbd-ai-composer-bottom");
				// "+" on the left, as on the Generate page: add files, mention with "@".
				const ajout = ajouter(pied, "button", "qbd-ai-composer-add");
				ajout.type = "button";
				ajout.setAttribute("aria-label", t("ai.composer.addContent"));
				host.ui.setIcon(ajout, "plus");
				ajout.addEventListener("click", () => ouvrirMenuPlus(ajout, { raccourci: "", ajouterFichiers: () => etat.jointes.choisirFichiers(), champ }));
				const outils = ajouter(pied, "div", "qbd-ai-composer-tools");
				const fournisseurBtn = ajouter(outils, "button", "qbd-select qbd-provider-trigger-logo");
				fournisseurBtn.type = "button";
				const modeleBtn = ajouter(outils, "button", "qbd-select qbd-model-trigger qbd-composer-plain");
				modeleBtn.type = "button";
				const modeleLabel = ajouter(modeleBtn, "span", "qbd-select-label");
				const effortBtn = ajouter(outils, "button", "qbd-select qbd-effort-trigger qbd-composer-plain");
				effortBtn.type = "button";
				const effortLabel = ajouter(effortBtn, "span", "qbd-select-label qbd-effort-trigger-label");
				const envoi = ajouter(outils, "button", "qbd-ai-composer-send");
				envoi.type = "button";

				/* The plan status line of the Generate page, as is (`usage-line.ts`), right
				   under the composer; remounted when the provider changes. */
				const lireForfait = host.process?.usageCompte;
				let outilForfait: UsageTool | null = null;
				const monterForfait = (): void => {
					const outil: UsageTool | null = !lireForfait || !peutExpliquer() ? null : courant === "claude-code" ? "claude" : courant === "codex" ? "codex" : null;
					if (outil === outilForfait && (ligneForfait || !outil)) return;
					ligneForfait?.destroy();
					ligneForfait = null;
					outilForfait = outil;
					if (!outil || !lireForfait) return;
					const place = ajouter(m.contentEl, "div", "qbd-ai-usage-slot");
					composer.after(place);
					ligneForfait = mountUsageLine(place, outil, (o) => lireForfait.call(host.process, o));
				};
				const peindreOutils = (): void => {
					fournisseurBtn.replaceChildren();
					if (peutExpliquer()) {
						const p = aiProviders.getProvider(courant);
						aiProviders.setBrandLogo(ajouter(fournisseurBtn, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo), p.logo);
						fournisseurBtn.title = p.name;
					} else {
						host.ui.setIcon(ajouter(fournisseurBtn, "span", "qbd-provider-logo"), "circle-dashed");
						fournisseurBtn.title = t("ai.provider.choose");
					}
					m.panelEl.dataset.nqFournisseur = courant;
					modeleBtn.hidden = !peutExpliquer();
					// The effort button exists for Claude Code and Codex only.
					effortBtn.hidden = !peutExpliquer() || !aBoutonEffort();
					monterForfait();
					if (peutExpliquer()) {
						modeleLabel.textContent = libelleModele();
						const ev = effortCourant();
						effortLabel.textContent = efforts().find(e => e.value === ev)?.label ?? ev;
					}
					peindreLogoBouton();
				};
				const majEnvoi = (): void => {
					const marche = enCours();
					const contenu = !!champ.value.trim() || !etat.jointes.vide();
					envoi.replaceChildren();
					envoi.classList.toggle("qbd-ai-composer-send--stop", marche);
					host.ui.setIcon(ajouter(envoi, "span", "qbd-ai-composer-send-icon"), marche ? "square" : "arrow-up");
					envoi.setAttribute("aria-label", t(marche ? "ai.explain.stop" : "ai.explain.send"));
					/* Hidden by default (dashboard-ai.css): shown with something to send,
					   and as the stop square while an answer runs. */
					envoi.classList.toggle("is-visible", marche || contenu);
					// A PDF still being read (or unreadable) holds the message back, and says why.
					envoi.disabled = !marche && (!contenu || !etat.jointes.pret());
					envoi.classList.toggle("qbd-ai-composer-send--disabled", envoi.disabled);
					envoi.title = !marche && !etat.jointes.pret() ? t("ai.attach.reading") : "";
				};
				peindreOutils();
				majEnvoi();
				etat.peindrePieces = () => { if (!composer.isConnected) return; etat.jointes.peindre(piecesZone); majEnvoi(); };
				etat.peindrePieces();
				void detecterDefaut().then(() => { if (fournisseurBtn.isConnected) peindreOutils(); });
				fournisseurBtn.addEventListener("click", () => {
					const masques = deps.settings.get().aiCanauxPayantsMasques;
					const brands = (): ProviderBrandOption[] => aiProviders.MARQUES
						.map(mq => ({
							value: mq.id,
							label: mq.name,
							logo: mq.logo,
							channels: mq.canaux.filter(c => LOCAUX.includes(c.id) && aiProviders.canalVisible(c.id, masques)).map(c => ({
								value: c.id,
								label: c.label,
								sub: sousTitre(c.id, c.sub),
								logo: c.logo || mq.logo,
								badge: c.gratuit ? t("ai.badge.free") : undefined,
								disabled: statuts[c.id] === "err",
								dot: statuts[c.id] === "warn" || statuts[c.id] === "err" ? statuts[c.id] : null,
							})),
						}))
						.filter(b => b.channels.length > 0);
					// Probed again at each opening, like the Generate page: the menu repaints when the answers come.
					const options: OpenProviderMenuOptions = {
						brands: brands(),
						current: courant,
						renderLogo: (el, logo) => aiProviders.setBrandLogo(el, logo),
						onPick: (id) => { void choisirFournisseur(id).then(peindreOutils); },
					};
					const menu = openProviderMenu(fournisseurBtn, options);
					void sonder(true).then(() => {
						if (!document.querySelector(".qbd-provider-menu")) return;
						options.brands = brands();
						menu.refresh();
					});
				});
				void aiProviders.refreshCliCaches().then(change => { if (change && modeleBtn.isConnected) peindreOutils(); });
				modeleBtn.addEventListener("click", async () => {
					await aiProviders.refreshCliCaches();
					if (!modeleBtn.isConnected) return;
					if (courant === "antigravity-cli") await aiProviders.refreshAntigravityModels();
					if (!modeleBtn.isConnected) return;
					ouvrirMenuModeles(modeleBtn, peindreOutils);
				});
				effortBtn.addEventListener("click", () => {
					openEffortSlider(effortBtn, {
						variant: courant === "claude-code" ? "claude" : "codex",
						efforts: efforts(),
						currentEffort: effortCourant(),
						onPickEffort: async (v) => { await deps.settings.save({ aiEffort: v }); peindreOutils(); },
					});
				});

				/* REWRITING A READING CARD. The proposal is judged before it is shown
				   (`validateCardEdit`); the write is the note's own path
				   (`saveCardEdit`: compare-and-swap on the block) and happens on
				   the click only. The page is then rendered again where the learner
				   was (`deps.recharger`).
				   A QUESTION (2026-10-09) goes the same way: `validateQuestionEdit`,
				   then `saveQuestionEdit`. When its right answer changes, the
				   learner's answer is judged again (`aReviser`). A handed-in quiz
				   keeps its results on screen: only the note changes. */
				const verrouille = (edit: CardProposal): boolean => !edit.lecture && hote.classList.contains("quiz-is-locked");
				const relire = async (edit: CardProposal): Promise<void> => {
					note = await host.fs.read(deps.chemin);
					etat.perime = true;
					/* Options that MOVED: the stored answer points at other texts, it is
					   dropped (`oublierReponse`); a new right answer: it is judged again. */
					const deplacees = optionsDeplacees(edit);
					if (deps.recharger) questions = await deps.recharger(note, edit.qi, { aReviser: changeLaReponse(edit) || deplacees, oublierReponse: deplacees, garderEcran: verrouille(edit) });
				};
				const changeLaReponse = (edit: CardProposal): boolean => edit.verdict.ok && "rows" in edit.verdict && edit.verdict.answerChange !== null;
				const optionsDeplacees = (edit: CardProposal): boolean => edit.verdict.ok && "rows" in edit.verdict && edit.verdict.reordered;
				const echec = (res: BlockRewrite): string => t(res.ok ? "ai.explain.cardApplied" : res.reason === "stale" ? "ai.explain.cardStale" : "ai.explain.cardFailed");
				const appliquer = async (edit: CardProposal): Promise<void> => {
					if (edit.occupe || edit.etat !== "pending" || !edit.verdict.ok) return;
					edit.occupe = true;
					edit.message = undefined;
					etat.repeindre?.();
					try {
						const bloc = note.match(QUIZ_BLOCK_RE)?.[1];
						const question = "rows" in edit.verdict;
						const res: BlockRewrite = bloc === undefined
							? { ok: false, reason: "failed" }
							: await (question ? saveQuestionEdit : saveCardEdit)(deps.chemin, bloc, edit.qi, edit.base, edit.verdict.fields);
						if (!res.ok || bloc === undefined) { edit.message = echec(res); return; }
						edit.avant = bloc;
						edit.apres = res.block;
						edit.etat = "applied";
						edit.message = t(!question ? "ai.explain.cardApplied" : verrouille(edit) ? "ai.explain.question.appliedKept" : optionsDeplacees(edit) ? "ai.explain.question.reordered" : changeLaReponse(edit) ? "ai.explain.question.reviewed" : "ai.explain.question.applied");
						await relire(edit);
					} catch (e) {
						console.warn(`${LOG_PREFIX} Explain: card edit failed:`, e);
						if (edit.etat !== "applied") edit.message = t("ai.explain.cardFailed");
					} finally {
						edit.occupe = false;
						etat.repeindre?.();
					}
				};
				const annuler = async (edit: CardProposal): Promise<void> => {
					if (edit.occupe || edit.etat !== "applied" || edit.avant === undefined || edit.apres === undefined) return;
					edit.occupe = true;
					edit.message = undefined;
					etat.repeindre?.();
					try {
						const res = await restoreBlock(deps.chemin, edit.apres, edit.avant);
						if (!res.ok) { edit.message = echec(res); return; }
						edit.etat = "pending";
						edit.message = t("ai.explain.cardUndone");
						await relire(edit);
					} catch (e) {
						console.warn(`${LOG_PREFIX} Explain: card undo failed:`, e);
						edit.message = t("ai.explain.cardFailed");
					} finally {
						edit.occupe = false;
						etat.repeindre?.();
					}
				};
				const motif = (r: string): string => t(
					r === "json" ? "ai.explain.cardRefused.json"
						: r === "empty" ? "ai.explain.cardRefused.empty"
						: r === "field" ? "ai.explain.cardRefused.field"
						: r === "tooLong" ? "ai.explain.cardRefused.tooLong"
						: r === "lossy" ? "ai.explain.cardRefused.lossy"
						: r === "notReading" ? "ai.explain.cardRefused.notReading"
						: "ai.explain.cardRefused.type");
				/* "Apply", then "Undo" once applied, and the outcome next to it. */
				const boutonProposition = (boite: HTMLElement, edit: CardProposal, appliquerCle: "ai.explain.cardApply" | "ai.explain.question.apply"): void => {
					const actions = ajouter(boite, "div", "nq-explain-edit-actions");
					const bouton = ajouter(actions, "button", "nq-explain-edit-btn", t(edit.etat === "applied" ? "ai.explain.cardUndo" : appliquerCle));
					bouton.type = "button";
					bouton.disabled = edit.occupe;
					bouton.addEventListener("click", () => { void (edit.etat === "applied" ? annuler(edit) : appliquer(edit)); });
					if (edit.message) ajouter(actions, "span", "nq-explain-edit-msg", edit.message);
				};
				const peindreProposition = (rep: HTMLElement, edit: CardProposal): void => {
					const boite = ajouter(rep, "div", "nq-explain-edit");
					if (!edit.verdict.ok) {
						boite.classList.add("nq-explain-edit-refus");
						ajouter(boite, "div", undefined, edit.lecture ? motif(edit.verdict.reason) : t(`ai.explain.questionRefused.${edit.verdict.reason as QuestionEditRefusal}`));
						return;
					}
					if ("rows" in edit.verdict) {
						/* A question: the before/after, the change of right answer first. */
						ajouter(boite, "div", "nq-explain-edit-titre", t("ai.explain.question.title"));
						peindreAvantApres(boite, edit.verdict);
						boutonProposition(boite, edit, "ai.explain.question.apply");
						return;
					}
					ajouter(boite, "div", "nq-explain-edit-titre", t("ai.explain.cardTitle"));
					const f: CardFields = edit.verdict.fields;
					const apercu = ajouter(boite, "div", "qbd-ai-preview-md markdown-preview-view nq-explain-edit-apercu");
					/* Every text is rendered through the sanitizer's gates: the Markdown
					   preview and the inline renderer escape, and `promptHtml` already
					   went through `sanitizeQuizHtml` in the verdict. */
					if (typeof f.title === "string") ajouter(apercu, "h4").innerHTML = renderInlineText(f.title);
					if (typeof f.prompt === "string") ajouter(apercu, "div").innerHTML = renderMarkdownPreview(f.prompt);
					if (typeof f.promptHtml === "string") ajouter(apercu, "div").innerHTML = f.promptHtml;
					if (Array.isArray(f.etapes)) {
						const ol = ajouter(apercu, "ol");
						for (const e of f.etapes as string[]) ajouter(ol, "li").innerHTML = renderMarkdownPreview(e);
					}
					if (f.retenir && typeof f.retenir === "object") {
						const items = (f.retenir as { items?: unknown[] }).items ?? [];
						const ul = ajouter(apercu, "ul");
						for (const it of items) {
							const c = it as { recto?: string; verso?: string } | string;
							ajouter(ul, "li").innerHTML = renderInlineText(typeof c === "string" ? c : `${c.recto ?? ""} : ${c.verso ?? ""}`);
						}
					}
					if (apercu.textContent?.includes("$")) void mathifyElement(apercu);
					boutonProposition(boite, edit, "ai.explain.cardApply");
				};

				/* THE HISTORY, painted from the chat (`messages`). Only a message
				   that CHANGED is painted again (2026-10-14): repainting every
				   message at each chunk re-ran the maths and reloaded the
				   interactive pages of the earlier answers, whose heights then
				   moved under the reader. */
				/* The bubbles' pictures, kept from one repaint to the next: a new <img> each time would flicker. */
				const vignettes = new Map<string, HTMLImageElement>();
				/* The work block of each answer, kept across repaints for the same reason:
				   a fold button rebuilt between mouse-down and mouse-up never clicks. */
				const travaux = new Map<string, BlocTravail>();
				/* The live work of each answer (a turn of a live session), by message key. */
				const travauxVivants = new Map<string, HTMLDetailsElement>();
				/** Each message's node and what it showed, to repaint only what changed. */
				const noeuds = new Map<string, { el: HTMLElement; cle: string }>();
				/** The `<card-edit>` proposal of a finished answer, judged once, against
				    the question the message was sent about (unknown for a message of an
				    earlier page: no proposal then, never a guess). */
				const propositionDe = (msg: Message): void => {
					if (msg.role !== "assistant" || msg.enCours || msg.erreur || etat.propositions.has(msg.key) || !deps.recharger) return;
					const qiMsg = etat.questionDe.get(requeteDe(msg.key));
					const question = qiMsg === undefined ? undefined : questions[qiMsg];
					if (qiMsg === undefined || !question) return;
					const raw = splitCardEdit(msg.text).raw;
					if (raw === null) return;
					const lecture = question.role === "read";
					etat.propositions.set(msg.key, {
						qi: qiMsg, lecture,
						verdict: lecture ? validateCardEdit(question, raw, sanitizeQuizHtml) : validateQuestionEdit(question, raw, sanitizeQuizHtml, ordreDe(qiMsg)),
						base: JSON.parse(JSON.stringify(question)) as Record<string, unknown>,
						etat: "pending",
						occupe: false,
					});
				};
				/* What a message shows (its running time and its AI work aside, updated in place). */
				const cleDe = (msg: Message): string => {
					const p = etat.propositions.get(msg.key);
					return JSON.stringify([msg.role, msg.text, msg.images, msg.documents, msg.enCours, msg.lecture, msg.erreur, msg.arrete, msg.duree, msg.modele, msg.fournisseur, msg.lineId !== undefined, p ? [p.etat, p.occupe, p.message] : null]);
				};
				/** A new node for `msg`, put in the thread by `placer` BEFORE it is filled
				    (the maths and the interactive pages render in a connected element). */
				const peindreMessage = (msg: Message, placer: (el: HTMLElement) => void): HTMLElement => {
					if (msg.role === "user") {
						const bloc = document.createElement("div");
						bloc.className = "nq-explain-msg-user";
						placer(bloc);
						if (msg.images.length || msg.documents.length) {
							const pj = ajouter(bloc, "div", "nq-explain-msg-pieces");
							for (const url of msg.images) {
								let img = vignettes.get(url);
								if (!img) {
									img = document.createElement("img");
									img.className = "nq-explain-msg-image";
									img.alt = "";
									img.src = url;
									vignettes.set(url, img);
								}
								pj.append(img);
							}
							// The whole name, extension included: the type of a file always shows.
							for (const nom of msg.documents) ajouter(pj, "span", "nq-explain-msg-doc", nom);
						}
						if (msg.text) ajouter(bloc, "div", "qbd-ai-bulle nq-explain-demande", msg.text);
						return bloc;
					}
					const rep = document.createElement("div");
					rep.className = "qbd-ai-chat-reponse";
					placer(rep);
					const tete = ajouter(rep, "div", "qbd-ai-chat-tete");
					const p = aiProviders.getProvider(msg.fournisseur || courant || "claude-code");
					aiProviders.setBrandLogo(ajouter(tete, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo), p.logo);
					const nom = msg.modele || p.name;
					ajouter(tete, "span", undefined, msg.lecture ? t("ai.explain.readingCourse")
						: msg.enCours ? t("ai.chat.working", { model: nom })
						: msg.arrete ? t("ai.explain.stop")
						: msg.duree !== undefined ? t("ai.chat.worked", { model: nom, time: duree(msg.duree) })
						: t("ai.chat.workedNoTime", { model: nom }));
					if (msg.enCours) ajouter(tete, "span", "qbd-ai-file-temps", duree(Date.now() - msg.debut));
					if (msg.lineId !== undefined) {
						/* The AI's work: a live turn in full (`renderThread`, as the AI
						   page shows it), folded under one line; else the one-shot
						   transcript block. Both kept across repaints (`majTravail`). */
						if (q.live(msg.lineId)) {
							let vivant = travauxVivants.get(msg.key);
							if (!vivant) {
								vivant = document.createElement("details");
								vivant.className = "qbd-ai-transcript nq-explain-travail";
								ajouter(vivant, "summary", "nq-explain-travail-resume");
								ajouter(vivant, "div", "qbd-work");
								travauxVivants.set(msg.key, vivant);
							}
							rep.append(vivant);
						} else {
							let travail = travaux.get(msg.key);
							if (!travail) { travail = creerBlocTravail(); travaux.set(msg.key, travail); }
							rep.append(travail.el);
						}
					}
					const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
					/* The `<card-edit>` block (a reading rewritten, a question improved) is
					   not text for the learner: it is cut out (even half written) and
					   shown as a proposal. */
					const decoupe = deps.recharger ? splitCardEdit(msg.text) : { shown: msg.text, raw: null, pending: false };
					if (msg.erreur) ajouter(prose, "div", "qbd-ai-reponse-erreur", msg.erreur);
					else if (decoupe.shown) {
						/* A fenced ```html block is shown as an interactive page in a
						   sandboxed frame (engine/html-frame-core.ts), not as code. Each
						   block goes through the markdown renderer as a plain token, then
						   its paragraph is replaced by the frame. A block still being
						   written is a placeholder: a half page would reload at every chunk. */
						const cadres: string[] = [];
						const seul = splitHtmlBlocks(decoupe.shown).map(seg => {
							if (seg.kind === "text") return seg.value;
							cadres.push(seg.kind === "html" ? htmlFrameMarkup(seg.value) : `<div class="nq-html-frame nq-html-frame--pending">${t("engine.htmlFrame.drawing")}</div>`);
							return `${NL}${NL}NQFRAME${cadres.length - 1}END${NL}${NL}`;
						}).join("");
						const ancre = ancrerImagesCitees(seul, jointesCours);
						let rendu = renderMarkdownPreview(ancre.texte);
						cadres.forEach((c, i) => { rendu = rendu.replace(new RegExp("<p>[^<]*NQFRAME" + i + "END[^<]*</p>|NQFRAME" + i + "END"), () => c); });
						prose.innerHTML = rendu;
						if (cadres.length) brancherCadres(prose);
						poserImagesCitees(prose, ancre.images);
						if (decoupe.shown.includes("$")) void mathifyElement(prose);
					}
					else if (msg.enCours) ajouter(prose, "span", "qbd-ai-chat-attente", t("ai.chat.thinking"));
					const prop = etat.propositions.get(msg.key);
					if (prop) peindreProposition(rep, prop);
					return rep;
				};
				/** The AI's work of an answer still in the queue, updated in place. */
				const majTravail = (msg: Message): void => {
					if (msg.lineId === undefined) return;
					const id = msg.lineId;
					const vue = q.live(id);
					const vivant = travauxVivants.get(msg.key);
					if (vue && vivant) {
						const racine = vivant.querySelector<HTMLElement>(":scope > .qbd-work");
						if (racine) renderThread(racine, vue.thread, {
							loadOutput: toolId => q.sortieOutil(id, toolId),
							answer: (requestId, allow) => q.repondreVivant(id, requestId, allow),
						});
						const resume = vivant.querySelector<HTMLElement>(":scope > summary");
						const v = t(vue.thread.running ? "ai.work.running" : "ai.work.worked");
						if (resume && resume.textContent !== v) resume.textContent = v;
						// A permission waiting for the learner: the turn waits for it, so it must show.
						if (vue.thread.items.some(i => i.kind === "permission" && i.state === "pending")) vivant.open = true;
						// Only while no row of the thread is live: a live row carries its own spinner.
						const busy = vue.thread.running && !threadHasLiveRow(vue.thread);
						let marche = vivant.querySelector<HTMLElement>(":scope > .qbd-work-running");
						if (busy && !marche) {
							marche = ajouter(vivant, "div", "qbd-work-running");
							const dot = ajouter(marche, "span", "qbd-work-dot is-running");
							dot.setAttribute("role", "img");
							dot.setAttribute("aria-label", t("ai.work.dotRunning"));
							ajouter(marche, "span", undefined, t("ai.work.running"));
						} else if (!busy && marche) marche.remove();
						return;
					}
					const tr = q.transcript(id);
					if (tr) travaux.get(msg.key)?.maj(tr, msg.enCours);
				};
				const suivi = suivreLeBas(fil);
				let etaitEnCours = false;
				const peindreFil = (): void => {
					derniers = messages();
					// No message yet: the composer sits in the middle of the window, and drops to the bottom at the first one.
					m.contentEl.classList.toggle("nq-explain-vide", derniers.length === 0);
					const gardes = new Set<Element>();
					for (const msg of derniers) {
						propositionDe(msg);
						const ancien = noeuds.get(msg.key);
						const cle = cleDe(msg);
						let el = ancien && ancien.cle === cle ? ancien.el : null;
						if (!el) {
							el = peindreMessage(msg, neuf => { if (ancien?.el.isConnected) ancien.el.replaceWith(neuf); else fil.append(neuf); });
							noeuds.set(msg.key, { el, cle });
						} else if (!el.isConnected) fil.append(el);
						gardes.add(el);
						// The running time and the AI's work change in place, without repainting the answer.
						if (msg.enCours) {
							const temps = el.querySelector<HTMLElement>(".qbd-ai-file-temps");
							const v = duree(Date.now() - msg.debut);
							if (temps && temps.textContent !== v) temps.textContent = v;
						}
						majTravail(msg);
					}
					for (const enfant of [...fil.children]) if (!gardes.has(enfant)) enfant.remove();
					// An answer just ended: the plan status line reads the new usage.
					const marche = enCours();
					if (etaitEnCours && !marche) ligneForfait?.refresh();
					etaitEnCours = marche;
					suivi.coller();
				};
				let image = 0;
				etat.repeindre = () => {
					if (image) return;
					image = requestAnimationFrame(() => { image = 0; if (fil.isConnected) { peindreFil(); majEnvoi(); majPlaceholder(); } });
				};
				peindreFil();
				majEnvoi();
				majPlaceholder();
				/* The queue (a line added or ended), the transcripts of this chat's
				   lines (a chunk, a live turn's change) and the chat store (a record
				   written, a chat deleted) repaint the thread. */
				const ligneDuChat = (id: number): boolean => q.lignes().some(l => l.id === id && l.demande.chatId === etat.chatId);
				const arrets = [
					q.abonner(() => etat.repeindre?.(), () => fenetre !== null),
					q.abonnerTranscript(id => { if (ligneDuChat(id)) etat.repeindre?.(); }),
					onChatsChanged(() => etat.repeindre?.()),
				];
				desabonner = () => { for (const a of arrets) a(); };
				// The time an answer has been running ticks once a second.
				horloge = window.setInterval(() => { if (enCours()) etat.repeindre?.(); }, 1000);

				const envoyer = async (): Promise<void> => {
					if (enCours()) return;
					const perso = champ.value.trim();
					if (!perso && etat.jointes.vide()) return;
					if (!etat.jointes.pret()) return;
					if (!peutExpliquer()) { fournisseurBtn.click(); return; }
					/* The unit on screen when the message leaves: what "this" means in it. */
					const qi = (uniteAffichee() ?? uniteCourante)?.qi ?? 0;
					champ.value = "";
					champ.style.height = "auto";
					const chatId = chatCourant();
					const requestId = newRequestId();
					const sentAt = Date.now();
					/* The provider and model shown here are the ones that answer: frozen
					   in the request; the Settings (the AI page's) are not changed. */
					const fournisseur = courant;
					const modele = modeleCourant();
					const prises = await etat.jointes.prendre(etat.imagesEnvoyees);
					etat.imagesEnvoyees += prises.images.length;
					if (prises.urls.length) etat.vignettes.set(requestId, { urls: prises.urls, noms: prises.nomsImages });
					etat.questionDe.set(requestId, qi);
					/* Read NOW, while the page shows what the learner sees (the course may take a while). */
					const position = positionDe(qi);
					const contexte = contexteDe(qi);
					const envoi: NonNullable<EtatFenetre["envoi"]> = { cle: requestId, texte: perso, documents: prises.nomsDocuments, fournisseur, modele: libelleModele(), debut: sentAt, annule: false };
					etat.envoi = envoi;
					// Sending is the one thing that brings the thread back to its bottom.
					suivi.reprendre();
					etat.repeindre?.();
					try {
						const lu = await coursDuQuiz();
						if (envoi.annule) return;
						/* The earlier turns, for a provider that cannot keep a live session:
						   the one call then carries the whole conversation. */
						const avant = explainMessages(getChats().find(c => c.id === chatId && !c.deleted) ?? null, q.lignes(), chatId)
							.filter(x => x.error === undefined && x.text.trim())
							.map(x => (x.role === "user" ? "LEARNER" : "TUTOR") + ":\n" + x.text.trim())
							.join("\n\n");
						const lecture = questions[qi]?.role === "read";
						/* What the model reads (never shown): the learner's text, a word
						   when a question changed, the pictures just attached, the documents' text. */
						const pourModele = (perso || PAR_DEFAUT)
							+ (etat.perime ? MARQUE_PERIME : "")
							+ (prises.nomsImages.length ? MARQUE_IMAGES + prises.nomsImages.map((n, i) => `${i + 1}. ${n}`).join("; ") : "")
							+ (prises.texte ? MARQUE_DOCUMENTS + prises.texte : "");
						etat.perime = false;
						/* The course's pictures stay in the quiz's folder: their names are
						   given, an agent working in the folder opens them. */
						const imagesCours = lu.nomsImages.length ? "\n\nPICTURES of the course, in the quiz's folder: " + lu.nomsImages.join("; ") : "";
						const demande: DemandeFile = {
							text: pourModele,
							texteAffiche: perso,
							notes: prises.notes,
							images: prises.images.map((p, i) => ({ file: new File([Uint8Array.from(atob(p.base64), c => c.charCodeAt(0))], prises.nomsImages[i], { type: p.mediaType }) })),
							...(avant ? { contexte: avant } : {}),
							mode: "learn",
							count: null,
							type: ["Mixte"],
							destination: "",
							reglages: figerReglages({ ...deps.settings.get(), aiProvider: fournisseur, aiModel: modele }),
							categorie: "general",
							chatId,
							requestId,
							sentAt,
							explication: {
								mark: { path: deps.chemin, quiz: deps.titre },
								context: contexte + imagesCours,
								course: lu.texte,
								position,
								/* A reading card may come back whole in a `<card-edit>` block, on top of the explanation. */
								maxChars: (deps.settings.get().aiExplainMaxChars ?? EXPLAIN_MAX_CHARS_DEFAUT) + (lecture ? CARD_EDIT_MAX_CHARS + 400 : deps.recharger ? QUESTION_EDIT_ROOM : 0),
								/* The quiz's folder (2026-10-14): Claude Code and Codex answer as
								   agents in it, as a generation runs, once the user trusts it. */
								folder: dossierQuiz,
							},
						};
						// The line takes the place of the message being prepared, in the same paint.
						etat.envoi = null;
						q.envoyer(demande);
					} catch (err) {
						console.warn(`${LOG_PREFIX} Explain: message not sent:`, err);
						host.ui.notice(t("ai.error.checkSettings"));
					} finally {
						if (etat.envoi === envoi) etat.envoi = null;
						etat.repeindre?.();
					}
				};
				champ.addEventListener("input", () => {
					champ.style.height = "auto";
					champ.style.height = Math.min(champ.scrollHeight, 160) + "px";
					majEnvoi();
				});
				/* Ctrl+V of a screenshot: the pictures become cards; a text paste is left alone. */
				champ.addEventListener("paste", (e) => {
					const fichiers = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith("image/"));
					if (!fichiers.length) return;
					e.preventDefault();
					void etat.jointes.ajouterFichiers(fichiers);
				});
				/* "@": the Generate page's file picker (vault notes, PDFs, pictures, extra folders). */
				const mentions = attachMentionPicker(champ, composer, {
					onPickVaultFile: (path) => { void etat.jointes.joindreChemin(path, "vault"); },
					onPickExternalFile: (path) => { void etat.jointes.joindreChemin(path, "external"); },
					onTextReplaced: () => {
						champ.style.height = "auto";
						champ.style.height = Math.min(champ.scrollHeight, 160) + "px";
						majEnvoi();
					},
					getExtraRoots: () => deps.settings.get().aiMentionExtraFolders || [],
				});
				detacherMentions = () => mentions.detach();
				champ.addEventListener("keydown", (e) => {
					// The "@" menu has the keyboard while open: its Enter picks a file, it never sends.
					if (e.defaultPrevented || mentions.isOpen()) return;
					if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
					e.preventDefault();
					void envoyer();
				});
				envoi.addEventListener("click", () => {
					/* Stop: the message still being prepared is dropped; a line in
					   the queue is stopped there (its live session stays). */
					if (etat.envoi) { etat.envoi.annule = true; etat.envoi = null; etat.repeindre?.(); return; }
					const enCoursLa = derniers.find(x => x.enCours && x.lineId !== undefined);
					if (enCoursLa?.lineId !== undefined) { q.annuler(enCoursLa.lineId); return; }
					void envoyer();
				});
				champ.focus();
			},
			// Closing the window keeps the chat (saved, its answers still running in the queue); only the painting stops.
			onClose: () => {
				if (fenetre === handle) fenetre = null;
				demonterPanneau();
				window.clearInterval(horloge);
				ligneForfait?.destroy();
				ligneForfait = null;
				desabonner?.();
				desabonner = null;
				etat.repeindre = null;
				detacherMentions?.();
				detacherMentions = null;
				etat.peindrePieces = null;
			},
		});
		fenetre = handle;
	}

	return () => {
		if (fenetre) fermerSansMouvement(fenetre);
		observateur.disconnect();
		/* Leaving the quiz page stops nothing: the answers go on in the queue
		   and are recorded in the chat. Only this page's pictures are let go. */
		etat.repeindre = null;
		etat.peindrePieces = null;
		etat.jointes.liberer();
		for (const v of etat.vignettes.values()) for (const u of v.urls) URL.revokeObjectURL(u);
		etat.vignettes.clear();
		boutonQuiz.remove();
	};
}
