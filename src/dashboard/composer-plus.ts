import { currentHost } from "../host/current";
import { t } from "../i18n";
import { openActionMenu, openNotePicker } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   LE MENU « + » DU COMPOSER DE « GÉNÉRER » — réplique du menu « + » de
   claude.ai (relevé du 2026-09-26) : « Ajouter des fichiers ou des
   images » avec son raccourci, un filet, puis les autres sources du
   composer. Il porte `qbd-menu-claude`, la matière des menus de claude.ai
   (fond plein, filet intérieur, rayon 12 px, lignes de 32 px).
══════════════════════════════════════════════════════════ */

export interface MenuPlusDeps {
	/** Le raccourci d'« Ajouter des fichiers », déjà formaté (« Ctrl+U »). */
	raccourci: string;
	ajouterFichiers(): void;
	/** Joint une note du vault par son chemin. */
	joindreNote(chemin: string): void;
	/** Les notes ouvertes, en tête du sélecteur (hôte à onglets seulement). */
	notesOuvertes?: () => { path: string; basename: string }[];
	/** Le champ du composer, où « Mentionner » tape le « @ ». */
	champ: HTMLTextAreaElement;
}

export function ouvrirMenuPlus(ancre: HTMLElement, deps: MenuPlusDeps): void {
	const host = currentHost();
	const items: ActionMenuItem[] = [
		{ icon: "paperclip", label: t("ai.add.files"), hint: deps.raccourci, onClick: deps.ajouterFichiers },
		{
			icon: "notebook-text", label: t("ai.add.note"), sepBefore: true,
			onClick: () => openNotePicker(ancre, {
				openFiles: deps.notesOuvertes?.() ?? [],
				allFiles: host.fs.listMarkdown(),
				onPick: (f) => deps.joindreNote(f.path)
			})
		},
		{ icon: "at-sign", label: t("ai.add.mention"), hint: "@", onClick: () => taperArobase(deps.champ) }
	];
	openActionMenu(ancre, items, { className: "qbd-menu-claude qbd-ai-plus-menu" });
}

/** Tape « @ » au caret (précédé d'une espace s'il colle à un mot : le
    picker n'ouvre que sur un « @ » en début de mot), puis rejoue l'événement
    `input` que le picker et le composer écoutent. */
function taperArobase(champ: HTMLTextAreaElement): void {
	champ.focus();
	const debut = champ.selectionStart ?? champ.value.length;
	const avant = debut > 0 ? champ.value[debut - 1] : "";
	const texte = avant && !/\s/.test(avant) ? " @" : "@";
	champ.setRangeText(texte, debut, champ.selectionEnd ?? debut, "end");
	champ.dispatchEvent(new Event("input", { bubbles: true }));
}
