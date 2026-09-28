/* ══════════════════════════════════════════════════════════
   LA FRISE DE PERLES, MODE COMPACT ET LOUPE (2026-09-27) — `perles.css`.

   Quand les perles en taille pleine ne tiennent plus sur UNE ligne, la
   rangée passe en mode compact : de petits points, un numéro sur une
   question sur cinq (`is-repere`, posé par le moteur), la courante en
   taille pleine ; au survol, la perle sous la souris et ses voisines
   grossissent comme le Dock de macOS et montrent leur numéro. Chaque
   question reste visible et cliquable, sur une ligne, sans infobulle.

   Ce module ne fait que ce que le CSS ne sait pas faire seul :
   - DÉCIDER du mode : autant de perles de 32 px (et 4 de plus pour la
     courante) tiennent-elles dans la largeur ? Une requête de conteneur ne
     sait pas lire un nombre de perles ;
   - poser `--zoom` sur les perles proches du pointeur ;
   - placer le FIL en pixels : en compact, les perles n'ont plus la même
     taille, et la fraction `--quiz-nav-pos` du moteur ne tombe plus sur le
     centre de la perle courante.

   Le moteur REMPLACE la rangée à chaque rendu complet (`innerHTML` de son
   conteneur, dont elle est un enfant direct) : elle est rattachée dès
   qu'elle change. Aucun import : ce module vit dans le rendu, qui ne doit
   jamais tirer Node (`check:host`).
══════════════════════════════════════════════════════════ */

const PLEINE = 32;
const ECART = 4;
const EXTRA_COURANTE = 4;
/** Le `padding` horizontal de la rangée, des deux côtés (`perles.css`). */
const MARGE = 12;
/** La loupe : la perle sous le pointeur, puis ses voisines de part et d'autre. */
const LOUPE = [1, 0.6, 0.25];

/** Branche la frise de perles sur l'hôte du moteur ; rend de quoi la débrancher. */
export function brancherPerles(hote: HTMLElement): () => void {
	let nav: HTMLElement | null = null;
	let image = 0;
	let pointeurX: number | null = null;

	const perles = (): HTMLElement[] =>
		nav ? Array.from(nav.querySelectorAll<HTMLElement>(":scope > .quiz-tab")) : [];
	const compacte = (): boolean => !!nav && nav.classList.contains("is-compacte");

	/* Le fil, du centre de la première perle à celui de la dernière, rempli
	   jusqu'au centre de la courante. Mesuré sur les perles elles-mêmes : la
	   loupe et la perle courante changent leurs tailles. */
	const placerFil = (): void => {
		if (!nav) return;
		if (!compacte()) {
			for (const p of ["--fil-debut", "--fil-long", "--fil-rempli"]) nav.style.removeProperty(p);
			return;
		}
		const liste = perles();
		if (liste.length === 0) return;
		const origine = nav.getBoundingClientRect().left;
		const centre = (el: HTMLElement): number => {
			const r = el.getBoundingClientRect();
			return r.left + r.width / 2 - origine;
		};
		const debut = centre(liste[0]);
		const courante = liste.find(el => el.classList.contains("active"));
		nav.style.setProperty("--fil-debut", `${debut}px`);
		nav.style.setProperty("--fil-long", `${Math.max(0, centre(liste[liste.length - 1]) - debut)}px`);
		nav.style.setProperty("--fil-rempli", `${courante ? Math.max(0, centre(courante) - debut) : 0}px`);
	};

	const evaluer = (): void => {
		if (!nav) return;
		const n = perles().length;
		const besoin = n * PLEINE + Math.max(0, n - 1) * ECART + EXTRA_COURANTE + MARGE;
		nav.classList.toggle("is-compacte", besoin > nav.clientWidth);
		if (!compacte()) for (const el of perles()) el.style.removeProperty("--zoom");
		placerFil();
	};

	/* La perle la plus proche du pointeur prend la taille pleine, ses
	   voisines une part décroissante ; toutes les autres redeviennent des
	   points. Hors du compact, ou pointeur parti : plus aucune loupe. */
	const appliquerLoupe = (): void => {
		image = 0;
		const liste = perles();
		if (!compacte() || pointeurX === null) {
			for (const el of liste) el.style.removeProperty("--zoom");
			placerFil();
			return;
		}
		let proche = -1;
		let meilleure = Infinity;
		liste.forEach((el, i) => {
			const r = el.getBoundingClientRect();
			const d = Math.abs(r.left + r.width / 2 - (pointeurX as number));
			if (d < meilleure) { meilleure = d; proche = i; }
		});
		liste.forEach((el, i) => {
			const z = LOUPE[Math.abs(i - proche)];
			if (z) el.style.setProperty("--zoom", String(z));
			else el.style.removeProperty("--zoom");
		});
		placerFil();
	};
	const demanderLoupe = (): void => {
		if (!image) image = requestAnimationFrame(appliquerLoupe);
	};

	const surMouvement = (e: PointerEvent): void => { pointeurX = e.clientX; demanderLoupe(); };
	const surSortie = (): void => { pointeurX = null; demanderLoupe(); };
	// Les perles changent de taille en 180 ms : le fil suit leur arrivée.
	const surFinTransition = (e: TransitionEvent): void => { if (e.propertyName === "width") placerFil(); };

	const surTaille = new ResizeObserver(() => evaluer());
	// La classe `active` passe d'une perle à l'autre à chaque navigation.
	const surClasses = new MutationObserver(() => placerFil());

	const attacher = (suivante: HTMLElement | null): void => {
		if (nav) {
			nav.removeEventListener("pointermove", surMouvement);
			nav.removeEventListener("pointerleave", surSortie);
			nav.removeEventListener("transitionend", surFinTransition);
			surTaille.unobserve(nav);
		}
		surClasses.disconnect();
		nav = suivante;
		pointeurX = null;
		if (!nav) return;
		nav.addEventListener("pointermove", surMouvement);
		nav.addEventListener("pointerleave", surSortie);
		nav.addEventListener("transitionend", surFinTransition);
		surTaille.observe(nav);
		surClasses.observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
		evaluer();
	};

	// La rangée est un enfant direct du conteneur du moteur : `childList` suffit.
	const surHote = new MutationObserver(() => {
		const suivante = hote.querySelector<HTMLElement>(":scope > .quiz-nav");
		if (suivante !== nav) attacher(suivante);
	});
	surHote.observe(hote, { childList: true });
	attacher(hote.querySelector<HTMLElement>(":scope > .quiz-nav"));

	return () => {
		surHote.disconnect();
		attacher(null);
		surTaille.disconnect();
		if (image) cancelAnimationFrame(image);
		image = 0;
	};
}
