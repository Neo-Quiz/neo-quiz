/* ══════════════════════════════════════════════════════════
   A REQUEST OF THE RECORD, ON SCREEN

   What `chat-thread.ts` shows from the record rather than from live lines:
   a chat of an earlier session, or a request whose replies have left the
   queue. The same look as a live turn (`file-generation-vue.ts`): the
   message on the right (documents by name, the text), the answer under it —
   a card per quiz with "Open", the written answers as prose, the failure or
   the stop in one line. The only HTML written here is the Markdown of an
   answer, through `renderMarkdownPreview` (the first gate of the sanitizer).

   THE AI WORK OF A RECORDED REQUEST (2026-10-11): a request that ran as a
   live turn keeps where that turn sits in its run (`ChatRequest.runs`).
   Each one is a folded line, a sparkles icon and "{model} worked for
   {time}" (MonoCode style: a sparkles icon, the full model label); opened, the turn is read back from the run store
   of this PC (page by page) and drawn by `work-view.ts` (`textContent` only),
   so a chat reopened after a restart still shows everything the AI did. The
   runs live only on the PC that ran them: a turn run on another device is a
   plain line naming that device, and a turn gone from this store says so when
   opened. The line is never removed. A host without a run store (the phone)
   shows no line.
══════════════════════════════════════════════════════════ */

import { peindreCarteQuiz } from "./result-card";
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
import { poserProseAvecCadres } from "./prose-frames";
import { splitCardEdit } from "../explain-edit";
import { badgeDeFichier, couperNomAuMilieu } from "./file-icons";
import type { ChatRequest } from "./chat-record";
import type { RunningEntry } from "../shared-state/generations";
import { canOpenCard } from "../shared-state/chat-merge";
import { peindreQuestions } from "./generation-kind-vue";
import { sansPrecisions } from "./generation-kind";
import type { PasteOutcome } from "./relay-flow";
import { recordOrigin } from "../shared-state/request-origin";
import type { DeviceRef } from "../shared-state/request-origin";
import { labelOf, originContext, peindreOrigine, refsOf, statusText } from "./request-origin-vue";
import type { ChatRun } from "./chat-record";
import type { Thread } from "./live-thread";
import { recordedToolOutput, recordedTurn, recordedTurnMs } from "./live-generation";
import * as aiProviders from "./ai-providers";
import { renderThread } from "./work-view";

/** The milliseconds of each live turn once read (keyed by run and seq range),
    so a re-render does not read the run again. `null`: not knowable. */
const dureesTravail = new Map<string, number | null>();

/** "m:ss", as the generation line writes a duration (`duree` of file-generation-vue). */
function dureeTravail(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The title pieces of a live turn, MonoCode style: a sparkles icon and
    "{model} worked for {time}" (or "{model} worked" while the time is not
    known), inserted before `avant`. `nom` is the full model label ("Opus
    5.5"); without one, "Worked for {time}" (never "AI work"). Returns the nodes
    it made, so a redraw can drop them. */
function morceauxTitre(parent: HTMLElement, avant: HTMLElement | null, ms: number | undefined, nom: string): HTMLElement[] {
	const make = (tag: string, cls: string, text?: string): HTMLElement => {
		const e = document.createElement(tag);
		e.className = cls;
		if (text !== undefined) e.textContent = text;
		parent.insertBefore(e, avant);
		return e;
	};
	const icone = make("span", "qbd-ai-transcript-titre-icone");
	currentHost().ui.setIcon(icone, "sparkles");
	const texte = !nom
		? (ms === undefined ? t("ai.work.worked") : t("ai.work.workedFor", { time: dureeTravail(ms) }))
		: ms === undefined
			? t("ai.chat.workedNoTime", { model: nom })
			: t("ai.chat.worked", { model: nom, time: dureeTravail(ms) });
	return [icone, make("span", "qbd-ai-transcript-ligne-texte", texte)];
}

/** The AI work of a recorded request (its live turns), as the AI page paints
    it under a recorded turn: for a view that paints the rest of the turn
    itself (the Explain window). Nothing without runs or a run store. */
export function peindreTravailEnregistre(parent: HTMLElement, q: ChatRequest, deps: { chatOrigin: string; racine?(): string | null; ouvrirFichier?(absolu: string): void }): void {
	if (!q.runs?.length) return;
	peindreTravail(parent, q, recordOrigin(q, deps.chatOrigin, originContext()).runner, deps);
}

/** One folded line per live turn of the request. A turn run on THIS device is
    a button: its details are read from the store on the first unfolding, and
    its time is read lazily to fill the label. A turn run on ANOTHER device has
    its details in that device's store only: the line is plain text naming the
    device, never a button. A turn whose details are gone says so when opened;
    the line is never removed. */
function peindreTravail(parent: HTMLElement, q: ChatRequest, runner: DeviceRef, deps: { racine?(): string | null; ouvrirFichier?(absolu: string): void }): void {
	const host = currentHost();
	if (!host.live || !q.runs) return;
	const fournisseur = q.provider ?? "";
	// The full model label, resolved as the generation line does (file-generation-vue.ts).
	const p = fournisseur ? aiProviders.getProvider(fournisseur) : null;
	const id = q.model || p?.defaultModel || "";
	const nom = p ? (id ? aiProviders.libelleModele(fournisseur, id) : p.name) : "";
	for (const run of q.runs) {
		const bloc = ajouter(parent, "div", "qbd-ai-transcript");
		bloc.setAttribute("role", "log");
		bloc.setAttribute("aria-label", t("ai.transcript.label"));
		const clef = `${run.runId}:${run.fromSeq}:${run.toSeq}`;
		if (!runner.self) {
			const ligne = ajouter(bloc, "div", "qbd-ai-statut");
			morceauxTitre(ligne, null, undefined, nom);
			ajouter(ligne, "span", undefined, t("ai.work.detailsOn", { device: labelOf(runner) }));
			continue;
		}
		const b = ajouter(bloc, "button", "qbd-ai-transcript-ligne");
		b.type = "button";
		b.setAttribute("aria-expanded", "false");
		const chevron = ajouter(b, "span", "qbd-ai-transcript-chevron");
		host.ui.setIcon(chevron, "chevron-right");
		const connu = dureesTravail.get(clef);
		let morceaux = morceauxTitre(b, chevron, connu ?? undefined, nom);
		// The time is read once, lazily; the label fills when it is known.
		if (connu === undefined) {
			void recordedTurnMs(run).then(ms => {
				dureesTravail.set(clef, ms);
				if (ms === null || !b.isConnected) return;
				morceaux.forEach(m => m.remove());
				morceaux = morceauxTitre(b, chevron, ms, nom);
			});
		}
		let detail: HTMLElement | null = null;
		let lu: Promise<Thread | null> | null = null;
		b.addEventListener("click", () => {
			const ouvrir = !detail;
			b.setAttribute("aria-expanded", String(ouvrir));
			host.ui.setIcon(chevron, ouvrir ? "chevron-down" : "chevron-right");
			if (!ouvrir) { detail?.remove(); detail = null; return; }
			const d = document.createElement("div");
			d.className = "qbd-ai-transcript-detail qbd-ai-transcript-detail--anime";
			b.after(d);
			detail = d;
			const racine = ajouter(d, "div", "qbd-work");
			lu ??= recordedTurn(run).catch(() => null);
			void lu.then(thread => {
				if (detail !== d) return;
				// Gone from the store (deleted, or never kept here): say so, keep the line.
				if (!thread || !thread.items.length) { ajouter(d, "div", "qbd-ai-statut", t("ai.work.unavailable")); return; }
				// Read-only: a recorded turn has no permission left to answer.
				renderThread(racine, thread, { loadOutput: id => recordedToolOutput(run.runId, id), answer: () => {}, root: deps.racine?.() ?? undefined, openFile: deps.ouvrirFichier });
			});
		});
	}
}

/** The chips of the documents a request carried (thumbnail when there is one,
    else the name cut IN THE MIDDLE so the extension always shows). With `ouvrir`,
    a chip that has a path opens its preview when clicked (or Enter / Space). */
export function peindrePieces(parent: HTMLElement, notes: readonly { name: string; path?: string; thumb?: string }[], ouvrir?: (n: { name: string; path?: string }) => void): void {
	for (const n of notes) {
		const p = ajouter(parent, "div", "qbd-ai-message-piece");
		p.title = n.path || n.name;
		if (n.thumb) {
			p.classList.add("qbd-ai-message-piece--image");
			const el = ajouter(p, "img");
			el.src = n.thumb;
			el.alt = n.name;
		} else {
			const { tete, queue } = couperNomAuMilieu(n.name);
			const nom = ajouter(p, "span", "qbd-ai-message-piece-nom");
			ajouter(nom, "span", "qbd-ai-message-piece-tete", tete);
			if (queue) ajouter(nom, "span", "qbd-ai-message-piece-queue", queue);
			ajouter(p, "span", "qbd-ai-note-chip-badge", badgeDeFichier(n.name));
		}
		if (ouvrir && n.path) rendreOuvrable(p, () => ouvrir(n));
	}
}

/** Makes a chip a keyboard-reachable button that runs `action` on click, Enter or Space. */
function rendreOuvrable(p: HTMLElement, action: () => void): void {
	p.classList.add("is-openable");
	p.setAttribute("role", "button");
	p.tabIndex = 0;
	p.addEventListener("click", action);
	p.addEventListener("keydown", e => {
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		action();
	});
}

export function peindreTourEnregistre(parent: HTMLElement, q: ChatRequest, deps: { racine?(): string | null; ouvrirFichier?(absolu: string): void; chatOrigin: string; /** An Explain chat: its answers are shown without their `<card-edit>` block. */ explain?: boolean; ouvrir(path: string): void; ouvrirPiece?(n: { name: string; path?: string }): void; copier?(text: string): Promise<boolean>; repondre?(requestId: string, answers: string[][]): void; reprenable?(requestId: string): boolean }): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.demande = q.id;
	// A legacy chat has answers with no request text: no empty bubble.
	if (q.documents.length || q.text.trim()) {
		const message = ajouter(tour, "div", "qbd-ai-message");
		if (q.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), q.documents, deps.ouvrirPiece);
		if (sansPrecisions(q.text).trim()) ajouter(message, "div", "qbd-ai-bulle", sansPrecisions(q.text).trim());
	}
	// Who sent it and where it ran (a record always has both).
	const { sender, runner } = recordOrigin(q, deps.chatOrigin, originContext());
	peindreOrigine(tour, sender, runner);
	if (q.clarify) {
		const id = q.id;
		peindreQuestions(tour, q.clarify, deps.repondre && deps.reprenable?.(id) ? (answers) => deps.repondre?.(id, answers) : undefined, id);
	}
	if (q.runs?.length) peindreTravail(tour, q, runner, deps);
	for (const res of q.results) {
		if (res.kind === "text") {
			const texte = deps.explain ? splitCardEdit(res.text).shown : res.text;
			const rep = ajouter(tour, "div", "qbd-ai-chat-reponse");
			const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
			poserProseAvecCadres(prose, texte);
			if (texte.includes("$")) void mathifyElement(prose);
			if (deps.copier) {
				const pied = ajouter(rep, "div", "qbd-ai-chat-pied");
				const b = ajouter(pied, "button", "qbd-ai-file-btn");
				b.type = "button";
				host.ui.setIcon(b, "copy");
				b.setAttribute("aria-label", t("ai.chat.copy"));
				b.addEventListener("click", () => { void deps.copier?.(texte).then(ok => host.ui.notice(t(ok ? "ai.chat.copied" : "ai.chat.copyFailed"))); });
			}
			continue;
		}
		const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--prete");
		/* The whole card opens the quiz; with no note to open, it is inert. */
		if (canOpenCard(res.path)) {
			peindreCarteQuiz(rep, { titre: res.title, chemin: res.path }, () => deps.ouvrir(res.path));
		} else {
			const carte = ajouter(rep, "div", "qbd-ai-resultat qbd-ai-resultat--inerte");
			host.ui.setIcon(ajouter(carte, "span", "qbd-ai-resultat-icone"), "file-check-2");
			ajouter(ajouter(carte, "span", "qbd-ai-resultat-corps"), "span", "qbd-ai-resultat-titre", res.title);
		}
	}
	if (q.state === "failed" || q.state === "stopped") {
		const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--echouee");
		host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), q.state === "failed" ? "alert-triangle" : "square");
		ajouter(rep, "span", "qbd-ai-reponse-texte", statusText(q.state, runner, q.error));
	} else if (q.results.length) {
		ajouter(tour, "div", "qbd-ai-statut", statusText("done", runner));
	}
}

/** A request running on ANOTHER device (`remote` items of the thread): its
    message, then its progress read from that device's file. Never a stop
    button or a transcript: only the PC that runs it can show those. A stale
    file reads "paused" and never shows progress. */
export function peindreProgressionDistante(parent: HTMLElement, entry: RunningEntry, stale: boolean, device: string): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.distante = entry.requestId;
	if (entry.text.trim()) ajouter(ajouter(tour, "div", "qbd-ai-message"), "div", "qbd-ai-bulle", entry.text.trim());
	const { sender, runner } = refsOf(entry.from, undefined, device);
	peindreOrigine(tour, sender, runner);
	const rep = ajouter(tour, "div", stale ? "qbd-ai-reponse" : "qbd-ai-reponse qbd-ai-reponse--cours");
	host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), stale ? "pause" : "loader");
	const corps = ajouter(rep, "div", "qbd-ai-remote-corps");
	ajouter(corps, "span", "qbd-ai-reponse-etape", statusText(stale ? "paused" : "running", runner));
	if (stale) { ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.paused")); return; }
	const p = entry.progress;
	/* Before the first question, the PC's model is reasoning: its size says it
	   is at work (2026-10-08), where "Question 0" said nothing. */
	if (p.question === 0 && p.thinking) ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.thinking"));
	else ajouter(corps, "span", "qbd-ai-reponse-texte", p.total ? t("ai.remote.progress", { n: p.question, total: p.total }) : t("ai.remote.progressNoTotal", { n: p.question }));
	if (p.quiz !== undefined && p.quizTotal !== undefined) ajouter(corps, "span", "qbd-ai-reponse-texte", t("ai.remote.quiz", { n: p.quiz, total: p.quizTotal }));
}

/** A request the phone sent that no PC has taken yet: its message, then "Waiting for the PC" (or "Expired" past 24 h). `pcReachable` false (the PC the request was sent to is not fresh) adds the one line saying the PC does not seem on. */
export function peindreEnAttente(parent: HTMLElement, item: { key: string; target: string; from: string; fromName?: string; request: { text: string; documents: Array<{ path: string }> }; state: "waiting" | "expired" }, pcReachable: boolean, ouvrirPiece?: (n: { name: string; path?: string }) => void): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.attente = item.key;
	const message = ajouter(tour, "div", "qbd-ai-message");
	if (item.request.documents.length) {
		const notes = item.request.documents.map(d => ({ name: d.path.slice(d.path.lastIndexOf("/") + 1), path: d.path }));
		peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), notes, ouvrirPiece);
	}
	if (sansPrecisions(item.request.text).trim()) ajouter(message, "div", "qbd-ai-bulle", sansPrecisions(item.request.text).trim());
	const refs = refsOf(item.from, item.fromName, item.target);
	peindreOrigine(tour, refs.sender, refs.runner);
	const rep = ajouter(tour, "div", item.state === "expired" ? "qbd-ai-reponse qbd-ai-reponse--echouee" : "qbd-ai-reponse qbd-ai-reponse--cours");
	host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), item.state === "expired" ? "alert-circle" : "clock");
	const corps = ajouter(rep, "div", "qbd-ai-remote-corps");
	ajouter(corps, "span", "qbd-ai-reponse-texte", statusText(item.state, refs.runner));
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
export function peindreRelais(parent: HTMLElement, r: RelaisVue, ouvrirPiece?: (n: { name: string; path?: string }) => void): void {
	const host = currentHost();
	const tour = ajouter(parent, "div", "qbd-ai-tour");
	tour.setAttribute("role", "listitem");
	tour.dataset.relais = "1";
	const message = ajouter(tour, "div", "qbd-ai-message");
	if (r.documents.length) peindrePieces(ajouter(message, "div", "qbd-ai-message-pieces"), r.documents, ouvrirPiece);
	if (sansPrecisions(r.text).trim()) ajouter(message, "div", "qbd-ai-bulle", sansPrecisions(r.text).trim());
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
