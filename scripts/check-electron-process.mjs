/**
 * Non-régression des CLI ET DE LEURS FICHIERS dans le processus principal
 * Electron (`apps/windows/electron/process.ts`) — tâche 3 de la génération IA
 * dans l'application (docs/superpowers/plans/2026-09-11-generation-ia-app.md).
 *
 * CE QU'IL EMPÊCHE. La liste de modèles de Codex et tout ce que le greffon
 * sait de Claude Code viennent de DEUX fichiers, à des chemins que seul le
 * processus principal connaît (`$CODEX_HOME/models_cache.json` ou
 * `~/.codex/models_cache.json`, `~/.claude.json`). Une clé décalée, un
 * `$CODEX_HOME` ignoré, un fichier absent qui LÈVE au lieu de rendre `null` :
 * dans les trois cas, la page « Générer » affiche le repli embarqué du code
 * partagé — une liste de modèles PLAUSIBLE mais périmée, sans un seul message
 * d'erreur. Un modèle du repli retiré du compte donne un 404 au CLI, et on
 * cherche le défaut du côté du CLI.
 *
 * Sur le module RÉEL, par `withSrcModule`, avec un faux DOSSIER PERSONNEL
 * (l'environnement est un paramètre de `lireCache` et de `cheminCache`
 * exprès) : aucun des vrais fichiers de la machine n'est lu, et le contrôle
 * ne dépend pas de ce qu'ils contiennent.
 *
 * Depuis la tâche 7, le groupe « lancer un CLI » éprouve `run` sur de VRAIS
 * process (stdin écrit puis fermé, flux séparés, arbre tué à l'annulation, un
 * `run` par outil, et `run` qui ne se règle qu'une fois l'arbre mort).
 *
 *     npm run check:electron-process
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Le délai de garde d'UN cas. Ce script lance de VRAIS process : un `run` qui
    n'aboutit jamais (un `stdin` jamais fermé, un filet de sécurité retiré)
    figeait toute la commande au lieu de rougir — et une commande figée masque
    tous les cas suivants, exactement le défaut que `CLAUDE.md` décrit pour
    `check:lesson`. Vécu pendant la discriminance de la tâche 7. */
const DELAI_CAS_MS = 30000;

async function cas(r, nom, fn) {
	let minuteur = null;
	const garde = new Promise((_, reject) => {
		minuteur = setTimeout(() => reject(new Error("DÉLAI DÉPASSÉ (" + DELAI_CAS_MS + " ms) : le cas n'a jamais rendu la main")), DELAI_CAS_MS);
	});
	try {
		await Promise.race([fn(), garde]);
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	} finally {
		clearTimeout(minuteur);
	}
}

await withSrcModule("src/cli-install-cmd.ts", async ({ commandeInstallation, commandeInstallationLancee, PREFIXE_JOURNAL_GO }) => {
await withSrcModule("apps/windows/electron/process.ts", async ({
	OUTILS, argumentsTerminal, avecFichiers, cheminCache, dossierPersonnel, dossiersCli, emplacementsOllama, encoderCommande, environnementOutil,
	estOutilAutorise, lireAncre, lireCache, lirePlacement, rectangleTerminal, scriptConnexion, scriptDisposerPourSite, scriptDisposerPourTerminal, scriptFermerTerminal, scriptInstallation, scriptPoserFenetre, scriptRestaurerNavigateur, scriptUsageTerminal,
}) => {
	const r = makeReporter("Électron — les CLI");
	const racine = mkdtempSync(join(tmpdir(), "quiz-process-"));
	/* Un faux dossier personnel : `~/.claude.json` et `~/.codex/` y vivent,
	   plus un `$CODEX_HOME` SÉPARÉ, pour que « honore CODEX_HOME » ne puisse
	   pas passer par hasard — les deux fichiers ont un contenu DIFFÉRENT. */
	const maison = join(racine, "maison");
	const codexHome = join(racine, "ailleurs");
	mkdirSync(join(maison, ".codex"), { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	writeFileSync(join(maison, ".codex", "models_cache.json"), '{"models":[{"slug":"du-dossier-personnel"}]}');
	writeFileSync(join(codexHome, "models_cache.json"), '{"models":[{"slug":"de-codex-home"}]}');
	writeFileSync(join(maison, ".claude.json"), '{"additionalModelOptionsCache":["fable"]}');

	const envMaison = { USERPROFILE: maison, HOME: maison };
	const envCodexHome = { USERPROFILE: maison, HOME: maison, CODEX_HOME: codexHome };

	try {
		await cas(r, "lireCache(\"codex\") lit le cache du dossier personnel", async () => {
			const cache = await lireCache("codex", envMaison);
			r.check("lireCache(\"codex\") lit le cache du dossier personnel",
				{ json: cache && cache.json, date: !!(cache && typeof cache.mtimeMs === "number") },
				{ json: { models: [{ slug: "du-dossier-personnel" }] }, date: true });
		});

		await cas(r, "lireCache(\"codex\") honore CODEX_HOME", async () => {
			/* `$CODEX_HOME` est l'override que le CLI Codex honore LUI-MÊME :
			   l'ignorer ferait lire le cache d'une AUTRE installation que celle
			   qui répond, et la liste de modèles mentirait sans une erreur. Les
			   deux fichiers existent, donc seul le bon chemin distingue. */
			const cache = await lireCache("codex", envCodexHome);
			r.check("lireCache(\"codex\") honore CODEX_HOME",
				{ json: cache && cache.json, chemin: cheminCache("codex", envCodexHome) },
				{ json: { models: [{ slug: "de-codex-home" }] }, chemin: join(codexHome, "models_cache.json") });
		});

		await cas(r, "lireCache(\"claude\") lit ~/.claude.json", async () => {
			/* Le dossier personnel est INJECTABLE (`USERPROFILE`/`HOME`) parce
			   que `os.homedir()` ne suit PAS `HOME` sous Windows : sans cette
			   entrée, ce cas ne pourrait lire que le vrai `~/.claude.json` de la
			   machine — dont le contenu varie, et qu'un contrôle n'a pas à lire. */
			const cache = await lireCache("claude", envMaison);
			r.check("lireCache(\"claude\") lit ~/.claude.json",
				{ json: cache && cache.json, chemin: cheminCache("claude", envMaison) },
				{ json: { additionalModelOptionsCache: ["fable"] }, chemin: join(maison, ".claude.json") });
		});

		await cas(r, "un cache absent rend null, sans lever", async () => {
			/* Une machine sans Codex est un état NORMAL, pas une panne : le code
			   partagé retombe sur son repli embarqué. Un jet ici remonterait
			   jusqu'au canal et ferait échouer l'affichage entier. */
			const vide = join(racine, "personne");
			mkdirSync(vide, { recursive: true });
			r.check("un cache absent rend null, sans lever",
				await lireCache("codex", { USERPROFILE: vide, HOME: vide }), null);
		});

		await cas(r, "un cache illisible rend null, sans lever", async () => {
			// Même règle pour du JSON invalide : « pas de cache », pas une panne.
			const casse = join(racine, "casse");
			mkdirSync(join(casse, ".codex"), { recursive: true });
			writeFileSync(join(casse, ".codex", "models_cache.json"), "{ ceci n'est pas du JSON");
			r.check("un cache illisible rend null, sans lever",
				await lireCache("codex", { USERPROFILE: casse, HOME: casse }), null);
		});

		await cas(r, "le dossier personnel vient de l'environnement donné, sinon du système", async () => {
			r.check("le dossier personnel vient de l'environnement donné, sinon du système",
				{ donne: dossierPersonnel(envMaison), systeme: typeof dossierPersonnel({}) },
				{ donne: maison, systeme: "string" });
		});

		await cas(r, "les emplacements d'Ollama sont ceux de chaque système", async () => {
			/* Ils servent de SECONDE sonde : un Ollama installé mais absent du
			   PATH d'une application de bureau doit quand même être vu. Une
			   entrée perdue ici, et l'utilisateur lit « non installé » alors que
			   le serveur n'est qu'arrêté. */
			r.check("les emplacements d'Ollama sont ceux de chaque système",
				{
					win: emplacementsOllama("win32", { LOCALAPPDATA: "C:/Local" }),
					mac: emplacementsOllama("darwin", {}),
					linux: emplacementsOllama("linux", {}),
				},
				{
					win: [join("C:/Local", "Programs", "Ollama", "ollama app.exe")],
					mac: ["/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"],
					linux: ["/usr/local/bin/ollama", "/usr/bin/ollama"],
				});
		});

		await cas(r, "la liste blanche est celle du contrat, et elle est jugée à l'exécution", async () => {
			/* Le NOM vient du RENDU. `CliTool` le borne à la COMPILATION ; ceci le
			   borne à l'EXÉCUTION, où arrive un jour une valeur venue d'un
			   réglage, d'un quiz partagé ou d'une fenêtre compromise. La liste
			   doit être EXACTEMENT celle de `CliTool` (`src/host/types.ts`), que
			   le code partagé lit : un outil accepté d'un côté et refusé de
			   l'autre ferait dépendre le sort d'un appel de l'hôte qui l'exécute.
			   (Le greffon Obsidian ne lance plus aucun CLI depuis le chantier
			   « greffon lecteur » — son `CLI_AUTORISES`, que ce commentaire citait
			   jusqu'au 2026-09-20, n'existe plus ; le contrat reste la référence,
			   et l'application Android à venir en héritera.) */
			r.check("la liste blanche est celle du contrat, et elle est jugée à l'exécution",
				{
					liste: [...OUTILS],
					/* `gemini` DOIT être jugé vrai : c'est le quatrième CLI, ajouté le
					   2026-09-20. Un nom de la liste refusé ici rendrait sa
					   génération impossible sans qu'aucun type ne bronche — le rendu
					   n'envoie qu'un nom, et c'est ici qu'il est cru ou non. */
					/* `agy` est Antigravity CLI ; `gemini` n'y est PLUS : Gemini CLI a
					   été fermé aux comptes individuels par Google (juin 2026), et
					   un nom hors liste est refusé même si le binaire est encore là. */
					juge: ["claude", "codex", "ollama", "agy", "gemini", "notepad", "x.bat", "", null, 3].map(estOutilAutorise),
				},
				{
					liste: ["claude", "codex", "ollama", "agy"],
					juge: [true, true, true, true, false, false, false, false, false, false],
				});
		});

		/* ── Installer un CLI : la recette est FIXE, dans ce module, jamais composée
		   depuis le rendu. Ces cas gardent l'URL officielle, l'étape de connexion,
		   l'encodage (le base64 ne contient que `[A-Za-z0-9+/=]`, donc il ne peut
		   refermer ni l'apostrophe de `-ArgumentList` ni le guillemet de
		   `-Command`), et la forme des arguments.

		   ARGUMENTS TERMINAL PAR SHELLEXECUTE (`Start-Process`), et non `cmd /c
		   start` : la sonde du 2026-09-17 (tâche 3, probe § 3c) a mesuré qu'un
		   `cmd /c start` lancé par `spawn` n'ouvre JAMAIS de fenêtre visible (un
		   `conhost` au `MainWindowHandle` nul), alors que `Start-Process` en ouvre
		   une vraie, hébergée par le terminal par défaut de l'utilisateur. Le titre
		   passe donc par le SCRIPT (`$host.UI.RawUI.WindowTitle`), pas par la ligne
		   de commande. */
		/* ── LE TERMINAL DIT VRAI ET SE FERME SEUL (2026-09-19) ──

		   CE QUE CES CAS EMPÊCHENT, vu dans la VM le 2026-09-18 : le script rechargeait
		   le PATH du REGISTRE, alors que l'application détecte les CLI par un PATH
		   ÉTENDU (`~/.local/bin`, où `install.ps1` pose `claude.exe`). Quand
		   l'installateur n'écrit pas ce dossier dans le PATH utilisateur, l'app disait
		   « installé » et le terminal « terme non reconnu » — puis affichait quand
		   même « Claude Code est connecté », parce que le `Write-Host` suivait la
		   commande sans condition. */
		const msgs = { succes: "c'est fini", echec: "raté", echecInstallation: "install ratée", agyCountdown: "60 secondes", agyExpire: "lien expiré" };
		const envDossiers = { USERPROFILE: "C:\\U\\x", HOME: "C:\\U\\x", LOCALAPPDATA: "C:\\U\\x\\AppData\\Local", APPDATA: "C:\\U\\x\\AppData\\Roaming" };
		{
			const dossiers = dossiersCli(envDossiers);
			r.check("dossiersCli : les dossiers des installateurs officiels y sont",
				{
					local: dossiers.includes("C:\\U\\x\\.local\\bin"),
					codex: dossiers.includes("C:\\U\\x\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin"),
					npm: dossiers.includes("C:\\U\\x\\AppData\\Roaming\\npm"),
				},
				{ local: true, codex: true, npm: true });
			for (const outil of ["claude", "codex"]) {
				/* `envDossiers`, le MÊME faux environnement que celui dont `dossiers`
				   (ci-dessus) est dérivé : sans lui, le script serait composé avec le
				   vrai `process.env` de la machine qui lance ce contrôle, et le cas
				   suivant ne pourrait jamais retrouver dedans les chemins fabriqués. */
				const inst = scriptInstallation(outil, "Neo Quiz - " + outil, msgs, envDossiers);
				const cx = scriptConnexion(outil, "Neo Quiz - " + outil, msgs, envDossiers);
				for (const [nom, script] of [["installation", inst], ["connexion", cx]]) {
					r.check(outil + " " + nom + " : le titre de la fenêtre est la première ligne",
						script.startsWith("$host.UI.RawUI.WindowTitle = 'Neo Quiz - " + outil + "'"), true);
					r.check(outil + " " + nom + " : le PATH reçoit le registre ET chaque dossier des CLI",
						{
							registre: script.includes("GetEnvironmentVariable('Path','User')"),
							dossiers: dossiers.every(d => script.includes(d.replace(/'/g, "''"))),
						},
						{ registre: true, dossiers: true });
					const login = outil === "claude" ? "claude auth login" : "codex login";
					r.check(outil + " " + nom + " : la connexion est la sous-commande, jamais le REPL",
						{ login: script.includes("\n" + login + "\n"), repl: /\nclaude\s*\n/.test(script) }, { login: true, repl: false });
					r.check(outil + " " + nom + " : le PATH est rechargé AVANT la connexion",
						script.indexOf("GetEnvironmentVariable('Path','User')") < script.indexOf("\n" + login), true);
					/* Le message de succès n'est atteint que si la connexion a rendu 0 ;
					   l'échec est dans l'autre branche et RETIENT la fenêtre (Read-Host). */
					const iSucces = script.indexOf("Write-Host 'c''est fini'");
					const iEchec = script.indexOf("Write-Host 'raté'");
					const iIf = script.indexOf("if ($LASTEXITCODE -eq 0)");
					const iElse = script.indexOf("} else {");
					r.check(outil + " " + nom + " : le succès est conditionné au code de sortie de la connexion",
						{ ordre: iIf > 0 && iIf < iSucces && iSucces < iElse && iElse < iEchec, apresLogin: iIf > script.indexOf("\n" + login) },
						{ ordre: true, apresLogin: true });
					/* Le succès se ferme seul, mais APRÈS un compte à rebours VISIBLE de
					   trois secondes (Ahmed, 2026-09-20) : une fenêtre qui disparaît en
					   silence se lit comme un plantage. Trois tours d'une seconde, et
					   les chiffres écrits — pas un `Start-Sleep -Seconds 3` muet. */
					const succes = script.slice(iSucces, iElse);
					r.check(outil + " " + nom + " : succès → compte à rebours visible de 3 s puis la fenêtre se ferme seule ; échec → elle reste",
						{
							compte: succes.includes("for ($i = 3; $i -gt 0; $i--)") && succes.includes("Write-Host") && succes.includes("Start-Sleep -Seconds 1"),
							muet: succes.includes("Start-Sleep -Seconds 2") || succes.includes("Start-Sleep -Seconds 3"),
							reste: script.slice(iEchec).includes("Read-Host"),
						},
						{ compte: true, muet: false, reste: true });
					/* Toute erreur d'EXÉCUTION retient la fenêtre (trap), et une
					   transcription est écrite sur le disque : la fenêtre qui se
					   fermait « instantanément » le 2026-09-20 n'avait laissé aucune
					   trace à lire. */
					r.check(outil + " " + nom + " : un trap retient la fenêtre sur toute erreur, et une transcription est écrite",
						{ trap: /\ntrap \{[\s\S]*Read-Host[\s\S]*\n\}/.test(script), transcription: script.includes("Start-Transcript -Path") },
						{ trap: true, transcription: true });
				}
				/* L'installation qui échoue n'enchaîne pas la connexion : le test de
				   son code de sortie précède la ligne de connexion. */
				const iInstall = inst.indexOf(commandeInstallationLancee(outil, true));
				const iGarde = inst.indexOf("if ($LASTEXITCODE -ne 0)");
				r.check(outil + " installation : un installateur qui échoue arrête le script avec son message, avant la connexion",
					{ ordre: iInstall > 0 && iGarde > iInstall && iGarde < inst.indexOf("\n" + (outil === "claude" ? "claude auth login" : "codex login")), message: inst.slice(iGarde).includes("Write-Host 'install ratée'") },
					{ ordre: true, message: true });
			}
			/* L'installateur de Codex demande « Start Codex now? [y/N] » à la fin et
	   bloquait la fenêtre sur cette question (VM, 2026-09-19) :
	   `CODEX_NON_INTERACTIVE` doit être posé AVANT la ligne d'installation,
	   et seulement pour Codex. */
	{
		const codexInst = scriptInstallation("codex", "t", msgs, envDossiers);
		const iVar = codexInst.indexOf("$env:CODEX_NON_INTERACTIVE = '1'");
		r.check("codex installation : CODEX_NON_INTERACTIVE posé avant l'installateur, et pas ailleurs",
			{
				avant: iVar > 0 && iVar < codexInst.indexOf(commandeInstallationLancee("codex", true)),
				claude: scriptInstallation("claude", "t", msgs, envDossiers).includes("CODEX_NON_INTERACTIVE"),
			},
			{ avant: true, claude: false });
	}
	/* ── ANTIGRAVITY (`agy`) : le remplaçant de Gemini CLI ── */
	{
		const inst = scriptInstallation("agy", "Neo Quiz - Antigravity CLI", msgs, envDossiers);
		const ligneInstall = commandeInstallationLancee("agy", true);
		r.check("agy installation : l'installateur officiel, sans prérequis ni nettoyage npm (un binaire Go)",
			{
				/* La ligne est indentee dans le `try` du reessai : c'est son
				   ENVELOPPE qui a change le 2026-09-20 (503 de Google), jamais la
				   ligne elle-meme, celle que le modal affiche. */
				officiel: inst.includes("\n    " + ligneInstall + "\n") && ligneInstall.includes("antigravity.google/cli/install.ps1"),
				/* Avant la ligne d'installation seulement : le rechargement du
				   PATH, plus bas, cite le dossier npm de l'utilisateur. */
				npm: /npm install|Get-Command npm|npm_config|Node\.js/.test(inst.slice(0, inst.indexOf(ligneInstall))),
			},
			{ officiel: true, npm: false });
		/* La connexion est HEADLESS et c'est le SCRIPT qui ouvre le navigateur :
		   `agy -p` écrit l'URL Google sur stderr et attend SOIXANTE secondes
		   EN INTERNE, puis abandonne sans rendre la main (mesuré les
		   2026-09-20 et 09-21). Depuis le 2026-09-21, le script rend ces 60 s
		   VISIBLES et RATTRAPABLES : un avertissement traduit par l'APPELANT
		   avant de lancer, une BOUCLE qui relit la sortie redirigée et tue
		   l'arbre de la tentative au bout de 70 s, attend Entrée, relance. */
		const cx = scriptConnexion("agy", "t", msgs, envDossiers);
		const iCd = cx.indexOf("\nSet-Location $env:USERPROFILE\n");
		const iAvertissement = cx.indexOf("[Console]::Out.WriteLine('60 secondes')");
		const iLancement = cx.indexOf("$p = Start-Process -FilePath \"agy\"");
		const iJuge = cx.indexOf("if ($connecte) {");
		const iTuer = cx.indexOf("taskkill.exe\" /PID $p.Id /T /F");
		const iExpire = cx.indexOf("[Console]::Out.WriteLine('lien expiré')");
		const iAttente = cx.indexOf("TotalSeconds -ge 70");
		r.check("agy connexion : dossier personnel, AVERTISSEMENT AVANT le lancement, sortie redirigée et relue, puis le jugement sur $connecte",
			{
				ordre: iCd > 0 && iAvertissement > iCd && iLancement > iAvertissement && iJuge > iLancement,
				ouvreUrl: cx.includes("accounts\\.google\\.com") && cx.includes("Start-Process $Matches[0]"),
				sansRepeindre: cx.includes("[Console]::Out.WriteLine($l)") && !cx.includes("Write-Host $l"),
				pathAvant: cx.indexOf("GetEnvironmentVariable('Path','User')") < iLancement,
				tui: /\nagy\s*\n/.test(cx),
			},
			{ ordre: true, ouvreUrl: true, sansRepeindre: true, pathAvant: true, tui: false });
		/* LA BOUCLE : 70 s (dix de plus que le chrono interne du CLI), l'ARBRE
		   tué, le message d'expiration traduit par l'appelant, Entrée attendue
		   DANS la boucle — un lien râté relance, il ne coûte plus la fenêtre. */
		r.check("agy connexion : la boucle tue l'arbre au bout de 70 s, annonce l'expiration, attend Entrée et relance",
			{
				boucle: cx.includes("while ($true) {"),
				delai: iAttente > iLancement && cx.includes("-Milliseconds 300"),
				toutLArbre: /taskkill\.exe" \/PID \$p\.Id \/T \/F/.test(cx),
				expireAvantAttente: iAttente > iLancement && iTuer > iAttente && iExpire > iTuer && cx.slice(iExpire).indexOf("Read-Host") > 0,
				relance: cx.lastIndexOf("Read-Host | Out-Null") < cx.lastIndexOf("}"),
			},
			{ boucle: true, delai: true, toutLArbre: true, expireAvantAttente: true, relance: true });
		/* LE SUCCÈS est jugé sur $connecte (code de sortie OU réponse JSON) :
		   Start-Process sur un .cmd ne rend pas toujours de code de sortie, et
		   la réponse est le signal que le protocole émet de toute façon. */
		r.check("agy connexion : succès = code de sortie 0 OU réponse JSON, et l'arbre tué si le CLI traîne après sa réponse",
			{
				json: cx.includes(`if ($l -match '"status"\\s*:\\s*"SUCCESS"') { $succesVu = $true }`),
				connecte: iJuge > 0 && !cx.includes("if ($LASTEXITCODE -eq 0)"),
				reponseAttendue: cx.includes("if (-not $p.WaitForExit(5000))"),
			},
			{ json: true, connecte: true, reponseAttendue: true });
		/* LA SORTIE EST REDIRIGÉE (fichiers temporaires relus en continu),
		   JAMAIS L'ENTRÉE : ce qu'on colle dans la fenêtre atteint le CLI —
		   c'est la porte de secours, et ce qui distingue ce script du terminal
		   d'usage (qui n'a AUCUNE redirection). Les compteurs de lignes lues
		   n'avancent que si la lecture a réussi : un verrou au milieu ne
		   rejouerait pas ce qui a déjà été affiché. */
		r.check("agy connexion : sortie redirigée vers des fichiers relus, entrée INTACTE, compteurs à l'abri d'une lecture perdue",
			{
				redirection: cx.includes("-RedirectStandardOutput $sortie") && cx.includes("-RedirectStandardError $erreur"),
				lectureContinue: cx.includes("[System.IO.File]::Open($sortie, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)") && cx.includes("[System.IO.File]::Open($erreur, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)"),
				entreeIntacte: !/RedirectStandardInput|Get-Clipboard|StandardInput\.WriteLine/.test(cx),
				compteurGarde: /catch \{ \$lignes = \$null \}/.test(cx) && cx.includes("if ($null -ne $lignes) {"),
			},
			{ redirection: true, lectureContinue: true, entreeIntacte: true, compteurGarde: true });
		/* L'ENTRÉE RESTE LA CONSOLE : sans redirection, ce qu'on colle dans la
		   fenêtre atteint le CLI. C'est la contrepartie du retour au manuel. */
		r.check("agy connexion : l'entrée du CLI n'est pas redirigée",
			/RedirectStandardInput|Get-Clipboard|StandardInput\.WriteLine/.test(cx), false);
		/* DISCRIMINANCE : la boucle, le chrono et le texte d'avertissement sont
		   propres à Antigravity — les deux scripts à sous-commande n'ont rien
		   de tout ça. */
		{
			const cl = scriptConnexion("claude", "t", msgs, envDossiers);
			r.check("agy connexion : la boucle et le chrono n'existent que pour agy",
				{ agy: cx.includes("while ($true) {") && cl.includes("while ($true) {") === false, jugeAgy: cl.includes("if ($LASTEXITCODE -eq 0)") },
				{ agy: true, jugeAgy: true });
		}
		/* `install.ps1` de Google pose `$ErrorActionPreference = "Stop"` dans
		   la session (par `iex`) : sous `Stop`, la première ligne relue —
		   l'URL — arrêtait le script (vécu le 2026-09-20). `Continue` doit
		   être remis ENTRE l'installation et le lancement. */
		{
			const iContinue = inst.indexOf("$ErrorActionPreference = 'Continue'");
			const iInstall = inst.indexOf(ligneInstall);
			const iAppelInst = inst.indexOf("$p = Start-Process -FilePath \"agy\"");
			r.check("agy installation : ErrorActionPreference remis à Continue APRÈS l'installateur de Google et AVANT l'appel headless",
				iInstall > 0 && iContinue > iInstall && iAppelInst > iContinue, true);
		}
		r.check("agy : son dossier d'installation Windows est dans les dossiers des CLI",
			dossiersCli(envDossiers).includes("C:\\U\\x\\AppData\\Local\\agy\\bin"), true);
	}

	/* ── LE TERMINAL D'USAGE (`scriptUsageTerminal`) ──
	   Le quota d'Antigravity ne se lit que dans son REPL (`/usage`) : le
	   script ouvre ce REPL, précédé d'une invite traduite par l'APPELANT —
	   jamais un texte venu du rendu. Sa liste blanche est PLUS ÉTROITE que
	   celle d'`estOutilAutorise` : les trois autres outils ont une lecture
	   directe ou une page web. La discriminance INVERSE (refuser `claude`,
	   qui passerait partout ailleurs) est ce qui prouve que la liste n'est
	   pas la liste commune recopiée. */
	r.check("usage terminal : null pour tout autre outil que agy — jamais un terminal sur rien",
		["claude", "codex", "ollama"].map(t => scriptUsageTerminal(t, "t", "tapez /usage")), [null, null, null]);
	{
		const s = scriptUsageTerminal("agy", "Neo Quiz - Antigravity CLI", "tapez /usage", envDossiers);
		const iPath = s.indexOf("GetEnvironmentVariable('Path','User')");
		const iInvite = s.indexOf("[Console]::Out.WriteLine('tapez /usage')");
		/* Le REPL est lancé APRÈS l'invite, et le script ne rend la main qu'à
		   sa sortie — entre les deux, il dépose `/usage` dans la console. */
		const iAgy = s.indexOf("Start-Process agy -NoNewWindow -PassThru");
		r.check("usage terminal agy : titre en première ligne, PATH rechargé, invite AVANT le REPL, sans repeindre, trap et transcription",
			{
				titre: s.startsWith("$host.UI.RawUI.WindowTitle = 'Neo Quiz - Antigravity CLI'"),
				ordre: iPath > 0 && iInvite > iPath && iAgy > iInvite && s.endsWith("$p.WaitForExit()"),
				invite: iInvite > 0,
				trap: /\ntrap \{[\s\S]*Read-Host[\s\S]*\n\}/.test(s),
				transcription: s.includes("Start-Transcript -Path"),
			},
			{ titre: true, ordre: true, invite: true, trap: true, transcription: true });
		/* Le REPL est INTERACTIF : ni sortie ni entrée redirigée — c'est ce qui
		   distingue ce script du `agy -p` headless de la connexion, et ce qui
		   laisse ce que l'utilisateur tape atteindre le CLI APRÈS la frappe
		   automatique (une redirection lui prendrait le clavier pour de bon). */
		r.check("usage terminal agy : ni la sortie ni l'entrée du REPL ne sont redirigées",
			/ForEach-Object|RedirectStandardInput|\| Out-String/.test(s), false);
		/* La frappe vise NOTRE console, jamais la fenêtre au premier plan : cinq
		   secondes passent avant elle, et `SendKeys` taperait `/usage` dans la
		   fenêtre où l'utilisateur est revenu entre-temps. */
		r.check("usage terminal agy : la frappe passe par la console, jamais par SendKeys",
			{ console: s.includes("WriteConsoleInput"), sendkeys: /SendKeys|AppActivate/.test(s) },
			{ console: true, sendkeys: false });
	}

	/* ── POURQUOI LA FRAPPE N'EST ÉPROUVÉE QUE PAR SA FORME ICI ──
	   Elle a été vérifiée SUR LE PRODUIT, à l'écran (2026-09-21) : le panneau
	   « Models & Quota » d'Antigravity s'ouvre seul après le clic. Un cas
	   automatisé, lui, demanderait une VRAIE console — un `spawn` n'en donne
	   pas (avec `detached`, Windows lance l'enfant sans console du tout, et
	   `GetStdHandle` ne rend alors aucune file où déposer la frappe), et la
	   créer par `cmd /c start` fait dépasser le délai du cas. Ce qui reste
	   au-dessus a quand même de la valeur : c'est la forme qui a coûté les
	   deux défauts réels (viser la fenêtre au premier plan, rediriger
	   l'entrée). Un cas d'exécution reste à écrire le jour où le harnais
	   saura tenir une console. */

	const ollama = scriptInstallation("ollama", "Neo Quiz - Ollama", msgs);
			r.check("ollama installation : ni connexion ni REPL, le message puis la fin",
				{ login: /login|\nclaude|\ncodex/.test(ollama), succes: ollama.includes("Write-Host 'c''est fini'") }, { login: false, succes: true });
			r.check("connexion ollama : null, jamais un terminal sur rien", scriptConnexion("ollama", "t", msgs), null);

			/* ── CE QUI EST MONTRÉ EST CE QUI PART, avec DEUX écarts écrits ──
			   Ollama : deux drapeaux d'accord non interactif. Claude : la ligne
			   affichée tourne dans un SOUS-PROCESSUS, parce que `install.ps1` fait
			   `exit 1` sur chaque échec et qu'un `exit` dans un `irm | iex` lancé dans
			   la session ferme la fenêtre entière, sans un mot — le code de sortie
			   n'existerait pas, et la branche « échec » du script ne serait jamais
			   atteinte. Codex l'a déjà, sous sa forme officielle. */
			for (const outil of ["claude", "codex", "ollama"]) {
				const script = scriptInstallation(outil, "t", msgs);
				const affichee = commandeInstallation(outil, true).code;
				const lancee = commandeInstallationLancee(outil, true);
				r.check(outil + " : la ligne lancée CONTIENT la ligne affichée, et le script la contient",
					{ dansLeScript: script.includes(lancee), contient: lancee.includes(affichee) }, { dansLeScript: true, contient: true });
			}
			r.check("les écarts entre affiché et lancé sont exactement les trois admis",
				{
					claude: commandeInstallationLancee("claude", true),
					codex: commandeInstallationLancee("codex", true) === commandeInstallation("codex", true).code,
					ollama: commandeInstallationLancee("ollama", true).slice(commandeInstallation("ollama", true).code.length),
					/* Antigravity : le sous-processus (comme Claude) PUIS un filtre
					   d'affichage qui retire le préfixe de journalisation Go — et
					   rien d'autre : la ligne affichée est dedans, telle quelle. */
					agy: commandeInstallationLancee("agy", true).startsWith('powershell -ExecutionPolicy Bypass -c "irm https://antigravity.google/cli/install.ps1 | iex" 2>&1 | ForEach-Object {')
						&& commandeInstallationLancee("agy", true).includes("[Console]::Out.WriteLine(")
						&& !commandeInstallationLancee("agy", true).includes("Write-Host"),
				},
				{
					claude: 'powershell -ExecutionPolicy Bypass -c "irm https://claude.ai/install.ps1 | iex"',
					codex: true,
					ollama: " --accept-source-agreements --accept-package-agreements",
					agy: true,
				});
			/* LE FILTRE, sur de vraies lignes de l'installateur (2026-09-20) : le
			   préfixe tombe, le message reste, et une ligne ordinaire — le succès,
			   l'URL de connexion — passe intacte. Éprouvé avec le moteur de
			   PowerShell lui-même. */
			{
				const echantillon = [
					"ERROR: logging before google.Init: I0920 19:58:12.796444       1 installer.go:27] Running Antigravity CLI setup...",
					"ERROR: logging before google.Init: I0920 19:58:13.267352       1 installer_windows.go:179] PATH verification: C:\\Users\\Ahmed\\AppData\\Local\\agy\\bin is correctly configured in Environment PATH.",
					"✅ Antigravity CLI installed successfully at C:\\Users\\Ahmed\\AppData\\Local\\agy\\bin\\agy.exe",
					"  https://accounts.google.com/o/oauth2/auth?access_type=offline",
				];
				const { execFileSync } = await import("node:child_process");
				/* La sortie de `powershell.exe` est lue ici en UTF-8 : sans le dire,
				   la console du harnais rend la coche « ✅ » en « ? » — un défaut
				   du TEST, pas du filtre. */
				const ps = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p = '" + PREFIXE_JOURNAL_GO + "'; @(" + echantillon.map(l => "'" + l.replace(/'/g, "''") + "'").join(",") + ") | ForEach-Object { [Console]::Out.WriteLine(($_ -replace $p, '')) }";
				let sortie = "";
				try {
					sortie = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 20000 });
				} catch (e) { sortie = "ÉCHEC : " + String(e && e.message); }
				r.check("le préfixe de journalisation Go tombe, le message reste, le reste passe intact",
					sortie.split(/\r?\n/).filter(Boolean),
					[
						"Running Antigravity CLI setup...",
						"PATH verification: C:\\Users\\Ahmed\\AppData\\Local\\agy\\bin is correctly configured in Environment PATH.",
						"✅ Antigravity CLI installed successfully at C:\\Users\\Ahmed\\AppData\\Local\\agy\\bin\\agy.exe",
						"  https://accounts.google.com/o/oauth2/auth?access_type=offline",
					]);
			}
			r.check("hors Windows, la ligne lancée de Claude reste celle affichée (bash n'a pas ce problème)",
				commandeInstallationLancee("claude", false), commandeInstallation("claude", false).code);

			const script = "Write-Host 'é | $x'";
			const b64 = encoderCommande(script);
			r.check("encoderCommande : base64 d'UTF-16LE, aller-retour exact", Buffer.from(b64, "base64").toString("utf16le"), script);
			r.check("encoderCommande : rien d'autre que du base64", /^[A-Za-z0-9+/=]+$/.test(b64), true);
			const args = argumentsTerminal("Neo Quiz", script);
			r.check("argumentsTerminal : Start-Process, -EncodedCommand, SANS -NoExit (le script décide de rester), jamais le script en clair",
				{
					debut: args.slice(0, 2),
					troisieme: args[2].includes("Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-EncodedCommand','" + b64),
					noExit: args[2].includes("-NoExit"),
					clair: args[2].includes("Write-Host"),
				},
				{ debut: ["-NoProfile", "-Command"], troisieme: true, noExit: false, clair: false });
		}

		/* ── LES PIÈCES JOINTES, ET LE DOSSIER QUI LES PORTE ──

		   CE QU'ILS EMPÊCHENT. `callClaude` et `callCodex` écrivaient eux-mêmes
		   les images dans un `mkdtempSync` et glissaient les chemins ABSOLUS
		   obtenus dans le prompt ou dans les arguments (`-i`, `-o`), puis
		   effaçaient le dossier. Le rendu n'a ni disque ni chemins : depuis la
		   tâche 4, il n'envoie que des JETONS que l'hôte remplace. Cette moitié
		   est écrite MAINTENANT, alors que `run` rejette encore, pour que la
		   tâche 7 n'ait plus qu'à poser le `spawn` au milieu — et surtout pour
		   qu'elle ne la réinvente pas autrement que l'hôte Obsidian, auquel cas
		   la même génération produirait deux prompts différents selon l'hôte.

		   L'EXÉCUTANT EST UN FAUX : `avecFichiers` ne lance rien lui-même, il
		   enveloppe. Le faux tient donc exactement le rôle du `spawn` de la
		   tâche 7 — il reçoit les arguments et le `stdin` SUBSTITUÉS, et peut
		   écrire le fichier de sortie comme le ferait un CLI.

		   LE FORMAT DES JETONS EST ÉCRIT ICI À LA MAIN, comme dans
		   `check-obsidian-host.mjs` : c'est une promesse du contrat, et un
		   contrôle qui le lirait de `src/host/jetons.ts` resterait vert si le
		   format changeait des deux côtés à la fois. */
		const jeton = (m, quoi) => "{{nq-" + m + ":" + quoi + "}}";
		const MARQ = "0123456789abcdef0123456789abcdef";
		const piece = { nom: "image-1.png", base64: Buffer.from("OCTETS-IMAGE").toString("base64") };
		const specImage = {
			marqueur: MARQ,
			args: ["-i", jeton(MARQ, "fichier:1"), "-o", jeton(MARQ, "sortie"), "-C", jeton(MARQ, "home")],
			stdin: "PROMPT\n- " + jeton(MARQ, "fichier:1") + "\n",
			fichiers: [piece],
			sortieFichier: "last-message.txt",
		};
		const envMaisonSeule = { USERPROFILE: maison, HOME: maison };

		await cas(r, "le jeton de pièce jointe est remplacé dans les args ET dans stdin par un chemin qui existe", async () => {
			/* Le contenu est lu DEPUIS l'exécutant : c'est le seul moment où le
			   fichier existe encore, le dossier étant effacé au retour. Un test
			   fait après coup ne pourrait plus rien en dire. */
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = {
					nom: resolu.args[1].split(/[/\\]/).pop(),
					contenu: readFileSync(resolu.args[1], "utf8"),
					stdin: resolu.stdin.includes(resolu.args[1]) && !resolu.stdin.includes("{{nq-"),
				};
				return null;
			}, envMaisonSeule);
			r.check("le jeton de pièce jointe est remplacé dans les args ET dans stdin par un chemin qui existe",
				vu, { nom: "image-1.png", contenu: "OCTETS-IMAGE", stdin: true });
		});

		await cas(r, "le jeton du dossier personnel rend le dossier personnel DONNÉ, pas celui de la machine", async () => {
			/* `USERPROFILE`/`HOME` sont des paramètres exprès : `homedir()` ne
			   suit pas `HOME` sous Windows, et un cas qui ne peut pas fabriquer
			   son entrée ne compare qu'à une formule recopiée du code. */
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = { home: resolu.args[5], imageDansUnDossierAPart: !resolu.args[1].startsWith(maison) };
				return null;
			}, envMaisonSeule);
			r.check("le jeton du dossier personnel rend le dossier personnel DONNÉ, pas celui de la machine",
				vu, { home: maison, imageDansUnDossierAPart: true });
		});

		await cas(r, "un prompt qui cite {{home}} ou {{fichier:1}} ressort INTACT", async () => {
			/* `stdin` porte la demande de l'utilisateur ET le contenu des notes
			   qu'il a jointes. La première forme des jetons était FIXE
			   (`{{home}}`) — une note sur Handlebars, Jinja ou Mustache faisait
			   donc partir le chemin ABSOLU de la machine au modèle, libre de le
			   recopier dans le quiz ; et un `{{fichier:1}}` cité sans image
			   jointe faisait REFUSER l'appel, tuant la génération sur un
			   diagnostic interne, en français, dans une interface anglaise. Le
			   marqueur est tiré au sort par appel — pas même la FORME complète
			   avec un autre marqueur ne collisionne, ce que la 3e phrase
			   ci-dessous éprouve. */
			const citations = "Un gabarit Handlebars s'écrit {{home}}, et {{fichier:1}} aussi. "
				+ "Même avec un autre marqueur : " + jeton("ffffffffffffffffffffffffffffffff", "home") + ".";
			let vu = null;
			await avecFichiers({ ...specImage, stdin: citations }, async resolu => {
				vu = resolu.stdin;
				return null;
			}, envMaisonSeule);
			r.check("un prompt qui cite {{home}} ou {{fichier:1}} ressort INTACT", vu, citations);
		});

		await cas(r, "sans marqueur, aucun jeton n'est substitué", async () => {
			/* Le défaut SÛR : un appelant qui ne fournit pas de marqueur ne veut
			   pas de substitution, et son texte traverse tel quel.

			   SANS PIÈCE JOINTE, et c'est une correction : ce cas en passait,
			   c'est-à-dire qu'il DÉCRIVAIT la combinaison que `run` refuse
			   désormais (des fichiers écrits qu'aucun jeton ne peut désigner).
			   Il resterait vert sur cette combinaison alors qu'elle est un défaut,
			   ce qui affaiblirait le cas qui la refuse un peu plus bas. Ce qu'il
			   éprouve — « pas de marqueur, pas de substitution » — n'a besoin
			   d'aucune pièce jointe pour être vu. */
			const sansFichiers = {
				args: ["-i", jeton(MARQ, "fichier:1"), "-C", jeton(MARQ, "home")],
				stdin: "PROMPT " + jeton(MARQ, "home"),
			};
			let vu = null;
			await avecFichiers(sansFichiers, async resolu => {
				vu = { args: resolu.args, stdin: resolu.stdin };
				return null;
			}, envMaisonSeule);
			r.check("sans marqueur, aucun jeton n'est substitué",
				vu, { args: sansFichiers.args, stdin: sansFichiers.stdin });
		});

		await cas(r, "sortieFichier rend le contenu écrit par l'enfant", async () => {
			const { sortie } = await avecFichiers(specImage, async resolu => {
				/* LE CHEMIN DOIT ÊTRE ABSOLU avant qu'on écrive quoi que ce soit.
				   Sous une rupture de la substitution, `args[3]` vaut le jeton
				   LITTÉRAL : un chemin RELATIF, donc un fichier écrit dans le
				   dossier courant — le dépôt. C'est arrivé une fois, en salissant
				   l'arbre de travail. Un contrôle ne doit jamais écrire hors de
				   son dossier temporaire, même quand la règle qu'il éprouve est
				   cassée : la garde fait rougir le cas, ce qui est le but. */
				if (!isAbsolute(resolu.args[3])) {
					throw new Error("chemin de sortie non absolu (jeton non substitué ?) : " + resolu.args[3]);
				}
				writeFileSync(resolu.args[3], "REPONSE FINALE");
				return null;
			}, envMaisonSeule);
			r.check("sortieFichier rend le contenu écrit par l'enfant", sortie, "REPONSE FINALE");
		});

		await cas(r, "sortieFichier absent rend undefined", async () => {
			/* `undefined` et non `""` : l'appelant distingue « le CLI n'a rien
			   écrit » (il reconstitue la réponse depuis les events JSONL) de
			   « il a écrit une réponse vide » (« ChatGPT n'a rien répondu »).
			   Une chaîne vide confondrait les deux. */
			const res = await avecFichiers(specImage, async () => "fini", envMaisonSeule);
			r.check("sortieFichier absent rend undefined",
				{ sortie: res.sortie, resultat: res.resultat }, { sortie: undefined, resultat: "fini" });
		});

		await cas(r, "le dossier temporaire est effacé même quand le CLI échoue", async () => {
			/* Un dossier qui SURVIT laisse les images de l'utilisateur dans
			   %TEMP% à chaque génération — un défaut qu'aucun écran ne montre.
			   L'exécutant JETTE, comme le fera un `spawn` annulé ou introuvable. */
			let dossierVu = "";
			let leve = "(aucun rejet)";
			try {
				await avecFichiers(specImage, async resolu => {
					dossierVu = resolu.args[1].slice(0, resolu.args[1].lastIndexOf(resolu.args[1].includes("/") ? "/" : "\\"));
					throw new Error("le CLI a échoué");
				}, envMaisonSeule);
			} catch (e) {
				leve = e.message;
			}
			r.check("le dossier temporaire est effacé même quand le CLI échoue",
				{ existeEncore: existsSync(dossierVu), dossierConnu: dossierVu.length > 0, leve },
				{ existeEncore: false, dossierConnu: true, leve: "le CLI a échoué" });
		});

		await cas(r, "un jeton qui ne désigne rien est refusé, avec son nom", async () => {
			/* Laissé passer, le jeton LITTÉRAL partirait sur la ligne de commande
			   et le CLI se plaindrait d'un chemin qui ne désigne rien ; rendu
			   VIDE, il donnerait `-o ""`, un argument vide au lieu d'un chemin.
			   Les deux produisent un appel faux et muet. */
			const nomDuRejet = async (spec) => {
				try {
					await avecFichiers(spec, async () => null, envMaisonSeule);
					return "(aucun rejet)";
				} catch (e) {
					return e.name;
				}
			};
			r.check("un jeton qui ne désigne rien est refusé, avec son nom",
				{
					indexHorsBornes: await nomDuRejet({
						marqueur: MARQ, args: ["-i", jeton(MARQ, "fichier:3")], stdin: "", fichiers: [piece],
					}),
					sortieSansFichier: await nomDuRejet({
						marqueur: MARQ, args: ["-o", jeton(MARQ, "sortie")], stdin: "",
					}),
					marqueurInvalide: await nomDuRejet({
						marqueur: "pas-hexa!", args: ["-i", "x"], stdin: "", fichiers: [piece],
					}),
				},
				{ indexHorsBornes: "refuse", sortieSansFichier: "refuse", marqueurInvalide: "refuse" });
		});

	} finally {
		rmSync(racine, { recursive: true, force: true });
	}

	/* ── La disposition des fenêtres : l'emplacement d'avant du navigateur
	   est écrit AVANT de le poser, puis relu et rendu (Ahmed, 2026-09-19). ── */
	{
		const disposition = scriptDisposerPourSite(1234);
		r.check("le script écrit « avant … » avant de poser le navigateur",
			disposition.indexOf("WriteLine('avant '") > 0 && disposition.indexOf("WriteLine('avant '") < disposition.lastIndexOf("Poser $hNav"), true);
		r.check("« avant » : hwnd, showCmd, rectangle normal ; agrandie (3) reste agrandie",
			lirePlacement("avant 725604 3 100 100 1000 700"), { hwnd: 725604, showCmd: 3, l: 100, t: 100, r: 1000, b: 700 });
		r.check("réduite (2) est rendue normale (1) : on l'avait restaurée pour la poser", lirePlacement("avant 5 2 0 0 10 10\r").showCmd, 1);
		r.check("toute autre ligne : null", [lirePlacement("pret"), lirePlacement("avant x"), lirePlacement("")], [null, null, null]);
		/* LE COLLAGE (2026-09-20) : demandé, le script attend que le titre de
		   la fenêtre du navigateur se stabilise, la ramène devant et colle,
		   APRÈS l'avoir posée ; non demandé, rien de tout cela. */
		const avecCollage = scriptDisposerPourSite(1234, true);
		r.check("collage demandé : titre stable, premier plan, colle, après la pose du navigateur",
			{
				drapeau: avecCollage.includes("$coller = $true"),
				titre: avecCollage.includes("GetWindowText($hNav"),
				devant: avecCollage.includes("SetForegroundWindow($h)"),
				colle: avecCollage.includes("EnvoyerTouches $h '^v'"),
				apresPose: avecCollage.indexOf("EnvoyerTouches $h '^v'") > avecCollage.lastIndexOf("Poser $hNav"),
			},
			{ drapeau: true, titre: true, devant: true, colle: true, apresPose: true });
		r.check("collage non demandé : le drapeau est faux et rien ne dépend de lui hors de sa garde",
			{ drapeau: disposition.includes("$coller = $false"), garde: disposition.includes("if ($coller) {") },
			{ drapeau: true, garde: true });
		/* ROBUSTESSE À LA REDIRECTION TARDIVE (2026-09-22, chat.mistral.ai qui
		   colle une fois sur deux : mesuré, la page peut rediriger de `/chat`
		   vers `/work` jusqu'à t ≈ 4,9 s, APRÈS un premier collage qu'une
		   fenêtre au même titre rendait invisible à la boucle de stabilité). */
		r.check("Ctrl+A précède Ctrl+V (idempotence : un second collage remplace plutôt que double)",
			avecCollage.indexOf("EnvoyerTouches $h '^a'") > 0 && avecCollage.indexOf("EnvoyerTouches $h '^a'") < avecCollage.indexOf("EnvoyerTouches $h '^v'"), true);
		r.check("le premier plan (GetForegroundWindow == $h) est vérifié avant CHAQUE envoi de touches, jamais un envoi aveugle",
			{
				compareAuHwndNavigateur: avecCollage.includes("GetForegroundWindow() -eq $h"),
				gardeCoLocaliseeAvecLenvoi: /if \(-not \(AuPremierPlan \$h\)\) \{ return \$false \}; \[System\.Windows\.Forms\.SendKeys\]::SendWait/.test(avecCollage),
				unSeulSendWaitDansLeScript: (avecCollage.match(/SendKeys\]::SendWait/g) || []).length,
			},
			{ compareAuHwndNavigateur: true, gardeCoLocaliseeAvecLenvoi: true, unSeulSendWaitDansLeScript: 1 });
		r.check("« colle »/« recolle » ne sont écrits qu'après un collage RÉUSSI, jamais inconditionnellement",
			{
				colleConditionnel: avecCollage.includes("if (TenterCollage $hNav) { [Console]::Out.WriteLine('colle')"),
				/* Depuis la garde anti-frappe (2026-09-22) : le second collage est
				   dans le `elseif` d'un `if ($tapee)`, plus dans un `if` isolé — voir
				   le groupe de cas suivant, qui éprouve cette garde. */
				recolleConditionnel: avecCollage.includes("} elseif (TenterCollage $hNav) {\n        [Console]::Out.WriteLine('recolle')"),
				appeleeDeuxFois: (avecCollage.match(/TenterCollage \$hNav/g) || []).length,
			},
			{ colleConditionnel: true, recolleConditionnel: true, appeleeDeuxFois: 2 });
		r.check("une redirection tardive (titre qui repasse par vide puis se restabilise, même règle de six lectures) déclenche un second collage borné dans le temps",
			{
				guetteLeVide: avecCollage.includes("if (-not $t) { $vu = $true }"),
				restabilisationMemeRegleDeSix: avecCollage.includes("if ($stable -ge 6) { $restabilise = $true; break }"),
				secondCollageGardeParLaRestabilisation: avecCollage.indexOf("if ($restabilise) {") < avecCollage.indexOf("WriteLine('recolle')"),
				delaisBornesEtNommes: avecCollage.includes("$delaiSurveillanceMs = 12000") && avecCollage.includes("$delaiComposerApresRedirectionMs = 3000"),
			},
			{ guetteLeVide: true, restabilisationMemeRegleDeSix: true, secondCollageGardeParLaRestabilisation: true, delaisBornesEtNommes: true });
		/* LA GARDE ANTI-FRAPPE (2026-09-22) : le second collage remplace (Ctrl+A)
		   ce qui est dans le composer, donc ne doit JAMAIS partir si l'utilisateur
		   a tapé depuis le premier collage — `GetAsyncKeyState`, pas
		   `GetLastInputInfo` (qui compte aussi la souris, bougée en permanence
		   pendant ces secondes-là, et ferait renoncer presque à chaque fois). */
		r.check("GetAsyncKeyState est importé, et sur des touches de SAISIE seulement (pas Alt+Tab, pas le volume)",
			{
				importe: avecCollage.includes("GetAsyncKeyState(int vKey)"),
				pasGetLastInputInfo: !avecCollage.includes("GetLastInputInfo"),
				/* Lettres, chiffres, pavé numérique, espace, retour arrière, entrée :
				   les bornes de plage attendues, jamais une liste de touches système. */
				lettres: avecCollage.includes("(0x41..0x5A)"),
				chiffres: avecCollage.includes("(0x30..0x39)"),
				paveNumerique: avecCollage.includes("(0x60..0x69)"),
				espaceRetourArriereEntree: avecCollage.includes("@(0x08,0x0D,0x20)"),
			},
			{ importe: true, pasGetLastInputInfo: true, lettres: true, chiffres: true, paveNumerique: true, espaceRetourArriereEntree: true });
		{
			const iColle = avecCollage.indexOf("WriteLine('colle')");
			const iNettoyage = avecCollage.indexOf("foreach ($vk in $touchesSaisie) { [NQ.Win]::GetAsyncKeyState($vk) | Out-Null }");
			const iBoucleGuet = avecCollage.indexOf("for ($i = 0; $i -lt ($delaiSurveillanceMs / 100); $i++) {");
			const iRenonce = avecCollage.indexOf("WriteLine('renonce')");
			const iRecolle = avecCollage.indexOf("} elseif (TenterCollage $hNav) {");
			r.check("l'état des touches de saisie est vidé APRÈS le premier collage et AVANT le guet — sinon le Ctrl+A/Ctrl+V qu'on vient d'envoyer se compterait comme une frappe de l'utilisateur",
				iColle > 0 && iNettoyage > iColle && iNettoyage < iBoucleGuet, true);
			r.check("le guet sonde une frappe à CHAQUE tour (toutes les 100 ms), avant et après la restabilisation",
				{
					dansLaBoucle: /for \(\$i = 0; \$i -lt \(\$delaiSurveillanceMs \/ 100\); \$i\+\+\) \{\s*Start-Sleep -Milliseconds 100\s*if \(-not \$tapee -and \(ToucheSaisieFrappee\)\)/.test(avecCollage),
					apresLeDelaiDuComposer: avecCollage.includes("Start-Sleep -Milliseconds $delaiComposerApresRedirectionMs\n      if (-not $tapee -and (ToucheSaisieFrappee))"),
				},
				{ dansLaBoucle: true, apresLeDelaiDuComposer: true });
			r.check("une frappe détectée écrit « renonce » et saute le second collage — jamais de vol de premier plan quand le garde refuse",
				{
					ordre: iRenonce > 0 && iRenonce < iRecolle,
					renonceDansLeIfTapee: /if \(\$tapee\) \{\s*\[Console\]::Out\.WriteLine\('renonce'\)/.test(avecCollage),
					recolleDansLeElse: avecCollage.slice(iRecolle).startsWith("} elseif (TenterCollage $hNav) {\n        [Console]::Out.WriteLine('recolle')"),
					/* La branche « renonce » (entre son écriture et le `elseif` qui
					   suit) ne contient QUE l'écriture du marqueur : ni
					   SetForegroundWindow ni SendKeys — refuser, c'est ne rien
					   envoyer, jamais forcer le focus pour rien. */
					brancheRenonceSansVolDeFocus: !/SetForegroundWindow|SendKeys/.test(avecCollage.slice(iRenonce, iRecolle)),
				},
				{ ordre: true, renonceDansLeIfTapee: true, recolleDansLeElse: true, brancheRenonceSansVolDeFocus: true });
		}
		/* L'ANALYSE SYNTAXIQUE ELLE-MÊME (2026-09-22). Tous les cas ci-dessus ne
		   cherchent que des SOUS-CHAÎNES dans le script produit — aveugles à toute
		   faute de SYNTAXE PowerShell ou de PORTÉE de variable, exactement
		   l'avertissement que le CLAUDE.md du projet porte sur ce genre de
		   contrôle. Le script est donc donné au parseur de PowerShell LUI-MÊME
		   (`[System.Management.Automation.Language.Parser]::ParseInput`).

		   LE POINT DÉLICAT EST L'ÉCHAPPEMENT : ce script contient des centaines
		   d'apostrophes, de guillemets, d'accolades et de dollars — l'embarquer
		   tel quel dans un argument `-Command` en aurait fait une seconde source
		   de bugs (échapper le texte qu'on cherche justement à faire analyser).
		   Il est donc transmis par STDIN (`spawnSync(..., { input: script })`) à
		   un wrapper PowerShell FIXE et minuscule, qui ne contient lui-même
		   aucune apostrophe ni aucun guillemet : `[Console]::In.ReadToEnd()`.
		   Aucune trace du texte analysé n'apparaît jamais sur une ligne de
		   commande. Sauté proprement (jamais un échec) si PowerShell est
		   introuvable sur la machine qui lance le contrôle. */
		{
			const { spawnSync } = await import("node:child_process");
			const powershellDisponible = (() => {
				try {
					const sonde = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "1"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
					return !sonde.error && sonde.status === 0;
				} catch { return false; }
			})();
			if (!powershellDisponible) {
				console.log("check-electron-process : PowerShell introuvable — analyse syntaxique du script de collage sautée");
			} else {
				const parseurPs = [
					"$texte = [Console]::In.ReadToEnd()",
					"$erreurs = $null",
					"[System.Management.Automation.Language.Parser]::ParseInput($texte, [ref]$null, [ref]$erreurs) | Out-Null",
					"[Console]::Out.WriteLine($erreurs.Count)",
				].join("\n");
				for (const [nom, script] of [["sans collage", disposition], ["avec collage", avecCollage]]) {
					const resultat = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parseurPs], { input: script, encoding: "utf8", windowsHide: true, timeout: 20000 });
					r.check("le script de disposition (" + nom + ") est syntaxiquement valide pour le parseur PowerShell",
						{ code: resultat.status, erreurs: Number((resultat.stdout || "-1").trim()) },
						{ code: 0, erreurs: 0 });
				}
			}
		}
		const restauration = scriptRestaurerNavigateur({ hwnd: 725604, showCmd: 3, l: 100, t: 100, r: 1000, b: 700 });
		r.check("la restauration passe par SetWindowPlacement, sur la fenêtre si elle existe encore",
			[restauration.includes("IsWindow($h)"), restauration.includes("SetWindowPlacement"), restauration.includes("$p.ShowCmd = 3"), restauration.includes("$p.R = 1000")], [true, true, true, true]);
	}
	/* ── La disposition pour un TERMINAL (Ahmed, 2026-09-20) : la fenêtre est
	   trouvée par son TITRE via `Get-Process` (pas `FindWindow`, dont le `$null`
	   de classe arrive en chaîne vide depuis PowerShell), posée au RECTANGLE
	   reçu (sous la modale, en pixels écran — plus à gauche de Neo Quiz, qui
	   ne bouge plus), puis guettée jusqu'à sa disparition — « fini » est ce
	   que le principal attend ; « absent » si elle n'est jamais venue. ── */
	{
		const d = scriptDisposerPourTerminal(1234, "Neo Quiz - Codex CLI", { x: 700, y: 420.7, largeur: 560, hauteur: 300 });
		r.check("terminal : trouvé par son titre exact, par Get-Process, jamais par FindWindow",
			{ titre: d.includes("$titre = 'Neo Quiz - Codex CLI'"), getProcess: d.includes("$_.MainWindowTitle -eq $titre"), findWindow: d.includes("FindWindow") },
			{ titre: true, getProcess: true, findWindow: false });
		const iPose = d.indexOf("Poser $hTerm 700 420 560 300");
		r.check("terminal : posé au rectangle reçu (entiers), puis guetté jusqu'à disparition, puis « fini » ; « absent » s'il n'apparaît pas",
			{
				gauche: iPose > 0,
				attente: d.indexOf("while ([NQT.Win]::IsWindow($hTerm))") > iPose,
				fini: d.indexOf("WriteLine('fini')") > d.indexOf("while ([NQT.Win]::IsWindow($hTerm))"),
				absent: d.includes("WriteLine('absent')") && d.indexOf("WriteLine('absent')") < iPose,
			},
			{ gauche: true, attente: true, fini: true, absent: true });
		/* Le rectangle du terminal, PUR : sous l'ancre (12 DIP), même largeur,
		   jusqu'à 24 DIP du bas de la fenêtre, 460 au plus, 200 au moins ; les
		   pixels CSS passent en DIP par le zoom ; sans ancre, la moitié basse. */
		const contenu = { x: 100, y: 50, width: 1600, height: 900 };
		r.check("rectangleTerminal : sous l'ancre, même largeur, plafonné à 560, zoom appliqué, moitié basse sans ancre",
			{
				sous: rectangleTerminal(contenu, 1, { x: 400, y: 100, largeur: 600, hauteur: 200 }),
				zoom: rectangleTerminal(contenu, 1.25, { x: 400, y: 100, largeur: 600, hauteur: 200 }),
				bas: rectangleTerminal(contenu, 1, { x: 400, y: 700, largeur: 600, hauteur: 200 }),
				sans: rectangleTerminal(contenu, 1, null),
			},
			{
				sous: { x: 500, y: 362, width: 600, height: 560 },
				zoom: { x: 600, y: 437, width: 750, height: 489 },
				bas: { x: 500, y: 962, width: 600, height: 200 },
				sans: { x: 420, y: 500, width: 960, height: 426 },
			});
		/* LA LIMITE BASSE : le terminal s'arrete AU-DESSUS de l'invite plutot
		   que de se poser en travers (Ahmed, 2026-09-20). Elle est en pixels
		   CSS, donc multipliee par le zoom comme le reste ; le bas de la
		   fenetre reste le plafond quand elle est plus basse que lui. */
		r.check("rectangleTerminal : la limite basse (le haut de l'invite) borne la hauteur, zoom compris, et ne depasse jamais le bas de la fenetre",
			{
				borne: rectangleTerminal(contenu, 1, { x: 400, y: 100, largeur: 600, hauteur: 200, limiteBas: 700 }),
				zoom: rectangleTerminal(contenu, 1.25, { x: 400, y: 100, largeur: 600, hauteur: 200, limiteBas: 700 }),
				plusBasQueLaFenetre: rectangleTerminal(contenu, 1, { x: 400, y: 100, largeur: 600, hauteur: 200, limiteBas: 5000 }),
			},
			{
				borne: { x: 500, y: 362, width: 600, height: 376 },
				zoom: { x: 600, y: 437, width: 750, height: 476 },
				plusBasQueLaFenetre: { x: 500, y: 362, width: 600, height: 560 },
			});
		/* PAS ASSEZ DE PLACE AU-DESSUS DE L'INVITE : le terminal descend et la
		   COUVRE EN ENTIER, au moins aussi large qu'elle (elle ne dépasse sur
		   aucun flanc), au lieu des 200 px de quatre lignes (vu le 2026-09-20 :
		   modale finie à 633, invite à 499). */
		r.check("rectangleTerminal : sans place au-dessus de l'invite, il descend et la couvre en entier",
			rectangleTerminal(contenu, 1, { x: 400, y: 100, largeur: 520, hauteur: 264, limiteBas: 300, inviteX: 300, inviteLargeur: 800 }),
			{ x: 400, y: 426, width: 800, height: 500 });
		r.check("rectangleTerminal : avec de la place, l'invite reste une simple limite basse",
			rectangleTerminal(contenu, 1, { x: 400, y: 100, largeur: 520, hauteur: 200, limiteBas: 800, inviteX: 300, inviteLargeur: 800 }),
			{ x: 500, y: 362, width: 520, height: 476 });
		r.check("lireAncre : la limite basse traverse quand elle est valide, et son absence n'invalide rien",
			[lireAncre({ x: 1, y: 2, largeur: 3, hauteur: 4, limiteBas: 5 }), lireAncre({ x: 1, y: 2, largeur: 3, hauteur: 4, limiteBas: -1 })],
			[{ x: 1, y: 2, largeur: 3, hauteur: 4, limiteBas: 5 }, { x: 1, y: 2, largeur: 3, hauteur: 4 }]);
		/* LES DEUX COLONNES : le même script guette le NAVIGATEUR au premier
		   plan (jamais une fenêtre d'arrière-plan, que le repli
		   `MainWindowHandle` du script de site aurait prise), écrit son
		   placement d'avant puis « navigateur ». */
		r.check("terminal : le navigateur est guetté au PREMIER PLAN, son placement écrit, puis posé à gauche et annoncé",
			{
				registre: d.includes("UrlAssociations") && d.includes("UserChoice"),
				premierPlan: d.includes("GetForegroundWindow()") && d.includes("$proc.ProcessName -ieq $nomNav"),
				repli: d.includes("Get-Process -Name $nomNav"),
				avant: d.indexOf("WriteLine('avant ' + [int64]$hNav") > 0,
				gauche: d.indexOf("Poser $hNav $aire.Left $aire.Top $moitie $aire.Height") > d.indexOf("WriteLine('avant ' + [int64]$hNav"),
				annonce: d.indexOf("WriteLine('navigateur')") > d.indexOf("Poser $hNav $aire.Left"),
			},
			{ registre: true, premierPlan: true, repli: false, avant: true, gauche: true, annonce: true });
		/* Reposer une fenêtre déjà ouverte : par son TITRE, sans rien guetter,
		   cadre invisible absorbé comme partout. */
		{
			const pf = scriptPoserFenetre("Neo Quiz - Antigravity CLI", { x: 960, y: 300, largeur: 700, hauteur: 420 });
			r.check("scriptPoserFenetre : trouve par titre, pose au rectangle, absorbe le cadre DWM, ne guette rien",
				{
					titre: pf.includes("$titre = 'Neo Quiz - Antigravity CLI'"),
					rect: pf.includes("$x = 960; $y = 300; $cx = 700; $cy = 420"),
					dwm: pf.includes("DwmGetWindowAttribute"),
					attente: pf.includes("IsWindow") || pf.includes("Start-Sleep"),
				},
				{ titre: true, rect: true, dwm: true, attente: false });
		}
		/* DEUX FENÊTRES DU MÊME TITRE : un essai raté retient sa fenêtre, et
		   relancer en ouvrait une seconde — le placement et l'attente, qui
		   cherchent par TITRE, accrochaient alors l'ancienne (Ahmed,
		   2026-09-20). L'ancienne est fermée par WM_CLOSE, jamais en tuant le
		   processus : la fenêtre appartient à Windows Terminal, qui héberge
		   aussi les autres terminaux de l'utilisateur. */
		{
			const f = scriptFermerTerminal("Neo Quiz - Antigravity CLI");
			r.check("scriptFermerTerminal : WM_CLOSE sur les fenêtres de CE titre, jamais un Stop-Process",
				{
					titre: f.includes("$titre = 'Neo Quiz - Antigravity CLI'"),
					parTitre: f.includes("$_.MainWindowTitle -eq $titre"),
					wmClose: f.includes("PostMessage") && f.includes("0x0010"),
					tue: /Stop-Process|\.Kill\(\)|taskkill/i.test(f),
				},
				{ titre: true, parTitre: true, wmClose: true, tue: false });
		}
		/* DEUX ÉCRANS : les colonnes se forment sur l'écran de NEO QUIZ. Un
		   terminal né ailleurs aurait emporté le navigateur avec lui. */
		r.check("terminal : l'aire des deux colonnes est celle de l'écran de Neo Quiz, le terminal en repli",
			d.includes("$aire = if ($hwndNeo -ne 0) { [System.Windows.Forms.Screen]::FromHandle([IntPtr]$hwndNeo).WorkingArea }"), true);
		r.check("lireAncre : quatre nombres finis et bornés, sinon null (jamais une propriété de plus)",
			[lireAncre({ x: 1, y: 2, largeur: 3, hauteur: 4, autre: 5 }), lireAncre({ x: -1, y: 2, largeur: 3, hauteur: 4 }), lireAncre({ x: "1", y: 2, largeur: 3, hauteur: 4 }), lireAncre(null), lireAncre({ x: 1, y: 2, largeur: 3, hauteur: Infinity })],
			[{ x: 1, y: 2, largeur: 3, hauteur: 4 }, null, null, null, null]);
	}
	r.done();
});
});

/**
 * LA MOITIÉ PURE DES JETONS (`src/host/jetons.ts`), éprouvée SEULE.
 *
 * Elle est partagée par les deux hôtes depuis la ronde 1 de la revue : composer
 * un jeton, le substituer, réduire un nom de fichier ne touche ni `fs`, ni
 * `os`, ni `path`. Dupliquée, elle avait DIVERGÉ en une tranche — l'une des
 * deux copies prenait son environnement en paramètre, l'autre lisait celui du
 * système. Ce groupe la tient à sa source ; les deux groupes d'hôte, eux,
 * tiennent la moitié DISQUE.
 *
 * Il vit dans ce script plutôt que dans un script neuf parce que c'est ici que
 * la moitié disque correspondante est déjà éprouvée : deux commandes pour un
 * même sujet se lancent moins souvent qu'une.
 */
await withSrcModule("src/host/jetons.ts", async ({
	jetonFichier, jetonHome, jetonSortie, nomDeFichierSur, nouveauMarqueur, substituerJetons,
}) => {
	const r = makeReporter("Jetons de pièces jointes (code partagé)");
	const MARQ = "0123456789abcdef0123456789abcdef";
	const valeurs = { marqueur: MARQ, chemins: ["/tmp/x/image-1.png"], sortie: "/tmp/x/out.txt", maison: "/home/a" };

	/* LA FORME DES JETONS est une promesse du contrat : `HostProcess.run` la
	   documente, et `check-obsidian-host.mjs` comme le groupe ci-dessus
	   l'écrivent à la main. Ce cas est le seul endroit où la SOURCE est
	   comparée à la forme écrite : s'ils divergent, c'est ici qu'on le voit. */
	r.check("les trois jetons portent le marqueur de l'appel",
		[jetonFichier(MARQ, 1), jetonFichier(MARQ, 12), jetonSortie(MARQ), jetonHome(MARQ)],
		["{{nq-" + MARQ + ":fichier:1}}", "{{nq-" + MARQ + ":fichier:12}}",
			"{{nq-" + MARQ + ":sortie}}", "{{nq-" + MARQ + ":home}}"]);

	/* Le marqueur est HEXADÉCIMAL et de longueur fixe : c'est ce qui en fait un
	   littéral sûr dans l'expression régulière composée ensuite, sans
	   échappement. Deux appels ne partagent pas le même — sinon le texte d'une
	   génération pourrait citer le jeton de la suivante. */
	const m1 = nouveauMarqueur();
	const m2 = nouveauMarqueur();
	r.check("un marqueur neuf est hexadécimal, long, et différent à chaque appel",
		{ forme: /^[0-9a-f]{32}$/.test(m1), distincts: m1 !== m2 }, { forme: true, distincts: true });

	r.check("les jetons du marqueur sont remplacés par leurs valeurs",
		substituerJetons(
			"lis " + jetonFichier(MARQ, 1) + " puis écris " + jetonSortie(MARQ) + " depuis " + jetonHome(MARQ),
			valeurs),
		"lis /tmp/x/image-1.png puis écris /tmp/x/out.txt depuis /home/a");

	/* LE TEXTE DE L'UTILISATEUR N'EST PAS UN JETON. `stdin` porte sa demande et
	   le contenu de ses notes ; la forme FIXE du premier jet (`{{home}}`)
	   collisionnait avec tout gabarit Handlebars, Jinja ou Mustache — et faisait
	   partir un chemin absolu de la machine au modèle. */
	const citations = "Handlebars écrit {{home}}, {{fichier:1}}, {{sortie}} ; "
		+ "et avec un AUTRE marqueur : " + jetonHome("ffffffffffffffffffffffffffffffff") + ".";
	r.check("un texte qui cite {{home}}, {{fichier:1}} ou le jeton d'un autre marqueur ressort INTACT",
		substituerJetons(citations, valeurs), citations);

	/* UN JETON QUI NE DÉSIGNE RIEN REFUSE — il ne s'efface pas. Rendu vide, il
	   donnerait `-o ""` au CLI : un argument vide au lieu d'un chemin, donc un
	   appel faux et MUET. */
	const nomDuJet = (fn) => { try { fn(); return "(aucun jet)"; } catch (e) { return e.name; } };
	r.check("un jeton qui ne désigne rien est refusé, avec son nom",
		{
			indexHorsBornes: nomDuJet(() => substituerJetons(jetonFichier(MARQ, 3), valeurs)),
			sortieAbsente: nomDuJet(() => substituerJetons(jetonSortie(MARQ), { ...valeurs, sortie: "" })),
			maisonAbsente: nomDuJet(() => substituerJetons(jetonHome(MARQ), { ...valeurs, maison: "" })),
			marqueurInvalide: nomDuJet(() => substituerJetons("x", { ...valeurs, marqueur: "PAS.HEXA*" })),
		},
		{ indexHorsBornes: "refuse", sortieAbsente: "refuse", maisonAbsente: "refuse", marqueurInvalide: "refuse" });

	/* REMPLACEMENT PAR FONCTION, jamais par chaîne : un chemin qui contient
	   `$&` ou `$1` serait réécrit par `String.replace`. Le dépôt a déjà payé ce
	   défaut ailleurs (cf. CLAUDE.md, `check:quiz-io`) — et un dossier
	   temporaire peut très bien contenir un `$`. */
	r.check("un chemin qui contient $& ou $1 est posé tel quel",
		substituerJetons(jetonFichier(MARQ, 1), { ...valeurs, chemins: ["C:/tmp/$&-$1-$$/image.png"] }),
		"C:/tmp/$&-$1-$$/image.png");

	/* Le rendu ne choisit pas OÙ l'hôte écrit : c'est la même règle que
	   `perimetre.borner` pour les chemins du pont. Un `..` ou un séparateur
	   sortirait du dossier temporaire, la seule chose que ce dossier promette. */
	r.check("le nom d'une pièce jointe ne sort pas du dossier temporaire",
		[
			nomDeFichierSur("../../evasion.bat", "defaut"),
			nomDeFichierSur("C:/Windows/System32/mal.exe", "defaut"),
			nomDeFichierSur("..", "defaut"),
			nomDeFichierSur("", "defaut"),
			nomDeFichierSur("image-1.png", "defaut"),
		],
		["evasion.bat", "mal.exe", "defaut", "defaut", "image-1.png"]);

	r.done();
});

/**
 * LANCER UN CLI — SUR DE VRAIS PROCESS (tâche 7).
 *
 * CE QUE CE GROUPE EMPÊCHE, et c'est la capacité la plus dangereuse du pont :
 * lancer un programme. Cinq propriétés, dont aucune ne se voit à l'écran quand
 * elle casse :
 * — la LISTE BLANCHE de noms et le REFUS d'un `tool` hors liste ; sans elle,
 *   « écris `x.bat` dans un dossier ouvert » + « lance-le » composent une
 *   exécution que le périmètre des chemins ne voit pas ;
 * — l'ORDRE des deux sources de l'exécutable (le réglage de l'utilisateur, puis
 *   le `PATH` étendu) : inversé, le réglage ne servirait à rien, et une machine
 *   avec deux installations lancerait l'autre ;
 * — la CITATION des arguments sur le repli `cmd.exe` (installations npm) : la
 *   première version citait `\"`, qui FERME le guillemet, et `a" & echo … & "b`
 *   exécutait la charge. Le témoin sur disque est ce qui distingue « bien cité »
 *   de « cmd a exécuté la charge » ;
 * — l'ARBRE tué à l'annulation : `claude` et `codex` spawnent des enfants, et
 *   un `kill` sur le seul parent laisse la génération tourner APRÈS le clic sur
 *   Stop, avec un process orphelin dans le Gestionnaire des tâches ;
 * — le VERROU par outil, relâché sur TOUTES les issues : une fuite rend le
 *   fournisseur définitivement inutilisable jusqu'au redémarrage.
 *
 * SUR LE MODULE RÉEL, avec de VRAIS enfants — `process.execPath` (Node
 * lui-même, le seul exécutable dont on soit sûr qu'il existe) lancé soit
 * DIRECTEMENT par le réglage « chemin », soit par un faux `codex.cmd` posé sur
 * un `PATH` bricolé, qui force le repli `cmd.exe`.
 *
 * L'ENVIRONNEMENT EST DÉDIÉ, jamais `process.env` : `APPDATA`, `LOCALAPPDATA`
 * et `CODEX_INSTALL_DIR` en sont ABSENTS. `environnementEnfant` les lit pour
 * ajouter des chemins en dur au `PATH` — et c'est précisément `LOCALAPPDATA`
 * qui, sur la machine d'Ahmed, pointe vers le VRAI Codex officiel. Un `PATH`
 * scopé ne sert à rien si ces trois variables réintroduisent un dossier réel
 * juste après : le cas recevrait la réponse du vrai CLI au lieu de celle du
 * faux (défaut vécu, `check:obsidian-host`, ronde 2 de la tâche 4).
 */
await withSrcModule("apps/windows/electron/process.ts", async ({ ollamaInstalle, resoudreExecutable, run, tuerArbre }) => {
	const r = makeReporter("Électron — lancer un CLI");
	const racine = mkdtempSync(join(tmpdir(), "quiz-lancer-"));
	const maison = join(racine, "maison");
	const vide = join(racine, "vide");
	mkdirSync(maison, { recursive: true });
	mkdirSync(vide, { recursive: true });

	/** Un environnement où RIEN d'autre que ce dossier n'est joignable. */
	const envDe = (dossier) => ({
		PATH: dossier,
		// Ce qu'il faut à `cmd.exe` pour se lancer lui-même.
		SystemRoot: process.env.SystemRoot,
		ComSpec: process.env.ComSpec,
		PATHEXT: process.env.PATHEXT,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		// Le dossier personnel : c'est le `cwd` des enfants, il doit exister.
		USERPROFILE: maison,
		HOME: maison,
	});

	/** Un faux CLI : un script Node, plus un lanceur du nom demandé.
	    `codex.cmd` sous Windows — même là où un `.exe` marcherait : c'est le
	    lanceur d'une installation npm réelle, et c'est délibérément le repli
	    `cmd.exe` (le chemin durci contre l'injection) qui doit être exercé. */
	const poserFauxCli = (nom, corps) => {
		const dossier = mkdtempSync(join(racine, "cli-"));
		const script = join(dossier, "faux.js");
		writeFileSync(script, corps);
		const lanceur = join(dossier, process.platform === "win32" ? nom + ".cmd" : nom);
		if (process.platform === "win32") {
			writeFileSync(lanceur, '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
		} else {
			writeFileSync(lanceur, '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
		}
		return { dossier, lanceur };
	};

	/** Un dossier où `codex` et `claude` sont NODE LUI-MÊME, sans script fixe :
	    le premier argument du `run` est donc le script lancé.

	    Il remplace l'option `cheminRegle` que ces cas passaient jusqu'au
	    2026-09-17 (« lance cet exécutable-ci »). Le réglage « chemin de
	    l'exécutable » a été retiré du produit : le seul chemin par lequel un
	    CLI est trouvé est désormais le `PATH`, et c'est donc par le `PATH` que
	    les cas doivent le poser — sinon ils éprouveraient une porte qui
	    n'existe plus. */
	const poserNodeNu = () => {
		const dossier = mkdtempSync(join(racine, "nodenu-"));
		for (const nom of ["codex", "claude"]) {
			const lanceur = join(dossier, process.platform === "win32" ? nom + ".cmd" : nom);
			if (process.platform === "win32") {
				writeFileSync(lanceur, "@echo off\r\n\"" + process.execPath + "\" %*\r\n");
			} else {
				writeFileSync(lanceur, "#!/bin/sh\nexec \"" + process.execPath + "\" \"$@\"\n", { mode: 0o755 });
			}
		}
		return dossier;
	};

	const nomDuRejet = async (promesse) => {
		try {
			await promesse;
			return "(aucun rejet)";
		} catch (e) {
			return e && e.name ? e.name : String(e);
		}
	};
	const dodo = (ms) => new Promise(resolve => setTimeout(resolve, ms));

	try {
		/* ── L'ORDRE DES DEUX SOURCES ── */
		const surPath = poserFauxCli("codex", "process.stdout.write('DU-PATH');");
		const ailleurs = poserFauxCli("autre", "process.stdout.write('DU-REGLAGE');");
		const env = envDe(surPath.dossier);

		await cas(r, "resoudreExecutable : le PATH, et rien d'autre", async () => {
			/* UNE SEULE SOURCE depuis le 2026-09-17. Le réglage « chemin de
			   l'exécutable » passait devant ; il a été retiré, et ce cas garde
			   ce qui reste : le nom est cherché sur le `PATH` étendu, et un
			   outil qui n'y est pas rend `null` — jamais un chemin deviné.
			   Comparaison en minuscules : sous Windows `PATHEXT` est écrit en
			   MAJUSCULES, donc le chemin trouvé porte « .CMD » là où le fichier
			   posé s'appelle « .cmd » — même fichier, système insensible à la
			   casse, et rien de ce qui suit n'en dépend. */
			const bas = (p) => (typeof p === "string" ? p.toLowerCase() : p);
			r.check("resoudreExecutable : le PATH, et rien d'autre",
				{
					parLePath: bas(resoudreExecutable("codex", env)),
					aucun: resoudreExecutable("claude", env),
				},
				{
					parLePath: bas(surPath.lanceur),
					aucun: null,
				});
			/* LE CLIQUET : un second argument « chemin » ne doit pas revenir.
			   `resoudreExecutable` en prenait un, et c'était par lui qu'un
			   chemin venu de la fenêtre atteignait `spawn`. */
			/* `length` compte les paramètres SANS valeur par défaut : `(tool,
			   env = process.env)` en déclare un seul. Il en déclarait deux
			   quand le chemin réglé passait devant — remettre un tel paramètre
			   ferait remonter ce compte, et c'est tout ce qu'on lui demande. */
			r.check("resoudreExecutable ne prend plus de chemin en second argument",
				resoudreExecutable.length, 1);
		});

		await cas(r, "run lance bien l'exécutable trouvé sur le PATH", async () => {
			/* LA MOITIÉ QUI MANQUERAIT à la vérification ci-dessus : `resoudre`
			   peut rendre le bon chemin et `run` en lancer un autre. L'appel
			   passe par le repli `cmd.exe` sous Windows (le lanceur est un
			   `.cmd`), donc ce cas éprouve AUSSI que ce repli aboutit. */
			const parPath = await run({ tool: "codex", args: [], stdin: "" }, { env });
			r.check("run lance bien l'exécutable trouvé sur le PATH",
				{ parPath: parPath.stdout, code: parPath.code },
				{ parPath: "DU-PATH", code: 0 });
		});

		/* ── LE STDIN, LES FLUX, LE CODE DE SORTIE ──
		   Lancés par un `codex`/`claude` du `PATH` qui EST node lui-même
		   (`poserNodeNu`) : le premier argument est donc le script à exécuter.
		   C'est ainsi que ces cas désignent l'exécutable depuis que le réglage
		   « chemin » n'existe plus — par le `PATH`, le seul chemin qui reste. */
		const envNode = envDe(poserNodeNu());
		const rapporteur = join(racine, "rapporteur.js");
		writeFileSync(rapporteur, [
			"let entree = '';",
			"process.stdin.on('data', d => { entree += d; });",
			"process.stdin.on('end', () => {",
			"  process.stdout.write('OUT:' + entree.length + ':' + process.argv.slice(2).join(','));",
			"  process.stderr.write('ERR:diagnostic');",
			"  process.exit(7);",
			"});",
		].join("\n"));

		await cas(r, "run écrit le stdin complet puis le ferme, et passe les arguments", async () => {
			/* Le stdin COMPLET, puis FERMÉ : sans le `end()`, le faux CLI
			   n'atteindrait jamais son `'end'` et `run` n'aboutirait pas — le cas
			   expirerait au lieu de rougir, mais il rougirait aussi sur la
			   LONGUEUR si une partie du prompt était perdue. */
			const res = await run(
				{ tool: "codex", args: [rapporteur, "-p", "--model", "opus"], stdin: "x".repeat(5000) },
				{ env: envNode },
			);
			r.check("run écrit le stdin complet puis le ferme, et passe les arguments",
				res.stdout, "OUT:5000:-p,--model,opus");
			r.check("stdout et stderr sont rendus séparés, avec le code de sortie",
				{ stderr: res.stderr, code: res.code }, { stderr: "ERR:diagnostic", code: 7 });
		});

		/* ── LES ARGUMENTS N'ATTEIGNENT PAS UN INTERPRÉTEUR ──
		   Le témoin sur disque est ce qui distingue « bien cité » de « cmd a
		   exécuté la charge » : l'`argv` seul ne le dirait pas. */
		await cas(r, "un argument à guillemets et métacaractères arrive intact, sans rien exécuter", async () => {
			const echo = poserFauxCli("codex", "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
			const temoin = join(racine, "pwn.txt");
			const charge = 'a" & echo PWN > ' + temoin.split("\\").join("/") + ' & "b';
			const argsCites = ["--model", charge, "", "espace et suite"];
			let recus = "(pas de sortie)";
			try {
				recus = (await run({ tool: "codex", args: argsCites, stdin: "" }, { env: envDe(echo.dossier) })).stdout;
			} catch (e) {
				recus = "EXCEPTION: " + (e && e.message ? e.message : String(e));
			}
			r.check("un argument à guillemets et métacaractères arrive intact, sans rien exécuter",
				{ argv: recus, temoin: existsSync(temoin) },
				{ argv: JSON.stringify(argsCites), temoin: false });
		});

		await cas(r, "les refus sont jugés avant tout lancement, et nommés", async () => {
			/* Les quatre refus que `run` prononce SANS rien lancer ni rien écrire.
			   « fichiers sans marqueur » est le mineur laissé ouvert par la revue
			   de la tâche 4 : sans marqueur rien n'est substitué, donc les pièces
			   jointes seraient écrites, aucun jeton ne pourrait les désigner, le
			   CLI partirait sans savoir qu'elles existent — et l'appel
			   RÉUSSIRAIT, en ignorant l'image, sans un mot. */
			const piece = { nom: "image-1.png", base64: Buffer.from("X").toString("base64") };
			r.check("les refus sont jugés avant tout lancement, et nommés",
				{
					horsListe: await nomDuRejet(run({ tool: "notepad", args: [], stdin: "" }, { env })),
					sautDeLigne: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur, "a\nb"], stdin: "" },
						{ env: envNode },
					)),
					fichiersSansMarqueur: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur], stdin: "", fichiers: [piece] },
						{ env: envNode },
					)),
					sortieSansMarqueur: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur], stdin: "", sortieFichier: "out.txt" },
						{ env: envNode },
					)),
				},
				{ horsListe: "refuse", sautDeLigne: "refuse", fichiersSansMarqueur: "refuse", sortieSansMarqueur: "refuse" });
		});

		await cas(r, "un exécutable absent rejette « introuvable », que le chemin vienne du PATH ou du réglage", async () => {
			/* C'est le rejet que le code partagé traduit en « CLI non installé »,
			   et un rejet ANONYME ferait chercher une panne ailleurs. Le réglage
			   est rendu TEL QUEL par `resoudreExecutable`, sans repli sur le
			   `PATH` : un repli lancerait une AUTRE installation que celle que
			   l'utilisateur a désignée, en silence. */
			r.check("un exécutable absent rejette « introuvable », que le chemin vienne du PATH ou du réglage",
				{
					pathVide: await nomDuRejet(run({ tool: "claude", args: [], stdin: "" }, { env: envDe(vide) })),
					regleFausse: await nomDuRejet(run(
						{ tool: "claude", args: [], stdin: "" },
						{ env: envDe(vide) },
					)),
				},
				{ pathVide: "introuvable", regleFausse: "introuvable" });
		});

		await cas(r, "un timeout tue le process et rejette « timeout »", async () => {
			const dormeur = join(racine, "dormeur.js");
			writeFileSync(dormeur, "setTimeout(() => { process.stdout.write('TROP TARD'); }, 5000);");
			r.check("un timeout tue le process et rejette « timeout »",
				await nomDuRejet(run(
					{ tool: "codex", args: [dormeur], stdin: "", timeoutMs: 300 },
					{ env: envNode },
				)),
				"timeout");
		});

		/* ── UN SEUL `run` PAR OUTIL, LE SUIVANT ATTEND, ET LE VERROU EST RELÂCHÉ ── */
		await cas(r, "un second run du même outil ATTEND le premier ; au-delà du délai il rejette « occupe » ; un autre outil passe", async () => {
			const lent = join(racine, "lent.js");
			writeFileSync(lent, "setTimeout(() => { process.stdout.write('FINI'); }, 500);");
			/* Une SONDE d'une seconde ne doit plus faire échouer la génération
			   lancée pendant qu'elle tourne (vécu le 2026-09-20 avec `agy
			   models`) : le second attend, puis passe. */
			const premier = run({ tool: "codex", args: [lent], stdin: "" }, { env: envNode });
			const second = await run({ tool: "codex", args: [rapporteur], stdin: "ok" }, { env: envNode, attenteVerrouMs: 3000 });
			/* Mais une génération qui dure plus que l'attente reste un `occupe`,
			   un nom, pas un silence. */
			const troisieme = run({ tool: "codex", args: [lent], stdin: "" }, { env: envNode });
			const impatient = await nomDuRejet(run({ tool: "codex", args: [rapporteur], stdin: "ok" }, { env: envNode, attenteVerrouMs: 50 }));
			/* Le verrou est par OUTIL : bloquer Codex pendant que Claude tourne
			   serait une limite inventée, et l'utilisateur ne peut de toute façon
			   lancer qu'une génération à la fois par fournisseur. */
			const autre = await run({ tool: "claude", args: [lent], stdin: "" }, { env: envNode });
			r.check("un second run du même outil ATTEND le premier ; au-delà du délai il rejette « occupe » ; un autre outil passe",
				{ premier: (await premier).stdout, second: second.stdout, impatient, troisieme: (await troisieme).stdout, autre: autre.stdout },
				{ premier: "FINI", second: "OUT:2:", impatient: "occupe", troisieme: "FINI", autre: "FINI" });
		});

		await cas(r, "le verrou est relâché sur TOUTES les issues, y compris un échec", async () => {
			/* UNE FUITE DU VERROU REND LE FOURNISSEUR INUTILISABLE jusqu'au
			   redémarrage de l'application, sans qu'aucun message ne dise
			   pourquoi. Les deux issues non-heureuses passent d'abord (un rejet
			   après acquisition du verrou, un CLI qui sort NON NUL), puis un appel
			   normal : s'il rend « occupe », le verrou a fui. */
			const echoue = join(racine, "echoue.js");
			writeFileSync(echoue, "process.exit(3);");
			const apresIntrouvable = await nomDuRejet(run(
				{ tool: "codex", args: [], stdin: "" },
				{ env: envDe(vide) },
			));
			const apresEchec = await run({ tool: "codex", args: [echoue], stdin: "" }, { env: envNode });
			const ensuite = await run({ tool: "codex", args: [rapporteur], stdin: "ok" }, { env: envNode });
			r.check("le verrou est relâché sur TOUTES les issues, y compris un échec",
				{ apresIntrouvable, codeEchec: apresEchec.code, ensuite: ensuite.stdout },
				{ apresIntrouvable: "introuvable", codeEchec: 3, ensuite: "OUT:2:" });
		});

		/* ── L'ANNULATION TUE L'ARBRE ── */
		await cas(r, "l'annulation tue l'ARBRE : le petit-enfant n'écrit jamais", async () => {
			/* `claude` et `codex` spawnent des enfants. Un `kill` sur le seul
			   premier process laisse la génération tourner APRÈS le clic sur
			   Stop : le fichier de sortie s'écrit, un process orphelin reste dans
			   le Gestionnaire des tâches, et la fenêtre, elle, est déjà revenue à
			   l'état repos. Le TÉMOIN est le seul moyen de le voir — un
			   petit-enfant qui écrit un fichier 1,5 s après son démarrage.

			   PAR LE FAUX `codex.cmd`, DONC PAR LE REPLI `cmd.exe`, et c'est
			   MESURÉ, pas supposé. Avec un enfant lancé DIRECTEMENT (Node par son
			   chemin), le `/T` ne se voit pas : libuv place un enfant non détaché
			   dans un Job Object qui meurt avec son parent, donc le petit-enfant
			   disparaît même sans `/T`, et le cas resterait VERT quoi qu'on casse.
			   `cmd.exe`, lui, lance son enfant sans job — c'est la forme d'une
			   installation npm sous Windows, le chemin PAR DÉFAUT pour
			   `claude.cmd`/`codex.cmd`, et celle où `killTree` est né. Mesuré sur
			   cette machine : sans `/T`, le témoin est écrit ; avec, jamais.

			   L'annulation part dès que le petit-enfant a confirmé être NÉ
			   (deux fichiers de rendez-vous), jamais après un délai fixe : un
			   délai trop court annulerait avant le `spawn`, et le cas passerait
			   pour une raison étrangère à ce qu'il éprouve. */
			const petit = join(racine, "petit.js");
			const temoin = join(racine, "petit-enfant.txt");
			const pret = join(racine, "pret.txt");
			writeFileSync(petit, [
				"const fs = require('fs');",
				"fs.writeFileSync(process.argv[2] + '.ne', 'ne');",
				"setTimeout(() => { fs.writeFileSync(process.argv[2], 'VIVANT'); }, 1500);",
			].join("\n"));
			const arbre = poserFauxCli("codex", [
				"const cp = require('child_process');",
				"const fs = require('fs');",
				"const a = process.argv.slice(2);",
				"cp.spawn(process.execPath, [a[0], a[1]], { stdio: 'ignore' });",
				"fs.writeFileSync(a[2], 'ok');",
				"setTimeout(() => { process.stdout.write('SURVIVANT'); }, 10000);",
			].join("\n"));

			const controleur = new AbortController();
			const promesse = run(
				{ tool: "codex", args: [petit, temoin, pret], stdin: "", signal: controleur.signal },
				{ env: envDe(arbre.dossier) },
			);
			const debut = Date.now();
			while (!existsSync(pret) && Date.now() - debut < 8000) await dodo(25);
			const debut2 = Date.now();
			while (!existsSync(temoin + ".ne") && Date.now() - debut2 < 8000) await dodo(25);
			const petitEnfantNe = existsSync(temoin + ".ne");
			controleur.abort();
			const rejet = await nomDuRejet(promesse);
			// Bien APRÈS l'instant où le petit-enfant aurait écrit.
			await dodo(2500);
			r.check("l'annulation tue l'ARBRE : le petit-enfant n'écrit jamais",
				{ petitEnfantNe, rejet, aEcrit: existsSync(temoin) },
				{ petitEnfantNe: true, rejet: "annule", aEcrit: false });
		});

		await cas(r, "un signal déjà abandonné rejette « annule » sans rien lancer", async () => {
			const c = new AbortController();
			c.abort();
			const marqueurDeVie = join(racine, "jamais.txt");
			const ecrivain = join(racine, "ecrivain.js");
			writeFileSync(ecrivain, "require('fs').writeFileSync(process.argv[2], 'LANCE');");
			const nom = await nomDuRejet(run(
				{ tool: "codex", args: [ecrivain, marqueurDeVie], stdin: "", signal: c.signal },
				{ env: envNode },
			));
			await dodo(150);
			r.check("un signal déjà abandonné rejette « annule » sans rien lancer",
				{ nom, lance: existsSync(marqueurDeVie) }, { nom: "annule", lance: false });
		});

		await cas(r, "un CLI qui sort sans lire son entrée ne tue pas le processus principal", async () => {
			/* Revue finale, I1. Un CLI qui sort AUSSITÔT (mauvaise
			   authentification) ferme son `stdin` pendant qu'on y écrit encore un
			   prompt de plusieurs Mo : l'`EPIPE`/`EOF` arrive de façon ASYNCHRONE
			   sur le flux, et un flux sans écouteur `error` lève une exception
			   NON RATTRAPÉE — mesuré : Node sort en 1 avec « Unhandled 'error'
			   event », c'est-à-dire que le processus PRINCIPAL de l'application
			   mourrait, la fenêtre avec. Sous la rupture (écouteur retiré), ce
			   cas ne rougit pas : il TUE le contrôle — c'est exactement le défaut. */
			const quitteur = join(racine, "quitteur.js");
			writeFileSync(quitteur, "process.exit(2);");
			const res = await run(
				{ tool: "codex", args: [quitteur], stdin: "x".repeat(4000000) },
				{ env: envNode },
			);
			r.check("un CLI qui sort sans lire son entrée ne tue pas le processus principal",
				{ code: res.code, vivant: true }, { code: 2, vivant: true });
		});

		await cas(r, "ollamaInstalle cherche ollama dans le PATH étendu, comme run", async () => {
			/* Revue finale, I2. La première écriture faisait un `spawn("ollama")`
			   nu sur le `PATH` donné : un Ollama installé par npm ou à un
			   emplacement personnalisé répondait « non installé » dans
			   l'APPLICATION seulement, là où le greffon (par `buildChildEnv`) le
			   voyait. `CODEX_INSTALL_DIR` est un dossier que SEUL le `PATH` étendu
			   ajoute ; `LOCALAPPDATA` est absent, donc la seconde sonde (le
			   dossier d'installation officiel) ne peut pas répondre à sa place. */
			const fauxOllama = poserFauxCli("ollama", "process.exit(0);");
			const envEtendu = { ...envDe(vide), CODEX_INSTALL_DIR: fauxOllama.dossier };
			r.check("ollamaInstalle cherche ollama dans le PATH étendu, comme run",
				{ parLeSeulPathEtendu: await ollamaInstalle(envEtendu), sansRien: await ollamaInstalle(envDe(vide)) },
				{ parLeSeulPathEtendu: true, sansRien: false });
		});

		/* ── `run` NE SE RÈGLE QU'UNE FOIS L'ARBRE MORT (ruling 15) ──

		   CE QUE CES DEUX CAS EMPÊCHENT. La première écriture de `lancer`
		   rejetait `annule` AUSSITÔT après avoir lancé `taskkill` : `run` se
		   réglait, son `finally` relâchait le verrou de l'outil, celui
		   d'`avecFichiers` effaçait le dossier temporaire — tout ça AVANT que
		   le système ait tué quoi que ce soit. Un petit-enfant pouvait encore
		   lire les pièces jointes pendant qu'on les effaçait, et un second `run`
		   du même outil partir pendant que l'arbre précédent écrivait encore. Le
		   témoin du cas « tue l'ARBRE » ne le voyait pas : il regardait 2,5 s
		   plus tard. Ici on regarde AU MOMENT où `run` se règle : l'enfant
		   doit déjà être mort (`process.kill(pid, 0)` échoue). */
		const estVivant = (pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch (e) {
				return false;
			}
		};
		const dormeur = join(racine, "dormeur-long.js");
		writeFileSync(dormeur, "setTimeout(() => { process.stdout.write('TROP TARD'); }, 8000);");

		await cas(r, "après un abandon, run ne se règle qu'une fois l'enfant fermé", async () => {
			/* L'ESPION voit le PID que `lancer` demande de tuer, et délègue au
			   vrai `tuerArbre` : la mort est réelle, seule l'observation est
			   ajoutée. `vivantAuReglement` est lu dans le `catch` de `run` —
			   c'est-à-dire à la microtâche où `run` se règle, pas après. */
			let pidVu = null;
			const c = new AbortController();
			const promesse = run(
				{ tool: "codex", args: [dormeur], stdin: "", signal: c.signal },
				{ env: envNode, tuer: async (pid) => { pidVu = pid; await tuerArbre(pid); } },
			);
			await dodo(400); // l'enfant tourne
			c.abort();
			let rejet = "(aucun rejet)";
			let vivantAuReglement = null;
			try {
				await promesse;
			} catch (e) {
				rejet = e.name;
				vivantAuReglement = typeof pidVu === "number" ? estVivant(pidVu) : "(pid inconnu)";
			}
			r.check("après un abandon, run ne se règle qu'une fois l'enfant fermé",
				{ rejet, vivantAuReglement }, { rejet: "annule", vivantAuReglement: false });
		});

		await cas(r, "après un abandon dont le kill échoue, run rejette quand même, nommé", async () => {
			/* LE FILET. `tuer` est un no-op (un `taskkill` qui échoue, un zombie) :
			   l'enfant ne fermera jamais de lui-même. `run` doit rejeter QUAND
			   MÊME, avec le motif, dans `delaiGardeMs` — et le DIRE dans la
			   console. Le délai est réglé PAR LA COUTURE, jamais en dur ici :
			   attendre les cinq secondes de production ne prouverait rien de
			   plus. L'enfant est tué pour de bon ensuite, par le vrai `tuerArbre`. */
			let pidVu = null;
			const avertissements = [];
			const warnAvant = console.warn;
			console.warn = (...a) => { avertissements.push(a.map(String).join(" ")); };
			const c = new AbortController();
			const promesse = run(
				{ tool: "codex", args: [dormeur], stdin: "", signal: c.signal },
				{ env: envNode, tuer: async (pid) => { pidVu = pid; }, delaiGardeMs: 300 },
			);
			await dodo(400);
			const debut = Date.now();
			c.abort();
			let rejet = "(aucun rejet)";
			try {
				await promesse;
			} catch (e) {
				rejet = e.name;
			}
			const duree = Date.now() - debut;
			console.warn = warnAvant;
			const encoreVivant = typeof pidVu === "number" && estVivant(pidVu);
			if (typeof pidVu === "number") await tuerArbre(pidVu);
			r.check("après un abandon dont le kill échoue, run rejette quand même, nommé",
				{
					rejet,
					dansLeDelai: duree < 3000,
					// L'enfant était bien VIVANT au règlement : c'est le filet qui a
					// rejeté, pas un `close` arrivé par hasard.
					encoreVivant,
					averti: avertissements.some(a => a.includes("n'a pas fermé") && a.includes("annule")),
				},
				{ rejet: "annule", dansLeDelai: true, encoreVivant: true, averti: true });
		});
	} finally {
		rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
	}
	r.done();
});

/**
 * STATIQUE — LE CANAL `process.run` JUGE LE NOM AVANT TOUT.
 *
 * `canaux.ts` importe `electron` : aucun harnais ne peut le charger, et c'est
 * pourquoi cette assertion lit sa SOURCE, comme celle des canaux `fichiers.*`
 * et celle de la garde de la clé `ai` (`check:electron-reglages`).
 *
 * Ce qu'elle empêche : que la liste blanche glisse APRÈS le lancement, et
 * surtout que le CHEMIN de l'exécutable vienne un jour de la fenêtre — auquel
 * cas la liste de noms ne séparerait plus rien, le rendu envoyant le chemin
 * qu'il veut. Il n'a plus de chemin du tout à lui donner depuis le
 * 2026-09-17 : le réglage qui en portait un a été retiré, et `run` résout
 * toujours le NOM sur le `PATH`.
 */
{
	const r = makeReporter("Électron — le canal process.run (statique)");
	const source = readFileSync("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.processusRun,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("estOutilAutorise(") : -1;
	const lancement = corps ? corps.indexOf("await run(") : -1;
	r.check("le canal process.run juge le NOM (estOutilAutorise) AVANT de lancer",
		{ trouve: corps !== null, garde: garde >= 0, avantLancement: garde >= 0 && lancement > garde },
		{ trouve: true, garde: true, avantLancement: true });
	/* LE CLIQUET, ET IL A CHANGÉ DE SENS. Ces deux assertions vérifiaient que le
	   canal lisait le chemin de l'exécutable dans le MAGASIN du principal (et
	   le rejugeait contre le périmètre du jour) plutôt que de l'accepter de
	   l'appel IPC. Le réglage a été retiré : il n'y a plus de chemin à lire, et
	   ce qu'il faut tenir désormais est qu'aucun n'en revienne — ni du rendu,
	   ni des réglages. Un `s.chemin` accepté du rendu, ou une option `chemin`
	   passée à `run`, rouvrirait d'un coup la porte que la liste blanche de
	   NOMS existe pour tenir fermée. */
	r.check("aucun chemin d'exécutable n'atteint run : ni du rendu, ni d'un réglage",
		{
			pasDeCheminRecu: corps !== null && !/s\.chemin/.test(corps),
			pasDOptionChemin: corps !== null && !/chemin\s*:/.test(corps.slice(corps.indexOf("await run("))),
			plusDeLectureDeReglage: !source.includes("cheminCliRegle("),
		},
		{ pasDeCheminRecu: true, pasDOptionChemin: true, plusDeLectureDeReglage: true });
	r.done();
}

/* ── LA LISTE DES MODÈLES EN DIRECT (2026-09-23) ──
   `surveillerCachesCli` sur de VRAIS fichiers, dans un faux dossier
   personnel. Ce qu'il empêche : un menu de modèles qui garde un catalogue
   périmé jusqu'au prochain clic, alors que Claude Code vient de le
   retélécharger ; et, à l'inverse, un avis par écriture de `~/.claude.json`
   (réécrit à chaque événement d'une session), ou pour un fichier voisin. */
await withSrcModule("apps/windows/electron/surveillant-cli.ts", async ({ surveillerCachesCli }) => {
	const r = makeReporter("Électron — les modèles des CLI en direct");
	const racine = mkdtempSync(join(tmpdir(), "quiz-caches-cli-"));
	const maison = join(racine, "maison");
	const catalogues = join(maison, ".claude", "cache", "model-catalog");
	mkdirSync(catalogues, { recursive: true });
	mkdirSync(join(maison, ".codex"), { recursive: true });
	writeFileSync(join(maison, ".claude.json"), "{}");
	writeFileSync(join(maison, ".codex", "models_cache.json"), "{}");
	const env = { USERPROFILE: maison, HOME: maison };
	const vus = [];
	const pause = (ms) => new Promise(res => setTimeout(res, ms));
	/** Attend qu'au moins `n` avis soient arrivés, puis laisse passer une
	    fenêtre de débounce entière pour voir s'il en vient un de trop. */
	const attendre = async (n) => {
		for (let i = 0; i < 60 && vus.length < n; i++) await pause(50);
		await pause(400);
	};
	let arreter = null;
	try {
		await cas(r, "surveillerCachesCli", async () => {
			arreter = surveillerCachesCli(tool => vus.push(tool), env, 150);
			await pause(700); // le temps que chokidar soit prêt

			writeFileSync(join(catalogues, "org-compte-cc.json"), '{"fetchedAt":1}');
			await attendre(1);
			r.check("un catalogue de Claude Code réécrit prévient « claude »", vus.splice(0), ["claude"]);

			writeFileSync(join(maison, ".codex", "models_cache.json"), '{"models":[]}');
			await attendre(1);
			r.check("le cache de Codex réécrit prévient « codex »", vus.splice(0), ["codex"]);

			for (let i = 0; i < 4; i++) { writeFileSync(join(maison, ".claude.json"), `{"n":${i}}`); await pause(20); }
			await attendre(1);
			r.check("quatre écritures rapprochées de ~/.claude.json : UN seul avis", vus.splice(0), ["claude"]);

			writeFileSync(join(maison, "notes.txt"), "rien");
			writeFileSync(join(catalogues, "autre.json"), "{}");
			await attendre(1);
			r.check("un fichier voisin, ou hors motif « -cc.json », ne prévient personne", vus.splice(0), []);

			await arreter();
			arreter = null;
			writeFileSync(join(maison, ".claude.json"), '{"apres":true}');
			await attendre(1);
			r.check("une fois arrêté, plus aucun avis", vus.splice(0), []);
		});
	} finally {
		if (arreter) await arreter();
		rmSync(racine, { recursive: true, force: true });
	}
	r.done();
});

/* ── AUCUNE CONSOLE VISIBLE, JAMAIS (2026-09-27) ──
   CE QU'IL EMPÊCHE. Un lancement de process du principal sans
   `windowsHide: true` ouvre une console visible à l'écran : c'est ce que
   `demarrerOllama` faisait sur son repli `ollama serve` (détaché, sans
   `windowsHide`). Le contrôle lit le SOURCE de TOUT `apps/windows/electron/`
   (hors `python/`, qui a son propre contrôle) et juge chaque appel de
   `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync` et
   `fork` :

   1. son objet d'options porte `windowsHide: true` EN TOUTES LETTRES, sans
      décomposition (`...x`) APRÈS lui au même niveau, qui pourrait le
      rabattre ; ou bien son dernier argument est l'identifiant `options`
      NU, et CHAQUE `const options = {…}` du fichier porte alors
      `windowsHide: true` sans décomposition. Mentionner `options` ailleurs
      dans l'appel ne suffit plus (`{ ...options, windowsHide: false }`
      passait) ;
   2. `windowsHide: false` est refusé partout, sauf dans la liste nommée
      ci-dessous ;
   3. le module n'est atteint que par un import NOMMÉ (`import * as cp`,
      `require("child_process")` échapperaient au motif).

   La liste des exceptions est un CLIQUET : chaque entrée nomme son fichier
   et le texte EXACT de l'appel (blancs normalisés, commentaires retirés) :
   un site qui change de forme retombe sous la règle générale, et une entrée
   qui ne correspond plus à rien fait échouer le contrôle.

   Ce contrôle ne voit pas les descendants qu'un CLI lance LUI-MÊME : la
   console de l'ouverture des réglages venait de là (`agy --bg-updater`, voir
   `ENV_SANS_MAJ_AGY` dans `process.ts`). Ce cas est tenu par le groupe
   suivant, sur `environnementEnfant`.

   DISCRIMINANCE ÉPROUVÉE À LA MAIN (2026-09-27) : `windowsHide: false` sur un
   site, `{ ...options, windowsHide: false }`, un `windowsHide` retiré de
   `const options`, un `execFile` de `partage.ts` sans l'option, un
   `import * as cp` : chacun fait rougir ce groupe ; restaurés, il reverdit. */
{
	const r = makeReporter("Électron — aucun process du principal lancé sans windowsHide: true");
	const RACINE = "apps/windows/electron";

	/** Fichiers source du principal, `python/` exclu. */
	function fichiersSource(dossier) {
		const sortie = [];
		for (const e of readdirSync(dossier, { withFileTypes: true })) {
			const chemin = dossier + "/" + e.name;
			if (e.isDirectory()) {
				if (chemin !== RACINE + "/python") sortie.push(...fichiersSource(chemin));
			} else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) {
				sortie.push(chemin);
			}
		}
		return sortie;
	}

	/* Les exceptions VOLONTAIRES, chacune justifiée sur place dans son fichier. */
	const EXCEPTIONS = [
		/* Le terminal d'installation/connexion : une fenêtre que l'utilisateur
		   DOIT voir. `windowsHide` y redonnerait un `conhost` sans fenêtre
		   (mesuré, en-tête d'`argumentsTerminal`). */
		{ fichier: RACINE + "/process.ts", appel: 'spawn("powershell.exe", argumentsTerminal(titre, script), { stdio: "ignore" })' },
		/* La fenêtre de mise à jour : l'application ELLE-MÊME (un exécutable
		   graphique Electron, sans console), qui doit se montrer. */
		{ fichier: RACINE + "/fenetre-maj.ts", appel: 'spawn(exeLie, [ DRAPEAU_FENETRE_MAJ, version, langue, `--user-data-dir=${join(dirname(exeLie), "profil")}`, ], { detached: true, windowsHide: false, stdio: "ignore" })' },
	];

	/** Commentaires retirés : la prose de ces fichiers nomme d'anciens appels
	    fautifs, qui ne sont pas du code. Les `//` ne sont pris que précédés
	    d'un blanc ou en début de ligne : `https://` dans une chaîne n'est pas
	    un commentaire. */
	function sansCommentaires(texte) {
		return texte
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
	}

	/** Le texte de l'appel entier, de son nom à sa parenthèse fermante. */
	function extraireAppel(source, debutNom, indiceOuvrante) {
		let profondeur = 0;
		for (let i = indiceOuvrante; i < source.length; i++) {
			if (source[i] === "(") profondeur++;
			else if (source[i] === ")") {
				profondeur--;
				if (profondeur === 0) return source.slice(debutNom, i + 1);
			}
		}
		return null;
	}

	/** Une décomposition `...` au MÊME niveau, après `windowsHide`, pourrait le
	    rabattre. Une décomposition imbriquée (`env: { ...x }`) ne le peut pas. */
	function decomposeApres(texte, indice) {
		let profondeur = 0;
		for (let i = indice; i < texte.length; i++) {
			const c = texte[i];
			if (c === "{" || c === "[" || c === "(") profondeur++;
			else if (c === "}" || c === "]" || c === ")") {
				if (profondeur === 0) return false;
				profondeur--;
			} else if (profondeur === 0 && texte.startsWith("...", i)) return true;
		}
		return false;
	}

	/** `windowsHide: true` présent, et rien après lui ne peut le rabattre. */
	function porteWindowsHide(texte) {
		const m = /windowsHide:\s*true\b/.exec(texte);
		return !!m && !decomposeApres(texte, m.index + m[0].length);
	}

	const normaliser = t => t.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");

	const sites = [];
	const echappees = [];
	for (const fichier of fichiersSource(RACINE)) {
		const source = sansCommentaires(readFileSync(fichier, "utf-8"));
		if (/\bimport\s*\*\s*as\s+\w+\s+from\s+["'](node:)?child_process["']/.test(source)
			|| /\brequire\(\s*["'](node:)?child_process["']\s*\)/.test(source)
			|| /\bimport\(\s*["'](node:)?child_process["']\s*\)/.test(source)) {
			echappees.push(fichier);
		}
		const definitionsOptions = source.match(/const options = \{[^}]*\}/g) || [];
		const motif = /(?<![.\w$])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g;
		for (let m; (m = motif.exec(source)); ) {
			const appel = extraireAppel(source, m.index, m.index + m[0].length - 1);
			if (appel) sites.push({ fichier, appel: normaliser(appel), definitionsOptions });
		}
	}
	r.check("aucun fichier n'atteint child_process autrement que par un import nommé (le motif ne verrait pas `cp.spawn`)",
		echappees, []);
	r.check("au moins dix sites de lancement trouvés (le motif n'a pas divergé du code)",
		sites.length >= 10, true);

	const estException = s => EXCEPTIONS.some(e => e.fichier === s.fichier && normaliser(e.appel) === s.appel);
	const fautifs = sites.filter(s => {
		if (estException(s)) return false;
		if (/windowsHide:\s*false\b/.test(s.appel)) return true;
		if (porteWindowsHide(s.appel)) return false;
		// L'identifiant `options` NU en dernier argument (seul, ou
		// `Object.assign({…}, options)`), et CHAQUE `options` du fichier
		// porte `windowsHide: true`.
		const parOptions = /, options,?\)$/.test(s.appel) || /, Object\.assign\(\{[^}]*\}, options\),?\)$/.test(s.appel);
		return !(parOptions && s.definitionsOptions.length > 0 && s.definitionsOptions.every(porteWindowsHide));
	}).map(s => s.fichier + " : " + s.appel.slice(0, 160));
	r.check("chaque lancement porte `windowsHide: true` (en toutes lettres, ou par un `options` nu qui le porte), jamais `windowsHide: false` hors des exceptions nommées",
		fautifs, []);

	const orphelines = EXCEPTIONS.filter(e => !sites.some(s => s.fichier === e.fichier && s.appel === normaliser(e.appel))).map(e => e.fichier);
	r.check("chaque exception nommée correspond à un site qui existe VRAIMENT (un cliquet qui ne couvre rien serait un mensonge)",
		orphelines, []);

	r.done();
}

/* ── LA MISE À JOUR D'ANTIGRAVITY, COUPÉE POUR TOUT LANCEMENT (2026-09-27) ──
   CE QU'IL EMPÊCHE. `agy`, lancé par l'application, déclenche sa propre
   vérification de mise à jour (`agy --bg-updater`), qui lance un `agy
   --version` avec une console NEUVE, confiée par Windows 11 à Windows
   Terminal : une fenêtre visible. Aucune option de `spawn` n'y peut rien ;
   seule `AGY_CLI_DISABLE_AUTO_UPDATE=true` dans l'environnement de l'enfant
   la coupe (tracé et prouvé sur la machine réelle, voir `ENV_SANS_MAJ_AGY`).
   La valeur exacte compte : `1` et `TRUE` laissent la console s'ouvrir. */
await withSrcModule("apps/windows/electron/process.ts", async ({ environnementEnfant }) => {
	const r = makeReporter("Électron — la mise à jour d'Antigravity coupée dans l'environnement de chaque CLI");
	const env = environnementEnfant({ PATH: "C:\\x", AGY_CLI_DISABLE_AUTO_UPDATE: "0" });
	r.check("`environnementEnfant` pose AGY_CLI_DISABLE_AUTO_UPDATE=true (minuscules), même si l'environnement hérité dit autre chose",
		env.AGY_CLI_DISABLE_AUTO_UPDATE, "true");
	r.done();
});
