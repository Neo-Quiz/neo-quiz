/* ══════════════════════════════════════════════════════════
   THE /exam COMMAND of the Generate composer (2026-09-30; its menu lives in
   slash-commands.ts since the "/" menu)

   "/exam" at the start of the composer opens a menu of
   the upcoming exams, the way "@" opens the files. Picking one sets the
   exam the request prepares for: the page then sends a whole PREPARATION —
   a Learn over everything that can come up, then Tests of rising
   difficulty, the last one at the exam's level (`preparationDemandes`).
   `/exam` sent without picking an exam prepares all the same, for the
   subject written after it.
══════════════════════════════════════════════════════════ */

import { currentLang, t } from "../i18n";

/** An upcoming exam, as the menu shows it. Date as `YYYY-MM-DD`. */
export interface ExamCible {
	id: string;
	nom: string;
	date: string;
	/** The course folder it belongs to. */
	module: string;
	/** That folder's contract path, where its documents are listed; absent
	    when no quiz of the catalogue lives in it any more — it is then
	    looked for by NAME (`module`) under `racine` (exam-documents.ts). */
	dossier?: string;
	/** The id of the root (vault) the folder is in. */
	racine?: string;
}

/** How many Tests follow the Learn, from the basics to the exam's level. */
export const PALIERS_TEST = 3;

/** The command typed at the start of the field, up to the caret: what follows
    it filters the exams. `null` when the field does not start with "/exam"
    (or a beginning of it, while it is being typed). */
export function trouverCommandeExam(texte: string, caret: number): { fin: number; requete: string } | null {
	const avant = texte.slice(0, caret);
	const m = avant.match(/^\/([a-z-]*)(?:[ \t]+([^\n]*))?$/i);
	if (!m) return null;
	const cmd = m[1].toLowerCase();
	const complete = cmd === "exam";
	if (!"exam".startsWith(cmd)) return null;
	if (m[2] !== undefined && !complete) return null;
	return { fin: caret, requete: (m[2] ?? "").trim() };
}

/** The text of a request sent with "/exam …" typed but no exam picked: the
    subject without the command, and whether it was there. */
export function retirerCommandeExam(texte: string): { texte: string; commande: boolean } {
	const m = texte.match(/^\/exam\b[ \t]*/i);
	return m ? { texte: texte.slice(m[0].length), commande: true } : { texte, commande: false };
}

/** The request written FOR the learner once an exam is picked, shown as a
    prompt tile in the composer (like the Explain window's) and sent as the
    text of the request; what the learner types is added under it. */
export function promptPreparation(exam: ExamCible, modele?: string): string {
	const valeurs: Record<string, string> = { exam: exam.nom, module: exam.module, date: dateCourte(exam.date) };
	// The template of the Settings, else the translated default; one pass, so a value holding "{date}" stays as it is.
	return (modele?.trim() || t("ai.exam.defaultPrompt")).replace(/\{(exam|module|date)\}/g, (_, cle: string) => valeurs[cle]);
}

/** "30 Sept" in the language of the app. */
export function dateCourte(iso: string): string {
	const [a, mo, j] = iso.split("-").map(Number);
	return new Intl.DateTimeFormat(currentLang(), { day: "numeric", month: "short" }).format(new Date(a, mo - 1, j));
}
