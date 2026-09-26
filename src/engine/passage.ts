import type { EngineCtx } from "../types/engine-ctx";
import type { QuestionRole } from "../types/quiz";
import { mathifyElement } from "./mathjax";
import { t } from "../i18n";
import { coursDeLEtape } from "../lecture-etape";
import { corpsLectureHtml, brancherCartes } from "./lecture-rendu";
import type { CorpsLecture } from "./lecture-rendu";
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

   LE COURS D'UNE ÉTAPE DE LEARN (décision du 2026-09-26) : la carte de
   lecture (`role: "read"`) n'est plus un écran. Son texte s'affiche ici,
   REPLIÉ, au-dessus de CHAQUE question de son étape, quel que soit le rôle,
   avec l'invite « Tentez de répondre sans lire » ; un clic le déplie, et il
   se déplie de lui-même une fois la question répondue, pour comparer. La
   règle de fusion vit dans `src/lecture-etape.ts`.
══════════════════════════════════════════════════════════ */

/**
 * Cinq régimes d'affichage du support :
 * - "open" : rendu et déplié, sans repli par défaut.
 * - "collapsible" : rendu, déplié, repliable à la demande.
 * - "folded" : rendu REPLIÉ par défaut, avec l'invite « Tentez de répondre
 *   sans lire » ; un clic le déplie, une réponse aussi.
 * - "reminder" : rendu REPLIÉ par défaut, SANS invite, et une réponse ne
 *   le déplie pas : un rappel à un clic d'un cours déjà lu à l'écran.
 * - "hidden" : pas rendu du tout.
 */
export type PassageVisibility = "open" | "collapsible" | "folded" | "reminder" | "hidden";

/** D'où vient le cours affiché au-dessus d'une question de Learn :
    - "absorbe" : une lecture `etapes` ou `tableau`, qui n'a pas d'écran ;
    - "page" : une lecture `page` (ou sans style), restée un ÉCRAN à part ;
    - absent : un support `passage` porté par la question elle-même. */
export type OrigineCours = "absorbe" | "page";

/**
 * Décision PURE, vérifiable sans DOM (`scripts/check-passage.mjs`) : le
 * rendu ne fait QUE la consulter, jamais recalculer la règle lui-même.
 *
 * Hors Learn, le support garde le comportement d'avant : repliable, ouvert
 * par défaut, quel que soit le rôle.
 *
 * En Learn — DÉCISION D'AHMED DU 2026-09-26 (soir), qui remplace celle du
 * matin (« replié partout, avec l'invite ») :
 * - une carte "read" affichée comme écran : le cours est son contenu, ouvert ;
 * - un cours `page` (un écran à part, placé après les pré-questions) :
 *   INVISIBLE au-dessus d'une pré-question (`pre`) — on tente sans avoir
 *   lu, et la page vient ensuite ; au-dessus des questions suivantes, un
 *   RAPPEL replié, sans invite, déplié à la demande seulement ;
 * - un cours `etapes`/`tableau` (absorbé, sans écran) ou un support propre :
 *   au-dessus d'une pré-question, REPLIÉ avec l'invite tant qu'elle n'est
 *   pas RÉPONDUE, puis ouvert pour comparer ; au-dessus de toute autre
 *   question, DÉPLIÉ d'office, et repliable d'un clic.
 * « Je ne sais pas » n'est pas une réponse (voir `repondue` plus bas).
 */
export function passageVisibility({ role, answered, isLesson, cours }: { role: QuestionRole; answered: boolean; isLesson: boolean; cours?: OrigineCours }): PassageVisibility {
	if (!isLesson) return "collapsible";
	if (role === "read") return "open";
	if (cours === "page") return role === "pre" ? "hidden" : "reminder";
	if (role === "pre") return answered ? "open" : "folded";
	return "collapsible";
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
	/** L'élément `read` d'où vient ce cours (Learn), pour son STYLE de
	    lecture (engine/lecture-rendu.ts) ; absent pour un support
	    `passage` ordinaire, qui n'en a pas. */
	lecture?: unknown;
	/** L'origine du cours d'étape (voir `OrigineCours`) ; absent pour un support propre. */
	cours?: OrigineCours;
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

/**
 * Le corps STYLÉ d'une lecture, par les portes du sanitizer du moteur : le
 * même appel pour le cours au-dessus d'une question et pour une lecture
 * autonome (engine/cards.ts), qui ne peuvent pas avoir chacun le leur.
 */
export function corpsLecture(ctx: EngineCtx, item: unknown, brut: string, texteHtml: string, titre?: string): CorpsLecture {
	return corpsLectureHtml(item, brut, texteHtml, titre, {
		bloc: s => ctx.sanitize.renderTextWithEmbeds(s, EMBED_PASSAGE),
		inline: s => ctx.sanitize.renderInlineText(s),
		attribut: s => ctx.escapeHtmlAttr(stripInlineMarkdown(s)),
	});
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
	/* Une clé n'y entre qu'UNE fois PAR SESSION : le repli par défaut du
	   régime "folded" (Learn) ne doit s'appliquer qu'à la toute première
	   apparition de la clé, sinon chaque re-rendu écraserait un dépli manuel
	   de l'utilisateur en le repliant à nouveau. */
	const seeded = new Set<string>();
	return {
		isCollapsed: (key: string): boolean => collapsed.has(key),
		/** Sème le repli par défaut une seule fois par clé ; sans effet ensuite. */
		seedCollapsedOnce(key: string): void {
			if (seeded.has(key)) return;
			seeded.add(key);
			collapsed.add(key);
		},
		/** Bascule manuel (clic) — renvoie le nouvel état pour l'aria/le libellé. */
		toggle(key: string): boolean {
			const nowCollapsed = !collapsed.has(key);
			if (nowCollapsed) collapsed.add(key); else collapsed.delete(key);
			return nowCollapsed;
		},
		/** À appeler depuis `resetQuiz` : nouvelle session, nouveau repli par défaut. */
		reset(): void {
			collapsed.clear();
			seeded.clear();
		}
	};
}

export function createPassageHandlers(ctx: EngineCtx): PassageHandlers {
	const collapseState = createPassageCollapseState();

	/** La question `qi` est-elle RÉPONDUE, au sens où le cours peut se
	    déplier pour comparer ? Choix fait (ou tous les trous remplis),
	    réponse libre vérifiée, ou quiz verrouillé.

	    PAS `lessonPreSkipped` (correctif du 2026-09-26) : ce drapeau n'est pas
	    une réponse. Il est posé par « Je ne sais pas », mais AUSSI, sans un
	    clic, sur toute pré-question qu'on franchit vers l'avant — bouton
	    suivant, onglet Qn, reprise (engine/state.ts `marquerPreNonTentees`).
	    Le compter dépliait le cours d'une question jamais répondue, jamais
	    même vue : sauter de Q1 à Q5 ouvrait le cours de la pré-question Q4,
	    qui s'affichait ensuite, choix vides, cours déplié. Ses options restent
	    d'ailleurs cliquables : pour l'apprenant, elle n'est pas répondue.
	    C'est aussi ce que dit son type (types/quiz.ts) : une carte ainsi
	    marquée reste « sans réponse » partout ailleurs. */
	function repondue(qi: number): boolean {
		if (ctx.quizState?.locked) return true;
		if (ctx.textOnly?.isChecked?.(qi)) return true;
		return !!ctx.isComplete?.(qi);
	}

	/** Décision de visibilité pour `qi`, exposée sur `ctx` — voir `passageVisibility`. */
	function passageVisibilityFor(qi: number, p: ResolvedPassage | null = resolvePassage(qi)): PassageVisibility {
		return passageVisibility({
			role: ctx.roleOfQuestion(qi),
			answered: repondue(qi),
			isLesson: ctx.isLessonMode(),
			cours: p?.cours
		});
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
			if (!hasContent(qi)) return lectureDeLEtape(qi);
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

	/** Le cours d'une question de Learn, quel que soit son rôle : la carte de
	    LECTURE de son étape (son titre et son texte), faute de support
	    propre — absorbée (`etapes`, `tableau`) ou restée un écran (`page`),
	    `cours` le dit (règle : `src/lecture-etape.ts`). La clé est PROPRE À
	    LA QUESTION : déplier le cours sur une question ne le déplie pas sur
	    la suivante. `null` hors Learn, pour une lecture, ou sans lecture dans
	    l'étape. */
	function lectureDeLEtape(qi: number): ResolvedPassage | null {
		if (!ctx.isLessonMode()) return null;
		const c = coursDeLEtape(ctx.quiz, true, qi);
		// Une lecture absorbée hors de l'ensemble FIGÉ du moteur (Learn
		// d'origine) n'est pas un cours : elle a son écran.
		if (!c || (c.absorbee && !ctx.lecturesAbsorbees?.has(c.index))) return null;
		const i = c.index;
		const lecture = ctx.quiz[i];
		const texte = String(lecture?.prompt ?? "").trim();
		const html = String(lecture?.promptHtml || lecture?._promptHtml || "").trim();
		if (!texte && !html) return null;
		return {
			key: `lecture-${i}-q${qi}`,
			title: String(lecture?.title ?? "").trim() || t("engine.passage.defaultTitle"),
			text: texte,
			html,
			sharedWith: [qi],
			lecture,
			cours: c.absorbee ? "absorbe" : "page"
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
		const visibility = passageVisibilityFor(qi, p);
		if (visibility === "hidden") return "";

		const texteHtml = p.html
			? ctx.sanitize.replaceObsidianEmbedsInHtml(p.html, EMBED_PASSAGE)
			: ctx.sanitize.renderTextWithEmbeds(p.text, EMBED_PASSAGE);
		/* Le cours d'une étape prend le STYLE de sa lecture (page, étapes,
		   tableau, « À retenir ») ; un support `passage` reste un texte. */
		const style = p.lecture !== undefined ? corpsLecture(ctx, p.lecture, p.text, texteHtml, p.title) : null;
		const contentHtml = style ? style.html : texteHtml;

		// Repli par défaut des régimes "folded" et "reminder", et seulement à
		// la première apparition de la clé (`seedCollapsedOnce` est un no-op
		// ensuite) : un cours déplié à la main le reste d'un re-rendu à l'autre.
		const replie = visibility === "folded" || visibility === "reminder";
		if (replie) collapseState.seedCollapsedOnce(p.key);
		// "open" force le dépli — y compris si un support PARTAGÉ (`passageId`)
		// a été replié par une autre question du même groupe — pour garantir la
		// comparaison entre la réponse et le cours.
		const isCollapsed = visibility === "open" ? false : collapseState.isCollapsed(p.key);
		const scope = scopeLabel(p);
		const toggleLabel = t(isCollapsed ? "engine.passage.expand" : "engine.passage.collapse");
		/* L'invite « Tentez de répondre sans lire » n'est plus que sur une
		   PRÉ-QUESTION (régime "folded", décision du 2026-09-26) : c'est la
		   seule où l'on tente vraiment sans avoir lu. Replié, un cours n'est
		   que sa barre (livre, titre, invite éventuelle, chevron). Déplié, un
		   cours d'étape (`data-lecture`) devient une PAGE qui porte son propre
		   titre (engine/lecture-rendu.ts, maquette B) : sa barre se réduit au
		   chevron, en haut à droite (lecture.css), pour ne pas écrire le titre
		   deux fois. */
		const invite = visibility === "folded"
			? `<span class="quiz-passage-invite">${ctx.escapeHtmlText(t("engine.passage.tryWithoutReading"))}</span>`
			: "";

		return `<div class="quiz-passage${isCollapsed ? " is-collapsed" : ""}" data-passage-key="${ctx.escapeHtmlAttr(p.key)}"${replie ? ' data-passage-fold="1"' : ""}${style ? ` data-lecture="${style.style}"` : ""}>
			<div class="quiz-passage-head">
				<span class="quiz-passage-icon" aria-hidden="true">${ICON_BOOK}</span>
				<span class="quiz-passage-title">${ctx.sanitize.renderInlineText(p.title)}</span>
				${invite}
				${scope ? `<span class="quiz-passage-scope">${ctx.sanitize.renderInlineText(scope)}</span>` : ""}
				<button class="quiz-passage-toggle" type="button" data-passage-toggle="1" aria-expanded="${isCollapsed ? "false" : "true"}" aria-label="${ctx.escapeHtmlAttr(toggleLabel)}" title="${ctx.escapeHtmlAttr(toggleLabel)}">${ICON_CHEVRON}</button>
			</div>
			<div class="quiz-passage-body"><div class="quiz-passage-clip"><div class="quiz-passage-content">${contentHtml}</div></div></div>
		</div>`;
	}

	function bindPassage(trackItem: HTMLElement, qi: number): void {
		/* Les cartes « À retenir », au-dessus d'une question comme dans une
		   lecture autonome (engine/cards.ts) : AVANT la sortie sans support. */
		brancherCartes(trackItem);
		const root = trackItem.querySelector<HTMLElement>(".quiz-passage");
		if (!root) return;

		// LaTeX du support : la carte question est mathifiée par le moteur, mais
		// une slide reconstruite hors de ce chemin (refresh partiel) doit l'être ici.
		mathifyElement(root);

		const toggle = root.querySelector<HTMLButtonElement>("[data-passage-toggle]");
		if (!toggle) return;

		/* Un cours REPLIÉ d'office (Learn) s'ouvre aussi d'un clic sur son
		   en-tête, invite comprise : c'est là que l'œil et la main arrivent. */
		if (root.dataset.passageFold === "1") {
			const head = root.querySelector<HTMLElement>(".quiz-passage-head");
			head?.addEventListener("click", e => {
				if (e.target instanceof Element && e.target.closest("[data-passage-toggle]")) return;
				toggle.click();
			});
		}

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
				btn.setAttribute("title", label);
			});

			/* Chaque carte touchée change de hauteur : leurs entrées de cache sont
			   périmées. Un support ordinaire se replie sans animation — un
			   collapse animé laisse des pixels fantômes du compositeur sur la
			   piste translatée. Le COURS d'une étape (`data-lecture`), lui,
			   glisse (passage.css, rangée de grille 0fr → 1fr) : sa hauteur est
			   resynchronisée à la fin du mouvement, plus bas. */
			resynchroniser();
		});

		if (root.dataset.lecture) {
			root.querySelector(".quiz-passage-body")?.addEventListener("transitionend", e => {
				if ((e as TransitionEvent).propertyName === "grid-template-rows") resynchroniser();
			});
		}

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
