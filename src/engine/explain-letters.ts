/* ══════════════════════════════════════════════════════════
   THE LETTERS AN EXPLANATION CITES, REWRITTEN TO THE SCREEN'S (2026-10-19)

   An explanation names the wrong options by their letter as WRITTEN in the
   note ("- B forgets to subtract 2"), but the engine shuffles the options:
   on screen the option written B may be shown as D, and the line pointed at
   the wrong answer. Seen on a generated Learn, four slices in a row.

   Only the lines that OPEN with a letter are rewritten ("- B …", "- **B** …",
   "- B : …"), and only when at least two such lines cite distinct letters of
   existing options: a lone "- A model is…" in English is a word, not an
   option. A multiple choice shows squares, not letters: there each cited
   letter becomes the option's own words. PURE: `npm run check:explain`
   holds it.
══════════════════════════════════════════════════════════ */

const LIGNE_LETTRE = /^(\s*[-*+]\s+)(\*\*)?([A-Z])(\*\*)?(?=[\s:.)—–,-])/gm;

/** Cut at 40 characters, on a word boundary when one is near. */
function couper(nom: string): string {
	if (nom.length <= 40) return nom;
	let c = nom.slice(0, 40);
	const espace = c.lastIndexOf(" ");
	if (espace > 20) c = c.slice(0, espace);
	return c.trimEnd() + "…";
}

/** `order[d]` is the WRITTEN index of the option shown at position `d`.
    `noms`, for a multiple choice (its options show squares, not letters):
    each cited letter becomes the option's own words, « … », cut at 40
    characters. */
export function relettrerExplication(texte: string, order: readonly number[], count: number, noms?: readonly string[]): string {
	if (count < 2 || count > 26 || order.length !== count) return texte;
	const vu = new Set(order);
	if (vu.size !== count || order.some(o => !Number.isInteger(o) || o < 0 || o >= count)) return texte;
	if (!noms && order.every((o, d) => o === d)) return texte;
	const cites = [...texte.matchAll(LIGNE_LETTRE)].map(m => m[3].charCodeAt(0) - 65);
	if (cites.length < 2 || cites.some(i => i >= count) || new Set(cites).size !== cites.length) return texte;
	const affiche = new Map(order.map((o, d) => [o, d]));
	return texte.replace(LIGNE_LETTRE, (_m, puce: string, g1: string | undefined, lettre: string, g2: string | undefined) => {
		const ecrite = lettre.charCodeAt(0) - 65;
		if (noms) {
			const nom = (noms[ecrite] ?? "").replace(/\s+/g, " ").trim();
			if (nom) return puce + "« " + couper(nom) + " »";
		}
		const d = affiche.get(ecrite);
		return puce + (g1 ?? "") + (d === undefined ? lettre : String.fromCharCode(65 + d)) + (g2 ?? "");
	});
}
