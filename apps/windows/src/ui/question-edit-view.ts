/* ══════════════════════════════════════════════════════════
   THE BEFORE/AFTER OF A QUESTION THE ASSISTANT PROPOSES TO CHANGE (2026-10-09)

   Painted inside the proposal box of the chat (`explain.ts`), above its
   "Apply to the question" button. A change of the RIGHT answer comes first and
   stands out: the learner must never apply one without seeing it. Each changed
   field then shows its old text, struck through, and its new one.

   Every text goes through `renderMarkdownPreview`, which escapes before it
   renders: the values are the model's, and an HTML field arrives here as plain
   text (`question-edit.ts` `shown`), already sanitized for the write.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { renderMarkdownPreview } from "../../../../src/markdown-preview";
import { mathifyElement } from "../../../../src/engine/mathjax";
import type { AnswerChange, QuestionEditRow } from "../../../../src/question-edit";

/** The label of a field, whatever its stored form. */
function libelle(field: string): string {
	const base = field.replace(/Html$/, "");
	switch (base) {
		case "title": return t("ai.explain.question.field.title");
		case "prompt": return t("ai.explain.question.field.prompt");
		case "explain": return t("ai.explain.question.field.explain");
		case "hint": return t("ai.explain.question.field.hint");
		case "options": case "option": return t("ai.explain.question.field.options");
		case "answer": case "correctText": return t("ai.explain.question.field.answer");
		case "acceptedAnswers": case "acceptableAnswers": case "correctAnswers": return t("ai.explain.question.field.accepted");
		case "cloze": return t("ai.explain.question.field.cloze");
		case "possibilities": return t("ai.explain.question.field.items");
		case "slots": return t("ai.explain.question.field.slots");
		case "rows": return t("ai.explain.question.field.rows");
		case "choices": return t("ai.explain.question.field.choices");
		default: return field;
	}
}

export function peindreAvantApres(boite: HTMLElement, v: { rows: QuestionEditRow[]; answerChange: AnswerChange | null }): void {
	const zone = ajouter(boite, "div", "qbd-ai-preview-md markdown-preview-view nq-qedit");
	if (v.answerChange) {
		const r = ajouter(zone, "div", "nq-qedit-reponse");
		ajouter(r, "div", "nq-qedit-reponse-titre", t("ai.explain.question.answerChange"));
		const ligne = ajouter(r, "div", "nq-qedit-reponse-ligne");
		ajouter(ligne, "span", "nq-qedit-avant").innerHTML = renderMarkdownPreview(v.answerChange.from);
		ajouter(ligne, "span", "nq-qedit-fleche", t("ai.explain.question.becomes"));
		ajouter(ligne, "span", "nq-qedit-apres").innerHTML = renderMarkdownPreview(v.answerChange.to);
	}
	for (const row of v.rows) {
		const bloc = ajouter(zone, "div", "nq-qedit-champ");
		ajouter(bloc, "div", "nq-qedit-libelle", libelle(row.field));
		const avant = ajouter(bloc, "div", "nq-qedit-avant");
		ajouter(avant, "span", "nq-qedit-tag", t("ai.explain.question.before"));
		ajouter(avant, "div").innerHTML = row.before ? renderMarkdownPreview(row.before) : "";
		const apres = ajouter(bloc, "div", "nq-qedit-apres");
		ajouter(apres, "span", "nq-qedit-tag", t("ai.explain.question.after"));
		ajouter(apres, "div").innerHTML = renderMarkdownPreview(row.after);
	}
	if (zone.textContent?.includes("$")) void mathifyElement(zone);
}
