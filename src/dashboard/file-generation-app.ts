/* ══════════════════════════════════════════════════════════
   LA FILE DE GÉNÉRATION, CÔTÉ APPLICATION

   Holds the queue (`file-generation.ts`, the pure core) and RUNS it: every
   chat side by side, one generation at a time inside a chat, in send order
   (`demarrerPrets`, 2026-10-09), through the path the Generate page used
   before: `createAiClient` to launch the CLI (the per-tool lock and the
   templates stay those of the main process), then `enregistrerQuiz` to
   write the note.

   UNE SEULE FILE PAR FENÊTRE, au niveau du MODULE : elle survit aux
   changements de page, et même au démontage de la coquille quand un quiz se
   joue (`main.ts` remplace alors le tableau de bord). La page « Générer »
   s'y ABONNE pour peindre les lignes et s'en désabonne en se démontant ;
   elle ne la possède pas. Fermer l'application la perd — les quiz déjà
   enregistrés restent. A RELOAD of the page no longer does (2026-09-30):
   the queue is saved after each change and read back, and the line that
   was running attaches to its CLI, which the main process kept alive
   (`generation-queue-store.ts`, `apps/windows/electron/resumable-runs.ts`).

   L'application ne change JAMAIS de page d'elle-même : un quiz prêt reste
   une ligne avec « Ouvrir », et un avis le dit si « Générer » n'est pas à
   l'écran.
══════════════════════════════════════════════════════════ */

import type { AiSettings } from "../types/dashboard-ctx";
import type { ModeGeneration } from "../quiz-format";
import { completerConfigLearn, fusionnerConfigsFinales } from "../quiz-format";
import type { CategorieQuiz } from "./categorie-quiz";
import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import { NoQuizAnswer, createAiClient, nettoyerTitre } from "./ai-client";
import type { AiClient, ImagePayload, PreparationExamen } from "./ai-client";
import type { AiSettingsHost } from "./ai-settings-host";
import type { AiUsage, AiUsageEntry } from "./usage-format";
import type { Scanner } from "./scanner";
import { brouillonDe, composerDemande, dossierParDefaut, enregistrerLot, enregistrerQuiz, lienLearn, nombreDeQuestions } from "./generation-demande";
import type { DemandeTexte, QuizDuLot } from "./generation-demande";
import * as F from "./file-generation";
import type { FileGeneration, LigneFile } from "./file-generation";
import { t } from "../i18n";
import { appliquer, transcriptVide } from "./transcript";
import { figuresParHote } from "./figures";
import type { Transcript } from "./transcript";
import { remoteProviderAllowed } from "./remote-providers";
import { garderFile, relireFile, sessionDeFenetre } from "./generation-queue-store";
import { LEGACY_CHAT_ID } from "./chat-record";
import { UsageLimitError, resetFromRows } from "./usage-limit";

/** The settings a request FREEZES when it is sent: changing the provider,
    model or effort afterwards only affects the following requests. */
export type ReglagesFiges = Pick<AiSettings, "aiProvider" | "aiModel" | "aiEffort" | "aiCodexFast" | "aiAntigravityLevels" | "aiOutputFolder">;

export function figerReglages(s: AiSettings): ReglagesFiges {
	return {
		aiProvider: s.aiProvider, aiModel: s.aiModel, aiEffort: s.aiEffort, aiCodexFast: s.aiCodexFast,
		aiAntigravityLevels: s.aiAntigravityLevels ? { ...s.aiAntigravityLevels } : s.aiAntigravityLevels,
		aiOutputFolder: s.aiOutputFolder,
	};
}

/** Une demande telle qu'elle est partie : le texte, les pièces déjà LUES,
    et chaque option de la génération. */
export interface DemandeFile extends DemandeTexte {
	mode: ModeGeneration;
	count: number | null;
	/** Canonical type values; a request saved by an older version carries ONE
	    string (see `normalizeTypes`). */
	type: string | string[];
	/** Chemin du contrat, ou "" pour le dossier par défaut. */
	destination: string;
	reglages: ReglagesFiges;
	/** La catégorie du quiz (categorie-quiz.ts), figée à l'envoi comme le
	    reste : son complément part dans le prompt système. */
	categorie: CategorieQuiz;
	/** "/exam" (2026-09-30): this request is one step of a preparation — the
	    Learn (`palier` 0) or the Test of level `palier` out of `paliers`. */
	preparation?: PreparationExamen;
	/** "/exam" (2026-09-30): this line PLANS the preparation — the model reads
	    every document, chooses the quizzes, and each becomes a line of the
	    queue behind this one. It makes no quiz itself. */
	planifier?: boolean;
	/** With `planifier`: the plan mixes kinds (a Learn, then Tests) instead of
	    following `mode` alone (2026-10-07, no Learn | Test selector any more). */
	mixte?: boolean;
	/** Le quiz que le modèle a produit, gardé dès sa réception : si l'écriture
	    de la note échoue, il n'est pas perdu (nouvel essai d'enregistrement,
	    ou ouverture sans enregistrer), et le CLI n'est jamais relancé pour ça. */
	produit?: ProduitGeneration;
	/** The chat this request belongs to (`chat-record.ts`). A line saved before
	    chats existed has none: it belongs to `LEGACY_CHAT_ID`. */
	chatId?: string;
	/** ONE id per SEND: every line born from one send (a line per document on
	    Ollama, an "/exam" plan and its steps) shares it, so that the thread
	    shows ONE bubble and the record ONE request. */
	requestId?: string;
	/** Epoch ms of the send. */
	sentAt?: number;
	/** The device that SENT this request when it is not this one (a request
	    from the phone, run by the PC). Absent: sent from this device. */
	fromDevice?: string;
	/** The name that device gave itself (from the request file), kept in the record. */
	fromName?: string;
}

/** Ce qu'une génération a rapporté, de quoi écrire la note sans le modèle. */
export interface ProduitGeneration {
	questions: unknown[];
	titre?: string;
	usage: AiUsage | null;
	planTranches?: { slice: number; titre: string }[];
	noteLearn?: string;
	/** ONE PASS (2026-10-01, `DemandeFile.parDocument`): one quiz per document,
	    in the documents' order — `questions` is then empty. */
	lot?: { document: string; questions: unknown[]; titre?: string }[];
	/** One pass: the Learn each document follows (same order). */
	liens?: ({ plan?: { slice: number; titre: string }[]; note?: string } | undefined)[];
	/** One pass: the notes already written, kept as they are saved so that a
	    retry of the save writes only the missing ones. */
	faits?: QuizDuLot[];
}

/** Ce qu'une ligne prête a produit : le nom de la note et son chemin, relu
    dans le catalogue au clic sur « Ouvrir ». */
export interface ResultatFile {
	titre: string;
	chemin: string;
	/** An answer in prose (Markdown), written instead of a quiz because the
	    request asked for none (`NoQuizAnswer`). No note, `chemin` empty. */
	texte?: string;
	/** How long the model worked on a prose answer, in ms. */
	dureeMs?: number;
	/** Le nombre de questions écrites, pour la carte de résultat. */
	questions?: number;
	/** ONE PASS: the quizzes saved, one per document, listed on the line
	    (`titre` then only counts them, `chemin` is the first one). */
	quiz?: { titre: string; chemin: string; questions: number }[];
}

/** L'étape d'une génération en cours, que la réponse affiche comme le texte
    d'état de claude.ai. Connue de l'application seule : le noyau pur n'en
    sait rien. */
export type EtapeGeneration = "preparation" | "lecture" | "redaction" | "enregistrement";

export type LigneGeneration = LigneFile<DemandeFile, ResultatFile>;

export interface DepsFile {
	settings: AiSettingsHost;
	scanner: Scanner;
	/** Journal d'usage, quand l'hôte en tient un. Accessoire : un échec ici ne
	    fait jamais échouer la génération. */
	recordUsage?(entry: AiUsageEntry): Promise<void>;
}

export interface FileGenerationApp {
	lignes(): readonly LigneGeneration[];
	/** L'étape de la ligne en cours, `null` hors génération. */
	etape(id: number): EtapeGeneration | null;
	envoyer(demande: DemandeFile): void;
	annuler(id: number): void;
	reessayer(id: number): void;
	/** A line paused on a usage limit: "Resume now" (every line paused on the
	    same provider restarts its turn). */
	reprendre(id: number): void;
	/** A paused line: "Cancel the resume" turns it into a failed line. */
	annulerReprise(id: number): void;
	/** Réécrit la note d'une ligne dont seul l'enregistrement a échoué. */
	reessayerEnregistrement(id: number): void;
	fermer(id: number): void;
	/** `affichee` dit si l'abonné est à l'écran : sans aucun abonné affiché,
	    un quiz prêt se signale par un avis. Rend le désabonnement. */
	abonner(ecouteur: () => void, affichee: () => boolean): () => void;
	/** The live transcript of a line (2026-09-29), `null` before its run
	    starts or for a provider that does not stream. */
	transcript(id: number): Transcript | null;
	/** Called with a line's id each time its transcript grows — at most
	    every 80 ms, so a view updates the transcript in place instead of
	    repainting the whole queue on every chunk. Returns the unsubscribe. */
	abonnerTranscript(ecouteur: (id: number) => void): () => void;
	/** Settles once the queue of before the reload was read back: a request
	    sent earlier would wait for it anyway, but a reader of `lignes()` must
	    not look before it (the remote runner decides "interrupted" on it). */
	readonly pret: Promise<void>;
}

let instance: FileGenerationApp | null = null;
/** Les dépendances de l'appelant le plus récent : une coquille remontée
    apporte un nouveau catalogue, la génération suivante le lit. */
let depsCourants: DepsFile | null = null;

/** LA file de la fenêtre. Le premier appel la crée ; les suivants rendent
    la même. */
export function fileDeGeneration(d: DepsFile): FileGenerationApp {
	depsCourants = d;
	if (!instance) {
		instance = creer(() => depsCourants as DepsFile);
		for (const cb of creationHooks) cb(instance);
	}
	return instance;
}

const creationHooks = new Set<(q: FileGenerationApp) => void>();
/** Calls `cb` with the window's queue as soon as it exists (at once when it
    already does). The queue only appears when the shell is mounted, so a
    host service that follows it (the generations publisher) registers here
    instead of building its own. */
export function onQueueCreated(cb: (q: FileGenerationApp) => void): void {
	if (instance) cb(instance);
	else creationHooks.add(cb);
}

function creer(lireDeps: () => DepsFile): FileGenerationApp {
	let file: FileGeneration<DemandeFile, ResultatFile> = F.fileVide();
	const abonnes = new Set<{ ecouteur: () => void; affichee: () => boolean }>();
	/** The client of each RUNNING line (2026-10-09, concurrent chats): Stop
	    aborts that line's run only. */
	const clients = new Map<number, AiClient>();
	/** What may run at once: one line per chat, 8 in all, Antigravity and
	    requests from another device one at a time (spec 2026-10-09). */
	const REGLES: F.ReglesDemarrage<DemandeFile> = {
		max: 8,
		chat: d => d.chatId ?? LEGACY_CHAT_ID,
		fournisseur: d => d.reglages.aiProvider ?? "",
		groupe: d => (d.fromDevice ? "remote" : d.reglages.aiProvider === "antigravity-cli" ? "antigravity" : null),
	};
	const etapes = new Map<number, EtapeGeneration>();
	/* The transcripts, by line, and who repaints them. Chunks arrive many
	   times a second: the listeners hear of it once per 80 ms at most. */
	const transcripts = new Map<number, Transcript>();
	const ecouteursTranscript = new Set<(id: number) => void>();
	const transcriptsChanges = new Set<number>();
	let minuteurTranscript: ReturnType<typeof setTimeout> | null = null;
	function transcriptChange(id: number): void {
		transcriptsChanges.add(id);
		if (minuteurTranscript !== null) return;
		minuteurTranscript = setTimeout(() => {
			minuteurTranscript = null;
			const ids = [...transcriptsChanges];
			transcriptsChanges.clear();
			for (const e of [...ecouteursTranscript]) {
				for (const id of ids) {
					try { e(id); } catch (err) { console.warn(LOG_PREFIX, "transcript listener failed:", err); }
				}
			}
		}, 80);
	}
	/** Change l'étape affichée d'une ligne et prévient les abonnés. */
	function etapeDe(id: number, e: EtapeGeneration | null): void {
		if (e) etapes.set(id, e); else etapes.delete(id);
		publier();
	}

	/* KEPT ACROSS A RELOAD (2026-09-30, `generation-queue-store.ts`): every
	   change of the queue is saved, and the queue saved before a reload is
	   read back once, below. Until then, a request sent waits in `differees`
	   — the restored lines come first, and their ids must not be reused. */
	let restauree = false;
	let ouvrirPret!: () => void;
	const pret = new Promise<void>(r => { ouvrirPret = r; });
	const differees: DemandeFile[] = [];
	let derniereGardee: FileGeneration<DemandeFile, ResultatFile> | null = null;

	/** The clock of the paused lines: one timer, aimed at the next due time
	    (the delay is capped, the timer is then armed again). */
	let minuteurReprise: ReturnType<typeof setTimeout> | null = null;
	function armerReprise(): void {
		if (minuteurReprise !== null) clearTimeout(minuteurReprise);
		minuteurReprise = null;
		const due = F.prochaineEcheance(file);
		if (due === null) return;
		minuteurReprise = setTimeout(() => { minuteurReprise = null; pomper(); }, Math.min(Math.max(due - Date.now(), 0) + 50, 2 ** 31 - 1));
	}

	/** A CLI refused on a usage limit: the line pauses until the window
	    resets. The time comes from the CLI's message, else from the usage
	    line (the window that is full), else the user resumes by hand. */
	async function pauserSurLimite(ligne: LigneGeneration, err: UsageLimitError): Promise<void> {
		let reprise = err.resetAt;
		if (reprise === null) {
			try {
				const lu = await currentHost().process?.usageCompte(err.tool);
				reprise = lu ? resetFromRows(lu.rows, Date.now()) : null;
			} catch { reprise = null; }
		}
		// Stopped while the usage was read: nothing to pause.
		if (!tourne(ligne.id)) return;
		file = F.mettreEnPause(file, ligne.id, { fournisseur: ligne.demande.reglages.aiProvider ?? "", reprise });
	}

	function publier(): void {
		armerReprise();
		if (restauree && file !== derniereGardee) {
			derniereGardee = file;
			void garderFile(file);
		}
		/* Le SIGNAL du rail (l'icône « Générer » s'anime tant qu'une
		   génération tourne, même depuis une autre page) : posé ici, au seul
		   endroit qui sait si la file travaille. */
		document.documentElement.classList.toggle("qbd-generating", F.occupee(file));
		for (const a of [...abonnes]) {
			try { a.ecouteur(); } catch (e) { console.warn(LOG_PREFIX, "abonné de la file en échec :", e); }
		}
	}

	function afficheeQuelquePart(): boolean {
		return [...abonnes].some(a => { try { return a.affichee(); } catch { return false; } });
	}

	/** Starts every line the rules allow (`demarrerPrets`), after waking the
	    paused lines whose limit has reset (reset time + 30 s). */
	function pomper(): void {
		file = F.reprendreEchues(file, Date.now()).file;
		const { file: suivante, lignes } = F.demarrerPrets(file, Date.now(), REGLES);
		file = suivante;
		publier();
		for (const ligne of lignes) void executer(ligne);
	}

	const tourne = (id: number): boolean => F.ligne(file, id)?.etat === "cours";

	async function executer(ligne: LigneGeneration): Promise<void> {
		const d = ligne.demande;
		// Defence in depth: a line from another device never launches a provider with live tools.
		if (d.fromDevice && !remoteProviderAllowed(d.reglages.aiProvider, d.images.length)) {
			file = F.echouer(file, ligne.id, t("ai.remote.providerNotAllowed"));
			file = F.solder(file, ligne.id);
			pomper();
			return;
		}
		const deps = lireDeps();
		/* Le client lit les réglages FIGÉS de la demande par-dessus les
		   réglages vivants : le reste (adresse Ollama, plans appris…) suit
		   l'hôte, et `save` reste le sien. */
		const figes: AiSettingsHost = {
			get: () => ({ ...deps.settings.get(), ...d.reglages }),
			save: (patch) => deps.settings.save(patch),
		};
		const client = createAiClient(figes);
		clients.set(ligne.id, client);
		if (d.planifier) { await planifier(ligne, client); return; }
		try {
			// « Lecture du document… » quand la demande en porte un.
			etapeDe(ligne.id, d.notes.length || d.images.length ? "lecture" : "preparation");
			const { source, prompt } = composerDemande(d);
			const images = await encoderImages(d.images);
			const dossier = d.destination || dossierParDefaut(d.reglages.aiOutputFolder);
			const learn = await lienLearn(deps.scanner, d.mode, dossier, d);
			/* ONE PASS: each document follows ITS Learn, as when it was
			   generated alone (`lienLearn` gives none for a request over several
			   documents, so it is asked document by document). */
			const documents = d.parDocument && d.notes.length >= 2 ? d.notes.map(n => n.name) : undefined;
			const liens = documents ? await Promise.all(d.notes.map(async n => {
				const l = await lienLearn(deps.scanner, d.mode, dossier, { ...d, notes: [n], parDocument: false });
				return l.plan || l.note ? l : undefined;
			})) : undefined;
			// Annulée pendant la préparation : aucun processus n'est encore lancé.
			if (!tourne(ligne.id)) return;
			etapeDe(ligne.id, "redaction");
			const transcript = transcriptVide();
			transcripts.set(ligne.id, transcript);
			const lancer = () => client.generate(prompt, {
				count: d.count, type: d.type, mode: d.mode, source, planTranches: learn.plan, images, categorie: d.categorie, preparation: d.preparation,
				documents, plansParDocument: liens?.map(l => l?.plan),
				/* The quiz's folder: Claude Code may read it with read-only tools
				   once the user trusts it. Never for a request from another
				   device: nobody at this PC asked for it. */
				dossier: d.fromDevice ? undefined : dossier,
				reprise: cleReprise(ligne),
				onTranscript: (ev) => {
					// A stopped or retried line no longer owns this transcript.
					if (transcripts.get(ligne.id) !== transcript) return;
					appliquer(transcript, ev);
					transcriptChange(ligne.id);
				},
			});
			/* AN UNREADABLE ANSWER IS ASKED ONCE MORE (2026-09-30): a model
			   sometimes writes a quiz whose JSON5 does not parse ("invalid
			   character 'u' at 7:26") — 2 quizzes out of 8 in one /exam plan.
			   The same request usually comes back clean: it is sent again once,
			   silently; a second failure is shown with its Try again. */
			let reponse: Awaited<ReturnType<typeof lancer>>;
			try {
				reponse = await lancer();
			} catch (err) {
				if (!(err instanceof SyntaxError) || !tourne(ligne.id)) throw err;
				console.warn(LOG_PREFIX, "réponse illisible, nouvel essai :", err.message);
				reponse = await lancer();
			}
			if (!tourne(ligne.id)) return;
			if (documents && reponse.lot) {
				await produireLot(ligne, d, client, deps, reponse.lot, liens);
				return;
			}
			/* The final configuration FIRST, merged: a model that answers with two
			   consecutive objects (the mode in one, the glossary in the other, in
			   any order) must lose neither — BEFORE anything below reads the
			   position of the LAST element (batch D §5). */
			const brut = fusionnerConfigsFinales(reponse.questions);
			/* A REQUESTED Learn whose model forgot `mode: "learn"` stays a Learn,
			   as before the queue. Done BEFORE the quiz is kept with the request,
			   so a retried save (which never calls the model again) writes the
			   same Learn. */
			/* The pages a reading names as its figure are drawn into the quiz's
			   folder BEFORE the quiz is kept with the request: a retried save
			   writes the same note, with the same pictures. */
			const questions = await figuresParHote(d.mode === "learn" ? completerConfigLearn(brut) : brut, d.notes, dossier);
			if (!questions.length) throw new Error(t("ai.error.checkSettings"));
			const usage = client.lastUsage;
			if (usage && deps.recordUsage) {
				try { await deps.recordUsage({ ...usage, at: Date.now(), questionCount: nombreDeQuestions(questions) }); }
				catch (e) { console.warn(LOG_PREFIX, "usage non enregistré:", e); }
			}
			/* Ici, relire le forfait du fournisseur (`AiUsageDeps.fetchPlan`)
			   pour le survol du bouton d'usage, si un hôte de la page le fournit
			   un jour : l'application ne fournit pas `usage`, et le greffon n'a
			   plus la page « Générer ». */
			/* Le quiz est GARDÉ avec la demande avant toute écriture — dans la
			   file aussi, donc dans sa sauvegarde : une page rechargée pendant
			   l'écriture écrit la note sans redemander le modèle. */
			const complete: DemandeFile = { ...d, produit: { questions, titre: titrePreparation(d) ?? reponse.titre, usage, planTranches: learn.plan, noteLearn: learn.note } };
			file = F.completer(file, ligne.id, complete);
			etapeDe(ligne.id, "enregistrement");
			await enregistrer(ligne.id, complete);
		} catch (err) {
			if (err instanceof UsageLimitError && tourne(ligne.id)) { await pauserSurLimite(ligne, err); return; }
			/* Asked for no quiz: the prose is the answer, shown in place of a quiz. */
			if (err instanceof NoQuizAnswer) {
				if (tourne(ligne.id)) file = F.terminer(file, ligne.id, { titre: "", chemin: "", texte: err.texte, dureeMs: Date.now() - (ligne.debut ?? Date.now()) });
				return;
			}
			const e = err as Error & { aborted?: boolean };
			// Un arrêt voulu n'est pas un échec : `solder` retire la ligne.
			if (!e?.aborted || tourne(ligne.id)) file = F.echouer(file, ligne.id, e?.message || t("ai.error.checkSettings"));
		} finally {
			if (clients.get(ligne.id) === client) clients.delete(ligne.id);
			etapes.delete(ligne.id);
			file = F.solder(file, ligne.id);
			pomper();
		}
	}

	/** ONE PASS (2026-10-01): the answer holds one quiz per document, already
	    checked (right count, each tag one document, no empty quiz): each is
	    merged and completed as a single quiz would be, then kept WITH the
	    request before any note is written, as for one quiz. */
	async function produireLot(ligne: LigneGeneration, d: DemandeFile, client: AiClient, deps: DepsFile, lot: { document: string; questions: unknown[]; titre?: string }[], liens: ProduitGeneration["liens"]): Promise<void> {
		const dossier = d.destination || dossierParDefaut(d.reglages.aiOutputFolder);
		const quiz = await Promise.all(lot.map(async q => {
			const brut = fusionnerConfigsFinales(q.questions);
			// Each quiz draws only from ITS document.
			const documents = d.notes.filter(n => n.name === q.document);
			return { ...q, questions: await figuresParHote(d.mode === "learn" ? completerConfigLearn(brut) : brut, documents.length ? documents : d.notes, dossier) };
		}));
		if (quiz.some(q => !q.questions.length)) throw new Error(t("ai.error.checkSettings"));
		const usage = client.lastUsage;
		if (usage && deps.recordUsage) {
			try { await deps.recordUsage({ ...usage, at: Date.now(), questionCount: quiz.reduce((n, q) => n + nombreDeQuestions(q.questions), 0) }); }
			catch (e) { console.warn(LOG_PREFIX, "usage non enregistré:", e); }
		}
		const complete: DemandeFile = { ...d, produit: { questions: [], lot: quiz, liens, usage, faits: [] } };
		file = F.completer(file, ligne.id, complete);
		etapeDe(ligne.id, "enregistrement");
		await enregistrer(ligne.id, complete);
	}

	/** THE PLANNING LINE of an "/exam" preparation: the model reads every
	    document and plans the quizzes; each becomes a line behind this one,
	    with the whole plan, its part, and all the documents. The plan shows
	    as this line's answer. A plan it could not read falls back on one
	    quiz of the chosen type over everything. */
	async function planifier(ligne: LigneGeneration, client: AiClient): Promise<void> {
		const d = ligne.demande;
		try {
			etapeDe(ligne.id, d.notes.length ? "lecture" : "redaction");
			const { prompt } = composerDemande(d);
			const transcript = transcriptVide();
			transcripts.set(ligne.id, transcript);
			etapeDe(ligne.id, "redaction");
			const plan = await client.planifier(d.text, prompt.slice(d.text.trim().length), d.mixte ? undefined : d.mode, {
				dossier: d.fromDevice ? undefined : (d.destination || dossierParDefaut(d.reglages.aiOutputFolder)),
				reprise: cleReprise(ligne),
				onTranscript: (ev) => {
					if (transcripts.get(ligne.id) !== transcript) return;
					appliquer(transcript, ev);
					transcriptChange(ligne.id);
				},
			});
			if (!tourne(ligne.id)) return;
			const quiz = plan.length ? plan : [{ titre: d.preparation?.examen?.nom ?? t("ai.exam.planFallback"), type: d.mode, focus: "", points: [] as string[] }];
			const titres = quiz.map(e => e.titre);
			quiz.forEach((e, i) => {
				file = F.ajouter(file, {
					...d, planifier: false, mode: e.type,
					preparation: { ...(d.preparation ?? { palier: 0, paliers: 0 }), titre: e.titre, focus: e.focus, points: e.points, plan: titres, etape: i + 1, etapes: quiz.length },
				}).file;
			});
			const nbPoints = quiz.reduce((n, e) => n + e.points.length, 0);
			const texte = t(nbPoints ? "ai.exam.planIntroPoints" : "ai.exam.planIntro", { count: quiz.length, points: nbPoints }) + "\n\n" + quiz.map((e, i) => `${i + 1}. **${e.titre}**${e.focus ? " — " + e.focus : ""}${e.points.length ? ` (${e.points.length})` : ""}`).join("\n");
			file = F.terminer(file, ligne.id, { titre: "", chemin: "", texte, dureeMs: Date.now() - (ligne.debut ?? Date.now()) });
		} catch (err) {
			if (err instanceof UsageLimitError && tourne(ligne.id)) { await pauserSurLimite(ligne, err); return; }
			const e = err as Error & { aborted?: boolean };
			if (!e?.aborted || tourne(ligne.id)) file = F.echouer(file, ligne.id, e?.message || t("ai.error.checkSettings"));
		} finally {
			if (clients.get(ligne.id) === client) clients.delete(ligne.id);
			etapes.delete(ligne.id);
			file = F.solder(file, ligne.id);
			pomper();
		}
	}

	/** Écrit la note du quiz produit. Un échec ne perd rien : la ligne passe
	    en « échec d'enregistrement » avec son quiz, et ne relancera jamais le
	    CLI. */
	async function enregistrer(id: number, d: DemandeFile): Promise<void> {
		const p = d.produit;
		if (!p) return;
		const deps = lireDeps();
		if (p.lot) { await enregistrerLotDeLigne(id, d, p, p.lot, deps); return; }
		// Le brouillon UNE FOIS (lot D) : `draft.questions` exclut déjà l'objet
		// de configuration final — sa longueur est le compteur affiché,
		// `p.questions.length` comptait le glossaire comme une question.
		const draft = brouillonDe(p.questions);
		const entree = await enregistrerQuiz({
			draft, questions: p.questions, modeDemande: d.mode, titreModele: p.titre, titreImpose: titrePreparation(d),
			demande: d, destination: d.destination, reglages: { ...deps.settings.get(), ...d.reglages },
			usage: p.usage, planTranches: p.planTranches, noteLearn: p.noteLearn, scanner: deps.scanner,
		});
		if (!entree) {
			file = F.echouerEnregistrement(file, id, t("ai.notice.saveFailed"), d);
			return;
		}
		const titre = entree.title || entree.basename;
		file = F.terminer(file, id, { titre, chemin: entree.path, questions: draft.questions.length });
		if (!afficheeQuelquePart()) currentHost().ui.notice(t("ai.queue.readyNotice", { title: titre }));
	}

	/** ONE PASS: one note per document. Each note written is kept in the line's
	    request at once (`faits`), so a retry, or a reload, writes only the rest. */
	async function enregistrerLotDeLigne(id: number, d: DemandeFile, p: ProduitGeneration, lot: NonNullable<ProduitGeneration["lot"]>, deps: DepsFile): Promise<void> {
		const garder = (faits: QuizDuLot[]): void => {
			const maintenant = F.ligne(file, id)?.demande ?? d;
			file = F.completer(file, id, { ...maintenant, produit: { ...(maintenant.produit ?? p), faits } });
		};
		const faits = await enregistrerLot({
			demande: d, lot, liens: p.liens, modeDemande: d.mode, destination: d.destination,
			reglages: { ...deps.settings.get(), ...d.reglages }, usage: p.usage, scanner: deps.scanner, apresChaque: garder,
		}, p.faits ?? []);
		if (!faits) {
			file = F.echouerEnregistrement(file, id, t("ai.notice.saveFailed"), F.ligne(file, id)?.demande ?? d);
			return;
		}
		const titre = t("ai.queue.lotSaved", { count: faits.length });
		file = F.terminer(file, id, { titre, chemin: faits[0].chemin, questions: faits.reduce((n, f) => n + f.questions, 0), quiz: faits.map(f => ({ titre: f.titre, chemin: f.chemin, questions: f.questions })) });
		if (!afficheeQuelquePart()) currentHost().ui.notice(t("ai.queue.readyNotice", { title: titre }));
	}

	/* THE QUEUE OF BEFORE THE RELOAD, read back once. Its running line runs
	   again: under the same resume key, its generation attaches to the CLI
	   the main process kept alive (or, past the minute it waits, starts
	   afresh). A line whose answer had arrived only writes its note. */
	void relireFile<FileGeneration<DemandeFile, ResultatFile>>().then(sauvee => {
		if (sauvee && Array.isArray(sauvee.lignes)) {
			file = F.restaurer(sauvee, d => !!d.produit);
		}
		restauree = true;
		for (const d of differees.splice(0)) file = F.ajouter(file, d).file;
		for (const l of file.lignes) {
			if (l.etat === "cours") void executer(l);
			else if (l.etat === "enregistrement") void enregistrer(l.id, l.demande).finally(publier);
		}
		pomper();
	}).catch(() => { /* an unreadable saved queue: `pret` still settles below */ }).finally(ouvrirPret);

	return {
		pret,
		lignes: () => file.lignes,
		etape: (id) => etapes.get(id) ?? null,
		reessayerEnregistrement(id) {
			const avant = file;
			file = F.reessayerEnregistrement(file, id);
			if (file === avant) return;
			publier();
			const d = F.ligne(file, id)?.demande;
			if (d) void enregistrer(id, d).finally(publier);
		},
		envoyer(demande) {
			if (!restauree) { differees.push(demande); return; }
			file = F.ajouter(file, demande).file;
			pomper();
		},
		annuler(id) {
			const r = F.annuler(file, id);
			file = r.file;
			/* Le même geste que l'ancien bouton Stop : `abort` tue l'arbre du
			   CLI. La place ne se libère qu'au retour de la génération
			   (`solder`, dans `executer`), le verrou du CLI rendu. */
			if (r.arreter) clients.get(id)?.abort();
			publier();
		},
		reprendre(id) {
			const avant = file;
			file = F.reprendre(file, id);
			if (file === avant) return;
			pomper();
		},
		annulerReprise(id) {
			const avant = file;
			file = F.annulerReprise(file, id, t("ai.queue.limitCancelled"));
			if (file === avant) return;
			publier();
		},
		reessayer(id) {
			transcripts.delete(id);
			file = F.reessayer(file, id);
			pomper();
		},
		fermer(id) {
			transcripts.delete(id);
			file = F.fermer(file, id);
			publier();
		},
		transcript: (id) => transcripts.get(id) ?? null,
		abonnerTranscript(ecouteur) {
			ecouteursTranscript.add(ecouteur);
			return () => { ecouteursTranscript.delete(ecouteur); };
		},
		abonner(ecouteur, affichee) {
			const a = { ecouteur, affichee };
			abonnes.add(a);
			return () => { abonnes.delete(a); };
		},
	};
}

/** The name of a quiz of an "/exam" preparation, imposed rather than left
    to the model (which named three Tests "CM3", "CM3 (2)", "CM3 (3)" on
    2026-09-30): the exam, then the step — "Contrôle continu — Learn CM2",
    "Contrôle continu — Test 3". `undefined` outside a preparation. */
export function titrePreparation(d: Pick<DemandeFile, "mode" | "preparation">): string | undefined {
	const p = d.preparation;
	// A step of the model's plan is named by the plan: "Lists and tuples".
	if (p?.titre) return nettoyerTitre(p.titre);
	if (!p?.examen) return undefined;
	const etape = d.mode === "learn"
		? (p.document ? `Learn ${p.document.replace(/\.[^.]+$/, "")}` : "Learn")
		: `Test ${p.palier}`;
	return nettoyerTitre(`${p.examen.nom} — ${etape}`);
}

/** The resume key of a line's run: the window's session, the line, and its
    start — the same after a reload (the queue keeps both), a new one for a
    retry (a new start). */
function cleReprise(ligne: LigneGeneration): string {
	return `${sessionDeFenetre()}-${ligne.id}-${ligne.debut ?? 0}`;
}

/** Les images en base64 pour l'API de vision, lues au moment de partir. */
async function encoderImages(images: { file: File }[]): Promise<ImagePayload[]> {
	return Promise.all(images.map(async (img) => {
		const bytes = new Uint8Array(await img.file.arrayBuffer());
		let binary = "";
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return { base64: btoa(binary), mediaType: img.file.type || "image/png" };
	}));
}
