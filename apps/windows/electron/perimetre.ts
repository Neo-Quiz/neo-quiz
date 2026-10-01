/* ══════════════════════════════════════════════════════════
   LE PÉRIMÈTRE — LA LISTE BLANCHE DES DOSSIERS QUE LE PONT A LE DROIT DE TOUCHER

   Ronde de correction 1 de la tâche 3 (Ruling 9). Le brief disait que
   `allow_folder` de Tauri « disparaît sans remplacement » : c'était une erreur
   du plan. Sans périmètre, chaque canal `fichiers.*` était un accès disque
   TOTAL depuis la fenêtre — `write("C:/Users/…/Startup/x.bat")` réussissait —
   alors que Tauri n'accordait `fs:*` qu'aux SEULS dossiers retenus
   (`src-tauri/capabilities/default.json`, portée vide, étendue par
   `allow_folder` à chaque lancement). Et la fenêtre rend du HTML qui n'est pas
   toujours celui de l'utilisateur : ce périmètre est ce qui sépare une porte
   oubliée du sanitizer d'un fichier posé dans le dossier de démarrage.

   CE QUI ALIMENTE LA LISTE, et rien d'autre : la clé `folders` des réglages
   (lue au démarrage, côté principal), le sélecteur natif (`choisirDossier`),
   les vaults qu'Obsidian déclare lui-même (`vaultsObsidian`), et les FICHIERS
   choisis dans le dialogue natif (`choisirFichiers`), en LECTURE SEULE. JAMAIS le
   dossier de données de l'application (Ruling 12) : il porte `settings.json`,
   dont la clé `folders` nourrit cette liste au démarrage suivant — l'admettre
   ferait du pont un moyen d'écrire cette clé en brut, hors de la garde de
   `reglages.ecrire`, et d'obtenir tout le disque de façon persistante. Et
   JAMAIS l'argument de `demarrer` : il vient du
   rendu, qui est précisément ce dont on se protège — `demarrer` FILTRE contre
   la liste, il ne la définit pas.

   COMMENT ON COMPARE : jamais sur la chaîne reçue. `..` est replié
   (`path.resolve`), puis le chemin est RÉSOLU sur le disque (`fs.realpath`,
   qui suit les liens symboliques et les jonctions) sur son segment existant le
   plus long — un fichier qui n'existe pas encore (une note à créer) est
   jugé par son dossier. Une racine est résolue de la même façon au moment où
   elle est autorisée. Sans cette résolution, une jonction posée dans un vault
   sortirait du périmètre sans qu'aucune comparaison de préfixe ne le voie.

   Ce module n'importe PAS Electron : c'est ce qui permet de l'éprouver sur un
   dossier temporaire (`scripts/check-electron-reglages.mjs`).
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import { contratDepuisAbsolu } from "./index-fichiers";
import { normaliser } from "./parcours";
import { CLE_REGLAGES_FOND } from "./pont";
import type { Reglages } from "./reglages";

export interface Perimetre {
	/** Ajoute un dossier à la liste blanche (résolu sur le disque). Un
	    dossier qui n'existe pas est ignoré : rien à protéger, rien à ouvrir. */
	autoriser(dossier: string): Promise<void>;
	/** Vrai si `chemin` (résolu) tombe sous une racine autorisée. */
	contient(chemin: string): Promise<boolean>;
	/** Vrai si `chemin` (résolu) EST une racine autorisée — c'est ce que
	    `trash(abs, racine)` exige de son second argument, sans quoi
	    `path.relative` fabrique un `../../…` et le déplacement devient
	    arbitraire. */
	estRacine(chemin: string): Promise<boolean>;
	/** Le chemin normalisé (séparateurs `/`, `..` replié) s'il est dans le
	    périmètre ; REJETTE avec une cause nommée sinon. C'est la seule porte
	    par laquelle un chemin du pont atteint une primitive. */
	borner(chemin: unknown): Promise<string>;
	/** Admet UN fichier existant (résolu) en LECTURE et OUVERTURE — jamais en
	    écriture. C'est ce qu'un fichier choisi dans le dialogue natif obtient :
	    l'utilisateur l'a désigné pour le joindre, pas pour qu'on l'écrase. */
	autoriserFichier(abs: string): Promise<void>;
	/** Comme `borner`, mais n'accepte que les RACINES : les canaux qui
	    écrivent, déplacent ou effacent passent par ici. */
	bornerEcriture(chemin: unknown): Promise<string>;
	/** Les racines autorisées, résolues. */
	racines(): string[];
}

/**
 * Le chemin tel que le disque le connaît : `..` replié, liens suivis sur la
 * partie qui existe. Rend `null` si aucun ancêtre n'existe (un chemin
 * fantaisiste comme `Z:/nulle-part`) — ce qui vaut « hors périmètre ».
 */
async function resoudre(chemin: string): Promise<string | null> {
	const absolu = path.resolve(chemin);
	let courant = absolu;
	let reste = "";
	for (;;) {
		try {
			const reel = await fs.realpath(courant);
			return normaliser(reste ? path.join(reel, reste) : reel);
		} catch {
			const parent = path.dirname(courant);
			if (parent === courant) return null;
			reste = reste ? path.join(path.basename(courant), reste) : path.basename(courant);
			courant = parent;
		}
	}
}

export function creerPerimetre(): Perimetre {
	const racines: string[] = [];
	/* La SECONDE liste : des FICHIERS (jamais des dossiers), admis un par un
	   par `autoriserFichier`, en LECTURE ET OUVERTURE seulement. `dansPerimetre`
	   ne la consulte que quand `ecriture` est faux — c'est ce qui empêche
	   « choisis-moi ce fichier » de devenir « écris dedans ». */
	const fichiersLecture: string[] = [];

	async function dansPerimetre(chemin: string, ecriture = false): Promise<string | null> {
		const reel = await resoudre(chemin);
		if (reel === null) return null;
		if (contratDepuisAbsolu(racines, reel) !== null) return reel;
		if (!ecriture && fichiersLecture.some(f => f.toLowerCase() === reel.toLowerCase())) return reel;
		return null;
	}

	return {
		async autoriser(dossier) {
			const reel = await resoudre(dossier);
			if (reel === null) return;
			try {
				if (!(await fs.stat(reel)).isDirectory()) return;
			} catch {
				return;
			}
			if (!racines.some(r => r.toLowerCase() === reel.toLowerCase())) racines.push(reel);
		},
		async autoriserFichier(abs) {
			const reel = await resoudre(abs);
			if (reel === null) return;
			try {
				if (!(await fs.stat(reel)).isFile()) return;
			} catch {
				return;
			}
			if (!fichiersLecture.some(f => f.toLowerCase() === reel.toLowerCase())) fichiersLecture.push(reel);
		},
		async contient(chemin) {
			return (await dansPerimetre(chemin)) !== null;
		},
		async estRacine(chemin) {
			const reel = await resoudre(chemin);
			if (reel === null) return false;
			return racines.some(r => r.toLowerCase() === reel.toLowerCase());
		},
		async borner(chemin) {
			/* `typeof` d'abord : un objet ou un nombre venu de l'IPC ne doit pas
			   atteindre `path.resolve`, qui jetterait une erreur sans rapport. */
			if (typeof chemin !== "string" || !chemin.trim()) {
				throw new Error("chemin invalide : " + JSON.stringify(chemin));
			}
			if ((await dansPerimetre(chemin)) === null) {
				throw new Error("chemin hors des dossiers ouverts : " + chemin);
			}
			return normaliser(path.resolve(chemin));
		},
		async bornerEcriture(chemin) {
			if (typeof chemin !== "string" || !chemin.trim()) {
				throw new Error("chemin invalide : " + JSON.stringify(chemin));
			}
			if ((await dansPerimetre(chemin, true)) === null) {
				throw new Error("chemin hors des dossiers ouverts (écriture) : " + chemin);
			}
			return normaliser(path.resolve(chemin));
		},
		racines() {
			return [...racines];
		},
	};
}

/** La clé des réglages où le rendu persiste ses dossiers (`host/folder.ts`),
    et l'ancienne au singulier. Nommées ici parce que le principal les LIT au
    démarrage pour nourrir le périmètre, et les GARDE à l'écriture
    (`canaux.ts`, `verifierDossiers`). */
export const CLE_DOSSIERS = "folders";
export const CLE_DOSSIER_LEGACY = "folder";

/** Les chemins que porte une valeur de la clé `folders` (tableau d'objets
    `{ path }`) ou de l'ancienne clé `folder` (une chaîne). Tolérant sur la
    forme — c'est `host/folder.ts` qui la valide — strict sur le contenu. */
export function cheminsDeDossiers(valeur: unknown): string[] {
	if (typeof valeur === "string") return [valeur];
	if (!Array.isArray(valeur)) return [];
	return valeur
		.map(e => (e && typeof e === "object" ? (e as { path?: unknown }).path : undefined))
		.filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

/**
 * Le périmètre du DÉMARRAGE : les dossiers retenus à la session précédente y
 * entrent, lus dans les réglages par le principal lui-même — le pendant de ce
 * que faisait `allowFolder` à chaque lancement côté Tauri, sauf que ce n'est
 * plus le rendu qui dicte. Un dossier disparu est simplement absent
 * (`autoriser` l'ignore), sans empêcher les autres.
 *
 * `dossierDonnees` (le `userData` d'Electron) est REÇU POUR ÊTRE CRÉÉ, jamais
 * autorisé (Ruling 12) : il porte `settings.json`, dont la clé `folders`
 * nourrit ce périmètre au démarrage suivant. L'y admettre laisserait un rendu
 * hostile écrire ce fichier en BRUT par `fichiers.write` —
 * `{"folders":[{"path":"C:/"}]}` — hors de la garde de `reglages.ecrire`, et
 * obtenir tout le disque de façon PERSISTANTE. Les réglages ne passent que par
 * leur canal gardé. Créé quand même : `reglages.ts` y pose son temporaire dès
 * la première écriture, et `autoriser` d'un vault n'en dépend pas. Cette
 * fonction vit ici, et non dans `main.ts`, pour que l'invariant soit ÉPROUVÉ
 * sur le module réel (`scripts/check-electron-reglages.mjs`).
 */
export async function perimetreInitial(options: {
	dossierDonnees: string;
	reglages: Reglages;
	/** Le dossier de quiz par défaut (`dossier-defaut.ts`), déjà CRÉÉ par
	    l'appelant (`main.ts`, `fs.mkdir` avant cet appel). Autorisé EN
	    PREMIER, et sans dépendre d'aucun réglage : c'est ce qui rend le
	    premier lancement possible sans écran de choix — un utilisateur qui
	    n'a jamais rien réglé doit quand même pouvoir écrire dedans. */
	dossierDefaut: string;
}): Promise<Perimetre> {
	const perimetre = creerPerimetre();
	await fs.mkdir(options.dossierDonnees, { recursive: true });
	await perimetre.autoriser(options.dossierDefaut);
	for (const cle of [CLE_DOSSIERS, CLE_DOSSIER_LEGACY]) {
		let valeur: unknown;
		try {
			valeur = await options.reglages.lire(cle);
		} catch (e) {
			// Réglages illisibles : le rendu le verra à son tour et l'affichera ;
			// ici, on démarre simplement sans dossier.
			console.warn(LOG_PREFIX, "réglages illisibles au démarrage:", e);
			return perimetre;
		}
		for (const chemin of cheminsDeDossiers(valeur)) await perimetre.autoriser(chemin);
	}
	/* Le dossier du fond d'écran (tâche 4 de la tranche 8), ADMIS de la MÊME
	   façon que les dossiers de quiz : sans quoi, au lancement suivant, le
	   protocole `app:` (`ressources.ts`) rejetterait 403 chaque image du
	   dossier choisi lors d'une session antérieure — le fond disparaîtrait
	   au premier redémarrage. Un `dossier` non-chaîne ou vide n'admet rien :
	   c'est le cas que `check:electron-reglages` éprouve par discriminance. */
	try {
		const fond = await options.reglages.lire(CLE_REGLAGES_FOND);
		/* La forme EMBARQUÉE n'a aucun chemin : un `dossier` qui l'accompagne
		   (écrit à la main, ou avant la garde) n'admet rien. */
		const embarque = fond && typeof fond === "object" && (fond as { embarque?: unknown }).embarque !== undefined;
		const dossier = fond && typeof fond === "object" && !embarque ? (fond as { dossier?: unknown }).dossier : undefined;
		if (typeof dossier === "string" && dossier.trim() !== "") await perimetre.autoriser(dossier);
	} catch (e) {
		console.warn(LOG_PREFIX, "réglage du fond illisible au démarrage:", e);
	}
	return perimetre;
}
