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
import { t } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { renderMarkdownPreview } from "../markdown-preview";
import { badgeDeFichier, couperNomAuMilieu } from "./file-icons";
import type { ChatRequest } from "./chat-record";
import { peindreQuestionGenre } from "./generation-kind-vue";
import type { KindChoice } from "./generation-kind";

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

export function peindreTourEnregistre(parent: HTMLElement, q: ChatRequest, deps: { ouvrir(path: string): void; copier?(text: string): Promise<boolean>; choisirGenre?(requestId: string, kind: KindChoice): void }): void {
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
	if (q.ask) {
		const id = q.id;
		peindreQuestionGenre(tour, q.ask, deps.choisirGenre ? (kind) => deps.choisirGenre?.(id, kind) : undefined);
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
		const b = ajouter(carte, "button", "qbd-ai-reponse-action", t("ai.queue.open"));
		b.type = "button";
		b.addEventListener("click", () => deps.ouvrir(res.path));
	}
	if (q.state === "failed" || q.state === "stopped") {
		const rep = ajouter(tour, "div", "qbd-ai-reponse qbd-ai-reponse--echouee");
		host.ui.setIcon(ajouter(rep, "span", "qbd-ai-reponse-icone"), q.state === "failed" ? "alert-triangle" : "square");
		ajouter(rep, "span", "qbd-ai-reponse-texte", q.state === "failed" ? (q.error || t("ai.thread.failed")) : t("ai.thread.stopped"));
	}
}
