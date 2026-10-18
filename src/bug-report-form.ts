/**
 * Pure state helpers of the bug report form (no DOM, host-neutral): the
 * Windows modal and the Android settings row both build their report here.
 */
import { LIMITS } from "./bug-report";
import type { BugReport, BugReportEnv } from "./bug-report";

export interface FormState {
	what: string;
	steps: string;
	expected: string;
	title: string;
	sendEnv: boolean;
	sendLog: boolean;
	env: BugReportEnv | null;
	log: string;
	sending: boolean;
}

/** Send is possible once something is described and no send is running. */
export function canSend(state: Pick<FormState, "what" | "sending">): boolean {
	return state.what.trim() !== "" && !state.sending;
}

/** The first non-empty line of the description, cut to the title limit (never inside a surrogate pair). */
export function defaultTitle(what: string): string {
	const line = what.split(/\r?\n/).map(l => l.trim()).find(l => l !== "") ?? "";
	const chars = Array.from(line);
	return chars.length <= LIMITS.title ? line : chars.slice(0, LIMITS.title).join("").trimEnd();
}

/** The report to hand to the main process: blank optional fields and unticked details are left out; never a token. */
export function reportFromForm(state: FormState): BugReport {
	const report: BugReport = { v: 1, what: state.what.trim() };
	const title = state.title.trim();
	if (title !== "") report.title = title;
	const steps = state.steps.trim();
	if (steps !== "") report.steps = steps;
	const expected = state.expected.trim();
	if (expected !== "") report.expected = expected;
	if (state.sendEnv && state.env) report.env = state.env;
	if (state.sendLog && state.log.trim() !== "") report.log = state.log;
	return report;
}
