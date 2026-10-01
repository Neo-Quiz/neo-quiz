import { LOG_PREFIX } from "../../../../src/branding";
import { readTestSetup, type TestSetup } from "../../../../src/test-setup";
import { ecrireReglage, lireReglage } from "../host/folder";
import { renommerCles } from "./folder-move";

/* ══════════════════════════════════════════════════════════
   THE SETTINGS LAST USED PER QUIZ (spec 2026-09-29-test-setup-modal-design.md
   §1): "Set up your test" opens on what this quiz was last played with.

   One key of the app's settings, `testSetups`, a map from the quiz's path to
   its `TestSetup`. Read once, kept in memory; every value goes back through
   `readTestSetup`, so a corrupt or hand-edited entry is ignored (the modal
   then opens on the file's default) and never reaches the engine.

   Not shared with the Obsidian plugin (like the session snapshots,
   `sessions.ts`): the plugin asks nothing at launch.
══════════════════════════════════════════════════════════ */

const KEY = "testSetups";

export interface TestSetupsApp {
	/** What this quiz was last played with, or `null` (never, or unreadable). */
	read(path: string): TestSetup | null;
	/** Remembers the setup this quiz is being played with. */
	remember(path: string, setup: TestSetup): void;
	/** A quiz (or a folder, by prefix) moved: its remembered setup follows it. */
	renamed(from: string, to: string): void;
}

let loading: Promise<TestSetupsApp> | null = null;

/** The store, loaded on first use: a quiz page needs it only when a Test starts. */
export function testSetups(): Promise<TestSetupsApp> {
	loading ??= (async () => {
		let cache: Record<string, unknown> = {};
		try {
			const raw = await lireReglage<Record<string, unknown>>(KEY);
			if (raw && typeof raw === "object" && !Array.isArray(raw)) cache = { ...raw };
		} catch (e) {
			// Unreadable settings: nothing remembered, but the test still starts.
			console.warn(LOG_PREFIX, "test setups unreadable:", e);
		}
		/* Writes go one after the other, each with the whole map as it stands
		   when its turn comes: two launches in quick succession never write
		   an older map over a newer one. */
		let queue: Promise<void> = Promise.resolve();
		return {
			read: (path) => readTestSetup(cache[path]),
			remember: (path, setup) => {
				cache[path] = { hints: setup.hints, timeLimitMinutes: setup.timeLimitMinutes };
				queue = queue.then(() => ecrireReglage(KEY, cache)).catch((e) => console.warn(LOG_PREFIX, "test setups not written:", e));
			},
			renamed: (from, to) => {
				if (!renommerCles(cache, from, to)) return;
				queue = queue.then(() => ecrireReglage(KEY, cache)).catch((e) => console.warn(LOG_PREFIX, "test setups not written:", e));
			},
		};
	})();
	return loading;
}
