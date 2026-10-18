/* ══════════════════════════════════════════════════════════
   THE BUG REPORT FORM (PC only): a modal opened from the app menu once the
   relay is configured. Modelled on VS Code's issue reporter and Chrome's
   feedback form: what happened, steps, expected, a title, and a "details
   sent" block whose boxes can be unticked, with a preview of the log.
   Everything goes through `pont().bugReport`: the window hands text and
   gets a result back, it never sees a token.
══════════════════════════════════════════════════════════ */

import { LIMITS } from "../../../../src/bug-report";
import { canSend, defaultTitle, reportFromForm } from "../../../../src/bug-report-form";
import type { FormState } from "../../../../src/bug-report-form";
import { ajouter } from "../../../../src/dom";
import { currentHost, requireHost } from "../../../../src/host/current";
import type { HostModalHandle } from "../../../../src/host/types";
import { t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { pont } from "../host/pont";

let openModal: HostModalHandle | null = null;

/** Codes after which GitHub itself is the way forward, so that button leads. */
const FALLBACK_CODES = new Set(["disabled", "upstream"]);
const KNOWN_CODES = new Set(["invalid", "rate_limited", "duplicate", "upstream", "disabled"]);

export function openBugReportModal(deps: { fallbackUrl: () => string }): void {
	if (openModal || !pont().bugReport) return;
	let cleanup: () => void = () => undefined;
	openModal = requireHost("modals").open({
		className: "nq-bug-modal",
		title: t("bugReport.title"),
		onOpen: handle => { cleanup = mount(handle.contentEl, deps, () => handle.close()); },
		onClose: () => { openModal = null; cleanup(); },
	});
}

function icon(el: HTMLElement, name: string): void { currentHost().ui.setIcon(el, name); }

function button(parent: HTMLElement, className: string, text: string, onClick: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", `nqb-btn ${className}`, text);
	b.type = "button";
	b.addEventListener("click", onClick);
	return b;
}

interface Field { el: HTMLInputElement | HTMLTextAreaElement; refresh(): void }

function mount(content: HTMLElement, deps: { fallbackUrl: () => string }, close: () => void): () => void {
	const api = pont().bugReport!;
	let destroyed = false;
	const state: FormState = {
		what: "", steps: "", expected: "", title: "",
		sendEnv: true, sendLog: true, env: null, log: "", sending: false,
	};
	let titleEdited = false;
	let connecting = false;

	const root = ajouter(content, "div", "nqb-root");
	const form = ajouter(root, "div", "nqb-form");

	/* ─── Fields ─── */
	function field(label: TransKey, placeholder: TransKey | null, max: number, rows: number, onValue: (v: string) => void): Field {
		const block = ajouter(form, "label", "nqb-field");
		const head = ajouter(block, "span", "nqb-field-head");
		ajouter(head, "span", "nqb-label", t(label));
		const counter = ajouter(head, "span", "nqb-counter");
		let el: HTMLInputElement | HTMLTextAreaElement;
		if (rows > 0) {
			el = ajouter(block, "textarea", "nqb-input nqb-area");
			(el as HTMLTextAreaElement).rows = rows;
		} else {
			el = ajouter(block, "input", "nqb-input");
			(el as HTMLInputElement).type = "text";
		}
		if (placeholder) el.placeholder = t(placeholder);
		el.maxLength = max;
		const refresh = (): void => { counter.textContent = t("bugReport.counter", { count: el.value.length, max }); };
		el.addEventListener("input", () => { onValue(el.value); refresh(); refreshButtons(); });
		refresh();
		return { el, refresh };
	}

	const whatField = field("bugReport.what", "bugReport.whatPlaceholder", LIMITS.what, 4, v => {
		state.what = v;
		// The title follows the description until the user edits it.
		if (!titleEdited) { state.title = defaultTitle(v); titleField.el.value = state.title; titleField.refresh(); }
	});
	field("bugReport.steps", "bugReport.stepsPlaceholder", LIMITS.text, 3, v => { state.steps = v; });
	field("bugReport.expected", "bugReport.expectedPlaceholder", LIMITS.text, 2, v => { state.expected = v; });
	const titleField = field("bugReport.reportTitle", null, LIMITS.title, 0, v => { titleEdited = true; state.title = v; });

	/* ─── Details sent ─── */
	const details = ajouter(form, "div", "nqb-details");
	ajouter(details, "div", "nqb-label", t("bugReport.details"));
	const envRow = ajouter(details, "label", "nqb-check");
	const envBox = ajouter(envRow, "input");
	envBox.type = "checkbox";
	envBox.checked = true;
	envBox.addEventListener("change", () => { state.sendEnv = envBox.checked; });
	const envText = ajouter(envRow, "span", "nqb-check-text");
	ajouter(envText, "span", "nqb-check-label", t("bugReport.envLabel"));
	const envValue = ajouter(envText, "span", "nqb-check-value");

	const logRow = ajouter(details, "div", "nqb-log");
	const logHead = ajouter(logRow, "div", "nqb-check nqb-log-head");
	const logBox = ajouter(logHead, "input");
	logBox.type = "checkbox";
	logBox.checked = true;
	logBox.id = "nqb-log-case";
	logBox.addEventListener("change", () => { state.sendLog = logBox.checked; });
	const logLabel = ajouter(logHead, "label", "nqb-check-label", t("bugReport.logLabel"));
	logLabel.htmlFor = logBox.id;
	const logToggle = ajouter(logHead, "button", "nqb-link");
	logToggle.type = "button";
	logToggle.setAttribute("aria-expanded", "false");
	const logToggleText = ajouter(logToggle, "span", undefined, t("bugReport.logShow"));
	const logChevron = ajouter(logToggle, "span", "nqb-chevron");
	icon(logChevron, "chevron-down");
	// Grid rows 0fr to 1fr: the preview opens and closes smoothly, whatever its height.
	const logZone = ajouter(logRow, "div", "nqb-log-zone");
	const logInner = ajouter(logZone, "div", "nqb-log-inner");
	const logPre = ajouter(logInner, "pre", "nqb-log-pre");
	logToggle.addEventListener("click", () => {
		const isOpen = logZone.classList.toggle("is-open");
		logToggle.setAttribute("aria-expanded", String(isOpen));
		logToggleText.textContent = t(isOpen ? "bugReport.logHide" : "bugReport.logShow");
		logChevron.classList.toggle("is-open", isOpen);
	});
	details.hidden = true;
	logRow.hidden = true;

	void api.preview().then(r => {
		if (destroyed || !r.ok) return;
		state.env = r.env;
		envValue.textContent = `${r.env.app} · ${r.env.os}`;
		state.log = r.log;
		logPre.textContent = r.log;
		logRow.hidden = r.log.trim() === "";
		details.hidden = false;
	}).catch(() => undefined);

	/* ─── GitHub account ─── */
	const account = ajouter(form, "div", "nqb-github");
	function drawAccount(connected: string | null, code?: { userCode: string; uri: string }, error?: string): void {
		account.replaceChildren();
		if (connected) {
			const row = ajouter(account, "div", "nqb-github-row");
			icon(ajouter(row, "span", "nqb-github-mark"), "github");
			ajouter(row, "span", "nqb-github-text", t("bugReport.githubAs", { login: connected }));
			button(row, "nqb-quiet", t("bugReport.githubDisconnect"), () => {
				void api.github.disconnect().then(() => { if (!destroyed) drawAccount(null); });
			});
			return;
		}
		if (code) {
			ajouter(account, "div", "nqb-github-title", t("bugReport.githubCode"));
			ajouter(account, "div", "nqb-code", code.userCode);
			const row = ajouter(account, "div", "nqb-github-row");
			button(row, "nqb-secondary", t("bugReport.githubOpen"), () => { window.open(code.uri, "_blank", "noopener"); });
			button(row, "nqb-quiet", t("bugReport.githubCancel"), () => { void api.github.cancel(); });
			ajouter(account, "div", "nqb-hint", t("bugReport.githubWaiting"));
			return;
		}
		const row = ajouter(account, "div", "nqb-github-row");
		icon(ajouter(row, "span", "nqb-github-mark"), "github");
		const text = ajouter(row, "span", "nqb-github-text");
		ajouter(text, "span", "nqb-check-label", t("bugReport.github"));
		ajouter(text, "span", "nqb-hint", t("bugReport.githubHint"));
		button(row, "nqb-secondary", t("bugReport.githubConnect"), () => { void connect(); });
		if (error) ajouter(account, "div", "nqb-error-inline", error);
	}
	async function connect(): Promise<void> {
		if (connecting) return;
		connecting = true;
		try {
			const d = await api.github.connect();
			if (destroyed) return;
			if (!d.ok) {
				drawAccount(null, undefined, t(d.code === "busy" ? "bugReport.githubError.busy" : "bugReport.githubError.failed"));
				return;
			}
			drawAccount(null, { userCode: d.userCode, uri: d.verificationUri });
			const outcome = await api.github.wait();
			if (destroyed) return;
			if ("login" in outcome) drawAccount(outcome.login);
			else if (outcome.error === "cancelled") drawAccount(null);
			else drawAccount(null, undefined, t(`bugReport.githubError.${outcome.error}`));
		} catch {
			if (!destroyed) drawAccount(null, undefined, t("bugReport.githubError.failed"));
		} finally {
			connecting = false;
		}
	}
	void api.github.state().then(e => { if (!destroyed) drawAccount(e?.login ?? null); }).catch(() => { if (!destroyed) drawAccount(null); });

	/* ─── Notice, error, actions ─── */
	ajouter(form, "p", "nqb-notice", t("bugReport.notice"));
	const errorBox = ajouter(form, "div", "nqb-error");
	errorBox.hidden = true;
	errorBox.setAttribute("role", "alert");
	const actions = ajouter(form, "div", "nqb-actions");
	const fallbackBtn = button(actions, "nqb-secondary", t("bugReport.openOnGithub"), () => { window.open(deps.fallbackUrl(), "_blank", "noopener"); });
	fallbackBtn.hidden = true;
	const cancelBtn = button(actions, "nqb-secondary", t("bugReport.cancel"), close);
	const sendBtn = button(actions, "nqb-primary", t("bugReport.send"), () => { void submit(); });
	function refreshButtons(): void {
		sendBtn.disabled = !canSend(state);
		cancelBtn.disabled = state.sending;
	}
	refreshButtons();
	whatField.el.focus();

	/* ─── Sent ─── */
	const sentBox = ajouter(root, "div", "nqb-sent");
	sentBox.hidden = true;

	async function submit(): Promise<void> {
		if (!canSend(state)) return;
		state.sending = true;
		errorBox.hidden = true;
		sendBtn.textContent = t("bugReport.sending");
		refreshButtons();
		let code = "failed";
		try {
			const r = await api.send(reportFromForm(state));
			if (destroyed) return;
			if (r.ok) { showSent(r.url, r.number); return; }
			code = r.code;
		} catch {
			if (destroyed) return;
		}
		state.sending = false;
		sendBtn.textContent = t("bugReport.retry");
		errorBox.hidden = false;
		errorBox.textContent = KNOWN_CODES.has(code) ? t(`bugReport.error.${code}` as TransKey) : t("bugReport.error.failed");
		// For disabled / upstream, GitHub itself is the way forward: that button leads.
		const leads = FALLBACK_CODES.has(code);
		fallbackBtn.hidden = false;
		fallbackBtn.classList.toggle("nqb-primary", leads);
		fallbackBtn.classList.toggle("nqb-secondary", !leads);
		sendBtn.classList.toggle("nqb-primary", !leads);
		sendBtn.classList.toggle("nqb-secondary", leads);
		refreshButtons();
	}

	function showSent(url: string, number: number): void {
		form.hidden = true;
		sentBox.hidden = false;
		icon(ajouter(sentBox, "div", "nqb-sent-mark"), "circle-check");
		ajouter(sentBox, "div", "nqb-sent-title", t("bugReport.sentTitle"));
		ajouter(sentBox, "p", "nqb-sent-body", t("bugReport.sentBody", { number: number }));
		const row = ajouter(sentBox, "div", "nqb-actions");
		button(row, "nqb-secondary", t("bugReport.viewIssue"), () => { window.open(url, "_blank", "noopener"); });
		button(row, "nqb-primary", t("bugReport.close"), close);
	}

	return () => {
		destroyed = true;
		if (connecting) void api.github.cancel();
	};
}
