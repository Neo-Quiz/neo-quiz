/* Les cadres internes de Pyodide (`/lib/python314.zip/_pyodide/…`) ne
   disent rien à l'élève : on les retire, cadre par cadre. Un cadre commence
   par `  File "…"` ; ses lignes de source suivent, indentées de 4 espaces
   ou plus. Tout ce qui n'est pas indenté (en-tête, message d'erreur) reste. */
const CADRE = /^ {2}File "([^"]*)"/;

export function nettoyerTraceback(brute: string): string {
	const lignes = String(brute ?? "").replace(/\r\n?/g, "\n").split("\n");
	const sortie: string[] = [];
	let garder = true;
	for (const l of lignes) {
		const m = CADRE.exec(l);
		if (m) { garder = !m[1].startsWith("/lib/"); if (garder) sortie.push(l); continue; }
		if (/^ {4}/.test(l)) { if (garder) sortie.push(l); continue; }
		garder = true;
		sortie.push(l);
	}
	while (sortie.length > 0 && sortie[sortie.length - 1].trim() === "") sortie.pop();
	return sortie.join("\n");
}
