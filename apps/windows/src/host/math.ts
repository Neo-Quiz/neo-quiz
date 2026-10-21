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
   denominator side by side), so a copy whose selection touches a formula puts
   that formula's LaTeX source in the clipboard, between `$` (or `$$`), as the
   quiz wrote it. Installed once, on the first formula rendered. */
let copieInstallee = false;
function copierFormulesEnLatex(): void {
	if (copieInstallee) return;
	copieInstallee = true;
	document.addEventListener("copy", (e) => {
		const sel = document.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.clipboardData) return;
		const morceaux: string[] = [];
		let formule = false;
		for (let i = 0; i < sel.rangeCount; i++) {
			const range = sel.getRangeAt(i).cloneRange();
			// A selection that starts or ends inside a formula takes the whole formula.
			const debut = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>(".math[data-latex]");
			const fin = (range.endContainer.parentElement ?? null)?.closest<HTMLElement>(".math[data-latex]");
			if (debut) range.setStartBefore(debut);
			if (fin) range.setEndAfter(fin);
			const copie = document.createElement("div");
			copie.append(range.cloneContents());
			const maths = copie.querySelectorAll<HTMLElement>(".math[data-latex]");
			if (maths.length) formule = true;
			maths.forEach(m => {
				const bloc = m.classList.contains("math-block");
				m.replaceWith(bloc ? `$$${m.dataset.latex}$$` : `$${m.dataset.latex}$`);
			});
			morceaux.push(copie.textContent ?? "");
		}
		if (!formule) return;
		e.clipboardData.setData("text/plain", morceaux.join("\n"));
		e.preventDefault();
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
