import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { CATEGORIES, type CategorieQuiz } from "./categorie-quiz";
import { libelleCategorie, peindreIconeCategorie } from "./categorie-affichage";

/* ══════════════════════════════════════════════════════════
   SUBJECT PICKER (2026-10-18) — the one place a folder's or a quiz's subject
   is changed by hand ("Edit folder", the quiz page). Same surface and
   behaviour as the icon picker (`icon-picker.ts`): a search field, a scrolling
   list, a click picks and closes, a click outside or Escape closes. First row
   "Automatic" = no choice of its own (`onPick(null)`): the subject is deduced.
══════════════════════════════════════════════════════════ */

const PICKER_W = 264;
const SCROLL_MAX = 300;
const PICKER_H = 44 + SCROLL_MAX + 20;

const plier = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface SubjectPickerHandle {
	close(): void;
}

/** `current`: the subject chosen by hand, `undefined` = Automatic. */
export function openSubjectPicker(
	anchorEl: HTMLElement,
	current: CategorieQuiz | undefined,
	onPick: (subject: CategorieQuiz | null) => void,
	container: HTMLElement = document.body,
): SubjectPickerHandle {
	const rect = anchorEl.getBoundingClientRect();
	const root = ajouter(container, "div", "qbd-icon-picker qbd-subject-picker");
	root.style.width = PICKER_W + "px";
	root.addEventListener("mousedown", (e) => e.stopPropagation());
	let top = rect.bottom + 6;
	if (top + PICKER_H > window.innerHeight - 8) top = Math.max(8, rect.top - PICKER_H - 6);
	root.style.top = top + "px";
	root.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - PICKER_W)) + "px";

	const wrap = ajouter(root, "div", "qbd-icon-search-wrap");
	currentHost().ui.setIcon(ajouter(wrap, "span", "qbd-icon-search-icon"), "search");
	const search = ajouter(wrap, "input", "qbd-icon-search");
	search.type = "text";
	search.placeholder = t("dashboard.quizzes.subjectSearch");
	search.setAttribute("aria-label", t("dashboard.quizzes.subjectSearch"));
	search.spellcheck = false;

	const list = ajouter(root, "div", "qbd-icon-scroll qbd-subject-list");
	list.style.maxHeight = SCROLL_MAX + "px";
	let first: (() => void) | null = null;

	const row = (label: string, paint: (el: HTMLElement) => void, active: boolean, pick: CategorieQuiz | null): void => {
		const b = ajouter(list, "button", "qbd-subject-row" + (active ? " is-active" : ""));
		b.type = "button";
		paint(ajouter(b, "span", "qbd-subject-row-icon"));
		ajouter(b, "span", "qbd-subject-row-label", label);
		const choose = (): void => { onPick(pick); close(); };
		b.addEventListener("click", choose);
		first ??= choose;
	};

	function render(query: string): void {
		list.replaceChildren();
		first = null;
		const q = plier(query.trim());
		const auto = t("dashboard.quizzes.subjectAuto");
		if (!q || plier(auto).includes(q)) {
			row(auto, el => currentHost().ui.setIcon(el, "sparkles"), current === undefined, null);
		}
		for (const c of CATEGORIES) {
			const label = libelleCategorie(c);
			if (q && !plier(label).includes(q)) continue;
			row(label, el => peindreIconeCategorie(el, c), current === c, c);
		}
		if (!first) ajouter(list, "div", "qbd-icon-empty", t("dashboard.quizzes.subjectNoResult"));
	}
	render("");
	search.addEventListener("input", () => render(search.value));
	search.addEventListener("keydown", (e) => { if (e.key === "Enter") first?.(); });

	const onDocDown = (e: MouseEvent): void => { if (!root.contains(e.target as Node)) close(); };
	const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
	document.addEventListener("mousedown", onDocDown);
	document.addEventListener("keydown", onKey);
	function close(): void {
		document.removeEventListener("mousedown", onDocDown);
		document.removeEventListener("keydown", onKey);
		root.remove();
	}
	window.setTimeout(() => search.focus(), 0);
	return { close };
}
