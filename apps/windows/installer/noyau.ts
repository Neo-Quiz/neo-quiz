/* ══════════════════════════════════════════════════════════
   NOYAU PUR DU BOOTSTRAPPER D'INSTALLATION

   Ce module contient les décisions qui ne doivent dépendre ni d'Electron ni
   du réseau : où lire la description de la dernière release, quel paquet en
   est installable, quelle empreinte est exigée, et quels arguments sont donnés
   au NSIS déjà produit par electron-builder. Le processus principal et le
   travailleur élevé consomment ces fonctions ; le contrôle `check:installer`
   charge donc le code RÉEL.
══════════════════════════════════════════════════════════ */

/** Le dépôt d'où viennent le paquet ET sa description : le bootstrapper ne
    télécharge jamais ailleurs, quoi que dise un fichier. */
const DEPOT_RELEASES = "https://github.com/Neo-Quiz/neo-quiz/releases";

/** Le `latest.yml` de la dernière release, par la redirection
    `releases/latest/download/…` de github.com. Ce n'est plus la lecture
    NORMALE du bootstrapper (voir `urlLatestYml`), seulement son repli.

    JAMAIS `api.github.com/…/releases/latest` : sans jeton, l'API REST est
    plafonnée à 60 requêtes par heure et par adresse IP, partagées entre tous
    les utilisateurs d'un même NAT (fac, entreprise, 4G) et tous les outils
    de la machine. Le bootstrapper 1.0.16 la lisait ; il s'ouvrait sur
    « La version actuelle de Neo Quiz n'a pas pu être préparée » dès le 61e
    lancement de l'heure — et chaque « Réessayer » comptait pour un. La
    redirection de github.com, elle, n'a pas ce plafond : c'est par elle que
    chaque application electron-updater du monde trouve sa mise à jour. */
export const URL_LATEST_YML = `${DEPOT_RELEASES}/latest/download/latest.yml`;

/** Une version publiable, `X.Y.Z` et rien d'autre. Tout ce qui s'en écarte
    vaut `null` : la version entre dans une URL, et un segment comme `..`
    ou `/` venu d'un `package.json` trafiqué ne doit jamais s'y retrouver. */
export function versionEpinglee(version: unknown): string | null {
	const texte = String(version ?? "");
	return /^\d+\.\d+\.\d+$/.test(texte) ? texte : null;
}

/** La description de la release DONT CE BOOTSTRAPPER EST ISSU — pas la
    dernière. Jusqu'à la 1.5.0, `NeoQuiz-X.Y.Z.exe` lisait `latest` : un exe
    nommé 1.4.0 installait la 1.5.0. Surprise pour qui l'avait gardé, et
    surtout ce qui interdisait à la page de téléchargement de le servir pour
    une ancienne version — elle devait donner le NSIS brut, sans la fenêtre
    d'installation, sous un autre nom. Épinglé, il fait ce que son nom dit,
    et la page peut le servir pour chaque version publiée depuis.

    Chaque release porte son `latest.yml` (electron-builder l'écrit à chaque
    build, `release.yml` l'attache) : l'adresse existe toujours pour une
    version publiée. Une version qui n'est PAS `X.Y.Z` — la répétition
    `0.0.0-repetition` de la CI, ou un `package.json` abîmé — retombe sur
    `latest` plutôt que de composer une URL avec ce qu'on lui donne. */
export function urlLatestYml(version: unknown): string {
	const epinglee = versionEpinglee(version);
	return epinglee
		? `${DEPOT_RELEASES}/download/desktop-v${epinglee}/latest.yml`
		: URL_LATEST_YML;
}

export interface PaquetInstallable {
	version: string;
	nom: string;
	url: string;
	taille: number;
	/** Base64, tel qu'electron-builder l'écrit — et tel que `check:package`
	    le compare à l'exe réel avant chaque publication. */
	sha512: string;
	/** Poids du logiciel une fois installé, publié par la CI sous la clé
	    racine `installedSize` de `latest.yml` (somme du dossier `win-unpacked`
	    qu'elle vient de construire). `null` pour toute release qui ne la porte
	    pas encore (1.0.0, 1.0.1) ou dont la valeur est invalide : le
	    pourcentage d'installation retombe alors sur une barre indéterminée,
	    jamais sur une valeur devinée. */
	tailleInstallee: number | null;
}

/** Candidat à valider : ce qu'on a lu d'un `latest.yml`, ou ce que le
    travailleur élevé reçoit du principal et ne croit pas sur parole. */
export interface CandidatPaquet {
	version: string;
	nom: string;
	taille: number;
	sha512: string;
	/** Non encore validée : `paquetInstallable` applique la même sévérité que
	    les autres champs (entier, positif, plus grand que le setup) et
	    retombe sur `null` plutôt que de refuser tout le paquet. */
	tailleInstallee?: number | null;
}

/** Une version publiée, sans suffixe : `releases/latest` ne sert jamais une
    pré-version (le workflow marque `prerelease` tout tag portant un `-`),
    et la refuser ici rend l'invariant explicite au lieu de le déléguer. */
const VERSION_PUBLIEE = /^\d+\.\d+\.\d+$/;
/** 64 octets en base64 : 86 caractères puis `==`. */
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

/** Ne retient que le NSIS VERSIONNÉ (`neo-quiz-setup-X.Y.Z.exe`). Un ancien
    alias `neo-quiz-setup.exe` peut subsister dans une release historique : il
    n'est jamais une source de version et le site ne le distribue plus comme
    point d'entrée. L'URL est CONSTRUITE depuis la version, jamais lue : le
    fichier ne peut pas rediriger le téléchargement hors du dépôt. */
export function paquetInstallable(candidat: CandidatPaquet): PaquetInstallable | null {
	const { version, nom, taille, sha512, tailleInstallee } = candidat;
	if (!VERSION_PUBLIEE.test(version)) return null;
	if (nom !== `neo-quiz-setup-${version}.exe`) return null;
	if (!Number.isInteger(taille) || taille <= 0) return null;
	if (!SHA512_BASE64.test(sha512)) return null;
	/* Un logiciel installé pèse toujours plus que son installeur compressé :
	   une valeur qui ne respecte pas ça (absente, non entière, nulle,
	   négative, ou plus petite que `taille`) n'est pas une ERREUR de paquet,
	   c'est simplement une release sans cette information — `null`, jamais
	   une exception qui invaliderait tout le paquet. */
	const tailleInstalleeValidee =
		Number.isInteger(tailleInstallee) && (tailleInstallee as number) > taille
			? (tailleInstallee as number)
			: null;
	return {
		version,
		nom,
		url: `${DEPOT_RELEASES}/download/desktop-v${version}/${nom}`,
		taille,
		sha512,
		tailleInstallee: tailleInstalleeValidee,
	};
}

/** Le sous-ensemble de YAML qu'electron-builder écrit dans `latest.yml` :
    des `clé: valeur` au niveau racine, et sous `files:` une liste d'entrées
    `- url: …` suivies de leurs clés indentées. Pas de bibliothèque YAML : le
    format est fixe, et un analyseur complet accepterait bien plus que lui. */
function lireLatestYml(texte: string): { racine: Map<string, string>; fichiers: Map<string, string>[] } {
	const racine = new Map<string, string>();
	const fichiers: Map<string, string>[] = [];
	let dansFiles = false;
	for (const ligne of texte.split(/\r?\n/)) {
		const m = /^(\s*)(-\s+)?([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(ligne);
		if (!m) continue;
		const [, indentation, tiret, cle, brut] = m;
		const valeur = brut.replace(/^(['"])(.*)\1$/, "$2");
		if (indentation === "" && !tiret) {
			dansFiles = cle === "files";
			if (!dansFiles) racine.set(cle, valeur);
			continue;
		}
		if (!dansFiles) continue;
		if (tiret) fichiers.push(new Map([[cle, valeur]]));
		else fichiers.at(-1)?.set(cle, valeur);
	}
	return { racine, fichiers };
}

/** La dernière release installable d'après son `latest.yml`, ou `null` si le
    fichier ne décrit pas exactement UN NSIS versionné, avec sa taille et son
    empreinte, cohérentes entre la racine et l'entrée `files`. */
export function resoudrePaquet(latestYml: string): PaquetInstallable | null {
	const { racine, fichiers } = lireLatestYml(latestYml);
	const version = racine.get("version");
	const nom = racine.get("path");
	const sha512 = racine.get("sha512");
	if (!version || !nom || !sha512) return null;
	const entree = fichiers.find(f => f.get("url") === nom);
	if (!entree || entree.get("sha512") !== sha512) return null;
	const taille = Number(entree.get("size"));
	/* Clé racine facultative, ignorée d'electron-updater comme de tout lecteur
	   qui ne la connaît pas : absente sur les releases publiées avant elle. */
	const installedSize = racine.get("installedSize");
	const tailleInstallee = installedSize === undefined ? null : Number(installedSize);
	return paquetInstallable({ version, nom, taille, sha512, tailleInstallee });
}

/* ─────────── le pourcentage d'installation ───────────

   CE QUE NSIS FAIT VRAIMENT, mesuré le 2026-09-16 par
   `scripts/mesurer-installation.mjs` sur les deux scénarios (NVMe, Defender
   actif), en sondant toutes les 100 ms le dossier d'installation ET le
   dossier temporaire de NSIS :

     étape                                    neuve (6,9 s)   mise à jour (10,5 s)
     1. démarrage (plugins, antivirus)        0 → 3,1 s        0 → 3,4 s
     2. désinstallation de l'ancienne version      —           3,4 → 6,9 s
     3. archive recopiée puis EXTRAITE
        dans le dossier temporaire             3,1 → 4,3 s     6,9 → 8,5 s
     4. mise en place dans le dossier          4,9 → 5,7 s     8,7 → 9,4 s
     5. registre, raccourcis, désinstalleur    5,7 → 6,9 s     9,4 → 10,5 s

   LE DÉFAUT CORRIGÉ : jusqu'au 2026-09-16 le pourcentage ne comptait que les
   octets du DOSSIER D'INSTALLATION — l'étape 4, soit 6 à 12 % de la durée, et
   tout à la fin. Les étapes 1 et 2 le laissent à zéro (en mise à jour il reste
   même PLEIN jusqu'à disparaître d'un coup en 200 ms), l'étape 3 n'y touche
   pas du tout. La barre restait donc morte neuf secondes puis publiait trois
   valeurs en six cents millisecondes. Aucun réglage du calcul ne pouvait
   réparer ça : le capteur était le mauvais.

   LE CAPTEUR RETENU : les étapes 3 et 4 sont les DEUX seules qui écrivent, et
   leur total est connu D'AVANCE depuis `latest.yml` — `paquet + installe`
   pour ce que NSIS entasse dans son dossier temporaire (l'archive PUIS son
   contenu extrait : les deux y coexistent), `installe` pour ce qu'il pose
   enfin dans le dossier d'installation. Elles pilotent la barre à l'octet
   près. Le travailleur donne à NSIS un `TEMP` PRIVÉ (voir `worker.ts`) : ce
   dossier n'est donc pas cherché parmi les `ns*.tmp` de `%TEMP%`, il est à
   nous, et rien d'autre ne peut s'y écrire.

   LES ÉTAPES 1 ET 2 NE DONNENT RIEN — ni octet, ni jalon : NSIS silencieux
   est muet. Elles avancent au temps écoulé, vers un palier qu'elles
   N'ATTEIGNENT JAMAIS (approche asymptotique), et la barre saute au palier
   dès que le premier octet d'extraction arrive. C'est le seul endroit du
   calcul qui ne repose pas sur une observation, et il est borné des deux
   côtés : il ne peut ni dépasser son palier, ni reculer. Une machine plus
   lente que celle de la mesure y ralentit au lieu de s'y figer — c'est
   pourquoi le réglage est une CONSTANTE DE TEMPS et non une durée totale. */

/** Ce que le bootstrapper sait AVANT de lancer NSIS. */
export interface BaremeInstallation {
	/** `size` du NSIS dans `latest.yml` : ce que NSIS recopiera dans son
	    dossier temporaire avant de l'y extraire. */
	paquet: number;
	/** `installedSize` : le poids du logiciel une fois installé. `null` pour
	    une release qui ne le publie pas (1.0.0, 1.0.1) — la jauge reste alors
	    indéterminée de bout en bout, jamais devinée. */
	installe: number | null;
	/** Octets déjà présents dans le dossier d'installation au lancement. Non
	    nul = mise à jour : NSIS commencera par lancer l'ancien désinstalleur,
	    une étape aveugle de plus, et le barème en tient compte. */
	initial: number;
}

/** Ce qu'un sondage observe, une fois dégagé de ce qui n'est pas de
    l'extraction (voir `suivre`). */
export interface ObservationInstallation {
	/** Millisecondes depuis le lancement de NSIS. */
	ecoule: number;
	/** Octets actuellement dans le dossier d'installation. */
	dossier: number;
	/** Le plus PETIT total jamais observé dans ce dossier : une mise à jour
	    commence par le vider, et c'est depuis ce creux que la mise en place
	    se mesure. */
	creux: number;
	/** Octets AJOUTÉS au dossier temporaire de NSIS depuis son propre creux,
	    au plus haut — c'est-à-dire l'extraction, et elle seule. */
	extrait: number;
	/** Dernière valeur publiée : la barre ne recule jamais. */
	dernier: number | null;
}

/** L'état roulant du sondage, d'un passage au suivant. Il vit ici, et non
    dans le travailleur, parce que la façon de dégager l'extraction du reste
    est une DÉCISION — celle qui a coûté le plateau de 1,6 s de la mesure du
    2026-09-16 — et qu'une décision doit être éprouvable sans lancer NSIS. */
export interface SuiviInstallation {
	creux: number;
	creuxTemporaire: number;
	extrait: number;
	dernier: number | null;
}

export function suiviInitial(bareme: BaremeInstallation): SuiviInstallation {
	return {
		creux: bareme.initial,
		/* Aucun creux connu avant le premier sondage : le premier relevé le
		   fixe, quel qu'il soit. */
		creuxTemporaire: Number.POSITIVE_INFINITY,
		extrait: 0,
		dernier: bareme.installe === null ? null : 0,
	};
}

/** Un sondage : met à jour l'état roulant, puis rend le pourcentage à publier.

    LE PIÈGE QU'IL ÉVITE, mesuré le 2026-09-16 : le désinstalleur
    d'electron-builder ne supprime pas l'ancienne version sur place, il DÉPLACE
    le dossier d'installation dans le dossier temporaire puis l'efface de là.
    Pendant quelques centaines de millisecondes, le temporaire pèse donc le
    poids de l'ANCIENNE version (390 Mo dans la mesure) — des octets qui ne
    doivent rien à l'extraction. Comptés comme tels, ils calaient la barre sur
    un maximum que la vraie extraction mettait 1,6 seconde à dépasser.

    La parade : le temporaire a lui aussi un CREUX, et ce creux est REBASÉ
    chaque fois que le dossier d'installation atteint un nouveau plancher —
    c'est exactement l'instant où ce qui s'y trouve est l'ancienne version.
    L'extraction n'est plus alors que ce qui s'est AJOUTÉ depuis. Sur une
    installation neuve, le dossier n'atteint jamais de nouveau plancher : le
    creux du temporaire reste celui du premier sondage, soit zéro, et le calcul
    se réduit au cas simple. */
export function suivre(
	bareme: BaremeInstallation,
	suivi: SuiviInstallation,
	mesure: { ecoule: number; dossier: number; temporaire: number },
): SuiviInstallation {
	let { creux, creuxTemporaire, extrait } = suivi;
	if (mesure.dossier < creux) {
		creux = mesure.dossier;
		creuxTemporaire = mesure.temporaire;
		extrait = 0;
	}
	if (mesure.temporaire < creuxTemporaire) creuxTemporaire = mesure.temporaire;
	/* Le plus haut, et non le courant : NSIS efface son dossier temporaire en
	   partant, et la barre ne doit pas en dépendre. */
	const ajoute = Math.max(0, mesure.temporaire - creuxTemporaire);
	if (ajoute > extrait) extrait = ajoute;
	const dernier = progressionInstallation(bareme, {
		ecoule: mesure.ecoule,
		dossier: mesure.dossier,
		creux,
		extrait,
		dernier: suivi.dernier,
	});
	return { creux, creuxTemporaire, extrait, dernier };
}

/** Les paliers de la barre et la constante de temps de l'étape aveugle qui
    les précède, pour chacun des deux scénarios. Les paliers suivent la part
    du TEMPS que chaque étape prend dans la mesure ci-dessus, pas sa part des
    octets : c'est la durée que l'utilisateur regarde. */
const BAREMES = {
	/* Étape 1 seule avant l'extraction : ~3,1 s des 6,9 s, soit 45 % du temps. */
	neuve: { preparation: 40, extraction: 70, constante: 1_600 },
	/* Étapes 1 ET 2 : ~6,9 s des 10,5 s, soit 66 % du temps. */
	maj: { preparation: 60, extraction: 80, constante: 3_600 },
} as const;

/** Le plafond avant le code de sortie 0 de NSIS : les raccourcis, le registre
    et l'écriture du désinstalleur (étape 5) ne s'observent pas non plus, et
    annoncer 100 % avant que NSIS l'ait dit serait le seul vrai mensonge. */
const PALIER_FIN = 99;

/** Le bruit du dossier temporaire pendant l'étape 1 : les plugins NSIS
    (~136 Ko) et, en mise à jour, la copie de l'ancien désinstalleur
    (~226 Ko). Mesuré à 484 Ko au plus haut ; 4 Mio laissent de la marge sans
    jamais atteindre l'archive, qui pèse plus de cent mégaoctets. */
const SEUIL_EXTRACTION_OCTETS = 4 * 1024 * 1024;

/** Une étape dont NSIS ne dit rien : la barre s'approche du palier sans
    l'atteindre. Le réglage est une constante de temps — à `constante`
    millisecondes la barre a fait 63 % du chemin, au double 86 % — si bien
    qu'une machine deux fois plus lente ralentit au lieu de se figer. */
function approcher(palier: number, ecoule: number, constante: number): number {
	return palier * (1 - Math.exp(-Math.max(0, ecoule) / constante));
}

/** Le pourcentage d'installation, comme fonction PURE de ce qui est observé.
    Sans `installe` publié, `null` de bout en bout — le repli d'avant ce
    correctif, jamais une valeur devinée. */
export function progressionInstallation(
	bareme: BaremeInstallation,
	observation: ObservationInstallation,
): number | null {
	const { paquet, installe, initial } = bareme;
	const { ecoule, dossier, creux, extrait, dernier } = observation;
	if (installe === null || installe <= 0) return null;

	const bareme2 = initial > 0 ? BAREMES.maj : BAREMES.neuve;
	const place = Math.max(0, dossier - creux);

	const extractionCommencee = extrait >= SEUIL_EXTRACTION_OCTETS;

	let valeur: number;
	if (place > 0 && extractionCommencee) {
		/* Étape 4 : la mise en place, à l'octet près, du palier d'extraction
		   jusqu'au plafond.

		   LA GARDE `extractionCommencee` N'EST PAS DÉCORATIVE. Le creux du
		   dossier est un cliquet : il retient le plus bas jamais vu. Or quand la
		   désinstallation de l'ancienne version ÉCHOUE, `un.atomicRMDir`
		   d'electron-builder a déjà déplacé une partie des fichiers hors du
		   dossier — puis il les REMET. Le dossier retrouve sa taille, mais le
		   creux, lui, garde la valeur basse : sans cette garde, `place` valait
		   soudain des centaines de mégaoctets et la barre sautait à 84 % alors
		   que RIEN n'avait été installé (vu à l'écran le 2026-09-16). Un dossier
		   qui grossit n'est une mise en place que si quelque chose a d'abord été
		   extrait ; sinon c'est une désinstallation qui se rétracte. */
		const part = Math.min(1, place / installe);
		valeur = bareme2.extraction + (PALIER_FIN - bareme2.extraction) * part;
	} else if (extractionCommencee) {
		/* Étape 3 : l'archive puis son contenu, à l'octet près. Les deux
		   coexistent dans le dossier temporaire, d'où le total `paquet +
		   installe`. */
		const part = Math.min(1, extrait / (paquet + installe));
		valeur = bareme2.preparation + (bareme2.extraction - bareme2.preparation) * part;
	} else {
		/* Étapes 1 et 2 : rien à observer. */
		valeur = approcher(bareme2.preparation, ecoule, bareme2.constante);
	}

	const borne = Math.max(0, Math.min(PALIER_FIN, valeur));
	return dernier !== null && borne < dernier ? dernier : borne;
}

/** Le binaire posé par NSIS dans le dossier d'installation — `executableName`
    d'`electron-builder.config.mjs`, immuable comme `appId`. Trois endroits le
    cherchent : le travailleur (pour confirmer que l'installation a réussi et
    pour savoir s'il y en avait déjà une), et le principal (pour reconnaître une
    installation existante avant même le clic sur Installer). */
export const NOM_EXECUTABLE = "neo-quiz.exe";

/** Arguments de l'installeur assisté d'electron-builder en mode silencieux.

    `/currentuser` (et non plus `/allusers`, 2026-09-18) : l'installation vit
    dans le profil de l'utilisateur, ce qui supprime l'invite UAC — à
    l'installation comme à CHAQUE mise à jour, qui relance le même installeur.
    Voir `electron-builder.config.mjs`, `nsis.perMachine`, pour ce que ce choix
    implique. Le commutateur est lu par `assistedInstaller.nsh` et l'emporte sur
    ce que le registre contient : sans lui, une installation machine trouvée
    dans `HKLM` ferait repartir NSIS en mode machine, donc en UAC.

    `/D=` est spécial chez NSIS : electron-builder 26.0.19 le lit comme TOUT ce
    qui suit, donc il doit rester le dernier. */
export function argumentsNsis(dossier: string): string[] {
	return ["/currentuser", "/S", `/D=${dossier}`];
}

/* ─────────── la langue de l'installeur ───────────
   La LANGUE D'AFFICHAGE DE WINDOWS (`app.getLocale()`, dans `main.ts`), et
   rien d'autre — la même source que l'application en mode « auto »
   (`apps/windows/electron/main.ts`) : installeur, application et dialogues
   natifs parlent la même langue sans qu'aucun réglage soit écrit ; qui veut
   autre chose le change dans Réglages.

   Jusqu'à la 1.0.16 la langue « voyageait dans le fichier » : un second nom
   `-fr.exe` pour la page française, puis le flux `Zone.Identifier` du
   navigateur en repli, puis seulement Windows. Deux mécanismes, deux assets,
   et le résultat était MOINS fiable que la langue du système (un exe renommé,
   copié, ou servi par GitHub à qui n'était pas passé par le site retombait
   de toute façon sur Windows). Retiré le 2026-09-15. */

export type LangueInstallateur = "en" | "fr";

/** La langue du système, telle que Chromium la rend (`fr`, `fr-FR`,
    `fr_CA`…) : tout ce qui commence par « fr » est français, le reste
    anglais — l'interface n'a que ces deux langues. */
export function langueDepuisLocale(locale: string): LangueInstallateur {
	return /^fr\b/i.test(locale.replace(/_/g, "-")) ? "fr" : "en";
}

/* ─────────── les pages légales ───────────
   Les deux liens du texte légal ouvrent le SITE, dans la langue de
   l'installeur. La page française vit sous `/fr/`, l'anglaise à la racine,
   comme la page de téléchargement. Le rendu ne transmet que le nom de la
   page (`LienLegal`) : l'URL est composée ICI, depuis deux constantes. */

const SITE = "https://neo-quiz.github.io/neo-quiz/";
const PAGES_LEGALES = { terms: "terms.html", privacy: "privacy.html" } as const;

export type PageLegale = keyof typeof PAGES_LEGALES;

export function urlLegale(page: PageLegale, langue: LangueInstallateur): string {
	return `${SITE}${langue === "fr" ? "fr/" : ""}${PAGES_LEGALES[page]}`;
}
