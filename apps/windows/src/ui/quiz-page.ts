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
import { extractExamOptions, parseQuizSource, QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { ajouter } from "../../../../src/dom";
import { quizModeIcon, quizModeLabel } from "../../../../src/dashboard/quiz-card";
import { brancherPerles } from "./perles";
import { attachQuizBars } from "./quiz-bars";
// Types en `import type` seulement : ils viennent du noyau et de `types/quiz`,
// et ce fichier ne doit tirer aucune implémentation de plus.
import type { ReviewGrade } from "../../../../src/scheduler";
import type { QuestionRole, StatsRecord } from "../../../../src/types/quiz";
import type { SessionsApp } from "../review/sessions";
import { testSetups } from "../review/test-setups";
import { createTestSetupPage, type TestSetupPage } from "./test-setup-host";

/** What `openQuizPage` hands back. */
export interface QuizPageHandle {
	/** Tears the page down. MUST be called before any other screen is mounted:
	    it destroys the engine's instance (see `__quizDestroy` below). */
	teardown: () => void;
	/** The player cancelled the "Set up your test" modal of the FIRST launch:
	    the page was never shown and its screen is already out of `root`. The
	    caller puts the previous screen back instead of playing an entry
	    transition (`main.ts`, `ouvrirQuiz`). */
	launchCancelled: boolean;
}

/**
 * Opens a quiz's page in `root` and returns its TEARDOWN (`QuizPageHandle`).
 *
 * It does NOT remove the screen from the DOM, nor empty `root` on entry
 * (2026-09-27): `main.ts` adds and removes screens, because the launch
 * transition (`transition-quiz.ts`) keeps the old one shown for 500 ms under
 * the new one — the same contract as the dashboard shell. The one exception
 * is a launch cancelled in the setup modal (`launchCancelled`): nothing was
 * ever shown, so the screen leaves at once.
 *
 * For a Test, the engine asks the player through the "Set up your test" modal
 * before it renders; this function therefore resolves only once the modal is
 * answered (and, for a cancel, only after the page is out of `root`).
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
): Promise<QuizPageHandle> {
	const contenu = ajouter(root, "div", "qbd-content qbd-qz");

	// ── Header: cross · mode pill · title ──
	// `t()` is called HERE, at render time, never in a module constant: a
	// string translated at load time would stay in the startup language.
	const entete = ajouter(contenu, "div", "qbd-qz-header");
	const retour = ajouter(entete, "button", "qbd-quizzes-crumb-back qbd-qz-back");
	retour.type = "button";
	/* A CROSS, not the dashboard's arrow (2026-09-27, StudySmarter reference):
	   the quiz is CLOSED, not climbed out of by one page. */
	retour.setAttribute("aria-label", t("app.quiz.close"));
	currentHost().ui.setIcon(retour, "x");
	/* Quitting is always allowed and always saves: the engine's destruction
	   (the teardown below) writes the session snapshot, with the time left on a
	   timed test. No "Leave the exam?" question any more (spec
	   2026-09-29-test-setup-modal-design.md §3). */
	/* An open "Set up your test" modal takes the back button first: it closes
	   the modal (a cancel) and nothing else. On a launch, `openQuizPage` then
	   resolves as cancelled and `main.ts` puts the previous screen back; on a
	   "Try again", the player stays on the results. */
	let setupPage: TestSetupPage | null = null;
	const quitter = (): void => {
		if (setupPage?.modalOpen()) setupPage.cancelModal();
		else onBack();
	};
	retour.addEventListener("click", quitter);
	/* The mouse's "back" button does the same as the arrow (2026-09-25).
	   Consumed on press, in the capture phase; the action fires on release.
	   "Forward" is consumed with no effect: there is nothing after a quiz being
	   played. */
	const surBoutonSouris = (e: MouseEvent): void => {
		if (e.button !== 3 && e.button !== 4) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.type === "mouseup" && e.button === 3) quitter();
	};
	document.addEventListener("mousedown", surBoutonSouris, true);
	document.addEventListener("mouseup", surBoutonSouris, true);

	const titrage = ajouter(entete, "div", "qbd-qz-headline");
	// `title` et non `basename` : c'est le champ que `QuizIndexEntry` prévoit
	// pour l'affichage (les deux sont égaux aujourd'hui, pas forcément demain).
	/* The MODE as a pill before the title (2026-09-28), the same pill as on
	   the quiz cards (quiz-card.ts): it replaced a "Learn: " prefix. The
	   note's path shown on hover above the title is gone too: it said
	   nothing a player needs. */
	const mode = ajouter(titrage, "span", "qbd-qz-mode");
	currentHost().ui.setIcon(ajouter(mode, "span", "qbd-qz-mode-icon"), quizModeIcon(entry.mode));
	ajouter(mode, "span", undefined, quizModeLabel(entry.mode));
	ajouter(titrage, "h2", "qbd-qz-title", entry.title);

	/* The container given to the engine, and THAT ALONE: the engine sets
	   `__quizDestroy` on it, and the teardown must aim at it. The plugin does
	   exactly the same (`el.createDiv({ cls: "quiz-blocks-host" })` in the block
	   processor). */
	const hote = ajouter(contenu, "div", "quiz-blocks-host");

	/** Teardown of a screen that did NOT reach the engine (read error, note
	    without a block): there is no instance to destroy, only the mouse
	    button listeners. */
	const demonterSansMoteur = (): void => {
		document.removeEventListener("mousedown", surBoutonSouris, true);
		document.removeEventListener("mouseup", surBoutonSouris, true);
	};
	const withoutEngine = (): QuizPageHandle => ({ teardown: demonterSansMoteur, launchCancelled: false });

	let source: string;
	try {
		source = await currentHost().fs.read(entry.path);
	} catch (e) {
		// The message names the FILE and the CAUSE: a catch that swallows the cause
		// makes a failure (permission, disk, lost native scope) undiagnosable.
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return withoutEngine();
	}

	const bloc = source.match(QUIZ_BLOCK_RE);
	if (!bloc) {
		// A `dashboard` key, borrowed: it is the message the dashboard already
		// gives for a note without a block. (`app.list.empty` speaks of the
		// FOLDER, it would lie here.)
		hote.textContent = t("dashboard.detail.noBlockInNote");
		return withoutEngine();
	}

	try {
		/* `parseQuizSource` THROWS on invalid JSON5 — hence the try: a half-written
		   block must say why, not leave an empty screen. */
		const quiz = parseQuizSource(bloc[1]);
		/* The app's side of "Set up your test": the modal, the settings last used
		   for this quiz, and "Keep exam mode" written into the note. A Learn
		   never asks (the engine skips it) and cannot hold Keep exam mode. */
		const { quizMode, examOptions } = extractExamOptions(quiz);
		setupPage = createTestSetupPage({
			path: entry.path,
			title: entry.title,
			block: bloc[1],
			kept: quizMode === "exam",
			minutes: examOptions?.durationMinutes ?? null,
			canKeep: quizMode !== "lesson",
			remembered: await testSetups(),
		});
		await renderInteractiveQuiz({
			container: hote,
			quiz,
			/* `sourcePath` is `entry.path`, the path RELATIVE to the folder's root.
			   It is the key the review journal uses, and it must be IDENTICAL to
			   the one Obsidian writes for the same note. An absolute path would
			   seem to work just the same (`C:/obsidian-vaults/Efrei/Cours/ch1.md::q1`
			   instead of `Cours/ch1.md::q1`): the two hosts would stop sharing
			   their history, and nobody would see it before the second slice. */
			sourcePath: entry.path,
			/* The JOURNAL. `keyOf(sourcePath, id)` composes a key of the CONTRACT
			   (prefixed by the root when there are several); the adapter brings it
			   back to its LOCAL form before writing it, so that the plugin reads
			   exactly the same key on the same folder. The engine knows none of
			   that: it only knows the SHAPE of the sink.
			   `statsSink` AND `reviewSink`: two sinks, two questions — the journal
			   answers "which questions are due today", the stats "where am I on
			   this quiz" (scheduler spec §9.1, "two distinct systems, not to be
			   merged"). */
			statsSink,
			reviewSink,
			sessionSink: sessions?.puits(entry.path),
			testSetup: setupPage.host,
		});
	} catch (e) {
		hote.replaceChildren();
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return withoutEngine();
	}

	/* A launch cancelled in the setup modal: the engine rendered nothing and
	   destroyed itself. The page was never shown (its screen is still hidden
	   while loading, `main.ts`), so it leaves `root` now and `main.ts` puts the
	   previous screen back without playing any transition. */
	if (setupPage?.launchCancelled()) {
		contenu.remove();
		return { teardown: demonterSansMoteur, launchCancelled: true };
	}

	/* The life cycle is carried by `__quizDestroy`, which the engine sets on the
	   container it was given (declared in `src/global.d.ts`). Calling it here is
	   the EXACT equivalent of the `MarkdownRenderChild`'s `onunload` on the
	   plugin side: without it, every quiz opened leaves its `document`/`window`
	   listeners, its `ResizeObserver`s and its timers. Ten round trips to the
	   list = ten live instances all reacting to the window being resized.

	   Idempotent (`fait`) and tolerant: a teardown called twice, or after a
	   destruction the engine already did, must not break navigation. */
	/* The strip of pearls (compact mode and magnifier, `ui/perles.ts`):
	   unplugged before the engine is destroyed, which empties the container it
	   watches. */
	const debrancherPerles = brancherPerles(hote);
	/* The two bars that stay in place while a question scrolls (`ui/quiz-bars.ts`). */
	const detachBars = attachQuizBars(hote);
	let fait = false;
	return {
		launchCancelled: false,
		teardown: () => {
			if (fait) return;
			fait = true;
			/* A "Try again" modal still open when the page is left: closed first,
			   so that its promise settles (the engine treats it as a cancel) and no
			   modal outlives the page. */
			setupPage?.cancelModal();
			debrancherPerles();
			detachBars();
			document.removeEventListener("mousedown", surBoutonSouris, true);
			document.removeEventListener("mouseup", surBoutonSouris, true);
			try {
				hote.__quizDestroy?.();
			} catch (e) {
				// Already destroyed, or half destroyed: nothing to save, and the next
				// screen must show all the same.
				// The prefix comes from `branding.ts`, never copied — and a log is
				// not translated (it speaks to the developer, not to the learner).
				console.warn(LOG_PREFIX + " incomplete quiz destruction", e);
			}
			// AFTER the engine's destruction: it already called `enregistrer` on the
			// sink (exit save); `vider()` writes at once instead of waiting for the
			// 400 ms guard delay.
			void sessions?.vider();
		},
	};
}
