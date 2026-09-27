import { LOG_PREFIX } from "../../../../src/branding";
import type { SessionQuiz, SessionSink } from "../../../../src/engine/session";
import { ecrireReglage, lireReglage } from "../host/folder";

/* ══════════════════════════════════════════════════════════
   LES SESSIONS EN COURS, CÔTÉ APPLICATION (2026-09-26) — reprendre un quiz
   là où on s'était arrêté. Sur le modèle de `stats.ts` : une clé des
   RÉGLAGES de l'application (`quizSessions`), lue une fois, tenue en
   mémoire. Pas partagée avec le greffon (spec, §1 : hors champ).

   Écriture DIFFÉRÉE de 400 ms (une série de clics n'écrit qu'une fois),
   et IMMÉDIATE par `vider()` — au démontage de la page du quiz et à la
   fermeture de la fenêtre : le délai de garde du processus principal laisse
   le rendu terminer ses écritures en attente.
══════════════════════════════════════════════════════════ */

const CLE_SESSIONS = "quizSessions";
const DELAI_MS = 400;

export interface SessionsApp {
	lire(chemin: string): SessionQuiz | null;
	puits(chemin: string): SessionSink;
	toutes(): Record<string, SessionQuiz>;
	vider(): Promise<void>;
}

export async function creerSessionsApp(): Promise<SessionsApp> {
	let cache: Record<string, SessionQuiz> = {};
	try {
		const brut = await lireReglage<Record<string, SessionQuiz>>(CLE_SESSIONS);
		if (brut && typeof brut === "object" && !Array.isArray(brut)) cache = brut;
	} catch (e) {
		// Réglages illisibles : aucune reprise, mais l'application s'ouvre.
		console.warn(LOG_PREFIX, "sessions illisibles:", e);
	}
	let minuterie = 0;
	const ecrire = async (): Promise<void> => {
		if (minuterie) { clearTimeout(minuterie); minuterie = 0; }
		try { await ecrireReglage(CLE_SESSIONS, cache); } catch (e) { console.warn(LOG_PREFIX, "sessions non écrites:", e); }
	};
	const planifier = (): void => {
		if (minuterie) clearTimeout(minuterie);
		minuterie = window.setTimeout(() => { minuterie = 0; void ecrire(); }, DELAI_MS);
	};
	return {
		lire: chemin => cache[chemin] ?? null,
		puits: chemin => ({
			initiale: cache[chemin] ?? null,
			enregistrer: s => { cache[chemin] = s; planifier(); },
			effacer: () => { if (chemin in cache) { delete cache[chemin]; planifier(); } },
		}),
		toutes: () => cache,
		vider: () => ecrire(),
	};
}
