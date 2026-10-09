/* ══════════════════════════════════════════════════════════
   "EXPLAIN" ON A PLAYED QUESTION (2026-09-29)

   A button under EACH answered question, inside its card, once the question
   is corrected: it opens a WINDOW that can be closed and opened again
   without losing anything — the conversation about a question lives as long as
   the quiz page, a running answer goes on while the window is closed. The
   window is a chat like claude.ai's: the history above, below a FREE, empty
   composer (no prompt, no tile), the provider, model and effort, and the
   send arrow. The learner types what they want; with EVERY message the AI
   receives, behind the scenes, the whole quiz with the question of the
   button marked and the learner's answer to it, the text of the folder's
   notes and PDFs and its pictures (`explain-prompt.ts`, `explain-course.ts`,
   `explain-cours.ts`). The course is read once per quiz page.

   Not in an Exam: the button hides as soon as the test clock shows (the
   engine adds `.quiz-exam-timer` to the host), in Learn and in a Test
   played without exam mode it stays.

   Same engine as the Generate page's chat (`AiClient.chat`): the CLI is
   launched with its fixed options and no tool, the whole conversation goes
   with each message, and the answer is rendered by `renderMarkdownPreview`
   (every text through the sanitizer's first gate).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { LOG_PREFIX } from "../../../../src/branding";
import { createAiClient } from "../../../../src/dashboard/ai-client";
import type { AiClient, ChatTurn } from "../../../../src/dashboard/ai-client";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import * as aiProviders from "../../../../src/dashboard/ai-providers";
import { openEffortSlider, openModelMenu, openProviderMenu } from "../../../../src/dashboard/ui-select";
import type { OpenProviderMenuOptions, ProviderBrandOption } from "../../../../src/dashboard/ui-select";
import { renderMarkdownPreview } from "../../../../src/markdown-preview";
import { mathifyElement } from "../../../../src/engine/mathjax";
import { brancherCadres, htmlFrameMarkup } from "../../../../src/engine/html-frame";
import { splitHtmlBlocks } from "../../../../src/engine/html-frame-core";
import { consigneExplication, contexteQuiz } from "../../../../src/explain-prompt";
import { ancrerImagesCitees } from "../../../../src/explain-images";
import type { ImageJointe } from "../../../../src/explain-images";
import { poserImagesCitees } from "./explain-images";
import { CARD_EDIT_MAX_CHARS, consigneEditionCarte, splitCardEdit, validateCardEdit } from "../../../../src/explain-edit";
import type { CardEditResult, CardFields } from "../../../../src/explain-edit";
import { renderInlineText, sanitizeQuizHtml, stripInlineMarkdown } from "../../../../src/engine/sanitizer";
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

/* THE SIDE PANEL (2026-10-09). The window is a panel on the right edge, like
   the artifact panel of claude.ai: the modal host still gives it its life
   cycle (Escape, the close button, focus), and the class below turns its
   container into a column that does not cover the quiz. The quiz area shrinks
   by the panel's width (`body.nq-explain-open`, quiz-bars.css). */
const CLE_LARGEUR = "nq-explain-width";
const LARGEUR_MIN = 420;
const LARGEUR_MAX = 760;

function bornerLargeur(w: number): number {
	// Never wider than the window leaves room for: 320 px at least stay for the quiz.
	return Math.round(Math.max(LARGEUR_MIN, Math.min(LARGEUR_MAX, w, window.innerWidth - 320)));
}

function largeurInitiale(): number {
	try {
		const v = Number(window.localStorage.getItem(CLE_LARGEUR));
		if (Number.isFinite(v) && v > 0) return bornerLargeur(v);
	} catch { /* storage refused: the default width */ }
	return bornerLargeur(window.innerWidth * 0.44);
}

function poserLargeur(w: number): void {
	document.documentElement.style.setProperty("--nq-explain-w", w + "px");
}

/** The plain text of a question's prompt, for the panel's subtitle. */
function texteQuestion(q: Record<string, unknown> | undefined): string {
	const brut = typeof q?.prompt === "string" ? q.prompt : typeof q?.title === "string" ? q.title : "";
	return stripInlineMarkdown(brut).replace(/\s+/g, " ").trim();
}

let nettoyagePanneau: (() => void) | null = null;

function monterPanneau(panneau: HTMLElement, sousTitre: string): void {
	nettoyagePanneau?.();
	const conteneur = panneau.parentElement;
	if (!conteneur) return;
	conteneur.classList.add("nq-explain-conteneur");
	// Not a modal: the quiz beside it stays usable.
	panneau.setAttribute("aria-modal", "false");
	poserLargeur(largeurInitiale());
	document.body.classList.add("nq-explain-open");
	const titre = panneau.querySelector<HTMLElement>(".modal-title");
	if (titre) {
		const texte = titre.querySelector<HTMLElement>(".modal-title-text");
		if (texte) texte.classList.add("nq-explain-titre");
		if (sousTitre) ajouter(titre, "span", "nq-explain-sous-titre", sousTitre).title = sousTitre;
	}
	// The width handle on the left edge.
	const poignee = ajouter(panneau, "div", "nq-explain-poignee");
	poignee.setAttribute("role", "separator");
	poignee.setAttribute("aria-orientation", "vertical");
	let courante = largeurInitiale();
	// Until the learner drags the handle, the default follows the window (44 %).
	let choisie = false;
	try { choisie = Number(window.localStorage.getItem(CLE_LARGEUR)) > 0; } catch { /* default */ }
	const surRedim = (): void => { courante = choisie ? bornerLargeur(courante) : largeurInitiale(); poserLargeur(courante); };
	window.addEventListener("resize", surRedim);
	const bouger = (e: PointerEvent): void => {
		choisie = true;
		courante = bornerLargeur(window.innerWidth - e.clientX);
		poserLargeur(courante);
	};
	const finir = (): void => {
		document.body.classList.remove("nq-explain-redimension");
		window.removeEventListener("pointermove", bouger);
		window.removeEventListener("pointerup", finir);
		window.removeEventListener("pointercancel", finir);
		if (!choisie) return;
		try { window.localStorage.setItem(CLE_LARGEUR, String(courante)); } catch { /* storage refused: not kept */ }
	};
	poignee.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		document.body.classList.add("nq-explain-redimension");
		window.addEventListener("pointermove", bouger);
		window.addEventListener("pointerup", finir);
		window.addEventListener("pointercancel", finir);
	});
	// The quiz gets its width back as soon as the closing slide starts.
	const obs = new MutationObserver(() => { if (conteneur.classList.contains("qbd-closing")) document.body.classList.remove("nq-explain-open"); });
	obs.observe(conteneur, { attributes: true, attributeFilter: ["class"] });
	nettoyagePanneau = () => { obs.disconnect(); window.removeEventListener("resize", surRedim); finir(); nettoyagePanneau = null; };
}

function demonterPanneau(): void {
	nettoyagePanneau?.();
	document.body.classList.remove("nq-explain-open");
}

const LETTRES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NL = String.fromCharCode(10);

/** The default longest explanation, in characters: a full explanation (error
    diagnosis, steps, every wrong option, example, check question) fits. */
export const EXPLAIN_MAX_CHARS_DEFAUT = 4000;

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

/** One message of a conversation, as the window shows it. */
interface Message {
	role: "user" | "assistant";
	text: string;
	modele?: string;
	/** The provider that answered: its logo stays when another is picked later. */
	fournisseur?: string;
	debut?: number;
	duree?: number;
	enCours?: boolean;
	/** The course is being read before the question leaves. */
	lecture?: boolean;
	erreur?: string;
	arrete?: boolean;
	/** A new version of the reading card, or a change of the question, proposed by this answer. */
	edit?: CardProposal;
}

/** The proposal of a new version of a reading card, or of a change of a
    question (`verdict` then has `rows`), from a `<card-edit>` block.
    `verdict` is the app's judgement BEFORE anything is shown. */
interface CardProposal {
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

/** The conversation about ONE question: it lives as long as the quiz page, so
    that closing the window and opening it again loses nothing — a running
    answer goes on being written while the window is closed. */
interface Conversation {
	messages: Message[];
	historique: ChatTurn[];
	client: AiClient;
	enCours: boolean;
	/** The quiz with this question marked (see `contexteQuiz`), set at each opening. */
	contexte: string;
	/** Repaints the window; null while it is closed. */
	repeindre: (() => void) | null;
	/** The question is a reading card: the chat may rewrite it. */
	lecture: boolean;
	/** The question was changed (or put back) since the context was built. */
	perime?: boolean;
}

export function monterBoutonExpliquer(hote: HTMLElement, deps: {
	questions: Record<string, unknown>[];
	titre: string;
	settings: AiSettingsHost;
	/** The path of the quiz note and its text, to find its folder and what it cites. */
	chemin: string;
	note: string;
	/** Re-renders the quiz page on a rewritten note, on the same screen, and
	    returns its questions again. Absent: neither a reading nor a question
	    can be rewritten. `aReviser`: the right answer of question `qi`
	    changed; `garderEcran`: a handed-in quiz keeps its screen. */
	recharger?: (note: string, qi: number, opts?: { aReviser?: boolean; garderEcran?: boolean }) => Promise<Record<string, unknown>[]>;
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
		const logo = ajouter(bouton, "span", "qz-explain-btn-logo");
		ajouter(bouton, "span", undefined, t("ai.explain.button"));
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
	   learner is asked to pick. Written to the Settings only when it differs
	   at send time or is picked by hand, so that merely opening a quiz never
	   changes the provider of the Generate page. */
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
			if (peutExpliquer()) {
				const p = aiProviders.getProvider(courant);
				const logo = ajouter(b.logo, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
				aiProviders.setBrandLogo(logo, p.logo);
			} else {
				host.ui.setIcon(b.logo, "sparkles");
			}
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

	/* The quiz with the question of the clicked button marked, and the learner's
	   answer to THAT question (read on its own slide). */
	const contexteDe = (slide: HTMLElement | null, qi: number): string | null => {
		const q = questions[qi];
		if (!q) return null;
		const ordre = slide ? [...slide.querySelectorAll<HTMLElement>(".quiz-option[data-orig]")].map(o => Number(o.dataset.orig)) : [];
		const dossier = deps.chemin.includes("/") ? deps.chemin.slice(0, deps.chemin.lastIndexOf("/")).split("/").pop() : "";
		const base = contexteQuiz(questions, { quiz: deps.titre, folder: dossier, courant: qi, ordre, myAnswer: slide ? maReponse(slide) : "", correct: slide ? estJuste(slide) : null, history: q.role === "read" ? null : deps.historique?.(qi) ?? null });
		const avecConsigne = base + "\n" + consigneExplication(q.role === "read");
		/* A reading card may be rewritten, and a question improved, by the chat
		   (only if the app can re-render the page). */
		if (!deps.recharger) return avecConsigne;
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
	   until the question is corrected. */
	const majVisibilite = (): void => {
		const examen = !!hote.querySelector(":scope > .quiz-exam-timer");
		/* The units: each card of a step page of a Learn, and the single card of
		   any other question slide. `juge` is the element whose classes say
		   whether the question is corrected, `qi` the question it holds. */
		const unites: Array<{ carte: HTMLElement; juge: HTMLElement; qi: number; lecture?: boolean }> = [];
		for (const slide of hote.querySelectorAll<HTMLElement>('.quiz-track > .quiz-track-item[data-slide-kind="question"]')) {
			if (slide.classList.contains("quiz-step-page")) {
				/* A reading card has nothing to correct: its button is there from the start. */
				for (const carte of slide.querySelectorAll<HTMLElement>(".quiz-card[data-card-qi].quiz-step-read")) unites.push({ carte, juge: carte, qi: Number(carte.dataset.cardQi), lecture: true });
				for (const carte of slide.querySelectorAll<HTMLElement>(".quiz-card[data-card-qi]:not(.quiz-step-read)")) unites.push({ carte, juge: carte, qi: Number(carte.dataset.cardQi) });
			} else {
				const carte = slide.querySelector<HTMLElement>(":scope > .quiz-card");
				if (carte && slide.dataset.qi !== undefined) unites.push({ carte, juge: slide, qi: Number(slide.dataset.qi) });
			}
		}
		for (const { carte, juge, qi, lecture } of unites) {
			const present = carte.querySelector(":scope > .qz-explain-carte");
			const q = questions[qi];
			const veut = !examen && !!q && (lecture ? q.role === "read" : corrigee(juge));
			if (veut && !present) {
				const zone = ajouter(carte, "div", "qz-explain-carte");
				const b = creerBouton(zone);
				b.addEventListener("click", () => ouvrirDepuis(juge, qi));
				peindreLogoBouton();
			} else if (!veut && present) present.remove();
		}
	};
	const observateur = new MutationObserver(majVisibilite);
	observateur.observe(hote, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "aria-hidden"] });
	majVisibilite();

	const conversations = new Map<number, Conversation>();
	const conversationDe = (qi: number): Conversation => {
		let c = conversations.get(qi);
		if (!c) {
			c = { messages: [], historique: [], client: createAiClient(deps.settings), enCours: false, contexte: "", repeindre: null, lecture: questions[qi]?.role === "read" };
			conversations.set(qi, c);
		}
		return c;
	};

	/** Opens the window about ONE question: the element that holds it (its card in
	    a step page, else its slide) and its index. */
	function ouvrirDepuis(el: HTMLElement, qi: number): void {
		const contexte = contexteDe(el, qi);
		if (contexte === null) { host.ui.notice(t("ai.explain.noQuestion")); return; }
		void coursDuQuiz();
		ouvrirFenetre(qi, contexte);
	}
	/** The window: the history above, the composer below. Built again at each
	    opening from the conversation, which is what survives. */
	function ouvrirFenetre(qi: number, contexte: string): void {
		const conv = conversationDe(qi);
		conv.contexte = contexte;
		let horloge = 0;
		let ligneForfait: UsageLine | null = null;
		requireHost("modals").open({
			className: "nq-explain-modal",
			title: t("ai.explain.title"),
			onOpen: (m) => {
				const fil = ajouter(m.contentEl, "div", "nq-explain-fil");
				monterPanneau(m.panelEl, texteQuestion(questions[qi]));
				const composer = ajouter(m.contentEl, "div", "nq-explain-composer");
				const champ = ajouter(composer, "textarea", "nq-explain-champ");
				champ.rows = 1;
				champ.placeholder = t("ai.explain.ownQuestion");
				const majPlaceholder = (): void => { champ.placeholder = t(conv.messages.length ? "ai.explain.followUp" : "ai.explain.ownQuestion"); };
				const pied = ajouter(composer, "div", "qz-mini-pied");
				const outils = ajouter(pied, "div", "qz-mini-outils");
				const fournisseurBtn = ajouter(outils, "button", "qbd-select qbd-provider-trigger-logo qz-mini-fournisseur");
				fournisseurBtn.type = "button";
				const modeleBtn = ajouter(outils, "button", "qbd-select qbd-model-trigger qbd-composer-plain");
				modeleBtn.type = "button";
				const modeleLabel = ajouter(modeleBtn, "span", "qbd-select-label");
				const effortBtn = ajouter(outils, "button", "qbd-select qbd-effort-trigger qbd-composer-plain");
				effortBtn.type = "button";
				const effortLabel = ajouter(effortBtn, "span", "qbd-select-label qbd-effort-trigger-label");
				const envoi = ajouter(outils, "button", "qz-mini-envoi");
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
					envoi.replaceChildren();
					host.ui.setIcon(ajouter(envoi, "span"), conv.enCours ? "square" : "arrow-up");
					envoi.setAttribute("aria-label", t(conv.enCours ? "ai.explain.stop" : "ai.explain.send"));
envoi.disabled = !conv.enCours && !champ.value.trim();
				};
				peindreOutils();
				majEnvoi();
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
				const verrouille = (): boolean => !conv.lecture && hote.classList.contains("quiz-is-locked");
				const relire = async (aReviser: boolean): Promise<void> => {
					note = await host.fs.read(deps.chemin);
					conv.perime = true;
					if (deps.recharger) questions = await deps.recharger(note, qi, { aReviser, garderEcran: verrouille() });
				};
				const changeLaReponse = (edit: CardProposal): boolean => edit.verdict.ok && "rows" in edit.verdict && edit.verdict.answerChange !== null;
				const echec = (res: BlockRewrite): string => t(res.ok ? "ai.explain.cardApplied" : res.reason === "stale" ? "ai.explain.cardStale" : "ai.explain.cardFailed");
				const appliquer = async (edit: CardProposal): Promise<void> => {
					if (edit.occupe || edit.etat !== "pending" || !edit.verdict.ok) return;
					edit.occupe = true;
					edit.message = undefined;
					conv.repeindre?.();
					try {
						const bloc = note.match(QUIZ_BLOCK_RE)?.[1];
						const question = "rows" in edit.verdict;
						const res: BlockRewrite = bloc === undefined
							? { ok: false, reason: "failed" }
							: await (question ? saveQuestionEdit : saveCardEdit)(deps.chemin, bloc, qi, edit.base, edit.verdict.fields);
						if (!res.ok || bloc === undefined) { edit.message = echec(res); return; }
						edit.avant = bloc;
						edit.apres = res.block;
						edit.etat = "applied";
						edit.message = t(!question ? "ai.explain.cardApplied" : verrouille() ? "ai.explain.question.appliedKept" : changeLaReponse(edit) ? "ai.explain.question.reviewed" : "ai.explain.question.applied");
						await relire(changeLaReponse(edit));
					} catch (e) {
						console.warn(`${LOG_PREFIX} Explain: card edit failed:`, e);
						if (edit.etat !== "applied") edit.message = t("ai.explain.cardFailed");
					} finally {
						edit.occupe = false;
						conv.repeindre?.();
					}
				};
				const annuler = async (edit: CardProposal): Promise<void> => {
					if (edit.occupe || edit.etat !== "applied" || edit.avant === undefined || edit.apres === undefined) return;
					edit.occupe = true;
					edit.message = undefined;
					conv.repeindre?.();
					try {
						const res = await restoreBlock(deps.chemin, edit.apres, edit.avant);
						if (!res.ok) { edit.message = echec(res); return; }
						edit.etat = "pending";
						edit.message = t("ai.explain.cardUndone");
						await relire(changeLaReponse(edit));
					} catch (e) {
						console.warn(`${LOG_PREFIX} Explain: card undo failed:`, e);
						edit.message = t("ai.explain.cardFailed");
					} finally {
						edit.occupe = false;
						conv.repeindre?.();
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
						ajouter(boite, "div", undefined, conv.lecture ? motif(edit.verdict.reason) : t(`ai.explain.questionRefused.${edit.verdict.reason as QuestionEditRefusal}`));
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

				/* THE HISTORY, painted from the conversation. Only the last answer
				   changes while it is written; every message is repainted with it,
				   which is cheap at the length of these conversations. */
				const enBas = (): boolean => fil.scrollHeight - fil.scrollTop - fil.clientHeight < 80;
				const peindreFil = (): void => {
					// No message yet: the composer sits in the middle of the window, and drops to the bottom at the first one.
					m.contentEl.classList.toggle("nq-explain-vide", conv.messages.length === 0);
					const bas = enBas() || fil.childElementCount === 0;
					fil.replaceChildren();
					for (const msg of conv.messages) {
						if (msg.role === "user") {
							const bloc = ajouter(fil, "div", "nq-explain-msg-user");
							if (msg.text) ajouter(bloc, "div", "qbd-ai-bulle nq-explain-demande", msg.text);
							continue;
						}
						const rep = ajouter(fil, "div", "qbd-ai-chat-reponse");
						const tete = ajouter(rep, "div", "qbd-ai-chat-tete");
						const p = aiProviders.getProvider(msg.fournisseur || courant || "claude-code");
						aiProviders.setBrandLogo(ajouter(tete, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo), p.logo);
						const nom = msg.modele ?? "";
						ajouter(tete, "span", undefined, msg.lecture ? t("ai.explain.readingCourse") : msg.enCours ? t("ai.chat.working", { model: nom }) : msg.arrete ? t("ai.explain.stop") : t("ai.chat.worked", { model: nom, time: duree(msg.duree ?? 0) }));
						if (msg.enCours) ajouter(tete, "span", "qbd-ai-file-temps", duree(Date.now() - (msg.debut ?? Date.now())));
						const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
						/* The `<card-edit>` block (a reading rewritten, a question improved) is
						   not text for the learner: it is cut out (even half written) and
						   shown as a proposal. */
						const decoupe = conv.lecture || deps.recharger ? splitCardEdit(msg.text) : { shown: msg.text, raw: null, pending: false };
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
						if (!msg.erreur && !msg.enCours && decoupe.raw !== null) {
							msg.edit ??= {
								verdict: conv.lecture
									? validateCardEdit(questions[qi], decoupe.raw, sanitizeQuizHtml)
									: validateQuestionEdit(questions[qi], decoupe.raw, sanitizeQuizHtml, ordreDe(qi)),
								base: JSON.parse(JSON.stringify(questions[qi])) as Record<string, unknown>,
								etat: "pending",
								occupe: false,
							};
							peindreProposition(rep, msg.edit);
						}
					}
					if (bas) fil.scrollTop = fil.scrollHeight;
				};
				let image = 0;
				conv.repeindre = () => {
					if (image) return;
					image = requestAnimationFrame(() => { image = 0; if (fil.isConnected) { peindreFil(); majEnvoi(); majPlaceholder(); } });
				};
				peindreFil();
				// The time an answer has been running ticks once a second.
				horloge = window.setInterval(() => { if (conv.enCours) conv.repeindre?.(); }, 1000);

				const envoyer = async (): Promise<void> => {
					if (conv.enCours) return;
					const perso = champ.value.trim();
					if (!perso) return;
					if (!peutExpliquer()) { fournisseurBtn.click(); return; }
					champ.value = "";
					champ.style.height = "auto";
					/* The provider shown here is the one that answers: the client reads the Settings. */
					if (deps.settings.get().aiProvider !== courant) await choisirFournisseur(courant);
					// Ollama: the model shown here (a default chosen by the window) is the one that answers.
					else if (courant === "ollama" && deps.settings.get().aiModel !== modeleCourant()) await deps.settings.save({ aiModel: modeleCourant() });
					conv.historique.push({ role: "user", text: perso });
					conv.messages.push({ role: "user", text: perso });
					const rep: Message = { role: "assistant", text: "", modele: libelleModele(), fournisseur: courant, debut: Date.now(), enCours: true, lecture: !coursPret };
					conv.messages.push(rep);
					conv.enCours = true;
					conv.repeindre?.();
					try {
						const lu = await coursDuQuiz();
						rep.lecture = false;
						conv.repeindre?.();
						/* A rewritten card changes what the model must see: rebuilt from the current questions. */
						if (conv.lecture) conv.contexte = contexteDe(null, qi) ?? conv.contexte;
						else if (conv.perime) { conv.contexte = contexteDe(elementDe(qi), qi) ?? conv.contexte; conv.perime = false; }
						const images = lu.nomsImages.length
							? "\n\nPICTURES attached to this message, in this order (image-1, image-2...): " + lu.nomsImages.map((n, i) => `${i + 1}. ${n}`).join("; ")
							: "";
						const reponse = await conv.client.chat(conv.historique, {
							style: "explain",
							context: conv.contexte + (lu.texte ? "\n\n=== COURSE ===\n" + lu.texte : "") + images,
							images: lu.images,
							imageNames: lu.nomsImages,
							/* A reading card may come back whole in a `<card-edit>` block, on top of the explanation. */
							maxChars: (deps.settings.get().aiExplainMaxChars ?? EXPLAIN_MAX_CHARS_DEFAUT) + (conv.lecture ? CARD_EDIT_MAX_CHARS + 400 : deps.recharger ? QUESTION_EDIT_ROOM : 0),
							onTranscript: (ev) => {
								if (ev.kind !== "text") return;
								rep.text += ev.text;
								conv.repeindre?.();
							},
						});
						rep.text = reponse;
						conv.historique.push({ role: "assistant", text: reponse });
					} catch (err) {
						const e = err as Error & { aborted?: boolean };
						conv.historique.pop();
						if (e?.aborted) rep.arrete = true;
						else rep.erreur = e?.message || t("ai.error.checkSettings");
					} finally {
						rep.enCours = false;
						rep.lecture = false;
						rep.duree = Date.now() - (rep.debut ?? Date.now());
						conv.enCours = false;
						ligneForfait?.refresh();
						conv.repeindre?.();
					}
				};
				champ.addEventListener("input", () => {
					champ.style.height = "auto";
					champ.style.height = Math.min(champ.scrollHeight, 160) + "px";
					majEnvoi();
				});
				champ.addEventListener("keydown", (e) => {
					if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
					e.preventDefault();
					void envoyer();
				});
				envoi.addEventListener("click", () => {
					if (conv.enCours) { conv.client.abort(); return; }
					void envoyer();
				});
				champ.focus();
			},
			// Closing the window keeps the conversation; only the painting stops.
			onClose: () => { demonterPanneau(); window.clearInterval(horloge); ligneForfait?.destroy(); ligneForfait = null; conv.repeindre = null; },
		});
	}

	return () => {
		observateur.disconnect();
		for (const c of conversations.values()) { if (c.enCours) c.client.abort(); c.repeindre = null; }
		for (const z of hote.querySelectorAll(".qz-explain-carte")) z.remove();
	};
}
