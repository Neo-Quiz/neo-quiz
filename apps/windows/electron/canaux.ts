/* ══════════════════════════════════════════════════════════
   LES CANAUX — UN GESTIONNAIRE PAR MÉTHODE DU PONT

   Tâche 3 de la migration Tauri → Electron, ronde de correction 1. Ce module
   enregistre les `ipcMain.handle` du pont (`./pont.ts`) et tient l'état du
   DISQUE vu par le processus principal (racines déclarées, index, surveillant).
   `main.ts` ne garde que la fenêtre et son cycle de vie : les deux
   responsabilités ne partagent rien d'autre que `deps.envoyer`, par lequel le
   surveillant pousse ses événements vers le rendu.

   LA RÈGLE QUI GOUVERNE CE FICHIER : aucun chemin venu du rendu n'atteint une
   primitive sans passer par le périmètre (`./perimetre.ts`) — depuis le
   2026-09-17, par DEUX portes. `perimetre.borner` pour tout ce qui LIT ou
   OUVRE (`read`, `readBinary`, `exists`, `stat`, `statEntree`, `list`,
   `listerDossier`, `liste`, `ouvrir`…) ; `perimetre.bornerEcriture` pour tout
   ce qui ÉCRIT, DÉPLACE ou EFFACE (`write`, `writeBinary`, `append`, la
   moitié écriture de `process` — `ecrireSiInchange` —, `mkdirs`, `trash`,
   `remove`, `rename` sur ses deux arguments) : elle n'accepte que les
   RACINES, jamais un fichier admis par le dialogue natif. Tous les canaux
   `fichiers.*`, plus `systeme.ouvrir`, passent par l'une des deux ;
   `demarrer` FILTRE ses racines contre le périmètre au lieu de le définir ;
   et les deux clés des réglages qui donnent un DROIT au principal sont
   GARDÉES à l'écriture : `folders`, qui nourrit le périmètre au prochain
   démarrage, et `ai` (`garde-ia.ts`), dont l'hôte d'`aiOllamaUrl` entre dans
   la liste du réseau et dont `aiMentionExtraFolders` désigne des dossiers lus
   par les canaux. `ouvrir` refuse EN PLUS les extensions exécutables
   (`EXTENSIONS_EXECUTABLES`, `ressources.ts`) : le périmètre borne l'écriture
   et la lecture, pas l'exécution, et `write` puis `ouvrir` d'un `.bat` les
   composerait.

   ET LA MÊME RÈGLE POUR LES URL : les canaux `reseau.*` passent par
   `fetchBorne` (`./reseau.ts`), qui refuse tout hôte hors de sa liste. Le
   rendu ne définit ni les chemins qu'il lit, ni les hôtes qu'il joint.

   AUCUN `ipcMain.on` : tout est `ipcMain.handle`. Un canal sans réponse ne
   peut pas être attendu, et l'appelant ne saurait jamais si son écriture a
   réussi.
══════════════════════════════════════════════════════════ */

import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, net, Notification, screen, shell } from "electron";
import * as os from "node:os";
import { infosAppareil } from "./appareil";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
// Le dossier par défaut CHOISI est créé ici s'il manque — voir son canal.
import * as fsp from "node:fs/promises";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { creerFichiers, stat, statEntree } from "./fichiers";
import { absoluDepuisContrat, contratDepuisAbsolu, creerIndex, renameDirVersAbsolu } from "./index-fichiers";
import type { EvenementSurveillant, Index } from "./index-fichiers";
import { listerRacine, normaliser } from "./parcours";
import { t } from "../../../src/i18n";
import { createNotificationGate, prepareNotification } from "./notification";
import { validerReglagesIa } from "./garde-ia";
import { hoteEcoleARetirer, origineSite, validerReglagesMoodle } from "./moodle/garde";
import { siteVerifie, verifierSite } from "./moodle/compat";
import { ECOLES } from "./moodle/ecoles";
import type { ServiceMoodle } from "./moodle/service";
import { CLE_DOSSIERS, CLE_DOSSIER_LEGACY, cheminsDeDossiers } from "./perimetre";
import type { Perimetre } from "./perimetre";
import { arreterDisposerPourSite, demarrerOllama, disposerPourSite, disposerPourTerminal, iconeDeType, restaurerNavigateur, verifierNavigateurVisible, erreurCli, estOutilAutorise, lancerTerminal, lireCache, lireAncre, ollamaInstalle, openPlainTerminal, poserFenetre, rectangleTerminal, run, scriptConnexion, scriptUsageTerminal } from "./process";
import { deconnecterCompte, etatComptes, usageCompte } from "./comptes";
import { codexResets } from "./codex-resets";
import type { ResetCredit } from "../../../src/dashboard/codex-resets";
import type { AncreTerminal, EtatCompte } from "../../../src/host/types";
import type { UsageRead } from "../../../src/dashboard/usage-format";
import type { Outil } from "./process";
import type { MiseAJour } from "./mise-a-jour";
import { CANAUX, PARTAGE_OCCUPE, CLE_DOSSIER_DEFAUT, CLE_REGLAGES_FOND, CLE_REGLAGES_IA, CLE_REGLAGES_MOODLE, CLE_REGLAGES_ZOOM, borneZoom } from "./pont";
import type { EnveloppeVideo, EtatFenetre, EvenementDisque, RequeteCli, RequeteReseau, ResultatCli } from "./pont";
import type { Reglages } from "./reglages";
import { autoriserHote, fetchBorne, retirerHote } from "./reseau";
import { extensionRefusee } from "./ressources";
import { vaultsObsidian } from "./vaults";
import { argumentsAutorises } from "./gabarits-cli";
import { creerReprises, estCleReprise } from "./resumable-runs";

/** How long a generation whose page reloaded waits to be claimed again
    before it is stopped: a reload takes seconds, a restored queue restarts
    its line at once. */
const DELAI_REPRISE_MS = 60_000;
/** The output kept for a later attach (characters): the transcript of a
    long generation, never the result, which is held apart. */
const TAILLE_MAX_REPRISE = 8_000_000;

/** The fingerprint of a CLI call for an attach: the tool, the arguments and
    the input, with the call's random marker taken out of both. */
function empreinteAppel(tool: string, args: readonly string[], stdin: string, marqueur: string): string {
	const sans = (x: string): string => (marqueur ? x.split(marqueur).join("") : x);
	return createHash("sha256").update(JSON.stringify([tool, args.map(sans), sans(stdin)])).digest("hex");
}
import { creerPartageFichier, ecrireTemporaire, lancerPartageNatif, nomPartage, octetsPartage, verrouEnregistrer, verrouNatif, verrouSync } from "./partage";
import { creerAttente, jetonValide } from "./attente-collage";
import { CAPTURE_MIN_INTERVAL_MS, captureRect, createRateGate, htmlBytes, htmlFileName } from "./frame-export";
/* LA LECTURE D'UNE VIDÉO (tâche 4) : `ID_VIDEO` vient du noyau pur
   (`src/video/`, sans Node) et est importé PAR LE PRINCIPAL — c'est
   l'exception nommée au `CLAUDE.md` du dépôt : `check:host` juge la
   direction RENDU → Node, pas celle-ci. Le principal juge donc
   l'identifiant AVANT tout lancement, comme les noms d'outils. */
import { ID_VIDEO } from "../../../src/video";
import type { LibellesDocument } from "../../../src/video";
import { annulerVideo, codeErreurVideo, transcrire } from "./video";
import type { CodeErreurVideo, ResultatVideo } from "./video";
import { etat as etatInstallation, infosInstallation, installer as installerYtDlp, mettreAJourSiDu } from "./video-installation";
import type { CodeInstallation } from "./telechargement";
import { estErreurInstallation } from "./telechargement";
/* CODE EXECUTION (task 4): `BacASable` comes from the main process's core
   (`./code-sandbox.ts`, task 3 of the C/C++ execution plan — generalised
   from Python-only, no behaviour change), which holds the hidden window and
   its isolation. VALUE import forbidden here: this module instantiates
   nothing, only `main.ts` creates the sandbox and passes it via
   `deps.code`. `CodeRun`/`CodeLanguage` are the shared contract
   (`src/host/types.ts`, `src/code-languages.ts`) that `HostCode` on the
   render side also uses. */
import type { CodeRun } from "../../../src/host/types";
import type { CodeLanguage } from "../../../src/code-languages";
import type { BacASable } from "./code-sandbox";
/* THE LANGUAGE PACKS (task 9): download, verify, install, delete — the pack
   is pinned in `langages.ts`; the renderer only names the language. */
import { etatLangage, installerLangage, PACKS, supprimerLangage } from "./langages";
import type { NomPack } from "./langages";
/* THE SYNC (task 6 of the Android v1 plan): the embedded Syncthing, created by
   `main.ts` (never from the window). Only the three verbs below reach it. */
import type { GestionSync } from "./syncthing";
import { isDeviceId, reglageReserve } from "./syncthing-regles";

/** Ce que les canaux demandent à `main.ts`. */
export interface DependancesCanaux {
	perimetre: Perimetre;
	/** Les réglages, ou une erreur NOMMÉE si l'application n'est pas prête :
	    un `null` silencieux ferait repartir l'utilisateur de l'écran de choix
	    sans que rien ne dise pourquoi. */
	reglagesOuErreur(): Reglages;
	/** Le chemin absolu du dossier de quiz par défaut (tranche 9), déjà créé
	    et autorisé au périmètre par `main.ts` — le canal `systeme.dossierDefaut`
	    le sert tel quel, sans autre calcul.
	    UNE FONCTION, ET NON PLUS UNE CHAÎNE : depuis que l'utilisateur peut le
	    CHANGER en cours de session (`systeme.choisirDossierDefaut`), une valeur
	    capturée au démarrage servirait l'ANCIEN chemin jusqu'au redémarrage —
	    la fenêtre rechargerait sur le dossier qu'elle vient de quitter. */
	dossierDefaut(): string;
	/** Retient le nouveau dossier par défaut, une fois le dialogue accepté et
	    le chemin admis au périmètre. C'est `main.ts` qui tient la variable :
	    lui seul l'a lue au démarrage, et lui seul doit la corriger. */
	poserDossierDefaut(abs: string): void;
	/** Pousse une charge vers la fenêtre (`webContents.send`), si elle existe. */
	envoyer(canal: string, charge: unknown): void;
	/** La fenêtre, pour y RATTACHER un dialogue natif (modal de la fenêtre,
	    pas de l'application) ; `null` avant qu'elle existe ou après sa
	    destruction — le dialogue s'ouvre alors seul. */
	fenetreCourante(): BrowserWindow | null;
	fermeture: { armer(): void; terminee(): void };
	miseAJour: MiseAJour;
	/** Ferme la fenêtre par le chemin de fermeture existant (écritures
	    différées vidées) ; `main.ts` lance `quitAndInstall` une fois tout
	    fermé. */
	fermerPourInstaller(): void;
	/** The frameless window: orders and state reading, implemented by
	    `main.ts` on the `BrowserWindow` instance. */
	fenetre: {
		prete(): void;
		reduire(): void;
		premierPlan(): void;
		agrandirOuRestaurer(): void;
		fermer(): void;
		pleinEcran(): void;
		etat(): EtatFenetre;
		zoom(f: number): void;
		recharger(): void;
		outilsDev(): void;
	};
	/** The code sandbox (task 3, `./code-sandbox.ts`), created and closed by
	    `main.ts` — this file only relays calls to it. Only Python reaches it
	    today; `c`/`cpp` answer `not-installed` until task 8. */
	code: BacASable;
	/** The embedded Syncthing, `null` where there is none (Linux): the `sync`
	    channels are then not registered at all. */
	sync: GestionSync | null;
	/** Moodle (`./moodle/service.ts`), created by `main.ts`. */
	moodle: ServiceMoodle;
	/** The pairing link Windows handed to the app (`lienAppairageExterne`,
	    already validated), forgotten once taken; `null` when there is none. */
	prendreLienAppairage?: () => string | null;
	/** Where the language packs live (`userData/languages`, the same
	    directory `main.ts` gives the sandbox), fixed by `main.ts`: never a
	    path from the renderer. */
	dossierLangages: string;
}

/** L'état du disque tenu par ce processus — voir `enregistrerCanaux`. */
interface EtatDisque {
	/** Les racines déclarées par `demarrer`, filtrées et normalisées. */
	racinesAbs: string[];
	index: Index | null;
	arreterSurveillance: (() => void) | null;
}

const fichiers = creerFichiers();

/* ─────────── ce qui franchit le pont ─────────── */

/**
 * L'événement du surveillant, retraduit en chemin ABSOLU.
 *
 * L'index porte une convention INTERNE (« 0/Cours/ch1.md », l'indice de la
 * racine en tête) qui ne franchit JAMAIS le pont : les chemins du CONTRAT sont
 * les clés du journal de révision, et `src/host/types.ts` avertit qu'un second
 * endroit qui les recomposerait ferait diverger deux historiques sans que
 * personne ne le voie. Le rendu, qui tient `CarteRacines`, est ce seul endroit.
 *
 * `rename` (de FICHIER) ne peut pas arriver (l'index n'émet que
 * `create`/`modify`/`delete` depuis chokidar) — le `null` est là pour que le
 * jour où il en émettrait un, ce soit un silence visible à la lecture plutôt
 * qu'un `abs` indéfini poussé dans la fenêtre.
 *
 * `renameDir` (tâche 5), lui, ARRIVE bel et bien — l'index l'émet une fois la
 * paire `unlinkDir`/`addDir` appariée (voir `EvenementRenommageDossier`,
 * `index-fichiers.ts`) — et il porte DEUX chemins du contrat à retraduire.
 * La traduction elle-même (`renameDirVersAbsolu`) est PURE et vit dans
 * `index-fichiers.ts`, pas ici : ce fichier importe `electron`, et aucun
 * harnais de contrôle ne peut le charger (`check-electron-index.mjs` charge
 * `index-fichiers.ts` directement) — une fonction pure prisonnière d'ici
 * resterait éprouvée seulement à la main.
 */
function versDisque(racinesAbs: string[], ev: EvenementSurveillant): EvenementDisque | null {
	if (ev.kind === "rename") return null;
	if (ev.kind === "renameDir") {
		const paire = renameDirVersAbsolu(racinesAbs, ev);
		return paire ? { kind: "renameDir", fromAbs: paire.fromAbs, toAbs: paire.toAbs } : null;
	}
	const contrat = ev.kind === "delete" ? ev.path : ev.file.path;
	const absolu = absoluDepuisContrat(racinesAbs, contrat);
	if (!absolu) return null;
	const abs = normaliser(absolu);
	return ev.kind === "delete" ? { kind: "delete", abs } : { kind: ev.kind, abs, mtime: ev.file.mtime, ...(ev.file.ctime ? { ctime: ev.file.ctime } : {}) };
}

/** Le `mtime` que l'écriture vient de produire — voir « LES QUATRE ÉCRITURES
    RENDENT LE `mtime` NEUF » dans `pont.ts`. Un `stat` qui échoue rend 0 plutôt
    que de faire échouer une écriture qui, elle, a réussi : la refuser après
    coup serait mentir dans l'autre sens. */
async function fraicheur(abs: string): Promise<{ mtime: number }> {
	const info = await stat(abs);
	return { mtime: info ? info.mtime : 0 };
}

/**
 * Écrit un fichier TEXTE, par l'index quand le chemin tombe sous une racine.
 *
 * POURQUOI PASSER PAR L'INDEX, alors que le `mtime` rendu à la fenêtre vient
 * d'un `stat` et pas de lui : l'index du principal sert de garde au
 * surveillant (`surSuppression` n'annonce la disparition que d'un fichier
 * qu'il connaît). Une note créée puis mise à la corbeille dans la même fenêtre
 * de débounce n'y serait jamais entrée, sa suppression serait donc AVALÉE, et
 * le miroir du rendu — qui, lui, l'a apprise par le `mtime` rendu ici —
 * garderait un quiz fantôme que plus rien ne peut retirer.
 *
 * `writeBinary` et `append` ne passent pas par là : l'index n'a pas de variante
 * binaire, et le seul appelant d'`append` (le journal de révision) écrit sous
 * `.neo-quiz/`, hors catalogue par construction.
 */
async function ecrireTexte(etat: EtatDisque, abs: string, contenu: string): Promise<void> {
	const contrat = etat.index ? contratDepuisAbsolu(etat.racinesAbs, normaliser(abs)) : null;
	if (etat.index && contrat) await etat.index.write(contrat, contenu);
	else await fichiers.write(abs, contenu);
}

/* ─────────── les canaux ─────────── */

/* PLUS DE RÉGLAGE « chemin de l'exécutable » (2026-09-17) : `cheminCliRegle`
   lisait la clé `ai` du magasin du principal et rejouait sa garde au
   lancement. Les deux champs des Réglages sont partis, et avec eux la seule
   façon dont un chemin d'exécutable pouvait venir de la fenêtre. Ce qui lance
   un CLI, désormais, est un NOM de la liste blanche résolu sur le `PATH` —
   celui du processus, fusionné au démarrage avec le `PATH` du REGISTRE
   (`process.ts`, `chargerPathRegistre`), qui est ce que les deux champs
   rattrapaient à la main. */

/** REJETTE si un des dossiers de la valeur n'est pas déjà dans le périmètre. */
async function verifierDossiers(perimetre: Perimetre, valeur: unknown): Promise<void> {
	for (const chemin of cheminsDeDossiers(valeur)) {
		if (!(await perimetre.contient(chemin))) {
			throw new Error("dossier hors périmètre, refusé dans les réglages : " + chemin);
		}
	}
}

/** REJETTE la clé du fond d'écran si elle n'est pas de la forme attendue : le
    `dossier` nourrit le périmètre au prochain démarrage (`perimetreInitial`),
    donc la garde est ici, à l'ÉCRITURE, exactement comme `verifierDossiers` —
    sinon un rendu compromis écrirait `{ dossier: "C:/…/Startup", image: "x" }`
    et obtiendrait ce dossier au périmètre à la session suivante. `null`/
    `undefined` (retrait du réglage) sont acceptés : ils n'admettent rien.
    `image` est un NOM de fichier venu de `listerDossier`, jamais un chemin :
    tout séparateur ou `..` y est refusé. */
async function verifierDossierFond(perimetre: Perimetre, valeur: unknown): Promise<void> {
	if (valeur === null || valeur === undefined) return;
	if (typeof valeur !== "object") {
		throw new Error("réglage fond refusé : valeur n'est pas un objet : " + String(valeur));
	}
	/* LA FORME EMBARQUÉE (`{ embarque }`) n'a AUCUN chemin : la photo est
	   livrée avec l'application et servie par elle. Il n'y a donc rien à juger
	   contre le périmètre — et rien à y admettre au démarrage suivant, ce qui
	   est précisément ce que cette garde existe pour empêcher. Une valeur
	   d'identifiant inconnue est sans danger et sans effet : le rendu la relit
	   avec son catalogue (`fonds-catalogue.ts`) et retombe sur le fond par
	   défaut si elle n'y figure pas. */
	const embarque = (valeur as { embarque?: unknown }).embarque;
	if (embarque !== undefined) {
		if (typeof embarque !== "string" || embarque.trim() === "") {
			throw new Error("réglage fond refusé : embarque doit être une chaîne : " + String(embarque));
		}
		/* PAS de `dossier` NI d'`image` à côté : `perimetreInitial` admet
		   `fond.dossier` au démarrage suivant, et cette forme sortait avant de le
		   regarder — `{ embarque: "x", dossier: "<racine du disque>" }` élargissait
		   le périmètre (revue de sécurité du 2026-10-01). */
		if ("dossier" in valeur || "image" in valeur) {
			throw new Error("réglage fond refusé : embarque n'admet ni dossier ni image");
		}
		return;
	}
	const dossier = (valeur as { dossier?: unknown }).dossier;
	const image = (valeur as { image?: unknown }).image;
	if (typeof dossier !== "string" || dossier.trim() === "") {
		throw new Error("réglage fond refusé : dossier invalide : " + String(dossier));
	}
	if (!(await perimetre.contient(dossier))) {
		throw new Error("réglage fond refusé : dossier hors périmètre : " + dossier);
	}
	if (typeof image !== "string" || image.trim() === "" || image.includes("/") || image.includes("\\") || image.includes("..")) {
		throw new Error("réglage fond refusé : image invalide : " + String(image));
	}
}

/** REJETTE le dossier par défaut s'il n'est pas une chaîne déjà au périmètre.
    Même raison que `verifierDossiers` : `perimetreInitial` l'admet au
    démarrage suivant, donc un chemin qui n'y est pas encore élargirait le
    périmètre d'une session à l'autre. `null`/`undefined` (retour au chemin
    calculé) n'admettent rien : acceptés. */
async function verifierDossierDefaut(perimetre: Perimetre, valeur: unknown): Promise<void> {
	if (valeur === null || valeur === undefined) return;
	if (typeof valeur !== "string" || valeur.trim() === "") {
		throw new Error("dossier par défaut refusé : valeur invalide : " + String(valeur));
	}
	if (!(await perimetre.contient(valeur))) {
		throw new Error("dossier par défaut refusé : hors périmètre : " + valeur);
	}
}

/** Ce que `enregistrerCanaux` rend à `main.ts` : de quoi arrêter l'attente
    d'une réponse copiée à la fermeture de la fenêtre (voir `fenetre.on("closed", ...)`
    dans `main.ts`), pour ne pas laisser une sonde tourner sans personne pour
    la recevoir. */
export interface ResultatCanaux {
	arreterAttente(): void;
}

export function enregistrerCanaux(deps: DependancesCanaux): ResultatCanaux {
	const { perimetre, reglagesOuErreur, dossierDefaut, poserDossierDefaut } = deps;
	/* L'état du DISQUE vu par ce processus : les racines déclarées, l'index et
	   son surveillant. Il vit ici, pas dans `main.ts` : la fenêtre n'a pas à le
	   connaître, elle ne fait que recevoir ce que `deps.envoyer` lui pousse. */
	const etat: EtatDisque = { racinesAbs: [], index: null, arreterSurveillance: null };

	ipcMain.handle(CANAUX.demarrer, async (_e, racines: unknown) => {
		/* Un second appel REMPLACE : le rendu recharge la page quand les racines
		   changent, et laisser vivre l'ancien surveillant ferait pousser dans la
		   fenêtre des événements portant les indices de l'ancienne liste. */
		etat.arreterSurveillance?.();
		etat.arreterSurveillance = null;
		/* FILTRÉES contre le périmètre, jamais prises pour argent comptant :
		   cet argument vient du rendu, et `demarrer(["C:/"])` ferait sinon du
		   surveillant et de l'index une lecture de tout le disque. Une racine
		   refusée est NOMMÉE dans la console plutôt qu'ignorée en silence. */
		const gardees: string[] = [];
		for (const r of Array.isArray(racines) ? racines : []) {
			if (typeof r === "string" && (await perimetre.contient(r))) gardees.push(normaliser(r));
			else console.warn(LOG_PREFIX, "racine hors périmètre, ignorée:", r);
		}
		etat.racinesAbs = gardees;
		etat.index = creerIndex(gardees);
	});

	/* CHAQUE canal `fichiers.*` passe par `borner` — la seule porte vers une
	   primitive. Un chemin hors périmètre REJETTE avec sa cause ; la primitive
	   ne voit jamais la chaîne brute du rendu. */
	ipcMain.handle(CANAUX.read, async (_e, abs: unknown, max: unknown) => {
		const borne = typeof max === "number" && Number.isInteger(max) && max >= 0 && max <= 64_000_000 ? max : undefined;
		return fichiers.read(await perimetre.borner(abs), borne);
	});
	ipcMain.handle(CANAUX.readCached, async (_e, abs: unknown) => fichiers.readCached(await perimetre.borner(abs)));

	/* Every write of the app is announced to the sync, which scans it at once
	   when it lies in the shared folder (real time, 2026-10-03). */
	const ecrit = (a: string): void => { deps.sync?.signalerEcriture(a); };

	ipcMain.handle(CANAUX.write, async (_e, abs: unknown, contenu: string) => {
		const a = await perimetre.bornerEcriture(abs);
		await ecrireTexte(etat, a, String(contenu));
		ecrit(a);
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.lirePourEcriture, async (_e, abs: unknown) => {
		const a = await perimetre.borner(abs);
		// `read` et non `readCached` : c'est la moitié LECTURE d'un
		// lire-modifier-écrire, elle doit voir le disque tel qu'il est.
		const contenu = await fichiers.read(a);
		const { mtime } = await fraicheur(a);
		return { contenu, mtime };
	});

	/* La seconde moitié de `process` — voir « `process`, EN DEUX TEMPS » dans
	   `pont.ts`. La comparaison porte sur le CONTENU : un `mtime` dont la
	   granularité vaut plusieurs millisecondes ne distinguerait pas deux
	   écritures rapprochées. `null` n'est pas une erreur, c'est la réponse
	   « le fichier a changé, rejoue ton rappel ». */
	ipcMain.handle(CANAUX.ecrireSiInchange, async (_e, abs: unknown, lu: string, contenu: string) => {
		const a = await perimetre.bornerEcriture(abs);
		const actuel = await fichiers.read(a);
		if (actuel !== lu) return null;
		await ecrireTexte(etat, a, String(contenu));
		ecrit(a);
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.writeBinary, async (_e, abs: unknown, data: Uint8Array) => {
		const a = await perimetre.bornerEcriture(abs);
		await fichiers.writeBinary(a, data);
		ecrit(a);
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.append, async (_e, abs: unknown, contenu: string) => {
		const a = await perimetre.bornerEcriture(abs);
		await fichiers.append(a, String(contenu));
		ecrit(a);
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.exists, async (_e, abs: unknown) => fichiers.exists(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.mkdirs, async (_e, abs: unknown) => fichiers.mkdirs(await perimetre.bornerEcriture(abs)));
	/* `racine` doit ÊTRE une racine autorisée, pas seulement y tomber : c'est
	   d'elle que `trash` déduit `<racine>/.trash/<relatif>`, et une racine
	   quelconque ferait de `path.relative` un `../../…` — un déplacement vers
	   n'importe où. Et `abs` doit tomber SOUS cette racine-là. */
	ipcMain.handle(CANAUX.trash, async (_e, abs: unknown, racine: unknown) => {
		const a = await perimetre.bornerEcriture(abs);
		if (typeof racine !== "string" || !(await perimetre.estRacine(racine))) {
			throw new Error("trash : racine inconnue : " + String(racine));
		}
		const r = normaliser(path.resolve(racine));
		if (contratDepuisAbsolu([r], a) === null) throw new Error("trash : " + a + " n'est pas sous " + r);
		await fichiers.trash(a, r);
		ecrit(a);
	});
	/* NORMALISÉE : `fichiers.list` compose ses chemins avec `path.join`, donc
	   avec des `\` sous Windows. Tout ce qui franchit le pont doit avoir la même
	   forme, sinon le miroir du rendu tiendrait deux clés pour un seul fichier. */
	ipcMain.handle(CANAUX.list, async (_e, dossier: unknown) =>
		(await fichiers.list(await perimetre.borner(dossier))).map(normaliser));
	ipcMain.handle(CANAUX.remove, async (_e, abs: unknown) => {
		const a = await perimetre.bornerEcriture(abs);
		await fichiers.remove(a);
		ecrit(a);
	});
	/* A DIRECTORY (or junction) rename runs with the file watcher closed:
	   chokidar holds one OS handle per watched directory and Windows refuses
	   (EPERM) to rename a directory with an open handle on it or below it. The
	   index restarts the watcher and reconciles itself afterwards, success or
	   not (`Index.suspendre`). A FILE rename works under the watcher: it stays
	   on the direct path. */
	ipcMain.handle(CANAUX.rename, async (_e, de: unknown, vers: unknown) => {
		const source = await perimetre.bornerEcriture(de);
		const cible = await perimetre.bornerEcriture(vers);
		const info = await fsp.lstat(source).catch(() => null);
		const dossier = !!info && (info.isDirectory() || info.isSymbolicLink());
		if (dossier && etat.index) await etat.index.suspendre(() => fichiers.rename(source, cible));
		else await fichiers.rename(source, cible);
		ecrit(source);
		ecrit(cible);
	});
	ipcMain.handle(CANAUX.stat, async (_e, abs: unknown) => stat(await perimetre.borner(abs)));
	/* Les trois canaux des RACINES EXTERNES du sélecteur « @ » (`HostFs.externe`,
	   `src/host/types.ts`), BORNÉS comme tous les autres : c'est le périmètre,
	   et lui seul, qui autorise cette interface côté application — une racine
	   externe qui n'est pas un dossier ouvert rejette ici, nommée par `borner`,
	   et le rendu en fait `[]`/`null`. `listerDossier` rend des NOMS, jamais
	   des chemins : le rendu recompose, contrat ou absolu (règle de l'en-tête
	   de `pont.ts`). */
	ipcMain.handle(CANAUX.statEntree, async (_e, abs: unknown) => statEntree(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.listerDossier, async (_e, dossier: unknown) =>
		fichiers.listerDossier(await perimetre.borner(dossier)));
	ipcMain.handle(CANAUX.readBinary, async (_e, abs: unknown) => fichiers.readBinary(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.liste, async (_e, racine: unknown) => listerRacine(await perimetre.borner(racine)));

	ipcMain.handle(CANAUX.surveiller, () => {
		/* La cause est NOMMÉE : un surveillant qui ne démarre pas en silence
		   donnerait une fenêtre où rien ne se met plus à jour, sans erreur. */
		if (!etat.index) throw new Error("surveiller() avant demarrer() : aucune racine déclarée");
		if (etat.arreterSurveillance) return; // déjà monté : un second watcher serait redondant.
		etat.arreterSurveillance = etat.index.surveiller(ev => {
			const disque = versDisque(etat.racinesAbs, ev);
			if (disque) deps.envoyer(CANAUX.evenement, disque);
		});
	});

	ipcMain.handle(CANAUX.choisirDossier, async () => {
		const choix = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		// Annulation : la réponse « non », pas une erreur.
		if (choix.canceled || choix.filePaths.length === 0) return null;
		// Le dossier que l'UTILISATEUR vient de désigner entre au périmètre :
		// c'est l'une des trois portes (avec les réglages et les vaults).
		await perimetre.autoriser(choix.filePaths[0]);
		return normaliser(choix.filePaths[0]);
	});

	ipcMain.handle(CANAUX.reglagesLire, (_e, cle: string) => reglagesOuErreur().lire(String(cle)));
	ipcMain.handle(CANAUX.reglagesEcrire, async (_e, cle: string, valeur: unknown) => {
		/* La clé des DOSSIERS est GARDÉE : elle nourrit le périmètre au prochain
		   démarrage, donc un rendu qui y écrirait `{ path: "C:/" }` obtiendrait
		   tout le disque à la session suivante. Chaque chemin doit déjà être
		   dans le périmètre — venu du sélecteur ou des vaults d'Obsidian. */
		if (cle === CLE_DOSSIERS || cle === CLE_DOSSIER_LEGACY) await verifierDossiers(perimetre, valeur);
		/* La clé `ai` est GARDÉE de la même façon, AVANT l'écriture, et pour la
		   même raison : l'hôte d'`aiOllamaUrl` entre dans la liste du réseau
		   (`main.ts` l'y admet au démarrage) et `aiMentionExtraFolders` désigne
		   des dossiers que les canaux `fichiers.*` liront. Le verdict est pur
		   (`garde-ia.ts`, éprouvé par `check:electron-reglages`) ; ici ne
		   restent que la porte NATIVE et l'admission. */
		if (cle === CLE_REGLAGES_IA) await garderReglagesIa(valeur);
		/* The `moodle` key too: its `site` is where a login token is sent, so a
		   NEW host is asked of the user through a native dialog. */
		if (cle === CLE_REGLAGES_MOODLE) await garderReglagesMoodle(valeur);
		/* La clé du FOND D'ÉCRAN est gardée pour la même raison que `folders` :
		   `perimetreInitial` admet `fond.dossier` au démarrage suivant. */
		if (cle === CLE_REGLAGES_FOND) await verifierDossierFond(perimetre, valeur);
		/* Le dossier PAR DÉFAUT nourrit lui aussi le périmètre au démarrage
		   suivant. Le rendu n'a aucune raison d'écrire cette clé — c'est
		   `systeme.choisirDossierDefaut` qui la pose — mais la porte générique
		   reste ouverte, et une clé gardée nulle part est une clé libre. */
		if (cle === CLE_DOSSIER_DEFAUT) await verifierDossierDefaut(perimetre, valeur);
		/* `syncActif` decides whether a binary is launched at startup: only the
		   main process writes it (after a first pairing). */
		if (reglageReserve(String(cle))) throw new Error("réglage refusé : " + String(cle) + " n'est écrit que par le processus principal");
		await reglagesOuErreur().ecrire(String(cle), valeur);
	});

	/** Refuse (rejet nommé, rien d'écrit), demande à l'utilisateur, ou admet
	    l'hôte d'Ollama dans la liste du réseau — AUSSITÔT, pas au prochain
	    lancement : un NAS déclaré dans les réglages doit répondre dans la
	    session où on l'a déclaré. */
	async function garderReglagesIa(valeur: unknown): Promise<void> {
		/* DEUX prédicats, et ils ne se confondent pas : le PÉRIMÈTRE juge les
		   dossiers que le sélecteur « @ » lira, l'EXISTENCE juge le chemin d'un
		   exécutable — lequel vit précisément HORS du périmètre (un CLI est dans
		   `Program Files`, pas dans un dossier de quiz). Le borner serait refuser
		   d'avance tout chemin valide ; ce qui le tient, c'est la liste blanche
		   d'extensions et le fait que l'utilisateur, et lui seul, le saisit. */
		const verdict = await validerReglagesIa(
			valeur,
			chemin => perimetre.contient(chemin),
			async chemin => (await statEntree(chemin))?.isFile === true,
		);
		if ("refus" in verdict) throw new Error(verdict.refus);
		if ("confirmer" in verdict) {
			/* Une porte NATIVE, comme `choisirDossier` : la question est rédigée
			   et traduite ICI, sur la langue posée par `main.ts` — un rendu
			   compromis ne peut ni la formuler ni y répondre. `cancelId` = refus :
			   fermer la boîte, c'est dire non. */
			const options = {
				type: "question" as const,
				title: t("app.aiHost.title"),
				message: t("app.aiHost.message", { host: verdict.confirmer }),
				detail: t("app.aiHost.detail"),
				buttons: [t("app.aiHost.allow"), t("app.aiHost.deny")],
				defaultId: 1,
				cancelId: 1,
			};
			const parent = deps.fenetreCourante();
			const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
			if (response !== 0) {
				console.warn(LOG_PREFIX, "hôte Ollama refusé par l'utilisateur:", verdict.confirmer);
				throw new Error("hôte refusé par l'utilisateur, réglages IA non écrits : " + verdict.confirmer);
			}
			autoriserHote(verdict.confirmer);
			return;
		}
		if (verdict.admettre) autoriserHote(verdict.admettre);
	}
	/** Same door as `garderReglagesIa`, for the Moodle site. */
	let dialogueMoodle = false;
	let dialogueMoodleFin = 0;
	async function garderReglagesMoodle(valeur: unknown): Promise<void> {
		const actuel = await reglagesOuErreur().lire(CLE_REGLAGES_MOODLE);
		const siteActuel = origineSite(actuel && typeof actuel === "object" ? (actuel as { site?: unknown }).site : undefined);
		const verdict = validerReglagesMoodle(valeur, siteActuel);
		if ("refus" in verdict) throw new Error(verdict.refus);
		if ("confirmer" in verdict) {
			// A site that is neither the school list nor already set must have been verified compatible first.
			const demande = origineSite(valeur && typeof valeur === "object" ? (valeur as { site?: unknown }).site : undefined);
			if (!demande || !siteVerifie(demande)) throw new Error("Moodle site refused: not verified as compatible (moodle.verifierSite)");
			// One native dialog at a time, and a pause after each: the window cannot spam modals.
			if (dialogueMoodle || Date.now() - dialogueMoodleFin < 3000) throw new Error("Moodle host question already open or just closed");
			dialogueMoodle = true;
			const options = {
				type: "question" as const,
				title: t("app.moodleHost.title"),
				message: t("app.moodleHost.message", { host: verdict.confirmer }),
				detail: t("app.moodleHost.detail"),
				buttons: [t("app.moodleHost.allow"), t("app.moodleHost.deny")],
				defaultId: 1,
				cancelId: 1,
			};
			const parent = deps.fenetreCourante();
			let response: number;
			try {
				({ response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options));
			} finally {
				dialogueMoodle = false;
				dialogueMoodleFin = Date.now();
			}
			if (response !== 0) {
				console.warn(LOG_PREFIX, "hôte Moodle refusé par l'utilisateur:", verdict.confirmer);
				throw new Error("hôte refusé par l'utilisateur, réglages Moodle non écrits : " + verdict.confirmer);
			}
			autoriserHote(verdict.confirmer);
			retirerEcole(siteActuel, demande);
			return;
		}
		if (verdict.admettre) autoriserHote(verdict.admettre);
		retirerEcole(siteActuel, origineSite(valeur && typeof valeur === "object" ? (valeur as { site?: unknown }).site : undefined));
	}
	/** Only the ACTIVE site stays allowed: a bundled school left behind loses its entry. */
	function retirerEcole(siteActuel: string | null, nouvelOrigine: string | null): void {
		const h = hoteEcoleARetirer(siteActuel, nouvelOrigine);
		if (h) retirerHote(h);
	}
	ipcMain.handle(CANAUX.reglagesSupprimer, (_e, cle: string) => {
		/* Removing `syncRoot` would let the next start pin the (renderer-changeable)
		   default folder as the shared one: same refusal as the write. */
		if (reglageReserve(String(cle))) throw new Error("réglage refusé : " + String(cle) + " n'est supprimé que par le processus principal");
		return reglagesOuErreur().supprimer(String(cle));
	});

	/* MOODLE: verbs only. The service holds the token; nothing it returns
	   carries it. Arguments from the window are re-validated inside. */
	let derniereVerif = 0;
	ipcMain.handle(CANAUX.moodleVerifierSite, (_e, origine: unknown) => {
		const o = origineSite(origine);
		if (!o) return Promise.resolve({ compatible: false, reason: "unreachable" });
		if (Date.now() - derniereVerif < 1000) throw new Error("ratelimited");
		derniereVerif = Date.now();
		return verifierSite(o);
	});
	ipcMain.handle(CANAUX.moodleEcoles, () => ECOLES);
	ipcMain.handle(CANAUX.moodleEtat, () => deps.moodle.etat());
	ipcMain.handle(CANAUX.moodleConnecter, () => deps.moodle.connecter());
	ipcMain.handle(CANAUX.moodleDeconnecter, () => deps.moodle.deconnecter());
	ipcMain.handle(CANAUX.moodleCours, () => deps.moodle.cours());
	ipcMain.handle(CANAUX.moodleChercher, (_e, texte: unknown) => deps.moodle.chercher(texte));
	ipcMain.handle(CANAUX.moodleAjouterParUrl, (_e, url: unknown) => deps.moodle.ajouterParUrl(url));
	ipcMain.handle(CANAUX.moodleFavori, (_e, id: unknown, on: unknown) => deps.moodle.favori(id, on));
	ipcMain.handle(CANAUX.moodleExclure, (_e, id: unknown, on: unknown) => deps.moodle.exclure(id, on));
	ipcMain.handle(CANAUX.moodleAjouter, (_e, id: unknown) => deps.moodle.ajouter(id));
	ipcMain.handle(CANAUX.moodleRetirer, (_e, id: unknown) => deps.moodle.retirer(id));
	ipcMain.handle(CANAUX.moodleFichiers, (_e, id: unknown) => deps.moodle.fichiers(id));
	ipcMain.handle(CANAUX.moodleModule, (_e, id: unknown) => deps.moodle.module(id));
	ipcMain.handle(CANAUX.moodleTelechargerCours, (_e, id: unknown) => deps.moodle.telechargerCours(id));
	ipcMain.handle(CANAUX.moodleTelechargerFichier, (_e, id: unknown, nom: unknown) => deps.moodle.telechargerFichier(id, nom));
	ipcMain.handle(CANAUX.moodleOuvrirDossier, (_e, id: unknown) => deps.moodle.ouvrirDossier(id));
	ipcMain.handle(CANAUX.moodleOuvrirFichier, (_e, id: unknown, nom: unknown) => deps.moodle.ouvrirFichier(id, nom));
	ipcMain.handle(CANAUX.moodleDeposer, (_e, cmid: unknown) => deps.moodle.deposer(cmid));
	ipcMain.handle(CANAUX.moodleDevoirVu, (_e, cmid: unknown) => deps.moodle.devoirVu(cmid));
	ipcMain.handle(CANAUX.moodleIgnorerDevoir, (_e, cmid: unknown, on: unknown) => deps.moodle.ignorerDevoir(cmid, on));
	ipcMain.handle(CANAUX.moodleSynchroniser, () => deps.moodle.synchroniser());
	ipcMain.handle(CANAUX.moodleDevoirs, () => deps.moodle.devoirs());
	ipcMain.handle(CANAUX.moodleOuvrirDevoir, (_e, cmid: unknown) => deps.moodle.ouvrirDevoir(cmid));

	ipcMain.handle(CANAUX.ouvrir, async (_e, abs: unknown) => {
		/* BORNÉ comme une lecture : `shell.openPath` lance l'application par
		   défaut du système, et hors périmètre ce serait « exécuter n'importe
		   quoi ». Il rend une CHAÎNE : vide en cas de succès, le message du
		   système sinon. `HostShell.openExternal` attend un booléen dont
		   `engine/resources.ts` se sert pour prévenir l'utilisateur. */
		const a = await perimetre.borner(abs);
		/* ET REFUSÉ SUR L'EXTENSION, même dans le périmètre : pour un `.bat`
		   ou un `.exe`, « l'application par défaut » est le fichier lui-même,
		   et `write` puis `ouvrir` — deux appels bornés — composeraient une
		   exécution (revue finale, I1 ; la liste et son POURQUOI sont sur
		   `EXTENSIONS_EXECUTABLES`, `ressources.ts`). Le refus est NOMMÉ dans
		   la console et rendu `false` : l'utilisateur voit la Notice « ouverture
		   impossible » de `engine/resources.ts`, jamais un bouton mort. */
		if (extensionRefusee(a)) {
			console.warn(LOG_PREFIX, "ouverture refusée, extension exécutable:", a);
			return false;
		}
		const erreur = await shell.openPath(path.normalize(a));
		if (erreur) console.warn(LOG_PREFIX, "ouverture impossible:", a, erreur);
		return !erreur;
	});

	/* Sans argument, comme `vaultsObsidian` : le chemin est fixé par le
	   principal (`dossier-defaut.ts`), jamais choisi par le rendu. Déjà créé
	   et autorisé au périmètre avant l'ouverture de la fenêtre — voir `main.ts`. */
	ipcMain.handle(CANAUX.systemeDossierDefaut, async () => dossierDefaut());

	/* CHANGER le dossier par défaut. Tout se passe ICI, et pas dans le rendu :
	   le chemin vient du dialogue natif (jamais d'un argument), il est créé s'il
	   manque, admis au périmètre, puis écrit — dans cet ordre, parce qu'un
	   réglage qui pointerait vers un dossier absent ou hors périmètre ferait
	   démarrer la session suivante sans dossier par défaut du tout.
	   `mkdir` PEUT ÉCHOUER (disque protégé, lecteur en lecture seule) : on
	   rejette alors sans rien écrire, et le dossier précédent reste en place —
	   c'est la même règle qu'au démarrage (`main.ts`), où un défaut
	   incréable n'empêche pas l'application de s'ouvrir. */
	ipcMain.handle(CANAUX.systemeChoisirDossierDefaut, async () => {
		/* `createDirectory` : le dialogue de Windows sait créer le dossier sur
		   place, ce qui évite d'avoir à sortir de l'application pour en
		   préparer un. Rattaché à la fenêtre quand elle existe, comme les
		   autres dialogues de ce fichier. */
		const fenetre = deps.fenetreCourante();
		const proprietes: ("openDirectory" | "createDirectory")[] = ["openDirectory", "createDirectory"];
		const choix = fenetre
			? await dialog.showOpenDialog(fenetre, { properties: proprietes })
			: await dialog.showOpenDialog({ properties: proprietes });
		if (choix.canceled || choix.filePaths.length === 0) return null;
		const abs = normaliser(choix.filePaths[0]);
		await fsp.mkdir(abs, { recursive: true });
		await perimetre.autoriser(abs);
		await reglagesOuErreur().ecrire(CLE_DOSSIER_DEFAUT, abs);
		poserDossierDefaut(abs);
		return abs;
	});

	/* Le dialogue natif de FICHIERS : « Add files » du composer. Les filtres
	   sont composés ICI depuis une union fermée, jamais reçus. Chaque fichier
	   choisi est admis au périmètre en LECTURE et OUVERTURE seulement
	   (`autoriserFichier`) : c'est ce qui donne un bouton « Ouvrir » à
	   l'aperçu d'un PDF joint, sans ouvrir le disque en écriture. */
	const FILTRES: Record<string, { name: string; extensions: string[] }[]> = {
		documents: [{ name: "Documents", extensions: ["pdf", "md", "txt"] }, { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
		images: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
		any: [],
	};
	ipcMain.handle(CANAUX.systemeChoisirFichiers, async (_e, kind: unknown) => {
		const filtres = typeof kind === "string" && kind in FILTRES ? FILTRES[kind] : FILTRES.any;
		const fenetre = deps.fenetreCourante();
		const proprietes: ("openFile" | "multiSelections")[] = ["openFile", "multiSelections"];
		const choix = fenetre
			? await dialog.showOpenDialog(fenetre, { properties: proprietes, filters: filtres })
			: await dialog.showOpenDialog({ properties: proprietes, filters: filtres });
		if (choix.canceled) return [];
		const admis: string[] = [];
		for (const brut of choix.filePaths) {
			const abs = normaliser(brut);
			await perimetre.autoriserFichier(abs);
			admis.push(abs);
		}
		return admis;
	});

	/* RELANCER. `app.relaunch()` réutilise l'exécutable et les arguments du
	   processus courant — le rendu n'en fournit aucun, et n'en fournira jamais
	   (voir `Pont.systeme.relancer`). `quit()` et NON `exit()` : `exit()` tue
	   le processus sans passer par le `close` de la fenêtre, donc sans le
	   délai de garde qui laisse le rendu vider ses écritures en attente — la
	   dernière frappe d'un quiz ouvert serait perdue à chaque changement de
	   langue. */
	/* Le presse-papiers : du TEXTE, et rien d'autre. Une chaîne, et bornée :
	   le principal ne fait pas plus confiance au rendu ici qu'ailleurs. La
	   borne était de 8 Ko (« un chemin de fichier tient largement dedans ») ;
	   elle vaut 512 Ko depuis le canal web (2026-09-18) : quand la question
	   ne tient pas dans une adresse, c'est le prompt entier, notes jointes
	   comprises, qui part par ici. Aucune LECTURE n'est exposée AU RENDU :
	   `clipboard.readText` n'a pas de canal ; la veille du canal web lit
	   côté principal, sous jeton (voir `attente-collage.ts`). */
	/* Le dernier texte que l'APPLICATION a écrit dans le presse-papier : la
	   veille du canal web ne doit jamais le prendre pour la réponse (il porte
	   le jeton quand c'est le prompt). Retenu ici, côté principal, où la copie
	   et la lecture se font toutes deux. */
	let dernierTexteEcritParLapp = "";
	/* LE PARTAGE (voir `./partage.ts`). Le rendu fournit un nom et des
	   octets, tous deux vérifiés ici ; jamais un chemin. */
	ipcMain.handle(CANAUX.partageEnregistrer, async (_e, nom: unknown, octets: unknown) => {
		const propre = nomPartage(nom);
		const contenu = octetsPartage(octets);
		if (!propre || !contenu) throw new Error("partage refusé : nom ou contenu invalide");
		const ext = path.extname(propre).slice(1).toLowerCase();
		const options = {
			defaultPath: path.join(app.getPath("downloads"), propre),
			filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
		};
		// Un dialogue à la fois : pas de pile de dialogues (voir `verrouEnregistrer`).
		const jeton = verrouEnregistrer.prendre();
		if (jeton === null) throw new Error(PARTAGE_OCCUPE);
		try {
			const fenetre = deps.fenetreCourante();
			const choix = fenetre ? await dialog.showSaveDialog(fenetre, options) : await dialog.showSaveDialog(options);
			if (choix.canceled || !choix.filePath) return null;
			/* L'extension est IMPOSÉE : l'emplacement est à l'utilisateur, la
			   nature du fichier non. Sans ça, des octets venus de la fenêtre
			   pouvaient finir en `.bat` d'une simple frappe dans le dialogue. */
			const dest = path.extname(choix.filePath).toLowerCase() === "." + ext ? choix.filePath : `${choix.filePath}.${ext}`;
			await fsp.writeFile(dest, contenu);
			shell.showItemInFolder(dest);
			return dest;
		} finally {
			verrouEnregistrer.rendre(jeton);
		}
	});

	/* THE NATIVE SHARE PANEL: the file is written by THIS process to a fresh
	   temporary folder, its path never leaves the main process, and the
	   PowerShell that opens the panel is constant (`scriptPartageNatif`). */
	ipcMain.handle(CANAUX.partageNatif, async (_e, nom: unknown, octets: unknown) => {
		const propre = nomPartage(nom);
		const contenu = octetsPartage(octets);
		if (!propre || !contenu) throw new Error("partage refusé : nom ou contenu invalide");
		if (process.platform !== "win32") return false;
		return partageFichier.demander(propre, contenu);
	});
	/* AN INTERACTIVE PAGE, EXPORTED (`./frame-export.ts`). The image: a
	   rectangle only, validated against THIS process's zoom and window size,
	   captured from the sender's own page, at most once per second. */
	const captureGate = createRateGate(CAPTURE_MIN_INTERVAL_MS);
	ipcMain.handle(CANAUX.frameImageCopy, async (e, raw: unknown) => {
		const fenetre = BrowserWindow.fromWebContents(e.sender);
		if (!fenetre || fenetre.isDestroyed()) return false;
		const b = fenetre.getContentBounds();
		const rect = captureRect(raw, e.sender.getZoomFactor(), { width: b.width, height: b.height });
		if (!rect || !captureGate()) return false;
		const image = await e.sender.capturePage(rect);
		if (image.isEmpty()) return false;
		// Electron 44: the clipboard API is the async ClipboardItem one (no more `writeImage`).
		await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]);
		return true;
	});
	/* The page source: a name (`.html` forced) and bounded bytes; the place is
	   the user's choice in the NATIVE dialog, which is what grants the write.
	   One dialog at a time, shared with the share "Save as". */
	ipcMain.handle(CANAUX.frameHtmlSave, async (e, name: unknown, bytes: unknown) => {
		const fileName = htmlFileName(name);
		const content = htmlBytes(bytes);
		if (!fileName || !content) throw new Error("save refused: invalid name or content");
		const jeton = verrouEnregistrer.prendre();
		if (jeton === null) throw new Error(PARTAGE_OCCUPE);
		try {
			const options = { defaultPath: path.join(app.getPath("downloads"), fileName), filters: [{ name: "HTML", extensions: ["html"] }] };
			const fenetre = BrowserWindow.fromWebContents(e.sender);
			const choice = fenetre ? await dialog.showSaveDialog(fenetre, options) : await dialog.showSaveDialog(options);
			if (choice.canceled || !choice.filePath) return null;
			// The extension is FORCED: the place is the user's, the file's nature is not.
			const dest = path.extname(choice.filePath).toLowerCase() === ".html" ? choice.filePath : `${choice.filePath}.html`;
			await fsp.writeFile(dest, content);
			return dest;
		} finally {
			verrouEnregistrer.rendre(jeton);
		}
	});
	const partageFichier = creerPartageFichier({ verrou: verrouNatif, ecrire: ecrireTemporaire, centre: () => centreFenetre() });
	/** The middle of the app window, where the native panel is centred. */
	const centreFenetre = (): { x: number; y: number } | undefined => {
		const f = deps.fenetreCourante();
		if (!f || f.isDestroyed()) return undefined;
		const b = f.getBounds();
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};

	ipcMain.handle(CANAUX.systemeCopierTexte, (_e, texte: unknown) => {
		if (typeof texte !== "string" || texte.length > 524288) throw new Error("copie refusée : le presse-papiers ne prend qu'un texte borné");
		dernierTexteEcritParLapp = texte;
		clipboard.writeText(texte);
	});

	/* Only two strings cross: no icon, URL, action or click handler comes from the page. */
	const porteNotification = createNotificationGate();
	ipcMain.handle(CANAUX.notificationAfficher, (_e, titre: unknown, corps: unknown) => {
		if (!Notification.isSupported()) return false;
		const propre = prepareNotification(porteNotification, titre, corps);
		if (!propre) return false;
		new Notification({ title: propre.title, body: propre.body, silent: false }).show();
		return true;
	});

	// No argument crosses: the answer is the cached name and kind of this computer.
	ipcMain.handle(CANAUX.appareilInfos, () => infosAppareil());

	ipcMain.handle(CANAUX.systemeRelancer, async () => {
		app.relaunch();
		app.quit();
	});

	/* L'attente d'une réponse copiée (canal web). UNE attente pour l'unique
	   fenêtre de l'application ; le noyau (`attente-collage.ts`) tient les
	   règles, ici seulement les branchements : le vrai presse-papier, les
	   vrais timers, la livraison par `deps.envoyer` (donc `webContents.send`),
	   et le clignotement dans la barre des tâches (`flashFrame(true)`, éteint
	   au prochain focus dans `main.ts`) plutôt qu'un vol de focus, que Windows
	   refuse et que l'utilisateur qui lit encore la réponse ne voudrait pas.

	   `clipboard.readText()` est ASYNCHRONE depuis Electron 44 (l'ancienne API
	   synchrone a disparu du typage) alors que le noyau lit `lire()` de façon
	   SYNCHRONE, à chaque tour : `planifier` rafraîchit le cache AVANT d'appeler
	   le tour suivant, `lire` ne fait que le CONSOMMER (le relire, puis le
	   remettre à `""`) — aucune modification du noyau pur pour un détail de
	   plateforme. La consommation est nécessaire, pas seulement suffisante : le
	   noyau ne lit qu'UNE FOIS par tour, juste après le rafraîchissement, sur
	   tous les chemins (comparé puis oublié, arrêté, livré, ou échu) — un cache
	   qui survivrait à son tour garderait en mémoire ce que l'utilisateur a
	   copié ENSUITE, pour tout autre usage, jusqu'à la prochaine sonde. */
	let dernierTexteCopie = "";
	/* `clipboard.readText()` est ASYNCHRONE (voir le commentaire plus haut) :
	   un `clearTimeout` n'a PLUS AUCUN EFFET une fois le minuteur écoulé et la
	   lecture en vol — `annuler` arrivant alors (l'utilisateur clique
	   « Rouvrir ») laisse la lecture en cours se terminer et rappeler `fn`,
	   qui replanifie un tour : DEUX boucles tournent ensuite côte à côte sur
	   la même attente, chacune consommant le presse-papier de l'autre. La
	   table retient donc, par id de sonde, le minuteur ET si elle est encore
	   vivante — `annuler` la retire tout de suite (avant même la fin de la
	   lecture), et la résolution ne rappelle `fn` que si elle trouve encore son id
	   dedans. */
	let prochaineSondeId = 1;
	const sondesVivantes = new Map<number, ReturnType<typeof setTimeout>>();
	const attente = creerAttente({
		lire: () => {
			const t = dernierTexteCopie;
			dernierTexteCopie = "";
			return t;
		},
		horloge: {
			planifier: (fn, ms) => {
				const id = prochaineSondeId++;
				const minuteur = setTimeout(() => {
					clipboard.readText().catch(() => "").then(t => {
						if (!sondesVivantes.delete(id)) return;
						// Affecter et consommer dans la MÊME microtâche : une
						// annulation ne peut plus laisser le cache orphelin.
						dernierTexteCopie = t;
						try { fn(); } finally { dernierTexteCopie = ""; }
					});
				}, ms);
				sondesVivantes.set(id, minuteur);
				return id;
			},
			annuler: id => {
				const minuteur = sondesVivantes.get(id);
				if (minuteur === undefined) return;
				clearTimeout(minuteur);
				sondesVivantes.delete(id);
			},
			maintenant: () => Date.now(),
		},
		livrer: texte => {
			deps.envoyer(CANAUX.collageTexte, texte);
			deps.fenetreCourante()?.flashFrame(true);
		},
	});
	ipcMain.handle(CANAUX.collageAttendre, (_e, jeton: unknown) => jetonValide(jeton) && attente.demarrer(jeton, dernierTexteEcritParLapp));
	/* Arrêter l'attente d'une réponse copiée arrête aussi, best effort, un
	   script de collage encore en guet (`disposerPourSite`, process.ts) — sans
	   ça il continue de guetter la fenêtre du site et peut coller jusqu'à une
	   quarantaine de secondes après l'annulation. */
	ipcMain.handle(CANAUX.collageArreter, () => { attente.arreter(); void arreterDisposerPourSite(); });

	/* ─── DISPOSER LES FENÊTRES POUR UN SITE ───
	   Neo Quiz passe à droite (posé ici, par `setBounds`, sur l'écran où il
	   est) ; le navigateur à gauche est posé par `disposerPourSite`
	   (process.ts), qui ne rend la main qu'une fois prêt à le guetter. */
	let dispositionAvant: { agrandie: boolean; bounds: Electron.Rectangle } | null = null;
	ipcMain.handle(CANAUX.depotDisposer, async (_e, options: unknown): Promise<void> => {
		/* Un seul drapeau traverse, lu comme un booléen strict. */
		const coller = !!options && typeof options === "object" && (options as { coller?: unknown }).coller === true;
		const fenetre = deps.fenetreCourante();
		let hwnd = 0;
		if (fenetre && !fenetre.isDestroyed()) {
			/* L'état d'AVANT, pour le rendre à la fin (`terminer`) : agrandie
			   ou non, et sa taille. Une disposition qui suit une autre garde
			   l'état d'origine, pas la moitié d'écran. */
			if (!dispositionAvant) dispositionAvant = { agrandie: fenetre.isMaximized(), bounds: fenetre.getNormalBounds() };
			const aire = screen.getDisplayMatching(fenetre.getBounds()).workArea;
			const moitie = Math.floor(aire.width / 2);
			if (fenetre.isMaximized()) fenetre.unmaximize();
			fenetre.setBounds({ x: aire.x + moitie, y: aire.y, width: aire.width - moitie, height: aire.height });
			const h = fenetre.getNativeWindowHandle();
			hwnd = h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0);
		}
		await disposerPourSite(hwnd, coller);
	});

	/* ─── GLISSER UN FICHIER DEPUIS L'APPLICATION ───
	   `startDrag` fait partir le VRAI fichier du disque vers la fenêtre où
	   l'utilisateur lâche (le navigateur, claude.ai) : c'est un accès au
	   fichier, BORNÉ comme une lecture. L'icône est celle que Windows donne au
	   fichier. Appelé pendant le `dragstart` du rendu — c'est le seul moment
	   où Chromium accepte de démarrer un glisser natif. */
	/* Les icônes de type, extraites d'avance (voir `iconeDeType`) : bornées
	   comme une lecture, elles aussi — l'icône d'un fichier hors périmètre
	   ne regarde pas l'application. */
	/* LES FICHIERS QUE LE PRINCIPAL A ÉCRITS LUI-MÊME pour le glisser : une
	   image collée, un fichier déposé depuis l'Explorateur (le rendu n'en a
	   que les octets, pas le chemin). Sans eux, UNE seule pièce sans chemin
	   retirait TOUTES les tuiles de la modale d'attente (vu le 2026-09-19).
	   Ils vivent hors du périmètre, dans le dossier temporaire de
	   l'application ; seuls les chemins de CET ensemble sont admis au glisser
	   en plus des chemins bornés — jamais une lecture, jamais `ouvrir`. */
	const temporaires = new Set<string>();
	const dossierDepot = path.join(app.getPath("temp"), "neo-quiz-depot");
	const resoudreDepot = async (abs: unknown): Promise<string> => {
		if (typeof abs === "string" && temporaires.has(path.normalize(abs))) return path.normalize(abs);
		return path.normalize(await perimetre.borner(abs));
	};
	ipcMain.handle(CANAUX.depotEcrire, async (_e, nom: unknown, octets: unknown): Promise<string | null> => {
		if (typeof nom !== "string" || !(octets instanceof Uint8Array) || octets.byteLength > 64 * 1024 * 1024) return null;
		/* Le NOM seul, nettoyé : ni dossier, ni caractère interdit par Windows,
		   ni extension exécutable (`extensionRefusee`). */
		const propre = path.basename(nom).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(-120) || "fichier";
		if (extensionRefusee(propre)) return null;
		/* Un sous-dossier par fichier : deux images collées s'appellent toutes
		   deux « image.png », et le site doit recevoir ce nom-là. */
		await fsp.mkdir(dossierDepot, { recursive: true });
		const dossier = await fsp.mkdtemp(path.join(dossierDepot, "d-"));
		const a = path.normalize(path.join(dossier, propre));
		await fsp.writeFile(a, octets);
		temporaires.add(a);
		return a;
	});
	ipcMain.handle(CANAUX.depotPreparer, async (_e, absolus: unknown): Promise<void> => {
		if (!Array.isArray(absolus)) return;
		for (const abs of absolus.slice(0, 25)) {
			let a: string;
			try { a = await resoudreDepot(abs); } catch { continue; }
			await iconeDeType(a, app.getPath("temp"));
		}
	});
	/* L'image composée par le rendu (`composerImageDeGlisser`) : un PNG en
	   `data:` URL, borné, à une échelle d'écran plausible. Tout le reste
	   retombe sur l'icône de type — jamais un glisser refusé pour son image. */
	const imageDuRendu = (image: unknown): Electron.NativeImage | null => {
		if (!image || typeof image !== "object") return null;
		const { png, echelle } = image as { png?: unknown; echelle?: unknown };
		const PREFIXE = "data:image/png;base64,";
		if (typeof png !== "string" || !png.startsWith(PREFIXE) || png.length > 4 * 1024 * 1024) return null;
		if (typeof echelle !== "number" || !(echelle >= 0.5 && echelle <= 4)) return null;
		const img = nativeImage.createFromBuffer(Buffer.from(png.slice(PREFIXE.length), "base64"), { scaleFactor: echelle });
		return img.isEmpty() ? null : img;
	};
	ipcMain.handle(CANAUX.depotGlisser, async (e, absolus: unknown, saisi: unknown, image: unknown): Promise<"depose" | "revenu" | "impossible"> => {
		if (!Array.isArray(absolus)) return "impossible";
		const fichiers: string[] = [];
		const indexSaisi = typeof saisi === "number" && Number.isInteger(saisi) ? saisi : 0;
		let saisiAbs: string | null = null;
		for (const [i, abs] of absolus.slice(0, 25).entries()) {
			let a: string;
			try { a = await resoudreDepot(abs); } catch { continue; }
			try { await fsp.access(a); } catch { continue; }
			fichiers.push(a);
			if (i === indexSaisi) saisiAbs = a;
		}
		if (fichiers.length === 0) return "impossible";
		try {
			/* L'icône du fichier SAISI (celui sous le curseur), comme dans
			   l'Explorateur : Windows n'en montre qu'une. Celle du shell en 256 px
			   si elle est déjà extraite (`preparer`) ; sinon celle d'Electron,
			   48 px, pour ne pas rater le geste. */
			const porteur = saisiAbs ?? fichiers[0];
			const composee = imageDuRendu(image);
			const png = composee ? null : await iconeDeType(porteur, app.getPath("temp"));
			/* 64 pt (96 px à 150 %) : la taille de l'image que l'Explorateur
			   glisse. Le PNG de 256 px, posé tel quel, débordait de la couche
			   de glisser de Chromium et arrivait tronqué (vu le 2026-09-19). */
			const icon = composee ?? (png
				? nativeImage.createFromPath(png).resize({ width: 64, height: 64, quality: "best" })
				: await app.getFileIcon(porteur, { size: "large" }));
			/* `files` l'emporte sur `file` quand il est donné ; `file` reste requis par le type. */
			e.sender.startDrag(fichiers.length === 1 ? { file: fichiers[0], icon } : { file: fichiers[0], files: fichiers, icon });
			/* `startDrag` ne rend la main qu'après le dépôt (boucle OLE de
			   Windows). Pendant cette boucle Chromium ne voit plus la souris :
			   la pile saisie gardait son `:hover` — éventail ouvert, « Glisser
			   tout » affiché — alors que les fichiers étaient déjà sur le site
			   (vu par Ahmed le 2026-09-19). On lui dit donc où est VRAIMENT la
			   souris : sortie de la fenêtre, ou à sa position dedans. */
			const fenetre = BrowserWindow.fromWebContents(e.sender);
			let dedans = true;
			if (fenetre && !fenetre.isDestroyed()) {
				const curseur = screen.getCursorScreenPoint();
				const zone = fenetre.getContentBounds();
				const x = curseur.x - zone.x;
				const y = curseur.y - zone.y;
				dedans = x >= 0 && y >= 0 && x < zone.width && y < zone.height;
				e.sender.sendInputEvent({ type: dedans ? "mouseMove" : "mouseLeave", x, y });
			}
			/* OÙ LE BOUTON A ÉTÉ RELÂCHÉ est tout ce qu'on sait du dépôt : la cible
			   ne dit jamais si elle a accepté. Hors de la fenêtre, dans la
			   disposition d'un site, c'est le navigateur — la carte d'attente
			   passe alors l'étape en « fait » (2026-09-20). */
			return dedans ? "revenu" : "depose";
		} catch (err) {
			console.warn(LOG_PREFIX, "glisser impossible:", fichiers, err);
			return "impossible";
		}
	});

	/* ─── LA FIN : Neo Quiz revient, centré, devant ───
	   (Ahmed, 2026-09-19 : « dès que l'on copie, les fenêtres ouvertes avant
	   se mettent en arrière-plan et Neo Quiz se met au centre »). La taille
	   d'avant est rendue, centrée sur l'écran courant ; agrandie avant,
	   agrandie après. Le navigateur retrouve lui aussi sa place d'avant
	   (`restaurerNavigateur`, process.ts ; Ahmed, 2026-09-19) et passe
	   derrière du seul fait que Neo Quiz revient devant. */
	ipcMain.handle(CANAUX.depotTerminer, async () => {
		/* Le navigateur d'abord, à sa place d'avant — ATTENDU : rendu agrandi,
		   il prend le premier plan, et Neo Quiz doit le reprendre après. */
		console.log(LOG_PREFIX, "[terminer] début");
		/* Le script de collage encore en guet est tué EN PREMIER (best effort) :
		   sans ça il peut reprendre le premier plan et coller bien après que
		   l'utilisateur a fini — voir le commentaire de `enfantDisposerPourSite`
		   (process.ts). */
		await arreterDisposerPourSite();
		const pNav = await restaurerNavigateur();
		console.log(LOG_PREFIX, "[terminer] restaurerNavigateur terminé, pNav:", pNav ? `hwnd=${pNav.hwnd}` : "null");
		const fenetre = deps.fenetreCourante();
		if (fenetre && !fenetre.isDestroyed() && dispositionAvant) {
			const avant = dispositionAvant;
			dispositionAvant = null;
			if (avant.agrandie) {
				fenetre.maximize();
			} else {
				const aire = screen.getDisplayMatching(fenetre.getBounds()).workArea;
				const width = Math.min(avant.bounds.width, aire.width);
				const height = Math.min(avant.bounds.height, aire.height);
				fenetre.setBounds({ x: aire.x + Math.floor((aire.width - width) / 2), y: aire.y + Math.floor((aire.height - height) / 2), width, height });
			}
		}
		deps.fenetre.premierPlan();
		console.log(LOG_PREFIX, "[terminer] fin — premierPlan appelé");
		if (pNav) {
			setTimeout(() => {
				void verifierNavigateurVisible(pNav);
			}, 150);
		}
	});

	ipcMain.handle(CANAUX.vaultsObsidian, async () => {
		/* Les vaults qu'Obsidian déclare LUI-MÊME entrent au périmètre : l'écran
		   d'accueil les propose d'un clic, sans passer par le sélecteur natif,
		   et `addFolder` les écrit ensuite sous `folders` — ce que la garde
		   ci-dessus refuserait sinon. */
		const vaults = await vaultsObsidian();
		for (const v of vaults) await perimetre.autoriser(v.chemin);
		return vaults;
	});

	/* ─── le réseau ───

	   Un `AbortController` par requête EN VOL, sous l'identifiant que le rendu a
	   choisi : le `signal` ne traverse pas l'IPC (voir `Pont.reseau`). L'entrée
	   est retirée dans un `finally`, quelle que soit l'issue — sans quoi la
	   table grandirait d'une entrée par requête pour la vie du processus.
	   Et retirée SEULEMENT si c'est encore la sienne : le compteur du rendu
	   repart à 1 après un `location.reload()` (`choisirDossier`) alors qu'une
	   requête de l'ancienne page peut être encore en vol. Le `set` de la
	   nouvelle requête ÉCRASE alors l'entrée de l'ancienne — c'est admis, on ne
	   peut plus annuler une requête dont la page est morte — mais le `finally`
	   de l'ancienne ne doit pas emporter l'entrée de la NOUVELLE, qui
	   deviendrait inannulable. Annuler un identifiant inconnu ne fait rien :
	   la requête est déjà finie, c'est la réponse « trop tard », pas une
	   erreur. (Revue de la tâche 2, correction 1.) */
	const enVol = new Map<number, AbortController>();

	ipcMain.handle(CANAUX.reseauFetch, async (_e, req: unknown, requeteId: unknown) => {
		/* La requête vient du RENDU : elle est RECOMPOSÉE champ par champ, jamais
		   passée telle quelle au transport. Une propriété inattendue (`mode`,
		   `credentials`, `redirect`…) glissée dans l'objet reçu n'atteint donc
		   pas `net.fetch` ; et l'hôte est jugé par `fetchBorne`, pas ici. */
		const r = (req && typeof req === "object" ? req : {}) as Partial<RequeteReseau>;
		const url = typeof r.url === "string" ? r.url : "";
		const method = r.method === "POST" ? "POST" : "GET";
		const headers: Record<string, string> = {};
		/* `!Array.isArray` : `typeof [] === "object"`, et `Object.entries` d'un
		   tableau donnerait des en-têtes nommés « 0 », « 1 ». */
		if (r.headers && typeof r.headers === "object" && !Array.isArray(r.headers)) {
			for (const [k, v] of Object.entries(r.headers)) if (typeof v === "string") headers[k] = v;
		}
		const body = typeof r.body === "string" ? r.body : undefined;
		const id = typeof requeteId === "number" ? requeteId : NaN;
		const controleur = new AbortController();
		if (!Number.isNaN(id)) enVol.set(id, controleur);
		try {
			/* `net.fetch` d'Electron, jamais le `fetch` de Node : c'est la pile
			   réseau de Chromium — proxy du système, magasin de certificats —
			   celle que l'utilisateur a déjà configurée pour tout le reste. */
			return await fetchBorne(
				{ url, method, headers, body, signal: controleur.signal },
				(u, init) => net.fetch(u, init),
			);
		} finally {
			if (enVol.get(id) === controleur) enVol.delete(id);
		}
	});
	ipcMain.handle(CANAUX.reseauAnnuler, (_e, requeteId: unknown) => {
		if (typeof requeteId === "number") enVol.get(requeteId)?.abort();
	});

	/* ─── les CLI et leurs fichiers ───

	   MÊME RÈGLE QUE LES CHEMINS ET LES URL, appliquée aux NOMS D'OUTILS : le
	   rendu n'envoie qu'un nom, et ce nom est jugé ici. Les chemins, eux, sont
	   FIXES et connus du seul principal (`./process.ts`) — c'est ce qui fait
	   que ce canal n'a pas besoin de `perimetre.borner` : il n'y a aucun
	   chemin venu du rendu à borner. Un `tool` hors liste serait précisément
	   la faille inverse : « lis-moi ce fichier-là » déguisé en nom d'outil.
	   Le refus est NOMMÉ dans la console ET rejeté (`name === "refuse"`) : un
	   `null` muet passerait pour « pas de cache », et on chercherait le défaut
	   du côté du CLI. */
	ipcMain.handle(CANAUX.processusLireCache, async (_e, tool: unknown) => {
		if (tool !== "claude" && tool !== "codex") {
			console.warn(LOG_PREFIX, "cache refusé, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		return lireCache(tool);
	});
	ipcMain.handle(CANAUX.processusOllamaInstalle, () => ollamaInstalle());
	ipcMain.handle(CANAUX.processusDemarrerOllama, () => demarrerOllama());

	const NOMS_OUTILS: Record<Outil, string> = { claude: "Claude Code", codex: "Codex CLI", ollama: "Ollama", agy: "Antigravity CLI" };
	/* ─── LE TERMINAL JUSTE SOUS LA MODALE, DANS NEO QUIZ ───
	   Neo Quiz ne bouge plus (la disposition gauche/droite du matin a été
	   écartée : Ahmed, 2026-09-20, « on ne fait aucune des deux options »).
	   La modale qui attend (installation ou connexion) est remontée par le
	   CSS, et le rendu envoie SON rectangle (`ancre`, en pixels CSS de la
	   fenêtre) : le terminal — trouvé par son titre, `disposerPourTerminal` —
	   est posé juste en dessous, même largeur, jusqu'au bas de la fenêtre
	   (plafonné). Sans ancre : la moitié basse de la fenêtre. Les pixels CSS
	   deviennent des DIP par le facteur de zoom, puis des pixels ÉCRAN par
	   `screen.dipToScreenPoint` — c'est ce que `SetWindowPos` attend. Best
	   effort : si le terminal n'est jamais trouvé, rien à défaire. */
	/* LA FIN DU TERMINAL, comme promesse : `disposerPourTerminal` est le seul à
	   savoir quand sa fenêtre disparaît, et le modal d'installation attend ce
	   moment pour se fermer (`processusAttendreFinTerminal`). Une promesse par
	   terminal lancé ; résolue aussi quand la fenêtre n'a jamais été trouvée,
	   sinon le modal attendrait pour rien. */
	let finTerminal: Promise<void> = Promise.resolve();
	/* Le titre du terminal en cours et la place de Neo Quiz avant le passage
	   en DEUX COLONNES : quand le navigateur de la connexion s'ouvre, il prend
	   la moitié gauche, Neo Quiz la moitié droite, et le terminal suit sa
	   modale (Ahmed, 2026-09-20). Tout est rendu à la fin. */
	let titreTerminal = "";
	let neoAvantColonnes: { agrandie: boolean; bounds: Electron.Rectangle } | null = null;
	/* UN SEUL TERMINAL COMPTE : celui du dernier lancement. Relancer une
	   installation pendant qu'une autre tourne laissait l'ancien guetteur
	   rendre sa place à Neo Quiz au milieu de la nouvelle (et restaurer le
	   navigateur). Chaque lancement prend un numéro ; les rappels d'un numéro
	   périmé ne font plus rien. */
	let sessionTerminal = 0;
	/* L'attente d'une ancre remesurée : posée par `preparerColonnes`, levée
	   par le canal `processusReplacerTerminal` (ou par son délai). */
	let attenteAncre: ((a: AncreTerminal | null) => void) | null = null;

	/* ─── LES DEUX COLONNES, DÈS LE DÉPART ───
	   Le navigateur FINIRA par s'ouvrir, quoi qu'il arrive : une connexion
	   passe toujours par lui (Ahmed, 2026-09-20). Autant tout disposer tout de
	   suite — Neo Quiz à droite, sa moitié gauche laissée libre — plutôt que
	   de voir les fenêtres sauter en cours de route quand il arrive. La
	   modale ayant rétréci avec la fenêtre, le rendu la remesure et rend son
	   nouveau rectangle ; le terminal sera posé dessous. Un demi-seconde au
	   plus : passé ce délai on garde l'ancre d'avant, qui vaut mieux que
	   rien. */
	const preparerColonnes = (ancreInitiale: AncreTerminal | null): Promise<AncreTerminal | null> => {
		const f = deps.fenetreCourante();
		if (!f || f.isDestroyed()) return Promise.resolve(ancreInitiale);
		if (f.isMinimized()) f.restore();
		if (!neoAvantColonnes) neoAvantColonnes = { agrandie: f.isMaximized(), bounds: f.getNormalBounds() };
		const a = screen.getDisplayMatching(f.getBounds()).workArea;
		const demi = Math.floor(a.width / 2);
		if (f.isMaximized()) f.unmaximize();
		f.setBounds({ x: a.x + demi, y: a.y, width: a.width - demi, height: a.height });
		f.webContents.send(CANAUX.processusNavigateurOuvert);
		return new Promise(resolve => {
			const minuteur = setTimeout(() => { attenteAncre = null; resolve(ancreInitiale); }, 500);
			attenteAncre = (nouvelle) => {
				clearTimeout(minuteur);
				attenteAncre = null;
				resolve(nouvelle ?? ancreInitiale);
			};
		});
	};
	const disposerAvecTerminal = (titre: string, ancre: AncreTerminal | null): void => {
		const fenetre = deps.fenetreCourante();
		if (!fenetre || fenetre.isDestroyed()) return;
		let resoudreFin: () => void = () => {};
		finTerminal = new Promise<void>(resolve => { resoudreFin = resolve; });
		titreTerminal = titre;
		const session = ++sessionTerminal;
		/* Une fenêtre RÉDUITE n'a pas de modale à l'écran : la poser dessous
		   n'aurait aucun sens, et l'utilisateur vient de cliquer dans l'app. */
		if (fenetre.isMinimized()) fenetre.restore();
		const rect = rectangleTerminal(fenetre.getContentBounds(), fenetre.webContents.getZoomFactor(), ancre);
		const hautGauche = screen.dipToScreenPoint({ x: rect.x, y: rect.y });
		const basDroite = screen.dipToScreenPoint({ x: rect.x + rect.width, y: rect.y + rect.height });
		const h = fenetre.getNativeWindowHandle();
		const hwnd = h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0);
		disposerPourTerminal(hwnd, titre, { x: hautGauche.x, y: hautGauche.y, largeur: basDroite.x - hautGauche.x, hauteur: basDroite.y - hautGauche.y }, () => {
			if (session !== sessionTerminal) return;
			const f = deps.fenetreCourante();
			if (f && !f.isDestroyed()) f.webContents.send(CANAUX.processusTerminalPose);
		}, () => {
			/* LE NAVIGATEUR EST POSÉ À GAUCHE, dans la moitié que Neo Quiz a
			   libérée avant même que le terminal ne s'ouvre : il n'y a plus
			   rien à déplacer ici, et c'est tout l'intérêt de disposer dès le
			   départ. Le rappel reste, pour le placement du navigateur qui se
			   fait côté script. */
		}, () => {
			resoudreFin();
			if (session !== sessionTerminal) return;
			titreTerminal = "";
			const f = deps.fenetreCourante();
			const avant = neoAvantColonnes;
			neoAvantColonnes = null;
			void restaurerNavigateur();
			if (!f || f.isDestroyed()) return;
			/* Sa place d'avant les deux colonnes, s'il y en a eu une. */
			if (avant) {
				if (avant.agrandie) {
					f.maximize();
				} else {
					const a = screen.getDisplayMatching(f.getBounds()).workArea;
					const width = Math.min(avant.bounds.width, a.width);
					const height = Math.min(avant.bounds.height, a.height);
					f.setBounds({ x: a.x + Math.floor((a.width - width) / 2), y: a.y + Math.floor((a.height - height) / 2), width, height });
				}
			}
			deps.fenetre.premierPlan();
		});
	};

	/* LA MODALE A BOUGÉ (Neo Quiz vient de passer à droite) : le rendu renvoie
	   son nouveau rectangle, et le terminal est reposé dessous. Même lecture
	   champ par champ que l'ancre de `connecter`. */
	ipcMain.handle(CANAUX.processusReplacerTerminal, (_e, ancre: unknown) => {
		/* Une préparation attend cette mesure pour LANCER le terminal : elle
		   la prend, et rien n'est encore à replacer. */
		if (attenteAncre) { attenteAncre(lireAncre(ancre)); return; }
		const fenetre = deps.fenetreCourante();
		if (!fenetre || fenetre.isDestroyed() || !titreTerminal) return;
		const rect = rectangleTerminal(fenetre.getContentBounds(), fenetre.webContents.getZoomFactor(), lireAncre(ancre));
		const hautGauche = screen.dipToScreenPoint({ x: rect.x, y: rect.y });
		const basDroite = screen.dipToScreenPoint({ x: rect.x + rect.width, y: rect.y + rect.height });
		poserFenetre(titreTerminal, { x: hautGauche.x, y: hautGauche.y, largeur: basDroite.x - hautGauche.x, hauteur: basDroite.y - hautGauche.y });
	});

	ipcMain.handle(CANAUX.processusAttendreFinTerminal, () => finTerminal);

	// `outils` vient du rendu : filtré contre la liste des quatre noms valides
	// avant transmission, une valeur hors liste étant simplement ignorée
	// (comme un canal qui reçoit un `tool` hors liste ailleurs dans ce fichier).
	const OUTILS_COMPTE: ReadonlyArray<EtatCompte["outil"]> = ["claude", "codex", "agy", "ollama"];
	ipcMain.handle(CANAUX.comptesEtat, (_e, outils: unknown): Promise<EtatCompte[]> => {
		const filtre = Array.isArray(outils)
			? outils.filter((o): o is EtatCompte["outil"] => OUTILS_COMPTE.includes(o as EtatCompte["outil"]))
			: undefined;
		return etatComptes(undefined, filtre);
	});

	ipcMain.handle(CANAUX.comptesUsage, (_e, tool: unknown): Promise<UsageRead> => {
		if (tool !== "claude" && tool !== "codex") {
			console.warn(LOG_PREFIX, "lecture de quota refusée, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		return usageCompte(tool);
	});

	/* Banked resets: the request is judged in `codexResets` (action, credit id
	   seen in the last read, cadence); a refusal is a result, not a thrown
	   error. A consume is confirmed HERE, in a native modal box written and
	   translated by the main process (same door as `garderReglagesIa`): a
	   compromised window can neither word it nor answer it. The credit's
	   title and description are the server's, as the last read gave them,
	   shown as plain text. `cancelId` = no: closing the box is a refusal. */
	const texteDialogue = (v: string | null): string => (v ?? "").replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
	const confirmerReset = async (credit: ResetCredit): Promise<boolean> => {
		const options = {
			type: "question" as const,
			title: t("app.codexReset.title"),
			message: t("app.codexReset.message"),
			detail: [texteDialogue(credit.title) || t("app.codexReset.fallbackTitle"), texteDialogue(credit.description)].filter(Boolean).join("\n"),
			buttons: [t("app.codexReset.spend"), t("app.codexReset.cancel")],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
		};
		const parent = deps.fenetreCourante();
		const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
		return response === 0;
	};
	ipcMain.handle(CANAUX.comptesResets, (_e, requete: unknown) => codexResets(requete, { confirmer: confirmerReset }));

	ipcMain.handle(CANAUX.comptesDeconnecter, (_e, tool: unknown): Promise<"ok" | "echec" | "indisponible"> => {
		if (!estOutilAutorise(tool)) {
			console.warn(LOG_PREFIX, "déconnexion refusée, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		return deconnecterCompte(tool);
	});

	/* ─── LE TERMINAL D'USAGE D'ANTIGRAVITY ───
	   Son quota ne se lit nulle part hors de son REPL (`/usage`) : le canal
	   ouvre un terminal interactif, même mécanique que `connecter` — mais sa
	   liste blanche est PLUS ÉTROITE que `estOutilAutorise` : seul `agy` a
	   besoin d'un REPL, les trois autres ont une lecture directe ou une page
	   web, et un terminal sur rien vaudrait `indisponible`, pas une fenêtre.
	   L'invite est traduite ICI, sur la langue posée par `main.ts` — le rendu
	   ne passe que le nom d'outil, jamais un texte. */
	ipcMain.handle(CANAUX.comptesUsageTerminal, (_e, tool: unknown): "lance" | "indisponible" => {
		if (tool !== "agy") {
			console.warn(LOG_PREFIX, "terminal d'usage refusé, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		if (process.platform !== "win32") return "indisponible";
		const titre = PRODUCT_NAME + " - " + NOMS_OUTILS[tool];
		const script = scriptUsageTerminal(tool, titre, t("app.comptes.usageTerminalHint"));
		if (script === null) return "indisponible";
		if (!lancerTerminal(titre, script)) return "indisponible";
		/* Posé SOUS LA FENÊTRE (moitié basse, pas de modale à ancrer), et sa
		   disparition rend la main comme pour les deux autres terminaux :
		   Neo Quiz revient au premier plan quand on quitte le REPL. */
		disposerAvecTerminal(titre, null);
		return "lance";
	});

	/* ─── OPEN A PLAIN TERMINAL ───
	   The "Open a terminal" button of the manual install path (2026-09-30). It
	   takes NO argument: no name, no command, no path comes from the renderer,
	   so a compromised renderer can only obtain an empty PowerShell window under
	   the user's eyes, never a command run. Not Windows: `indisponible`. */
	ipcMain.handle(CANAUX.processusOpenTerminal, (): "lance" | "indisponible" => openPlainTerminal() ? "lance" : "indisponible");

	/* ─── CONNECTER UN CLI ───
	   Même porte, même jugement du nom, et SANS confirmation native : cet
	   appel ne télécharge rien et n'exécute aucun script distant — il lance
	   `codex login` / `claude auth login`, un exécutable déjà présent et déjà
	   sur la liste blanche. `scriptConnexion` rend `null` pour Ollama, dont le compte se
	   connecte par le navigateur (`/api/me` rend l'adresse, voir
	   `ai-providers.ts`). */
	ipcMain.handle(CANAUX.processusConnecter, async (_e, tool: unknown, ancre: unknown): Promise<"lance" | "annule" | "indisponible"> => {
		if (!estOutilAutorise(tool)) {
			console.warn(LOG_PREFIX, "connexion refusée, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		if (process.platform !== "win32") return "indisponible";
		const name = NOMS_OUTILS[tool];
		const titre = PRODUCT_NAME + " - " + name;
		const script = scriptConnexion(tool, titre, {
			succes: t("app.connectCli.done", { name }),
			echec: t("app.connectCli.failed", { name }),
			/* Antigravity seulement (lus par `agyConnexion`) : l'avertissement
			   des 60 secondes et le message d'expiration, traduits ICI — jamais
			   un texte venu du rendu dans un script. */
			agyCountdown: t("app.comptes.agyCountdown"),
			agyExpire: t("app.comptes.agyExpired"),
		});
		if (script === null) return "indisponible";
		const place = await preparerColonnes(lireAncre(ancre));
		if (!lancerTerminal(titre, script)) return "indisponible";
		disposerAvecTerminal(titre, place);
		return "lance";
	});

	/* ─── LANCER UN CLI ───

	   La capacité la plus dangereuse du pont, et elle tient sur trois règles
	   qui ne se remplacent pas :

	   1. LE NOM EST JUGÉ AVANT TOUT ce qui suit — avant de lire un réglage,
	      avant de toucher au disque, avant le moindre `spawn`. C'est la liste
	      blanche d'`OUTILS` (`process.ts`, la même que l'hôte Obsidian), et
	      c'est elle qui rend impossible « écris `x.bat` dans un dossier ouvert,
	      puis lance-le » — une séquence que le périmètre des chemins, qui ne
	      borne que la lecture et l'écriture, ne voit pas.
	   2. LE CHEMIN DE L'EXÉCUTABLE VIENT DU MAGASIN DU PRINCIPAL, jamais de cet
	      appel : un chemin envoyé par le rendu annulerait la règle 1 d'un trait.
	      Le réglage lui-même est gardé À L'ÉCRITURE (`garde-ia.ts`).
	   3. L'APPEL EST RECOMPOSÉ CHAMP PAR CHAMP, comme `reseau.fetch` : une
	      propriété inattendue glissée dans l'objet reçu n'atteint pas `run`.

	   L'ENVELOPPE (`ResultatCli`, `pont.ts`) et non un rejet : l'IPC perd le
	   `name` d'une erreur, et tout le contrat de `run` tient dans ce nom. */
	const cliEnVol = new Map<number, { controleur: AbortController; page: Electron.WebContents; reprenable: boolean }>();
	/* A PAGE THAT GOES AWAY TAKES ITS CLIs WITH IT (2026-09-30): a reload of
	   the window (update, crash, Ctrl+R) left the running Claude Code going
	   in the background, answering nobody — and holding the tool's lock, so
	   the next generation failed with "already running", or waited on a
	   model the page could no longer hear. The runs a page started are
	   stopped when it navigates away, crashes or is destroyed.

	   EXCEPT A RESUMABLE RUN (same day, `resumable-runs.ts`): a generation
	   sent with a resume key is DETACHED on navigation or crash, and the
	   reloaded page attaches to it again; only its window being destroyed,
	   or nobody asking for it within the minute, stops it. */
	const reprises = creerReprises<Electron.WebContents>({ delaiMs: DELAI_REPRISE_MS, tailleMax: TAILLE_MAX_REPRISE });
	const pagesSuivies = new WeakSet<Electron.WebContents>();
	const quitterPage = (page: Electron.WebContents, definitif: boolean): void => {
		for (const [cle, run] of cliEnVol) {
			if (run.page !== page) continue;
			if (!run.reprenable || definitif) run.controleur.abort();
			cliEnVol.delete(cle);
		}
		if (definitif) reprises.detruire(page); else reprises.detacher(page);
	};
	const suivrePage = (page: Electron.WebContents): void => {
		if (pagesSuivies.has(page)) return;
		pagesSuivies.add(page);
		page.on("did-start-navigation", (...a: unknown[]) => {
			const details = a[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
			const surPlace = typeof a[2] === "boolean" ? a[2] : details?.isSameDocument === true;
			const cadrePrincipal = typeof a[3] === "boolean" ? a[3] : details?.isMainFrame !== false;
			if (cadrePrincipal && !surPlace) quitterPage(page, false);
		});
		page.on("render-process-gone", () => quitterPage(page, false));
		page.once("destroyed", () => quitterPage(page, true));
	};

	ipcMain.handle(CANAUX.processusRun, async (e, spec: unknown, requeteId: unknown, flux: unknown): Promise<ResultatCli> => {
		const s = (spec && typeof spec === "object" ? spec : {}) as Partial<RequeteCli>;
		if (!estOutilAutorise(s.tool)) {
			console.warn(LOG_PREFIX, "CLI refusé, outil hors liste:", s.tool);
			return { ok: false, nom: "refuse", message: "outil hors liste : " + String(s.tool) };
		}
		const tool = s.tool;
		/* LES ARGUMENTS AUSSI, et pas seulement le nom (revue de sécurité du
		   2026-09-25) : un rendu compromis passait sinon à Claude Code ou à
		   Codex les options qui exécutent des commandes sans le modèle. Seules
		   les formes d'appel connues passent — voir `gabarits-cli.ts`. */
		if (!argumentsAutorises(tool, s.args, s.marqueur)) {
			console.warn(LOG_PREFIX, "CLI refusé, arguments hors gabarit:", tool);
			return { ok: false, nom: "refuse", message: "arguments refusés pour " + tool };
		}
		const args = s.args as string[];
		const fichiers = Array.isArray(s.fichiers)
			? s.fichiers
				.filter((f): f is { nom: string; base64: string } =>
					!!f && typeof f === "object" && typeof f.nom === "string" && typeof f.base64 === "string")
				.map(f => ({ nom: f.nom, base64: f.base64 }))
			: undefined;
		const id = typeof requeteId === "number" ? requeteId : NaN;
		/* THE LIVE TRANSCRIPT (2026-09-29): the standard output, as it
		   arrives, to the window that asked — `e.sender`, never another. It
		   is the text this call returns anyway at the end; nothing new leaves
		   the main process, and nothing but a boolean came in. */
		const expediteur = e.sender;
		const surStdout = flux === true && !Number.isNaN(id)
			? (texte: string): void => { if (!expediteur.isDestroyed()) expediteur.send(CANAUX.processusFlux, { id, texte }); }
			: undefined;
		suivrePage(expediteur);
		/* THE RESUME KEY. Its run is found again only by THIS page and only
		   once detached (`rattacher`): the key never reaches another
		   window's run, and a run still attached is never shared. The tool
		   and arguments were judged above like any call; an attach launches
		   nothing new. */
		const cleReprise = estCleReprise(s.reprise) ? s.reprise : null;
		/* What the run is asked, WITHOUT its marker: the marker is drawn at
		   random for each call (`nouveauMarqueur`), so the replay of a line
		   after a reload carries a new one in its tokens — the rest must be
		   the same for an attach. */
		const empreinte = cleReprise ? empreinteAppel(tool, args, typeof s.stdin === "string" ? s.stdin : "", typeof s.marqueur === "string" ? s.marqueur : "") : "";
		const rattache = cleReprise ? reprises.rattacher(expediteur, cleReprise, empreinte, surStdout ?? null) : null;
		if (rattache) {
			const enVolRattache = { controleur: rattache.controleur, page: expediteur, reprenable: true };
			if (!Number.isNaN(id)) cliEnVol.set(id, enVolRattache);
			try {
				return await rattache.resultat;
			} finally {
				if (cliEnVol.get(id) === enVolRattache) cliEnVol.delete(id);
			}
		}
		const controleur = new AbortController();
		/* A key already held (by this window or another, attached or not) is
		   not resumable: launched plainly, stopped with its page as before. */
		const reprenable = !!cleReprise && reprises.libre(cleReprise);
		const enVolCli = { controleur, page: expediteur, reprenable };
		if (!Number.isNaN(id)) cliEnVol.set(id, enVolCli);
		const executer = async (emettre?: (texte: string) => void): Promise<ResultatCli> => {
			try {
				const res = await run({
					tool,
					args,
					stdin: typeof s.stdin === "string" ? s.stdin : "",
					timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : undefined,
					marqueur: typeof s.marqueur === "string" ? s.marqueur : undefined,
					fichiers,
					sortieFichier: typeof s.sortieFichier === "string" ? s.sortieFichier : undefined,
					signal: controleur.signal,
				}, { surStdout: emettre });
				return { ok: true, stdout: res.stdout, stderr: res.stderr, code: res.code, sortie: res.sortie };
			} catch (e) {
				/* Le NOM survit, c'est tout l'objet de l'enveloppe. « erreur » est le
				   défaut d'une exception qui n'en porterait pas — jamais un nom du
				   contrat choisi au hasard, qui mentirait sur la cause. */
				const nom = e instanceof Error && e.name ? e.name : "erreur";
				const message = e instanceof Error ? e.message : String(e);
				console.warn(LOG_PREFIX, "CLI", tool, "en échec:", nom, message);
				return { ok: false, nom, message };
			}
		};
		try {
			/* A resumable run streams through the registry, which buffers the
			   output for a later attach, even when this call asked for no
			   stream. */
			return reprenable && cleReprise
				? await reprises.lancer(expediteur, cleReprise, empreinte, controleur, executer, surStdout ?? null)
				: await executer(surStdout);
		} finally {
			/* Retirée SEULEMENT si c'est encore la sienne : le compteur du rendu
			   repart à 1 après un `location.reload()`, et le `finally` d'un appel
			   de l'ancienne page ne doit pas emporter l'entrée de la nouvelle —
			   qui deviendrait inannulable. Même raison qu'au réseau. */
			if (cliEnVol.get(id) === enVolCli) cliEnVol.delete(id);
		}
	});
	ipcMain.handle(CANAUX.processusAnnuler, (e, requeteId: unknown) => {
		/* Only the window that launched the call stops it (security review
		   of 2026-09-30): ids are per page, another window's could match. */
		const enVol = typeof requeteId === "number" ? cliEnVol.get(requeteId) : undefined;
		if (enVol && enVol.page === e.sender) enVol.controleur.abort();
	});

	ipcMain.handle(CANAUX.armerFermeture, () => deps.fermeture.armer());
	ipcMain.handle(CANAUX.fermetureTerminee, () => deps.fermeture.terminee());

	/* ─── LA FENÊTRE SANS CADRE ───
	   Le rendu dessine la barre ; le principal exécute. Rien ne traverse
	   qu'un ordre sans argument, ou un nom d'une union fermée, ou un nombre
	   borné ici : aucun chemin, aucune URL. */
	ipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());
	ipcMain.handle(CANAUX.fenetreReduire, () => deps.fenetre.reduire());
	ipcMain.handle(CANAUX.fenetrePremierPlan, () => deps.fenetre.premierPlan());
	ipcMain.handle(CANAUX.fenetreAgrandir, () => deps.fenetre.agrandirOuRestaurer());
	ipcMain.handle(CANAUX.fenetreFermer, () => deps.fenetre.fermer());
	ipcMain.handle(CANAUX.fenetrePleinEcran, () => deps.fenetre.pleinEcran());
	ipcMain.handle(CANAUX.fenetreEtatLire, () => deps.fenetre.etat());
	ipcMain.handle(CANAUX.affichageZoom, async (_e, facteur: unknown) => {
		const f = borneZoom(facteur);
		deps.fenetre.zoom(f);
		await deps.reglagesOuErreur().ecrire(CLE_REGLAGES_ZOOM, f);
	});
	ipcMain.handle(CANAUX.affichageRecharger, () => deps.fenetre.recharger());
	ipcMain.handle(CANAUX.affichageOutilsDev, () => deps.fenetre.outilsDev());

	/* ─── LA MISE À JOUR ───
	   Rien de ce qui traverse n'est un chemin ni une URL : le rendu demande,
	   le principal décide avec son `app-update.yml`. `installer` ferme la
	   fenêtre par le chemin de la croix (écritures différées vidées) ; c'est
	   `main.ts` qui, tout fermé, lance `quitAndInstall`. */
	ipcMain.handle(CANAUX.miseAJourEtatLire, () => deps.miseAJour.etat());
	ipcMain.handle(CANAUX.miseAJourVerifier, () => deps.miseAJour.verifier());
	ipcMain.handle(CANAUX.miseAJourInstaller, () => {
		/* A version waiting on a metered connection: the click is Download. */
		if (deps.miseAJour.etat().phase === "disponible") { void deps.miseAJour.telecharger(); return; }
		if (deps.miseAJour.armerInstallation()) deps.fermerPourInstaller();
	});

	/* ─── THE SYNC (embedded Syncthing) ───
	   THREE verbs and two pushes, nothing else. What comes from the window is
	   a device id, and for a pairing the name its link announced, both checked
	   in the main process before they reach a config (`syncthing.ts`); no
	   path, port, folder id or REST call ever crosses, and neither does the
	   API key. */
	if (deps.sync) {
		const sync = deps.sync;
		ipcMain.handle(CANAUX.syncEtatLire, () => sync.etat());
		ipcMain.handle(CANAUX.syncAppairer, (_e, id: unknown, nom: unknown) =>
			typeof id === "string" && id.length <= 80
				? sync.appairer(id, typeof nom === "string" && nom.length <= 256 ? nom : undefined)
				: "invalide");
		ipcMain.handle(CANAUX.syncOublier, async (_e, id: unknown) => {
			if (typeof id === "string" && id.length <= 80) await sync.oublier(id);
		});
		ipcMain.handle(CANAUX.syncRenommer, async (_e, id: unknown, nom: unknown) => {
			if (typeof id === "string" && id.length <= 80 && typeof nom === "string" && nom.length <= 200) await sync.renommer(id, nom);
		});
		ipcMain.handle(CANAUX.syncRenvoyer, async (_e, id: unknown) => {
			if (typeof id === "string" && id.length <= 80) await sync.renvoyer(id);
		});
		/* The three verbs of the bottom rows of the page (2026-10-04): the log
		   of the engine, and switching sync off and on. NONE of them takes an
		   argument: the page names a verb, the main process reads the switch
		   and the log itself (the `syncActif` setting is the main process's). */
		ipcMain.handle(CANAUX.syncJournal, async () => await sync.journal());
		ipcMain.handle(CANAUX.syncDesactiver, async () => { await sync.desactiver(); });
		ipcMain.handle(CANAUX.syncActiver, async () => { await sync.activer(); });
		ipcMain.handle(CANAUX.syncIgnorer, async (_e, id: unknown) => {
			if (typeof id === "string" && id.length <= 80) await sync.ignorer(id);
		});
		/* Sharing the id: the window sends a channel name, nothing else, and
		   only `systeme` does anything. The id is OURS (read from the running
		   instance, validated); the text is built here. */
		let partageSyncEnCours = false;
		ipcMain.handle(CANAUX.syncPartagerId, async (_e, canal: unknown) => {
			/* Single flight, like `partage.ts`: a second call while one is open is dropped. */
			if (partageSyncEnCours) return false;
			partageSyncEnCours = true;
			try {
				return await partagerIdSync(canal);
			} finally {
				partageSyncEnCours = false;
			}
		});
		const partagerIdSync = async (canal: unknown): Promise<boolean> => {
			const id = (await sync.etat()).appareil;
			if (!isDeviceId(id)) return false;
			/* `systeme`: Windows' Share panel, with a text this process built
			   from its own validated id. */
			if (canal === "systeme") {
				if (process.platform !== "win32") return false;
				const jeton = verrouSync.prendre();
				if (jeton === null) return false;
				/* The pairing PAGE of the site, a link every app makes clickable
				   (a `neo-quiz://` one is not): it shows this device and opens Neo
				   Quiz with "Add a device" filled in. ID and name ride in the
				   fragment, which no server ever receives. Pasted whole into "Add
				   a device", the message works too (`normaliserCode`). */
				const nom = os.hostname().slice(0, 64);
				const lien = `https://neo-quiz.github.io/pair/#device=${id}&name=${encodeURIComponent(nom)}`;
				const r = await lancerPartageNatif({ titre: PRODUCT_NAME, texte: t("app.syncShare.body", { name: nom, link: lien }), centre: centreFenetre() }, () => verrouSync.rendre(jeton));
					if (!r.ok) console.warn(`[partage] sync share failed (${r.raison}): ${r.message}`);
					return r.ok;
			}
			return false;
		};
		/* The QR code: no argument crosses. A window that asks faster than
		   every 500 ms gets the last answer again, so it cannot turn the
		   2 s rotation into a flood of codes and REST calls. */
		let dernierQr: { t: number; r: Promise<{ texte: string; periodeMs: number } | null> } | null = null;
		ipcMain.handle(CANAUX.syncQrSuivant, () => {
			const t = Date.now();
			if (dernierQr && t - dernierQr.t < 500) return dernierQr.r;
			dernierQr = { t, r: sync.qrSuivant() };
			return dernierQr.r;
		});
		/* Closing does NOT reset the throttle: closing then asking again would
		   otherwise skip it (security review, 2026-10-03). A dialog reopened
		   within 500 ms shows the last code once, then the next one. */
		ipcMain.handle(CANAUX.syncQrFermer, () => { sync.qrFermer(); });
		sync.surEtat(etat => deps.envoyer(CANAUX.syncEtat, etat));
		sync.surDonneesRecues(() => deps.envoyer(CANAUX.syncDonneesRecues, null));
		ipcMain.handle(CANAUX.syncLienAppairageLire, () => deps.prendreLienAppairage?.() ?? null);
	}

	/* ─── LES VIDÉOS YOUTUBE (tâche 4) ───
	   Le rendu ne passe qu'un IDENTIFIANT de vidéo, et ce qui traverse
	   est jugé comme tout le reste du fichier :

	   1. L'IDENTIFIANT EST JUGÉ AVANT TOUT, par `ID_VIDEO` (le noyau pur,
	      `src/video/youtube.ts`) : un identifiant hors regex rejette sans
	      composer le moindre libellé ni lancer le moindre process — et
	      `video.ts` le revalide, mais c'est ici que la tuile ne peut
	      faire passer que de la forme valide.
	   2. LES LIBELLÉS DU DOCUMENT SONT COMPOSÉS À CET APPEL, par `t()`,
	      dans la langue posée par `main.ts` — jamais dans une constante
	      top-level : `t()` doit être appelé au rendu (`CLAUDE.md`), un
	      libellé figé au démarrage ignorerait le changement de langue.
	      Ils traversent `DepsVideo`, et le noyau les met dans le
	      document joint à la demande — des DONNÉES, pas des textes
	      d'écran (la tuile et la modale portent les leurs, tâches 5
	      et 6).
	   3. L'ERREUR TRAVERSE EN ENVELOPPE (`EnveloppeVideo`, pont.ts),
	      comme `ResultatCli` : l'IPC perd le `name` d'une erreur jetée,
	      et tout le jugement de la tuile tient dans ce code.

	   ET LA MISE À JOUR EST LANCÉE SANS ÊTRE ATTENDUE (le plan le
	   demande verbatim), AVANT la transcription : au plus un
	   `yt-dlp -U` par 24 h (l'horodatage est posé AVANT le
	   lancement par la tâche 3), avalée et journalisée en cas
	   d'échec — jamais bloquante pour la transcription qui suit.
	   ICI, et non dans `video.ts`, pour ne pas refermer le cycle
	   d'imports que `video-installation.ts` ouvre déjà vers lui. */
	ipcMain.handle(CANAUX.videoEtat, () => etatInstallation());

	ipcMain.handle(CANAUX.videoInfos, () => infosInstallation());

	ipcMain.handle(CANAUX.videoTranscrire, (_e, id: unknown): Promise<EnveloppeVideo<ResultatVideo, CodeErreurVideo>> => {
		/* LA REVALIDATION DU SEUL ARGUMENT VENU DU RENDU : une chaîne hors
		   regex ne lance rien, ne compose rien — le code d'erreur est
		   celui que `transcrire` aurait produit, pour que la tuile le
		   juge comme une panne ordinaire (elle n'en envoie jamais de
		   mauvais : c'est une garde contre un rendu compromis). */
		if (typeof id !== "string" || !ID_VIDEO.test(id)) {
			console.warn(LOG_PREFIX, "transcription refusée, identifiant invalide :", id);
			return Promise.resolve({ ok: false, code: "inconnue", detail: "identifiant : " + String(id) });
		}
		/* LA MISE À JOUR, SANS L'ATTENDRE (voir l'en-tête) : les erreurs
		   de `-U` sont avalées et journalisées par le module
		   d'installation — un `void` explicite, jamais un `await`. */
		void mettreAJourSiDu();
		/* LES SEPT LIBELLÉS du document, composés À CET APPEL — c'est le
		   PIÈGE du `CLAUDE.md` : une constante top-level figerait la
		   langue du démarrage et ignorerait son changement. */
		const libelles: LibellesDocument = {
			chaine: t("ai.video.doc.chaine"),
			duree: t("ai.video.doc.duree"),
			langue: t("ai.video.doc.langue"),
			manuel: t("ai.video.doc.manuel"),
			auto: t("ai.video.doc.auto"),
			description: t("ai.video.doc.description"),
			transcription: t("ai.video.doc.transcription"),
		};
		return transcrire(id, { libelles }).then(
			resultat => ({ ok: true, valeur: resultat }),
			(e: unknown) => {
				/* Un rejet SANS code est un bug, pas une panne attendue :
				   nommé dans la console du principal, comme partout dans
				   ce fichier — le rendu n'en verra que le code. */
				if (!(e as { code?: unknown })?.code) console.warn(LOG_PREFIX, "transcription en exception :", e);
				return { ok: false, code: codeErreurVideo(e), detail: (e as { detail?: string })?.detail };
			},
		);
	});

	ipcMain.handle(CANAUX.videoAnnuler, (_e, id: unknown) => {
		/* Un identifiant inconnu (déjà finie, jamais lancée, hors regex)
		   est ignoré : annuler ce qui ne court plus n'est pas une
		   erreur — la même réponse « trop tard » qu'au réseau. */
		if (typeof id === "string") annulerVideo(id);
	});

	/* CODE EXECUTION. The arguments come from the renderer: revalidated
	   here, bounded in size (64 KB), deadline clamped to [100 ms, 10 s],
	   `language` checked against the known set — the sandbox does the rest
	   (code-sandbox.ts), and answers `not-installed` for `c`/`cpp` until
	   task 8 adds the Clang/WASM worker. */
	const PLAFOND_CODE = 64 * 1024;
	const LANGUES_CODE = ["python", "c", "cpp"] as const;
	/* Defence in depth (security review 2026-09-27, M1): the sandbox's
	   hidden window has no `neo` bridge (no `neo` preload, the code runs in
	   a worker) and therefore cannot reach this channel — but checking the
	   sender only on the RETURN channel (`code-sandbox.ts`) left this one
	   without a symmetrical guard. */
	const depuisFenetrePrincipale = (e: Electron.IpcMainInvokeEvent) => e.sender === deps.fenetreCourante()?.webContents;
	ipcMain.handle(CANAUX.codeRun, (e, job: unknown): Promise<CodeRun> => {
		if (!depuisFenetrePrincipale(e)) return Promise.resolve({ status: "unavailable", stdout: "", error: "job refused" });
		const o = (job ?? {}) as Record<string, unknown>;
		const texte = (v: unknown) => typeof v === "string" && v.length <= PLAFOND_CODE;
		if (!LANGUES_CODE.includes(o.language as never) || !texte(o.code) || !texte(o.stdin ?? "") || (o.after !== undefined && !texte(o.after))) {
			return Promise.resolve({ status: "unavailable", stdout: "", error: "job refused" });
		}
		const delai = Math.min(10000, Math.max(100, Number.isFinite(o.timeoutMs) ? Number(o.timeoutMs) : 5000));
		return deps.code.run({ language: o.language as CodeLanguage, code: o.code as string, stdin: (o.stdin as string) ?? "", after: o.after as string | undefined, timeoutMs: delai });
	});
	ipcMain.handle(CANAUX.codeWarm, (e, language: unknown) => { if (depuisFenetrePrincipale(e) && LANGUES_CODE.includes(language as never)) deps.code.warm(language as CodeLanguage); });

	/* THE LANGUAGE PACKS (task 9). The renderer passes ONE argument, the
	   pack's name (`"c"`, which serves C and C++, or `"python"`): anything
	   else is refused before a byte moves. The URL, the hash and the
	   directory are the main process's own (`langages.ts`, `main.ts`).
	   ONE install at a time PER PACK: a second call for the same pack while
	   one runs gets the SAME promise instead of racing it on the same
	   `.part` files, and a delete waits for that pack's install rather than
	   removing a directory being renamed into place. Progress is PUSHED
	   (`langagesProgression`), like yt-dlp's. */
	const PACKS_CONNUS = ["c", "python"] as const;
	const packConnu = (nom: unknown): nom is NomPack => PACKS_CONNUS.includes(nom as never);
	const installationsPack = new Map<NomPack, Promise<EnveloppeVideo<null, CodeInstallation>>>();
	ipcMain.handle(CANAUX.langagesEtat, async (e, nom: unknown) => {
		if (!depuisFenetrePrincipale(e) || !packConnu(nom)) return { installe: false, version: null, octets: 0 };
		return etatLangage(deps.dossierLangages, nom);
	});
	ipcMain.handle(CANAUX.langagesInstaller, (e, nom: unknown): Promise<EnveloppeVideo<null, CodeInstallation>> => {
		if (!depuisFenetrePrincipale(e) || !packConnu(nom)) return Promise.resolve({ ok: false, code: "reseau", detail: "pack refused" });
		const enCoursDeCePack = installationsPack.get(nom);
		if (enCoursDeCePack) return enCoursDeCePack;
		/* Already installed at the pinned version: nothing to download — a
		   compromised renderer cannot make the app re-fetch 28 MB in a loop.
		   Unless the pack's marker file is gone (an antivirus quarantine of
		   the compiler or the wasm): then Install repairs it. */
		const pin = PACKS[nom];
		const enPlace = (st: { installe: boolean; version: string | null }): boolean =>
			st.installe && st.version === pin.version && existsSync(path.join(deps.dossierLangages, nom, ...pin.marqueur.split("/")));
		const enCours = etatLangage(deps.dossierLangages, nom).then(st => (enPlace(st) ? undefined : installerLangage(deps.dossierLangages, nom, (recus, total) => deps.envoyer(CANAUX.langagesProgression, { recus, total }))))
			.then((): EnveloppeVideo<null, CodeInstallation> => ({ ok: true, valeur: null }), (err: unknown): EnveloppeVideo<null, CodeInstallation> => {
				if (estErreurInstallation(err)) return { ok: false, code: err.code, detail: err.detail };
				console.warn(LOG_PREFIX, "language pack install threw:", err);
				return { ok: false, code: "reseau" };
			})
			.finally(() => { installationsPack.delete(nom); });
		installationsPack.set(nom, enCours);
		return enCours;
	});
	ipcMain.handle(CANAUX.langagesSupprimer, async (e, nom: unknown) => {
		if (!depuisFenetrePrincipale(e) || !packConnu(nom)) return;
		await installationsPack.get(nom);
		await supprimerLangage(deps.dossierLangages, nom);
	});

	ipcMain.handle(CANAUX.videoInstaller, async (): Promise<EnveloppeVideo<null, CodeInstallation>> => {
		try {
			/* La progression POUSÉE vers la fenêtre en OCTETS, comme les
			   événements du surveillant : la modale anime une jauge, pas
			   trois états. Le rappel vit dans le rendu, il ne traverse
			   pas l'IPC (voir `Pont.video`). */
			await installerYtDlp((recus, total) => deps.envoyer(CANAUX.videoProgression, { recus, total }));
			return { ok: true, valeur: null };
		} catch (e) {
			/* Rejet réduit au CODE : le message n'est pas traduit. Une
			   exception hors installation (un bug) vaut `reseau`, et est
			   NOMMÉE dans la console du principal. */
			if (estErreurInstallation(e)) return { ok: false, code: e.code, detail: e.detail };
			console.warn(LOG_PREFIX, "installation de yt-dlp en exception :", e);
			return { ok: false, code: "reseau" };
		}
	});

	return { arreterAttente: () => attente.arreter() };
}
