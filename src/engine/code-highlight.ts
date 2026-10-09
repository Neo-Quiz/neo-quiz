/* ══════════════════════════════════════════════════════════
   COLORATION SYNTAXIQUE d'un bloc de code de quiz — module PUR
   (ni DOM, ni hôte : au même titre que grammaire-blocs.ts, dont c'est le
   complément pour la classe "code"). Utilisé par les deux hôtes via
   engine/sanitizer.ts.

   UNE SEULE EXCEPTION À LA PURETÉ (tour 3 de la revue) : le budget cumulé de
   coloration par rendu de carte (`budgetRestantDuRendu` plus bas) est un
   compteur de MODULE, remis à zéro par ses deux appelants. Voir le
   commentaire sur `BUDGET_COLORATION_PAR_RENDU` pour pourquoi, et le
   rapport de la tâche pour ce que ça change si un jour ce module tourne
   dans un contexte qui rendrait deux cartes en parallèle (il ne le fait pas
   aujourd'hui : JS est mono-thread et un rendu de carte est synchrone).

   BIBLIOTHÈQUE (revue du 2026-09-26, C1) : `refractor`, jamais `prismjs`
   directement. `prismjs` (même son entrée « core » seule) pose une globale
   (`window.Prism`/`global.Prism`) et programme un `highlightAll()` si
   `Prism.manual` n'est pas posé avant l'import — inacceptable dans un
   greffon qui tourne DANS Obsidian, lequel a SON PROPRE `window.Prism`
   (chargé à la demande par son propre moteur de rendu) : le remplacer, ou
   lui faire tourner du code du nôtre sur les blocs des AUTRES notes du
   vault, corromprait le rendu de tout le vault, pas seulement des quiz.
   `refractor` (wooorm, la bibliothèque derrière `react-syntax-highlighter`
   et `rehype-prism-plus`) porte les mêmes grammaires Prism mais dans un
   module sans AUCUNE globale : vérifié en lisant tout `refractor/lib/*.js`
   (aucune occurrence de `window`, `document`, `global`, `self`,
   `addEventListener`) — `refractor.highlight()` rend un arbre hast, jamais
   une chaîne HTML, et ne pose ni hook ni écouteur.

   SÉCURITÉ, sur un quiz partagé et donc hostile :
   - jamais de sortie HTML de la bibliothèque : on ne prend que l'arbre hast
     de `refractor.highlight`, et c'est NOUS qui construisons le HTML, nœud
     par nœud, en passant tout texte par l'échappement du sanitizer
     (paramètre `echapper`, jamais recopié ici).
   - le nom d'une classe de jeton n'entre en HTML qu'après un filtre
     `^[a-z0-9-]+$` : un jeton EXOTIQUE ne doit jamais pouvoir écrire autre
     chose qu'une classe CSS.
   - a language is looked up through `refractor.registered()` (never a direct
     `refractor.languages[langue]`, which would read an INHERITED property
     for a key such as `constructor` or `toString`) and through the language
     catalogue (code-catalogue.ts `codeLanguageOf`, guarded by
     `hasOwnProperty.call` — M1 of the review), which replaced this module's
     own alias table on 2026-09-28.
   - un langage inconnu, ou toute erreur de tokenisation, retombe sur `null` :
     l'appelant (grammaire-blocs.ts) affiche alors le texte échappé nu, sans
     couleurs — jamais une exception qui casserait le rendu du quiz.
   - un bloc trop long n'est coloré que sur un PLAFOND (voir `PLAFOND_BLOC`
     ci-dessous), et un texte entier (plusieurs blocs) sur un BUDGET cumulé
     (voir `sanitizer.ts`, `rendreTexteQuiz`) : au-delà, le reste s'affiche
     échappé sans couleurs plutôt que de risquer un temps de tokenisation
     qui bloque le rendu — mesuré sur des motifs RÉPÉTÉS hostiles, pas
     seulement aléatoires (revue du 2026-09-26, C2 ; voir le rapport et
     `scripts/check-code-highlight.mjs`).
══════════════════════════════════════════════════════════ */

import { refractor } from "refractor/core";
import clike from "refractor/clike";
import markup from "refractor/markup";
import css from "refractor/css";
import javascript from "refractor/javascript";
import typescript from "refractor/typescript";
import python from "refractor/python";
import c from "refractor/c";
import cpp from "refractor/cpp";
import java from "refractor/java";
import bash from "refractor/bash";
import powershell from "refractor/powershell";
import sql from "refractor/sql";
import json from "refractor/json";
import yaml from "refractor/yaml";
import go from "refractor/go";
import rust from "refractor/rust";
import php from "refractor/php"; // enregistre lui-même sa dépendance markup-templating
import csharp from "refractor/csharp";
// The grammars of the language catalogue (code-catalogue.ts, 2026-09-28):
// every `grammar` it names is one of these, `check:code-catalogue` proves it.
import scss from "refractor/scss";
import sass from "refractor/sass";
import less from "refractor/less";
import jsx from "refractor/jsx";
import tsx from "refractor/tsx";
import r from "refractor/r";
import julia from "refractor/julia";
import matlab from "refractor/matlab";
import objectivec from "refractor/objectivec";
import zig from "refractor/zig";
import kotlin from "refractor/kotlin";
import scala from "refractor/scala";
import groovy from "refractor/groovy";
import swift from "refractor/swift";
import dart from "refractor/dart";
import ruby from "refractor/ruby";
import elixir from "refractor/elixir";
import erlang from "refractor/erlang";
import perl from "refractor/perl";
import batch from "refractor/batch";
import arduino from "refractor/arduino";
import haskell from "refractor/haskell";
import ocaml from "refractor/ocaml";
import fsharp from "refractor/fsharp";
import lisp from "refractor/lisp";
import scheme from "refractor/scheme";
import clojure from "refractor/clojure";
import lua from "refractor/lua";
import vbnet from "refractor/vbnet";
import visualBasic from "refractor/visual-basic";
import pascal from "refractor/pascal";
import fortran from "refractor/fortran";
import toml from "refractor/toml";
import ini from "refractor/ini";
import markdown from "refractor/markdown";
import latex from "refractor/latex";
import docker from "refractor/docker";
import makefile from "refractor/makefile";
import cmake from "refractor/cmake";
import hcl from "refractor/hcl";
import graphql from "refractor/graphql";
import { codeLanguageOf } from "../code-catalogue";

// Known limit (review of 2026-09-28): the `markdown` grammar's own hook
// reads `Prism.languages[tag]` for a fence NESTED in a markdown block, so a
// nested ```constructor fence makes the tokenizer throw. The throw is caught
// below and the block shows uncoloured, still escaped — degraded, not unsafe.
// `refractor.register` ignores a grammar already registered (compared on its
// `displayName`), and a grammar registers its own dependencies (`php` →
// `markup-templating`, `tsx` → `jsx`, `vbnet` → `basic`…): order does not
// matter.
for (const langage of [clike, markup, css, javascript, typescript, python, c, cpp, java, bash, powershell, sql, json, yaml, go, rust, php, csharp,
	scss, sass, less, jsx, tsx, r, julia, matlab, objectivec, zig, kotlin, scala, groovy, swift, dart, ruby, elixir, erlang, perl, batch,
	arduino, haskell, ocaml, fsharp, lisp, scheme, clojure, lua, vbnet, visualBasic, pascal, fortran, toml, ini, markdown, latex, docker,
	makefile, cmake, hcl, graphql]) {
	refractor.register(langage);
}

/** Un plafond de caractères réellement colorés PAR BLOC : au-delà, le reste
    du code s'affiche échappé, sans couleurs. Choisi après mesure sur des
    motifs RÉPÉTÉS hostiles (re-revue du 2026-09-26, tour 3) : le motif `q3`
    (`"'`` , un guillemet, une apostrophe, un accent grave, répété) tokenisé
    par `refractor` prend 334 à 408 ms pour 3 000 caractères de bash — le
    premier plafond (3 000) ne suffisait pas. 1 000 caractères, le même
    motif sur bash, restent sous ~35 ms sur une machine rapide (mesuré :
    ~34 ms), avec une marge large pour une machine modeste. Voir
    `scripts/check-code-highlight.mjs`. */
export const PLAFOND_CARACTERES_PAR_BLOC = 1_000;

/** Un budget CUMULÉ de caractères colorés pour TOUT LE RENDU d'une carte de
    question (titre, énoncé, options, indice, explication, cours… peuvent
    contenir chacun un ou plusieurs blocs de code) : au-delà, les blocs
    suivants s'affichent échappés sans couleurs, même reconnus. La re-revue
    du tour 2 avait montré qu'un budget par TEXTE (un seul champ) laissait un
    champ de 7 blocs bash de 3 000 caractères prendre 2,1 s à lui seul, et
    qu'aucune borne ne tenait sur un quiz entier (plusieurs champs, chacun
    reparti avec un budget plein). Ce budget-ci est partagé par TOUS les
    champs d'une carte, quel que soit leur nombre — voir
    `reinitialiserBudgetRendu` plus bas pour le point exact où il se remet à
    zéro, et le rapport de la tâche pour le choix de ce point. */
export const BUDGET_COLORATION_PAR_RENDU = 5_000;

/* Le budget lui-même : un compteur de MODULE, pas un paramètre — c'est
   l'exception PURE de ce module (voir l'en-tête) : partagé par tous les
   appels de `colorerCode` faits par le rendu EN COURS, quel que soit le
   champ ou l'appelant. Sûr en l'état : JavaScript est mono-thread, et
   `questionCardHtml`/`renderQuizPreviewCard` rendent une carte de façon
   entièrement SYNCHRONE (aucun `await` entre le premier champ et le
   dernier) — deux rendus ne s'entrelacent jamais. */
let budgetRestantDuRendu = BUDGET_COLORATION_PAR_RENDU;

/** À appeler UNE FOIS, tout au DÉBUT du rendu d'une carte de question
    entière — jamais à chaque champ, sans quoi chaque champ obtiendrait son
    propre budget plein et la carte entière pourrait dépasser de loin la
    borne voulue. Appelants (tour 4) : `engine.ts` (`render`, tout le track ;
    `refreshQuestionSlide`, une carte re-rendue), `engine/hint.ts`
    (`openHintModal`, l'indice ouvert au clic), `dashboard/detail-fiche.ts`
    (`renderGrille`, toute la grille) et `editor/question-preview.ts`
    (`renderQuizPreviewCard`, une carte d'aperçu). Un rendu qui n'est PAS
    affiché passe par `sansColoration` à la place. */
export function reinitialiserBudgetRendu(): void {
	budgetRestantDuRendu = BUDGET_COLORATION_PAR_RENDU;
}

/** Le budget qu'il reste à colorer pour le rendu en cours. */
export function budgetRestant(): number {
	return budgetRestantDuRendu;
}

/** Exécute `f` SANS AUCUNE coloration (blocs rendus échappés), puis rend au
    rendu en cours EXACTEMENT le budget qu'il avait avant l'appel, même si
    `f` jette. Pour un rendu qui n'est PAS affiché, et dont la coloration
    serait jetée : la comparaison de `editor/html-vers-markdown.ts`, faite
    pour chaque champ de chaque question à l'ouverture d'une page de quiz
    (`canon()` y déballe de toute façon tous les `<span>`). La revue du
    2026-09-26 (tour 4) y a mesuré 9 à 18 s sur un quiz partagé hostile
    quand ce chemin REMETTAIT le budget à plein à chaque appel ; à budget
    nul, les deux côtés comparés sont rendus de la même façon, sans dépendre
    l'un de l'autre, et le rendu en cours n'est ni vidé ni rechargé. */
export function sansColoration<T>(f: () => T): T {
	const sauvegarde = budgetRestantDuRendu;
	budgetRestantDuRendu = 0;
	try {
		return f();
	} finally {
		budgetRestantDuRendu = sauvegarde;
	}
}

/** Décompte `n` caractères du budget du rendu en cours (appelé par
    `sanitizer.ts` après chaque coloration réussie, avec le `colore` que
    `colorerCode` a rendu). */
export function consommerBudget(n: number): void {
	budgetRestantDuRendu -= n;
}

/** Un nom de type ou d'alias de jeton, sûr à poser dans une classe. */
const NOM_SUR = /^[a-z0-9-]+$/;

interface NoeudHast {
	type: "root" | "element" | "text";
	tagName?: string;
	properties?: { className?: unknown };
	children?: NoeudHast[];
	value?: string;
}

function rendreHast(noeuds: NoeudHast[], echapper: (texte: string) => string): string {
	let html = "";
	for (const n of noeuds) {
		if (n.type === "text") { html += echapper(n.value ?? ""); continue; }
		if (n.type !== "element") continue; // aucun autre type ne sort de refractor.highlight
		const classes = Array.isArray(n.properties?.className)
			? n.properties.className.filter((c): c is string => typeof c === "string" && NOM_SUR.test(c))
			: [];
		const contenu = rendreHast(n.children ?? [], echapper);
		html += classes.length ? `<span class="${classes.join(" ")}">${contenu}</span>` : contenu;
	}
	return html;
}

/** Coupe `code` à `n` caractères SANS séparer une paire de substitution
    (émoji, caractère astral) : M2 de la revue — `slice(0, n)` seul peut
    couper entre les deux moitiés d'un caractère UTF-16 et afficher deux
    `U+FFFD` (caractère de remplacement) à l'écran. */
function couperSansCasserSurrogate(code: string, n: number): string {
	if (n >= code.length || n <= 0) return n <= 0 ? "" : code;
	const avantDernier = code.charCodeAt(n - 1);
	// 0xD800–0xDBFF : demi haut d'une paire de substitution — la couper
	// laisserait un demi bas orphelin juste après la coupe.
	return avantDernier >= 0xd800 && avantDernier <= 0xdbff ? code.slice(0, n - 1) : code.slice(0, n);
}

/** Le résultat d'une coloration : le HTML, et le nombre de caractères
    RÉELLEMENT colorés (pour que l'appelant tienne son propre budget cumulé
    sur tout un texte — voir `sanitizer.ts`). */
export interface ResultatColoration { html: string; colore: number }

/**
 * Le HTML coloré d'un bloc de code, ou `null` si le langage est inconnu (ou
 * absent), si `capMax` est nul ou négatif (budget déjà épuisé), ou pour
 * toute erreur de tokenisation — l'appelant affiche alors le texte échappé
 * sans couleurs. `langueBrute` est déjà filtrée par le motif de clôture du
 * bloc (`[\w+#.-]*`, grammaire-blocs.ts) : rien d'autre ne peut y arriver,
 * mais on ne fait aucune confiance de plus que ce filtre n'en donne déjà.
 * `capMax` est le nombre de caractères que l'APPELANT autorise encore à
 * colorer dans le texte en cours (son budget cumulé, déjà plafonné par
 * `PLAFOND_CARACTERES_PAR_BLOC` s'il le souhaite) ; cette fonction ne colore
 * jamais plus que `min(capMax, PLAFOND_CARACTERES_PAR_BLOC)`.
 * `plafond`: a single block shown on its own (the source of an interactive
 * page, `html-frame.ts`) may raise the per-block cap; quiz text never does.
 */
export function colorerCode(code: string, langueBrute: string, echapper: (texte: string) => string, capMax: number, plafond = PLAFOND_CARACTERES_PAR_BLOC): ResultatColoration | null {
	if (capMax <= 0) return null;
	const cle = langueBrute.trim().toLowerCase();
	// The catalogue's grammar for a recognized tag (its lookup is guarded
	// against inherited `Object.prototype` keys, M1 of the review); any other
	// tag is tried as a refractor name or alias as it is (`svg`, `diff`…).
	// `registered()` itself reads only own entries.
	const langue = codeLanguageOf(cle)?.grammar ?? cle;
	if (!refractor.registered(langue)) return null;
	try {
		const cap = Math.min(capMax, plafond);
		const aColorer = code.length > cap ? couperSansCasserSurrogate(code, cap) : code;
		const reste = code.slice(aColorer.length);
		const arbre = refractor.highlight(aColorer, langue);
		const html = rendreHast((arbre.children ?? []) as NoeudHast[], echapper);
		return { html: reste ? html + echapper(reste) : html, colore: aColorer.length };
	} catch {
		return null;
	}
}
