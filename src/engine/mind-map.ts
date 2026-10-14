/**
 * The MIND MAP of a Learn's summary (2026-10-14, spec
 * 2026-10-14-learn-active-memory §4): the quiz at the centre, one branch per
 * step titled by its reading, the step's key points as leaves. Leaves start
 * hidden: the learner recalls what each branch holds, then taps to check.
 * PURE (no DOM, no i18n): the caller gives the inline door and the labels.
 */
import { retenirDeLecture } from "../lecture-style";
import { STEP_HUES, stepHue, type StepSlide } from "./step-page";

export interface MindBranch { step: number; hue: number; title: string; leaves: string[] }

/** Leaves per branch: a branch that lists more is a page, not a recall aid. */
const MAX_LEAVES = 5;

/** One branch per step, in step order. A step without a reading keeps its
    branch (titled by its number) with no leaves. */
export function mindMapModel(slides: readonly StepSlide[], quiz: readonly unknown[]): MindBranch[] {
	return slides.map(s => {
		const read = s.reads.length > 0 ? (quiz[s.reads[0]] as { title?: unknown } | undefined) : undefined;
		const title = typeof read?.title === "string" ? read.title.trim() : "";
		const r = read ? retenirDeLecture(read) : null;
		const leaves = !r ? [] : r.forme === "cartes" ? r.items.map(c => c.recto) : r.items;
		return { step: s.step, hue: stepHue(s.step), title, leaves: leaves.slice(0, MAX_LEAVES) };
	});
}

/** The map's HTML, or "" with no branch. Every author text (centre, titles,
    leaves) goes through `inline`, the inline door of the engine. */
export function mindMapHtml(branches: readonly MindBranch[], centre: string, inline: (s: string) => string, labels: { title: string; hint: string; showAll: string; leafAria: string }): string {
	if (branches.length === 0) return "";
	const branch = (b: MindBranch) => {
		const leaves = b.leaves.length
			? `<div class="quiz-mindmap-leaves">${b.leaves.map(l => `<button type="button" class="quiz-mindmap-leaf" aria-pressed="false" aria-label="${inline(labels.leafAria)}"><span>${inline(l)}</span></button>`).join("")}</div>`
			: "";
		return `<li class="quiz-mindmap-branch" data-step="${b.step}" style="--quiz-step-h:${STEP_HUES[b.hue]}"><div class="quiz-mindmap-branch-title">${b.title ? inline(b.title) : String(b.step)}</div>${leaves}</li>`;
	};
	return `<section class="quiz-mindmap"><h3>${inline(labels.title)}</h3><p class="quiz-mindmap-hint">${inline(labels.hint)}</p><div class="quiz-mindmap-centre">${inline(centre)}</div><ul class="quiz-mindmap-branches">${branches.map(branch).join("")}</ul><button type="button" class="quiz-action-btn quiz-mindmap-show-all">${inline(labels.showAll)}</button></section>`;
}
