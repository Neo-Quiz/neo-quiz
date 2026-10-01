/* ══════════════════════════════════════════════════════════
   LE PONT — LE SEUL PASSAGE ENTRE LA FENÊTRE ET LE DISQUE

   Tâche 3 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce module ne
   contient QUE des types et des noms de canaux : il est importé par les trois
   contextes (le processus principal, le préchargement, le rendu), et un seul
   d'entre eux a le droit de toucher Node.

   POURQUOI UN PONT ET PAS `nodeIntegration`. La fenêtre rend du HTML qui n'est
   PAS toujours celui de l'utilisateur : un quiz PARTAGÉ arrive avec les
   `explainHtml` de son auteur (voir `CLAUDE.md`, « Texte et HTML d'un quiz :
   quatre portes »). Avec `nodeIntegration`, une faille du rendu — une porte
   oubliée, une balise que la liste blanche laisse passer — donnerait un accès
   complet à la machine. Le rendu n'obtient donc QUE les méthodes ci-dessous,
   jamais `ipcRenderer` nu : exposer `ipcRenderer` rendrait atteignable
   n'importe quel canal, y compris ceux d'Electron lui-même, et annulerait
   l'isolation qu'on vient de payer.

   RÈGLE DE CHEMINS, et elle n'a qu'une exception. Le pont ne parle que de
   chemins ABSOLUS du disque. Les chemins du CONTRAT (« Efrei/Cours/ch1.md »,
   qui sont les clés du journal de révision) restent l'affaire du rendu, où
   vit `CarteRacines` (`apps/windows/src/host/roots.ts`). C'est délibéré :
   `src/host/types.ts` (`HostPaths.localPath`) avertit qu'un hôte qui
   recomposerait ces clés AILLEURS ferait diverger deux historiques sans que
   personne ne le voie. Un second vocabulaire de chemins traversant l'IPC
   serait exactement ce second endroit. L'index du processus principal
   (`index-fichiers.ts`) porte bien, lui, une convention interne à préfixe
   numérique — elle ne franchit jamais le pont, `main.ts` la retraduit en
   absolu avant d'émettre.

   TOUT EST ASYNCHRONE, sans exception : chaque appel traverse l'IPC. C'est la
   contrainte qui a décidé la forme de `liste()` et de `surveiller()` — voir
   plus bas.

   ET TOUT CHEMIN EST BORNÉ. Un chemin absolu n'est pas un droit : chaque canal
   `fichiers.*` (et `systeme.ouvrir`) REJETTE tout chemin qui ne tombe pas sous
   un dossier du PÉRIMÈTRE (`./perimetre.ts`) — les dossiers retenus dans les
   réglages, ceux que le sélecteur natif a désignés, et les vaults qu'Obsidian
   déclare. JAMAIS le dossier de données de l'application : il porte
   `settings.json`, dont la clé `folders` nourrit ce périmètre au prochain
   démarrage — l'y admettre permettrait de l'écrire en brut. C'est ce que Tauri
   faisait avec `allow_folder` et la portée vide de `plugin-fs` ; sans lui, une
   porte oubliée du sanitizer deviendrait `write("…/Startup/x.bat")`. Le rendu
   ne peut PAS élargir ce périmètre : `demarrer` filtre ses racines contre lui,
   et la clé `folders` des réglages est gardée à l'écriture.
══════════════════════════════════════════════════════════ */

import type { AncreTerminal, EtatCompte, HostNetRequest, HostNetResponse, HostProcess, CodeJob, CodeRun } from "../../../src/host/types";
import type { CodeLanguage } from "../../../src/code-languages";
import type { UsageRead } from "../../../src/dashboard/usage-format";
import type { EtatSync } from "../../../src/dashboard/sync-etat";
export type { EtatSync } from "../../../src/dashboard/sync-etat";
export type { EtatMiseAJour, PhaseMiseAJour } from "./mise-a-jour-etat";
import type { EtatMiseAJour } from "./mise-a-jour-etat";
/* Le type des NOMS d'outils que le principal accepte de lancer/installer.
   `import type` seulement : ce module reste sans Node (`check:host`,
   assertion 6), et `Outil` n'est qu'une union de littéraux. */
import type { Outil } from "./process";
/* Les types de la lecture d'une vidéo, dérivés des modules du principal —
   `import type` seulement, comme `Outil` : un champ ajouté là-bas doit
   faire rougir la compilation ici. */
import type { CodeErreurVideo, ResultatVideo } from "./video";
import type { InfosInstallation } from "./video-installation";
import type { CodeInstallation } from "./telechargement";

/** Une requête réseau telle qu'elle TRAVERSE le pont : `HostNetRequest` sans
    son `signal`. Un `AbortSignal` ne se clone pas (l'IPC sérialise par clonage
    structuré, et `invoke` rejetterait) ; l'annulation voyage à part, par un
    identifiant — voir `Pont.reseau`. */
export type RequeteReseau = Omit<HostNetRequest, "signal">;

/** Un appel de CLI tel qu'il TRAVERSE le pont : la spec de `HostProcess.run`
    sans son `signal`, pour exactement la même raison que `RequeteReseau`.
    DÉRIVÉE du contrat, jamais recopiée : un champ ajouté là-bas (les pièces
    jointes de la tâche 4 en sont un) doit faire rougir la compilation ici. */
export type RequeteCli = Omit<Parameters<HostProcess["run"]>[0], "signal">;

/**
 * Ce que le canal `process.run` REND — une ENVELOPPE, jamais un rejet.
 *
 * POURQUOI, et ce n'est pas un goût : l'IPC d'Electron sérialise une erreur
 * jetée par un gestionnaire en message + pile, et PERD son `name`. Or tout le
 * contrat de `HostProcess.run` tient dans ce nom (`introuvable`, `timeout`,
 * `annule`, `refuse`, `occupe`, `indisponible`) : c'est lui, et lui seul, que
 * `ai-client.ts` traduit en « Claude Code n'est pas installé » ou « délai
 * dépassé ». Jeté, chaque échec serait arrivé côté fenêtre sous le nom
 * « Error » — donc traité comme une réponse illisible du modèle. L'enveloppe
 * fait voyager le nom comme une DONNÉE, et l'hôte du rendu le reconstruit
 * (`apps/windows/src/host/process.ts`).
 */
export type ResultatCli =
	| { ok: true; stdout: string; stderr: string; code: number | null; sortie?: string }
	| { ok: false; nom: string; message: string };

/** Ce que les canaux `video.transcrire` et `video.installer` RENDENT —
    une ENVELOPPE, jamais un rejet, pour la même raison que `ResultatCli` :
    l'IPC d'Electron sérialise une erreur jetée en message + pile et PERD
    son `name`. Or tout le jugement de l'appelant tient dans ce code
    (`absent`, `reseau`, `delai`, `annule`… ; `empreinte`, `reseau`). Le
    message brut, lui, n'est pas traduit : seuls le code et le `detail` de
    journal traversent, et l'hôte du rendu reconstruit une erreur typée
    (`apps/windows/src/host/video.ts`). */
export type EnveloppeVideo<Valeur, Code extends string> =
	| { ok: true; valeur: Valeur }
	| { ok: false; code: Code; detail?: string };

/** L'état de la fenêtre, poussé par le principal — voir `Pont.fenetre.surEtat`. */
export interface EtatFenetre {
	agrandie: boolean;
	focus: boolean;
	pleinEcran: boolean;
}

/** Un vault Obsidian connu de la machine (remplace la commande Rust
    `obsidian_vaults`). */
export interface VaultConnu {
	chemin: string;
	nom: string;
}

/** Un fichier trouvé par le parcours d'une racine. `chemin` est ABSOLU. */
export interface EntreeDisque {
	chemin: string;
	/** Date de modification, ms depuis l'époque. `0` quand elle n'a pas été
	    demandée — voir `Pont.fichiers.liste`. */
	mtime: number;
}

/**
 * Un changement observé sur le DISQUE, en chemins absolus.
 *
 * Ce n'est PAS `HostFileEvent` (`src/host/types.ts`), et c'est volontaire :
 * `HostFile.path` est un chemin du CONTRAT, que le processus principal n'a pas
 * le droit de composer (voir l'en-tête). Le rendu traduit les trois premiers
 * genres en `HostFileEvent` avec `CarteRacines.depuisAbsolu`, comme il le fait
 * déjà aujourd'hui dans `reconcilier`.
 *
 * PAS de `rename` de FICHIER : l'index du processus principal n'en émet pas
 * (chokidar remonte `add`/`change`/`unlink`, jamais une paire appariée).
 * L'appariement d'un renommage de FICHIER vit côté rendu, dans
 * `createRenameDetector` (`src/review/rename-match.ts`), déjà branché côté
 * application — l'inventer ici en ferait une seconde règle d'appariement.
 *
 * `renameDir` EST présent, et c'est tâche 5 : un renommage de DOSSIER,
 * contrairement à un fichier, ne peut PAS se réconcilier après coup par un
 * `create`+`delete` — c'est le PRÉFIXE que le journal de révision doit
 * déplacer, et lui seul dit ce préfixe. L'appariement `unlinkDir`/`addDir` est
 * donc fait ICI, côté principal (`electron/catalogue.ts`,
 * `evenementDeRenommageDossier`, PURE, plus la fenêtre de débounce
 * d'`index-fichiers.ts`) — pas une seconde règle, la SEULE : il n'y a pas
 * d'équivalent rendu pour les dossiers, à la différence des fichiers.
 */
export type EvenementDisque =
	| { kind: "create"; abs: string; mtime: number }
	| { kind: "modify"; abs: string; mtime: number }
	| { kind: "delete"; abs: string }
	| { kind: "renameDir"; fromAbs: string; toAbs: string };

/**
 * Ce que la fenêtre peut demander au processus principal.
 *
 * Les noms reprennent ceux de `HostFs` (`src/host/types.ts`) partout où c'est
 * la même opération, pour que l'hôte du rendu (tâche 4) soit un passe-plat
 * lisible plutôt qu'un traducteur.
 */
export interface Pont {
	/**
	 * Déclare les racines ouvertes (chemins ABSOLUS), dans l'ordre où le rendu
	 * les tient. Le processus principal y monte son index et son surveillant.
	 *
	 * À appeler AVANT `surveiller()` et `liste()`. Idempotente au sens où un
	 * second appel remplace les racines : le rendu recharge la fenêtre quand
	 * elles changent (`main.ts`, `choisirDossier`), il n'appelle donc jamais
	 * ceci deux fois dans la même vie de page.
	 *
	 * FILTRÉE, pas crue : une racine hors périmètre est IGNORÉE (et nommée dans
	 * la console du principal). Le rendu ne définit jamais ce qu'il a le droit
	 * de lire — voir l'en-tête.
	 */
	demarrer(racines: string[]): Promise<void>;

	fichiers: {
		read(abs: string): Promise<string>;
		/** Pas de cache : le processus principal n'en a pas — voir
		    `fichiers.ts`. Présente pour que l'hôte du rendu ait la méthode que
		    le contrat nomme, sans inventer d'alias. */
		readCached(abs: string): Promise<string>;
		/** Des OCTETS, pour `HostFs.externe.readBinary` (une image jointe hors
		    vault). BORNÉ comme `read` : une racine externe n'entre au périmètre
		    que par les réglages, le sélecteur ou les vaults d'Obsidian. */
		readBinary(abs: string): Promise<Uint8Array>;

		/* ─── LES QUATRE ÉCRITURES RENDENT LE `mtime` NEUF ───

		   `Promise<{ mtime }>` et jamais `Promise<void>` : c'est la seule façon
		   de tenir « LA FRAÎCHEUR APRÈS UNE ÉCRITURE » (`src/host/types.ts`) à
		   travers l'IPC. Le contrat promet qu'au retour de `write`, `process`,
		   `writeBinary` ou `append`, `getFile(path)` rend le `mtime` que
		   l'écriture vient de produire. Or `getFile` est SYNCHRONE et lit le
		   MIROIR du rendu (voir `liste` ci-dessous) : attendre que le
		   surveillant — débouncé de 300 ms — apprenne le changement au rendu
		   rendrait un `mtime` PÉRIMÉ pendant toute cette fenêtre. C'est
		   exactement le défaut mesuré le 2026-09-10 (6000 d'un côté, 1000 de
		   l'autre) qui faisait afficher une Notice « note modifiée dehors »
		   MENSONGÈRE après chaque sauvegarde. Le rendu applique donc ce `mtime`
		   à son miroir AVANT de résoudre l'écriture. */

		write(abs: string, contenu: string): Promise<{ mtime: number }>;
		writeBinary(abs: string, data: Uint8Array): Promise<{ mtime: number }>;
		append(abs: string, contenu: string): Promise<{ mtime: number }>;

		/* ─── `process`, EN DEUX TEMPS ───

		   Le plan de migration décrivait `process(abs, rappelId)`. C'est
		   impossible, et la note qui suivait ce type dans le plan le disait
		   elle-même : LE RAPPEL NE TRAVERSE PAS L'IPC. Il vit dans le rendu (il
		   ferme sur l'état de la page) ; la lecture et l'écriture vivent dans
		   le principal. Un identifiant de rappel ne changerait rien à cela —
		   il faudrait que le principal rappelle le rendu au milieu de son
		   propre appel, et attende sa réponse : une inversion de sens qui
		   rendrait le verrou du principal dépendant d'un rendu qui peut être
		   occupé, figé, ou déjà parti.

		   D'où les deux moitiés ci-dessous. Le rendu lit, applique son rappel,
		   puis demande une écriture CONDITIONNÉE au contenu qu'il a lu. Si le
		   fichier a changé entre les deux, l'écriture est REFUSÉE (`null`) et
		   le rendu REJOUE son rappel sur le contenu neuf. C'est précisément ce
		   que le contrat autorise : « Le rappel peut être REJOUÉ : il doit
		   repartir de zéro à chaque invocation… C'est la DERNIÈRE invocation
		   qui fait foi » (`src/host/types.ts`, `HostFs.process`) — et
		   `detail-io.ts`, son appelant le plus exigeant, en dépend déjà (son
		   drapeau `ecrit` est remis à faux en tête de rappel).

		   La comparaison porte sur le CONTENU et non sur le `mtime` : la
		   granularité d'un `mtime` peut valoir plusieurs millisecondes selon le
		   système de fichiers, et deux écritures rapprochées y seraient
		   indistinguables. */

		/** Le contenu ACTUEL, à passer tel quel à `ecrireSiInchange`. Rejette
		    si le fichier est absent — comme `HostFs.process`. */
		lirePourEcriture(abs: string): Promise<{ contenu: string; mtime: number }>;
		/** Écrit SI le fichier contient toujours `contenuLu`. Rend `null` quand
		    il a changé : l'appelant doit relire et rejouer son rappel. */
		ecrireSiInchange(
			abs: string,
			contenuLu: string,
			contenu: string,
		): Promise<{ mtime: number } | null>;

		exists(abs: string): Promise<boolean>;
		mkdirs(abs: string): Promise<void>;
		/** Déplace vers `<racine>/.trash/…`. `racine` est explicite : le
		    principal ne connaît pas la notion de racines multiples, elle vit
		    dans `CarteRacines` côté rendu. Elle doit ÊTRE une racine du
		    périmètre (pas seulement y tomber), et `abs` doit être sous elle :
		    sinon `path.relative` fabriquerait un `../../…` et le déplacement
		    irait n'importe où. */
		trash(abs: string, racine: string): Promise<void>;
		/** Les FICHIERS d'un dossier, sans descendre. Un dossier absent rend
		    `[]`. */
		list(dossier: string): Promise<string[]>;
		remove(abs: string): Promise<void>;
		/** REJETTE si la destination existe : la migration du journal de
		    révision s'en sert pour ne jamais écraser une sauvegarde. */
		rename(de: string, vers: string): Promise<void>;
		/** Date de modification, ou `null` si absent ou si c'est un dossier.
		    N'est PAS une méthode du contrat `HostFs` — elle sert au rendu à
		    recaler son miroir sur un chemin précis. */
		stat(abs: string): Promise<{ mtime: number } | null>;
		/** Fichier OU dossier, avec sa date : `HostFs.externe.stat`. Distinct
		    de `stat`, qui rend `null` pour un dossier — or c'est le `mtime` de
		    la RACINE externe (un dossier) qui invalide son index. `null` si
		    absent ; et REJETTE hors périmètre comme tout canal `fichiers.*`,
		    l'hôte du rendu traduit ce rejet en `null`. */
		statEntree(abs: string): Promise<{ isFile: boolean; mtimeMs: number } | null>;
		/** TOUTES les entrées d'un dossier, avec leur type, sans descendre —
		    `HostFs.listDir` (navigation « @Cours/ ») et `HostFs.externe.list`
		    (les racines externes). Le NOM seul : le rendu recompose le chemin,
		    contrat ou absolu, il est le seul à le savoir (règle de chemins de
		    l'en-tête). Un dossier absent rend `[]` ; hors périmètre, REJETTE —
		    c'est ce qui fait qu'une racine externe non ouverte n'est jamais
		    lue, et l'hôte du rendu en fait `[]`. */
		listerDossier(dossier: string): Promise<Array<{ name: string; isFolder: boolean }>>;

		/**
		 * TOUS les fichiers d'une racine, récursivement, pour HYDRATER le
		 * miroir du rendu au démarrage.
		 *
		 * C'EST LE TROU QUE LE PLAN NE VOYAIT PAS. `HostFs.listMarkdown()`,
		 * `findByName()` et `getFile()` sont SYNCHRONES, et le contrat écrit
		 * pourquoi : « le scanner et le sanitizer les appellent en plein rendu,
		 * où une promesse imposerait de tout rendre asynchrone »
		 * (`src/host/types.ts`). AUCUNE méthode de ce pont ne peut les servir —
		 * l'IPC est asynchrone par construction. La conception retenue :
		 *
		 *   - le processus PRINCIPAL garde l'index d'AUTORITÉ (c'est lui qui a
		 *     le surveillant et qui fait les écritures) ;
		 *   - le RENDU tient un MIROIR en mémoire, hydraté une fois par cette
		 *     méthode, puis tenu à jour par les événements que le principal
		 *     POUSSE (`surveiller`) et par le `mtime` que chaque écriture rend ;
		 *   - les trois méthodes synchrones du contrat lisent ce miroir.
		 *
		 * Ce n'est pas une invention : `buildIndex` et `apply` vivent DÉJÀ côté
		 * rendu dans l'hôte Tauri (`apps/windows/src/host/fs.ts`). La frontière
		 * se déplace, pas l'architecture.
		 *
		 * Un PARCOURS DU DISQUE et non une lecture de l'index du principal :
		 * celui-ci se peuple au fil du parcours initial de chokidar, donc il
		 * est INCOMPLET tant que ce parcours n'est pas fini, et rien n'en
		 * signale la fin. Le rendu montrerait alors un catalogue vide au
		 * démarrage, qui se remplirait sous les yeux de l'utilisateur.
		 *
		 * Les dossiers ignorés (cachés, `node_modules`) ne sont pas parcourus,
		 * et `mtime` n'est relevé que pour les `.md` — un `stat` par fichier
		 * coûterait un aller-retour disque pour chaque image d'un dossier de
		 * cours, alors que seul le catalogue de quiz s'en sert (tri
		 * « récents »). Les autres gardent `mtime: 0`, ce que `HostFile`
		 * autorise explicitement.
		 */
		liste(racine: string): Promise<EntreeDisque[]>;
	};

	/**
	 * S'abonne aux changements de TOUTES les racines déclarées par `demarrer`.
	 * Rend le désabonnement.
	 *
	 * ON HYDRATE (`liste`) D'ABORD, ON S'ABONNE ENSUITE, depuis
	 * perf-demarrage-surveillant — l'ordre inverse d'avant cette branche. Le
	 * crawl initial du surveillant part avec `ignoreInitial: false`
	 * (`index-fichiers.ts`) : il RE-ANNONCE donc chaque fichier déjà trouvé
	 * par `liste`, une réconciliation complète et non une simple écoute ; un
	 * fichier modifié entre l'hydratation et cet abonnement revient avec un
	 * `mtime` différent de celui que `liste` a posé, et ressort en `modify`
	 * plutôt que d'être perdu. L'explication complète, y compris ce que cet
	 * ordre perd malgré tout, vit dans `apps/windows/src/host/fs.ts`
	 * (`createWindowsIndex`, `demarrerSurveillance`), le seul appelant de
	 * cette méthode.
	 */
	surveiller(onEvenement: (ev: EvenementDisque) => void): Promise<() => void>;

	dialogue: {
		/** Le sélecteur natif. `null` si l'utilisateur annule — ce n'est pas une
		    erreur, c'est la réponse « non ». */
		choisirDossier(): Promise<string | null>;
	};

	/**
	 * Les réglages de l'application (remplace `@tauri-apps/plugin-store`).
	 *
	 * PAS de `save()` : chaque écriture touche le disque immédiatement. Le
	 * magasin Tauri était débouncé et demandait un `save()` explicite qu'on
	 * pouvait oublier — un réglage perdu sans le moindre message.
	 */
	reglages: {
		lire(cle: string): Promise<unknown>;
		ecrire(cle: string, valeur: unknown): Promise<void>;
		/** RETIRE la clé. Nécessaire, et pas par symétrie : la conversion de
		    l'ancienne clé `folder` au singulier (`host/folder.ts`) l'efface
		    après l'avoir lue — sans quoi elle serait relue à chaque démarrage
		    et les deux clés finiraient par diverger. Écrire `undefined` ne
		    suffirait pas : JSON ne le sérialise pas. */
		supprimer(cle: string): Promise<void>;
	};

	/** Partager un quiz (.md) ou un dossier (.zip) — voir `./partage.ts`. La
	    fenêtre ne donne qu'un NOM et des OCTETS : l'emplacement vient du
	    dialogue natif, le chemin temporaire et le script du principal. */
	partage: {
		/** Le dialogue « Enregistrer sous » (Téléchargements par défaut), puis
		    le fichier montré dans l'explorateur. Rend son chemin, `null` si
		    l'utilisateur a annulé. */
		enregistrer(nom: string, octets: Uint8Array): Promise<string | null>;
		/** Windows : le FICHIER copié dans le presse-papiers, Discord au
		    premier plan (l'utilisateur colle). `false` si rien n'est parti. */
		discord(nom: string, octets: Uint8Array): Promise<boolean>;
	};

	/**
	 * THE SYNC of the quiz folder (embedded Syncthing, `./syncthing.ts`). Absent
	 * where there is no embedded binary (Linux): the Sync page is then not
	 * offered. The window reaches THREE verbs and two pushes, nothing more:
	 * never a folder, a path, a port, the API key or any REST call. A device id
	 * is validated in the main process before it reaches a config.
	 */
	sync?: {
		/** The state; also what starts the embedded Syncthing the first time
		    the Sync page asks (the page cannot show this device's id otherwise). */
		etat(): Promise<EtatSync>;
		/** Pairs a device by its id. `invalide`: not an id (format or check
		    characters), or our own. `indisponible`: Syncthing is not running.
		    `annule`: the owner declined the native confirmation shown first. */
		appairer(deviceId: string): Promise<"ok" | "invalide" | "indisponible" | "annule">;
		oublier(deviceId: string): Promise<void>;
		surEtat(rappel: (etat: EtatSync) => void): () => void;
		/** Another device's changes to the folder have landed (idle after
		    remote items): time to reload what is read from the folder. */
		surDonneesRecues(rappel: () => void): () => void;
		/** Android only (a camera): opens the scanner and resolves with the
		    text of the QR code read (a candidate device id, validated by
		    `appairer`), or `null` if the user gave up. Absent on Windows. */
		scanner?(): Promise<string | null>;
	};

	systeme: {
		/** Ouvre le fichier avec l'application par défaut du système. Rend
		    `false` si le système a refusé : `HostShell.openExternal` rend un
		    booléen dont `engine/resources.ts` se sert pour prévenir
		    l'utilisateur, et un `void` obligerait l'hôte à inventer un `true`
		    qui mentirait. */
		ouvrir(abs: string): Promise<boolean>;
		/** Écrit du TEXTE dans le presse-papiers. Par le principal et non par
		    `navigator.clipboard` : dans la fenêtre, `writeText` fait demander la
		    permission `clipboard-read` (mesuré le 2026-09-17), que le gardien de
		    `main.ts` refuse avec toutes les autres — et l'autoriser pour pouvoir
		    ÉCRIRE donnerait à la page le droit de LIRE le presse-papiers.
		    N'expose aucune lecture : le rendu écrit, il ne relit jamais. */
		copierTexte(texte: string): Promise<void>;
		/** Les vaults qu'Obsidian connaît. Une liste vide est un état NORMAL
		    (Obsidian absent de la machine), pas une erreur. */
		vaultsObsidian(): Promise<VaultConnu[]>;
		/** Le chemin absolu du dossier de quiz par défaut (`C:/Neo Quiz`,
		    tranche 9), déjà créé et autorisé au périmètre au démarrage. Sans
		    argument : ce chemin n'est jamais choisi par le rendu, seulement
		    lu — voir `electron/dossier-defaut.ts`. */
		dossierDefaut(): Promise<string>;
		/**
		 * CHANGE le dossier de quiz par défaut, et rend son nouveau chemin —
		 * `null` si l'utilisateur a annulé.
		 *
		 * SANS ARGUMENT, ET C'EST LA GARDE ELLE-MÊME : le chemin vient du
		 * dialogue natif, donc de l'utilisateur, jamais du rendu. Ce réglage
		 * nourrit le périmètre au démarrage suivant (`perimetreInitial`) —
		 * accepter un chemin de la fenêtre reviendrait à lui laisser choisir ce
		 * que l'application pourra lire et écrire à la session d'après, ce que
		 * `verifierDossiers` refuse déjà pour la clé `folders`.
		 *
		 * Le principal crée le dossier s'il manque, l'admet au périmètre, écrit
		 * le réglage et met sa propre valeur à jour dans la foulée : après cet
		 * appel, `dossierDefaut()` rend déjà le nouveau chemin.
		 */
		choisirDossierDefaut(): Promise<string | null>;
		/**
		 * Le dialogue natif de FICHIERS (« Add files » du composer). Les
		 * filtres sont composés dans le PRINCIPAL depuis une union fermée —
		 * le rendu ne les choisit pas plus qu'il ne choisit un chemin.
		 * Chaque chemin rendu a été admis au PÉRIMÈTRE en lecture et
		 * ouverture seulement (`perimetre.autoriserFichier`), jamais en
		 * écriture : voir `./perimetre.ts`. `[]` si l'utilisateur annule.
		 */
		choisirFichiers(kind: "documents" | "images" | "any"): Promise<string[]>;
		/**
		 * RELANCE l'application — le processus entier, pas la seule fenêtre.
		 *
		 * UN SEUL APPELANT, ET UNE SEULE RAISON : le changement de langue.
		 * La locale de Chromium se pose par un commutateur de ligne de commande,
		 * lu une fois avant `app.ready` (`main.ts`, `poserLocaleChromium`) —
		 * c'est elle, et non l'attribut `lang` de la page, qui décide du format
		 * des champs `<input type="date">`. Un `location.reload()` retraduit
		 * donc toute l'interface mais laisse le sélecteur de date dans l'ancienne
		 * locale : « Exam dates » au-dessus d'un champ qui dit « jj/mm/aaaa ».
		 *
		 * SANS ARGUMENT, et c'est ce qui la rend sûre : le rendu ne choisit ni
		 * exécutable ni argument de relance (`app.relaunch()` réutilise les
		 * siens). Le pire qu'un rendu compromis en tire est de faire redémarrer
		 * l'application — bruyant, et sans aucun gain.
		 *
		 * La promesse ne se résout JAMAIS dans le cas courant : l'application
		 * s'arrête avant de répondre. L'appelant ne doit rien enchaîner après.
		 * La fermeture passe par `app.quit()`, donc par le `close` de la fenêtre
		 * et son délai de garde — une écriture en attente est vidée d'abord.
		 */
		relancer(): Promise<void>;
	};

	/**
	 * LE RÉSEAU, tout entier : `HostNet` (`src/host/types.ts`) vu du rendu.
	 *
	 * Une seule porte, dans le PRINCIPAL, derrière une liste d'hôtes
	 * (`./reseau.ts`) : un rendu compromis ne peut pas faire de l'application
	 * un relais vers n'importe où — c'est la même règle que le périmètre pour
	 * les chemins, appliquée aux URL. Le principal ne rend `null` que sur un
	 * échec RÉSEAU (hôte refusé, injoignable, annulé) ; un statut d'erreur
	 * HTTP est rendu avec son corps.
	 *
	 * `requeteId` : le `signal` de `HostNetRequest` ne traverse pas l'IPC. Le
	 * rendu choisit un identifiant, l'envoie avec la requête, et c'est
	 * `annuler(requeteId)` qui relaie l'abandon — le principal tient un
	 * `AbortController` par identifiant tant que la requête vit
	 * (`canaux.ts`). Un identifiant inconnu (requête déjà finie) est ignoré :
	 * annuler ce qui est terminé n'est pas une erreur.
	 */
	reseau: {
		fetch(req: RequeteReseau, requeteId: number): Promise<HostNetResponse | null>;
		annuler(requeteId: number): Promise<void>;
	};

	/**
	 * LES CLI ET LEURS FICHIERS : `HostProcess` (`src/host/types.ts`) vu du
	 * rendu.
	 *
	 * `run` LANCE UN PROGRAMME — la capacité la plus dangereuse de ce pont. Ce
	 * qui traverse est un NOM d'outil, jamais un chemin : `canaux.ts` refuse
	 * tout nom hors d'`OUTILS` (`process.ts`) AVANT toute autre chose, et le
	 * chemin de l'exécutable est résolu par le PRINCIPAL — réglage
	 * `cheminClaude`/`cheminCodex` lu dans SON magasin (jamais pris de cet
	 * appel), sinon le `PATH` étendu. Un rendu compromis ne peut donc pas
	 * choisir le programme lancé, seulement lequel des trois CLI connus part.
	 *
	 * `requeteId` : le `signal` de `HostProcess.run` ne traverse pas l'IPC —
	 * même patron qu'au réseau. Le rendu choisit un identifiant, l'envoie avec
	 * l'appel, et `annuler(requeteId)` relaie l'abandon ; le principal tient un
	 * `AbortController` par identifiant tant que le CLI vit, et l'abandon tue
	 * l'ARBRE de process (`claude` et `codex` spawnent des enfants). Un
	 * identifiant inconnu (appel déjà fini) est ignoré.
	 *
	 * `lireCache` prend un NOM D'OUTIL, jamais un chemin, et c'est toute la
	 * sûreté de ce canal : les chemins (`$CODEX_HOME/models_cache.json`,
	 * `~/.claude.json`) sont FIXES et connus du seul principal
	 * (`./process.ts`). Un chemin venu du rendu ferait de ce canal une lecture
	 * disque hors périmètre — le canal REFUSE donc tout nom hors de
	 * « claude » / « codex » (`canaux.ts`), et le refus est journalisé.
	 *
	 * `ollamaInstalle` et `demarrerOllama` ne prennent RIEN : il n'y a qu'un
	 * Ollama, à ses emplacements d'installation officiels. `demarrerOllama`
	 * rend `false` quand rien n'a pu être lancé ; c'est le poll de l'appelant
	 * qui constate si le serveur répond, jamais ce booléen.
	 */
	processus: {
		/** `flux`: stream the CLI's standard output to THIS window as it
		    arrives (`surFlux`), for the live transcript of a generation. Only
		    a boolean crosses; what comes back is the text `run` returns anyway
		    at the end, sent to the window that asked and to no other. */
		run(spec: RequeteCli, requeteId: number, flux?: boolean): Promise<ResultatCli>;
		annuler(requeteId: number): Promise<void>;
		lireCache(tool: "claude" | "codex"): Promise<{ mtimeMs: number; json: unknown; catalogue?: unknown } | null>;
		ollamaInstalle(): Promise<boolean>;
		demarrerOllama(): Promise<boolean>;
		/** `HostProcess.openTerminal` as seen from the renderer: opens a plain
		    PowerShell window in the home folder and runs nothing. NO argument
		    crosses: no name, no command, no path. */
		openTerminal(): Promise<"lance" | "indisponible">;
		/** Ouvre un terminal VISIBLE qui connecte le compte d'un outil DÉJÀ
		    installé : `HostProcess.connecterCli` vu du rendu. Le NOM est jugé par
		    `estOutilAutorise` avant toute autre chose, SANS confirmation native :
		    rien n'est téléchargé ni exécuté depuis le réseau, seul part un
		    exécutable qui est déjà sur la liste blanche. Ce qu'un rendu
		    compromis obtiendrait ici, c'est une fenêtre de connexion ouverte
		    sous les yeux de l'utilisateur, pas un script distant. */
		connecter(tool: Outil, ancre?: AncreTerminal): Promise<"lance" | "annule" | "indisponible">;
		/** `HostProcess.attendreFinTerminal` vu du rendu : rend la main quand la
		    fenêtre du dernier terminal a disparu. Rien ne traverse : ni nom, ni
		    chemin, ni handle. */
		attendreFinTerminal(): Promise<void>;
		/** S'abonne au moment où la fenêtre d'un terminal est posée. Rien ne
		    traverse : l'appel ne porte aucune donnée, juste l'instant. */
		surTerminalPose(rappel: () => void): () => void;
		/** S'abonne à la réécriture des fichiers de modèles d'un CLI (voir
		    `surveillerCachesCli`). Seul le NOM de l'outil traverse, jamais un
		    chemin ni un contenu : le rendu relit ensuite par `lireCache`. */
		surCachesCli(rappel: (tool: "claude" | "codex") => void): () => void;
		/** Subscribes to the standard output of the runs started with `flux`:
		    the run's `requeteId` and a chunk of its text. */
		surFlux(rappel: (requeteId: number, texte: string) => void): () => void;
		/** S'abonne au moment où le navigateur de la connexion s'ouvre (les
		    deux colonnes) : la modale doit alors se remesurer. */
		surNavigateurOuvert(rappel: () => void): () => void;
		/** Le nouveau rectangle de la modale, sous lequel reposer le terminal. */
		replacerTerminal(ancre: AncreTerminal): Promise<void>;
		/** L'état des trois comptes que le PRINCIPAL seul peut lire. Aucun jeton
		    ne traverse : seulement une adresse, un nom de forfait et deux
		    booléens. Ollama n'y est pas, son compte se sonde en HTTP local
		    depuis le rendu. `outils` filtre la lecture (voir `HostProcess.etatComptes`) :
		    omis, les trois sont lus, comme avant. */
		comptesEtat(outils?: EtatCompte["outil"][]): Promise<EtatCompte[]>;
		/** Les quotas d'un compte. Le jeton qui les obtient ne quitte jamais le
		    principal. */
		comptesUsage(tool: "claude" | "codex"): Promise<UsageRead>;
		/** Déconnecte un compte, sans terminal. Le NOM est jugé par
		    `estOutilAutorise` avant tout, comme `run` et `connecter`. */
		comptesDeconnecter(tool: Outil): Promise<"ok" | "echec" | "indisponible">;
		/** Ouvre un terminal VISIBLE où le CLI tourne INTERACTIF, pour ce
		    qu'aucune lecture ne sait obtenir : Antigravity ne publie son quota
		    que dans son propre REPL (`/usage`), ni en HTTP ni sur une page web.
		    Liste blanche PLUS ÉTROITE que `connecter` : seul `agy` est servi,
		    tout autre nom rejette (`refuse`). L'invite affichée dans la fenêtre
		    est traduite PAR LE PRINCIPAL — le rendu ne passe que le nom. */
		comptesUsageTerminal(tool: Outil): Promise<"lance" | "indisponible">;
	};

	fenetre: {
		/** Signale que le rendu a fini son initialisation et peut être montré. */
		prete(): Promise<void>;
		/**
		 * Le rappel à exécuter AVANT que la fenêtre ne se ferme, et que la
		 * fermeture ATTEND. C'est le seul chemin qui sache attendre une
		 * écriture différée (journal de révision, statistiques, page d'un quiz
		 * — trois écrivains débouncés, voir `apps/windows/src/main.ts`).
		 *
		 * `Promise<void>` et non `void` : l'ARMEMENT lui-même traverse l'IPC,
		 * et une fermeture qui surviendrait avant que le principal ne sache
		 * qu'un rappel existe n'attendrait rien. On peut donc attendre d'être
		 * réellement armé. (Le plan écrivait `void` ; c'est la même règle que
		 * « aucun `ipcMain.on` sans réponse » appliquée au sens principal →
		 * rendu.)
		 */
		surFermeture(rappel: () => Promise<void>): Promise<void>;
		/** Ordres SANS ARGUMENT : la barre dessinée par le rendu (tâche 2) ne
		    fait qu'exécuter, jamais décider. */
		reduire(): Promise<void>;
		/** Restaure et met la fenêtre au premier plan (voir `HostUi.premierPlan`). */
		premierPlan(): Promise<void>;
		agrandirOuRestaurer(): Promise<void>;
		/** LE MÊME chemin que la croix native (`fenetre.close()` côté
		    principal) : la fermeture attendue reste garantie, armement et
		    délai de garde compris. */
		fermer(): Promise<void>;
		/** Bascule. */
		pleinEcran(): Promise<void>;
		etat(): Promise<EtatFenetre>;
		/**
		 * L'état est POUSSÉ par le principal (`webContents.send`), jamais
		 * deviné par le rendu depuis `innerWidth` : `innerWidth` ne distingue
		 * pas une fenêtre agrandie d'une fenêtre large, et ne dit rien du
		 * focus. Même patron que `miseAJour.surEtat`.
		 */
		surEtat(rappel: (etat: EtatFenetre) => void): () => void;
	};

	/** Le zoom et les deux commandes qu'un menu natif exposait
	    (`Ctrl+R`, `Ctrl+Alt+I`), retirées avec lui. */
	affichage: {
		/** Borné ZOOM_MIN..ZOOM_MAX par le principal, et PERSISTÉ sous la clé
		    `CLE_REGLAGES_ZOOM` : la barre dessinée par le rendu (tâche 2) n'a
		    donc pas à relire ce réglage elle-même au démarrage suivant, le
		    principal l'applique déjà (`main.ts`, `did-finish-load`). */
		zoom(facteur: number): Promise<void>;
		recharger(): Promise<void>;
		outilsDev(): Promise<void>;
	};

	/**
	 * LA MISE À JOUR AUTOMATIQUE, vue du rendu. Le rendu ne choisit RIEN de
	 * ce qui traverse : ni URL, ni chemin, ni version — le flux est
	 * `app-update.yml`, embarqué au paquet, et c'est le principal qui
	 * télécharge, vérifie le sha512 et installe. Le rendu reçoit un état
	 * (poussé, comme les événements disque) et donne deux ordres : vérifier
	 * maintenant, installer ce qui est prêt. PLUS DE « couper l'automatique »
	 * depuis le 2026-09-17 : l'application se met à jour, toujours.
	 */
	miseAJour: {
		etat(): Promise<EtatMiseAJour>;
		surEtat(rappel: (etat: EtatMiseAJour) => void): () => void;
		/** False when no check ran (a dev build). */
		verifier(): Promise<boolean>;
		installer(): Promise<void>;
	};

	/**
	 * L'ATTENTE D'UNE RÉPONSE COPIÉE (génération par un site). Le rendu
	 * donne un JETON et reçoit AU PLUS un texte : celui qui le porte. Le
	 * principal sonde le presse-papier (voir `attente-collage.ts` : un texte
	 * sans jeton est comparé puis oublié, jamais transmis) et arrête de
	 * lui-même à la première livraison, sur `arreter`, ou après trente
	 * minutes. Poussé comme `miseAJour.surEtat`.
	 */
	collage: {
		/** `false` si le jeton est refusé (trop court, mal formé). */
		attendre(jeton: string): Promise<boolean>;
		arreter(): Promise<void>;
		surTexte(rappel: (texte: string) => void): () => void;
	};

	/** DISPOSER LES FENÊTRES POUR UN SITE et GLISSER un fichier (voir
	    `HostDepot`, src/host/types.ts) : le chemin est ABSOLU, borné par le
	    périmètre comme une lecture. */
	depot: {
		disposer(options?: { coller?: boolean }): Promise<void>;
		/** Écrit ces octets sous ce nom dans le dossier temporaire de
		    l'application et rend le chemin, glissable ensuite ; `null` si refusé. */
		ecrire(nom: string, octets: Uint8Array): Promise<string | null>;
		preparer(absolus: string[]): Promise<void>;
		/** `image` : le PNG (`data:` URL) qui suit le curseur, et son échelle ;
		    sans elle, l'icône de type du fichier saisi. */
		glisser(absolus: string[], saisi: number, image?: { png: string; echelle: number }): Promise<"depose" | "revenu" | "impossible">;
		terminer(): Promise<void>;
	};

	/**
	 * LA LECTURE D'UNE VIDÉO YOUTUBE : `HostVideo` (`src/host/types.ts`) vu
	 * du rendu. Le rendu ne passe qu'un IDENTIFIANT — revalidé par
	 * `ID_VIDEO` dans `canaux.ts` AVANT tout lancement, puis revalidé par
	 * `video.ts` une seconde fois ; l'URL est reconstruite par le
	 * principal, jamais reçue d'ici : un rendu compromis ne peut faire
	 * lancer yt-dlp que sur youtube.com, et sur une vidéo désignée par
	 * son seul identifiant.
	 *
	 * `installer` PORTE son rappel de progression, mais il ne traverse
	 * pas : même règle que le `signal` du réseau et des CLI — LE RAPPEL
	 * NE TRAVERSE PAS L'IPC. Les octets partent par un canal POUSSÉ
	 * (`neo:video/progression`, comme `collage.texte`), et le
	 * préchargement s'y abonne AVANT d'invoquer, puis se désabonne dans
	 * un `finally` (voir `preload.ts`).
	 *
	 * `transcrire` et `installer` rendent une ENVELOPPE
	 * (`EnveloppeVideo`) et non un rejet : même raison que
	 * `ResultatCli`. `annuler(id)` relaie l'abandon : le principal tient
	 * un contrôleur PAR transcription vivante de cet identifiant
	 * (`video.ts`), et l'abandon tue l'ARBRE de yt-dlp. Un identifiant
	 * sans transcription vivante est ignoré.
	 */
	video: {
		etat(): Promise<{ present: boolean; source: "app" | "systeme" | null }>;
		infosInstallation(): Promise<InfosInstallation>;
		installer(surProgression: (recus: number, total: number | null) => void): Promise<EnveloppeVideo<null, CodeInstallation>>;
		transcrire(id: string): Promise<EnveloppeVideo<ResultatVideo, CodeErreurVideo>>;
		annuler(id: string): Promise<void>;
	};

	/**
	 * RUNNING A PROGRAM: `HostCode` as seen from the renderer. The code runs
	 * in the main process's sandbox (`code-sandbox.ts`), a hidden window with
	 * no disk or network access; the renderer never executes anything itself.
	 */
	code: {
		run(job: CodeJob): Promise<CodeRun>;
		warm(language: CodeLanguage): Promise<void>;
	};

	/**
	 * THE LANGUAGE PACKS (task 9, `langages.ts`): the C/C++ compiler, a
	 * pinned download. The renderer only NAMES the pack (`"c"`, which serves
	 * C and C++); URL, hash and directory stay in the main process. As for
	 * `video.installer`, the progress callback does not cross the IPC: the
	 * bytes come back on a PUSHED channel (`langagesProgression`).
	 */
	langages: {
		etat(nom: "c"): Promise<{ installe: boolean; version: string | null; octets: number }>;
		installer(nom: "c", surProgression: (recus: number, total: number) => void): Promise<EnveloppeVideo<null, CodeInstallation>>;
		supprimer(nom: "c"): Promise<void>;
	};
}

/**
 * Les noms de canaux, ÉCRITS UNE FOIS.
 *
 * Le principal les enregistre, le préchargement les appelle : un nom recopié
 * de travers ne produit aucune erreur de compilation, seulement un `invoke`
 * qui rejette à l'exécution avec « No handler registered ». Une seule source
 * rend la faute impossible.
 */
/** Le message d'erreur d'un partage refusé parce qu'un autre est en cours
    (`electron/partage.ts`) : la fenêtre le reconnaît et le dit, au lieu d'un
    échec muet. Ici parce que les deux côtés du pont l'importent. */
export const PARTAGE_OCCUPE = "partage-occupe";

export const CANAUX = {
	demarrer: "neo:demarrer",
	read: "neo:fichiers/read",
	readCached: "neo:fichiers/read-cached",
	write: "neo:fichiers/write",
	lirePourEcriture: "neo:fichiers/lire-pour-ecriture",
	ecrireSiInchange: "neo:fichiers/ecrire-si-inchange",
	writeBinary: "neo:fichiers/write-binary",
	append: "neo:fichiers/append",
	exists: "neo:fichiers/exists",
	mkdirs: "neo:fichiers/mkdirs",
	trash: "neo:fichiers/trash",
	list: "neo:fichiers/list",
	remove: "neo:fichiers/remove",
	rename: "neo:fichiers/rename",
	stat: "neo:fichiers/stat",
	statEntree: "neo:fichiers/stat-entree",
	listerDossier: "neo:fichiers/lister-dossier",
	readBinary: "neo:fichiers/read-binary",
	liste: "neo:fichiers/liste",
	surveiller: "neo:surveiller",
	/** POUSSÉ par le principal vers la fenêtre (`webContents.send`). C'est le
	    SEUL sens principal → rendu du pont, et il est indispensable : un rendu
	    qui interrogerait le disque en boucle pour voir ce qui a changé serait
	    l'inverse d'un surveillant. */
	evenement: "neo:evenement",
	fenetrePrete: "neo:fenetre/prete",
	armerFermeture: "neo:fenetre/armer-fermeture",
	fermeture: "neo:fenetre/fermeture",
	fermetureTerminee: "neo:fenetre/fermeture-terminee",
	fenetreReduire: "neo:fenetre/reduire",
	fenetrePremierPlan: "neo:fenetre/premier-plan",
	fenetreAgrandir: "neo:fenetre/agrandir",
	fenetreFermer: "neo:fenetre/fermer",
	fenetrePleinEcran: "neo:fenetre/plein-ecran",
	fenetreEtatLire: "neo:fenetre/etat-lire",
	/** POUSSÉ par le principal (`webContents.send`), comme `evenement` et
	    `miseAJourEtat`. */
	fenetreEtat: "neo:fenetre/etat",
	affichageZoom: "neo:affichage/zoom",
	affichageRecharger: "neo:affichage/recharger",
	affichageOutilsDev: "neo:affichage/outils-dev",
	choisirDossier: "neo:dialogue/choisir-dossier",
	reglagesLire: "neo:reglages/lire",
	reglagesEcrire: "neo:reglages/ecrire",
	reglagesSupprimer: "neo:reglages/supprimer",
	ouvrir: "neo:systeme/ouvrir",
	vaultsObsidian: "neo:systeme/vaults-obsidian",
	systemeDossierDefaut: "neo:systeme/dossier-defaut",
	systemeRelancer: "neo:systeme/relancer",
	systemeCopierTexte: "neo:systeme/copier-texte",
	systemeChoisirDossierDefaut: "neo:systeme/choisir-dossier-defaut",
	systemeChoisirFichiers: "neo:systeme/choisir-fichiers",
	partageEnregistrer: "neo:partage/enregistrer",
	partageDiscord: "neo:partage/discord",
	syncEtatLire: "neo:sync/etat-lire",
	syncAppairer: "neo:sync/appairer",
	syncOublier: "neo:sync/oublier",
	/* Pushed to the window: the state, and "other devices' changes landed". */
	syncEtat: "neo:sync/etat",
	syncDonneesRecues: "neo:sync/donnees-recues",
	reseauFetch: "neo:reseau/fetch",
	reseauAnnuler: "neo:reseau/annuler",
	processusRun: "neo:process/run",
	processusAnnuler: "neo:process/annuler",
	/** PUSHED by the main process: a chunk of the standard output of a run
	    started with `flux` (live transcript, 2026-09-29). */
	processusFlux: "neo:process/flux",
	processusLireCache: "neo:process/lire-cache",
	processusOllamaInstalle: "neo:process/ollama-installe",
	processusDemarrerOllama: "neo:process/demarrer-ollama",
	processusOpenTerminal: "neo:process/open-terminal",
	processusConnecter: "neo:process/connecter",
	processusAttendreFinTerminal: "neo:process/attendre-fin-terminal",
	/** POUSSÉ par le principal (`webContents.send`), comme `evenement` et
	    `fenetreEtat` : la fenêtre du terminal vient d'être POSÉE sous la
	    modale. C'est à cet instant, et pas avant, que la modale remonte. */
	processusTerminalPose: "neo:process/terminal-pose",
	/** POUSSÉ par le principal : un fichier de modèles d'un CLI vient d'être
	    réécrit (`surveillerCachesCli`). La charge est le nom de l'outil. */
	processusCachesCli: "neo:process/caches-cli",
	/** POUSSÉ par le principal : le navigateur de la connexion vient d'être
	    posé à gauche et Neo Quiz à droite — la modale a bougé, qu'elle se
	    remesure. */
	processusNavigateurOuvert: "neo:process/navigateur-ouvert",
	/** La réponse du rendu : le nouveau rectangle de sa modale, sous lequel
	    reposer le terminal. */
	processusReplacerTerminal: "neo:process/replacer-terminal",
	comptesEtat: "neo:comptes/etat",
	comptesUsage: "neo:comptes/usage",
	comptesDeconnecter: "neo:comptes/deconnecter",
	comptesUsageTerminal: "neo:comptes/usage-terminal",
	miseAJourEtatLire: "neo:mise-a-jour/etat-lire",
	miseAJourEtat: "neo:mise-a-jour/etat",
	miseAJourVerifier: "neo:mise-a-jour/verifier",
	miseAJourInstaller: "neo:mise-a-jour/installer",
	depotDisposer: "neo:depot/disposer",
	depotEcrire: "neo:depot/ecrire",
	depotPreparer: "neo:depot/preparer",
	depotGlisser: "neo:depot/glisser",
	depotTerminer: "neo:depot/terminer",
	collageAttendre: "neo:collage/attendre",
	collageArreter: "neo:collage/arreter",
	/** POUSSÉ par le principal (`webContents.send`), comme `evenement` et
	    `miseAJourEtat`. */
	collageTexte: "neo:collage/texte",
	videoEtat: "neo:video/etat",
	videoInfos: "neo:video/infos",
	videoInstaller: "neo:video/installer",
	/** POUSSÉ par le principal (`webContents.send`), comme `evenement` et
	    `collageTexte` : la progression d'une installation, en OCTETS (reçus
	    à cet instant, total lu par HEAD, `null` quand il est ignoré). */
	videoProgression: "neo:video/progression",
	videoTranscrire: "neo:video/transcrire",
	videoAnnuler: "neo:video/annuler",
	codeRun: "neo:code/run",
	codeWarm: "neo:code/warm",
	langagesEtat: "neo:langages/etat",
	langagesInstaller: "neo:langages/installer",
	langagesSupprimer: "neo:langages/supprimer",
	/** PUSHED by the main process, like `videoProgression`: bytes received
	    and the pack's pinned size. */
	langagesProgression: "neo:langages/progression",
} as const;

/** La clé des RÉGLAGES IA de l'application (`neo.reglages`) : les MÊMES
    champs que `plugin.settings` du greffon, dont `aiOllamaUrl`. Écrite ici,
    entre les deux processus, parce que les DEUX la lisent : le principal au
    démarrage, pour admettre l'hôte d'`aiOllamaUrl` à la liste du réseau
    (`main.ts`, `admettreHoteOllama`) — AVANT que le rendu n'existe — et le
    rendu pour ses réglages (`AiSettingsHost`, tâche 6 du plan). Deux
    littéraux « ai » recopiés divergeraient sans une erreur : l'hôte du NAS
    resterait refusé alors que le réglage est bien enregistré. */
export const CLE_REGLAGES_IA = "ai";

/* LA CLÉ « updates » N'EXISTE PLUS ICI (2026-09-17). Elle portait
   `{ auto: boolean }` ; la mise à jour automatique ne se coupe plus, donc plus
   personne ne la lit. Ce qu'une installation a déjà écrit dessous reste dans
   `settings.json`, ignoré — l'effacer n'apporterait rien et demanderait une
   migration pour un octet. */

/** The key of the persisted ZOOM (`neo.reglages`), read by the main process
    when the page loads and written by it alone (`affichage.zoom` clamps, then
    persists): the renderer never writes it directly, so that the
    ZOOM_MIN..ZOOM_MAX bound also applies to a value written by hand. */
export const CLE_REGLAGES_ZOOM = "zoom";

/** The zoom bounds, shared by the main process (clamp) and the renderer (the
    steps of `ui/menu-app-arbre.ts`, whose first and last they are). Below
    75 % the page was measured unusable (2026-09-29): the panel, capped in
    width, shrank to a narrow column of unreadable text, on a small window as
    on a full screen. */
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 1.5;

/** A persisted or requested factor brought into the bounds; anything that is
    not a number is 100 %. A factor saved before the bound was raised (25 %,
    50 %) comes back as 75 %, never ignored. */
export function borneZoom(f: unknown): number {
	return typeof f === "number" && Number.isFinite(f) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f)) : 1;
}

/* LA CLÉ « reprise » N'EXISTE PLUS ICI (2026-09-17). Elle portait
   l'interrupteur « rouvrir là où on s'était arrêté » ; l'application rouvre
   désormais toujours, et plus personne ne la lit. Ce qu'une installation a
   déjà écrit dessous reste dans `settings.json`, ignoré. `CLE_DERNIERE_VUE`,
   elle, est toujours écrite : c'est la vue à rouvrir, pas un réglage. */
export const CLE_DERNIERE_VUE = "derniereVue";

/** La clé de la LANGUE de l'interface (`neo.reglages`) : « auto » (la langue
    du système), « en » ou « fr » — les mêmes valeurs que le réglage
    `language` du greffon. Écrite par le rendu (page Réglages) ET par le
    BOOTSTRAPPER d'installation (`installer/main.ts`), qui y pose la langue
    du site d'où l'exe a été téléchargé, une seule fois, jamais par-dessus
    un choix. Le nom de la clé et le chemin du fichier sont donc un CONTRAT
    entre les deux produits. Lue par le rendu ET par le principal (ses
    dialogues natifs). */
export const CLE_REGLAGES_LANGUE = "language";

/** La clé du FORMAT DE L'HEURE (`neo.reglages`) : « 24h » ou « 12h » ; absente
    ou illisible, 24 h. Écrite par la page Réglages seule, lue par le rendu au
    démarrage (`ui/format-heure.ts`). Aucune garde : ce n'est pas un chemin. */
export const CLE_REGLAGES_HEURE = "timeFormat";

/** Le dossier de quiz PAR DÉFAUT, quand l'utilisateur en a choisi un autre que
    celui que `electron/dossier-defaut.ts` calcule. Absente (l'état courant de
    presque toutes les installations), c'est le chemin calculé qui vaut. Cette
    clé n'est JAMAIS écrite par le rendu : elle nourrit le périmètre au
    démarrage, et seul `systeme.choisirDossierDefaut` la pose, depuis un chemin
    venu du dialogue natif. */
export const CLE_DOSSIER_DEFAUT = "defaultFolder";

/** La clé du fond d'écran (`neo.reglages`) : `{ dossier: string; image: string
    }`, ou absente (fond embarqué). Écrite par le RENDU SEUL — ni chemin
    résolu ni URL, un chemin ABSOLU déjà admis au périmètre (par le
    sélecteur natif à l'écriture, et par `perimetreInitial` au démarrage
    suivant, exactement comme `CLE_DOSSIERS` : voir `electron/perimetre.ts`).
    Pas de garde à l'écriture comme pour `folders` ou `ai` : un chemin qui
    n'a jamais transité par le sélecteur n'est simplement pas SERVABLE par
    `app:` (403), il ne donne aucun accès disque supplémentaire au rendu. */
export const CLE_REGLAGES_FOND = "fond";

/** Whether the embedded Syncthing starts with the application (`neo.reglages`).
    Set to `true` by the MAIN process alone, after a first successful pairing
    (`syncthing.ts`): the window never writes it (`canaux.ts` refuses), because
    it decides whether a binary is launched at startup. Absent = false. */
export const CLE_SYNC_ACTIF = "syncActif";

/** The folder the embedded Syncthing shares (`neo-quiz`), as a canonical
    absolute path. Written by the MAIN process alone, once, the first time sync
    starts (the default folder at that moment); never derived again from
    `defaultFolder`, which the window can change. The window cannot write it
    (`canaux.ts`): repointing it would share any folder of the perimeter. */
export const CLE_SYNC_ROOT = "syncRoot";

/** La luminosité et le flou du fond d'écran (`neo.reglages`) : `{ luminosite:
    number; flou: number }`, relu par `normaliserEffetsFond`
    (`ui/fond-pur.ts`). Écrite par la page Réglages seule. Aucune garde : ce
    n'est ni un chemin ni une URL, deux nombres d'affichage. */
export const CLE_REGLAGES_FOND_EFFETS = "fondEffets";

declare global {
	interface Window {
		/** Posé par le préchargement (`contextBridge.exposeInMainWorld`). Le
		    rendu n'a AUCUN autre accès au disque. */
		readonly neo: Pont;
	}
}
