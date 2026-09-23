/**
 * Frontmatter YAML minimal posé en tête d'une note générée par IA, sous la
 * clé `neo-quiz:` — QUI a généré le quiz (provider, modèle, effort,
 * horodatage). Module PUR, sans parseur YAML : on ne lit que les quatre
 * clés attendues, ligne à ligne, jamais une structure YAML arbitraire.
 *
 * Ces clés sont des DONNÉES persistées dans les notes, jamais traduites
 * (CLAUDE.md, « Langue (i18n) »).
 */

/** Ce que `saveGeneratedQuiz` (dashboard/ai.ts) écrit, et que le scanner
 *  relit. `effort` est absent pour Ollama (pas de notion d'effort). */
export interface NeoQuizFrontmatter {
	provider: string;
	model: string;
	effort?: string;
	generatedAt: string;
	/** Practice seulement : le nom de la note Learn de la même source, écrit
	 *  en lien `[[…]]` au premier niveau pour qu'Obsidian le suive. */
	learn?: string;
	/** La SOURCE de la note (première pièce jointe, sinon la demande) : c'est
	 *  par elle qu'un Practice retrouve le Learn de la même source, le mode ne
	 *  figurant plus dans le nom du fichier (2026-09-23). Déjà nettoyée des
	 *  guillemets et sauts de ligne par `nomDeSource`. */
	source?: string;
}

/** Retire les guillemets (simples ou doubles) qui entourent une valeur YAML,
 *  si l'auteur en a mis — jamais posés par `ecrireFrontmatterNeoQuiz`, mais
 *  un frontmatter modifié à la main peut en avoir. */
function depouiller(valeur: string): string {
	const v = valeur.trim();
	if (v.length >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
		return v.slice(1, -1);
	}
	return v;
}

/**
 * Lit le frontmatter `neo-quiz:` en tête de `content`, s'il existe.
 *
 * Un frontmatter YAML commence STRICTEMENT à la ligne 1 par `---` ; un `---`
 * ailleurs dans le texte (un séparateur, une ligne de tableau Markdown...)
 * n'en est pas un — `null` dans ce cas comme dans celui d'une note sans
 * frontmatter du tout, ou d'un frontmatter sans clé `neo-quiz:`.
 */
export function lireFrontmatterNeoQuiz(content: string): NeoQuizFrontmatter | null {
	const lines = content.split(/\r\n|\n/);
	if (lines[0] !== "---") return null;

	let fin = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---") { fin = i; break; }
	}
	if (fin === -1) return null;

	const bloc = lines.slice(1, fin);
	const debut = bloc.findIndex(l => l === "neo-quiz:");
	if (debut === -1) return null;

	const champs: Record<string, string> = {};
	for (let i = debut + 1; i < bloc.length; i++) {
		const ligne = bloc[i];
		// Une ligne non indentée referme la clé neo-quiz: (retour au niveau
		// racine du frontmatter) — un `---` de fermeture n'atteint jamais
		// cette boucle puisque `bloc` s'arrête avant.
		if (!/^\s/.test(ligne)) break;
		const m = ligne.match(/^\s+([a-zA-Z]+):\s*(.*)$/);
		if (!m) continue;
		champs[m[1]] = depouiller(m[2]);
	}

	const { provider, model, effort, generatedAt, source } = champs;
	if (!provider || !model || !generatedAt) return null;
	return { provider, model, effort: effort || undefined, generatedAt, ...(source ? { source } : {}) };
}

/**
 * La note ne contient-elle RIEN d'autre qu'un frontmatter `neo-quiz:` ? C'est
 * le cas d'une note générée dont on vient de retirer le bloc : le frontmatter
 * est à l'application, pas à l'utilisateur, et une note qui n'a plus que lui
 * n'a plus rien — elle part à la corbeille avec le quiz (vu par Ahmed le
 * 2026-09-19 : la note restait, listée comme un quiz, et sa suppression
 * disait « aucun bloc »). Un frontmatter qui porte d'AUTRES clés que
 * `neo-quiz:` (tags, alias posés par l'utilisateur) n'est pas vide.
 */
export function neContientQueLeFrontmatterNeoQuiz(content: string): boolean {
	const lines = content.split(/\r\n|\n/);
	if (lines[0] !== "---") return false;
	const fin = lines.indexOf("---", 1);
	if (fin === -1) return false;
	const bloc = lines.slice(1, fin);
	/* La CLÉ suffit, pas un enregistrement complet : sur claude.ai, `model`
	   est vide (le site choisit), et `lireFrontmatterNeoQuiz` rend alors
	   null — la carcasse passait pour une note de l'utilisateur (vu le
	   2026-09-19, deux fois). */
	if (!bloc.includes("neo-quiz:")) return false;
	/* `learn: "[[...]]"` (Practice seulement, voir `ecrireFrontmatterNeoQuiz`)
	   est écrit par l'APPLICATION, au même titre que `neo-quiz:` — ce n'est
	   pas une clé de l'utilisateur. Sans cette exception, une note Practice
	   liée à son Learn ne repassait plus jamais pour « rien que le
	   frontmatter » une fois son bloc retiré, et restait orpheline au lieu
	   d'aller à la corbeille avec lui. */
	const autresCles = bloc.some(l => l.trim() && !/^\s/.test(l) && l !== "neo-quiz:" && !l.startsWith("learn:"));
	if (autresCles) return false;
	return lines.slice(fin + 1).join("\n").trim().length === 0;
}

/**
 * Sérialise le frontmatter `neo-quiz:`, prêt à être préfixé au bloc quiz
 * exporté (`ecrireFrontmatterNeoQuiz(meta) + exportAllWithFence(...)`).
 * Se termine par une ligne vide : le bloc qui suit ne colle pas au `---`.
 */
export function ecrireFrontmatterNeoQuiz(meta: NeoQuizFrontmatter): string {
	const lignes = ["---"];
	if (meta.learn) lignes.push(`learn: "[[${meta.learn.replace(/"/g, "")}]]"`);
	lignes.push("neo-quiz:", `  provider: ${meta.provider}`, `  model: ${meta.model}`);
	if (meta.effort) lignes.push(`  effort: ${meta.effort}`);
	lignes.push(`  generatedAt: ${meta.generatedAt}`);
	if (meta.source) lignes.push(`  source: "${meta.source.replace(/["\r\n]/g, "")}"`);
	lignes.push("---", "");
	return lignes.join("\n");
}
