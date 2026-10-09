import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { currentHost } from "../host/current";
import { PROVIDERS, setBrandLogo } from "./ai-providers";
import { cadenceRateLimited, cadenceSuccess, cadenceVerdict, newCadence } from "./usage-cadence";
import type { Cadence } from "./usage-cadence";
import { formatAge, usageWaitText, usageLevel, usageRemainingPercent, usageResetIn, usageResetText, usageShortLabel, usageStatusRows, usageWindowTitle } from "./usage-format";
import type { UsageRead } from "./usage-format";
import { spendable } from "./codex-resets";
import type { ResetOutcome, ResetsError, ResetsRead } from "./codex-resets";

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

/** Account address per tool, read through the same host call as Settings >
    Accounts (`process.etatComptes`, one CLI launch). At most one read per 10
    minutes, started by the first popover opening only, never while the page is
    hidden. The plan is deliberately never read here. */
const EMAIL_MS = 10 * 60000;
const emails = new Map<UsageTool, { email: string | null; at: number }>();
const emailEnVol = new Set<UsageTool>();
function loadEmail(tool: UsageTool, done: () => void): void {
	const cur = emails.get(tool);
	if (emailEnVol.has(tool) || document.visibilityState !== "visible") return;
	if (cur && Date.now() - cur.at < EMAIL_MS) return;
	const proc = currentHost().process;
	if (!proc || !currentHost().platform.isDesktopApp) return;
	emailEnVol.add(tool);
	proc.etatComptes([tool]).then(list => {
		const c = list.find(e => e.outil === tool);
		emails.set(tool, { email: c && c.connecte ? c.email : null, at: Date.now() });
	}).catch(() => { emails.set(tool, { email: null, at: Date.now() }); }).finally(() => {
		emailEnVol.delete(tool);
		done();
	});
}
/* ── Codex banked resets (popover section, Codex only) ──
   Read through the main process (`host.process.codexResets`, which launches
   `codex app-server`); at most one read every 30 s, forced after a spend. The
   confirmation is in two steps: "Use" turns the row into "Spend this reset
   now?" and ONLY "Confirm" calls `consume`. Shared by every mount like the
   cache above. */
const RESETS_GAP_MS = 30000;
interface ResetsState {
	data: ResetsRead | null;
	at: number;
	reading: boolean;
	/** The credit whose row asks "Spend this reset now?". */
	confirming: string | null;
	spending: boolean;
	/** The last result or error, shown under the list. */
	message: ResetOutcome | ResetsError | null;
}
const resets: ResetsState = { data: null, at: 0, reading: false, confirming: null, spending: false, message: null };
const canResets = (tool: UsageTool): boolean => tool === "codex" && !!currentHost().process?.codexResets;

function loadResets(tool: UsageTool, force: boolean, done: () => void): void {
	const proc = currentHost().process;
	if (!canResets(tool) || !proc?.codexResets || resets.reading || document.visibilityState !== "visible") return;
	if (!force && resets.at && Date.now() - resets.at < RESETS_GAP_MS) return;
	resets.reading = true;
	proc.codexResets({ action: "read" }).then(r => {
		resets.at = Date.now();
		if (r.ok && r.action === "read") resets.data = r.resets;
	}).catch(() => { resets.at = Date.now(); }).finally(() => { resets.reading = false; done(); });
}

const OUTCOME_KEYS = {
	reset: "ai.usage.resetOutcomeReset", nothingToReset: "ai.usage.resetOutcomeNothing", noCredit: "ai.usage.resetOutcomeNoCredit", alreadyRedeemed: "ai.usage.resetOutcomeAlready",
	"not-installed": "ai.usage.resetErrNotInstalled", "not-signed-in": "ai.usage.resetErrNotSignedIn", timeout: "ai.usage.resetErrTimeout",
	unavailable: "ai.usage.resetErrUnavailable", refused: "ai.usage.resetErrStale", "unknown-credit": "ai.usage.resetErrStale",
} as const;

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
			// At 0 % the bar is a plain empty track: no fill, so no min-width dot.
			if (pct === 0) bar.dataset.empty = "true";
			const fill = ajouter(bar, "span", "qbd-ai-usage-fill");
			fill.style.width = pct + "%";
			ajouter(win, "span", "qbd-ai-usage-pct", t("ai.usage.linePercent", { n: pct }));
			const reset = usageResetText(row.resetsAt, now, currentLang());
			// Always a cell, even empty: the rows share one grid (CSS).
			ajouter(win, "span", "qbd-ai-usage-reset", reset ? "(" + reset + ")" : "");
		}
		if (cur) {
			const upd = ajouter(el, "div", "qbd-ai-usage-updated" + (enVol.has(tool) ? " is-reading" : ""), t("ai.usage.updated", { age: formatAge(cur.at, now) }));
			// A click on the age refreshes by hand (same cadence rule), without opening the popover.
			upd.addEventListener("click", (e) => { e.stopPropagation(); load(true); draw(); });
		}
		drawPop();
	};

	/* ── Popover ── */
	let pop: HTMLElement | null = null;
	/** When the popover opened: its bars fill from 0 during the first 450 ms
	    only (a redraw inside that window resumes the fill via a negative delay). */
	let openedAt = 0;
	const FILL_MS = 450;
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
		const mail = emails.get(tool)?.email;
		if (mail) {
			// Middle truncation: the local part shrinks, the domain stays whole.
			const at = mail.lastIndexOf("@");
			const line = ajouter(titles, "div", "qbd-usage-pop-email");
			line.title = mail;
			ajouter(line, "span", "qbd-usage-pop-email-local", at > 0 ? mail.slice(0, at) : mail);
			if (at > 0) ajouter(line, "span", "qbd-usage-pop-email-domain", mail.slice(at));
		}
		const refresh = ajouter(head, "button", "qbd-usage-pop-refresh") as HTMLButtonElement;
		refresh.type = "button";
		refresh.setAttribute("aria-label", t("ai.usage.refresh"));
		const verdict = cadenceVerdict(cadenceOf(tool), now);
		refresh.title = verdict.ok ? t("ai.usage.refresh") : t("ai.usage.availableIn", { when: usageWaitText(verdict.waitMs) });
		refresh.disabled = enVol.has(tool) || !verdict.ok;
		currentHost().ui.setIcon(refresh, "refresh-cw");
		if (enVol.has(tool)) refresh.classList.add("is-reading");
		refresh.addEventListener("click", () => { load(true); loadResets(tool, false, () => redraws.forEach(f => f())); drawPop(); });
		if (!verdict.ok && verdict.reason === "backoff") ajouter(pop, "div", "qbd-usage-pop-note", t("ai.usage.rateLimited", { when: usageWaitText(verdict.waitMs) }));
		for (const row of cur ? usageStatusRows(cur.rows) : []) {
			const pct = Math.max(0, Math.min(100, Math.round(row.usedPercent)));
			const sec = ajouter(pop, "div", "qbd-usage-pop-win");
			const top = ajouter(sec, "div", "qbd-usage-pop-top");
			ajouter(top, "span", "qbd-usage-pop-name", usageWindowTitle(row));
			ajouter(top, "span", "qbd-usage-pop-used", t("ai.usage.used", { n: pct }));
			const bar = ajouter(sec, "div", "qbd-ai-usage-bar qbd-usage-pop-bar");
			bar.dataset.level = usageLevel(row.usedPercent);
			// At 0 % the bar is a plain empty track: no fill, so no min-width dot.
			if (pct === 0) bar.dataset.empty = "true";
			const fill = ajouter(bar, "span", "qbd-ai-usage-fill");
			fill.style.width = pct + "%";
			const elapsed = now - openedAt;
			if (elapsed < FILL_MS) {
				fill.classList.add("is-filling");
				fill.style.animationDelay = -elapsed + "ms";
			}
			const meta = ajouter(sec, "div", "qbd-usage-pop-meta");
			ajouter(meta, "span", "", t("ai.usage.remaining", { n: usageRemainingPercent(row.usedPercent) }));
			const when = usageResetIn(row.resetsAt, now);
			ajouter(meta, "span", "", when ? t("ai.usage.resetsIn", { when }) : "");
		}
		drawResets(now);
		place();
	}
	/** The banked resets section. Texts from the server go in as TEXT. */
	function drawResets(now: number): void {
		if (!pop || !canResets(tool)) return;
		const count = resets.data?.availableCount ?? 0;
		if (count <= 0 && !resets.message) return;
		const sec = ajouter(pop, "div", "qbd-usage-pop-resets");
		if (count > 0) {
			ajouter(sec, "div", "qbd-usage-pop-resets-title", t("ai.usage.resetsAvailable", { n: count }));
			const credits = resets.data ? spendable(resets.data) : [];
			// A server that gives only a count: generic rows, nothing to spend by id.
			const rows = credits.length ? credits : Array.from({ length: count }, () => null);
			for (const c of rows) {
				const row = ajouter(sec, "div", "qbd-usage-reset-row");
				const info = ajouter(row, "div", "qbd-usage-reset-info");
				ajouter(info, "div", "qbd-usage-reset-name", c?.title ?? t("ai.usage.resetFallbackTitle"));
				if (c?.description) ajouter(info, "div", "qbd-usage-reset-desc", c.description);
				const when = c ? usageResetIn(c.expiresAt, now) : null;
				if (when) ajouter(info, "div", "qbd-usage-reset-expiry", t("ai.usage.resetExpires", { when }));
				if (!c) { ajouter(info, "div", "qbd-usage-reset-desc", t("ai.usage.resetFallbackNote")); continue; }
				const actions = ajouter(row, "div", "qbd-usage-reset-actions");
				const btn = (label: string, primary: boolean, on: () => void): void => {
					const b = ajouter(actions, "button", "qbd-usage-reset-btn" + (primary ? " is-primary" : ""), label) as HTMLButtonElement;
					b.type = "button";
					b.disabled = resets.spending;
					b.addEventListener("click", on);
				};
				if (resets.confirming === c.id) {
					row.classList.add("is-confirming");
					ajouter(info, "div", "qbd-usage-reset-question", t("ai.usage.resetConfirmQuestion"));
					btn(t("ai.usage.resetCancel"), false, () => { resets.confirming = null; redraws.forEach(f => f()); });
					btn(resets.spending ? t("ai.usage.resetSpending") : t("ai.usage.resetConfirm"), true, () => spendReset(c.id));
				} else {
					btn(t("ai.usage.resetUse"), false, () => { resets.confirming = c.id; resets.message = null; redraws.forEach(f => f()); });
				}
			}
		}
		if (resets.message) {
			const msg = ajouter(sec, "div", "qbd-usage-reset-message", t(OUTCOME_KEYS[resets.message]));
			msg.setAttribute("role", "status");
		}
	}
	/** Only the Confirm button gets here. Then: the credits are read again
	    (forced) and the limits at the next free slot of the shared cadence. */
	function spendReset(creditId: string): void {
		const proc = currentHost().process;
		if (!proc?.codexResets || resets.spending) return;
		resets.spending = true;
		redraws.forEach(f => f());
		proc.codexResets({ action: "consume", creditId }).then(r => {
			resets.message = r.ok && r.action === "consume" ? r.outcome : r.ok ? "unavailable" : r.error;
		}).catch(() => { resets.message = "unavailable"; }).finally(() => {
			resets.spending = false;
			resets.confirming = null;
			rereadLimits = true;
			loadResets(tool, true, () => redraws.forEach(f => f()));
			redraws.forEach(f => f());
		});
	}
	/** A forced re-read of the limits waits for the 30 s gap and any back-off. */
	let rereadLimits = false;
	/* While the popover is open and the page visible, the "available in N s"
	   countdown moves every second; nothing else runs per second. */
	let secTimer: ReturnType<typeof setInterval> | null = null;
	const stopSec = (): void => { if (secTimer) clearInterval(secTimer); secTimer = null; };
	const startSec = (): void => {
		stopSec();
		if (!pop || document.visibilityState !== "visible") return;
		/* A redraw replaces the popover's buttons, so it runs only while
		   something moves: the "available in N s" countdown (and the tick after
		   it), or a limits re-read waiting for its slot. */
		let waited = false;
		secTimer = setInterval(() => {
			if (!pop) { stopSec(); return; }
			const waiting = !cadenceVerdict(cadenceOf(tool), Date.now()).ok;
			if (rereadLimits && !waiting) { rereadLimits = false; load(true); }
			if (waiting || waited || rereadLimits) drawPop();
			waited = waiting;
		}, 1000);
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
		openedAt = Date.now();
		drawPop();
		resets.message = null;
		loadEmail(tool, () => { if (pop) drawPop(); });
		loadResets(tool, false, () => redraws.forEach(f => f()));
		load(true);
		startSec();
	};
	el.addEventListener("click", togglePop);
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.classList.add("is-pressed"); togglePop(); }
	});
	// Keyboard gets the same press-and-rebound as the pointer's :active.
	el.addEventListener("keyup", () => el.classList.remove("is-pressed"));
	el.addEventListener("blur", () => el.classList.remove("is-pressed"));

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
