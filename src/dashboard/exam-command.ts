/* ══════════════════════════════════════════════════════════
   THE /exam COMMAND of the Generate composer (2026-09-30)

   "/exam" at the start of the composer opens a menu of
   the upcoming exams, the way "@" opens the files. Picking one sets the
   exam the request prepares for: the page then sends a whole PREPARATION —
   a Learn over everything that can come up, then Tests of rising
   difficulty, the last one at the exam's level (`preparationDemandes`).
   `/exam` sent without picking an exam prepares all the same, for the
   subject written after it.
══════════════════════════════════════════════════════════ */

import { currentLang, t } from "../i18n";
import { openMentionMenu } from "./ui-select";
import type { MentionMenuHandle, MentionMenuItem } from "./ui-select";

/** An upcoming exam, as the menu shows it. Date as `YYYY-MM-DD`. */
export interface ExamCible {
	id: string;
	nom: string;
	date: string;
	/** The course folder it belongs to. */
	module: string;
	/** That folder's contract path, where its documents are listed. */
	dossier?: string;
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

export interface ExamCommandHandle {
	isOpen(): boolean;
	detach(): void;
}

/** Plugs the menu into the composer's field, next to the "@" picker. */
export function attachExamCommand(textarea: HTMLTextAreaElement, ancre: HTMLElement, opts: {
	exams(): ExamCible[];
	onPick(exam: ExamCible): void;
	onTextReplaced(valeur: string): void;
}): ExamCommandHandle {
	let menu: MentionMenuHandle | null = null;
	/** Exams listed: with none, Enter goes on to the composer (it sends). */
	let nombre = 0;
	const fermer = (): void => { if (menu) { const m = menu; menu = null; m.close(); } };

	function rafraichir(): void {
		const jeton = trouverCommandeExam(textarea.value, textarea.selectionStart ?? 0);
		if (!jeton || textarea.selectionStart !== textarea.selectionEnd) { fermer(); return; }
		const requete = jeton.requete.toLowerCase();
		const items: MentionMenuItem[] = opts.exams()
			.filter(e => !requete || (e.nom + " " + e.module).toLowerCase().includes(requete))
			.map(e => ({
				label: e.nom,
				sub: `${e.module} · ${dateCourte(e.date)}`,
				icon: "graduation-cap",
				onChoose: () => {
					// The command and its filter leave the text: the exam becomes a tile.
					const reste = textarea.value.slice(jeton.fin).replace(/^[ \t]+/, "");
					textarea.value = reste;
					textarea.setSelectionRange(0, 0);
					opts.onTextReplaced(reste);
					opts.onPick(e);
				},
			}));
		nombre = items.length;
		// Something typed that names no exam: it is the subject, the menu leaves.
		if (!items.length && requete) { fermer(); return; }
		if (!menu) menu = openMentionMenu(ancre, () => { menu = null; });
		menu.setItems(items, items.length ? undefined : t("ai.exam.none"));
	}

	const surTouche = (e: KeyboardEvent): void => {
		if (!menu) return;
		if (e.key === "ArrowDown") { e.preventDefault(); menu.moveSelection(1); return; }
		if (e.key === "ArrowUp") { e.preventDefault(); menu.moveSelection(-1); return; }
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(); return; }
		if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing && nombre > 0) {
			e.preventDefault();
			e.stopPropagation();
			menu.confirm();
		}
	};
	const surSaisie = (): void => rafraichir();
	textarea.addEventListener("input", surSaisie);
	textarea.addEventListener("click", surSaisie);
	textarea.addEventListener("keydown", surTouche, true);
	textarea.addEventListener("blur", fermer);
	return {
		isOpen: () => menu !== null && nombre > 0,
		detach() {
			textarea.removeEventListener("input", surSaisie);
			textarea.removeEventListener("click", surSaisie);
			textarea.removeEventListener("keydown", surTouche, true);
			textarea.removeEventListener("blur", fermer);
			fermer();
		},
	};
}
