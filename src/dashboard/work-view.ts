/**
 * The full AI work view of a live session: draws a `Thread`
 * (src/dashboard/live-thread.ts) into a root element.
 *
 * Every string here comes from the CLI (model text, tool names, tool input,
 * tool output, permission requests): it is untrusted. Each one is written
 * with `textContent` and never with `innerHTML`, never through a sanitizer
 * gate. The check is `scripts/check-work-view.mjs`.
 *
 * Re-rendering is keyed by item index: an item whose JSON is unchanged keeps
 * its node (and whatever the user already expanded or answered in it); only
 * a changed or new item is rebuilt. A thread that shrinks drops its tail.
 */
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { PREVIEW_LINES, type Thread, type ThreadItem } from "./live-thread";

export interface WorkViewDeps {
	/** The full output of one tool call, fetched on demand (null if gone). */
	loadOutput(toolId: string): Promise<string | null>;
	/** A permission answer; sent once per request. */
	answer(requestId: string, allow: boolean): void;
}

/** The signature of the item each node was built from, to skip unchanged ones. */
const SIGNATURE = new WeakMap<HTMLElement, string>();

const NOTICE_KEYS: Record<string, "ai.work.interrupted" | "ai.work.truncated" | "ai.work.resumed"> = {
	interrupted: "ai.work.interrupted",
	truncated: "ai.work.truncated",
	resumed: "ai.work.resumed",
};

const STATUS_ICONS: Record<string, string> = {
	running: "loader",
	ok: "check",
	error: "circle-alert",
	refused: "ban",
};

export function renderThread(root: HTMLElement, thread: Thread, deps: WorkViewDeps): void {
	root.classList.add("qbd-work");
	thread.items.forEach((item, i) => {
		const signature = JSON.stringify(item);
		const current = root.children.item(i) as HTMLElement | null;
		if (current && SIGNATURE.get(current) === signature) return;
		const fresh = buildItem(item, deps);
		SIGNATURE.set(fresh, signature);
		if (current) root.replaceChild(fresh, current);
		else root.appendChild(fresh);
	});
	while (root.children.length > thread.items.length) {
		root.removeChild(root.lastElementChild as Element);
	}
}

function buildItem(item: ThreadItem, deps: WorkViewDeps): HTMLElement {
	switch (item.kind) {
		case "user":
			return textBlock("qbd-work-item qbd-work-user", item.text);
		case "text":
			return textBlock("qbd-work-item qbd-work-text", item.text);
		case "thinking":
			return thinkingBlock(item.text);
		case "notice":
			return noticeBlock(item.text);
		case "tool":
			return toolBlock(item, deps);
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

function thinkingBlock(text: string): HTMLElement {
	const block = el("div", "qbd-work-item qbd-work-thinking");
	block.appendChild(el("div", "qbd-work-label", t("ai.work.thinking")));
	block.appendChild(el("div", "qbd-work-body", text));
	return block;
}

function noticeBlock(text: string): HTMLElement {
	const key = NOTICE_KEYS[text];
	// A notice text is a key from our own code; anything else is shown as-is,
	// which is still safe because it goes through textContent.
	return el("div", "qbd-work-item qbd-work-notice", key ? t(key) : text);
}

function monoPre(text: string, className = "qbd-work-pre"): HTMLPreElement {
	return el("pre", className, text);
}

function toolBlock(item: Extract<ThreadItem, { kind: "tool" }>, deps: WorkViewDeps): HTMLElement {
	const block = el("div", "qbd-work-item qbd-work-tool");
	const head = el("div", "qbd-work-tool-head");
	const icon = el("span", "qbd-work-icon");
	const iconName = STATUS_ICONS[item.status];
	if (iconName) currentHost().ui.setIcon(icon, iconName);
	head.appendChild(icon);
	head.appendChild(el("span", "qbd-work-tool-name", item.name));
	if (item.status === "running") head.appendChild(el("span", "qbd-work-status", t("ai.transcript.stepRunning")));
	if (item.status === "refused") head.appendChild(el("span", "qbd-work-status", t("ai.transcript.stepRefusedBare")));
	if (item.status === "error") head.appendChild(el("span", "qbd-work-status", t("ai.transcript.stepErrorBare")));
	block.appendChild(head);

	if (item.input) block.appendChild(monoPre(item.input, "qbd-work-pre qbd-work-input"));

	if (item.diff) {
		const diff = el("div", "qbd-work-diff");
		for (const line of item.diff.removed) diff.appendChild(el("div", "qbd-work-diff-del", "- " + line));
		for (const line of item.diff.added) diff.appendChild(el("div", "qbd-work-diff-add", "+ " + line));
		block.appendChild(diff);
	}

	if (item.preview) block.appendChild(monoPre(item.preview));

	if (item.lines > PREVIEW_LINES) {
		const full = monoPre("", "qbd-work-pre qbd-work-full");
		full.hidden = true;
		block.appendChild(full);
		const toggle = el("button", "qbd-work-toggle", t("ai.work.showAll", { n: item.lines }));
		toggle.type = "button";
		let loaded = false;
		let loading = false;
		toggle.addEventListener("click", () => {
			if (loaded) {
				const open = full.hidden;
				full.hidden = !open;
				toggle.textContent = open ? t("ai.work.showLess") : t("ai.work.showAll", { n: item.lines });
				return;
			}
			if (loading) return;
			loading = true;
			deps.loadOutput(item.id).then(output => {
				loading = false;
				if (output === null) return;
				loaded = true;
				full.textContent = output;
				full.hidden = false;
				toggle.textContent = t("ai.work.showLess");
			}, () => {
				loading = false;
			});
		});
		block.appendChild(toggle);
	}
	return block;
}

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
