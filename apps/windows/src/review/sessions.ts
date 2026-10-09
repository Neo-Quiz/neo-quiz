import { LOG_PREFIX } from "../../../../src/branding";
import type { SessionQuiz, SessionSink } from "../../../../src/engine/session";
import { ecrireReglage, lireReglage } from "../host/folder";
import type { SessionsPartagees } from "../host/shared-sessions";
import { renommerCles } from "./folder-move";

/* ══════════════════════════════════════════════════════════
   LES SESSIONS EN COURS, CÔTÉ APPLICATION (2026-09-26) — reprendre un quiz
   là où on s'était arrêté.

   SYNCED BETWEEN DEVICES since 2026-10-09 (host/shared-sessions.ts): a
   quiz begun on the phone resumes on the laptop. The snapshots live in each
   root's `.neo-quiz/sessions/<device>.json`; the latest written wins. The
   app's settings key `quizSessions` stays as this device's LOCAL MIRROR:
   it is what an older version of the app reads, and the fallback for a
   quiz whose root could not be loaded. Its content is copied once into the
   synced files (`migrer`): progress made before this version is not lost.

   Écriture DIFFÉRÉE de 400 ms (une série de clics n'écrit qu'une fois),
   et IMMÉDIATE par `vider()` — au démontage de la page du quiz et à la
   fermeture de la fenêtre : le délai de garde du processus principal laisse
   le rendu terminer ses écritures en attente.
══════════════════════════════════════════════════════════ */

const CLE_SESSIONS = "quizSessions";
const DELAI_MS = 400;
/** Set once the mirror has been copied into the synced files. */
const CLE_MIGREE = "quizSessionsShared";

export interface SessionsApp {
	lire(chemin: string): SessionQuiz | null;
	puits(chemin: string): SessionSink;
	toutes(): Record<string, SessionQuiz>;
	/** A quiz (or a folder, by prefix) moved: its snapshots follow it. */
	renommer(de: string, vers: string): void;
	/** Reads again the other devices' snapshots (after a sync). */
	recharger(): Promise<void>;
	vider(): Promise<void>;
}

export async function creerSessionsApp(partagees?: SessionsPartagees): Promise<SessionsApp> {
	let locales: Record<string, SessionQuiz> = {};
	try {
		const brut = await lireReglage<Record<string, SessionQuiz>>(CLE_SESSIONS);
		if (brut && typeof brut === "object" && !Array.isArray(brut)) locales = brut;
	} catch (e) {
		// Réglages illisibles : aucune reprise, mais l'application s'ouvre.
		console.warn(LOG_PREFIX, "sessions illisibles:", e);
	}
	if (partagees) {
		try {
			await partagees.load();
			/* ONCE (`quizSessionsShared`): only what no device has yet, the synced
			   files being newer than the mirror. Never again after: once a
			   tombstone from another device has aged out, the mirror's old
			   snapshot would bring a finished quiz back. */
			if (!(await lireReglage<boolean>(CLE_MIGREE))) {
				if (partagees.migrer(locales) > 0) await partagees.ecrire();
				await ecrireReglage(CLE_MIGREE, true);
			}
		} catch (e) {
			console.warn(LOG_PREFIX, "synced sessions not loaded:", e);
		}
	}
	/** The merged view: the synced snapshots, and the mirror for a quiz the
	    synced files do not know at all (its root was not loaded). */
	const vue = (): Record<string, SessionQuiz> => {
		if (!partagees) return locales;
		const p = partagees.toutes();
		const out: Record<string, SessionQuiz> = { ...p };
		for (const [k, s] of Object.entries(locales)) if (!(k in out) && !partagees.gere(k)) out[k] = s;
		return out;
	};

	let minuterie = 0;
	const ecrire = async (): Promise<void> => {
		if (minuterie) { clearTimeout(minuterie); minuterie = 0; }
		try { await ecrireReglage(CLE_SESSIONS, locales); } catch (e) { console.warn(LOG_PREFIX, "sessions non écrites:", e); }
		if (partagees) { try { await partagees.ecrire(); } catch (e) { console.warn(LOG_PREFIX, "synced sessions not written:", e); } }
	};
	const planifier = (): void => {
		if (minuterie) clearTimeout(minuterie);
		minuterie = window.setTimeout(() => { minuterie = 0; void ecrire(); }, DELAI_MS);
	};
	return {
		lire: chemin => vue()[chemin] ?? null,
		puits: chemin => ({
			initiale: vue()[chemin] ?? null,
			enregistrer: s => { locales[chemin] = s; partagees?.poser(chemin, s); planifier(); },
			effacer: () => {
				const avait = chemin in locales || !!partagees?.toutes()[chemin];
				delete locales[chemin];
				partagees?.effacer(chemin);
				if (avait) planifier();
			},
		}),
		toutes: () => vue(),
		renommer: (de, vers) => {
			const local = renommerCles(locales, de, vers);
			partagees?.renommer(de, vers);
			if (local || partagees) planifier();
		},
		recharger: async () => { if (partagees) { try { await partagees.refresh(); } catch (e) { console.warn(LOG_PREFIX, "synced sessions not refreshed:", e); } } },
		vider: () => ecrire(),
	};
}
