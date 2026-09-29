/* ══════════════════════════════════════════════════════════
   THE SUBJECT, ON THE "GENERATE" PAGE SIDE (feedback #7, 2026-09-26)

   Each subject's translated name, icon and menu place (categorie-quiz.ts),
   and the NOTICE set in the composer's output-folder row: "Python
   detected", as text with the icon, no badge. Nothing is shown for
   `general`.

   A language's icon is its FLAG (2026-09-29): thirty languages behind one
   and the same Lucide glyph could not be told apart. Emoji flags are not
   an option — the project draws no emoji, and Windows shows "FR" in
   letters instead of the flag. The SVGs come from `country-flag-icons`
   and go in as an <img> data URL: an image, which runs nothing, never
   markup set with innerHTML.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { CATEGORIES, LANGUES_IDS, estLangue } from "./categorie-quiz";
import type { CategorieQuiz, LangueQuiz } from "./categorie-quiz";
import type { OptionCategorie } from "./ui-select";
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
	secu: "shield",
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

/* The menu section heading OPENED by a subject: the first of each group in
   CATEGORIES' order. Forty-odd subjects in one flat list could not be
   scanned; grouped, the eye goes straight to "Sciences". */
const SECTIONS: Readonly<Partial<Record<CategorieQuiz, TransKey>>> = {
	python: "ai.categorie.section.programming",
	bash: "ai.categorie.section.computing",
	maths: "ai.categorie.section.sciences",
	histoire: "ai.categorie.section.humanities",
	musique: "ai.categorie.section.other",
};

/** A subject's displayed name, read AT RENDER (current language). */
export function libelleCategorie(c: CategorieQuiz): string {
	return t(NOMS[c]);
}

/** Draws a subject's icon in `el`: a language's flag, otherwise its Lucide
    glyph. */
export function peindreIconeCategorie(el: HTMLElement, c: CategorieQuiz): void {
	el.replaceChildren();
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

/** "Python detected". French says "Détecté : Chimie": with forty-odd
    subjects of both genders, "{name} détecté" could not agree (it once
    special-cased "Maths détectées" alone). */
export function libelleDetecte(c: CategorieQuiz): string {
	return t("ai.categorie.detected", { name: libelleCategorie(c) });
}

/** The options menu's choices: every subject, `general` included, each
    group opened by its section heading — and the languages gathered in ONE
    "Languages" row that opens them, searchable, in a second flyout (thirty
    of them would bury the rest of the list). */
export function choixCategories(): OptionCategorie[] {
	const choix = (c: CategorieQuiz): OptionCategorie =>
		({ value: c, label: libelleCategorie(c), renderIcon: (el) => peindreIconeCategorie(el, c) });
	const liste: OptionCategorie[] = [];
	for (const c of CATEGORIES) {
		if (estLangue(c)) continue;
		const section = SECTIONS[c];
		liste.push({ ...choix(c), ...(section ? { section: t(section) } : {}) });
		// The Languages row closes the humanities, in the place they held.
		if (c === "psycho") {
			liste.push({
				value: "", label: t("ai.categorie.section.languages"), icon: "languages",
				section: t("ai.categorie.section.languages"),
				children: LANGUES_IDS.map(choix),
			});
		}
	}
	return liste;
}

/**
 * Paints the notice in `el`: icon and text, or nothing. `detectee`: the
 * subject comes from the detection ("Python detected"); otherwise it was
 * chosen in the options ("Python").
 */
export function peindreAvisCategorie(el: HTMLElement, c: CategorieQuiz, detectee: boolean): void {
	/* Repainted on every keystroke: nothing changes while the subject stays
	   the same, or the appearance would replay on every letter. */
	const cle = `${c}|${detectee}`;
	if (el.dataset.cle === cle) return;
	el.dataset.cle = cle;
	el.replaceChildren();
	const visible = c !== "general";
	el.hidden = !visible;
	if (!visible) return;
	peindreIconeCategorie(ajouter(el, "span", "qbd-ai-categorie-icone"), c);
	ajouter(el, "span", "qbd-ai-categorie-texte", detectee ? libelleDetecte(c) : libelleCategorie(c));
}
