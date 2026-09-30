import { t } from "../i18n";
import { lireLecture, paragraphes } from "../lecture-style";
import type { LectureStylee, Retenir, TableauLecture } from "../lecture-style";

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

function etapesHtml(items: string[], p: PortesLecture): string {
	return `<ol class="quiz-lecture-etapes">${items.map((e, i) =>
		`<li class="quiz-lecture-etape"><span class="quiz-lecture-num" aria-hidden="true">${i + 1}</span><div class="quiz-lecture-etape-texte">${p.bloc(e)}</div></li>`
	).join("")}</ol>`;
}

function tableauHtml(tab: TableauLecture, p: PortesLecture): string {
	const tete = tab.colonnes.length
		? `<thead><tr>${tab.colonnes.map((c, i) => `<th scope="col" class="quiz-lecture-col-${Math.min(i, 3)}">${p.inline(c)}</th>`).join("")}</tr></thead>`
		: "";
	const corps = `<tbody>${tab.lignes.map(l => `<tr>${l.map(c => `<td>${p.inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
	// L'enveloppe défile à l'horizontale si le tableau est trop large : jamais la carte.
	return `<div class="quiz-lecture-tableau-wrap"><table class="quiz-lecture-tableau">${tete}${corps}</table></div>`;
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
	}).join("")}</div><div class="quiz-lecture-indice">${p.inline(t("engine.lecture.flipHint"))}</div></div>`;
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
export function corpsLectureHtml(item: unknown, brut: string, texteHtml: string, titre: string | undefined, p: PortesLecture): CorpsLecture {
	return rendre(item, brut, texteHtml, titre, p, false);
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

function rendre(item: unknown, brut: string, texteHtml: string, titre: string | undefined, p: PortesLecture, courte: boolean): CorpsLecture {
	const l = lireLecture(item);
	let corps: string;
	if (l.style === "etapes") {
		/* Les étapes ÉCRITES, avec le texte en introduction ; à défaut, les
		   paragraphes du texte deviennent les étapes (spec §2). */
		const ecrites = l.etapes.length > 0;
		const items = ecrites ? l.etapes : paragraphes(brut);
		corps = items.length
			? `${ecrites && texteHtml.trim() ? `<div class="quiz-lecture-intro">${texteHtml}</div>` : ""}${etapesHtml(items, p)}`
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
	const tete = titre && titre.trim() ? `<h3 class="quiz-lecture-titre">${p.inline(titre)}</h3>` : "";
	/* Where the reading comes from ("cite", 2026-09-30): the document and its
	   pages, written by the generator — the original to read again. */
	const cite = (item as { cite?: unknown } | null)?.cite;
	const source = typeof cite === "string" && cite.trim()
		? `<div class="quiz-lecture-source">${p.inline(t("engine.lecture.source", { source: cite.trim() }))}</div>`
		: "";
	return { style: l.style, html: `<div class="quiz-lecture quiz-lecture--${l.style}${courte ? " quiz-lecture--courte" : ""}">${tete}${corps}${retenir}${source}</div>` };
}

/**
 * Branche les cartes à retourner d'un sous-arbre : un clic (ou Entrée,
 * Espace — c'est un bouton) les retourne et les remet. Idempotent : une
 * carte déjà branchée ne l'est pas deux fois, sans quoi deux écouteurs
 * s'annuleraient et la carte ne tournerait plus.
 */
export function brancherCartes(racine: ParentNode): void {
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
