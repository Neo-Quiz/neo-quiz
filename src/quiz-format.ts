import type { QuestionRole } from "./types/quiz";
import { findQuizModeConfigIndex, parseQuizSource, QUIZ_BLOCK_RE } from "./quiz-utils";

/**
 * LE FORMAT LEARN / PRACTICE — module PUR : ni hôte, ni DOM, ni horloge.
 *
 * Spec : docs/superpowers/specs/2026-09-23-learn-practice-design.md §1 et §2.
 * Deux modes, et seulement deux : un bloc dont l'objet de configuration dit
 * `mode: "learn"` est un Learn ; TOUT autre bloc est un Practice — sans objet
 * de mode, ou avec un mode hérité (`exam`, `lesson`, `examMode`, `learnMode`)
 * que le format ne connaît plus.
 *
 * Ce module est le VOCABULAIRE partagé par trois lecteurs qui ne doivent
 * jamais diverger : le prompt (`composerPrompts` décrit `CHAMPS_DECRITS`),
 * le contrôle à l'arrivée (`verifierFormat`), et la génération Practice qui
 * joint le plan des tranches du Learn (`planDesTranches`). `npm run
 * check:quiz-format` et `npm run check:prompt` le tiennent.
 */

export type ModeQuiz = "learn" | "practice";

/** Ce que le prompt de CHAQUE mode doit nommer, mot pour mot : un champ que
    le contrôle à l'arrivée exige mais que le prompt tait n'est jamais produit
    (test du 2026-09-23 : `explain` absent du prompt, aucune explication). */
export const CHAMPS_DECRITS: Readonly<Record<ModeQuiz, readonly string[]>> = {
	learn: ['"slice"', '"role"', '"pre"', '"read"', '"explain"', '"recall"', '"hint"', 'mode: "learn"', '"objectives"', '"topic"', '"timeLimit"'],
	practice: ['"explain"', '"hint"', '"topic"', '"slice"', '"timeLimit"'],
};

/** Ce qu'aucun prompt ne doit plus mentionner : les modes et le champ retirés. */
export const MOTS_INTERDITS: readonly RegExp[] = [/\blesson\b/i, /\bexamMode\b/, /mode:\s*"exam"/];

export type Manque =
	| { kind: "sansExplication"; questions: string[] }
	| { kind: "trancheIncomplete"; slice: number; rolesManquants: QuestionRole[] }
	| { kind: "sansTranche"; questions: string[] }
	| { kind: "trancheInconnue"; questions: string[] }
	| { kind: "sansObjectifs" }
	/** Une pré-question sans indice : on la pose AVANT la lecture, sans rien
	    savoir — sans aide du tout, elle décourage (Ahmed, 2026-09-23). */
	| { kind: "preSansIndice"; questions: string[] };

interface Element {
	title?: unknown; prompt?: unknown; explain?: unknown; explainHtml?: unknown; hint?: unknown;
	slice?: unknown; role?: unknown; mode?: unknown; objectives?: unknown;
}

const texte = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const estTranche = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** Le nom d'une question dans une notice : son titre, sinon le début de son
    énoncé, sinon son rang. */
function nom(q: Element, i: number): string {
	const t = texte(q.title) ? q.title.trim() : texte(q.prompt) ? q.prompt.trim() : "";
	if (!t) return `#${i + 1}`;
	return t.length > 40 ? t.slice(0, 39) + "…" : t;
}

/** Les questions (objets seulement, rang d'origine gardé) et l'objet de
    configuration s'il existe. */
function separer(items: readonly unknown[]): { questions: { q: Element; i: number }[]; config: Element | null } {
	const idx = findQuizModeConfigIndex(items);
	const questions: { q: Element; i: number }[] = [];
	items.forEach((it, i) => {
		if (i === idx || !it || typeof it !== "object" || Array.isArray(it)) return;
		questions.push({ q: it as Element, i });
	});
	const config = idx >= 0 ? (items[idx] as Element) : null;
	return { questions, config };
}

export function modeDuBloc(items: readonly unknown[]): ModeQuiz {
	const { config } = separer(items);
	return config && typeof config.mode === "string" && config.mode.trim().toLowerCase() === "learn" ? "learn" : "practice";
}

/** Le suffixe de mode d'un nom de fichier : « — Learn » / « — Practice ». */
function suffixeDeMode(mode: ModeQuiz): string {
	return ` — ${mode === "learn" ? "Learn" : "Practice"}`;
}

/** Le nom de fichier d'une note générée : `<base> — Learn` / `<base> —
    Practice`. Le mode reste LISIBLE dans l'explorateur d'Obsidian, qui n'a
    pas de badge ; l'application le retire du titre affiché
    (`titreSansMode`) et le montre en badge à droite du type (Ahmed,
    2026-09-23). */
export function nomDeNote(base: string, mode: ModeQuiz): string {
	return base + suffixeDeMode(mode);
}

/** Le titre affiché d'une note : son nom SANS le suffixe de son mode, que
    le badge dit déjà. Seul le suffixe du mode RÉEL du bloc est retiré : un
    Practice nommé « … — Learn » à la main garde son nom entier. */
export function titreSansMode(nom: string, mode: ModeQuiz): string {
	const suffixe = suffixeDeMode(mode);
	return nom.endsWith(suffixe) && nom.length > suffixe.length ? nom.slice(0, -suffixe.length) : nom;
}

export function verifierFormat(mode: ModeQuiz, items: readonly unknown[], tranchesConnues?: readonly number[]): Manque[] {
	const { questions, config } = separer(items);
	const manques: Manque[] = [];
	if (mode === "practice") {
		const sans = questions.filter(({ q }) => !texte(q.explain) && !texte(q.explainHtml)).map(({ q, i }) => nom(q, i));
		if (sans.length) manques.push({ kind: "sansExplication", questions: sans });
		if (tranchesConnues) {
			const connues = new Set(tranchesConnues);
			const inconnues = questions.filter(({ q }) => estTranche(q.slice) && !connues.has(q.slice)).map(({ q, i }) => nom(q, i));
			if (inconnues.length) manques.push({ kind: "trancheInconnue", questions: inconnues });
		}
		return manques;
	}
	const objectifs = config?.objectives;
	if (!Array.isArray(objectifs) || !objectifs.some(texte)) manques.push({ kind: "sansObjectifs" });
	const horsTranche = questions.filter(({ q }) => !estTranche(q.slice)).map(({ q, i }) => nom(q, i));
	if (horsTranche.length) manques.push({ kind: "sansTranche", questions: horsTranche });
	const roles = new Map<number, Set<string>>();
	for (const { q } of questions) {
		if (!estTranche(q.slice)) continue;
		const s = roles.get(q.slice) ?? new Set<string>();
		s.add(typeof q.role === "string" ? q.role : "test");
		roles.set(q.slice, s);
	}
	const exiges: QuestionRole[] = ["pre", "read", "recall"];
	for (const slice of [...roles.keys()].sort((a, b) => a - b)) {
		const presents = roles.get(slice) as Set<string>;
		const rolesManquants = exiges.filter(r => !presents.has(r));
		if (rolesManquants.length) manques.push({ kind: "trancheIncomplete", slice, rolesManquants });
	}
	const preSansIndice = questions.filter(({ q }) => q.role === "pre" && !texte(q.hint)).map(({ q, i }) => nom(q, i));
	if (preSansIndice.length) manques.push({ kind: "preSansIndice", questions: preSansIndice });
	return manques;
}

export function planDesTranches(items: readonly unknown[]): { slice: number; titre: string }[] {
	const titres = new Map<number, string>();
	for (const { q, i } of separer(items).questions) {
		if (!estTranche(q.slice)) continue;
		if (q.role === "read" || !titres.has(q.slice)) titres.set(q.slice, nom(q, i));
	}
	return [...titres.entries()].sort((a, b) => a[0] - b[0]).map(([slice, titre]) => ({ slice, titre }));
}

/** Le premier bloc `quiz-blocks` d'une note, décodé ; `null` sans bloc ou
    sur un JSON5 illisible — jamais une exception : une note Learn abîmée ne
    doit pas faire échouer la génération de son Practice. */
export function lireBlocQuiz(markdown: string): unknown[] | null {
	const m = markdown.match(QUIZ_BLOCK_RE);
	if (!m) return null;
	try {
		return parseQuizSource(m[1], { logErrors: false }) as unknown[];
	} catch {
		return null;
	}
}
