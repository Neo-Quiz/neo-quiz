import type { CodeQuestion } from "../types/quiz";

/* La PRÉSENCE de `language` fait le type (même règle que `cloze`, spec §1.1).
   Un langage vide n'est pas un exercice : le moteur ne saurait rien en faire. */
export function estQuestionCode(q: unknown): q is CodeQuestion {
	const l = (q as { language?: unknown } | null)?.language;
	return typeof l === "string" && l.trim().length > 0;
}

/** Seul Python s'exécute ; un autre langage s'affiche sans exécution (§5.3). */
export function estExecutable(q: CodeQuestion): boolean {
	return q.language.trim().toLowerCase() === "python";
}

/* `hints` prime ; `hint`, le champ historique d'une chaîne, sert de repli.
   Un indice vide n'en est pas un : il débloquerait une marche pour rien. */
export function indicesDe(q: CodeQuestion): string[] {
	const brut: unknown[] = Array.isArray(q.hints) ? q.hints : (typeof q.hint === "string" ? [q.hint] : []);
	return brut.filter((h): h is string => typeof h === "string" && h.trim().length > 0).map(h => h.trim());
}

/* Jamais vide : un programme qui ne lit rien a quand même UN essai. */
export function entreesDe(q: CodeQuestion): string[] {
	const liste = Array.isArray(q.inputs) ? q.inputs.filter((x): x is string => typeof x === "string") : [];
	return liste.length > 0 ? liste : [""];
}
