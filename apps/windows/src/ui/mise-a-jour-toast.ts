/* ══════════════════════════════════════════════════════════
   THE UPDATE TOAST (desktop only)

   A card at the bottom right once a version is downloaded (or waits for a
   click on a metered connection). Not a modal, no backdrop. Its button calls
   the same action as the menu row (`installerMiseAJour`). The close button
   hides it for this version until the next launch. What to show is decided
   by the pure `decisionToast`.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { poserIcone } from "../host/ui";
import { decisionToast, type ToastMaj } from "./mise-a-jour-toast-pur";
import { installerMiseAJour, suivreMiseAJour } from "./mise-a-jour";

const DUREE_SORTIE = 200;

export function monterToastMiseAJour(): () => void {
	let fermee: string | null = null;
	let carte: HTMLElement | null = null;
	let affichee: ToastMaj | null = null;
	let minuteur: ReturnType<typeof setTimeout> | undefined;

	const retirer = (): void => {
		const c = carte;
		if (!c) return;
		carte = null;
		affichee = null;
		c.classList.remove("is-visible");
		// Animated exit; under reduced motion the transition is instant, the timer still removes it.
		minuteur = setTimeout(() => c.remove(), DUREE_SORTIE);
	};

	const poser = (d: ToastMaj): void => {
		const c = document.createElement("div");
		c.className = "nq-maj-toast";
		c.setAttribute("role", "status");
		const icone = ajouter(c, "span", "nq-maj-toast-icone");
		icone.setAttribute("aria-hidden", "true");
		poserIcone(icone, "info");
		const corps = ajouter(c, "div", "nq-maj-toast-corps");
		ajouter(corps, "div", "nq-maj-toast-titre", t("app.toast.title"));
		ajouter(corps, "div", "nq-maj-toast-texte", t(d.action === "install" ? "app.toast.ready" : "app.toast.waiting", { version: d.version }));
		const bouton = ajouter(corps, "button", "nq-maj-toast-bouton", t(d.action === "install" ? "app.toast.restart" : "app.toast.download"));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			if (d.action === "install") bouton.disabled = true;
			installerMiseAJour();
		});
		const croix = ajouter(c, "button", "nq-maj-toast-fermer");
		croix.type = "button";
		croix.setAttribute("aria-label", t("app.toast.close"));
		poserIcone(croix, "x");
		const fermer = (): void => { fermee = d.version; retirer(); };
		croix.addEventListener("click", fermer);
		c.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } });
		document.body.appendChild(c);
		carte = c;
		affichee = d;
		// Two frames: the card must be painted at its start position first.
		requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add("is-visible")));
	};

	const desabonner = suivreMiseAJour(etat => {
		const d = decisionToast(etat, fermee);
		if (!d) { retirer(); return; }
		if (affichee && affichee.action === d.action && affichee.version === d.version) return;
		if (carte) { carte.remove(); carte = null; }
		poser(d);
	});
	return () => { desabonner(); clearTimeout(minuteur); carte?.remove(); };
}
