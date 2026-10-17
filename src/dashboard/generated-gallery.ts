import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { currentLang, t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import { detecterCategorie } from "./categorie-quiz";
import { topicArt } from "./topic-art";

/* ══════════════════════════════════════════════════════════
   THE GENERATED QUIZZES, A GALLERY INSIDE THE AI PAGE (2026-10-17)

   Modelled on claude.ai's "Artifacts" page: a serif title, a row of tabs
   (All · Learn · Test) with the search field on the right, then a grid of
   cards, newest first. A card shows a flat illustration of the quiz's
   subject (`topic-art.ts`, like claude.ai's "Create" tiles), a small icon square
   straddling the preview's bottom edge, then the quiz's name and "Learn ·
   Modified 3 h ago". A click opens the quiz. The side column of the AI page
   stays on screen, its entry highlighted.
══════════════════════════════════════════════════════════ */

export interface GeneratedGalleryDeps {
	quizzes: readonly QuizIndexEntry[];
	open: (quiz: QuizIndexEntry) => void;
	now?: number;
}

type Onglet = "all" | "learn" | "test";
/** The tab and the search, kept while the app runs (the page repaints often). */
let onglet: Onglet = "all";
let recherche = "";
const plier = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Modified 2 h ago" under a day, "Modified Oct 12" after (the year when not this one). */
function modifie(ms: number, now: number): string {
	const heures = Math.floor((now - ms) / 3_600_000);
	if (heures >= 0 && heures < 24) return heures < 1 ? t("ai.gallery.modifiedJustNow") : t("ai.gallery.modifiedHoursAgo", { n: String(heures) });
	const d = new Date(ms);
	const date = new Intl.DateTimeFormat(currentLang() === "fr" ? "fr-FR" : "en-US",
		{ day: "numeric", month: "short", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }).format(d);
	return t("ai.gallery.modifiedOn", { date });
}

export function renderGeneratedGallery(parent: HTMLElement, deps: GeneratedGalleryDeps): void {
	const host = currentHost();
	const now = deps.now ?? Date.now();
	const page = ajouter(parent, "div", "qbd-gen-gallery");
	ajouter(page, "h1", "qbd-gen-title", t("ai.side.generated"));

	// Tabs on the left, the search on the right (claude.ai's toolbar).
	const barre = ajouter(page, "div", "qbd-gen-toolbar");
	const onglets = ajouter(barre, "div", "qbd-gen-tabs");
	onglets.setAttribute("role", "tablist");
	const cherche = ajouter(barre, "label", "qbd-gen-search");
	host.ui.setIcon(ajouter(cherche, "span", "qbd-gen-search-icon"), "search");
	const champ = ajouter(cherche, "input", "qbd-gen-search-input");
	champ.type = "search";
	champ.placeholder = t("ai.gallery.search");
	champ.setAttribute("aria-label", t("ai.gallery.search"));
	champ.value = recherche;

	const grille = ajouter(page, "div", "qbd-gen-grid");
	const vide = ajouter(page, "p", "qbd-gen-empty");
	const tries = [...deps.quizzes].sort((a, b) => b.mtime - a.mtime);

	const boutons = new Map<Onglet, HTMLButtonElement>();
	for (const [cle, libelle] of [["all", "ai.gallery.tabAll"], ["learn", "ai.gallery.kindLearn"], ["test", "ai.gallery.kindTest"]] as const) {
		const b = ajouter(onglets, "button", "qbd-gen-tab");
		b.type = "button";
		b.setAttribute("role", "tab");
		b.textContent = t(libelle);
		b.addEventListener("click", () => { onglet = cle; peindre(); });
		boutons.set(cle, b);
	}

	const peindre = (): void => {
		for (const [cle, b] of boutons) {
			b.classList.toggle("is-active", cle === onglet);
			b.setAttribute("aria-selected", String(cle === onglet));
		}
		grille.replaceChildren();
		const q = plier(recherche.trim());
		const visibles = tries.filter(x => (onglet === "all" || (onglet === "learn") === (x.mode === "learn")) && (!q || plier(x.title).includes(q)));
		vide.textContent = deps.quizzes.length === 0 ? t("ai.gallery.empty") : visibles.length === 0 ? t("ai.gallery.noMatch") : "";
		vide.hidden = visibles.length > 0;
		for (const x of visibles) carte(x);
	};

	const carte = (q: QuizIndexEntry): void => {
		const learn = q.mode === "learn";
		const c = ajouter(grille, "button", "qbd-gen-card");
		c.type = "button";
		c.setAttribute("aria-label", q.title);
		// The preview: a flat illustration of the quiz's subject (`topic-art.ts`).
		const apercu = ajouter(c, "div", "qbd-gen-preview");
		const sujet = detecterCategorie({ pieces: q.generated?.source ? [q.generated.source] : [], demande: q.title });
		apercu.appendChild(topicArt(sujet));
		host.ui.setIcon(ajouter(apercu, "span", "qbd-gen-badge"), learn ? "book-open" : "list-checks");
		const pied = ajouter(c, "div", "qbd-gen-foot");
		ajouter(pied, "span", "qbd-gen-name", q.title);
		ajouter(pied, "span", "qbd-gen-date", `${t(learn ? "ai.gallery.kindLearn" : "ai.gallery.kindTest")} · ${modifie(q.mtime, now)}`);
		c.addEventListener("click", () => deps.open(q));
	};

	champ.addEventListener("input", () => { recherche = champ.value; peindre(); });
	peindre();
}
