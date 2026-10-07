/**
 * The Android bridge, seen from three sides at once, without a device:
 *
 *  1. every channel the shim sends (`apps/android/web/shim.ts`, `appeler("x.y"`)
 *     has a Kotlin entry in `Channels.ALL`, and every entry of `Channels.ALL` is
 *     sent by the shim: a channel nobody sends is dead code, a channel nobody
 *     handles answers `unknown-channel` on a phone and nowhere else. The one
 *     tolerated gap: an OPTIONAL group of `Pont` (`sync?`) that the shim has not
 *     implemented yet may be listed by Kotlin ahead of its shim;
 *  2. every method of the `Pont` interface (`apps/windows/electron/pont.ts`)
 *     exists in the shim object (the compiler already insists, this names the
 *     method), and the shim has no method `Pont` lacks;
 *  3. the Kotlin copy of `EXTENSIONS_EXECUTABLES` (`ExecutableExtensions.kt`,
 *     what `systeme.ouvrir` refuses) equals the Windows one: a list that drifts
 *     silently opens a file the other platform refuses.
 *
 *     npm run check:android-pont
 *
 * Exit code only (`process.exitCode`, never `process.exit()`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const SHIM = "apps/android/web/shim.ts";
const CHANNELS = "apps/android/app/src/main/java/com/ahmedmili/neoquiz/bridge/Channels.kt";
const EXTENSIONS = "apps/android/app/src/main/java/com/ahmedmili/neoquiz/bridge/ExecutableExtensions.kt";
const PONT = "apps/windows/electron/pont.ts";
const RESSOURCES = "apps/windows/electron/ressources.ts";

/** Block and line comments out (a `//` right after `:` is a URL, not a comment). */
export function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
}

/** Index of the `}` / `)` / `]` closing the opener at `open`. */
function matching(src, open) {
	const pairs = { "{": "}", "(": ")", "[": "]" };
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c in pairs) depth++;
		else if (c === "}" || c === ")" || c === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	throw new Error("unbalanced block");
}

/** End of the member starting at `from`: the next `;` or `,` outside any bracket. */
function memberEnd(src, from) {
	let depth = 0;
	for (let i = from; i < src.length; i++) {
		const c = src[i];
		// `<` / `>` count too (`EnveloppeVideo<A, B>` holds a comma), except the `>` of `=>`.
		if (c === "{" || c === "(" || c === "[" || c === "<") depth++;
		else if (c === "}" || c === ")" || c === "]" || (c === ">" && src[i - 1] !== "=")) depth--;
		else if (depth === 0 && (c === ";" || c === ",")) return i;
	}
	return src.length;
}

/**
 * The leaf members of an object type / object literal, as dotted paths
 * (`fichiers.read`, `surveiller`). A member whose value starts with `{` is a
 * group; anything else is a leaf. `optional` collects the dotted paths of the
 * groups declared with `?`.
 */
export function leafPaths(body, prefix = "", leaves = new Set(), optional = new Set()) {
	let i = 0;
	while (i < body.length) {
		while (i < body.length && /[\s,;]/.test(body[i])) i++;
		if (i >= body.length) break;
		const m = /^(?:async\s+)?([A-Za-z_$][\w$]*)(\?)?/.exec(body.slice(i));
		if (!m) throw new Error(`cannot parse a member near: ${body.slice(i, i + 60)}`);
		const path = prefix + m[1];
		i += m[0].length;
		let k = i;
		while (/\s/.test(body[k] ?? "")) k++;
		if (body[k] === ":") {
			k++;
			while (/\s/.test(body[k] ?? "")) k++;
			if (body[k] === "{") {
				const close = matching(body, k);
				if (m[2]) optional.add(path);
				leafPaths(body.slice(k + 1, close), path + ".", leaves, optional);
				i = close + 1;
				continue;
			}
		}
		leaves.add(path);
		i = memberEnd(body, i);
	}
	return { leaves, optional };
}

/** The text between the braces of the first `{` found after `marker`. */
function blockAfter(src, marker) {
	const at = src.indexOf(marker);
	if (at < 0) throw new Error(`marker not found: ${marker}`);
	const open = src.indexOf("{", at + marker.length);
	return src.slice(open + 1, matching(src, open));
}

const strings = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const failures = [];
const fail = (msg) => failures.push(msg);
const show = (set) => [...set].sort().join(", ");

function main() {
	const shim = stripComments(read(SHIM));
	const pont = stripComments(read(PONT));

	// 1. channels
	const sent = new Set([...shim.matchAll(/appeler(?:<[^()]*>)?\(\s*"([A-Za-z.]+)"/g)].map((m) => m[1]));
	const kotlinSrc = stripComments(read(CHANNELS));
	const listed = new Set(strings(kotlinSrc.slice(kotlinSrc.indexOf("setOf("))));
	if (sent.size === 0) fail("no channel found in the shim (parser broken?)");
	if (listed.size === 0) fail("no channel found in Channels.ALL (parser broken?)");

	const { leaves: pontLeaves, optional: pontOptional } = leafPaths(blockAfter(pont, "export interface Pont"));
	const { leaves: shimLeaves } = leafPaths(blockAfter(shim, "const pont: Pont ="));
	const optionalMissing = (path) => [...pontOptional].some((g) => path.startsWith(g + ".") && ![...shimLeaves].some((l) => l.startsWith(g + ".")));

	const unhandled = [...sent].filter((c) => !listed.has(c));
	if (unhandled.length) fail(`the shim sends channels Kotlin does not list (Channels.ALL): ${show(unhandled)}`);
	const unsent = [...listed].filter((c) => !sent.has(c) && !optionalMissing(c));
	if (unsent.length) fail(`Channels.ALL lists channels the shim never sends: ${show(unsent)}`);

	// 2. Pont against the shim
	const notImplemented = [...pontLeaves].filter((p) => !shimLeaves.has(p) && !optionalMissing(p));
	if (notImplemented.length) fail(`Pont methods the shim does not implement: ${show(notImplemented)}`);
	const unknown = [...shimLeaves].filter((p) => !pontLeaves.has(p));
	if (unknown.length) fail(`shim methods Pont does not declare: ${show(unknown)}`);

	// 3. executable extensions
	const ressources = stripComments(read(RESSOURCES));
	const setStart = ressources.indexOf("EXTENSIONS_EXECUTABLES");
	const windows = new Set(strings(ressources.slice(setStart, ressources.indexOf("]);", setStart))));
	const kotlin = read(EXTENSIONS);
	const begin = kotlin.indexOf("// WINDOWS-LIST-BEGIN");
	const end = kotlin.indexOf("// WINDOWS-LIST-END");
	if (begin < 0 || end < begin) fail("WINDOWS-LIST markers missing in ExecutableExtensions.kt");
	else {
		const copy = new Set(strings(kotlin.slice(begin, end)));
		if (windows.size === 0) fail("no extension found in ressources.ts (parser broken?)");
		const missing = [...windows].filter((e) => !copy.has(e));
		const extra = [...copy].filter((e) => !windows.has(e));
		if (missing.length) fail(`ExecutableExtensions.kt lacks extensions that ressources.ts refuses: ${show(missing)}`);
		if (extra.length) fail(`ExecutableExtensions.kt refuses extensions ressources.ts does not: ${show(extra)}`);
	}

	// 4. sharing: the Kotlin copies of the share rules equal the TypeScript ones
	const partage = read("apps/windows/electron/partage.ts");
	const share = read("apps/android/app/src/main/java/com/ahmedmili/neoquiz/bridge/ShareChannel.kt");
	const incoming = read("apps/android/app/src/main/java/com/ahmedmili/neoquiz/bridge/IncomingRules.kt");
	const zipTs = read("src/dashboard/zip.ts");
	// The forbidden-character class: TS `.replace(/[...]/g, "-")`, Kotlin `FORBIDDEN = Regex("[...]")` (string escapes undone).
	const tsClass = /\.replace\(\/(\[[^\n]*?\])\/g, "-"\)/.exec(partage)?.[1];
	const ktString = /FORBIDDEN = Regex\("((?:[^"\\]|\\.)*)"\)/.exec(share)?.[1];
	const ktClass = ktString?.replace(/\\(["\\])/g, "$1");
	if (!tsClass || !ktClass) fail("share name class not found (parser broken?)");
	else if (tsClass !== ktClass) fail(`share forbidden-character class differs: TS ${tsClass} / Kotlin ${ktClass}`);
	const tsMax = /SHARE_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(zipTs)?.[1];
	const ktMax = /MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(share)?.[1];
	if (!tsMax || tsMax !== ktMax) fail(`share bound differs: TS ${tsMax} MB / Kotlin ${ktMax} MB`);
	const tsArchive = /archive: (\d+) \* 1024 \* 1024/.exec(zipTs)?.[1];
	const ktArchive = /MAX_BYTES = (\d+)L \* 1024 \* 1024/.exec(incoming)?.[1];
	if (!tsArchive || tsArchive !== ktArchive) fail(`import bound differs: TS ${tsArchive} MB / Kotlin ${ktArchive} MB`);
	const tsExt = [...(/EXTENSIONS_PARTAGE = \[([^\]]*)\]/.exec(partage)?.[1] ?? "").matchAll(/"\.(\w+)"/g)].map((m) => m[1]).sort().join();
	const ktExt = [...(/EXTENSIONS = mapOf\(([^)]*)\)/.exec(share)?.[1] ?? "").matchAll(/"(\w+)" to/g)].map((m) => m[1]).sort().join();
	if (!tsExt || tsExt !== ktExt) fail(`share extensions differ: TS ${tsExt} / Kotlin ${ktExt}`);
	// Windows device names: the reserved-name pattern of share-names.ts equals the Kotlin copy (string escapes undone).
	const tsReserved = /const RESERVED = \/(.*)\/i;/.exec(read("src/dashboard/share-names.ts"))?.[1];
	const ktReserved = /RESERVED = Regex\("((?:[^"\\]|\\.)*)"/.exec(share)?.[1]?.replace(/\\\\/g, "\\");
	if (!tsReserved || !ktReserved) fail("reserved-name pattern not found (parser broken?)");
	else if (tsReserved !== ktReserved) fail(`reserved-name pattern differs: TS ${tsReserved} / Kotlin ${ktReserved}`);
	// The staging folder of an import is ignored by Syncthing on both platforms.
	for (const [who, file] of [["Windows", "apps/windows/electron/syncthing-regles.ts"], ["Android", "apps/android/app/src/main/java/com/ahmedmili/neoquiz/sync/ShareRules.kt"]]) {
		if (!read(file).includes('"(?d).import-*"')) fail(`${who} .stignore lacks the import staging rule "(?d).import-*"`);
	}

	console.log(`check:android-pont  channels sent ${sent.size}, listed ${listed.size}, Pont leaves ${pontLeaves.size}, shim leaves ${shimLeaves.size}, executable extensions ${windows.size}`);
}

try {
	main();
} catch (e) {
	fail(`check crashed: ${e instanceof Error ? e.message : e}`);
}
if (failures.length) {
	for (const f of failures) console.error("FAIL " + f);
	process.exitCode = 1;
} else {
	console.log("OK");
}
