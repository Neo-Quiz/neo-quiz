import type { EngineCtx } from "../types/engine-ctx";
import type { QuestionRole } from "../types/quiz";
import { mathifyElement } from "./mathjax";
import { t } from "../i18n";
import { corpsLectureHtml, corpsLectureCourteHtml, brancherCartes } from "./lecture-rendu";
import type { CorpsLecture, PortesLecture } from "./lecture-rendu";
import { stripInlineMarkdown } from "./sanitizer";

/* ══════════════════════════════════════════════════════════
   SUPPORT DE COMPRÉHENSION — le document qu'on lit avant de répondre.

   Un vrai sujet d'examen n'est pas qu'une suite de questions de cours : il
   comporte une partie compréhension, où UN document (texte, cas, extrait de
   code, image) porte PLUSIEURS questions. C'est ce que ce module rend.

   Partage : les questions qui déclarent le même `passageId` montrent le même
   support ; une seule porte le texte, les autres n'écrivent que l'identifiant.
   L'état replié est mémorisé PAR SUPPORT (pas par question) — replier le texte
   sur Q1 le garde replié en arrivant sur Q2, ce qu'attend un lecteur qui a fini
   de lire et veut la place pour répondre.

   Les LECTURES d'un Learn ne passent plus par ici (décision d'Ahmed du
   2026-09-26, la dernière) : chacune a son propre écran (engine/cards.ts,
   `corpsLecture` ci-dessous pour son style), sauf une lecture très courte,
   lue en texte simple au-dessus de sa question hôte (src/lecture-etape.ts).
   Aucune ne s'affiche plus en support replié au-dessus des questions. Ce
   module ne rend plus que le support `passage`/`passageId` d'une question.
══════════════════════════════════════════════════════════ */

/**
 * Deux régimes d'affichage du support :
 * - "open" : rendu et déplié, sans repli ;
 * - "collapsible" : rendu, déplié, repliable à la demande.
 * Le régime « replié avec Tentez de répondre sans lire » est parti avec le
 * cours au-dessus des questions (2026-09-26) : aucun support n'est plus
 * replié d'office.
 */
export type PassageVisibility = "open" | "collapsible";

/**
 * Décision PURE, vérifiable sans DOM (`scripts/check-passage.mjs`) : le
 * rendu ne fait QUE la consulter. Le support d'une carte de LECTURE jouée en
 * Learn est son contenu : ouvert. Partout ailleurs : repliable, ouvert par
 * défaut, quel que soit le rôle.
 */
export function passageVisibility({ role, isLesson }: { role: QuestionRole; isLesson: boolean }): PassageVisibility {
	return isLesson && role === "read" ? "open" : "collapsible";
}

/** Support résolu pour une question donnée (partage `passageId` déjà appliqué). */
export interface ResolvedPassage {
	/** Clé d'identité et de partage — `passageId` s'il existe, sinon une clé privée à la question. */
	key: string;
	title: string;
	/** Texte brut du support (rendu avec embeds) ; vide si `html` porte le contenu. */
	text: string;
	/** HTML pré-rendu du support, prioritaire sur `text`. */
	html: string;
	/** Indices des questions qui partagent ce support, ordre du quiz. */
	sharedWith: number[];
}

export interface PassageHandlers {
	resolvePassage(qi: number): ResolvedPassage | null;
	/** Décision de visibilité seule (rôle + verrouillage + mode Leçon), sans le repli par défaut — voir `passageHtml`. */
	passageVisibilityFor(qi: number): PassageVisibility;
	passageHtml(qi: number): string;
	bindPassage(trackItem: HTMLElement, qi: number): void;
	/**
	 * Vide l'état de session mémorisé par CLÉ de support (repli manuel de
	 * l'utilisateur + repli par défaut déjà semé). À appeler depuis
	 * `resetQuiz` (engine/state.ts) : sans ça, un « recommencer » ou un
	 * aller-retour Leçon → Examen → Leçon retrouve un support de rôle "test"
	 * qui ne se replie plus par défaut (déjà semé lors de la session
	 * précédente), et un support replié manuellement le reste pour toujours —
	 * corrigé au round 1 de revue de la Task 4.
	 */
	resetPassageState(): void;
}

/* Icônes Lucide inline (book-open, chevron-down) : le plugin n'a pas d'autre
   canal d'icône côté moteur — `ctx.lucideIcons` est vestigial et setIcon()
   d'Obsidian ne s'applique qu'à un nœud DOM déjà monté, alors que tout le
   moteur construit des chaînes HTML. */
const ICON_BOOK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>';
const EMBED_PASSAGE = { wrapClass: "quiz-passage-embed-wrap", imgClass: "quiz-passage-embed" };

/** Les portes du sanitizer du moteur pour le corps d'une lecture. */
function portesMoteur(ctx: EngineCtx): PortesLecture {
	return {
		bloc: s => ctx.sanitize.renderTextWithEmbeds(s, EMBED_PASSAGE),
		inline: s => ctx.sanitize.renderInlineText(s),
		attribut: s => ctx.escapeHtmlAttr(stripInlineMarkdown(s)),
	};
}

/**
 * Le corps STYLÉ d'une lecture sur son ÉCRAN (engine/cards.ts), par les
 * portes du sanitizer du moteur.
 */
export function corpsLecture(ctx: EngineCtx, item: unknown, brut: string, texteHtml: string, titre?: string): CorpsLecture {
	return corpsLectureHtml(item, brut, texteHtml, titre, portesMoteur(ctx));
}

/** La version LÉGÈRE d'une lecture courte, au-dessus de sa question hôte
    (engine/cards.ts) : mêmes portes. */
export function corpsLectureCourte(ctx: EngineCtx, item: unknown, brut: string, texteHtml: string): CorpsLecture {
	return corpsLectureCourteHtml(item, brut, texteHtml, portesMoteur(ctx));
}

const ICON_CHEVRON ='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * État de repli des supports, par CLÉ — extrait en fonction PURE (aucune
 * dépendance à `ctx` ni au DOM) pour la même raison que `passageVisibility` :
 * le rendre vérifiable par `scripts/check-lesson.mjs` sans passer par un
 * clic réel (`bindPassage` a besoin d'un `document`, absent hors Obsidian).
 *
 * Round 1 de revue de la Task 4, FINDING important : `resetQuiz` ne vidait
 * ni le repli manuel de l'utilisateur ni le repli par défaut déjà semé — un
 * « recommencer », ou un aller-retour Leçon → Examen → Leçon, retrouvait un
 * support de rôle "test" qui ne se repliait plus par défaut si l'utilisateur
 * l'avait déplié pendant la session précédente. `reset()` corrige ça ; le cas
 * de vérification correspondant instancie CET état directement, sans DOM.
 */
export function createPassageCollapseState() {
	const collapsed = new Set<string>();
	return {
		isCollapsed: (key: string): boolean => collapsed.has(key),
		/** Bascule manuel (clic) — renvoie le nouvel état pour l'aria/le libellé. */
		toggle(key: string): boolean {
			const nowCollapsed = !collapsed.has(key);
			if (nowCollapsed) collapsed.add(key); else collapsed.delete(key);
			return nowCollapsed;
		},
		/** À appeler depuis `resetQuiz` : nouvelle session, tout redéplié. */
		reset(): void {
			collapsed.clear();
		}
	};
}

export function createPassageHandlers(ctx: EngineCtx): PassageHandlers {
	const collapseState = createPassageCollapseState();

	/** Décision de visibilité pour `qi`, exposée sur `ctx` — voir `passageVisibility`. */
	function passageVisibilityFor(qi: number): PassageVisibility {
		return passageVisibility({ role: ctx.roleOfQuestion(qi), isLesson: ctx.isLessonMode() });
	}

	/** Champ support d'une question, forme texte ou HTML pré-rendu. */
	const rawText = (qi: number): string => String(ctx.quiz[qi]?.passage ?? "").trim();
	const rawHtml = (qi: number): string => {
		const q = ctx.quiz[qi];
		return String(q?.passageHtml || q?._passageHtml || "").trim();
	};
	const hasContent = (qi: number): boolean => rawText(qi).length > 0 || rawHtml(qi).length > 0;

	function resolvePassage(qi: number): ResolvedPassage | null {
		const q = ctx.quiz[qi];
		if (!q) return null;

		const sharedId = String(q.passageId ?? "").trim();

		// Sans identifiant de partage, le support doit être porté par la question
		// elle-même — sinon il n'y a rien à afficher.
		if (!sharedId) {
			if (!hasContent(qi)) return null;
			return {
				key: `q${qi}`,
				title: String(q.passageTitle ?? "").trim() || t("engine.passage.defaultTitle"),
				text: rawText(qi),
				html: rawHtml(qi),
				sharedWith: [qi]
			};
		}

		// Avec identifiant : le contenu vient de la PREMIÈRE question du quiz qui
		// porte cet identifiant ET du contenu (les suivantes n'écrivent que l'id).
		const sharedWith: number[] = [];
		let source = -1;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (String(ctx.quiz[i]?.passageId ?? "").trim() !== sharedId) continue;
			sharedWith.push(i);
			if (source === -1 && hasContent(i)) source = i;
		}
		if (source === -1) return null;

		const src = ctx.quiz[source];
		return {
			key: sharedId,
			// Le titre peut être posé sur n'importe quelle question du groupe :
			// celui de la question courante prime, sinon celui de la source.
			title: String(q.passageTitle ?? "").trim() || String(src?.passageTitle ?? "").trim() || t("engine.passage.defaultTitle"),
			text: rawText(source),
			html: rawHtml(source),
			sharedWith
		};
	}

	/** Numéro affiché d'une question : celui des onglets Q1…Qn, qui saute les
	    lectures absorbées (repli sur l'index + 1 hors moteur complet). */
	const numero = (qi: number): number => ctx.numeroAffiche?.(qi) ?? qi + 1;

	/** « Q2 · questions 2 à 4 » — dit au lecteur combien de questions portent sur ce document. */
	function scopeLabel(p: ResolvedPassage): string {
		if (p.sharedWith.length < 2) return "";
		const first = numero(p.sharedWith[0]);
		const last = numero(p.sharedWith[p.sharedWith.length - 1]);
		// Groupe contigu ⇒ « questions 2 à 4 » ; groupe éclaté ⇒ le compte seul.
		const contiguous = p.sharedWith.every((qi, k) => numero(qi) === first + k);
		return contiguous
			? t("engine.passage.scopeRange", { first, last })
			: t("engine.passage.scopeCount", { count: p.sharedWith.length });
	}

	function passageHtml(qi: number): string {
		/* Le support d'abord : sans support, pas de décision de visibilité à
		   payer (elle relit le modèle de leçon, engine/lesson.ts), et cette
		   fonction est invoquée une fois PAR QUESTION à chaque rendu complet. */
		const p = resolvePassage(qi);
		if (!p) return "";
		const visibility = passageVisibilityFor(qi);

		const contentHtml = p.html
			? ctx.sanitize.replaceObsidianEmbedsInHtml(p.html, EMBED_PASSAGE)
			: ctx.sanitize.renderTextWithEmbeds(p.text, EMBED_PASSAGE);

		// "open" force le dépli — y compris si un support PARTAGÉ (`passageId`)
		// a été replié par une autre question du même groupe.
		const isCollapsed = visibility === "open" ? false : collapseState.isCollapsed(p.key);
		const scope = scopeLabel(p);
		const toggleLabel = t(isCollapsed ? "engine.passage.expand" : "engine.passage.collapse");

		return `<div class="quiz-passage${isCollapsed ? " is-collapsed" : ""}" data-passage-key="${ctx.escapeHtmlAttr(p.key)}">
			<div class="quiz-passage-head">
				<span class="quiz-passage-icon" aria-hidden="true">${ICON_BOOK}</span>
				<span class="quiz-passage-title">${ctx.sanitize.renderInlineText(p.title)}</span>
				${scope ? `<span class="quiz-passage-scope">${ctx.sanitize.renderInlineText(scope)}</span>` : ""}
				<button class="quiz-passage-toggle" type="button" data-passage-toggle="1" aria-expanded="${isCollapsed ? "false" : "true"}" aria-label="${ctx.escapeHtmlAttr(toggleLabel)}">${ICON_CHEVRON}</button>
			</div>
			<div class="quiz-passage-body"><div class="quiz-passage-content">${contentHtml}</div></div>
		</div>`;
	}

	function bindPassage(trackItem: HTMLElement, qi: number): void {
		/* Les cartes « À retenir » d'une lecture, sur son écran ou en lecture
		   courte au-dessus de sa question hôte (engine/cards.ts) : AVANT la
		   sortie sans support. */
		brancherCartes(trackItem);
		const root = trackItem.querySelector<HTMLElement>(".quiz-passage");
		if (!root) return;

		// LaTeX du support : la carte question est mathifiée par le moteur, mais
		// une slide reconstruite hors de ce chemin (refresh partiel) doit l'être ici.
		mathifyElement(root);

		const toggle = root.querySelector<HTMLButtonElement>("[data-passage-toggle]");
		if (!toggle) return;

		toggle.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const key = root.dataset.passageKey || "";
			const nowCollapsed = collapseState.toggle(key);
			const label = t(nowCollapsed ? "engine.passage.expand" : "engine.passage.collapse");

			/* Toutes les slides existent DÉJÀ dans le DOM (piste préconstruite) :
			   mémoriser l'état dans `collapseState` ne suffit pas, il n'est relu qu'à
			   la construction du HTML. Le repli doit donc être appliqué ICI à
			   chaque copie du MÊME document — sinon replier sur Q1 laisse le texte
			   déplié en arrivant sur Q2, et le partage n'en est plus un. */
			const twins = ctx.container.querySelectorAll<HTMLElement>(
				`.quiz-passage[data-passage-key="${CSS.escape(key)}"]`
			);
			twins.forEach(el => {
				el.classList.toggle("is-collapsed", nowCollapsed);
				const btn = el.querySelector<HTMLButtonElement>("[data-passage-toggle]");
				if (!btn) return;
				btn.setAttribute("aria-expanded", nowCollapsed ? "false" : "true");
				btn.setAttribute("aria-label", label);
			});

			/* Chaque carte touchée change de hauteur : leurs entrées de cache sont
			   périmées. Pas d'animation de repli — un collapse animé laisse des
			   pixels fantômes du compositeur sur la piste translatée. */
			resynchroniser();
		});

		function resynchroniser(): void {
			const p = resolvePassage(qi);
			for (const twinQi of (p ? p.sharedWith : [qi])) {
				const slideIdx = ctx.getSlideIndexForQuestion(twinQi);
				if (slideIdx < 0) continue;
				ctx.viewport.__quizSlideHeightCache?.delete(slideIdx);
				if (slideIdx === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
				}
			}
		}
	}

	function resetPassageState(): void {
		collapseState.reset();
	}

	return { resolvePassage, passageVisibilityFor, passageHtml, bindPassage, resetPassageState };
}
