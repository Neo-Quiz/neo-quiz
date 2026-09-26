/**
 * LES GESTES d'édition d'une question, purs et partagés par le formulaire
 * (`src/editor/editor-form.ts`) et par l'édition dans le rendu corrigé (moteur).
 *
 * Ce qu'ils empêchent : une question sans bonne réponse (dernière bonne
 * retirée, ou retirée par suppression d'option), un classement avec deux
 * emplacements sur le même élément (l'échange, jamais la simple écrasement),
 * des indices qui ne suivent pas un ajout ou un retrait d'option.
 *
 * Chaque geste MUTE la question passée et rend `true` si quelque chose a
 * changé, `false` si le geste est refusé — le seul type de retour qui
 * distingue « rien à faire » de « fait ». L'appelant (formulaire ou rendu)
 * décide seul de ce qu'un `true` déclenche (rendu, sauvegarde) : ce module ne
 * connaît ni l'écran ni la sauvegarde.
 *     npm run check:gestes
 */
import type { DraftQuestion } from "./utils";

/**
 * Bascule la réponse `i` entre bonne et mauvaise.
 * Choix unique (`correctIndex`) : `i` devient LA bonne réponse ; déjà bonne →
 * refusé (rien à faire). Choix multiple (`correctIndices`) : `i` entre ou
 * sort du tableau trié ; retirer la DERNIÈRE bonne réponse est refusé — une
 * question sans aucune bonne réponse ne se corrige plus.
 */
export function basculerBonne(q: DraftQuestion, i: number): boolean {
	if (q.correctIndices !== undefined) {
		const a = q.correctIndices || [];
		if (a.includes(i)) {
			if (a.length <= 1) return false;
			q.correctIndices = a.filter(x => x !== i);
			return true;
		}
		q.correctIndices = [...a, i].sort((x, y) => x - y);
		return true;
	}
	if (q.correctIndex === i) return false;
	q.correctIndex = i;
	return true;
}

/**
 * Insère une option vide après l'indice `apres` (`apres` ≥ dernier indice, ou
 * absent des options : en fin ; `-1` : en tête). Décale `correctIndex` /
 * `correctIndices` au-delà du point d'insertion. Choix multiple qui n'avait
 * qu'une seule option après l'ajout : elle devient la seule bonne réponse
 * (règle du formulaire — une question à une seule option est forcément
 * réponse unique).
 */
export function ajouterOption(q: DraftQuestion, apres: number): boolean {
	const options = q.options;
	if (!options) return false;
	const at = apres >= options.length - 1 ? options.length : apres + 1;
	options.splice(at, 0, "");
	if (q.correctIndex !== undefined && q.correctIndex >= at) q.correctIndex++;
	if (q.correctIndices !== undefined) {
		q.correctIndices = q.correctIndices.map(x => x >= at ? x + 1 : x);
		if (options.length === 1) q.correctIndices = [0];
	}
	return true;
}

/**
 * Retire l'option `i`. Refusé sous deux options (une question a besoin d'au
 * moins deux choix), et refusé si `i` est une bonne réponse — jamais retirer
 * la bonne réponse elle-même, plutôt que la remplacer par une autre au hasard.
 * Sinon, retire et décale les indices au-delà de `i`.
 */
export function retirerOption(q: DraftQuestion, i: number): boolean {
	const options = q.options;
	if (!options || options.length <= 2) return false;
	const isMulti = q.correctIndices !== undefined;
	if (isMulti) {
		if ((q.correctIndices || []).includes(i)) return false;
	} else if (q.correctIndex === i) {
		return false;
	}
	options.splice(i, 1);
	if (isMulti) {
		q.correctIndices = (q.correctIndices || []).filter(idx => idx !== i).map(idx => idx > i ? idx - 1 : idx);
	} else if ((q.correctIndex ?? 0) > i) {
		q.correctIndex = (q.correctIndex ?? 0) - 1;
	}
	return true;
}

/**
 * Classement : place `element` à l'emplacement `emplacement`. Si `element`
 * occupait déjà un autre emplacement, les deux ÉCHANGENT leur valeur — jamais
 * deux emplacements ne pointent le même élément. Aucun changement (déjà en
 * place) → refusé.
 */
export function placerOrdre(q: DraftQuestion, emplacement: number, element: number): boolean {
	const order = q.correctOrder;
	if (!order) return false;
	if (order[emplacement] === element) return false;
	const autre = order.indexOf(element);
	if (autre !== -1 && autre !== emplacement) order[autre] = order[emplacement];
	order[emplacement] = element;
	return true;
}

/**
 * Appariement : associe la ligne `ligne` au choix `choix`, borné à
 * `choices.length - 1` (un indice reçu hors bornes, par ex. après suppression
 * d'un choix, retombe sur le dernier choix valide plutôt que de planter).
 */
export function associer(q: DraftQuestion, ligne: number, choix: number): boolean {
	const map = q.correctMap;
	const choices = q.choices;
	if (!map || !choices || choices.length === 0) return false;
	const borne = Math.min(Math.max(choix, 0), choices.length - 1);
	if (map[ligne] === borne) return false;
	map[ligne] = borne;
	return true;
}

/** Ajoute une variante de réponse acceptée (texte, numérique, terminal…). */
export function ajouterVariante(q: DraftQuestion): boolean {
	if (!q.acceptedAnswers) return false;
	q.acceptedAnswers.push("");
	return true;
}

/**
 * Retire la variante `i` — refusé sous une seule variante restante : une
 * question sans aucune réponse acceptée ne se corrige plus jamais.
 */
export function retirerVariante(q: DraftQuestion, i: number): boolean {
	const arr = q.acceptedAnswers;
	if (!arr || arr.length <= 1) return false;
	arr.splice(i, 1);
	return true;
}

/* ── Changer le TYPE d'une question ──────────────────────────
   Aucun formulaire ne savait le faire : le type se choisissait à la création
   et restait. La barre de l'édition dans le rendu (dashboard/detail-edition.ts)
   le permet, et la règle vit ici, pure, pour qu'elle s'éprouve. */

/** Les champs qui n'appartiennent qu'à un type. Tout le reste (titre, énoncé,
    explication, indice, document, leçon, ressource, rôle, identifiant…) est
    COMMUN et traverse le changement. */
const CHAMPS_DU_TYPE = [
	"options", "correctIndex", "correctIndices", "slots", "possibilities", "correctOrder",
	"rows", "choices", "correctMap", "placeholder", "acceptedAnswers", "caseSensitive",
	"commandPrefix", "cloze", "answer", "unit", "tolerance", "tolerancePercent",
	"_variantKey", "_variantValue", "_variantNested",
] as const;

/** Deux types dont les réponses se transposent : les choix (unique ⇄
    multiple) gardent leurs options, les réponses saisies (texte, numérique,
    terminaux) gardent leurs réponses acceptées. */
function famille(type: string): string {
	if (type === "single" || type === "multi") return "choix";
	if (type === "numeric" || type === "text" || type === "cmd" || type === "powershell" || type === "bash") return "saisie";
	return type;
}

/** `a` et `b` sont-ils de la même famille — un changement sans perte ? */
export function memeFamille(a: string, b: string): boolean {
	return famille(a) === famille(b);
}

/**
 * Donne à `q` le type de `defaut` (la question par défaut de ce type, que
 * l'appelant fabrique par `makeDefault` : ce module ne traduit rien). Les
 * champs COMMUNS restent ; les champs de l'ancien type partent, ceux du
 * nouveau prennent leur valeur par défaut — sauf ce qui se transpose :
 * - choix unique ⇄ multiple : les options ; la bonne réponse devient la
 *   seule bonne, la première bonne devient LA bonne ;
 * - réponses saisies entre elles : les réponses acceptées, le texte d'aide et
 *   la casse. L'invite reste celle du nouveau terminal (celle de `cmd` n'a
 *   rien à faire dans PowerShell), et la variante ÉCRITE de l'ancien terminal
 *   part : réémise, elle ferait relire la question dans son ancien type.
 * Même type → refusé.
 */
export function changerType(q: DraftQuestion, defaut: DraftQuestion): boolean {
	const ancien = q._type;
	const nouveau = defaut._type;
	if (ancien === nouveau) return false;
	const avant: Partial<DraftQuestion> = {};
	const sac = q as unknown as Record<string, unknown>;
	const neuf = defaut as unknown as Record<string, unknown>;
	for (const k of CHAMPS_DU_TYPE) {
		(avant as Record<string, unknown>)[k] = sac[k];
		delete sac[k];
		if (neuf[k] !== undefined) sac[k] = neuf[k];
	}
	/* La variante IMBRIQUÉE (`text: { variant }`, `terminal: { variant }`) vit
	   dans les champs personnalisés, réémis tels quels : laissée, elle ferait
	   relire la question comme l'ancien terminal. */
	if (avant._variantNested && q._extraFields) {
		for (const k of ["text", "terminal"]) {
			const v = q._extraFields[k];
			if (v && typeof v === "object" && !Array.isArray(v)) delete q._extraFields[k];
		}
	}
	q._type = nouveau;

	if (famille(ancien) === "choix" && famille(nouveau) === "choix" && avant.options) {
		q.options = avant.options;
		if (nouveau === "multi") q.correctIndices = [avant.correctIndex ?? 0];
		else q.correctIndex = avant.correctIndices?.[0] ?? 0;
	}
	if (famille(ancien) === "saisie" && famille(nouveau) === "saisie") {
		if (avant.acceptedAnswers?.length) q.acceptedAnswers = avant.acceptedAnswers;
		if (avant.placeholder) q.placeholder = avant.placeholder;
		if (avant.caseSensitive !== undefined) q.caseSensitive = avant.caseSensitive;
	}
	/* Les indices BORNÉS aux listes qu'ils désignent, quelle que soit leur
	   provenance (transposés ou par défaut) : aucun ne doit viser une option
	   ou un élément qui n'existe pas. */
	const nOptions = q.options?.length ?? 0;
	if (q.correctIndices) {
		q.correctIndices = q.correctIndices.filter(i => i >= 0 && i < nOptions);
		if (q.correctIndices.length === 0 && nOptions > 0) q.correctIndices = [0];
	}
	if (q.correctIndex !== undefined && (q.correctIndex < 0 || q.correctIndex >= nOptions)) q.correctIndex = 0;
	if (q.correctOrder && q.possibilities) {
		const n = q.possibilities.length;
		const ordre = q.correctOrder.slice(0, n);
		// Un indice hors bornes ou en double : l'ordre naturel, jamais deux
		// emplacements sur le même élément.
		const valide = ordre.length === n && ordre.every(i => i >= 0 && i < n) && new Set(ordre).size === n;
		q.correctOrder = valide ? ordre : Array.from({ length: n }, (_, i) => i);
	}
	return true;
}
