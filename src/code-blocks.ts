import { parseQuizSource, QUIZ_BLOCK_RE } from "./quiz-utils";
import { decouperBlocs } from "./engine/grammaire-blocs";
import { paragraphes } from "./lecture-style";
import { langageDeBloc } from "./code-languages";

/* ══════════════════════════════════════════════════════════
   THE PYTHON BLOCKS OF A QUIZ NOTE (PURE)

   What the PC may run for a request of the phone (code-run-request.ts): the
   code of a ```python fence of a quiz field, EXACTLY as the engine runs it
   from the rendered block (`textContent` of its `<code>`, engine/code-run.ts),
   so the SHA-256 the phone computed from what it showed matches the one
   computed here. The fences are found by the engine's own block grammar
   (`decouperBlocs`, grammaire-blocs.ts) on every string of every
   ```quiz-blocks block, each string also cut the way a reading in steps cuts
   its text (`paragraphes`, lecture-style.ts). Taking more candidates than the
   screen shows is harmless: every one is a Python block of the note.
   ACCEPTED LIMIT (final review M2): a block the engine keeps hidden (▶ masked
   in a statement not yet corrected, a hint not yet revealed) is a candidate
   too, so a phone may ask for a block it does not show. It is still the
   owner's note's own code, run only after the phone's warning and the PC's
   one-time authorization of that device (electron/python/distant.ts); the
   masking is about not giving answers away, not a security boundary. The
   HTML parser turns CR and CR LF into LF and drops NUL in text: the same is
   done here, since `textContent` reads the parsed text.
══════════════════════════════════════════════════════════ */

/** Nesting depth explored in a quiz item (fields, step lists, hint levels…). */
const MAX_DEPTH = 8;

function strings(x: unknown, depth: number, out: string[]): void {
	if (typeof x === "string") { out.push(x); return; }
	if (depth >= MAX_DEPTH || !x || typeof x !== "object") return;
	for (const v of Array.isArray(x) ? x : Object.values(x)) strings(v, depth + 1, out);
}

function fencesOf(text: string, out: Set<string>): void {
	for (const b of decouperBlocs(text)) {
		if (b.genre !== "code" || langageDeBloc(b.langue) !== "python") continue;
		const code = b.contenu ? text.slice(b.contenu.debut, b.contenu.fin) : "";
		out.add(code.replace(/\r\n?/g, "\n").replace(/\0/g, ""));
	}
}

/** Every Python block of the note's quiz blocks, in order of appearance, each once. */
export function blocsPython(texteNote: string): string[] {
	const out = new Set<string>();
	const re = new RegExp(QUIZ_BLOCK_RE.source, "g");
	for (const m of String(texteNote ?? "").matchAll(re)) {
		let items: unknown[];
		try { items = parseQuizSource(m[1], { logErrors: false }); } catch { continue; }
		const all: string[] = [];
		strings(items, 0, all);
		for (const s of all) {
			if (!s.includes("```") && !s.includes("~~~")) continue;
			fencesOf(s, out);
			for (const p of paragraphes(s)) fencesOf(p, out);
		}
	}
	return [...out];
}

/** Lowercase hex SHA-256 of a text's UTF-8 bytes, through Web Crypto (no Node). */
export async function sha256Hex(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	let hex = "";
	for (const b of digest) hex += b.toString(16).padStart(2, "0");
	return hex;
}
