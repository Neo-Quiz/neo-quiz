/* ══════════════════════════════════════════════════════════
   LE PROCESSUS PRINCIPAL — LA FENÊTRE, ET LE SEUL CÔTÉ QUI TOUCHE LE DISQUE

   Tâche 3 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce fichier ouvre
   la fenêtre, alimente le périmètre et branche les canaux du pont
   (`./pont.ts`, `./canaux.ts`).

   LES TROIS DRAPEAUX DE LA FENÊTRE NE SE NÉGOCIENT PAS —
   `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Neo Quiz
   rend du HTML qui n'est PAS toujours celui de l'utilisateur : un quiz PARTAGÉ
   arrive avec les `explainHtml` de son auteur, et ce HTML est traité par notre
   propre chaîne de rendu (`CLAUDE.md`, « Texte et HTML d'un quiz : quatre
   portes »). Avec `nodeIntegration`, une seule porte oubliée donnerait à ce
   HTML un `require("child_process")` — l'accès complet à la machine. Les trois
   sont écrits EXPLICITEMENT même quand ils sont déjà le défaut d'Electron :
   un défaut peut changer d'une version majeure à l'autre sans rien casser de
   visible, et personne ne relit une ligne absente.

   Les gestionnaires des canaux vivent dans `./canaux.ts` (aucun `ipcMain.on`,
   tout est `ipcMain.handle`) ; le périmètre qui borne chaque chemin dans
   `./perimetre.ts`. Le seul sens principal → rendu est `webContents.send` du
   surveillant (`CANAUX.evenement`) et l'appel de fermeture, auquel le rendu
   RÉPOND par un `invoke`.
══════════════════════════════════════════════════════════ */

import { BrowserWindow, Menu, app, dialog, net, protocol, shell } from "electron";
import * as fs from "node:fs/promises";
// Le SEUL usage synchrone du disque dans ce fichier — voir `poserLocaleChromium`.
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { currentLang, setLanguage, t } from "../../../src/i18n";
import {
	afficherFenetreMaj,
	DRAPEAU_FENETRE_MAJ,
	lancerFenetreMaj,
	langueDepuisArguments,
	marquerDemarrage,
	nettoyerLiensMaj,
	versionDepuisArguments,
} from "./fenetre-maj";
import { enregistrerCanaux } from "./canaux";
import { cheminDossierDefaut } from "./dossier-defaut";
import { chargerPathRegistre } from "./process";
import { surveillerCachesCli } from "./surveillant-cli";
import { perimetreInitial } from "./perimetre";
import type { Perimetre } from "./perimetre";
import { CANAUX, CLE_DOSSIER_DEFAUT, CLE_SYNC_ACTIF, CLE_SYNC_ROOT, CLE_REGLAGES_IA, CLE_REGLAGES_LANGUE, CLE_REGLAGES_ZOOM, borneZoom } from "./pont";
import type { EtatFenetre } from "./pont";
import { creerGestionSync } from "./syncthing";
import { nomSur } from "./syncthing-regles";
import type { GestionSync } from "./syncthing";
import { creerMiseAJour } from "./mise-a-jour";
import type { MiseAJour } from "./mise-a-jour";
import { creerReglages } from "./reglages";
import type { Reglages } from "./reglages";
import { autoriserHote } from "./reseau";
import { SCHEMA_RESSOURCES, resoudreRessource } from "./ressources";
/* THE CODE SANDBOX (task 4, then generalised from Python-only to any
   language at task 3 of the C/C++ execution plan): `PRIVILEGES_CODE` is
   added to the ONE call to `registerSchemesAsPrivileged` (Electron only
   keeps the last one), and `creerBacASable` builds the hidden window passed
   to the channels. */
import { creerBacASable, PRIVILEGES_CODE } from "./code-sandbox";
import type { BacASable } from "./code-sandbox";

/** Le serveur de développement de Vite. Le port vient de `vite.config.ts`
    (`strictPort: true`) : s'il change là-bas, il change ici. */
const URL_DEV = process.env.NEO_DEV_SERVER ?? "http://localhost:1421";

/** Les mêmes dimensions que l'ancienne fenêtre Tauri (`tauri.conf.json`,
    retiré tâche 7) : ce n'est pas une application neuve, c'est la même qui
    change de coquille. */
const FENETRE = { width: 1280, height: 840, minWidth: 900, minHeight: 600 };

/**
 * Le délai après lequel la fenêtre se ferme MÊME SI le rendu n'a pas répondu.
 *
 * Sans lui, un rendu figé (ou déjà mort) rendrait la fenêtre INFERMABLE —
 * exactement le piège documenté côté Tauri, où un `destroy()` refusé par les
 * permissions empêchait toute fermeture après l'ajout d'un écouteur.
 *
 * VALEUR FIXÉE PAR MESURE (tâche 6), pas choisie à vue comme les 3000 ms de
 * la tâche 3. Les trois écrivains différés de l'application ont des débounces
 * de 500 ms (`src/review/log-file.ts`), 500 ms (`src/dashboard/stats-store.ts`)
 * et 600 ms (`src/dashboard/detail.ts`) — mais AUCUN des trois ne gate cette
 * attente : `flushSave()`/`dispose()` de la page d'un quiz ANNULENT leur
 * minuterie et lancent l'écriture SUR-LE-CHAMP (voir leur commentaire dans
 * `detail.ts`). Le débounce n'est donc jamais ce qu'on attend ici ; ce qu'on
 * attend, c'est l'IPC (un aller-retour `invoke`) plus l'écriture disque
 * elle-même. Mesuré de bout en bout, sur un WM_CLOSE réel (`PostMessage`
 * WM_CLOSE, pas `window.close()` — voir plus bas pourquoi), frappe tapée puis
 * fenêtre fermée AUSSITÔT (moins de 40 ms après la frappe) : la fenêtre a fini
 * de se fermer 72 à 116 ms après le WM_CLOSE, note relue avec la frappe dedans
 * — et l'écart interne entre l'appel de fermeture et la réponse du rendu
 * n'était que de 4 ms. Rien en attente : 70 ms, un temps équivalent — la
 * croix ne paie donc jamais ce délai dans le cas courant.
 *
 * Le garde-fou n'a donc PAS à couvrir un débounce ni même une écriture lente
 * ordinaire (déjà sous 120 ms mesurés) : il protège contre le cas
 * PATHOLOGIQUE — un rendu figé, un disque réseau ou synchronisé
 * (OneDrive, antivirus) qui traîne, un vault distant. 1500 ms donne plus de
 * DIX FOIS la marge du cas mesuré (120 ms) tout en restant sous la seconde et
 * demie où l'utilisateur perçoit un blocage — ni les 2000 ms du brief ni les
 * 3000 ms de la tâche 3, choisis sans mesure l'un et l'autre. Le principe qui
 * tranche si ce délai se révèle encore trop court sur un vault lent : mieux
 * vaut perdre la dernière frappe que refuser de fermer.
 */
const DELAI_GARDE_FERMETURE_MS = 1500;

/* ─────────── état du processus ─────────── */

/** L'état de la fenêtre tel que le pont le POUSSE au rendu — voir `pousserEtat`
    dans `creerFenetre`. `{ agrandie: false, focus: false, pleinEcran: false }`
    quand la fenêtre n'existe pas ou plus. */
function etatFenetre(): EtatFenetre {
	if (!fenetre || fenetre.isDestroyed()) return { agrandie: false, focus: false, pleinEcran: false };
	return {
		agrandie: fenetre.isMaximized(),
		focus: fenetre.isFocused(),
		pleinEcran: fenetre.isFullScreen(),
	};
}

let fenetre: BrowserWindow | null = null;
let reglages: Reglages | null = null;
/** Le chemin absolu du dossier de quiz par défaut (tranche 9), posé une fois
    au démarrage — le canal `systeme.dossierDefaut` le sert tel quel. */
let dossierDefaut = "";
let miseAJour: MiseAJour | null = null;
/** The embedded Syncthing (Windows only), stopped with the application. */
let sync: GestionSync | null = null;
let fermetureArmee = false;
let fermetureEnCours = false;
let gardeFermeture: NodeJS.Timeout | null = null;
/** Arrête l'attente d'une réponse copiée (voir `canaux.ts`) ; posée par
    `enregistrerCanaux`, appelée à la fermeture de la fenêtre. */
let arreterAttente: (() => void) | null = null;
/** The code sandbox (task 3, `./code-sandbox.ts`, generalised from
    Python-only to any language): created once, closed when the window
    closes, like `arreterAttente`. Only Python is wired through it for now —
    `c`/`cpp` answer `not-installed` until task 8. */
let code: BacASable | null = null;

/** Les réglages, ou une erreur NOMMÉE — voir `DependancesCanaux`. */
function reglagesOuErreur(): Reglages {
	if (!reglages) throw new Error("réglages non initialisés : l'application n'est pas prête");
	return reglages;
}

/* ─────────── la fermeture ─────────── */

/** Ferme pour de bon : annule le garde-fou et détruit la fenêtre. Idempotente
    — le rendu peut répondre alors que le délai vient d'expirer. */
function terminerFermeture(): void {
	if (gardeFermeture) {
		clearTimeout(gardeFermeture);
		gardeFermeture = null;
	}
	if (fenetre && !fenetre.isDestroyed()) fenetre.destroy();
}

/* ─────────── la fenêtre ─────────── */

/** L'origine de la page de l'application (« http://localhost:1421 » en
    développement, « file://…/dist/index.html » sinon). `file://` a une origine
    OPAQUE (« null ») : on compare alors sur le chemin du fichier chargé. */
let origineApp: string | null = null;

function memeOrigine(url: string): boolean {
	if (!origineApp) return false;
	try {
		const u = new URL(url);
		if (u.protocol === "file:") return origineApp.startsWith("file:") && u.pathname === new URL(origineApp).pathname;
		return u.origin === origineApp;
	} catch {
		return false;
	}
}

/** Le nombre de tentatives de connexion au serveur de développement, et
    l'intervalle entre deux : Tâche 6, nommés à la revue de la tâche 3 (deux
    littéraux nus, « dix secondes d'attente silencieuse avant le repli »). Le
    produit des deux (10 s) est le temps qu'Electron laisse à Vite pour
    démarrer avant de retomber sur `dist/index.html` — en pratique celui-ci
    n'existe pas encore en développement (`npm run dev` ne le construit pas),
    et la fenêtre s'ouvre alors sur une page blanche : un mode DÉGRADÉ,
    propre au développement, jamais rencontré depuis un paquet installé
    (`app.isPackaged` court-circuite cette boucle plus haut). */
const TENTATIVES_SERVEUR_DEV = 40;
const INTERVALLE_TENTATIVE_MS = 250;

/** Charge le rendu, en réessayant tant que le serveur de développement n'écoute
    pas encore : `npm run dev` lance Vite et Electron EN PARALLÈLE, et Electron
    est souvent prêt le premier. Sans réessai, la fenêtre s'ouvrirait une fois
    sur deux sur une page d'erreur, selon la machine. */
async function charger(cible: BrowserWindow): Promise<void> {
	const fichierRendu = path.join(__dirname, "..", "dist", "index.html");
	/* `pathToFileURL`, jamais une concaténation : `memeOrigine` compare le
	   `pathname` de l'URL que Chromium rapporte, donc PERCENT-ENCODÉ. Un `#`
	   ou un `?` dans le dossier d'installation (« C:/Apps/Neo Quiz #2 ») aurait
	   fait de la concaténation une URL au fragment tronqué, la comparaison
	   échouait, et `location.reload()` — la navigation dont `choisirDossier`
	   dépend — était REFUSÉE comme une origine étrangère (revue finale, M1). */
	const origineFichier = pathToFileURL(fichierRendu).href;
	if (app.isPackaged) {
		origineApp = origineFichier;
		await cible.loadFile(fichierRendu);
		return;
	}
	origineApp = new URL(URL_DEV).origin;
	for (let essai = 0; essai < TENTATIVES_SERVEUR_DEV; essai++) {
		try {
			await cible.loadURL(URL_DEV);
			return;
		} catch {
			await new Promise(r => setTimeout(r, INTERVALLE_TENTATIVE_MS));
		}
	}
	/* Pas de serveur de développement : on retombe sur le rendu construit,
	   s'il existe. Un `npm run build` suivi d'`electron .` passe par là. */
	origineApp = origineFichier;
	await cible.loadFile(fichierRendu);
}

function creerFenetre(): void {
	/* Retire aussi les accélérateurs natifs : le menu d'application du rendu
	   les remplace, `Ctrl+R`, `F11`, `Ctrl+Alt+I` inclus. */
	Menu.setApplicationMenu(null);
	fenetre = new BrowserWindow({
		...FENETRE,
		title: PRODUCT_NAME,
		// Sans cadre natif, la barre est dessinée par le rendu, style Neo
		// Calendar ; les bords restent redimensionnables sous Windows,
		// `thickFrame` par défaut.
		frame: false,
		/* La fenêtre n'apparaît qu'une fois peinte : sans ça, on voit d'abord un
		   rectangle blanc, puis le thème sombre — un clignotement à chaque
		   lancement. */
		show: false,
		/* La couleur du THÈME (`--background-primary`, `src/theme/host-vars.css`
		   : rgb(30, 30, 46)), pas une valeur recopiée : c'est ce que la fenêtre
		   montre AVANT que la page ait peint, et un ton différent ferait un
		   clignotement à chaque lancement — exactement ce que `show: false`
		   ci-dessus existe pour empêcher (différé depuis la tâche 3, M2). */
		backgroundColor: "#1e1e2e",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			// LES TROIS DRAPEAUX — voir l'en-tête de ce fichier.
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			/* AUCUN correcteur d'orthographe dans l'application (2026-09-26) :
			   il soulignait en rouge le code Python et le HTML d'un énoncé. */
			spellcheck: false,
		},
	});

	/* `ready-to-show` ne signifie que « Chromium a peint ». La fenêtre reste
	   volontairement cachée jusqu'au signal explicite du rendu, APRÈS lecture
	   des réglages, scan initial et montage de l'écran utilisable. */

	/* L'état de la fenêtre est POUSSÉ au rendu : agrandie ou non (l'icône du
	   bouton du milieu), focus ou non (les glyphes de la barre s'atténuent),
	   plein écran. Le rendu ne le devine jamais depuis `innerWidth`. */
	const pousserEtat = (): void => {
		if (!fenetre || fenetre.isDestroyed()) return;
		fenetre.webContents.send(CANAUX.fenetreEtat, etatFenetre());
	};
	/* `as const` seul ne suffit pas à TypeScript pour choisir la bonne
	   surcharge de `on` (l'union de noms ne correspond à aucun overload) :
	   chaque écouteur prend le même rappel sans argument, l'union n'apporte
	   rien de plus qu'une boucle plus courte. */
	fenetre.on("maximize", pousserEtat);
	fenetre.on("unmaximize", pousserEtat);
	fenetre.on("focus", pousserEtat);
	fenetre.on("blur", pousserEtat);
	fenetre.on("enter-full-screen", pousserEtat);
	fenetre.on("leave-full-screen", pousserEtat);

	/* Le zoom persisté (réglage `zoom`), appliqué une fois la page chargée :
	   `did-finish-load` survient après chaque `loadURL`/`loadFile`, y compris
	   un rechargement (`location.reload()`), donc le facteur survit à une
	   navigation. Une valeur hors bornes ou absente n'applique rien : le
	   défaut d'Electron (1) reste en place. */
	fenetre.webContents.on("did-finish-load", () => {
		void (async () => {
			if (!reglages) return;
			let z: unknown;
			try {
				z = await reglages.lire(CLE_REGLAGES_ZOOM);
			} catch {
				return;
			}
			// Clamped, not ignored: a zoom saved below the current minimum (25 %,
			// 50 %) opens at 75 %, the same value the renderer reads back.
			if (typeof z === "number" && Number.isFinite(z)) {
				fenetre?.webContents.setZoomFactor(borneZoom(z));
			}
		})();
	});

	/* Un quiz PARTAGÉ peut contenir un lien : qu'il ouvre une seconde fenêtre
	   Electron n'a aucun sens ici, et une fenêtre ouverte par la page hériterait
	   de préférences que nous n'aurions pas choisies. Refus systématique — mais
	   REMIS AU NAVIGATEUR quand c'est du `https?:`, comme `will-navigate`
	   ci-dessous : le sanitizer admet `<a target="_blank">`, et un refus sec
	   faisait de ce lien légitime un lien MORT, là où le même lien sans
	   `target` s'ouvrait dans le navigateur (revue finale, M7). Même filtre,
	   même geste : deux règles pour un seul lien auraient divergé. */
	fenetre.webContents.setWindowOpenHandler(({ url }) => {
		remettreAuNavigateur(url);
		return { action: "deny" };
	});

	/* UNE NAVIGATION DE PREMIER NIVEAU DONNERAIT `window.neo` À UNE ORIGINE
	   ÉTRANGÈRE. Le sanitizer laisse passer `<a href="https://…">`
	   (`src/engine/sanitizer.ts`), un quiz partagé peut donc porter un lien ;
	   un clic ferait naviguer la fenêtre, et le préchargement est attaché au
	   `webContents`, pas à l'origine — la page de l'attaquant recevrait le
	   pont entier. Règle par ORIGINE : la nôtre (le serveur de développement
	   ou `file://`) navigue librement — c'est ce qui laisse passer le
	   `location.reload()` dont `choisirDossier` dépend, puisqu'un rechargement
	   vise l'URL de l'application ; toute autre origine est REFUSÉE ici et
	   remise au NAVIGATEUR de l'utilisateur, où un lien légitime a sa place. */
	/** Ouvre `url` hors de la fenêtre si c'est du `https?:` (le navigateur) ou
	    de l'`obsidian:` (Obsidian, pour ouvrir une note de vault — demande
	    Ahmed 2026-09-17, `ctx.openInObsidian`), sinon le refus est NOMMÉ dans
	    la console. Partagée entre la navigation de premier niveau et
	    `setWindowOpenHandler` : un seul filtre.

	    `obsidian:` est sans danger à ce niveau : l'URI ne fait qu'ouvrir un
	    vault et une note dans une application que l'utilisateur a installée,
	    et tout autre schéma (`file:`, `javascript:`, un exécutable enregistré
	    comme gestionnaire) reste refusé. */
	/**
	 * `shell.openExternal` passe par ShellExecute, dont la ligne de commande
	 * plafonne à ~32 K caractères (`report:url-max`) ; claude.ai en accepte le
	 * double dans son adresse. Au-delà de la borne de Windows, l'adresse est
	 * écrite dans un FICHIER HTML de redirection du dossier temporaire de
	 * l'application, et c'est ce fichier qui est ouvert : le navigateur suit
	 * `location.replace` sans limite de ligne de commande. Vérifié dans Brave
	 * le 2026-09-19 avec 53 K. Le fichier est effacé une minute plus tard.
	 *
	 * L'adresse est mise dans le script par `JSON.stringify`, jamais
	 * concaténée telle quelle : une URL qui contiendrait `</script>` fermerait
	 * sinon la balise — c'est notre propre adresse, mais la règle ne coûte
	 * rien. Seul `https:` emprunte ce chemin ; `obsidian:` et les adresses
	 * courtes gardent `openExternal`.
	 */
	const LIGNE_DE_COMMANDE_MAX = 30000;
	const ouvrirDehors = async (url: string): Promise<void> => {
		if (url.length <= LIGNE_DE_COMMANDE_MAX || !url.startsWith("https:")) { await shell.openExternal(url); return; }
		const dossier = path.join(app.getPath("temp"), "neo-quiz");
		await fs.mkdir(dossier, { recursive: true });
		const fichier = path.join(dossier, "ouvrir-" + Date.now().toString(36) + ".html");
		const page = "<!doctype html><meta charset=\"utf-8\"><title>" + PRODUCT_NAME + "</title>"
			+ "<script>location.replace(" + JSON.stringify(url) + ")</script>";
		await fs.writeFile(fichier, page, "utf8");
		const erreur = await shell.openPath(fichier);
		if (erreur) {
			console.warn(LOG_PREFIX, "redirection non ouverte:", erreur);
			await shell.openExternal(url).catch(() => { /* trop long : rien de mieux à faire */ });
		}
		setTimeout(() => { void fs.rm(fichier, { force: true }); }, 60_000);
	};
	const remettreAuNavigateur = (url: string): void => {
		/* Sous `try` : `memeOrigine` rend `false` sur une URL non analysable, et
		   un `throw` ici, APRÈS le `preventDefault`, ferait sortir l'écouteur en
		   erreur pour une navigation déjà refusée. */
		let protocole = "";
		try {
			protocole = new URL(url).protocol;
		} catch {
			// URL illisible : refusée, et rien à remettre au navigateur.
		}
		if (/^(https?|obsidian):$/.test(protocole)) void ouvrirDehors(url);
		else console.warn(LOG_PREFIX, "navigation refusée:", url);
	};
	const refuserHorsOrigine = (e: Electron.Event, url: string): void => {
		if (memeOrigine(url)) return;
		e.preventDefault();
		remettreAuNavigateur(url);
	};
	fenetre.webContents.on("will-navigate", refuserHorsOrigine);
	// Une redirection ne peut suivre qu'une navigation admise ; la même règle
	// sur `will-redirect` est la ceinture, pour une ligne.
	fenetre.webContents.on("will-redirect", refuserHorsOrigine);

	/* REMISE À ZÉRO DE L'ARMEMENT — défaut laissé par la tâche 3, relevé à sa
	   revue. `choisirDossier` recharge par `location.reload()` (une navigation
	   de premier niveau ADMISE par `refuserHorsOrigine`, donc jamais annulée) :
	   le nouveau contexte de préchargement reçu par le rendu a `neo.fenetre
	   .surFermeture` non réarmé (`ecouteurFermeturePose` à faux côté rendu,
	   `src/main.ts`), mais SANS ce reset, `fermetureArmee` restait VRAI côté
	   principal — hérité de l'ancien contexte, détruit avec la page qui l'avait
	   posé. Fermer la fenêtre pendant cette fenêtre de course (entre le
	   rechargement et le prochain `armer()`) attendrait alors le délai de garde
	   ENTIER pour un rappel qui n'existe plus. `isMainFrame && !isInPlace` :
	   seule une VRAIE navigation de haut niveau compte, pas un changement de
	   hash ni une frame secondaire (il n'y en a pas ici, mais la garde coûte
	   une comparaison). */
	fenetre.webContents.on("did-start-navigation", (_e, _url, isInPlace, isMainFrame) => {
		if (isMainFrame && !isInPlace) fermetureArmee = false;
	});

	/* Par défaut, Electron ACCORDE les permissions (micro, caméra,
	   notifications…) à toute page. Aucune fonction de l'application n'en
	   demande : refus systématique, et une origine hostile n'obtient rien. */
	fenetre.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

	/* MESURÉ SUR ELECTRON 44, et la tâche 5 doit le savoir : cet événement est
	   émis par le chemin UTILISATEUR (la croix, Alt+F4, la barre des tâches —
	   un WM_CLOSE), mais PAS par un `window.close()` appelé depuis le rendu, qui
	   détruit la fenêtre sans passer par ici. Ce n'est pas gênant — l'application
	   n'appelle jamais `window.close()`, elle recharge (`location.reload()`) —
	   mais un rappel de fermeture éprouvé avec `window.close()` passerait pour
	   cassé alors qu'il ne l'est pas. Vérifié par la tâche 3 (délai de garde
	   alors à 3000 ms) : un rappel qui ne résout jamais fait fermer au délai de
	   garde (3,1 s), un rappel de 600 ms fait fermer à 0,7 s. Rejoué par la
	   tâche 6 sur une écriture RÉELLE (voir `DELAI_GARDE_FERMETURE_MS`) : 72 à
	   116 ms du WM_CLOSE à la fenêtre détruite, frappe relue dans la note. */
	fenetre.on("close", e => {
		/* Tant que le rendu n'a armé aucun rappel, la fermeture est immédiate :
		   intercepter sans personne pour répondre donnerait une fenêtre qui ne
		   se ferme plus — le piège exact rencontré côté Tauri.

		   DÉCISION (défaut laissé par la tâche 3, relevé à sa revue) : un SECOND
		   clic sur la croix pendant que `fermetureEnCours` est vrai n'est PAS
		   intercepté ici — `preventDefault` n'est pas rappelé, et Electron
		   détruit la fenêtre par son comportement natif, abandonnant l'écriture
		   déjà lancée par le premier clic. C'est VOULU, pas oublié : le premier
		   clic a déjà déclenché le vidage des tampons ET posé un délai de garde
		   borné (`DELAI_GARDE_FERMETURE_MS`) — la seule chose qu'un second clic
		   change, c'est de raccourcir une attente déjà plafonnée. Refuser ce
		   second clic ferait de la fenêtre une chose qui ignore l'utilisateur
		   qui insiste, pour ne protéger qu'une fenêtre de quelques centaines de
		   millisecondes au plus — le même arbitrage que le délai de garde
		   lui-même (« mieux vaut perdre la dernière frappe que refuser de
		   fermer »), appliqué à l'impatience plutôt qu'à un rendu figé.

		   LA TENSION AVEC `DELAI_GARDE_FERMETURE_MS`, ET POURQUOI ELLE N'EN EST
		   PAS UNE : ce délai est la PATIENCE de l'application — combien de temps
		   ELLE attend une écriture avant de conclure que le rendu est figé ; le
		   second clic est le MOT DE LA FIN de l'utilisateur — et quand les deux
		   s'opposent (l'utilisateur clique une seconde fois AVANT l'expiration
		   du délai de garde, précisément le moment où ce second clic est le plus
		   tentant), c'est l'utilisateur qui gagne, jamais l'application. Même
		   principe que celui qui fixe `DELAI_GARDE_FERMETURE_MS` : mieux vaut
		   perdre la dernière frappe que refuser de fermer — ici appliqué à
		   l'impatience de l'utilisateur plutôt qu'à un rendu figé, mais c'est le
		   MÊME arbitrage, pas un second.

		   CE QUE ÇA COÛTE VRAIMENT (doute n°1 du rapport de tâche 6) : les
		   1500 ms de `DELAI_GARDE_FERMETURE_MS` sont mesurés sur un disque LOCAL
		   rapide (72 à 116 ms bout en bout pour une écriture réelle). Sur un
		   vault RÉSEAU ou SYNCHRONISÉ (OneDrive, antivirus qui intercepte
		   l'écriture), cette garde peut se révéler trop courte : l'écriture est
		   alors coupée en plein vol par `terminerFermeture()`, et la dernière
		   frappe est perdue — le second clic ne fait qu'avancer ce moment.
		   Ce n'est PAS un défaut caché : c'est l'arbitrage assumé par le plan de
		   migration (mieux perdre la frappe que rendre la fenêtre infermable),
		   écrit ici pour que le prochain lecteur le trouve à l'endroit où il se
		   pose, sans avoir à recouper deux commentaires séparés. */
		if (!fermetureArmee || fermetureEnCours) return;
		fermetureEnCours = true;
		e.preventDefault();
		gardeFermeture = setTimeout(terminerFermeture, DELAI_GARDE_FERMETURE_MS);
		fenetre?.webContents.send(CANAUX.fermeture);
	});

	// Le clignotement posé par l'attente d'une réponse copiée s'éteint dès qu'on revient.
	fenetre.on("focus", () => fenetre?.flashFrame(false));

	fenetre.on("closed", () => {
		fenetre = null;
		arreterAttente?.();
		code?.fermer();
	});

	void charger(fenetre).catch(e => console.error(LOG_PREFIX, "chargement du rendu impossible:", e));
}

/* ─────────── la liste d'hôtes du réseau ─────────── */

/**
 * L'hôte d'`aiOllamaUrl` entre dans la liste du réseau (`./reseau.ts`), lu des
 * RÉGLAGES par le principal, comme les dossiers de `folders` entrent au
 * périmètre. Un Ollama sur un NAS est un usage légitime que l'utilisateur
 * déclare dans ses réglages ; sans cette ligne, il serait refusé « hôte hors
 * liste » sans autre recours.
 * Une URL absente ou illisible n'ajoute rien, en silence : le défaut
 * (`localhost`) est déjà dans la liste.
 * COMME `folders`, la clé `ai` est GARDÉE à l'écriture (`canaux.ts`,
 * `garderReglagesIa`) : ce qui est relu ici a été vérifié avant d'être écrit —
 * une URL en http(s), un hôte de la liste ou du réseau local, ou un hôte que
 * l'UTILISATEUR a confirmé par la porte native. L'écriture l'admet aussitôt ;
 * cette lecture ne fait que le RÉTABLIR au lancement suivant, la liste du
 * réseau vivant en mémoire.
 */
async function admettreHoteOllama(reg: Reglages): Promise<void> {
	let ia: unknown;
	try {
		ia = await reg.lire(CLE_REGLAGES_IA);
	} catch (e) {
		console.warn(LOG_PREFIX, "réglages IA illisibles, hôte Ollama non admis:", e);
		return;
	}
	const url = ia && typeof ia === "object" ? (ia as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	if (typeof url !== "string" || !url) return;
	try {
		autoriserHote(new URL(url).hostname);
	} catch {
		console.warn(LOG_PREFIX, "aiOllamaUrl illisible, hôte non admis:", url);
	}
}

/* ─────────── le protocole des ressources ─────────── */

/**
 * Sert les images qu'un quiz affiche (`HostLinks.resourceUrl`, côté rendu
 * `apps/windows/src/host/links.ts`) — le remplaçant du protocole d'asset de
 * Tauri. La forme de l'URL et sa lecture vivent dans `./ressources.ts`, partagé
 * avec le rendu ; ici il n'y a que le branchement.
 *
 * BORNÉ PAR LE MÊME PÉRIMÈTRE QUE LES CANAUX `fichiers.*` (Ruling 13), et pas
 * par une liste à lui : une seconde liste blanche finirait par diverger de la
 * première, et c'est la porte que la tâche 3 a mis deux rondes à fermer. Une
 * URL hors des dossiers ouverts reçoit 403, sans que le chemin demandé ne
 * touche jamais le disque — `resoudreRessource` rend `null` avant.
 *
 * `net.fetch` sur une URL `file:` est le chemin que la documentation d'Electron
 * donne pour un `protocol.handle` qui sert des fichiers : il pose le type MIME
 * d'après l'extension et diffuse en flux (`stream: true` ci-dessous), sans
 * charger l'image entière en mémoire. Un fichier disparu entre la résolution
 * et la lecture rejette : 404, pas une exception qui remonterait au rendu.
 */
function servirRessources(perimetre: Perimetre): void {
	protocol.handle(SCHEMA_RESSOURCES, async (requete) => {
		const chemin = await resoudreRessource(perimetre, requete.url);
		if (!chemin) return new Response(null, { status: 403 });
		try {
			return await net.fetch(pathToFileURL(chemin).href);
		} catch (e) {
			console.warn(LOG_PREFIX, "ressource illisible:", chemin, e);
			return new Response(null, { status: 404 });
		}
	});
}

/* AVANT `app.ready`, et nulle part ailleurs : Electron refuse d'enregistrer
   des privilèges après. `standard` donne à l'URL un hôte et un chemin
   analysables (sans lui, `app://neo-res/D:/…` serait un chemin OPAQUE que
   `new URL` ne découpe pas) ; `secure` évite qu'une page chargée en `https`
   (ce n'est pas le cas aujourd'hui) traite ces images comme du contenu mixte ;
   `stream` laisse `net.fetch` diffuser le fichier au lieu de le lire entier.
   Ni `supportFetchAPI` ni `bypassCSP` : le rendu ne fait que des `<img src>`,
   et une surface qu'aucun appelant ne demande est une surface de trop. */
protocol.registerSchemesAsPrivileged([
	{ scheme: SCHEMA_RESSOURCES, privileges: { standard: true, secure: true, stream: true } },
	PRIVILEGES_CODE,
]);

/* ─────────── le démarrage ─────────── */

/* Le nom de l'application, POSÉ AVANT `getPath("userData")` : sans lui,
   Electron reprend le `name` de `package.json` — « @neo-quiz/windows », dont
   la barre oblique ferait du dossier de données un sous-dossier fantôme. */
app.setName(PRODUCT_NAME);

/**
 * LA LOCALE DE CHROMIUM, POSÉE DEPUIS LE RÉGLAGE DE LANGUE.
 *
 * LE DÉFAUT QUE ÇA CORRIGE : l'application traduite en anglais affichait ses
 * champs de date d'examen en « jj/mm/aaaa ». Le format d'un
 * `<input type="date">` n'est décidé NI par `t()`, NI par l'attribut `lang` de
 * la page : Chromium le tire de sa propre locale, celle du SYSTÈME par défaut.
 * Windows en français plus interface en anglais donnait donc un titre anglais
 * au-dessus d'un champ français, et rien dans la page Réglages ne pouvait le
 * changer — c'était le seul morceau d'interface que le réglage de langue
 * n'atteignait pas.
 *
 * SYNCHRONE, ET AVANT `app.ready` : un commutateur de ligne de commande n'est
 * lu qu'au démarrage de Chromium. Attendre la lecture asynchrone des réglages
 * (`creerReglages`, dans `whenReady`) serait trop tard. Le fichier fait
 * quelques centaines d'octets et n'est lu qu'ici, une fois : c'est le cas
 * exact où le synchrone est le bon outil.
 *
 * `auto` NE POSE RIEN : le mode automatique veut justement dire « suivre le
 * système », et le champ de date le suit déjà.
 *
 * TOUTE ERREUR EST IGNORÉE : fichier absent (premier lancement), illisible,
 * verrouillé par un antivirus. Le démarrage ne doit pas dépendre d'un confort
 * de format de date — `reglages.ts` relira le même fichier dans `whenReady`,
 * et c'est LUI qui traite ses erreurs pour de bon (mise de côté d'un JSON
 * corrompu).
 */
function poserLocaleChromium(): void {
	try {
		const brut = readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf-8");
		const langue = (JSON.parse(brut) as Record<string, unknown>)[CLE_REGLAGES_LANGUE];
		/* Des locales COMPLÈTES, région comprise : « en » seul laisse Chromium
		   choisir sa région et donc son format de date. `en-US` et `fr-FR` sont
		   les deux que les dictionnaires du dépôt servent (`src/i18n/`). */
		if (langue === "en") app.commandLine.appendSwitch("lang", "en-US");
		else if (langue === "fr") app.commandLine.appendSwitch("lang", "fr-FR");
	} catch {
		// Voir l'en-tête : le démarrage ne dépend pas de cette lecture.
	}
}

poserLocaleChromium();

/** LA FENÊTRE DE MISE À JOUR EST UN AUTRE PROGRAMME dans le même exécutable :
    ce lancement-là n'est pas l'application, n'ouvre aucun vault et ne touche
    aucun réglage. Il ne doit surtout pas prendre le verrou d'instance unique —
    c'est l'application RELANCÉE par NSIS qui en a besoin. */
function demarrerFenetreMaj(): void {
	const version = versionDepuisArguments(process.argv);
	const langue = langueDepuisArguments(process.argv);
	void app.whenReady()
		.then(() => afficherFenetreMaj(version, langue))
		.catch(erreur => console.error(LOG_PREFIX, "fenêtre de mise à jour:", erreur))
		.finally(() => app.quit());
}

/* UNE SEULE INSTANCE. `reglages.ts` tient sa table en mémoire et réécrit le
   fichier entier à chaque changement : deux instances écraseraient chacune
   les réglages de l'autre à tour de rôle, sans un mot. La seconde instance
   s'arrête et la première reprend le premier plan. */
if (process.argv.includes(DRAPEAU_FENETRE_MAJ)) {
	demarrerFenetreMaj();
} else if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!fenetre || fenetre.isDestroyed()) return;
		if (fenetre.isMinimized()) fenetre.restore();
		fenetre.focus();
	});

	void app.whenReady().then(async () => {
		/* La langue du PRINCIPAL, pour les seuls textes qu'il affiche lui-même :
		   les dialogues natifs (`canaux.ts`, `garderReglagesIa`). Même source que
		   la fenêtre : `app.getLocale()` est la locale de Chromium, celle que le
		   rendu lit par `navigator.language` (`src/host/platform.ts`). Le mode
		   « auto » de `src/i18n.ts` n'a ni hôte ni `navigator` ici — la langue
		   est posée EXPLICITEMENT — sauf si le réglage `language` en décide
		   autrement (page Réglages) : le principal suit le même réglage que
		   le rendu, sinon un dialogue natif parlerait une autre langue que la
		   fenêtre. Une valeur inconnue vaut « auto ». */
		/* LE `PATH` DU REGISTRE, fusionné dans celui de ce processus. À faire
		   AVANT toute recherche de CLI — c'est la vraie cause des « CLI
		   introuvable » : le `PATH` d'un processus est figé à son lancement, et
		   un installateur qui écrit dans le registre n'atteint jamais une
		   application déjà ouverte (ni celle que l'explorateur a lancée avec le
		   `PATH` de l'ouverture de session). Best effort : une lecture qui
		   échoue laisse le `PATH` du processus tel quel. */
		const ajoutsPath = await chargerPathRegistre();
		if (ajoutsPath) console.log(LOG_PREFIX, "PATH du registre :", ajoutsPath, "dossier(s) ajouté(s)");

		const donnees = app.getPath("userData");
		reglages = creerReglages(path.join(donnees, "settings.json"));
		const langueReglee = await reglages.lire(CLE_REGLAGES_LANGUE);
		setLanguage(langueReglee === "fr" || langueReglee === "en"
			? langueReglee
			: /^fr\b/i.test(app.getLocale()) ? "fr" : "en");
		/* Le dossier de quiz PAR DÉFAUT (tranche 9) : créé AVANT le périmètre,
		   pour qu'il existe déjà quand `perimetreInitial` l'autorise — sans quoi
		   la première ouverture d'un fichier dedans (« Nouveau quiz ») tomberait
		   sur un dossier absent.
		   GARDÉ (fix round 1) : un disque protégé (droits, quota, lecteur en
		   lecture seule) faisait sinon REJETER toute la chaîne `whenReady`, sans
		   qu'aucune fenêtre ne s'ouvre ni qu'aucun message ne le dise —
		   l'application semblait simplement ne pas démarrer. `perimetreInitial`
		   n'a pas besoin que ce dossier existe : `autoriser` ignore déjà en
		   silence un chemin absent (`perimetre.ts`), donc le démarrage continue
		   sans le défaut, sur les autres dossiers ouverts ou vide. */
		/* CELUI QUE L'UTILISATEUR A CHOISI, sinon celui qu'on calcule. Le
		   réglage est écrit par le seul canal `systeme.choisirDossierDefaut`,
		   depuis un chemin venu du dialogue natif — jamais du rendu (voir sa
		   documentation dans `pont.ts`). Une valeur qui n'est pas une chaîne
		   utile (clé absente, réglage trafiqué à la main) retombe sur le chemin
		   calculé plutôt que de faire démarrer l'application sans défaut. */
		const defautChoisi = await reglages.lire(CLE_DOSSIER_DEFAUT);
		dossierDefaut = typeof defautChoisi === "string" && defautChoisi.trim()
			? defautChoisi
			: cheminDossierDefaut(process.platform, os.homedir());
		try {
			await fs.mkdir(dossierDefaut, { recursive: true });
		} catch (e) {
			console.error(LOG_PREFIX, "dossier par défaut introuvable:", dossierDefaut, e);
			dialog.showErrorBox(PRODUCT_NAME, t("app.error.startup", {
				error: `${dossierDefaut}: ${e instanceof Error ? e.message : String(e)}`,
			}));
		}
		/* La liste blanche des dossiers que le pont a le droit de toucher — voir
		   `perimetre.ts` : le défaut d'ABORD, puis les réglages, puis le sélecteur
		   et les vaults d'Obsidian (`canaux.ts`). Le dossier de données est CRÉÉ
		   là-dedans mais JAMAIS autorisé (Ruling 12) : la raison est écrite sur
		   `perimetreInitial`. */
		const perimetre = await perimetreInitial({ dossierDonnees: donnees, reglages: reglagesOuErreur(), dossierDefaut });
		// Même geste que le périmètre, pour les URL : l'hôte Ollama des réglages.
		await admettreHoteOllama(reglagesOuErreur());
		// Le MÊME objet que les canaux : une racine admise par `choisirDossier`
		// ou `vaultsObsidian` devient aussitôt servable, sans second registre.
		servirRessources(perimetre);
		miseAJour = creerMiseAJour({
			envoyer: etat => {
				if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(CANAUX.miseAJourEtat, etat);
			},
		});
		/* The code sandbox (task 3, `./code-sandbox.ts`): a hidden window,
		   created here and closed with the main window (see `fenetre.on
		   ("closed", …)` above). `dist-electron/code` carries the files
		   served by `neo-code://app/<file>`, `code-preload.cjs` that
		   window's own sandboxed preload — two artefacts distinct from the
		   app window's. `userData/languages` is where a downloaded language
		   pack (task 9, `langages.ts`) lands, served under
		   `neo-code://app/languages/…` — ONE path, given to both the sandbox
		   and the install channels, so they can never look in two places. */
		const dossierLangages = path.join(app.getPath("userData"), "languages");
		code = creerBacASable(path.join(__dirname, "code"), dossierLangages, path.join(__dirname, "code-preload.cjs"));
		/* THE EMBEDDED SYNCTHING (task 6): Windows only. The binary is the
		   packaged one (`resources/syncthing/`) or, unpackaged, the vendored
		   one (`npm run fetch:syncthing`) — a path decided HERE, never from the
		   window. Its home is its own folder under the user data. Started at
		   launch only once sync was switched on (by a first pairing); the Sync
		   page starts it on demand before that. */
		if (process.platform === "win32") {
			sync = creerGestionSync({
				exe: app.isPackaged
					? path.join(process.resourcesPath, "syncthing", "syncthing.exe")
					: path.join(__dirname, "..", "vendor", "syncthing", "syncthing.exe"),
				home: path.join(donnees, "syncthing"),
				/* The shared folder is PINNED the first time (see `CLE_SYNC_ROOT`):
				   the default folder, which the window can change, is only read then. */
				racineParDefaut: () => dossierDefaut,
				lireRoot: async () => {
					const v = await reglagesOuErreur().lire(CLE_SYNC_ROOT);
					return typeof v === "string" && path.isAbsolute(v) ? v : null;
				},
				poserRoot: root => reglagesOuErreur().ecrire(CLE_SYNC_ROOT, root),
				/* Native, modal on the window, default Cancel: same pattern as the
				   Ollama host guard (`canaux.ts`, `garderReglagesIa`). */
				confirmer: async (id, nom) => {
					const options = {
						type: "warning" as const,
						title: t("app.syncPair.title"),
						message: t("app.syncPair.message"),
						/* The ID FIRST on its own labelled line, the announced name LAST with
						   its label: the name is the other device's and must never read as
						   part of the ID line (`nomSur` also strips line breaks from it). */
						detail: t("app.syncPair.detail", { id }) + (nom ? "\n" + t("app.syncPair.detailName", { name: nomSur(nom) }) : ""),
						buttons: [t("app.syncPair.allow"), t("app.syncPair.deny")],
						defaultId: 1,
						cancelId: 1,
					};
					const parent = fenetre && !fenetre.isDestroyed() ? fenetre : null;
					const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
					return response === 0;
				},
				lireActif: async () => (await reglagesOuErreur().lire(CLE_SYNC_ACTIF)) === true,
				poserActif: () => reglagesOuErreur().ecrire(CLE_SYNC_ACTIF, true),
			});
		}
		const canaux = enregistrerCanaux({
			perimetre,
			reglagesOuErreur,
			code,
			dossierLangages,
			/* LU À CHAQUE APPEL, jamais capturé : l'utilisateur peut changer ce
			   dossier en cours de session, et les canaux doivent servir le
			   nouveau dès l'instant où il est écrit. */
			dossierDefaut: () => dossierDefaut,
			poserDossierDefaut: abs => { dossierDefaut = abs; },
			envoyer(canal, charge) {
				if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, charge);
			},
			fenetreCourante: () => (fenetre && !fenetre.isDestroyed() ? fenetre : null),
			fermeture: {
				armer() { fermetureArmee = true; },
				terminee: terminerFermeture,
			},
			miseAJour,
			sync,
			fermerPourInstaller: () => fenetre?.close(),
			fenetre: {
				prete: () => {
					if (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;
					/* The app opens MAXIMIZED (2026-09-30), the work area
					   filled. Here and not at creation: `maximize()` also shows
					   the window, which must stay hidden until the renderer
					   says it is ready. */
					fenetre.maximize();
					fenetre.show();
					fenetre.focus();
				},
				reduire: () => fenetre?.minimize(),
				/* Windows refuse le premier plan à un processus qui n'a pas le
				   focus (verrou de SetForegroundWindow) : `focus()` seul ne fait
				   que clignoter dans la barre des tâches. Passer un instant en
				   « toujours au-dessus » est le détour admis — la fenêtre monte,
				   prend le focus, puis redevient une fenêtre ordinaire. */
				premierPlan: () => {
					if (!fenetre || fenetre.isDestroyed()) return;
					if (fenetre.isMinimized()) fenetre.restore();
					fenetre.show();
					fenetre.setAlwaysOnTop(true);
					fenetre.focus();
					fenetre.moveTop();
					fenetre.setAlwaysOnTop(false);
					fenetre.flashFrame(false);
				},
				agrandirOuRestaurer: () => {
					if (!fenetre) return;
					if (fenetre.isMaximized()) fenetre.unmaximize();
					else fenetre.maximize();
				},
				// LE MÊME chemin que la croix native : la fermeture attendue
				// (armement, délai de garde) reste garantie.
				fermer: () => fenetre?.close(),
				pleinEcran: () => fenetre?.setFullScreen(!fenetre.isFullScreen()),
				etat: etatFenetre,
				zoom: f => fenetre?.webContents.setZoomFactor(f),
				recharger: () => fenetre?.webContents.reload(),
				outilsDev: () => fenetre?.webContents.toggleDevTools(),
			},
		});
		arreterAttente = canaux.arreterAttente;
		creerFenetre();
		/* APRÈS la fenêtre, comme le surveillant des notes : le menu des
		   modèles se redessine dès que Claude Code ou Codex réécrit ses
		   fichiers de modèles (voir `surveillerCachesCli`). Vit autant que
		   l'application ; la fenêtre absente, l'avis se perd sans dommage. */
		surveillerCachesCli(tool => {
			if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(CANAUX.processusCachesCli, tool);
		});
		/* Le témoin que la fenêtre de mise à jour attend pour s'effacer, puis
		   les reflets qu'une mise à jour passée a laissés : après elle, ces
		   liens sont la seule référence aux fichiers de l'ANCIENNE version et
		   pèsent son poids entier. Ni l'un ni l'autre ne doit retarder la
		   fenêtre, d'où l'absence d'`await`. */
		void marquerDemarrage();
		void nettoyerLiensMaj();
		// APRÈS la fenêtre : une erreur réseau au démarrage ne doit rien
		// retarder. Sans argument — la mise à jour automatique ne se règle
		// plus, elle est le seul mode (voir `mise-a-jour-etat.ts`).
		miseAJour.initialiser();
		/* After the window, like the other background work: a slow start of
		   Syncthing must never delay it. A failure is logged, never fatal. */
		void sync?.demarrerSiActif().catch(e => console.warn(LOG_PREFIX, "sync unavailable:", e));
	}).catch(e => {
		/* Le FILET FINAL (fix round 1) : sans lui, une exception n'importe où
		   dans cette chaîne (réglages, périmètre, réseau, fenêtre) rejette une
		   promesse que personne n'attend — Electron l'avale, aucune fenêtre ne
		   s'ouvre, et rien ne le dit. `setLanguage` a pu échouer avant d'avoir
		   tourné : pas de `t()` garanti, d'où le texte anglais brut. */
		console.error(LOG_PREFIX, "démarrage impossible:", e);
		dialog.showErrorBox(PRODUCT_NAME, `Neo Quiz failed to start: ${e instanceof Error ? e.message : String(e)}`);
	});
}

/* Une seule fenêtre, et Windows pour seule plateforme à cette tranche : sa
   fermeture est la fin de l'application, sauf si une installation a été
   armée : c'est alors `quitAndInstall` qui quitte, après avoir lancé
   l'installeur silencieux ; l'application se relance seule. */
app.on("window-all-closed", () => {
	if (!miseAJour?.installationArmee()) {
		app.quit();
		return;
	}
	/* LA FENÊTRE D'ABORD, l'installation ENSUITE : `installerArmee` ne revient
	   pas, et NSIS tue aussitôt ce processus. Lancer la fenêtre après serait
	   lancer du code qui ne s'exécute jamais.

	   Si le reflet échoue (voir `fenetre-maj.ts` : volume différent, temporaire
	   inaccessible), on installe quand même, en silence comme avant. Une mise à
	   jour sans fenêtre vaut mieux qu'une mise à jour empêchée. */
	const armee = miseAJour;
	/* Syncthing is stopped BEFORE the installer runs: a running
	   `resources/syncthing/syncthing.exe` would keep the installer from
	   replacing the install folder. */
	const arretSync = sync ? sync.arreter().catch(() => undefined) : Promise.resolve();
	void Promise.all([lancerFenetreMaj(armee.etat().version ?? "", currentLang()), arretSync]).finally(() => armee.installerArmee());
});
/* Any other way out: stop the embedded Syncthing first (it asks the process to
   shut down, then kills it after a few seconds), THEN quit for real. Without
   it, the child would outlive the app and keep the install folder locked. */
let syncArrete = false;
app.on("before-quit", e => {
	if (!sync || syncArrete) return;
	e.preventDefault();
	syncArrete = true;
	void sync.arreter().catch(() => undefined).finally(() => app.quit());
});
app.on("browser-window-focus", () => miseAJour?.surFocus());
