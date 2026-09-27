import type { EngineCtx } from "../types/engine-ctx";
import { indexerGlossaire, trouverTermes, type IndexGlossaire } from "../glossaire";
import { creerBulleGlossaire } from "./termes-bulle";

/* ══════════════════════════════════════════════════════════
   TERMES DU GLOSSAIRE — soulignement dans les zones de lecture

   Enveloppe, par le DOM (jamais `innerHTML`), chaque occurrence d'un terme du
   glossaire dans les ZONES de lecture d'une carte déjà rendue : le support de
   compréhension, l'explication, l'indice (en ligne comme dans sa modale), le
   cours d'une étape de Leçon, le verso d'une flashcard. JAMAIS dans l'énoncé,
   les options, un classement/appariement ou le recto d'une carte mémoire — ces
   zones n'y sont simplement pas, la liste ci-dessous est une liste blanche,
   pas un filtre d'exclusion (spec §1).

   Appelé à CHAQUE site où le moteur appelle `ctx.codeRun.bindCodeRunButtons`
   (engine.ts rendu complet + repeint d'une carte, engine/cards.ts slides meta,
   engine/hint.ts modale d'indice) — voir ces fichiers.

   ORDRE vis-à-vis de `mathifyElement` : cette passe doit tourner AVANT lui à
   chaque site d'appel. `mathifyElement` capture, de façon SYNCHRONE, les
   nœuds texte à mathifier avant d'attendre MathJax puis de les remplacer ; si
   `poserTermes` s'exécutait APRÈS son appel (même si l'attente n'est pas
   encore résolue), il détacherait ces mêmes nœuds texte (ils sont remplacés
   par un fragment) et leur formule ne serait alors jamais rendue. Passer
   AVANT évite la course : `trouverTermes` (src/glossaire.ts) exclut déjà les
   segments `$…$`/`$$…$$` d'une formule pas encore mathifiée, donc un terme
   n'est jamais apparié à l'intérieur.
══════════════════════════════════════════════════════════ */

/** Les zones où un terme peut être souligné — liste BLANCHE (spec §1/§4). */
const SELECTEUR_ZONES = [
	".quiz-passage-content",
	".quiz-explain",
	".quiz-hint-inline-body",
	".quiz-hint-modal-body",
	".quiz-learn-content",
	".quiz-flashcard-back",
].join(", ");

/** Ancêtres dont le texte n'est JAMAIS apparié : code, liens, contrôles,
    formule déjà rendue, sortie de programme, et `.qb-terme` lui-même — sans
    cette dernière exclusion, un second passage sur le même DOM ré-envelopperait
    le texte déjà souligné (idempotence, spec §7). */
const SELECTEUR_EXCLUS = "code, pre, kbd, a, button, input, textarea, mjx-container, .math, .quiz-code-output, .qb-terme, script, style";

export interface TermesHandlers {
	/** Souligne les termes du glossaire sous `root` (toutes les zones qu'il
	    contient, `root` lui-même compris s'il en est une). Sans glossaire,
	    sortie immédiate — aucun DOM touché. */
	poserTermes(root: Element | null): void;
}

/** Les zones de lecture SOUS `root`, `root` lui-même inclus s'il correspond. */
function zonesSous(root: Element): Element[] {
	const zones: Element[] = [];
	if (root.matches(SELECTEUR_ZONES)) zones.push(root);
	root.querySelectorAll<Element>(SELECTEUR_ZONES).forEach(z => zones.push(z));
	return zones;
}

/** Les entrées déjà soulignées dans `zone` (un passage précédent) : leur index
    reste HORS ATTEINTE d'un appel suivant — sans ça, une entrée dont la
    première occurrence a été enveloppée mais dont une AUTRE occurrence, plus
    loin dans la même zone, ne l'avait pas encore été (arrêtée par `dejaVus`
    au premier passage) serait soulignée à son tour au second appel : deux
    occurrences visibles pour la même entrée, et un DOM qui change d'un appel
    à l'autre — la passe ne serait plus idempotente. */
function entreesDejaVues(zone: Element): Set<number> {
	const vues = new Set<number>();
	zone.querySelectorAll<HTMLElement>(".qb-terme[data-terme]").forEach(el => {
		const i = Number(el.dataset.terme);
		if (Number.isInteger(i)) vues.add(i);
	});
	return vues;
}

/** Enveloppe les occurrences trouvées dans le nœud texte `noeud`, par un
    `DocumentFragment` de nœuds texte / `span.qb-terme` — jamais `innerHTML` :
    le texte d'un quiz partagé est une donnée, pas du HTML de confiance. */
function envelopperNoeud(noeud: Text, index: IndexGlossaire, dejaVus: Set<number>): void {
	const texte = noeud.nodeValue ?? "";
	const trouvailles = trouverTermes(texte, index, dejaVus);
	if (trouvailles.length === 0) return;

	const frag = document.createDocumentFragment();
	let curseur = 0;
	for (const { debut, fin, entree } of trouvailles) {
		if (debut > curseur) frag.appendChild(document.createTextNode(texte.slice(curseur, debut)));
		const span = document.createElement("span");
		span.className = "qb-terme";
		span.tabIndex = 0;
		span.dataset.terme = String(entree);
		// Texte recopié TEL QUEL (casse, pluriel) — jamais le terme canonique
		// du glossaire, qui pourrait différer de la forme lue dans le texte.
		span.textContent = texte.slice(debut, fin);
		frag.appendChild(span);
		curseur = fin;
	}
	if (curseur < texte.length) frag.appendChild(document.createTextNode(texte.slice(curseur)));
	noeud.replaceWith(frag);
}

/** Les nœuds texte non vides de `zone`, hors `SELECTEUR_EXCLUS`. Collectés
    d'abord (le `TreeWalker` ne doit pas courir sur un DOM que la boucle
    modifie en même temps que lui).
    Le filtrage se fait APRÈS coup (`closest`), pas via le callback
    `acceptNode` du `TreeWalker` : `linkedom` (scripts/check-termes.mjs,
    hors navigateur) implémente `whatToShow` mais ignore silencieusement ce
    callback — un filtre qui en dépendrait passerait tous les nœuds texte,
    y compris ceux d'un `<code>` ou d'un `.qb-terme` déjà posé, sans jamais
    rougir. Cette version fonctionne identiquement dans les deux environnements. */
function noeudsTexteDeLaZone(zone: Element): Text[] {
	const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
	const noeuds: Text[] = [];
	let n: Node | null;
	while ((n = walker.nextNode())) {
		const node = n as Text;
		if (!node.nodeValue || !node.nodeValue.trim()) continue;
		const parent = node.parentElement;
		if (!parent || parent.closest(SELECTEUR_EXCLUS)) continue;
		noeuds.push(node);
	}
	return noeuds;
}

/**
 * Passe DOM PURE (aucune dépendance à `ctx`), pour rester testable sans
 * assembler le moteur complet (`scripts/check-termes.mjs`). `poserTermes`
 * (plus bas) n'en est qu'un appel avec l'index du quiz courant.
 */
export function poserTermesDans(root: Element | null, index: IndexGlossaire): void {
	if (!root || index.formes.length === 0) return;
	for (const zone of zonesSous(root)) {
		// Une seule occurrence par ENTRÉE et par ZONE (spec §3) : l'ensemble
		// démarre avec les entrées déjà soulignées (idempotence), puis est
		// MUTÉ et PARTAGÉ par tous les nœuds texte de cette zone.
		const dejaVus = entreesDejaVues(zone);
		for (const noeud of noeudsTexteDeLaZone(zone)) {
			envelopperNoeud(noeud, index, dejaVus);
		}
	}
}

export function createTermesHandlers(ctx: EngineCtx): TermesHandlers {
	const entrees = ctx.glossaire;
	if (!entrees || entrees.length === 0) {
		// Quiz sans glossaire : aucune bulle à poser, aucun écouteur à brancher.
		return { poserTermes() {} };
	}
	// Index construit UNE fois pour tout le quiz — l'ordre de tri ne dépend
	// que du glossaire, jamais du texte où on le cherche (glossaire.ts).
	const index = indexerGlossaire(entrees);
	const bulle = creerBulleGlossaire(ctx);
	ctx.__quizGlobalCleanups.push(() => bulle.destroy());

	function poserTermes(root: Element | null): void {
		poserTermesDans(root, index);
	}

	return { poserTermes };
}
