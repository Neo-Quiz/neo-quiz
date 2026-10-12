/**
 * The full AI work view of a live session: draws a `Thread`
 * (src/dashboard/live-thread.ts) into a root element, one row per tool call
 * like Claude Code (`Read(lib\a.ts · lines 1-120)`, a `└` summary line),
 * consecutive calls of one family folded into one row (MonoCode).
 *
 * Every string here comes from the CLI (model text, tool names, tool input,
 * tool output, permission requests): it is untrusted. Each one is written
 * with `textContent` and never with `innerHTML`, never through a sanitizer
 * gate. The command colours come from refractor's hast tree, rebuilt here
 * node by node. The check is `scripts/check-work-view.mjs`.
 *
 * Re-rendering is keyed by row index: a row whose JSON is unchanged keeps
 * its node (and whatever the user already expanded or answered in it); only
 * a changed or new row is rebuilt, and it keeps the expanded state of the
 * node it replaces. A thread that shrinks drops its tail.
 */
import { libelleComptes } from "./question-count";
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import powershell from "refractor/powershell";
import markup from "refractor/markup";
import css from "refractor/css";
import javascript from "refractor/javascript";
import typescript from "refractor/typescript";
import python from "refractor/python";
import json from "refractor/json";
import markdown from "refractor/markdown";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { PREVIEW_LINES, type Thread, type ThreadItem } from "./live-thread";
import { codeLanguageOf, codeLanguageBadgeSrc } from "../code-catalogue";
import { prettyHtml } from "./pretty-code";
import { quizProgress } from "./transcript";

refractor.register(bash);
refractor.register(powershell);
refractor.register(markup);
refractor.register(css);
refractor.register(javascript);
refractor.register(typescript);
refractor.register(python);
refractor.register(json);
refractor.register(markdown);

/** File extension to grammar for the diff lines; an unknown extension stays plain text. */
const DIFF_LANGUAGES = new Map<string, string>([
	["md", "markdown"], ["markdown", "markdown"], ["html", "markup"], ["htm", "markup"], ["xml", "markup"], ["svg", "markup"],
	["css", "css"], ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
	["ts", "typescript"], ["tsx", "typescript"], ["py", "python"], ["json", "json"],
]);

export interface WorkViewDeps {
	/** The full output of one tool call, fetched on demand (null if gone). */
	loadOutput(toolId: string): Promise<string | null>;
	/** A permission answer; sent once per request. */
	answer(requestId: string, allow: boolean): void;
	/** The absolute Neo Quiz root (Windows path). Paths inside it are shown relative to it. */
	root?: string;
	/** Opens a file with the app that owns it. Only called with an absolute path inside `root`. */
	openFile?(absPath: string): void;
	/** A quiz generation: every assistant text is the quiz being written (JSON5 or
	    HTML), so it is shown as a one-line summary, never as text. */
	summarizeText?: boolean;
}

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;
type ThinkingItem = Extract<ThreadItem, { kind: "thinking" }>;
type Family = "read" | "run" | "search";
type Entry = { kind: "item"; item: ThreadItem } | { kind: "group"; family: Family; items: ToolItem[] };
/** A title segment: plain text, or a path (clickable when it is a file in the root). */
type Segment = string | { path: string; file: boolean };

/** The signature of the row each node was built from, to skip unchanged ones. */
const SIGNATURE = new WeakMap<HTMLElement, string>();
/** When each live thinking row started (ms), carried over to its rebuilt node. */
const SINCE = new WeakMap<HTMLElement, number>();
/** The one timer that refreshes the elapsed counter of a running thread. */
const TICKERS = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>();

const NOTICE_KEYS: Record<string, "ai.work.interrupted" | "ai.work.truncated" | "ai.work.resumed"> = {
	interrupted: "ai.work.interrupted",
	truncated: "ai.work.truncated",
	resumed: "ai.work.resumed",
};

/** Token colours of the app's code blocks (quiz-card.css, `--qmc-*`), applied to a command. */
const COMMAND_LIMIT = 20000;
const TITLE_LIMIT = 80;
const COMMAND_LANGUAGES: Record<string, string> = { Bash: "bash", commandExecution: "bash", PowerShell: "powershell" };

interface HastNode { type: string; value?: string; children?: HastNode[]; properties?: { className?: unknown } }

/** True while a row of the thread is itself live (a running call, the thinking,
    a quiz being written, or prose streaming): the page's "Working" line then
    stays hidden, so no second spinner shows under a live row. */
export function threadHasLiveRow(thread: Thread): boolean {
	if (!thread.running) return false;
	const last = thread.items[thread.items.length - 1];
	if (!last) return false;
	if (thread.items.some(i => i.kind === "tool" && i.status === "running")) return true;
	if (last.kind === "thinking" || last.kind === "text") return true;
	return false;
}

export function renderThread(root: HTMLElement, thread: Thread, deps: WorkViewDeps): void {
	root.classList.add("qbd-work");
	const entries = groupItems(thread.items);
	const last = entries.length - 1;
	// A permission waiting for an answer: its command row opens to show what is approved.
	const awaiting = thread.items.some(i => i.kind === "permission" && i.state === "pending");
	entries.forEach((entry, i) => {
		const live = thread.running && i === last;
		// `running` (not only `live`): a summarised quiz row animates while the turn runs, wherever it sits.
		const signature = (live ? "1" : "0") + (awaiting ? "1" : "0") + (thread.running ? "1" : "0") + JSON.stringify(entry.kind === "item" ? entry.item : entry.items);
		const current = root.children.item(i) as HTMLElement | null;
		if (current && SIGNATURE.get(current) === signature) return;
		const fresh = buildEntry(entry, current ?? undefined, deps, live, awaiting, thread.running);
		SIGNATURE.set(fresh, signature);
		if (current) root.replaceChild(fresh, current);
		else root.appendChild(fresh);
	});
	while (root.children.length > entries.length) {
		root.removeChild(root.lastElementChild as Element);
	}
	const liveThinking = thread.running && last >= 0 && entries[last].kind === "item" && (entries[last] as { item: ThreadItem }).item.kind === "thinking";
	syncTicker(root, liveThinking);
}

// --- Grouping -------------------------------------------------------------------

/** Consecutive calls of one family fold into one row. Only a call that finished
    OK is folded: a running, failed or refused call stays a row of its own, so
    it is never hidden inside a collapsed group. */
function groupItems(items: ThreadItem[]): Entry[] {
	const out: Entry[] = [];
	for (const item of items) {
		const family = item.kind === "tool" && item.status === "ok" ? familyOf(item) : null;
		const prev = out[out.length - 1];
		if (family && prev?.kind === "group" && prev.family === family) {
			prev.items.push(item as ToolItem);
		} else if (family && prev?.kind === "item" && prev.item.kind === "tool" && prev.item.status === "ok" && familyOf(prev.item) === family) {
			out[out.length - 1] = { kind: "group", family, items: [prev.item, item as ToolItem] };
		} else {
			out.push({ kind: "item", item });
		}
	}
	return out;
}

function familyOf(item: ToolItem): Family | null {
	if (item.name === "Read") return "read";
	if (item.name === "Bash" || item.name === "PowerShell" || item.name === "commandExecution") return "run";
	if (item.name === "Grep" || item.name === "Glob") return "search";
	return null;
}

// --- Rows -----------------------------------------------------------------------

function buildEntry(entry: Entry, prev: HTMLElement | undefined, deps: WorkViewDeps, live: boolean, awaiting: boolean, running: boolean): HTMLElement {
	if (entry.kind === "group") return groupBlock(entry.family, entry.items, deps, prev);
	return buildItem(entry.item, deps, live, prev, awaiting, running);
}

function buildItem(item: ThreadItem, deps: WorkViewDeps, live: boolean, prev: HTMLElement | undefined, awaiting: boolean, running: boolean): HTMLElement {
	switch (item.kind) {
		case "user":
			return textBlock("qbd-work-item qbd-work-user", item.text);
		case "text":
			return deps.summarizeText ? writtenRow(item.text, running) : textItem(item.text, live);
		case "thinking":
			return thinkingBlock(item, live, prev);
		case "notice":
			return noticeBlock(item.text);
		case "tool":
			return toolBlock(item, deps, prev, awaiting);
		case "permission":
			return permissionBlock(item, deps);
	}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function textBlock(className: string, text: string): HTMLElement {
	const block = el("div", className);
	block.appendChild(el("div", "qbd-work-body", text));
	return block;
}

function thinkingBlock(item: ThinkingItem, live: boolean, prev: HTMLElement | undefined): HTMLElement {
	const block = el("div", "qbd-work-item qbd-work-thinking");
	const label = el("div", "qbd-work-label");
	if (live) {
		const since = prev && SINCE.has(prev) ? (SINCE.get(prev) as number) : Date.now();
		SINCE.set(block, since);
		label.appendChild(el("span", "qbd-work-thinking-label is-live", t("ai.work.thinking")));
		label.appendChild(el("span", "qbd-work-sep", " · "));
		const elapsed = el("span", "qbd-work-elapsed", formatElapsed(Date.now() - since));
		elapsed.setAttribute("data-since", String(since));
		label.appendChild(elapsed);
	} else {
		label.appendChild(el("span", "qbd-work-thinking-label", thoughtLabel(item)));
	}
	if (item.tokens) {
		label.appendChild(el("span", "qbd-work-sep", " · "));
		label.appendChild(el("span", "qbd-work-tokens", t("ai.work.thinkingTokens", { n: item.tokens })));
	}
	block.appendChild(label);
	if (item.text) block.appendChild(el("div", "qbd-work-body", item.text));
	return block;
}

/** A finished thinking row: its duration when the stream gave both ends, else "Thought". */
function thoughtLabel(item: ThinkingItem): string {
	if (item.started !== undefined && item.ended !== undefined && item.ended - item.started >= 1000) {
		return t("ai.work.thoughtFor", { time: formatElapsed(item.ended - item.started) });
	}
	return t("ai.work.thought");
}

function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Refreshes the elapsed counter of a live thinking row once a second; the
    timer stops when the thread is no longer running or its root is detached. */
function syncTicker(root: HTMLElement, live: boolean): void {
	const timer = TICKERS.get(root);
	if (live && timer === undefined) {
		const id = setInterval(() => tick(root, id), 1000);
		TICKERS.set(root, id);
	} else if (!live && timer !== undefined) {
		clearInterval(timer);
		TICKERS.delete(root);
	}
}

function tick(root: HTMLElement, id: ReturnType<typeof setInterval>): void {
	if (root.isConnected === false) {
		clearInterval(id);
		TICKERS.delete(root);
		return;
	}
	const now = Date.now();
	root.querySelectorAll(".qbd-work-elapsed").forEach(node => {
		const since = Number(node.getAttribute("data-since"));
		if (Number.isFinite(since)) node.textContent = formatElapsed(now - since);
	});
}

function noticeBlock(text: string): HTMLElement {
	const key = NOTICE_KEYS[text];
	// A notice text is a key from our own code; anything else is shown as-is,
	// which is still safe because it goes through textContent.
	return el("div", "qbd-work-item qbd-work-notice", key ? t(key) : text);
}

function groupBlock(family: Family, items: ToolItem[], deps: WorkViewDeps, prev: HTMLElement | undefined): HTMLElement {
	const block = el("div", "qbd-work-item qbd-work-group");
	const count = items.length;
	const title = family === "read" ? "ai.work.groupRead" : family === "run" ? "ai.work.groupRun" : "ai.work.groupSearch";
	const head = el("div", "qbd-work-group-head");
	head.appendChild(statusDot(groupDotState(items)));
	head.appendChild(el("span", "qbd-work-group-title", t(title, { count })));
	head.appendChild(chevron());
	const body = el("div", "qbd-work-group-body");
	const prevBody = prev?.children.item(1) as HTMLElement | null | undefined;
	items.forEach((item, i) => body.appendChild(toolBlock(item, deps, prevBody?.children.item(i) as HTMLElement | undefined, false)));
	const open = prev ? prev.classList.contains("is-open") : false;
	setOpen(block, body, open);
	expandable(head, block, body);
	block.appendChild(head);
	block.appendChild(body);
	return block;
}

/** Makes a head row open its body on click or Enter/Space, with the chevron that shows it. */
function expandable(head: HTMLElement, block: HTMLElement, body: HTMLElement, onOpen?: () => void): void {
	head.classList.add("is-expandable");
	if (!head.querySelector(".qbd-work-chevron")) head.appendChild(chevron());
	toggleOn(head, () => {
		const open = !block.classList.contains("is-open");
		if (open) onOpen?.();
		setOpen(block, body, open);
	});
}

/** A Lucide chevron; CSS turns it when its row is open. */
function chevron(): HTMLElement {
	const node = el("span", "qbd-work-chevron");
	currentHost().ui.setIcon(node, "chevron-right");
	return node;
}

function setOpen(block: HTMLElement, body: HTMLElement, open: boolean): void {
	body.hidden = !open;
	if (open) block.classList.add("is-open");
	else block.classList.remove("is-open");
}

/** A row that opens and closes on a click or on Enter/Space. */
function toggleOn(trigger: HTMLElement, onToggle: () => void): void {
	trigger.tabIndex = 0;
	trigger.setAttribute("role", "button");
	trigger.addEventListener("click", onToggle);
	trigger.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onToggle();
		}
	});
}

function monoPre(text: string, className = "qbd-work-pre"): HTMLPreElement {
	return el("pre", className, text);
}

// --- Tool calls -----------------------------------------------------------------

/** Collapsed by default, Bash included: the title and the `└` line show it.
    The one exception is a running command whose permission is still asked:
    it opens, so the owner sees the command he approves. A row the user
    already opened or closed keeps that state. */
function toolBlock(item: ToolItem, deps: WorkViewDeps, prev: HTMLElement | undefined, awaiting: boolean): HTMLElement {
	const isRun = familyOf(item) === "run";
	const block = el("div", "qbd-work-item qbd-work-tool");
	const open = prev ? prev.classList.contains("is-open") : awaiting && isRun && item.status === "running";

	const head = el("div", "qbd-work-tool-head");
	head.appendChild(statusDot(toolDotState(item, awaiting)));
	const title = el("span", "qbd-work-title");
	appendTitle(title, item, deps);
	head.appendChild(title);
	block.appendChild(head);

	const summary = summaryNode(item);
	if (summary) block.appendChild(summary);

	// The body is built on first open: a failed call's full message is not in
	// the DOM before the row is expanded, and is never shown twice.
	const body = el("div", "qbd-work-tool-body");
	let built = false;
	const build = () => {
		if (built) return;
		built = true;
		if (isRun && item.input) body.appendChild(commandNode(item.input, COMMAND_LANGUAGES[item.name] ?? "bash"));
		if (item.diff) body.appendChild(diffNode(item, item.diff));
		const output = renderOutput(item, deps);
		if (output) body.appendChild(output);
	};
	if (open) build();
	setOpen(block, body, open);
	const hasBody = (isRun && item.input !== "") || item.diff !== null || item.preview !== "" || item.lines > 0;
	if (hasBody) expandable(head, block, body, build);
	block.appendChild(body);
	return block;
}

type DotState = "ok" | "error" | "running" | "waiting";
const DOT_LABELS: Record<DotState, "ai.work.dotOk" | "ai.work.dotError" | "ai.work.dotRunning" | "ai.work.dotWaiting"> = {
	ok: "ai.work.dotOk",
	error: "ai.work.dotError",
	running: "ai.work.dotRunning",
	waiting: "ai.work.dotWaiting",
};

/** The status of a row: a small dot, green, red, pulsing grey, or amber while waiting. */
function statusDot(state: DotState): HTMLElement {
	const dot = el("span", "qbd-work-dot is-" + state);
	dot.setAttribute("role", "img");
	dot.setAttribute("aria-label", t(DOT_LABELS[state]));
	return dot;
}

function toolDotState(item: ToolItem, awaiting: boolean): DotState {
	if (item.status === "running") return awaiting ? "waiting" : "running";
	return item.status === "ok" ? "ok" : "error";
}

/** A group is green when all its calls succeeded, red when one failed, grey while one runs. */
function groupDotState(items: ToolItem[]): DotState {
	if (items.some(i => i.status === "running")) return "running";
	return items.some(i => i.status === "error" || i.status === "refused") ? "error" : "ok";
}

const BASH_VERBS = new Set(["Bash", "PowerShell", "commandExecution"]);

/** The title: `Name(args)`, with the args Claude Code shows for each tool. */
function titleSegments(item: ToolItem, deps: WorkViewDeps): { verb: string; args: Segment[] } {
	if (item.name === "fileChange") {
		const paths = item.input.split("\n").filter(p => p !== "");
		return { verb: t("ai.work.verbEdit"), args: joinSegments(paths.map(p => ({ path: p, file: true }))) };
	}
	if (BASH_VERBS.has(item.name)) {
		return { verb: item.name === "PowerShell" ? "PowerShell" : "Bash", args: [ellipsize(firstLine(item.input), TITLE_LIMIT)] };
	}
	const input = parseInput(item.input);
	switch (item.name) {
		case "Read": {
			const path = str(input.file_path) || str(input.path);
			const args: Segment[] = [{ path, file: true }];
			const range = lineRange(input.offset, input.limit);
			if (range) args.push(" · " + range);
			return { verb: t("ai.work.verbRead"), args };
		}
		case "Write":
			return { verb: t("ai.work.verbWrite"), args: [{ path: str(input.file_path), file: true }] };
		case "Edit":
		case "MultiEdit":
			return { verb: t("ai.work.verbEdit"), args: [{ path: str(input.file_path), file: true }] };
		case "Grep": {
			const args: Segment[] = [`"${ellipsize(str(input.pattern), TITLE_LIMIT)}"`];
			const path = str(input.path);
			if (path) args.push(t("ai.work.inPath"), { path, file: false });
			return { verb: t("ai.work.verbSearch"), args };
		}
		case "Glob":
			return { verb: t("ai.work.verbFind"), args: [ellipsize(str(input.pattern), TITLE_LIMIT)] };
		case "WebFetch":
			return { verb: t("ai.work.verbFetch"), args: [ellipsize(str(input.url), TITLE_LIMIT)] };
		case "WebSearch":
			return { verb: t("ai.work.verbWebSearch"), args: [`"${ellipsize(str(input.query), TITLE_LIMIT)}"`] };
	}
	void deps;
	const short = ellipsize(item.input.replace(/\s+/g, " ").trim(), TITLE_LIMIT);
	return { verb: item.name, args: short ? [short] : [] };
}

function appendTitle(node: HTMLElement, item: ToolItem, deps: WorkViewDeps): void {
	const { verb, args } = titleSegments(item, deps);
	node.appendChild(el("span", "qbd-work-tool-name", verb));
	if (args.length === 0) return;
	// The arguments in monospace, the tool's name in the UI font (as MonoCode).
	const arg = el("span", "qbd-work-arg");
	arg.appendChild(document.createTextNode("("));
	for (const seg of args) {
		if (typeof seg === "string") arg.appendChild(document.createTextNode(seg));
		else arg.appendChild(pathNode(seg, deps));
	}
	arg.appendChild(document.createTextNode(")"));
	node.appendChild(arg);
}

function joinSegments(paths: Segment[]): Segment[] {
	const out: Segment[] = [];
	paths.forEach((p, i) => {
		if (i > 0) out.push(", ");
		out.push(p);
	});
	return out;
}

/** A path inside the root is shown relative to it, with Windows backslashes.
    It is clickable only for a file, inside the root, and when the view has `openFile`. */
function pathNode(seg: { path: string; file: boolean }, deps: WorkViewDeps): HTMLElement {
	const absolute = toWindows(seg.path);
	const rel = relativeToRoot(absolute, deps.root);
	if (seg.file && rel !== null && deps.openFile) {
		const link = el("span", "qbd-work-path is-link", rel);
		const open = () => deps.openFile?.(absolute);
		link.tabIndex = 0;
		link.setAttribute("role", "link");
		link.addEventListener("click", e => {
			e.stopPropagation();
			open();
		});
		link.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.stopPropagation();
				open();
			}
		});
		return link;
	}
	return el("span", "qbd-work-path", rel ?? absolute);
}

/** The path relative to the root, or null when it is outside it (or not absolute). */
function relativeToRoot(absolute: string, root: string | undefined): string | null {
	const r = root ? toWindows(root) : "";
	if (!r || !/^[a-zA-Z]:\\/.test(absolute) || absolute.split("\\").includes("..")) return null;
	if (absolute.toLowerCase().startsWith(r.toLowerCase() + "\\")) return absolute.slice(r.length + 1);
	return null;
}

function toWindows(p: string): string {
	return p.replace(/\//g, "\\").replace(/\\+$/, "");
}

function lineRange(offset: unknown, limit: unknown): string {
	const from = numOf(offset);
	const count = numOf(limit);
	if (count !== undefined) return t("ai.work.lineRange", { from: from ?? 1, to: (from ?? 1) + count - 1 });
	if (from !== undefined) return t("ai.work.lineFrom", { from });
	return "";
}

/** The `└` line under a title: the change, the size of the output, or the error. */
function summaryNode(item: ToolItem): HTMLElement | null {
	const s = summaryOf(item);
	if (!s) return null;
	const line = el("div", s.error ? "qbd-work-summary is-error" : "qbd-work-summary");
	line.appendChild(el("span", "qbd-work-branch", "└"));
	const text = el("span", "qbd-work-summary-text", s.text);
	if (s.full && s.full !== s.text) text.setAttribute("title", s.full);
	line.appendChild(text);
	return line;
}

function firstSentence(s: string): string {
	const m = /^(.+?[.!?])(\s|$)/.exec(s);
	return m ? m[1] : s;
}

function summaryOf(item: ToolItem): { text: string; error: boolean; full?: string } | null {
	if (item.status === "running") return null;
	if (item.status === "refused") return { text: t("ai.transcript.stepRefusedBare"), error: true };
	if (item.status === "error") {
		// One sentence on one line; the full message lives in the body only.
		const full = item.preview.trim();
		return { text: firstSentence(firstLine(item.preview)) || t("ai.transcript.stepErrorBare"), error: true, full };
	}
	if (item.diff && item.diff.added.length + item.diff.removed.length > 0) {
		const added = item.diff.added.length;
		if (item.name === "Write") return { text: added === 1 ? t("ai.work.wroteOne") : t("ai.work.wrote", { count: added }), error: false };
		const removed = item.diff.removed.length;
		const addedText = added === 1 ? t("ai.work.addedOne") : t("ai.work.addedOther", { count: added });
		const removedText = removed === 1 ? t("ai.work.removedOne") : t("ai.work.removedOther", { count: removed });
		return { text: addedText + ", " + removedText, error: false };
	}
	const n = item.lines;
	if (n === 0) return null;
	if (item.name === "Read") return { text: n === 1 ? t("ai.work.sumReadOne") : t("ai.work.sumReadOther", { count: n }), error: false };
	if (item.name === "Glob") return { text: n === 1 ? t("ai.transcript.stepFilesOne") : t("ai.transcript.stepFilesOther", { count: n }), error: false };
	return { text: n === 1 ? t("ai.transcript.stepLinesOne") : t("ai.transcript.stepLinesOther", { count: n }), error: false };
}

/** The command as a terminal shows it: a `$ ` prompt, then coloured tokens. */
function commandNode(command: string, language: string): HTMLElement {
	const pre = el("pre", "qbd-work-pre qbd-work-term");
	pre.appendChild(el("span", "qbd-work-prompt", "$ "));
	if (command.length <= COMMAND_LIMIT && refractor.registered(language)) {
		const tree = refractor.highlight(command, language) as unknown as { children?: HastNode[] };
		appendHast(pre, tree.children ?? []);
	} else {
		pre.appendChild(document.createTextNode(command));
	}
	return pre;
}

/** Builds the DOM of a refractor (hast) tree node by node: text stays text. */
function appendHast(parent: Node, nodes: HastNode[]): void {
	for (const node of nodes) {
		if (node.type === "text") {
			parent.appendChild(document.createTextNode(node.value ?? ""));
		} else if (node.type === "element") {
			const span = document.createElement("span");
			const classes = Array.isArray(node.properties?.className) ? node.properties.className : [];
			const safe = classes.filter((c): c is string => typeof c === "string" && /^[a-z0-9-]+$/.test(c));
			if (safe.length) span.className = safe.join(" ");
			appendHast(span, node.children ?? []);
			parent.appendChild(span);
		}
	}
}

type ToolDiff = NonNullable<ToolItem["diff"]>;

/** The lines of a change: removed first, then added, as Claude Code shows an edit.
    A Write numbers its lines from 1 (its whole file is new); an Edit has no
    numbers, since the stream carries no structured patch. Each line keeps the
    file's syntax colours and only a faint tint marks a change. More than
    PREVIEW_LINES lines: the rest is hidden behind "Show all". */
function diffNode(item: ToolItem, diff: ToolDiff): HTMLElement {
	const lang = DIFF_LANGUAGES.get(extensionOf(diffPath(item))) ?? null;
	const rows: { cls: string; marker: string; text: string; num: string }[] = [];
	if (diff.lines) {
		for (const l of diff.lines) {
			const cls = l.kind === "add" ? "qbd-work-diff-add" : l.kind === "del" ? "qbd-work-diff-del" : "qbd-work-diff-ctx";
			const marker = l.kind === "add" ? "+" : l.kind === "del" ? "-" : "";
			rows.push({ cls, marker, text: l.text, num: String(l.num) });
		}
	} else {
		for (const line of diff.removed) rows.push({ cls: "qbd-work-diff-del", marker: "-", text: line, num: "" });
		// A Write is a file preview: numbered lines, no marker.
		const write = item.name === "Write";
		// A compact HTML page is shown re-indented; the model's text and the counts stay as written.
		const ext = extensionOf(diffPath(item));
		const added = write && (ext === "html" || ext === "htm") ? prettyHtml(diff.added.join("\n")).split("\n") : diff.added;
		let n = 1;
		for (const line of added) rows.push({ cls: write ? "qbd-work-diff-write" : "qbd-work-diff-add", marker: write ? "" : "+", text: line, num: write ? String(n++) : "" });
	}
	const box = el("div", "qbd-work-diff");
	rows.forEach((r, i) => {
		const row = el("div", "qbd-work-diff-row " + r.cls);
		if (i >= PREVIEW_LINES) row.hidden = true;
		row.appendChild(el("span", "qbd-work-gutter", r.num));
		row.appendChild(el("span", "qbd-work-marker", r.marker));
		const code = el("span", "qbd-work-code");
		// A removed line is dimmed plain text, as Claude Code shows it: no syntax colours.
		appendHighlighted(code, r.text, r.cls === "qbd-work-diff-del" ? null : lang);
		row.appendChild(code);
		box.appendChild(row);
	});
	if (rows.length > PREVIEW_LINES) {
		const toggle = el("button", "qbd-work-toggle", t("ai.work.showAll", { n: rows.length }));
		toggle.type = "button";
		let shown = false;
		toggle.addEventListener("click", e => {
			e.stopPropagation();
			shown = !shown;
			box.querySelectorAll(".qbd-work-diff-row").forEach((node, i) => {
				if (i >= PREVIEW_LINES) (node as HTMLElement).hidden = !shown;
			});
			toggle.textContent = shown ? t("ai.work.showLess") : t("ai.work.showAll", { n: rows.length });
		});
		box.appendChild(toggle);
	}
	return box;
}

function diffPath(item: ToolItem): string {
	if (item.name === "fileChange") return firstLine(item.input);
	return str(parseInput(item.input).file_path);
}

function extensionOf(path: string): string {
	const m = /\.([A-Za-z0-9]+)$/.exec(path);
	return m ? m[1].toLowerCase() : "";
}

/** One line of code: coloured by its grammar when there is one, text otherwise. */
function appendHighlighted(parent: Node, text: string, language: string | null): void {
	if (language && text.length <= COMMAND_LIMIT && refractor.registered(language)) {
		const tree = refractor.highlight(text, language) as unknown as { children?: HastNode[] };
		appendHast(parent, tree.children ?? []);
	} else {
		parent.appendChild(document.createTextNode(text));
	}
}

const OUTPUT_TEXT = new WeakMap<HTMLElement, string>();

/** Render model output through the same preview and lazy expansion as tool output. */
export function renderTextOutput(root: HTMLElement, text: string): void {
	if (OUTPUT_TEXT.get(root) === text) return;
	OUTPUT_TEXT.set(root, text);
	const lines = text.split("\n");
	const output = renderOutput({ id: "", preview: lines.slice(0, PREVIEW_LINES).join("\n"), lines: lines.length }, {
		loadOutput: async () => text,
	});
	root.replaceChildren(...(output ? [output] : []));
}

/** Reuse the quiz code badge and its inert catalogue SVG, including the fallback icon. */
function appendLanguageBadge(pre: HTMLElement, tag: string, prepend = true): void {
	const entry = codeLanguageOf(tag) ?? { id: tag, name: tag, aliases: [], icon: "file-code" as const };
	pre.classList.add("quiz-md-code");
	const badge = el("span", "quiz-code-lang");
	badge.dataset.langName = entry.name;
	const logo = el("img", "quiz-code-lang-logo");
	logo.src = codeLanguageBadgeSrc(entry);
	logo.alt = entry.name;
	logo.width = 16;
	logo.height = 16;
	logo.draggable = false;
	badge.appendChild(logo);
	if (prepend) pre.prepend(badge);
	else pre.appendChild(badge);
}

/** Preserve output text exactly while placing a badge before each fenced block. */
function fillOutputPre(pre: HTMLElement, text: string): void {
	pre.replaceChildren();
	let offset = 0;
	for (const match of text.matchAll(new RegExp(FENCE.source, "gm"))) {
		pre.appendChild(document.createTextNode(text.slice(offset, match.index)));
		appendLanguageBadge(pre, match[1], false);
		pre.appendChild(document.createTextNode(match[0]));
		offset = match.index + match[0].length;
	}
	pre.appendChild(document.createTextNode(text.slice(offset)));
}

function outputPre(text: string): HTMLPreElement {
	const pre = monoPre("");
	fillOutputPre(pre, text);
	return pre;
}

/** The output: the first lines are already in the model; the rest is fetched on demand. */
export function renderOutput(item: Pick<ToolItem, "id" | "preview" | "lines">, deps: Pick<WorkViewDeps, "loadOutput">): HTMLElement | null {
	if (!item.preview && item.lines === 0) return null;
	const box = el("div", "qbd-work-output");
	const preview = outputPre(item.preview);
	box.appendChild(preview);
	if (item.lines <= PREVIEW_LINES) return box;
	preview.classList.add("is-capped");
	const full = monoPre("", "qbd-work-pre qbd-work-full");
	full.hidden = true;
	box.appendChild(full);
	const toggle = el("button", "qbd-work-toggle", t("ai.work.showAll", { n: item.lines }));
	toggle.type = "button";
	let loaded = false;
	let loading = false;
	toggle.addEventListener("click", e => {
		e.stopPropagation();
		if (loaded) {
			const open = full.hidden;
			full.hidden = !open;
			// The full output starts at line 1: the preview would show twice.
			preview.hidden = open;
			toggle.textContent = open ? t("ai.work.showLess") : t("ai.work.showAll", { n: item.lines });
			return;
		}
		if (loading) return;
		loading = true;
		deps.loadOutput(item.id).then(output => {
			loading = false;
			if (output === null) return;
			loaded = true;
			fillOutputPre(full, output);
			full.hidden = false;
			preview.hidden = true;
			toggle.textContent = t("ai.work.showLess");
		}, () => {
			loading = false;
		});
	});
	box.appendChild(toggle);
	return box;
}

// --- Text: prose, fenced code, and the quiz the model writes at the end -------

/** A fence opens a block: ```lang, its code, then the closing fence (or the end
    while it still streams). As in CommonMark, both fences stand ALONE on their
    line (up to 3 spaces of indent): a ``` in the MIDDLE of a line — inside a
    string of the quiz, e.g. an example "```html\n<script>…" — never opens nor
    closes a block (2026-10-13: such a string cut the quiz block in two and the
    rest spilled out as prose). */
const FENCE = /^ {0,3}```([A-Za-z0-9_+-]*)[^\n`]*\n([\s\S]*?)(?:^ {0,3}```+[ \t]*$|(?![\s\S]))/m;
const QUIZ_FENCE = /^ {0,3}```quiz-blocks[^\n]*\n?/m;
/** A closing fence: alone on its line. */
const CLOSING_FENCE = /^ {0,3}```+[ \t]*$/m;
const FENCE_LANGUAGES = new Map<string, string>([
	["json", "javascript"], ["json5", "javascript"], ["js", "javascript"], ["javascript", "javascript"],
	["ts", "typescript"], ["typescript", "typescript"], ["py", "python"], ["python", "python"],
	["bash", "bash"], ["sh", "bash"], ["powershell", "powershell"], ["ps1", "powershell"],
	["html", "markup"], ["xml", "markup"], ["css", "css"], ["md", "markdown"], ["markdown", "markdown"],
]);

/** A quiz being written, recognised by its SHAPE from its first lines: an array
    whose objects carry quiz keys. Not by its question count — a Learn opens
    with readings, and while they stream there is no question yet (2026-10-13:
    the running quiz showed as a plain code block until its first question). */
function ressembleAUnQuiz(body: string): boolean {
	return /^\s*\[/.test(body) && /(^|[\s{,"'])(role|prompt|slice|options|correctIndex|questions)["']?\s*:/m.test(body.slice(0, 4000));
}

/** A text item: the prose stays prose, a fenced block becomes a monospace coloured
    block, and a quiz block (```quiz-blocks, or a bare JSON array that parses as a
    quiz) becomes ONE row like a tool call. */
function textItem(text: string, live: boolean): HTMLElement {
	const block = el("div", "qbd-work-item qbd-work-text");
	const quiz = QUIZ_FENCE.exec(text);
	if (quiz) {
		const before = text.slice(0, quiz.index);
		const after = text.slice(quiz.index + quiz[0].length);
		const fin = CLOSING_FENCE.exec(after);
		const close = fin ? fin.index : -1;
		const body = close < 0 ? after : after.slice(0, close);
		const rest = fin ? after.slice(fin.index + fin[0].length) : "";
		appendProse(block, before);
		block.appendChild(quizRow(body, live && close < 0));
		appendProse(block, rest);
		return block;
	}
	if (ressembleAUnQuiz(text)) {
		block.appendChild(quizRow(text.trim(), live));
		return block;
	}
	/* The quiz in an ordinary fence (```json5, ```json…), as models write it:
	   the prose around stays prose, the quiz becomes the same folded row. */
	const fence = FENCE.exec(text);
	if (fence && ressembleAUnQuiz(fence[2])) {
		appendProse(block, text.slice(0, fence.index));
		block.appendChild(quizRow(fence[2].replace(/\n$/, ""), live && !fence[0].trimEnd().endsWith("```")));
		appendProse(block, text.slice(fence.index + fence[0].length));
		return block;
	}
	cappedProse(block, text);
	return block;
}

/** A long message: its first lines, rendered (prose and real code blocks, never
    the raw fences), then "Show all" which REPLACES the preview with the whole
    message rendered the same way — never a second copy under the first. */
function cappedProse(block: HTMLElement, text: string): void {
	const lines = text.split("\n");
	if (lines.length <= PREVIEW_LINES) { appendProse(block, text); return; }
	const preview = el("div", "qbd-work-text-preview");
	appendProse(preview, lines.slice(0, PREVIEW_LINES).join("\n"));
	const full = el("div", "qbd-work-text-full");
	full.hidden = true;
	block.append(preview, full);
	const toggle = el("button", "qbd-work-toggle", t("ai.work.showAll", { n: lines.length }));
	toggle.type = "button";
	let built = false;
	toggle.addEventListener("click", e => {
		e.stopPropagation();
		if (!built) { appendProse(full, text); built = true; }
		const open = full.hidden;
		full.hidden = !open;
		preview.hidden = open;
		toggle.textContent = open ? t("ai.work.showLess") : t("ai.work.showAll", { n: lines.length });
	});
	block.appendChild(toggle);
}

/** Prose and fenced code, in order. A running fence is shown as code up to now. */
function appendProse(parent: HTMLElement, text: string): void {
	let rest = text;
	for (;;) {
		const m = FENCE.exec(rest);
		if (!m) break;
		if (m.index > 0) parent.appendChild(el("div", "qbd-work-body", rest.slice(0, m.index)));
		parent.appendChild(codeBlock(m[2], m[1]));
		rest = rest.slice(m.index + m[0].length);
		if (m[0].length === 0) break;
	}
	if (rest !== "") parent.appendChild(el("div", "qbd-work-body", rest));
}

function codeBlock(code: string, language: string): HTMLElement {
	const pre = el("pre", "qbd-work-pre qbd-work-codeblock");
	appendLanguageBadge(pre, language);
	appendHighlighted(pre, code.replace(/\n$/, ""), FENCE_LANGUAGES.get(language.toLowerCase()) ?? null);
	return pre;
}

/** The quiz the model writes: one row, collapsed. Its raw block is built only on open. */
function quizRow(block: string, live: boolean): HTMLElement {
	const wrap = el("div", "qbd-work-tool qbd-work-quiz");
	const progress = quizProgress(block);
	const head = el("div", "qbd-work-tool-head");
	head.appendChild(statusDot(live ? "running" : "ok"));
	const title = el("span", "qbd-work-title");
	title.appendChild(el("span", "qbd-work-tool-name", live ? t("ai.work.quizWriting") : t("ai.work.quizWritten")));
	head.appendChild(title);
	wrap.appendChild(head);
	const count = live ? (progress.question > 0 ? t("ai.work.quizQuestion", { n: progress.question }) : "") : libelleComptes({ questions: progress.question, readings: progress.readings });
	if (count) {
		const line = el("div", "qbd-work-summary");
		line.appendChild(el("span", "qbd-work-branch", "└"));
		line.appendChild(el("span", "qbd-work-summary-text", count));
		wrap.appendChild(line);
	}
	const body = el("div", "qbd-work-tool-body");
	let built = false;
	/* Shows the preview (first lines, faded at the bottom) or everything. The row
	   always REopens on the preview (2026-10-13): a long quiz left expanded
	   meant scrolling to its very end to find "Show less". */
	let montrer: (tout: boolean) => void = () => {};
	const build = () => {
		if (block === "") return;
		if (built) { montrer(false); return; }
		built = true;
		const lines = block.split("\n");
		const box = el("div", "qbd-work-diff");
		lines.forEach((line, i) => {
			const row = el("div", "qbd-work-diff-row");
			row.appendChild(el("span", "qbd-work-gutter", String(i + 1)));
			const code = el("span", "qbd-work-code");
			appendHighlighted(code, line, "javascript");
			row.appendChild(code);
			box.appendChild(row);
		});
		body.appendChild(box);
		if (lines.length > PREVIEW_LINES) {
			// While expanded it sticks to the bottom of the view: "Show less" is always at hand.
			const toggle = el("button", "qbd-work-toggle qbd-work-toggle--collant", t("ai.work.showAll", { n: lines.length }));
			toggle.type = "button";
			let shown = false;
			montrer = tout => {
				shown = tout;
				box.querySelectorAll(".qbd-work-diff-row").forEach((node, i) => {
					if (i >= PREVIEW_LINES) (node as HTMLElement).hidden = !shown;
				});
				box.classList.toggle("is-capped", !shown);
				toggle.classList.toggle("is-stuck", shown);
				toggle.textContent = shown ? t("ai.work.showLess") : t("ai.work.showAll", { n: lines.length });
			};
			toggle.addEventListener("click", e => {
				e.stopPropagation();
				const fermer = shown;
				montrer(!shown);
				// Collapsing from far below: bring the row's head back into view.
				if (fermer) wrap.scrollIntoView?.({ block: "nearest" });
			});
			body.appendChild(toggle);
			montrer(false);
		}
	};
	setOpen(wrap, body, false);
	wrap.appendChild(body);
	if (block !== "") expandable(head, wrap, body, build);
	return wrap;
}

/** A quiz generation's assistant text, summarised: "Wrote the quiz · 214 lines".
    Only the line count is shown, never the text (JSON5 or HTML): no button, no body.
    While the turn runs the pen icon pulses (`.is-writing`, work-view.css). */
function writtenRow(text: string, running: boolean): HTMLElement {
	const wrap = el("div", "qbd-work-item qbd-work-tool qbd-work-written");
	const head = el("div", "qbd-work-tool-head");
	head.appendChild(statusDot(running ? "running" : "ok"));
	const icon = el("span", running ? "qbd-work-written-icon is-writing" : "qbd-work-written-icon");
	currentHost().ui.setIcon(icon, "file-pen");
	head.appendChild(icon);
	const lines = text.split("\n").length;
	const title = el("span", "qbd-work-title");
	const key = running
		? (lines === 1 ? "ai.work.quizWritingLinesOne" : "ai.work.quizWritingLinesOther")
		: (lines === 1 ? "ai.work.quizWrittenLinesOne" : "ai.work.quizWrittenLinesOther");
	title.appendChild(el("span", "qbd-work-tool-name", t(key, { count: lines })));
	head.appendChild(title);
	wrap.appendChild(head);
	return wrap;
}

// --- Permissions ----------------------------------------------------------------

function permissionBlock(item: Extract<ThreadItem, { kind: "permission" }>, deps: WorkViewDeps): HTMLElement {
	const card = el("div", "qbd-work-item qbd-work-permission");
	card.appendChild(el("div", "qbd-work-permission-title", t("ai.work.permissionTitle", { tool: item.tool })));
	if (item.input) card.appendChild(monoPre(item.input));
	const actions = el("div", "qbd-work-permission-actions");
	const allow = el("button", "qbd-work-allow", t("ai.work.allow"));
	const deny = el("button", "qbd-work-deny", t("ai.work.deny"));
	allow.type = "button";
	deny.type = "button";
	const pending = item.state === "pending";
	allow.disabled = !pending;
	deny.disabled = !pending;
	const answerOnce = (allowed: boolean) => {
		if (allow.disabled && deny.disabled) return;
		allow.disabled = true;
		deny.disabled = true;
		deps.answer(item.requestId, allowed);
	};
	allow.addEventListener("click", () => answerOnce(true));
	deny.addEventListener("click", () => answerOnce(false));
	actions.appendChild(allow);
	actions.appendChild(deny);
	card.appendChild(actions);
	return card;
}

// --- Small helpers --------------------------------------------------------------

function parseInput(input: string): Record<string, unknown> {
	try {
		const v: unknown = JSON.parse(input);
		return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const firstLine = (s: string): string => s.split("\n").find(l => l.trim() !== "")?.trim() ?? "";

function ellipsize(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
