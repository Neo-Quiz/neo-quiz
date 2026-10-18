/* The card of a quiz written by the Generate page, "clear row" style: the
   WHOLE card is one <button>, so every pixel of it opens the quiz. No
   control sits inside it (a button in a button is invalid HTML and would
   swallow the click). The folder's own icon and colour reach the CSS
   (--qbd-folder) once the folder is resolved; until then, the defaults. */
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { detecterCategorie } from "./categorie-quiz";
import { topicArt, topicTint } from "./topic-art";
import { moduleAccent } from "./module-color";
import type { ModuleInfo } from "./quiz-modules";
import { libelleComptes } from "./question-count";
import type { ComptesQuiz } from "./question-count";
import type { ModeGeneration } from "../quiz-format";

export interface CarteQuiz {
	titre: string;
	chemin: string;
	/** Omitted when the counts are unknown (a chat record, a reloaded thread). */
	comptes?: ComptesQuiz;
	/** Omitted when the kind is unknown: the meta line then shows no kind. */
	mode?: ModeGeneration;
}

/** The folder of a note path: the segment just before the file name. */
export function nomDossier(chemin: string): string {
	const morceaux = chemin.split(/[\/]/);
	return morceaux.length > 1 ? morceaux[morceaux.length - 2] : "";
}

/** Paints the card into `parent` and returns it. `ouvrir` runs on any click
    and on Enter or Space (native to <button>). `dossierDe` resolves the
    folder of the note (its icon and colour, from the module map); it is
    optional, and a folder it cannot resolve keeps the defaults. */
export function peindreCarteQuiz(
	parent: HTMLElement,
	q: CarteQuiz,
	ouvrir: () => void,
	dossierDe?: (chemin: string) => Promise<ModuleInfo | null>,
): HTMLButtonElement {
	const host = currentHost();
	const dossier = nomDossier(q.chemin);
	const carte = ajouter(parent, "button", "qbd-ai-resultat");
	carte.type = "button";
	carte.style.setProperty("--qbd-folder", moduleAccent({ folder: dossier || q.titre }));
	carte.addEventListener("click", ouvrir);
	/* The tile of the quiz's subject: the same illustration as its card in the
	   gallery (`topic-art.ts`), on the subject's ground colour. */
	const sujet = detecterCategorie({ dossier: q.chemin.split(/[\\/]/).slice(0, -1).join("/"), demande: q.titre });
	const icone = ajouter(carte, "span", "qbd-ai-resultat-icone");
	icone.style.background = topicTint(sujet);
	icone.setAttribute("aria-hidden", "true");
	icone.appendChild(topicArt(sujet));
	const corps = ajouter(carte, "span", "qbd-ai-resultat-corps");
	ajouter(corps, "span", "qbd-ai-resultat-titre", q.titre);
	const meta = ajouter(corps, "span", "qbd-ai-resultat-meta");
	const genre = [q.mode ? t(q.mode === "learn" ? "dashboard.quizMode.learn" : "dashboard.quizMode.test") : "", q.comptes ? libelleComptes(q.comptes) : ""].filter(Boolean).join(" · ");
	if (genre) ajouter(meta, "span", undefined, genre);
	if (dossier) ajouter(meta, "span", undefined, dossier);
	const aller = ajouter(carte, "span", "qbd-ai-resultat-go");
	ajouter(aller, "span", undefined, t("ai.queue.open"));
	host.ui.setIcon(ajouter(aller, "span", "qbd-ai-resultat-fleche"), "arrow-right");
	/* The folder's own colour (its settings), once known: the hover edge. */
	void dossierDe?.(q.chemin).then(info => {
		if (info) carte.style.setProperty("--qbd-folder", moduleAccent(info));
	});
	return carte;
}
