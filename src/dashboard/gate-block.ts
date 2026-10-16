/* WHY AN AUTOMATIC LINE WAITS (spec 2026-10-15-moodle-auto-learn): the
   reason its gate gave, kept on the paused line and read back after a reload.
   Imports NOTHING on purpose: the queue's pure core (`file-generation.ts`)
   reads it back, and an import here (the gate's `usage-format.ts` pulls the
   i18n dictionaries) would drag into the core what it must not know.
   `check:file-generation` holds that this file stays import-free. */

export type GateBlock = { kind: "session" | "weekly"; percent: number } | { kind: "daily"; count: number } | { kind: "unknown" } | { kind: "untrusted" } | { kind: "off" };

/** Reads back a stored block (a paused line); anything malformed is dropped. */
export function readGateBlock(v: unknown): GateBlock | undefined {
	if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
	const o = v as Record<string, unknown>;
	const n = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
	if ((o.kind === "session" || o.kind === "weekly") && n(o.percent)) return { kind: o.kind, percent: o.percent };
	if (o.kind === "daily" && n(o.count)) return { kind: "daily", count: o.count };
	if (o.kind === "unknown" || o.kind === "untrusted" || o.kind === "off") return { kind: o.kind };
	return undefined;
}
