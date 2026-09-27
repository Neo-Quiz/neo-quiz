/* ══════════════════════════════════════════════════════════
   GLOSSAIRE d'un quiz — lecture du format et appariement d'un terme

   Noyau PUR (ni DOM, ni hôte) : lit le tableau `glossary` de l'objet de
   configuration du bloc (`lireGlossaire`), puis repère où chaque terme
   apparaît dans un texte donné (`indexerGlossaire` + `trouverTermes`), pour
   que `src/engine/termes.ts` (lot suivant) puisse l'entourer d'une bulle.
   `npm run check:termes` l'éprouve, comme `check:md` éprouve
   `engine/grammaire-inline.ts`.

   Format, DONNÉES PERSISTÉES (clés en anglais, jamais traduites) :
     glossary: [ { term: 'pile', definition: '…', aliases: ['LIFO'] } ]
   Voir `docs/superpowers/specs/2026-09-27-lot-d-bulles-vocabulaire-design.md`.
══════════════════════════════════════════════════════════ */

import { motifFormule } from "./engine/grammaire-inline";

/** Une entrée du glossaire, DÉJÀ validée par `lireGlossaire` : `term` et
    `definition` non vides, `aliases` (s'il est présent) non vide lui aussi. */
export interface EntreeGlossaire {
	term: string;
	definition: string;
	aliases?: string[];
}

/**
 * Le tableau `glossary` BRUT du bloc, filtré aux entrées exploitables.
 *
 * Toute entrée dont `term` ou `definition` n'est pas une chaîne non vide
 * (après `trim`) est IGNORÉE plutôt que de faire échouer la lecture du bloc —
 * même règle de tolérance que le reste du format quiz-blocks (un auteur, ou
 * un modèle, écrit facilement une ligne incomplète). `aliases` est filtré aux
 * seules chaînes non vides ; un tableau qui n'en garde aucune est omis plutôt
 * que laissé vide, pour qu'`indexerGlossaire` n'ait pas à re-filtrer.
 */
export function lireGlossaire(brut: unknown): EntreeGlossaire[] {
	if (!Array.isArray(brut)) return [];
	const sortie: EntreeGlossaire[] = [];
	for (const item of brut) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const o = item as Record<string, unknown>;
		const term = typeof o.term === "string" ? o.term.trim() : "";
		const definition = typeof o.definition === "string" ? o.definition.trim() : "";
		if (!term || !definition) continue;
		const entree: EntreeGlossaire = { term, definition };
		if (Array.isArray(o.aliases)) {
			const aliases = o.aliases
				.filter((a): a is string => typeof a === "string" && a.trim() !== "")
				.map(a => a.trim());
			if (aliases.length > 0) entree.aliases = aliases;
		}
		sortie.push(entree);
	}
	return sortie;
}

/** Une forme reconnue (le terme lui-même, ou l'un de ses alias), associée à
    l'index de son entrée dans le glossaire d'ORIGINE (celui passé à
    `indexerGlossaire`) — c'est cet index que `trouverTermes` rend et que
    `dejaVus` accumule, jamais un index dans `formes`. */
interface FormeGlossaire {
	entree: number;
	longueur: number;
	regex: RegExp;
}

/**
 * Index PRÉCALCULÉ des formes d'un glossaire, opaque : rien hors de
 * `trouverTermes` n'a besoin de lire `formes`. Construit une fois par quiz
 * (pas à chaque zone rendue), puisque l'ordre de tri ne dépend que du
 * glossaire, jamais du texte où on le cherche.
 */
export interface IndexGlossaire {
	/** Triées de la forme la plus LONGUE à la plus courte : un chevauchement
	    entre deux formes (« pile d'appel » contient « pile ») se résout
	    toujours en faveur de la plus spécifique, quel que soit l'ordre des
	    entrées dans le glossaire d'origine. */
	readonly formes: readonly FormeGlossaire[];
}

/** Échappe les caractères spéciaux d'une regex : un terme écrit par
    l'utilisateur n'est jamais un motif, même s'il contient un `.` ou un
    `(` (« C++ », « f(x) »). */
function echapperRegex(texte: string): string {
	return texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prépare un glossaire pour `trouverTermes`. Une expression par FORME (le
 * terme, puis chacun de ses alias) : deux formes de la même entrée sont deux
 * façons indépendantes de la repérer (« pile », « LIFO »), pas une seule
 * expression avec alternance — la longueur qui décide de la priorité au
 * chevauchement est celle de la forme trouvée, pas celle de l'entrée.
 *
 * Mot entier, insensible à la CASSE mais aux accents EXACTS (plier les
 * accents confondrait « pile » et « pilé »), pluriel français/anglais
 * toléré en suffixe : `(?:s|x|es)?`. Bornes par classe Unicode
 * (`\p{L}\p{N}_`), pas par `\b` (ASCII, « café » n'a pas de frontière avant
 * le `é` pour `\b`).
 */
export function indexerGlossaire(entrees: readonly EntreeGlossaire[]): IndexGlossaire {
	const formes: FormeGlossaire[] = [];
	entrees.forEach((entree, i) => {
		for (const forme of [entree.term, ...(entree.aliases ?? [])]) {
			formes.push({
				entree: i,
				longueur: forme.length,
				regex: new RegExp(
					"(?<![\\p{L}\\p{N}_])" + echapperRegex(forme) + "(?:s|x|es)?(?![\\p{L}\\p{N}_])",
					"giu",
				),
			});
		}
	});
	// La plus longue d'abord — tri STABLE (ES2019) : à longueur égale, la
	// forme rencontrée en premier dans le glossaire (le terme avant ses
	// alias, une entrée avant la suivante) garde la priorité.
	formes.sort((a, b) => b.longueur - a.longueur);
	return { formes };
}

/** Les plages `[début, fin[` occupées par une formule `$…$`/`$$…$$` dans
    `texte` — jamais coupée par un terme apparié (MathJax la rend de façon
    asynchrone, après le passage des bulles). Groupe 1 de `motifFormule` est
    le caractère qui précède la formule, à exclure de la plage. */
function plagesFormules(texte: string): Array<[number, number]> {
	const plages: Array<[number, number]> = [];
	const motif = motifFormule();
	let m: RegExpExecArray | null;
	while ((m = motif.exec(texte)) !== null) {
		plages.push([m.index + m[1].length, m.index + m[0].length]);
	}
	return plages;
}

/** Une plage `[début, fin[` en chevauche-t-elle une autre de la liste ? */
function chevauche(debut: number, fin: number, plages: ReadonlyArray<readonly [number, number]>): boolean {
	return plages.some(([a, b]) => debut < b && fin > a);
}

/**
 * Les occurrences de termes du glossaire dans `texte`, prêtes à être
 * entourées d'une bulle.
 *
 * `dejaVus` est un ensemble d'index d'ENTRÉES (pas de formes), MUTÉ par cet
 * appel et destiné à être PARTAGÉ entre tous les nœuds texte d'une même zone
 * (`src/engine/termes.ts`) : une entrée déjà trouvée dans un nœud précédent
 * de la zone n'est jamais reprise dans le suivant — une seule occurrence par
 * entrée et par zone, alias compris.
 *
 * Résolution des chevauchements : les formes sont essayées de la plus longue
 * à la plus courte (`indexerGlossaire`) ; la première occurrence valide d'une
 * forme (hors formule, hors plage déjà occupée par une forme plus longue déjà
 * acceptée) est retenue, et aucune autre forme de la MÊME entrée n'est
 * ensuite essayée dans cet appel (`dejaVus`). Le résultat est trié par
 * position de début, pas par ordre de découverte.
 */
export function trouverTermes(
	texte: string,
	index: IndexGlossaire,
	dejaVus: Set<number>,
): { debut: number; fin: number; entree: number }[] {
	if (!texte) return [];
	const exclusions = plagesFormules(texte);
	const occupees: Array<[number, number]> = [];
	const trouvailles: { debut: number; fin: number; entree: number }[] = [];

	for (const forme of index.formes) {
		if (dejaVus.has(forme.entree)) continue;
		forme.regex.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = forme.regex.exec(texte)) !== null) {
			const debut = m.index;
			const fin = debut + m[0].length;
			if (chevauche(debut, fin, exclusions) || chevauche(debut, fin, occupees)) continue;
			occupees.push([debut, fin]);
			dejaVus.add(forme.entree);
			trouvailles.push({ debut, fin, entree: forme.entree });
			break; // une seule occurrence par entrée, même parmi ses propres alias
		}
	}

	trouvailles.sort((a, b) => a.debut - b.debut);
	return trouvailles;
}
