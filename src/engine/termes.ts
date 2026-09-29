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
	/* L'ÉCRAN d'une lecture et la lecture courte au-dessus d'une question
	   (engine/lecture-rendu.ts) : texte, étapes, tableau, récapitulatif —
	   UNE zone pour toute la lecture, pas une par étape (un terme souligné à
	   chaque étape). Ses cartes à retourner sont des `<button>`, exclus :
	   souligner leur recto donnerait le verso. */
	".quiz-lecture",
].join(", ");

/** Ancêtres dont le texte n'est JAMAIS apparié, COMMUNS au texte ordinaire et
    à un `<code>` inline (défaut #5 de la revue du 2026-09-27, voir plus bas) :
    liens, contrôles, formule déjà rendue, sortie de programme, `.qb-terme`
    lui-même — sans cette dernière exclusion, un second passage sur le même
    DOM ré-envelopperait le texte déjà souligné (idempotence, spec §7). Les
    titres non plus : le titre d'une lecture nomme souvent son terme, et la
    première occurrence doit tomber dans le texte qui l'explique. Les TEXTES
    D'INTERFACE posés dans une zone (indice de retournement d'une lecture,
    titre « À retenir », libellé du verso d'une flashcard — défaut #9) ne sont
    pas du contenu du quiz. `code`/`pre` restent EXCLUS du texte ordinaire
    (`SELECTEUR_EXCLUS`) mais PAS de la recherche d'un `<code>` inline
    (`SELECTEUR_EXCLUS_CODE`, qui s'en sert justement) — un `<pre>` (bloc,
    jamais visé) le reste dans les deux cas. */
const ANCETRES_EXCLUS = [
	"pre", "kbd", "a", "button", "input", "textarea", "mjx-container", ".math",
	".quiz-code-output", ".qb-terme", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6",
	".quiz-lecture-indice", ".quiz-lecture-retenir-titre", ".quiz-textonly-label",
];
const SELECTEUR_EXCLUS = ["code", ...ANCETRES_EXCLUS].join(", ");
const SELECTEUR_EXCLUS_CODE = ANCETRES_EXCLUS.join(", ");

/** Le contenu qu'une carte de question EXIGE de l'utilisateur — jamais
    explicable AILLEURS sur la même carte tant qu'elle n'est pas corrigée
    (défaut #4 de la revue, spec §1 : « une définition sur l'énoncé d'une
    question qui demande justement ce terme donnerait la réponse »). Le titre
    (`h2`), l'énoncé (`.quiz-question` — sauf sur un écran de LECTURE, où il
    loge la zone `.quiz-lecture` elle-même, filtrée plus bas), les options,
    les emplacements/éléments d'un classement, les lignes/choix d'un
    appariement. Le recto d'une flashcard n'a pas de sélecteur à part : c'est
    le même `.quiz-question` que les autres types (`engine/cards.ts`,
    `questionCardHtml`, `promptHtml` partagé). */
const SELECTEUR_PROTEGE = "h2, .quiz-question, .quiz-option, [data-order-slot], [data-order-item], [data-match-slot], [data-match-choice]";

/** Les zones à RISQUE de fuite (défaut #4) : visibles AVANT que la carte ne
    soit corrigée. `.quiz-lecture--courte` seul, pas `.quiz-lecture` tout
    court (l'écran plein d'une lecture n'a pas de question à protéger contre
    lui-même — spec §1, seule la lecture COURTE se pose au-dessus d'une
    question hôte). Les zones APRÈS-RÉPONSE (`.quiz-explain`,
    `.quiz-flashcard-back`) ne sont PAS listées ici : elles ne changent pas. */
const SELECTEUR_ZONES_A_RISQUE = ".quiz-hint-inline-body, .quiz-hint-modal-body, .quiz-passage-content, .quiz-lecture--courte, .quiz-learn-content";

/** La carte d'une question, repérable depuis n'importe laquelle de ses zones. */
const SELECTEUR_CARTE = ".quiz-track-item[data-qi]";

export interface TermesHandlers {
	/** Souligne les termes du glossaire sous `root` (toutes les zones qu'il
	    contient, `root` lui-même compris s'il en est une). Sans glossaire,
	    sortie immédiate — aucun DOM touché. `carteExterne` : la carte de
	    référence pour la garde anti-fuite (défaut #4) quand `root` n'est PAS
	    lui-même dans une carte — la modale d'indice, portalée hors du quiz
	    (`engine/hint.ts`). */
	poserTermes(root: Element | null, carteExterne?: Element | null): void;
	/** Ferme la bulle de définition ouverte (changement de question). */
	fermerBulle(): void;
}

/** Les zones de lecture SOUS `root`, `root` lui-même inclus s'il correspond. */
function zonesSous(root: Element): Element[] {
	const zones: Element[] = [];
	if (root.matches(SELECTEUR_ZONES)) zones.push(root);
	root.querySelectorAll<Element>(SELECTEUR_ZONES).forEach(z => zones.push(z));
	/* Les zones les plus EXTÉRIEURES seulement : une lecture courte posée
	   dans un support, ou toute zone dans une autre, compterait sinon deux
	   fois — deux soulignements du même terme dans ce que l'œil lit comme un
	   seul texte. */
	return zones.filter(z => !zones.some(o => o !== z && o.contains(z)));
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

/** La carte contenant `zone` est-elle CORRIGÉE (défaut #4) ? Deux signes
    lisibles depuis le DOM SEUL, sans `ctx` (cette passe reste pure) : le
    verrou GLOBAL du quiz — `.quiz-is-locked`, posé sur le conteneur à la
    soumission (engine.ts, engine/track.ts, engine/exam.ts) et donc ancêtre de
    TOUTES les cartes — et le retournement d'UNE carte mémoire, le seul cas où
    une carte peut être corrigée AVANT le verrou global (`.quiz-flashcard-back`
    n'existe dans le DOM qu'une fois retournée, engine/text-only.ts
    `flashcardBodyHtml`). Une carte sans explication (`q.explain` absent)
    resterait autrement invisible au verrou : ce n'est PAS le signe retenu.
    A Learn card checked on its own (engine/learn.ts, 2026-09-29) is
    corrected too: its track item carries `quiz-learn-revealed`. */
function carteCorrigee(carte: Element): boolean {
	return !!carte.closest(".quiz-is-locked, .quiz-learn-revealed") || !!carte.querySelector(".quiz-flashcard-back");
}

/** Les entrées du glossaire présentes dans le contenu PROTÉGÉ de `carte`
    (défaut #4) — celles qu'une zone à risque de la MÊME carte ne doit pas
    expliquer avant correction. Un ensemble PARTAGÉ entre tous les éléments
    protégés (titre, énoncé, options, classement, appariement) : une entrée
    trouvée dans l'un n'est pas recherchée dans les suivants. */
function entreesProtegeesDeLaCarte(carte: Element, index: IndexGlossaire): Set<number> {
	const trouvees = new Set<number>();
	carte.querySelectorAll<Element>(SELECTEUR_PROTEGE).forEach(el => {
		// L'écran d'une LECTURE loge son contenu (zone `.quiz-lecture`, déjà
		// soulignable normalement) DANS `.quiz-question` : ce n'est alors pas
		// un énoncé qui attend une réponse, rien à protéger.
		if (el.matches(".quiz-question") && el.querySelector(".quiz-lecture")) return;
		trouverTermes(el.textContent ?? "", index, trouvees);
	});
	return trouvees;
}

/** Un ancêtre de `depart`, STRICTEMENT entre lui et `zone` (`zone` EXCLUE),
    correspond-il à `selecteur` ? Borné à la zone (défaut #9 de la revue) : un
    `closest()` non borné remonterait au-delà — un lien, un titre ou un `<pre>`
    qui EMBARQUE le quiz entier dans la note ferait alors sauter toute une
    zone, alors que seuls les ancêtres INTERNES à la zone doivent compter. */
function ancetreExcluDansZone(depart: Element | null, zone: Element, selecteur: string): boolean {
	let n = depart;
	while (n && n !== zone) {
		if (n.matches(selecteur)) return true;
		n = n.parentElement;
	}
	return false;
}

/** Les `<code>` INLINE (jamais dans un `<pre>`, jamais dans un lien ou un
    `.qb-terme` déjà posé) de `zone`, candidats au défaut #5 : la génération
    met chaque identifiant entre backticks, donc dans un `<code>`, exclu de la
    passe texte ordinaire — un terme comme `yield` n'y était jamais visible. */
function elementsCodeDeLaZone(zone: Element): HTMLElement[] {
	const els: HTMLElement[] = [];
	zone.querySelectorAll<HTMLElement>("code").forEach(code => {
		if (ancetreExcluDansZone(code.parentElement, zone, SELECTEUR_EXCLUS_CODE)) return;
		els.push(code);
	});
	return els;
}

/** Enveloppe un `<code>` ENTIER dans `span.qb-terme` quand son texte (trim)
    est EXACTEMENT une forme (terme ou alias) d'une entrée pas encore vue dans
    la zone — le `<code>` reste INTACT à l'intérieur (défaut #5). Réutilise la
    regex de la forme (mêmes tolérances : casse, pluriel, apostrophes) plutôt
    qu'une comparaison de chaînes séparée ; « exactement » est vérifié en
    exigeant que le match couvre le texte du `<code>` en entier. */
function envelopperCode(code: HTMLElement, index: IndexGlossaire, dejaVus: Set<number>): void {
	const texte = (code.textContent ?? "").trim();
	if (!texte) return;
	const texteMinuscule = texte.toLowerCase();
	for (const forme of index.formes) {
		if (dejaVus.has(forme.entree)) continue;
		if (!texteMinuscule.includes(forme.indice)) continue;
		forme.regex.lastIndex = 0;
		const m = forme.regex.exec(texte);
		if (!m || m.index !== 0 || m[0].length !== texte.length) continue;
		const parent = code.parentNode;
		if (!parent) return;
		const span = document.createElement("span");
		span.className = "qb-terme";
		span.tabIndex = 0;
		span.dataset.terme = String(forme.entree);
		parent.insertBefore(span, code);
		span.appendChild(code);
		dejaVus.add(forme.entree);
		return;
	}
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
    Le filtrage se fait APRÈS coup (`ancetreExcluDansZone`), pas via le
    callback `acceptNode` du `TreeWalker` : `linkedom` (scripts/check-termes.mjs,
    hors navigateur) implémente `whatToShow` mais ignore silencieusement ce
    callback — un filtre qui en dépendrait passerait tous les nœuds texte,
    y compris ceux d'un `<code>` ou d'un `.qb-terme` déjà posé, sans jamais
    rougir. Cette version fonctionne identiquement dans les deux environnements.
    BORNÉ à `zone` (défaut #9) : un ancêtre du QUIZ lui-même (un `<a>`, un
    `<h2>` ou un `<pre>` qui l'embarque dans la note) ne doit jamais faire
    sauter la zone entière — seuls les ancêtres INTERNES à `zone` comptent. */
function noeudsTexteDeLaZone(zone: Element): Text[] {
	const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
	const noeuds: Text[] = [];
	let n: Node | null;
	while ((n = walker.nextNode())) {
		const node = n as Text;
		if (!node.nodeValue || !node.nodeValue.trim()) continue;
		if (ancetreExcluDansZone(node.parentElement, zone, SELECTEUR_EXCLUS)) continue;
		noeuds.push(node);
	}
	return noeuds;
}

/**
 * Passe DOM PURE (aucune dépendance à `ctx`), pour rester testable sans
 * assembler le moteur complet (`scripts/check-termes.mjs`). `poserTermes`
 * (plus bas) n'en est qu'un appel avec l'index du quiz courant.
 *
 * `carteExterne` : la carte de RÉFÉRENCE pour la garde anti-fuite (défaut #4)
 * quand une zone à risque n'est PAS elle-même dans une carte — la modale
 * d'indice, portalée hors du quiz (`engine/hint.ts`, `SELECTEUR_CARTE` n'y
 * trouve rien en remontant). Ignoré pour une zone qui EST dans une carte :
 * celle-ci prime toujours.
 */
export function poserTermesDans(root: Element | null, index: IndexGlossaire, carteExterne: Element | null = null): void {
	if (!root || index.formes.length === 0) return;
	for (const zone of zonesSous(root)) {
		// Une seule occurrence par ENTRÉE et par ZONE (spec §3) : l'ensemble
		// démarre avec les entrées déjà soulignées (idempotence), puis est
		// MUTÉ et PARTAGÉ par tous les nœuds texte de cette zone.
		const dejaVus = entreesDejaVues(zone);
		// Fuite pédagogique (défaut #4) : une zone à risque d'une carte PAS
		// ENCORE corrigée ne souligne jamais un terme qui apparaît dans le
		// contenu protégé de la MÊME carte — ce serait donner la réponse.
		if (zone.matches(SELECTEUR_ZONES_A_RISQUE)) {
			const carte = zone.closest(SELECTEUR_CARTE) ?? carteExterne;
			if (carte && !carteCorrigee(carte)) {
				entreesProtegeesDeLaCarte(carte, index).forEach(i => dejaVus.add(i));
			}
		}
		// Termes de CODE (défaut #5) avant le texte ordinaire : un `<code>`
		// dont le contenu EST exactement une forme réserve son entrée, pour
		// qu'une occurrence en texte plus loin dans la zone ne double pas.
		for (const code of elementsCodeDeLaZone(zone)) {
			envelopperCode(code, index, dejaVus);
		}
		for (const noeud of noeudsTexteDeLaZone(zone)) {
			envelopperNoeud(noeud, index, dejaVus);
		}
	}
}

export function createTermesHandlers(ctx: EngineCtx): TermesHandlers {
	const entrees = ctx.glossaire;
	if (!entrees || entrees.length === 0) {
		// Quiz sans glossaire : aucune bulle à poser, aucun écouteur à brancher.
		return { poserTermes() {}, fermerBulle() {} };
	}
	// Index construit UNE fois pour tout le quiz — l'ordre de tri ne dépend
	// que du glossaire, jamais du texte où on le cherche (glossaire.ts).
	const index = indexerGlossaire(entrees);
	const bulle = creerBulleGlossaire(ctx);
	ctx.__quizGlobalCleanups.push(() => bulle.destroy());

	function poserTermes(root: Element | null, carteExterne: Element | null = null): void {
		poserTermesDans(root, index, carteExterne);
	}

	return { poserTermes, fermerBulle: () => bulle.fermer() };
}
