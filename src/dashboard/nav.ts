import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx, DashboardViewName } from "../types/dashboard-ctx";

/* ══════════════════════════════════════════════════════════
   NAVIGATION SIDEBAR — Dashboard
   Sidebar avec brand et nav items stylisés.
══════════════════════════════════════════════════════════ */

/* NAV_ITEMS porte une CLÉ de traduction, pas un libellé : la liste est
   construite une seule fois (à l'ouverture de la vue), alors que le libellé
   doit suivre la langue courante à CHAQUE rendu — un `label: string` figé ici
   resterait dans la langue du démarrage après un changement de réglage. */
interface NavItem {
	key: Exclude<DashboardViewName, "detail">;
	labelKey: TransKey;
	icon: string;
}

export interface NavHandlers {
	render(container: HTMLElement): void;
	setActive(key: DashboardViewName): void;
}

export function createNavHandlers(ctx: DashboardShellCtx): NavHandlers {
	let activeNav: DashboardViewName = "home";
	/* Boutons du rendu COURANT. setActive bascule la classe active sur ces
	   nœuds VIVANTS au lieu de laisser la vue reconstruire le rail : sans ça
	   le bouton cliqué est un élément neuf, né déjà actif — la transition
	   fond/couleur du CSS n'a aucun état de départ à interpoler et la carte
	   claire apparaît d'un coup. */
	let buttons: { key: DashboardViewName; el: HTMLElement }[] = [];

	function paintActive(): void {
		for (const b of buttons) b.el.classList.toggle("qbd-nav-item--active", b.key === activeNav);
	}

	const NAV_ITEMS: NavItem[] = [
		{ key: "home", labelKey: "dashboard.nav.home", icon: "home" },
		// Named "Folders" since 2026-09-29 (formerly "My quizzes", "library"
		// icon): the page opens on a grid of folders, so the rail names what
		// the user actually sees there.
		{ key: "quizzes", labelKey: "dashboard.nav.quizzes", icon: "folders" },
		{ key: "ai", labelKey: "dashboard.nav.generate", icon: "sparkles" }
	];

	function render(container: HTMLElement): void {
		container.replaceChildren();

		/* Plus de logo en tête du rail (retiré le 2026-09-23) : il ne menait
		   nulle part et ressemblait à un bouton. Le rail commence par Accueil. */

		// Nav items
		const navList = ajouter(container, "div", "qbd-nav-items");
		buttons = [];

		for (const item of NAV_ITEMS) {
			// Une entrée que l'hôte ne sait pas encore ouvrir (ex. « Générer »
			// côté application avant la tranche 4) reste VISIBLE mais inerte —
			// une barre qui change de forme entre deux hôtes se remarque plus
			// qu'une entrée manifestement à venir.
			const disabled = !ctx.canOpen(item.key);
			const cls = [
				"qbd-nav-item",
				activeNav === item.key ? "qbd-nav-item--active" : "",
				disabled ? "qbd-nav-item--disabled" : "",
			].filter(Boolean).join(" ");
			const btn = ajouter(navList, "button", cls);
			// La clé sur le bouton : c'est par elle que le CSS anime l'icône
			// « Générer » pendant une génération (`qbd-generating` sur la
			// racine du document, posé par `ai.ts`), sans que le rail ait à
			// connaître la page.
			btn.dataset.nav = item.key;
			buttons.push({ key: item.key, el: btn });

			const iconWrap = ajouter(btn, "span", "qbd-nav-icon");
			currentHost().ui.setIcon(iconWrap, item.icon);

			ajouter(btn, "span", "qbd-nav-label", t(item.labelKey));

			if (disabled) {
				btn.disabled = true;
				btn.title = t("dashboard.nav.soon");
			}

			btn.addEventListener("click", () => {
				activeNav = item.key;
				paintActive();
				ctx.navigate(item.key);
			});
		}

		// Réglages : en PIED de rail (pattern StudySmarter), hors de la liste
		// de navigation — délègue à l'hôte (ctx.openSettings) : sous Obsidian,
		// l'onglet du plugin dans les réglages ; l'application ouvrira sa
		// propre page Réglages.
		const footer = ajouter(container, "div", "qbd-nav-footer");
		const settingsBtn = ajouter(footer, "button", "qbd-nav-item");
		const settingsIcon = ajouter(settingsBtn, "span", "qbd-nav-icon");
		currentHost().ui.setIcon(settingsIcon, "settings");
		ajouter(settingsBtn, "span", "qbd-nav-label", t("dashboard.nav.settings"));
		settingsBtn.addEventListener("click", () => { ctx.openSettings(); });
	}

	function setActive(key: DashboardViewName): void {
		activeNav = key;
		// Navigation qui ne vient PAS d'un clic du rail (historique souris,
		// ouverture d'un détail, retour) : le rail doit suivre, en animant.
		paintActive();
	}

	return { render, setActive };
}
