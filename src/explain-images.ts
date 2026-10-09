/* ══════════════════════════════════════════════════════════
   THE COURSE PICTURES CITED IN AN "EXPLAIN" ANSWER (2026-10-09)

   The tutor may show a picture it was given by writing `![[exact name]]` (or
   the folder-relative path). Only the pictures really attached to the message
   are accepted: a name that matches none of them, or that tries to leave the
   folder, is shown as plain text and never loaded. An accepted one becomes a
   private token that the window swaps for the picture once the text is
   rendered (`apps/windows/src/ui/explain-images.ts`).

   PURE: no DOM, no host. `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

export interface ImageJointe {
	name: string;
	/** Path of the picture in the host's contract. */
	path: string;
	/** Path relative to the quiz's folder (equals `name` at its root). */
	relatif: string;
}

/** Private-use delimiters of the tokens: stripped from the model's text first,
    so that the model cannot forge one. */
const DEBUT = "";
const FIN = "";
export const JETON_RE = /(\d+)/g;

const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;
const PUA_RE = /[]/g;

/** The attached picture named by `cible`, or `null`. Exact name or exact
    relative path, case ignored; a path with `..`, a drive or a backslash never matches. */
export function imageNommee(cible: string, jointes: readonly ImageJointe[]): ImageJointe | null {
	const nom = cible.split("|")[0].trim().replace(/^\/+/, "");
	if (!nom || nom.includes("\\") || nom.includes(":") || nom.split("/").includes("..") || nom.split("/").includes(".")) return null;
	const bas = nom.toLowerCase();
	return jointes.find(j => j.relatif.toLowerCase() === bas) ?? jointes.find(j => j.name.toLowerCase() === bas) ?? null;
}

/** The answer's text with every `![[…]]` settled: an attached picture becomes a
    token (`images[i]` is its picture), anything else the bare name as text. */
export function ancrerImagesCitees(texte: string, jointes: readonly ImageJointe[]): { texte: string; images: ImageJointe[] } {
	const images: ImageJointe[] = [];
	const sortie = texte.replace(PUA_RE, "").replace(EMBED_RE, (_m, cible: string) => {
		const j = imageNommee(cible, jointes);
		if (!j) return cible.split("|")[0].trim();
		let i = images.indexOf(j);
		if (i < 0) { i = images.length; images.push(j); }
		return `${DEBUT}${i}${FIN}`;
	});
	return { texte: sortie, images };
}
