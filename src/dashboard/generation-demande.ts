/* ══════════════════════════════════════════════════════════
   UNE DEMANDE DE GÉNÉRATION, DE L'ENVOI À LA NOTE

   Sorti de `ai.ts` avec la file de génération (spec 2026-09-26) : la page
   « Générer » ET la file (`file-generation-app.ts`) composent le prompt,
   cherchent le Learn d'un Practice et enregistrent la note par ces MÊMES
   fonctions. Deux copies divergeraient sans un mot — un quiz de la file
   nommé autrement que celui du canal web, ou rangé ailleurs.

   Rien ici ne lit l'état de la page : tout arrive en paramètre, figé à
   l'envoi pour la file, lu à l'instant pour le canal web.
══════════════════════════════════════════════════════════ */

import type { AiSettings } from "../types/dashboard-ctx";
import type { EditorExamOptions } from "../types/editor-ctx";
import type { ModeQuiz } from "../quiz-format";
import { modeDuBloc, nomDeNote, verifierFormat } from "../quiz-format";
import { nomDeSource, trouverLearn, lirePlanLearn, messagesDesManques } from "./ai-sources";
import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import * as aiProviders from "./ai-providers";
import type { AiUsage } from "./usage-format";
import type { Scanner, QuizIndexEntry } from "./scanner";
import type { QuizDraft } from "./detail-io";
import { aiSettingsDefaults } from "./ai-settings-host";
import { convertParsedToInternal, readModeConfig } from "../editor/convert";
import { exportAllWithFence } from "../editor/export";
import { ecrireFrontmatterNeoQuiz } from "../quiz-frontmatter";
import { ensureFolder, freeNotePath } from "./folder-create";
import type { DraftQuestion } from "../editor/utils";
import type { ParsedQuizItem } from "../editor/modals";
import { findQuizModeConfigIndex } from "../quiz-utils";
import { t } from "../i18n";

/** Origine d'une pièce jointe texte : note/fichier du VAULT (chemin relatif
    connu), fichier hors vault résolu via le picker « @ » (chemin absolu
    connu), fichier choisi/déposé SANS origine connue (menu « + »,
    glisser-déposer — on ne sait dire que son nom), ou TRANSCRIPTION D'UNE
    VIDÉO YOUTUBE (la tuile du composer — `path` y est un identifiant
    `youtube:<id>`, jamais un fichier). Sert de dédoublonnage
    (cf. `attachmentKey` de `ai.ts`) : deux fichiers de même NOM mais
    d'origine ou de chemin différents restent deux pièces jointes. */
export type AttachmentSource = "vault" | "external" | "file" | "video";

/** Source texte attachée (note du vault, fichier .md/.txt/PDF, ou
    transcription d'une vidéo YouTube — la tuile, cf. video-tile.ts). */
export interface NoteAttachment {
	name: string;
	content: string;
	/** Vault → chemin relatif au vault. Externe → chemin ABSOLU (résolu par
	    le picker « @ » juste avant l'attachement). Absent seulement pour un
	    fichier choisi/déposé sans origine connue. */
	path?: string;
	source: AttachmentSource;
	/** Les OCTETS d'un PDF, gardés pour l'aperçu ; `content` n'en est que le
	    texte. Absent pour une note. */
	bytes?: Uint8Array;
	/** La première page en image (`data:` URL), pour la carte. */
	thumb?: string;
}

/** Ce qu'une demande porte au modèle : la consigne, les documents lus, les
    images. Générique sur l'image : la page garde l'URL d'aperçu, la file
    n'a besoin que du fichier. */
export interface DemandeTexte<I extends { file: File } = { file: File }> {
	text: string;
	notes: NoteAttachment[];
	images: I[];
}

/* Source et prompt déduits de la demande, partagés par le chemin CLI (la
   file) et le chemin web (`ouvrirSite`) : même demande, deux façons de la
   porter à un modèle. */
export function composerDemande(msg: DemandeTexte): { source: "image" | "text" | "topic"; prompt: string } {
	// images → vision ; notes/fichiers attachés → texte source ; sinon sujet.
	// Chaque source texte est délimitée par son nom (l'IA distingue les
	// documents d'un envoi multi-notes).
	const source = msg.images.length > 0 ? "image" : msg.notes.length > 0 ? "text" : "topic";
	const notesBlock = msg.notes
		.map(n => (msg.notes.length > 1 ? "--- " + n.name + " ---\n" : "") + n.content)
		.join("\n\n");
	// Repli quand des images sont envoyées SANS consigne : instruction au
	// modèle (pas de l'UI) → anglais, et surtout « dans leur langue ».
	const prompt = source === "image"
		? (msg.text.trim() || "Analyze the provided images and build the quiz in their language")
		: source === "text"
		? (msg.text.trim() ? msg.text.trim() + "\n\n" : "") + notesBlock
		: msg.text.trim();
	return { source, prompt };
}

/** UN QUIZ PAR FICHIER JOINT (2026-09-23) : un sous-message par fichier,
    même consigne pour chacun, dès que la demande porte plusieurs documents
    et aucune image (une image illustre souvent LE document d'à côté). */
export function decouperParFichier<I extends { file: File }>(msg: DemandeTexte<I>): DemandeTexte<I>[] {
	if (msg.images.length > 0 || msg.notes.length < 2) return [msg];
	return msg.notes.map(note => ({ text: msg.text, notes: [note], images: [] }));
}

/** Le dossier par défaut, en chemin du contrat : `<racine par défaut>/<aiOutputFolder>`. */
export function dossierParDefaut(aiOutputFolder: string | undefined): string {
	const host = currentHost();
	return host.paths.contractPath(host.paths.defaultRoot().id, aiOutputFolder || aiSettingsDefaults().aiOutputFolder);
}

/** Practice : la note Learn de la même SOURCE dans le dossier de
    destination (clé `source:` de son frontmatter) et son plan des tranches,
    qui part avec la demande (spec §2). Rien trouvé ou illisible : `{}`. */
export async function lienLearn(scanner: Scanner, mode: ModeQuiz, dossier: string, msg: DemandeTexte): Promise<{ plan?: { slice: number; titre: string }[]; note?: string }> {
	if (mode !== "practice") return {};
	const source = nomDeSource(msg.notes, msg.text, t("dashboard.quizzes.newQuizDefaultName"));
	const learn = trouverLearn(scanner.getQuizzes(), dossier, source);
	if (!learn) return {};
	const plan = (await lirePlanLearn(learn.path)) ?? undefined;
	return plan ? { plan, note: learn.basename } : {};
}

/** Brouillon éditable à partir des questions générées. Passe par la MÊME
    conversion que la lecture d'une note (editor/convert.ts) : un quiz
    généré et un quiz relu d'un .md doivent être le même objet. `file: null` :
    ce quiz n'a pas encore de note. */
export function brouillonDe(generated: unknown[]): QuizDraft {
	const questions: DraftQuestion[] = [];
	let examOptions: EditorExamOptions | null = null;
	// Par son INDEX : le critère dépend de la POSITION dans le bloc.
	const configIdx = findQuizModeConfigIndex(generated as ParsedQuizItem[]);
	(generated as ParsedQuizItem[]).forEach((raw, i) => {
		if (i === configIdx) { examOptions = readModeConfig(raw); return; }
		questions.push(convertParsedToInternal(raw));
	});
	return { file: null, questions, examOptions };
}

export interface Enregistrement {
	draft: QuizDraft;
	/** Les questions brutes, dont le mode du bloc et le contrôle se lisent. */
	questions: unknown[];
	/** Le mode DEMANDÉ (l'interrupteur au moment de l'envoi). */
	modeDemande: ModeQuiz;
	titreModele?: string;
	demande: { text: string; notes: { name: string }[] } | null;
	/** Chemin du contrat choisi, ou "" pour le dossier par défaut. */
	destination: string;
	/** Fournisseur, modèle, effort et dossier de sortie de CETTE génération. */
	reglages: AiSettings;
	usage: AiUsage | null;
	planTranches?: { slice: number; titre: string }[];
	noteLearn?: string;
	scanner: Scanner;
}

/** Écrit la note du quiz généré et l'indexe. `null` si rien n'a pu être
    enregistré — l'appelant le dit (notice ou ligne en échec). */
export async function enregistrerQuiz(e: Enregistrement): Promise<QuizIndexEntry | null> {
	const host = currentHost();
	try {
		if (!e.draft.questions.length) return null;
		/* `destination` est déjà un chemin du contrat : il ne repasse pas par
		   `contractPath`, qui le préfixerait une seconde fois. */
		const folder = e.destination || dossierParDefaut(e.reglages.aiOutputFolder);
		await ensureFolder(folder);
		/* Le NOM : `<base> — Learn` / `<base> — Practice`, la base étant la
		   pièce jointe (le CM), sinon le titre du modèle, sinon la demande. La
		   SOURCE part dans le frontmatter : c'est par elle qu'un Practice
		   retrouve son Learn. */
		const defaut = t("dashboard.quizzes.newQuizDefaultName");
		const pieces = e.demande?.notes ?? [];
		const source = nomDeSource(pieces, e.demande?.text ?? "", defaut);
		const mode = modeDuBloc(e.questions);
		const base = pieces.length ? source : nomDeSource([], e.titreModele || e.demande?.text || "", defaut);
		const path = await freeNotePath(folder, nomDeNote(base, mode));
		const provider = e.reglages.aiProvider || "";
		/* Sur un SITE, le modèle et l'effort sont les siens : `model` porte le
		   site, pas de ligne `effort`. Antigravity : la famille RÉSOLUE, et le
		   niveau de la famille plutôt qu'`aiEffort`. */
		const canalWeb = aiProviders.estCanalWeb(provider);
		const model = canalWeb ? provider
			: provider === "antigravity-cli" ? aiProviders.resolveAntigravityModel(e.reglages.aiModel)
			: (e.usage?.model || e.reglages.aiModel || "");
		const effort = canalWeb || provider === "ollama" ? undefined
			: provider === "antigravity-cli" ? (aiProviders.niveauAntigravity(e.reglages.aiAntigravityLevels, aiProviders.resolveAntigravityModel(model)) || undefined)
			: e.reglages.aiEffort;
		const frontmatter = ecrireFrontmatterNeoQuiz({
			provider, model, effort,
			generatedAt: new Date().toISOString(),
			learn: mode === "practice" ? e.noteLearn : undefined,
			source,
		});
		await host.fs.write(path, frontmatter + exportAllWithFence(e.draft.questions, e.draft.examOptions) + "\n");

		/* Contrôle à l'arrivée (spec §2) : un manque est SIGNALÉ, jamais un
		   échec — la note est déjà écrite, d'où un try/catch séparé. */
		try {
			for (const m of messagesDesManques(verifierFormat(mode, e.questions, e.planTranches?.map(p => p.slice)))) host.ui.notice(m);
			if (e.modeDemande === "learn" && mode === "practice") host.ui.notice(t("ai.format.notLearn"));
		} catch (err) {
			console.warn(LOG_PREFIX, "contrôle à l'arrivée en échec (note déjà enregistrée) :", err);
		}

		const file = host.fs.getFile(path);
		if (file) await e.scanner.scanFile(file);
		return e.scanner.getQuiz(path);
	} catch (err) {
		// La cause reste interne ; l'appelant affiche l'échec traduit.
		console.warn(LOG_PREFIX, "enregistrement du quiz généré en échec :", err);
		return null;
	}
}
