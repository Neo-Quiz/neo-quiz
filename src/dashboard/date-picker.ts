import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { currentHost } from "../host/current";
import { formatExamDate, parseExamDate } from "../review/review-store";
import { isoLocal, startOfDay } from "./home-tasks";
import { closeAllSelects, type MenuHandle } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   DATE PICKER (2026-09-29): the app's own calendar, replacing the native
   `<input type="date">`, whose grey OS popup no theme can reach.

   A popover portalled to `<body>` on the surface of the app's menus
   (`.qbd-select-menu`, see `openActionMenu`). Weeks start on Monday, weekday
   names come from `Intl`. Everything is computed on LOCAL midnights and the
   picked value is written with `isoLocal`, never `toISOString()`, which moves
   an evening to the next day east of Greenwich.

   Keyboard: arrows move the day, PageUp / PageDown the month, Enter or Space
   picks, Escape closes (and, being caught first, does not close the modal the
   picker sits in), Tab closes and moves on from the field.
══════════════════════════════════════════════════════════ */

export interface DatePickerOptions {
	/** Earliest day that can be picked, `YYYY-MM-DD`. Earlier days are disabled. */
	min?: string;
}

/** The picker currently open, if any: one at a time, and a second click on
    its field closes it instead of reopening it. */
let open: { anchor: HTMLElement; close: () => void } | null = null;

function addDays(ms: number, n: number): number {
	const d = new Date(ms);
	d.setDate(d.getDate() + n);
	return d.getTime();
}

/** `n` months later, the day of the month clamped to the target month's last day. */
function addMonths(ms: number, n: number): number {
	const d = new Date(ms);
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + n);
	d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
	return d.getTime();
}

/** Days since Monday, 0 to 6. */
function mondayIndex(ms: number): number {
	return (new Date(ms).getDay() + 6) % 7;
}

function sameMonth(a: number, b: number): boolean {
	const x = new Date(a);
	const y = new Date(b);
	return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

export function openDatePicker(anchor: HTMLElement, value: string, options: DatePickerOptions, onPick: (iso: string) => void): MenuHandle {
	if (open && open.anchor === anchor) {
		open.close();
		return { close() {} };
	}
	closeAllSelects();
	open?.close();

	const lang = currentLang();
	const todayMs = startOfDay(Date.now());
	const todayIso = isoLocal(todayMs);
	const minMs = options.min ? parseExamDate(options.min) : null;
	const clampMin = (ms: number): number => (minMs !== null && ms < minMs ? minMs : ms);
	let focus = clampMin(parseExamDate(value) ?? todayMs);

	const monthFormat = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" });
	const weekdayFormat = new Intl.DateTimeFormat(lang, { weekday: "short" });
	// 2024-01-01 was a Monday.
	const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFormat.format(new Date(2024, 0, 1 + i)));

	const pop = ajouter(document.body, "div", "qbd-select-menu qbd-datepicker");
	pop.setAttribute("role", "dialog");
	pop.setAttribute("aria-label", t("dashboard.planning.dateCalendar"));

	const head = ajouter(pop, "div", "qbd-datepicker-head");
	const navButton = (icon: string, label: "dashboard.planning.datePrevMonth" | "dashboard.planning.dateNextMonth", delta: number): HTMLButtonElement => {
		const b = ajouter(head, "button", "qbd-datepicker-nav");
		b.type = "button";
		b.setAttribute("aria-label", t(label));
		currentHost().ui.setIcon(b, icon);
		b.addEventListener("click", () => {
			focus = clampMin(addMonths(focus, delta));
			render(false);
		});
		return b;
	};
	const prev = navButton("chevron-left", "dashboard.planning.datePrevMonth", -1);
	const title = ajouter(head, "div", "qbd-datepicker-title");
	title.setAttribute("aria-live", "polite");
	navButton("chevron-right", "dashboard.planning.dateNextMonth", 1);

	const grid = ajouter(pop, "div", "qbd-datepicker-grid");
	grid.setAttribute("role", "grid");

	function render(takeFocus: boolean): void {
		const label = monthFormat.format(new Date(focus));
		title.textContent = label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
		// Nothing to see before the first pickable month.
		prev.disabled = minMs !== null && sameMonth(focus, minMs);

		grid.replaceChildren();
		const weekRow = ajouter(grid, "div", "qbd-datepicker-row");
		weekRow.setAttribute("role", "row");
		for (const name of weekdays) {
			const cell = ajouter(weekRow, "span", "qbd-datepicker-weekday", name);
			cell.setAttribute("role", "columnheader");
		}
		const first = new Date(focus);
		first.setDate(1);
		const start = addDays(first.getTime(), -mondayIndex(first.getTime()));
		// Six weeks always: the popover keeps its height from one month to the next.
		for (let w = 0; w < 6; w++) {
			const row = ajouter(grid, "div", "qbd-datepicker-row");
			row.setAttribute("role", "row");
			for (let i = 0; i < 7; i++) {
				const ms = addDays(start, w * 7 + i);
				const iso = isoLocal(ms);
				const disabled = minMs !== null && ms < minMs;
				const day = ajouter(row, "button", "qbd-datepicker-day"
					+ (sameMonth(ms, focus) ? "" : " qbd-datepicker-day--other")
					+ (iso === todayIso ? " qbd-datepicker-day--today" : ""), String(new Date(ms).getDate()));
				day.type = "button";
				day.setAttribute("role", "gridcell");
				day.setAttribute("aria-label", formatExamDate(iso, lang));
				day.setAttribute("aria-selected", String(iso === value));
				day.tabIndex = ms === focus ? 0 : -1;
				if (iso === todayIso) day.setAttribute("aria-current", "date");
				if (disabled) day.setAttribute("aria-disabled", "true");
				day.addEventListener("click", () => {
					if (disabled) return;
					close(true);
					onPick(iso);
				});
			}
		}
		if (takeFocus) grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}

	function place(): void {
		const rect = anchor.getBoundingClientRect();
		const box = pop.getBoundingClientRect();
		const below = rect.bottom + 4;
		const above = rect.top - 4 - box.height;
		pop.style.top = (below + box.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
		pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - box.width)) + "px";
	}

	function close(refocus: boolean): void {
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", onResize);
		pop.remove();
		anchor.setAttribute("aria-expanded", "false");
		if (open?.anchor === anchor) open = null;
		if (refocus) anchor.focus();
	}
	const onResize = (): void => close(false);

	function onDocDown(e: MouseEvent): void {
		const target = e.target as Node | null;
		if (target && (anchor.contains(target) || pop.contains(target))) return;
		close(false);
	}

	function onScroll(e: Event): void {
		if (e.target instanceof Node && pop.contains(e.target)) return;
		close(false);
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			// Caught before the modal's own Escape: only the picker closes.
			e.preventDefault();
			e.stopPropagation();
			close(true);
			return;
		}
		const active = document.activeElement;
		if (e.key === "Tab") {
			// Leave from the field, so Tab carries on from there.
			if (active && pop.contains(active)) close(true);
			return;
		}
		if (!(active instanceof HTMLElement) || !grid.contains(active)) return;
		const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		if (e.key in steps) focus = clampMin(addDays(focus, steps[e.key]));
		else if (e.key === "PageUp") focus = clampMin(addMonths(focus, -1));
		else if (e.key === "PageDown") focus = clampMin(addMonths(focus, 1));
		else return;
		e.preventDefault();
		e.stopPropagation();
		render(true);
	}

	render(false);
	place();
	anchor.setAttribute("aria-expanded", "true");
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onResize);
	grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();

	const handle = { anchor, close: () => close(false) };
	open = handle;
	return { close: handle.close };
}
