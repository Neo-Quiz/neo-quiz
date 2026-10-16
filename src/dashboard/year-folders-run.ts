/* "Organise by school year", the RUN (spec 2026-10-15-year-folders-design §2).
   The plan and the link rewrite are pure (`year-folders.ts`); this module reads
   the root through the host contract and moves each course folder with
   `moveModuleTo`, the app's only safe mover: it carries the review history (a
   rename line, global across devices), stats, exams, sessions, test setups and
   folder settings. Never a review line written here. */

import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { moveModuleTo } from "./quiz-menu";
import { YEAR_FOLDER_RE, planYearFolders, rewriteDashboardLinks, type YearMove, type YearPlan } from "./year-folders";

export const DASHBOARD_NOTE = "Dashboard.md";

/** The plan for the root `rootId`, read from the disk now. */
export async function readYearPlan(ctx: DashboardShellCtx, rootId: string, now: Date): Promise<YearPlan> {
	const host = currentHost();
	const entries = (await host.fs.listDir(rootId)).map(e => ({ name: e.name, isFolder: e.isFolder }));
	const yearChildren: Record<string, string[]> = {};
	for (const e of entries) {
		if (e.isFolder && YEAR_FOLDER_RE.test(e.name)) {
			yearChildren[e.name] = (await host.fs.listDir(host.paths.contractPath(rootId, e.name))).map(c => c.name);
		}
	}
	// The "Generated" folder never moves, whatever its name.
	const sas = ctx.generatedFolder?.();
	const keep = sas && host.paths.rootOf(sas)?.id === rootId && !host.paths.localPath(sas).includes("/")
		? [host.paths.localPath(sas)] : [];
	return planYearFolders({ entries, yearChildren, keep, now });
}

export interface YearRunResult {
	moved: YearMove[];
	/** The course folder (or year folder to create) that failed; the run stopped there. */
	failed: string | null;
	dashboard: "rewritten" | "unchanged" | "absent" | "failed";
}

/** Creates the missing year folders, then moves each course folder ONE AT A
    TIME, awaited; the first failure stops the run (what moved stays moved: each
    move is complete on its own). Then rewrites the links of the MOVED folders
    in `<root>/Dashboard.md`, read fresh. Refuses a plan with collisions. */
export async function runYearFolders(
	ctx: DashboardShellCtx,
	rootId: string,
	plan: YearPlan,
	onProgress: (done: number, total: number) => void = () => {},
): Promise<YearRunResult> {
	const host = currentHost();
	const path = (local: string): string => host.paths.contractPath(rootId, local);
	const moved: YearMove[] = [];
	let failed: string | null = null;
	if (plan.collisions.length > 0) return { moved, failed: plan.collisions[0], dashboard: "unchanged" };
	for (const name of plan.create) {
		try { await host.fs.mkdirs(path(name)); } catch (e) {
			console.error("[quiz-blocks] year folder not created:", name, e);
			return { moved, failed: name, dashboard: "unchanged" };
		}
	}
	for (const m of plan.moves) {
		onProgress(moved.length, plan.moves.length);
		let ok = false;
		try {
			ok = await moveModuleTo(ctx, { folder: m.folder, name: m.folder, ue: null, path: path(m.folder), quizzes: [], total: 0, mastered: 0 }, path(m.yearFolder));
		} catch (e) {
			/* Thrown AFTER the rename (review log, stats, host keys): the folder
			   may have moved. Counted as a failure all the same, the run stops. */
			console.error("[quiz-blocks] year folder move failed:", m.folder, e);
		}
		if (!ok) { failed = m.folder; break; }
		moved.push(m);
	}
	onProgress(moved.length, plan.moves.length);
	return { moved, failed, dashboard: await rewriteDashboard(rootId, moved) };
}

/** Writes the rewritten Dashboard.md once, only when a link changed. */
async function rewriteDashboard(rootId: string, moved: readonly YearMove[]): Promise<YearRunResult["dashboard"]> {
	if (moved.length === 0) return "unchanged";
	const host = currentHost();
	const note = host.paths.contractPath(rootId, DASHBOARD_NOTE);
	try {
		if (!(await host.fs.exists(note))) return "absent";
		const before = await host.fs.read(note);
		if (rewriteDashboardLinks(before, moved) === before) return "unchanged";
		// `process` re-reads it: an edit made since the read above is kept.
		await host.fs.process(note, current => rewriteDashboardLinks(current, moved));
		return "rewritten";
	} catch (e) {
		console.error("[quiz-blocks] Dashboard.md not rewritten:", e);
		return "failed";
	}
}
