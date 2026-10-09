import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { currentHost } from "../host/current";
import { PROVIDERS, setBrandLogo } from "./ai-providers";
import { cadenceRateLimited, cadenceSuccess, cadenceVerdict, newCadence } from "./usage-cadence";
import type { Cadence } from "./usage-cadence";
import { formatAge, usageWaitText, usageLevel, usageRemainingPercent, usageResetIn, usageResetText, usageShortLabel, usageStatusRows, usageWindowTitle } from "./usage-format";
import type { UsageRead } from "./usage-format";

/* ══════════════════════════════════════════════════════════
   THE PLAN STATUS BLOCK under the composer: one small text row per window
   ("5h ━━━ 40 % (56 min)") and an "Updated 3 min ago" line. Clicking it opens
   a popover (portalled to <body>, above the block or below when short of room)
   with one section per window: title, "% used", bar, "% remaining", reset.

   Reading: when the page opens, when a generation or reply ends (`refresh`),
   then every 5 minutes while the page is visible. The remaining time is
   recomputed every minute from the last reading, without reading again. No
   timer runs while the document is hidden (a CSS-free timer, but a hidden page
   has nobody to show it to). A failed reading keeps the last numbers; with
   none at all the line stays empty. While the popover is open it reads on
   open, then every minute, and its refresh button reads too: always at least
   30 s apart (and silent during a 429 back-off): `usage-cadence.ts`, one
   clock per provider shared by every block.
══════════════════════════════════════════════════════════ */

const RELOAD_MS = 5 * 60000;
const REDRAW_MS = 60000;

export type UsageTool = "claude" | "codex";

interface Reading { rows: UsageRead["rows"]; at: number }
/** Last good reading per tool, shared by every mount (the page redraws often). */
const cache = new Map<UsageTool, Reading>();
/** The read clock per tool, shared like the cache (Generate and Explain blocks). */
const cadences = new Map<UsageTool, Cadence>();
const cadenceOf = (tool: UsageTool): Cadence => {
	let c = cadences.get(tool);
	if (!c) { c = newCadence(); cadences.set(tool, c); }
	return c;
};
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
	el.setAttribute("role", "button");
	el.tabIndex = 0;
	el.setAttribute("aria-haspopup", "dialog");
	el.setAttribute("aria-expanded", "false");
	el.setAttribute("aria-label", t("ai.usage.open"));
	let timer: ReturnType<typeof setInterval> | null = null;
	let dead = false;

	const draw = (): void => {
		el.replaceChildren();
		const cur = cache.get(tool);
		const rows = cur ? usageStatusRows(cur.rows) : [];
		el.hidden = rows.length === 0;
		if (el.hidden) closePop();
		const now = Date.now();
		const grid = ajouter(el, "div", "qbd-ai-usage-grid");
		for (const row of rows) {
			const pct = Math.max(0, Math.min(100, Math.round(row.usedPercent)));
			const win = ajouter(grid, "span", "qbd-ai-usage-win");
			ajouter(win, "span", "qbd-ai-usage-name", usageShortLabel(row));
			const bar = ajouter(win, "span", "qbd-ai-usage-bar");
			bar.dataset.level = usageLevel(row.usedPercent);
			const fill = ajouter(bar, "span", "qbd-ai-usage-fill");
			fill.style.width = pct + "%";
			ajouter(win, "span", "qbd-ai-usage-pct", t("ai.usage.linePercent", { n: pct }));
			const reset = usageResetText(row.resetsAt, now, currentLang());
			// Always a cell, even empty: the rows share one grid (CSS).
			ajouter(win, "span", "qbd-ai-usage-reset", reset ? "(" + reset + ")" : "");
		}
		if (cur) {
			const upd = ajouter(el, "div", "qbd-ai-usage-updated", t("ai.usage.updated", { age: formatAge(cur.at, now) }));
			// A click on the age refreshes by hand (same cadence rule), without opening the popover.
			upd.addEventListener("click", (e) => { e.stopPropagation(); load(true); });
		}
		drawPop();
	};

	/* ── Popover ── */
	let pop: HTMLElement | null = null;
	const place = (): void => {
		if (!pop) return;
		const r = el.getBoundingClientRect();
		const w = pop.offsetWidth, h = pop.offsetHeight;
		const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
		let top = r.top - h - 8;
		let below = false;
		if (top < 8) { top = r.bottom + 8; below = true; }
		pop.style.left = left + "px";
		pop.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + "px";
		pop.dataset.side = below ? "below" : "above";
	};
	function drawPop(): void {
		if (!pop) return;
		pop.replaceChildren();
		const cur = cache.get(tool);
		const now = Date.now();
		const head = ajouter(pop, "div", "qbd-usage-pop-head");
		// The very logo the composer's model picker shows (same table, same colour class).
		const brand = PROVIDERS.find(p => p.id === (tool === "claude" ? "claude-code" : "codex"))?.logo;
		if (brand) {
			const logo = ajouter(head, "span", "qbd-provider-logo qbd-provider-logo--" + brand + " qbd-usage-pop-logo");
			setBrandLogo(logo, brand);
		}
		const titles = ajouter(head, "div", "qbd-usage-pop-titles");
		ajouter(titles, "div", "qbd-usage-pop-title", t(tool === "claude" ? "ai.usage.popoverTitleClaude" : "ai.usage.popoverTitleCodex"));
		if (cur) ajouter(titles, "div", "qbd-usage-pop-sub", t("ai.usage.updated", { age: formatAge(cur.at, now) }));
		const refresh = ajouter(head, "button", "qbd-usage-pop-refresh") as HTMLButtonElement;
		refresh.type = "button";
		refresh.setAttribute("aria-label", t("ai.usage.refresh"));
		const verdict = cadenceVerdict(cadenceOf(tool), now);
		refresh.title = verdict.ok ? t("ai.usage.refresh") : t("ai.usage.availableIn", { when: usageWaitText(verdict.waitMs) });
		refresh.disabled = enVol.has(tool) || !verdict.ok;
		currentHost().ui.setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => { load(true); drawPop(); });
		if (!verdict.ok && verdict.reason === "backoff") ajouter(pop, "div", "qbd-usage-pop-note", t("ai.usage.rateLimited", { when: usageWaitText(verdict.waitMs) }));
		for (const row of cur ? usageStatusRows(cur.rows) : []) {
			const pct = Math.max(0, Math.min(100, Math.round(row.usedPercent)));
			const sec = ajouter(pop, "div", "qbd-usage-pop-win");
			const top = ajouter(sec, "div", "qbd-usage-pop-top");
			ajouter(top, "span", "qbd-usage-pop-name", usageWindowTitle(row));
			ajouter(top, "span", "qbd-usage-pop-used", t("ai.usage.used", { n: pct }));
			const bar = ajouter(sec, "div", "qbd-ai-usage-bar qbd-usage-pop-bar");
			bar.dataset.level = usageLevel(row.usedPercent);
			ajouter(bar, "span", "qbd-ai-usage-fill").style.width = pct + "%";
			const meta = ajouter(sec, "div", "qbd-usage-pop-meta");
			ajouter(meta, "span", "", t("ai.usage.remaining", { n: usageRemainingPercent(row.usedPercent) }));
			const when = usageResetIn(row.resetsAt, now);
			ajouter(meta, "span", "", when ? t("ai.usage.resetsIn", { when }) : "");
		}
		place();
	}
	/* While the popover is open and the page visible, the "available in N s"
	   countdown moves every second; nothing else runs per second. */
	let secTimer: ReturnType<typeof setInterval> | null = null;
	const stopSec = (): void => { if (secTimer) clearInterval(secTimer); secTimer = null; };
	const startSec = (): void => {
		stopSec();
		if (!pop || document.visibilityState !== "visible") return;
		secTimer = setInterval(() => { if (pop) drawPop(); else stopSec(); }, 1000);
	};
	const onDocDown = (e: Event): void => {
		const n = e.target as Node;
		if (pop && !pop.contains(n) && !el.contains(n)) closePop();
	};
	const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && pop) { closePop(); el.focus(); } };
	function closePop(): void {
		if (!pop) return;
		pop.remove();
		pop = null;
		stopSec();
		el.setAttribute("aria-expanded", "false");
		document.removeEventListener("pointerdown", onDocDown, true);
		document.removeEventListener("keydown", onKey, true);
		window.removeEventListener("resize", place);
	}
	const togglePop = (): void => {
		if (pop) { closePop(); return; }
		pop = ajouter(document.body, "div", "qbd-usage-pop");
		pop.setAttribute("role", "dialog");
		pop.setAttribute("aria-label", t(tool === "claude" ? "ai.usage.popoverTitleClaude" : "ai.usage.popoverTitleCodex"));
		el.setAttribute("aria-expanded", "true");
		document.addEventListener("pointerdown", onDocDown, true);
		document.addEventListener("keydown", onKey, true);
		window.addEventListener("resize", place);
		drawPop();
		load(true);
		startSec();
	};
	el.addEventListener("click", togglePop);
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePop(); }
	});

	const load = (force: boolean): void => {
		const cur = cache.get(tool);
		const age = cur ? Date.now() - cur.at : Infinity;
		if (dead || enVol.has(tool) || (!force && age < RELOAD_MS)) return;
		if (!cadenceVerdict(cadenceOf(tool), Date.now()).ok) return;
		const p = read(tool).then(r => {
			const c = cadenceOf(tool);
			if (r.error?.kind === "rate-limited") cadenceRateLimited(c, Date.now(), r.error.retryAfterSec);
			else if (!r.error && r.rows.length) { cadenceSuccess(c, Date.now()); cache.set(tool, { rows: r.rows, at: Date.now() }); }
		}).catch(() => { /* keep the last numbers */ }).finally(() => {
			enVol.delete(tool);
			redraws.forEach(f => f());
		});
		enVol.set(tool, p);
	};

	const tick = (): void => {
		if (!el.isConnected) { destroy(); return; }
		draw();
		load(pop !== null);
	};
	const sync = (): void => {
		if (dead) return;
		if (!el.isConnected) { destroy(); return; }
		if (document.visibilityState === "visible") {
			if (!timer) timer = setInterval(tick, REDRAW_MS);
			draw();
			load(false);
			startSec();
		} else {
			stopSec();
			if (timer) { clearInterval(timer); timer = null; }
		}
	};
	function destroy(): void {
		dead = true;
		closePop();
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
