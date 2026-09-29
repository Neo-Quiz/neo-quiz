/**
 * Ce qui reste du god-object de l'ÉDITEUR.
 *
 * L'éditeur en trois colonnes (Questions / Éditeur / Aperçu / Code) a été
 * retiré le 2026-07-31 : sa page de travail est désormais celle du dashboard
 * (dashboard/detail.ts), y compris dans l'onglet `quiz-blocks-builder`. Ce
 * fichier décrivait le `ctx` que `attachQuizEditorCore` assemblait — 17 slots,
 * ~35 méthodes aplaties, quatre panneaux redimensionnables. Tout cela est
 * parti avec lui.
 *
 * Il ne subsiste que ce dont le FORMULAIRE de questions (editor/editor-form.ts)
 * a besoin : ce formulaire, lui, a survécu — c'est le contrat qu'un pont
 * (dashboard/detail-form-bridge.ts) satisfait pour le rendre utilisable depuis
 * la page. Le garder aussi étroit qu'il l'est vraiment est ce qui a permis
 * cette réutilisation ; l'élargir « au cas où » ramènerait l'éditeur par la
 * fenêtre.
 *
 * Il l'est devenu DAVANTAGE à la tranche 3 : `app` et `plugin` ont quitté les
 * deux interfaces. Ils ne portaient qu'une capacité d'ÉCRITURE — le chemin
 * d'une pièce jointe et l'écriture de ses octets —, que l'hôte fournit
 * désormais (`HostPaths.attachmentPathFor`, `HostFs.writeBinary`). Les garder
 * aurait obligé la fenêtre à fabriquer une fausse `App` d'Obsidian pour
 * satisfaire un type dont plus personne ne lisait le contenu.
 *
 * Conséquence pour QUI LIRA CE FICHIER ENSUITE : le pont satisfait désormais
 * ce contrat SANS cast. Il portait un `as unknown as EditorCtx`, justifié à
 * l'époque où `EditorCtx` décrivait dix-sept slots dont le formulaire n'en
 * lisait que sept ; ce cast est précisément ce qui avait laissé `app` et
 * `plugin` survivre dans le pont après que ces deux interfaces les eurent
 * perdus. Le contrat et l'objet fourni coïncidant enfin, l'annotation
 * remplace le cast — et tout champ ajouté ici fera désormais rougir
 * `npm run check` chez l'appelant au lieu d'être silencieusement absent.
 */

import type * as EditorUtils from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { EntreeGlossaire } from "../glossaire";

/**
 * The block's configuration object on the EDITING side (read by
 * `readModeConfig`, written by `exportAll`). Since 2026-09-29 (spec
 * 2026-09-29-test-practice-exam-design §5.1) it holds only the mode, the
 * duration of an Exam, the glossary and the keys it does not know: the
 * `enabled` switch, `autoSubmit` and `showTimer` went with the retired
 * `examMode` / `examAutoSubmit` / `examShowTimer` keys.
 */
export interface EditorExamOptions {
	/**
	 * The quiz's mode as written in the block read — already NORMALISED
	 * (readModeConfig): a Learn is the internal "lesson", never "learn".
	 * Kept to be written back as it was (editor/export.ts): without it, a quiz
	 * imported as a Learn came out as an exam, or lost its mode.
	 */
	mode?: "quiz" | "lesson" | "exam";
	/**
	 * An Exam's duration in minutes, within [1, 300] (quiz-utils.ts
	 * `clampExamDuration`). Only read and written for an Exam; absent there,
	 * the export writes the fallback rule (`fallbackExamDuration`), so a saved
	 * Exam always carries an explicit duration.
	 */
	durationMinutes?: number;
	/**
	 * Keys of the mode object the plugin does not know, kept as they are to be
	 * written back. Without them, a hand-written block lost its personal
	 * annotations at the first save — same treatment as `_extraFields` on a
	 * question.
	 */
	_extra?: Record<string, unknown>;
	/**
	 * The quiz's glossary (batch D, 2026-09-27), read by `readModeConfig`
	 * (editor/convert.ts) through `lireGlossaire` — already validated
	 * (non-empty `term`/`definition`, filtered `aliases`). Out of `_extra` so
	 * as not to be written twice: `editor/export.ts` `exportAll` writes it
	 * explicitly in the configuration object. The Vocabulary modal (task 4 of
	 * the batch) changes this field directly.
	 */
	glossary?: EntreeGlossaire[];
	/**
	 * The items of the note's `glossary` array that `lireGlossaire` set aside
	 * (empty term or definition, unexpected shape), kept RAW to be written back
	 * as they are: what we do not understand, we give back. Without them, an
	 * entry being written by hand vanished at the first save of another
	 * question (review of 2026-09-27).
	 */
	_glossaryRest?: unknown[];
}

/**
 * L'hôte que le formulaire appelle quand une donnée change. Quatre crochets,
 * pas un de plus — c'est exactement ce que `createFormBridge` fournit :
 * - `renderCode` / `schedulePreview` : vestiges des panneaux disparus, appelés
 *   par le formulaire à chaque frappe. Le pont les rend inertes plutôt que de
 *   retoucher tous les points d'appel du formulaire.
 * - `scheduleSave` : persiste (débounce côté hôte).
 * - `render` : un ajout/retrait a changé la structure, repeindre le panneau.
 */
export interface EditorHostView {
	/** Conteneur du formulaire — inutilisé par le pont, qui ne rend que les
	    champs d'un TYPE et jamais le formulaire entier. */
	editorInnerEl: HTMLElement;
	/**
	 * Chemin de la NOTE éditée, quand il y en a une. Sert à ranger une image
	 * collée là où l'utilisateur l'a demandé : le réglage « dossier des pièces
	 * jointes » a des modes RELATIFS à la note (`./`, `./images`), et sans ce
	 * chemin Obsidian se rabat sur le fichier ACTIF — qui, depuis un onglet de
	 * quiz ou le dashboard, n'est pas la note du quiz.
	 *
	 * OPTIONNEL, mais les deux hôtes ne traitent pas son absence pareil, et le
	 * contrat l'assume (`HostPaths.attachmentPathFor`) : la fenêtre REJETTE là
	 * où Obsidian retombe sur son fichier actif. Un appelant qui n'a pas encore
	 * de note (page « Générer », `QuizDraft.file === null`) doit donc savoir
	 * qu'y coller une image échouera dans l'application.
	 */
	sourcePath?: string;
	renderCode(): void;
	schedulePreview(): void;
	scheduleSave?(): void;
	render(): void;
}

/**
 * Le contexte que `createEditorFormHandlers(ctx)` consomme. Sept champs, tous
 * vérifiables d'un `grep "ctx\."` sur editor/editor-form.ts — et depuis la
 * tranche 3, littéralement sept : `app` et `plugin` étaient déclarés sans
 * qu'aucun `ctx.app` n'existe, le formulaire ne lisant que `ctx.plugin.app`.
 */
export interface EditorCtx {
	view: EditorHostView;
	/** Questions du quiz édité, et l'index de celle qu'on modifie. */
	questions: DraftQuestion[];
	activeIdx: number;

	Q_TYPES: typeof EditorUtils.Q_TYPES;
	_setIcon: typeof EditorUtils._setIcon;
	_iconSpan: typeof EditorUtils._iconSpan;
	md2html: typeof EditorUtils.md2html;
}
