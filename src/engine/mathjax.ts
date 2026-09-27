/* ══════════════════════════════════════════════════════════
   MATHJAX — rendu LaTeX natif dans le quiz
   Syntaxe $...$ (inline) et $$...$$ (bloc). La segmentation est
   partagée entre les hôtes ; le rendu lui-même passe par
   `currentHost().math` (MathJax sous Obsidian, MathLive dans
   l'app Windows) → apparence STRICTEMENT identique aux notes du
   vault sous Obsidian.
   Module partagé moteur + éditeur : exports directs, pas de
   factory ctx (aucune dépendance au contexte du quiz).
══════════════════════════════════════════════════════════ */

/* Le moteur de rendu vient de l'HÔTE : MathJax sous Obsidian (apparence
   strictement identique aux notes du vault), MathLive dans l'app — déjà une
   dépendance du projet, fontes déjà inlinées.

   La segmentation ci-dessous, elle, reste PARTAGÉE : c'est elle qui décide ce
   qui est une formule, et deux hôtes ne peuvent pas en avoir chacun sa
   version. La mémoïsation de `ready()` — et la règle qu'un échec transitoire
   ne se mémoïse pas — a déménagé dans l'hôte, qui seul sait ce qu'il charge. */
import { currentHost } from "../host/current";

/* $$...$$ (bloc, testé en premier) puis $...$ (inline). Heuristique
   d'Obsidian pour éviter les vrais dollars (« 5$ et 3$ ») : le $
   ouvrant est collé au contenu, le fermant aussi, pas de saut de
   ligne dans un inline. */
const MATH_SEGMENT = /\$\$([^$]+?)\$\$|\$(?!\s)([^$\n]*?[^$\s])\$/g;

function hasMath(text: unknown): boolean {
	if (typeof text !== "string" || text.indexOf("$") === -1) return false;
	MATH_SEGMENT.lastIndex = 0;
	return MATH_SEGMENT.test(text);
}

/* Remplace, dans les text nodes sous `root`, chaque segment $...$ /
   $$...$$ par son rendu MathJax. Async (chargement MathJax au premier
   appel) et fire-and-forget : un re-render régénère le HTML source,
   donc jamais de double traitement. Les zones littérales (code, pre,
   textarea, éléments déjà rendus par MathJax) sont ignorées. */
async function mathifyElement(root: HTMLElement | null | undefined): Promise<void> {
	if (!root) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!node.nodeValue || node.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
			const p = node.parentElement;
			// .quiz-terminal : zones shell (bash/cmd/powershell) — les $ y
			// sont des variables ($PATH:$HOME), pas des maths ; review
			// 2026-07-11. code/pre/textarea/mjx : zones littérales.
			// .quiz-code-output : sortie d'exécution Python (stdout/erreur),
			// du texte de programme potentiellement hostile — jamais composé
			// par MathJax (revue du 2026-09-26, mineur 1).
			if (!p || p.closest("code, pre, textarea, script, style, mjx-container, .math, .quiz-terminal, .quiz-code-output")) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		}
	});
	const jobs: Text[] = [];
	while (walker.nextNode()) {
		const current = walker.currentNode as Text;
		if (hasMath(current.nodeValue)) jobs.push(current);
	}
	if (!jobs.length) return;

	// Appels fire-and-forget : un échec de chargement MathJax ne doit pas
	// remonter en unhandled rejection — les dollars restent en texte brut
	// (dégradation douce), retentative au prochain rendu (cf. HostMath.ready).
	try {
		await currentHost().math.ready();
	} catch (e) {
		console.warn("[quiz-blocks] MathJax indisponible:", e);
		return;
	}
	const math = currentHost().math;
	for (const node of jobs) {
		// replaceWith exige un parent ; un re-render a pu orpheliner le
		// node pendant le chargement MathJax. (Un container encore détaché
		// du DOM reste traité — l'embed peut monter avant insertion.)
		if (!node.parentNode) continue;
		const text = node.nodeValue ?? "";
		const frag = document.createDocumentFragment();
		let last = 0;
		let m: RegExpExecArray | null;
		MATH_SEGMENT.lastIndex = 0;
		while ((m = MATH_SEGMENT.exec(text))) {
			if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
			const display = m[1] !== undefined;
			try {
				frag.appendChild(math.render(display ? m[1] : m[2], display));
			} catch (e) {
				// LaTeX invalide → laisser le texte source tel quel.
				frag.appendChild(document.createTextNode(m[0]));
			}
			last = m.index + m[0].length;
		}
		if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
		node.replaceWith(frag);
	}
	// Requis par l'API : flush de la feuille de style MathJax.
	math.flush();
}

export { mathifyElement, hasMath };
