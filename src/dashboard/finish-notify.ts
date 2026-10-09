/* ══════════════════════════════════════════════════════════
   WHEN TO TELL THE USER THAT SOMETHING FINISHED (PURE)

   A quiz that is ready, or an explanation that came back, while the window is
   not the one in front of the user: a native notification and a soft sound.
   Both are cut by one switch ("Silent mode"). The decision is here so that a
   check can play every case; the sound and the notification are the callers'.
   No DOM, no host, no clock: `now` is always an input.
══════════════════════════════════════════════════════════ */

import type { LigneGeneration } from "./file-generation-app";

/** The main process refuses more than this per hour and spaces two by this much (`electron/notification.ts`): asking beyond it would play a sound for a notification that never shows. */
export const NOTIFY_MAX_PER_HOUR = 30;
export const NOTIFY_MIN_GAP_MS = 2_000;
const HOUR_MS = 3_600_000;

export type NotifyVerdict = { notify: true } | { notify: false; reason: "silence" | "foreground" | "limit" };

export function decideNotify(i: { silence: boolean; foreground: boolean; recent: readonly number[]; now: number }): NotifyVerdict {
	if (i.silence) return { notify: false, reason: "silence" };
	if (i.foreground) return { notify: false, reason: "foreground" };
	const lately = i.recent.filter(at => i.now - at < HOUR_MS);
	const last = lately.length ? Math.max(...lately) : -Infinity;
	if (lately.length >= NOTIFY_MAX_PER_HOUR || i.now - last < NOTIFY_MIN_GAP_MS) return { notify: false, reason: "limit" };
	return { notify: true };
}

/** The send times still inside the hour, plus this one. */
export function remember(recent: readonly number[], now: number): number[] {
	return [...recent.filter(at => now - at < HOUR_MS), now];
}

/** What a line that just became ready announces: a quiz by its title, an answer in prose by a plain line. */
export type ReadyKind = { kind: "quiz"; title: string } | { kind: "text" };

export function readyKind(l: Pick<LigneGeneration, "resultat">): ReadyKind {
	const r = l.resultat;
	if (r?.texte) return { kind: "text" };
	return { kind: "quiz", title: (r?.titre ?? "").trim() };
}

/** The lines that became ready since `seen` (their ids are then added to it). A line already ready when first seen is in `seen` from the start: a restored queue announces nothing. */
export function newlyReady(seen: Set<number>, lines: readonly LigneGeneration[]): LigneGeneration[] {
	const out: LigneGeneration[] = [];
	for (const l of lines) {
		if (l.etat !== "prete" || seen.has(l.id)) continue;
		seen.add(l.id);
		out.push(l);
	}
	return out;
}
