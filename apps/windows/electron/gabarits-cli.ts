/* ══════════════════════════════════════════════════════════
   LES ARGUMENTS QU'UN CLI ACCEPTE DE LA FENÊTRE (2026-09-25).

   `process.run` ne jugeait que le NOM de l'outil : ses arguments venaient
   tels quels du rendu. Or le rendu est supposé compromis (`pont.ts`), et un
   CLI d'IA a des options qui LANCENT des commandes sans passer par le
   modèle : `--dangerously-skip-permissions`, `--mcp-config` (un serveur
   `{ "command": … }`) pour Claude Code, `--dangerously-bypass-approvals-and-
   sandbox` pour Codex. La règle « le CLI est lancé sans aucun outil » n'était
   tenue que par le code du rendu (revue de sécurité du 2026-09-25).

   Ce module est une LISTE BLANCHE DE FORMES : chaque appel légitime de
   `ai-client.ts` et `ai-providers.ts` a une forme fixe, dont seules trois
   pièces varient — un nom de modèle, un niveau d'effort, et des jetons liés
   au MARQUEUR de la requête. Tout le reste est comparé mot pour mot. Un
   argument de plus, de moins, ou déplacé : refusé. Ajouter une option à un
   appel du rendu exige donc de l'ajouter ICI — c'est voulu.

   PUR (ni Node ni Electron) : `npm run check:partage` l'éprouve.
══════════════════════════════════════════════════════════ */

/** Un nom de modèle : ne commence jamais par un tiret (ce serait une
    option), ni espace, ni `%`, ni guillemet. Couvre `claude-opus-4-1`,
    `gpt-5.1-codex`, `gemini-2.5-pro`, `opus[1m]`, `qwen3:8b`. */
const MODELE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/;
/** Un niveau d'effort Codex : `minimal`, `low`, `medium`, `high`, `xhigh`… */
const EFFORT = /^[a-z]{1,16}$/;
/** A level of `claude --effort`, exactly the ones its help lists. */
const EFFORT_CLAUDE = /^(low|medium|high|xhigh|max)$/;
/** Le marqueur de `nouveauMarqueur` (`src/host/jetons.ts`) : 32 hexadécimaux. */
const MARQUEUR = /^[0-9a-f]{32}$/;

/** Une pièce d'une forme : un mot exact, ou une valeur jugée. */
type Piece = string | ((arg: string) => boolean);

function correspond(args: readonly string[], forme: readonly Piece[]): boolean {
	return args.length === forme.length && forme.every((p, i) => typeof p === "string" ? args[i] === p : p(args[i]));
}

const modele = (a: string): boolean => MODELE.test(a);

/** The one launch of `codex app-server` (banked resets,
    `codex-resets.ts`): exactly one word. It is deliberately NOT accepted by
    `argumentsAutorises`: through `process.run` the window would own the stdin
    of an app-server, i.e. the whole JSON-RPC surface (command execution
    included). Only the main-process module launches it, and it speaks only
    `initialize`, `initialized` and one of two methods. */
export const ARGS_CODEX_APP_SERVER: readonly string[] = ["app-server"];

/* ── CLAUDE CODE WITH READ-ONLY TOOLS, IN A TRUSTED FOLDER (2026-10-09) ──

   The one form where the model has tools: it reads and searches the files of
   the quiz's folder itself, as in a terminal. The folder must have been
   trusted by the user through a NATIVE dialog (`confiance-ia.ts`); the
   window only asks. This form is only half of the rule: `canaux.ts` refuses
   it unless the call names a folder that is approved, inside the perimeter,
   and then runs the CLI with that folder as its working directory.

   Every option was checked against `claude --help` of Claude Code 2.1.296,
   and each layer was measured on that CLI (2026-10-09):
   - `--tools Read,Grep,Glob`: the only built-in tools the model is given.
     There is no `LS` tool in this version (`Glob` lists), and naming it
     changes nothing. No `WebFetch` / `WebSearch`: a course read in the
     folder could carry instructions that send its files to a URL.
   - `--allowedTools Read(./**)`: reads are pre-approved inside the working
     directory ONLY. A bare `Read` rule was measured to approve a read of
     `../outside/secret.txt`; the scoped rule is denied there.
   - `--disallowedTools …`: everything that writes, runs, delegates or talks
     to a server, MCP tools included (`mcp__*`). Even when the model calls
     `Write` or `Bash`, the CLI answers "No such tool available".
   - `--permission-mode dontAsk` and `--permission-prompts none`: anything
     not pre-approved is denied, nobody can approve it. Never
     `bypassPermissions`, never `--dangerously-skip-permissions`.
   - `--restricted`: a second, independent confinement of the file tools to
     the working directories, code-running tools removed, user / project /
     local settings ignored, `bypassPermissions` refused.
   - `--setting-sources ""` and `--settings {"disableAllHooks":true}`: no
     settings file of the folder or of the user applies, no hook runs.
   - `--strict-mcp-config --mcp-config {"mcpServers":{}}`: no MCP server,
     not even the account's connectors.
   - `--add-dir <attachments>`: only with pictures attached, and only the
     temporary folder the host wrote them in, named by its token. */

/** The read-only tools the model is given. */
export const OUTILS_LECTURE = "Read,Grep,Glob";
/** The pre-approved reads: inside the working directory only. */
export const LECTURE_AUTORISEE = "Read(./**)";
/** Everything denied by name, MCP included. */
export const OUTILS_INTERDITS = "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,WebFetch,WebSearch,mcp__*";
/** The settings passed inline: no hook may run. */
export const REGLAGES_SANS_HOOK = "{\"disableAllHooks\":true}";
/** An MCP configuration with no server at all. */
export const MCP_VIDE = "{\"mcpServers\":{}}";

/** The fixed tail of the tools form, after the model and the effort. */
const FIN_OUTILS: readonly string[] = [
	"--tools", OUTILS_LECTURE,
	"--allowedTools", LECTURE_AUTORISEE,
	"--disallowedTools", OUTILS_INTERDITS,
	"--permission-mode", "dontAsk",
	"--permission-prompts", "none",
	"--restricted",
	"--no-session-persistence",
	"--setting-sources", "",
	"--settings", REGLAGES_SANS_HOOK,
	"--strict-mcp-config",
	"--mcp-config", MCP_VIDE,
];

/** The head shared by both Claude forms: print mode, the stream, the model. */
function teteClaude(): Piece[] {
	return ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", modele];
}
const effortClaude: Piece[] = ["--effort", (e: string) => EFFORT_CLAUDE.test(e)];

/** True when `args` is the Claude Code call WITH read-only tools. The caller
    must then also check the folder (`canaux.ts`): this says nothing of
    where the CLI runs. */
export function argumentsAvecOutils(tool: string, args: unknown, marqueur: unknown): boolean {
	if (tool !== "claude" || !Array.isArray(args) || !args.every(a => typeof a === "string")) return false;
	const a = args as string[];
	const m = typeof marqueur === "string" && MARQUEUR.test(marqueur) ? marqueur : null;
	const pieces: Piece[] = m ? ["--add-dir", "{{nq-" + m + ":pieces}}"] : [];
	for (const avecEffort of [false, true]) {
		for (const avecPieces of m ? [false, true] : [false]) {
			const forme = [...teteClaude(), ...(avecEffort ? effortClaude : []), ...FIN_OUTILS, ...(avecPieces ? pieces : [])];
			if (correspond(a, forme)) return true;
		}
	}
	return false;
}

/** True when `args` is exactly the app-server launch. */
export function argumentsAppServer(tool: string, args: unknown): boolean {
	return tool === "codex" && Array.isArray(args) && args.length === ARGS_CODEX_APP_SERVER.length && args.every((a, i) => a === ARGS_CODEX_APP_SERVER[i]);
}

/** Vrai si `args` est un appel que la fenêtre a le droit de demander à
    `tool`. `marqueur` est celui de la requête : un jeton qui en porte un
    autre n'est pas reconnu. */
export function argumentsAutorises(tool: string, args: unknown, marqueur: unknown): boolean {
	if (!Array.isArray(args) || !args.every(a => typeof a === "string")) return false;
	const a = args as string[];
	// La sonde de version, commune aux quatre outils.
	if (correspond(a, ["--version"])) return true;
	/* The CLI's own update, for Claude Code and Codex only (2026-10-03, the
	   "update available" banner, `dashboard/cli-updates.ts`): one word, the
	   official command of each tool, nothing variable. */
	if ((tool === "claude" || tool === "codex") && correspond(a, ["update"])) return true;

	const m = typeof marqueur === "string" && MARQUEUR.test(marqueur) ? marqueur : null;
	const jeton = (nom: string): string => "{{nq-" + m + ":" + nom + "}}";

	switch (tool) {
		case "agy":
			return correspond(a, ["models"])
				|| correspond(a, ["--input-format", "stream-json", "--output-format", "stream-json"])
				|| correspond(a, ["--input-format", "stream-json", "--output-format", "stream-json", "--model", modele]);
		case "claude":
			/* `--tools` vaut "" (aucun outil) ou "Read", et Read seulement
			   quand des images sont jointes : le modèle les lit par leur jeton.
			   The output is a STREAM since 2026-09-29 (live transcript):
			   `stream-json` requires `--verbose` in print mode, and
			   `--include-partial-messages` adds the text as it is written.
			   Three output options, no capability: the plain `json` form is
			   gone, so there is still exactly one shape. */
			{
				// The read-only tools form, in a trusted folder (see above).
				if (argumentsAvecOutils(tool, a, marqueur)) return true;
				const tete = teteClaude();
				/* The composer's effort (2026-10-08): `--effort` and ONE of the
				   five levels the CLI documents, or nothing (the CLI's default).
				   A level only changes how long the model reasons. */
				const effort = effortClaude;
				const fin: Piece[] = [
					"--tools", (t: string) => t === "" || t === "Read",
					"--no-session-persistence", "--setting-sources", "",
					// No --mcp-config, and --strict-mcp-config: the account's connectors are not even listed.
					"--strict-mcp-config",
				];
				return correspond(a, [...tete, ...fin]) || correspond(a, [...tete, ...effort, ...fin]);
			}
		case "codex": {
			if (m === null) return false;
			const tete: Piece[] = ["exec", "--json", "-m", modele, "-c", (c: string) => c.startsWith("model_reasoning_effort=") && EFFORT.test(c.slice("model_reasoning_effort=".length))];
			const rapide: Piece[] = ["-c", "service_tier=priority"];
			const fin: Piece[] = ["-s", "read-only", "--skip-git-repo-check", "--ignore-user-config", "-C", jeton("home"), "-o", jeton("sortie")];
			for (const avecRapide of [false, true]) {
				const base = [...tete, ...(avecRapide ? rapide : []), ...fin];
				if (a.length < base.length || (a.length - base.length) % 2 !== 0) continue;
				if (!correspond(a.slice(0, base.length), base)) continue;
				// Les images jointes : « -i <jeton du fichier n> », n = 1, 2, 3… dans l'ordre.
				const images = a.slice(base.length);
				let ok = true;
				for (let i = 0; i < images.length; i += 2) {
					if (images[i] !== "-i" || images[i + 1] !== jeton("fichier:" + String(i / 2 + 1))) { ok = false; break; }
				}
				if (ok) return true;
			}
			return false;
		}
		default:
			// Ollama ne passe pas par `process.run` (son API HTTP, `net.fetchJson`).
			return false;
	}
}
