import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { decouperInline } from "../engine/grammaire-inline";
import type { GenreSegment, SegmentInline } from "../engine/grammaire-inline";
import { hasMath, mathifyElement } from "../engine/mathjax";

/* ══════════════════════════════════════════════════════════
   DÉCORATIONS du champ à aperçu en direct (editor/champ-direct.ts)

   Comme Obsidian : le texte s'affiche RENDU — code en pastille, gras,
   italique, formule — et les marqueurs markdown (`` ` ``, `**`, `*`, `$`)
   ne réapparaissent que lorsque le curseur ou la sélection touche le
   segment. Le DOCUMENT, lui, reste toujours la source : seules des
   décorations la recouvrent, la valeur enregistrée ne change pas.

   Les segments viennent de `decouperInline`, la grammaire du rendu du quiz
   (engine/grammaire-inline.ts) : le champ ne peut pas rendre en italique ce
   que le quiz laisserait tel quel.
══════════════════════════════════════════════════════════ */

/** Le contenu d'un segment, stylé comme dans le quiz. Le code porte la
    balise `<code>` : la pastille est la MÊME règle que celle du quiz
    (`.quiz-question code`, components/quiz-card.css). */
const STYLE: Record<Exclude<GenreSegment, "formule">, Decoration> = {
	code: Decoration.mark({ tagName: "code", class: "qb-direct-code" }),
	gras: Decoration.mark({ tagName: "strong" }),
	italique: Decoration.mark({ tagName: "em" }),
	grasItalique: Decoration.mark({ tagName: "strong", class: "qb-direct-gras-italique" }),
	barre: Decoration.mark({ tagName: "del" }),
};
const MASQUE = Decoration.replace({});
/** Marqueurs visibles (curseur dans le segment) : discrets, comme Obsidian. */
const MARQUEUR = Decoration.mark({ class: "qb-direct-marqueur" });
/** Source d'une formule en cours d'édition. */
const SOURCE_FORMULE = Decoration.mark({ class: "qb-direct-formule-source" });

/** Une formule rendue par le MÊME chemin que le quiz : `mathifyElement` sur
    sa source, qui passe par le rendu de l'hôte. Un LaTeX invalide y reste
    en texte — la dégradation du quiz. */
class WidgetFormule extends WidgetType {
	constructor(readonly source: string) { super(); }
	eq(autre: WidgetFormule): boolean { return autre.source === this.source; }
	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = "qb-direct-formule";
		el.textContent = this.source;
		void mathifyElement(el);
		return el;
	}
	/* Faux : un clic sur la formule place le curseur à côté, ce qui la
	   rouvre en source — c'est le geste d'Obsidian. */
	ignoreEvent(): boolean { return false; }
}

/** Le curseur (ou une sélection) touche-t-il le segment ? Bords compris :
    un curseur collé à l'accent grave fermant rouvre le code. */
function actif(s: SegmentInline, vue: EditorView): boolean {
	if (!vue.hasFocus) return false;
	return vue.state.selection.ranges.some(r => r.from <= s.fin && r.to >= s.debut);
}

function construire(vue: EditorView): DecorationSet {
	const texte = vue.state.doc.toString();
	const deco: Range<Decoration>[] = [];
	for (const s of decouperInline(texte)) {
		const dedans = [s.debut + s.ouvre, s.fin - s.ferme] as const;
		const ouvert = actif(s, vue);
		if (s.genre === "formule") {
			const source = texte.slice(s.debut, s.fin);
			/* Rendue seulement si le rendu du quiz la rendrait : `hasMath`
			   (sa segmentation, celle de `check:math-render`) et sur une seule
			   ligne — le quiz coupe le texte à chaque `<br>`, et une
			   décoration de plugin ne peut pas remplacer un saut de ligne. */
			const rendue = hasMath(source) && !source.includes("\n");
			if (!ouvert && rendue) {
				deco.push(Decoration.replace({ widget: new WidgetFormule(source) }).range(s.debut, s.fin));
			} else {
				deco.push(SOURCE_FORMULE.range(s.debut, s.fin));
			}
			continue;
		}
		if (dedans[1] > dedans[0]) deco.push(STYLE[s.genre].range(dedans[0], dedans[1]));
		if (s.genre === "grasItalique" && dedans[1] > dedans[0]) {
			deco.push(Decoration.mark({ tagName: "em" }).range(dedans[0], dedans[1]));
		}
		const bouts: Array<[number, number]> = [[s.debut, dedans[0]], [dedans[1], s.fin]];
		for (const [d, f] of bouts) deco.push((ouvert ? MARQUEUR : MASQUE).range(d, f));
	}
	return Decoration.set(deco, true);
}

/** Recalculé à chaque frappe, déplacement du curseur ou changement de
    focus : les champs d'un quiz sont courts, un découpage complet coûte
    moins qu'une mise à jour incrémentale à maintenir. */
export const decorationsDirectes = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(vue: EditorView) { this.decorations = construire(vue); }
	update(u: ViewUpdate): void {
		if (u.docChanged || u.selectionSet || u.focusChanged) this.decorations = construire(u.view);
	}
}, { decorations: v => v.decorations });
