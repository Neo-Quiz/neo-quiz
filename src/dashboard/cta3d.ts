import { ajouter } from "../dom";

/* ══════════════════════════════════════════════════════════
   LE BOUTON 3D de Brilliant (« Continue course »), pour l'action principale
   d'une page (2026-09-25). Relevé sur brilliant.org et gardé dans la
   bibliothèque ui-effects (`button/cta-3d--lifted-face-shimmer.html`) ; ici
   dans le bleu des flèches ← → du quiz.

   Trois couches : le bouton (transparent, il pâlit au survol), la FACE
   surélevée de 4px au-dessus de sa tranche pleine (elle s'enfonce au clic),
   et le REFLET — le SVG d'origine de Brilliant, deux bandes inclinées à 30°
   qui balaient la face pendant le premier quart d'un cycle de 6,4 s. Le
   style vit dans dashboard-components.css (`.qbd-cta3d`).
══════════════════════════════════════════════════════════ */

const NS = "http://www.w3.org/2000/svg";
/* Des identifiants de dégradé UNIQUES par bouton : deux boutons sur la même
   page qui partageraient un `id` verraient le second pointer sur les
   dégradés du premier — et les perdre quand le premier est retiré. */
let compteur = 0;

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
	const n = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
	parent.appendChild(n);
	return n;
}

/** Transforme `bouton` en bouton 3D : son contenu passe dans la face, le
    reflet s'ajoute par-dessus. Rend le SVG du reflet, dont l'appelant peut
    relancer l'animation (`getAnimations()`). */
export function poserBouton3d(bouton: HTMLElement): SVGSVGElement {
	bouton.classList.add("qbd-cta3d");
	const face = ajouter(bouton, "span", "qbd-cta3d-face");
	while (bouton.firstChild && bouton.firstChild !== face) face.appendChild(bouton.firstChild);

	const clip = ajouter(face, "span", "qbd-cta3d-clip");
	clip.setAttribute("aria-hidden", "true");
	const n = ++compteur;
	const svg = el(clip, "svg", { viewBox: "0 0 150 56", fill: "none" });
	const g = el(svg, "g", { "clip-path": `url(#qbd-cta3d-clip-${n})` });
	el(g, "rect", { opacity: "0.4", x: "75", y: "-58.6328", width: "51", height: "150", transform: "rotate(30 75 -58.6328)", fill: `url(#qbd-cta3d-a-${n})` });
	el(g, "rect", { opacity: "0.4", x: "127.826", y: "-28.1328", width: "26", height: "150", transform: "rotate(30 127.826 -28.1328)", fill: `url(#qbd-cta3d-b-${n})` });
	const defs = el(svg, "defs", {});
	const a = el(defs, "linearGradient", { id: `qbd-cta3d-a-${n}`, x1: "100.5", y1: "-58.6328", x2: "100.5", y2: "91.3672", gradientUnits: "userSpaceOnUse" });
	el(a, "stop", { offset: "0.27", "stop-color": "#EFF3FF" });
	el(a, "stop", { offset: "0.71", "stop-color": "white", "stop-opacity": "0" });
	const b = el(defs, "linearGradient", { id: `qbd-cta3d-b-${n}`, x1: "140.826", y1: "-28.1328", x2: "140.826", y2: "121.867", gradientUnits: "userSpaceOnUse" });
	el(b, "stop", { offset: "0.081302", "stop-color": "#EFF3FF" });
	el(b, "stop", { offset: "0.570844", "stop-color": "white", "stop-opacity": "0" });
	const cp = el(defs, "clipPath", { id: `qbd-cta3d-clip-${n}` });
	el(cp, "rect", { width: "150", height: "56", fill: "white" });
	return svg;
}
