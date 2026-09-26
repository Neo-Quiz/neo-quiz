import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import type { Scanner } from "../../../../src/dashboard/scanner";
import { migrateReviewLog } from "../../../../src/review/migration";
import { createReviewStore, parseExamDate, type ReviewStore } from "../../../../src/review/review-store";
import { construireCatalogue, cleModule } from "./catalogue";
import { examDates } from "../host/folder";
import { garderSiExamen } from "./garde-examen";

/**
 * Le journal de l'application : un fichier par dossier, un plan unique.
 *
 * MIGRER D'ABORD, CHARGER ENSUITE. L'inverse lirait un journal neuf encore
 * vide, et la carte « À réviser » annoncerait « rien à réviser » à quelqu'un
 * qui a un semestre derrière lui — le pire message possible, parce qu'il a
 * l'air normal.
 */
export async function creerJournalApp(host: Host, scanner: Scanner): Promise<ReviewStore> {
	for (const root of host.paths.roots()) {
		try {
			const res = await migrateReviewLog(host.fs, root.legacyReviewLog, root.reviewLog);
			if (!res.skipped) {
				console.info(LOG_PREFIX, `journal migré (${root.name}) : ${res.absorbed} absorbée(s), ${res.duplicates} déjà présente(s), ${res.ignored} illisible(s), ancien ${res.renamed ? "rangé" : "conservé"}`);
			}
		} catch (e) {
			/* Le démarrage NE DÉPEND PAS de la migration : au pire l'historique
			   reste à son ancienne place, et on réessaiera au prochain
			   lancement. Une exception ici laisserait la fenêtre vide. */
			console.warn(LOG_PREFIX, "migration du journal impossible:", root.name, e);
		}
	}

	const store = createReviewStore({
		fs: host.fs,
		watcher: host.watcher,
		paths: host.paths,
		catalogue: () => construireCatalogue(scanner.getQuizzes(), host.paths),
		horizons: examDatesEnMs,
		now: () => Date.now(),
	});
	await store.load();
	/* PAS D'EXAMEN, PAS DE RÉVISION (garde-examen.ts) : une seule porte, ici. */
	const planBrut = store.plan.bind(store);
	store.plan = (now: number) => {
		const p = planBrut(now);
		const avec = examDates();
		const aExamen = (chemin: string): boolean => !!avec[cleModule(chemin, host.paths)];
		return { ...p, today: garderSiExamen(p.today, aExamen), deferred: garderSiExamen(p.deferred, aExamen) };
	};
	return store;
}

/** Les dates saisies, converties une fois par plan. `parseExamDate` est
    PARTAGÉE avec le greffon : deux conversions divergeraient, et une date
    mal lue déplace un examen d'un jour sans le dire. */
function examDatesEnMs(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const [module, brut] of Object.entries(examDates())) {
		const t = parseExamDate(brut);
		if (t !== null) out[module] = t;
	}
	return out;
}
