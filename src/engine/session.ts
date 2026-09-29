import type { LearnQueueEntry, LearnResume, LearnVerdict, QuestionSelection, QuestionShuffleEntry, QuizState, TextOnlyRating } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   LA PHOTO DE SESSION D'UN QUIZ (2026-09-26) — reprendre là où on s'était
   arrêté (spec docs/superpowers/specs/2026-09-26-reprise-quiz-design.md).

   PUR : ni DOM, ni hôte, ni horloge (l'heure est un paramètre). Le moteur
   photographie son état après chaque réponse ; l'hôte range la photo et la
   rend à la prochaine ouverture. Tout est rangé par IDENTIFIANT de question
   (`ctx.questionIds`, la règle unique de `quiz-ids.ts`), jamais par index :
   un quiz modifié entre deux sessions garde les réponses de ses questions
   restantes, une question nouvelle arrive vide.

   Les options sont désignées par leur index D'ORIGINE (`data-orig`) : une
   sélection reste juste quel que soit l'ordre affiché. Le mélange est gardé
   pour que le quiz se rouvre TEL QU'IL ÉTAIT — et rejeté si le nombre
   d'options a changé, avec la sélection qu'il accompagnait.
══════════════════════════════════════════════════════════ */

export const SESSION_VERSION = 1;

/** Une sélection sans `Set` : le JSON ne sait pas les écrire. */
export type SelectionSerialisee = string | string[] | Array<number | null> | number[] | number | null;

export interface EtatQuestion {
	selection?: SelectionSerialisee;
	melange?: QuestionShuffleEntry;
	texte?: string;
	verifiee?: boolean;
	note?: TextOnlyRating | null;
	jnsp?: boolean;
	indice?: boolean;
	journalisee?: boolean;
	/* The Learn retry loop (engine/learn-loop.ts, 2026-09-29), each key only
	   when it differs from a fresh question: the verdict, the misses, being
	   retried, the current attempt checked, a written answer waiting for
	   its own verdict. */
	verdict?: Exclude<LearnVerdict, "none">;
	ratees?: number;
	reprise?: boolean;
	verifieeLearn?: boolean;
	enAttente?: boolean;
}

export interface SessionQuiz {
	v: 1;
	/** Identifiant de la question courante ; null hors d'une question. */
	courante: string | null;
	questions: Record<string, EtatQuestion>;
	/** Horodatage de l'écriture (ms) : la session la plus récente l'emporte. */
	ecrite: number;
	/** Learn: the missed questions waiting for their retry, by id. Absent
	    from a snapshot taken before the retry loop existed. */
	file?: Array<{ id: string; depuis: number }>;
	/** Learn: where the normal order resumes after the retries — an id, or
	    "end" past the last question. */
	suite?: string;
	/** Learn: the retried question that resume point belongs to, by id. */
	enReprise?: string;
}

export type EtatPhoto = Pick<QuizState,
	"selections" | "shuffleMap" | "textOnlyAnswers" | "textOnlyChecked" | "textOnlyRatings" | "lessonPreSkipped" | "hintSeen" | "recorded"
	| "learnVerdicts" | "learnMisses" | "learnRetrying" | "learnChecked" | "learnPending" | "learnQueue" | "learnResume" | "learnRetryQi">;

export interface Restauration extends EtatPhoto {
	/** INDEX de la question sur laquelle rouvrir. */
	courante: number;
}

const NOTES: readonly TextOnlyRating[] = ["understood", "partial", "review"];
const VERDICTS: readonly LearnVerdict[] = ["first", "retried", "missed"];

function serialiser(s: QuestionSelection): SelectionSerialisee {
	if (s instanceof Set) return [...s].sort((a, b) => a - b);
	return Array.isArray(s) ? [...s] as SelectionSerialisee : s as SelectionSerialisee;
}

/** Vrai si la sélection porte une réponse (pas l'état initial). */
function repondue(s: QuestionSelection | undefined): boolean {
	if (s === null || s === undefined || s === "") return false;
	if (s instanceof Set) return s.size > 0;
	if (Array.isArray(s)) return s.some(v => v !== null && v !== "");
	return true;
}

export function photographier(etat: EtatPhoto, ids: readonly string[], courante: number | null, maintenant: number): SessionQuiz {
	const questions: Record<string, EtatQuestion> = {};
	ids.forEach((id, i) => {
		const e: EtatQuestion = {};
		if (repondue(etat.selections[i])) e.selection = serialiser(etat.selections[i]);
		const m = etat.shuffleMap[i];
		if (m !== null && m !== undefined) e.melange = Array.isArray(m) ? [...m] : { rows: [...m.rows], choices: [...m.choices] };
		if (etat.textOnlyAnswers[i]) e.texte = etat.textOnlyAnswers[i];
		if (etat.textOnlyChecked[i]) e.verifiee = true;
		if (etat.textOnlyRatings[i]) e.note = etat.textOnlyRatings[i];
		if (etat.lessonPreSkipped[i]) e.jnsp = true;
		if (etat.hintSeen[i]) e.indice = true;
		if (etat.recorded[i]) e.journalisee = true;
		const v = etat.learnVerdicts?.[i];
		if (v && v !== "none") e.verdict = v;
		if (etat.learnMisses?.[i]) e.ratees = etat.learnMisses[i];
		if (etat.learnRetrying?.[i]) e.reprise = true;
		if (etat.learnChecked?.[i]) e.verifieeLearn = true;
		if (etat.learnPending?.[i]) e.enAttente = true;
		// Un mélange seul n'est pas une réponse : une question jamais touchée
		// n'encombre pas la photo (elle sera remélangée, ce qui est sans effet).
		const cles = Object.keys(e).filter(k => k !== "melange");
		if (cles.length > 0) questions[id] = e;
	});
	const photo: SessionQuiz = {
		v: SESSION_VERSION,
		courante: courante === null ? null : (ids[courante] ?? null),
		questions,
		ecrite: maintenant,
	};
	const file = (etat.learnQueue ?? []).filter(e => ids[e.qi] !== undefined).map(e => ({ id: ids[e.qi], depuis: e.since }));
	if (file.length > 0) photo.file = file;
	const r = etat.learnResume;
	if (r === "end") photo.suite = "end";
	else if (typeof r === "number" && ids[r] !== undefined) photo.suite = ids[r];
	const rq = etat.learnRetryQi;
	if (typeof rq === "number" && ids[rq] !== undefined) photo.enReprise = ids[rq];
	return photo;
}

const estEntier = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function estPermutation(v: unknown, n: number): v is number[] {
	if (!Array.isArray(v) || v.length !== n || !v.every(estEntier)) return false;
	return new Set(v).size === n && v.every(x => x < n);
}

/** Le mélange sauvé, s'il a EXACTEMENT la forme du mélange neuf. */
function melangeValide(sauve: unknown, neuf: QuestionShuffleEntry): QuestionShuffleEntry | undefined {
	if (neuf === null || sauve === undefined) return undefined;
	if (Array.isArray(neuf)) return estPermutation(sauve, neuf.length) ? [...sauve] : undefined;
	const s = sauve as { rows?: unknown; choices?: unknown } | null;
	if (!s || typeof s !== "object") return undefined;
	return estPermutation(s.rows, neuf.rows.length) && estPermutation(s.choices, neuf.choices.length)
		? { rows: [...s.rows], choices: [...s.choices] }
		: undefined;
}

/** La sélection sauvée, si elle a le TYPE de la sélection initiale. `borne` : nombre d'options connu (mélange), sinon null. */
function selectionValide(sauve: unknown, initiale: QuestionSelection, borne: number | null): QuestionSelection | undefined {
	const dansBornes = (v: number): boolean => borne === null || v < borne;
	if (initiale instanceof Set) {
		return Array.isArray(sauve) && sauve.every(v => estEntier(v) && dansBornes(v)) ? new Set(sauve as number[]) : undefined;
	}
	if (Array.isArray(initiale)) {
		if (!Array.isArray(sauve) || sauve.length !== initiale.length) return undefined;
		const texte = initiale.every(v => typeof v === "string");
		if (texte) {
			return sauve.every(v => typeof v === "string") ? [...sauve] as QuestionSelection : undefined;
		}
		// Classement ou appariement : chaque élément non-null doit être < borne
		const ok = sauve.every(v => v === null || (estEntier(v) && dansBornes(v)));
		return ok ? [...sauve] as QuestionSelection : undefined;
	}
	if (typeof initiale === "string") return typeof sauve === "string" ? sauve : undefined;
	// Choix unique ou carte mémoire.
	// Carte mémoire : initiale === null ET borne === null, seul null accepté.
	if (initiale === null && borne === null) {
		return sauve === null ? null : undefined;
	}
	// Choix unique : scalar selection (initiale est null ou un nombre)
	if (sauve === null) return null;
	return estEntier(sauve) && dansBornes(sauve) ? sauve : undefined;
}

function copieSelection(s: QuestionSelection): QuestionSelection {
	if (s instanceof Set) return new Set(s);
	return Array.isArray(s) ? [...s] as QuestionSelection : s;
}

export function restaurer(brut: unknown, ids: readonly string[], base: { selections: QuestionSelection[]; shuffleMap: QuestionShuffleEntry[] }): Restauration | null {
	let photo: unknown = brut;
	if (typeof brut === "string") {
		try { photo = JSON.parse(brut); } catch { return null; }
	}
	const p = photo as Partial<SessionQuiz> | null;
	if (!p || typeof p !== "object" || p.v !== SESSION_VERSION) return null;
	if (!p.questions || typeof p.questions !== "object" || Array.isArray(p.questions)) return null;
	if (p.courante !== null && typeof p.courante !== "string") return null;

	const n = ids.length;
	const r: Restauration = {
		courante: 0,
		selections: base.selections.map(copieSelection),
		shuffleMap: base.shuffleMap.map(m => m === null ? null : Array.isArray(m) ? [...m] : { rows: [...m.rows], choices: [...m.choices] }),
		textOnlyAnswers: new Array<string>(n).fill(""),
		textOnlyChecked: new Array<boolean>(n).fill(false),
		textOnlyRatings: new Array<TextOnlyRating | null>(n).fill(null),
		lessonPreSkipped: new Array<boolean>(n).fill(false),
		hintSeen: new Array<boolean>(n).fill(false),
		recorded: new Array<boolean>(n).fill(false),
		learnVerdicts: new Array<LearnVerdict>(n).fill("none"),
		learnMisses: new Array<number>(n).fill(0),
		learnRetrying: new Array<boolean>(n).fill(false),
		learnChecked: new Array<boolean>(n).fill(false),
		learnPending: new Array<boolean>(n).fill(false),
		learnQueue: [],
		learnResume: null,
		learnRetryQi: null,
	};

	ids.forEach((id, i) => {
		const e = (p.questions as Record<string, unknown>)[id] as EtatQuestion | undefined;
		if (!e || typeof e !== "object") return;
		const neuf = base.shuffleMap[i];
		const melange = melangeValide(e.melange, neuf);
		// Un mélange PRÉSENT mais de mauvaise forme : les options ont changé,
		// la sélection qui l'accompagnait ne veut plus rien dire.
		const melangeRejete = neuf !== null && e.melange !== undefined && melange === undefined;
		if (melange) r.shuffleMap[i] = melange;
		if (!melangeRejete && e.selection !== undefined) {
			const initiale = base.selections[i];
			let borne: number | null = null;
			if (neuf === null) {
				borne = null;
			} else if (Array.isArray(neuf)) {
				// Pour Set/scalar, borne = shuffle.length. Pour array (classement), borne = initiale.length.
				borne = Array.isArray(initiale) ? initiale.length : neuf.length;
			} else {
				// Pour {rows, choices} (appariement), borne = choices.length
				borne = neuf.choices.length;
			}
			const sel = selectionValide(e.selection, initiale, borne);
			if (sel !== undefined) r.selections[i] = sel;
		}
		if (typeof e.texte === "string") r.textOnlyAnswers[i] = e.texte;
		if (e.verifiee === true) r.textOnlyChecked[i] = true;
		if (e.note && NOTES.includes(e.note)) r.textOnlyRatings[i] = e.note;
		if (e.jnsp === true) r.lessonPreSkipped[i] = true;
		if (e.indice === true) r.hintSeen[i] = true;
		if (e.journalisee === true) r.recorded[i] = true;
		if (typeof e.verdict === "string" && VERDICTS.includes(e.verdict)) r.learnVerdicts[i] = e.verdict;
		if (estEntier(e.ratees)) r.learnMisses[i] = e.ratees;
		if (e.reprise === true) r.learnRetrying[i] = true;
		/* A card checked with options that have changed since: its answer was
		   dropped above, so it must not reopen as checked — it would show a
		   correction with no answer, and could never be answered again. */
		if (e.verifieeLearn === true && !melangeRejete) r.learnChecked[i] = true;
		if (e.enAttente === true && !melangeRejete) r.learnPending[i] = true;
	});

	/* The Learn queue and resume point, by id: a question removed from the
	   quiz since simply leaves the queue. A malformed value is ignored, never
	   a reason to reopen the quiz from zero. */
	const file: LearnQueueEntry[] = [];
	if (Array.isArray(p.file)) {
		for (const e of p.file as unknown[]) {
			const x = e as { id?: unknown; depuis?: unknown } | null;
			if (!x || typeof x.id !== "string" || !estEntier(x.depuis)) continue;
			const qi = ids.indexOf(x.id);
			if (qi >= 0 && !file.some(f => f.qi === qi)) file.push({ qi, since: x.depuis });
		}
	}
	r.learnQueue = file;
	let suite: LearnResume = null;
	if (p.suite === "end") suite = "end";
	else if (typeof p.suite === "string" && ids.indexOf(p.suite) >= 0) suite = ids.indexOf(p.suite);
	r.learnResume = suite;
	const enReprise = typeof p.enReprise === "string" ? ids.indexOf(p.enReprise) : -1;
	r.learnRetryQi = enReprise >= 0 ? enReprise : null;

	const ici = p.courante === null ? -1 : ids.indexOf(p.courante);
	if (ici >= 0) r.courante = ici;
	else {
		const vide = ids.findIndex((_, i) => !repondue(r.selections[i]) && !r.textOnlyAnswers[i] && !r.lessonPreSkipped[i]);
		r.courante = vide >= 0 ? vide : 0;
	}
	return r;
}

/** Le puits de session que l'hôte passe au moteur (`renderInteractiveQuiz`). */
export interface SessionSink {
	/** La photo à reprendre, lue par l'hôte avant l'ouverture ; null si aucune. */
	initiale: SessionQuiz | null;
	enregistrer(s: SessionQuiz): void;
	effacer(): void;
}
