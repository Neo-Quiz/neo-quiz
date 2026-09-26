import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { makeDefault, Q_TYPES } from "../editor/utils";
import type { DraftQuestion, QuestionTypeKey } from "../editor/utils";
import { changerType, memeFamille } from "../editor/gestes";
import { openConfirmModal } from "../editor/modals";
import { libererChamps } from "../editor/champ-direct";
import { QUESTION_ROLES } from "../types/quiz";
import type { QuestionRole } from "../types/quiz";
import { createSelect } from "./ui-select";
import { monterEditionRendu } from "./edition-rendu";
import { createFormBridge } from "./detail-form-bridge";
import type { FormBridge } from "./detail-form-bridge";
import { bloc, renderExtras, section } from "./detail-question";
import type { EditCallbacks } from "./detail-question";

/* ══════════════════════════════════════════════════════════
   LA QUESTION EN ÉDITION : SON RENDU CORRIGÉ, ET « PLUS »
   (chantier « éditer dans le rendu », 2026-09-26, tâche 5)

   De haut en bas :
   - une BARRE fine — le type de la question et, dans un Learn, son rôle :
     deux menus `ui-select` précédés de leur nom, du texte et des contrôles,
     pas une carte ;
   - le RENDU corrigé de la question (edition-rendu.ts) : on clique un texte
     pour le modifier, la lettre d'une réponse pour la marquer juste… ;
   - « Plus », repliable, fermé par défaut : le formulaire de l'éditeur
     LIMITÉ à ce que le rendu ne sait pas faire (champs du type rares,
     énoncé ou explication restés en HTML, document, leçon, ressource,
     indice). Son état ouvert/fermé est tenu par la page, pour survivre aux
     repeints.

   Les deux moitiés se tiennent à jour : un changement dans « Plus » repeint
   le rendu (après une courte pause, pas à chaque frappe), un changement dans
   le rendu repeint « Plus » (une liste d'éléments y montrerait sinon
   l'ancien texte, et l'écrirait par-dessus le nouveau).
══════════════════════════════════════════════════════════ */

export interface EditionCallbacks {
	/** Une donnée a changé : persister (débounce côté page) + rafraîchir la liste. */
	onChange(): void;
	/** La structure du panneau a changé : repeindre le panneau. */
	onStructureChange(): void;
	/** Le type ou le rôle a changé : repeindre la liste (icône, nom) et le panneau. */
	onListeChange(): void;
	/** « Plus » est-il ouvert ? Mémorisé par la page. */
	plusOuvert: boolean;
	setPlusOuvert(ouvert: boolean): void;
	/** Le quiz est un Learn : la barre propose le rôle. */
	estLecon: boolean;
}

/** Pause avant de repeindre le rendu après une frappe dans « Plus ». */
const PAUSE_RENDU_MS = 300;

/** Le nom de chaque rôle d'une question de Learn. `test`, le rôle par défaut
    (une question sans rôle en est une), n'avait pas de libellé : la fiche ne
    l'affiche pas. */
const ROLE_LIBELLES: Record<QuestionRole, TransKey> = {
	pre: "engine.lesson.rolePre",
	read: "engine.lesson.roleRead",
	explain: "engine.lesson.roleExplain",
	recall: "engine.lesson.roleRecall",
	test: "editor.render.roleTest",
};

/**
 * Monte la question `q` (numéro `index`, à partir de 0) en édition dans
 * `parent`. Renvoie le nettoyage — à appeler AVANT tout repeint du panneau
 * ou changement de question : il valide un texte ouvert, retire les
 * écouteurs du rendu et détruit ses champs.
 */
export function renderQuestionEditRendu(parent: HTMLElement, q: DraftQuestion, index: number, cb: EditionCallbacks, sourcePath?: string): () => void {
	parent.classList.add("qbd-qz-er");
	renderBarre(parent, q, cb);

	const hoteRendu = ajouter(parent, "div", "qbd-qz-er-rendu");
	let demonter: (() => void) | null = null;
	let minuterie: number | null = null;

	function monter(): void {
		demonter?.();
		demonter = monterEditionRendu(hoteRendu, q, {
			sourcePath,
			titreDeRepli: `Question ${index + 1}`,
			onChange: cb.onChange,
			rendre: peindrePlus,
		});
	}
	/* Un texte OUVERT dans le rendu n'est jamais remonté sous le curseur : la
	   frappe dans « Plus » attendra le repeint suivant. */
	function repeindreRenduPlusTard(): void {
		if (minuterie !== null) window.clearTimeout(minuterie);
		minuterie = window.setTimeout(() => {
			minuterie = null;
			if (hoteRendu.isConnected && !hoteRendu.querySelector(".is-editing")) monter();
		}, PAUSE_RENDU_MS);
	}

	const cbPlus: EditCallbacks = {
		onChange: () => { cb.onChange(); repeindreRenduPlusTard(); },
		onStructureChange: cb.onStructureChange,
	};
	const bridge = createFormBridge({ ...cbPlus, sourcePath });

	const plus = section(parent, "sliders-horizontal", t("editor.render.more"), cb.plusOuvert, cb.setPlusOuvert);
	plus.parentElement?.parentElement?.classList.add("qbd-qz-er-plus");
	plus.classList.add("qbd-qz-form");

	function peindrePlus(): void {
		libererChamps(plus);
		plus.replaceChildren();
		remplirPlus(plus, q, cbPlus, bridge);
	}

	monter();
	peindrePlus();

	return () => {
		if (minuterie !== null) { window.clearTimeout(minuterie); minuterie = null; }
		demonter?.();
		demonter = null;
		libererChamps(parent);
	};
}

/* ── La barre : type et rôle ──────────────────────────────── */

function renderBarre(parent: HTMLElement, q: DraftQuestion, cb: EditionCallbacks): void {
	const barre = ajouter(parent, "div", "qbd-qz-er-barre");
	const ui = currentHost().ui;

	ajouter(barre, "span", "qbd-qz-er-barre-nom", t("editor.render.type"));
	const type = createSelect(barre, {
		value: q._type,
		options: Q_TYPES.map(d => ({ value: d.key, label: d.label })),
		// L'icône du type devant son nom, comme dans la liste de gauche.
		renderTrigger: (el, cur) => {
			const def = Q_TYPES.find(d => d.key === cur?.value);
			if (def) ui.setIcon(ajouter(el, "span", "qbd-qz-er-barre-icone"), def.lucide);
			ajouter(el, "span", undefined, cur?.label ?? "");
		},
		onChange: (v) => {
			const cible = Q_TYPES.find(d => d.key === v)?.key;
			if (!cible) return;
			const appliquer = (): void => {
				if (!changerType(q, makeDefault(cible as QuestionTypeKey))) return;
				cb.onChange();
				cb.onListeChange();
			};
			// Choix ⇄ choix, saisie ⇄ saisie : rien ne se perd. Sinon les
			// réponses de l'ancien type partent — on le demande d'abord.
			if (memeFamille(q._type, cible)) { appliquer(); return; }
			openConfirmModal(
				t("editor.render.typeChangeTitle"),
				t("editor.render.typeChangeMessage"),
				t("editor.render.typeChangeConfirm"),
				t("editor.action.cancel"),
				(ok) => { if (ok) appliquer(); else type.setValue(q._type); },
			);
		},
	});
	type.el.setAttribute("aria-label", t("editor.render.type"));

	/* Le rôle n'a de sens que dans un Learn (engine/lesson.ts) ; une question
	   qui en porte déjà un le montre aussi, pour qu'on puisse le corriger. */
	if (!cb.estLecon && !q.role) return;
	ajouter(barre, "span", "qbd-qz-er-barre-nom", t("editor.render.role"));
	const role = createSelect(barre, {
		value: q.role ?? "test",
		options: QUESTION_ROLES.map(r => ({ value: r, label: t(ROLE_LIBELLES[r]) })),
		onChange: (v) => {
			const r = QUESTION_ROLES.find(x => x === v);
			if (!r) return;
			// Sans rôle, une question EST un test : rien à écrire.
			if (r === "test" && !q.role) return;
			q.role = r;
			cb.onChange();
			cb.onListeChange();
		},
	});
	role.el.setAttribute("aria-label", t("editor.render.role"));
}

/* ── « Plus » : les champs rares ──────────────────────────── */

function remplirPlus(box: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	/* Les champs du TYPE que le rendu ne modifie pas : ajouter ou retirer un
	   élément d'un classement ou d'un appariement, l'invite d'un terminal, le
	   texte d'aide, la casse, l'unité et les marges d'un numérique. Rien pour
	   un QCM ni une carte mémoire : tout s'y fait dans le rendu. */
	const typeSec = bloc(box, t("dashboard.quiz.editAnswers"));
	const typeBox = ajouter(typeSec, "div", "qbd-qz-type-box");
	bridge.renderTypeFields(typeBox, q, { rares: true });
	if (!typeBox.childElementCount) typeSec.remove();

	/* Un énoncé ou une explication restés en HTML (une conversion en markdown
	   aurait perdu quelque chose) : visibles dans le rendu, modifiables ici,
	   en HTML — c'est la seule façon de garder ce qu'aucun markdown ne dit. */
	if (q._promptHtml) {
		const sec = bloc(box, t("editor.render.promptHtml"));
		bridge.field(sec, "", q._promptHtml.replace(/<br\s*\/?>/gi, "\n"), t("dashboard.quiz.editPromptPlaceholder"), true, (v) => {
			q._promptHtml = v;
			q._useHtmlPrompt = true;
			cb.onChange();
		}, true);
	}
	if (q._explainHtml) {
		const sec = bloc(box, t("editor.render.explainHtml"));
		bridge.field(sec, "", q._explainHtml.replace(/<br\s*\/?>/gi, "\n"), t("editor.form.explainPlaceholder"), true, (v) => {
			/* Le texte de secours `explain` reste : l'export écrit les deux
			   (même règle que l'ancien champ d'explication). */
			q._explainHtml = v;
			cb.onChange();
		}, true);
	}

	// Document, leçon, ressource, indice : les sections de toujours.
	renderExtras(box, q, cb, bridge);
}
