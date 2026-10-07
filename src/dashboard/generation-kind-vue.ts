/* ══════════════════════════════════════════════════════════
   THE QUESTION CARD of a request that did not say Learn or Test
   (spec 2026-10-07-generate-auto-kind)

   Shown in the chat thread under the request: a tile (it is content) holding
   the question and its answers as flat rows — not a modal, nothing generates
   until a row is clicked. Once answered the card stays in the history with
   the chosen row marked and the others dimmed.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import type { ChatAsk } from "./chat-record";
import type { KindChoice } from "./generation-kind";

export function peindreQuestionGenre(parent: HTMLElement, ask: ChatAsk, choisir?: (kind: KindChoice) => void): void {
	const host = currentHost();
	const carte = ajouter(parent, "div", "qbd-ai-kind");
	carte.setAttribute("role", "group");
	carte.setAttribute("aria-label", ask.question);
	const repondue = !!ask.chosen;
	carte.classList.toggle("is-answered", repondue);
	ajouter(carte, "div", "qbd-ai-kind-question", ask.question);
	const liste = ajouter(carte, "div", "qbd-ai-kind-options");
	let choisie = false;
	for (const o of ask.options) {
		const b = ajouter(liste, "button", "qbd-ai-kind-option");
		b.type = "button";
		const estChoisie = repondue && o.kind === ask.chosen;
		b.classList.toggle("is-chosen", estChoisie);
		ajouter(b, "span", "qbd-ai-kind-label", o.label);
		if (estChoisie) {
			host.ui.setIcon(ajouter(b, "span", "qbd-ai-kind-check"), "check");
			b.setAttribute("aria-pressed", "true");
		}
		// An answered card, or one with no handler (a record read back), is read-only.
		if (repondue || !choisir) { b.disabled = true; continue; }
		b.addEventListener("click", () => {
			if (choisie) return;
			choisie = true;
			liste.querySelectorAll("button").forEach(x => { x.disabled = true; });
			choisir(o.kind);
		});
	}
}
