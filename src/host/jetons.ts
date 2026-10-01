/* ══════════════════════════════════════════════════════════
   LES JETONS DE PIÈCES JOINTES — la moitié PURE, partagée par les deux hôtes

   `HostProcess.run` accepte des pièces jointes et un fichier de sortie ; c'est
   l'hôte qui crée le dossier temporaire, y écrit les fichiers et REMPLACE dans
   `args` et `stdin` les jetons qui les désignent. Le code partagé ne connaît
   donc aucun chemin — le rendu de l'application n'a pas de disque, il ne peut
   ni écrire ces fichiers ni apprendre où ils sont.

   POURQUOI ICI ET PAS DANS CHAQUE HÔTE. La composition et la substitution des
   jetons ne touchent NI `fs`, NI `os`, NI `path` : elles sont pures. Les
   dupliquer dans chaque hôte — ce qu'a fait le premier jet de la tâche 4 —
   n'était pas forcé, et les deux copies avaient déjà DIVERGÉ en une tranche
   (l'une prenait son environnement en paramètre, l'autre non). Ce fichier n'importe rien de Node : le rendu de
   l'application pourrait l'importer sans que `check:host` (assertion 6) ne
   rougisse. Seule la moitié `fs` reste chez chaque hôte.

   POURQUOI UN MARQUEUR PAR APPEL, et ce que ça a coûté de l'apprendre. La
   première forme des jetons était `{{fichier:1}}`, `{{home}}` — substitués dans
   `stdin`, c'est-à-dire dans un texte ENTIÈREMENT écrit par l'utilisateur : sa
   demande, et le contenu des notes qu'il a jointes. Une note sur les moteurs de
   gabarits (Handlebars, Jinja, Mustache — tous écrivent `{{…}}`) qui cite
   `{{home}}` faisait donc partir le chemin ABSOLU de la machine au modèle, qui
   pouvait le recopier dans le quiz réécrit dans une note ; et un `{{fichier:1}}`
   cité alors qu'aucune image n'est jointe faisait REFUSER l'appel, tuant la
   génération sur un diagnostic interne, en français, injecté tel quel dans une
   interface anglaise. Le marqueur est tiré au sort POUR CET APPEL : le texte de
   l'utilisateur ne peut pas le deviner, donc il ne peut plus collisionner.
══════════════════════════════════════════════════════════ */

/** Une pièce jointe d'un appel de CLI : un nom et son contenu encodé. */
export interface FichierJoint {
	nom: string;
	base64: string;
}

/** Le marqueur est HEXADÉCIMAL, et c'est vérifié avant de composer la moindre
    expression régulière : il en devient un littéral sûr, sans échappement. Un
    marqueur venu d'ailleurs (un réglage, un quiz partagé) ne peut donc pas
    glisser de métacaractère dans le motif. */
const MARQUEUR_VALIDE = /^[0-9a-f]{8,64}$/;

/** Une erreur dont le `name` est celui que le contrat nomme (`refuse`) :
    l'appelant décide sur ce nom, jamais sur le message, qui n'est pas traduit. */
function refus(message: string): Error {
	const e = new Error(message);
	e.name = "refuse";
	return e;
}

/**
 * Un marqueur neuf, pour UN appel. 32 chiffres hexadécimaux.
 *
 * `crypto.getRandomValues` existe dans les trois environnements où ce code
 * tourne (le rendu d'Obsidian, celui de l'application, Node ≥ 19 pour les
 * contrôles). Le repli sur `Math.random` n'est pas une faiblesse de sécurité :
 * ce marqueur ne garde aucun secret, il sépare seulement notre texte de celui
 * de l'utilisateur — et l'utilisateur n'a pas le prompt sous les yeux au moment
 * où il l'écrit.
 */
export function nouveauMarqueur(): string {
	const alea = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
	if (alea && typeof alea.getRandomValues === "function") {
		const octets = alea.getRandomValues(new Uint8Array(16));
		return Array.from(octets, o => o.toString(16).padStart(2, "0")).join("");
	}
	let s = "";
	while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
	return s.slice(0, 32);
}

/** Le jeton de la N-ième pièce jointe (1-based). */
export function jetonFichier(marqueur: string, n: number): string {
	return "{{nq-" + marqueur + ":fichier:" + String(n) + "}}";
}

/** Le jeton du chemin absolu de `sortieFichier`. */
export function jetonSortie(marqueur: string): string {
	return "{{nq-" + marqueur + ":sortie}}";
}

/** Le jeton du dossier personnel. */
export function jetonHome(marqueur: string): string {
	return "{{nq-" + marqueur + ":home}}";
}

/** Le nom d'une pièce jointe, RÉDUIT à un nom de fichier. Le code partagé ne
    choisit pas où l'hôte écrit : un `..` ou un séparateur sortirait du dossier
    temporaire, qui est la seule chose que ce dossier promette. C'est la même
    règle que `perimetre.borner` pour les chemins du pont. */
export function nomDeFichierSur(nom: string, defaut: string): string {
	const base = String(nom || "").split(/[/\\]/).pop() || "";
	return base && base !== "." && base !== ".." ? base : defaut;
}

/** Ce que l'hôte a fabriqué, et que les jetons désignent. */
export interface ValeursJetons {
	/** Le marqueur de CET appel. */
	marqueur: string;
	/** Les chemins absolus des pièces jointes, dans l'ordre. */
	chemins: string[];
	/** Le chemin absolu de `sortieFichier`, ou la chaîne vide s'il n'y en a pas. */
	sortie: string;
	/** Le dossier personnel. */
	maison: string;
}

/**
 * Remplace, dans `texte`, les jetons portant CE marqueur — et eux seuls.
 *
 * Un jeton qui ne désigne rien REFUSE, il ne s'efface pas : un `{{…:sortie}}`
 * rendu vide donnerait au CLI un argument vide au lieu d'un chemin (`-o ""`),
 * et un `{{…:fichier:3}}` littéral, un chemin qui n'existe pas. Les deux
 * produisent un appel faux et muet ; le refus, lui, se lit d'un coup d'œil.
 *
 * REMPLACEMENT PAR FONCTION, jamais par chaîne de remplacement : un chemin qui
 * contiendrait `$1` ou `$&` serait réécrit par `String.replace`. Le dépôt a
 * déjà payé ce défaut ailleurs (cf. CLAUDE.md, `check:quiz-io`).
 */
export function substituerJetons(texte: string, valeurs: ValeursJetons): string {
	if (!MARQUEUR_VALIDE.test(valeurs.marqueur)) {
		throw refus("marqueur de jetons invalide : " + valeurs.marqueur);
	}
	const motif = new RegExp("\\{\\{nq-" + valeurs.marqueur + ":(?:fichier:(\\d+)|sortie|home)\\}\\}", "g");
	return texte.replace(motif, (jeton: string, index: string | undefined) => {
		if (index === undefined) {
			if (jeton.endsWith(":home}}")) {
				if (!valeurs.maison) throw refus("jeton " + jeton + " : aucun dossier personnel");
				return valeurs.maison;
			}
			if (!valeurs.sortie) throw refus("jeton " + jeton + " : aucun fichier de sortie demandé");
			return valeurs.sortie;
		}
		const i = Number(index) - 1;
		if (i < 0 || i >= valeurs.chemins.length) {
			throw refus("jeton " + jeton + " : aucune pièce jointe à cet index");
		}
		return valeurs.chemins[i];
	});
}
