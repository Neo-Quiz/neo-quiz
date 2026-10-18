/**
 * Bug report format shared by the app (main process) and the relay Worker, so
 * both validate identically. Pure: strings and regexes only, no DOM, no Node,
 * no host import.
 */

export const LIMITS = { what: 4000, text: 2000, log: 8000, body: 16384, title: 80, logLines: 200, logLine: 500 } as const;

export interface BugReportEnv { app: string; os: string; platform: "windows" | "android" }
export interface BugReport {
	v: 1;
	title?: string;
	what: string;
	steps?: string;
	expected?: string;
	env?: BugReportEnv;
	log?: string;
	githubToken?: string;
}
export type Validation = { ok: true; report: BugReport } | { ok: false; code: "invalid"; reason: string };

const KEYS = new Set(["v", "title", "what", "steps", "expected", "env", "log", "githubToken"]);
const ENV_KEYS = new Set(["app", "os", "platform"]);
const ENV_MAX = 100;
const TOKEN_MAX = 255;
// Everything below U+0020 except \t and \n, plus DEL.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

const bad = (reason: string): Validation => ({ ok: false, code: "invalid", reason });
const clean = (s: string): string => s.replace(CONTROL, "");

export function validateReport(raw: unknown): Validation {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("not an object");
	let size: number;
	try { size = JSON.stringify(raw).length; } catch { return bad("not serialisable"); }
	if (size > LIMITS.body) return bad("body too large");
	const o = raw as Record<string, unknown>;
	for (const k of Object.keys(o)) if (!KEYS.has(k)) return bad("unknown field " + k);
	if (o.v !== 1) return bad("unsupported version");

	const text = (key: string, max: number, required = false): string | undefined | null => {
		const val = o[key];
		if (val === undefined) return required ? null : undefined;
		if (typeof val !== "string") return null;
		const s = clean(val);
		if (s.length > max) return null;
		if (required && s.trim() === "") return null;
		return s;
	};
	const what = text("what", LIMITS.what, true);
	if (what == null) return bad("what");
	const report: BugReport = { v: 1, what };
	for (const [key, max] of [["title", LIMITS.title], ["steps", LIMITS.text], ["expected", LIMITS.text], ["log", LIMITS.log], ["githubToken", TOKEN_MAX]] as const) {
		const s = text(key, max);
		if (s === null) return bad(key);
		if (s !== undefined) (report as unknown as Record<string, string>)[key] = s;
	}
	if (o.env !== undefined) {
		const e = o.env;
		if (typeof e !== "object" || e === null || Array.isArray(e)) return bad("env");
		const ev = e as Record<string, unknown>;
		for (const k of Object.keys(ev)) if (!ENV_KEYS.has(k)) return bad("unknown env field " + k);
		if (typeof ev.app !== "string" || typeof ev.os !== "string") return bad("env");
		if (ev.platform !== "windows" && ev.platform !== "android") return bad("env");
		const app = clean(ev.app), os = clean(ev.os);
		if (app.length > ENV_MAX || os.length > ENV_MAX) return bad("env");
		report.env = { app, os, platform: ev.platform };
	}
	return { ok: true, report };
}

/** Defuse mentions and HTML in text a stranger wrote. */
export function neutralise(text: string): string {
	return text.replace(/@/g, "@​").replace(/</g, "&lt;");
}

export function buildIssue(report: BugReport, opts?: { reportedBy?: string }): { title: string; body: string } {
	const firstLine = report.what.split("\n").map(l => l.trim()).find(l => l !== "") ?? "";
	const title = neutralise((report.title?.trim() || firstLine).slice(0, LIMITS.title)) || "Bug report";

	const parts: string[] = [];
	if (opts?.reportedBy && /^[A-Za-z0-9-]{1,39}$/.test(opts.reportedBy)) parts.push("Reported by @" + opts.reportedBy);
	parts.push(neutralise(report.what));
	if (report.steps?.trim()) parts.push("### Steps to reproduce\n\n" + neutralise(report.steps));
	if (report.expected?.trim()) parts.push("### Expected\n\n" + neutralise(report.expected));
	if (report.env) {
		parts.push("### Environment\n\n- App: " + neutralise(report.env.app) + "\n- OS: " + neutralise(report.env.os) + "\n- Platform: " + report.env.platform);
	}
	if (report.log?.trim()) {
		const log = neutralise(report.log);
		const longest = Math.max(0, ...(log.match(/`+/g) ?? []).map(m => m.length));
		const fence = "`".repeat(Math.max(3, longest + 1));
		parts.push("<details><summary>Log</summary>\n\n" + fence + "\n" + log + "\n" + fence + "\n\n</details>");
	}
	parts.push("_Sent from the Neo Quiz app._");
	return { title, body: parts.join("\n\n") };
}

const RULES: Array<[RegExp, string]> = [
	// Home paths first, so later rules never see a user name.
	[/[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>|:]+/gi, "%USERPROFILE%"],
	[/\\\\[^\\\s]+\\[^\\\s]+\\[^\\\s]+/g, "%USERPROFILE%"],
	[/(?<![\w.])\/(?:Users|home)\/[^/\s"'<>|:]+/g, "%USERPROFILE%"],
	// Syncthing device ID: keep the first block only.
	[/\b([A-Z2-7]{7})(?:-[A-Z2-7]{7}){7}\b/g, "$1"],
	[/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "<email>"],
	[/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "<redacted>"],
	[/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "<redacted>"],
	[/\bBearer\s+\S+/gi, "Bearer <redacted>"],
	[/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<redacted>"],
	[/\b\w*(token|key|password)=[^&\s]+/gi, "$1=<redacted>"],
	[/\b[0-9a-fA-F]{32}\b/g, "<redacted>"],
	[/[A-Za-z0-9_-]{32,}/g, "<redacted>"],
];

export function scrubLog(text: string): string {
	let s = text;
	for (const [re, to] of RULES) s = s.replace(re, to);
	const lines = s.split(/\r?\n/).slice(-LIMITS.logLines).map(l => l.slice(0, LIMITS.logLine));
	s = lines.join("\n");
	return s.length > LIMITS.log ? s.slice(-LIMITS.log) : s;
}
