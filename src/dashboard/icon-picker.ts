import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { MODULE_ICONS } from "./module-icons";

/* ══════════════════════════════════════════════════════════
   ICON PICKER — sélecteur d'icône Lucide pour la carte de module
   (« Modifier dossier »). Portalé au MODAL (comme color-picker) →
   pas de vol de focus. Trois zones : une barre de RECHERCHE (accès à
   TOUTES les icônes via le catalogue de l'hôte), une section « Suggérées »
   (icônes proposées d'après le module, cf. icon-suggest.ts) et une
   grille curée par défaut. Un clic émet onChange + ferme.
══════════════════════════════════════════════════════════ */

const COLS = 6;
const CELL = 34;
const GAP = 4;
const PAD = 10;
const PICKER_W = COLS * CELL + (COLS - 1) * GAP + 2 * PAD;
const SCROLL_MAX = 260;
/* Hauteur totale bornée pour le clamp au viewport : recherche + scroll + pads. */
const PICKER_H = 44 + SCROLL_MAX + 2 * PAD;

/** Tout le set d'icônes disponible (Lucide + custom), normalisé et trié —
    calculé une fois. Les noms sont déjà nus (sans préfixe « lucide- ») : le
    contrat de l'hôte le garantit, cf. `HostUi.iconNames()`. */
let ALL_ICONS: string[] | null = null;
function allIcons(): string[] {
	if (ALL_ICONS) return ALL_ICONS;
	const seen = new Set<string>();
	// Le retrait du préfixe « lucide- » a déménagé dans chaque hôte : le
	// contrat promet des noms nus, et l'appelant n'a plus à y penser.
	for (const id of currentHost().ui.iconNames()) seen.add(id);
	ALL_ICONS = [...seen].sort();
	return ALL_ICONS;
}

export interface IconPickerHandle {
	close(): void;
}

export function openIconPicker(
	anchorEl: HTMLElement,
	current: string | undefined,
	onChange: (icon: string) => void,
	container: HTMLElement = document.body,
	suggestions: string[] = []
): IconPickerHandle {
	const anchorRect = anchorEl.getBoundingClientRect();

	const root = ajouter(container, "div", "qbd-icon-picker");
	root.style.width = PICKER_W + "px";
	root.addEventListener("mousedown", (e) => e.stopPropagation());

	// ── Position clampée au viewport, flip au-dessus si trop bas ──
	let top = anchorRect.bottom + 6;
	if (top + PICKER_H > window.innerHeight - 8)
		top = Math.max(8, anchorRect.top - PICKER_H - 6);
	const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 8 - PICKER_W));
	root.style.top = top + "px";
	root.style.left = left + "px";

	// ── Barre de recherche ──
	const searchWrap = ajouter(root, "div", "qbd-icon-search-wrap");
	const searchIcon = ajouter(searchWrap, "span", "qbd-icon-search-icon");
	currentHost().ui.setIcon(searchIcon, "search");
	const search = ajouter(searchWrap, "input", "qbd-icon-search");
	search.type = "text";
	search.placeholder = t("dashboard.quizzes.moduleIconSearch");
	search.spellcheck = false;

	// ── Zone scrollable (sections) ──
	const scroll = ajouter(root, "div", "qbd-icon-scroll");
	scroll.style.maxHeight = SCROLL_MAX + "px";

	const cellFor = (grid: HTMLElement, name: string) => {
		const cell = ajouter(grid, "button", "qbd-icon-cell");
		cell.type = "button";
		currentHost().ui.setIcon(cell, name);
		cell.setAttribute("aria-label", name);
		if (name === current) cell.classList.add("is-active");
		cell.addEventListener("click", () => { onChange(name); close(); });
	};
	const section = (label: string | null, icons: string[]) => {
		if (label) ajouter(scroll, "div", "qbd-icon-section-label", label);
		const grid = ajouter(scroll, "div", "qbd-icon-grid");
		for (const name of icons) cellFor(grid, name);
	};

	function render(query: string): void {
		scroll.replaceChildren();
		const q = query.trim().toLowerCase();
		if (!q) {
			// Vue par défaut : suggestions (si module reconnu) + grille curée.
			if (suggestions.length) section(t("dashboard.quizzes.moduleIconSuggested"), suggestions);
			section(suggestions.length ? t("dashboard.quizzes.moduleIconAll") : null, MODULE_ICONS);
			return;
		}
		// Recherche : tout le set Lucide, borné pour la perf.
		const hits = allIcons().filter(n => n.includes(q)).slice(0, 60);
		if (hits.length) section(null, hits);
		else ajouter(scroll, "div", "qbd-icon-empty", t("dashboard.quizzes.moduleIconNoResult"));
	}
	render("");
	search.addEventListener("input", () => render(search.value));

	// ── Dismiss clic-dehors / Escape ──
	const onDocDown = (e: MouseEvent) => {
		if (!root.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocDown);
	document.addEventListener("keydown", onKey);

	function close(): void {
		document.removeEventListener("mousedown", onDocDown);
		document.removeEventListener("keydown", onKey);
		root.remove();
	}

	// Focus la recherche à l'ouverture (le picker est dans le modal → pas de vol).
	window.setTimeout(() => search.focus(), 0);
	return { close };
}
