/* ══════════════════════════════════════════════════════════
   LA FILE DE GÉNÉRATION, CÔTÉ APPLICATION

   Tient la file (`file-generation.ts`, le noyau pur) et l'EXÉCUTE : une
   génération à la fois, dans l'ordre d'envoi, par le chemin qu'empruntait
   la page « Générer » — `createAiClient` pour lancer le CLI (le verrou par
   outil et les gabarits restent ceux du processus principal), puis
   `enregistrerQuiz` pour écrire la note.

   UNE SEULE FILE PAR FENÊTRE, au niveau du MODULE : elle survit aux
   changements de page, et même au démontage de la coquille quand un quiz se
   joue (`main.ts` remplace alors le tableau de bord). La page « Générer »
   s'y ABONNE pour peindre les lignes et s'en désabonne en se démontant ;
   elle ne la possède pas. Fermer l'application la perd — les quiz déjà
   enregistrés restent.

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
import { createAiClient } from "./ai-client";
import type { AiClient, ImagePayload } from "./ai-client";
import type { AiSettingsHost } from "./ai-settings-host";
import type { AiUsage, AiUsageEntry } from "./usage-format";
import type { Scanner } from "./scanner";
import { brouillonDe, composerDemande, dossierParDefaut, enregistrerQuiz, lienLearn, nombreDeQuestions } from "./generation-demande";
import type { DemandeTexte } from "./generation-demande";
import * as F from "./file-generation";
import type { FileGeneration, LigneFile } from "./file-generation";
import { t } from "../i18n";
import { appliquer, transcriptVide } from "./transcript";
import type { Transcript } from "./transcript";

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
	type: string;
	/** Chemin du contrat, ou "" pour le dossier par défaut. */
	destination: string;
	reglages: ReglagesFiges;
	/** La catégorie du quiz (categorie-quiz.ts), figée à l'envoi comme le
	    reste : son complément part dans le prompt système. */
	categorie: CategorieQuiz;
	/** Le quiz que le modèle a produit, gardé dès sa réception : si l'écriture
	    de la note échoue, il n'est pas perdu (nouvel essai d'enregistrement,
	    ou ouverture sans enregistrer), et le CLI n'est jamais relancé pour ça. */
	produit?: ProduitGeneration;
}

/** Ce qu'une génération a rapporté, de quoi écrire la note sans le modèle. */
export interface ProduitGeneration {
	questions: unknown[];
	titre?: string;
	usage: AiUsage | null;
	planTranches?: { slice: number; titre: string }[];
	noteLearn?: string;
}

/** Ce qu'une ligne prête a produit : le nom de la note et son chemin, relu
    dans le catalogue au clic sur « Ouvrir ». */
export interface ResultatFile {
	titre: string;
	chemin: string;
	/** Le nombre de questions écrites, pour la carte de résultat. */
	questions?: number;
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
}

let instance: FileGenerationApp | null = null;
/** Les dépendances de l'appelant le plus récent : une coquille remontée
    apporte un nouveau catalogue, la génération suivante le lit. */
let depsCourants: DepsFile | null = null;

/** LA file de la fenêtre. Le premier appel la crée ; les suivants rendent
    la même. */
export function fileDeGeneration(d: DepsFile): FileGenerationApp {
	depsCourants = d;
	if (!instance) instance = creer(() => depsCourants as DepsFile);
	return instance;
}

function creer(lireDeps: () => DepsFile): FileGenerationApp {
	let file: FileGeneration<DemandeFile, ResultatFile> = F.fileVide();
	const abonnes = new Set<{ ecouteur: () => void; affichee: () => boolean }>();
	let clientCourant: AiClient | null = null;
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

	function publier(): void {
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

	/** Démarre la suivante si la place est libre. */
	function pomper(): void {
		const { file: suivante, ligne } = F.demarrerSuivant(file, Date.now());
		file = suivante;
		publier();
		if (ligne) void executer(ligne);
	}

	const tourne = (id: number): boolean => F.ligne(file, id)?.etat === "cours";

	async function executer(ligne: LigneGeneration): Promise<void> {
		const d = ligne.demande;
		const deps = lireDeps();
		/* Le client lit les réglages FIGÉS de la demande par-dessus les
		   réglages vivants : le reste (adresse Ollama, plans appris…) suit
		   l'hôte, et `save` reste le sien. */
		const figes: AiSettingsHost = {
			get: () => ({ ...deps.settings.get(), ...d.reglages }),
			save: (patch) => deps.settings.save(patch),
		};
		const client = createAiClient(figes);
		clientCourant = client;
		try {
			// « Lecture du document… » quand la demande en porte un.
			etapeDe(ligne.id, d.notes.length || d.images.length ? "lecture" : "preparation");
			const { source, prompt } = composerDemande(d);
			const images = await encoderImages(d.images);
			const dossier = d.destination || dossierParDefaut(d.reglages.aiOutputFolder);
			const learn = await lienLearn(deps.scanner, d.mode, dossier, d);
			// Annulée pendant la préparation : aucun processus n'est encore lancé.
			if (!tourne(ligne.id)) return;
			etapeDe(ligne.id, "redaction");
			const transcript = transcriptVide();
			transcripts.set(ligne.id, transcript);
			const reponse = await client.generate(prompt, {
				count: d.count, type: d.type, mode: d.mode, source, planTranches: learn.plan, images, categorie: d.categorie,
				onTranscript: (ev) => {
					// A stopped or retried line no longer owns this transcript.
					if (transcripts.get(ligne.id) !== transcript) return;
					appliquer(transcript, ev);
					transcriptChange(ligne.id);
				},
			});
			if (!tourne(ligne.id)) return;
			/* The final configuration FIRST, merged: a model that answers with two
			   consecutive objects (the mode in one, the glossary in the other, in
			   any order) must lose neither — BEFORE anything below reads the
			   position of the LAST element (batch D §5). */
			const brut = fusionnerConfigsFinales(reponse.questions);
			/* A REQUESTED Learn whose model forgot `mode: "learn"` stays a Learn,
			   as before the queue. Done BEFORE the quiz is kept with the request,
			   so a retried save (which never calls the model again) writes the
			   same Learn. */
			const questions = d.mode === "learn" ? completerConfigLearn(brut) : brut;
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
			// Le quiz est GARDÉ avec la demande avant toute écriture.
			etapeDe(ligne.id, "enregistrement");
			await enregistrer(ligne.id, { ...d, produit: { questions, titre: reponse.titre, usage, planTranches: learn.plan, noteLearn: learn.note } });
		} catch (err) {
			const e = err as Error & { aborted?: boolean };
			// Un arrêt voulu n'est pas un échec : `solder` retire la ligne.
			if (!e?.aborted || tourne(ligne.id)) file = F.echouer(file, ligne.id, e?.message || t("ai.error.checkSettings"));
		} finally {
			if (clientCourant === client) clientCourant = null;
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
		// Le brouillon UNE FOIS (lot D) : `draft.questions` exclut déjà l'objet
		// de configuration final — sa longueur est le compteur affiché,
		// `p.questions.length` comptait le glossaire comme une question.
		const draft = brouillonDe(p.questions);
		const entree = await enregistrerQuiz({
			draft, questions: p.questions, modeDemande: d.mode, titreModele: p.titre,
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

	return {
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
			file = F.ajouter(file, demande).file;
			pomper();
		},
		annuler(id) {
			const r = F.annuler(file, id);
			file = r.file;
			/* Le même geste que l'ancien bouton Stop : `abort` tue l'arbre du
			   CLI. La place ne se libère qu'au retour de la génération
			   (`solder`, dans `executer`), le verrou du CLI rendu. */
			if (r.arreter) clientCourant?.abort();
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

/** Les images en base64 pour l'API de vision, lues au moment de partir. */
async function encoderImages(images: { file: File }[]): Promise<ImagePayload[]> {
	return Promise.all(images.map(async (img) => {
		const bytes = new Uint8Array(await img.file.arrayBuffer());
		let binary = "";
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return { base64: btoa(binary), mediaType: img.file.type || "image/png" };
	}));
}
