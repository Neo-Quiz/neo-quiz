/* ══════════════════════════════════════════════════════════
   LA PAGE D'UN QUIZ

   Elle lit la note, en extrait le PREMIER bloc `quiz-blocks` et le donne au
   moteur PARTAGÉ. Le moteur est IDENTIQUE à celui du greffon : c'est tout
   l'objet du contrat d'hôte. Rien ici ne connaît Obsidian, et rien ici ne
   réimplémente le rendu — un second rendu divergerait du premier sans que
   personne ne le voie.

   Le PREMIER bloc seulement : c'est exactement la limite du scanner
   (`extractQuizSource`, même `QUIZ_BLOCK_RE`), mesurée et connue
   (`npm run report:multiblock`), pas un oubli. Jouer ici le deuxième bloc
   d'une note ferait diverger la page du catalogue qui l'a listée.

   Les CLASSES sont celles de la page d'un quiz du tableau de bord
   (`qbd-qz-header`, `qbd-quizzes-crumb-back`…) : `src/assets/css/` est déjà
   chargé par `main.ts`, et la feuille dit elle-même « un seul bouton retour ».
   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte : un
   import de CSS y tire les fontes MathLive, pour lesquelles le harnais des
   scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../../src/branding";
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import { renderInteractiveQuiz } from "../../../../src/engine";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { parseQuizSource, QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { ajouter } from "../../../../src/dom";
import { couperNomAuMilieu } from "../../../../src/dashboard/file-icons";
import { quizModeLabel } from "../../../../src/dashboard/quiz-card";
import { brancherPerles } from "./perles";
import { attachQuizBars } from "./quiz-bars";
// Types en `import type` seulement : ils viennent du noyau et de `types/quiz`,
// et ce fichier ne doit tirer aucune implémentation de plus.
import type { ReviewGrade } from "../../../../src/scheduler";
import type { QuestionRole, StatsRecord } from "../../../../src/types/quiz";
import type { SessionsApp } from "../review/sessions";


/**
 * Ouvre la page d'un quiz dans `root` et rend son DÉMONTAGE.
 *
 * Le retour DOIT être appelé avant tout autre montage : il détruit l'instance
 * du moteur. Voir le commentaire de `__quizDestroy` plus bas.
 *
 * Il NE RETIRE PAS l'écran du DOM, pas plus que ne vide `root` à l'entrée
 * (2026-09-27) : c'est `main.ts` qui ajoute et retire les écrans, parce que
 * la transition de lancement (`transition-quiz.ts`) garde l'ancien affiché
 * 500 ms sous le nouveau — même contrat que la coquille du tableau de bord.
 */
export async function openQuizPage(
	root: HTMLElement,
	entry: QuizIndexEntry,
	onBack: () => void,
	/* La FORME du puits, pas le `ReviewStore` : cette page n'a besoin ni de
	   `plan()` ni de `load()`, et c'est exactement le type que le moteur
	   attend (`types/engine-ctx.ts`). */
	reviewSink?: {
		record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
		keyOf(path: string, id: string): string;
	},
	/* Même principe que `reviewSink` : la FORME du puits des statistiques
	   par quiz (`types/engine-ctx.ts`), jamais son implémentation — c'est ce
	   qui permet à `StatsStore` (obsidian.Plugin ou réglages de l'app) de
	   servir les deux hôtes sans que le moteur sache lequel l'appelle. */
	statsSink?: { updateRecord(path: string, update: StatsRecord): unknown },
	/* Les SESSIONS en cours (2026-09-26) : reprendre le quiz là où on
	   s'était arrêté. Optionnel comme les deux puits ci-dessus, pour les
	   mêmes raisons. */
	sessions?: SessionsApp,
): Promise<() => void> {
	const contenu = ajouter(root, "div", "qbd-content qbd-qz");

	// ── En-tête : croix · « Mode : titre », le chemin au survol du titre ──
	// `t()` est appelé ICI, au rendu, jamais dans une constante de module : une
	// chaîne traduite au chargement serait figée à la langue du démarrage.
	const entete = ajouter(contenu, "div", "qbd-qz-header");
	const retour = ajouter(entete, "button", "qbd-quizzes-crumb-back qbd-qz-back");
	retour.type = "button";
	/* Une CROIX et non la flèche du tableau de bord (2026-09-27, référence
	   StudySmarter) : on FERME le quiz, on ne remonte pas d'une page. */
	retour.setAttribute("aria-label", t("app.quiz.close"));
	currentHost().ui.setIcon(retour, "x");
	retour.addEventListener("click", () => onBack());
	/* Le bouton « précédent » de la souris fait la même chose que la flèche
	   (2026-09-25). Consommé dès l'appui, en capture ; l'action part au
	   relâchement. Le « suivant » est consommé sans effet : il n'y a rien après
	   un quiz qu'on joue. */
	const surBoutonSouris = (e: MouseEvent): void => {
		if (e.button !== 3 && e.button !== 4) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.type === "mouseup" && e.button === 3) onBack();
	};
	document.addEventListener("mousedown", surBoutonSouris, true);
	document.addEventListener("mouseup", surBoutonSouris, true);

	const titrage = ajouter(entete, "div", "qbd-qz-headline");
	// `title` et non `basename` : c'est le champ que `QuizIndexEntry` prévoit
	// pour l'affichage (les deux sont égaux aujourd'hui, pas forcément demain).
	ajouter(titrage, "h2", "qbd-qz-title", t("app.quiz.titleWithMode", { mode: quizModeLabel(entry.mode), title: entry.title }));
	/* Le CHEMIN de la note, affiché juste au-dessus du titre, au SURVOL du
	   titre seulement (la référence n'a qu'une ligne) ; APRÈS lui dans le DOM
	   pour que le survol le désigne (`+`, dashboard-detail.css). Coupé au
	   milieu : l'extension reste visible (`couperNomAuMilieu`). */
	const chemin = ajouter(titrage, "p", "qbd-qz-path");
	const { tete, queue } = couperNomAuMilieu(entry.path);
	ajouter(chemin, "span", "qbd-qz-path-tete", tete);
	if (queue) ajouter(chemin, "span", "qbd-qz-path-queue", queue);

	/* Le conteneur donné au moteur, et LUI SEUL : c'est sur lui que le moteur
	   posera `__quizDestroy`, et c'est lui que le démontage doit viser. Le
	   greffon fait exactement pareil (`el.createDiv({ cls: "quiz-blocks-host" })`
	   dans le processeur de bloc). */
	const hote = ajouter(contenu, "div", "quiz-blocks-host");

	/** Démontage d'un écran qui n'a PAS atteint le moteur (erreur de lecture,
	    note sans bloc) : il n'y a pas d'instance à détruire, seulement les
	    écouteurs du bouton de la souris. */
	const demonterSansMoteur = (): void => {
		document.removeEventListener("mousedown", surBoutonSouris, true);
		document.removeEventListener("mouseup", surBoutonSouris, true);
	};

	let source: string;
	try {
		source = await currentHost().fs.read(entry.path);
	} catch (e) {
		// Le message nomme le FICHIER et la CAUSE : un catch qui avale la cause
		// rend une panne (permission, disque, portée native perdue) indiagnosticable.
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return demonterSansMoteur;
	}

	const bloc = source.match(QUIZ_BLOCK_RE);
	if (!bloc) {
		// Clé du domaine `dashboard`, empruntée : c'est le message que le tableau
		// de bord donne déjà pour une note sans bloc. (`app.list.empty` parle du
		// DOSSIER, il mentirait ici.)
		hote.textContent = t("dashboard.detail.noBlockInNote");
		return demonterSansMoteur;
	}

	try {
		await renderInteractiveQuiz({
			container: hote,
			// `parseQuizSource` JETTE sur un JSON5 invalide — d'où le try : un bloc
			// à moitié écrit doit dire pourquoi, pas laisser un écran vide.
			quiz: parseQuizSource(bloc[1]),
			/* `sourcePath` vaut `entry.path`, le chemin RELATIF à la racine du
			   dossier. C'est la clé que le journal de révision utilisera en
			   tranche 2, et elle doit être IDENTIQUE à celle qu'Obsidian écrit
			   pour la même note. Un chemin absolu fonctionnerait à l'identique en
			   apparence (`C:/obsidian-vaults/Efrei/Cours/ch1.md::q1` au lieu de
			   `Cours/ch1.md::q1`) : les deux hôtes cesseraient de partager
			   l'historique, et personne ne le verrait avant la tranche 2. */
			sourcePath: entry.path,
			/* Le JOURNAL. `keyOf(sourcePath, id)` compose une clé du CONTRAT
			   (préfixée par la racine quand il y en a plusieurs) ; c'est
			   l'adaptateur qui la ramène à sa forme LOCALE avant de l'écrire,
			   pour que le greffon lise exactement la même clé sur le même
			   dossier. Le moteur, lui, ne sait rien de tout ça : il ne connaît
			   que la FORME du puits.
			   `statsSink` ET `reviewSink` : deux puits, deux questions — le
			   journal répond à « quelles questions sont dues aujourd'hui », les
			   stats à « où en suis-je sur ce quiz » (spec de l'ordonnanceur
			   §9.1, « deux systèmes distincts, à ne pas fusionner »). */
			statsSink,
			reviewSink,
			sessionSink: sessions?.puits(entry.path),
		});
	} catch (e) {
		hote.replaceChildren();
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return demonterSansMoteur;
	}

	/* Le cycle de vie est porté par `__quizDestroy`, que le moteur pose sur le
	   conteneur qu'on lui a donné (déclaré dans `src/global.d.ts`). L'appeler ici
	   est l'équivalent EXACT de l'`onunload` du `MarkdownRenderChild` côté
	   greffon : sans lui, chaque quiz ouvert laisse ses écouteurs
	   `document`/`window`, ses `ResizeObserver` et ses timers. Dix allers-retours
	   vers la liste = dix instances vivantes qui réagissent toutes au
	   redimensionnement de la fenêtre.

	   Idempotent (`fait`) et tolérant : un démontage appelé deux fois, ou après
	   une destruction déjà faite par le moteur, ne doit pas casser la navigation. */
	/* La frise de perles (mode compact et loupe, `ui/perles.ts`) : débranchée
	   avant la destruction du moteur, qui vide le conteneur qu'elle observe. */
	const debrancherPerles = brancherPerles(hote);
	/* The two bars that stay in place while a question scrolls (`ui/quiz-bars.ts`). */
	const detachBars = attachQuizBars(hote);
	let fait = false;
	return () => {
		if (fait) return;
		fait = true;
		debrancherPerles();
		detachBars();
		document.removeEventListener("mousedown", surBoutonSouris, true);
		document.removeEventListener("mouseup", surBoutonSouris, true);
		try {
			hote.__quizDestroy?.();
		} catch (e) {
			// Déjà détruit, ou détruit à moitié : rien à sauver, et l'écran suivant
			// doit s'afficher quand même.
			// Le préfixe vient de `branding.ts`, jamais recopié — et un log ne se
			// traduit pas (il s'adresse au développeur, pas à l'apprenant).
			console.warn(LOG_PREFIX + " destruction du quiz incomplète", e);
		}
		// APRÈS la destruction du moteur : elle a déjà appelé `enregistrer` sur
		// le puits (sauvegarde de sortie) ; `vider()` écrit immédiatement au lieu
		// d'attendre le délai de garde de 400 ms.
		void sessions?.vider();
	};
}
