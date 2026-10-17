import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { fileIcon } from "./file-icons";
import { fileIconSvg } from "./file-icon-svg";

/* ══════════════════════════════════════════════════════════
   THE ICON OF A FILE IN A ROW, one rule for every surface (2026-10-17)

   A PDF always shows the colour PDF mark of the "@" picker (the red one,
   `file-icon-svg.ts`): it was a red mark there, a Lucide book here, a green
   page in the Moodle window, and the same file did not look the same twice.
   Any other type keeps its Lucide icon (`file-icons.ts`).
══════════════════════════════════════════════════════════ */

export const estPdf = (name: string): boolean => /\.pdf$/i.test(name);

/** Replaces the content of `el` with the icon of the file `name`. */
export function poserIconeFichier(el: HTMLElement, name: string): void {
	el.replaceChildren();
	if (estPdf(name)) {
		const img = ajouter(el, "img", "nq-file-type-img");
		img.src = fileIconSvg(name);
		img.alt = "";
		img.draggable = false;
		return;
	}
	currentHost().ui.setIcon(el, fileIcon(name));
}
