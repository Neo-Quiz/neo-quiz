/* THE SAFETY NET (pure). Before an update is installed, the main process
   writes the version it expects (`majAttendue`, `main.ts`). At the next start:
   still an older version means the update did not finish, and the logo menu
   says so with "Try again" instead of the old version running silently (the
   2026-10-10 loop: 1.20.69 binaries around 1.20.63 code); the expected
   version or newer means it landed and the key is cleared. Tested by
   `npm run check:updater`. */

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0 or 1; anything that is not `X.Y.Z` compares as equal. */
export function compareVersions(a: string, b: string): number {
	const x = VERSION.exec(a), y = VERSION.exec(b);
	if (!x || !y) return 0;
	for (let i = 1; i <= 3; i++) {
		const d = Number(x[i]) - Number(y[i]);
		if (d !== 0) return d > 0 ? 1 : -1;
	}
	return 0;
}

export function expectedUpdateOutcome(expected: unknown, running: string): "none" | "unfinished" | "landed" {
	if (typeof expected !== "string" || !VERSION.test(expected)) return "none";
	return compareVersions(running, expected) < 0 ? "unfinished" : "landed";
}
