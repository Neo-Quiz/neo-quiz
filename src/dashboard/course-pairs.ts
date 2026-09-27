import type { QuizIndexEntry } from "./scanner";

/* ══════════════════════════════════════════════════════════
   UN COURS, DEUX MODES — module PUR (ni hôte, ni DOM).

   Un cours a un fichier par mode : « CM1 — Learn » et « CM1 — Practice ».
   Le format ne change pas (un fichier par mode reste la règle définitive,
   Ahmed 2026-09-24) ; c'est l'AFFICHAGE qui les réunit : six cartes pour
   trois CM donnaient l'impression d'une montagne de travail.

   Deux quiz forment un cours quand ils sont dans le MÊME dossier, portent
   le MÊME titre (le suffixe de mode est déjà retiré par le scanner) et ont
   des modes DIFFÉRENTS. Au-delà de deux homonymes, rien n'est réuni : on ne
   devine pas lequel va avec lequel.
══════════════════════════════════════════════════════════ */

/** Une carte de la grille : un quiz, et son frère de l'autre mode s'il a été
    réuni avec lui. `quiz` est toujours le Learn quand les deux existent. */
export interface CarteCours {
	quiz: QuizIndexEntry;
	frere?: QuizIndexEntry;
}

function cle(q: QuizIndexEntry): string {
	const dossier = q.path.split("/").slice(0, -1).join("/");
	return dossier + "\u0000" + q.title.trim().toLocaleLowerCase();
}

/** Le quiz de l'AUTRE mode du même cours, ou `null`. */
export function quizFrere(quiz: QuizIndexEntry, tous: readonly QuizIndexEntry[]): QuizIndexEntry | null {
	const k = cle(quiz);
	const memes = tous.filter(q => cle(q) === k);
	if (memes.length !== 2) return null;
	const autre = memes.find(q => q.path !== quiz.path);
	return autre && autre.mode !== quiz.mode ? autre : null;
}

/** Les cartes d'une grille, dans l'ordre reçu : un cours réuni prend la place
    de son premier quiz, le Learn en tête. `actif` faux : une carte par quiz,
    comme avant. */
export function regrouperParCours(quizzes: readonly QuizIndexEntry[], actif: boolean): CarteCours[] {
	if (!actif) return quizzes.map(quiz => ({ quiz }));
	const vus = new Set<string>();
	const cartes: CarteCours[] = [];
	for (const q of quizzes) {
		if (vus.has(q.path)) continue;
		const frere = quizFrere(q, quizzes);
		if (!frere) { cartes.push({ quiz: q }); continue; }
		vus.add(frere.path);
		const learn = q.mode === "learn" ? q : frere;
		cartes.push({ quiz: learn, frere: learn === q ? frere : q });
	}
	return cartes;
}
