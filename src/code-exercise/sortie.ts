/* Normalisation des DEUX côtés (spec §2.2) : fins de ligne, espaces de fin
   de ligne, lignes vides finales. Tout le reste est exact : la sortie d'un
   TP se lit mot pour mot, et l'exemple visible la donne telle quelle. */
export function normaliserTexte(s: string): string {
	const lignes = String(s ?? "").replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/[ \t]+$/, ""));
	while (lignes.length > 0 && lignes[lignes.length - 1] === "") lignes.pop();
	return lignes.join("\n");
}

export type Ecart =
	| { ok: true }
	| { ok: false; ligne: number; attendu: string | null; obtenu: string | null };

/** La PREMIÈRE ligne qui diffère, numérotée à partir de 1 ; `null` = absente. */
export function comparerSorties(attendu: string, obtenu: string): Ecart {
	const a = normaliserTexte(attendu), o = normaliserTexte(obtenu);
	if (a === o) return { ok: true };
	const la = a === "" ? [] : a.split("\n"), lo = o === "" ? [] : o.split("\n");
	const n = Math.max(la.length, lo.length);
	for (let i = 0; i < n; i++) {
		const x = i < la.length ? la[i] : null, y = i < lo.length ? lo[i] : null;
		if (x !== y) return { ok: false, ligne: i + 1, attendu: x, obtenu: y };
	}
	return { ok: true };
}
