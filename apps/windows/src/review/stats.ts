import { LOG_PREFIX } from "../../../../src/branding";
import { createStatsStore, type StatsStore } from "../../../../src/dashboard/stats-store";
import type { SharedState } from "../host/shared-state";

/* ══════════════════════════════════════════════════════════
   PER-QUIZ STATS, APPLICATION SIDE

   Distinct from the review JOURNAL and not to be merged with it: the journal
   answers "which questions are due today", the stats "where am I on this
   quiz" (scheduler spec, section 9.1: two systems, two questions).

   Since 2026-10-01 they live in the synced folder, one attempts file per
   device and root (`host/shared-state.ts`), not in the app settings: another
   device syncing the same folder sees the attempts. The store keeps working on
   a whole table in memory; each debounced save is turned into add/delete
   events by comparing it with what the store held before. The old `quizStats`
   setting is only read, once, by the migration.
══════════════════════════════════════════════════════════ */

export async function creerStatsApp(state: SharedState): Promise<StatsStore> {
	const stats = createStatsStore({
		getStats: () => state.stats(),
		saveStats: async (data) => {
			try {
				await state.syncStats(data);
			} catch (e) {
				// The in-memory table stays; the next save retries what failed.
				console.warn(LOG_PREFIX, "attempts not saved:", e);
			}
		},
	});
	stats.load();
	return stats;
}
