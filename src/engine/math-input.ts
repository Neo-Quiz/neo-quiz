/* ══════════════════════════════════════════════════════════
   MATH INPUT — éditeur d'équations WYSIWYG (MathLive)
   Champ <math-field> pour les réponses des questions texte
   mathématiques : frappe naturelle → math rendue, clic sur un
   élément → édition ciblée, AUCUN code LaTeX visible. Panneau
   de symboles custom façon Overleaf (catégorie par défaut
   déduite de la réponse attendue). Spec :
   docs/superpowers/specs/2026-07-11-math-input-design.md
   Module partagé moteur + éditeur (exports directs).
══════════════════════════════════════════════════════════ */

/* Ce module n'a pas de `ctx` : il expose des fonctions directes appelées par
   engine/terminal.ts et editor/question-preview.ts. Il lit donc l'hôte par
   `currentHost()` — le MÊME objet que `ctx.host`, installé une seule fois. */

import { currentHost } from "../host/current";
import { hasMath } from "./mathjax";
import { t } from "../i18n";
// Import TYPE only (erased) : garde `mathlive` en chargement LAZY (require dans
// configureMathlive), tout en typant `MathfieldElement`/le layout et en activant
// l'augmentation globale `Window.mathVirtualKeyboard` fournie par mathlive.
import type { MathfieldElement, VirtualKeyboardLayout } from "mathlive";

/** Sous-ensemble structurel des champs de question lus par les 3 fonctions pures. */
export interface MathQuestionInput {
	type?: string;
	_type?: string;
	mathInput?: boolean;
	_extraFields?: { mathInput?: boolean; answerTemplate?: string } | null;
	prompt?: string;
	promptHtml?: string;
	_promptHtml?: string;
	acceptedAnswers?: unknown[];
	acceptableAnswers?: unknown[];
	answer?: unknown;
	caseSensitive?: boolean;
	/** Réponse NUMÉRIQUE déclarée (engine/numeric.ts) — prime sur l'auto-détection math. */
	numeric?: boolean;
}

export interface CreateMathFieldOptions {
	value?: string;
	template?: string;
	readOnly?: boolean;
	placeholder?: string;
	onInput?: (latex: string) => void;
	onEnter?: () => void;
}

export interface MathFieldHandle {
	el: MathfieldElement;
	getValue(): string;
	setValue(l: unknown): void;
	focus(): void;
	destroy(): void;
}

/** electron n'est pas installé comme package (fourni par l'hôte Electron d'Obsidian) : type minimal. */
interface ElectronLike {
	webFrame: { getZoomFactor(): number };
}

/* Une question texte est « math » si l'IA l'a marquée mathInput, ou si
   son énoncé / une réponse acceptée contient un segment $...$. */
function isMathQuestion(q: MathQuestionInput | null | undefined): boolean {
	if (!q || (q.type !== "text" && q._type !== "text")) return false;
	/* `numeric: true` est une DÉCLARATION de l'auteur sur la nature de la
	   réponse ; l'auto-détection ci-dessous n'est qu'une devinette sur la
	   présence de $...$. Une question « valeur de $\pi$ ? » attend un nombre,
	   pas un éditeur d'équations — et sans cette garde elle en ouvrait un,
	   tout en perdant sa tolérance (la vérification math passe avant la
	   numérique dans terminal.ts). */
	if (q.numeric === true) return false;
	// Le flag vit à la racine (moteur, JSON5 brut) ou dans _extraFields
	// (objet normalisé de l'éditeur — clé inconnue préservée).
	const flag = q.mathInput ?? (q._extraFields && q._extraFields.mathInput);
	if (flag === true) return true;
	if (flag === false) return false;
	if (hasMath(q.prompt || "") || hasMath(q.promptHtml || q._promptHtml || "")) return true;
	const answers: unknown[] = [...(q.acceptedAnswers || []), ...(q.acceptableAnswers || [])];
	if (typeof q.answer === "string") answers.push(q.answer);
	return answers.some(a => typeof a === "string" && (hasMath(a) || /\\[a-zA-Z]{2,}/.test(a)));
}

/* Le champ de saisie est-il l'éditeur d'équations ? Oui pour une question
   math, et AUSSI pour une question numérique posée en LaTeX : « Calculer
   $u_0 + … + u_7$ » réclame le clavier mathématique (Ahmed, 2026-09-23).
   Seule la SAISIE change : la comparaison reste numérique, avec sa
   tolérance (`latexEnNombre`, engine/numeric.ts). Un `mathInput: false`
   explicite garde le champ texte. */
function usesMathField(q: MathQuestionInput | null | undefined): boolean {
	if (isMathQuestion(q)) return true;
	if (!q || q.numeric !== true || (q.type !== "text" && q._type !== "text")) return false;
	const flag = q.mathInput ?? (q._extraFields && q._extraFields.mathInput);
	if (flag === false) return false;
	return flag === true || hasMath(q.prompt || "") || hasMath(q.promptHtml || q._promptHtml || "");
}

/* Normalisation de FORME uniquement (décision Ahmed 2026-07-11 : pas
   d'équivalence symbolique — x\cdot4 ≠ 4x ; chaque forme acceptable est
   listée dans acceptedAnswers). Rend comparables les écritures
   équivalentes d'un MÊME LaTeX. */
function normalizeMathAnswer(latex: unknown, { caseSensitive = false }: { caseSensitive?: boolean } = {}): string {
	let s = String(latex ?? "").trim();
	// Dollars des acceptedAnswers d'auteur ($...$) : la valeur comparée
	// est le contenu.
	s = s.replace(/^\$\$?|\$\$?$/g, "");
	// Espaces D'ABORD (sinon « { 1 } » échappe au strip singleton). La
	// transformation est appliquée identiquement aux deux côtés de la
	// comparaison — déterminisme > sémantique (\text{} multi-mots hors
	// périmètre des réponses math).
	s = s.replace(/\s+/g, "");
	// Formes d'écriture sans effet sur le rendu.
	s = s.replace(/\\left(?=[([{|])/g, "").replace(/\\right(?=[)\]}|])/g, "");
	s = s.replace(/\\[,;!:]/g, "");
	s = s.replace(/\\(d|t)frac/g, "\\frac");
	s = s.replace(/\\operatorname\{([a-zA-Z]+)\}/g, "\\$1");
	/* MathLive REWRITES what the learner types (measured 2026-09-28, typing
	   into the real field): a prime becomes `^{\prime}` — « f'(3)=6 » comes
	   out as `f^{\prime}(3)=6` —, a decimal comma stays a comma or becomes
	   `{,}`, and « 15/7 » stays a slash. The answers a model writes use
	   `f'`, `1.5` and `\frac{15}{7}`: every correct answer to a derivative
	   was marked wrong. Same writing, same form, on both sides. */
	s = s.replace(/\^\{((?:\\prime)+)\}|\^((?:\\prime)+)|\\prime/g, (m, braced?: string, bare?: string) =>
		"'".repeat(((braced ?? bare ?? m).match(/\\prime/g) ?? []).length));
	s = s.replace(/\{,\}/g, ",").replace(/(\d),(?=\d)/g, "$1.");
	s = s.replace(/\\frac\{(\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}/g, "$1/$2");
	// Accolades singleton : x^{2} → x^2 (répété pour les imbrications).
	for (let i = 0; i < 3; i++) s = s.replace(/\{([a-zA-Z0-9])\}/g, "$1");
	if (!caseSensitive) s = s.toLowerCase();
	return s;
}

/* La réponse de l'élève (LaTeX MathLive) correspond-elle à une des
   réponses acceptées de la question ? */
function matchesMathAnswer(studentLatex: unknown, q: MathQuestionInput): boolean {
	const accepted: unknown[] = [...(q.acceptedAnswers || []), ...(q.acceptableAnswers || [])];
	if (typeof q.answer === "string") accepted.push(q.answer);
	const opts = { caseSensitive: !!q.caseSensitive };
	const student = normalizeMathAnswer(studentLatex, opts);
	if (!student) return false;
	return accepted.some(a => normalizeMathAnswer(a, opts) === student);
}

/* Fermeture DOUCE du clavier virtuel : hide() de MathLive détruit le
   DOM immédiatement (vérifié : backdrop absent 30 ms après l'appel) →
   aucune transition possible. On anime NOUS-MÊMES la sortie (les
   transitions CSS de math-input.css s'appliquent aux styles inline)
   puis on hide réellement. Un re-focus pendant la sortie l'annule. */
let __kbExitTimer = 0;

function cancelKeyboardExit(): void {
	if (!__kbExitTimer) return;
	clearTimeout(__kbExitTimer);
	__kbExitTimer = 0;
	const b = document.querySelector<HTMLElement>(".ML__keyboard .MLK__backdrop");
	if (b) b.style.opacity = "";
}

/* MathLive pousse l'app en posant un padding-bottom INLINE sur <body>
   à l'ouverture du clavier. Si le hide est court-circuité (reload du
   plugin clavier ouvert, erreur interne), ce padding reste orphelin :
   grande bande vide sous l'app (baseline Ahmed 2026-07-11, 313px).
   À appeler quand AUCUN clavier n'est visible. */
/* Retire la poussée de l'app par le clavier — MÊME clavier visible
   (mode overlay) : le padding inline du body ET le mémo du singleton. */
function suppressKeyboardPush(): void {
	if (document.body.style.paddingBottom) document.body.style.paddingBottom = "";
	// `originalContainerBottomPadding` est un champ INTERNE MathLive absent des
	// types publics (VirtualKeyboardInterface) : cast local pour le purger.
	const kb = window.mathVirtualKeyboard as typeof window.mathVirtualKeyboard & { originalContainerBottomPadding?: unknown };
	if (kb && kb.originalContainerBottomPadding) {
		try { kb.originalContainerBottomPadding = null; } catch (e) { /* best effort */ }
	}
}

/* ── Clavier FLOTTANT déplaçable (référence : clavier visuel Windows,
   demande Ahmed 2026-07-11). Le DOM du clavier est DÉTRUIT à chaque
   hide → tout est (ré)appliqué après chaque show : classe flottante,
   position mémorisée (session), poignée de drag + bouton fermer. ── */
let __kbPos: { left: number; top: number; w: number; h: number } | null = null; // position mémorisée pour la session
let __kbDragging = false; // drag en cours : ne pas fermer le clavier
let __lastMathfield: HTMLElement | null = null; // dernier champ focalisé (refocus post-drag)
let __kbCursorEl: HTMLDivElement | null = null; // réplique du curseur système pendant le drag

/* Le curseur système est rendu par l'OS (hardware, latence ~0) ; tout
   élément DOM le suit avec 1-2 frames de compositing de retard — à
   grande vitesse le vrai curseur « glisse » sur le clavier, quel que
   soit le code (mesuré : le style suit la cible à chaque frame, le
   décalage vient de la couche de présentation). Pendant le drag on
   masque donc le curseur OS (cursor: none) et on affiche SA réplique,
   mise à jour dans le même handler que le clavier → présentés dans la
   MÊME frame compositée : écart relatif nul par construction. Pointe
   du glyphe à (1,1) dans le SVG (marge anti-rognage du contour) :
   compenser d'1px au positionnement. */
function getDragCursor(): HTMLDivElement {
	if (__kbCursorEl) return __kbCursorEl;
	// Couleurs du curseur natif de CHAQUE OS : macOS = flèche noire à
	// liseré blanc ; Windows/Linux = blanche à contour noir. Même
	// silhouette, le swap reste discret pour tout utilisateur.
	const mac = currentHost().platform.isMacOS;
	const c = document.createElement("div");
	c.className = "qbd-kb-cursor";
	c.innerHTML = '<svg width="16" height="22" viewBox="0 0 16 22">'
		+ '<path d="M1 1 L1 17.6 L5.1 13.8 L7.6 19.6 L10.4 18.4 L7.9 12.7 L13.3 12.7 Z"'
		+ ' fill="' + (mac ? "#000" : "#fff") + '" stroke="' + (mac ? "#fff" : "#000")
		+ '" stroke-width="1.1" stroke-linejoin="round"/></svg>';
	__kbCursorEl = c;
	return c;
}

function clampKbPos(left: number, top: number, w: number, h: number): { left: number; top: number } {
	return {
		left: Math.min(Math.max(8, left), window.innerWidth - w - 8),
		top: Math.min(Math.max(8, top), window.innerHeight - h - 8),
	};
}

function makeKeyboardFloating(attempt = 0): void {
	const backdrop = document.querySelector<HTMLElement>(".ML__keyboard.is-visible .MLK__backdrop");
	if (!backdrop) {
		// Le show peut poser is-visible une frame plus tard : retenter
		// brièvement (10 frames max) avant d'abandonner.
		if (attempt < 10) requestAnimationFrame(() => makeKeyboardFloating(attempt + 1));
		return;
	}
	if (backdrop.classList.contains("qbd-kb-floating")) return;
	backdrop.classList.add("qbd-kb-floating");
	// Réplique de curseur orpheline (drag interrompu par une destruction
	// du clavier) : purge au show — elle vit dans body, pas dans le DOM
	// du clavier détruit à chaque hide.
	if (__kbCursorEl) __kbCursorEl.remove();

	// Position : mémorisée (revient EXACTEMENT où l'utilisateur l'a
	// laissée — clamp avec les dimensions MÉMORISÉES au drop, jamais
	// celles du clavier en cours d'animation, faussées), sinon centré
	// bas (marge 14px).
	requestAnimationFrame(() => {
		if (__kbPos) {
			const pos = clampKbPos(__kbPos.left, __kbPos.top, __kbPos.w || 880, __kbPos.h || 330);
			backdrop.style.left = pos.left + "px";
			backdrop.style.top = pos.top + "px";
			return;
		}
		const r = backdrop.getBoundingClientRect();
		backdrop.style.left = Math.round((window.innerWidth - r.width) / 2) + "px";
		backdrop.style.top = Math.round(window.innerHeight - r.height - 14) + "px";
	});

	// Poignée de drag + fermer.
	const handle = document.createElement("div");
	handle.className = "qbd-kb-handle";
	const grip = document.createElement("span");
	grip.className = "qbd-kb-handle-grip";
	currentHost().ui.setIcon(grip, "grip-horizontal");
	const close = document.createElement("button");
	close.type = "button";
	close.className = "qbd-kb-handle-close";
	close.setAttribute("aria-label", t("engine.math.closeKeyboard"));
	currentHost().ui.setIcon(close, "x");
	close.addEventListener("click", () => {
		// La croix ferme le clavier ET désélectionne le champ (demande Ahmed) :
		// blur du dernier champ focalisé → le caret et l'anneau de focus
		// disparaissent. __lastMathfield est remis à null AVANT le blur pour
		// neutraliser le refocus post-drag qui, sinon, rouvrirait le clavier.
		// Le blur déclenche le focusout du champ → hideKeyboardSoftly ; on
		// rappelle hide en filet de sécurité (cas d'un champ sans focus DOM
		// réel) — le clearTimeout de __kbExitTimer dans hideKeyboardSoftly
		// déduplique le fondu : pas de double déclenchement.
		const active = document.activeElement as HTMLElement | null;
		const mf: HTMLElement | null = (__lastMathfield && __lastMathfield.isConnected) ? __lastMathfield
			: (active && active.tagName === "MATH-FIELD" ? active : null);
		__lastMathfield = null;
		if (mf && typeof mf.blur === "function") mf.blur();
		hideKeyboardSoftly();
	});
	handle.append(grip, close);
	backdrop.prepend(handle);

	// Drag depuis N'IMPORTE QUELLE zone non interactive du clavier
	// (référence clavier visuel Windows — demande Ahmed) : le listener
	// vit sur le BACKDROP en phase capture (le « sink » MathLive
	// avalerait l'événement sinon). Touches/onglets/toolbar/variantes
	// restent cliquables ; tout le reste (poignée, bordures, espaces
	// entre touches) déplace. Le blur du champ pendant le drag est
	// neutralisé par __kbDragging, focus rendu au relâchement.
	const INTERACTIVE = ".MLK__keycap, .MLK__shift, [data-command], button, [role=button], .MLK__toolbar *, .MLK__variant-panel, .layer-switch, .qbd-kb-handle-close";
	backdrop.addEventListener("pointerdown", (e: PointerEvent) => {
		if ((e.target as Element | null)?.closest(INTERACTIVE)) return;
		e.preventDefault();
		e.stopPropagation();
		__kbDragging = true;
		cancelKeyboardExit();
		try { backdrop.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		const r = backdrop.getBoundingClientRect();
		backdrop.classList.add("is-dragging");
		// Drag classique par décalage : le CURSEUR (visible) reste sur
		// le point du clavier saisi pendant tout le déplacement — formule
		// absolue clientX - dx, aucune dérive possible. Clamp CONTINU aux
		// bords (comportement validé par Ahmed). Le « saut au-dessus du
		// curseur » historique venait du transform résiduel MathLive,
		// corrigé par transform: none — pas de ce calcul.
		const dx = e.clientX - r.left;
		const dy = e.clientY - r.top;
		const startLeft = r.left;
		const startTop = r.top;

		// Réplique du curseur (voir getDragCursor) : posée à la position
		// exacte du vrai curseur au moment du grab → le swap OS↔réplique
		// est invisible. Souris uniquement (au tactile, pas de curseur).
		// Le curseur OS ignore le zoom d'interface d'Obsidian : la
		// réplique compense par scale(1/zoom), hotspot (1px) scalé aussi.
		const ghost = e.pointerType === "mouse" ? getDragCursor() : null;
		let ghostScale = "", hot = 1;
		if (ghost) {
			let zf = 1;
			try { zf = (require("electron") as ElectronLike).webFrame.getZoomFactor() || 1; } catch (err) { /* desktop only */ }
			if (zf !== 1) { ghostScale = " scale(" + (1 / zf) + ")"; hot = 1 / zf; }
			ghost.style.transform = "translate(" + (e.clientX - hot) + "px, " + (e.clientY - hot) + "px)" + ghostScale;
			document.body.appendChild(ghost);
		}

		// Déplacement par transform INLINE !important (seul à battre le
		// verrou transform:none de la feuille) : translation pure d'une
		// layer déjà rasterisée, pas de layout par frame — et pas de
		// custom property, dont l'héritage invaliderait le style de tout
		// le sous-arbre du clavier à chaque frame. Clavier ET réplique
		// mis à jour dans le même handler → composités dans la même
		// frame. left/top consolidés au relâchement seulement.
		const onMove = (ev: PointerEvent) => {
			const pos = clampKbPos(ev.clientX - dx, ev.clientY - dy, r.width, r.height);
			backdrop.style.setProperty("transform",
				"translate(" + (pos.left - startLeft) + "px, " + (pos.top - startTop) + "px)", "important");
			if (ghost) ghost.style.transform = "translate(" + (ev.clientX - hot) + "px, " + (ev.clientY - hot) + "px)" + ghostScale;
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onUp);
			if (ghost) ghost.remove();
			// Consolider AVANT de retirer la classe (pas de flash) :
			// position visuelle finale → left/top, puis transform relâché.
			const rr = backdrop.getBoundingClientRect();
			backdrop.style.left = Math.round(rr.left) + "px";
			backdrop.style.top = Math.round(rr.top) + "px";
			backdrop.style.removeProperty("transform");
			backdrop.classList.remove("is-dragging");
			__kbPos = {
				left: Math.round(rr.left), top: Math.round(rr.top),
				w: Math.round(rr.width), h: Math.round(rr.height),
			};
			__kbDragging = false;
			syncKeyboardInset();
			// Rendre le focus au champ : la saisie continue sans re-clic.
			if (__lastMathfield && __lastMathfield.isConnected) __lastMathfield.focus();
		};
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onUp);
	}, { capture: true });
}

/* The room the keyboard takes at the bottom of the window, published as
   `--nq-mathkb-inset` so the quiz lifts its bar of arrows above it (math-input.css).
   Only a keyboard resting on the bottom edge counts: one dragged up the screen
   covers part of the question, not the arrows, and must not squash the page. */
function syncKeyboardInset(): void {
	const rect = document.querySelector<HTMLElement>(".ML__keyboard.is-visible .MLK__backdrop")?.getBoundingClientRect();
	const docked = !!rect && rect.height > 0 && rect.bottom >= window.innerHeight - 40;
	const inset = docked ? Math.max(0, Math.round(window.innerHeight - rect.top)) : 0;
	document.documentElement.style.setProperty("--nq-mathkb-inset", inset + "px");
}

function clearKeyboardBodyPadding(): void {
	if (!document.querySelector(".ML__keyboard.is-visible")) syncKeyboardInset();
	if (document.querySelector(".ML__keyboard.is-visible")) return;
	if (document.body.style.paddingBottom) document.body.style.paddingBottom = "";
	// Le singleton MathLive MÉMORISE le « padding original » et le
	// restaure à chaque hide (et l'ADDITIONNE au show suivant) : un
	// résidu pollué s'auto-entretient — 313 → 625 → … (mesuré). Purger
	// aussi le mémo.
	const kb = window.mathVirtualKeyboard as typeof window.mathVirtualKeyboard & { originalContainerBottomPadding?: unknown };
	if (kb && kb.originalContainerBottomPadding) {
		try { kb.originalContainerBottomPadding = null; } catch (e) { /* lecture seule ? tant pis */ }
	}
}

function hideKeyboardSoftly(): void {
	const b = document.querySelector<HTMLElement>(".ML__keyboard.is-visible .MLK__backdrop");
	if (!b) {
		try { window.mathVirtualKeyboard?.hide({ animate: false }); } catch (e) { /* déjà fermé */ }
		clearKeyboardBodyPadding();
		return;
	}
	// Fondu seul : en mode flottant le transform est interdit (résidus
	// MathLive → positions décalées), l'opacité suffit.
	b.style.opacity = "0";
	if (__kbExitTimer) clearTimeout(__kbExitTimer);
	__kbExitTimer = window.setTimeout(() => {
		__kbExitTimer = 0;
		b.style.opacity = "";
		try { window.mathVirtualKeyboard?.hide({ animate: false }); } catch (e) { /* transitoire */ }
		clearKeyboardBodyPadding();
	}, 260);
}

/* Onglet custom « Matrices et structures » du clavier virtuel (demande Ahmed
   2026-07-11 : remplacer le menu ≡ par un onglet, pour ne plus jongler entre le
   champ et le clavier). Les \placeholder{} sont navigables au Tab, comme
   answerTemplate. Format keycap officiel (types/virtual-keyboard.d.ts : `latex`
   = label rendu ET fragment inséré ; `command` = action, qui prime sur `latex`
   réduit alors au rôle de label). */
const __PH = "\\placeholder{}";
function __mkMatrix(env: string, rows: number, cols: number): string {
	// Une rangée = cols placeholders séparés par & ; les rangées séparées par
	// \\ (double backslash LaTeX → quadruple en chaîne JS).
	const line = new Array<string>(cols).fill(__PH).join("&");
	return "\\begin{" + env + "}" + new Array<string>(rows).fill(line).join("\\\\") + "\\end{" + env + "}";
}
/* FONCTION, et non constante de module : les `tooltip` sont des libellés VISIBLES.
   Un objet construit au chargement du module figerait la langue du démarrage
   d'Obsidian — la fonction est rappelée à chaque configureMathlive(), donc les
   infobulles suivent le réglage de langue. Le `label` de l'onglet reste un glyphe
   Unicode (jamais traduit), comme les `latex` (fragments insérés = données). */
function matrixLayout(): VirtualKeyboardLayout {
	return {
		// Le label de l'onglet est injecté en markup brut par MathLive (pas de rendu
		// LaTeX) → glyphe Unicode évoquant une matrice, cohérent avec 123/∫/αβγ.
		label: "[∷]",
		labelClass: "MLK__tex-math",
		tooltip: t("engine.math.matrixTab"),
		rows: [
			[
				{ latex: __mkMatrix("pmatrix", 2, 2), class: "small", tooltip: t("engine.math.matrix2x2Paren") },
				{ latex: __mkMatrix("pmatrix", 3, 3), class: "small", tooltip: t("engine.math.matrix3x3Paren") },
				{ latex: __mkMatrix("bmatrix", 2, 2), class: "small", tooltip: t("engine.math.matrix2x2Bracket") },
				{ latex: __mkMatrix("vmatrix", 2, 2), class: "small", tooltip: t("engine.math.determinant2x2") },
			],
			[
				{ latex: __mkMatrix("cases", 2, 1), class: "small", tooltip: t("engine.math.equationSystem") },
				{ latex: "\\vec{" + __PH + "}", class: "small", tooltip: t("engine.math.vector") },
				{ latex: "\\overline{" + __PH + "}", class: "small", tooltip: t("engine.math.overline") },
				// command prime : ces touches n'agissent que si le caret est DANS une
				// matrice (sinon sans effet, comportement attendu).
				{ latex: "+\\,\\downarrow", command: "addRowAfter", class: "small", tooltip: t("engine.math.addRow") },
				{ latex: "+\\,\\rightarrow", command: "addColumnAfter", class: "small", tooltip: t("engine.math.addColumn") },
			],
		],
	};
}

let __mathliveConfigured = false;

/* LA BIBLIOTHÈQUE, FOURNIE PAR L'HÔTE OU CHARGÉE PARESSEUSEMENT. Le greffon
   la charge par `require` au premier champ math (bundle CommonJS ; le
   rechargement du plugin et le poids de MathLive justifient la paresse). Le
   rendu de l'application est en modules ES : `require` n'y existe pas, et
   la page de tout quiz portant une question `text` mourait sur « require is
   not defined » (vu par Ahmed le 2026-09-13). L'hôte Windows, qui importe
   déjà `mathlive` statiquement (`apps/windows/src/host/math.ts`), la FOURNIT
   ici au démarrage ; le `require` ne reste que le repli du greffon. */
let mathliveFournie: typeof import("mathlive") | null = null;
function provideMathlive(lib: typeof import("mathlive")): void {
	mathliveFournie = lib;
}

function configureMathlive(): void {
	// Clavier virtuel NATIF MathLive (choix Ahmed 2026-07-11 : « c'est propre ce
	// clavier-là ») — sans l'onglet alphabétique (« abc », inutile avec un clavier
	// physique) : 123, symboles, grec.
	// (Ré)appliqué à CHAQUE appel, AVANT le verrou __mathliveConfigured : le layout
	// porte des infobulles traduites, et configureMathlive n'est appelée qu'à la
	// création d'un champ math — sinon la langue des infobulles resterait celle du
	// premier champ math de la session. L'assignation est idempotente.
	if (window.mathVirtualKeyboard) {
		window.mathVirtualKeyboard.layouts = ["numeric", "symbols", "greek", matrixLayout()];
	}
	if (__mathliveConfigured) return;
	const lib = mathliveFournie ?? (require("mathlive") as typeof import("mathlive"));
	// PIÈGE reload plugin : customElements.define('math-field') ne peut
	// arriver qu'UNE fois par page — après un disable/enable, l'élément
	// enregistré reste la classe de l'ANCIEN bundle. document.createElement
	// utilise l'enregistrée : c'est ELLE qu'il faut configurer, sinon
	// fontsDirectory retombe sur './fonts' (requêtes mortes, erreurs au
	// focus/blur). Un redémarrage complet d'Obsidian reste l'état propre.
	const MFE = (customElements.get("math-field") || lib.MathfieldElement) as typeof import("mathlive").MathfieldElement;
	// Fonts fournies par styles.css (data-URI au build) ; null = MathLive
	// ne tente AUCUN chargement (doc officielle). Sons désactivés.
	MFE.fontsDirectory = null;
	MFE.soundsDirectory = null;
	// Purge un padding orphelin d'une session précédente (reload plugin
	// pendant que le clavier était ouvert).
	clearKeyboardBodyPadding();
	__mathliveConfigured = true;
}

/*
 * createMathField(host, {
 *   value?, readOnly?, placeholder?,
 *   onInput?(latex), onEnter?()
 * }) → { el, getValue(), setValue(l), focus(), destroy() }
 * Le clavier virtuel NATIF MathLive s'ouvre automatiquement au focus
 * (demande Ahmed : pas besoin de cliquer le bouton clavier) et se
 * referme au blur. Thème : variables CSS dans math-input.css.
 */
function createMathField(host: HTMLElement, opts: CreateMathFieldOptions = {}): MathFieldHandle {
	configureMathlive();

	const mf = document.createElement("math-field") as MathfieldElement;
	mf.classList.add("quiz-mathfield");
	// Ouverture pilotée par nous (focusin) — pas seulement tactile.
	mf.mathVirtualKeyboardPolicy = "manual";
	// Barre espace active (en mode math l'espace ne fait rien par
	// défaut) : insère une espace fine — neutralisée par
	// normalizeMathAnswer à la correction, purement visuelle.
	mf.mathModeSpace = "\\;";
	if (opts.readOnly) mf.readOnly = true;
	if (opts.placeholder) mf.setAttribute("placeholder", opts.placeholder);
	if (opts.value) {
		mf.setValue(String(opts.value).replace(/^\$\$?|\$\$?$/g, ""));
	} else if (opts.template) {
		// Gabarit guidé (« x = ▯ ») : pré-écrit, l'élève remplit les
		// \placeholder{} (navigation Tab native MathLive).
		mf.setValue(String(opts.template).replace(/^\$\$?|\$\$?$/g, ""));
	}
	host.appendChild(mf);

	// Menu MathLive retiré (bouton ≡ ET menu clic-droit, même source) : son menu
	// par défaut expose « Résoudre / Évaluer / Simplifier » (Compute Engine) —
	// dans un quiz, l'élève ferait résoudre l'équation à sa place (anti-triche).
	// Le bouton ≡ résiduel est masqué en CSS (::part(menu-toggle)). Les
	// structures (matrices, système…) passent par l'onglet clavier dédié.
	// Le setter menuItems exige le mathfield MONTÉ (« Mathfield not mounted »
	// sinon) : or le host est souvent détaché à la création (l'éditeur insère
	// l'arbre ensuite → appendChild ne monte pas encore). On l'applique sur
	// l'événement 'mount' de MathLive (émis à chaque connexion → menu re-vidé
	// même après un re-mount de carousel), et tout de suite si déjà monté.
	// Setter et event officiels (types/mathfield-element.d.ts).
	const clearMenu = () => { try { mf.menuItems = []; } catch (e) { /* pas encore monté */ } };
	mf.addEventListener("mount", clearMenu);
	clearMenu();

	const onInput = opts.onInput;
	if (onInput) {
		mf.addEventListener("input", () => onInput(mf.getValue("latex")));
	}
	const onEnter = opts.onEnter;
	if (onEnter) {
		mf.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				onEnter();
			}
		});
	}

	// Clavier virtuel : ouvert dès qu'on écrit (focus), refermé au blur.
	// try/catch : le show/hide de MathLive peut jeter dans des états
	// transitoires (reload plugin, champ détaché) — dégradation douce.
	if (!opts.readOnly) {
		mf.addEventListener("focusin", () => {
			__lastMathfield = mf;
			cancelKeyboardExit();
			try { window.mathVirtualKeyboard?.show({ animate: true }); } catch (e) { /* transitoire */ }
			// OVERLAY, pas poussée : MathLive contracte l'app (padding
			// body) → zone morte sans wallpaper derrière le clavier
			// (capture Ahmed). On retire la poussée : le clavier (fixed)
			// recouvre le bas de l'app et son verre floute du VRAI
			// contenu. Le champ est recentré s'il tombe dessous.
			requestAnimationFrame(() => {
				suppressKeyboardPush();
				makeKeyboardFloating();
				const kbTop = document.querySelector<HTMLElement>(".ML__keyboard.is-visible .MLK__backdrop")?.getBoundingClientRect().top;
				const r = mf.getBoundingClientRect();
				if (kbTop && r.bottom > kbTop) mf.scrollIntoView({ block: "center", behavior: "smooth" });
				// The keyboard slides in: measure where it ends up, not where it starts.
				syncKeyboardInset();
				window.setTimeout(syncKeyboardInset, 450);
			});
		});
		mf.addEventListener("focusout", () => {
			// Blur causé par la saisie de la poignée de drag : ignorer,
			// le clavier reste ouvert et le champ sera refocalisé au drop.
			if (__kbDragging) return;
			hideKeyboardSoftly();
		});
	}

	return {
		el: mf,
		getValue: () => mf.getValue("latex"),
		setValue: (l: unknown) => mf.setValue(String(l ?? "").replace(/^\$\$?|\$\$?$/g, "")),
		focus: () => mf.focus(),
		destroy: () => {
			mf.remove();
		},
	};
}

export {
	isMathQuestion, usesMathField, normalizeMathAnswer, matchesMathAnswer,
	createMathField, provideMathlive,
};
