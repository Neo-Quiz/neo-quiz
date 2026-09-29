/* ══════════════════════════════════════════════════════════
   LE MENU D'APPLICATION — la cascade

   Portale un empilement de panneaux `position: fixed` au `body`, un par
   niveau ouvert (premier sous l'ancre, chaque sous-menu à droite de sa
   ligne). L'arbre vient de `menu-app-arbre.ts` (pur) ; ce module ne fait que
   le poser à l'écran et router le clic/clavier vers `deps.executer`.

   Même geste que `ui-select.ts` (portail au `body`, fermeture clic-dehors /
   Échap) mais un fichier séparé : `ui-select.ts` est du code PARTAGÉ, une
   cascade à plusieurs niveaux avec navigation clavier au clavier lui est
   étrangère, et le dupliquer ici évite d'alourdir un module que le greffon
   charge aussi.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../../../../src/dom";
import { buildMenu } from "./menu-app-arbre";
import type { EntreeMenu } from "./menu-app-arbre";
import { poserIcone } from "../host/ui";

export interface ActionsMenu {
	version: string;
	zoom(): number;
	executer(id: string, value?: number): void;
}

/** Un niveau ouvert de la cascade : le panneau posé à l'écran et l'index de
    la ligne active au clavier (-1 : rien de survolé/focalisé). */
interface Panneau {
	entrees: EntreeMenu[];
	el: HTMLElement;
	lignes: HTMLButtonElement[];
	actif: number;
}

/**
 * Ouvre le menu d'application ancré sous `ancre`. Rend la fonction de
 * fermeture ; `ancre` porte `data-open` tant que le menu est ouvert (la
 * barre s'en sert pour teinter le chevron).
 */
export function ouvrirMenuApp(ancre: HTMLElement, deps: ActionsMenu): () => void {
	const arbre = buildMenu({ version: deps.version, zoom: deps.zoom() });

	const couche = document.createElement("div");
	couche.className = "nq-menu-couche";
	document.body.appendChild(couche);
	ancre.setAttribute("data-open", "");

	const panneaux: Panneau[] = [];

	/* THE MENU DOES NOT ZOOM, like the bar it opens from (shell.css,
	   2026-09-29): its layer cancels the page zoom, so its panels are placed
	   in SCREEN pixels. Every page measure (a rect, the window's size) is
	   brought to screen pixels by the zoom the page actually has. */
	const zoom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nq-zoom")) || 1;
	const ecran = (px: number): number => px * zoom;

	function fermer(): void {
		document.removeEventListener("keydown", surClavier, true);
		window.removeEventListener("blur", fermer);
		ancre.removeAttribute("data-open");
		couche.remove();
	}

	/** Retire tous les panneaux à partir du niveau `depuis` (inclus). */
	function fermerDepuis(depuis: number): void {
		while (panneaux.length > depuis) {
			panneaux.pop()!.el.remove();
		}
	}

	/** Positionne un panneau déjà construit, rabattu dans la fenêtre s'il
	    déborde à droite ou en bas. */
	function positionner(el: HTMLElement, left: number, top: number): void {
		// Posé hors écran d'abord pour lire sa taille réelle, puis rabattu.
		el.style.left = "-9999px";
		el.style.top = "-9999px";
		couche.appendChild(el);
		const taille = el.getBoundingClientRect();
		const largeur = ecran(taille.width), hauteur = ecran(taille.height);
		const l = Math.max(4, Math.min(left, ecran(window.innerWidth) - largeur - 4));
		const h = Math.max(4, Math.min(top, ecran(window.innerHeight) - hauteur - 4));
		el.style.left = `${l}px`;
		el.style.top = `${h}px`;
	}

	/** Construit et pose le panneau du niveau `niveau` pour `entrees`, à la
	    position donnée. Ferme d'abord tout niveau plus profond. */
	function ouvrirNiveau(niveau: number, entrees: EntreeMenu[], left: number, top: number): void {
		fermerDepuis(niveau);

		const panneau = document.createElement("div");
		panneau.className = "nq-menu-panneau";
		const lignes: HTMLButtonElement[] = [];

		for (const entree of entrees) {
			if (entree.kind === "separator") {
				ajouter(panneau, "div", "nq-menu-separateur");
				continue;
			}
			if (entree.kind === "about") {
				/* The version, "Check for updates" and the GitHub mark on ONE
				   row. Only "Check for updates" is a keyboard line (`lignes`):
				   the arrows go from row to row, and the mark stays a click
				   away, named for screen readers. */
				const rangee = ajouter(panneau, "div", "nq-menu-apropos");
				// "v1.19.0", as a version reads on a release page.
				ajouter(rangee, "span", "nq-menu-apropos-version", `v${entree.version}`);
				const verifier = document.createElement("button");
				verifier.type = "button";
				verifier.className = "nq-menu-apropos-verifier";
				verifier.textContent = entree.checkLabel;
				verifier.addEventListener("click", () => activer(entree, verifier));
				verifier.addEventListener("mouseenter", () => {
					panneau_focaliser(lignes.indexOf(verifier));
					fermerDepuis(niveau + 1);
				});
				const depot = document.createElement("button");
				depot.type = "button";
				depot.className = "nq-menu-apropos-github";
				// No `title`: Windows' native tooltip looked out of place in the
				// menu; the mark speaks for itself, its name stays for a
				// screen reader.
				depot.setAttribute("aria-label", entree.repoLabel);
				depot.append(marqueGithub());
				depot.addEventListener("click", () => { deps.executer("repo"); fermer(); });
				// The mark takes the focus on hover, as a line does: one
				// highlighted target at a time, never "Check for updates" left
				// lit while the pointer is on the mark.
				depot.addEventListener("mouseenter", () => { depot.focus(); fermerDepuis(niveau + 1); });
				rangee.append(verifier, depot);
				lignes.push(verifier);
				continue;
			}

			const ligne = document.createElement("button");
			ligne.type = "button";
			ligne.className = "nq-menu-ligne";

			const coche = ajouter(ligne, "span", "nq-menu-coche");
			if (entree.kind === "check" && entree.checked) poserIcone(coche, "check");

			ajouter(ligne, "span", "nq-menu-libelle", entree.label);

			if (entree.kind === "action" || entree.kind === "check") {
				const raccourci = "shortcut" in entree ? entree.shortcut : undefined;
				if (raccourci) ajouter(ligne, "span", "nq-menu-raccourci", raccourci);
			}

			if (entree.kind === "submenu") {
				ligne.setAttribute("aria-expanded", "false");
				const chevron = ajouter(ligne, "span", "nq-menu-chevron");
				poserIcone(chevron, "chevron-right");
			}

			if (entree.kind === "action" && entree.disabled) ligne.disabled = true;

			ligne.addEventListener("click", () => activer(entree, ligne));
			ligne.addEventListener("mouseenter", () => {
				panneau_focaliser(lignes.indexOf(ligne));
				if (entree.kind === "submenu") ouvrirSousMenu(niveau, entree, ligne);
				else fermerDepuis(niveau + 1);
			});

			panneau.appendChild(ligne);
			lignes.push(ligne);
		}

		positionner(panneau, left, top);
		panneaux[niveau] = { entrees, el: panneau, lignes, actif: -1 };
	}

	function panneau_focaliser(index: number): void {
		const p = panneaux[panneaux.length - 1];
		if (!p) return;
		p.actif = index;
		for (const [i, l] of p.lignes.entries()) {
			if (i === index) l.focus();
		}
	}

	function ouvrirSousMenu(niveauParent: number, entree: EntreeMenu & { kind: "submenu" }, ligneEl: HTMLElement): void {
		panneaux[niveauParent].lignes.forEach(l => l.removeAttribute("aria-expanded"));
		ligneEl.setAttribute("aria-expanded", "true");
		const rect = ligneEl.getBoundingClientRect();
		ouvrirNiveau(niveauParent + 1, entree.items, ecran(rect.right) - 4, ecran(rect.top) - 12);
	}

	function activer(entree: EntreeMenu, ligneEl: HTMLElement): void {
		if (entree.kind === "submenu") {
			ouvrirSousMenu(panneaux.length - 1, entree, ligneEl);
			return;
		}
		if (entree.kind === "action" && entree.disabled) return;
		if (entree.kind === "about") {
			deps.executer("check-updates");
			fermer();
		} else if (entree.kind === "action") {
			deps.executer(entree.id);
			fermer();
		} else if (entree.kind === "check") {
			deps.executer(entree.id, entree.value);
			fermer();
		}
	}

	function surClavier(e: KeyboardEvent): void {
		if (e.key === "Escape") { e.preventDefault(); fermer(); return; }
		const p = panneaux[panneaux.length - 1];
		if (!p) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			panneau_focaliser((p.actif + 1 + p.lignes.length) % p.lignes.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			panneau_focaliser((p.actif - 1 + p.lignes.length) % p.lignes.length);
		} else if (e.key === "ArrowRight") {
			const entree = p.entrees.filter(x => x.kind !== "separator")[p.actif];
			if (entree && entree.kind === "submenu") {
				e.preventDefault();
				ouvrirSousMenu(panneaux.length - 1, entree, p.lignes[p.actif]);
				panneau_focaliser(0);
			}
		} else if (e.key === "ArrowLeft") {
			if (panneaux.length > 1) {
				e.preventDefault();
				fermerDepuis(panneaux.length - 1);
			}
		} else if (e.key === "Enter") {
			if (p.actif >= 0) {
				e.preventDefault();
				const entree = p.entrees.filter(x => x.kind !== "separator")[p.actif];
				if (entree) activer(entree, p.lignes[p.actif]);
			}
		}
	}

	couche.addEventListener("mousedown", (e) => {
		if (e.target === couche) fermer();
	});
	document.addEventListener("keydown", surClavier, true);
	window.addEventListener("blur", fermer);

	const rectAncre = ancre.getBoundingClientRect();
	ouvrirNiveau(0, arbre, ecran(rectAncre.left), ecran(rectAncre.bottom) + 4);

	return fermer;
}

/** GitHub's mark (Octicons `mark-github`, MIT), filled with `currentColor`:
    Lucide no longer ships brand icons. Built node by node, no markup. */
function marqueGithub(): SVGSVGElement {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS(NS, "path");
	path.setAttribute("d", "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z");
	svg.append(path);
	return svg;
}
