/* An AI answer in prose, as HTML, with each fenced ```html block drawn as an
   interactive page in a sandboxed frame (engine/html-frame-core.ts) instead of
   its source as code. Shared by the answers still in the generation queue
   (file-generation-vue.ts) and the recorded ones (chat-record-vue.ts): an
   Explain answer looked right in its window but showed raw HTML on the AI
   page once recorded (2026-10-14). */

import { renderMarkdownPreview } from "../markdown-preview";
import { brancherCadres, htmlFrameMarkup } from "../engine/html-frame";
import { splitHtmlBlocks } from "../engine/html-frame-core";
import { t } from "../i18n";

/** Writes `texte` into `prose`. Each block goes through the markdown renderer
    as a plain token, then its paragraph is replaced by the frame; a block still
    being written is a placeholder (a half page would reload at every chunk). */
export function poserProseAvecCadres(prose: HTMLElement, texte: string): void {
	const cadres: string[] = [];
	const seul = splitHtmlBlocks(texte).map(seg => {
		if (seg.kind === "text") return seg.value;
		cadres.push(seg.kind === "html" ? htmlFrameMarkup(seg.value) : `<div class="nq-html-frame nq-html-frame--pending">${t("engine.htmlFrame.drawing")}</div>`);
		return `\n\nNQFRAME${cadres.length - 1}END\n\n`;
	}).join("");
	let rendu = renderMarkdownPreview(seul);
	cadres.forEach((c, i) => { rendu = rendu.replace(new RegExp("<p>[^<]*NQFRAME" + i + "END[^<]*</p>|NQFRAME" + i + "END"), () => c); });
	prose.innerHTML = rendu;
	if (cadres.length) brancherCadres(prose);
}
