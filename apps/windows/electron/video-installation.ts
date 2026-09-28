/* ══════════════════════════════════════════════════════════
   INSTALLER YT-DLP DEPUIS SA RELEASE OFFICIELLE — CÔTÉ PRINCIPAL

   Tâche 3 des vidéos YouTube (spec
   docs/superpowers/specs/2026-09-22-videos-youtube-design.md,
   § 3.2, autorité liante). La tâche 2 TROUVAIT l'exécutable et le
   LANÇAIT ; ce module, lui, pose la COPIE GÉRÉE
   `<dossierApp>/outils/yt-dlp.exe` depuis la release GitHub
   officielle, dit à la modale d'où vient l'outil
   (`infosInstallation`), la tient à jour (`mettreAJourSiDu`) et en
   rend l'état à la tuile (`etat`).

   LA VERSION NE VIENT PAS DE L'API REST : son quota de requêtes
   ferait croire à une panne hors ligne. L'étiquette vient de la
   REDIRECTION de `/releases/latest` (l'en-tête `Location` se
   termine par le nom du tag) — une requête de plus, sans quota, et
   qui ne demande RIEN d'autre à GitHub. Chez yt-dlp l'étiquette EST
   la date de publication (`2026.08.19`) : la modale la reformate en
   ISO, sans la coder en dur.

   LES DEUX FICHIERS VIENNENT DE LA MÊME ÉTIQUETTE — l'exécutable et
   son `SHA2-256SUMS` (le fichier qui liste, en `<empreinte>␣␣<nom>`,
   TOUS les assets de la release ; appariés par NOM, `yt-dlp.exe` ou
   `yt-dlp_arm64.exe`). L'empreinte SHA-256 est recalculée ici sur
   les octets téléchargés ; un écart rejette `empreinte` et NE
   LAIT RIEN sur le disque — ni le `.part`, ni le fichier final.
   C'est la seule façon de poser un exécutable sans le lancer à
   l'aveugle : un `.part` d'une installation avortée ne doit jamais
   être réutilisé, et le `rename` final est ATOMIQUE (même volume,
   même dossier) — le fichier final n'apparaît que vérifié.

   LA PROGRESSION EST EN OCTETS : la longueur vient d'un HEAD sur
   l'asset, les octets reçus d'un corps lu par PAQUETS — le rendu
   anime une jauge, pas trois états.

   CHAQUE SAUT RÉSEAU EST JUGÉ PAR LA LISTE D'HÔTES (`hoteAutorise`
   de reseau.ts, où la spec a ajouté github.com,
   objects.githubusercontent.com et
   release-assets.githubusercontent.com) : le transport est
   injectable (le contrôle), le défaut est le `fetch` global du
   processus principal en redirection MANUELLE — chaque destination
   d'un `Location` est re-jugée AVANT son saut, car suivre
   aveuglément les redirections donnerait à un hôte de la liste le
   droit d'en désigner un autre.

   LA MISE À JOUR NE TOUCH JAMAIS UNE COPIE SYSTÈME : un
   `yt-dlp -U` sur celle de pip ou winget serait une écriture hors
   du dossier de l'app, sur un exécutable qui n'est pas le nôtre.
   Elle est lancée AU PLUS UNE FOIS PAR 24 H (l'horodatage de
   l'essai est écrit dans `<dossierApp>/outils/yt-dlp.maj` AVANT le
   lancement : un -U en échec a compté, il ne repartira pas à
   chaque transcription), bornée par le délai de `lancer`, avalée
   ET journalisée en cas d'échec — l'appelant (la tâche 4, avant
   une transcription) ne doit jamais attendre une mise à jour qui
   échoue.

   L'ENVIRONNEMENT, LE DOSSIER D'APP, LE TRANSPORT ET
   L'ARCHITECTURE SONT DES PARAMÈTRES : c'est ce qui permet à
   `npm run check:electron-video` d'éprouver l'installation contre
   une FAUSSE release servie depuis un dossier temporaire (le
   transport), le cas arm64 sans y tourner, et le `-U` sur un faux
   de la fixture de la tâche 2 — sans rien installer sur la
   machine, sans toucher au vrai PATH.
═══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_NAME, LOG_PREFIX } from "../../../src/branding";
import { hoteAutorise } from "./reseau";
import { executableYtDlp } from "./video";
import { environnementEnfant, lancer } from "./process";
/* The download transport (manual redirects, each hop re-judged), the
   shared error shape and the byte-stream reader moved to `telechargement.ts`
   (task 9 of docs/superpowers/plans/2026-09-28-c-cpp-execution.md): this
   module's own installer (yt-dlp) and `langages.ts`'s (the C/C++ pack) both
   need them, and a copy would eventually drift. No behaviour change here —
   `ErreurInstallation`/`CodeInstallation`/`estErreurInstallation` are the
   exact symbols this file exported before, re-imported instead of defined. */
import type { TransportInstallation } from "./telechargement";
import { demander, erreurInstallation, estErreurInstallation, transportDefaut } from "./telechargement";
export type { CodeInstallation, ErreurInstallation } from "./telechargement";
export { estErreurInstallation } from "./telechargement";

/* ══════════════════════════════════════════════════════════
   LES NOMS FIXES DE LA RELEASE OFFICIELLE
═══════════════════════════════════════════════════════════ */

/** L'URL de la release « latest » : la REDIRECTION porte
    l'étiquette, et c'est aussi le lien cliquable de la modale —
    valable même quand la version est illisible (hors ligne). */
const URL_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest";

/** L'étiquette de yt-dlp EST une date de publication : validée
    AVANT de composer une URL de téléchargement — un tag venu d'un
    `Location` hostile ne peut composer que l'URL d'un asset d'une
    release yt-dlp, jamais un chemin d'autre chose. */
const ETIQUETTE = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** La copie gérée, posée par `installer` QUEL QUE SOIT
    l'architecture : c'est l'asset binaire de la release Windows
    (`yt-dlp_arm64.exe` sur arm64) qui y est posé sous ce nom-là —
    la résolution de `video.ts` ne connaît que ce nom-là. */
const NOM_COPIE_GEREE = "yt-dlp.exe";

/** Le fichier des empreintes de la MÊME release (le nom qu'yt-dlp
    publie lui-même, une ligne par asset). */
const NOM_SOMMES = "SHA2-256SUMS";

/** L'horodatage de la mise à jour : au plus un `-U` par 24 h. */
const NOM_HORIZODATAGE = "yt-dlp.maj";
const VINGT_QUATRE_HEURES_MS = 24 * 60 * 60 * 1000;

/** Le délai max d'UN `yt-dlp -U` (les 60 s de la spec ; -U remplace
    l'exécutable, rarement au-delà de quelques secondes). */
const DELAI_MAJ_MS = 60_000;

/* ══════════════════════════════════════════════════════════
   LES COUTURES DU CONTRÔLE — CE QU'UN CAS INJECTE
═══════════════════════════════════════════════════════════ */

/** Chaque paramètre est ce qu'un cas de `check:electron-video`
    injecte. Sans deps, la production est entière : le fetch
    global, l'architecture du process, le dossier de `PRODUCT_NAME`
    sous APPDATA, 60 s pour `-U`. */
export interface DepsInstallation {
	/** L'environnement : la copie gérée et le `-U` en dépendent. */
	env?: NodeJS.ProcessEnv;
	/** Le dossier de l'application (le `userData` d'Electron) :
	   `<dossierApp>/outils` porte la copie gérée et l'horodatage. */
	dossierApp?: string;
	/** Le transport HTTP injecté (le contrôle). */
	transport?: TransportInstallation;
	/** L'architecture, injectable : `arm64` désigne l'asset
	    `yt-dlp_arm64.exe`, toute autre valeur `yt-dlp.exe`. */
	arch?: string;
	/** Le délai max du `yt-dlp -U`, en ms. */
	delaiMs?: number;
}

/** Les infos d'installation de la modale : la version lue par la
    REDIRECTION, la date qui en découle (chez yt-dlp l'étiquette
    EST la date), la taille lue par HEAD — tout `null` hors ligne
    (la modale dit alors « dernière version publiée », et `url`
    reste cliquable). JAMAIS l'API REST : pas de quota. */
export interface InfosInstallation {
	version: string | null;
	/** La date de publication, en ISO AAAA-MM-JJ. */
	datePublication: string | null;
	/** La taille de l'asset, lue par HEAD sur l'asset. */
	taille: number | null;
	/** La page de la release officielle, cliquable même hors ligne. */
	url: string;
}

/* ══════════════════════════════════════════════════════════
   LES URLS ET L'ÉTIQUETTE — VALIDÉES AVANT TOUTE COMPOSITION
═══════════════════════════════════════════════════════════ */

/** L'URL d'un asset de la release :
    `…/releases/download/<tag>/<asset>` — composée depuis
    l'ÉTIQUETTE VALIDÉE, jamais un chemin reçu d'ailleurs. */
function urlAsset(tag: string, asset: string): string {
	return "https://github.com/yt-dlp/yt-dlp/releases/download/" + tag + "/" + asset;
}

/** L'asset de la release pour l'architecture : `yt-dlp_arm64.exe`
    sur arm64, `yt-dlp.exe` ailleurs — INJECTABLE, le contrôle
    éprouve arm64 sans tourner sur une machine arm64. */
function nomAsset(arch: string = process.arch): string {
	return arch === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
}

/** La date de publication, en ISO AAAA-MM-JJ : chez yt-dlp
    l'étiquette EST la date (`2026.08.19`, parfois suivie d'un
    quatrième segment — les trois premiers portent la date). */
function dateDEtiquette(tag: string): string | null {
	const m = tag.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
	return m ? m[1] + "-" + m[2] + "-" + m[3] : null;
}

/** L'étiquette, lue par la REDIRECTION de `/releases/latest` —
    JAMAIS par l'API REST (son quota ferait croire à une panne hors
    ligne). Le `Location` se termine par le nom du tag, relatif ou
    absolu ; le dernier segment du chemin est validé AVANT tout
    usage — un tag hostile ne peut composer qu'une URL de release
    yt-dlp. */
async function lireEtiquette(transport: TransportInstallation): Promise<string | null> {
	if (!hoteAutorise(URL_LATEST)) return null;
	const reponse = await transport(URL_LATEST, { method: "GET" });
	const lieu = reponse.entete("location");
	if (!lieu) return null;
	const dernier = new URL(lieu, URL_LATEST).pathname.split("/").filter(Boolean).pop() ?? "";
	return ETIQUETTE.test(dernier) ? dernier : null;
}

/* ══════════════════════════════════════════════════════════
   LES INFOS D'INSTALLATION — POUR LA MODALE
═══════════════════════════════════════════════════════════ */

/** Le dossier de la copie gérée :
    `<dossierApp ?? le dossier de PRODUCT_NAME sous APPDATA>/outils`
    — le même que `candidatsYtDlp` de `video.ts` élit en premier ;
    c'est la résolution (source « app ») qui en fait foi. */
function dossierOutils(env: NodeJS.ProcessEnv, dossierApp?: string): string | null {
	const racine = dossierApp ?? (env.APPDATA ? join(env.APPDATA, PRODUCT_NAME) : null);
	return racine ? join(racine, "outils") : null;
}

/** La taille de l'asset, lue par HEAD (content-length, après les
    redirections qui mènent au vrai asset) — null quand elle est
    illisible : une progression en octets se suffit, sans total.

    L'EN-TÊTE ABSENT N'EST PAS ZÉRO : `Number(null)` vaut 0, et 0 passe
    le filtre `>= 0` — la modale aurait affiché « 0 o » pour une taille
    qu'on ignore, et la jauge un 100 % de travers (revue du 2026-09-23,
    promue bloquante). On lit l'en-tête d'abord : absent → null. */
async function tailleAsset(tag: string, asset: string, transport: TransportInstallation): Promise<number | null> {
	const reponse = await demander(urlAsset(tag, asset), "HEAD", transport);
	if (reponse.status !== 200) return null;
	const brute = reponse.entete("content-length");
	if (brute === null) return null;
	const longueur = Number(brute);
	return Number.isFinite(longueur) && longueur >= 0 ? longueur : null;
}

/**
 * Les infos d'installation, pour la modale : la version par la
 * REDIRECTION de `/releases/latest`, la date qui en découle, la
 * taille par HEAD sur l'asset. Hors ligne (ou étiquette
 * illisible), TOUT est null SANS exception — la modale dit alors
 * « dernière version publiée » (spec § 4) : un rejet ici serait
 * une modale en échec pour un état NORMAL. L'URL, elle, reste
 * cliquable quoi qu'il arrive.
 */
export async function infosInstallation(deps?: DepsInstallation): Promise<InfosInstallation> {
	const transport = deps?.transport ?? transportDefaut;
	const rendu: InfosInstallation = { version: null, datePublication: null, taille: null, url: URL_LATEST };
	try {
		const tag = await lireEtiquette(transport);
		if (!tag) return rendu;
		const taille = await tailleAsset(tag, nomAsset(deps?.arch), transport);
		return { version: tag, datePublication: dateDEtiquette(tag), taille, url: URL_LATEST };
	} catch (e) {
		return rendu;
	}
}

/* ══════════════════════════════════════════════════════════
   L'INSTALLATION — UNE RELEASE, DEUX FICHIERS, UNE EMPREINTE
═══════════════════════════════════════════════════════════ */

/** Le fichier des empreintes, lu en texte depuis la MÊME
    étiquette que l'exécutable. */
async function lireSommes(tag: string, transport: TransportInstallation): Promise<string> {
	const reponse = await demander(urlAsset(tag, NOM_SOMMES), "GET", transport);
	if (reponse.status !== 200) throw erreurInstallation("reseau", NOM_SOMMES + " : statut " + reponse.status);
	return await reponse.texte();
}

/** L'empreinte d'un asset dans un SHA2-256SUMS — l'appariement se
    fait par NOM DE FICHIER, le fichier listant TOUS les assets de
    la release (`yt-dlp.exe`, `yt-dlp_arm64.exe`, …) ; `null` quand
    il n'en porte pas : on refuse plutôt que de poser sans
    vérifier. */
function empreinteDe(sommes: string, asset: string): string | null {
	for (const ligne of sommes.split(/\r?\n/)) {
		const m = ligne.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
		if (m && m[2] === asset) return m[1].toLowerCase();
	}
	return null;
}

/**
 * Installe la copie gérée depuis la release officielle :
 * `SHA2-256SUMS` et l'exe pris dans la MÊME étiquette (lue par la
 * redirection de `/releases/latest`, pas l'API), l'empreinte
 * SHA-256 recalculée sur les octets téléchargés, l'écriture dans
 * `yt-dlp.exe.part` puis un rename ATOMIQUE — un échec laisse le
 * disque VIDE, ni `.part` ni fichier final. La progression est
 * portée en OCTETS par `surProgression` (reçus à cet instant,
 * total lu par HEAD, null quand il est ignoré). Rejette
 * `{ code: "reseau" | "empreinte" }` — le libellé est la décision
 * de la tâche 5.
 *
 * L'ARCHITECTURE est un paramètre (`deps.arch`) : le contrôle
 * éprouve `yt-dlp_arm64.exe` sans tourner sur une machine arm64.
 */
export async function installer(
	surProgression: (recus: number, total: number | null) => void,
	deps?: DepsInstallation,
): Promise<void> {
	const env = deps?.env ?? process.env;
	const transport = deps?.transport ?? transportDefaut;
	const outils = dossierOutils(env, deps?.dossierApp);
	if (!outils) throw erreurInstallation("reseau", "dossier de l'application introuvable");
	const partiel = join(outils, NOM_COPIE_GEREE + ".part");
	const cible = join(outils, NOM_COPIE_GEREE);
	mkdirSync(outils, { recursive: true });
	try {
		/* Un .part d'une installation précédente avortée ne doit
		   jamais être réutilisé : une empreinte qui collerait par
		   hasard validerait des octets qui ne sont pas ceux de la
		   release. */
		rmSync(partiel, { force: true });
		const tag = await lireEtiquette(transport);
		if (!tag) throw erreurInstallation("reseau", "étiquette de " + URL_LATEST + " illisible");
		const asset = nomAsset(deps?.arch);
		/* LES DEUX fichiers viennent de la MÊME étiquette : une somme
		   d'une autre release vérifierait un fichier qui n'est pas
		   celui-ci. Les sommes d'ABORD — elles échouent vite, sans
		   télécharger 18 Mo pour rien. */
		const sommes = await lireSommes(tag, transport);
		const empreinteAttendue = empreinteDe(sommes, asset);
		if (!empreinteAttendue) throw erreurInstallation("empreinte", NOM_SOMMES + " ne nomme pas " + asset);
		const total = await tailleAsset(tag, asset, transport);
		const reponse = await demander(urlAsset(tag, asset), "GET", transport);
		if (reponse.status !== 200) throw erreurInstallation("reseau", "statut " + reponse.status + " : " + asset);
		const hache = createHash("sha256");
		let recus = 0;
		const ecrire = (paquet: Uint8Array): void => {
			writeSync(descripteur, paquet);
			hache.update(paquet);
			recus += paquet.length;
			surProgression(recus, total);
		};
		const descripteur = openSync(partiel, "w");
		try {
			if (reponse.octets) {
				for await (const paquet of reponse.octets()) ecrire(paquet);
			} else {
				/* Un transport qui ne streame pas : le corps entier en
				   texte, latin1 pour que chaque octet soit un code
				   point — le même chemin que `transportOctets` de
				   `video.ts` pour la miniature. */
				ecrire(Buffer.from(await reponse.texte(), "latin1"));
			}
		} finally {
			closeSync(descripteur);
		}
		if (hache.digest("hex") !== empreinteAttendue) {
			throw erreurInstallation("empreinte", "SHA-256 de " + asset + " hors de " + NOM_SOMMES);
		}
		/* LE RENAME, même volume, même dossier : atomique. Un échec
		   ici laisse le .part au catch ci-dessous — jamais un
		   exécutable à moitié posé sous son nom final. */
		renameSync(partiel, cible);
	} catch (e) {
		/* ÉCHEC → RIEN sur le disque : le .part est effacé, TOUJOURS
		   (un échec d'effacement est un disque qui refusera aussi le
		   rename au prochain essai — nommé, pas silencieux). */
		try {
			rmSync(partiel, { force: true });
		} catch (e2) {
			console.warn(LOG_PREFIX, "yt-dlp.exe.part non effacé :", partiel, e2);
		}
		if (estErreurInstallation(e)) throw e;
		throw erreurInstallation("reseau", String((e as Error)?.message ?? e).slice(-300));
	}
}

/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR — LA COPIE GÉRÉE SEULEMENT, AU PLUS 1×/24 H
═══════════════════════════════════════════════════════════ */

/**
 * Met à jour la COPIE GÉRÉE SEULEMENT : au plus un `yt-dlp -U` par
 * 24 h, horodatage dans `<dossierApp>/outils/yt-dlp.maj`, lancé
 * par les primitives de `process.ts` (le délai 60 s, l'ARBRE tué à
 * l'expiration, les arguments cités) avec les arguments fixes
 * `["-U"]`. JAMAIS une copie système : un `-U` sur celle de pip ou
 * winget serait une écriture hors du dossier de l'app.
 *
 * L'horodatage est écrit AVANT le lancement : « au plus une fois
 * par 24 h » compte les TENTATIVES — un `-U` en échec ne repartira
 * pas à chaque transcription. Les erreurs sont avalées ET
 * journalisées, et le `-U` est borné par le délai : l'appelant (la
 * tâche 4, avant une transcription) ne doit jamais attendre une
 * mise à jour qui échoue. Sans copie gérée ni horodatage frais, il
 * ne se passe RIEN.
 */
export async function mettreAJourSiDu(deps?: DepsInstallation): Promise<void> {
	const env = deps?.env ?? process.env;
	const outils = dossierOutils(env, deps?.dossierApp);
	if (!outils) return;
	const horodatage = join(outils, "yt-dlp.maj");
	try {
		/* LA RÉSOLUTION D'ABORD, LA GARDE ENSUITE, et plus AUCUN
		   `await` entre la garde et l'horodatage : le cap « au plus
		   un -U par 24 h » tient MÉCANIQUEMENT — deux appels entrelacés
		   ne peuvent pas passer la garde tous les deux (tout ce qui
		   reste avant l'écriture de l'horodatage est synchrone). */
		const resolu = await executableYtDlp(env, deps?.dossierApp);
		/* La COPIE GÉRÉE SEULEMENT : un `yt-dlp -U` sur une copie du
		   PATH (pip, winget) serait une écriture hors du dossier de
		   l'app, sur un exécutable qui n'est pas le nôtre. */
		if (!resolu || resolu.source !== "app") return;
		try {
			if (Date.now() - statSync(horodatage).mtimeMs < VINGT_QUATRE_HEURES_MS) return;
		} catch (e) {
			/* Absent : une première mise à jour, l'état normal. */
		}
		writeFileSync(horodatage, String(Date.now()), "utf8");
		try {
			const res = await lancer({
				executable: resolu.chemin,
				args: ["-U"],
				stdin: "",
				timeoutMs: deps?.delaiMs ?? DELAI_MAJ_MS,
				env: environnementEnfant(env),
			});
			if (res.code !== 0) console.warn(LOG_PREFIX, "yt-dlp -U a échoué (code", res.code, ") —", res.stderr.trim().slice(-300));
		} catch (e) {
			/* Délai dépassé (l'arbre est tué par `lancer`), exécutable
			   mort : la mise à jour ne doit JAMAIS emporter la
			   transcription qui suit. */
			console.warn(LOG_PREFIX, "yt-dlp -U impossible :", e);
		}
	} catch (e) {
		console.warn(LOG_PREFIX, "mise à jour de yt-dlp non tentée :", e);
	}
}

/* ══════════════════════════════════════════════════════════
   L'ÉTAT — DÉRIVÉ DE LA RÉSOLUTION RÉELLE
═══════════════════════════════════════════════════════════ */

/** L'état de yt-dlp, tel que la tuile le juge (spec § 3.2, la
    tâche 4 le portera) : `present` = un exécutable a été résolu,
    `source` = sa provenance — la copie gérée (« app ») ou un
    yt-dlp du PATH (« systeme ») — et `null` quand rien n'a été
    résolu (l'état NORMAL d'une machine sans yt-dlp, pas une
    panne). */
export interface EtatInstallation {
	present: boolean;
	source: "app" | "systeme" | null;
}

/** Dérivé d'`executableYtDlp` (la tâche 2), LA MÊME résolution que
    la transcription : les deux ne peuvent pas diverger. */
export async function etat(deps?: DepsInstallation): Promise<EtatInstallation> {
	const resolu = await executableYtDlp(deps?.env ?? process.env, deps?.dossierApp);
	return resolu ? { present: true, source: resolu.source } : { present: false, source: null };
}