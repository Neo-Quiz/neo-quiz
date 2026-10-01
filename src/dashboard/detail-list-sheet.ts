import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   THE QUESTION LIST AS A BOTTOM SHEET (phone, editor)

   On a phone the editor's list of questions no longer sits above the question
   being edited: it is a sheet that rises from the bottom bar, opened by a
   button (`.qbd-qz-list-toggle`) over the page and closed by a tap on the
   scrim, on a question, or by the Back key (`retour-android.ts` clicks the
   button). Only the HOST decides (`HostPlatform.isMobile`); the layout itself
   is `mobile.css`, under `.qbd-qz-body--sheet`.
══════════════════════════════════════════════════════════ */

/** Puts `listCol` (the list column of `.qbd-qz-body`) in sheet mode, creating
    the button and the scrim the first time, and refreshing the question count
    shown on the button. A no-op off mobile. */
export function mountListSheet(listCol: HTMLElement, count: number): void {
	if (!currentHost().platform.isMobile) return;
	const body = listCol.parentElement;
	if (!body) return;
	body.classList.add("qbd-qz-body--sheet");
	let toggle = body.querySelector<HTMLButtonElement>(".qbd-qz-list-toggle");
	if (!toggle) {
		const bouton = ajouter(body, "button", "qbd-qz-list-toggle");
		bouton.type = "button";
		bouton.setAttribute("aria-expanded", "false");
		currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-qz-list-toggle-icon"), "list");
		ajouter(bouton, "span", "qbd-qz-list-toggle-label");
		const scrim = ajouter(body, "div", "qbd-qz-list-scrim");
		const set = (open: boolean): void => {
			body.classList.toggle("is-list-open", open);
			bouton.setAttribute("aria-expanded", String(open));
		};
		bouton.addEventListener("click", () => set(!body.classList.contains("is-list-open")));
		scrim.addEventListener("click", () => set(false));
		/* Picking a question closes the sheet; the buttons of a card (move,
		   delete) do not, the list stays open for the next gesture. */
		listCol.addEventListener("click", (e) => {
			const cible = e.target as Element;
			if (!cible.closest("button") && cible.closest(".qbd-qz-list-items > *")) set(false);
		});
		toggle = bouton;
	}
	const label = toggle.querySelector(".qbd-qz-list-toggle-label");
	if (label) label.textContent = t("dashboard.quiz.questionsTitle", { n: count });
}
