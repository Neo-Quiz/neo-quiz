/* The pure core of the Moodle sync: no network, no disk. Ported from the
   owner's Obsidian plugin "moodle-sync" (engine.js). `root` (the configured
   site) is always a parameter, never a constant. */

import * as crypto from "node:crypto";
import * as path from "node:path";
import { MoodleError } from "./erreurs";
import { decodeEntities, sanitize, safeSegment } from "./noms";

export interface RawCourse { id: number | string; shortname?: string; fullname?: string; displayname?: string; enddate?: number }
export interface Course { id: number; name: string; code: string | null; yearKey: string | null; cohort: string | null; /** Epoch seconds, 0 = none. */ enddate: number }

/** "XTI302-CYB-2627PSA01" or "XCS-413-2627PSA01" -> code, year, cohort. */
export function parseCourse(raw: RawCourse): Course {
	const short = String(raw.shortname || "");
	const name = decodeEntities(raw.fullname || raw.displayname || short)
		.replace(/^\s*\*\s*/, "")
		// The list of groups in parentheses tells nothing here.
		.replace(/\s*\((?:[A-Z0-9-]+\s*,\s*)*[A-Z0-9-]+(?:,\s*\.\.\.)?\)\s*$/, "")
		.trim();
	const code = short.match(/^([A-Z]{2,5})-?(\d{3})(?!\d)/);
	const year = short.match(/-(\d{2})(\d{2})[PB]/);
	const cohort = short.match(/-\d{4}([A-Z]{3}\d*)/);
	return {
		id: Number(raw.id),
		name,
		code: code ? code[1] + code[2] : null,
		yearKey: year ? `20${year[1]}-20${year[2]}` : null,
		cohort: cohort ? cohort[1] : null,
		enddate: typeof raw.enddate === "number" && Number.isFinite(raw.enddate) && raw.enddate > 0 ? Math.floor(raw.enddate) : 0,
	};
}

export type FileStatus = "missing" | "present" | "outdated" | "failed" | "busy";
export interface MoodleFile {
	url: string;
	name: string;
	size: number | null;
	timemodified: number;
	status: FileStatus;
	localName?: string;
}
export interface Deposit {
	due: number;
	cutoff: number;
	status: string;
	submittedAt: number;
	files: { name: string; size: number | null }[];
	extension?: number;
}
export interface Activity { id: number; name: string; type: string; files: MoodleFile[]; external: string[]; deposit?: Deposit }
export interface Section { name: string; activities: Activity[] }
export interface Scan { sections: Section[]; external: string[] }

/* The Moodle API answers are untyped JSON: `any` is deliberate below. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A Moodle date (seconds): finite and not negative, never later than now + 1 day. */
export function cleanDate(v: unknown, now = Date.now()): number {
	if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
	return Math.min(Math.floor(v), Math.floor(now / 1000) + 86400);
}

interface RawContent { type?: string; filename?: string; filesize?: number; fileurl?: string; timemodified?: number }
function toFile(c: RawContent): MoodleFile {
	return {
		url: String(c.fileurl),
		// One safe path segment: a name from the server can never carry `..` or a separator.
		name: safeSegment(String(c.filename ?? "")),
		// Server values are untrusted: a bad size means "unknown", a date is clamped to tomorrow.
		size: typeof c.filesize === "number" && Number.isSafeInteger(c.filesize) && c.filesize >= 0 ? c.filesize : null,
		timemodified: cleanDate(c.timemodified),
		status: "missing",
	};
}

export interface Submission { status: string; submittedAt: number; extension: number; files: { name: string; size: number | null }[] }
/** `mod_assign_get_submission_status` -> what the user handed in. The files are
    display-only: they are never downloaded. */
export function parseSubmission(st: any): Submission {
	const last = (st && st.lastattempt) || {};
	const sub = last.submission || last.teamsubmission || {};
	const files = ((sub.plugins || []) as any[])
		.flatMap(p => ((p.fileareas || []) as any[]).flatMap(fa => (fa.files || []) as any[]))
		.map(c => ({ name: sanitize(c.filename), size: (c.filesize ?? null) as number | null }));
	return { status: sub.status || "new", submittedAt: sub.timemodified || 0, extension: last.extensionduedate || 0, files };
}

const URGENT_MS = 8 * 3600 * 1000;
export type DepositKind = "submitted" | "todo" | "urgent" | "late" | "closed" | "open";

/** State of a deposit at `now` (ms); Moodle dates are in seconds. A draft is
    not submitted: it counts as not handed in. */
export function depositState(
	dep: { status: string; due: number; cutoff?: number; extension?: number },
	now = Date.now(),
): { state: DepositKind; due: number; remaining: number } {
	if (dep.status === "submitted") return { state: "submitted", due: dep.due, remaining: 0 };
	const due = dep.extension || dep.due;
	if (!due) return { state: "open", due: 0, remaining: 0 };
	const remaining = due * 1000 - now;
	if (remaining > 0) return { state: remaining <= URGENT_MS ? "urgent" : "todo", due, remaining };
	if (dep.cutoff && dep.cutoff * 1000 <= now) return { state: "closed", due, remaining };
	return { state: "late", due, remaining };
}

/** API answers -> sections -> activities -> files, in the course page's order. */
export function flattenContents(sections: any[], assignments: any[] = [], deposits = new Map<number, Submission>()): Section[] {
	const byCmid = new Map<number, any>(assignments.map(a => [a.cmid, a]));
	const out: Section[] = [];
	for (const s of sections || []) {
		const activities: Activity[] = [];
		for (const m of (s.modules || []) as any[]) {
			// Invisible to the user, or a mere layout label.
			if (m.uservisible === false || m.modname === "label") continue;
			const files: MoodleFile[] = [];
			const external: string[] = [];
			for (const c of (m.contents || []) as RawContent[]) {
				if (c.type === "url") {
					if (c.fileurl) external.push(c.fileurl);
					continue;
				}
				if (c.type !== "file" || !c.fileurl) continue;
				// A page's or book's text arrives as index.html: not a document.
				if ((m.modname === "page" || m.modname === "book") && c.filename === "index.html") continue;
				files.push(toFile(c));
			}
			const assign = byCmid.get(m.id);
			// The statement attached to an assignment downloads like any course material.
			for (const f of (assign && assign.introattachments) || []) files.push(toFile(f));
			files.sort((a, b) => a.name.localeCompare(b.name, "fr"));
			const act: Activity = { id: m.id, name: decodeEntities(m.name), type: m.modname, files, external };
			// An assignment without online submission has nothing to hand in: no state.
			if (assign && !assign.nosubmissions) {
				const d = deposits.get(m.id) || parseSubmission(null);
				act.deposit = { due: assign.duedate || 0, cutoff: assign.cutoffdate || 0, status: d.status, submittedAt: d.submittedAt, files: d.files };
				if (d.extension) act.deposit.extension = d.extension;
			}
			activities.push(act);
		}
		if (activities.length) out.push({ name: decodeEntities(s.name).trim() || "Untitled", activities });
	}
	return out;
}

/** The same final name in two activities: one file on disk (case ignored, like
    NTFS), the most recent wins. */
export function dedupe<T extends { activities: { files: { name: string; timemodified: number }[] }[] }>(sections: T[]): T[] {
	const best = new Map<string, { name: string; timemodified: number }>();
	for (const s of sections) for (const a of s.activities) for (const f of a.files) {
		const key = f.name.toLowerCase();
		const cur = best.get(key);
		if (!cur || f.timemodified > cur.timemodified) best.set(key, f);
	}
	for (const s of sections) for (const a of s.activities) a.files = a.files.filter(f => best.get(f.name.toLowerCase()) === f);
	return sections;
}

export function allFiles(scan: { sections: Section[] }): MoodleFile[] {
	return scan.sections.flatMap(s => s.activities.flatMap(a => a.files));
}

export interface PendingDeposit { id: number; name: string; state: DepositKind; due: number; remaining: number; fresh: boolean }
/** Assignments still to hand in, most urgent first: not submitted, not closed,
    not ignored. `fresh`: appeared since the last visit. */
export function pendingDeposits(
	scan: { sections: Section[] },
	{ now = Date.now(), seen = new Set<number>(), ignored = new Set<number>() } = {},
): PendingDeposit[] {
	const out: PendingDeposit[] = [];
	for (const s of scan.sections) for (const a of s.activities) {
		if (!a.deposit || ignored.has(a.id)) continue;
		const st = depositState(a.deposit, now);
		if (st.state === "submitted" || st.state === "closed") continue;
		out.push({ id: a.id, name: a.name, state: st.state, due: st.due, remaining: st.remaining, fresh: !seen.has(a.id) });
	}
	return out.sort(compareDeposits);
}

/** Late first (oldest first), then what can still be handed in on time. */
export function compareDeposits(x: { state: DepositKind; due: number }, y: { state: DepositKind; due: number }): number {
	const RANK: Record<string, number> = { late: 0, urgent: 1, todo: 2, open: 3 };
	return RANK[x.state] - RANK[y.state] || (x.due || Infinity) - (y.due || Infinity);
}

export function formatRemaining(ms: number): string {
	const min = Math.floor(ms / 60000);
	if (min < 1) return "less than a minute";
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
	return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const PENDING = new Set<FileStatus>(["missing", "outdated", "failed"]);
export const pending = (scan: { sections: Section[] }): MoodleFile[] => allFiles(scan).filter(f => PENDING.has(f.status));

export function summarize(scan: { sections: Section[] }): { missing: number; outdated: number } {
	let missing = 0;
	let outdated = 0;
	for (const f of allFiles(scan)) {
		if (f.status === "missing" || f.status === "failed") missing++;
		else if (f.status === "outdated") outdated++;
	}
	return { missing, outdated };
}

/** Two cohorts can drop the same name in the same folder: one download per
    path (case ignored), the most recent. */
export function uniqueJobs<T extends { dir: string; target?: string; file: { name: string; timemodified: number } }>(jobs: T[]): T[] {
	const best = new Map<string, T>();
	for (const j of jobs) {
		const key = path.join(j.dir, j.target ?? j.file.name).toLowerCase();
		const cur = best.get(key);
		if (!cur || j.file.timemodified > cur.file.timemodified) best.set(key, j);
	}
	return [...best.values()];
}

/** Per-run budget of an automatic download: no more than this many files or bytes. */
export const RUN_MAX_FILES = 500;
export const RUN_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** The jobs that fit the budget, in order, and how many were left for the next
    run. A file of unknown size counts as `unknownBytes` (the per-file cap). */
export function withinBudget<T extends { file: { size: number | null } }>(
	jobs: T[], unknownBytes: number, maxFiles = RUN_MAX_FILES, maxBytes = RUN_MAX_BYTES,
): { kept: T[]; left: number } {
	const kept: T[] = [];
	let bytes = 0;
	for (const j of jobs) {
		const n = j.file.size ?? unknownBytes;
		if (kept.length >= maxFiles || bytes + n > maxBytes) continue;
		kept.push(j);
		bytes += n;
	}
	return { kept, left: jobs.length - kept.length };
}

export function launchUrl(root: string, passport: string, scheme: string): string {
	return `${root}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${encodeURIComponent(passport)}`
		+ `&urlscheme=${encodeURIComponent(scheme)}`;
}

/** launch.php's answer: base64("md5(wwwroot + passport):::token[:::privatetoken]").
    The md5 proves it answers OUR request: a forged `neo-quiz://token=` link is
    rejected. The private token is ignored and never kept. */
export function verifyLaunchToken(b64: string, passport: string, root: string): string {
	const parts = Buffer.from(String(b64), "base64").toString("utf8").split(":::");
	const expected = crypto.createHash("md5").update(root + passport).digest("hex");
	if (parts.length < 2 || parts[0] !== expected || !/^[0-9a-f]{32}$/i.test(parts[1])) {
		throw new MoodleError("badlaunch", "Invalid login answer: it does not match this request.");
	}
	return parts[1];
}

/** At most `max` tasks at once; the next ones start as soon as one ends. */
export function limiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
	let active = 0;
	const queue: { fn: () => Promise<unknown>; resolve: (v: any) => void; reject: (e: unknown) => void }[] = [];
	const next = (): void => {
		if (active >= max || !queue.length) return;
		active++;
		const { fn, resolve, reject } = queue.shift()!;
		Promise.resolve().then(fn).then(resolve, reject).finally(() => {
			active--;
			next();
		});
	};
	return <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => {
		queue.push({ fn, resolve, reject });
		next();
	});
}

/** A `neo-quiz://token=<base64>` link among a process's arguments: the raw
    base64 candidate, or null. Never validated here (see `verifyLaunchToken`). */
export function jetonDansArguments(argv: readonly string[]): string | null {
	for (const a of argv) {
		if (typeof a !== "string") continue;
		const m = /^neo-quiz:\/\/token=(.+)$/i.exec(a);
		if (m) return m[1].replace(/\/+$/, "");
	}
	return null;
}

/** What an AUTOMATIC run (app start, hourly, right after sign-in) does:
    `off` when the `auto` setting is off, `metered` when Windows says the
    connection is metered (the run is skipped and recorded: "paused, metered
    connection"), else `run`. A manual download never asks this. PURE. */
export function decisionAuto(auto: boolean, limitee: boolean): "run" | "off" | "metered" {
	if (!auto) return "off";
	return limitee ? "metered" : "run";
}
