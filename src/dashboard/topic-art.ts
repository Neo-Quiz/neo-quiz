import type { CategorieQuiz } from "./categorie-quiz";
import { estLangue } from "./categorie-quiz";
import { aUneImageCategorie, glypheCategorie, peindreIconeCategorie } from "./categorie-affichage";
import { currentHost } from "../host/current";

/* ══════════════════════════════════════════════════════════
   THE COVER OF A GALLERY CARD (2026-10-18, "Cover" direction)

   The preview of a card in the gallery of generated quizzes: a rich diagonal
   gradient in the SUBJECT's own colour (not its family's, so two neighbours
   differ), the subject's emblem drawn giant as a light ghost watermark,
   cropped at the bottom right and slightly tilted, and a small crisp tile at
   the top left holding the colour logo (Raycast's way). A subject with no
   logo gets a solid tile with a white Lucide glyph (Duolingo's way); a human
   language shows its flag in the tile and the gradient takes the flag's
   colours. Built with `createElement` from fixed pieces: no markup string,
   nothing taken from the quiz.

   Each tint is [light corner, dark corner, warm accent of the bottom-right
   glow], hand-picked from the logo's dominant colour where the logo is
   ambiguous (Python blue + yellow, Bash graphite + green...).
══════════════════════════════════════════════════════════ */

type Teinte = readonly [string, string, string];

const TEINTES: Readonly<Record<CategorieQuiz, Teinte>> = {
	general: ["#6d4fd8", "#1a1433", "#ff9ad0"],
	python: ["#3b7bb8", "#14284a", "#ffd43b"],
	c: ["#6b8bb5", "#1b2750", "#a8b9cc"],
	cpp: ["#1f78c1", "#0a2342", "#00d0ff"],
	java: ["#e0701c", "#3a1608", "#0074bd"],
	csharp: ["#8e44ad", "#2a1038", "#e08be0"],
	web: ["#e34f26", "#3d1208", "#f7df1e"],
	rust: ["#a8502a", "#2a1409", "#f4a261"],
	go: ["#00a7d0", "#06303d", "#8ff0ff"],
	algo: ["#d98a0b", "#3a2405", "#ffd277"],
	genie: ["#5e6ad2", "#181b4a", "#a5b4fc"],
	git: ["#d93b2b", "#3d0f0a", "#ff9a7a"],
	bash: ["#2b3a33", "#0a100d", "#4eaa25"],
	sql: ["#3f5fd0", "#14204d", "#9b8cff"],
	reseau: ["#12a4c4", "#08334a", "#67e8f9"],
	secu: ["#16a34a", "#052e16", "#4ade80"],
	os: ["#3c4452", "#12151b", "#fcc624"],
	archi: ["#0a5fb0", "#04182e", "#00c7fd"],
	cloud: ["#5e86f2", "#1c2f5c", "#fbbc04"],
	ia: ["#a855f7", "#2b0f4a", "#22d3ee"],
	maths: ["#5b4bd6", "#1b1650", "#38bdf8"],
	physique: ["#1d4fb0", "#071a3d", "#fc3d21"],
	chimie: ["#1fa87a", "#08302a", "#a3e635"],
	bio: ["#4aa83a", "#10300f", "#bef264"],
	medecine: ["#e04f5f", "#40101a", "#ffc2ca"],
	electronique: ["#00979d", "#04302f", "#7ed957"],
	histoire: ["#c9a227", "#3b2d08", "#f5dc8c"],
	geo: ["#2a8f5c", "#0c2f3a", "#4285f4"],
	philo: ["#4f6d7a", "#14222a", "#d6e0e5"],
	litterature: ["#a35f2d", "#2f1d0c", "#f0d9a8"],
	eco: ["#12805c", "#052a20", "#facc15"],
	gestion: ["#8a5a44", "#2c1a12", "#e0b49a"],
	droit: ["#34406e", "#0e1330", "#d4af37"],
	psycho: ["#d65db1", "#3a1030", "#ffc2dd"],
	musique: ["#d9306e", "#3b0a1e", "#ff9f1c"],
	arts: ["#c026d3", "#3a0a42", "#fbbf24"],
	conduite: ["#52606d", "#14181d", "#ef4444"],
	// Languages: the main colours of the flag shown in the tile.
	langues: ["#1cb0f6", "#0a3550", "#58cc02"],
	anglais: ["#2b4aa0", "#0b1840", "#e0233f"],
	francais: ["#2b4bb5", "#0e1a4a", "#ef4135"],
	espagnol: ["#c60b1e", "#3a0409", "#ffc400"],
	allemand: ["#4a4a4a", "#0c0c0c", "#ffce00"],
	chinois: ["#de2910", "#3d0a04", "#ffde00"],
	hindi: ["#f28c28", "#3a1c04", "#138808"],
	arabe: ["#165d31", "#05200f", "#cfe8d5"],
	bengali: ["#006a4e", "#02261c", "#f42a41"],
	portugais: ["#046a38", "#04210f", "#da291c"],
	russe: ["#1c4ea3", "#0b1d44", "#d52b1e"],
	ourdou: ["#01411c", "#021a0b", "#d9efdf"],
	indonesien: ["#ce1126", "#3a050c", "#ffd1d6"],
	japonais: ["#bc002d", "#2e0010", "#f8e1e6"],
	marathi: ["#ff8f1f", "#3a1a04", "#7b2d8e"],
	telougou: ["#c24d00", "#331500", "#00a86b"],
	turc: ["#e30a17", "#3a0308", "#ffd0d3"],
	tamoul: ["#b3261e", "#33100d", "#ffcc33"],
	cantonais: ["#c8102e", "#3a0614", "#ffe3e8"],
	vietnamien: ["#da251d", "#3a0806", "#ffeb3b"],
	coreen: ["#cd2e3a", "#14213d", "#0047a0"],
	italien: ["#009246", "#052a16", "#ce2b37"],
	persan: ["#239f40", "#0a2a12", "#da0000"],
	polonais: ["#dc143c", "#3a0612", "#ffe0e6"],
	neerlandais: ["#21468b", "#0b1a3d", "#d02a3a"],
	swahili: ["#0b6b2f", "#061a0c", "#d00000"],
	thai: ["#2d2a6a", "#0f0e22", "#d02040"],
	grec: ["#0d5eaf", "#06214a", "#cfe3ff"],
	hebreu: ["#0038b8", "#04163f", "#8fb0ff"],
	suedois: ["#006aa7", "#04283f", "#fecc00"],
	ukrainien: ["#0057b7", "#03204a", "#ffd700"],
};

/** Subjects whose logo reads badly as an emblem: the Lucide glyph replaces it (a shield-check, never a globe). */
const GLYPHE_IMPOSE: Partial<Record<CategorieQuiz, { tuile: string; fantome: string }>> = {
	secu: { tuile: "shield-check", fantome: "shield-check" },
	general: { tuile: "sparkles", fantome: "layers" },
};

/** Of those, the logos whose flat white silhouette stays recognisable as a giant ghost; the others (multi-tone marks, rounded-square illustrations) would turn into a blob, so their ghost is the Lucide glyph. */
const FANTOME_LOGO = new Set<CategorieQuiz>(["python", "c", "java", "web", "rust", "go", "git", "bash"]);

const glyphe = (parent: HTMLElement, nom: string): void => {
	currentHost().ui.setIcon(parent, nom);
};

/**
 * Just the crisp tile of a subject (its logo, its flag, or a white glyph on
 * its tint), for a compact row such as the chat's quiz card. Same pieces as
 * the tile of the gallery cover, so a subject looks the same in both.
 */
export function topicTuile(c: CategorieQuiz): HTMLElement {
	const [t1, t2, t3] = TEINTES[c];
	const tuile = document.createElement("div");
	tuile.className = "qbd-gen-art-tile";
	tuile.style.setProperty("--art-1", t1);
	tuile.style.setProperty("--art-2", t2);
	tuile.style.setProperty("--art-3", t3);
	const impose = GLYPHE_IMPOSE[c];
	const drapeau = estLangue(c) && c !== "langues";
	if (!impose && (drapeau || aUneImageCategorie(c))) peindreIconeCategorie(tuile, c);
	else {
		tuile.classList.add("is-solid");
		glyphe(tuile, impose?.tuile ?? glypheCategorie(c));
	}
	return tuile;
}

/**
 * The cover of a card. Sized by its container; the subject's tint reaches CSS
 * as `--art-1` (light), `--art-2` (dark) and `--art-3` (accent).
 */
export function topicArt(c: CategorieQuiz): HTMLElement {
	const [t1, t2, t3] = TEINTES[c];
	const racine = document.createElement("div");
	racine.className = "qbd-gen-art";
	racine.style.setProperty("--art-1", t1);
	racine.style.setProperty("--art-2", t2);
	racine.style.setProperty("--art-3", t3);

	const impose = GLYPHE_IMPOSE[c];
	const drapeau = estLangue(c) && c !== "langues";
	const logo = !impose && !drapeau && aUneImageCategorie(c);

	// The giant ghost: the logo's silhouette, else the subject's glyph.
	const fantome = document.createElement("div");
	fantome.className = "qbd-gen-art-ghost";
	if (logo && FANTOME_LOGO.has(c)) {
		fantome.classList.add("is-logo");
		peindreIconeCategorie(fantome, c);
	} else {
		glyphe(fantome, impose?.fantome ?? glypheCategorie(c));
	}
	racine.appendChild(fantome);

	const lueur = document.createElement("div");
	lueur.className = "qbd-gen-art-wash";
	racine.appendChild(lueur);

	// The tile: the colour logo or the flag; a solid tint and a white glyph otherwise.
	const tuile = document.createElement("div");
	tuile.className = "qbd-gen-art-tile";
	if (logo || drapeau) peindreIconeCategorie(tuile, c);
	else {
		tuile.classList.add("is-solid");
		glyphe(tuile, impose?.tuile ?? glypheCategorie(c));
	}
	racine.appendChild(tuile);
	return racine;
}
