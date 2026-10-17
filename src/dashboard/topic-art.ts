import type { CategorieQuiz } from "./categorie-quiz";
import { estLangue } from "./categorie-quiz";

/* ══════════════════════════════════════════════════════════
   A SMALL FLAT ILLUSTRATION PER SUBJECT (2026-10-17)

   The preview of a card in the gallery of generated quizzes, after the
   "Create something new" tiles of claude.ai: a dark tinted ground and,
   straight on it (no panel: no tile inside a tile), flat shapes in two or three tones of the
   subject's colour (an editor for code, axes and a curve for maths, nodes for
   networks...). Built with `createElementNS` from fixed shapes: no markup
   string, nothing taken from the quiz.
══════════════════════════════════════════════════════════ */

type Famille = "code" | "data" | "maths" | "reseau" | "secu" | "ia" | "science" | "langue" | "lettres" | "doc";

const FAMILLE: Partial<Record<CategorieQuiz, Famille>> = {
	python: "code", c: "code", cpp: "code", java: "code", csharp: "code", web: "code", rust: "code", go: "code", algo: "code", genie: "code", git: "code", bash: "code",
	sql: "data",
	maths: "maths", eco: "maths", gestion: "maths",
	reseau: "reseau", cloud: "reseau", os: "reseau", archi: "reseau",
	secu: "secu",
	ia: "ia",
	physique: "science", chimie: "science", bio: "science", medecine: "science", electronique: "science",
	histoire: "lettres", geo: "lettres", philo: "lettres", litterature: "lettres", droit: "lettres", psycho: "lettres", musique: "lettres", arts: "lettres", conduite: "lettres",
};

/** The colour of each family: the ground's hue, then three tones for the shapes. */
const TEINTES: Record<Famille, { fond: string; a: string; b: string; c: string }> = {
	code: { fond: "#1d3a5f", a: "#5b9cf0", b: "#f2c94c", c: "#8fb8ef" },
	data: { fond: "#1f4a4a", a: "#4fd1c5", b: "#81e6d9", c: "#2c7a7b" },
	maths: { fond: "#3b2a5e", a: "#a78bfa", b: "#c4b5fd", c: "#7c5fd6" },
	reseau: { fond: "#173f45", a: "#38bdf8", b: "#67e8f9", c: "#0e7490" },
	secu: { fond: "#4a1f24", a: "#f87171", b: "#fca5a5", c: "#b91c1c" },
	ia: { fond: "#35214f", a: "#c084fc", b: "#f0abfc", c: "#8b5cf6" },
	science: { fond: "#173d2c", a: "#4ade80", b: "#86efac", c: "#15803d" },
	langue: { fond: "#4a3214", a: "#f6ad55", b: "#fbd38d", c: "#c05621" },
	lettres: { fond: "#47361a", a: "#e9b872", b: "#f6dfb2", c: "#a0703a" },
	doc: { fond: "#26324a", a: "#7f9cc9", b: "#b8c7e0", c: "#4d6390" },
};

export function familleDe(c: CategorieQuiz): Famille {
	if (estLangue(c)) return "langue";
	return FAMILLE[c] ?? "doc";
}

const NS = "http://www.w3.org/2000/svg";
type Forme = [string, Record<string, string | number>];

function formes(f: Famille, t: { a: string; b: string; c: string }): Forme[] {
	const ligne = (x: number, y: number, w: number, fill: string): Forme => ["rect", { x, y, width: w, height: 5, rx: 2.5, fill }];
	switch (f) {
		case "code": return [
			["circle", { cx: 50, cy: 26, r: 2.6, fill: t.c }], ["circle", { cx: 58, cy: 26, r: 2.6, fill: t.c }], ["circle", { cx: 66, cy: 26, r: 2.6, fill: t.c }],
			ligne(46, 38, 34, t.a), ligne(84, 38, 22, t.b), ligne(54, 48, 46, t.c), ligne(54, 58, 28, t.b), ligne(86, 58, 26, t.a), ligne(46, 68, 20, t.a),
		];
		case "data": return [
			["rect", { x: 46, y: 26, width: 68, height: 10, rx: 3, fill: t.a }],
			...[0, 1, 2].flatMap((r): Forme[] => [0, 1, 2].map((k): Forme => ["rect", { x: 46 + k * 24, y: 40 + r * 12, width: 20, height: 8, rx: 2, fill: (r + k) % 2 ? t.c : t.b, opacity: 0.85 }])),
		];
		case "maths": return [
			["path", { d: "M48 74 V26 M48 74 H116", stroke: t.c, "stroke-width": 3, "stroke-linecap": "round", fill: "none" }],
			["path", { d: "M50 68 C64 30, 78 30, 88 50 S104 72, 114 32", stroke: t.a, "stroke-width": 4, "stroke-linecap": "round", fill: "none" }],
			["circle", { cx: 88, cy: 50, r: 4, fill: t.b }],
		];
		case "reseau": return [
			["path", { d: "M58 34 L102 34 L80 66 Z M58 34 L80 66", stroke: t.c, "stroke-width": 3, fill: "none" }],
			["circle", { cx: 58, cy: 34, r: 8, fill: t.a }], ["circle", { cx: 102, cy: 34, r: 8, fill: t.b }], ["circle", { cx: 80, cy: 66, r: 9, fill: t.a }],
		];
		case "secu": return [
			["path", { d: "M80 22 L104 31 V50 C104 64 93 73 80 78 C67 73 56 64 56 50 V31 Z", fill: t.a }],
			["path", { d: "M70 50 L77 57 L91 42", stroke: t.b, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }],
		];
		case "ia": return [
			["path", { d: "M56 32 L80 50 L56 68 M104 32 L80 50 L104 68 M56 32 L104 68 M104 32 L56 68", stroke: t.c, "stroke-width": 2.5, fill: "none" }],
			["circle", { cx: 56, cy: 32, r: 6, fill: t.b }], ["circle", { cx: 56, cy: 68, r: 6, fill: t.b }], ["circle", { cx: 104, cy: 32, r: 6, fill: t.b }],
			["circle", { cx: 104, cy: 68, r: 6, fill: t.b }], ["circle", { cx: 80, cy: 50, r: 9, fill: t.a }],
		];
		case "science": return [
			["ellipse", { cx: 80, cy: 50, rx: 28, ry: 10, stroke: t.a, "stroke-width": 3, fill: "none" }],
			["ellipse", { cx: 80, cy: 50, rx: 28, ry: 10, stroke: t.b, "stroke-width": 3, fill: "none", transform: "rotate(60 80 50)" }],
			["ellipse", { cx: 80, cy: 50, rx: 28, ry: 10, stroke: t.c, "stroke-width": 3, fill: "none", transform: "rotate(-60 80 50)" }],
			["circle", { cx: 80, cy: 50, r: 5, fill: t.a }],
		];
		case "langue": return [
			["rect", { x: 46, y: 26, width: 50, height: 26, rx: 8, fill: t.a }], ["path", { d: "M56 50 L54 60 L66 50 Z", fill: t.a }],
			["rect", { x: 70, y: 48, width: 46, height: 24, rx: 8, fill: t.b }], ["path", { d: "M104 70 L108 78 L96 70 Z", fill: t.b }],
			ligne(54, 34, 26, t.c), ligne(54, 42, 18, t.c),
		];
		case "lettres": return [
			["path", { d: "M80 34 C70 28 58 28 48 32 V72 C58 68 70 68 80 74 Z", fill: t.a }],
			["path", { d: "M80 34 C90 28 102 28 112 32 V72 C102 68 90 68 80 74 Z", fill: t.b }],
			["path", { d: "M80 34 V74", stroke: t.c, "stroke-width": 2.5 }],
		];
		default: return [
			["rect", { x: 60, y: 20, width: 40, height: 60, rx: 5, fill: t.c, opacity: 0.6 }],
			ligne(66, 28, 22, t.a), ligne(66, 38, 28, t.b), ligne(66, 46, 24, t.b), ["circle", { cx: 68.5, cy: 58.5, r: 2.5, fill: t.a }], ligne(74, 56, 18, t.b), ligne(66, 66, 26, t.b),
		];
	}
}

/** The illustration of a subject, sized by its container (viewBox 160 x 100). */
export function topicArt(c: CategorieQuiz): SVGSVGElement {
	const f = familleDe(c);
	const t = TEINTES[f];
	const svg = document.createElementNS(NS, "svg");
	/* A wide frame around the 160 x 100 drawing: the shapes keep a modest size
	   in a large card instead of filling it. */
	svg.setAttribute("viewBox", "-22 -4 204 108");
	svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
	svg.setAttribute("aria-hidden", "true");
	const id = `nq-art-${f}`;
	const defs = document.createElementNS(NS, "defs");
	const grad = document.createElementNS(NS, "linearGradient");
	grad.setAttribute("id", id);
	grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
	// The colour fades into the card itself: no separate block for the picture.
	for (const [offset, couleur, op] of [["0", t.fond, "0.9"], ["1", t.fond, "0"]] as const) {
		const stop = document.createElementNS(NS, "stop");
		stop.setAttribute("offset", offset);
		stop.setAttribute("stop-color", couleur);
		stop.setAttribute("stop-opacity", op);
		grad.appendChild(stop);
	}
	defs.appendChild(grad);
	svg.appendChild(defs);
	const poser = ([tag, attrs]: Forme): void => {
		const el = document.createElementNS(NS, tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
		svg.appendChild(el);
	};
	poser(["rect", { x: -22, y: -4, width: 204, height: 108, fill: `url(#${id})` }]);
	// No panel behind the shapes: no tile inside the card's tile.
	for (const forme of formes(f, t)) poser(forme);
	return svg;
}
