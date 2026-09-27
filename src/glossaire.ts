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
	/** Clés INCONNUES de l'entrée brute (`example`, `category`… — défaut #12
	    de la revue du 2026-09-27) : jamais interprétées par ce module, mais
	    jamais perdues non plus — une sauvegarde de l'éditeur qui ne les
	    touche pas doit les réécrire telles quelles (`src/editor/export.ts`
	    `glossaryEntries`). `Object.create(null)`, comme `_extraFields`
	    ailleurs dans le format : un objet ordinaire absorberait une clé
	    nommée `__proto__` au lieu de la stocker. */
	_extra?: Record<string, unknown>;
}

/** Un `term`/alias entouré de backticks (« `yield` », un modèle qui met
    systématiquement un identifiant de code entre backticks) désigne le MÊME
    terme sans eux (défaut #5 de la revue) : sans ce nettoyage, un terme de
    code n'était jamais reconnu — la génération l'écrit toujours entre
    backticks, donc dans un `<code>`, hors de portée de la passe DOM. */
function sansBackticks(brut: string): string {
	const t = brut.trim();
	if (t.length >= 2 && t.startsWith("`") && t.endsWith("`")) {
		const interieur = t.slice(1, -1).trim();
		if (interieur) return interieur;
	}
	return t;
}

/** Clés reconnues d'une entrée — tout le reste part dans `_extra`. */
const CLES_CONNUES_ENTREE = new Set(["term", "definition", "aliases"]);

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
		const term = typeof o.term === "string" ? sansBackticks(o.term) : "";
		const definition = typeof o.definition === "string" ? o.definition.trim() : "";
		if (!term || !definition) continue;
		const entree: EntreeGlossaire = { term, definition };
		if (Array.isArray(o.aliases)) {
			const aliases = o.aliases
				.filter((a): a is string => typeof a === "string")
				.map(a => sansBackticks(a))
				.filter(a => a !== "");
			if (aliases.length > 0) entree.aliases = aliases;
		}
		const extra: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const cle of Object.keys(o)) {
			if (!CLES_CONNUES_ENTREE.has(cle)) extra[cle] = o[cle];
		}
		if (Object.keys(extra).length > 0) entree._extra = extra;
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
	/** Préfiltre (défaut #11, revue du 2026-09-27) : un préfixe littéral en
	    minuscules de la forme, testé par `includes()` avant de lancer la
	    regex — voir `indicePrefiltre`. */
	indice: string;
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

/** Les apostrophes qu'un texte réel mélange : droite, typographiques,
    modificateur. Un terme écrit « pile d'appel » dans le glossaire et
    « pile d’appel » dans la lecture (guillemets intelligents d'un éditeur)
    est le même terme (revue du 2026-09-27). */
const APOSTROPHES = "'\u2018\u2019\u201A\u201B\u02BC";

/** Le motif d'une forme : échappée, chaque apostrophe acceptant toutes les
    autres ; une ESPACE apparie toute suite d'espaces, une espace insécable ou
    un saut de ligne (défaut #10, revue du 2026-09-27) — `\s` couvre déjà
    ` `, donc « pile d'appel » écrit avec une espace insécable dans le
    texte lu reste le même terme. */
function motifForme(forme: string): string {
	const classe = "[" + APOSTROPHES + "]";
	return [...forme].map(c => {
		if (APOSTROPHES.includes(c)) return classe;
		if (c === " ") return "\\s+";
		return echapperRegex(c);
	}).join("");
}

/** Sous trois caractères, pas de pluriel toléré : le symbole « s »
    (seconde) apparierait « ses », « m » apparierait « mes » — et un
    symbole est invariable (revue du 2026-09-27). Sert aussi de seuil pour
    les pluriels IRRÉGULIERS ci-dessous (même règle, même raison). */
const LONGUEUR_MIN_PLURIEL = 3;

/** Bornes de mot : ni lettre, ni chiffre, ni `_`, ni MARQUE COMBINANTE
    (`\p{M}`, défaut #10) — pas par `\b` (ASCII, « café » n'a pas de
    frontière avant le `é` pour `\b`). Un texte NFD écrit « é » en « e » +
    accent combinant ; sans `\p{M}` ici, un terme « cafe » aurait mordu sur
    le début d'un « café » décomposé, le combinant n'étant pas une lettre. */
const BORNE = "[\\p{L}\\p{N}_\\p{M}]";

/** `motMinuscule` se termine-t-il par une CONSONNE suivie de « y » (anglais :
    query → queries, mais day → days reste régulier) ? Appelant responsable de
    la mise en minuscules. */
function finConsonnePlusY(motMinuscule: string): boolean {
	if (motMinuscule.length < 2 || !motMinuscule.endsWith("y")) return false;
	return !"aeiouy".includes(motMinuscule[motMinuscule.length - 2]);
}

/** Longueur MAXIMALE de l'indice de préfiltre (défaut #11). */
const LONGUEUR_INDICE = 4;

/**
 * L'indice de préfiltre d'une forme : un préfixe LITTÉRAL en minuscules,
 * testé par `includes()` sur le texte en minuscules (calculé une fois par
 * appel de `trouverTermes`) avant de lancer sa regex — bien moins cher sur un
 * texte long et un glossaire de quinze entrées (défaut #11).
 *
 * Ne doit JAMAIS produire de faux négatif : coupé avant la première espace ou
 * apostrophe (leur équivalence typographique ne doit pas dépendre de
 * l'indice — « d'Ohm » vs « d’Ohm », l'espace de « pile d'appel »), et
 * raccourci de la marge qu'un pluriel IRRÉGULIER peut ronger en fin de mot
 * (« signal » → « signaux » perd « al », « query » → « queries » perd le
 * « y ») — seulement quand l'indice porte sur CE mot-là : sur une forme de
 * plusieurs mots, la troncature tombe toujours APRÈS la coupure, hors de
 * portée du préfixe retenu.
 */
function indicePrefiltre(forme: string): string {
	const car = [...forme];
	const coupe = car.findIndex(c => c === " " || APOSTROPHES.includes(c));
	const monoMot = coupe === -1;
	const base = monoMot ? car : car.slice(0, coupe);
	let marge = 0;
	if (monoMot && base.length >= LONGUEUR_MIN_PLURIEL) {
		const bas = base.join("").toLowerCase();
		if (bas.endsWith("al")) marge = 2;
		else if (finConsonnePlusY(bas)) marge = 1;
	}
	const longueur = Math.max(1, Math.min(LONGUEUR_INDICE, base.length - marge));
	return base.slice(0, longueur).join("").toLowerCase();
}

/**
 * La regex d'une forme : mot entier, insensible à la CASSE mais aux accents
 * EXACTS (plier les accents confondrait « pile » et « pilé »), pluriel
 * français/anglais RÉGULIER toléré en suffixe (`(?:s|x|es)?`), et, quand la
 * forme s'y prête, un pluriel IRRÉGULIER en ALTERNATIVE — jamais les deux à
 * la fois dans un même essai (défaut #10, revue du 2026-09-27) : « signal »
 * → « signaux » (fin « al » → « aux ») et « query » → « queries » (consonne +
 * « y » → « ies »).
 */
function construireRegexForme(forme: string): RegExp {
	const car = [...forme];
	const tolerePluriel = car.length >= LONGUEUR_MIN_PLURIEL;
	const alternatives = [motifForme(forme) + (tolerePluriel ? "(?:s|x|es)?" : "")];
	if (tolerePluriel) {
		const bas = forme.toLowerCase();
		if (bas.endsWith("al")) {
			alternatives.push(motifForme(forme.slice(0, -2)) + "aux");
		} else if (finConsonnePlusY(bas)) {
			alternatives.push(motifForme(forme.slice(0, -1)) + "ies");
		}
	}
	const corps = alternatives.length > 1 ? `(?:${alternatives.join("|")})` : alternatives[0];
	// Une forme d'un ou deux caractères n'est JAMAIS appariée suivie d'une
	// apostrophe puis d'une lettre (« C'est », « n'est ») : c'est l'élision
	// française, pas une frontière de mot ordinaire (défaut #10).
	const antiElision = car.length <= 2 ? `(?![${APOSTROPHES}]\\p{L})` : "";
	return new RegExp(`(?<!${BORNE})${corps}${antiElision}(?!${BORNE})`, "giu");
}

/**
 * Prépare un glossaire pour `trouverTermes`. Une expression par FORME (le
 * terme, puis chacun de ses alias) : deux formes de la même entrée sont deux
 * façons indépendantes de la repérer (« pile », « LIFO »), pas une seule
 * expression avec alternance — la longueur qui décide de la priorité au
 * chevauchement est celle de la forme trouvée, pas celle de l'entrée.
 */
export function indexerGlossaire(entrees: readonly EntreeGlossaire[]): IndexGlossaire {
	const formes: FormeGlossaire[] = [];
	entrees.forEach((entree, i) => {
		for (const forme of [entree.term, ...(entree.aliases ?? [])]) {
			formes.push({
				entree: i,
				longueur: forme.length,
				indice: indicePrefiltre(forme),
				regex: construireRegexForme(forme),
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
	// Préfiltre (défaut #11) : calculé UNE fois pour tout le texte, jamais
	// par forme — c'est lui qui rend le `includes()` de chaque forme bon marché.
	const texteMinuscule = texte.toLowerCase();
	const exclusions = plagesFormules(texte);
	const occupees: Array<[number, number]> = [];
	const trouvailles: { debut: number; fin: number; entree: number }[] = [];

	for (const forme of index.formes) {
		if (dejaVus.has(forme.entree)) continue;
		if (!texteMinuscule.includes(forme.indice)) continue;
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
