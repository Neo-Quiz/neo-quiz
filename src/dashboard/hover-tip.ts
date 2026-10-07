import { ajouter } from "../dom";

/* ══════════════════════════════════════════════════════════
   BULLE AU SURVOL — celle des boutons du composer de « Générer »

   Sortie de `ai.ts` (2026-09-23) pour que la fiche d'un quiz explique son
   mode (Learn / Practice) avec EXACTEMENT la bulle du sélecteur de la page
   « Générer » : deux surfaces qui disent la même chose ne doivent pas avoir
   chacune la leur. Style : `.qbd-hover-tip` (components/effort-slider.css).

   Le CONTENU est reconstruit à chaque survol (`fill`), jamais mémorisé : ces
   bulles affichent un état vivant (options courantes, usage du forfait)
   qu'un texte figé à la construction ferait mentir. Portalée au <body> — le
   composer clippe.
══════════════════════════════════════════════════════════ */

/* Hiding of every tip still shown, whatever its anchor: a navigation takes
   the page (and its buttons) away while the tip, portalled to <body>, stays.
   Called by the shell on each view change (`dashboard-shell.ts`, `naviguer`). */
const fermeurs = new Set<() => void>();

export function fermerBullesSurvol(): void {
	for (const fermer of Array.from(fermeurs)) fermer();
}

export function attachHoverTip(btn: HTMLElement, fill: (tip: HTMLElement) => void): void {
	let tip: HTMLElement | null = null;
	const hide = () => { if (tip) { tip.remove(); tip = null; } fermeurs.delete(hide); };
	btn.addEventListener("mouseenter", () => {
		if (tip) return;
		tip = ajouter(document.body, "div", "qbd-hover-tip");
		fermeurs.add(hide);
		fill(tip);
		const r = btn.getBoundingClientRect();
		tip.style.visibility = "hidden";
		const tr = tip.getBoundingClientRect();
		const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
		let top = r.top - tr.height - 8;
		if (top < 8) top = r.bottom + 8;
		tip.style.left = left + "px";
		tip.style.top = top + "px";
		tip.style.visibility = "";
		/* La bulle MEURT AVEC SON ANCRE. Une page repeinte sous la souris
		   (fiche redessinée, navigation au clavier) détache l'ancre sans
		   qu'aucun \`mouseleave\` ne parte : portalée au <body>, la bulle restait
		   affichée pour de bon (vu le 2026-09-23 sur la fiche d'un quiz). Veille
		   par image, seulement tant que la bulle est visible. */
		const veiller = (): void => {
			if (!tip) return;
			if (!btn.isConnected) { hide(); return; }
			requestAnimationFrame(veiller);
		};
		requestAnimationFrame(veiller);
	});
	btn.addEventListener("mouseleave", hide);
	btn.addEventListener("click", hide);
}
