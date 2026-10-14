/* ══════════════════════════════════════════════════════════
   THE "/" MENU of the Generate composer

   "/" at the start of the field lists the commands, the way "@" lists the
   files: /exam (prepare for an upcoming exam, whose list is the second
   level once "/exam" is complete), /clear (new conversation), /model (the
   model menu), /resume (the conversation search). The three app commands
   run at once, and never reach a generation: picking one, or typing it
   exactly then Enter (or the send button), runs it.
══════════════════════════════════════════════════════════ */

import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { dateCourte, trouverCommandeExam } from "./exam-command";
import type { ExamCible } from "./exam-command";
import { openMentionMenu } from "./ui-select";
import type { MentionMenuHandle, MentionMenuItem } from "./ui-select";

export type SlashName = "exam" | "clear" | "model" | "resume";
/** The commands that act on the app and never become a request. */
export type AppCommand = Exclude<SlashName, "exam">;

export interface SlashCommand {
	name: SlashName;
	icon: string;
	sub: TransKey;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ name: "exam", icon: "graduation-cap", sub: "ai.slash.exam" },
	{ name: "clear", icon: "message-square-plus", sub: "ai.slash.clear" },
	{ name: "model", icon: "cpu", sub: "ai.slash.model" },
	{ name: "resume", icon: "history", sub: "ai.slash.resume" },
];

/** What the field holds at its start, up to the caret: the commands whose
    name begins with what was typed. `exam` is true once "/exam" is complete
    (the exam list is then shown, filtered by what follows). `null` when
    nothing matches, or the text is not at the start of the field. */
export function findSlashCommand(texte: string, caret: number): { fin: number; commandes: SlashCommand[]; exam: boolean } | null {
	const m = texte.slice(0, caret).match(/^\/([a-z-]*)(?:[ \t]+([^\n]*))?$/i);
	if (!m) return null;
	const prefixe = m[1].toLowerCase();
	// Text after a space only belongs to /exam (its subject or filter).
	if (m[2] !== undefined && prefixe !== "exam") return null;
	const commandes = SLASH_COMMANDS.filter(c => c.name.startsWith(prefixe));
	if (!commandes.length) return null;
	return { fin: caret, commandes, exam: prefixe === "exam" };
}

/** The app command the field holds and nothing else ("/clear", spaces
    around allowed), else `null`. "/clear now" and "/exam" are not. */
export function exactCommand(texte: string): AppCommand | null {
	const m = texte.trim().match(/^\/(clear|model|resume)$/i);
	return m ? (m[1].toLowerCase() as AppCommand) : null;
}

export interface SlashCommandHandle {
	isOpen(): boolean;
	/** Runs the app command the field holds exactly, if any (the send button
	    and Enter call it). True when one ran: the text is not a request. */
	runExact(): boolean;
	detach(): void;
}

/** Plugs the menu into the composer's field, next to the "@" picker. */
export function attachSlashCommands(textarea: HTMLTextAreaElement, ancre: HTMLElement, opts: {
	exams(): ExamCible[];
	onPick(exam: ExamCible): void;
	/** The text was replaced from here (no "input" event follows). */
	onTextReplaced(valeur: string): void;
	/** Runs /clear, /model or /resume, the command text already removed. */
	onCommand(nom: AppCommand): void;
}): SlashCommandHandle {
	let menu: MentionMenuHandle | null = null;
	/** Entries listed: with none, Enter goes on to the composer (it sends). */
	let nombre = 0;
	const fermer = (): void => { if (menu) { const m = menu; menu = null; m.close(); } };
	const poser = (valeur: string): void => {
		textarea.value = valeur;
		textarea.setSelectionRange(valeur.length, valeur.length);
		opts.onTextReplaced(valeur);
	};

	function lancer(nom: AppCommand): void {
		fermer();
		poser("");
		opts.onCommand(nom);
	}

	function listeExams(requete: string, fin: number): void {
		const filtre = requete.toLowerCase();
		const items: MentionMenuItem[] = opts.exams()
			.filter(e => !filtre || (e.nom + " " + e.module).toLowerCase().includes(filtre))
			.map(e => ({
				label: e.nom,
				sub: `${e.module} · ${dateCourte(e.date)}`,
				icon: "graduation-cap",
				onChoose: () => {
					// The command and its filter leave the text: the exam becomes a tile.
					const reste = textarea.value.slice(fin).replace(/^[ \t]+/, "");
					textarea.value = reste;
					textarea.setSelectionRange(0, 0);
					opts.onTextReplaced(reste);
					opts.onPick(e);
				},
			}));
		nombre = items.length;
		// Something typed that names no exam: it is the subject, the menu leaves.
		if (!items.length && filtre) { fermer(); return; }
		if (!menu) menu = openMentionMenu(ancre, () => { menu = null; });
		menu.setItems(items, items.length ? undefined : t("ai.exam.none"));
	}

	function rafraichir(): void {
		const caret = textarea.selectionStart ?? 0;
		const trouve = findSlashCommand(textarea.value, caret);
		if (!trouve || textarea.selectionStart !== textarea.selectionEnd) { fermer(); return; }
		if (trouve.exam) {
			const jeton = trouverCommandeExam(textarea.value, caret);
			if (jeton) { listeExams(jeton.requete, jeton.fin); return; }
		}
		const items: MentionMenuItem[] = trouve.commandes.map(c => ({
			label: "/" + c.name,
			sub: t(c.sub),
			icon: c.icon,
			onChoose: () => {
				if (c.name === "exam") { poser("/exam "); rafraichir(); } else lancer(c.name);
			},
		}));
		nombre = items.length;
		if (!menu) menu = openMentionMenu(ancre, () => { menu = null; });
		menu.setItems(items);
	}

	function runExact(): boolean {
		const nom = exactCommand(textarea.value);
		if (!nom) return false;
		lancer(nom);
		return true;
	}

	const surTouche = (e: KeyboardEvent): void => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing && runExact()) { e.preventDefault(); e.stopPropagation(); return; }
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
		runExact,
		detach() {
			textarea.removeEventListener("input", surSaisie);
			textarea.removeEventListener("click", surSaisie);
			textarea.removeEventListener("keydown", surTouche, true);
			textarea.removeEventListener("blur", fermer);
			fermer();
		},
	};
}
