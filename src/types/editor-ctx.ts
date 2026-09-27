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

import type { ExamOptions } from "./quiz";
import type * as EditorUtils from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { EntreeGlossaire } from "../glossaire";

/**
 * Options d'examen côté ÉDITION. Sur-ensemble de `ExamOptions` (types/quiz.ts),
 * qui modélise les options ACTIVES telles que lues par le moteur une fois
 * l'examen construit (quiz-utils.ts extractExamOptions) : ce dernier n'a pas de
 * champ `enabled` car sa seule présence (non-null) vaut activation. Le
 * FORMULAIRE, lui, existe même quand l'examen est désactivé, et garde donc un
 * interrupteur explicite en plus des trois champs de `ExamOptions`.
 */
export interface EditorExamOptions extends ExamOptions {
	enabled: boolean;
	/**
	 * Mode du quiz, tel qu'il était écrit dans le bloc lu — déjà NORMALISÉ
	 * (readModeConfig) : "learn" a été renommé "lesson" (task 0 du lot mode
	 * leçon, 2026-08-31), et cette valeur ne vaut donc plus jamais "learn".
	 * Mémorisé pour être réémis à l'identique (editor/export.ts) : sans lui,
	 * un quiz importé en mode leçon ressortait en mode examen, ou perdait son
	 * mode.
	 */
	mode?: "quiz" | "lesson" | "exam";
	/**
	 * Clés de l'objet de mode que le plugin ne connaît pas, gardées telles
	 * quelles pour être réémises. Sans elles, un bloc écrit à la main perdait
	 * ses annotations personnelles à la première sauvegarde — même traitement
	 * que `_extraFields` sur une question.
	 */
	_extra?: Record<string, unknown>;
	/**
	 * Glossaire du quiz (lot D, 2026-09-27), lu par `readModeConfig`
	 * (editor/convert.ts) via `lireGlossaire` — déjà validé (`term`/`definition`
	 * non vides, `aliases` filtré). Sorti de `_extra` pour ne pas être réémis
	 * deux fois : c'est `editor/export.ts` `exportAll` qui l'écrit
	 * explicitement, dans l'objet de configuration. La modale « Vocabulaire »
	 * (tâche 4 du lot) modifie ce champ directement.
	 */
	glossary?: EntreeGlossaire[];
	/**
	 * Les éléments du tableau `glossary` de la note que `lireGlossaire` a
	 * écartés (terme ou définition vides, forme inattendue), gardés BRUTS pour
	 * être réécrits tels quels : ce qu'on ne comprend pas, on le rend. Sans
	 * eux, une entrée en cours d'écriture à la main disparaissait à la première
	 * sauvegarde d'une autre question (revue du 2026-09-27).
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
