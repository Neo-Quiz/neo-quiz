/* ══════════════════════════════════════════════════════════
   L'ÉTAT DE LA MISE À JOUR — un noyau PUR

   electron-updater parle par événements (`checking-for-update`,
   `update-available`, `download-progress`, `update-downloaded`,
   `update-not-available`, `error`). Le rendu, lui, veut UN objet à afficher :
   une phase, une version, un pourcentage. Cette traduction est la seule
   logique du mécanisme, et elle vit ici, sans Electron ni réseau, pour être
   éprouvée par `npm run check:updater` — la même règle que `garde-ia.ts`.

   LA MISE À JOUR AUTOMATIQUE NE SE COUPE PLUS (2026-09-17). Le drapeau `auto`
   et son événement `reglage` sont partis avec l'interrupteur des Réglages :
   l'application vérifie, télécharge et installe, toujours. Ce n'est pas qu'un
   retrait d'écran — le réglage était PERSISTÉ, et laisser sa lecture en place
   sans plus rien pour le rallumer aurait figé à jamais les installations où un
   `{ auto: false }` traînait déjà. La clé n'est plus lue ; ce qui reste écrit
   sur le disque est ignoré, comme les réglages de la dictée.

   Une décision qui ne se voit pas dans les types : une ERREUR après « prête »
   ne retire pas la mise à jour déjà téléchargée — le paquet est sur le disque,
   vérifié, et un échec de re-vérification réseau n'y change rien.
══════════════════════════════════════════════════════════ */

export type PhaseMiseAJour = "inactif" | "verification" | "a-jour" | "telechargement" | "prete" | "erreur";

export interface EtatMiseAJour {
	phase: PhaseMiseAJour;
	version?: string;
	pourcent?: number;
	/** Bytes received / total of the download in progress; null when the server gave no usable size. */
	octetsRecus?: number | null;
	octetsTotal?: number | null;
	message?: string;
}

export type EvenementMiseAJour =
	| { type: "checking-for-update" }
	| { type: "update-available"; version: string }
	| { type: "update-not-available" }
	| { type: "download-progress"; percent: number; transferred?: number; total?: number }
	| { type: "update-downloaded"; version: string }
	| { type: "error"; message: string };

export const ETAT_INITIAL: EtatMiseAJour = { phase: "inactif" };

export function transition(etat: EtatMiseAJour, ev: EvenementMiseAJour): EtatMiseAJour {
	switch (ev.type) {
		case "checking-for-update":
			return { phase: "verification" };
		case "update-available":
			return { phase: "telechargement", version: ev.version, pourcent: 0, octetsRecus: null, octetsTotal: null };
		case "download-progress":
		{
			/* A total that is missing, zero, negative or not finite is no size at
			   all: both bytes fields go null so the UI never shows "0 MB / 0 MB".
			   Received bytes are clamped to [0, total]. */
			const total = typeof ev.total === "number" && Number.isFinite(ev.total) && ev.total > 0 ? ev.total : null;
			const recu = total === null ? null
				: Math.max(0, Math.min(total, Number.isFinite(ev.transferred) ? (ev.transferred as number) : 0));
			return { ...etat, pourcent: Math.max(0, Math.min(100, Math.round(ev.percent))), octetsRecus: recu, octetsTotal: total };
		}
		case "update-downloaded":
			return { phase: "prete", version: ev.version };
		case "update-not-available":
			return { phase: "a-jour" };
		case "error":
			if (etat.phase === "prete") return etat;
			return { phase: "erreur", message: ev.message };
	}
}
