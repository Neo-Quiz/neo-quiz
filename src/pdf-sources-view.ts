import { currentHost } from "./host/current";
import { ajouter } from "./dom";
import { t } from "./i18n";
import { LOG_PREFIX } from "./branding";
import { QUIZ_BLOCK_RE, parseQuizSource } from "./quiz-utils";
import { lireCitations, partiesNom, resoudreSource, sourcesDuQuiz } from "./pdf-sources";
import { ouvrirPdf } from "./pdf-viewer";

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
