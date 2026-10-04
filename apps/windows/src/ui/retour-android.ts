/* ══════════════════════════════════════════════════════════
   THE ANDROID BACK KEY

   Kotlin asks the renderer (`window.neoPlatform.surRetour`, `main.ts`) whether
   it can go back; only when it answers no does the activity finish.

   Layers, topmost first:
   1. an open modal (Settings, a "Set up your test" window, a menu of the
      shell are all `.modal-container`s): its close button, the one the user
      would tap;
   2. the editor's question sheet (`detail-list-sheet.ts`), then the quiz
      engine's hint window;
   3. a screen: every screen that can go back listens to `EVENEMENT_RETOUR`
      on the document and marks the event handled. The played quiz closes
      (as its cross does); the dashboard shell steps back in its history, the
      same one the mouse's back button walks (`historique-nav.ts`). The shell
      kept inert behind a played quiz stays out of it.
   Nothing handled: the key leaves the app.
══════════════════════════════════════════════════════════ */

export const EVENEMENT_RETOUR = "nq-retour";

export interface DetailRetour {
	traite: boolean;
}

/** Marks a back request as handled by the caller; false when it was already. */
export function prendreRetour(e: Event): boolean {
	const detail = (e as CustomEvent<DetailRetour>).detail;
	if (!detail || detail.traite) return false;
	detail.traite = true;
	return true;
}

/** Goes one step back; returns whether anything did. */
export function retourAndroid(): boolean {
	const modales = document.querySelectorAll<HTMLElement>(".modal-container:not(.qbd-closing) .modal-close-button");
	const derniere = modales[modales.length - 1];
	/* Inside Settings, an open category goes back to the list first (the
	   phone's list of categories, 2026-10-04), as its own arrow does. */
	const retourReglages = derniere?.closest(".modal")?.querySelector<HTMLElement>(".nq-set.is-categorie .nq-set-page:not([hidden]) .nq-set-retour");
	if (retourReglages) {
		retourReglages.click();
		return true;
	}
	if (derniere) {
		derniere.click();
		return true;
	}
	const feuille = document.querySelector<HTMLElement>(".qbd-qz-body.is-list-open .qbd-qz-list-toggle");
	if (feuille) {
		feuille.click();
		return true;
	}
	const indice = document.querySelector<HTMLElement>(".quiz-hint-modal-overlay.is-open .quiz-hint-modal-close");
	if (indice) {
		indice.click();
		return true;
	}
	const evenement = new CustomEvent<DetailRetour>(EVENEMENT_RETOUR, { detail: { traite: false } });
	document.dispatchEvent(evenement);
	return evenement.detail.traite;
}
