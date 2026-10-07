import { currentHost } from "../host/current";
import type { ModeQuiz, Manque } from "../quiz-format";
import { lireBlocQuiz, planDesTranches } from "../quiz-format";
import { t } from "../i18n";

/**
 * UNE SOURCE, DEUX NOTES (spec Learn/Practice §1.2). Le mode ne se lit PAS
 * dans le nom du fichier — un badge le montre (décision d'Ahmed le
 * 2026-09-23 : « c'est pas propre sinon ») : la note porte le titre que le
 * modèle lui a donné, et le lien entre le Practice et son Learn passe par
 * la clé `source:` du frontmatter `neo-quiz`, écrite sur les deux notes.
 * La source est la première pièce jointe (le CM), sinon la demande elle-même.
 */

const INTERDITS = /[\\/:*?"<>|]/g;

/** La première ligne de la demande, coupée au dernier mot entier avant
    `max` caractères ; `coupee` dit si elle l'a été (le titre affiché y
    ajoute alors « … », jamais le nom d'une source). */
export function debutDeDemande(texte: string, max = 60): { texte: string; coupee: boolean } {
	const brut = (texte || "").trim().split("\n")[0].trim();
	if (brut.length <= max) return { texte: brut, coupee: false };
	const coupe = brut.slice(0, max);
	const espace = coupe.lastIndexOf(" ");
	return { texte: (espace > max / 2 ? coupe.slice(0, espace) : coupe).replace(/[\s:,;–—-]+$/, ""), coupee: true };
}

/** The name of the source: the first attached document without its
    extension, else the start of the request, else `repli` — cleaned of the
    characters a file name or a YAML value cannot hold. Computed identically
    at launch (Learn lookup) and at saving. With SEVERAL documents (one quiz
    over all of them, spec 2026-09-29 §4.4) no single document names it: it is
    `folderName`, the destination folder's name (the module), when there is one. */
export function nomDeSource(pieces: { name: string }[], demande: string, repli: string, folderName = ""): string {
	const brut = (pieces.length > 1 ? folderName : "") || pieces[0]?.name.replace(/\.[^.\\/]+$/, "") || debutDeDemande(demande).texte || repli;
	return brut.replace(INTERDITS, "-").replace(/\s+/g, " ").trim() || repli;
}

/** Ce que la recherche du Learn lit d'une entrée du catalogue. */
export interface NoteCandidate {
	path: string;
	mode: ModeQuiz;
	generated?: { source?: string; generatedAt?: string } | null;
}

/** La note Learn de cette source dans ce dossier (pas dans ses
    sous-dossiers) ; la plus récente s'il y en a plusieurs ; `null` sinon. */
export function trouverLearn<T extends NoteCandidate>(notes: readonly T[], dossier: string, source: string): T | null {
	const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	const candidates = notes.filter(n => n.mode === "learn" && n.generated?.source === source && parent(n.path) === dossier);
	candidates.sort((a, b) => (b.generated?.generatedAt ?? "").localeCompare(a.generated?.generatedAt ?? ""));
	return candidates[0] ?? null;
}

/** Le plan des tranches d'une note Learn ; `null` si elle est illisible ou
    sans tranche — la génération Practice part alors sans plan, jamais en
    échec. */
export async function lirePlanLearn(chemin: string): Promise<{ slice: number; titre: string }[] | null> {
	try {
		const items = lireBlocQuiz(await currentHost().fs.read(chemin));
		const plan = items ? planDesTranches(items) : [];
		return plan.length ? plan : null;
	} catch {
		return null;
	}
}

/** Une notice par manque, traduite, qui NOMME les questions. Les tranches
    incomplètes d'un même quiz ne font qu'UNE notice : un Learn qui en a
    plusieurs ne doit pas empiler une notice par tranche. */
export function messagesDesManques(manques: Manque[]): string[] {
	const tranches = manques.filter(m => m.kind === "trancheIncomplete");
	const autres = manques.filter(m => m.kind !== "trancheIncomplete").map(messageDuManque);
	return tranches.length ? [...autres, tranches.map(messageDuManque).join(" ")] : autres;
}

function messageDuManque(m: Manque): string {
	switch (m.kind) {
		case "sansExplication": return t("ai.format.noExplain", { count: m.questions.length, names: m.questions.join(", ") });
		case "trancheInconnue": return t("ai.format.unknownSlice", { count: m.questions.length, names: m.questions.join(", ") });
		case "sansTranche": return t("ai.format.noSlice", { count: m.questions.length, names: m.questions.join(", ") });
		case "trancheIncomplete": return t("ai.format.incompleteSlice", { slice: m.slice, roles: m.rolesManquants.join(", ") });
		case "sansObjectifs": return t("ai.format.noObjectives");
		case "preSansIndice": return t("ai.format.preNoHint", { count: m.questions.length, names: m.questions.join(", ") });
		case "sansIndice": return t("ai.format.noHint", { count: m.questions.length, names: m.questions.join(", ") });
		case "carteSansReponse": return t("ai.format.flashcardNoAnswer", { count: m.questions.length, names: m.questions.join(", ") });
		case "runInLastHintInvalide": return t("ai.format.runInLastHintInvalid", { count: m.questions.length, names: m.questions.join(", ") });
	}
}
