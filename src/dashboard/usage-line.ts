import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { usageLevel, usageResetText, usageShortLabel, usageStatusRows } from "./usage-format";
import type { UsageRead } from "./usage-format";

/* ══════════════════════════════════════════════════════════
   THE PLAN STATUS LINE under the composer: one small text block per window
   ("5h ━━━ 40 % (56 min)"), always visible, no click.

   Reading: when the page opens, when a generation or reply ends (`refresh`),
   then every 5 minutes while the page is visible. The remaining time is
   recomputed every minute from the last reading, without reading again. No
   timer runs while the document is hidden (a CSS-free timer, but a hidden page
   has nobody to show it to). A failed reading keeps the last numbers; with
   none at all the line stays empty.
══════════════════════════════════════════════════════════ */

const RELOAD_MS = 5 * 60000;
const REDRAW_MS = 60000;
/** The usage endpoint rate-limits reads: never read twice within this delay. */
const MIN_GAP_MS = 20000;

export type UsageTool = "claude" | "codex";

interface Reading { rows: UsageRead["rows"]; at: number }
/** Last good reading per tool, shared by every mount (the page redraws often). */
const cache = new Map<UsageTool, Reading>();
const enVol = new Map<UsageTool, Promise<void>>();
/** Redraws of every live mount: a reading started by a mount the page has since
    replaced must still paint the one that replaced it. */
const redraws = new Set<() => void>();

export interface UsageLine {
	/** Reads again (throttled): call when a generation or a reply ends. */
	refresh(): void;
	destroy(): void;
}

export function mountUsageLine(parent: HTMLElement, tool: UsageTool, read: (tool: UsageTool) => Promise<UsageRead>): UsageLine {
	const el = ajouter(parent, "div", "qbd-ai-usage-line");
	el.setAttribute("role", "group");
	el.setAttribute("aria-label", t("ai.usage.lineLabel"));
	let timer: ReturnType<typeof setInterval> | null = null;
	let dead = false;

	const draw = (): void => {
		el.replaceChildren();
		const cur = cache.get(tool);
		const rows = cur ? usageStatusRows(cur.rows) : [];
		el.hidden = rows.length === 0;
		const now = Date.now();
		for (const row of rows) {
			const pct = Math.max(0, Math.min(100, Math.round(row.usedPercent)));
			const win = ajouter(el, "span", "qbd-ai-usage-win");
			ajouter(win, "span", "qbd-ai-usage-name", usageShortLabel(row));
			const bar = ajouter(win, "span", "qbd-ai-usage-bar");
			bar.dataset.level = usageLevel(row.usedPercent);
			const fill = ajouter(bar, "span", "qbd-ai-usage-fill");
			fill.style.width = pct + "%";
			ajouter(win, "span", "qbd-ai-usage-pct", t("ai.usage.linePercent", { n: pct }));
			const reset = usageResetText(row.resetsAt, now, currentLang());
			if (reset) ajouter(win, "span", "qbd-ai-usage-reset", "(" + reset + ")");
		}
	};

	const load = (force: boolean): void => {
		const cur = cache.get(tool);
		const age = cur ? Date.now() - cur.at : Infinity;
		if (dead || enVol.has(tool) || age < (force ? MIN_GAP_MS : RELOAD_MS)) return;
		const p = read(tool).then(r => {
			if (!r.error && r.rows.length) cache.set(tool, { rows: r.rows, at: Date.now() });
		}).catch(() => { /* keep the last numbers */ }).finally(() => {
			enVol.delete(tool);
			redraws.forEach(f => f());
		});
		enVol.set(tool, p);
	};

	const tick = (): void => {
		if (!el.isConnected) { destroy(); return; }
		draw();
		load(false);
	};
	const sync = (): void => {
		if (dead) return;
		if (!el.isConnected) { destroy(); return; }
		if (document.visibilityState === "visible") {
			if (!timer) timer = setInterval(tick, REDRAW_MS);
			draw();
			load(false);
		} else if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};
	function destroy(): void {
		dead = true;
		redraws.delete(draw);
		if (timer) clearInterval(timer);
		timer = null;
		document.removeEventListener("visibilitychange", sync);
		el.remove();
	}
	document.addEventListener("visibilitychange", sync);
	redraws.add(draw);
	draw();
	if (document.visibilityState === "visible") {
		timer = setInterval(tick, REDRAW_MS);
		load(false);
	}
	return { refresh: () => load(true), destroy };
}
