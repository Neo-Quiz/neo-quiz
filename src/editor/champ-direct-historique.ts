import { Annotation, StateEffect, StateField } from "@codemirror/state";
import type { ChangeSet, EditorSelection, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/* ══════════════════════════════════════════════════════════
   ANNULER / RÉTABLIR du champ à aperçu en direct

   Une `<textarea>` annulait d'elle-même (Ctrl+Z). CodeMirror, lui, ne le
   fait qu'avec `@codemirror/commands`, que le projet n'embarque pas (seuls
   `state` et `view` sont des dépendances de l'app) : sans ce module, le
   champ aurait PERDU l'annulation que la zone de texte offrait. Le minimum :
   une pile d'inverses, les frappes rapprochées fondues en un seul pas.
══════════════════════════════════════════════════════════ */

interface Pas {
	/** Les changements qui RAMÈNENT le document à l'état d'avant. */
	inverse: ChangeSet;
	/** La sélection à restaurer avec eux. */
	selection: EditorSelection;
}
interface Historique { passe: Pas[]; futur: Pas[]; dernier: number }

/** Deux modifications à moins de ce délai forment un seul pas d'annulation. */
const FUSION_MS = 500;
const LIMITE = 200;

const deHistorique = Annotation.define<boolean>();
const remplacer = StateEffect.define<Historique>();

const champHistorique = StateField.define<Historique>({
	create: () => ({ passe: [], futur: [], dernier: 0 }),
	update(h, tr) {
		for (const e of tr.effects) if (e.is(remplacer)) return e.value;
		if (!tr.docChanged || tr.annotation(deHistorique)) return h;
		const maintenant = Date.now();
		const inverse = tr.changes.invert(tr.startState.doc);
		const precedent = h.passe[h.passe.length - 1];
		if (precedent && maintenant - h.dernier < FUSION_MS) {
			/* Défaire le nouveau pas PUIS l'ancien : `inverse` s'applique au
			   document courant et rend celui d'avant ce pas, où `precedent`
			   s'applique à son tour. */
			const fondu: Pas = { inverse: inverse.compose(precedent.inverse), selection: precedent.selection };
			return { passe: [...h.passe.slice(0, -1), fondu], futur: [], dernier: maintenant };
		}
		const passe = [...h.passe, { inverse, selection: tr.startState.selection }].slice(-LIMITE);
		return { passe, futur: [], dernier: maintenant };
	},
});

/** Rejoue le dernier pas de la pile du `sens` demandé et pousse son contraire
    sur l'autre pile. */
function rejouer(vue: EditorView, sens: "annuler" | "retablir"): boolean {
	const h = vue.state.field(champHistorique);
	const source = sens === "annuler" ? h.passe : h.futur;
	const pas = source[source.length - 1];
	if (!pas) return true;
	const contraire: Pas = { inverse: pas.inverse.invert(vue.state.doc), selection: vue.state.selection };
	const reste = source.slice(0, -1);
	const suivant: Historique = sens === "annuler"
		? { passe: reste, futur: [...h.futur, contraire], dernier: 0 }
		: { passe: [...h.passe, contraire], futur: reste, dernier: 0 };
	vue.dispatch({
		changes: pas.inverse,
		selection: pas.selection,
		effects: remplacer.of(suivant),
		annotations: deHistorique.of(true),
		userEvent: sens === "annuler" ? "undo" : "redo",
		scrollIntoView: true,
	});
	return true;
}

export function historiqueMinimal(): Extension {
	return [
		champHistorique,
		keymap.of([
			{ key: "Mod-z", run: v => rejouer(v, "annuler"), preventDefault: true },
			{ key: "Mod-y", run: v => rejouer(v, "retablir"), preventDefault: true },
			{ key: "Mod-Shift-z", run: v => rejouer(v, "retablir"), preventDefault: true },
		]),
	];
}
