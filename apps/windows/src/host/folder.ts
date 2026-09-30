/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LE DOSSIER DE QUIZ

   Choisir un dossier, s'en souvenir d'une session à l'autre. Tout passe par le
   pont (`window.neo`, `apps/windows/electron/pont.ts`) : le sélecteur natif,
   les réglages, la liste des vaults d'Obsidian.

   `allowFolder` A DISPARU, et ce n'est pas une simplification. Sous Tauri, la
   commande Rust `allow_folder` ÉTENDAIT une barrière (la portée vide de
   `plugin-fs`) à chaque lancement : le rendu déclarait ce qu'il avait le droit
   de lire. Le périmètre Electron (`electron/perimetre.ts`) tient la même
   barrière, mais côté PRINCIPAL et alimenté par lui seul — la clé `folders`
   des réglages, lue au démarrage ; le dossier que le sélecteur natif a
   désigné ; les vaults qu'Obsidian déclare. Il n'y a donc plus rien à
   « ouvrir » depuis ici : un dossier persisté est déjà au périmètre quand le
   rendu démarre, et un dossier neuf y entre par la porte qui l'a produit.

   LES CHEMINS SONT NORMALISÉS À L'ENTRÉE (Ruling 14). `obsidian.json` écrit
   des `\` (« C:\\obsidian-vaults\\Personal ») et le sélecteur natif aussi,
   alors que tout ce qui franchit le pont porte des `/`. Un même dossier
   ouvert d'un côté puis de l'autre donnerait sinon deux clés pour un seul
   fichier dans le miroir du rendu — et deux historiques de révision. La
   normalisation se fait ici, au point d'entrée, et les valeurs DÉJÀ
   PERSISTÉES par la version Tauri sont CONVERTIES à la lecture.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../../src/branding";
import type { ExamenDossier } from "../../../../src/types/dashboard-ctx";
import { readExamWeight } from "../../../../src/review/review-store";
/* `pont()` lit `window.neo` À L'APPEL — voir `./pont.ts` pour le pourquoi.
   `npm run check:folders` charge ce module hors de toute fenêtre : les
   fonctions PURES qu'il éprouve (`lireDossiers`, `idUnique`,
   `appliquerExamDate`…) ne l'appellent jamais. */
import { pont } from "./pont";
import { normaliser } from "./fs";

/** Un dossier de quiz retenu par l'application. */
export interface DossierQuiz {
	/**
	 * Identifiant, et PREMIER SEGMENT des chemins du contrat qui en relèvent
	 * (« Efrei/Cours/reseau.md »). PERSISTÉ, et jamais recalculé : un
	 * identifiant qui changerait le jour où un dossier homonyme arrive
	 * changerait avec lui tous les chemins affichés.
	 *
	 * C'est le NOM du dossier, pas un jeton opaque (« f1 ») : ces chemins
	 * sont montrés à l'écran, et « Efrei/Cours/reseau.md » se lit là où
	 * « f1/Cours/reseau.md » demanderait une table de traduction — donc un
	 * second endroit où le préfixe serait connu.
	 */
	id: string;
	/** Chemin ABSOLU sur le disque, séparateurs `/`. La seule valeur qui ne
	    soit pas du contrat : elle ne sort de l'hôte que vers le pont. */
	path: string;
	/** Nom affiché. Modifiable un jour sans conséquence — l'identité, c'est
	    `id`. */
	name: string;
	/** Le dossier par défaut (`C:\Neo Quiz`, tranche 9) : jamais écrit dans
	    `folders`, toujours PREMIER dans `savedFolders()`, et `removeFolder`
	    le refuse. Absent (pas `false`) pour tout autre dossier — c'est
	    `savedFolders` qui pose `true`, personne d'autre n'a à le faire. */
	parDefaut?: boolean;
}

/** La limite de la spec §6. Dix dossiers, pas onze. */
export const MAX_DOSSIERS = 10;

const CLE_DOSSIERS = "folders";
/** L'ancienne clé, au SINGULIER (tranche 1). Lue une fois, puis retirée. */
const CLE_DOSSIER_LEGACY = "folder";

/** L'identifiant et le nom du dossier par défaut — DONNÉES PERSISTÉES dans
    les chemins du contrat (le premier segment) : jamais traduites, comme
    `id`/`name` de tout autre dossier. RÉSERVÉ dans `lireDossiers` (voir plus
    bas) : aucun dossier persisté ne peut plus obtenir cet id. */
const ID_DOSSIER_DEFAUT = "Neo Quiz";

/**
 * LA CONVERSION DES VALEURS DÉJÀ PERSISTÉES (Ruling 14). Un `folders` écrit
 * par la version Tauri porte les `\` que le sélecteur natif rendait
 * (« C:\obsidian-vaults\Efrei ») ; le pont, lui, pose partout l'invariant des
 * `/` — c'est `parcours.ts` qui le dit et le principal l'applique à tout ce
 * qu'il émet. Sans cette conversion, un dossier ouvert depuis la liste
 * Obsidian et le MÊME ouvert par le sélecteur donneraient deux `path`
 * différents pour un seul disque : `depuisAbsolu` (`roots.ts`) compare des
 * préfixes, donc les événements du surveillant tomberaient dans le vide pour
 * l'une des deux formes. Appliquée à la LECTURE (`lireDossiers`), donc une
 * fois pour toutes : la première écriture qui suit réécrit la forme normalisée.
 *
 * IMPORTÉE de `./fs.ts` et non réécrite : c'était la TROISIÈME copie octet pour
 * octet de la même règle dans le dépôt, et deux d'entre elles vivaient dans le
 * même paquet.
 */
const normaliserChemin = normaliser;

/** Ouvre le sélecteur natif. `null` si l'utilisateur annule — ce n'est pas une
    erreur, c'est la réponse « non ». Le dossier choisi entre au périmètre du
    principal par ce seul appel (`canaux.ts`). */
export async function pickFolder(): Promise<string | null> {
	const choix = await pont().dialogue.choisirDossier();
	return typeof choix === "string" && choix.trim() ? normaliserChemin(choix) : null;
}

/** Le dernier segment d'un chemin, quel que soit le séparateur. */
export function nomDeDossier(chemin: string): string {
	return String(chemin ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(chemin ?? "");
}

/**
 * Un nom réduit à ce qui peut tenir dans UN segment de chemin.
 *
 * Les caractères interdits par Windows (`\ / : * ? " < > |`) deviennent des
 * tirets — pas parce que l'identifiant touche le disque (il ne le touche
 * jamais : c'est un préfixe de chemin du CONTRAT), mais parce qu'un `/` dans
 * l'identifiant en ferait DEUX segments, et le premier ne désignerait plus
 * aucune racine.
 */
export function segmentValide(nom: string): string {
	const nu = String(nom ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
	return nu || "dossier";
}

/** Un identifiant libre. Le suffixe est numérique et croissant : deux
    dossiers nommés « Cours » donnent « Cours » et « Cours-2 ». */
export function idUnique(nom: string, pris: ReadonlySet<string>): string {
	const base = segmentValide(nom);
	if (!pris.has(base)) return base;
	let n = 2;
	while (pris.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/**
 * Les dossiers retenus, à partir de ce que les réglages contiennent — y
 * compris l'ANCIENNE clé au singulier, et y compris les chemins écrits avec
 * des `\` par la version Tauri (voir `normaliserChemin`).
 *
 * PURE, et c'est délibéré : la conversion d'un réglage est exactement le
 * genre de code qu'on n'ose plus toucher parce qu'on ne peut pas l'exécuter.
 * Ici, `npm run check:folders` l'exécute.
 */
export function lireDossiers(brut: { folders?: unknown; folder?: unknown }): DossierQuiz[] {
	/* `ID_DOSSIER_DEFAUT` ("Neo Quiz") est RÉSERVÉ (tranche 9, fix round 1) :
	   c'est l'id de contrat du dossier par défaut, posé par `savedFolders`,
	   jamais par ce qui vient de `folders`. Le préchargé dans `pris` avant
	   toute lecture : un dossier persisté qui portait déjà cet id (un
	   utilisateur qui avait ouvert un dossier nommé « Neo Quiz » avant cette
	   version) se voit renuméroté en « Neo Quiz-2 » par `idUnique`, comme
	   n'importe quelle collision. Il PERD alors son historique sous l'ancien
	   id — les chemins du contrat qui en dépendent changent de préfixe — mais
	   c'est le prix d'un id qui doit rester univoque : sans cette réservation,
	   `savedFolders()` produirait DEUX entrées `id: "Neo Quiz"` (le défaut et
	   ce dossier), indiscernables l'une de l'autre, et `removeFolder("Neo
	   Quiz")` retirerait le mauvais des deux (ou aucun — voir son garde-fou).
	   Ceci ne contredit PAS « un identifiant persisté est reconduit tel
	   quel » (commentaire plus bas, éprouvé par `check-folders.mjs`) : cette
	   règle vaut pour tout id SAUF celui-ci, désormais réservé. */
	const pris = new Set<string>([ID_DOSSIER_DEFAUT]);
	const out: DossierQuiz[] = [];

	if (Array.isArray(brut.folders)) {
		for (const e of brut.folders) {
			const o = e as Partial<DossierQuiz> | null;
			const path = typeof o?.path === "string" ? normaliserChemin(o.path.trim()) : "";
			if (!path) continue;
			const name = typeof o?.name === "string" && o.name.trim() ? o.name.trim() : nomDeDossier(path);
			/* L'identifiant persisté est reconduit tel quel — sauf collision,
			   qu'un fichier de réglages édité à la main peut produire, ou
			   celle réservée ci-dessus. Le recalculer systématiquement
			   changerait les chemins affichés à chaque renommage de dossier. */
			const voulu = typeof o?.id === "string" && o.id.trim() ? segmentValide(o.id) : segmentValide(name);
			const id = idUnique(voulu, pris);
			pris.add(id);
			out.push({ id, path, name });
			if (out.length >= MAX_DOSSIERS) break;
		}
		return out;
	}

	/* MIGRATION de la clé au singulier (tranche 1). Un seul sens, exécuté une
	   fois : `savedFolders` réécrit aussitôt sous la nouvelle clé et retire
	   l'ancienne. Sans elle, la mise à jour de l'application ferait repartir
	   l'utilisateur sur l'écran « Choisissez un dossier », son dossier
	   toujours là mais oublié. */
	if (typeof brut.folder === "string" && brut.folder.trim()) {
		const path = normaliserChemin(brut.folder.trim());
		const name = nomDeDossier(path);
		return [{ id: idUnique(segmentValide(name), pris), path, name }];
	}
	return [];
}

/**
 * Le dossier par défaut, tel que le principal le sert (déjà créé et autorisé
 * au périmètre au démarrage — voir `electron/dossier-defaut.ts`).
 *
 * Une lecture impossible n'empêche pas le reste de démarrer : elle est
 * gardée à part de celle des réglages, plus bas, pour la même raison que
 * `obsidianVaults` — un incident sur cette lecture ne doit pas priver
 * l'utilisateur des dossiers qu'il a lui-même ouverts.
 */
async function dossierParDefaut(): Promise<DossierQuiz | null> {
	try {
		const chemin = await pont().systeme.dossierDefaut();
		if (typeof chemin !== "string" || !chemin.trim()) return null;
		return { id: ID_DOSSIER_DEFAUT, path: normaliserChemin(chemin), name: ID_DOSSIER_DEFAUT, parDefaut: true };
	} catch (e) {
		console.warn(LOG_PREFIX, "dossier par défaut illisible:", e);
		return null;
	}
}

/**
 * Les dossiers retenus de la session précédente, LE DÉFAUT DEVANT.
 *
 * Le défaut n'est jamais lu dans `folders` ni écrit dedans (Ruling — voir
 * `DossierQuiz.parDefaut`) : il est ajouté ICI, à chaque appel, à partir de
 * ce que le principal sert. Un utilisateur qui avait déjà des dossiers
 * ouverts les garde tels quels, en emplacements supplémentaires — rien à
 * migrer dans les réglages.
 */
export async function savedFolders(): Promise<DossierQuiz[]> {
	const defaut = await dossierParDefaut();
	try {
		const reglages = pont().reglages;
		const legacy = await reglages.lire(CLE_DOSSIER_LEGACY);
		const liste = lireDossiers({
			folders: await reglages.lire(CLE_DOSSIERS),
			folder: legacy,
		});
		/* La conversion se paie UNE fois : dès qu'on a lu l'ancienne clé, on
		   écrit la nouvelle et on retire l'ancienne. Laisser les deux en place
		   ferait diverger le jour où l'une des deux serait modifiée. */
		if (legacy !== undefined) {
			await reglages.ecrire(CLE_DOSSIERS, liste);
			await reglages.supprimer(CLE_DOSSIER_LEGACY);
		}
		return defaut ? [defaut, ...liste] : liste;
	} catch (e) {
		// Réglages illisibles : le défaut reste utilisable, seuls les
		// emplacements supplémentaires manquent à l'appel.
		console.warn(LOG_PREFIX, "réglages illisibles:", e);
		return defaut ? [defaut] : [];
	}
}

/**
 * Écrit la liste des dossiers.
 *
 * LA GARDE DU PRINCIPAL PEUT REFUSER (Ruling 15). Le canal `reglages.ecrire`
 * vérifie que CHAQUE chemin de cette clé est déjà au périmètre, parce que
 * c'est elle qui le nourrit au démarrage suivant : sans cette garde, le rendu
 * pourrait s'écrire `{ path: "C:/" }` et obtenir tout le disque à la session
 * d'après. Or un dossier ABSENT du disque (clé USB retirée, dossier supprimé)
 * n'est jamais entré au périmètre — `autoriser` ignore ce qui n'existe pas —
 * et sa seule présence dans la liste ferait REJETER l'écriture entière : un
 * utilisateur ne pourrait plus retirer un autre dossier tant que la clé n'est
 * pas rebranchée. On écarte donc les dossiers DISPARUS avant d'écrire ; ils
 * sont perdus du réglage, ce qui est déjà ce que l'écran montre (le démarrage
 * les ignore aussi, `main.ts`).
 *
 * DEUX RÉPONSES QUI NE SE CONFONDENT PAS, et c'est le correctif de la ronde 1 :
 * `exists` rend `false` (« le disque a répondu : il n'y a rien là ») ou REJETTE
 * (« la question n'a pas pu être posée » — chemin hors périmètre, partage
 * réseau qui ne répond pas, droits). Seul le `false` fait retirer l'entrée.
 * Un rejet la GARDE : le Ruling 15 ne visait que « disparu du disque », et une
 * défaillance transitoire du canal ferait sinon disparaître un dossier des
 * réglages en silence — un dossier parfaitement vivant, que l'utilisateur
 * retrouverait oublié au prochain lancement. Garder l'entrée laisse le
 * PRINCIPAL trancher : s'il s'agit vraiment d'un chemin hors périmètre, sa
 * garde refuse l'écriture entière et le refus atteint l'utilisateur, ce qui est
 * exactement ce qu'on veut d'une valeur fabriquée.
 */
export async function saveFolders(liste: DossierQuiz[]): Promise<void> {
	const gardes: DossierQuiz[] = [];
	/* LE DÉFAUT N'ENTRE JAMAIS DANS `folders` (Ruling, tranche 9) : il n'est
	   pas produit par le sélecteur natif ni par un vault choisi, il est
	   POSÉ par `savedFolders` à chaque lecture. Un appelant qui passerait ici
	   la liste telle que `savedFolders` la rend (défaut compris — `addFolder`,
	   `removeFolder`) ne doit pas le persister deux fois. */
	for (const d of liste) {
		if (d.parDefaut) continue;
		let present = true;
		try {
			present = await pont().fichiers.exists(d.path);
		} catch (e) {
			/* La question n'a pas pu être posée : on ne conclut RIEN. L'entrée
			   reste, et le principal tranchera à l'écriture. */
			console.warn(LOG_PREFIX, "dossier inaccessible, gardé dans les réglages:", d.path, e);
		}
		if (present) gardes.push(d);
		else console.warn(LOG_PREFIX, "dossier disparu du disque, retiré des réglages:", d.path);
	}
	await pont().reglages.ecrire(CLE_DOSSIERS, gardes);
}

/**
 * Ce qu'un chemin est vis-à-vis des racines DÉJÀ ouvertes. PURE, et éprouvée
 * par `npm run check:folders`.
 *
 * Les trois refus disent la même chose : **deux racines ne doivent jamais se
 * recouvrir**. `depuisAbsolu` (roots.ts) tranche par « la plus longue racine
 * gagne », donc un même fichier changerait de chemin du contrat selon la
 * racine retenue — et la clé du journal de révision porte ce chemin. Deux
 * racines gigognes, c'est deux historiques pour la même question, et la
 * seconde repart éternellement à neuf.
 *
 * - `doublon` : exactement la même racine (le cas que le code refusait déjà) ;
 * - `dedans` : le chemin est SOUS une racine ouverte — c'est le cas d'un
 *   dossier de cours dans un vault, et il ne s'ouvre pas, il se DÉCLARE
 *   (« Ouvrir un dossier existant », `quizzesModuleOverrides`) ;
 * - `contient` : le chemin est AU-DESSUS d'une racine ouverte (on a désigné
 *   `C:/obsidian-vaults` alors qu'un vault est déjà ouvert dessous).
 *
 * La comparaison ignore la casse : Windows l'ignore aussi, et `depuisAbsolu`
 * fait de même — deux règles qui divergeraient sur ce point laisseraient
 * passer ici ce qu'elle refuse là.
 */
export type LienAvecRacines = "libre" | "doublon" | "dedans" | "contient";

export function lienAvecRacines(chemin: string, racines: readonly { path: string }[]): LienAvecRacines {
	const bas = normaliserChemin(chemin).toLowerCase().replace(/\/+$/, "");
	if (!bas) return "libre";
	for (const r of racines) {
		const racine = normaliserChemin(r.path).toLowerCase().replace(/\/+$/, "");
		if (!racine) continue;
		if (bas === racine) return "doublon";
		if (bas.startsWith(racine + "/")) return "dedans";
	}
	/* Le « contient » n'est cherché qu'après : un chemin qui serait à la fois
	   sous une racine et au-dessus d'une autre est d'abord « dedans », la
	   réponse qui dit quoi faire (le déclarer). */
	for (const r of racines) {
		const racine = normaliserChemin(r.path).toLowerCase().replace(/\/+$/, "");
		if (racine && racine.startsWith(bas + "/")) return "contient";
	}
	return "libre";
}

/** Ajoute un dossier et rend la liste complète. Un chemin qui RECOUVRE une
    racine déjà ouverte n'est pas ajouté — voir `lienAvecRacines` pour ce que
    ça coûterait. L'appelant compare la longueur de la liste rendue, ou
    interroge `lienAvecRacines` lui-même pour nommer la cause. */
export async function addFolder(chemin: string): Promise<DossierQuiz[]> {
	const liste = await savedFolders();
	const normalise = normaliserChemin(chemin);
	if (lienAvecRacines(normalise, liste) !== "libre") return liste;
	/* IL SORT DES ÉCARTÉS : rouvrir à la main un vault qu'on avait retiré doit
	   le rouvrir POUR DE BON. Sans ça, il resterait ouvert cette fois-ci, puis
	   serait le seul vault de la machine que l'ouverture automatique saute —
	   sans que rien ne le dise. */
	const ecartes = await cheminsEcartes();
	if (ecartes.some(c => c.toLowerCase() === normalise.toLowerCase())) {
		await pont().reglages.ecrire(CLE_VAULTS_ECARTES,
			ecartes.filter(c => c.toLowerCase() !== normalise.toLowerCase()));
	}
	/* `MAX_DOSSIERS` compte les emplacements SUPPLÉMENTAIRES (spec §2.1) : le
	   défaut est en plus, il ne mange pas de la limite. */
	if (liste.filter(d => !d.parDefaut).length >= MAX_DOSSIERS) return liste;
	const nom = nomDeDossier(normalise);
	const suivante = [...liste, { id: idUnique(nom, new Set(liste.map(d => d.id))), path: normalise, name: nom }];
	await saveFolders(suivante);
	return savedFolders();
}

/**
 * CHANGE le dossier de quiz par défaut. Rend le nouveau chemin, ou `null` si
 * l'utilisateur a annulé le dialogue.
 *
 * L'ANCIEN DÉFAUT EST GARDÉ, EN EMPLACEMENT SUPPLÉMENTAIRE. C'est le point
 * important, et ce n'est pas une politesse : les quiz de l'ancien dossier
 * restent sur le disque, mais l'application ne lit QUE ses racines — sans ce
 * rattrapage, changer de dossier ferait disparaître du catalogue tout ce qu'on
 * y avait écrit, et ferait disparaître avec eux les statistiques de révision
 * qui s'y rattachent. Il garde sa croix : le retirer reste à un clic, alors
 * qu'une disparition ne se rattrape qu'en retrouvant le chemin de mémoire.
 *
 * Le dossier n'est PAS déplacé, et rien n'est copié : changer le dossier par
 * défaut change l'endroit où les prochains quiz seront créés, pas où les
 * précédents vivent.
 */
export async function setDefaultFolder(): Promise<string | null> {
	const avant = await dossierParDefaut();
	const choisi = await pont().systeme.choisirDossierDefaut();
	if (!choisi) return null;
	/* Le même dossier qu'avant : rien à rattraper, et l'ajouter en
	   supplémentaire ferait deux racines sur les mêmes fichiers. */
	if (avant && avant.path.toLowerCase() !== normaliserChemin(choisi).toLowerCase()) {
		/* `addFolder` ignore un chemin déjà présent et respecte `MAX_DOSSIERS` :
		   une liste pleine ne fait pas échouer le changement, elle laisse
		   simplement l'ancien dossier de côté — il est toujours sur le disque
		   et s'ajoute à la main après avoir fait de la place. */
		await addFolder(avant.path);
	}
	return choisi;
}

/* ══════════════════════════════════════════════════════════
   LES VAULTS OBSIDIAN OUVERTS TOUT SEULS

   Tout vault qu'Obsidian déclare sur cette machine est ouvert au démarrage,
   sans que personne ait à cliquer : quelqu'un qui a déjà ses notes dans
   Obsidian veut ses quiz, pas une liste de cases à cocher.

   CE QUI REND LA CROIX ENCORE POSSIBLE. Sans mémoire, un vault retiré serait
   redétecté au lancement suivant et rouvert aussitôt — la croix deviendrait un
   bouton sans effet, et c'est exactement le genre de défaut qu'on ne remarque
   qu'après avoir cliqué trois fois. `removeFolder` note donc le chemin
   RETIRÉ ; l'ouverture automatique saute ce qui figure dans cette liste. La
   règle tient en une phrase : tout vault de la machine est ouvert, SAUF ceux
   que l'utilisateur a retirés — et « Ajouter un dossier » les rouvre, ce qui
   les fait sortir de la liste.
══════════════════════════════════════════════════════════ */

const CLE_VAULTS_ECARTES = "dismissedFolders";

/** Les chemins retirés à la main, en minuscules (la comparaison de chemins est
    insensible à la casse sous Windows, comme partout ailleurs dans ce module). */
async function cheminsEcartes(): Promise<string[]> {
	try {
		const brut = await pont().reglages.lire(CLE_VAULTS_ECARTES);
		return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === "string") : [];
	} catch (e) {
		/* Illisible : on n'écarte rien. Le pire est de rouvrir un vault que
		   l'utilisateur avait retiré — visible, et rattrapable d'une croix —,
		   là où échouer tout le démarrage ne l'est pas. */
		console.warn(LOG_PREFIX, "dossiers écartés illisibles:", e);
		return [];
	}
}

/**
 * Ouvre les vaults Obsidian détectés qui ne sont ni déjà ouverts ni écartés.
 * Rend le nombre de dossiers ajoutés — zéro est le cas courant, à partir du
 * deuxième lancement.
 *
 * UNE SEULE ÉCRITURE, quel que soit le nombre de vaults : `addFolder` relit et
 * réécrit les réglages à chaque appel, et `saveFolders` interroge le disque
 * pour chaque entrée. En boucle, cinq vaults, c'est cinq lectures, cinq
 * réécritures et vingt-cinq `exists` au démarrage.
 */
export async function ouvrirVaultsDetectes(): Promise<number> {
	let vaults: VaultConnu[];
	try {
		vaults = await obsidianVaults();
	} catch (e) {
		// Obsidian absent, liste illisible : un état NORMAL, pas une panne.
		console.warn(LOG_PREFIX, "vaults Obsidian illisibles:", e);
		return 0;
	}
	if (!vaults.length) return 0;
	const liste = await savedFolders();
	const connus = new Set(liste.map(d => d.path.toLowerCase()));
	const ecartes = new Set((await cheminsEcartes()).map(c => c.toLowerCase()));
	const ids = new Set(liste.map(d => d.id));
	const suivante = liste.filter(d => !d.parDefaut);
	let ajoutes = 0;
	for (const v of vaults) {
		const normalise = normaliserChemin(v.chemin);
		const cle = normalise.toLowerCase();
		if (connus.has(cle) || ecartes.has(cle)) continue;
		// La limite compte les emplacements SUPPLÉMENTAIRES (spec §2.1).
		if (suivante.length >= MAX_DOSSIERS) break;
		const nom = nomDeDossier(normalise);
		const id = idUnique(nom, ids);
		ids.add(id);
		suivante.push({ id, path: normalise, name: nom });
		connus.add(cle);
		ajoutes++;
	}
	if (ajoutes) await saveFolders(suivante);
	return ajoutes;
}

/** Retire un dossier. Le JOURNAL du dossier n'est pas touché : il vit dans le
    dossier, avec les notes qu'il décrit, et le rajouter plus tard doit rendre
    l'historique — c'est précisément ce que son nouvel emplacement permet. */
export async function removeFolder(id: string): Promise<DossierQuiz[]> {
	if (id === ID_DOSSIER_DEFAUT) return savedFolders();
	const liste = await savedFolders();
	const retire = liste.find(d => d.id === id);
	/* ÉCARTÉ, sans quoi la croix ne retirerait rien de durable : un vault
	   Obsidian retiré est redétecté au lancement suivant et rouvert
	   automatiquement (voir `ouvrirVaultsDetectes`). Noté pour TOUT dossier,
	   vault ou non : un dossier ordinaire n'est jamais rouvert tout seul, la
	   ligne en trop ne coûte rien, et savoir ici lequel est un vault
	   demanderait un aller-retour de plus au disque. */
	if (retire) {
		const ecartes = await cheminsEcartes();
		const cle = retire.path.toLowerCase();
		if (!ecartes.some(c => c.toLowerCase() === cle)) {
			await pont().reglages.ecrire(CLE_VAULTS_ECARTES, [...ecartes, retire.path]);
		}
	}
	/* `saveFolders` écrit sous `folders`, où le défaut n'entre JAMAIS (voir
	   `savedFolders`) : il est retiré ici de la liste écrite, puis
	   `savedFolders` le replace devant à la prochaine lecture. */
	await saveFolders(liste.filter(d => d.id !== id && !d.parDefaut));
	return savedFolders();
}

/** Un vault Obsidian connu de la machine. */
export interface VaultConnu {
	chemin: string;
	nom: string;
}

/**
 * Les vaults qu'Obsidian connaît sur cette machine. Ils étaient PROPOSÉS d'un
 * clic dans les Réglages ; depuis le 2026-09-17 ils sont simplement OUVERTS au
 * démarrage (`ouvrirVaultsDetectes`), son unique appelante.
 *
 * La lecture se fait DANS LE PROCESSUS PRINCIPAL (`electron/vaults.ts`) : le
 * fichier vit dans le dossier de configuration d'Obsidian, et donner au rendu
 * l'accès à ce dossier pour lire un seul fichier lui donnerait bien plus que
 * ce qu'il demande. C'est aussi l'une des trois portes du périmètre : les
 * vaults rendus ici y entrent, ce qui permet à `addFolder` de les écrire
 * ensuite sous `folders`.
 *
 * Les chemins sont NORMALISÉS ici (Ruling 14) : `obsidian.json` les écrit avec
 * des `\`, et c'est ce chemin-là qui devient le `path` d'une racine quand
 * l'utilisateur clique.
 *
 * Une liste vide est un état NORMAL — Obsidian n'est pas installé, ou aucun
 * de ses vaults n'existe plus. L'écran n'affiche alors que le sélecteur.
 */
export async function obsidianVaults(): Promise<VaultConnu[]> {
	try {
		const vaults = await pont().systeme.vaultsObsidian();
		return vaults.map(v => ({ nom: v.nom, chemin: normaliserChemin(v.chemin) }));
	} catch (e) {
		console.warn(LOG_PREFIX, "liste des vaults Obsidian illisible:", e);
		return [];
	}
}

/**
 * Le dossier est-il un vault Obsidian ?
 *
 * La question n'est pas cosmétique : elle décide OÙ vont les résultats de quiz.
 * Dans un vault, le greffon écrit déjà dans `.obsidian/quiz-blocks-results` ;
 * l'application doit y écrire aussi, sinon les deux hôtes tiennent chacun leur
 * moitié de l'historique sur le même corpus. Hors d'un vault, il n'y a pas de
 * `.obsidian/` et les résultats vont dans `.neo-quiz/`.
 */
export async function estVaultObsidian(racine: string): Promise<boolean> {
	try {
		return await pont().fichiers.exists(`${normaliserChemin(racine)}/.obsidian`);
	} catch (e) {
		// Dossier illisible ou hors périmètre : on le traite comme un dossier
		// ordinaire plutôt que d'empêcher son ouverture.
		console.warn(LOG_PREFIX, "détection du vault impossible:", e);
		return false;
	}
}

/* ══════════════════════════════════════════════════════════
   LES DATES D'EXAMEN

   Indexées par la CLÉ DE MODULE (`review/catalogue.ts`, qui porte
   l'identifiant de racine) : une date saisie pour « Efrei/Reseaux » ne doit
   jamais resserrer les révisions de « Perso/Reseaux ». Valeur PERSISTÉE,
   au format AAAA-MM-JJ tel que saisi — jamais traduite, jamais reformatée.

   `examDates()` lit le réglage EN MÉMOIRE plutôt que le pont à chaque appel :
   le plan de l'ordonnanceur est recalculé souvent (chaque réponse jouée), et
   un aller-retour IPC à chaque calcul serait payé pour rien — le cache est
   `tableExamens`, chargé une fois au démarrage par `chargerExamens()`
   ci-dessous.

   `chargerExamDates`/`datesExamen`/`setExamDate`/`appliquerExamDate` (une
   seule date par module) sont partis à la tâche 4 (« plusieurs examens par
   dossier », 2026-09-26) : plus aucun appelant depuis que l'onglet Planning
   remplace le champ de « Modifier dossier ». `CLE_EXAM_DATES` reste : c'est
   la clé de la MIGRATION lue par `chargerExamens` (`lireExamens`, plus bas).
══════════════════════════════════════════════════════════ */

const CLE_EXAM_DATES = "examDates";

/**
 * `examDates()` DÉRIVE de `tableExamens` (plusieurs examens par module) :
 * elle rend, pour chaque module, la date du PROCHAIN examen — ainsi tout
 * lecteur déjà branché sur cette fonction (l'ordonnanceur) voit sans rien
 * changer l'examen qui compte pour resserrer les révisions, même quand
 * plusieurs sont saisis.
 */
export function examDates(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(tableExamens)
			.map(([m, l]) => [m, examenProchain(l, aujourdhuiIso(Date.now()))?.date] as const)
			.filter((e): e is [string, string] => !!e[1]),
	);
}

/* ══════════════════════════════════════════════════════════
   PLUSIEURS EXAMENS PAR DOSSIER (2026-09-26)

   `examDates()` ci-dessus ne gardait qu'UNE date par module : un semestre
   avec partiel ET final resserrait les révisions sur le mauvais des deux dès
   que le premier était passé, sans que rien ne le signale. `tableExamens`
   remplace `datesExamen` comme source de vérité ; `datesExamen` et
   `CLE_EXAM_DATES` restent lus une seule fois, à la MIGRATION.

   `Examen` est déclaré dans `src/types/dashboard-ctx.ts` (`ExamenDossier`) et
   réexporté ici : `src/` ne peut pas importer `apps/`, donc le type vit côté
   partagé et c'est ce fichier qui l'importe, jamais l'inverse.
══════════════════════════════════════════════════════════ */

export type Examen = ExamenDossier;

const CLE_EXAMENS = "examens";
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** La table des examens par module (cache mémoire, comme `datesExamen`). */
let tableExamens: Record<string, Examen[]> = {};

export function examens(): Record<string, Examen[]> {
	return tableExamens;
}

/** Cleans a stored `seances` list: valid ISO dates only, unique, sorted, at
    most 60. Anything unusable (not an array, nothing valid left) is `undefined`,
    so the exam stays a plain dated exam. */
function readSeances(brut: unknown): string[] | undefined {
	if (!Array.isArray(brut)) return undefined;
	const propres = [...new Set(brut.filter((d): d is string => typeof d === "string" && DATE_ISO.test(d)))].sort().slice(0, 60);
	return propres.length ? propres : undefined;
}

/**
 * Valide la forme du réglage `examens`, ignore les entrées invalides, et
 * MIGRE, tant que le réglage neuf n'a jamais été écrit (`brut` absent),
 * chaque date de `anciennes` (l'ancien réglage `examDates`) en un examen
 * `{ id: "migre-" + module, nom: "", date }`. PURE
 * : c'est cette fonction, et non `chargerExamens`, que `check:folders`
 * éprouve.
 */
export function lireExamens(brut: unknown, anciennes: unknown): Record<string, Examen[]> {
	const out: Record<string, Examen[]> = {};
	if (brut && typeof brut === "object" && !Array.isArray(brut)) {
		for (const [module, liste] of Object.entries(brut as Record<string, unknown>)) {
			if (!Array.isArray(liste)) continue;
			const valides = liste.filter((e): e is Examen => !!e && typeof e === "object"
				&& typeof (e as Examen).id === "string" && (e as Examen).id !== ""
				&& typeof (e as Examen).nom === "string"
				&& typeof (e as Examen).date === "string" && DATE_ISO.test((e as Examen).date))
				.map(e => {
					const seances = readSeances(e.seances);
					return {
						id: e.id, nom: e.nom,
						// A continuous assessment's date is always its last session.
						date: seances ? seances[seances.length - 1] : e.date,
						// An invalid weight is dropped, never the exam.
						...readExamWeight(e.coefficient, e.weightUnit),
						...(seances ? { seances } : {}),
					};
				});
			if (valides.length) out[module] = valides.sort((a, b) => a.date.localeCompare(b.date));
		}
	}
	/* La migration ne joue que si la clé `examens` n'a JAMAIS été écrite. Une
	   table écrite puis vidée (`{}`, ou un module retiré) est une décision :
	   l'ancien réglage `examDates`, jamais effacé, ferait sinon revenir au
	   lancement suivant l'examen qu'on vient de supprimer. */
	if ((brut === undefined || brut === null) && anciennes && typeof anciennes === "object" && !Array.isArray(anciennes)) {
		for (const [module, date] of Object.entries(anciennes as Record<string, unknown>)) {
			if (out[module] || typeof date !== "string" || !DATE_ISO.test(date)) continue;
			out[module] = [{ id: "migre-" + module, nom: "", date }];
		}
	}
	return out;
}

/** Ajoute ou remplace (même `id`) un examen d'un module, triée par date. */
export function enregistrerExamenDans(t: Record<string, Examen[]>, module: string, e: Examen): Record<string, Examen[]> {
	const liste = (t[module] ?? []).filter(x => x.id !== e.id);
	return { ...t, [module]: [...liste, { ...e }].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Retire un examen d'un module ; un module vidé perd sa clé. */
export function retirerExamenDe(t: Record<string, Examen[]>, module: string, id: string): Record<string, Examen[]> {
	const suivant = { ...t };
	const liste = (t[module] ?? []).filter(x => x.id !== id);
	if (liste.length) suivant[module] = liste; else delete suivant[module];
	return suivant;
}

/** Le premier examen de date `>= aujourdhui` (comparaison de chaînes
    `AAAA-MM-JJ`), sinon `null`. */
export function examenProchain(liste: readonly Examen[], aujourdhui: string): Examen | null {
	// A continuous assessment (`seances`) never drives the review schedule.
	return [...liste].filter(e => !e.seances).sort((a, b) => a.date.localeCompare(b.date)).find(e => e.date >= aujourdhui) ?? null;
}

/** `AAAA-MM-JJ` LOCAL — jamais UTC, sans quoi un examen du jour même
    disparaîtrait après le coucher du soleil UTC. */
export function aujourdhuiIso(now: number): string {
	const d = new Date(now);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function chargerExamens(): Promise<void> {
	let brutExamens: unknown;
	let brutAnciennes: unknown;
	try {
		brutExamens = await pont().reglages.lire(CLE_EXAMENS);
	} catch (e) {
		console.warn(LOG_PREFIX, "examens illisibles:", e);
		brutExamens = undefined;
	}
	try {
		brutAnciennes = await pont().reglages.lire(CLE_EXAM_DATES);
	} catch (e) {
		console.warn(LOG_PREFIX, "anciennes dates d'examen illisibles:", e);
		brutAnciennes = undefined;
	}
	// Pas de réécriture ici : la migration ne se matérialise qu'à la
	// première écriture (`enregistrerExamen`/`retirerExamen`).
	tableExamens = lireExamens(brutExamens, brutAnciennes);
}

export async function enregistrerExamen(module: string, e: Examen): Promise<void> {
	tableExamens = enregistrerExamenDans(tableExamens, module, e);
	await pont().reglages.ecrire(CLE_EXAMENS, tableExamens);
}

export async function retirerExamen(module: string, id: string): Promise<void> {
	tableExamens = retirerExamenDe(tableExamens, module, id);
	await pont().reglages.ecrire(CLE_EXAMENS, tableExamens);
}

/* ══════════════════════════════════════════════════════════
   LES AUTRES RÉGLAGES

   `reglagesStore()` (le magasin Tauri) a disparu avec `plugin-store`. Ses deux
   autres consommateurs — les statistiques par quiz (`review/stats.ts`) et les
   réglages de page du tableau de bord (`ui/dashboard-shell.ts`) — passent
   désormais par ces deux fonctions, qui sont le pont nu. Elles vivent ICI et
   non chez eux pour la raison qui avait fait exporter `reglagesStore` : un
   seul endroit du rendu sait où vivent les réglages.
══════════════════════════════════════════════════════════ */

export async function lireReglage<T>(cle: string): Promise<T | undefined> {
	return await pont().reglages.lire(cle) as T | undefined;
}

export async function ecrireReglage(cle: string, valeur: unknown): Promise<void> {
	await pont().reglages.ecrire(cle, valeur);
}
