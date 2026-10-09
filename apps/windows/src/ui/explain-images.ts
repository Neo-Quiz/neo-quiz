/* The course pictures an "Explain" answer cites (`src/explain-images.ts` settled
   which ones, as tokens in the text). Swapped here, once the text is rendered,
   for real pictures built with DOM calls (no HTML string): the source comes
   from the host, which only serves files of the opened folders, and a click
   opens the viewer. A picture the host cannot serve stays its name, as text. */

import { currentHost } from "../../../../src/host/current";
import { ouvrirImage } from "../../../../src/engine/image-zoom";
import { JETON_RE } from "../../../../src/explain-images";
import type { ImageJointe } from "../../../../src/explain-images";

export function poserImagesCitees(prose: HTMLElement, images: readonly ImageJointe[]): void {
	if (!images.length) return;
	const links = currentHost().links;
	const textes: Text[] = [];
	const marcheur = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
	for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
		if (new RegExp(JETON_RE.source).test(n.nodeValue ?? "")) textes.push(n as Text);
	}
	for (const noeud of textes) {
		const texte = noeud.nodeValue ?? "";
		const frag = document.createDocumentFragment();
		let fin = 0;
		for (const m of texte.matchAll(JETON_RE)) {
			const debut = m.index ?? 0;
			if (debut > fin) frag.append(texte.slice(fin, debut));
			fin = debut + m[0].length;
			const j = images[Number(m[1])];
			const src = j ? links.resourceUrl(j.path) : null;
			if (!j || !src) { frag.append(j?.name ?? ""); continue; }
			const fig = document.createElement("figure");
			fig.className = "nq-explain-image";
			const img = document.createElement("img");
			img.src = src;
			img.alt = j.name;
			img.loading = "eager";
			img.addEventListener("click", () => {
				const toutes = [...(prose.ownerDocument.querySelectorAll<HTMLImageElement>(".nq-explain-image img"))];
				ouvrirImage(toutes, Math.max(0, toutes.indexOf(img)));
			});
			fig.append(img);
			frag.append(fig);
		}
		if (fin < texte.length) frag.append(texte.slice(fin));
		noeud.replaceWith(frag);
	}
}
