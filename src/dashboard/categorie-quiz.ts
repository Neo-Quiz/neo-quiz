/* ══════════════════════════════════════════════════════════
   LA CATÉGORIE D'UN QUIZ — module PUR : ni hôte, ni DOM, ni i18n

   Retour #7 du 2026-09-26 : le prompt s'adapte au SUJET du quiz (un cours de
   Python n'appelle pas les mêmes questions qu'un cours de réseau). La
   catégorie se DÉDUIT de trois indices, du plus fiable au moins fiable :
   1. le nom des pièces jointes (« CM1 - Introduction à Python.pdf ») ;
   2. le chemin du dossier de destination (« Efrei/Python/TD ») ;
   3. le texte de la demande.
   Un indice plus fiable l'emporte TOUJOURS sur les suivants : un PDF
   « SQL » rangé dans un dossier « Python » est un quiz de SQL. À égalité
   dans le même indice, rien n'est tranché : `general`.

   Le complément de prompt de chaque catégorie vit à part
   (categorie-prompt.ts) ; le libellé et l'icône, côté page (ai.ts).
   `npm run check:categorie` tient ce module.
══════════════════════════════════════════════════════════ */

export const CATEGORIES = ["general", "python", "c", "bash", "sql", "web", "maths", "reseau"] as const;
export type CategorieQuiz = typeof CATEGORIES[number];

export function estCategorie(v: unknown): v is CategorieQuiz {
	return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

export interface IndicesCategorie {
	/** Les noms des pièces jointes (fichiers, notes, vidéos). */
	pieces?: readonly string[];
	/** Le chemin du dossier de destination. */
	dossier?: string;
	/** Le texte de la demande. */
	demande?: string;
}

/* Les MOTS de chaque catégorie, sur un texte en minuscules sans accents
   (`normaliser`). Des mots entiers : « python » mais pas « pythonesque ».
   Le C est à part (`MOTS_C_NOM`) : la lettre seule n'est un indice que dans
   un NOM de fichier ou de dossier, jamais dans une phrase (« c'est »). */
const MOTS: Readonly<Record<Exclude<CategorieQuiz, "general">, RegExp>> = {
	python: /\b(python\d?|py|pandas|numpy|django|flask|pip|jupyter|matplotlib)\b|\.py\b/,
	c: /\b(langage c|programmation c|en c|gcc|malloc|printf|scanf|pointeurs?|c\+\+|cpp)(?![a-z0-9])|\.c\b/,
	bash: /\b(bash|shell|linux|unix|ubuntu|debian|terminal|grep|chmod|awk|sed|zsh|powershell|systemd)\b|\.sh\b/,
	sql: /\b(sql|mysql|postgres(ql)?|sqlite|oracle|base de donnees|bases de donnees|database|jointures?|requetes? sql)\b/,
	web: /\b(html5?|css3?|javascript|typescript|js|ts|react|vuejs|angular|node(js)?|php|dom|web|front-?end|back-?end)\b/,
	maths: /\b(maths?|mathematiques?|algebre|probabilites?|statistiques?|equations?|derivees?|integrales?|matrices?|polynomes?|trigonometrie|second degre|suites? numeriques?|analyse reelle|calculus|algebra|geometrie)\b/,
	reseau: /\b(reseaux?|network(ing)?|tcp|udp|ip|ipv4|ipv6|osi|cisco|routeurs?|routage|commutateurs?|vlan|dns|dhcp|sous-reseaux?|subnet(ting)?|ethernet|wifi|adressage)\b/,
};

/** Une lettre C isolée dans un NOM : « Programmation C.pdf », « TP C ». */
const MOTS_C_NOM = /(^|[^a-z0-9'’])c(?![a-z0-9'’#+])/;

/** Minuscules, accents retirés, séparateurs de nom (`_`, `-`) en espaces. */
function normaliser(texte: string): string {
	return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_]+/g, " ");
}

/** Les catégories trouvées dans un texte, chacune comptée une fois. */
function trouvees(texte: string, estNom: boolean): Set<CategorieQuiz> {
	const t = normaliser(texte);
	const r = new Set<CategorieQuiz>();
	for (const [cat, re] of Object.entries(MOTS) as [Exclude<CategorieQuiz, "general">, RegExp][]) {
		if (re.test(t)) r.add(cat);
	}
	// Le nom d'un fichier sans son extension : « .c » est déjà dans MOTS.
	if (estNom && MOTS_C_NOM.test(t.replace(/\.[a-z0-9]{1,5}$/, ""))) r.add("c");
	return r;
}

/** La catégorie d'UN indice : celle que le plus de textes nomment, `null`
    si aucune, ou si deux catégories sont à égalité. */
function categorieDe(textes: readonly string[], estNom: boolean): CategorieQuiz | null {
	const votes = new Map<CategorieQuiz, number>();
	for (const texte of textes) {
		for (const cat of trouvees(texte, estNom)) votes.set(cat, (votes.get(cat) ?? 0) + 1);
	}
	let meilleure: CategorieQuiz | null = null;
	let max = 0;
	let egalite = false;
	for (const [cat, n] of votes) {
		if (n > max) { meilleure = cat; max = n; egalite = false; }
		else if (n === max) egalite = true;
	}
	return egalite ? null : meilleure;
}

/** La catégorie déduite de la demande : pièces jointes, puis dossier, puis
    texte ; `general` quand rien ne tranche. */
export function detecterCategorie(indices: IndicesCategorie): CategorieQuiz {
	const pieces = (indices.pieces ?? []).filter(p => typeof p === "string" && p.trim() !== "");
	const parPieces = pieces.length ? categorieDe(pieces, true) : null;
	if (parPieces) return parPieces;
	// Chaque segment du chemin est un nom : « Efrei/Programmation C ».
	const segments = (indices.dossier ?? "").split(/[\\/]+/).filter(Boolean);
	const parDossier = segments.length ? categorieDe([segments.join(" / ")], true) : null;
	if (parDossier) return parDossier;
	const demande = indices.demande ?? "";
	return (demande.trim() ? categorieDe([demande], false) : null) ?? "general";
}

/** La catégorie qui part avec une demande : le choix de l'utilisateur
    quand il en a fait un (`auto` sinon), la détection autrement. */
export function categorieChoisie(choix: CategorieQuiz | "auto", indices: IndicesCategorie): CategorieQuiz {
	return choix === "auto" ? detecterCategorie(indices) : choix;
}
