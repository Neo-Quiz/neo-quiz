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

/** Le nom de la source : la première pièce jointe sans son extension,
    sinon le début de la demande, sinon `repli` — nettoyé des caractères
    qu'un nom de fichier ou une valeur YAML ne supporte pas. Calculé à
    l'identique au lancement (recherche du Learn) et à l'enregistrement. */
export function nomDeSource(pieces: { name: string }[], demande: string, repli: string): string {
	const brut = pieces[0]?.name.replace(/\.[^.\\/]+$/, "") || debutDeDemande(demande).texte || repli;
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

/** Une notice par manque, traduite, qui NOMME les questions. */
export function messagesDesManques(manques: Manque[]): string[] {
	return manques.map(m => {
		switch (m.kind) {
			case "sansExplication": return t("ai.format.noExplain", { count: m.questions.length, names: m.questions.join(", ") });
			case "trancheInconnue": return t("ai.format.unknownSlice", { count: m.questions.length, names: m.questions.join(", ") });
			case "sansTranche": return t("ai.format.noSlice", { count: m.questions.length, names: m.questions.join(", ") });
			case "trancheIncomplete": return t("ai.format.incompleteSlice", { slice: m.slice, roles: m.rolesManquants.join(", ") });
			case "sansObjectifs": return t("ai.format.noObjectives");
			case "preSansIndice": return t("ai.format.preNoHint", { count: m.questions.length, names: m.questions.join(", ") });
			case "sansIndice": return t("ai.format.noHint", { count: m.questions.length, names: m.questions.join(", ") });
			case "carteSansReponse": return t("ai.format.flashcardNoAnswer", { count: m.questions.length, names: m.questions.join(", ") });
		}
	});
}
