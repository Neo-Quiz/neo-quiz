/* ══════════════════════════════════════════════════════════
   LA BARRE DE TITRE — style Neo Calendar

   Tâche 1 a posé `frame: false` : plus de barre native, plus de menu natif
   (`Menu.setApplicationMenu(null)`). Sans ce module la fenêtre n'a ni barre
   ni boutons — c'est lui qui les redessine, entièrement dans le rendu, et
   qui ouvre la cascade du menu d'application (`menu-app.ts`).

   Montée UNE SEULE FOIS au démarrage (`main.ts`), avant le premier écran :
   elle survit aux changements d'écran (coquille, réglages, écran vide),
   contrairement à eux qui se démontent et se remontent.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { pont } from "../host/pont";
import { poserIcone } from "../host/ui";
import { poserGlyphe } from "./glyphes-fenetre";
import { ouvrirMenuApp } from "./menu-app";
import { palierZoomVoisin } from "./menu-app-arbre";
import { createZoomBubble } from "./zoom-bubble";
import { CLE_REGLAGES_ZOOM } from "../../electron/pont";
import type { EtatFenetre } from "../../electron/pont";
import application from "../../package.json";
// L'URL du dépôt, pour l'entrée « Source code » du menu d'application.
import manifeste from "../../../../src/assets/manifest.json";

/** Table id de menu → nom de commande d'édition (`pont().edition.commande`) :
    les six ids de `menu-app-arbre.ts` correspondent un à un aux six noms du
    contrat, mais la table reste EXPLICITE plutôt qu'un cast — un septième id
    ajouté un jour sans entrée ici doit rester silencieusement sans effet, pas
    planter le rendu. */
const COMMANDES_EDITION: Record<string, "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"> = {
	undo: "undo",
	redo: "redo",
	cut: "cut",
	copy: "copy",
	paste: "paste",
	"select-all": "selectAll",
};

/**
 * Construit la barre, l'ajoute en tout premier enfant de `root` (donc AVANT
 * `#neo-quiz-root`, son frère), et la câble au pont. Rend le démontage —
 * jamais appelé en pratique (la barre vit toute la vie de la fenêtre), posé
 * par cohérence avec le reste du code partagé (`abonner` de `mise-a-jour.ts`).
 */
export function monterBarreTitre(root: HTMLElement, deps: {
	ouvrirReglages(): void;
	fondSuivant(): void;
}): () => void {
	const barre = document.createElement("div");
	barre.className = "nq-barre";
	root.prepend(barre);

	const gauche = ajouter(barre, "div", "nq-barre-gauche");
	const boutonMenu = document.createElement("button");
	boutonMenu.type = "button";
	boutonMenu.className = "nq-barre-menu";
	boutonMenu.setAttribute("aria-label", t("app.titlebar.menu"));
	poserGlyphe(boutonMenu, "chevron-down");
	gauche.appendChild(boutonMenu);

	const glisse = ajouter(barre, "div", "nq-barre-glisse");

	const controles = ajouter(barre, "div", "nq-barre-controles");
	const boutonReduire = document.createElement("button");
	boutonReduire.type = "button";
	boutonReduire.className = "nq-barre-controle";
	boutonReduire.setAttribute("aria-label", t("app.titlebar.minimize"));
	poserGlyphe(boutonReduire, "minimize");

	const boutonAgrandir = document.createElement("button");
	boutonAgrandir.type = "button";
	boutonAgrandir.className = "nq-barre-controle";

	const boutonFermer = document.createElement("button");
	boutonFermer.type = "button";
	boutonFermer.className = "nq-barre-controle";
	boutonFermer.setAttribute("aria-label", t("app.titlebar.close"));
	poserGlyphe(boutonFermer, "close");

	controles.append(boutonReduire, boutonAgrandir, boutonFermer);

	/** Icône et libellés du bouton du milieu, selon l'état courant. */
	function poserAgrandirOuRestaurer(agrandie: boolean): void {
		const cle = agrandie ? "app.titlebar.restore" : "app.titlebar.maximize";
		boutonAgrandir.setAttribute("aria-label", t(cle));
		// Restaurer : le `copy` de Lucide à 16 px, exactement comme Neo Calendar.
		if (agrandie) poserIcone(boutonAgrandir, "copy"); else poserGlyphe(boutonAgrandir, "maximize");
	}
	poserAgrandirOuRestaurer(false);

	boutonReduire.addEventListener("click", () => { void pont().fenetre.reduire(); });
	boutonAgrandir.addEventListener("click", () => { void pont().fenetre.agrandirOuRestaurer(); });
	boutonFermer.addEventListener("click", () => { void pont().fenetre.fermer(); });

	function surDoubleClic(e: MouseEvent): void {
		if (e.target instanceof HTMLElement && e.target.closest("button")) return;
		void pont().fenetre.agrandirOuRestaurer();
	}
	glisse.addEventListener("dblclick", surDoubleClic);
	gauche.addEventListener("dblclick", surDoubleClic);

	/* ─── L'ÉTAT DE LA FENÊTRE : même patron que `mise-a-jour.ts`, la garde
	   `pousse` contre la course entre la lecture initiale (`etat()`) et un
	   événement déjà poussé par `surEtat` pendant l'aller-retour. ─── */
	let pousse = false;
	function appliquerEtat(e: EtatFenetre): void {
		barre.dataset.focused = String(e.focus);
		barre.dataset.maximized = String(e.agrandie);
		poserAgrandirOuRestaurer(e.agrandie);
	}
	const desabonnerFenetre = pont().fenetre.surEtat(e => {
		pousse = true;
		appliquerEtat(e);
	});
	void pont().fenetre.etat().then(e => {
		if (!pousse) appliquerEtat(e);
	});

	/* ─── THE CURRENT ZOOM: read once at mount, so that the check mark of
	   Display > Interface scale is right from the first opening. The main
	   process already applies it on `did-finish-load` (see `pont.ts`); this
	   read only serves the CHECK MARK and the zoom bubble, it applies
	   nothing. Its `.then` runs after `zoomBubble` below is created. ─── */
	let currentZoom = 1;
	void pont().reglages.lire(CLE_REGLAGES_ZOOM).then(v => {
		if (typeof v !== "number") return;
		currentZoom = v;
		zoomBubble.setApplied(v);
	});

	/* ─── EVERY ZOOM CHANGE GOES THROUGH HERE — wheel, menu and the bubble's
	   own buttons — so the bubble shows up whatever triggered the change,
	   and only one place talks to the main process. ─── */
	function setZoom(f: number): void {
		currentZoom = f;
		void pont().affichage.zoom(f);
		zoomBubble.show(f);
	}
	function stepZoom(direction: 1 | -1): void {
		const next = palierZoomVoisin(currentZoom, direction);
		// Already at the end of the list: nothing to ask the main process,
		// and the menu's check mark must not move either.
		if (Math.abs(next - currentZoom) < 0.001) return;
		setZoom(next);
	}
	const zoomBubble = createZoomBubble({ step: stepZoom, reset: () => setZoom(1) });

	/* ─── CTRL + WHEEL — a browser's zoom, on the SAME steps as the Interface
	   scale submenu (asked for on 2026-09-17). An Electron window does not do
	   it by itself: without this listener, Ctrl + wheel SCROLLS the page.

	   `passive: false` IS what makes `preventDefault` work: Chromium makes
	   `wheel` listeners passive by default, and a `preventDefault` there is
	   ignored with a console warning as the only sign.

	   THE DELTA ACCUMULATES, and a step only falls at the threshold. One wheel
	   notch is about a hundred pixels, so one step — as expected; a touchpad
	   pinch sends dozens of small deltas and would cross all eight steps in a
	   single gesture. The delta is first converted to pixels: the same wheel
	   may count in lines or pages (`deltaMode`), and three lines would never
	   have reached the threshold. */
	const PIXELS_PER_UNIT = [1, 16, 400]; // pixel, line, page
	const NOTCH_THRESHOLD = 50;
	let wheelTotal = 0;
	function onWheel(e: WheelEvent): void {
		if (!e.ctrlKey) return;
		e.preventDefault();
		wheelTotal += e.deltaY * (PIXELS_PER_UNIT[e.deltaMode] ?? 1);
		if (Math.abs(wheelTotal) < NOTCH_THRESHOLD) return;
		// UP (negative delta) zooms in: the browser's direction.
		const direction = wheelTotal < 0 ? 1 : -1;
		wheelTotal = 0;
		stepZoom(direction);
	}
	window.addEventListener("wheel", onWheel, { passive: false });

	let fermerMenu: (() => void) | null = null;
	boutonMenu.addEventListener("click", () => {
		if (fermerMenu) { fermerMenu(); fermerMenu = null; return; }
		fermerMenu = ouvrirMenuApp(boutonMenu, {
			version: application.version,
			zoom: () => currentZoom,
			executer(id, value) {
				if (id === "check-updates") {
					void pont().miseAJour.verifier();
					deps.ouvrirReglages();
				} else if (id === "settings") {
					deps.ouvrirReglages();
				} else if (id === "repo") {
					/* `window.open` et non une navigation : le principal REFUSE
					   toute navigation de premier niveau vers une autre origine
					   (elle donnerait `window.neo` à la page distante) et remet
					   au navigateur ce qui passe par `setWindowOpenHandler`
					   (`electron/main.ts`). C'est le même chemin qu'empruntait
					   le `<a target="_blank">` de l'ancienne section
					   « À propos ». */
					window.open(manifeste.helpUrl, "_blank", "noopener");
				} else if (id in COMMANDES_EDITION) {
					void pont().edition.commande(COMMANDES_EDITION[id]);
				} else if (id.startsWith("scale-") && typeof value === "number") {
					setZoom(value);
				} else if (id === "next-wallpaper") {
					deps.fondSuivant();
				} else if (id === "reload") {
					void pont().affichage.recharger();
				} else if (id === "fullscreen") {
					void pont().fenetre.pleinEcran();
				} else if (id === "devtools") {
					void pont().affichage.outilsDev();
				}
			},
		});
	});
	// Le menu se ferme lui-même (clic dehors, Échap, action) sans repasser par
	// ce bouton : `fermerMenu` resterait alors une fonction déjà consommée.
	// `ouvrirMenuApp` pose et retire `data-open` sur l'ancre ; on s'en sert
	// pour savoir si un second clic doit fermer ou rouvrir.
	function surFermetureMenu(): void {
		if (!boutonMenu.hasAttribute("data-open")) fermerMenu = null;
	}
	const observateurMenu = new MutationObserver(surFermetureMenu);
	observateurMenu.observe(boutonMenu, { attributes: true, attributeFilter: ["data-open"] });

	/* ─── LES RACCOURCIS SANS MENU NATIF ───
	   `Ctrl+,` et `Ctrl+Shift+B` seulement HORS champ (ce sont des raccourcis
	   d'application, pas d'édition) ; `F11`, `Ctrl+R`, `Ctrl+Alt+I` PARTOUT,
	   comme le ferait un accélérateur de menu natif — ils ne touchent aucun
	   champ. Les raccourcis d'ÉDITION (Ctrl+Z, Ctrl+C…) ne sont PAS interceptés
	   ici : natifs dans les champs, c'est `Édition >` qui les porte pour la
	   souris. */
	function surClavier(e: KeyboardEvent): void {
		const cible = e.target;
		const dansChamp = cible instanceof HTMLElement
			&& (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable);

		if (!dansChamp && e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ",") {
			e.preventDefault();
			deps.ouvrirReglages();
			return;
		}
		if (!dansChamp && e.ctrlKey && e.shiftKey && !e.altKey && e.key.toUpperCase() === "B") {
			e.preventDefault();
			deps.fondSuivant();
			return;
		}
		if (e.key === "F11") {
			e.preventDefault();
			void pont().fenetre.pleinEcran();
		} else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
			e.preventDefault();
			void pont().affichage.recharger();
		} else if (e.ctrlKey && !e.shiftKey && e.altKey && e.key.toLowerCase() === "i") {
			e.preventDefault();
			void pont().affichage.outilsDev();
		}
	}
	document.addEventListener("keydown", surClavier, true);

	return () => {
		desabonnerFenetre();
		observateurMenu.disconnect();
		document.removeEventListener("keydown", surClavier, true);
		window.removeEventListener("wheel", onWheel);
		zoomBubble.destroy();
		fermerMenu?.();
		barre.remove();
	};
}
