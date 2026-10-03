/* ══════════════════════════════════════════════════════════
   LE PARTAGE D'UN QUIZ OU D'UN DOSSIER — côté PRINCIPAL (2026-09-25).

   Le greffon partageait déjà (`src/dashboard/share.ts`, retiré avec le
   tableau de bord le 2026-09-13) en appelant Node depuis la fenêtre. Ici, la
   fenêtre ne donne que deux choses : un NOM de fichier et ses OCTETS. Tout le
   reste — où écrire, quoi lancer — est décidé par ce module :

   - « Enregistrer » : l'EMPLACEMENT vient du dialogue natif, donc de
     l'utilisateur, jamais du rendu ; l'extension est imposée.
   - « Discord » : le fichier va dans un dossier temporaire tiré au sort, et
     le script PowerShell n'a qu'un paramètre, ce chemin que le principal a
     lui-même composé. Le nom venu du rendu est assaini AVANT (`nomPartage`),
     et le chemin n'est JAMAIS écrit dans le script : PowerShell le lit dans
     une variable d'environnement (`VARIABLE_FICHIER`). Aucune citation,
     donc aucune apostrophe — ASCII ou typographique — pour en sortir.

   `nomPartage`, `octetsPartage` et `scriptDiscord` sont PURS :
   `npm run check:partage` les éprouve sans rien lancer.
══════════════════════════════════════════════════════════ */

import { execFile } from "node:child_process";
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
export function creerVerrou(delaiMax: number, intervalleMin = 0, maintenant: () => number = Date.now): { prendre(): number | null; rendre(jeton: number): void } {
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
			pris = dernier = t;
			jetonCourant = ++compteur;
			return jetonCourant;
		},
		/** Ne rend que SON verrou : un processus qui finit après que le verrou
		    est retombé de lui-même ne libère pas celui du partage suivant. */
		rendre(jeton: number) { if (jeton === jetonCourant) pris = null; },
	};
}

/** Un verrou PAR BOUTON : un dialogue « Enregistrer sous » ouvert ne doit
    pas empêcher Discord, ni l'inverse (seconde revue du 2026-09-25).
    - Enregistrer : un dialogue à la fois ; il peut rester ouvert longtemps.
    - Discord : le script attend la fenêtre jusqu'à 20 s, plus 1,2 s de
      signal, d'où 30 s ; et deux secondes au moins entre deux lancements. */
export const verrouEnregistrer = creerVerrou(10 * 60_000);
export const verrouDiscord = creerVerrou(30_000, 2_000);

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

/* ── Activation de Discord (Windows), reprise du greffon, où chaque couche a
   été MESURÉE le 2026-07-19 :
   1. SIGNAL single-instance (raccourci du menu Démarrer, sinon Update.exe) :
      quand Discord tourne, c'est la seule voie qui lui fait faire son propre
      raise + focus + REPAINT ; une activation externe seule le laissait au
      premier plan mais NOIR (rendu suspendu).
   2. RESTAURATION seulement si la fenêtre est cachée ou iconique : un
      SW_RESTORE sur une fenêtre visible la dé-maximiserait.
   3. ESCALADE de focus en filet (direct → Alt simulé → AttachThreadInput →
      SwitchToThisWindow), si le signal n'a pas suffi.
   Discord fermé : le signal le lance, et la boucle attrape la fenêtre
   principale en écartant le splash « Discord Updater » (même classe, ~300 px).
   Script passé en -EncodedCommand : aucun échappement de shell. Il est
   CONSTANT : rien de ce que la fenêtre envoie n'y entre. */
export function scriptDiscord(): string {
	return `$ErrorActionPreference = 'SilentlyContinue'
Set-Clipboard -LiteralPath $env:${VARIABLE_FICHIER}
$lnk = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk'
$up = Join-Path $env:LOCALAPPDATA 'Discord\\Update.exe'
function Send-DiscordSignal {
	if (Test-Path $lnk) { Invoke-Item $lnk }
	elseif (Test-Path $up) { Start-Process $up -ArgumentList '--processStart','Discord.exe' }
	else { try { Start-Process 'discord://' } catch { Start-Process 'https://discord.com/channels/@me' } }
}
$wasRunning = [bool](Get-Process Discord -ErrorAction SilentlyContinue)
if (-not $wasRunning) { Send-DiscordSignal }
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace NeoQuiz {
	public static class DiscordFocus {
		delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
		[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
		[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
		[DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
		[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
		[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
		[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
		[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
		[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
		[DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
		[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
		[DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
		[DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
		[DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
		[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
		[StructLayout(LayoutKind.Sequential)] struct RECT { public int L; public int T; public int R; public int B; }
		[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
		public static IntPtr FindMain() {
			var pids = new System.Collections.Generic.HashSet<int>();
			foreach (var p in Process.GetProcessesByName("Discord")) pids.Add(p.Id);
			if (pids.Count == 0) return IntPtr.Zero;
			IntPtr found = IntPtr.Zero;
			EnumWindows(delegate(IntPtr h, IntPtr l) {
				uint pid; GetWindowThreadProcessId(h, out pid);
				if (!pids.Contains((int)pid)) return true;
				var c = new StringBuilder(64); GetClassName(h, c, 64);
				if (c.ToString() != "Chrome_WidgetWin_1") return true;
				if (!IsIconic(h)) {
					RECT r; GetWindowRect(h, out r);
					if (r.R - r.L < 500) return true;
				}
				found = h; return false;
			}, IntPtr.Zero);
			return found;
		}
		public static void AllowFor(IntPtr h) {
			uint pid; GetWindowThreadProcessId(h, out pid);
			if (pid != 0) AllowSetForegroundWindow(pid);
		}
		public static void RestoreIfHidden(IntPtr h) {
			if (IsIconic(h)) ShowWindow(h, 9);
			else if (!IsWindowVisible(h)) ShowWindow(h, 5);
		}
		public static void EnsureFront(IntPtr h) {
			if (Try(h)) return;
			keybd_event(0x12, 0, 0, UIntPtr.Zero);
			keybd_event(0x12, 0, 2, UIntPtr.Zero);
			if (Try(h)) return;
			IntPtr fg = GetForegroundWindow();
			if (fg != IntPtr.Zero) {
				uint pid; uint fgT = GetWindowThreadProcessId(fg, out pid);
				uint curT = GetCurrentThreadId();
				if (fgT != 0 && fgT != curT) {
					AttachThreadInput(curT, fgT, true);
					BringWindowToTop(h);
					SetForegroundWindow(h);
					AttachThreadInput(curT, fgT, false);
					System.Threading.Thread.Sleep(60);
					if (GetForegroundWindow() == h) return;
				}
			}
			SwitchToThisWindow(h, true);
		}
		static bool Try(IntPtr h) {
			SetForegroundWindow(h);
			System.Threading.Thread.Sleep(60);
			return GetForegroundWindow() == h;
		}
	}
}
'@
$deadline = (Get-Date).AddSeconds(20)
$h = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
	$h = [NeoQuiz.DiscordFocus]::FindMain()
	if ($h -ne [IntPtr]::Zero) { break }
	Start-Sleep -Milliseconds 150
}
if ($h -ne [IntPtr]::Zero) {
	[NeoQuiz.DiscordFocus]::AllowFor($h)
	[NeoQuiz.DiscordFocus]::RestoreIfHidden($h)
	if ($wasRunning) { Send-DiscordSignal; Start-Sleep -Milliseconds 1200 }
	[NeoQuiz.DiscordFocus]::EnsureFront($h)
}
`;
}

/** Lance le script, caché. Rend `true` une fois PowerShell LANCÉ, pas à sa
    fin : le script active Discord avec ses propres attentes, et attendre sa
    sortie retarderait la confirmation de plusieurs secondes. Un échec de
    lancement (`ENOENT`) arrive, lui, tout de suite. `fin` est appelé quand
    PowerShell rend la main (ou ne se lance pas) : c'est là que le verrou du
    partage retombe. */
export function lancerDiscord(dest: string, fin: () => void): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const encode = Buffer.from(scriptDiscord(), "utf16le").toString("base64");
			const enfant = execFile("powershell.exe",
				["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encode],
				{ windowsHide: true, env: { ...process.env, [VARIABLE_FICHIER]: dest } }, () => fin());
			enfant.once("error", () => { fin(); resolve(false); });
			setTimeout(() => resolve(true), 300);
		} catch {
			fin();
			resolve(false);
		}
	});
}

/* ── THE NATIVE WINDOWS SHARE PANEL (2026-10-03) ──
   What Neo Calendar gets from `navigator.share` in WebView2, which Electron
   does not provide: Windows' own "Share" panel (Discord, WhatsApp, Outlook,
   Teams, Nearby Share…), for a text (the sync ID) or a file (a quiz .md, a
   folder .zip). The panel belongs to a window, and only a WinRT interop
   (`IDataTransferManagerInterop`) opens it from a desktop process: Electron
   has no API for it, so a hidden PowerShell process creates a 1-pixel
   window of its own, centred on the app, and opens the panel on it.

   Same rules as `scriptDiscord`: the script is CONSTANT, and everything it
   needs travels in environment variables it reads itself (the title, the
   text, the absolute path of a temporary file this module wrote, the point
   to centre on). Nothing from the window is ever spliced into the script.
   The process ends when the panel is cancelled, 15 s after an app was
   chosen (the target reads the file by then), or after five minutes. */

export const VARIABLES_NATIF = {
	titre: "NEO_QUIZ_PARTAGE_TITRE",
	texte: "NEO_QUIZ_PARTAGE_TEXTE",
	fichier: VARIABLE_FICHIER,
	x: "NEO_QUIZ_PARTAGE_X",
	y: "NEO_QUIZ_PARTAGE_Y",
} as const;

/** One native panel at a time, two seconds at least between two. */
export const verrouNatif = creerVerrou(6 * 60_000, 2_000);

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
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'; $f.ShowInTaskbar = $false; $f.Width = 1; $f.Height = 1; $f.Opacity = 0.01
$x = 0; $y = 0
if ([int]::TryParse($env:${VARIABLES_NATIF.x}, [ref]$x) -and [int]::TryParse($env:${VARIABLES_NATIF.y}, [ref]$y)) {
	$f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point $x, $y
} else { $f.StartPosition = 'CenterScreen' }
$fin = New-Object System.Windows.Forms.Timer; $fin.Interval = 300000; $fin.Add_Tick({ $f.Close() }); $fin.Start()
$f.Add_Shown({
	try {
		$script:dtm = [NeoQuiz.NativeShare]::ForWindow($dtmType, $f.Handle)
		$script:dtm.add_DataRequested({ param($s, $e)
			$e.Request.Data.Properties.Title = $titre
			if ($script:fichier) { $e.Request.Data.SetStorageItems([Windows.Storage.IStorageItem[]]@($script:fichier)) }
			elseif ($texte) { $e.Request.Data.SetText($texte) }
		})
		$script:dtm.add_TargetApplicationChosen({ param($s, $e) $fin.Stop(); $fin.Interval = 15000; $fin.Start() })
		try { $script:dtm.add_ShareCanceled({ param($s, $e) $f.Close() }) } catch { }
		[NeoQuiz.NativeShare]::Show($dtmType, $f.Handle)
	} catch { [Console]::Error.WriteLine($_.Exception.Message); $f.Close() }
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

/** Starts the hidden PowerShell that opens the panel. Resolves `true` once
    it is LAUNCHED (the panel waits for the user, sometimes minutes); `fin`
    is called when PowerShell exits, which is when the lock is released. */
export function lancerPartageNatif(p: PartageNatif, fin: () => void): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const encode = Buffer.from(scriptPartageNatif(), "utf16le").toString("base64");
			const env: NodeJS.ProcessEnv = { ...process.env, [VARIABLES_NATIF.titre]: p.titre.slice(0, 200) };
			if (p.fichier) env[VARIABLES_NATIF.fichier] = p.fichier;
			else if (p.texte) env[VARIABLES_NATIF.texte] = p.texte.slice(0, 4000);
			if (p.centre && Number.isFinite(p.centre.x) && Number.isFinite(p.centre.y)) {
				env[VARIABLES_NATIF.x] = String(Math.round(p.centre.x));
				env[VARIABLES_NATIF.y] = String(Math.round(p.centre.y));
			}
			const enfant = execFile("powershell.exe",
				["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encode],
				{ windowsHide: true, env }, () => fin());
			enfant.once("error", () => { fin(); resolve(false); });
			setTimeout(() => resolve(true), 300);
		} catch {
			fin();
			resolve(false);
		}
	});
}
