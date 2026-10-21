import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { lireLecture, paragraphes } from "../lecture-style";
import { lireCitations } from "../pdf-sources";
import { brancherCadres, htmlFrameMarkup } from "./html-frame";
import { htmlDeLecture } from "./html-frame-core";
import type { Accroche, FormeAccroche, LectureStylee, Retenir, TableauLecture } from "../lecture-style";

/* ══════════════════════════════════════════════════════════
   LE CORPS D'UNE LECTURE, SELON SON STYLE (2026-09-26)

   Spec : docs/superpowers/specs/2026-09-26-styles-de-lecture-design.md §3.
   Maquettes validées : B (page), E (étapes), R4 (tableau), R5 (cartes à
   retourner), R6 (récapitulatif coché).

   Sert l'ÉCRAN d'une lecture (`corpsLectureHtml`, engine/cards.ts) et la
   version légère d'une lecture sans écran, lue au-dessus de sa question
   hôte (`corpsLectureCourteHtml`, src/lecture-etape.ts) : le style décrit
   le CONTENU de l'élément `read`.

   PUR, et sans porte à lui : chaque texte passe par une fonction que
   l'appelant lui DONNE (`PortesLecture`), qui sont les portes du sanitizer
   (engine/sanitizer.ts) — `renderInlineText` pour une case, une étape ou
   une carte, le rendu markdown complet pour un paragraphe, et
   `stripInlineMarkdown` ré-échappé pour un attribut. Les seules balises
   écrites ici sont les nôtres, sans aucun texte de l'auteur non passé par
   une porte.

   AUCUN saut de ligne ni indentation dans le HTML produit : le contenu d'un
   support est en `white-space: break-spaces` (passage.css, pour garder
   l'indentation d'un extrait de code), et chaque retour à la ligne entre
   deux balises y deviendrait une ligne vide.
══════════════════════════════════════════════════════════ */

export interface PortesLecture {
	/** Texte markdown COMPLET (paragraphes, listes, code) → HTML sûr. */
	bloc(texte: string): string;
	/** Texte d'une ligne (case, étape courte, carte) → HTML sûr. */
	inline(texte: string): string;
	/** Texte destiné à un ATTRIBUT : marqueurs retirés, puis échappé. */
	attribut(texte: string): string;
}

export interface CorpsLecture {
	style: LectureStylee["style"];
	html: string;
}

/** The steps, as flowing paragraphs; `apres` (the interactive page) goes
    inside step `rang`, right after its text. No numbers and no rules between
    them (2026-10-14): a numbered list on every reading of every Learn was
    found exhausting to read, and a notion is not a procedure. */
function etapesHtml(items: string[], p: PortesLecture, rang = -1, apres = ""): string {
	return `<div class="quiz-lecture-etapes">${items.map((e, i) =>
		`<div class="quiz-lecture-etape"><div class="quiz-lecture-etape-texte">${p.bloc(e)}${i === rang ? apres : ""}</div></div>`
	).join("")}</div>`;
}

function tableauHtml(tab: TableauLecture, p: PortesLecture): string {
	const tete = tab.colonnes.length
		? `<thead><tr>${tab.colonnes.map((c, i) => `<th scope="col" class="quiz-lecture-col-${Math.min(i, 3)}">${p.inline(c)}</th>`).join("")}</tr></thead>`
		: "";
	const corps = `<tbody>${tab.lignes.map(l => `<tr>${l.map(c => `<td>${p.inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
	// L'enveloppe défile à l'horizontale si le tableau est trop large : jamais la carte.
	return `<div class="quiz-lecture-tableau-wrap"><table class="quiz-lecture-tableau">${tete}${corps}</table></div>`;
}

/* Lucide icons of the hook forms, inline like the recap's check mark. */
const ICONES_ACCROCHE: Record<FormeAccroche, string> = {
	analogie: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
	histoire: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
	image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
	mnemo: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
};

/* The translation key of each hook form, written out so `t()` is typed. */
const CLES_ACCROCHE: Record<FormeAccroche, TransKey> = {
	analogie: "engine.lecture.hook.analogie",
	histoire: "engine.lecture.hook.histoire",
	image: "engine.lecture.hook.image",
	mnemo: "engine.lecture.hook.mnemo",
};

/** The hook block: icon, label of its form, text through the inline door. */
function accrocheHtml(a: Accroche, p: PortesLecture): string {
	const icone = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES_ACCROCHE[a.forme]}</svg>`;
	return `<div class="quiz-lecture-accroche is-${a.forme}"><div class="quiz-lecture-accroche-tete">${icone}<span>${p.inline(t(CLES_ACCROCHE[a.forme]))}</span></div><div class="quiz-lecture-accroche-texte">${p.inline(a.texte)}</div></div>`;
}

function retenirHtml(r: Retenir, p: PortesLecture): string {
	const titre = `<div class="quiz-lecture-retenir-titre">${p.inline(t("engine.lecture.keyPoints"))}</div>`;
	if (r.forme === "recap") {
		return `<div class="quiz-lecture-recap">${titre}<ul>${r.items.map(it =>
			`<li><span class="quiz-lecture-coche" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span>${p.inline(it)}</span></li>`
		).join("")}</ul></div>`;
	}
	/* Cartes à retourner : de vrais <button>, donc Entrée et Espace au
	   clavier sans rien de plus, et un état annoncé (`aria-pressed`). Le
	   libellé lu dit le recto, puis le recto et le verso une fois retournée
	   (`brancherCartes` ci-dessous échange les deux). */
	return `<div class="quiz-lecture-cartes-bloc">${titre}<div class="quiz-lecture-cartes">${r.items.map(c => {
		const fermee = p.attribut(t("engine.lecture.flipAria", { front: c.recto }));
		const ouverte = p.attribut(t("engine.lecture.flippedAria", { front: c.recto, back: c.verso }));
		return `<button type="button" class="quiz-lecture-carte" aria-pressed="false" aria-label="${fermee}" data-aria-ferme="${fermee}" data-aria-ouvert="${ouverte}"><span class="quiz-lecture-carte-in" aria-hidden="true"><span class="quiz-lecture-face is-recto"><span>${p.inline(c.recto)}</span></span><span class="quiz-lecture-face is-verso"><span>${p.inline(c.verso)}</span></span></span></button>`;
	}).join("")}</div><div class="quiz-lecture-indice"><span class="quiz-lecture-indice-clic">${p.inline(t("engine.lecture.flipHint"))}</span><span class="quiz-lecture-indice-tap">${p.inline(t("engine.lecture.flipHintTouch"))}</span></div></div>`;
}

/**
 * Le corps stylé d'une lecture.
 * @param item l'élément `read` brut (ses champs `lecture`, `etapes`, `tableau`, `retenir`).
 * @param brut son texte (`prompt`), pour le découpage en étapes.
 * @param texteHtml le HTML DÉJÀ sûr de ce texte (prompt rendu, ou `promptHtml` assaini).
 * @param titre le titre à écrire EN TÊTE de la page (cours déplié au-dessus
 *   d'une question, maquette B) ; absent pour une lecture autonome, dont la
 *   carte porte déjà le titre.
 */
export function corpsLectureHtml(item: unknown, brut: string, texteHtml: string, titre: string | undefined, p: PortesLecture, numero?: number): CorpsLecture {
	return rendre(item, brut, texteHtml, titre, p, false, numero);
}

/**
 * La version LÉGÈRE d'une lecture COURTE (src/lecture-etape.ts
 * `estLectureCourte`), lue au-dessus de sa question hôte : le même style
 * (texte, étapes, tableau, « À retenir »), sans titre ni lettrine, sans
 * surface — lecture.css `.quiz-lecture--courte`.
 */
export function corpsLectureCourteHtml(item: unknown, brut: string, texteHtml: string, p: PortesLecture): CorpsLecture {
	return rendre(item, brut, texteHtml, undefined, p, true);
}

function rendre(item: unknown, brut: string, texteHtml: string, titre: string | undefined, p: PortesLecture, courte: boolean, numero?: number): CorpsLecture {
	const l = lireLecture(item);
	let corps: string;
	let pageApres = "";
	let pagePlacee = false;
	if (l.style === "etapes") {
		/* Les étapes ÉCRITES, avec le texte en introduction ; à défaut, les
		   paragraphes du texte deviennent les étapes (spec §2). */
		const ecrites = l.etapes.length > 0;
		const items = ecrites ? l.etapes : paragraphes(brut);
		/* The interactive page sits RIGHT UNDER the step that holds the code
		   (2026-10-14): it acts on that code, which stays in view, instead of
		   at the end of the reading, far from it. */
		const rangCode = courte ? -1 : items.findIndex(e => e.includes("```"));
		if (rangCode >= 0) { pageApres = pageInteractive(item, titre); pagePlacee = pageApres !== ""; }
		corps = items.length
			? `${ecrites && texteHtml.trim() ? `<div class="quiz-lecture-intro">${texteHtml}</div>` : ""}${etapesHtml(items, p, rangCode, pageApres)}`
			: `<div class="quiz-lecture-texte">${texteHtml}</div>`;
	} else if (l.style === "tableau" && l.tableau) {
		corps = `${texteHtml.trim() ? `<div class="quiz-lecture-intro">${texteHtml}</div>` : ""}${tableauHtml(l.tableau, p)}`;
	} else if (l.style === "tableau") {
		// Un tableau annoncé mais absent ou vide : le texte, simplement.
		corps = `<div class="quiz-lecture-texte">${texteHtml}</div>`;
	} else {
		/* Plus de « Environ N minutes de lecture » (retour #8 du 2026-09-26) :
		   une étape de cours n'est pas un article. */
		corps = `<div class="quiz-lecture-texte">${texteHtml}</div>`;
	}
	const retenir = l.retenir ? retenirHtml(l.retenir, p) : "";
	/* The reading opens with the number of its step, the one on its bead in
	   the row above (2026-10-14): the course reads as numbered parts, and the
	   bead and the page say the same number. */
	const num = numero !== undefined && Number.isInteger(numero) && numero > 0 ? `<span class="quiz-lecture-numero" aria-hidden="true">${numero}</span>` : "";
	const tete = titre && titre.trim() ? `<h3 class="quiz-lecture-titre">${num}${p.inline(titre)}</h3>` : "";
	const accroche = !courte && l.accroche ? accrocheHtml(l.accroche, p) : "";
	/* Where the reading comes from ("cite", 2026-09-30): the document and its
	   pages, written by the generator — the original to read again. */
	const cite = (item as { cite?: unknown } | null)?.cite;
	const source = typeof cite === "string" && cite.trim()
		? `<div class="quiz-lecture-source"${citeOuvrable(cite) ? ` data-cite="${p.attribut(cite.trim())}" role="button" tabindex="0"` : ""}>${p.inline(t("engine.lecture.source", { source: cite.trim() }))}</div>`
		: "";
	return { style: l.style, html: `<div class="quiz-lecture quiz-lecture--${l.style}${courte ? " quiz-lecture--courte" : ""}">${tete}${accroche}${courte ? "" : figureHtml(item, p)}${corps}${courte || pagePlacee ? "" : pageInteractive(item, titre)}${retenir}${source}</div>` };
}

/** The reading's interactive page (`html`, 2026-10-09): a complete HTML page in
    a sandboxed iframe (html-frame-core.ts), under the text. Never in the
    short version read above a question. */
function pageInteractive(item: unknown, titre: string | undefined): string {
	const source = htmlDeLecture(item);
	return source === null ? "" : htmlFrameMarkup(source, titre ?? "");
}

/** Does this `cite` name a PDF the viewer can open? Then the line is a button. */
function citeOuvrable(cite: string): boolean {
	return lireCitations(cite).length > 0;
}

/** The reading's FIGURE (2026-10-08): its `passage` (a diagram drawn from the
    course, dashboard/figures.ts, or a picture an author put there) shown
    INSIDE the reading, under its title, and no longer in a framed card of
    its own above it. Its title is a caption, unless it only repeats the
    source line. `null` without a text `passage` (a shared `passageId` or a
    `passageHtml` keeps the document card: engine/cards.ts). */
export function figureDeLecture(item: unknown): string | null {
	const r = item as { passage?: unknown; passageHtml?: unknown; passageId?: unknown } | null;
	if (!r || typeof r.passage !== "string" || !r.passage.trim()) return null;
	if (typeof r.passageHtml === "string" && r.passageHtml.trim()) return null;
	if (typeof r.passageId === "string" && r.passageId.trim()) return null;
	return r.passage;
}

function figureHtml(item: unknown, p: PortesLecture): string {
	const passage = figureDeLecture(item);
	if (passage === null) return "";
	const r = item as { passageTitle?: unknown; cite?: unknown };
	const titre = typeof r.passageTitle === "string" ? r.passageTitle.trim() : "";
	const cite = typeof r.cite === "string" ? r.cite.trim() : "";
	const legende = titre && titre !== cite ? `<figcaption class="quiz-lecture-legende">${p.inline(titre)}</figcaption>` : "";
	return `<figure class="quiz-lecture-figure">${p.bloc(passage)}${legende}</figure>`;
}

/**
 * Branche les cartes à retourner d'un sous-arbre : un clic (ou Entrée,
 * Espace — c'est un bouton) les retourne et les remet. Idempotent : une
 * carte déjà branchée ne l'est pas deux fois, sans quoi deux écouteurs
 * s'annuleraient et la carte ne tournerait plus.
 */
export function brancherCartes(racine: ParentNode): void {
	// The interactive pages (iframes) of the same subtree share this entry point.
	brancherCadres(racine);
	racine.querySelectorAll<HTMLButtonElement>(".quiz-lecture-carte").forEach(btn => {
		if (btn.dataset.branchee === "1") return;
		btn.dataset.branchee = "1";
		btn.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const ouverte = btn.getAttribute("aria-pressed") !== "true";
			btn.setAttribute("aria-pressed", ouverte ? "true" : "false");
			btn.classList.toggle("is-retournee", ouverte);
			btn.setAttribute("aria-label", (ouverte ? btn.dataset.ariaOuvert : btn.dataset.ariaFerme) || "");
		});
	});
}
