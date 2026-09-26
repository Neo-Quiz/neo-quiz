import { Q_TYPES, _setIcon, _iconSpan, md2html } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import { createEditorFormHandlers } from "../editor/editor-form";
import type { EditorCtx } from "../types/editor-ctx";

/* ══════════════════════════════════════════════════════════
   PONT VERS LE FORMULAIRE DE L'ÉDITEUR

   La page « quiz » doit savoir éditer TOUS les types de questions —
   classement, appariement, texte à trous, numérique, terminal — et pas
   seulement les choix uniques/multiples. Ces formulaires existent déjà,
   éprouvés, dans `editor/editor-form.ts` : les réécrire produirait deux
   dialectes du même .md qui divergeraient au premier champ ajouté.

   Ce module les rend utilisables HORS de l'éditeur en fournissant le plus
   petit `EditorCtx` qui les satisfasse : une vue factice dont les quatre
   crochets (renderCode / schedulePreview / scheduleSave / render) sont
   redirigés vers la page. Rien d'autre du god-object de l'éditeur n'est
   nécessaire — c'est ce qui rend la bascule possible sans embarquer sa
   mise en page en trois colonnes.
══════════════════════════════════════════════════════════ */

export interface FormBridgeOptions {
	/** Une donnée a changé : persister (débounce côté appelant). */
	onChange(): void;
	/** L'ajout/retrait d'un champ a changé la structure : repeindre le panneau. */
	onStructureChange(): void;
	/** Chemin de la note éditée (voir EditorHostView.sourcePath). */
	sourcePath?: string;
}

export interface FormBridge {
	/** Les champs propres au type de la question (réponses, slots, paires…). */
	renderTypeFields(box: HTMLElement, q: DraftQuestion): void;
	/** Un champ libellé + saisie, au format de l'éditeur. */
	field(
		parent: HTMLElement,
		label: string,
		value: string | undefined,
		placeholder: string,
		multiline: boolean,
		onChange: (value: string) => void,
		/** Le champ édite du HTML : la barre de mise en forme insère alors des
		    balises (`<strong>`…) au lieu du markdown (`**`…). */
		html?: boolean,
	): HTMLElement;
}

export function createFormBridge(opts: FormBridgeOptions): FormBridge {
	/* `editor-form` signale un changement en appelant SUCCESSIVEMENT
	   `renderCode()`, `schedulePreview()` et `scheduleSave()`. Les deux
	   derniers mènent ici au même endroit : sans coalescence, chaque frappe
	   déclenchait deux fois le rafraîchissement de la liste et la
	   planification de l'écriture. Une micro-tâche suffit à les fondre — elles
	   partent toujours dans le même tour de boucle. */
	let notifPrevue = false;
	const notifier = (): void => {
		if (notifPrevue) return;
		notifPrevue = true;
		queueMicrotask(() => { notifPrevue = false; opts.onChange(); });
	};

	/* Vue factice. `editorInnerEl` n'est jamais lu (on n'appelle pas
	   renderEditor(), qui rendrait le formulaire ENTIER de l'éditeur) ; il est
	   quand même pointé sur un nœud détaché plutôt que laissé indéfini, pour
	   qu'un futur appel échoue visiblement au lieu d'écrire dans le vide. */
	const view = {
		editorInnerEl: document.createElement("div"),
		sourcePath: opts.sourcePath,
		/* Les quatre crochets mènent tous à la persistance, sauf `renderCode`
		   qui n'a plus de panneau à rafraîchir. `schedulePreview` en fait
		   partie : c'est le SEUL signal émis quand une image est collée dans
		   un champ (le fichier est écrit dans le vault et un wikilien inséré).
		   Le laisser inerte perdait le lien à la fermeture et laissait la
		   pièce jointe orpheline. */
		renderCode: () => { /* pas de panneau Code */ },
		schedulePreview: notifier,
		scheduleSave: notifier,
		render: () => opts.onStructureChange(),
	};

	/* Contexte COMPLET, et non plus un cast : `EditorCtx` ne décrit plus le
	   god-object de l'éditeur mais les sept champs que `editor-form.ts` lit
	   vraiment, et le pont les fournit tous. C'est l'ancien
	   `as unknown as EditorCtx` qui avait laissé `app` et `plugin` survivre ici
	   après que le contrat les eut perdus : une annotation les fait rougir. */
	const ctx: EditorCtx = {
		view,
		questions: [],
		activeIdx: 0,
		Q_TYPES,
		_setIcon,
		_iconSpan,
		md2html,
	};

	const handlers = createEditorFormHandlers(ctx);

	return {
		renderTypeFields: (box, q) => handlers._renderTypeFields(box, q),
		field: (parent, label, value, placeholder, multiline, onChange, html) =>
			handlers._field(parent, label, value, placeholder, multiline, onChange, { html: !!html }),
	};
}
