/* ══════════════════════════════════════════════════════════
   LE PARTAGE D'UN QUIZ OU D'UN DOSSIER — côté PRINCIPAL (2026-09-25).

   Le greffon partageait déjà (`src/dashboard/share.ts`, retiré avec le
   tableau de bord le 2026-09-13) en appelant Node depuis la fenêtre. Ici, la
   fenêtre ne donne que deux choses : un NOM de fichier et ses OCTETS. Tout le
   reste — où écrire, quoi lancer — est décidé par ce module :

   - « Enregistrer » : l'EMPLACEMENT vient du dialogue natif, donc de
     l'utilisateur, jamais du rendu ; l'extension est imposée.
   - The Windows Share panel (since 2026-10-03, replacing the Discord
     script): the file goes to a random temporary folder, and the PowerShell
     that opens the panel only reads that path, which this process composed
     itself, from an environment variable (`VARIABLE_FICHIER`). The name from
     the window is sanitised FIRST (`nomPartage`), and the path is NEVER
     written into the script: no quoting, so no apostrophe, ASCII or
     typographic, to break out of.

   `nomPartage`, `octetsPartage` and `scriptPartageNatif` are PURE:
   `npm run check:partage` les éprouve sans rien lancer.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHARE_MAX_BYTES } from "../../../src/dashboard/zip";

/** Ce qu'un partage produit : le zip d'un dossier, le .md d'un quiz. */
export const EXTENSIONS_PARTAGE = [".zip", ".md"] as const;
/** Un partage porte des NOTES (texte) et, depuis le 2026-10-01, les IMAGES
    que ces notes intègrent : les neuf quiz d'un dossier de cours pèsent
    quelques centaines de Ko. 16 Mo (la MÊME borne que côté fenêtre, qui
    écarte les images en trop et le dit : `share-pack.ts`) ; au-delà, c'est
    une fenêtre qui envoie n'importe quoi. */
export const TAILLE_MAX_PARTAGE = SHARE_MAX_BYTES;

/** Le nom de fichier assaini, ou `null` s'il n'est pas un partage : pas de
    séparateur de chemin (un nom, jamais un chemin), pas de caractère interdit
    par Windows, une extension de la liste. */
export function nomPartage(nom: unknown): string | null {
	if (typeof nom !== "string") return null;
	const propre = nom
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
		.replace(/^[\s.]+|[\s.]+$/g, "")
		.trim();
	if (propre.length === 0 || propre.length > 150) return null;
	const point = propre.lastIndexOf(".");
	if (point <= 0) return null;
	const ext = propre.slice(point).toLowerCase();
	return (EXTENSIONS_PARTAGE as readonly string[]).includes(ext) ? propre : null;
}

export function octetsPartage(octets: unknown): Uint8Array | null {
	if (!(octets instanceof Uint8Array)) return null;
	return octets.length > 0 && octets.length <= TAILLE_MAX_PARTAGE ? octets : null;
}

/** La variable d'environnement par laquelle le script reçoit le chemin. */
export const VARIABLE_FICHIER = "NEO_QUIZ_PARTAGE_FICHIER";

/** UN partage à la fois (2026-09-25). Une fenêtre compromise pouvait sinon
    lancer le partage en boucle : un PowerShell et un fichier temporaire par
    appel, ou une pile de dialogues « Enregistrer sous ». Rien n'y donnait un
    accès, mais c'était une nuisance sans borne. `prendre` rend `false` si le
    verrou est déjà tenu, ou pris il y a moins de `intervalleMin` ms même
    s'il est rendu (un clic humain ne partage pas plus vite) ; il retombe de
    lui-même après `delaiMax` ms, pour qu'un processus qui ne rendrait jamais
    la main ne bloque pas le partage jusqu'au redémarrage. */
export function creerVerrou(delaiMax: number, intervalleMin = 0, maintenant: () => number = Date.now, recupere?: () => void): { prendre(): number | null; rendre(jeton: number): void } {
	let pris: number | null = null;
	let dernier: number | null = null;
	let compteur = 0;
	let jetonCourant = 0;
	return {
		/** Un JETON si le verrou est pris, `null` sinon. */
		prendre() {
			const t = maintenant();
			if (pris !== null && t - pris < delaiMax) return null;
			if (dernier !== null && t - dernier < intervalleMin) return null;
			// A lock older than its bound is taken over (and logged): whatever
			// bug left it held can never block sharing for good.
			if (pris !== null) recupere?.();
			pris = dernier = t;
			jetonCourant = ++compteur;
			return jetonCourant;
		},
		/** Ne rend que SON verrou : un processus qui finit après que le verrou
		    est retombé de lui-même ne libère pas celui du partage suivant. */
		rendre(jeton: number) { if (jeton === jetonCourant) pris = null; },
	};
}

/** One lock PER ACTION: an open "Save as" dialog must not block the share
    panel, nor the reverse (second review of 2026-09-25). Saving: one dialog
    at a time; it may stay open a long time. */
export const verrouEnregistrer = creerVerrou(10 * 60_000);

const PREFIXE_TEMPORAIRE = "neo-quiz-partage-";
/** Âge au-delà duquel un fichier partagé vers Discord est effacé : le temps
    de le coller et que Discord l'ait lu. */
export const AGE_MAX_TEMPORAIRE = 10 * 60 * 1000;

/** Les dossiers temporaires de partage à effacer : les NÔTRES seulement
    (préfixe), et plus vieux que `AGE_MAX_TEMPORAIRE`. Pur. */
export function temporairesPerimes(entrees: { nom: string; mtimeMs: number; dossier: boolean }[], maintenant: number): string[] {
	return entrees
		.filter(e => e.dossier && e.nom.startsWith(PREFIXE_TEMPORAIRE) && maintenant - e.mtimeMs > AGE_MAX_TEMPORAIRE)
		.map(e => e.nom);
}

/** Efface les partages périmés du dossier temporaire. `lstat` : un lien ou
    une jonction portant notre préfixe n'est jamais suivi. Tout échec est
    muet : le ménage ne doit pas empêcher un partage. */
async function nettoyerTemporaires(): Promise<void> {
	try {
		const racine = tmpdir();
		const entrees: { nom: string; mtimeMs: number; dossier: boolean }[] = [];
		for (const nom of await readdir(racine)) {
			if (!nom.startsWith(PREFIXE_TEMPORAIRE)) continue;
			try {
				const s = await lstat(join(racine, nom));
				entrees.push({ nom, mtimeMs: s.mtimeMs, dossier: s.isDirectory() && !s.isSymbolicLink() });
			} catch { /* disparu entre-temps */ }
		}
		for (const nom of temporairesPerimes(entrees, Date.now())) {
			await rm(join(racine, nom), { recursive: true, force: true }).catch(() => {});
		}
	} catch { /* dossier temporaire illisible : rien à nettoyer */ }
}

/** Écrit le fichier dans un dossier temporaire NEUF et rend son chemin. Un
    dossier par partage : deux quiz homonymes partagés coup sur coup ne
    s'écrasent pas, alors que le presse-papier du premier pointe encore sur
    son fichier. Les partages de plus de dix minutes sont effacés au passage :
    avec le verrou et la borne de taille, le disque temporaire ne peut plus
    se remplir, même depuis une fenêtre qui partagerait en boucle. */
export async function ecrireTemporaire(nom: string, octets: Uint8Array): Promise<string> {
	await nettoyerTemporaires();
	const dossier = await mkdtemp(join(tmpdir(), PREFIXE_TEMPORAIRE));
	const dest = join(dossier, nom);
	await writeFile(dest, octets);
	return dest;
}

/* ── THE NATIVE WINDOWS SHARE PANEL (2026-10-03) ──
   What Neo Calendar gets from `navigator.share` in WebView2, which Electron
   does not provide: Windows' own "Share" panel (Discord, WhatsApp, Outlook,
   Teams, Nearby Share…), for a text (the sync ID) or a file (a quiz .md, a
   folder .zip). The panel belongs to a window, and only a WinRT interop
   (`IDataTransferManagerInterop`) opens it from a desktop process: Electron
   has no API for it, so a hidden PowerShell process creates a 1-pixel
   window of its own, centred on the app, and opens the panel on it.

   The script is CONSTANT, and everything it
   needs travels in environment variables it reads itself (the title, the
   text, the absolute path of a temporary file this module wrote, the point
   to centre on). Nothing from the window is ever spliced into the script.
   The script prints `SHOWN`, `CHOSEN` or `ERROR:<message>` on stdout. It
   ends 15 s after an app was chosen (the target reads the file by then) or
   after 90 s; the main process also kills it (30 s without `SHOWN`, 90 s in
   all). `DataTransferManager` has NO cancel event (its events are
   `DataRequested`, `TargetApplicationChosen`, `ShareProvidersRequested`,
   checked on Windows 11 build 26300): the old `add_ShareCanceled`
   subscription threw, was swallowed, and a dismissed panel left the process
   and the lock alive for five and six minutes. */

export const VARIABLES_NATIF = {
	titre: "NEO_QUIZ_PARTAGE_TITRE",
	texte: "NEO_QUIZ_PARTAGE_TEXTE",
	fichier: VARIABLE_FICHIER,
	x: "NEO_QUIZ_PARTAGE_X",
	y: "NEO_QUIZ_PARTAGE_Y",
} as const;

/** Without a "panel shown" signal after this long, the process is killed. */
export const BORNE_SANS_SIGNAL_MS = 30_000;
/** Hard bound on one share, whatever happens (was 6 minutes, the cause of
    "A share is already in progress" staying on screen with no panel). */
export const BORNE_TOTALE_MS = 90_000;

const journalRecuperation = (nom: string) => () => console.warn(`[partage] ${nom}: lock older than its bound taken over`);
/** One native FILE share at a time. No minimum spacing any more: a double
    click joins the first call (see `canaux.ts`) instead of raising a "busy"
    toast with nothing on screen. */
export const verrouNatif = creerVerrou(BORNE_TOTALE_MS, 0, Date.now, journalRecuperation("file"));
/** The sync-ID share has its own lock: a stuck quiz share must not block it. */
export const verrouSync = creerVerrou(BORNE_TOTALE_MS, 0, Date.now, journalRecuperation("sync"));

export function scriptPartageNatif(): string {
	return `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$dtmType = [Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
Add-Type -ReferencedAssemblies System.Runtime.WindowsRuntime -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
namespace NeoQuiz {
	public static class NativeShare {
		[ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
		interface IDataTransferManagerInterop {
			IntPtr GetForWindow(IntPtr appWindow, [In] ref Guid riid);
			void ShowShareUIForWindow(IntPtr appWindow);
		}
		static IDataTransferManagerInterop Interop(Type dtm) { return (IDataTransferManagerInterop)WindowsRuntimeMarshal.GetActivationFactory(dtm); }
		public static object ForWindow(Type dtm, IntPtr hwnd) {
			Guid iid = new Guid("A5CAEE9B-8708-49D1-8D36-67D25A8DA00C");
			return Marshal.GetObjectForIUnknown(Interop(dtm).GetForWindow(hwnd, ref iid));
		}
		public static void Show(Type dtm, IntPtr hwnd) { Interop(dtm).ShowShareUIForWindow(hwnd); }
	}
}
'@
$titre = $env:${VARIABLES_NATIF.titre}
$texte = $env:${VARIABLES_NATIF.texte}
$chemin = $env:${VARIABLES_NATIF.fichier}
$script:fichier = $null
if ($chemin) {
	$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
	$tache = $asTask.MakeGenericMethod([Windows.Storage.StorageFile]).Invoke($null, @([Windows.Storage.StorageFile]::GetFileFromPathAsync($chemin)))
	$null = $tache.Wait(-1)
	$script:fichier = $tache.Result
}
function Signal($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'; $f.ShowInTaskbar = $false; $f.Width = 1; $f.Height = 1; $f.Opacity = 0.01
$x = 0; $y = 0
if ([int]::TryParse($env:${VARIABLES_NATIF.x}, [ref]$x) -and [int]::TryParse($env:${VARIABLES_NATIF.y}, [ref]$y)) {
	$f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point $x, $y
} else { $f.StartPosition = 'CenterScreen' }
$fin = New-Object System.Windows.Forms.Timer; $fin.Interval = 90000; $fin.Add_Tick({ $f.Close() }); $fin.Start()
$f.Add_Shown({
	try {
		$script:dtm = [NeoQuiz.NativeShare]::ForWindow($dtmType, $f.Handle)
		$script:dtm.add_DataRequested({ param($s, $e)
			$e.Request.Data.Properties.Title = $titre
			if ($script:fichier) { $e.Request.Data.SetStorageItems([Windows.Storage.IStorageItem[]]@($script:fichier)) }
			elseif ($texte) { $e.Request.Data.SetText($texte) }
		})
		$script:dtm.add_TargetApplicationChosen({ param($s, $e) Signal 'CHOSEN'; $fin.Stop(); $fin.Interval = 15000; $fin.Start() })
		[NeoQuiz.NativeShare]::Show($dtmType, $f.Handle)
		Signal 'SHOWN'
	} catch { Signal ('ERROR:' + ($_.Exception.Message -replace '[\\r\\n]+', ' ')); $f.Close() }
})
[System.Windows.Forms.Application]::Run($f)
`;
}

export interface PartageNatif {
	titre: string;
	/** A text to share, or… */
	texte?: string;
	/** …the absolute path of a file this module wrote (`ecrireTemporaire`). */
	fichier?: string;
	/** Where to centre the panel: the middle of the app window, in screen pixels. */
	centre?: { x: number; y: number };
}

/** What a share did, told truthfully: `ok` only once the panel is SHOWN. */
export type ResultatPartage =
	| { ok: true }
	| { ok: false; raison: "lancement" | "sortie" | "delai" | "erreur"; message: string };

interface FluxPartage { on(ev: "data", cb: (d: Buffer | string) => void): unknown }
/** The part of a child process this module uses (so a test can fake it). */
export interface EnfantPartage {
	stdout: FluxPartage | null;
	stderr: FluxPartage | null;
	on(ev: "exit" | "close", cb: (code: number | null) => void): unknown;
	on(ev: "error", cb: (e: Error) => void): unknown;
	kill(): unknown;
}
export interface DepsPartage {
	lancer?: (commande: string, args: string[], env: NodeJS.ProcessEnv) => EnfantPartage;
	minuteur?: { set(f: () => void, ms: number): unknown; clear(h: unknown): void };
	/** Called once the panel is shown (the lock is then really busy). */
	surMontre?: () => void;
}

/** Starts the hidden PowerShell that opens the panel and follows what it
    prints on stdout (`SHOWN`, `CHOSEN`, `ERROR:<message>`). Resolves only when
    the panel is SHOWN (`ok: true`) or when it is known it will not be (spawn
    error, exit or `ERROR` before `SHOWN`, 30 s without a signal). `fin`
    releases the lock and is called EXACTLY ONCE, on every outcome: spawn
    error, early exit, non-zero exit, error signal, either timeout, or the
    normal exit. The process is killed on the timeouts, so a share can never
    hold the lock longer than `BORNE_TOTALE_MS`. */
export function lancerPartageNatif(p: PartageNatif, fin: () => void, deps: DepsPartage = {}): Promise<ResultatPartage> {
	const lancer = deps.lancer ?? ((cmd, args, env) => spawn(cmd, args, { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as EnfantPartage);
	const minuteur = deps.minuteur ?? { set: (f: () => void, ms: number) => setTimeout(f, ms), clear: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
	return new Promise((resolve) => {
		let resolu = false;
		let libere = false;
		let montre = false;
		let enfant: EnfantPartage | null = null;
		let tampon = "";
		let erreurs = "";
		let tSignal: unknown = null;
		let tTotal: unknown = null;
		const repondre = (r: ResultatPartage) => { if (!resolu) { resolu = true; resolve(r); } };
		const liberer = () => {
			if (libere) return;
			libere = true;
			minuteur.clear(tSignal);
			minuteur.clear(tTotal);
			fin();
		};
		const tuer = () => { try { enfant?.kill(); } catch { /* already gone */ } };
		const echec = (raison: "lancement" | "sortie" | "delai" | "erreur", message: string, tue: boolean) => {
			repondre({ ok: false, raison, message });
			if (tue) tuer();
			liberer();
		};
		const ligne = (l: string) => {
			if (l === "SHOWN") {
				montre = true;
				minuteur.clear(tSignal);
				deps.surMontre?.();
				repondre({ ok: true });
			} else if (l.startsWith("ERROR:")) {
				echec("erreur", l.slice(6).slice(0, 300), true);
			}
		};
		try {
			const encode = Buffer.from(scriptPartageNatif(), "utf16le").toString("base64");
			const env: NodeJS.ProcessEnv = { ...process.env, [VARIABLES_NATIF.titre]: p.titre.slice(0, 200) };
			if (p.fichier) env[VARIABLES_NATIF.fichier] = p.fichier;
			else if (p.texte) env[VARIABLES_NATIF.texte] = p.texte.slice(0, 4000);
			if (p.centre && Number.isFinite(p.centre.x) && Number.isFinite(p.centre.y)) {
				env[VARIABLES_NATIF.x] = String(Math.round(p.centre.x));
				env[VARIABLES_NATIF.y] = String(Math.round(p.centre.y));
			}
			enfant = lancer("powershell.exe",
				["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encode], env);
			tSignal = minuteur.set(() => { if (!montre) echec("delai", "no signal from the share panel", true); }, BORNE_SANS_SIGNAL_MS);
			tTotal = minuteur.set(() => echec("delai", "share panel timed out", true), BORNE_TOTALE_MS);
			enfant.stdout?.on("data", (d) => {
				tampon += String(d);
				const lignes = tampon.split(/\r?\n/);
				tampon = lignes.pop() ?? "";
				for (const l of lignes) ligne(l.trim());
			});
			enfant.stderr?.on("data", (d) => { if (erreurs.length < 2000) erreurs += String(d); });
			enfant.on("error", (e) => echec("lancement", e.message, false));
			const sortie = (code: number | null) => {
				if (tampon.trim()) { ligne(tampon.trim()); tampon = ""; }
				echec("sortie", erreurs.trim().slice(0, 300) || `exit code ${code}`, false);
			};
			enfant.on("exit", sortie);
			enfant.on("close", sortie);
		} catch (e) {
			echec("lancement", e instanceof Error ? e.message : String(e), true);
		}
	});
}
