/* ══════════════════════════════════════════════════════════
   LES RESSOURCES — L'URL D'UNE IMAGE, ET LE CHEMIN QU'ELLE DÉSIGNE

   Tâche 4 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Sous Tauri,
   `convertFileSrc` fabriquait pour `HostLinks.resourceUrl` une URL que la
   WebView servait elle-même (`http://asset.localhost/<chemin>`), bornée par la
   portée du protocole d'asset. Electron n'a pas d'équivalent : le processus
   principal enregistre un protocole (`protocol.handle`, `main.ts`) et c'est CE
   module qui dit, des deux côtés, à quoi ressemble l'URL et ce qu'elle désigne.

   Il vit dans `electron/` mais n'importe NI Node NI Electron, comme
   `catalogue.ts` : le rendu (`apps/windows/src/host/links.ts`) fabrique l'URL,
   le principal la lit, et une règle recopiée de part et d'autre aurait
   divergé — deux copies d'une même règle l'ont déjà fait une fois dans ce
   dépôt. `Perimetre` n'est importé qu'en TYPE : `perimetre.ts` tire
   `node:fs`, qui n'a rien à faire dans le paquet du rendu.

   LE SCHÉMA EST `app:`, ET CE N'EST PAS UN CHOIX LIBRE. La liste blanche du
   sanitizer (`src/engine/sanitizer.ts`, `isSafeQuizUrl`) n'admet pour un
   `src` d'image que `https?:`, `app:`, `file:`, `blob:` et `data:image/` — et
   `src/` ne bouge pas à cette tranche. Un schéma inventé (« neo-res: »)
   aurait fait RETIRER par le sanitizer chaque image d'option
   (`src/engine/cards.ts` résout puis assainit), sans erreur : des quiz sans
   images. `app:` est le schéma qu'Obsidian donne à ses propres ressources, et
   c'est exactement ce qu'il désigne ici aussi : « une ressource servie par
   l'application ». `file:` aurait passé la liste blanche aussi, mais une page
   chargée en `http://localhost` (le serveur de développement) n'a pas le droit
   de charger `file://`, et rien ne l'aurait borné.

   L'URL PORTE LE CHEMIN ABSOLU, et le principal le BORNE. Le pont ne parle
   que de chemins absolus (voir l'en-tête de `pont.ts`) : les chemins du
   contrat sont les clés du journal de révision et ne franchissent pas l'IPC,
   et la convention interne de l'index (« 0/Cours/ch1.md ») ne la franchit pas
   non plus — `absoluDepuisContrat` (`index-fichiers.ts`) ne comprend QUE
   cette convention, jamais « Efrei/Cours/ch1.md ». Une URL qui porterait un
   indice de racine dépendrait en plus de l'ORDRE que `demarrer` a retenu
   après filtrage : une racine refusée décalerait tous les indices suivants
   et ferait servir l'image d'un autre dossier. Le chemin absolu n'a pas ce
   problème, et il passe par `perimetre.borner` exactement comme chaque canal
   `fichiers.*` : MÊME liste blanche, jamais une seconde (Ruling 13 — c'est la
   porte que la tâche 3 a mis deux rondes à fermer).
══════════════════════════════════════════════════════════ */

import type { Perimetre } from "./perimetre";

/** Le schéma — voir l'en-tête pour pourquoi ce n'est pas un nom inventé. */
export const SCHEMA_RESSOURCES = "app";
/** L'hôte de l'URL : ce qui distingue nos ressources de tout autre `app://`. */
export const HOTE_RESSOURCES = "neo-res";

/**
 * The URL prefix of the resources, WITH its trailing slash. `app://neo-res/` on
 * Windows; the Android shim sets `window.neoPlatform.resourceBase` to a path
 * under the WebView's own origin (`https://appassets.androidplatform.net/neo-res/`),
 * which Kotlin serves behind the same perimeter (`ResourceRoute.kt`): an Android
 * WebView has no custom scheme handler. Read through `globalThis`, as this
 * module is loaded by the main process and by checks outside any window.
 */
export function baseRessources(): string {
	const base = (globalThis as { neoPlatform?: { resourceBase?: unknown } }).neoPlatform?.resourceBase;
	return typeof base === "string" && base.endsWith("/") ? base : `${SCHEMA_RESSOURCES}://${HOTE_RESSOURCES}/`;
}

/**
 * L'URL affichable d'un fichier du disque (chemin ABSOLU, séparateurs `/`).
 *
 * Chaque segment est encodé (espaces, `#`, `?`, accents), SAUF le `:` du
 * lecteur : `D%3A` serait valide mais illisible dans un `src`, et c'est une
 * URL qu'on relit dans l'inspecteur quand une image ne s'affiche pas.
 */
export function urlDeRessource(absolu: string): string {
	const segments = String(absolu ?? "").replace(/\\/g, "/").split("/")
		.map(s => encodeURIComponent(s).replace(/%3A/gi, ":"));
	return `${baseRessources()}${segments.join("/")}`;
}

/**
 * Le chemin absolu qu'une URL de ressource désigne, AVANT tout bornage — ou
 * `null` si ce n'est pas une URL de ce protocole (autre schéma, autre hôte,
 * URL illisible). `null` n'est pas une erreur : le gestionnaire répond 404.
 */
export function cheminDeRessource(url: string): string | null {
	let u: URL;
	try {
		u = new URL(String(url ?? ""));
	} catch {
		return null;
	}
	if (u.protocol !== `${SCHEMA_RESSOURCES}:` || u.host !== HOTE_RESSOURCES) return null;
	let chemin: string;
	try {
		chemin = decodeURIComponent(u.pathname);
	} catch {
		return null; // un `%` orphelin : pas un chemin.
	}
	chemin = chemin.replace(/^\/+/, "");
	return chemin || null;
}

/**
 * Le chemin que le protocole a le droit de servir pour cette URL, ou `null`
 * s'il doit REFUSER : URL étrangère au protocole, ou chemin hors du périmètre.
 *
 * C'est la fonction que le gestionnaire de `main.ts` appelle, et elle est ici
 * plutôt que là-bas pour être ÉPROUVÉE sur le module réel
 * (`scripts/check-electron-reglages.mjs`) — `main.ts` importe Electron, aucun
 * script de contrôle ne peut le charger. Le bornage est celui de `borner`,
 * qui replie `..`, suit les jonctions et compare au chemin RÉSOLU : une URL
 * qui encoderait `%2E%2E` pour sortir d'une racine arrive ici décodée, puis
 * repliée, puis refusée.
 */
export async function resoudreRessource(perimetre: Perimetre, url: string): Promise<string | null> {
	const chemin = cheminDeRessource(url);
	if (!chemin) return null;
	try {
		return await perimetre.borner(chemin);
	} catch {
		return null;
	}
}

/* ─────────── ce que `systeme.ouvrir` refuse d'ouvrir ─────────── */

/**
 * Les extensions que `systeme.ouvrir` (`canaux.ts`) REFUSE, quel que soit le
 * périmètre — revue finale de la migration, I1.
 *
 * LE PÉRIMÈTRE BORNE L'ÉCRITURE ET LA LECTURE, PAS L'EXÉCUTION. `ouvrir` passe
 * par `shell.openPath`, qui lance l'application par défaut du système — et pour
 * un `.bat`, un `.exe` ou un `.ps1`, « l'application par défaut » EST le
 * fichier. Deux appels bornés, chacun dans les règles, composent alors une
 * exécution : `fichiers.write("<vault>/x.bat", …)` puis
 * `systeme.ouvrir("<vault>/x.bat")`. Le périmètre, pris comme barrière, est
 * contourné. Et il n'y a même pas besoin d'un XSS : `src/engine/resources.ts`
 * ouvre par NOM un fichier livré avec le dossier du quiz — un quiz PARTAGÉ
 * dont le dossier contient `fiche.bat` et un bouton « ressource » suffit.
 * Même forme sous Tauri, donc pas une régression ; mais c'est exactement la
 * porte que le périmètre prétend fermer.
 *
 * Une liste NOIRE, pas blanche : ce que l'utilisateur ouvre depuis un quiz
 * (PDF, image, `.docx`, `.xlsx`, `.pptx`, `.ipynb`…) est trop varié pour être
 * énuméré, et un type refusé à tort serait une ressource morte sans message —
 * alors que ce qui S'EXÉCUTE en double-clic sous Windows est une liste courte
 * et connue. Elle vit ici, dans un module sans Node ni Electron, pour être
 * ÉPROUVÉE (`scripts/check-electron-reglages.mjs`) : `canaux.ts` importe
 * `electron`, aucun contrôle ne peut le charger.
 */
export const EXTENSIONS_EXECUTABLES: ReadonlySet<string> = new Set([
	"exe", "bat", "cmd", "com", "scr", "pif", "lnk",
	"js", "jse", "vbs", "vbe", "wsf", "wsh", "hta",
	"msi", "ps1", "reg", "url",
	/* Élargie le 2026-09-25 sur la liste des pièces jointes que Windows et
	   Outlook tiennent pour dangereuses : panneaux de configuration, consoles,
	   modules PowerShell, raccourcis d'explorateur, paquets, scripts que le
	   système sait lancer. Refuser à tort un de ceux-là ne coûte presque rien :
	   aucun n'est un support de cours. */
	"ade", "adp", "app", "application", "appref-ms", "appx", "appxbundle", "appinstaller",
	"bas", "cab", "chm", "cpl", "crt", "csh", "der", "diagcab", "gadget", "grp", "hlp",
	"htc", "inf", "ins", "isp", "its", "jar", "jnlp", "ksh", "library-ms",
	"mad", "maf", "mag", "mam", "maq", "mar", "mas", "mat", "mau", "mav", "maw",
	"mcf", "mda", "mdb", "mde", "mdt", "mdw", "mdz", "msc", "msh", "msh1", "msh2",
	"mshxml", "msh1xml", "msh2xml", "msix", "msixbundle", "msp", "mst", "msu", "ops",
	"osd", "pcd", "pl", "plg", "prf", "prg", "printerexport", "ps1xml", "ps2",
	"ps2xml", "psc1", "psc2", "psd1", "psm1", "py", "pyc", "pyo", "pyw", "pyz", "pyzw",
	"scf", "sct", "search-ms", "searchconnector-ms", "settingcontent-ms", "shb", "shs",
	"theme", "vb", "vbp", "vhd", "vhdx", "vsmacros", "vsw", "webpnp", "website", "ws",
	"wsb", "wsc", "xbap", "xll", "xnk",
	/* Seconde revue du même jour : une image disque se MONTE (et contourne le
	   marquage « téléchargé d'Internet »), un `.rdp` connecte au serveur d'un
	   tiers, un thème fait fuir l'identifiant NTLM. */
	"iso", "img", "rdp", "appcontent-ms", "themepack", "deskthemepack", "asx",
	"cnt", "hpj", "pssc", "psdm1",
]);

/**
 * Vrai si `ouvrir` doit REFUSER ce chemin. Sur l'extension seule, casse
 * ignorée (`X.BAT` s'exécute autant que `x.bat`), et sur le DERNIER point du
 * nom : `notes.pdf.exe` est un `.exe`. Un chemin sans extension n'est pas
 * refusé — Windows ne l'exécute pas en double-clic. Un nom réduit à son
 * extension (`.bat`), si : Windows l'exécute.
 *
 * Le nom est lu COMME WINDOWS LE LIT (2026-09-25) : Win32 retire les points
 * et les espaces de fin, donc `x.bat.` et `x.bat ` OUVRENT `x.bat` — l'ancien
 * test voyait une extension vide, ou « bat  », et laissait passer. Un « : »
 * dans le nom désigne un flux NTFS (`x.bat::$DATA`) : refusé d'office, aucun
 * document de cours n'en a besoin.
 */
export function extensionRefusee(chemin: string): boolean {
	const brut = String(chemin ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
	if (brut.includes(":")) return true;
	const nom = brut.replace(/[. ]+$/, "");
	/* Un nom qui COMMENCE par le point (`.bat`) : Node n'y voit pas
	   d'extension, mais Windows (`PathFindExtension`, qu'emploie
	   ShellExecute) y voit `.bat`, et l'exécute. On lit comme Windows. */
	const point = nom.lastIndexOf(".");
	if (point < 0) return false;
	return EXTENSIONS_EXECUTABLES.has(nom.slice(point + 1).toLowerCase());
}
