/* ══════════════════════════════════════════════════════════
   A REQUEST OF THE RECORD, ON SCREEN

   What `chat-thread.ts` shows from the record rather than from live lines:
   a chat of an earlier session, or a request whose replies have left the
   queue. The same look as a live turn (`file-generation-vue.ts`): the
   message on the right (documents by name, the text), the answer under it —
   a card per quiz with "Open", the written answers as prose, the failure or
   the stop in one line. The only HTML written here is the Markdown of an
   answer, through `renderMarkdownPreview` (the first gate of the sanitizer).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { currentLang, t } from "../i18n";
import type { TransKey } from "../i18n";

/** "4.2K", "4,2 k": a token count as the reader's language writes it short. */
export function compterJetons(n: number): string {
	try { return new Intl.NumberFormat(currentLang(), { notation: "compact", maximumFractionDigits: 1 }).format(n); }
	catch { return String(Math.round(n)); }
}
import { mathifyElement } from "../engine/mathjax";
import { renderMarkdownPreview } from "../markdown-preview";
import { badgeDeFichier, couperNomAuMilieu } from "./file-icons";
import type { ChatRequest } from "./chat-record";
import type { RunningEntry } from "../shared-state/generations";
import { canOpenCard } from "../shared-state/chat-merge";
import { peindreQuestions } from "./generation-kind-vue";
import type { PasteOutcome } from "./relay-flow";

/** The chips of the documents a request carried (thumbnail when there is one,
    else the name cut IN THE MIDDLE so the extension always shows). */
export function peindrePieces(parent: HTMLElement, notes: readonly { name: string; path?: string; thumb?: string }[]): void {
	for (const n of notes) {
		const p = ajouter(parent, "div", "qbd-ai-message-piece");
		p.title = n.path || n.name;
		if (n.thumb) {
			p.classList.add("qbd-ai-message-piece--image");
			const el = ajouter(p, "img");
			el.src = n.thumb;
			el.alt = n.name;
			continue;
		}
		const { tete, queue } = couperNomAuMilieu(n.name);
		const nom = ajouter(p, "span", "qbd-ai-message-piece-nom");
		ajouter(nom, "span", "qbd-ai-message-piece-tete", tete);
		if (queue) ajouter(nom, "span", "qbd-ai-message-piece-queue", queue);
		ajouter(p, "span", "qbd-ai-note-chip-badge", badgeDeFichier(n.name));
	}
}

export function peindreTourEnregistre(parent: HTMLElement, q: ChatRequest, deps: { ouvrir(path: string): void; copier?(text: string): Promise<boolean>; repondre?(requestId: string, answers: string[][]): void; reprenable?(requestId: string): boolean }): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.demande = q.id;
	// A legacy chat has answers with no request text: no empty bubble.
	if (q.documents.length || q.text.trim()) {
		const message = ajouter(tour, "div", "qbd-ai-message");
		if (q.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), q.documents);
		if (q.text.trim()) ajouter(message, "div", "qbd-ai-bulle", q.text.trim());
	}
	if (q.clarify) {
		const id = q.id;
		peindreQuestions(tour, q.clarify, deps.repondre && deps.reprenable?.(id) ? (answers) => deps.repondre?.(id, answers) : undefined, id);
	}
	for (const res of q.results) {
		if (res.kind === "text") {
			const rep = ajouter(tour, "div", "qbd-ai-chat-reponse");
			const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
			prose.innerHTML = renderMarkdownPreview(res.text);
			if (res.text.includes("$")) void mathifyElement(prose);
			if (deps.copier) {
				const pied = ajouter(rep, "div", "qbd-ai-chat-pied");
				const b = ajouter(pied, "button", "qbd-ai-file-btn");
				b.type = "button";
				host.ui.setIcon(b, "copy");
				b.setAttribute("aria-label", t("ai.chat.copy"));
				b.addEventListener("click", () => { void deps.copier?.(res.text).then(ok => host.ui.notice(t(ok ? "ai.chat.copied" : "ai.chat.copyFailed"))); });
			}
			continue;
		}
		const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--prete");
		const carte = ajouter(rep, "div", "qbd-ai-resultat");
		host.ui.setIcon(ajouter(carte, "span", "qbd-ai-resultat-icone"), "file-check-2");
		ajouter(ajouter(carte, "div", "qbd-ai-resultat-corps"), "div", "qbd-ai-resultat-titre", res.title);
		if (canOpenCard(res.path)) {
			const b = ajouter(carte, "button", "qbd-ai-reponse-action", t("ai.queue.open"));
			b.type = "button";
			b.addEventListener("click", () => deps.ouvrir(res.path));
		}
	}
	if (q.state === "failed" || q.state === "stopped") {
		const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--echouee");
		host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), q.state === "failed" ? "alert-triangle" : "square");
		ajouter(rep, "span", "qbd-ai-reponse-texte", q.state === "failed" ? (q.error || t("ai.thread.failed")) : t("ai.thread.stopped"));
	}
}

/** A request running on ANOTHER device (`remote` items of the thread): its
    message, then its progress read from that device's file. Never a stop
    button or a transcript: only the PC that runs it can show those. A stale
    file reads "paused" and never shows progress. */
export function peindreProgressionDistante(parent: HTMLElement, entry: RunningEntry, stale: boolean): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.distante = entry.requestId;
	if (entry.text.trim()) ajouter(ajouter(tour, "div", "qbd-ai-message"), "div", "qbd-ai-bulle", entry.text.trim());
	const rep = ajouter(tour, "div", stale ? "qbd-ai-reponse" : "qbd-ai-reponse qbd-ai-reponse--cours");
	host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), stale ? "pause" : "loader");
	const corps = ajouter(rep, "div", "qbd-ai-remote-corps");
	ajouter(corps, "span", "qbd-ai-reponse-etape", t("ai.remote.onDevice"));
	if (stale) { ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.paused")); return; }
	const p = entry.progress;
	/* Before the first question, the PC's model is reasoning: its size says it
	   is at work (2026-10-08), where "Question 0" said nothing. */
	if (p.question === 0 && p.thinking) ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.thinking", { count: compterJetons(p.thinking) }));
	else ajouter(corps, "span", "qbd-ai-reponse-texte", p.total ? t("ai.remote.progress", { n: p.question, total: p.total }) : t("ai.remote.progressNoTotal", { n: p.question }));
	if (p.quiz !== undefined && p.quizTotal !== undefined) ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.quiz", { n: p.quiz, total: p.quizTotal }));
}

/** A request the phone sent that no PC has taken yet: its message, then "Waiting for the PC" (or "Expired" past 24 h). `pcReachable` false (the PC the request was sent to is not fresh) adds the one line saying the PC does not seem on. */
export function peindreEnAttente(parent: HTMLElement, item: { key: string; request: { text: string; documents: Array<{ path: string }> }; state: "waiting" | "expired" }, pcReachable: boolean): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.attente = item.key;
	const message = ajouter(tour, "div", "qbd-ai-message");
	if (item.request.documents.length) {
		const notes = item.request.documents.map(d => ({ name: d.path.slice(d.path.lastIndexOf("/") + 1), path: d.path }));
		peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), notes);
	}
	if (item.request.text.trim()) ajouter(message, "div", "qbd-ai-bulle", item.request.text.trim());
	const rep = ajouter(tour, "div", item.state === "expired" ? "qbd-ai-reponse qbd-ai-reponse--echouee" : "qbd-ai-reponse qbd-ai-reponse--cours");
	host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), item.state === "expired" ? "alert-circle" : "clock");
	const corps = ajouter(rep, "div", "qbd-ai-remote-corps");
	ajouter(corps, "span", "qbd-ai-reponse-texte", t(item.state === "expired" ? "ai.remote.expired" : "ai.remote.waiting"));
	if (item.state === "waiting" && !pcReachable) ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.noPc"));
}

/** Why a pasted answer was refused: every refusal of the relay, and the flow's own. */
export type RefusRelais = Extract<PasteOutcome, { ok: false }>["reason"];

const MESSAGE_REFUS: Record<RefusRelais, TransKey> = {
	"clipboard-empty": "ai.relay.err.clipboard-empty",
	"empty": "ai.relay.err.empty",
	"too-large": "ai.relay.err.too-large",
	"none": "ai.relay.err.none",
	"several": "ai.relay.err.several",
	"other-request": "ai.relay.err.other-request",
	"invalid": "ai.relay.err.invalid",
	"no-questions": "ai.relay.err.no-questions",
	"format": "ai.relay.err.format",
	"save-failed": "ai.relay.err.save-failed",
	"already-saved": "ai.relay.err.already-saved",
};

/** The line shown under the paste button for a refusal. The first line of the
    detail is kept for `invalid` only (where the text breaks). The `format`
    detail is a list of internal codes, never shown. */
export function erreurRelais(refus: { reason: RefusRelais; detail?: string }): { message: string; detail?: string } {
	const premiere = refus.detail?.split("\n")[0].trim();
	const detail = refus.reason === "invalid" && premiere ? premiere : undefined;
	return { message: t(MESSAGE_REFUS[refus.reason]), detail };
}

/** The relay card of a request shared to an AI app and not yet answered. */
export interface RelaisVue {
	text: string;
	documents: Array<{ name: string; path?: string }>;
	/** The refusal of the last paste, null when none. */
	erreur: { message: string; detail?: string } | null;
	/** A paste is being read: the buttons wait. */
	occupe: boolean;
	coller(): void;
	annuler(): void;
}

/** A request shared to an AI app: its message, the hint, the paste (primary) and cancel (quiet) buttons, and the last refusal. */
export function peindreRelais(parent: HTMLElement, r: RelaisVue): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.relais = "1";
	const message = ajouter(tour, "div", "qbd-ai-message");
	if (r.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), r.documents);
	if (r.text.trim()) ajouter(message, "div", "qbd-ai-bulle", r.text.trim());
	const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-relais");
	host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), "share-2");
	const corps = ajouter(rep, "div", "qbd-ai-remote-corps");
	ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.relay.hint"));
	if (r.erreur) {
		ajouter(corps, "span", "qbd-ai-relais-erreur", r.erreur.message);
		if (r.erreur.detail) ajouter(corps, "span", "qbd-ai-relais-detail", r.erreur.detail);
	}
	const actions = ajouter(corps, "div", "qbd-ai-relais-actions");
	const coller = ajouter(actions, "button", "qbd-ai-relais-coller");
	coller.type = "button";
	coller.disabled = r.occupe;
	host.ui.setIcon(ajouter(coller, "span", "qbd-ai-relais-icone"), "clipboard-paste");
	ajouter(coller, "span", "qbd-ai-relais-label", t("ai.relay.paste"));
	coller.addEventListener("click", () => r.coller());
	const annuler = ajouter(actions, "button", "qbd-ai-relais-annuler", t("ai.relay.cancel"));
	annuler.type = "button";
	annuler.addEventListener("click", () => r.annuler());
}
