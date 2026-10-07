/* ══════════════════════════════════════════════════════════
   THE CLARIFYING CARD of a vague request (spec 2026-10-07-generate-auto-kind)

   Works like Claude Code's AskUserQuestion, in the chat thread under the
   request (a tile, not a modal): a header chip, the question, then a
   NUMBERED list of options, each a label with a one-line description, and
   last the app's own "Type something" option which becomes an inline field.
   Several questions follow one another in the same card ("1/2"); answered
   ones collapse to "Question → Answer". A multiple-answer question toggles
   its rows and ends with "Confirm".

   Keyboard: ↑/↓ move the highlight, Enter picks, 1–9 pick directly, Esc
   skips the question (an empty answer: the generation goes on without that
   precision). Focus goes to the first option when the card appears. When
   every question is answered or skipped, `repondre` starts the generation.
   Read back from the record (or once answered) the card is read-only.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import type { ChatClarify } from "./chat-record";
import type { ClarifyQuestion } from "./generation-kind";

/** The progress of a card still waiting, by request id: the thread repaints
    as the queue moves, and a repaint must not send the user back to step 1. */
const progres = new Map<string, { index: number; reponses: string[][]; envoye: boolean }>();

export function peindreQuestions(parent: HTMLElement, clarify: ChatClarify, repondre?: (answers: string[][]) => void, cle?: string): void {
	const host = currentHost();
	const questions = clarify.questions;
	const carte = ajouter(parent, "div", "qbd-ai-kind");
	carte.setAttribute("role", "group");
	carte.setAttribute("aria-label", questions.map(q => q.question).join(" "));

	const resume = (zone: HTMLElement, q: ClarifyQuestion, reponse: string[]): void => {
		const ligne = ajouter(zone, "div", "qbd-ai-kind-resume");
		if (q.header) ajouter(ligne, "span", "qbd-ai-kind-chip", q.header);
		ajouter(ligne, "span", "qbd-ai-kind-resume-q", q.question);
		host.ui.setIcon(ajouter(ligne, "span", "qbd-ai-kind-fleche"), "arrow-right");
		const r = ajouter(ligne, "span", "qbd-ai-kind-resume-r", reponse.length ? reponse.join(", ") : t("ai.clarify.skipped"));
		r.classList.toggle("is-skipped", reponse.length === 0);
	};

	const dejaRepondu = !!clarify.answers || !repondre || !cle;
	if (dejaRepondu) {
		carte.classList.add("is-answered");
		questions.forEach((q, i) => resume(carte, q, clarify.answers?.[i] ?? []));
		return;
	}
	const etat = progres.get(cle) ?? { index: 0, reponses: [], envoye: false };
	progres.set(cle, etat);

	const peindre = (): void => {
		carte.replaceChildren();
		for (let i = 0; i < Math.min(etat.index, questions.length); i++) resume(carte, questions[i], etat.reponses[i] ?? []);
		if (etat.index >= questions.length) {
			carte.classList.add("is-answered");
			if (!etat.envoye) {
				etat.envoye = true;
				repondre(questions.map((_, i) => etat.reponses[i] ?? []));
			}
			return;
		}
		peindreEtape(carte, questions[etat.index], etat.index, questions.length, (reponse) => {
			etat.reponses[etat.index] = reponse;
			etat.index++;
			peindre();
		});
	};
	peindre();
}

/** One step: the question and its rows, with the keyboard. `fini` receives the
    answer (an empty list when skipped). */
function peindreEtape(carte: HTMLElement, q: ClarifyQuestion, index: number, total: number, fini: (reponse: string[]) => void): void {
	const host = currentHost();
	const tete = ajouter(carte, "div", "qbd-ai-kind-tete");
	if (q.header) ajouter(tete, "span", "qbd-ai-kind-chip", q.header);
	if (total > 1) ajouter(tete, "span", "qbd-ai-kind-etape", `${index + 1}/${total}`);
	ajouter(carte, "div", "qbd-ai-kind-question", q.question);
	const liste = ajouter(carte, "div", "qbd-ai-kind-options");
	liste.setAttribute("role", q.multiple ? "group" : "listbox");
	const choisies = new Set<string>();
	const lignes: HTMLElement[] = [];
	const nbLignes = q.options.length + 1;
	let actif = 0;
	let autreOuvert = false;
	let champ: HTMLInputElement | null = null;
	let termine = false;

	const marquer = (): void => {
		lignes.forEach((l, i) => {
			l.classList.toggle("is-active", i === actif);
			if (i < q.options.length) {
				const on = choisies.has(q.options[i].label);
				l.classList.toggle("is-chosen", on);
				l.setAttribute("aria-pressed", String(on));
				l.querySelector(".qbd-ai-kind-check")?.classList.toggle("is-on", on);
			}
		});
	};
	const finir = (reponse: string[]): void => {
		if (termine) return;
		termine = true;
		fini(reponse);
	};
	const valider = (texte?: string): void => {
		const liste = [...choisies];
		const libre = (texte ?? "").trim();
		if (libre) liste.push(libre);
		if (liste.length === 0) return;
		finir(liste);
	};
	const activer = (i: number): void => {
		if (termine) return;
		actif = i;
		if (i === q.options.length) { ouvrirAutre(); return; }
		const label = q.options[i].label;
		if (q.multiple) {
			if (choisies.has(label)) choisies.delete(label); else choisies.add(label);
			marquer();
			lignes[i].focus({ preventScroll: true });
			return;
		}
		finir([label]);
	};

	const numero = (ligne: HTMLElement, i: number): void => { ajouter(ligne, "span", "qbd-ai-kind-num", `${i + 1}.`); };
	q.options.forEach((o, i) => {
		const b = ajouter(liste, "button", "qbd-ai-kind-option");
		b.type = "button";
		numero(b, i);
		const corps = ajouter(b, "span", "qbd-ai-kind-corps");
		ajouter(corps, "span", "qbd-ai-kind-label", o.label);
		if (o.description) ajouter(corps, "span", "qbd-ai-kind-desc", o.description);
		if (q.multiple) host.ui.setIcon(ajouter(b, "span", "qbd-ai-kind-check"), "check");
		b.addEventListener("click", () => activer(i));
		b.addEventListener("focus", () => { actif = i; marquer(); });
		lignes.push(b);
	});
	// The app's own last option: "Type something", an inline field once picked.
	const iAutre = q.options.length;
	// A div, not a button: it holds a text field once opened.
	const autre = ajouter(liste, "div", "qbd-ai-kind-option qbd-ai-kind-autre");
	autre.tabIndex = 0;
	autre.setAttribute("role", "button");
	autre.addEventListener("keydown", (e) => {
		if (e.target === autre && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); activer(iAutre); }
	});
	numero(autre, iAutre);
	ajouter(ajouter(autre, "span", "qbd-ai-kind-corps"), "span", "qbd-ai-kind-label", t("ai.clarify.other"));
	autre.addEventListener("click", () => activer(iAutre));
	autre.addEventListener("focus", () => { actif = iAutre; marquer(); });
	lignes.push(autre);

	const ouvrirAutre = (): void => {
		if (autreOuvert) { champ?.focus(); return; }
		autreOuvert = true;
		autre.replaceChildren();
		numero(autre, iAutre);
		champ = ajouter(autre, "input", "qbd-ai-kind-champ");
		champ.type = "text";
		champ.placeholder = t("ai.clarify.otherPlaceholder");
		champ.setAttribute("aria-label", t("ai.clarify.other"));
		// A row holding a field: clicks go to the field, not back to the row.
		autre.addEventListener("click", (e) => { if (e.target === champ) e.stopPropagation(); }, true);
		champ.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				const v = champ?.value.trim() ?? "";
				if (!v) return;
				if (q.multiple) valider(v); else finir([v]);
			} else if (e.key === "Escape") {
				// Esc inside the field gives the list back; a second Esc skips.
				e.preventDefault();
				e.stopPropagation();
				autreOuvert = false;
				autre.replaceChildren();
				numero(autre, iAutre);
				ajouter(ajouter(autre, "span", "qbd-ai-kind-corps"), "span", "qbd-ai-kind-label", t("ai.clarify.other"));
				champ = null;
				autre.focus({ preventScroll: true });
			} else e.stopPropagation();
		});
		champ.focus({ preventScroll: true });
		marquer();
	};

	if (q.multiple) {
		const ok = ajouter(carte, "button", "qbd-ai-kind-ok", t("ai.clarify.validate"));
		ok.type = "button";
		ok.addEventListener("click", () => valider(champ?.value));
	}
	ajouter(carte, "div", "qbd-ai-kind-aide", t("ai.clarify.hint"));

	carte.tabIndex = -1;
	carte.addEventListener("keydown", (e) => {
		if (termine || (e.target instanceof HTMLInputElement)) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			actif = (actif + (e.key === "ArrowDown" ? 1 : -1) + nbLignes) % nbLignes;
			lignes[actif].focus({ preventScroll: true });
			marquer();
		} else if (/^[1-9]$/.test(e.key) && Number(e.key) <= nbLignes) {
			e.preventDefault();
			activer(Number(e.key) - 1);
		} else if (e.key === "Escape") {
			e.preventDefault();
			finir([]);
		}
	});
	marquer();
	// Focus goes to the first option when the card appears.
	// The page may hand the focus back to the composer as it is redrawn: ask again a moment later.
	const focus = (): void => { if (carte.isConnected && !termine && !carte.contains(document.activeElement)) lignes[actif]?.focus({ preventScroll: true }); };
	requestAnimationFrame(focus);
	window.setTimeout(focus, 150);
}
