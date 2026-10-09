/**
 * LE PARTAGE, côté principal (`apps/windows/electron/partage.ts`), et la
 * CITATION PowerShell du principal (`citerPs`, `process.ts`).
 *
 * Ce qu'il empêche :
 * - un nom venu de la fenêtre qui serait un CHEMIN (`..\..\Startup\x.zip`)
 *   et écrirait hors du dossier temporaire ; une extension hors liste
 *   (`.bat`) ; un contenu vide ou démesuré ;
 * - un script Discord qui dépendrait de ce que la fenêtre envoie : il est
 *   CONSTANT, le chemin passe par une variable d'environnement ;
 * - un partage lancé en boucle (le verrou) ;
 * - une apostrophe TYPOGRAPHIQUE (’ ‘ ‚ ‛) qui fermerait une chaîne
 *   PowerShell : PowerShell les tient toutes pour des apostrophes, et ne
 *   doubler que l'ASCII laissait « l’an » faire exécuter la suite (mesuré le
 *   2026-09-25). Sous Windows, les cas sont rejoués sur le VRAI powershell.exe.
 *     npm run check:partage
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/partage.ts", ({ nomPartage, octetsPartage, scriptPartageNatif, VARIABLES_NATIF, creerVerrou, outilSysteme, POWERSHELL_PARTAGE, temporairesPerimes, VARIABLE_FICHIER, TAILLE_MAX_PARTAGE }) => {
	const r = makeReporter("Partage — noms, contenus, script, verrou");
	const sys = { SystemRoot: String.raw`D:\Win` };
	r.check("PowerShell and taskkill are launched by their FULL System32 path (SystemRoot, else C:\\Windows), never through PATH",
		[POWERSHELL_PARTAGE(sys), outilSysteme("taskkill.exe", sys), outilSysteme("taskkill.exe", {})],
		[String.raw`D:\Win\System32\WindowsPowerShell\v1.0\powershell.exe`, String.raw`D:\Win\System32\taskkill.exe`, String.raw`C:\Windows\System32\taskkill.exe`]);
	const src = readFileSync(new URL("../apps/windows/electron/partage.ts", import.meta.url), "utf8");
	r.check("partage.ts never starts a bare powershell.exe or taskkill", [/(spawn|lancer)\(\s*"(powershell|taskkill)/.test(src), /(spawn|lancer)\(\s*POWERSHELL_PARTAGE\(\)/.test(src), /spawn\(outilSysteme\("taskkill\.exe"\)/.test(src)], [false, true, true]);
	for (const f of ["appareil.ts", "connexion-limitee.ts"]) {
		const s2 = readFileSync(new URL("../apps/windows/electron/" + f, import.meta.url), "utf8");
		r.check(f + " launches PowerShell by its full System32 path", [/execFile\(\s*"powershell/.test(s2), /execFile\(\s*POWERSHELL_PARTAGE\(\)/.test(s2)], [false, true]);
	}
	r.check("un nom de zip ordinaire passe tel quel", nomPartage("XTI301 - Écosystème Python.zip"), "XTI301 - Écosystème Python.zip");
	r.check("un .md passe", nomPartage("CM1.md"), "CM1.md");
	r.check("une apostrophe typographique reste dans le NOM (le script ne le voit jamais)", nomPartage("L’an.md"), "L’an.md");
	r.check("les séparateurs deviennent des tirets : un nom, jamais un chemin",
		nomPartage(String.raw`..\..\Startup\x.zip`), "-..-Startup-x.zip");
	r.check("un séparateur « / » aussi", nomPartage("a/b.zip"), "a-b.zip");
	r.check("une extension hors liste est refusée", nomPartage("x.bat"), null);
	r.check("l'extension compte même en majuscules", nomPartage("x.ZIP"), "x.ZIP");
	r.check("sans extension, refusé", nomPartage("zip"), null);
	r.check("un point final ne cache pas une autre extension", nomPartage("x.bat."), null);
	r.check("a Windows device name is refused whatever the extension", ["CON.zip", "nul.md", "Com1.zip", "con.txt.md", "LPT3 .md"].map(nomPartage), [null, null, null, null, null]);
	r.check("a name that only STARTS like a device name is kept", [nomPartage("console.md"), nomPartage("com10.zip")], ["console.md", "com10.zip"]);
	r.check("pas une chaîne, refusé", nomPartage(42), null);
	r.check("vide, refusé", nomPartage(""), null);
	r.check("trop long, refusé", nomPartage("a".repeat(200) + ".zip"), null);
	r.check("des octets ordinaires passent", octetsPartage(new Uint8Array([1, 2]))?.length, 2);
	r.check("vide, refusé", octetsPartage(new Uint8Array(0)), null);
	r.check("au-delà de la borne, refusé", octetsPartage(new Uint8Array(TAILLE_MAX_PARTAGE + 1)), null);
	r.check("un tableau ordinaire n'est pas un contenu", octetsPartage([1, 2]), null);
	r.check("the main process bound is the window's bound (16 MB, `SHARE_MAX_BYTES`)", TAILLE_MAX_PARTAGE, 16 * 1024 * 1024);

	/* The native Share panel (the only script of the share): constant, every
	   input read from the environment, and never a value spliced in. */
	const n = scriptPartageNatif();
	r.check("native share: the script takes no argument", scriptPartageNatif.length, 0);
	r.check("native share: title, text, file and point are read from the environment",
		Object.values(VARIABLES_NATIF).every(v => n.includes("$env:" + v)), true);
	r.check("native share: the file variable is the one the main process sets for Discord", VARIABLES_NATIF.fichier, VARIABLE_FICHIER);
	r.check("native share: two calls give the same script (nothing per share inside)", scriptPartageNatif() === n, true);
	r.check("native share: the point is parsed as integers, never run", n.includes("TryParse($env:NEO_QUIZ_PARTAGE_X") && n.includes("TryParse($env:NEO_QUIZ_PARTAGE_Y"), true);
	r.check("native share: no Invoke-Expression, no Start-Process, no iex", /Invoke-Expression|Start-Process|iex/i.test(n), false);

	let t = 0;
	const v = creerVerrou(1000, 0, () => t);
	const j1 = v.prendre();
	r.check("le premier partage prend le verrou", j1 !== null, true);
	r.check("un second, pendant le premier, est refusé", v.prendre(), null);
	v.rendre(j1);
	const j2 = v.prendre();
	r.check("rendu, le verrou se reprend", j2 !== null, true);
	t = 999;
	r.check("toujours tenu juste avant le délai", v.prendre(), null);
	t = 1000;
	const j3 = v.prendre();
	r.check("retombé de lui-même au délai : un processus bloqué ne bloque pas tout", j3 !== null, true);
	v.rendre(j2);
	r.check("l'ancien processus qui finit ne libère pas le verrou du suivant", v.prendre(), null);
	v.rendre(j3);
	r.check("le suivant, lui, le rend", v.prendre() !== null, true);

	let u = 0;
	const w = creerVerrou(1000, 2000, () => u);
	w.rendre(w.prendre());
	u = 1999;
	r.check("rendu mais trop tôt : l'intervalle minimal refuse", w.prendre(), null);
	u = 2000;
	r.check("l'intervalle écoulé, le partage repart", w.prendre() !== null, true);

	const maintenant = 10 * 60 * 1000 + 5000;
	r.check("le ménage n'efface que NOS dossiers périmés", temporairesPerimes([
		{ nom: "neo-quiz-partage-vieux", mtimeMs: 0, dossier: true },
		{ nom: "neo-quiz-partage-recent", mtimeMs: maintenant - 1000, dossier: true },
		{ nom: "autre-appli-vieux", mtimeMs: 0, dossier: true },
		{ nom: "neo-quiz-partage-lien", mtimeMs: 0, dossier: false },
	], maintenant), ["neo-quiz-partage-vieux"]);
	r.done();
});

/* LES ARGUMENTS D'UN CLI venus de la fenêtre (`gabarits-cli.ts`, revue de
   sécurité du 2026-09-25) : les appels RÉELS de `ai-client.ts` et
   `ai-providers.ts` passent, et une seule option de plus les fait refuser. */
await withSrcModule(["apps/windows/electron/gabarits-cli.ts", "src/host/claude-outils.ts"], ({ argumentsAutorises, argumentsAvecOutils, argumentsAppServer, ARGS_CODEX_APP_SERVER }, { ARGS_OUTILS_CLAUDE }) => {
	const r = makeReporter("Arguments des CLI (liste blanche)");
	const m = "0123456789abcdef0123456789abcdef";
	const j = (nom) => `{{nq-${m}:${nom}}}`;
	const claude = (modele, outils) => ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", modele, "--tools", outils, "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config"];
	const codex = (rapide, images) => ["exec", "--json", "-m", "gpt-5.1-codex", "-c", "model_reasoning_effort=high",
		...(rapide ? ["-c", "service_tier=priority"] : []),
		"-s", "read-only", "--skip-git-repo-check", "--ignore-user-config", "-C", j("home"), "-o", j("sortie"),
		...Array.from({ length: images }, (_, i) => ["-i", j("fichier:" + (i + 1))]).flat()];
	const agy = ["--input-format", "stream-json", "--output-format", "stream-json"];

	r.check("codex app-server (banked resets): the one form is the single word, for codex only",
		[ARGS_CODEX_APP_SERVER.length, argumentsAppServer("codex", ["app-server"]), argumentsAppServer("claude", ["app-server"]), argumentsAppServer("agy", ["app-server"])], [1, true, false, false]);
	r.check("codex app-server: anything added, removed or moved is refused",
		[["app-server", "--listen"], ["app-server", "-c", "x=1"], [], ["--app-server"], ["app-server "], ["App-Server"], "app-server", null].map(a => argumentsAppServer("codex", a)), [false, false, false, false, false, false, false, false]);
	r.check("codex app-server is NOT a form the window can launch through process.run (it would own the app-server stdin)",
		[argumentsAutorises("codex", ["app-server"], m), argumentsAutorises("codex", ["app-server"], undefined), argumentsAutorises("claude", ["app-server"], m)], [false, false, false]);
	r.check("les sondes de version passent", ["claude", "codex", "agy"].map(o => argumentsAutorises(o, ["--version"], undefined)), [true, true, true]);
	r.check("agy models passe", argumentsAutorises("agy", ["models"], undefined), true);
	r.check("the update of Claude Code and Codex passes, as the bare word", [argumentsAutorises("claude", ["update"], undefined), argumentsAutorises("codex", ["update"], undefined)], [true, true]);
	r.check("no update for agy, and no update with anything added", [argumentsAutorises("agy", ["update"], undefined), argumentsAutorises("claude", ["update", "--force"], undefined), argumentsAutorises("codex", ["update", "-c", "x=1"], undefined), argumentsAutorises("claude", ["upgrade"], undefined)], [false, false, false, false]);
	r.check("agy génération, sans et avec modèle", [argumentsAutorises("agy", agy, m), argumentsAutorises("agy", [...agy, "--model", "gemini-2.5-pro"], m)], [true, true]);
	r.check("claude sans outil, et avec Read pour les images", [argumentsAutorises("claude", claude("claude-opus-4-1", ""), m), argumentsAutorises("claude", claude("opus[1m]", "Read"), m)], [true, true]);
	r.check("codex, rapide ou non, avec 0 à 3 images", [argumentsAutorises("codex", codex(false, 0), m), argumentsAutorises("codex", codex(true, 1), m), argumentsAutorises("codex", codex(false, 3), m)], [true, true, true]);

	// A remote request's model reaches the CLI ONLY in the model slot of the fixed shape: ids of a PC's list pass, an option-looking one never does.
	r.check("claude: the model ids a PC offers pass in the model slot", ["opus", "sonnet", "claude-opus-5:1", "claude-sonnet-4.5"].map(x => argumentsAutorises("claude", claude(x, ""), m)), [true, true, true, true]);
	r.check("claude: a model that is an option, a flag or has a space is refused", ["--dangerously-skip-permissions", "-p", "opus --mcp-config", "a b", "%x"].map(x => argumentsAutorises("claude", claude(x, ""), m)), [false, false, false, false, false]);
	r.check("claude + --dangerously-skip-permissions : refusé", argumentsAutorises("claude", [...claude("sonnet", ""), "--dangerously-skip-permissions"], m), false);
	r.check("claude: the old one-object json output, or the stream without its partial messages: refused",
		[argumentsAutorises("claude", ["-p", "--output-format", "json", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config"], m),
			argumentsAutorises("claude", claude("sonnet", "").filter(x => x !== "--include-partial-messages"), m)], [false, false]);
	r.check("claude without --strict-mcp-config (connectors listed): refused", argumentsAutorises("claude", claude("sonnet", "").filter(x => x !== "--strict-mcp-config"), m), false);
	r.check("claude + --strict-mcp-config + --mcp-config: refused", argumentsAutorises("claude", [...claude("sonnet", ""), "--mcp-config", "{}"], m), false);
	r.check("claude + --mcp-config : refusé", argumentsAutorises("claude", [...claude("sonnet", ""), "--mcp-config", "{}"], m), false);
	r.check("claude avec un outil autre que Read : refusé", argumentsAutorises("claude", claude("sonnet", "Bash"), m), false);
	r.check("claude, un modèle qui est une option : refusé", argumentsAutorises("claude", claude("--dangerously-skip-permissions", ""), m), false);
	r.check("codex + --dangerously-bypass-approvals-and-sandbox : refusé", argumentsAutorises("codex", [...codex(false, 0), "--dangerously-bypass-approvals-and-sandbox"], m), false);
	r.check("codex en bac à sable danger-full-access : refusé", argumentsAutorises("codex", codex(false, 0).map(a => a === "read-only" ? "danger-full-access" : a), m), false);
	r.check("codex, un -c arbitraire à la place de l'effort : refusé", argumentsAutorises("codex", codex(false, 0).map(a => a === "model_reasoning_effort=high" ? "sandbox_mode=danger-full-access" : a), m), false);
	r.check("codex, un jeton d'un AUTRE marqueur : refusé", argumentsAutorises("codex", codex(false, 0), "f".repeat(32)), false);
	r.check("codex, une image hors ordre : refusé", argumentsAutorises("codex", [...codex(false, 0), "-i", j("fichier:2")], m), false);
	r.check("codex, un modèle avec % : refusé (repli cmd.exe)", argumentsAutorises("codex", codex(false, 0).map(a => a === "gpt-5.1-codex" ? "a%CMDCMDLINE%" : a), m), false);
	/* The composer's effort (2026-10-08): `--effort <level>` right after the
	   model, one of the five levels of `claude --help`, nothing else. */
	const avecEffort = (niveau, outils = "") => { const a = claude("opus", outils); a.splice(7, 0, "--effort", niveau); return a; };
	r.check("claude: each documented effort level passes, with or without Read",
		[...["low", "medium", "high", "xhigh", "max"].map(n => argumentsAutorises("claude", avecEffort(n), m)), argumentsAutorises("claude", avecEffort("high", "Read"), m)], [true, true, true, true, true, true]);
	r.check("claude: an unknown level, an option or an empty level in the effort slot is refused",
		["ultracode", "--dangerously-skip-permissions", "", "high --mcp-config", "HIGH"].map(n => argumentsAutorises("claude", avecEffort(n), m)), [false, false, false, false, false]);
	r.check("claude: --effort elsewhere than after the model, twice, or without its level, is refused", [
		argumentsAutorises("claude", [...claude("opus", ""), "--effort", "high"], m),
		argumentsAutorises("claude", (() => { const a = avecEffort("high"); a.splice(9, 0, "--effort", "low"); return a; })(), m),
		argumentsAutorises("claude", avecEffort("high").filter((x, i) => i !== 8), m),
	], [false, false, false]);
	/* READ-ONLY TOOLS IN A TRUSTED FOLDER (2026-10-09): exactly one tail of
	   options, measured on Claude Code 2.1.296; anything that would give the
	   model a command, a write, a server or a bypass is refused. */
	const FIN_OUTILS = ["--tools", "Read,Grep,Glob", "--allowedTools", "Read(./**)",
		"--disallowedTools", "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,WebFetch,WebSearch,mcp__*",
		"--permission-mode", "dontAsk", "--permission-prompts", "none", "--restricted", "--no-session-persistence",
		"--setting-sources", "", "--settings", "{\"disableAllHooks\":true}", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"];
	const outils = (modele = "haiku", effort = null, pieces = false) => ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", modele,
		...(effort ? ["--effort", effort] : []), ...FIN_OUTILS, ...(pieces ? ["--add-dir", j("pieces")] : [])];
	const remplacer = (a, de, vers) => a.map(x => (x === de ? vers : x));
	r.check("claude with read-only tools: accepted with and without effort, with the attachments folder",
		[argumentsAvecOutils("claude", outils(), m), argumentsAvecOutils("claude", outils("opus", "high"), m), argumentsAvecOutils("claude", outils("sonnet", null, true), m),
			argumentsAutorises("claude", outils(), m), argumentsAutorises("claude", outils("opus", "max", true), m)], [true, true, true, true, true]);
	r.check("claude with tools: the plain forms are NOT the tools form (they run in the home folder, no folder judged)",
		[argumentsAvecOutils("claude", claude("sonnet", ""), m), argumentsAvecOutils("claude", claude("sonnet", "Read"), m), argumentsAvecOutils("codex", outils(), m)], [false, false, false]);
	r.check("claude with tools: Bash, Write or WebFetch allowed, or Bash no longer denied, is refused", [
		remplacer(outils(), "Read,Grep,Glob", "Read,Grep,Glob,Bash"),
		remplacer(outils(), "Read,Grep,Glob", "default"),
		remplacer(outils(), "Read(./**)", "Read"),
		remplacer(outils(), "Read(./**)", "Bash"),
		remplacer(outils(), "Read(./**)", "Read(./**),WebFetch"),
		remplacer(outils(), "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,WebFetch,WebSearch,mcp__*", "Write,Edit"),
	].map(a => argumentsAutorises("claude", a, m)), [false, false, false, false, false, false]);
	r.check("claude with tools: a permission bypass in any form is refused", [
		remplacer(outils(), "dontAsk", "bypassPermissions"),
		remplacer(outils(), "dontAsk", "acceptEdits"),
		remplacer(outils(), "dontAsk", "auto"),
		remplacer(outils(), "none", "host"),
		[...outils(), "--dangerously-skip-permissions"],
		[...outils(), "--allow-dangerously-skip-permissions"],
		outils().filter(x => x !== "--restricted"),
	].map(a => argumentsAutorises("claude", a, m)), [false, false, false, false, false, false, false]);
	r.check("claude with tools: an MCP configuration that is not empty, or no strict MCP, is refused", [
		remplacer(outils(), "{\"mcpServers\":{}}", "{\"mcpServers\":{\"x\":{\"command\":\"calc.exe\"}}}"),
		remplacer(outils(), "{\"mcpServers\":{}}", "C:/x/mcp.json"),
		outils().filter(x => x !== "--strict-mcp-config"),
		[...outils(), "--mcp-config", "{}"],
	].map(a => argumentsAutorises("claude", a, m)), [false, false, false, false]);
	r.check("claude with tools: settings or setting sources that let hooks run are refused", [
		remplacer(outils(), "{\"disableAllHooks\":true}", "{\"disableAllHooks\":false}"),
		remplacer(outils(), "{\"disableAllHooks\":true}", "{\"hooks\":{}}"),
		(() => { const a = outils(); a[a.indexOf("--setting-sources") + 1] = "project"; return a; })(),
	].map(a => argumentsAutorises("claude", a, m)), [false, false, false]);
	r.check("claude with tools: --add-dir only on the attachments token of THIS call, never a chosen folder", [
		[...outils(), "--add-dir", "C:/Users"],
		[...outils(), "--add-dir", `{{nq-${"f".repeat(32)}:pieces}}`],
		[...outils(), "--add-dir", j("home")],
		[...outils(), "--add-dir", j("pieces"), "--add-dir", j("pieces")],
	].map(a => argumentsAutorises("claude", a, m)), [false, false, false, false]);
	r.check("the page's list of tools options (src/host/claude-outils.ts) is exactly the form accepted here",
		argumentsAvecOutils("claude", ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", "haiku", ...ARGS_OUTILS_CLAUDE], m), true);
	r.check("ollama ne passe jamais par process.run", argumentsAutorises("ollama", ["run", "x"], m), false);
	r.check("un argument non-chaîne : refusé", argumentsAutorises("claude", [1], m), false);
	r.check("pas de tableau : refusé", argumentsAutorises("claude", "--version", m), false);
	r.done();
});

/* THE FOLDER OF A RUN WITH TOOLS (2026-10-09, `confiance-ia.ts`): the
   read-only tools form runs only in a folder that resolves, lies in the
   perimeter, and was trusted by the user. A real temporary tree: a junction
   inside a trusted folder that points outside must not carry the trust. */
{
	const { mkdtempSync, mkdirSync, writeFileSync: ecrire, symlinkSync, rmSync, realpathSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	await withSrcModule("apps/windows/electron/confiance-ia.ts", async ({ jugerDossierOutils, dossierCanonique, lireApprouves, ajouterApprouve, retirerApprouve, estApprouve }) => {
		const r = makeReporter("Run with tools: the folder (trusted, opened, resolved)");
		const base = realpathSync(mkdtempSync(join(tmpdir(), "nq-confiance-")));
		try {
			const cours = join(base, "cours");
			const sous = join(cours, "chap1");
			const dehors = join(base, "dehors");
			mkdirSync(sous, { recursive: true });
			mkdirSync(dehors);
			ecrire(join(cours, "note.md"), "x");
			let jonction = null;
			try { symlinkSync(dehors, join(cours, "lien"), "junction"); jonction = join(cours, "lien"); } catch { /* no junction on this system */ }
			const c = await dossierCanonique(cours);
			const approuves = ajouterApprouve([], { path: c.path, real: c.real, at: "2026-10-09T00:00:00.000Z" });
			const juger = async (chemin, dansPerimetre = true) => {
				const k = await dossierCanonique(chemin);
				return jugerDossierOutils({ reel: k?.real ?? null, estDossier: k !== null, dansPerimetre: k !== null && dansPerimetre, approuves });
			};
			r.check("a trusted folder and its sub-folder pass", [await juger(cours), await juger(sous), await juger(join(sous, ".."))], [true, true, true]);
			r.check("a folder outside the trusted one is refused, even through ..", [await juger(dehors), await juger(join(cours, "..", "dehors")), await juger(base)], [false, false, false]);
			r.check("a trusted folder OUT of the perimeter is refused", await juger(cours, false), false);
			r.check("a file, a missing folder, a relative path or no string are refused", [await juger(join(cours, "note.md")), await juger(join(cours, "absent")), await juger("cours"), await juger(42), await juger(null)], [false, false, false, false, false]);
			if (jonction) r.check("a junction inside the trusted folder that points outside is judged where it leads: refused", await juger(jonction), false);
			r.check("nothing trusted: refused", jugerDossierOutils({ reel: c.real, estDossier: true, dansPerimetre: true, approuves: [] }), false);
			r.check("a stored list that is damaged reads as empty, entries without a real absolute path are dropped",
				[lireApprouves("x").length, lireApprouves([{ path: "a" }, { path: "b", real: "relatif" }, null]).length, lireApprouves([{ path: c.path, real: c.real, at: "" }]).length], [0, 0, 1]);
			r.check("the same folder is not added twice, and Remove takes it off by its shown path",
				[ajouterApprouve(approuves, approuves[0]).length, retirerApprouve(approuves, c.path.replace(/\//g, "\\")).length], [1, 0]);
			r.check("a sibling whose name starts like the trusted one is not covered", estApprouve(c.real + "-copie", approuves), false);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
		r.done();
	});
}

/* L'AUTRE BOUT du partage : l'import d'une archive REÇUE. */
await withSrcModule("src/dashboard/zip.ts", ({ nomNoteImportee }) => {
	const r = makeReporter("Import d'une archive reçue (nomNoteImportee)");
	r.check("une note ordinaire garde son nom", nomNoteImportee("CM1 - Intro.md"), "CM1 - Intro");
	r.check("un sous-dossier d'archive est aplati", nomNoteImportee("cours/CM2.md"), "CM2");
	r.check("un chemin Windows aussi", nomNoteImportee(String.raw`..\..\Startup\x.md`), "x");
	r.check("un .exe est écarté", nomNoteImportee("setup.exe"), null);
	r.check("un .lnk est écarté", nomNoteImportee("raccourci.lnk"), null);
	r.check("un .bat déguisé est écarté", nomNoteImportee("x.md.bat"), null);
	r.check("un nom fait de points est écarté", nomNoteImportee("...md"), null);
	r.check("un fichier caché perd son point", nomNoteImportee(".cache.md"), "cache");
	r.check("un dossier d'archive (fin en /) est écarté", nomNoteImportee("cours/"), null);
	r.check("l'extension compte en majuscules", nomNoteImportee("A.MD"), "A");
	r.done();
});

/* THE NAME RULES, shared by the exporter and the importer (`share-names.ts`,
   2026-10-07). A rule that lives in one side only lets an exported archive
   hold a name the importer refuses. */
await withSrcModule(["src/dashboard/share-names.ts", "src/dashboard/zip.ts"], (names, zip) => {
	const { cleanName, isReservedName, baseNameVerdict, exportBaseName, dedupeNames, fitsPath, fitsWindowsPath, folderNameFromArchive, NAME_MAX, PATH_MAX } = names;
	const r = makeReporter("Share name rules (exporter and importer)");
	r.check("Windows reserves a device name for EVERY extension: con.txt.md, CON.md, nul.tar.gz", [isReservedName("con.txt.md"), isReservedName("CON.md"), isReservedName("nul.tar.gz")], [true, true, true]);
	r.check("device names: com0-9, lpt0-9, the superscript digits, the console handles, a trailing space", [isReservedName("COM1"), isReservedName("lpt9.md"), isReservedName("COM¹.md"), isReservedName("conout$"), isReservedName("aux .md")], [true, true, true, true, true]);
	r.check("a longer word that merely starts like one is fine", [isReservedName("console.md"), isReservedName("coma.md"), isReservedName("a.con.md")], [false, false, false]);
	r.check("a note import refuses con.txt.md and keeps console.md", [zip.nomNoteImportee("con.txt.md"), zip.nomNoteImportee("console.md")], [null, "console"]);
	r.check("an image import refuses nul.final.png", zip.nomImageImportee("nul.final.png"), null);
	const nfd = "café.md";
	r.check("NFD (macOS) becomes NFC", [zip.nomNoteImportee(nfd), zip.nomNoteImportee(nfd) === "café"], ["café", true]);
	r.check("an NFD image name matches the NFC link", zip.nomImageImportee("café.png"), "café.png");
	r.check("forbidden characters and controls become dashes, edge dots and spaces go", [cleanName(' a:b*c?"d<e>f|g\u0001 .'), cleanName("..x..")], ["a-b-c--d-e-f-g-", "x"]);
	r.check("a 300-character name is cut to the cap, not dropped", [zip.nomNoteImportee("x".repeat(300) + ".md")?.length, NAME_MAX], [NAME_MAX, 100]);
	r.check("empty after cleaning is refused with a reason", [baseNameVerdict("...").reason, baseNameVerdict("CON").reason], ["empty", "reserved"]);
	r.check("the exporter never refuses: a reserved name gets an underscore, an empty one the fallback", [exportBaseName("CON", "quiz"), exportBaseName("???", "quiz"), exportBaseName("a/b", "quiz"), exportBaseName("con.txt", "quiz")], ["CON_", "---", "a-b", "con_.txt"]);
	r.check("exporter and importer agree on hostile names: whatever is exported is accepted back", ["CON", "con.txt", "nul.", "Q:1", "x".repeat(400), "é́", "aux .z", " ", "lpt1"].every(n => {
		const out = exportBaseName(n, "quiz");
		return zip.nomNoteImportee(`${out}.md`) === out;
	}), true);
	r.check("names that differ only by case, or by NFC/NFD, collide: the next gets (2), (3)", dedupeNames(["A.md", "a.md", "café.md", "café.md", "A.MD"]), ["A.md", "a (2).md", "café.md", "café (2).md", "A (3).MD"]);
	r.check("a deduplicated name does not collide with a later real one", dedupeNames(["a.md", "a.md", "a (2).md"]), ["a.md", "a (2).md", "a (2) (2).md"]);
	r.check("the target path bound: 240 fits, 241 does not", [fitsPath("x".repeat(100), "y".repeat(139)), fitsPath("x".repeat(100), "y".repeat(140)), PATH_MAX], [true, false, 240]);
	// An absolute Windows target: 260 counts the root, the folder AND the staging folder (".import-" + 12 hex) that sits beside it.
	const root = "C:/Users/Ahmed/Documents/Cours/" + "d".repeat(60);
	const P = "C:/" + "p".repeat(100) + "/";
	r.check("Windows absolute path: 259 characters fit, 260 do not", [fitsWindowsPath(root, "a".repeat(100)), fitsWindowsPath(root, "a".repeat(167)), fitsWindowsPath(root, "a".repeat(168))], [true, true, false]);
	r.check("... a SHORT folder name makes the staging path (.import- + 12 hex) the longer one",
		[fitsWindowsPath(P + "x", "a".repeat(134)), fitsWindowsPath(P + "x", "a".repeat(135)), fitsWindowsPath(P + "y".repeat(30), "a".repeat(124)), fitsWindowsPath(P + "y".repeat(30), "a".repeat(125))], [true, false, true, false]);
	r.check("a name that is an Object.prototype key is refused (a folder called __proto__ would not be stored as a setting)", ["__proto__", "constructor", "Prototype", " __PROTO__ "].map(n => baseNameVerdict(n).reason), ["reserved", "reserved", "reserved", "reserved"]);
	r.check("... the exporter renames it, the archive name falls back to Import", [exportBaseName("constructor", "quiz"), exportBaseName("__proto__", "quiz"), folderNameFromArchive("__proto__.zip"), baseNameVerdict("constructors").ok], ["constructor_", "__proto___", "Import", true]);
	const rlo = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b), isoFirst = String.fromCharCode(0x2066), zwj = String.fromCharCode(0x200d);
	r.check("bidi controls and zero-width characters are removed from every name (ann<RLO>txt.md cannot masquerade); ZWJ stays for emoji",
		[cleanName(`ann${rlo}txt.md`), cleanName(`a${zw}b${isoFirst}c.md`), cleanName(`x${zwj}y`), zip.nomNoteImportee(`ann${rlo}txt.md`), exportBaseName(`ann${rlo}txt`, "quiz")],
		["anntxt.md", "abc.md", `x${zwj}y`, "anntxt", "anntxt"]);
	r.check("the folder named after an archive: CON.zip, a download suffix, NFD, empty", [folderNameFromArchive("CON.zip"), folderNameFromArchive("Cours C (1).zip"), folderNameFromArchive("café.zip"), folderNameFromArchive(".zip"), folderNameFromArchive("a:b.zip")], ["Import", "Cours C", "café", "Import", "a-b"]);
	r.done();
});

/* THE SHARE'S CONTENT AND THE RECEIVING READER (2026-10-01). A shared folder
   used to carry quiz notes only (every embedded image was dead on arrival) and
   the reader skipped every archive it had not written itself (deflate: "empty"). */
await withSrcModule(["src/dashboard/zip.ts", "src/dashboard/share-pack.ts", "src/dashboard/share-plan.ts"], async (zip, pack, planner) => {
	const { buildZip, buildZipFiles, readZip, nomImageImportee, ZipReadError, IMPORT_LIMITS, SHARE_MAX_BYTES } = zip;
	const { embedTargets, packShare, isShareableImage } = pack;
	const { deflateRawSync } = await import("node:zlib");
	const r = makeReporter("Share content and archive reader");
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7]);
	const crcOf = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
	/** A hand-made archive, as Explorer or 7-Zip writes it: deflate, central sizes. */
	const make = (entries, { flags = 0, method = 8, dropCrc = false } = {}) => {
		const parts = []; const cd = []; let off = 0;
		const w16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
		const w32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
		for (const e of entries) {
			const name = Buffer.from(e.name, "utf8");
			const raw = Buffer.from(e.bytes);
			const m = e.method ?? method;
			const body = m === 8 ? deflateRawSync(raw) : raw;
			const crc = dropCrc ? 1 : crcOf(raw);
			const local = Buffer.concat([w32(0x04034b50), w16(20), w16(flags), w16(m), w16(0), w16(0x21), w32(crc), w32(body.length), w32(raw.length), w16(name.length), w16(0), name, body]);
			cd.push(Buffer.concat([w32(0x02014b50), w16(20), w16(20), w16(flags), w16(m), w16(0), w16(0x21), w32(crc), w32(body.length), w32(e.declared ?? raw.length), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), name]));
			parts.push(local); off += local.length;
		}
		const cdb = Buffer.concat(cd);
		return new Uint8Array(Buffer.concat([...parts, cdb, w32(0x06054b50), w16(0), w16(0), w16(entries.length), w16(entries.length), w32(cdb.length), w32(off), w16(0)]));
	};
	const refus = (p) => p.then(() => "read", (e) => e instanceof ZipReadError && e.code);

	// Round trip of our own writer, binary included.
	const own = buildZipFiles([{ name: "a.md", bytes: enc.encode("```quiz-blocks\n[]\n```") }, { name: "img/x.png", bytes: PNG }]);
	const back = await readZip(own);
	r.check("our own archive reads back, images byte for byte", [back.files.map(f => f.name), Array.from(back.files[1].bytes), back.skipped.length], [["a.md", "img/x.png"], Array.from(PNG), 0]);
	r.check("buildZip stays deterministic without a date (the pinned language pack)", Array.from(buildZip([{ name: "a.md", content: "x" }]).slice(10, 14)), [0, 0, 0, 0]);
	const dated = buildZip([{ name: "a.md", content: "x" }], new Date(2026, 9, 1, 12, 30, 20));
	const dv = new DataView(dated.buffer);
	r.check("a shared archive carries a real DOS date, not month 0 day 0", [dv.getUint16(12, true) & 31, (dv.getUint16(12, true) >> 5) & 15, 1980 + (dv.getUint16(12, true) >> 9)], [1, 10, 2026]);

	// An archive from another tool (deflate): the old reader found nothing.
	const note = "```quiz-blocks\n[{prompt:'é'}]\n```\n" + "x".repeat(5000);
	const defl = await readZip(make([{ name: "Cours/CM1 é.md", bytes: enc.encode(note) }, { name: "Cours/", bytes: [], method: 0 }]));
	r.check("a DEFLATE archive (Explorer, 7-Zip, macOS) is read, accents kept", [defl.files.length, defl.files[0]?.name, dec.decode(defl.files[0]?.bytes ?? new Uint8Array()) === note], [1, "Cours/CM1 é.md", true]);

	// Hostile archives.
	const bomb = await readZip(make([{ name: "b.md", bytes: new Uint8Array(1000), declared: 10 }]));
	r.check("an entry that inflates past its DECLARED size is dropped (zip bomb)", [bomb.files.length, bomb.skipped.map(x => x.reason)], [0, ["corrupt"]]);
	const hugeDeclared = await readZip(make([{ name: "b.md", bytes: new Uint8Array(100), declared: IMPORT_LIMITS.entry + 1 }]));
	r.check("an entry declared over the per-entry bound is dropped without inflating", [hugeDeclared.files.length, hugeDeclared.skipped.map(x => x.reason)], [0, ["too-big"]]);
	const badCrc = await readZip(make([{ name: "c.md", bytes: enc.encode("abc") }], { dropCrc: true }));
	r.check("a bad checksum is dropped", [badCrc.files.length, badCrc.skipped.map(x => `${x.name}:${x.reason}`)], [0, ["c.md:bad-crc"]]);
	const enc1 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc") }], { flags: 1 }));
	r.check("an encrypted entry is dropped", [enc1.files.length, enc1.skipped.map(x => x.reason)], [0, ["encrypted"]]);
	const m9 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc"), method: 9 }]));
	r.check("an unknown method is dropped", [m9.files.length, m9.skipped.map(x => x.reason)], [0, ["method"]]);
	const many = make(Array.from({ length: 5 }, (_, i) => ({ name: `n${i}.md`, bytes: enc.encode("x") })));
	r.check("too many entries: refused whole", await refus(readZip(many, { ...IMPORT_LIMITS, entries: 4 })), "too-many");
	r.check("an archive over the bound: refused whole", await refus(readZip(own, { ...IMPORT_LIMITS, archive: 10 })), "too-large");
	r.check("not a zip: refused", await refus(readZip(enc.encode("hello, this is not a zip file at all"))), "invalid");
	r.check("a truncated archive: refused", await refus(readZip(own.slice(0, own.length - 30))), "invalid");
	const tot = await readZip(make([{ name: "a.md", bytes: enc.encode("x".repeat(60)) }, { name: "b.md", bytes: enc.encode("y".repeat(60)) }]), { ...IMPORT_LIMITS, total: 100 });
	r.check("the total inflated size is bounded", [tot.files.length, tot.skipped.map(x => x.reason)], [1, ["total"]]);

	// What may be imported.
	// (The import plan replaced the old flattening classifier: sub-folders are kept, a `..` segment refuses the file.)
	const planOf = (files) => planner.planImport({ files: files.map(f => ({ name: f.name, bytes: f.bytes, sha256: "0" })), skipped: [], junk: 0, quizOnly: false, existing: new Map(), fallbackName: "x" });
	const cls = planOf([
		{ name: "Cours/CM1.md", bytes: enc.encode("a") }, { name: String.raw`..\..\Startup\x.png`, bytes: PNG }, { name: "dessin.SVG", bytes: PNG },
		{ name: "setup.exe", bytes: PNG }, { name: "cours.pdf", bytes: PNG }, { name: "gros.png", bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
	]);
	r.check("notes are kept; svg, exe, pdf, a path with .. and an oversize image are left out, each with its reason",
		[cls.writes.map(w => w.path), cls.discarded.map(x => `${x.name}:${x.reason}`).sort()],
		[["Cours/CM1.md"], ["..\\..\\Startup\\x.png:bad-name", "cours.pdf:unsupported-type", "dessin.SVG:unsupported-type", "gros.png:image-too-large", "setup.exe:unsupported-type"]]);
	const png = (n) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n]);
	const bytesOf = (...parts) => new Uint8Array(parts.flatMap(x => typeof x === "string" ? [...x].map(c => c.charCodeAt(0)) : x));
	const sigs = { "a.png": png(0), "b.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]), "c.gif": bytesOf("GIF89a"), "d.webp": bytesOf("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "e.bmp": bytesOf("BM", new Array(30).fill(0)), "f.avif": bytesOf([0, 0, 0, 28], "ftypavif") };
	const real = planOf(Object.entries(sigs).map(([name, bytes]) => ({ name, bytes })));
	r.check("images whose bytes are a PNG, JPEG, GIF, WebP, BMP or AVIF are imported", [real.writes.map(w => w.path), real.discarded], [Object.keys(sigs), []]);
	const fake = planOf([{ name: "shot.png", bytes: bytesOf("MZ", [0x90, 0], "a program") }, { name: "x.jpg", bytes: bytesOf("<script>alert(1)</script>") }, { name: "y.gif", bytes: new Uint8Array(0) }, { name: "z.webp", bytes: bytesOf("RIFF", [0, 0, 0, 0], "WAVEfmt ") }, { name: "renamed.jpg", bytes: png(9) }]);
	r.check("a file that only CLAIMS to be an image (program, script, empty, a WAV) is left out as 'not-an-image'; a PNG named .jpg still displays and stays",
		[fake.writes.map(w => w.path), fake.discarded.map(x => `${x.name}:${x.reason}`)], [["renamed.jpg"], ["shot.png:not-an-image", "x.jpg:not-an-image", "y.gif:not-an-image", "z.webp:not-an-image"]]);
	r.check("an image name: path flattened, hidden dots stripped, no extension refused", [nomImageImportee("a/b/c.PNG"), nomImageImportee("..png"), nomImageImportee("x"), nomImageImportee("x.png.bat")], ["c.png", null, null, null]);
	r.check("Windows device names are refused as imported names", [nomImageImportee("CON.png"), nomImageImportee("d/nul.jpg"), zip.nomNoteImportee("COM1.md"), zip.nomNoteImportee("console.md")], [null, null, null, "console"]);

	// What a share carries.
	r.check("embedded images are found: wikilink with size and heading, markdown, not URLs",
		embedTargets("![[a.png|200]] ![[b c.jpg#x]] ![alt](d%20e.png) ![w](https://x/y.png) ![d](data:image/png;base64,AA) ![[Cours note]]"), ["a.png", "b c.jpg", "Cours note", "d e.png"]);
	r.check("isShareableImage", [isShareableImage("a.PNG"), isShareableImage("a.svg"), isShareableImage("a.pdf")], [true, false, false]);
	const notes = [{ name: "q.md", content: "x".repeat(1000) }];
	const imgs = [{ name: "a.png", bytes: new Uint8Array(4000) }, { name: "b.png", bytes: new Uint8Array(4000) }, { name: "c.png", bytes: new Uint8Array(100) }];
	const bound = 22 + 3 * 200 + 1000 + 4000 + 100;
	const small = packShare(notes, imgs, new Date(), bound);
	r.check("images that do not fit are LEFT OUT and counted, the rest goes in", [small.imagesIn, small.imagesOut, small.bytes !== null], [2, 1, true]);
	r.check("the built archive stays under the bound it was given", small.bytes.length <= bound, true);
	r.check("the archive reads back with the images that went in", (await readZip(small.bytes)).files.map(f => f.name), ["q.md", "a.png", "c.png"]);
	r.check("notes alone over the bound: no archive", packShare([{ name: "q.md", content: "x".repeat(2000) }], [], new Date(), 1000).bytes, null);
	r.check("a duplicate name is left out, not overwritten", packShare(notes, [{ name: "a.png", bytes: PNG }, { name: "A.png", bytes: PNG }], new Date()).imagesOut, 1);
	r.check("the bound is the share bound", SHARE_MAX_BYTES, 16 * 1024 * 1024);
	r.done();
});

/* THE READER HARDENED (2026-10-07): legacy names, zip64, overlap, system
   litter, links, ratio, and above all NOTHING dropped without a name and a
   reason. */
await withSrcModule(["src/dashboard/share-manifest.ts", "src/dashboard/share-pack.ts", "src/dashboard/zip.ts"], async (mf, pack, zip) => {
	const r = makeReporter("Share manifest (format 1) and the v1 packer");
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const read = (o) => mf.readManifest(enc.encode(typeof o === "string" ? o : JSON.stringify(o)));
	const sha = "a".repeat(64);
	const ok = { format: "neo-quiz-share", version: 1, app: "1.0.0", created: "2026-10-07T12:00:00Z", kind: "folder", name: "X", files: [{ path: "A.md", kind: "note", size: 3, sha256: sha }] };

	r.check("no manifest = format 0", mf.readManifest(null), { status: "none" });
	r.check("a valid manifest is read", read(ok).status, "ok");
	r.check("garbage, an array, another format, a version below 1: all 'invalid', never a throw", [read("not json").status, read("[]").status, read({ ...ok, format: "x" }).status, read({ ...ok, version: 0 }).status, read({ ...ok, version: 1.5 }).status], ["invalid", "invalid", "invalid", "invalid", "invalid"]);
	r.check("a file entry with a bad hash makes the manifest invalid (no half-trusted list)", read({ ...ok, files: [{ path: "A.md", size: 1, sha256: "zz" }] }).status, "invalid");
	r.check("a NEWER version is 'newer' whatever else it holds (unknown fields, another hash scheme)", read({ format: "neo-quiz-share", version: 7, files: "blake3", extra: {} }), { status: "newer", version: 7 });
	r.check("a manifest listing more than IMPORT_LIMITS.entries files is invalid (the bound is pinned to the archive's)", [mf.MANIFEST_MAX_FILES, mf.MANIFEST_MAX_FILES === zip.IMPORT_LIMITS.entries,
		read({ ...ok, files: Array.from({ length: mf.MANIFEST_MAX_FILES + 1 }, (_, i) => ({ path: `f${i}.md`, kind: "note", size: 1, sha256: sha })) }).status,
		read({ ...ok, files: Array.from({ length: mf.MANIFEST_MAX_FILES }, (_, i) => ({ path: `f${i}.md`, kind: "note", size: 1, sha256: sha })) }).status], [2000, true, "invalid", "ok"]);
	r.check("unknown fields of the current version are ignored", read({ ...ok, brandNew: 1 }).status, "ok");
	r.check("paths are read as NFC", read({ ...ok, files: [{ ...ok.files[0], path: "e\u0301.md" }] }).manifest.files[0].path, "\u00e9.md");

	r.check("folder settings: a bad colour, an icon outside the list, control characters are dropped",
		mf.sanitizeFolderSettings({ color: "red", icon: "not-an-icon", name: "A\u0000B", ue: "\u0007UE\n1", extra: 1 }), { name: "A-B", ue: "UE 1" });
	r.check("folder settings: valid values are kept (colour lower-cased)", mf.sanitizeFolderSettings({ color: "#4F8CFF", icon: "book", name: "Cours", ue: "UE 1" }), { color: "#4f8cff", icon: "book", name: "Cours", ue: "UE 1" });
	r.check("folder settings: nothing usable = null", [mf.sanitizeFolderSettings({}), mf.sanitizeFolderSettings(null), mf.sanitizeFolderSettings("x")], [null, null, null]);
	r.check("folder settings: names are cut to 100 characters", mf.sanitizeFolderSettings({ name: "n".repeat(300) }).name.length, 100);

	const now = new Date(Date.UTC(2026, 9, 7, 12, 0, 0));
	const note = (path, text) => ({ path, kind: "note", bytes: enc.encode(text) });
	const img = (path, n) => ({ path, kind: "image", bytes: new Uint8Array(n).fill(7) });
	const packed = await pack.packShareV1([note("Dossier/a.md", "alpha")], [img("x.png", 10)], { app: "9.9.9", kind: "quizzes", name: "N", folder: { color: "bad", icon: "book" } }, now);
	const files = (await zip.readZip(packed.bytes)).files;
	const m = JSON.parse(dec.decode(files[0].bytes));
	r.check("packShareV1: the manifest is the FIRST entry", files.map(f => f.name), ["neo-quiz.json", "Dossier/a.md", "x.png"]);
	r.check("packShareV1: kind, app, a Z-time, the sanitised look (bad colour dropped)", [m.kind, m.app, m.created, m.folder], ["quizzes", "9.9.9", "2026-10-07T12:00:00Z", { icon: "book" }]);
	r.check("packShareV1: size and SHA-256 are those of the bytes that went in",
		m.files.map(f => [f.path, f.size, f.sha256]), [["Dossier/a.md", 5, await mf.sha256Hex(enc.encode("alpha"))], ["x.png", 10, await mf.sha256Hex(new Uint8Array(10).fill(7))]]);
	r.check("packShareV1: same input, same bytes (deterministic)", Buffer.from((await pack.packShareV1([note("Dossier/a.md", "alpha")], [img("x.png", 10)], { app: "9.9.9", kind: "quizzes", name: "N", folder: { color: "bad", icon: "book" } }, now)).bytes).equals(Buffer.from(packed.bytes)), true);

	// The budget includes the manifest: images that no longer fit are left out and the archive stays under the bound.
	const limit = 3000;
	const big = await pack.packShareV1([note("a.md", "alpha")], [img("1.png", 1200), img("2.png", 1200), img("3.png", 1200)], { app: "1", kind: "folder", name: "N" }, now, limit);
	r.check("packShareV1: the archive never exceeds the bound, manifest included; the rest is counted as left out", [big.bytes.length <= limit, big.imagesIn + big.imagesOut, big.imagesOut > 0], [true, 3, true]);
	const mBig = JSON.parse(dec.decode((await zip.readZip(big.bytes)).files[0].bytes));
	r.check("... and the manifest lists only what is in", mBig.files.length, 1 + big.imagesIn);
	r.check("notes alone over the bound: no archive", (await pack.packShareV1([note("a.md", "x".repeat(5000))], [], { app: "1", kind: "folder", name: "N" }, now, limit)).bytes, null);
	r.check("two images whose paths differ only by case: the second is left out", (await pack.packShareV1([note("a.md", "x")], [img("I.png", 5), img("i.PNG", 5)], { app: "1", kind: "folder", name: "N" }, now)).imagesOut, 1);
	r.done();
});

await withSrcModule(["src/dashboard/zip.ts", "src/dashboard/share-plan.ts"], async (zip, planner) => {
	const { readZip, isJunkEntry, ZipReadError, IMPORT_LIMITS, CP437_HIGH } = zip;
	const { forgeZip, unicodePathExtra } = await import("./lib/zip-forge.mjs");
	const r = makeReporter("Archive reader hardening");
	const note = "```quiz-blocks\n[{prompt:'x'}]\n```\n";
	const refus = (p) => p.then(() => "read", (e) => e instanceof ZipReadError && e.code);
	const names = async (z) => (await readZip(z)).files.map(f => f.name);

	r.check("the code page 437 table has 128 characters", [...CP437_HIGH].length, 128);
	// "Cafe" with 0x82 = e acute in CP437, no UTF-8 flag (legacy Windows tools).
	const cp = forgeZip([{ nameBytes: Buffer.from([0x43, 0x61, 0x66, 0x82, 0x2e, 0x6d, 0x64]), bytes: note }]);
	r.check("no UTF-8 flag and not valid UTF-8: decoded as CP437 (Café.md, not mojibake)", await names(cp), ["Café.md"]);
	const cpFr = forgeZip([{ nameBytes: Buffer.from([0x82, 0x8a, 0x85, 0x87, 0x2e, 0x6d, 0x64]), bytes: note }]);
	r.check("French accents of CP437: é è à ç", await names(cpFr), ["éèàç.md"]);
	r.check("no flag but valid UTF-8 (many tools): read as UTF-8", await names(forgeZip([{ name: "Café.md", bytes: note }])), ["Café.md"]);
	r.check("the UTF-8 flag is honoured", await names(forgeZip([{ name: "Café.md", bytes: note, flags: 0x800 }])), ["Café.md"]);
	const rawLegacy = Buffer.from([0x43, 0x82]);
	r.check("the Unicode Path field wins when its checksum matches the stored name", await names(forgeZip([{ nameBytes: rawLegacy, extra: unicodePathExtra(rawLegacy, "Cœur.md"), localExtra: unicodePathExtra(rawLegacy, "Cœur.md"), bytes: note }])), ["Cœur.md"]);
	const badUp = unicodePathExtra(Buffer.from([0x41]), "Evil.md");
	r.check("a Unicode Path field for ANOTHER name is ignored", await names(forgeZip([{ nameBytes: rawLegacy, extra: badUp, bytes: note }])), ["Cé"]);

	// zip64.
	const z64 = forgeZip([{ name: "a.md", bytes: note, zip64: true }, { name: "b.md", bytes: note }], { zip64End: true });
	const z64r = await readZip(z64);
	r.check("a zip64 archive (end record, locator and extra fields) is READ", [z64r.files.map(f => f.name), z64r.skipped.length], [["a.md", "b.md"], 0]);
	const z64Broken = forgeZip([{ name: "a.md", bytes: note }]);
	new DataView(z64Broken.buffer).setUint32(z64Broken.length - 6, 0xffffffff, true); // central directory offset = "see zip64", no locator
	r.check("zip64 that cannot be read: its OWN error code, not \"damaged\"", await refus(readZip(z64Broken)), "zip64");
	const z64NoExtra = forgeZip([{ name: "a.md", bytes: note, extra: [], zip64: false, size: 0xffffffff }]);
	const nx = await readZip(z64NoExtra);
	r.check("an entry whose 32-bit size says \"see zip64\" with no field: listed as skipped, named", nx.skipped.map(x => `${x.name}:${x.reason}`), ["a.md:zip64"]);
	r.check("a split (multi-disk) archive: its own error code", await refus(readZip(forgeZip([{ name: "a.md", bytes: note }], { diskNumber: 1 }))), "multi-disk");

	// Two entries with one path: refused whole (the manifest check would only see the last).
	r.check("two entries with the same path: the archive is refused (duplicate)", await refus(readZip(forgeZip([{ name: "a.md", bytes: note }, { name: "a.md", bytes: note + " " }]))), "duplicate");
	r.check("... also across separators and NFD", await refus(readZip(forgeZip([{ name: "d/é.md", bytes: note }, { name: "d" + String.fromCharCode(92) + "e" + String.fromCharCode(0x301) + ".md", bytes: note + " " }]))), "duplicate");

	// Overlap and name mismatch.
	const ov = forgeZip([{ name: "a.md", bytes: note }, { name: "b.md", bytes: note, noLocal: true, localOffsetOf: 0 }]);
	r.check("two entries sharing the same bytes: the archive is refused (overlap)", await refus(readZip(ov)), "overlap");
	const mism = await readZip(forgeZip([{ name: "a.md", localNameBytes: Buffer.from("b.md"), bytes: note }]));
	r.check("local and central names differ: the entry is skipped, named, with its reason", [mism.files.length, mism.skipped.map(x => `${x.name}:${x.reason}`)], [0, ["a.md:name-mismatch"]]);

	// A hostile manifest must not make the plan quadratic: 2000 skipped entries + 60 000 manifest lines.
	{
		const sha64 = "b".repeat(64);
		const enc = new TextEncoder();
		const manifest = enc.encode(JSON.stringify({ format: "neo-quiz-share", version: 1, app: "1", created: "", kind: "folder", name: "X", files: Array.from({ length: 60000 }, (_, i) => ({ path: `m${i}.md`, kind: "note", size: 1, sha256: sha64 })) }));
		const skipped = Array.from({ length: 2000 }, (_, i) => ({ name: `s${i}.md`, reason: "corrupt" }));
		const t0 = performance.now();
		const big = planner.planImport({ files: [{ name: "neo-quiz.json", bytes: manifest, sha256: "0" }], skipped, junk: 0, quizOnly: false, existing: new Map(), fallbackName: "x" });
		const ms = performance.now() - t0;
		r.check("a 60 000-line manifest is refused as invalid, with a notice, and fast", [big.notices, big.missing.length, ms < 200], [["manifest-invalid"], 0, true]);
		const ok2000 = enc.encode(JSON.stringify({ format: "neo-quiz-share", version: 1, app: "1", created: "", kind: "folder", name: "X", files: Array.from({ length: 2000 }, (_, i) => ({ path: `s${i}.md`, kind: "note", size: 1, sha256: sha64 })) }));
		const t1 = performance.now();
		const full = planner.planImport({ files: [{ name: "neo-quiz.json", bytes: ok2000, sha256: "0" }], skipped, junk: 0, quizOnly: false, existing: new Map(), fallbackName: "x" });
		r.check("2000 skipped entries all listed by a 2000-line manifest: none reported missing, fast (a Set, not a scan)", [full.missing.length, performance.now() - t1 < 200], [0, true]);
	}

	// System litter.
	const mac = await readZip(forgeZip([
		{ name: "Cours/CM1.md", bytes: note }, { name: "__MACOSX/Cours/._CM1.md", bytes: new Uint8Array([0, 5, 22, 7]) },
		{ name: "Cours/.DS_Store", bytes: new Uint8Array([0, 0, 0, 1]) }, { name: "Thumbs.db", bytes: new Uint8Array([1]) }, { name: "desktop.ini", bytes: "x" },
	]));
	r.check("macOS and Windows litter is filtered BEFORE reading and counted apart (never a junk note)", [mac.files.map(f => f.name), mac.junk, mac.skipped.length], [["Cours/CM1.md"], 4, 0]);
	r.check("isJunkEntry: only the litter", ["__MACOSX/x", "a/._b.md", ".DS_Store", "Thumbs.db", "THUMBS.DB", "a/desktop.ini"].map(isJunkEntry).concat(["a._b.md", "cours.md", "__MACOSXY/x.md"].map(isJunkEntry)), [true, true, true, true, true, true, false, false, false]);
	const planOf = (files) => planner.planImport({ files: files.map(f => ({ name: f.name, bytes: f.bytes, sha256: "0" })), skipped: [], junk: 0, quizOnly: false, existing: new Map(), fallbackName: "x" });
	const clsMac = planOf([{ name: "__MACOSX/._CM1.md", bytes: new Uint8Array([0, 5]) }, { name: "CM1.md", bytes: new TextEncoder().encode(note) }]);
	r.check("the import plan never turns an AppleDouble file into a note", [clsMac.writes.map(w => w.path), clsMac.junk, clsMac.discarded.length], [["CM1.md"], 1, 0]);

	// Links, ratio, hostile counts.
	const sl = await readZip(forgeZip([{ name: "link.md", bytes: "/etc/passwd", madeBy: (3 << 8) | 20, attrs: (0o120777 << 16) >>> 0 }, { name: "ok.md", bytes: note, madeBy: (3 << 8) | 20, attrs: (0o100644 << 16) >>> 0 }]));
	r.check("a symbolic link entry is skipped and named; a regular unix file is read", [sl.files.map(f => f.name), sl.skipped.map(x => `${x.name}:${x.reason}`)], [["ok.md"], ["link.md:symlink"]]);
	const zeros = new Uint8Array(8 * 1024 * 1024);
	const ratio = await readZip(forgeZip([{ name: "z.md", bytes: zeros }]));
	r.check("8 MB of zeros stored in a few KB: skipped for its ratio, named", ratio.skipped.map(x => `${x.name}:${x.reason}`), ["z.md:ratio"]);
	r.check("a long ordinary note is NOT mistaken for a bomb", (await readZip(forgeZip([{ name: "n.md", bytes: "word ".repeat(200000) }]))).files.length, 1);

	// Every refusal carries a name and a reason; nothing is silent.
	const mixed = await readZip(forgeZip([
		{ name: "ok.md", bytes: note }, { name: "enc.md", bytes: note, flags: 1 }, { name: "m.md", bytes: note, method: 8, crc: 1 },
		{ name: "big.md", bytes: "x", size: IMPORT_LIMITS.entry + 1 },
	]));
	r.check("the good entry is read and every other one is listed with its reason", [mixed.files.length, mixed.skipped.map(x => `${x.name}:${x.reason}`).sort()], [1, ["big.md:too-big", "enc.md:encrypted", "m.md:bad-crc"]]);
	const png = (n) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n]);
	const cl = planOf([{ name: "a.png", bytes: png(1) }, { name: "dir/A.PNG", bytes: png(2) }, { name: "dir2/a.png", bytes: png(1) }, { name: "con.md", bytes: new Uint8Array([1]) }, { name: "x.pdf", bytes: new Uint8Array([1]) }]);
	r.check("the import plan keeps same-named images of different folders and lists a refused name and a type", [cl.writes.map(w => w.path), cl.discarded.map(x => `${x.name}:${x.reason}`)], [["a.png", "dir/A.PNG", "dir2/a.png"], ["x.pdf:unsupported-type", "con.md:bad-name"]]);
	r.done();
});

await withSrcModule("apps/windows/electron/process.ts", ({ citerPs }) => {
	const r = makeReporter("Citation PowerShell (citerPs)");
	const Q = ["'", "\u2018", "\u2019", "\u201A", "\u201B"];
	for (const q of Q) {
		r.check(`U+${q.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} est doublé`, citerPs(`a${q}b`), `'a${q}${q}b'`);
	}
	r.check("le reste passe tel quel", citerPs(String.raw`C:\x $y "z"`), String.raw`'C:\x $y "z"'`);

	/* Le VRAI PowerShell, sous Windows : la valeur ressort intacte, et la
	   tentative d'injection reste du texte. Hors Windows (CI Linux), pas de
	   powershell.exe : ces cas sont sautés, les cas purs ci-dessus restent. */
	if (process.platform === "win32") {
		const executer = (script) => execFileSync("powershell.exe",
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + script, "utf16le").toString("base64")],
			{ encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		for (const q of Q) {
			const valeur = `a${q}; Write-Output INJECTE; $x=${q}b`;
			r.check(`vrai PowerShell : U+${q.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} ne ferme pas la chaîne`,
				executer(`$v = ${citerPs(valeur)}; [Console]::Out.Write($v)`), valeur);
		}
	}
	r.done();
});

/* ── THIS COMPUTER'S NAME AND KIND (appareil.ts): one constant script, two words out, failure = laptop, probed once. */
await withSrcModule("apps/windows/electron/appareil.ts", async ({ lireType, nomPropre, creerInfosAppareil, SCRIPT_TYPE }) => {
	const r = makeReporter("Appareil: type et nom");
	const NL = String.fromCharCode(10);
	r.check("desktop and laptop are read as such", [lireType("desktop" + NL), lireType("laptop")], ["desktop", "laptop"]);
	r.check("anything else (junk, empty, null, a number, a longer line) is a laptop", [lireType("Desktop!"), lireType(""), lireType(null), lireType(7), lireType("desktop laptop")], ["laptop", "laptop", "laptop", "laptop", "laptop"]);
	r.check("the script is constant: no environment variable, no interpolation, no argument", /\$env:|\$\{|\$args/.test(SCRIPT_TYPE), false);
	r.check("the name is one clean line of 64 characters at most", [nomPropre("PC-" + NL + "A"), nomPropre("x".repeat(100)).length, nomPropre(5), nomPropre("  Aero  ")], ["PC-A", 64, "", "Aero"]);
	let lancements = 0;
	const infos = creerInfosAppareil({ executer: async () => { lancements++; return "desktop"; }, nom: () => "Tour" });
	const [a, b] = await Promise.all([infos(), infos()]);
	await infos();
	r.check("the probe runs once for any number of calls", [a.kind, a.name, b.kind, lancements], ["desktop", "Tour", "desktop", 1]);
	const casse = creerInfosAppareil({ executer: async () => { throw new Error("x"); }, nom: () => { throw new Error("y"); } });
	r.check("a failing probe and name never reject: laptop, empty name", await casse(), { name: "", kind: "laptop" });
	r.done();
});

/* ── METERED CONNECTION (2026-10-07, `connexion-limitee.ts`) ──
   The probe that decides whether updates and Moodle wait for a click. The
   script is a constant, the answer is cached, and ANY failure means "not
   metered" (never block updates for good on a machine where the probe cannot
   run). */
await withSrcModule("apps/windows/electron/connexion-limitee.ts", async ({ lireCout, creerSonde, SCRIPT_COUT, DUREE_CACHE_MS, executerPowerShell }) => {
	const r = makeReporter("Connexion limitée — lecture, cache, échec = non limitée");
	r.check("Unrestricted seul : non limitée", lireCout("Unrestricted False False False\r\n"), false);
	r.check("Fixed : limitée", lireCout("Fixed False False False"), true);
	r.check("Variable (case « connexion limitée » de Windows) : limitée", lireCout("Variable False False False"), true);
	r.check("Unrestricted mais en itinérance : limitée", lireCout("Unrestricted True False False"), true);
	r.check("Unrestricted mais forfait dépassé : limitée", lireCout("Unrestricted False True False"), true);
	r.check("Unrestricted mais forfait bientôt atteint : limitée", lireCout("Unrestricted False False True"), true);
	r.check("aucun profil : non limitée", lireCout("none"), false);
	r.check("sortie illisible, vide ou non texte : non limitée", [lireCout("blah"), lireCout(""), lireCout(null), lireCout(42), lireCout("Fixed")], [false, false, false, false, false]);
	r.check("le script est constant : pas de variable d'environnement, pas d'interpolation de valeur extérieure", /\$env:|\$\{/.test(SCRIPT_COUT), false);

	let t = 1000, appels = 0, sortie = "Fixed False False False";
	const sonde = creerSonde({ executer: async () => { appels++; return sortie; }, maintenant: () => t });
	const [a, b] = await Promise.all([sonde.limitee(), sonde.limitee()]);
	r.check("deux demandes simultanées partagent UN lancement", [a, b, appels], [true, true, 1]);
	await sonde.limitee();
	r.check("dans les cinq minutes : réponse en cache, aucun lancement", appels, 1);
	sortie = "Unrestricted False False False"; t += DUREE_CACHE_MS + 1;
	r.check("cache expiré : nouvelle mesure", [await sonde.limitee(), appels], [false, 2]);
	sortie = "Fixed False False False";
	sonde.invalider();
	r.check("invalider() (reprise de veille) force une nouvelle mesure", [await sonde.limitee(), appels], [true, 3]);
	const casse = creerSonde({ executer: async () => { throw new Error("boom"); } });
	r.check("exécuteur qui échoue : non limitée, sans rejet", await casse.limitee(), false);
	const nul = creerSonde({ executer: async () => null });
	r.check("exécuteur sans sortie (pas Windows, délai) : non limitée", await nul.limitee(), false);
	const forcee = creerSonde({ executer: async () => "Unrestricted False False False", forcer: () => true });
	r.check("forçage de développement honoré, sans cache", await forcee.limitee(), true);

	/* The REAL script on Windows: a line we can read (a machine with no
	   connection prints `none`, which is also accepted). */
	if (process.platform === "win32") {
		const brut = await executerPowerShell();
		r.check("vrai PowerShell : sortie lisible (coût réseau ou « none »)", /^(none|(Unrestricted|Fixed|Variable|Unknown) (True|False) (True|False) (True|False))\s*$/.test((brut ?? "").trim()), true);
	} else {
		r.check("hors Windows : aucun lancement, non limitée", await executerPowerShell(), null);
	}
	r.done();
});

/* EXPORTING AN INTERACTIVE PAGE (`apps/windows/electron/frame-export.ts`):
   "Copy as image" takes only a rectangle from the window, "Download as HTML"
   only a name and bounded bytes. Prevented: a capture of anything outside the
   window (or a malformed, NaN, negative or extra-keyed rectangle reaching
   `capturePage`), a capture loop, a saved page whose extension the window
   chose (`.bat`), a name that is a path or a device name, a page over the cap. */
await withSrcModule(["apps/windows/electron/frame-export.ts", "src/engine/html-frame-core.ts"], async ({ captureRect, htmlFileName, htmlBytes, htmlSaveTarget, createRateGate, FRAME_HTML_MAX_BYTES, CAPTURE_MIN_INTERVAL_MS }, core) => {
	const r = makeReporter("Interactive page export: rectangle, name, bytes, rate");
	const win = { width: 1200, height: 800 };
	r.check("a rectangle inside the window passes, rounded outward", captureRect({ x: 10.4, y: 20.6, width: 300.2, height: 100 }, 1, win), { x: 10, y: 20, width: 301, height: 101 });
	r.check("the zoom factor of the MAIN process scales CSS pixels to DIP", captureRect({ x: 10, y: 20, width: 100, height: 50 }, 1.25, win), { x: 12, y: 25, width: 126, height: 63 });
	r.check("the whole window passes", captureRect({ x: 0, y: 0, width: 1200, height: 800 }, 1, win), { x: 0, y: 0, width: 1200, height: 800 });
	r.check("one pixel of rounding past the edge is clamped, not refused", captureRect({ x: 0, y: 0, width: 1201, height: 800.5 }, 1, win), { x: 0, y: 0, width: 1200, height: 800 });
	r.check("a rectangle leaving the window is refused", [captureRect({ x: 1000, y: 0, width: 300, height: 10 }, 1, win), captureRect({ x: 0, y: 700, width: 10, height: 200 }, 1, win), captureRect({ x: 0, y: 0, width: 1000, height: 700 }, 1.5, win)], [null, null, null]);
	r.check("a negative origin is refused", [captureRect({ x: -1, y: 0, width: 10, height: 10 }, 1, win), captureRect({ x: 0, y: -5, width: 10, height: 10 }, 1, win)], [null, null]);
	r.check("an empty or negative size is refused", [captureRect({ x: 0, y: 0, width: 0, height: 10 }, 1, win), captureRect({ x: 0, y: 0, width: 10, height: -3 }, 1, win), captureRect({ x: 0, y: 0, width: 0.4, height: 10 }, 1, win)], [null, null, null]);
	r.check("non-finite or non-number values are refused",
		[NaN, Infinity, -Infinity, "10", null, undefined, 10n].map(v => captureRect({ x: v, y: 0, width: 10, height: 10 }, 1, win)), [null, null, null, null, null, null, null]);
	r.check("anything but a plain object of exactly four keys is refused",
		[captureRect(null, 1, win), captureRect([0, 0, 10, 10], 1, win), captureRect("0,0,10,10", 1, win), captureRect({ x: 0, y: 0, width: 10 }, 1, win), captureRect({ x: 0, y: 0, width: 10, height: 10, path: String.raw`C:\x` }, 1, win)], [null, null, null, null, null]);
	r.check("a bogus zoom is refused", [captureRect({ x: 0, y: 0, width: 10, height: 10 }, 0, win), captureRect({ x: 0, y: 0, width: 10, height: 10 }, NaN, win), captureRect({ x: 0, y: 0, width: 10, height: 10 }, 9, win), captureRect({ x: 0, y: 0, width: 10, height: 10 }, "1", win)], [null, null, null, null]);
	r.check("a window with no size refuses everything", captureRect({ x: 0, y: 0, width: 10, height: 10 }, 1, { width: 0, height: 0 }), null);

	r.check("a plain title gets .html", htmlFileName("Pile d'appel"), "Pile d'appel.html");
	r.check(".html is never doubled, .htm becomes .html", [htmlFileName("x.html"), htmlFileName("x.HTM")], ["x.html", "x.html"]);
	r.check("the window cannot choose the extension: .bat stays part of the name", htmlFileName("run.bat"), "run.bat.html");
	r.check("separators become dashes: a name, never a path", htmlFileName(String.raw`..\..\Startup\x`), "-..-Startup-x.html");
	r.check("forbidden characters and controls become dashes", htmlFileName('a:b*c?"<>|\u0001d'), "a-b-c------d.html");
	r.check("a Windows device name is refused", [htmlFileName("CON"), htmlFileName("nul.txt"), htmlFileName("com1.html")], [null, null, null]);
	r.check("an empty, dotted or non-string name is refused", [htmlFileName(""), htmlFileName(" . . "), htmlFileName(".html"), htmlFileName(42), htmlFileName(null)], [null, null, null, null, null]);
	r.check("a long name is cut to 100 characters before the extension", htmlFileName("a".repeat(300)), "a".repeat(100) + ".html");

	r.check("the cap is the frame page cap (200 KB)", [FRAME_HTML_MAX_BYTES, FRAME_HTML_MAX_BYTES === core.FRAME_MAX_BYTES], [200 * 1024, true]);
	r.check("bytes up to the cap pass", htmlBytes(new Uint8Array(FRAME_HTML_MAX_BYTES))?.length, FRAME_HTML_MAX_BYTES);
	r.check("cap + 1 byte, empty, or not bytes is refused", [htmlBytes(new Uint8Array(FRAME_HTML_MAX_BYTES + 1)), htmlBytes(new Uint8Array(0)), htmlBytes("<p>x</p>"), htmlBytes([60, 112])], [null, null, null, null]);

	let now = 0;
	const gate = createRateGate(CAPTURE_MIN_INTERVAL_MS, () => now);
	const seq = [gate()];
	now = 500; seq.push(gate());
	now = 999; seq.push(gate());
	now = 1000; seq.push(gate());
	now = 1001; seq.push(gate());
	r.check("one capture per second at most", [CAPTURE_MIN_INTERVAL_MS, seq], [1000, [true, false, false, true, false]]);

	const canaux = readFileSync(new URL("../apps/windows/electron/canaux.ts", import.meta.url), "utf8");
	const corps = canaux.slice(canaux.indexOf("CANAUX.frameImageCopy"), canaux.indexOf("CANAUX.frameHtmlSave"));
	r.check("the capture channel validates the rectangle and the rate BEFORE capturing, from the sender's own page",
		[/captureRect\(raw, e\.sender\.getZoomFactor\(\)/.test(corps), corps.indexOf("captureGate()") < corps.indexOf("capturePage"), /e\.sender\.capturePage\(rect\)/.test(corps), /clipboard\.write\(\[new ClipboardItem\(\{ "image\/png"/.test(corps)], [true, true, true, true]);
	const save = canaux.slice(canaux.indexOf("CANAUX.frameHtmlSave"), canaux.indexOf("const partageFichier"));
	r.check("the save channel writes only where the NATIVE dialog said, with .html forced and the target's flag",
		[/htmlFileName\(name\)/.test(save), /htmlBytes\(bytes\)/.test(save), /dialog\.showSaveDialog/.test(save), /htmlSaveTarget\(choice\.filePath\)/.test(save),
			/writeFile\(target\.path, content, \{ flag: target\.flag \}\)/.test(save), /=== "EEXIST"\) throw new Error\(/.test(save), (save.match(/writeFile\(/g) || []).length],
		[true, true, true, true, true, true, 1]);

	/* A name completed with `.html` AFTER the dialog was never confirmed there:
	   prevented, silently replacing an existing `x.html` the user never saw
	   when they typed `x`. Real files in a fresh temp folder. */
	r.check("a path the user picked as .html is written as is (the dialog asked before replacing)",
		[htmlSaveTarget(String.raw`C:\d\page.html`), htmlSaveTarget(String.raw`C:\d\page.HTML`)],
		[{ path: String.raw`C:\d\page.html`, flag: "w" }, { path: String.raw`C:\d\page.HTML`, flag: "w" }]);
	r.check("a completed name is created exclusively (wx), whatever the chosen extension",
		[htmlSaveTarget(String.raw`C:\d\page`), htmlSaveTarget(String.raw`C:\d\run.bat`), htmlSaveTarget(String.raw`C:\d\.html`), htmlSaveTarget(String.raw`C:\x.html\page`)],
		[{ path: String.raw`C:\d\page.html`, flag: "wx" }, { path: String.raw`C:\d\run.bat.html`, flag: "wx" }, { path: String.raw`C:\d\.html.html`, flag: "wx" }, { path: String.raw`C:\x.html\page.html`, flag: "wx" }]);
	const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "nq-check-frame-save-"));
	try {
		await writeFile(join(dir, "page.html"), "USER FILE");
		const target = htmlSaveTarget(join(dir, "page"));
		let code = null;
		try { await writeFile(target.path, "<p>page</p>", { flag: target.flag }); } catch (err) { code = err.code; }
		r.check("an existing file behind a completed name is refused (EEXIST) and left intact",
			[code, await readFile(join(dir, "page.html"), "utf8")], ["EEXIST", "USER FILE"]);
		const neuf = htmlSaveTarget(join(dir, "neuf"));
		await writeFile(neuf.path, "<p>new</p>", { flag: neuf.flag });
		r.check("a completed name with no file there is written", await readFile(join(dir, "neuf.html"), "utf8"), "<p>new</p>");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});
