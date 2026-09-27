import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import type { Scanner } from "../../../../src/dashboard/scanner";
import { migrateReviewLog } from "../../../../src/review/migration";
import { createReviewStore, parseExamDate, type ReviewStore } from "../../../../src/review/review-store";
import { construireCatalogue } from "./catalogue";
import { examDates } from "../host/folder";

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
		/* PAS D'EXAMEN, PAS DE RÉVISION (2026-09-26) : une question n'entre au
		   plan que si le module de sa note a un examen À VENIR (`examDates()`
		   ne rend que ceux-là). UNE seule porte, et sur le CATALOGUE, pas sur
		   le plan : filtrer `today` APRÈS coup laissait le budget du jour se
		   dépenser sur des modules sans examen, puis les retirait — un jour
		   chargé ailleurs rendait une liste vide ou tronquée pour le module
		   qui a un partiel. Filtré ici, le noyau ne voit que ce qui compte,
		   et `forecast`/`stats` disent la même chose que `today`. Le journal,
		   lui, continue d'être écrit : ajouter un examen fait réapparaître ce
		   que l'historique rend dû. */
		catalogue: () => {
			const avecExamen = examDates();
			return construireCatalogue(scanner.getQuizzes(), host.paths).filter(it => !!avecExamen[it.module]);
		},
		horizons: examDatesEnMs,
		now: () => Date.now(),
	});
	await store.load();
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
