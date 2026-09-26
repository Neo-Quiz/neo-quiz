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
import type { ModeQuiz } from "../quiz-format";
import { completerConfigLearn } from "../quiz-format";
import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import { createAiClient } from "./ai-client";
import type { AiClient, ImagePayload } from "./ai-client";
import type { AiSettingsHost } from "./ai-settings-host";
import type { AiUsageEntry } from "./usage-format";
import type { Scanner } from "./scanner";
import { brouillonDe, composerDemande, dossierParDefaut, enregistrerQuiz, lienLearn } from "./generation-demande";
import type { DemandeTexte } from "./generation-demande";
import * as F from "./file-generation";
import type { FileGeneration, LigneFile } from "./file-generation";
import { t } from "../i18n";

/** Les réglages qu'une demande FIGE à l'envoi : changer de fournisseur, de
    modèle ou d'effort ensuite ne touche que les envois suivants. */
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
	mode: ModeQuiz;
	count: number | null;
	type: string;
	/** Chemin du contrat, ou "" pour le dossier par défaut. */
	destination: string;
	reglages: ReglagesFiges;
}

/** Ce qu'une ligne prête a produit : le nom de la note et son chemin, relu
    dans le catalogue au clic sur « Ouvrir ». */
export interface ResultatFile {
	titre: string;
	chemin: string;
}

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
	envoyer(demande: DemandeFile): void;
	annuler(id: number): void;
	reessayer(id: number): void;
	fermer(id: number): void;
	/** `affichee` dit si l'abonné est à l'écran : sans aucun abonné affiché,
	    un quiz prêt se signale par un avis. Rend le désabonnement. */
	abonner(ecouteur: () => void, affichee: () => boolean): () => void;
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
			const { source, prompt } = composerDemande(d);
			const images = await encoderImages(d.images);
			const dossier = d.destination || dossierParDefaut(d.reglages.aiOutputFolder);
			const learn = await lienLearn(deps.scanner, d.mode, dossier, d);
			// Annulée pendant la préparation : aucun processus n'est encore lancé.
			if (!tourne(ligne.id)) return;
			const reponse = await client.generate(prompt, { count: d.count, type: d.type, mode: d.mode, source, planTranches: learn.plan, images });
			if (!tourne(ligne.id)) return;
			/* Un Learn DEMANDÉ dont le modèle a oublié `mode: "learn"` reste un
			   Learn, comme avant la file. */
			const questions = d.mode === "learn" ? completerConfigLearn(reponse.questions) : reponse.questions;
			if (!questions.length) throw new Error(t("ai.error.checkSettings"));
			const usage = client.lastUsage;
			if (usage && deps.recordUsage) {
				try { await deps.recordUsage({ ...usage, at: Date.now(), questionCount: questions.length }); }
				catch (e) { console.warn(LOG_PREFIX, "usage non enregistré:", e); }
			}
			const entree = await enregistrerQuiz({
				draft: brouillonDe(questions), questions, modeDemande: d.mode, titreModele: reponse.titre,
				demande: d, destination: d.destination, reglages: { ...deps.settings.get(), ...d.reglages },
				usage, planTranches: learn.plan, noteLearn: learn.note, scanner: deps.scanner,
			});
			if (!entree) throw new Error(t("ai.notice.saveFailed"));
			file = F.terminer(file, ligne.id, { titre: entree.title || entree.basename, chemin: entree.path });
			if (!afficheeQuelquePart()) currentHost().ui.notice(t("ai.queue.readyNotice", { title: entree.title || entree.basename }));
		} catch (err) {
			const e = err as Error & { aborted?: boolean };
			// Un arrêt voulu n'est pas un échec : `solder` retire la ligne.
			if (!e?.aborted || tourne(ligne.id)) file = F.echouer(file, ligne.id, e?.message || t("ai.error.checkSettings"));
		} finally {
			if (clientCourant === client) clientCourant = null;
			file = F.solder(file, ligne.id);
			pomper();
		}
	}

	return {
		lignes: () => file.lignes,
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
			file = F.reessayer(file, id);
			pomper();
		},
		fermer(id) {
			file = F.fermer(file, id);
			publier();
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
