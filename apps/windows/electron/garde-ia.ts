/* ══════════════════════════════════════════════════════════
   LA GARDE DE LA CLÉ `ai` DES RÉGLAGES — LA PARTIE PURE

   Tâche 6 de la génération IA dans l'application. La clé `ai` (`CLE_REGLAGES_IA`,
   `pont.ts`) est la première clé des réglages que le RENDU écrit et que le
   PRINCIPAL relit pour décider de ce qu'il a le droit de faire : l'hôte
   d'`aiOllamaUrl` entre dans la liste du réseau (`reseau.ts`), et
   `aiMentionExtraFolders` désigne des dossiers hors des racines que le
   sélecteur « @ » lit par les canaux `fichiers.*`.

   Sans garde, un rendu compromis écrirait `{ aiOllamaUrl: "https://attaquant
   .example" }` et obtiendrait cet hôte au prochain lancement — c'est le
   résiduel que `reseau.ts` a nommé jusqu'ici. La règle, ici, est la même que
   pour la clé `folders` (`verifierDossiers`, `canaux.ts`) : une valeur qui
   élargit ce que le principal accepte doit être vérifiée AVANT d'être écrite,
   et jamais par celui qui l'écrit.

   POURQUOI UN MODULE À PART, SANS `electron` NI `node:*` : le verdict est une
   fonction pure de la valeur et de deux prédicats, et c'est ce qui le rend
   éprouvable par `npm run check:electron-reglages` sur le CODE RÉEL —
   `canaux.ts`, lui, tire `electron` et ne se charge dans aucun script. Le
   dialogue natif (`dialog.showMessageBox`) et l'admission (`autoriserHote`)
   restent dans `canaux.ts` : ce module ne fait que DIRE ce qu'il faut faire.
══════════════════════════════════════════════════════════ */

import { HOTES_AUTORISES } from "./reseau";

/** Le verdict sur une valeur de la clé `ai`. Trois issues, jamais confondues :
    - `ok` : à écrire ; `admettre` est l'hôte d'`aiOllamaUrl` à faire entrer
      dans la liste du réseau AUSSITÔT (pas au prochain lancement), `null`
      quand le réglage ne porte pas d'URL ;
    - `refus` : ne rien écrire, et la cause est NOMMÉE — une écriture refusée
      en silence laisserait l'utilisateur croire son réglage enregistré ;
    - `confirmer` : l'hôte n'est ni dans la liste ni sur le réseau local, et
      seul l'UTILISATEUR peut l'admettre — par une porte NATIVE, que le rendu
      ne peut pas dessiner à sa place. */
export type VerdictReglagesIa =
	| { ok: true; admettre: string | null }
	| { refus: string }
	| { confirmer: string };

/**
 * Un hôte du RÉSEAU LOCAL, celui qu'on admet sans rien demander : la boucle
 * locale, les trois plages privées de la RFC 1918, et `.local` (mDNS, le nom
 * d'un NAS chez soi). Un Ollama sur ces hôtes est l'usage que le plan nomme ;
 * tout le reste est Internet, et Internet se confirme.
 *
 * `hostname` tel que `new URL().hostname` le rend : déjà en minuscules, et une
 * adresse IPv6 entre crochets (`[::1]`).
 */
export function hoteEstPrive(hostname: string): boolean {
	const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (!h) return false;
	if (h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	if (a === 127 || a === 10) return true;
	if (a === 192 && b === 168) return true;
	return a === 172 && b >= 16 && b <= 31;
}

/**
 * Les extensions qu'un CHEMIN DE CLI a le droit de porter. Une liste BLANCHE,
 * à l'inverse d'`EXTENSIONS_EXECUTABLES` (`ressources.ts`, une liste noire) —
 * et l'inversion n'est pas un caprice : `ouvrir` doit accepter tout ce qu'un
 * quiz peut livrer (PDF, image, `.docx`, `.ipynb`…) et n'exclure que ce qui
 * s'exécute, là où un CLI est au contraire une chose très précise.
 *
 * LA RÈGLE, ET SA RAISON. Ce réglage désigne un programme que l'application
 * LANCERA. Il n'a donc de sens que pour ce que son lanceur sait lancer :
 * `spawn` direct (`.exe`, `.com`, ou un fichier sans extension sous Unix), ou
 * le repli `cmd.exe` des installations npm (`.cmd`, `.bat`) ; `.sh` pour un
 * shim Unix. TOUT LE RESTE EST REFUSÉ, et les deux moitiés du refus comptent :
 * — un `.docx`, un `.txt`, un `.png` ne se lancent pas : accepté, le réglage
 *   produirait un échec obscur au moment de générer, très loin de l'écran où
 *   il a été saisi ;
 * — un `.js`, un `.ps1`, un `.vbs`, un `.hta`, un `.reg` sont des SCRIPTS
 *   qu'un interpréteur choisi par le SYSTÈME exécuterait, pas nous. Le pont
 *   refuse déjà de les OUVRIR (`systeme.ouvrir`, `EXTENSIONS_EXECUTABLES`) ;
 *   les admettre ici rouvrirait la même porte par l'autre bout — `write` d'un
 *   `.js` dans un dossier ouvert, puis ce chemin dans le réglage, et la
 *   génération suivante l'exécute.
 *
 * Un fichier SANS extension passe : c'est la forme normale d'un exécutable sous
 * Unix. Sous Windows il ne se lancera pas, et le rejet `introuvable` le dira au
 * moment du lancement — un refus ici serait faux pour l'autre moitié du monde.
 */
export const EXTENSIONS_CLI: ReadonlySet<string> = new Set(["exe", "com", "cmd", "bat", "sh"]);

/**
 * Un chemin ABSOLU ? PURE, et sans `node:path` (ce module ne tire aucun Node,
 * c'est ce qui le rend chargeable par `check:electron-reglages`).
 *
 * Les trois formes absolues qui existent : lettre de lecteur (`C:\…`, `C:/…`),
 * UNC (`\\serveur\part`), et racine POSIX (`/usr/bin/claude`). Un chemin
 * RELATIF est refusé parce qu'il serait résolu contre le dossier courant du
 * PROCESSUS PRINCIPAL — que l'utilisateur ne connaît pas et qui n'a rien à voir
 * avec l'écran où il a saisi le réglage : `claude` y désignerait tout autre
 * chose que ce qu'il croit, et un `../` y remonterait où il ne pense pas.
 */
export function estCheminAbsolu(chemin: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(chemin) || chemin.startsWith("\\\\") || chemin.startsWith("/");
}

/**
 * Un dossier de sortie IA reste une clé RELATIVE dans une racine ouverte.
 * Le rendu le passe ensuite à `HostPaths.contractPath` : accepter ici un
 * chemin absolu, un retour `..` ou un séparateur Windows permettrait de
 * contourner cette composition et de viser ailleurs que la racine choisie.
 * Le prédicat reste pur pour que la garde soit éprouvée sans Electron ni Node.
 */
export function estDossierSortieIaValide(valeur: unknown): valeur is string {
	if (typeof valeur !== "string" || !valeur || valeur !== valeur.trim()) return false;
	if (estCheminAbsolu(valeur) || /[<>:"|?*\\\u0000-\u001f]/.test(valeur)) return false;
	const segments = valeur.split("/");
	return segments.every(segment => !!segment && segment !== "." && !segment.includes(".."));
}

/**
 * The bounds of an Exam's typed duration, in minutes. The SAME values as
 * `EXAM_DURATION_MIN` / `EXAM_DURATION_MAX` (`src/quiz-utils.ts`), repeated
 * here because that module pulls JSON5 into the main process for two numbers;
 * `check:electron-reglages` compares the two so they cannot drift apart.
 */
export const EXAM_DURATION_MIN_MINUTES = 1;
export const EXAM_DURATION_MAX_MINUTES = 300;

/** A typed Exam duration is a whole number of minutes within the bounds. It
    reaches the prompt and is written into the quiz: a fraction, a string or
    a huge number would be a corrupted setting, refused rather than cut. */
export function isValidExamDuration(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value)
		&& value >= EXAM_DURATION_MIN_MINUTES && value <= EXAM_DURATION_MAX_MINUTES;
}

/** L'extension d'un chemin, en minuscules, ou la chaîne vide s'il n'en a pas.
    Sur le DERNIER point du NOM seul : `C:/a.b/claude` n'a pas d'extension, et
    `claude.pdf.exe` en a une — `.exe`. */
function extensionDe(chemin: string): string {
	const nom = chemin.replace(/\\/g, "/").split("/").pop() ?? "";
	const point = nom.lastIndexOf(".");
	return point <= 0 ? "" : nom.slice(point + 1).toLowerCase();
}

/* LES CHEMINS DE CLI RÉGLÉS À LA MAIN N'EXISTENT PLUS (2026-09-17).

   `verifierCheminCli` et `cheminCliPourLancement` gardaient deux clés,
   `cheminClaude` et `cheminCodex`, par lesquelles l'utilisateur désignait
   l'exécutable à lancer quand la sonde automatique échouait. Les deux champs
   ont été retirés des Réglages : le principal fusionne désormais le `PATH` du
   REGISTRE dans le sien au démarrage (`process.ts`, `chargerPathRegistre`),
   ce qui rattrape la vraie cause des « CLI introuvable » — un `PATH` de
   processus figé au lancement, qu'aucun installateur ne peut mettre à jour
   après coup.

   CE RETRAIT RESSERRE LA SÉCURITÉ, il ne la relâche pas. La séquence que ces
   gardes existaient pour rendre impossible — `fichiers.write("<racine>/x.cmd")`
   puis ce chemin dans le réglage, et la génération suivante lance ce que le
   rendu vient d'écrire, avec les droits du principal — n'a plus de second
   temps : aucun chemin d'exécutable ne vient plus de la fenêtre, ni par l'IPC
   ni par les réglages. Ne reste que la LISTE BLANCHE DE NOMS résolus sur le
   `PATH` (`process.ts`, `resoudreExecutable`).

   Ce qu'une installation a déjà écrit sous ces deux clés reste dans
   `settings.json`, ignoré — plus personne ne le lit. */

/**
 * Le verdict sur la valeur que le rendu veut écrire sous la clé `ai`.
 *
 * `aiOllamaUrl`, s'il est présent, doit être une URL `http(s)` lisible : son
 * hôte est admis d'office s'il est dans la liste du réseau ou sur le réseau
 * local, et demandé à l'utilisateur sinon. `aiMentionExtraFolders`, s'il est
 * présent, doit être un tableau de chaînes dont CHACUNE est déjà dans le
 * périmètre (`perimetreContient`) — la même règle que `folders`, et pour la
 * même raison : un dossier hors périmètre inscrit là serait lu par le
 * sélecteur « @ » au prochain lancement. L'application n'a aucune interface
 * pour remplir cette clé aujourd'hui ; la garde existe avant l'interface.
 *
 * Les autres champs (modèle, effort, journal d'usage) ne donnent aucun droit
 * au principal : ils passent tels quels.
 */
export async function validerReglagesIa(
	valeur: unknown,
	perimetreContient: (chemin: string) => Promise<boolean>,
	fichierExiste: (chemin: string) => Promise<boolean>,
): Promise<VerdictReglagesIa> {
	if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) {
		return { refus: "AI settings refused: the value is not an object" };
	}
	const { aiOllamaUrl, aiMentionExtraFolders, aiOutputFolder, aiExamDurationMinutes } = valeur as {
		aiOllamaUrl?: unknown; aiMentionExtraFolders?: unknown; aiOutputFolder?: unknown; aiExamDurationMinutes?: unknown;
	};

	if (aiOutputFolder !== undefined && !estDossierSortieIaValide(aiOutputFolder)) {
		return { refus: "AI settings refused: aiOutputFolder must be a safe relative path" };
	}

	// Absent or `null` is Auto; anything else must be a whole number of minutes in range.
	if (aiExamDurationMinutes !== undefined && aiExamDurationMinutes !== null && !isValidExamDuration(aiExamDurationMinutes)) {
		return { refus: `AI settings refused: aiExamDurationMinutes must be a whole number from ${EXAM_DURATION_MIN_MINUTES} to ${EXAM_DURATION_MAX_MINUTES}, or empty` };
	}

	if (aiMentionExtraFolders !== undefined) {
		if (!Array.isArray(aiMentionExtraFolders) || aiMentionExtraFolders.some(d => typeof d !== "string")) {
			return { refus: "AI settings refused: aiMentionExtraFolders must be an array of strings" };
		}
		for (const dossier of aiMentionExtraFolders as string[]) {
			if (!(await perimetreContient(dossier))) {
				return { refus: "folder outside the perimeter, refused in the AI settings: " + dossier };
			}
		}
	}

	if (aiOllamaUrl === undefined) return { ok: true, admettre: null };
	if (typeof aiOllamaUrl !== "string") {
		return { refus: "AI settings refused: aiOllamaUrl must be a string" };
	}
	let url: URL;
	try {
		url = new URL(aiOllamaUrl);
	} catch {
		return { refus: "AI settings refused: aiOllamaUrl is unreadable: " + aiOllamaUrl };
	}
	/* Le protocole, pas seulement l'hôte — la même moitié que `hoteAutorise`
	   (`reseau.ts`) : `file://127.0.0.1/C:/x` porte un hôte de la liste. */
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { refus: "AI settings refused: aiOllamaUrl must be http(s): " + aiOllamaUrl };
	}
	const hote = url.hostname.toLowerCase();
	if (HOTES_AUTORISES.has(hote) || hoteEstPrive(hote)) return { ok: true, admettre: hote };
	return { confirmer: hote };
}
