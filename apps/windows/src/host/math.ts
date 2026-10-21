/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — RENDU LaTeX

   Sous Obsidian, le rendu passe par MathJax, pour que les formules d'un quiz
   soient STRICTEMENT identiques à celles des notes du vault. L'application n'a
   pas MathJax : elle rend avec MathLive, déjà une dépendance du projet (le
   champ de saisie mathématique) et déjà chargée dans le CSS partagé, fontes
   inlinées comprises.

   La segmentation ($…$ / $$…$$) reste PARTAGÉE dans `src/engine/mathjax.ts` :
   ce fichier ne fait que rendre un segment déjà découpé.
══════════════════════════════════════════════════════════ */

import * as mathlive from "mathlive";
import { convertLatexToMarkup, MathfieldElement } from "mathlive";
import type { HostMath } from "../../../../src/host/types";
import { provideMathlive } from "../../../../src/engine/math-input";
import { latexPourMathLive } from "./latex-mathlive";

/* L'éditeur d'équations partagé (`engine/math-input.ts`) charge MathLive par
   `require` sous le greffon ; ici il n'y a pas de `require`. La bibliothèque
   est déjà importée statiquement au-dessus : on la lui donne au chargement
   de ce module, avant tout champ math. */
provideMathlive(mathlive);

/* Rendered formulas are selectable (2026-10-21; MathLive's static CSS sets
   `user-select: none` on `.ML__latex`, overridden in quiz-card.css). Their
   glyph spans make poor text (a fraction copies as its numerator and
   denominator side by side), so a copy that holds a WHOLE formula puts its
   LaTeX source in the clipboard, between `$` (or `$$`), as the quiz wrote
   it; a formula only partly selected copies the selected glyphs. Installed
   once, on the first formula rendered. */
let copieInstallee = false;

/** The formulas a range touches, in document order. */
function formulesTouchees(range: Range): HTMLElement[] {
	const racine = range.commonAncestorContainer;
	const dans = racine instanceof Element ? racine : racine.parentElement;
	if (!dans) return [];
	const propre = dans.closest<HTMLElement>(".math[data-latex]");
	if (propre) return [propre];
	return [...dans.querySelectorAll<HTMLElement>(".math[data-latex]")].filter(m => range.intersectsNode(m));
}

/** The horizontal extent of what a range selects inside a formula: the union
    of its selected glyphs, or null when none is. */
function etendueSelectionnee(range: Range, formule: HTMLElement): { gauche: number; droite: number; haut: number; bas: number } | null {
	let gauche = Infinity, droite = -Infinity, haut = Infinity, bas = -Infinity;
	const parcours = document.createTreeWalker(formule, NodeFilter.SHOW_TEXT);
	const morceau = document.createRange();
	for (let n = parcours.nextNode() as Text | null; n; n = parcours.nextNode() as Text | null) {
		if (!n.data.trim() || !range.intersectsNode(n)) continue;
		const debut = n === range.startContainer ? range.startOffset : 0;
		const fin = n === range.endContainer ? range.endOffset : n.length;
		if (fin <= debut) continue;
		morceau.setStart(n, debut);
		morceau.setEnd(n, fin);
		const r = morceau.getBoundingClientRect();
		if (!r.width) continue;
		gauche = Math.min(gauche, r.left); droite = Math.max(droite, r.right);
		haut = Math.min(haut, r.top); bas = Math.max(bas, r.bottom);
	}
	return droite > gauche ? { gauche, droite, haut, bas } : null;
}

/** The line box an inline formula sits on: from the content top of its block
    and its `line-height`, or, when that is `normal`, centred on the span. */
function ligneDe(m: HTMLElement, boite: DOMRect): { haut: number; hauteur: number } {
	let bloc = m.parentElement;
	while (bloc && /^(inline|contents)/.test(getComputedStyle(bloc).display)) bloc = bloc.parentElement;
	const style = bloc ? getComputedStyle(bloc) : null;
	const lh = style ? parseFloat(style.lineHeight) : NaN;
	if (!bloc || !style || !Number.isFinite(lh) || lh <= 0) {
		const propre = parseFloat(getComputedStyle(m).lineHeight);
		const demi = Number.isFinite(propre) ? Math.max(0, (propre - boite.height) / 2) : 0;
		return { haut: boite.top - demi, hauteur: boite.height + 2 * demi };
	}
	const haut = bloc.getBoundingClientRect().top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
	const k = Math.max(0, Math.round((boite.top - (lh - boite.height) / 2 - haut) / lh));
	return { haut: haut + k * lh, hauteur: lh };
}

function copierFormulesEnLatex(): void {
	if (copieInstallee) return;
	copieInstallee = true;
	document.addEventListener("copy", (e) => {
		const sel = document.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.clipboardData) return;
		const morceaux: string[] = [];
		let formule = false;
		for (let i = 0; i < sel.rangeCount; i++) {
			const range = sel.getRangeAt(i);
			const originales = formulesTouchees(range);
			const copie = document.createElement("div");
			copie.append(range.cloneContents());
			copie.querySelectorAll(".math-selection").forEach(o => o.remove());
			// The clone holds the touched formulas in the same order, whole or cut.
			copie.querySelectorAll<HTMLElement>(".math[data-latex]").forEach((m, k) => {
				const origine = originales[k];
				if (!origine || !sel.containsNode(origine, false)) return;
				formule = true;
				const bloc = m.classList.contains("math-block");
				m.replaceWith(bloc ? `$$${m.dataset.latex}$$` : `$${m.dataset.latex}$`);
			});
			morceaux.push(copie.textContent ?? "");
		}
		if (!formule) return;
		e.clipboardData.setData("text/plain", morceaux.join("\n"));
		e.preventDefault();
	});
	/* The native highlight paints glyph by glyph, each glyph at its own height
	   and with holes at MathLive's spacing (around `=`, `+`). Inside a formula
	   it is made transparent (quiz-card.css) and ONE band is drawn instead,
	   from the first selected glyph to the last, at the height of the line
	   (`.math-selection`): the selection stays free, glyph by glyph, like the
	   text around it. */
	let surlignees: HTMLElement[] = [];
	document.addEventListener("selectionchange", () => {
		const sel = document.getSelection();
		const vues: HTMLElement[] = [];
		if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
			for (let i = 0; i < sel.rangeCount; i++) {
				const range = sel.getRangeAt(i);
				for (const m of formulesTouchees(range)) {
					const e = etendueSelectionnee(range, m);
					if (!e) continue;
					let bande = m.querySelector<HTMLElement>(":scope > .math-selection");
					if (!bande) {
						bande = document.createElement("span");
						bande.className = "math-selection";
						bande.setAttribute("aria-hidden", "true");
						m.append(bande);
					}
					const boite = m.getBoundingClientRect();
					bande.style.left = `${e.gauche - boite.left}px`;
					bande.style.width = `${e.droite - e.gauche}px`;
					// A display formula spans the selected glyphs' height.
					if (m.classList.contains("math-block")) {
						bande.style.top = `${e.haut - boite.top}px`;
						bande.style.height = `${e.bas - e.haut}px`;
					} else {
						/* An inline formula: its line, where the native highlight of
						   text is painted. The lines of the text's block stack every
						   `line-height` from its content top; centring the band on the
						   span's content area instead landed 0.8 px higher than the
						   text's highlight, a visible step once snapped. */
						const l = ligneDe(m, boite);
						bande.style.top = `${l.haut - boite.top}px`;
						bande.style.height = `${l.hauteur}px`;
					}
					bande.hidden = false;
					vues.push(m);
				}
			}
		}
		for (const m of surlignees) if (!vues.includes(m)) {
			const bande = m.querySelector<HTMLElement>(":scope > .math-selection");
			if (bande) bande.hidden = true;
		}
		surlignees = vues;
	});
}

/** Le réglage des fontes n'est posé qu'UNE fois par session. */
let fontesConfigurees = false;

export function createWindowsMath(): HostMath {
	return {
		/* MathLive est déjà chargé (import statique) : il n'y a rien à attendre.
		   Il reste UNE chose à poser, et une seule fois : `fontsDirectory = null`.
		   Sans elle, MathLive va chercher ses fontes dans « ./fonts », un chemin
		   qui n'existe pas dans le paquet de l'application — les requêtes
		   échouent et les formules se rendent en glyphes de substitution. Les
		   fontes viennent du CSS partagé, où elles sont inlinées en data-URI au
		   build (même raison que `engine/math-input.ts`). */
		async ready() {
			if (fontesConfigurees) return;
			// Pas de détour par `customElements.get("math-field")` comme dans
			// `engine/math-input.ts` : ce détour n'existe que pour le rechargement
			// à chaud d'un GREFFON, où l'élément enregistré vient d'un bundle
			// précédent. Une fenêtre d'application ne charge qu'un bundle.
			MathfieldElement.fontsDirectory = null;
			MathfieldElement.soundsDirectory = null;
			fontesConfigurees = true;
		},
		render(latex, display) {
			const span = document.createElement("span");
			// `math` : la classe que le parcours de `engine/mathjax.ts` écarte, pour
			// qu'un second passage ne re-rende pas une formule déjà rendue.
			span.className = display ? "math math-block" : "math math-inline";
			// The source, for `copierFormulesEnLatex`: a copy gives `$…$`, not the glyphs.
			span.dataset.latex = String(latex ?? "");
			copierFormulesEnLatex();
			/* LE SEUL `innerHTML` NON ASSAINI DE L'APPLICATION, et la raison doit
			   être écrite noir sur blanc : le HTML injecté ici est la SORTIE de
			   `convertLatexToMarkup`, fabriquée par MathLive — ce n'est ni le
			   texte de l'utilisateur, ni celui d'un quiz partagé. L'entrée, elle,
			   est du LaTeX, que MathLive analyse et n'exécute pas ; il ne peut pas
			   en ressortir de `<script>` ni de `onerror`. Assainir cette sortie
			   reviendrait à découper les balises que MathLive vient de composer,
			   c'est-à-dire à casser le rendu pour rien.
			   Tout AUTRE HTML de l'application passe par `src/engine/sanitizer.ts`
			   et ses quatre portes. */
			span.innerHTML = convertLatexToMarkup(latexPourMathLive(String(latex ?? "")), {
				defaultMode: display ? "math" : "inline-math",
			});
			return span;
		},
		/* Rien à faire, et ce n'est pas un oubli : MathLive rend de façon
		   SYNCHRONE, segment par segment. Obsidian a besoin d'une passe finale
		   (`finishRenderMath`) parce que MathJax diffère une partie de sa mise en
		   page ; ici le DOM est complet quand `render` rend la main. */
		flush() {
			/* volontairement vide — voir le commentaire ci-dessus */
		},
	};
}
