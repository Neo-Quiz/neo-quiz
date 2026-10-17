import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { currentLang, t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";

/* ══════════════════════════════════════════════════════════
   THE GENERATED QUIZZES, A GALLERY INSIDE THE AI PAGE (2026-10-17)

   "Generated quizzes" in the AI page's side column no longer leaves for the
   Folders page: like "Artifacts" on claude.ai, the side column stays, its
   entry is highlighted, and the page shows a title over a grid of cards. A
   card is a preview (its kind, its title, what it holds) above its name and
   the date it was last changed; a click opens the quiz. Most recent first.
══════════════════════════════════════════════════════════ */

export interface GeneratedGalleryDeps {
	quizzes: readonly QuizIndexEntry[];
	open: (quiz: QuizIndexEntry) => void;
	now?: number;
}

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
	const tries = [...deps.quizzes].sort((a, b) => b.mtime - a.mtime);
	if (!tries.length) {
		ajouter(page, "p", "qbd-gen-empty", t("ai.gallery.empty"));
		return;
	}
	const grille = ajouter(page, "div", "qbd-gen-grid");
	for (const q of tries) {
		const carte = ajouter(grille, "button", "qbd-gen-card");
		carte.type = "button";
		carte.setAttribute("aria-label", q.title);
		// The preview: the kind as a small label, the title large, what it holds.
		const apercu = ajouter(carte, "div", "qbd-gen-preview is-" + q.mode);
		ajouter(apercu, "span", "qbd-gen-kind", t(q.mode === "learn" ? "ai.gallery.kindLearn" : "ai.gallery.kindTest"));
		ajouter(apercu, "span", "qbd-gen-preview-title", q.title);
		const contenu: string[] = [t(q.questions === 1 ? "ai.gallery.question" : "ai.gallery.questions", { n: String(q.questions) })];
		if (q.readings) contenu.push(t(q.readings === 1 ? "ai.gallery.reading" : "ai.gallery.readings", { n: String(q.readings) }));
		if (q.minutes) contenu.push(t("ai.gallery.minutes", { n: String(q.minutes) }));
		ajouter(apercu, "span", "qbd-gen-preview-meta", contenu.join(" · "));
		const pied = ajouter(carte, "div", "qbd-gen-foot");
		host.ui.setIcon(ajouter(pied, "span", "qbd-gen-foot-icon"), q.mode === "learn" ? "book-open" : "list-checks");
		const textes = ajouter(pied, "div", "qbd-gen-foot-text");
		ajouter(textes, "span", "qbd-gen-name", q.title);
		ajouter(textes, "span", "qbd-gen-date", modifie(q.mtime, now));
		carte.addEventListener("click", () => deps.open(q));
	}
}
