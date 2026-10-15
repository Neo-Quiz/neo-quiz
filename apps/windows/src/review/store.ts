import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import type { Scanner } from "../../../../src/dashboard/scanner";
import { migrateReviewLog } from "../../../../src/review/migration";
import { createReviewStore, parseExamDate, type ReviewStore } from "../../../../src/review/review-store";
import { construireCatalogue } from "./catalogue";
import { examDates } from "../host/folder";
import { hiddenQuizTest } from "../../../../src/dashboard/folder-hidden";
import { lastModuleMap } from "../../../../src/dashboard/module-map-note";
import type { ModuleOverride } from "../../../../src/dashboard/quiz-modules";

/**
 * The app's review journal: one file per folder, a single plan.
 *
 * MIGRATE FIRST, LOAD AFTER. The other way round would read a new journal
 * still empty, and the "To review" card would say "nothing to review" to
 * someone with a whole term behind them: the worst possible message, because
 * it looks normal.
 */
export async function creerJournalApp(host: Host, scanner: Scanner,
	/** The folder settings as the pages hold them NOW (read at every plan). */
	folderSettings: () => Record<string, ModuleOverride> | undefined = () => undefined,
): Promise<ReviewStore> {
	for (const root of host.paths.roots()) {
		try {
			const res = await migrateReviewLog(host.fs, root.legacyReviewLog, root.reviewLog);
			if (!res.skipped) {
				console.info(LOG_PREFIX, `review log migrated (${root.name}): ${res.absorbed} absorbed, ${res.duplicates} already there, ${res.ignored} unreadable, old one ${res.renamed ? "put away" : "kept"}`);
			}
		} catch (e) {
			/* Startup DOES NOT DEPEND on the migration: at worst the history
			   stays where it was, and the next start tries again. An exception
			   here would leave the window empty. */
			console.warn(LOG_PREFIX, "review log migration failed:", root.name, e);
		}
	}

	const store = createReviewStore({
		fs: host.fs,
		watcher: host.watcher,
		paths: host.paths,
		/* NO EXAM, NO REVIEW (2026-09-26): a question enters the plan only if
		   the module of its note has an UPCOMING exam (`examDates()` returns
		   only those). ONE gate, and on the CATALOGUE, not on the plan:
		   filtering `today` AFTERWARDS let the day's budget be spent on modules
		   without an exam, then removed them; a day busy elsewhere gave an
		   empty or truncated list for the module that has a midterm. Filtered
		   here, the kernel sees only what counts, and `forecast`/`stats` say
		   the same as `today`. The journal keeps being written: adding an exam
		   brings back what the history makes due. */
		/* HIDDEN FOLDER, REVIEWS PAUSED (2026-10-15): the quizzes of a folder
		   hidden from the lists leave the catalogue here, at the same single
		   gate and for the same reason as above. Every reader of the plan
		   (Home, a folder's Review plan, the phone's daily notification table,
		   `calendrier-android.ts`) then agrees, and nothing is written to the
		   journal: showing the folder again gives back the very plan the
		   history derives, overdue questions included. */
		catalogue: () => {
			const avecExamen = examDates();
			const hidden = hiddenQuizTest(folderSettings(), lastModuleMap());
			const quizzes = scanner.getQuizzes().filter(q => !hidden(q.path));
			return construireCatalogue(quizzes, host.paths).filter(it => !!avecExamen[it.module]);
		},
		horizons: examDatesEnMs,
		now: () => Date.now(),
	});
	await store.load();
	return store;
}

/** The entered dates, converted once per plan. `parseExamDate` is SHARED:
    two conversions would diverge, and a misread date moves an exam by a day
    without a word. */
function examDatesEnMs(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const [module, brut] of Object.entries(examDates())) {
		const t = parseExamDate(brut);
		if (t !== null) out[module] = t;
	}
	return out;
}
