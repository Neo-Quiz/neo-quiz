import { estCategorie, type CategorieQuiz } from "./categorie-quiz";

/* ══════════════════════════════════════════════════════════
   A QUIZ'S SUBJECT, CHOSEN BY HAND (2026-10-18) — PURE text edit of the
   note's frontmatter.

   The subject lives in `subject:` under `neo-quiz:` (the key the generator
   writes, `quiz-frontmatter.ts`). Changing it must touch ONE line: the note
   belongs to the user, so this edits the text of that line only, like
   `exam-keep.ts` does for the block. Every other line keeps its own line
   ending (a note may mix LF and CRLF), a BOM, YAML comments, other keys and
   the quiz block stay byte for byte. Only a known subject id is ever written
   (`estCategorie`): a hostile value yields `null`, not a line.
══════════════════════════════════════════════════════════ */

const BOM = "﻿";

/** One line of the note and its OWN terminator ("" for the last line): a note
    with mixed endings keeps each one, only an added line takes the dominant. */
interface Ligne { t: string; e: string }
interface Parts { bom: string; dominant: string; lines: Ligne[]; fin: number }

function decouper(content: string): Parts {
	const bom = content.startsWith(BOM) ? BOM : "";
	const morceaux = content.slice(bom.length).split(/(\r\n|\n)/);
	const lines: Ligne[] = [];
	for (let i = 0; i < morceaux.length; i += 2) lines.push({ t: morceaux[i], e: morceaux[i + 1] ?? "" });
	const crlf = lines.filter(l => l.e === "\r\n").length;
	const lf = lines.filter(l => l.e === "\n").length;
	let fin = -1;
	if (lines[0].t === "---") fin = lines.findIndex((l, i) => i > 0 && l.t === "---");
	return { bom, dominant: crlf > lf ? "\r\n" : "\n", lines, fin };
}

const recoller = (p: Parts, lines: Ligne[]): string => p.bom + lines.map(l => l.t + l.e).join("");

/** Index of the `neo-quiz:` line and the end (exclusive) of its children: the
    indented lines, blank lines between them included (trailing blanks are not
    part of it). `neo-quiz:foo` is another key; a flow-style value is refused. */
function blocNeoQuiz(p: Parts): { debut: number; fin: number } | null | "unsupported" {
	for (let i = 1; i < p.fin; i++) {
		const l = p.lines[i].t;
		if (!l.startsWith("neo-quiz:") || /^neo-quiz:\S/.test(l)) continue;
		const reste = l.slice("neo-quiz:".length).trim();
		if (reste !== "" && !reste.startsWith("#")) return "unsupported";
		let fin = i + 1;
		for (let j = i + 1; j < p.fin; j++) {
			const t = p.lines[j].t;
			if (t.trim() !== "" && !/^\s/.test(t)) break;
			if (t.trim() !== "") fin = j + 1;
		}
		return { debut: i, fin };
	}
	return null;
}

/** `  subject: value`, the value bare or quoted, a trailing `# comment` allowed (as `lireFrontmatterNeoQuiz` reads it). */
const LIGNE_SUJET = /^(\s+)subject:[ \t]*(?:(["'])([^"'\r\n]*)\2|([^#"'\r\n]*?))[ \t]*(#.*)?$/;

/** The subject written in the note, or `undefined` (none, or not a known id). */
export function lireSujetNote(content: string): CategorieQuiz | undefined {
	const p = decouper(content);
	if (p.fin < 0) return undefined;
	const b = blocNeoQuiz(p);
	if (!b || b === "unsupported") return undefined;
	for (let i = b.debut + 1; i < b.fin; i++) {
		const m = LIGNE_SUJET.exec(p.lines[i].t);
		if (!m) continue;
		const v = m[3] ?? m[4] ?? "";
		return estCategorie(v) ? v : undefined;
	}
	return undefined;
}

/**
 * `content` with its subject set to `sujet` (`null` = "Automatic": the key is
 * removed). Returns `content` itself when it already says so, and `null` when
 * the edit cannot be made safely (an unknown id, a `neo-quiz:` written in flow
 * style). Every untouched line keeps its own ending.
 */
export function reecrireSujet(content: string, sujet: CategorieQuiz | null): string | null {
	if (sujet !== null && !estCategorie(sujet)) return null;
	const p = decouper(content);
	const { lines } = p;
	const neuve = (t: string): Ligne => ({ t, e: p.dominant });

	if (p.fin < 0) {
		if (sujet === null) return content;
		return recoller(p, [neuve("---"), neuve("neo-quiz:"), neuve(`  subject: ${sujet}`), neuve("---"), neuve(""), ...lines]);
	}
	const b = blocNeoQuiz(p);
	if (b === "unsupported") return null;
	if (!b) {
		if (sujet === null) return content;
		return recoller(p, [...lines.slice(0, p.fin), neuve("neo-quiz:"), neuve(`  subject: ${sujet}`), ...lines.slice(p.fin)]);
	}
	let at = -1;
	for (let i = b.debut + 1; i < b.fin; i++) if (LIGNE_SUJET.test(lines[i].t)) { at = i; break; }
	if (at < 0) {
		if (sujet === null) return content;
		// Same indentation as the sibling keys, two spaces when it has none.
		const indent = /^(\s+)\S/.exec(lines[b.debut + 1]?.t ?? "")?.[1] ?? "  ";
		return recoller(p, [...lines.slice(0, b.fin), neuve(`${indent}subject: ${sujet}`), ...lines.slice(b.fin)]);
	}
	const m = LIGNE_SUJET.exec(lines[at].t) as RegExpExecArray;
	if (sujet !== null) {
		const t = `${m[1]}subject: ${sujet}${m[5] ? " " + m[5] : ""}`;
		if (t === lines[at].t) return content;
		const copie = [...lines];
		copie[at] = { t, e: lines[at].e };
		return recoller(p, copie);
	}
	const copie = lines.filter((_, i) => i !== at);
	// A `neo-quiz:` left with no child, and a frontmatter left with no key, go too.
	const reste = blocNeoQuiz({ ...p, lines: copie, fin: p.fin - 1 });
	if (reste && reste !== "unsupported" && reste.fin === reste.debut + 1) {
		copie.splice(reste.debut, 1);
		if (copie[0].t === "---" && copie[1].t === "---") {
			copie.splice(0, 2);
			if ((copie[0]?.t as string | undefined) === "") copie.shift();
		}
	}
	return recoller(p, copie);
}
