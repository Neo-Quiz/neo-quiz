import { LOG_PREFIX } from "./branding";
import JSON5 from "json5";
import type { QuizQuestion, ExamOptions } from "./types/quiz";
import { lireGlossaire, type EntreeGlossaire } from "./glossaire";

/** A quiz's mode, read from the optional configuration object of the array.
    The format writes `mode: "learn"` (a Learn), `mode: "exam"` (a Test in
    Exam) or nothing (a Test in Practice; `mode: "quiz"` says the same thing
    explicitly). "lesson" is only the INTERNAL name of a Learn, kept by the
    engine: since 2026-09-29 (spec 2026-09-29-test-practice-exam-design §1.1)
    a block that writes `mode: "lesson"` is no longer read as a Learn, and the
    old `examMode` / `learnMode` booleans are no longer read at all — no quiz
    note of the vaults used them when they were retired. */
type QuizMode = "lesson" | "exam" | "quiz";

/**
 * Optional configuration object of a quiz-blocks JSON5 array (usually its
 * last item) — not a question: recognised by the absence of `prompt` and the
 * presence of one of the markers of `isQuizModeConfig`.
 */
interface QuizModeConfig {
	mode?: string;
	examDurationMinutes?: number;
	/** Free reference to the source note of the quiz (e.g. a `[[...]]` link) —
	    never read as a question marker by `isStrictQuizModeConfig`. */
	source?: string;
	/** The quiz's glossary (batch D, 2026-09-27): an object WITHOUT a prompt
	    that carries one is the configuration, even without `mode` or `source`
	    — a hand-written block may only want to declare terms. Raw, never
	    validated here: `extractExamOptions` hands it to `lireGlossaire`
	    (src/glossaire.ts), which filters out invalid entries. */
	glossary?: unknown;
}

/** Bounds of an Exam's duration, in minutes (spec 2026-09-29 §1.1: the upper
    bound went from 180 to 300). */
export const EXAM_DURATION_MIN = 1;
export const EXAM_DURATION_MAX = 300;

/** A duration brought back to whole minutes within [EXAM_DURATION_MIN,
    EXAM_DURATION_MAX]; `null` when the value is not a positive number. */
export function clampExamDuration(value: unknown): number | null {
	const n = typeof value === "number" ? value
		: typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.max(EXAM_DURATION_MIN, Math.min(EXAM_DURATION_MAX, Math.round(n)));
}

/** The duration of an Exam that does not state one (spec 2026-09-29 §1.2):
    1 min 30 per question, rounded to the nearest 5 minutes, within the
    bounds. Shared by the engine (a hand-written Exam without a duration),
    generation (the model omitted it) and the editor (switching to Exam), so
    that the three never disagree on the same quiz. Re-exported by
    `src/quiz-format.ts`, the format's vocabulary; it lives here because
    `quiz-format.ts` already imports this module. */
export function fallbackExamDuration(questionCount: number): number {
	const n = Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 0;
	const rounded = Math.round((n * 1.5) / 5) * 5;
	return Math.max(EXAM_DURATION_MIN, Math.min(EXAM_DURATION_MAX, rounded));
}

interface ParseQuizSourceOptions {
	/** Le scanner relit pendant l'autosave : un JSON5 transitoirement incomplet
	    n'est pas une erreur à journaliser toutes les deux secondes. */
	logErrors?: boolean;
}

function parseQuizSource(source?: string | null, options: ParseQuizSourceOptions = {}): QuizQuestion[] {
	const raw = String(source ?? "").trim();

	if (raw.length === 0) return [];

	let parsed: unknown;
	try {
		parsed = JSON5.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.logErrors !== false) {
			// Les appels interactifs gardent le diagnostic détaillé ; seul le scan
			// automatique le désactive pour ne pas transformer la frappe en erreurs.
			console.error(LOG_PREFIX + " JSON5 parse error:", message);
			if (message && message.includes("position")) {
				const match = message.match(/position (\d+)/);
				if (match) {
					const pos = parseInt(match[1]);
					console.error(LOG_PREFIX + " Caractère à la position", pos + ":", raw.charAt(pos));
					console.error(LOG_PREFIX + " Contexte:", raw.substring(Math.max(0, pos - 30), pos + 30));
				}
			}
		}
		throw new Error("Le bloc ```quiz-blocks doit contenir un tableau JSON5 valide.");
	}

	if (!Array.isArray(parsed)) {
		throw new Error("Le contenu du bloc quiz-blocks doit être un tableau.");
	}

	return parsed as QuizQuestion[];
}

/**
 * Cet élément est-il l'objet de CONFIGURATION du bloc plutôt qu'une question ?
 * Aucun énoncé, et l'un des marqueurs de mode.
 *
 * INTERNE. Le point d'entrée est `findQuizModeConfigIndex` : ce prédicat seul
 * ne suffit pas à décider, il dépend de la position (cf. plus bas). Il a
 * longtemps été exporté sous le nom `isModeConfig`, et chaque lecteur du bloc
 * l'appelait élément par élément — c'est cette forme-là qui laissait la
 * question fantôme entrer, chaque lecteur comptant les siennes.
 */
function isQuizModeConfig(item: unknown): boolean {
	const q = item as (QuizQuestion & QuizModeConfig) | null | undefined;
	if (!q || typeof q !== "object" || Array.isArray(q) || q.prompt) return false;
	/* FIX round 1 de revue (task 8) : un bloc écrit à la main comme
	   `[{ source: "[[...]]" }]`, SANS `mode`, n'était reconnu par aucune des
	   deux conditions ci-dessus/dessous — l'objet devenait une question
	   fantôme et `source` était ignoré en silence. `source` n'est le nom
	   d'aucun champ de question (types/quiz.ts) : sa seule présence, sur un
	   objet sans `prompt`, suffit à le désigner comme configuration — désormais
	   sans danger pour une carte "read" créditant sa propre source (ex.
	   `{ role: "read", passage: "…", source: "Wikipédia" }`), fermé par l'ajout
	   de `passage`/`passageHtml` aux MARQUEURS ci-dessous (round 2 de revue).
	   Casse EXACTE (`source`, pas `Source`/`SOURCE`) volontairement : contrairement
	   à `mode`, dont la VALEUR passe par `normalizeQuizMode`, ceci teste le NOM
	   d'une clé — aucun autre marqueur de cette fonction (`options`, `promptHtml`,
	   `examMode`…) ne tolère de variante de casse sur son nom, et une clé mal
	   casée échoue ici DU BON CÔTÉ : l'objet reste une question ordinaire au lieu
	   d'être pris pour une configuration. */
	if (typeof q.source === "string" && q.source.trim() !== "") return true;
	/* Même règle que `source` juste au-dessus : un objet sans énoncé qui porte
	   un `glossary` (tableau, même vide) EST la configuration — `glossary`
	   n'est le nom d'aucun champ de question (types/quiz.ts). Ajouté pour le
	   lot D (bulles de vocabulaire, 2026-09-27) : un quiz écrit à la main doit
	   pouvoir déclarer un glossaire sans déclarer de mode. */
	if (Array.isArray(q.glossary)) return true;
	/* The format's modes, not "any string". A legitimate question such as
	   `{ title: 'Which mode?', mode: 'transport' }` used to pass for the
	   block's configuration and VANISHED on rewrite — and in last position,
	   even a complete question with its answers (`mode: 'dark'`) did (codex
	   review 2026-07-31). It is the list `readModeConfig` accepts too:
	   recognition and reading speak the same vocabulary. */
	return normalizeQuizMode(q.mode) !== null;
}

/**
 * The mode written in a block, brought back to its internal name — or `null`
 * when it is not one.
 *
 * TOLERANT of case and spaces: a hand-written block says `mode: 'Learn'` or
 * `mode: 'exam '` as easily as the exact form, and requiring exactness would
 * turn the object into a phantom question instead of a configuration.
 *
 * `"learn"` → the internal `"lesson"`; `"exam"`; `"quiz"` (an explicit
 * Practice). `"lesson"` itself is no longer a format value (retired on
 * 2026-09-29, spec §1.1): the internal name is code, not format.
 */
export function normalizeQuizMode(value: unknown): QuizMode | null {
	if (typeof value !== "string") return null;
	const m = value.trim().toLowerCase();
	if (m === "learn") return "lesson";
	return m === "quiz" || m === "exam" ? m : null;
}

/**
 * Le même élément, mais SANS le moindre signe de question. Utilisé pour
 * reconnaître une configuration ailleurs qu'en dernière position, où l'on n'a
 * pas le droit de se tromper : mal juger le dernier élément ne coûte qu'un
 * mode, mal juger un élément du milieu ferait DISPARAÎTRE une question.
 *
 * Mesuré sur les deux vaults avant d'écrire ceci : 1194 éléments, dont 240 sans
 * énoncé, et exactement 2 qui satisfont `isQuizModeConfig` — deux lignes vides
 * héritées du bug de la question fantôme, toutes deux en DERNIÈRE position, et
 * qui portent le vrai mode de leur quiz. Les exclure les ferait réapparaître
 * comme des questions vides dans deux notes réelles ; c'est pourquoi la règle
 * stricte ne s'applique qu'ailleurs qu'à la fin.
 */
function isStrictQuizModeConfig(item: unknown): boolean {
	if (!isQuizModeConfig(item)) return false;
	const q = item as Record<string, unknown>;
	/* Les marqueurs VIDES ne comptent pas. C'est ce qui permet d'appliquer la
	   règle stricte PARTOUT, dernière position comprise : les deux lignes
	   héritées du bug de la question fantôme portent `options: ['', '']` et
	   `correctIndex: 0` — des coquilles sans contenu — là où une vraie question
	   a des réponses écrites. Sans cette nuance il fallait relâcher le critère
	   en fin de tableau, et une question réelle portant un champ `mode` y
	   disparaissait (revue codex 2026-07-31). */
	const rempli = (v: unknown): boolean => Array.isArray(v)
		? v.some(x => typeof x === "string" ? x.trim() !== "" : x != null)
		: typeof v === "string" ? v.trim() !== "" : v != null && v !== false;
	/* TOUS les marqueurs de question du moteur, pas seulement les plus visibles.
	   En oublier laissait passer une question historique complète —
	   `{ mode: 'learn', promptHtml: '<p>2 + 2 ?</p>', text: true, answer: '4' }`
	   était pris pour la configuration et retiré du quiz (revue codex
	   2026-07-31). */
	const MARQUEURS = ["options", "optionHtml", "cloze", "ordering", "matching",
		"promptHtml", "answer", "acceptedAnswers", "acceptableAnswers",
		"correctText", "correctAnswers", "numeric",
		// `tolerance`, `tolerancePercent` et `unit` suffisent au moteur à
		// déclarer une réponse numérique (engine/numeric.ts isNumericQuestion) :
		// les omettre faisait passer une vraie question pour la configuration.
		"tolerance", "tolerancePercent", "unit",
		// FIX round 2 de revue (task 8) : `passage`/`passageHtml` (le support
		// affiché par une carte de rôle "read", engine/passage.ts) n'étaient
		// PAS des marqueurs. Une carte légitimement sans `prompt` ni réponse
		// — `{ role: "read", passage: "…", source: "Wikipédia" }`, `source`
		// servant ici à créditer une citation, pas à référencer une leçon —
		// satisfaisait alors `isQuizModeConfig` (ajout de `source` au round 1)
		// ET la règle stricte, et DISPARAISSAIT du quiz : exactement la
		// régression que ce fichier documente déjà pour `promptHtml`/`answer`.
		// Correctif structurel : protège toute carte porteuse d'un support,
		// quel que soit le champ ajouté par la suite pour la déclencher.
		"passage", "passageHtml"];
	if (MARQUEURS.some(cle => rempli(q[cle]))) return false;
	/* `text` compte seulement s'il vaut EXACTEMENT `true` — c'est la règle du
	   moteur (engine.ts isTextQuestion). Un `text: { variant: 'bash' }` est une
	   forme imbriquée que le moteur ne lit QUE sur une question déjà déclarée
	   texte ; le traiter comme un marqueur transformait une configuration
	   légitime en question. */
	if (q.text === true) return false;
	/* `type` ne compte que s'il nomme un type de QUESTION. Une configuration a
	   le droit de porter une clé `type` personnalisée (« teacher-profile ») —
	   la traiter comme un marqueur en faisait une question fantôme. */
	if (typeof q.type === "string" && ["text", "single", "multiple", "multi"].includes(q.type)) return false;
	return true;
}

/**
 * INDEX de l'objet de configuration dans un bloc, ou -1. C'est la seule façon
 * correcte de le repérer : le critère dépend de la POSITION (cf.
 * `isStrictQuizModeConfig`), et un test élément par élément ne peut pas le
 * savoir. Toutes les lectures du bloc passent par ici — le moteur
 * (`extractExamOptions`), la page « quiz », le scanner et la génération IA —
 * pour qu'aucune ne compte ses questions autrement que les autres.
 */
export function findQuizModeConfigIndex(items: readonly unknown[]): number {
	if (!Array.isArray(items) || items.length === 0) return -1;
	/* La MÊME règle partout, y compris en dernière position. Elle y a un temps
	   été relâchée pour ne pas faire réapparaître deux lignes vides de notes
	   réelles ; excuser les marqueurs VIDES (cf. `isStrictQuizModeConfig`)
	   obtient le même résultat sans le prix — une question réelle portant un
	   champ `mode` ne disparaît plus, où qu'elle soit. */
	const dernier = items.length - 1;
	if (isStrictQuizModeConfig(items[dernier])) return dernier;
	return items.findIndex(isStrictQuizModeConfig);
}

function extractExamOptions(quizArray: QuizQuestion[]): {
	questions: QuizQuestion[];
	quizMode: QuizMode;
	examOptions: ExamOptions | null;
	/** The quiz's glossary, already filtered to its valid entries
	    (`lireGlossaire`) — empty without a configuration object, or when it
	    carries no `glossary`. */
	glossary: EntreeGlossaire[];
} {
	if (!Array.isArray(quizArray) || quizArray.length === 0) return { questions: quizArray, quizMode: "quiz", examOptions: null, glossary: [] };

	/* ANYWHERE in the array, not only last. The export always writes the
	   configuration at the end, but a quiz written by hand — or by a model —
	   readily puts it first. The engine then showed an EMPTY first card and
	   counted one question too many, where the quiz page and the scanner
	   already recognised it anywhere: "0/11" for a ten-question quiz.

	   One rule everywhere (`findQuizModeConfigIndex`): away from the end, a
	   mistake would not cost a mode but a question. */
	const configIdx = findQuizModeConfigIndex(quizArray);
	const lastItem = configIdx >= 0 ? quizArray[configIdx] as QuizQuestion & QuizModeConfig : undefined;

	if (lastItem) {
		/* The mode goes through the same normalisation as RECOGNITION —
		   otherwise a `mode: 'Learn'` would be accepted as a configuration,
		   then read as a Practice. */
		const quizMode: QuizMode = normalizeQuizMode(lastItem.mode) ?? "quiz";
		const questions = quizArray.filter((_, i) => i !== configIdx);

		/* An Exam that does not state its duration (written by hand) gets the
		   fallback rule, as generation and the editor would have written it
		   (spec 2026-09-29 §1.2). `examAutoSubmit` / `examShowTimer` are no
		   longer read: an Exam is a visible clock and a hand-in at zero. A
		   duration on another mode is ignored: the Learn → Exam switch it fed
		   is gone (§3.5). */
		const examOptions: ExamOptions | null = quizMode === "exam"
			? { durationMinutes: clampExamDuration(lastItem.examDurationMinutes) ?? fallbackExamDuration(questions.length) }
			: null;

		return {
			questions,
			quizMode,
			examOptions,
			glossary: lireGlossaire(lastItem.glossary)
		};
	}

	return { questions: quizArray, quizMode: "quiz", examOptions: null, glossary: [] };
}

/** Forme structurelle minimale acceptée par `pickLessonFields` : les six
    champs "leçon" possibles d'une question, dans n'importe lequel des trois
    types réels qui les portent (`QuestionBase`, `ParsedQuizItem`,
    `DraftQuestion`) — typés `unknown` ici pour ne dépendre d'aucun des trois. */
interface LessonFieldsSource {
	lesson?: unknown;
	lessonHtml?: unknown;
	_lessonHtml?: unknown;
	learn?: unknown;
	learnHtml?: unknown;
	_learnHtml?: unknown;
}

/**
 * Contenu "Leçon" BRUT d'une question, texte et HTML chacun ramenés à UNE
 * seule chaîne de repli — nom canonique d'abord, alias hérité `learn*`
 * ensuite (mode "learn" renommé "lesson", task 0 du lot mode leçon,
 * 2026-08-31) : un quiz partagé écrit avant le renommage doit continuer de
 * s'afficher indéfiniment, on ne réécrit plus jamais que le nouveau nom.
 *
 * SEULE définition de cet ordre dans tout le plugin (round 1 de revue,
 * 2026-08-31) : `engine/sanitizer.ts` (rendu, a besoin en plus du sanitizer
 * pour choisir entre HTML pré-rendu et texte brut) et `editor/convert.ts` /
 * `editor/export.ts` (lecture / écriture du JSON5, qui n'ont pas besoin du
 * sanitizer) l'appellent tous les trois — avant cette fonction, chacun avait
 * réécrit sa propre chaîne, dans un ordre différent des deux autres, et
 * `export.ts` avait même oublié `lessonHtml` (présent seulement dans
 * `ParsedQuizItem`, pas dans `DraftQuestion`).
 */
export function pickLessonFields(q: LessonFieldsSource): { text?: string; html?: string } {
	const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
	return {
		text: str(q.lesson) ?? str(q.learn),
		html: str(q.lessonHtml) ?? str(q._lessonHtml) ?? str(q.learnHtml) ?? str(q._learnHtml),
	};
}

/* DOM standard, PAS `container.createEl()` : cette extension est posée sur
   `HTMLElement` par Obsidian et n'existe pas dans l'application Windows, où
   cette fonction est pourtant bundlée — elle y aurait planté si on l'avait
   atteinte. Aucun `import` ne trahit ce genre de dépendance : c'est le
   typecheck de l'app, pas `check:host`, qui la détecte. */
function renderParagraph(container: HTMLElement, text?: string | null): HTMLParagraphElement {
	const p = document.createElement("p");
	p.textContent = String(text ?? "");
	container.append(p);
	return p;
}

/* Premier bloc ```quiz-blocks``` d'une note — groupe 1 = la source JSON5.
   TOLÉRANT aux fins de ligne CRLF (notes Windows/importées), aux attributs
   après le nom du langage et à l'indentation de la fence fermante : le
   scanner (indexOf, scanner.ts) accepte tout ça, et un regex strict `\n`
   faisait diverger l'index et les actions — le quiz apparaissait dans
   « Mes quiz » mais Share/Edit/Delete répondaient « bloc introuvable ». */
const QUIZ_BLOCK_RE = /```quiz-blocks[^\n]*\n([\s\S]*?)\r?\n[ \t]*```/;

export { parseQuizSource, extractExamOptions, renderParagraph, QUIZ_BLOCK_RE };
