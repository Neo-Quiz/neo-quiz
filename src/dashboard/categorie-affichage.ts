/* ══════════════════════════════════════════════════════════
   A SUBJECT'S DISPLAY: translated name and icon (categorie-quiz.ts)

   Used by the folders page (subject filter, module cards) and the generated
   gallery. The composer's subject chip and picker are gone (2026-10-18): the
   clarify call names the subject itself (generation-kind.ts).

   A human language's icon is its FLAG (2026-09-29): thirty languages behind
   one and the same Lucide glyph could not be told apart. Emoji flags are not
   an option — the project draws no emoji, and Windows shows "FR" in
   letters instead of the flag. The SVGs come from `country-flag-icons`
   and go in as an <img> data URL: an image, which runs nothing, never
   markup set with innerHTML. Only a subject that IS the thing, a
   programming language or a tool (`LOGO_AUTORISE`), shows its official colour
   logo (`subject-logos.ts`), taken before the code catalogue's own logo
   (`code-catalogue.ts`), which stays reserved for code blocks. Every other
   subject (fields, sciences, humanities) shows a Lucide glyph: never one
   company's brand, never an emoji-style illustration (owner, 2026-10-18).
══════════════════════════════════════════════════════════ */

import { currentHost } from "../host/current";
import { codeLanguageBadgeSrc, codeLanguageOf } from "../code-catalogue";
import { SUBJECT_LOGOS } from "../subject-logos";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { estLangue } from "./categorie-quiz";
import type { CategorieQuiz, LangueQuiz } from "./categorie-quiz";
import { BD, CN, DE, ES, FR, GB, GR, HK, ID, IL, IN, IR, IT, JP, KE, KR, NL, PK, PL, PT, RU, SA, SE, TH, TR, UA, VN } from "country-flag-icons/string/3x2";

const ICONES: Readonly<Record<CategorieQuiz, string>> = {
	general: "book-open",
	python: "code",
	c: "cpu",
	cpp: "braces",
	java: "coffee",
	csharp: "hash",
	web: "globe",
	rust: "cog",
	go: "rabbit",
	algo: "workflow",
	genie: "blocks",
	git: "git-branch",
	bash: "terminal",
	sql: "database",
	reseau: "network",
	secu: "shield-check",
	os: "monitor-cog",
	archi: "microchip",
	cloud: "cloud",
	ia: "brain-circuit",
	maths: "sigma",
	physique: "atom",
	chimie: "flask-conical",
	bio: "dna",
	medecine: "stethoscope",
	electronique: "circuit-board",
	histoire: "landmark",
	geo: "earth",
	philo: "lightbulb",
	litterature: "book-marked",
	eco: "trending-up",
	gestion: "briefcase",
	droit: "scale",
	psycho: "brain",
	anglais: "languages",
	francais: "languages",
	espagnol: "languages",
	allemand: "languages",
	langues: "languages",
	chinois: "languages",
	hindi: "languages",
	arabe: "languages",
	bengali: "languages",
	portugais: "languages",
	russe: "languages",
	ourdou: "languages",
	indonesien: "languages",
	japonais: "languages",
	marathi: "languages",
	telougou: "languages",
	turc: "languages",
	tamoul: "languages",
	cantonais: "languages",
	vietnamien: "languages",
	coreen: "languages",
	italien: "languages",
	persan: "languages",
	polonais: "languages",
	neerlandais: "languages",
	swahili: "languages",
	thai: "languages",
	grec: "languages",
	hebreu: "languages",
	suedois: "languages",
	ukrainien: "languages",
	musique: "music",
	arts: "palette",
	conduite: "car",
};

/* Keys written out in full (never composed): searching for a key finds it,
   and a missing key is a compile error. */
const NOMS: Readonly<Record<CategorieQuiz, TransKey>> = {
	general: "ai.categorie.general",
	python: "ai.categorie.python",
	c: "ai.categorie.c",
	cpp: "ai.categorie.cpp",
	java: "ai.categorie.java",
	csharp: "ai.categorie.csharp",
	web: "ai.categorie.web",
	rust: "ai.categorie.rust",
	go: "ai.categorie.go",
	algo: "ai.categorie.algo",
	genie: "ai.categorie.genie",
	git: "ai.categorie.git",
	bash: "ai.categorie.bash",
	sql: "ai.categorie.sql",
	reseau: "ai.categorie.reseau",
	secu: "ai.categorie.secu",
	os: "ai.categorie.os",
	archi: "ai.categorie.archi",
	cloud: "ai.categorie.cloud",
	ia: "ai.categorie.ia",
	maths: "ai.categorie.maths",
	physique: "ai.categorie.physique",
	chimie: "ai.categorie.chimie",
	bio: "ai.categorie.bio",
	medecine: "ai.categorie.medecine",
	electronique: "ai.categorie.electronique",
	histoire: "ai.categorie.histoire",
	geo: "ai.categorie.geo",
	philo: "ai.categorie.philo",
	litterature: "ai.categorie.litterature",
	eco: "ai.categorie.eco",
	gestion: "ai.categorie.gestion",
	droit: "ai.categorie.droit",
	psycho: "ai.categorie.psycho",
	anglais: "ai.categorie.anglais",
	francais: "ai.categorie.francais",
	espagnol: "ai.categorie.espagnol",
	allemand: "ai.categorie.allemand",
	langues: "ai.categorie.langues",
	chinois: "ai.categorie.chinois",
	hindi: "ai.categorie.hindi",
	arabe: "ai.categorie.arabe",
	bengali: "ai.categorie.bengali",
	portugais: "ai.categorie.portugais",
	russe: "ai.categorie.russe",
	ourdou: "ai.categorie.ourdou",
	indonesien: "ai.categorie.indonesien",
	japonais: "ai.categorie.japonais",
	marathi: "ai.categorie.marathi",
	telougou: "ai.categorie.telougou",
	turc: "ai.categorie.turc",
	tamoul: "ai.categorie.tamoul",
	cantonais: "ai.categorie.cantonais",
	vietnamien: "ai.categorie.vietnamien",
	coreen: "ai.categorie.coreen",
	italien: "ai.categorie.italien",
	persan: "ai.categorie.persan",
	polonais: "ai.categorie.polonais",
	neerlandais: "ai.categorie.neerlandais",
	swahili: "ai.categorie.swahili",
	thai: "ai.categorie.thai",
	grec: "ai.categorie.grec",
	hebreu: "ai.categorie.hebreu",
	suedois: "ai.categorie.suedois",
	ukrainien: "ai.categorie.ukrainien",
	musique: "ai.categorie.musique",
	arts: "ai.categorie.arts",
	conduite: "ai.categorie.conduite",
};

/* Each language's flag: the country most associated with it for a
   learner (Arabic: Saudi Arabia, Portuguese: Portugal, Swahili: Kenya).
   "Any other language" has none: its glyph stays. */
const DRAPEAUX: Readonly<Record<Exclude<LangueQuiz, never>, string>> = {
	anglais: GB,
	francais: FR,
	espagnol: ES,
	allemand: DE,
	chinois: CN,
	hindi: IN,
	arabe: SA,
	bengali: BD,
	portugais: PT,
	russe: RU,
	ourdou: PK,
	indonesien: ID,
	japonais: JP,
	marathi: IN,
	telougou: IN,
	turc: TR,
	tamoul: IN,
	cantonais: HK,
	vietnamien: VN,
	coreen: KR,
	italien: IT,
	persan: IR,
	polonais: PL,
	neerlandais: NL,
	swahili: KE,
	thai: TH,
	grec: GR,
	hebreu: IL,
	suedois: SE,
	ukrainien: UA,
};

/** The Lucide glyph of a subject (its icon when it has no logo, the ghost emblem of its gallery cover). */
export function glypheCategorie(c: CategorieQuiz): string {
	return ICONES[c];
}

/** A subject's displayed name, read AT RENDER (current language). */
export function libelleCategorie(c: CategorieQuiz): string {
	return t(NOMS[c]);
}

/* The programming subjects, by their tag in the code catalogue. Their icon
   shows that language's logo, not a generic glyph. */
const TAG_LANGAGE: Partial<Record<CategorieQuiz, string>> = {
	python: "python", c: "c", cpp: "cpp", java: "java", csharp: "csharp",
	rust: "rust", go: "go", bash: "bash", sql: "sql",
};

/* Which subjects may wear a logo (2026-10-18, owner's rule): only those that
   ARE the thing, a programming language or a tool. A FIELD (AI, cloud,
   networking, OS, music, medicine...) never wears one company's brand, and no
   emoji-style illustration stands in for a subject: it shows its Lucide glyph.
   Every consumer (subject filter, gallery covers) follows this one list. */
const LOGO_AUTORISE: ReadonlySet<CategorieQuiz> = new Set<CategorieQuiz>([
	"python", "c", "cpp", "java", "csharp", "web", "rust", "go", "git", "bash",
]);

/* Each subject logo's data URI, encoded once: the largest is ~40 KB, and the
   menu draws every subject on each open. */
const LOGO_MATIERE_SRC = new Map<CategorieQuiz, string>();

/** Does the subject have an image (logo or flag), rather than only a Lucide glyph? */
export function aUneImageCategorie(c: CategorieQuiz): boolean {
	if (!estLangue(c) && !LOGO_AUTORISE.has(c)) return false;
	if (SUBJECT_LOGOS[c]) return true;
	if (TAG_LANGAGE[c] && codeLanguageOf(TAG_LANGAGE[c])?.logo) return true;
	return estLangue(c) && c !== "langues" && !!DRAPEAUX[c as LangueQuiz];
}

/** Draws a subject's icon in `el`: its colour logo (a programming language's
    official one first), a human language's flag, the code catalogue's logo
    for a language with no colour logo, otherwise its Lucide glyph. */
export function peindreIconeCategorie(el: HTMLElement, c: CategorieQuiz): void {
	el.replaceChildren();
	const logo = LOGO_AUTORISE.has(c) ? SUBJECT_LOGOS[c] : undefined;
	if (logo) {
		let src = LOGO_MATIERE_SRC.get(c);
		if (src === undefined) {
			src = "data:image/svg+xml," + encodeURIComponent(logo);
			LOGO_MATIERE_SRC.set(c, src);
		}
		const img = ajouter(el, "img", "qbd-categorie-logo");
		img.src = src;
		img.alt = "";
		img.draggable = false;
		return;
	}
	const langage = LOGO_AUTORISE.has(c) && TAG_LANGAGE[c] ? codeLanguageOf(TAG_LANGAGE[c]) : null;
	if (langage?.logo) {
		const img = ajouter(el, "img", "qbd-categorie-logo");
		img.src = codeLanguageBadgeSrc(langage);
		img.alt = "";
		img.draggable = false;
		return;
	}
	const drapeau = estLangue(c) && c !== "langues" ? DRAPEAUX[c as LangueQuiz] : undefined;
	if (drapeau) {
		const img = ajouter(el, "img", "qbd-categorie-drapeau");
		img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(drapeau);
		img.alt = "";
		img.draggable = false;
		return;
	}
	currentHost().ui.setIcon(el, ICONES[c]);
}
