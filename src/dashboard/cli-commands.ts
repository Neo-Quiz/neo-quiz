/* ══════════════════════════════════════════════════════════
   CLAUDE CODE'S OWN COMMANDS in the "/" menu of the AI page

   A live Claude Code session answers its `initialize` request with the list
   of its commands and skills (`response.commands`). The page keeps the last
   list it saw (in memory and in localStorage, so the menu has it before the
   first session of the next launch) and sends a command typed in the
   composer as it is, as a turn of the chat's live session.

   Everything here is PURE or storage-guarded: the list comes from a process
   and from a file on disk, so it is parsed as hostile input and never throws.
══════════════════════════════════════════════════════════ */

export interface CliCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const MAX_CLI_COMMANDS = 300;
export const CLI_COMMANDS_KEY = "neo-quiz.claudeCommands";
const NAME = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,63}$/;
/** The commands the app handles itself: Claude Code's namesakes are hidden. */
export const APP_COMMAND_NAMES: readonly string[] = ["exam", "clear", "model", "resume"];

// Control characters (C0, DEL, C1) removed, then cut to `max` code points.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
function clean(v: string, max: number): string {
	return [...v.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim()].slice(0, max).join("");
}

/** Reads a list of commands from untrusted data. Never throws; an item that
    is not well formed is dropped. */
export function parseCliCommands(v: unknown): CliCommand[] {
	if (!Array.isArray(v)) return [];
	const out: CliCommand[] = [];
	const seen = new Set<string>();
	for (const item of v.slice(0, MAX_CLI_COMMANDS)) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const o = item as Record<string, unknown>;
		const name = o.name;
		if (typeof name !== "string" || !NAME.test(name) || seen.has(name)) continue;
		seen.add(name);
		const c: CliCommand = { name, description: typeof o.description === "string" ? clean(o.description, 200) : "" };
		if (typeof o.argumentHint === "string") {
			const hint = clean(o.argumentHint, 100);
			if (hint) c.argumentHint = hint;
		}
		out.push(c);
	}
	return out;
}

/** The commands a stdout line of a Claude Code session carries, when it is
    the `control_response` to `initialize`; `null` for any other line. */
export function commandsFromLine(line: unknown): CliCommand[] | null {
	try {
		if (!line || typeof line !== "object") return null;
		const o = line as Record<string, unknown>;
		if (o.type !== "control_response") return null;
		const r = o.response as Record<string, unknown> | null | undefined;
		const inner = r && typeof r === "object" ? (r.response as Record<string, unknown> | null | undefined) : null;
		if (!inner || typeof inner !== "object" || !Array.isArray(inner.commands)) return null;
		return parseCliCommands(inner.commands);
	} catch {
		return null;
	}
}

/** The name of the Claude command a message starts with ("/review foo" with
    "review" known), else `null`: a name the app handles, an unknown name, or
    a slash that is not at the very start is an ordinary request. */
export function findCliCommand(text: string, known: readonly CliCommand[]): string | null {
	const m = text.trim().match(/^\/([A-Za-z0-9][A-Za-z0-9_:.-]{0,63})(?=\s|$)/);
	if (!m) return null;
	const name = m[1];
	if (APP_COMMAND_NAMES.includes(name.toLowerCase())) return null;
	return known.some(c => c.name === name) ? name : null;
}

/** The commands to list after the app's, filtered by what follows the "/". */
export function listCliCommands(known: readonly CliCommand[], prefix: string): CliCommand[] {
	const p = prefix.toLowerCase();
	return known.filter(c => !APP_COMMAND_NAMES.includes(c.name.toLowerCase()) && c.name.toLowerCase().startsWith(p));
}

let current: CliCommand[] | null = null;

function storage(): Storage | null {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The last list seen: memory first, else what the last launch stored. */
export function getCliCommands(): CliCommand[] {
	if (current) return current;
	let list: CliCommand[] = [];
	try {
		const raw = storage()?.getItem(CLI_COMMANDS_KEY);
		if (raw) list = parseCliCommands(JSON.parse(raw));
	} catch { list = []; }
	current = list;
	return list;
}

export function setCliCommands(list: CliCommand[]): void {
	current = list;
	try { storage()?.setItem(CLI_COMMANDS_KEY, JSON.stringify(list)); } catch { /* full or refused: memory only */ }
}
