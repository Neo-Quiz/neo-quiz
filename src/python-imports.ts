/**
 * Top-level module names imported by a Python source. Pure and host-free:
 * used by the renderer (to show what a code block needs) and by the main
 * process (to decide what to install).
 */

/** Blanks out comments and string literals so they cannot fake an import. */
function sansChainesEtCommentaires(code: string): string {
	let sortie = "";
	let i = 0;
	while (i < code.length) {
		const c = code[i];
		if (c === "#") {
			while (i < code.length && code[i] !== "\n") i++;
			continue;
		}
		if (c === '"' || c === "'") {
			const triple = code.startsWith(c.repeat(3), i);
			const fin = triple ? c.repeat(3) : c;
			i += fin.length;
			while (i < code.length && !code.startsWith(fin, i)) {
				if (code[i] === "\\") i++;
				else if (!triple && code[i] === "\n") break;
				if (code[i] === "\n") sortie += "\n";
				i++;
			}
			i += fin.length;
			sortie += '""';
			continue;
		}
		sortie += c;
		i++;
	}
	return sortie;
}

export function importsDuCode(code: string): string[] {
	const trouves: string[] = [];
	const ajouter = (nom: string) => {
		if (nom && !trouves.includes(nom)) trouves.push(nom);
	};
	// Statements separated by newlines or `;`; backslash continuations joined.
	const lignes = sansChainesEtCommentaires(code).replace(/\\r?\n/g, " ").split(/[\r\n;]+/);
	for (const ligne of lignes) {
		const from = /^\s*from\s+([A-Za-z_][\w]*)(?:\.[\w.]*)?\s+import\b/.exec(ligne);
		if (from) {
			ajouter(from[1]);
			continue;
		}
		const imp = /^\s*import\s+(.+)$/.exec(ligne);
		if (!imp) continue;
		for (const part of imp[1].replace(/[()]/g, "").split(",")) {
			const m = /^\s*([A-Za-z_]\w*)/.exec(part);
			if (m) ajouter(m[1]);
		}
	}
	return trouves;
}
