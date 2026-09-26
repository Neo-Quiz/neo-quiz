/* ══════════════════════════════════════════════════════════
   COLORATION SYNTAXIQUE d'un bloc de code de quiz — module PUR
   (ni DOM, ni hôte : au même titre que grammaire-blocs.ts, dont c'est le
   complément pour la classe "code"). Utilisé par les deux hôtes via
   engine/sanitizer.ts.

   SÉCURITÉ, sur un quiz partagé et donc hostile (revue du 2026-09-26) :
   - jamais `Prism.highlight` ni une sortie HTML de Prism : on ne fait que
     `Prism.tokenize`, et c'est NOUS qui construisons le HTML, jeton par
     jeton, en passant tout texte par l'échappement du sanitizer (paramètre
     `echapper`, jamais recopié ici).
   - le type d'un jeton (et ses alias) n'entre en classe qu'après un filtre
     `^[a-z0-9-]+$` : Prism ne les fabrique qu'à partir de noms de grammaire
     connus, mais un jeton EXOTIQUE (langage tiers ajouté un jour) ne doit
     jamais pouvoir écrire autre chose qu'une classe CSS.
   - un langage inconnu, ou toute erreur de tokenisation, retombe sur `null` :
     l'appelant (grammaire-blocs.ts) affiche alors le texte échappé nu, sans
     couleurs — jamais une exception qui casserait le rendu du quiz.
   - un bloc trop long est coloré seulement sur son PLAFOND : au-delà, le
     reste s'affiche échappé sans couleurs plutôt que de risquer un temps de
     tokenisation qui bloque le rendu (mesuré au commit : voir le rapport).
══════════════════════════════════════════════════════════ */

/* L'entrée PAR DÉFAUT du paquet (`import Prism from "prismjs"`) embarque en
   plus le PLUGIN `file-highlight`, qui réfère `Element` sans le protéger
   correctement dès que `document` existe (même un bouchon minimal, comme
   celui posé par les scripts `check-*.mjs` hors d'un vrai navigateur) —
   `ReferenceError: Element is not defined` au chargement. `prism-core`
   n'embarque que le moteur, sans ce plugin ; markup/css/clike/javascript
   (que l'entrée par défaut embarque aussi) sont importés nous-mêmes juste
   après, comme les autres langages. */
import Prism from "prismjs/components/prism-core";
// Chaque import enregistre sa grammaire (et ses alias, ex. `js`, `py`, `sh`)
// sur l'objet global Prism.languages — c'est le patron même de Prism.
import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-php";
import "prismjs/components/prism-csharp";

/** Alias qui ne sont PAS déjà posés par les composants Prism eux-mêmes
    (`js`, `ts`, `sh`, `shell`, `py`, `cs`, `html`, `xml` le sont déjà). */
const ALIAS_SUPPLEMENTAIRES: Readonly<Record<string, string>> = {
	"c++": "cpp",
};

/** Un plafond de caractères réellement colorés par bloc : au-delà, le reste
    du code s'affiche échappé, sans couleurs. Choisi après mesure (voir le
    rapport de la tâche) pour rester bien sous ~200 ms même sur un langage
    lent, quelle que soit la taille du bloc source. */
const PLAFOND_CARACTERES = 20_000;

/** Un nom de type ou d'alias de jeton Prism, sûr à poser dans une classe. */
const NOM_SUR = /^[a-z0-9-]+$/;

type ArbreJetons = (string | Prism.Token)[];

function classesDuJeton(jeton: Prism.Token): string[] {
	const alias = Array.isArray(jeton.alias) ? jeton.alias : jeton.alias ? [jeton.alias] : [];
	return [jeton.type, ...alias].filter(c => typeof c === "string" && NOM_SUR.test(c));
}

function rendreJetons(jetons: ArbreJetons, echapper: (texte: string) => string): string {
	let html = "";
	for (const j of jetons) {
		if (typeof j === "string") { html += echapper(j); continue; }
		const contenu = typeof j.content === "string"
			? echapper(j.content)
			: rendreJetons((Array.isArray(j.content) ? j.content : [j.content]) as ArbreJetons, echapper);
		const classes = ["token", ...classesDuJeton(j)].join(" ");
		html += `<span class="${classes}">${contenu}</span>`;
	}
	return html;
}

/**
 * Le HTML coloré d'un bloc de code, ou `null` si le langage est inconnu (ou
 * absent) — l'appelant affiche alors le texte échappé sans couleurs.
 * `langueBrute` est déjà filtrée par le motif de clôture du bloc
 * (`[\w+#.-]*`, grammaire-blocs.ts) : rien d'autre ne peut y arriver, mais on
 * ne fait aucune confiance de plus que ce filtre n'en donne déjà.
 */
export function colorerCode(code: string, langueBrute: string, echapper: (texte: string) => string): string | null {
	const cle = langueBrute.trim().toLowerCase();
	const langue = ALIAS_SUPPLEMENTAIRES[cle] ?? cle;
	const grammaire = Prism.languages[langue];
	if (!grammaire) return null;
	try {
		const dansLePlafond = code.length > PLAFOND_CARACTERES ? code.slice(0, PLAFOND_CARACTERES) : code;
		const reste = code.length > PLAFOND_CARACTERES ? code.slice(PLAFOND_CARACTERES) : "";
		const jetons = Prism.tokenize(dansLePlafond, grammaire) as ArbreJetons;
		const html = rendreJetons(jetons, echapper);
		return reste ? html + echapper(reste) : html;
	} catch {
		return null;
	}
}
