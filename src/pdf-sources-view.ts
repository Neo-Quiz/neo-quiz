import { currentHost } from "./host/current";
import { ajouter } from "./dom";
import { t } from "./i18n";
import { LOG_PREFIX } from "./branding";
import { QUIZ_BLOCK_RE, parseQuizSource } from "./quiz-utils";
import { lireCitations, partiesNom, resoudreSource, sourcesDuQuiz } from "./pdf-sources";
import { ouvrirPdf } from "./pdf-viewer";
import { fileIconSvg } from "./dashboard/file-icon-svg";

/* ══════════════════════════════════════════════════════════
   THE SOURCE CHIPS OF A QUIZ (2026-10-09)

   Under the title of a Learn, one chip per PDF its cards cite (`pdf-sources.ts`
   decides which and where the file is); a click opens the viewer
   (`pdf-viewer.ts`). The `cite` line of a reading card opens the PDF at the
   page it names. Nothing is persisted and the note is never written.
══════════════════════════════════════════════════════════ */

function ouvrirDocument(nom: string, quizPath: string, page: number): void {
	const host = currentHost();
	const chemin = resoudreSource(nom, quizPath, host.fs.listFiles());
	if (!chemin) { host.ui.notice(t("pdf.viewer.notFound", { name: nom })); return; }
	ouvrirPdf(chemin, page);
}

/**
 * The sources as ONE PILL next to the player's title (2026-10-14): a row of
 * chips under the title took room from the quiz. The pill says how many
 * files; hovering it (or a tap, on a phone) opens the list, each file with
 * the colour icon of its type, as the composer's "@" picker shows them, and a
 * click opens it. Nothing is painted for a quiz that cites no file.
 */
export function monterPastilleSources(parent: HTMLElement, questions: readonly unknown[], quizPath: string): void {
	parent.replaceChildren();
	const sources = sourcesDuQuiz(questions);
	if (!sources.length) return;
	const host = currentHost();
	const fichiers = host.fs.listFiles();
	const pastille = ajouter(parent, "button", "qbd-qz-sources-pill");
	pastille.type = "button";
	pastille.setAttribute("aria-haspopup", "true");
	pastille.setAttribute("aria-expanded", "false");
	host.ui.setIcon(ajouter(pastille, "span", "qbd-qz-sources-pill-icon"), "paperclip");
	ajouter(pastille, "span", "qbd-qz-sources-pill-count", t(sources.length === 1 ? "pdf.sources.countOne" : "pdf.sources.countOther", { count: sources.length }));
	const liste = ajouter(parent, "div", "qbd-qz-sources-panel");
	liste.setAttribute("role", "menu");
	for (const s of sources) {
		const chemin = resoudreSource(s.name, quizPath, fichiers);
		const ligne = ajouter(liste, "button", "qbd-qz-sources-item");
		ligne.type = "button";
		ligne.setAttribute("role", "menuitem");
		const img = ajouter(ligne, "img", "qbd-qz-sources-item-icon");
		img.src = fileIconSvg(s.name);
		img.alt = "";
		img.width = 16;
		img.height = 16;
		const nom = ajouter(ligne, "span", "qbd-pdf-chip-name");
		const { head, tail } = partiesNom(s.name);
		ajouter(nom, "span", "qbd-pdf-chip-head", head);
		if (tail) ajouter(nom, "span", "qbd-pdf-chip-tail", tail);
		const libelle = t(chemin ? "pdf.chip.open" : "pdf.chip.missing", { name: s.name });
		ligne.title = libelle;
		ligne.setAttribute("aria-label", libelle);
		if (chemin) ligne.addEventListener("click", () => { parent.classList.remove("is-open"); pastille.setAttribute("aria-expanded", "false"); ouvrirPdf(chemin, s.page); });
		else ligne.setAttribute("aria-disabled", "true");
	}
	/* A tap (no hover on a phone) or a click toggles the list; hover opens it in CSS. */
	pastille.addEventListener("click", () => {
		const ouvert = parent.classList.toggle("is-open");
		pastille.setAttribute("aria-expanded", String(ouvert));
	});
	parent.addEventListener("keydown", e => {
		if (e.key !== "Escape" || !parent.classList.contains("is-open")) return;
		parent.classList.remove("is-open");
		pastille.setAttribute("aria-expanded", "false");
		pastille.focus();
	});
}

/** Paints the chips of `questions` into `parent` (replacing what a previous
    call painted there). Nothing is painted for a quiz that cites no PDF. */
export function monterSources(parent: HTMLElement, questions: readonly unknown[], quizPath: string): void {
	parent.replaceChildren();
	const sources = sourcesDuQuiz(questions);
	if (!sources.length) return;
	const host = currentHost();
	const fichiers = host.fs.listFiles();
	for (const s of sources) {
		const chemin = resoudreSource(s.name, quizPath, fichiers);
		const puce = ajouter(parent, "button", "qbd-pdf-chip");
		puce.type = "button";
		host.ui.setIcon(ajouter(puce, "span", "qbd-pdf-chip-icon"), "file-text");
		const nom = ajouter(puce, "span", "qbd-pdf-chip-name");
		const { head, tail } = partiesNom(s.name);
		ajouter(nom, "span", "qbd-pdf-chip-head", head);
		if (tail) ajouter(nom, "span", "qbd-pdf-chip-tail", tail);
		if (chemin) {
			const libelle = t("pdf.chip.open", { name: s.name });
			puce.title = libelle;
			puce.setAttribute("aria-label", libelle);
			puce.addEventListener("click", () => ouvrirPdf(chemin, s.page));
		} else {
			const libelle = t("pdf.chip.missing", { name: s.name });
			puce.title = libelle;
			puce.setAttribute("aria-label", libelle);
			puce.setAttribute("aria-disabled", "true");
		}
	}
}

/** The same, from a note on disk: for the fiche, whose draft does not keep `cite`. */
export async function monterSourcesDeNote(parent: HTMLElement, quizPath: string): Promise<void> {
	try {
		const note = await currentHost().fs.read(quizPath);
		const bloc = note.match(QUIZ_BLOCK_RE);
		if (!bloc) return;
		monterSources(parent, parseQuizSource(bloc[1]), quizPath);
	} catch (e) {
		// A chip is a convenience: a note that cannot be read here fails elsewhere, loudly.
		console.warn(LOG_PREFIX, "PDF sources:", quizPath, e);
	}
}

/** Makes the `cite` lines of readings rendered under `racine` (`[data-cite]`,
    engine/lecture-rendu.ts) open the PDF at the cited page. One delegated
    listener, so a reading drawn later is covered too. Returns its removal. */
export function brancherCitations(racine: HTMLElement, quizPath: string): () => void {
	const ouvrir = (cible: EventTarget | null): boolean => {
		const el = cible instanceof Element ? cible.closest<HTMLElement>("[data-cite]") : null;
		const cite = el?.dataset.cite;
		if (!cite) return false;
		const premiere = lireCitations(cite)[0];
		if (!premiere) return false;
		ouvrirDocument(premiere.name, quizPath, premiere.page ?? 1);
		return true;
	};
	const surClic = (e: MouseEvent): void => { if (ouvrir(e.target)) e.stopPropagation(); };
	const surTouche = (e: KeyboardEvent): void => {
		if ((e.key === "Enter" || e.key === " ") && ouvrir(e.target)) { e.preventDefault(); e.stopPropagation(); }
	};
	racine.addEventListener("click", surClic);
	racine.addEventListener("keydown", surTouche);
	return () => { racine.removeEventListener("click", surClic); racine.removeEventListener("keydown", surTouche); };
}
