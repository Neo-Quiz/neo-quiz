import { estCategorie, type CategorieQuiz } from "./categorie-quiz";

/* ══════════════════════════════════════════════════════════
   A QUIZ'S SUBJECT, CHOSEN BY HAND (2026-10-18) — PURE text edit of the
   note's frontmatter.

   The subject lives in `subject:` under `neo-quiz:` (the key the generator
   writes, `quiz-frontmatter.ts`). Changing it must touch ONE line: the note
   belongs to the user, so this edits the text of that line only, like
   `exam-keep.ts` does for the block. Line endings (LF or CRLF), a BOM, YAML
   comments, other keys and the quiz block all stay byte for byte. Only a
   known subject id is ever written (`estCategorie`): a hostile value yields
   `null`, not a line.
══════════════════════════════════════════════════════════ */

const BOM = "﻿";

interface Parts { bom: string; eol: string; lines: string[]; fin: number }

/** The note split in lines, with where its frontmatter closes (-1: none). */
function decouper(content: string): Parts {
	const bom = content.startsWith(BOM) ? BOM : "";
	const body = content.slice(bom.length);
	const eol = body.includes("\r\n") ? "\r\n" : "\n";
	const lines = body.split(/\r\n|\n/);
	let fin = -1;
	if (lines[0] === "---") fin = lines.indexOf("---", 1);
	return { bom, eol, lines, fin };
}

/** Index of the `neo-quiz:` line and the end (exclusive) of its indented children. */
function blocNeoQuiz(p: Parts): { debut: number; fin: number } | null | "unsupported" {
	for (let i = 1; i < p.fin; i++) {
		const l = p.lines[i];
		if (!l.startsWith("neo-quiz:")) continue;
		if (l.slice("neo-quiz:".length).trim() !== "") return "unsupported";
		let j = i + 1;
		while (j < p.fin && /^\s/.test(p.lines[j])) j++;
		return { debut: i, fin: j };
	}
	return null;
}

const LIGNE_SUJET = /^(\s+)subject:[ \t]*([^#\r\n]*?)[ \t]*(#.*)?$/;

/** The subject written in the note, or `undefined` (none, or not a known id). */
export function lireSujetNote(content: string): CategorieQuiz | undefined {
	const p = decouper(content);
	if (p.fin < 0) return undefined;
	const b = blocNeoQuiz(p);
	if (!b || b === "unsupported") return undefined;
	for (let i = b.debut + 1; i < b.fin; i++) {
		const m = LIGNE_SUJET.exec(p.lines[i]);
		if (!m) continue;
		const v = m[2].replace(/^(["'])(.*)\1$/, "$2");
		return estCategorie(v) ? v : undefined;
	}
	return undefined;
}

/**
 * `content` with its subject set to `sujet` (`null` = "Automatic": the key is
 * removed). Returns `content` itself when it already says so, and `null` when
 * the edit cannot be made safely (an unknown id, a `neo-quiz:` written in flow
 * style).
 */
export function reecrireSujet(content: string, sujet: CategorieQuiz | null): string | null {
	if (sujet !== null && !estCategorie(sujet)) return null;
	const p = decouper(content);
	const { lines, eol } = p;
	const sortie = (l: string[]): string => p.bom + l.join(eol);

	if (p.fin < 0) {
		if (sujet === null) return content;
		return sortie(["---", "neo-quiz:", `  subject: ${sujet}`, "---", "", ...lines]);
	}
	const b = blocNeoQuiz(p);
	if (b === "unsupported") return null;
	if (!b) {
		if (sujet === null) return content;
		return sortie([...lines.slice(0, p.fin), "neo-quiz:", `  subject: ${sujet}`, ...lines.slice(p.fin)]);
	}
	let at = -1;
	for (let i = b.debut + 1; i < b.fin; i++) if (LIGNE_SUJET.test(lines[i])) { at = i; break; }
	if (at < 0) {
		if (sujet === null) return content;
		// Same indentation as the sibling keys, two spaces when it has none.
		const indent = /^(\s+)\S/.exec(lines[b.debut + 1] ?? "")?.[1] ?? "  ";
		let fin = b.fin;
		while (fin > b.debut + 1 && lines[fin - 1].trim() === "") fin--;
		return sortie([...lines.slice(0, fin), `${indent}subject: ${sujet}`, ...lines.slice(fin)]);
	}
	const m = LIGNE_SUJET.exec(lines[at]) as RegExpExecArray;
	if (sujet !== null) {
		const ligne = `${m[1]}subject: ${sujet}${m[3] ? " " + m[3] : ""}`;
		if (ligne === lines[at]) return content;
		const copie = [...lines];
		copie[at] = ligne;
		return sortie(copie);
	}
	const copie = lines.filter((_, i) => i !== at);
	// A `neo-quiz:` left with no child, and a frontmatter left with no key, go too.
	const reste = blocNeoQuiz({ ...p, lines: copie, fin: p.fin - 1 });
	if (reste && reste !== "unsupported" && reste.fin === reste.debut + 1) {
		copie.splice(reste.debut, 1);
		if (copie[0] === "---" && copie[1] === "---") {
			copie.splice(0, 2);
			if ((copie[0] as string) === "") copie.shift();
		}
	}
	return sortie(copie);
}
