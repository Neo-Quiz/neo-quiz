import { t } from "../i18n";
import { currentHost } from "../host/current";
import { reserveFreePath, releaseReservedPath } from "../unique-path";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { insererTexte } from "./format-toolbar";

/* ══════════════════════════════════════════════════════════
   COLLER UNE IMAGE DANS UN CHAMP DIRECT

   Sorti d'`editor-form.ts` (2026-09-26, tâche 5 de l'édition dans le rendu) :
   les champs ouverts dans le RENDU corrigé (dashboard/edition-rendu.ts) collent
   une image exactement comme ceux du formulaire — même chemin décidé par
   l'hôte, même réservation du nom, même lien `![[…]]`. Deux copies de ce code
   auraient divergé au premier correctif.
══════════════════════════════════════════════════════════ */

/**
 * Chemin où écrire une image collée, décidé par L'HÔTE.
 *
 * `paths.attachmentPathFor` (`src/host/types.ts`) résout ce que l'hôte est
 * seul à savoir : sous Obsidian le réglage « dossier des pièces jointes » — y
 * compris ses modes relatifs `./` (le dossier de la note) et `./sous-dossier`
 * —, dans la fenêtre le dossier de la note elle-même. Le calculer à la main
 * donnait `.//Pasted image….png`, et écrivait à la RACINE du vault ce qui
 * devait aller à côté de la note (revue codex 2026-07-31).
 *
 * `sourcePath` est la note à laquelle l'image appartient. Les deux hôtes n'en
 * font PAS la même chose quand elle manque, et le contrat le dit plutôt que de
 * l'uniformiser : Obsidian retombe sur son fichier ACTIF ; la fenêtre REJETTE
 * avec une cause nommée, n'ayant pas de fichier actif et ne pouvant pas
 * choisir une racine sans risquer de poser l'image hors de celle où la note
 * finira. Le `catch` de l'appelant transforme ce rejet en message.
 */
export async function cheminImageCollee(ext: string, sourcePath?: string): Promise<{ fileName: string; filePath: string }> {
	const now = new Date();
	const ts = now.getFullYear().toString() +
		String(now.getMonth() + 1).padStart(2, "0") +
		String(now.getDate()).padStart(2, "0") +
		String(now.getHours()).padStart(2, "0") +
		String(now.getMinutes()).padStart(2, "0") +
		String(now.getSeconds()).padStart(2, "0");
	/* L'HÔTE décide du DOSSIER (et déduplique contre ce qui EXISTE déjà), la
	   réservation décide du NOM quand deux collages se suivent : mesuré, deux
	   appels rapprochés rendent le MÊME chemin tant que le fichier n'existe pas
	   encore, et la seconde image écrasait la première.
	   Elle reste ici et NON dans l'hôte, parce que le contrat le dit
	   (`HostPaths.attachmentPathFor`) : un hôte qui réserverait à notre place
	   ferait tomber CETTE réservation sur un nom déjà pris par lui, chaque
	   collage sortirait en « ….-2.png » et le nom de base resterait brûlé sans
	   jamais être écrit. */
	const propose = await currentHost().paths.attachmentPathFor(
		`Pasted image ${ts}.${ext}`, sourcePath);
	const point = propose.lastIndexOf(".");
	const filePath = await reserveFreePath(
		point > 0 ? propose.slice(0, point) : propose,
		point > 0 ? propose.slice(point) : "",
		(c) => currentHost().fs.exists(c));
	/* Le lien `![[…]]` porte le NOM, pas le chemin : c'est la forme qu'Obsidian
	   résout lui-même, et celle que le moteur attend (engine/sanitizer.ts
	   resolveObsidianEmbedFile). */
	return { fileName: filePath.split("/").pop() || filePath, filePath };
}

export interface OptionsCollage {
	/** La note éditée : l'hôte y rattache l'image. */
	sourcePath?: string;
	/** Appelé une fois l'image écrite et son lien posé (la page sauvegarde). */
	apres(): void;
}

/** Coller une image dans un champ direct : le fichier écrit par l'hôte, un
    `![[…]]` inséré au curseur. Le `preventDefault` part AVANT l'écriture
    asynchrone : sinon CodeMirror collerait aussi le presse-papiers.
    `onChange` est celui du champ : si le champ a été détruit pendant
    l'écriture (formulaire repeint, champ du rendu validé), le lien passe par
    lui au lieu d'être inséré dans une vue morte — sinon l'image restait
    orpheline dans le vault, sans lien dans la note. */
export function collageImage(onChange: (value: string) => void, opts: OptionsCollage): Extension {
	return EditorView.domEventHandlers({
		paste(e, vue) {
			const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"));
			const file = item?.getAsFile();
			if (!item || !file) return false;
			e.preventDefault();
			void (async () => {
				/* Un rejet ici ne remonterait NULLE PART : sans ce `try`, une
				   image qui ne pouvait pas s'écrire disparaissait en silence. */
				try {
					const ext = item.type.split("/")[1] || "png";
					const { fileName, filePath } = await cheminImageCollee(ext, opts.sourcePath);
					const buffer = await file.arrayBuffer();
					try {
						await currentHost().fs.writeBinary(filePath, new Uint8Array(buffer));
					} catch (err) { releaseReservedPath(filePath); throw err; }
					const lien = `![[${fileName}]]`;
					if (vue.dom.isConnected) {
						insererTexte(vue, lien, () => { /* l'écouteur du champ notifie */ });
					} else {
						// Vue détruite : son dernier état reste lisible, et la
						// sélection d'alors dit où le lien devait aller.
						const { from, to } = vue.state.selection.main;
						const doc = vue.state.doc.toString();
						onChange(doc.slice(0, from) + lien + doc.slice(to));
					}
					opts.apres();
				} catch (err) {
					console.error("[quiz-blocks] collage d'image impossible :", err);
					currentHost().ui.notice(t("editor.paste.imageFailed"));
				}
			})();
			return true;
		},
	});
}
