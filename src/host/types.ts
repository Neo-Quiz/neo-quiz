/* ══════════════════════════════════════════════════════════
   LE CONTRAT D'HÔTE

   Tout ce que le code partagé (moteur, scanner, chaîne de lecture d'un bloc)
   demande à son environnement. Obsidian, Windows et — plus tard — Android en
   fournissent chacun une implémentation ; aucun d'eux n'apparaît ici.

   C'est la généralisation d'un patron déjà éprouvé dans ce dépôt :
   `review/review-store.ts` absorbe tout ce qui est spécifique à Obsidian
   pour que l'ordonnanceur n'en voie rien. La différence est mécanique :
   `npm run check:host` refuse toute nouvelle dépendance à `obsidian` dans
   `src/`, et c'est ce contrôle — pas la discipline — qui tient la frontière.

   RÈGLE DE FORME : aucun type de ce fichier ne porte de méthode vivante ni
   d'objet propriétaire d'un hôte. Un `TFile` d'Obsidian et une entrée d'index
   Tauri doivent tous les deux se réduire à un `HostFile` sans rien inventer.
══════════════════════════════════════════════════════════ */

import type { UsageRead } from "../dashboard/usage-format";
import type { CodeLanguage } from "../code-languages";

/** Un fichier vu par l'hôte. Volontairement plat et sérialisable. */
export interface HostFile {
	/** Chemin depuis la racine du dossier, séparateurs `/`, jamais absolu.
	    C'est la clé du journal de révision et du catalogue : elle doit être
	    identique dans les trois hôtes pour le même fichier. */
	path: string;
	/** Nom avec extension : « schema.png ». */
	name: string;
	/** Nom sans extension : « schema ». */
	basename: string;
	/** Extension sans point : « png ». Chaîne vide si aucune. */
	extension: string;
	/** Dernière modification, ms depuis l'époque. 0 si l'hôte l'ignore. */
	mtime: number;
	/** Creation (birth) time, ms since the epoch. Optional: a host that does
	    not know it leaves it out and callers fall back to `mtime`. */
	ctime?: number;
}

/**
 * Une ENTRÉE d'un dossier, telle que `HostFs.listDir` et `HostFs.externe.list`
 * la rendent. Plate et sérialisable, comme `HostFile` — un `TFolder`
 * d'Obsidian et un `Dirent` de Node s'y réduisent sans rien inventer.
 *
 * `path` change de NATURE selon la porte : chemin du CONTRAT sous `listDir`,
 * chemin ABSOLU du disque sous `externe.list`. C'est le seul type du contrat
 * qui porte les deux, et c'est écrit ici pour qu'un appelant ne mélange jamais
 * les deux — un chemin absolu qui fuirait vers `HostFs.read` serait refusé par
 * l'hôte, un chemin du contrat passé à `externe.read` ne désignerait rien.
 */
export interface DirEntry {
	/** Nom avec extension : « TD3.md », « Cours ». */
	name: string;
	/** Voir l'en-tête du type : contrat ou absolu selon la porte. */
	path: string;
	isFolder: boolean;
}

/** Changement observé dans le dossier. `rename` est distinct de
    delete+create : le journal de révision suit les clés par renommage, et
    reconstituer un renommage à partir de deux évènements est impossible. */
export type HostFileEvent =
	| { kind: "create"; file: HostFile }
	| { kind: "modify"; file: HostFile }
	| { kind: "delete"; path: string }
	| { kind: "rename"; file: HostFile; oldPath: string };

/**
 * LA FRAÎCHEUR APRÈS UNE ÉCRITURE — une promesse de TOUT `HostFs`, pas d'une
 * seule de ses méthodes.
 *
 * Quand `write`, `process`, `writeBinary` ou `append` rendent la main sans
 * rejeter, `getFile(path)` rend un `HostFile` dont le `mtime` est celui que
 * l'écriture vient de produire — jamais celui d'avant. Un chemin que l'hôte ne
 * met pas au catalogue (dossier caché : `.obsidian/…`, `.neo-quiz/…`) rend
 * `null` avant comme après : ce n'est pas une violation, il n'a jamais été
 * indexé.
 *
 * POURQUOI CETTE PROMESSE EXISTE, et ce qu'elle a coûté d'apprendre. Les deux
 * hôtes n'indexent pas de la même façon : le greffon refabrique son `HostFile`
 * à partir d'un `TFile` VIVANT à chaque appel, donc il était frais sans le
 * savoir ; l'application lit une `Map` que seul son surveillant met à jour, et
 * ce surveillant est DÉBOUNCÉ de 300 ms. Un appelant qui relit le `mtime` de
 * ce qu'il vient d'écrire obtenait donc la vérité sous Obsidian et une valeur
 * PÉRIMÉE dans la fenêtre — mesuré le 2026-09-10, la même écriture rendant
 * 6000 d'un côté et 1000 de l'autre.
 *
 * Ce que ça produisait : `src/dashboard/detail-io.ts` mémorise le `mtime` de sa
 * propre écriture pour que `draftIsStale` ne la prenne pas ensuite pour une
 * modification EXTERNE. Avec un `mtime` périmé, chaque sauvegarde faisait jeter
 * le brouillon et affichait une Notice « modifié dehors » — MENSONGÈRE, à
 * chaque frappe. La divergence ne se voyait dans aucun type, dans aucun
 * contrôle, et dans aucun des deux hôtes pris isolément.
 *
 * D'où le texte ici plutôt qu'un correctif dans la fenêtre seule : une promesse
 * TACITE n'est pas une promesse. L'hôte Android tiendrait la fraîcheur par
 * accident ou pas du tout, et `draftIsStale` s'y casserait sans un mot. Elle
 * est éprouvée côté fenêtre (`check:windows-host`).
 *
 * Ce qu'elle NE couvre PAS, et c'est nommé exprès : `trash`, `remove` et
 * `rename` ne sont pas des écritures — le catalogue les apprend du surveillant,
 * qui SEUL sait traduire un déplacement vers un dossier ignoré en disparition
 * (`evenementDeRenommage`, `apps/windows/src/host/fs.ts`). Recopier cette règle
 * dans les méthodes d'écriture donnerait deux copies d'un même prédicat, et
 * elles ont déjà divergé une fois ici.
 */
export interface HostFs {
	/** Lit un fichier texte. Rejette si absent ou illisible. */
	read(path: string): Promise<string>;
	/** Lecture destinée à un balayage complet du dossier : l'hôte a le droit
	    de servir un cache. Obsidian a `cachedRead` ; un hôte sans cache peut
	    renvoyer `read`. */
	readCached(path: string): Promise<string>;
	/** Like `read`, but rejects when the file is over `maxBytes`, checked WHILE reading
	    (a synced file may grow between a `size` check and the read). */
	readBounded(path: string, maxBytes: number): Promise<string>;
	/** CRÉE OU REMPLACE : le contenu est écrit, que la cible existe ou non.
	    Ne rejette JAMAIS parce qu'elle existe déjà — un hôte dont l'API de
	    création refuse une cible présente (`vault.create` sous Obsidian) doit
	    lui-même retomber sur un remplacement.

	    Voir « LA FRAÎCHEUR APRÈS UNE ÉCRITURE » ci-dessous : au retour,
	    `getFile(path)` rend le `mtime` NEUF.

	    Ce que la fraîcheur ne rend PAS inutile : un appelant qui cherche un nom
	    LIBRE interroge le DISQUE (`exists`), jamais l'index. L'index ne
	    connaît que le CATALOGUE — pas les dossiers ignorés, pas ce qu'un autre
	    programme vient de poser là. C'est ce que fait `freeNotePath`
	    (`src/dashboard/folder-create.ts`), dont les boucles d'import rendraient
	    sinon deux fois le même nom libre et écraseraient la première note en
	    silence. */
	write(path: string, data: string): Promise<void>;
	/** Lecture-modification-écriture INDIVISIBLE : le rappel reçoit le contenu
	    actuel et rend le contenu à écrire.

	    C'est la seule façon sûre d'écrire dans une note dont on ne possède
	    qu'un MORCEAU. `read` puis `write` perd toute modification faite entre
	    les deux, et le commentaire d'`ai.ts:2058` dit ce que ça coûtait : une
	    insertion écrasait le travail d'à côté en annonçant « Quiz inséré ».

	    Le rappel peut être REJOUÉ : il doit repartir de zéro à chaque
	    invocation et ne rien garder d'un essai abandonné. C'est la DERNIÈRE
	    invocation qui fait foi (`detail-io.ts` en dépend, son drapeau `ecrit`
	    est remis à faux en tête de rappel).

	    Ce que les deux hôtes NE promettent pas également : Obsidian sérialise
	    réellement les écritures de son vault ; la fenêtre est un processus
	    unique sans autre écrivain qu'elle-même, et son implémentation lit puis
	    écrit. Aucun des deux ne protège d'un éditeur de texte EXTÉRIEUR — c'est
	    pourquoi l'appelant porte son propre compare-and-swap sur le CONTENU
	    (`detail-io.ts`), qui est la seule garantie à la bonne granularité.

	    Voir « LA FRAÎCHEUR APRÈS UNE ÉCRITURE » ci-dessus : au retour,
	    `getFile(path)` rend le `mtime` neuf. C'est `detail-io.ts` qui en dépend
	    le plus directement — il relit ce `mtime` juste après avoir écrit, pour
	    que sa propre écriture ne passe pas pour une modification EXTERNE au
	    rendu suivant. */
	process(path: string, mutate: (content: string) => string): Promise<void>;
	/** Écrit des OCTETS, en créant ou en remplaçant, comme `write`.
	    Existe pour UNE raison : coller une image dans une question
	    (`editor/editor-form.ts`). Le texte a `write` ; un `Uint8Array` passé
	    par `write` serait converti en chaîne et l'image serait corrompue sans
	    qu'aucune erreur ne le dise.

	    Fraîcheur : voir « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ». Elle compte ici
	    aussi — l'aperçu d'une question relit l'image qu'on vient d'y coller. */
	writeBinary(path: string, data: Uint8Array): Promise<void>;
	/** Lit les OCTETS d'un fichier du contrat — le miroir de `writeBinary`, et
	    pour un seul appelant : joindre une image ou un PDF du vault à une
	    génération (`dashboard/ai.ts`, `attachVaultPath`, sélecteur « @ »). Le
	    greffon lisait `vault.readBinary(TFile)` ; `externe.readBinary` ne
	    convient pas, il attend un chemin ABSOLU que le code partagé ne sait
	    pas composer. Rejette si absent ou illisible, comme `read`. */
	readBinary(path: string): Promise<Uint8Array>;
	/** Retire un fichier en le rendant RÉCUPÉRABLE. Ce n'est pas `remove` :
	    supprimer le quiz d'un semestre par mégarde ne doit pas être définitif.

	    Chaque hôte applique SA convention, et le contrat ne promet que le
	    résultat : le fichier n'est plus à son chemin, et l'utilisateur peut le
	    retrouver par les moyens habituels de son hôte. Obsidian suit le réglage
	    de l'utilisateur (corbeille système, `.trash` du vault, ou définitif) ;
	    l'application déplace vers `<racine>/.trash/<chemin local>`, qui est
	    l'une des trois options qu'Obsidian propose lui-même — sans dépendance
	    neuve, et portable telle quelle sur Android au chantier 3, où aucune
	    corbeille système n'est atteignable. */
	trash(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	/** The size in bytes of a FILE, read WITHOUT reading its content (a synced
	    file written by another device must be size-checked before it is read).
	    `null` when absent, not a file, unreadable or outside the roots. */
	size(path: string): Promise<number | null>;
	/** Crée le dossier ET ses parents. Ne rejette pas s'il existe déjà. */
	mkdirs(path: string): Promise<void>;
	/** Ajoute à la FIN du fichier, en le créant s'il n'existe pas.
	    L'ajout seul est ce qui rend le journal de révision sûr : une coupure
	    ne peut tronquer que le dernier petit lot, jamais réécrire tout
	    l'historique. Un hôte qui l'émulerait par lecture + réécriture
	    perdrait exactement la propriété pour laquelle il existe.

	    Fraîcheur : couvert comme les trois autres écritures, et il a fallu s'en
	    donner les moyens plutôt que de l'excepter. Sous Obsidian, `append`
	    passait par le seul ADAPTATEUR, qui écrit sur le disque sans que le
	    vault en sache rien : le `mtime` du `TFile` restait celui d'avant. Une
	    promesse qui saute une des quatre voies d'écriture est un piège pire que
	    pas de promesse — un appelant ne peut pas se souvenir de l'exception.
	    L'hôte greffon emploie donc `vault.append` quand le chemin EST indexé
	    (même partage que `write`), et l'adaptateur pour le reste. Le seul
	    appelant d'aujourd'hui, le journal de révision, écrit sous `.neo-quiz/`
	    et prend la seconde branche : sa conduite est inchangée. */
	append(path: string, data: string): Promise<void>;
	/** Les FICHIERS d'un dossier (chemins du contrat), sans descendre dans
	    les sous-dossiers. Un dossier absent rend `[]` — ce n'est pas une
	    erreur : le journal cherche des fichiers de conflit qui, la plupart
	    du temps, n'existent pas. */
	list(dir: string): Promise<string[]>;
	/** Supprime un fichier. Ne rejette pas s'il est déjà absent. */
	remove(path: string): Promise<void>;
	/** Renomme (ou déplace) un fichier, OU UN DOSSIER — auquel cas tout son
	    contenu suit (menu « Déplacer vers… », qui peut traverser deux
	    racines distinctes, donc deux volumes). Rejette si la destination
	    existe : la migration du journal s'en sert pour ne jamais écraser une
	    sauvegarde précédente, et un module déplacé vers un homonyme ne doit
	    jamais l'écraser en silence. */
	rename(from: string, to: string): Promise<void>;
	/** Index EN MÉMOIRE des fichiers `.md`, synchrone. Obsidian tient déjà le
	    sien ; l'app le construit au démarrage et le maintient par le watcher.
	    Synchrone parce que le scanner et le sanitizer l'appellent en plein
	    rendu, où une promesse imposerait de tout rendre asynchrone. */
	listMarkdown(): HostFile[];
	/** Cherche par NOM exact (avec extension), casse ignorée. Plusieurs
	    résultats sont possibles et ce n'est pas une erreur : l'appelant
	    prévient l'utilisateur (engine/resources.ts). */
	findByName(name: string): HostFile[];
	getFile(path: string): HostFile | null;
	/** TOUS les fichiers de l'index, `.md` ou non, synchrone comme
	    `listMarkdown`. Un seul appelant le justifie, et il ne peut pas faire
	    autrement : la recherche floue du sélecteur « @ » (`dashboard/
	    file-sources.ts`, `searchAll`) note CHAQUE chemin du vault contre ce
	    que l'utilisateur tape — images et PDF compris, puisque ce sont des
	    pièces jointes — et `findByName` ne sait chercher qu'un nom EXACT.
	    Les dossiers en sont DÉRIVÉS (chaque préfixe d'un chemin de fichier) :
	    un dossier vide n'y figure pas, et il n'a rien à attacher. Dans
	    l'application, l'index tient déjà tous les fichiers du parcours
	    (`parcours.ts` n'écarte que les dossiers ignorés), `mtime` à 0 hors des
	    `.md` — ce que `HostFile` autorise. */
	listFiles(): HostFile[];
	/** Les ENTRÉES d'un dossier du contrat — fichiers ET sous-dossiers, sans
	    descendre. `dir` vide désigne la racine (le vault ; dans l'application,
	    les dossiers ouverts eux-mêmes, un par racine). Un dossier absent OU
	    HORS DES RACINES rend `[]` (l'hôte nomme le refus dans sa console),
	    jamais un rejet : l'appelant (`isVaultFolder`, file-sources.ts) demande
	    « @Foo/ » avant de savoir si Foo est du vault ou une racine externe, et
	    un rejet ici tuerait la navigation externe. C'est la voie de NAVIGATION
	    du sélecteur « @ » (« @Cours/ » liste `Cours`) : `list` ne rend que les
	    fichiers, et rien d'autre au contrat ne sait nommer un sous-dossier. */
	listDir(dir: string): Promise<DirEntry[]>;
	/**
	 * LES RACINES EXTERNES — des chemins ABSOLUS, hors de toute racine du
	 * contrat.
	 *
	 * POURQUOI ÇA EXISTE : le réglage `aiMentionExtraFolders` désigne des
	 * dossiers HORS du vault (« C:/Users/…/Downloads ») dont le sélecteur « @ »
	 * et les chemins cités dans le prompt tirent des pièces jointes.
	 * `dashboard/file-sources.ts` et `prompt-paths.ts` y faisaient quatre
	 * `require("fs")` — inexistant dans le rendu de l'application, où chaque
	 * racine externe aurait rendu une liste vide en silence. Tout ce qui touche
	 * un chemin absolu passe donc ici, et `DirEntry.path` y est ABSOLU.
	 *
	 * POURQUOI C'EST SÛR, et ce n'est pas la même raison des deux côtés. Sous
	 * Obsidian, le greffon a déjà `fs` entier ; cette porte ne lui donne rien
	 * qu'il n'avait. Dans l'application, ces quatre méthodes sont les MÊMES
	 * canaux `fichiers.*` du pont que le reste de `HostFs`, BORNÉS par le
	 * périmètre (`apps/windows/electron/perimetre.ts`) : une racine externe qui
	 * n'est pas un dossier ouvert rend `[]`/`null` (`list`, `stat`) ou rejette
	 * (`read`, `readBinary`), et le processus principal la NOMME dans sa
	 * console — elle n'est jamais lue. Sans le périmètre, cette interface
	 * serait un accès disque total depuis la fenêtre ; c'est lui, et lui seul,
	 * qui autorise son existence côté application. Un hôte MOBILE rend
	 * `[]`/`null` et rejette : il n'a pas de disque à offrir.
	 *
	 * `readBinary` entre au contrat MAINTENANT, sans appelant dans cette
	 * tranche : les images jointes (`ai.ts`, `attachExternalPath`) en auront
	 * besoin à la tâche suivante, et rouvrir le contrat pour une méthode de
	 * plus rouvrirait aussi les quatre contrôles qui l'éprouvent.
	 */
	externe: {
		/** Les entrées d'un dossier absolu, `path` ABSOLU. Absent, illisible ou
		    hors périmètre → `[]`. */
		list(abs: string): Promise<DirEntry[]>;
		/** `isFile` distingue un fichier d'un dossier ; `mtimeMs` sert à
		    invalider l'index d'une racine. Absent ou hors périmètre → `null`. */
		stat(abs: string): Promise<{ isFile: boolean; mtimeMs: number } | null>;
		/** Rejette si absent, illisible ou hors périmètre. */
		read(abs: string): Promise<string>;
		readBinary(abs: string): Promise<Uint8Array>;
		/** Le dialogue natif de fichiers de l'hôte, OPTIONNEL (le greffon n'en
		    a pas : la page garde son `<input type="file">`). Rend des chemins
		    ABSOLUS que l'hôte a admis en lecture et ouverture ; `[]` si annulé. */
		pickFiles?(kind: "documents" | "images" | "any"): Promise<string[]>;
	};
}

export interface HostLinks {
	/** Résout un wikilink (« schema.png », « Cours/ch1 ») relativement à la
	    note `fromPath`. null si rien ne correspond. */
	resolve(linkPath: string, fromPath: string): HostFile | null;
	/** URL affichable dans un attribut `src`. null si non résoluble — jamais
	    une chaîne vide, qui ferait charger la page courante comme image.

	    SÉMANTIQUE ARRÊTÉE : « RÉSOUT puis convertit ». Une CHAÎNE est d'abord
	    résolue en fichier existant par la même voie que `resolve` ; si rien
	    ne correspond, la réponse est `null`. Ce n'est PAS un simple
	    changement de préfixe sur le chemin qu'on lui donne.
	    Pourquoi cette moitié-là : l'unique appelant
	    (`src/engine/cards.ts`, images d'options) laisse le `src` d'origine
	    intact quand la réponse est `null`, en comptant sur la liste blanche
	    du sanitizer. Cette branche n'a de sens que si `null` est possible.
	    L'implémentation Obsidian rendait autrefois `getResourcePath()` sans
	    rien vérifier — donc jamais `null` pour une chaîne non vide, donc une
	    URL de fichier inexistant, et un nom nu (« schema.png ») référencé
	    depuis un sous-dossier restait cassé là où l'app l'affichait.

	    `fromPath` est la note CITANTE. Il sert deux fois : sous Obsidian, il
	    permet à `getFirstLinkpathDest` de résoudre un nom nu comme la note
	    l'entend ; dans l'application, il BORNE la recherche à la racine de
	    cette note — une image du dossier A ne doit jamais être servie à une
	    note du dossier B, exactement comme un lien ne sort pas d'un vault. */
	resourceUrl(target: string | HostFile, fromPath?: string): string | null;
}

export interface HostWatcher {
	/** S'abonne aux changements du dossier. Renvoie le désabonnement. */
	onChange(cb: (ev: HostFileEvent) => void): () => void;
	/**
	 * Renommages de DOSSIERS, séparés des fichiers, et c'est le journal de
	 * révision qui l'exige : ses clés se déplacent par PRÉFIXE, donc un
	 * dossier renommé déplace toutes ses notes en une seule ligne. Sans ce
	 * canal, renommer « Cours » en « Cours B2 » orphelinerait d'un coup
	 * l'historique de toutes ses questions — et rien ne le signalerait.
	 *
	 * Un hôte qui ne sait pas distinguer un dossier renommé n'appelle
	 * jamais le rappel ; il ne DEVINE pas.
	 */
	onRenameDir(cb: (ev: { from: string; to: string }) => void): () => void;
}

export interface HostUi {
	/** Message bref, non bloquant, sans interaction. */
	notice(message: string, timeoutMs?: number): void;
	/** Pose une icône LUCIDE dans l'élément, en remplaçant son contenu.
	    `name` est un identifiant Lucide (« grip-horizontal », « x »). */
	setIcon(el: HTMLElement, name: string): void;
	/** Tous les noms d'icônes disponibles, en KEBAB-CASE (« chevron-down »),
	    la forme que le contrat emploie partout. Le sélecteur d'icônes les
	    liste ; l'ordre n'a pas d'importance, il trie lui-même. */
	iconNames(): string[];
	/** Remet la fenêtre de l'application au PREMIER PLAN (restaurée si elle
	    était réduite). OPTIONNEL : le greffon n'a pas de fenêtre à lui. Sert
	    quand l'utilisateur revient d'un terminal ou d'un navigateur ouvert par
	    l'application pour une étape qu'elle vient de voir aboutir (compte
	    connecté) : il n'a pas à chercher la fenêtre dans la barre des tâches. */
	premierPlan?(): Promise<void>;
}

export interface HostMath {
	/** Prépare le moteur de rendu. Idempotent, et un échec ne doit pas être
	    mémoïsé : une panne transitoire tuerait le rendu pour la session. */
	ready(): Promise<void>;
	/** Rend UN segment LaTeX. `display` = mode bloc ($$…$$). */
	render(latex: string, display: boolean): HTMLElement;
	/** Fin de lot. L'hôte qui a besoin d'une passe finale la fait ici ; les
	    autres n'ont rien à faire. */
	flush(): void;
}

export interface HostShell {
	/** Ouvre le fichier avec l'application par défaut du système. Une CHAÎNE
	    est un chemin ABSOLU : un fichier que l'hôte a admis (dialogue natif).
	    Sous le greffon, seule la forme `HostFile` existe. */
	openExternal(file: HostFile | string): Promise<boolean>;
	/** Révèle le fichier dans l'explorateur de l'hôte. `false` quand l'hôte
	    n'a pas d'explorateur : ce n'est PAS une erreur, l'appelant enchaîne
	    sur l'ouverture externe. */
	revealInHost(file: HostFile): Promise<boolean>;
	/** Ouvre une adresse `https:` dans le navigateur de l'utilisateur. `false`
	    si l'hôte a refusé (autre schéma, adresse illisible). Jamais un chemin
	    de fichier : c'est `openExternal`. Sert au canal web de la page
	    « Générer » (spec 2026-09-18). */
	openUrl(url: string): Promise<boolean>;
	/** Copies text to the system clipboard (`navigator.clipboard` is refused
	    in the app window). Optional: `false` or absent means it did not work. */
	copyText?(text: string): Promise<boolean>;
}

export interface HostPlatform {
	isMobile: boolean;
	isMacOS: boolean;
	/** Windows. Un seul appelant, et il n'a pas d'autre voie : la page
	    « Générer » affiche la COMMANDE d'installation d'un CLI absent, et elle
	    n'est pas la même sur Windows (`irm … | iex`, `winget`) qu'ailleurs
	    (`curl … | sh`). Trois systèmes, trois commandes : `isMacOS` seul ne les
	    sépare pas, et « pas un Mac » aurait donné du PowerShell à un Linux. */
	isWindows: boolean;
	/** Vrai quand un CLI local peut être lancé et qu'un réseau est atteignable
	    depuis l'hôte : Obsidian de bureau, l'application Windows. Faux sur
	    Obsidian mobile — et l'hôte Android le dira lui-même. C'est le SEUL
	    test d'hôte que la génération IA a le droit de faire : elle ne demande
	    jamais « suis-je sous Electron ? », elle demande « ai-je un bureau ? ». */
	isDesktopApp: boolean;
	/** Étiquette BCP-47 de la langue de l'interface de l'HÔTE (« fr »,
	    « en-US »). C'est la source du mode « auto » de `src/i18n.ts` : sous
	    Obsidian, la langue d'Obsidian ; dans l'app, celle du système. */
	uiLanguage: string;
}

/**
 * Une requête HTTP, telle que la génération IA en fait : le catalogue
 * d'Ollama, son API locale, l'usage chez Anthropic. Plate et sérialisable —
 * SAUF `signal`, qui ne traverse aucun IPC : l'hôte de l'application le
 * traduit en un identifiant de requête et un canal d'annulation
 * (`apps/windows/src/host/net.ts`), et l'hôte Obsidian l'IGNORE, parce que
 * `requestUrl` ne l'accepte pas — le greffon n'annulait pas ses appels non
 * plus.
 */
export interface HostNetRequest {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

export interface HostNetResponse {
	status: number;
	body: string;
}

/**
 * TOUT le HTTP du code partagé passe ici, et l'hôte décide de ce qui part.
 *
 * POURQUOI UNE PORTE ET PAS `fetch` : dans l'application, la fenêtre rend du
 * HTML qui n'est pas toujours celui de l'utilisateur, et `fetch` depuis le
 * rendu vers `localhost:11434` est de toute façon refusé par la politique
 * d'origine. Le processus PRINCIPAL fait donc la requête, derrière une liste
 * d'hôtes (`apps/windows/electron/reseau.ts`) — un rendu compromis ne peut
 * pas faire de l'application un relais vers n'importe où. Sous Obsidian,
 * c'est `requestUrl`, qui contourne CORS comme le greffon l'a toujours fait.
 */
export interface HostNet {
	/** `null` = échec RÉSEAU (hôte refusé, injoignable, annulé). Un statut
	    HTTP d'erreur n'est PAS un échec réseau : il est rendu avec son corps —
	    Ollama y met son diagnostic, et `requestUrl` le cachait. */
	fetchJson(req: HostNetRequest): Promise<HostNetResponse | null>;
}

/**
 * Un CLI que la génération IA a le droit de lancer. `tool` est un NOM, jamais
 * un chemin : c'est l'hôte qui résout l'exécutable (réglage « chemin » s'il
 * est rempli, sinon le PATH du processus) et refuse tout autre nom. C'est la
 * liste blanche qui rend impossible la séquence que le périmètre des chemins
 * ne voit pas : `fs.write("x.bat")` puis `process.run("x.bat")`. Voir la spec
 * docs/superpowers/specs/2026-09-11-generation-ia-app-design.md, §2.
 */
export type CliTool = "claude" | "codex" | "ollama" | "agy";

/** L'état d'un compte IA tel que la section « Comptes » l'affiche. JAMAIS un
    jeton : le principal lit les fichiers de secrets et n'en ressort que ceci.
    `installe` est distinct de `connecte` — sans lui, un outil absent de la
    machine et un outil présent mais déconnecté offriraient le même bouton. */
export interface EtatCompte {
	outil: "claude" | "codex" | "agy" | "ollama";
	installe: boolean;
	connecte: boolean;
	email: string | null;
	plan: string | null;
}

/** Le rectangle SOUS LEQUEL poser la fenêtre du terminal (la modale qui
    attend, mesurée par `getBoundingClientRect`), en pixels CSS de la fenêtre.
    Le terminal ne se place plus à côté de Neo Quiz mais juste en dessous de
    la modale, dans Neo Quiz (Ahmed, 2026-09-20). Sans ancre, l'hôte pose le
    terminal dans la moitié basse de la fenêtre. */
export interface AncreTerminal {
	x: number;
	y: number;
	largeur: number;
	hauteur: number;
	/** LE HAUT DE CE QUE LE TERMINAL NE DOIT PAS RECOUVRIR (l'invite où l'on
	    écrit son prompt), en pixels CSS. Sans cette limite, il se posait EN
	    TRAVERS du composer : on n'en voyait plus que les bords gauche et droit
	    (Ahmed, 2026-09-20 : « jamais en haut ou en bas »). Absente, le
	    terminal descend jusqu'au bas de la fenêtre. */
	limiteBas?: number;
	/** L'INVITE elle-même (son bord gauche et sa largeur, pixels CSS) : quand
	    la place au-dessus d'elle ne suffit pas, le terminal descend et la
	    COUVRE EN ENTIER — au moins aussi large qu'elle — plutôt que de la
	    laisser dépasser sur ses flancs (la règle d'Ahmed : jamais vue en haut
	    ou en bas). */
	inviteX?: number;
	inviteLargeur?: number;
}

/**
 * LES PROCESSUS ET LES FICHIERS DES CLI, vus du code partagé.
 *
 * POURQUOI UNE PORTE : `src/dashboard/ai-providers.ts` faisait dix
 * `require("fs"|"os"|"path"|"child_process")` — lire le cache de modèles de
 * Codex, `~/.claude.json`, lancer `claude --version`, chercher Ollama à ses
 * emplacements d'installation. Dans le rendu de l'application, `require`
 * n'existe pas : chaque sonde aurait dit « non installé » en silence, sans
 * qu'aucune erreur ne le nomme. Tout ce qui touche Node passe donc par l'hôte,
 * et le rendu de l'application n'a jamais que le pont.
 */
export interface HostProcess {
	/** Un CLI lancé SANS RIEN D'INTERACTIF : le prompt complet sur `stdin`,
	    `stdin` fermé, `stdout` et `stderr` rendus SÉPARÉS et À LA FIN, avec le
	    code de sortie. Rejette avec une erreur dont `name` est nommé :
	    `introuvable` (l'exécutable manque), `timeout` (`timeoutMs` dépassé,
	    process tué), `annule` (`signal` abandonné, l'ARBRE de process est tué
	    — `claude` et `codex` spawnent des enfants), `refuse` (outil hors liste,
	    argument incitable, pièces jointes ou `sortieFichier` sans
	    `marqueur` — aucun jeton ne pourrait alors les désigner, et l'appel
	    réussirait en les IGNORANT), `occupe` (un `run` du MÊME outil est déjà en
	    cours : l'hôte n'en lance qu'un à la fois, et le dire vaut mieux que
	    laisser deux générations écrire dans le même terminal),
	    `indisponible` (l'hôte ne sait pas lancer de CLI du tout — Obsidian sur
	    mobile, où il n'y a pas de processus enfants). */
	run(spec: {
		tool: CliTool;
		args: string[];
		stdin: string;
		signal?: AbortSignal;
		timeoutMs?: number;
		/** Le MARQUEUR de cet appel, tiré au sort par `nouveauMarqueur()`
		    (`src/host/jetons.ts`). L'hôte ne substitue QUE les jetons qui le
		    portent — `{{nq-<marqueur>:fichier:N}}`, `{{nq-<marqueur>:sortie}}`,
		    `{{nq-<marqueur>:home}}`, composés par `jetonFichier`/`jetonSortie`/
		    `jetonHome`. Sans lui, AUCUNE substitution n'a lieu.

		    POURQUOI IL EXISTE : `stdin` porte un texte entièrement écrit par
		    l'utilisateur (sa demande, le contenu des notes jointes). Une forme
		    fixe (`{{home}}`) collisionnait avec toute note citant un moteur de
		    gabarits — et faisait partir un chemin absolu de la machine au
		    modèle, qui pouvait le recopier dans le quiz. */
		marqueur?: string;
		/** Les pièces jointes de CET appel. L'hôte crée un dossier temporaire, y
		    écrit chaque fichier, et REMPLACE — dans `args` comme dans `stdin` — le
		    jeton `{{nq-<marqueur>:fichier:N}}` par le chemin absolu du N-ième
		    (1-based). Le rendu compose donc sa ligne de commande sans jamais
		    apprendre un chemin disque. Le dossier est effacé en `finally`,
		    toujours. Un jeton qui ne désigne rien REJETTE (`refuse`) au lieu de
		    s'effacer : un argument vide produirait un appel faux et muet. */
		fichiers?: Array<{ nom: string; base64: string }>;
		/** Un NOM de fichier, relatif au dossier temporaire, que le CLI écrit et que
		    l'appelant veut relire (Codex `-o last-message.txt`). Son contenu est rendu
		    dans `sortie` ; `undefined` si le CLI ne l'a pas écrit. Le chemin absolu à
		    donner au CLI s'écrit `{{nq-<marqueur>:sortie}}` : le code partagé ne sait
		    pas si l'hôte sépare par `/` ou `\`, et le deviner est exactement ce que
		    ces jetons existent pour éviter. */
		sortieFichier?: string;
		/** The CLI's standard output AS IT ARRIVES, in chunks cut anywhere,
		    for the live transcript of a generation (2026-09-29,
		    `dashboard/transcript.ts`). The same text still comes back whole
		    in `stdout` at the end. A host that cannot stream ignores it. */
		onStdout?: (chunk: string) => void;
		/** A RESUME KEY (2026-09-30), stable across a reload of the page:
		    `[A-Za-z0-9_-]{8,120}`. A run launched with one survives its page
		    reloading; the reloaded page calling again with the same key gets
		    the SAME run (its output replayed, then its result) instead of a
		    new one. A host that cannot keep a run alive ignores it. */
		reprise?: string;
	}): Promise<{ stdout: string; stderr: string; code: number | null; sortie?: string }>;
	/** Le fichier de cache/config du CLI, à un chemin FIXE tenu par l'hôte
	    (Codex : `$CODEX_HOME` ou `~/.codex/models_cache.json` ; Claude :
	    `~/.claude.json`), HORS de toute racine — c'est pourquoi `HostFs` ne
	    l'atteint pas. `mtimeMs` sert à l'appelant pour ne pas re-parser ; le
	    PARSING (quels modèles, quels efforts) reste dans le code partagé, l'hôte
	    ne fait que lire et décoder le JSON. `null` = absent ou illisible.

	    `catalogue` (Claude seulement, facultatif) : le catalogue de modèles
	    que Claude Code télécharge lui-même (`~/.claude/cache/model-catalog/
	    <organisation>-…-cc.json`), décodé tel quel — l'équivalent du
	    `models_cache.json` de Codex. `~/.claude.json` seul ne garde que la
	    dernière session de chaque projet : le menu est resté figé sur
	    « Opus 5 » (2026-09-23). Un hôte qui ne sait pas le lire l'omet, et le
	    code partagé retombe sur `~/.claude.json`. */
	lireCache(tool: "claude" | "codex"): Promise<{ mtimeMs: number; json: unknown; catalogue?: unknown } | null>;
	/** Ollama est-il INSTALLÉ, même serveur arrêté ? `ollama --version`
	    répond, ou l'exécutable est à un emplacement d'installation officiel.
	    Le greffon diagnostique lui-même : jamais un « si Ollama n'est pas
	    installé » laissé à l'utilisateur. */
	ollamaInstalle(): Promise<boolean>;
	/** Démarre l'application Ollama (le serveur démarre avec elle), détachée,
	    best-effort : `false` quand rien n'a pu être lancé. L'appelant constate
	    le résultat en interrogeant le serveur, pas ici. */
	demarrerOllama(): Promise<boolean>;
	/** Opens a plain PowerShell window in the user's home folder and runs
	    NOTHING in it (2026-09-30): the manual install path of the install
	    window ("Open a terminal"), where the user pastes the command shown
	    there. It takes NO argument on purpose: no name, no command, no path
	    crosses from the renderer, so the capability cannot run anything. `lance`:
	    the window was opened; `indisponible`: the host cannot open a terminal
	    (not Windows) or the launch failed. */
	openTerminal(): Promise<"lance" | "indisponible">;
	/** Ouvre un terminal VISIBLE qui CONNECTE le compte d'un outil DÉJÀ
	    installé (`codex login`, `claude auth login`). Verdicts : `lance`,
	    `annule`, `indisponible`. Le rendu n'envoie qu'un NOM, jugé par l'hôte ;
	    la recette vit chez lui. Connecter ne lance qu'un exécutable déjà
	    présent et déjà sur la liste blanche (l'installation automatique, qui
	    téléchargeait puis exécutait un script distant, n'existe plus depuis le
	    2026-09-30).

	    `ollama` n'a pas de compte : l'hôte rend `indisponible` plutôt que
	    d'ouvrir un terminal sur rien. */
	connecterCli(tool: CliTool, ancre?: AncreTerminal): Promise<"lance" | "annule" | "indisponible">;
	/** Rend la main quand la fenêtre du DERNIER terminal lancé par
	    `connecterCli` a disparu — tout de suite s'il n'y en
	    a pas, ou s'il n'a jamais été trouvé. C'est ce que le modal
	    d'installation attend pour se fermer : détecter le binaire ne suffit
	    pas, le terminal enchaîne la CONNEXION du compte juste après, et un
	    modal qui disparaît pendant qu'elle se fait laisse croire qu'elle n'a
	    pas eu lieu (Ahmed, 2026-09-20). OPTIONNEL : seul un hôte qui sait
	    guetter une fenêtre l'offre. */
	attendreFinTerminal?(): Promise<void>;
	/** S'abonne à l'instant où la fenêtre du terminal est POSÉE (sous la
	    modale qui attend) : c'est là que cette modale remonte, et pas avant
	    — remontée dès le clic, elle serait en hauteur sans raison (Ahmed,
	    2026-09-20). Rend de quoi se désabonner. OPTIONNEL, comme
	    `attendreFinTerminal` : seul un hôte qui place des fenêtres l'offre. */
	surTerminalPose?(rappel: () => void): () => void;
	/** S'abonne à la réécriture des fichiers de modèles d'un CLI
	    (`~/.claude.json`, le catalogue de Claude Code, `models_cache.json` de
	    Codex) : le menu des modèles se redessine en direct au lieu d'attendre
	    le prochain clic. Rend de quoi se désabonner. OPTIONNEL : un hôte sans
	    surveillant (le greffon) garde la relecture à l'ouverture du menu. */
	surCachesCli?(rappel: (tool: "claude" | "codex") => void): () => void;
	/** S'abonne à l'ouverture du NAVIGATEUR de la connexion : il prend la
	    moitié gauche de l'écran, Neo Quiz la moitié droite (Ahmed,
	    2026-09-20), et la modale a donc bougé — à elle de se remesurer et de
	    rendre son nouveau rectangle par `replacerTerminal`, sous lequel le
	    terminal est reposé. OPTIONNEL, comme les deux voisins. */
	surNavigateurOuvert?(rappel: () => void): () => void;
	/** Repose la fenêtre du terminal sous ce rectangle. */
	replacerTerminal?(ancre: AncreTerminal): Promise<void>;
	/** L'état des comptes IA que seul l'hôte peut lire. Le contrat ne promet
	    JAMAIS de jeton : un hôte qui en ferait traverser un violerait la seule
	    règle de cette capacité.

	    `outils` FILTRE la lecture (Ahmed, 2026-09-21) : sans lui, les trois
	    sondes tournent, dont `agy models` (~1 s, un aller-retour réseau). Les
	    sondes PÉRIODIQUES d'un flux de connexion (`comptes.ts`, `ai.ts`, trois
	    secondes) n'ont besoin que d'un seul outil ; lire les trois à chaque
	    tick y lance des dizaines d'appels sans rapport avec ce que
	    l'utilisateur fait. La section « Comptes » continue de demander les
	    trois d'un coup en omettant ce paramètre. */
	etatComptes(outils?: EtatCompte["outil"][]): Promise<EtatCompte[]>;
	/** Les quotas du forfait, pour les deux fournisseurs qui les publient. */
	usageCompte(tool: "claude" | "codex"): Promise<UsageRead>;
	/** Déconnecte le compte d'un CLI. Vaut pour TOUTE la machine : c'est le
	    compte de l'outil, pas celui de l'application. L'appelant confirme. */
	deconnecterCli(tool: CliTool): Promise<"ok" | "echec" | "indisponible">;
	/** Ouvre un terminal VISIBLE où le CLI tourne INTERACTIF, pour ce
	    qu'aucune lecture ne sait obtenir : Antigravity ne publie son quota que
	    dans son propre REPL (commande `/usage`), ni en HTTP ni sur une page
	    web. Mêmes verdicts qu'`connecterCli` sans `annule` — rien n'est
	    téléchargé ni confirmé, seul part un exécutable déjà sur la liste
	    blanche. Liste PLUS ÉTROITE que `connecterCli` : seul `agy` est servi,
	    les trois autres ont une lecture directe (`usageCompte`) ou une page
	    web — l'hôte rend `indisponible` plutôt qu'un terminal sur rien. */
	terminalUsageCli(tool: CliTool): Promise<"lance" | "indisponible">;
}

/**
 * Une RACINE : un dossier de quiz ouvert.
 *
 * Le greffon n'en a qu'une (le vault) ; l'application peut en ouvrir
 * jusqu'à dix. C'est la seule différence que le code partagé doit
 * connaître, et il la connaît par ce type — jamais par un test d'hôte.
 */
export interface HostRoot {
	/** Identifiant, et PREMIER SEGMENT des chemins du contrat qui en
	    relèvent. Chaîne VIDE quand l'hôte n'a qu'une racine : les chemins
	    du greffon restent alors exactement ce qu'ils ont toujours été. */
	id: string;
	/** Nom affichable (le dossier choisi, le vault). */
	name: string;
	/** Le journal de révision de cette racine, en chemin du CONTRAT. */
	reviewLog: string;
	/** The directory holding one review log per device
	    (`<root>/.neo-quiz/journal`), in CONTRACT path. */
	reviewJournalDir: string;
	/** This device's identifier: names its own log file in `reviewJournalDir`. */
	deviceId: string;
	/** L'ANCIEN journal (celui que le greffon écrivait à côté de lui), en
	    chemin du contrat, ou `null` quand l'hôte sait qu'il n'y en a pas.
	    C'est l'hôte qui le sait : le greffon lit `manifest.dir`,
	    l'application compose le chemin conventionnel. */
	legacyReviewLog: string | null;
	/** Cette racine est-elle un vault Obsidian ? L'hôte seul le sait :
	    le greffon VIT dans un vault, l'application l'a mesuré au démarrage
	    (la présence d'un dossier `.obsidian`) pour chaque dossier ouvert.
	    Sert à MARQUER un dossier dans l'interface, jamais à décider où
	    écrire : le journal de révision est au même endroit dans les deux
	    cas, et le faire dépendre de ceci scinderait l'historique le jour
	    où un dossier devient un vault. */
	vault: boolean;
	/** The root's ABSOLUTE path on the disk (forward slashes), when the host knows it. Used only to
	    measure a path against the file system's own limit (Windows' 260); never to build a path. */
	diskPath?: string;
}

export interface HostPaths {
	/**
	 * Dossier des exports de résultats POUR une note donnée.
	 * Une FONCTION et non une constante depuis que l'application ouvre
	 * plusieurs dossiers : une constante enverrait les résultats d'un quiz
	 * du dossier B dans le dossier A.
	 * Côté Obsidian elle ignore son argument et rend toujours
	 * « .obsidian/quiz-blocks-results », qui NE CHANGE PAS.
	 */
	resultsDirFor(sourcePath: string): string;
	/**
	 * Chemin LIBRE où ranger une pièce jointe de la note `sourcePath`.
	 *
	 * L'hôte décide du DOSSIER, jamais l'appelant : sous Obsidian c'est un
	 * réglage de l'utilisateur (« dossier des pièces jointes »), qui a des
	 * modes relatifs à la note — et le calculer nous-mêmes rangerait l'image
	 * ailleurs que là où l'utilisateur l'a demandé.
	 *
	 * « LIBRE » veut dire : la cible n'existe pas au moment où elle est rendue.
	 * L'appelant reste tenu de RÉSERVER le nom (`src/unique-path.ts`) s'il en
	 * demande deux coup sur coup : mesuré sous Obsidian, deux appels
	 * rapprochés rendent le MÊME chemin tant que le fichier n'existe pas, et la
	 * seconde image écrasait la première. AUCUN hôte ne réserve à sa place —
	 * s'il le faisait, la réservation de l'appelant tomberait sur un nom déjà
	 * pris par l'hôte lui-même et sauterait au suivant : chaque collage
	 * sortirait en « ….-2.png », et le nom de base resterait brûlé sans jamais
	 * être écrit.
	 *
	 * `sourcePath` est OPTIONNEL, et les deux hôtes n'en font PAS la même
	 * chose — le contrat ne promet donc rien de plus que « l'hôte décide ».
	 * Obsidian retombe sur le fichier ACTIF de sa fenêtre. L'application, elle,
	 * REJETTE avec une cause nommée : elle n'a pas de fichier actif, et choisir
	 * une racine parmi les dix qu'elle peut ouvrir poserait l'image hors de la
	 * racine où la note finira — où la résolution de liens, BORNÉE à cette
	 * racine, ne la retrouverait plus, et l'image serait perdue en silence.
	 * Un appelant sans note (page « Générer », `QuizDraft.file === null`) doit
	 * donc savoir où va le quiz AVANT d'y coller une image.
	 */
	attachmentPathFor(name: string, sourcePath?: string): Promise<string>;
	/** Les racines ouvertes, dans l'ordre d'affichage. */
	roots(): HostRoot[];
	/**
	 * La racine PAR DÉFAUT : où va un quiz généré, ou « Nouveau quiz » sans
	 * dossier choisi. Sous Obsidian c'est la seule racine (le vault) ;
	 * dans l'application c'est le dossier « Neo Quiz » créé au lancement.
	 */
	defaultRoot(): HostRoot;
	/** La racine dont relève un chemin du contrat, ou `null`. */
	rootOf(path: string): HostRoot | null;
	/**
	 * Le chemin RELATIF À SA RACINE — c'est-à-dire la CLÉ DU JOURNAL.
	 * Elle doit être identique sous les deux hôtes pour la même note :
	 * « Cours/reseau.md », jamais « Efrei/Cours/reseau.md » ni un chemin
	 * absolu. Un hôte qui recomposerait cette clé ailleurs ferait diverger
	 * les deux historiques sans que personne ne le voie.
	 */
	localPath(path: string): string;
	/** L'inverse : le chemin du contrat d'une clé locale dans une racine. */
	contractPath(rootId: string, localPath: string): string;
}

/** Ce qu'une modale ouverte rend à son ouvreur. */
export interface HostModalHandle {
	/** LE PANNEAU. Exposé parce qu'un menu ouvert depuis une modale doit s'y
	    portaler et non au `body` : portalé au body, il passe DERRIÈRE le
	    panneau et le focus retourne au fond (module-edit.ts:118 et :202). */
	readonly panelEl: HTMLElement;
	/** Le corps, où l'appelant construit son contenu. L'hôte le vide à la
	    fermeture : aucun appelant n'a à le faire. */
	readonly contentEl: HTMLElement;
	/* PAS de `setTitle` : le titre se pose une fois par `spec.title`, et aucune
	   des dix modales du dépôt ne se renomme en cours de route. Le membre a
	   existé, sans appelant ni cas — donc sans preuve —, et il aurait fini
	   implémenté une troisième fois par Android. */
	close(): void;
}

export interface HostModalSpec {
	/** Classe(s) posée(s) sur le PANNEAU (« qbd-create-modal »,
	    « qbd-medit-modal »), comme un attribut `class` : plusieurs, séparées
	    par des espaces, sont admises. Le CSS partagé les cible déjà ; l'hôte
	    ne les choisit pas. */
	className?: string;
	title?: string;
	/**
	 * Remplit une marque posée AVANT le titre, sur sa ligne. Sert au logo du
	 * fournisseur dans le modal d'installation ; ignoré s'il n'y a pas de
	 * titre.
	 *
	 * UN RAPPEL, ET NON UNE CHAÎNE DE HTML : le contrat ne fait jamais voyager
	 * du balisage. L'appelant dessine ce qu'il veut dans l'élément qu'on lui
	 * donne, l'hôte ne fournit que l'emplacement, et aucune des quatre portes
	 * du sanitizer (`CLAUDE.md`, « Texte et HTML d'un quiz ») n'est contournée
	 * — un `titleHtml` en aurait ouvert une cinquième pour rien.
	 */
	titleIcon?(el: HTMLElement): void;
	/** Construit le contenu. Appelé une fois, après attachement — un appelant
	    qui mesure un élément doit pouvoir le faire ici. */
	onOpen(handle: HostModalHandle): void;
	/** Appelé APRÈS la disparition, jamais avant : `module-edit.ts` y écrit
	    ses changements sur le disque, et le faire pendant l'animation
	    rendrait l'écriture concurrente d'un rendu. */
	onClose?(): void;
}

export interface HostModals {
	/** Ouvre une modale. Elle est modale au sens strict : Échap et un clic sur
	    le fond la ferment, et l'hôte rend le focus à ce qui l'avait. */
	open(spec: HostModalSpec): HostModalHandle;
}

/**
 * LE TEXTE D'UN PDF — un membre OPTIONNEL, et c'est une divergence ÉCRITE.
 *
 * La page « Générer » accepte un PDF en pièce jointe et en extrait le texte
 * localement. Sous Obsidian, c'est `loadPdfJs()` — le pdf.js EMBARQUÉ de
 * l'application, worker déjà configuré, aucune dépendance ajoutée. L'application
 * Windows n'embarque pas pdf.js (tranche 5, tâche 6, tranché) : elle n'a pas ce
 * membre, et la page REFUSE le PDF avec la Notice `ai.error.pdfUnsupportedInApp`
 * au lieu de le joindre vide en silence. Une tranche future peut poser pdf.js
 * côté app en implémentant ce seul membre, sans toucher `ai.ts`.
 *
 * `data` : les OCTETS, pas un `HostFile` — un PDF déposé ou choisi par le
 * dialogue de fichiers n'a pas de chemin du contrat, seulement son contenu.
 */
export interface HostPdf {
	/** Le texte de toutes les pages, une section par page. Chaîne vide pour un
	    PDF scanné (sans couche texte) : c'est à l'appelant de le dire. */
	extractText(data: Uint8Array): Promise<string>;
	/**
	 * Les pages DESSINÉES, en images (`data:` URL PNG), à la largeur demandée
	 * — pour la vignette d'une carte de pièce jointe et l'aperçu d'une modale
	 * (référence claude.ai, Ahmed 2026-09-17). `max` borne le nombre de pages
	 * rendues ; `total` est le nombre de pages du document, rendues ou non.
	 * OPTIONNEL, comme le membre lui-même : un hôte qui sait lire le texte
	 * mais pas dessiner rend la carte sans vignette et l'aperçu en texte.
	 */
	renderPages?(data: Uint8Array, opts: { width: number; max?: number }): Promise<{ pages: string[]; total: number }>;
}

/**
 * LA LECTURE D'UNE VIDÉO YOUTUBE — un membre OPTIONNEL, et c'est une
 * divergence ÉCRITE (spec docs/superpowers/specs/2026-09-22-videos-youtube
 * -design.md, § 3.3). Le composer accepte un lien YouTube dans la demande et
 * joint sa transcription (dans la langue d'origine) comme un document.
 * L'application Windows l'implémente par le pont (`apps/windows/electron/
 * video.ts` trouve et lance yt-dlp) ; le greffon Obsidian ne l'a PAS — et le
 * composer n'affiche alors ni tuile ni notice. Un hôte mobile n'aura rien à
 * écrire pour le refuser : le membre reste absent.
 *
 * CE QUI TRAVERSE : un IDENTIFIANT de vidéo (11 caractères, regex
 * `ID_VIDEO` du noyau `src/video/youtube.ts`), revalidé PAR L'HÔTE AVANT
 * tout lancement — jamais une URL, que l'hôte reconstruit lui-même. Les
 * erreurs portent leur `code` (`absent`, `reseau`, `pasDeSousTitres`,
 * `videoIndisponible`, `delai`, `annule`, `inconnue`) et le `detail` de
 * journal (stderr, jamais traduit) ; le message d'interface est une
 * décision de l'appelant, pas de l'hôte.
 */
export interface HostVideo {
	/** yt-dlp est-il résolu, et d'où : la copie gérée par l'application
	    (« app »), un yt-dlp du PATH étendu (« systeme »), ou rien (`null` —
	    l'état NORMAL d'une machine sans yt-dlp, pas une panne). */
	etat(): Promise<{ present: boolean; source: "app" | "systeme" | null }>;
	/** Les infos de la release officielle, pour la modale d'installation.
	    Tout `null` hors ligne (la modale dit « dernière version publiée »),
	    et `url` reste cliquable quoi qu'il arrive. */
	infosInstallation(): Promise<{ version: string | null; datePublication: string | null; taille: number | null; url: string }>;
	/** Installe la copie gérée depuis la release officielle (empreinte
	    SHA-256 vérifiée, rien sur le disque en cas d'échec). La progression
	    est portée en OCTETS (`recus` à cet instant, `total` lu par HEAD,
	    `null` quand il est ignoré). Rejette `{ code: "reseau" | "empreinte" }`. */
	installer(surProgression: (recus: number, total: number | null) => void): Promise<void>;
	/** Transcrit la vidéo `id` — revalidé par l'hôte AVANT tout
	    lancement, et l'URL est reconstruite par lui : le rendu ne peut
	    faire passer qu'un identifiant. Rend le document markdown joint à
	    la demande, son nom de fichier, la fiche réduite et la miniature
	    en `data:` URI (jamais une URL distante). Rejette
	    `{ code, detail? }` — voir l'en-tête. */
	transcrire(id: string): Promise<{ document: string; nom: string; titre: string; dureeS: number | null; langue: string | null; type: "manuel" | "auto"; miniature: string | null }>;
	/** Abandonne les transcriptions vivantes de cet identifiant : l'arbre
	    de yt-dlp est tué, et chacune rejette `{ code: "annule" }`. Un
	    identifiant sans transcription vivante (jamais lancée, déjà finie)
	    est ignoré. */
	annuler(id: string): void;
}

/** A program to run in the sandbox — see `HostCode`. */
export interface CodeJob {
	language: CodeLanguage;
	code: string;
	stdin: string;
	after?: string;
	timeoutMs: number;
}
/** What the sandbox returns, never more than these fields. `compile-error`:
    the compiler refused the program; `error` carries its message. */
export interface CodeRun {
	status: "ok" | "error" | "compile-error" | "timeout" | "too-long" | "unavailable" | "not-installed";
	stdout: string;
	error?: string;
}
/** THE CODE SANDBOX — an OPTIONAL member, the app only
    (apps/windows/electron/code-sandbox.ts). The plugin runs nothing. */
export interface HostCode {
	/** Languages ▶ may offer now: ENABLED ones (per-language switch
	    `languagesDisabled`), installed or downloadable. */
	languages(): readonly CodeLanguage[];
	run(job: CodeJob): Promise<CodeRun>;
	/** Loads the engine in the background; no effect if already loaded. */
	warm(language: CodeLanguage): void;
	/** Downloads the engine of a language that answered `not-installed`
	    (the C/C++ pack, apps/windows/electron/langages.ts), reporting whole
	    percents. `offline`: it could not be downloaded; `refused`: it was,
	    but failed its integrity check and was not installed. OPTIONAL: a
	    host whose languages are all built in has nothing to download. */
	installer?(language: CodeLanguage, onProgress: (percent: number) => void): Promise<"ok" | "offline" | "refused">;
}

/**
 * L'attente d'une réponse COPIÉE, pendant une génération par un site (spec
 * 2026-09-18, §4). Le principal sonde le presse-papier et ne livre que le
 * texte qui porte le jeton ; le rendu ne lit rien lui-même. Membre OPTIONNEL :
 * absent sous le greffon, la page attend alors un collage manuel.
 */
export interface HostCollage {
	/** Démarre l'attente ; la fonction rendue l'arrête. Une nouvelle attente
	    remplace la précédente. `surTexte` est appelé AU PLUS une fois. */
	attendre(jeton: string, surTexte: (texte: string) => void): () => void;
}

/**
 * DISPOSER LES FENÊTRES POUR UN SITE, ET GLISSER UN FICHIER DEPUIS
 * L'APPLICATION — un membre OPTIONNEL, l'application seule.
 *
 * Un site (claude.ai) n'accepte un fichier que par un geste de l'utilisateur
 * dans sa page : aucune application ne peut lui en pousser un. Ce que Neo
 * Quiz peut faire, c'est se mettre en position : le site dans la moitié
 * gauche de l'écran, l'application dans la moitié droite, et les pièces
 * jointes affichées dans la carte d'attente comme des tuiles qu'on GLISSE
 * vers le site — c'est le vrai fichier du disque qui part (glisser-déposer
 * natif, `webContents.startDrag`), pas une copie. Plus d'Explorateur à
 * ouvrir : il se dessinait à son ancienne place avant qu'on puisse le poser
 * (Ahmed, 2026-09-19). Le PDF arrive comme un vrai PDF, et le prompt tient
 * toujours dans l'adresse.
 *
 * Les fichiers sont désignés comme pour `HostShell.openExternal` : un
 * `HostFile` du contrat, ou un chemin ABSOLU déjà admis par l'hôte.
 */
/** L'image qui suit le curseur pendant un glisser (`HostDepot.glisser`) : un
    PNG en `data:` URL, dessiné à l'échelle `echelle` de l'écran. */
export interface ImageDeGlisser {
	png: string;
	echelle: number;
}

/** Ce qu'un glisser a donné. `depose` : le bouton a été relâché HORS de la
    fenêtre de l'application — donc, dans la disposition d'un site, sur le
    navigateur à gauche : c'est le mieux qu'un hôte puisse savoir, la cible
    ne dit jamais si elle a accepté. `revenu` : relâché dans l'application,
    le geste n'a rien déposé. `impossible` : rien n'a pu partir (fichiers
    hors périmètre, disparus). */
export type ResultatGlisser = "depose" | "revenu" | "impossible";

export interface HostDepot {
	/** Le site à gauche, l'application à droite (sur l'écran de l'application).
	    À appeler AVANT d'ouvrir le site : l'hôte guette la fenêtre du
	    navigateur et la pose dès qu'elle naît.

	    `coller` : le prompt est déjà dans le presse-papier (le site n'a pas
	    de paramètre qui préremplisse, ou le texte n'a pas tenu dans
	    l'adresse), et l'hôte le COLLE lui-même dans la fenêtre du navigateur
	    une fois la page chargée — un Ctrl+V envoyé à la fenêtre, quand son
	    titre a cessé de changer. Meilleur effort : si la page tarde, si un
	    autre champ a le focus (une page de connexion), le collage tombe à
	    côté et la carte d'attente, qui dit toujours de coller, reste le filet.
	    Demandé le 2026-09-20 pour gemini.google.com et chat.deepseek.com :
	    « juste glisser les fichiers et appuyer sur Entrée ». */
	disposer(options?: { coller?: boolean }): Promise<void>;
	/** PRÉSENT quand l'hôte colle lui-même le prompt (voir `disposer`) : la
	    carte d'attente n'affiche alors pas l'étape « collez ». Ne fait rien
	    d'autre ; le greffon ne l'a pas. */
	surColle?(): void;
	/** Prépare le glisser : l'hôte extrait d'avance l'image que le curseur
	    portera (l'icône de type de fichier de Windows, ~300 ms la première
	    fois par extension) — le `dragstart` n'attend pas. À appeler quand les
	    tuiles s'affichent. */
	preparer(fichiers: Array<HostFile | string>): Promise<void>;
	/** Pose une pièce jointe SANS chemin (image collée, fichier déposé depuis
	    l'Explorateur) dans un fichier que l'hôte pourra glisser, et rend son
	    chemin ; `null` si l'hôte refuse (nom exécutable, trop gros). */
	ecrire(nom: string, octets: Uint8Array): Promise<string | null>;
	/** Démarre le glisser-déposer natif de TOUS ces fichiers, d'un seul geste
	    (Ahmed, 2026-09-19 : « on ne doit jamais se retrouver à devoir
	    glisser plusieurs fichiers un par un ») ; à appeler depuis un écouteur
	    `dragstart`, après `preventDefault`. `saisi` : l'index du fichier sous
	    le curseur — c'est SON icône qui part avec le geste, comme dans
	    l'Explorateur. `false` si aucun ne peut être glissé (hors périmètre,
	    disparu) ; ceux qui le peuvent partent. */
	glisser(fichiers: Array<HostFile | string>, saisi?: number, image?: ImageDeGlisser): Promise<ResultatGlisser>;
	/** La fin : l'application reprend sa taille d'avant, centrée, et revient au
	    premier plan ; le site reste derrière. Sans effet sans `disposer`. */
	terminer(): Promise<void>;
}

export interface Host {
	fs: HostFs;
	links: HostLinks;
	watcher: HostWatcher;
	ui: HostUi;
	math: HostMath;
	shell: HostShell;
	platform: HostPlatform;
	paths: HostPaths;
	/** Un membre OPTIONNEL du contrat, exigé : le greffon lecteur ne fournit
	    ni `process`, ni `net`, ni `modals` ; une page qui les demande est une
	    page que le greffon n'a plus. L'erreur nomme le membre. */
	modals?: HostModals;
	net?: HostNet;
	process?: HostProcess;
	/** Absent quand l'hôte n'a pas de moteur PDF — voir `HostPdf`. */
	pdf?: HostPdf;
	/** Absent sous le greffon — voir `HostVideo`. */
	video?: HostVideo;
	/** Absent under the plugin — see `HostCode`. */
	code?: HostCode;
	/** Absent sous le greffon — voir `HostCollage`. */
	collage?: HostCollage;
	/** Absent sous le greffon — voir `HostDepot`. */
	depot?: HostDepot;
}
