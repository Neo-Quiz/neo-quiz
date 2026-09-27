import { EditorState, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { decorationsDirectes } from "./champ-direct-deco";
import { historiqueMinimal } from "./champ-direct-historique";

/* ══════════════════════════════════════════════════════════
   LE CHAMP À APERÇU EN DIRECT, comme Obsidian (2026-09-26)

   Une zone de texte montrait la source telle quelle : « Quand on lance
   `python3 main.py` » gardait ses accents graves, là où le quiz affiche une
   pastille de code. Ce champ-ci est un CodeMirror 6 (`@codemirror/view` et
   `@codemirror/state` seulement, ni langage ni lezer) dont le texte s'affiche
   RENDU ; la syntaxe ne réapparaît qu'autour du curseur
   (editor/champ-direct-deco.ts).

   La VALEUR reste le texte source (markdown, `$…$`) : `onChange` la reçoit
   à chaque modification, et la sauvegarde différée existante fait le reste.
   Le HTML n'y est jamais interprété — CodeMirror écrit du texte, un `<b>`
   tapé reste un `<b>` lisible.
══════════════════════════════════════════════════════════ */

export interface OptionsChampDirect {
	valeur: string;
	multiligne: boolean;
	placeholder?: string;
	/** Nom accessible du champ (sinon le placeholder). */
	etiquette?: string;
	onChange(valeur: string): void;
	/** Entrée dans un champ d'une ligne (sinon Entrée ne fait rien). */
	onEntree?(): void;
	onEchap?(): void;
	/** Comportements propres à l'appelant (collage d'image, raccourcis). */
	extensions?: Extension[];
}

export interface ChampDirect {
	focus(): void;
	valeur(): string;
	detruire(): void;
	vue: EditorView;
}

/* ── Ménage des champs retirés de la page ──
   Le formulaire se repeint en vidant son parent (`replaceChildren`) : aucun
   crochet ne prévient le champ qu'il a quitté la page, et une vue CodeMirror
   non détruite garde ses écouteurs sur le document. À chaque création, les
   vues qui ont été AFFICHÉES puis détachées sont détruites. Une vue pas
   encore attachée (le formulaire se construit hors de la page puis s'y
   insère) est épargnée : on ne détruit que ce qu'on a déjà vu connecté. */
const vivantes = new Map<EditorView, { vueConnectee: boolean }>();

function menage(): void {
	for (const [vue, etat] of vivantes) {
		if (vue.dom.isConnected) etat.vueConnectee = true;
		else if (etat.vueConnectee) { vivantes.delete(vue); vue.destroy(); }
	}
}

/**
 * Libère les champs que la page vient de quitter. Appelée par la page d'un
 * quiz (dashboard/detail.ts) quand elle se repeint — juste après avoir vidé
 * son conteneur, AVANT de construire les nouveaux champs — et quand elle est
 * fermée. À ce moment-là, aucun champ n'est en cours de construction : toute
 * vue détachée est morte, y compris celle qui n'a jamais été affichée (que le
 * ménage de `creerChampDirect` doit, lui, épargner). `racine` : les champs
 * encore dans ce nœud sont libérés aussi (la page fermée n'est pas forcément
 * déjà retirée du document).
 */
export function libererChamps(racine?: HTMLElement | null): void {
	for (const vue of [...vivantes.keys()]) {
		if (!vue.dom.isConnected || (racine && racine.contains(vue.dom))) {
			vivantes.delete(vue);
			vue.destroy();
		}
	}
}

/** Un champ d'une ligne ne reçoit jamais de saut de ligne, même collé : il
    devient une espace (même longueur, donc la sélection reste valable). */
const uneSeuleLigne = EditorState.transactionFilter.of(tr => {
	if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
	return [{
		changes: { from: 0, to: tr.startState.doc.length, insert: tr.newDoc.toString().replace(/\n/g, " ") },
		selection: tr.selection,
		scrollIntoView: tr.scrollIntoView,
	}];
});

export function creerChampDirect(parent: HTMLElement, opts: OptionsChampDirect): ChampDirect {
	menage();
	const touches = Prec.highest(keymap.of([
		{
			key: "Enter",
			run: () => {
				if (opts.multiligne) return false;
				opts.onEntree?.();
				return true;
			},
		},
		{ key: "Escape", run: () => { if (!opts.onEchap) return false; opts.onEchap(); return true; } },
	]));

	const vue = new EditorView({
		parent,
		state: EditorState.create({
			doc: opts.valeur,
			extensions: [
				touches,
				...(opts.extensions ?? []),
				historiqueMinimal(),
				EditorView.lineWrapping,
				decorationsDirectes,
				opts.placeholder ? placeholder(opts.placeholder) : [],
				opts.multiligne ? [] : uneSeuleLigne,
				/* Pas de correcteur : il est coupé dans toute l'app, mais un
				   `contenteditable` le rallume de lui-même. */
				EditorView.contentAttributes.of({
					spellcheck: "false",
					autocorrect: "off",
					autocapitalize: "off",
					"aria-multiline": opts.multiligne ? "true" : "false",
					...(opts.etiquette || opts.placeholder ? { "aria-label": opts.etiquette || opts.placeholder || "" } : {}),
				}),
				EditorView.updateListener.of(u => {
					if (u.docChanged) opts.onChange(u.state.doc.toString());
				}),
			],
		}),
	});
	vivantes.set(vue, { vueConnectee: vue.dom.isConnected });

	return {
		vue,
		focus: () => vue.focus(),
		valeur: () => vue.state.doc.toString(),
		detruire: () => { vivantes.delete(vue); vue.destroy(); },
	};
}
