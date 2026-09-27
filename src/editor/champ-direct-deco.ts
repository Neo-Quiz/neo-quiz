import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { decouperInline } from "../engine/grammaire-inline";
import type { GenreSegment, SegmentInline } from "../engine/grammaire-inline";
import { aDesBlocs, decouperBlocs } from "../engine/grammaire-blocs";
import type { Zone } from "../engine/grammaire-blocs";
import { hasMath, mathifyElement } from "../engine/mathjax";

/* ══════════════════════════════════════════════════════════
   DÉCORATIONS du champ à aperçu en direct (editor/champ-direct.ts)

   Comme Obsidian : le texte s'affiche RENDU — code en pastille, gras,
   italique, formule — et les marqueurs markdown (`` ` ``, `**`, `*`, `$`)
   ne réapparaissent que lorsque le curseur ou la sélection touche le
   segment. Le DOCUMENT, lui, reste toujours la source : seules des
   décorations la recouvrent, la valeur enregistrée ne change pas.

   Les segments viennent de `decouperInline` et `decouperBlocs`, les
   grammaires du rendu du quiz (engine/grammaire-inline.ts,
   engine/grammaire-blocs.ts) : le champ ne peut pas rendre en italique ce
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

/* ── Les BLOCS (2026-09-26) ──
   Les mêmes que le quiz (engine/grammaire-blocs.ts) : chaque ligne d'un bloc
   reçoit sa classe — police de code dans un bloc ```…```, retrait d'une
   liste, tableau aligné —, et le marqueur d'une liste, d'un titre ou d'une
   citation s'efface hors du curseur, comme l'emphase. L'inline n'est
   découpé que DANS les zones que le rendu passe à l'inline : jamais dans un
   bloc de code. */
const LIGNE_CODE = Decoration.line({ class: "qb-direct-bloc-code" });
const LIGNE_CLOTURE = Decoration.line({ class: "qb-direct-bloc-code qb-direct-cloture" });
const LIGNE_TABLEAU = Decoration.line({ class: "qb-direct-tableau" });
const LIGNE_CITATION = Decoration.line({ class: "qb-direct-citation" });
const ligneTitre = (n: number): Decoration => Decoration.line({ class: `qb-direct-titre qb-direct-titre-${n}` });
const ligneListe = (indent: number): Decoration =>
	Decoration.line({ class: "qb-direct-liste", attributes: { style: `padding-left: ${1.1 + indent * 0.55}em` } });

/** La puce ou le numéro d'une liste, à la place de son marqueur. */
class WidgetPuce extends WidgetType {
	constructor(readonly texte: string) { super(); }
	eq(autre: WidgetPuce): boolean { return autre.texte === this.texte; }
	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = "qb-direct-puce";
		el.textContent = this.texte;
		return el;
	}
	ignoreEvent(): boolean { return false; }
}

/** Le curseur est-il sur l'une des lignes `[debut, fin]` ? */
function surLignes(debut: number, fin: number, vue: EditorView): boolean {
	if (!vue.hasFocus) return false;
	return vue.state.selection.ranges.some(r => r.from <= fin && r.to >= debut);
}

/** Les décorations de ligne et de marqueur des blocs ; rend les zones à
    découper en inline. */
function decorerBlocs(texte: string, vue: EditorView, deco: Range<Decoration>[]): Zone[] {
	const blocs = decouperBlocs(texte);
	// Texte simple : tout est inline, comme au rendu (règle de compatibilité).
	if (!aDesBlocs(blocs)) return [{ debut: 0, fin: texte.length }];
	const doc = vue.state.doc;
	const lignes = (d: number, f: number, dec: Decoration): void => {
		for (let n = doc.lineAt(d).number; n <= doc.lineAt(f).number; n++) deco.push(dec.range(doc.line(n).from));
	};
	const marqueur = (z: Zone, actif: boolean, remplacement?: WidgetType): void => {
		if (z.fin <= z.debut) return;
		if (actif) deco.push(MARQUEUR.range(z.debut, z.fin));
		else deco.push((remplacement ? Decoration.replace({ widget: remplacement }) : MASQUE).range(z.debut, z.fin));
	};
	const zones: Zone[] = [];
	for (const b of blocs) {
		switch (b.genre) {
			case "paragraphe": zones.push(b.zone); break;
			case "titre":
				lignes(b.debut, b.fin, ligneTitre(b.niveau));
				marqueur(b.marqueur, surLignes(b.debut, b.fin, vue));
				zones.push(b.zone);
				break;
			case "citation":
				for (const l of b.lignes) {
					lignes(l.marqueur.debut, l.zone.fin, LIGNE_CITATION);
					marqueur(l.marqueur, surLignes(l.marqueur.debut, l.zone.fin, vue));
					zones.push(l.zone);
				}
				break;
			case "liste":
				for (const it of b.items) {
					lignes(it.debut, it.fin, ligneListe(it.indent));
					marqueur(it.marqueur, surLignes(it.debut, it.fin, vue),
						new WidgetPuce(it.ordonne ? `${it.numero}.` : "•"));
					zones.push(it.zone);
				}
				break;
			case "code":
				lignes(b.ouverture.debut, b.ouverture.fin, LIGNE_CLOTURE);
				if (b.contenu) lignes(b.contenu.debut, b.contenu.fin, LIGNE_CODE);
				if (b.fermeture) lignes(b.fermeture.debut, b.fermeture.fin, LIGNE_CLOTURE);
				break;
			case "tableau":
				lignes(b.debut, b.fin, LIGNE_TABLEAU);
				zones.push(...b.entete);
				for (const r of b.rangees) zones.push(...r);
				break;
		}
	}
	return zones;
}

function construire(vue: EditorView): DecorationSet {
	const texte = vue.state.doc.toString();
	const deco: Range<Decoration>[] = [];
	const segments: SegmentInline[] = [];
	for (const z of decorerBlocs(texte, vue, deco)) {
		for (const s of decouperInline(texte.slice(z.debut, z.fin))) {
			segments.push({ ...s, debut: s.debut + z.debut, fin: s.fin + z.debut });
		}
	}
	for (const s of segments) {
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
