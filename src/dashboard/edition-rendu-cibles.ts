import { t } from "../i18n";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import type { DraftQuestion } from "../editor/utils";

/* ══════════════════════════════════════════════════════════
   CE QUE DÉSIGNE UN TEXTE DU RENDU CORRIGÉ

   Sorti d'`edition-rendu.ts` (tâche 5) : la correspondance entre un élément
   `data-edit` du rendu et le champ du brouillon qu'il montre — lire sa
   valeur SOURCE, l'écrire par les mêmes setters que le formulaire — plus
   les emplacements VIDES (énoncé, explication absents), sans lesquels un
   texte qui n'existe pas encore ne pouvait pas se créer depuis le rendu.
══════════════════════════════════════════════════════════ */

/** Ce qu'un élément `data-edit` désigne dans le brouillon. */
export interface Cible { champ: string; index: number }

/** Les textes LONGS : champ multiligne, barre de mise en forme au-dessus. */
export const MULTILIGNES = new Set(["prompt", "explain", "answer", "cloze"]);

export function lireCible(el: HTMLElement): Cible | null {
	const champ = el.getAttribute("data-edit");
	if (!champ) return null;
	return { champ, index: Number(el.getAttribute("data-index") ?? "0") || 0 };
}

/** Le texte SOURCE que désigne une cible — ce que le formulaire montrerait. */
export function valeurSource(q: DraftQuestion, c: Cible): string {
	const de = (liste: string[] | undefined): string => (liste || [])[c.index] ?? "";
	switch (c.champ) {
		case "title": return q.title || "";
		case "prompt": return q.prompt || "";
		case "explain": return q.explain || "";
		case "answer": return q.answer || "";
		case "cloze": return q.cloze || "";
		case "option": return de(q.options);
		case "slot": return de(q.slots);
		case "possibility": return de(q.possibilities);
		case "row": return de(q.rows);
		case "choice": return de(q.choices);
		case "accepted": return de(q.acceptedAnswers);
		default: return "";
	}
}

/** Écrit `v` dans le brouillon, par les mêmes setters que le formulaire. */
export function ecrire(q: DraftQuestion, c: Cible, v: string): void {
	const dans = (liste: string[]): void => { liste[c.index] = v; };
	switch (c.champ) {
		case "title":
			q.title = v;
			// Un titre SAISI est un titre d'auteur : sans ce drapeau, le prochain
			// réordonnancement le remplacerait par « Question N ».
			q._userModifiedTitle = true;
			return;
		case "prompt":
			// Même règle que l'ancien champ d'énoncé : le texte de l'auteur fait
			// foi, le HTML pré-rendu d'un import lui cède la place.
			q.prompt = v;
			q._promptSource = true;
			q._useHtmlPrompt = false;
			delete q._promptHtml;
			return;
		case "explain":
			q.explain = v;
			delete q._explainHtml;
			return;
		case "answer": q.answer = v; return;
		case "cloze": q.cloze = v; return;
		case "option": dans(q.options ||= []); return;
		case "slot": dans(q.slots ||= []); return;
		case "possibility": dans(q.possibilities ||= []); return;
		case "row": dans(q.rows ||= []); return;
		case "choice": dans(q.choices ||= []); return;
		case "accepted": dans(q.acceptedAnswers ||= []); return;
	}
}

export function selecteur(c: Cible): string {
	return `[data-edit="${c.champ}"]` + (c.champ === "title" || MULTILIGNES.has(c.champ) ? "" : `[data-index="${c.index}"]`);
}

/** Un emplacement VIDE : une ligne discrète (icône « + » et libellé), qui
    porte le `data-edit` du texte absent — le clic l'ouvre comme n'importe
    quel texte, et une validation à vide le laisse en place. */
function vide(champ: string, libelle: string): HTMLElement {
	const el = document.createElement("div");
	el.className = "qb-er-vide";
	el.setAttribute("data-edit", champ);
	currentHost().ui.setIcon(ajouter(el, "span", "qb-er-vide-icone"), "plus");
	ajouter(el, "span", "qb-er-vide-texte", libelle);
	return el;
}

/**
 * Pose sur la carte les emplacements des textes ABSENTS : l'énoncé (après le
 * titre et le bouton de ressource, là où le moteur le mettrait) et
 * l'explication (en fin de carte). Un `*Html` compte comme présent : il se
 * modifie dans « Plus ».
 */
export function poserVides(carte: HTMLElement, q: DraftQuestion): void {
	if (!q.prompt && !q._promptHtml && !carte.querySelector(".quiz-question")) {
		const apres = carte.querySelector(":scope > .quiz-resource-btn") ?? carte.querySelector(":scope > h2");
		const el = vide("prompt", t("editor.render.addPrompt"));
		if (apres) apres.after(el); else carte.prepend(el);
	}
	if (!q._explainHtml && !(q.explain && q.explain.trim())) {
		carte.appendChild(vide("explain", t("editor.render.addExplain")));
	}
}
