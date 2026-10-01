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
import type { ModeGeneration } from "../quiz-format";
import { fusionnerConfigsFinales, modeDuBloc, nomDeNote, verifierFormat } from "../quiz-format";
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
	/** Un PDF dont la LECTURE n'est pas finie (`cours`) ou a échoué
	    (`erreur`) : sa carte est déjà là (référence claude.ai, la pièce
	    apparaît au choix du fichier), mais `content` n'est pas encore son
	    texte. Tant que ce champ existe, rien ne part. */
	lecture?: "cours" | "erreur";
	/** Le message d'une lecture en `erreur`, affiché sur la carte. */
	erreurLecture?: string;
}

/** Ce qu'une demande porte au modèle : la consigne, les documents lus, les
    images. Générique sur l'image : la page garde l'URL d'aperçu, la file
    n'a besoin que du fichier. */
export interface DemandeTexte<I extends { file: File } = { file: File }> {
	text: string;
	notes: NoteAttachment[];
	images: I[];
	/** ONE PASS (2026-10-01): this request carries SEVERAL documents and asks
	    for ONE quiz PER document from a single reading of all of them
	    (`decouperParFichier`, "N quizzes"). Absent: one quiz over the whole
	    request, as before. */
	parDocument?: boolean;
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

/** ONE QUIZ PER ATTACHED FILE (2026-09-23), unless the user chose "1 quiz"
    (spec 2026-09-29 §4.3): as soon as the request carries several documents
    and no image (an image often illustrates THE document next to it, so an
    image keeps a single quiz whatever the choice). `oneQuiz` is the state of
    the composer's "N quizzes <-> 1 quiz" toggle, whose default is N quizzes.
    `enUnePasse` (2026-10-01, `lectureEnUnePasse` of the provider): N quizzes
    come from ONE generation that reads ALL the documents first and answers
    with one quiz per document (the request is flagged `parDocument`); without
    it, one sub-request per file, the same instruction for each, each seeing
    only its own document. */
export function decouperParFichier<I extends { file: File }>(msg: DemandeTexte<I>, oneQuiz: boolean, enUnePasse = false): DemandeTexte<I>[] {
	if (oneQuiz || msg.images.length > 0 || msg.notes.length < 2) return [msg];
	if (enUnePasse) return [{ ...msg, parDocument: true }];
	return msg.notes.map(note => ({ text: msg.text, notes: [note], images: [] }));
}

/** Whether a provider can write N quizzes in one answer. Every one but Ollama:
    its structured answer (`format` schema) holds exactly one quiz, so it keeps
    one generation per document. */
export function lectureEnUnePasse(provider: string): boolean {
	return provider !== "ollama";
}

/** The name of a folder given as a contract path: its last segment, or the
    root's own name when the folder IS a root. `""` when neither is known. */
function folderName(folder: string): string {
	const host = currentHost();
	const last = host.paths.localPath(folder).split("/").filter(Boolean).pop();
	return last ?? host.paths.rootOf(folder)?.name ?? "";
}

/** Whether the toggle is offered: at least two documents and no image (with
    an image, `decouperParFichier` keeps a single quiz whatever the choice). */
export function canChooseQuizCount(documents: number, images: number): boolean {
	return documents >= 2 && images === 0;
}

/** Le dossier par défaut, en chemin du contrat : `<racine par défaut>/<aiOutputFolder>`. */
export function dossierParDefaut(aiOutputFolder: string | undefined): string {
	const host = currentHost();
	return host.paths.contractPath(host.paths.defaultRoot().id, aiOutputFolder || aiSettingsDefaults().aiOutputFolder);
}

/** Practice: the Learn note of the same SOURCE in the destination folder
    (the `source:` key of its frontmatter) and its slice plan, which goes
    with the request (spec §2). Nothing found or unreadable: `{}`. Never for
    a Practice made as ONE quiz over several documents (spec 2026-09-29
    §4.5): there is no single Learn to follow. */
export async function lienLearn(scanner: Scanner, mode: ModeGeneration, dossier: string, msg: DemandeTexte): Promise<{ plan?: { slice: number; titre: string }[]; note?: string }> {
	if (mode !== "practice" || msg.notes.length > 1) return {};
	const source = nomDeSource(msg.notes, msg.text, t("dashboard.quizzes.newQuizDefaultName"));
	const learn = trouverLearn(scanner.getQuizzes(), dossier, source);
	if (!learn) return {};
	const plan = (await lirePlanLearn(learn.path)) ?? undefined;
	return plan ? { plan, note: learn.basename } : {};
}

/** Brouillon éditable à partir des questions générées. Passe par la MÊME
    conversion que la lecture d'une note (editor/convert.ts) : un quiz
    généré et un quiz relu d'un .md doivent être le même objet. `file: null` :
    ce quiz n'a pas encore de note.
    PREMIER point du chemin de retour qui relit le tableau brut rendu par le
    modèle (file comme canal web l'appellent, directement ou par
    `enregistrerQuiz`) : `fusionnerConfigsFinales` (lot D §5) y tourne AVANT
    `findQuizModeConfigIndex`, pour qu'une configuration scindée en deux
    objets consécutifs (mode d'un côté, glossaire de l'autre) ne perde ni
    l'un ni l'autre — filet de sécurité même quand l'appelant l'a déjà
    fusionnée plus haut (idempotent sur un tableau déjà fusionné). */
/** Le nombre de QUESTIONS d'un tableau généré, l'objet de configuration final
    (glossaire, mode, objectifs) exclu — ce que la file de génération affiche
    (`ResultatFile.questions`) et journalise dans l'usage (`questionCount`).
    Régression du lot D (revue) : compter `questions.length` tout court y
    comptait cet objet comme une question de plus, dès qu'un glossaire lui
    était ajouté. `fusionnerConfigsFinales` D'ABORD, comme `brouillonDe` :
    une configuration encore scindée en deux objets compterait sinon deux
    questions fantômes plutôt qu'une. PURE. */
export function nombreDeQuestions(generated: readonly unknown[]): number {
	const fusionne = fusionnerConfigsFinales(generated);
	const idx = findQuizModeConfigIndex(fusionne as ParsedQuizItem[]);
	return fusionne.length - (idx >= 0 ? 1 : 0);
}

export function brouillonDe(generated: unknown[]): QuizDraft {
	const fusionne = fusionnerConfigsFinales(generated);
	const questions: DraftQuestion[] = [];
	let examOptions: EditorExamOptions | null = null;
	// Par son INDEX : le critère dépend de la POSITION dans le bloc.
	const configIdx = findQuizModeConfigIndex(fusionne as ParsedQuizItem[]);
	(fusionne as ParsedQuizItem[]).forEach((raw, i) => {
		if (i === configIdx) { examOptions = readModeConfig(raw); return; }
		questions.push(convertParsedToInternal(raw));
	});
	return { file: null, questions, examOptions };
}

export interface Enregistrement {
	draft: QuizDraft;
	/** The raw questions, from which the block's mode and the check are read. */
	questions: unknown[];
	/** The type REQUESTED (the selector's value when the request was sent). */
	modeDemande: ModeGeneration;
	titreModele?: string;
	/** A name decided by the app, over the document's (a quiz of an "/exam"
	    plan is named by its step: "Lists and tuples — Learn"). */
	titreImpose?: string;
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
		/* The NAME: `<base> — Learn` / `<base> — Practice` / `<base> — Exam`,
		   the base being the attached document (the lecture), else the model's
		   title, else the request. SEVERAL documents in ONE quiz have no single
		   name to take: the base is then the destination folder's name (the
		   module, spec 2026-09-29 §4.4). The SOURCE goes in the frontmatter: a
		   Practice finds its Learn through it, and it takes the same value as
		   the name's base. */
		const defaut = t("dashboard.quizzes.newQuizDefaultName");
		const pieces = e.demande?.notes ?? [];
		const source = nomDeSource(pieces, e.demande?.text ?? "", defaut, folderName(folder));
		const mode = modeDuBloc(e.questions);
		const base = e.titreImpose || (pieces.length ? source : nomDeSource([], e.titreModele || e.demande?.text || "", defaut));
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

/** What a one-pass generation saved for one document. */
export interface QuizDuLot {
	document: string;
	titre: string;
	chemin: string;
	questions: number;
}

export interface EnregistrementLot extends Omit<Enregistrement, "draft" | "questions" | "titreModele" | "titreImpose" | "demande" | "planTranches" | "noteLearn"> {
	/** The request: its instruction and the documents, in the order of `lot`. */
	demande: { text: string; notes: { name: string }[] };
	/** One entry per document, in the documents' order (`parseReponseLot`). */
	lot: { document: string; questions: unknown[]; titre?: string }[];
	/** Per document (same order): the Learn it follows and its slice plan. */
	liens?: ({ plan?: { slice: number; titre: string }[]; note?: string } | undefined)[];
	/** Called with everything saved so far after EACH note, so the caller can
	    keep it: a retry must not write a note twice. */
	apresChaque?: (faits: QuizDuLot[]) => void;
}

/** ONE PASS (2026-10-01): writes one note per document of a one-pass
    generation, each through `enregistrerQuiz` with a request carrying ONLY its
    document — so its name, its `source` and its Learn link are exactly those of
    a generation made for that document alone. `deja` holds the notes already
    saved by an earlier attempt: those documents are skipped (a retry never
    writes a note twice). Returns every quiz saved, in the documents' order, or
    `null` when a note could not be written (what was saved before it was
    reported through `apresChaque`). */
export async function enregistrerLot(e: EnregistrementLot, deja: readonly QuizDuLot[] = []): Promise<QuizDuLot[] | null> {
	const faits: QuizDuLot[] = [...deja];
	for (let i = 0; i < e.lot.length; i++) {
		const q = e.lot[i];
		if (faits.some(f => f.document === q.document)) continue;
		const draft = brouillonDe(q.questions);
		const lien = e.liens?.[i];
		const entree = await enregistrerQuiz({
			...e, draft, questions: q.questions, titreModele: q.titre,
			demande: { text: e.demande.text, notes: [{ name: q.document }] },
			planTranches: lien?.plan, noteLearn: lien?.note,
		});
		if (!entree) return null;
		faits.push({ document: q.document, titre: entree.title || entree.basename, chemin: entree.path, questions: draft.questions.length });
		e.apresChaque?.(faits.map(f => f));
	}
	// The documents' order, whatever the order of the saves of several attempts.
	return e.lot.map(q => faits.find(f => f.document === q.document) as QuizDuLot);
}
