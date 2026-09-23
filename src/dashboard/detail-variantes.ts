import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { quizModeLabel, quizTypeLabel, quizTypeIcon } from "./quiz-card";

/* ══════════════════════════════════════════════════════════
   ESSAI — TROIS INTERFACES POUR L'OUVERTURE D'UN QUIZ

   Branche `essai-page-quiz` (2026-09-23) : Ahmed choisit, dans l'app et
   sur ses vrais quiz, ce que la page montre à l'ouverture. La touche `i`
   fait défiler l'interface actuelle (la carte « Prêt ? » de detail.ts) et
   trois pistes, chacune inspirée d'un site :
     A · Couverture          — Lumni
     B · Choix d'activité    — Quizlet
     C · Fiche + questions   — Wayground (ex-Quizizz)
   Une fois le choix fait, la gagnante est gardée et ce module disparaît.
   Les lettres suivent la page de maquettes (D, E puis F y ont été écartées).
══════════════════════════════════════════════════════════ */

export type VariantePage = "actuelle" | "a" | "b" | "c";

const ORDRE: VariantePage[] = ["actuelle", "a", "b", "c"];
const CLE = "neo-quiz.essai-page-quiz";

const NOMS: Record<VariantePage, TransKey> = {
	actuelle: "dashboard.essai.nameCurrent",
	a: "dashboard.essai.nameA",
	b: "dashboard.essai.nameB",
	c: "dashboard.essai.nameC",
};

/** L'interface retenue pour cet essai. Préférence de l'utilisateur, d'où le
    localStorage ; sa lecture peut échouer (données du site bloquées). */
export function lireVariante(): VariantePage {
	try {
		const v = localStorage.getItem(CLE) as VariantePage | null;
		if (v && ORDRE.includes(v)) return v;
	} catch { /* rien de mémorisé */ }
	return "actuelle";
}

/** Passe à l'interface suivante, la mémorise et la nomme dans une notice. */
export function varianteSuivante(): VariantePage {
	const v = ORDRE[(ORDRE.indexOf(lireVariante()) + 1) % ORDRE.length];
	try { localStorage.setItem(CLE, v); } catch { /* pas mémorisée, tant pis */ }
	currentHost().ui.notice(t("dashboard.essai.switched", { name: t(NOMS[v]) }));
	return v;
}

export interface VarianteDeps {
	quiz: QuizIndexEntry;
	questions: DraftQuestion[];
	stat: QuizStatRecord;
	/** Lance le quiz (le bouton de l'hôte, avec l'écriture en attente). */
	onStart(el: HTMLElement): void;
	/** Ouvre l'aperçu d'une question — l'aperçu habituel de la page. */
	onOpenQuestion(index: number): void;
}

export function renderVariante(v: Exclude<VariantePage, "actuelle">, parent: HTMLElement, deps: VarianteDeps): void {
	const root = ajouter(parent, "div", `qbd-essai qbd-essai--${v}`);
	if (v === "a") renderA(root, deps);
	else if (v === "b") renderB(root, deps);
	else renderC(root, deps);
}

/* ── Briques communes ── */

function icone(parent: HTMLElement, name: string, cls = "qbd-essai-i"): HTMLElement {
	const el = ajouter(parent, "span", cls);
	currentHost().ui.setIcon(el, name);
	return el;
}

/** Texte d'une question, avec son LaTeX rendu. */
function texte(parent: HTMLElement, tag: "p" | "span" | "div", cls: string, value: string): HTMLElement {
	const el = ajouter(parent, tag, cls, value);
	if (value.includes("$")) void mathifyElement(el);
	return el;
}

function typeLabel(q: DraftQuestion): string {
	return Q_TYPES.find(d => d.key === q._type)?.label ?? q._type;
}

function chips(parent: HTMLElement, deps: VarianteDeps, withModel = false): void {
	const row = ajouter(parent, "div", "qbd-essai-chips");
	ajouter(row, "span", "qbd-essai-chip is-accent", quizModeLabel(deps.quiz.mode));
	ajouter(row, "span", "qbd-essai-chip", t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));
	ajouter(row, "span", "qbd-essai-chip", quizTypeLabel(deps.quiz.quizType));
	if (withModel && deps.quiz.generated) ajouter(row, "span", "qbd-essai-chip", deps.quiz.generated.model);
}

function progression(parent: HTMLElement, deps: VarianteDeps): void {
	const total = deps.stat.totalQuestions || deps.quiz.questions;
	const done = Math.min(deps.stat.questionsDone, total);
	const wrap = ajouter(parent, "div", "qbd-essai-progress");
	const bar = ajouter(wrap, "div", "qbd-qz-welcome-bar");
	ajouter(bar, "div", "qbd-qz-welcome-fill").style.width = `${total > 0 ? Math.round(done / total * 100) : 0}%`;
	ajouter(wrap, "span", "qbd-essai-small", t("dashboard.quiz.welcomeProgress", { done, total }));
}

function startButton(parent: HTMLElement, deps: VarianteDeps, label: string, big = true): HTMLButtonElement {
	const btn = ajouter(parent, "button", "qbd-btn--create qbd-essai-start" + (big ? " is-big" : ""));
	btn.type = "button";
	icone(btn, "play", "qbd-btn-icon");
	ajouter(btn, "span", undefined, label);
	btn.addEventListener("click", () => deps.onStart(btn));
	return btn;
}

/** Vignette cliquable d'une question : numéro, texte, type. */
function vignette(parent: HTMLElement, q: DraftQuestion, i: number, deps: VarianteDeps): void {
	const card = ajouter(parent, "button", "qbd-essai-q");
	card.type = "button";
	ajouter(card, "span", "qbd-qz-card-num", String(i + 1));
	const body = ajouter(card, "span", "qbd-essai-q-body");
	texte(body, "span", "qbd-essai-q-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
	ajouter(body, "span", "qbd-essai-q-type", typeLabel(q));
	card.addEventListener("click", () => deps.onOpenQuestion(i));
}

/** La SOLUTION d'une question, en lignes de texte ; `ok` marque la bonne
    option quand la question en a plusieurs. */
function solution(q: DraftQuestion): Array<{ text: string; ok: boolean }> {
	const opts = q.options ?? [];
	switch (q._type) {
		case "single":
			return opts.map((o, i) => ({ text: o, ok: i === q.correctIndex }));
		case "multi":
			return opts.map((o, i) => ({ text: o, ok: !!q.correctIndices?.includes(i) }));
		case "ordering": {
			const pos = q.possibilities ?? [];
			return (q.correctOrder ?? []).map((idx, i) => ({ text: `${q.slots?.[i] ? q.slots[i] + " → " : `${i + 1}. `}${pos[idx] ?? ""}`, ok: true }));
		}
		case "matching": {
			const ch = q.choices ?? [];
			return (q.rows ?? []).map((r, i) => ({ text: `${r} → ${ch[q.correctMap?.[i] ?? -1] ?? "?"}`, ok: true }));
		}
		case "cloze": {
			const trous = [...(q.cloze ?? "").matchAll(/\{\{([^}]*)\}\}/g)].map(m => m[1].split("|")[0].trim()).filter(Boolean);
			return trous.map(x => ({ text: x, ok: true }));
		}
		default: {
			const unit = q.unit ? ` ${q.unit}` : "";
			return (q.acceptedAnswers ?? []).filter(a => a.trim()).map(a => ({ text: a + unit, ok: true }));
		}
	}
}

/* ── A · Couverture (Lumni) ── */
function renderA(root: HTMLElement, deps: VarianteDeps): void {
	const hero = ajouter(root, "div", "qbd-essai-hero");
	const glyph = ajouter(hero, "div", "qbd-essai-glyph");
	icone(glyph, quizTypeIcon(deps.quiz.quizType));
	const info = ajouter(hero, "div", "qbd-essai-grow");
	ajouter(info, "h2", "qbd-essai-hero-title", deps.quiz.title);
	chips(info, deps);
	const actions = ajouter(info, "div", "qbd-essai-hero-actions");
	startButton(actions, deps, t("dashboard.quiz.welcomeStart"));
	const total = deps.stat.totalQuestions || deps.quiz.questions;
	ajouter(actions, "span", "qbd-essai-small", t("dashboard.quiz.welcomeProgress", { done: Math.min(deps.stat.questionsDone, total), total }));

	ajouter(root, "div", "qbd-essai-label", t("dashboard.essai.aWhatsInside"));
	const grid = ajouter(root, "div", "qbd-essai-grid");
	deps.questions.forEach((q, i) => vignette(grid, q, i, deps));
}

/* ── B · Choix d'activité (Quizlet) ── */
function renderB(root: HTMLElement, deps: VarianteDeps): void {
	const modes = ajouter(root, "div", "qbd-essai-modes");
	const mode = (icon: string, title: TransKey, desc: TransKey, onClick?: (el: HTMLElement) => void): void => {
		const el = ajouter(modes, "button", "qbd-essai-mode" + (onClick ? " is-main" : " is-soon"));
		el.type = "button";
		icone(ajouter(el, "span", "qbd-essai-mode-ic"), icon);
		const head = ajouter(el, "span", "qbd-essai-mode-head");
		ajouter(head, "b", undefined, t(title));
		if (!onClick) ajouter(head, "span", "qbd-essai-soon", t("dashboard.essai.soon"));
		ajouter(el, "span", "qbd-essai-small", t(desc));
		if (onClick) el.addEventListener("click", () => onClick(el));
		else el.disabled = true;
	};
	mode("play", "dashboard.essai.bPlay", "dashboard.essai.bPlayDesc", (el) => deps.onStart(el));
	mode("layers", "dashboard.essai.bCards", "dashboard.essai.bCardsDesc");
	mode("rotate-ccw", "dashboard.essai.bMistakes", "dashboard.essai.bMistakesDesc");

	// La carte qui défile : l'énoncé, puis sa solution au clic.
	let idx = 0;
	let shown = false;
	const card = ajouter(root, "div", "qbd-essai-flash");
	const nav = ajouter(root, "div", "qbd-essai-flash-nav");
	const prev = ajouter(nav, "button", "qbd-qz-nav-btn");
	prev.type = "button";
	currentHost().ui.setIcon(prev, "chevron-left");
	const pos = ajouter(nav, "span", "qbd-essai-small");
	const next = ajouter(nav, "button", "qbd-qz-nav-btn");
	next.type = "button";
	currentHost().ui.setIcon(next, "chevron-right");
	const reveal = ajouter(nav, "button", "qbd-essai-link");
	reveal.type = "button";
	icone(reveal, "eye");
	const revealLabel = ajouter(reveal, "span");

	const paint = (): void => {
		const q = deps.questions[idx];
		card.replaceChildren();
		if (!q) return;
		ajouter(card, "span", "qbd-essai-q-type", typeLabel(q));
		texte(card, "div", "qbd-essai-flash-text", questionText(q));
		if (shown) {
			const sol = ajouter(card, "div", "qbd-essai-sol");
			for (const s of solution(q).filter(s => s.ok)) texte(sol, "div", "qbd-essai-sol-line is-ok", s.text);
		}
		pos.textContent = `${idx + 1} / ${deps.questions.length}`;
		prev.disabled = idx === 0;
		next.disabled = idx >= deps.questions.length - 1;
		revealLabel.textContent = t(shown ? "dashboard.essai.hideAnswer" : "dashboard.essai.showAnswer");
	};
	prev.addEventListener("click", () => { idx--; shown = false; paint(); });
	next.addEventListener("click", () => { idx++; shown = false; paint(); });
	reveal.addEventListener("click", () => { shown = !shown; paint(); });
	card.addEventListener("click", () => { shown = !shown; paint(); });
	paint();
}

/* ── C · Fiche + questions (Wayground) ── */
function renderC(root: HTMLElement, deps: VarianteDeps): void {
	const side = ajouter(root, "aside", "qbd-essai-side");
	const cover = ajouter(side, "div", "qbd-essai-cover");
	icone(cover, quizTypeIcon(deps.quiz.quizType));
	ajouter(side, "h2", "qbd-essai-side-title", deps.quiz.title);
	chips(side, deps, true);
	progression(side, deps);
	startButton(side, deps, t("dashboard.quiz.welcomeStart"));

	const main = ajouter(root, "div", "qbd-essai-grow qbd-essai-list");
	const bar = ajouter(main, "div", "qbd-essai-list-head");
	ajouter(bar, "span", "qbd-essai-small", t(deps.questions.length === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.questions.length }));
	const toggle = ajouter(bar, "label", "qbd-essai-toggle");
	ajouter(toggle, "span", undefined, t("dashboard.essai.cShowAnswers"));
	const input = ajouter(toggle, "input");
	input.type = "checkbox";
	ajouter(toggle, "span", "qbd-essai-switch");

	const items = ajouter(main, "div", "qbd-essai-list-items");
	const paint = (): void => {
		items.replaceChildren();
		deps.questions.forEach((q, i) => {
			const card = ajouter(items, "button", "qbd-essai-full");
			card.type = "button";
			const top = ajouter(card, "span", "qbd-essai-full-top");
			ajouter(top, "span", undefined, `${i + 1} · ${typeLabel(q)}`);
			texte(card, "p", "qbd-essai-full-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
			const sol = solution(q);
			if (sol.length) {
				const opts = ajouter(card, "span", "qbd-essai-opts");
				for (const s of sol) {
					const ok = input.checked && s.ok;
					const line = ajouter(opts, "span", "qbd-essai-opt" + (ok ? " is-ok" : ""));
					icone(line, ok ? "check" : "circle");
					texte(line, "span", "", s.text);
					if (!input.checked && (q._type !== "single" && q._type !== "multi")) line.classList.add("is-hidden");
				}
			}
			card.addEventListener("click", () => deps.onOpenQuestion(i));
		});
	};
	input.addEventListener("change", paint);
	paint();
}

