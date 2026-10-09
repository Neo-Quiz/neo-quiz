import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { poserBouton3d, poserBouton3dNeutre } from "./cta3d";

/* ══════════════════════════════════════════════════════════
   THE HEADER OF A QUIZ'S PAGE: fiche, editor, preview, Generate page

   ONE header for every mode of the page (2026-09-29): the back arrow above,
   the title, the folder as a subtitle under it, then a row with the info
   line on the left, a free slot in the centre (the fiche's search) and the
   actions on the right — "Edit" as a neutral 3D button, "Start the quiz" as
   the blue one, then "⋮". It stays OUTSIDE the body that fades when the
   page switches between the fiche and the editor (`toggleEditing`,
   detail.ts), so the title, the subtitle and the two buttons never
   disappear and come back: only "Edit" becomes "Done". Before, the fiche
   drew its own header inside that body and the editor another one, at
   another height: the whole top of the page flashed on every switch.

   What only one mode has carries `qbd-qz-swap` and fades with the body:
   the editor's actions of a page without "⋮" (the Generate page's
   "Vocabulary"), placed LEFT of "Edit" so that "Done" and
   "Start" keep their place. A quiz of the catalogue has them in its "⋮"
   menu instead (detail.ts): its header is then identical in both modes.

   No full path nor meta line (score, games, attempts): they live in the
   folder's Progress tab. The Generate page, which has no folder, keeps its
   usage line as a subtitle.

   A module of its own so that `detail.ts` does not grow: it knows nothing
   of the draft nor of writing — the caller passes functions already
   wrapped in its `flushSave`.
══════════════════════════════════════════════════════════ */

export interface EnteteAction {
	label: string;
	icon: string;
	onClick(el: HTMLElement): void;
	/** Numeric badge after the label (term count of the glossary, task 4 of
	    batch D) — absent or empty: no badge. */
	badge?: string;
	/** Thin progress bar along the bottom of the button (a quiz started and
	    not finished: "Resume"). Absent: no bar. */
	progress?: { done: number; total: number };
	/** STABLE identifier set as `data-qbd-key` on the painted button, so a
	    caller finds an already painted button (`setActionBadge`) without
	    repainting the whole header — the "Vocabulary" action, whose badge is
	    updated once the draft is loaded (`detail.ts`). Absent for the other
	    actions, which have nothing to refresh afterwards. */
	key?: string;
}

export interface EnteteDeps {
	title: string;
	/** Subtitle: the quiz's folder, or the usage line of a generation. Empty → hidden. */
	kicker: string;
	/** True in editing: the toggle button says "Done", otherwise "Edit". */
	editing: boolean;
	/** The editor cannot open here (a phone): no Edit button is drawn. */
	editorLocked?: boolean;
	onBack(): void;
	onToggleEditing(): void;
	/** Actions of every mode (Generate page: "Insert"), before "Edit". */
	actions: EnteteAction[];
	/** Actions of the editor only ("Vocabulary"): they fade in and
	    out with the body, left of the others. */
	editActions?: EnteteAction[];
	/** Main button ("Start the quiz", "Save"). Absent → hidden. */
	start?: EnteteAction;
	/** Enter starts the quiz when nothing has the focus (the fiche). */
	enterStarts?: boolean;
	/** The quiz's "⋮" menu, the same as its card's. Absent: no button. */
	menu?(anchor: HTMLElement): void;
	/** The info line (mode, number of questions, origin), painted into the
	    given row. Absent (Generate page) → nothing. */
	infos?(parent: HTMLElement): void;
}

export interface Entete {
	top: HTMLElement;
	/** The free slot in the centre of the actions row (the fiche's search). */
	center: HTMLElement;
	/** Under the title and the folder: the PDF source chips (pdf-sources-view.ts). */
	sources: HTMLElement;
	/** Restarts the sheen of the main button at once (a click on a question
	    card of the fiche). Nothing without animations or without a button. */
	attirer(): void;
}

/** The folder of a quiz — the only segment of the path that says where it
    comes from, same rule as the fiche and the cards. Vault root: empty string. */
export function dossierDuQuiz(path: string): string {
	return path.split("/").slice(0, -1).filter(Boolean).pop() ?? "";
}

function bouton(parent: HTMLElement, cls: string, icon: string, label: string, badge?: string, key?: string): HTMLButtonElement {
	const btn = ajouter(parent, "button", cls);
	btn.type = "button";
	if (key) btn.dataset.qbdKey = key;
	currentHost().ui.setIcon(ajouter(btn, "span", "qbd-btn-icon"), icon);
	ajouter(btn, "span", undefined, label);
	if (badge) ajouter(btn, "span", "qbd-qz-action-badge", badge);
	return btn;
}

/** Updates (or removes) the badge of an already painted action button,
    without repainting the whole header — the "Vocabulary" modal (task 4 of
    batch D) uses it when it closes, once the term count is known. */
export function setActionBadge(btn: HTMLElement, badge?: string): void {
	let pastille = btn.querySelector<HTMLElement>(".qbd-qz-action-badge");
	if (!badge) { pastille?.remove(); return; }
	if (!pastille) pastille = ajouter(btn, "span", "qbd-qz-action-badge");
	pastille.textContent = badge;
}

function reduit(): boolean {
	return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function renderEntete(page: HTMLElement, deps: EnteteDeps): Entete {
	// `qbd-qz-top` and not `qbd-qz-header`: the latter also dresses the header
	// of the PLAYER's page (apps/windows/src/ui/quiz-page.ts), as a row.
	// Turning it into a column here would have broken it there.
	const top = ajouter(page, "div", "qbd-qz-top");

	/* The same button as every back arrow of the dashboard, the arrow drawn
	   in CSS (mask). ABOVE the title (2026-09-26), as in a folder: on the
	   left, arrow, title, info line and bar all start from one vertical. */
	const back = ajouter(top, "button", "qbd-quizzes-crumb-back qbd-fiche-back");
	back.type = "button";
	back.setAttribute("aria-label", t("dashboard.quiz.back"));
	ajouter(back, "span", "qbd-quizzes-crumb-icon");
	back.addEventListener("click", () => deps.onBack());

	const head = ajouter(top, "header", "qbd-fiche-head");
	const titres = ajouter(head, "div", "qbd-fiche-titles");
	// The title FIRST, the folder as a subtitle under it (2026-09-26).
	ajouter(titres, "h2", "qbd-fiche-title", deps.title);
	if (deps.kicker) ajouter(titres, "div", "qbd-fiche-kicker", deps.kicker);
	const sources = ajouter(titres, "div", "qbd-pdf-sources");

	/* ONE row under the title: the infos on the left, the centre slot, the
	   actions on the right (2026-09-26: each at its own height, they were
	   aligned on nothing). The actions came DOWN a row: at the title's
	   height they were far from the bar and the questions. */
	const tools = ajouter(top, "div", "qbd-fiche-tools");
	deps.infos?.(tools);
	const center = ajouter(tools, "div", "qbd-fiche-tools-center");
	const actions = ajouter(tools, "div", "qbd-fiche-actions");

	const action = (a: EnteteAction, swap: boolean): void => {
		const btn = bouton(actions, "qbd-qz-action" + (swap ? " qbd-qz-swap" : ""), a.icon, a.label, a.badge, a.key);
		poserBouton3dNeutre(btn);
		btn.addEventListener("click", () => a.onClick(btn));
	};
	for (const a of deps.editActions ?? []) action(a, true);
	for (const a of deps.actions) action(a, false);

	// Edit ↔ Done: the SAME page switches. Neutral: the main action stays
	// "Start the quiz", next to it. Where the editor cannot open (a phone)
	// there is no button at all: a "Soon" button that only showed a notice
	// took half the row from "Start the quiz" (2026-10-08).
	if (!deps.editorLocked) {
		const edit = bouton(actions, "qbd-qz-edit", deps.editing ? "check" : "square-pen",
			t(deps.editing ? "dashboard.quiz.editDone" : "dashboard.quiz.editor"));
		poserBouton3dNeutre(edit);
		edit.addEventListener("click", () => deps.onToggleEditing());
	}

	let reflet: SVGSVGElement | null = null;
	const start = deps.start;
	if (start) {
		const btn = bouton(actions, "qbd-qz-start", start.icon, start.label);
		/* Brilliant's 3D button, in the blue of the arrows (2026-09-25): a
		   raised face that sinks on click, and the SHEEN that sweeps — an SVG
		   of its own, so that `attirer` can restart its cycle (cta3d.ts). */
		reflet = poserBouton3d(btn);
		const p = start.progress;
		if (p && p.total > 0) {
			const done = Math.max(0, Math.min(p.done, p.total));
			const bar = ajouter(btn.querySelector(".qbd-cta3d-face") ?? btn, "span", "qbd-cta3d-progress");
			bar.setAttribute("role", "progressbar");
			bar.setAttribute("aria-valuemin", "0");
			bar.setAttribute("aria-valuemax", String(p.total));
			bar.setAttribute("aria-valuenow", String(done));
			bar.setAttribute("aria-label", t(p.total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total: p.total }));
			bar.style.setProperty("--progress", `${(done / p.total) * 100}%`);
		}
		btn.addEventListener("click", () => start.onClick(btn));
		if (deps.enterStarts) {
			/* ENTER = "Start the quiz" when nothing has the focus (2026-09-26),
			   with the click's press: the face sinks, THEN the quiz starts. Not
			   while typing (search), nor on a focused button or card (Enter
			   belongs to them), nor under a modal. The listener removes itself
			   once the button has left the document. */
			const surEntree = (e: KeyboardEvent): void => {
				if (!btn.isConnected) { document.removeEventListener("keydown", surEntree); return; }
				if (e.key !== "Enter" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
				const cible = e.target instanceof HTMLElement ? e.target : null;
				if (cible && cible !== document.body && cible.closest("input, textarea, select, button, a, [contenteditable], [role=button], [tabindex]")) return;
				if (document.querySelector(".modal-container, [role=dialog], [aria-modal=true]")) return;
				e.preventDefault();
				btn.classList.add("is-pressing");
				window.setTimeout(() => {
					btn.classList.remove("is-pressing");
					if (btn.isConnected) start.onClick(btn);
				}, reduit() ? 0 : 130);
			};
			document.addEventListener("keydown", surEntree);
		}
	}

	/* "⋮": the quiz card's menu, as in a folder's header. */
	const menu = deps.menu;
	if (menu) {
		const plus = ajouter(actions, "button", "qbd-folder-more-btn");
		plus.type = "button";
		plus.setAttribute("aria-label", t("dashboard.card.more"));
		currentHost().ui.setIcon(plus, "ellipsis-vertical");
		plus.addEventListener("click", () => menu(plus));
	}

	return {
		top,
		center,
		sources,
		attirer: () => {
			if (!reflet || reduit()) return;
			for (const a of reflet.getAnimations()) a.currentTime = 0;
		},
	};
}
