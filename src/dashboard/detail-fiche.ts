import { currentHost } from "../host/current";
import { placerIndicateur, DUREE_GLISSEMENT } from "./seg-indic";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import { usesMathField } from "../engine/math-input";
import { isShellVariant } from "../engine/terminal";
import type { DraftQuestion } from "../editor/utils";
import type { ModeQuiz } from "../quiz-format";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { texteQuizHtml } from "../editor/question-preview";
import { codeClozeHtml, fillSlots, markSlots, protectCodeSlots, restoreCodeSlots } from "../engine/cloze";
import { renderInlineText, stripInlineMarkdown } from "../engine/sanitizer";
import { reinitialiserBudgetRendu } from "../engine/code-highlight";
import { quizModeIcon, quizModeLabel, quizModeTip, renderQuizTypeIcon } from "./quiz-card";
import { setBrandLogo } from "./ai-providers";
import { attachHoverTip } from "./hover-tip";
import { lectureCourteDe, numerosAffiches, questionsVisibles } from "../lecture-etape";

/* ══════════════════════════════════════════════════════════
   FICHE D'UN QUIZ — ce que la page montre à l'ouverture

   ORGANISATION DE STUDYSMARTER (2026-09-26), qui remplace la fiche fixe à
   gauche et la frise verticale du 2026-09-23 (« c'est beau mais c'est mal
   organisé ») : un EN-TÊTE sur toute la largeur (retour, dossier et titre à
   gauche ; Éditeur, Commencer le quiz et ⋮ à droite), une ligne d'infos
   (mode, nombre de questions, origine, puis les actions), une recherche,
   puis les questions sur toute la largeur.

   UNE SEULE VUE : LA GRILLE. Les deux vues de StudySmarter ont été essayées
   dans l'app ; la liste avec la question en grand à droite obligeait à
   cliquer pour lire chaque question, la grille les montre toutes d'un coup
   (choix du 2026-09-26). Le sélecteur de vue est parti avec la liste.

   AUCUNE RÉPONSE ici : on relit le quiz pour savoir ce qui attend, pas pour
   en apprendre la solution. Seules les options d'un QCM sont montrées, sans
   la bonne ; les autres types n'affichent que leur énoncé. Répondre ne se
   fait qu'en jouant le quiz. Cliquer une question ouvre l'éditeur
   dessus (2026-09-26 ; avant, le clic faisait briller « Commencer »).

   L'en-tête de la page est masqué sur cet écran (classe `qbd-qz--fiche`) :
   la flèche retour et l'éditeur vivent dans celui de la fiche.
══════════════════════════════════════════════════════════ */

/** D'où vient le quiz, déjà mis en forme par la page (même rendu que sa
    ligne d'infos). */
export interface FicheOrigine {
	/** Nom lisible de la source : le modèle d'un CLI, le nom d'un site. */
	source: string;
	/** Date et heure de la génération, dans la langue de l'application. */
	date: string;
	/** Logo de l'entrée du fournisseur (`setBrandLogo`). */
	logo: string;
	/** Infobulle : l'identifiant exact du modèle, et l'effort du CLI quand il est connu. */
	tooltip: string;
}

export interface FicheDeps {
	quiz: QuizIndexEntry;
	questions: DraftQuestion[];
	/** Le brouillon est un Learn (mode lu comme le moteur) : seules ses
	    lectures d'étape sont absorbées (src/lecture-etape.ts). */
	lecon: boolean;
	stat: QuizStatRecord;
	/** Absente pour une note écrite à la main ou un quiz partagé. */
	origine: FicheOrigine | null;
	/** Opens the editor on THIS question (click on its card). Absent: the
	    click makes "Start the quiz" shine, as before. */
	onEditQuestion?(index: number): void;
	/** Makes "Start the quiz", in the page's header, shine. */
	attirer(): void;
}

/** The OTHER modes of the same course (course-pairs.ts): the mode pill
    becomes a selector Learn | Practice | Exam, whose other segments open
    their quiz. */
export type AutresModes = Array<{ mode: ModeQuiz; open(): void }>;

/* L'état de la barre, gardé entre deux repeints du MÊME quiz (la page se
   repeint sur des événements extérieurs) ; remis à zéro sur un autre quiz. */
const etat = { chemin: "", recherche: "", fondu: false };

function icone(parent: HTMLElement, name: string, cls = "qbd-fiche-i"): HTMLElement {
	const el = ajouter(parent, "span", cls);
	currentHost().ui.setIcon(el, name);
	return el;
}

/** Texte d'une question, avec son LaTeX rendu. */
function texte(parent: HTMLElement, tag: "p" | "span", cls: string, value: string): HTMLElement {
	const el = ajouter(parent, tag, cls, value);
	if (value.includes("$")) void mathifyElement(el);
	return el;
}

function reduit(): boolean {
	return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Oublie la recherche : appelée par la page à
    chaque ARRIVÉE (navigation), jamais à un repeint interne. Le fondu d'un
    changement de mode, lui, doit survivre à l'arrivée sur l'autre quiz. */
export function oublierFiche(): void {
	etat.chemin = "";
	etat.recherche = "";
}

/** Paints the fiche's questions into `parent`, and returns what repaints
    them after a new search. The header (back arrow, title, info line,
    search, actions) is the page's (detail-head.ts), shared with the editor
    so that it does not move when the page switches. */
export function renderFiche(parent: HTMLElement, deps: FicheDeps): () => void {
	const root = ajouter(parent, "div", "qbd-fiche");
	return renderBody(root, deps.attirer, deps);
}

/** The search of a quiz's page, in the header's centre slot: the same field
    for the fiche's grid and the editor's list, kept between two repaints of
    the same quiz. `onChange` repaints what it filters. */
export function renderRecherche(place: HTMLElement, chemin: string, onChange: () => void): void {
	if (etat.chemin !== chemin) {
		etat.chemin = chemin;
		etat.recherche = "";
	}
	const recherche = ajouter(place, "label", "qbd-fiche-search");
	icone(recherche, "search", "qbd-fiche-search-icon");
	const champ = ajouter(recherche, "input", "qbd-fiche-search-input");
	champ.type = "search";
	champ.placeholder = t("dashboard.fiche.search");
	champ.setAttribute("aria-label", t("dashboard.fiche.search"));
	champ.value = etat.recherche;
	champ.addEventListener("input", () => { etat.recherche = champ.value; onChange(); });
}

/** The indexes of the visible questions that match the current search, in
    their order (all of them with an empty search). */
export function questionsTrouvees(questions: DraftQuestion[], lecon: boolean): number[] {
	return filtrer(questions, lecon, etat.recherche);
}

/** The info line of the page's header, the same in the fiche and the
    editor: the mode (or the selector Learn | Practice of the course's other
    modes), the number of questions, the origin. */
export function renderInfosQuiz(parent: HTMLElement, quiz: QuizIndexEntry, origine: FicheOrigine | null, autresModes?: AutresModes): HTMLElement {
	return renderMeta(parent, { quiz, origine, autresModes });
}

function renderMeta(root: HTMLElement, deps: { quiz: QuizIndexEntry; origine: FicheOrigine | null; autresModes?: AutresModes }): HTMLElement {
	const meta = ajouter(root, "div", "qbd-fiche-meta");
	/* Les pastilles, puis l'ORIGINE (modèle et date) sur la ligne du dessous,
	   à la place qu'occupait la recherche, partie au centre (2026-09-26) ;
	   les actions au bout. */
	const infos = ajouter(meta, "div", "qbd-fiche-meta-infos");
	const chips = ajouter(infos, "div", "qbd-fiche-chips");
	/* The MODE, with its icon, and its explanation on hover: the bubble of
	   the Generate page's Learn | Test selector, same texts. */
	const pastilleMode = (parent: HTMLElement, m: ModeQuiz, cls: string, tag: "span" | "button"): HTMLElement => {
		const el = ajouter(parent, tag, cls);
		icone(el, quizModeIcon(m), "qbd-fiche-mode-icon");
		ajouter(el, "span", undefined, quizModeLabel(m));
		attachHoverTip(el, (tip) => {
			tip.classList.add("qbd-hover-tip--card");
			ajouter(tip, "div", "qbd-hover-tip-title", quizModeLabel(m));
			ajouter(tip, "div", "qbd-hover-tip-body", quizModeTip(m));
		});
		return el;
	};
	const autres = (deps.autresModes ?? []).filter(a => a.mode !== deps.quiz.mode);
	if (autres.length > 0) {
		const choix = ajouter(chips, "div", "qbd-fiche-modes");
		choix.setAttribute("role", "group");
		/* Le bloc qui glisse, comme dans la page « Générer » (2026-09-25) : au
		   clic, il glisse vers l'autre mode pendant que les questions
		   s'effacent, PUIS sa fiche s'ouvre et les siennes apparaissent. */
		const indic = ajouter(choix, "div", "qbd-fiche-mode-indic");
		// The course's modes, in their order (Learn, Practice, Exam).
		const ordre: readonly ModeQuiz[] = ["learn", "practice", "exam"];
		const presents = ordre.filter(m => m === deps.quiz.mode || autres.some(a => a.mode === m));
		const segs = presents.map(m => {
			const actif = m === deps.quiz.mode;
			const seg = pastilleMode(choix, m, "qbd-fiche-mode-seg" + (actif ? " is-active" : ""), "button");
			(seg as HTMLButtonElement).type = "button";
			seg.setAttribute("aria-pressed", actif ? "true" : "false");
			return { actif, seg, open: autres.find(a => a.mode === m)?.open };
		});
		const courant = segs.find(s => s.actif)!.seg;
		requestAnimationFrame(() => placerIndicateur(indic, courant, false));
		/* ONE flag for every segment: with three modes, clicking a second one
		   during the slide would open two quizzes. */
		let parti = false;
		for (const { actif, seg, open } of segs) {
			if (actif || !open) continue;
			seg.addEventListener("click", () => {
				if (parti) return;
				parti = true;
				courant.classList.remove("is-active");
				seg.classList.add("is-active");
				placerIndicateur(indic, seg, true);
				const sansAnim = reduit();
				if (!sansAnim) {
					etat.fondu = true;
					// The questions are in the page's body, not in this header row.
					(root.closest(".qbd-qz") ?? document).querySelectorAll<HTMLElement>(".qbd-fiche-q").forEach(c => c.animate(
						[{ opacity: 1 }, { opacity: 0 }],
						{ duration: DUREE_GLISSEMENT, easing: "ease-out", fill: "forwards" },
					));
				}
				window.setTimeout(() => open(), sansAnim ? 0 : DUREE_GLISSEMENT);
			});
		}
	} else {
		pastilleMode(chips, deps.quiz.mode, "qbd-fiche-chip qbd-fiche-mode", "span");
	}
	const count = ajouter(chips, "span", "qbd-fiche-chip qbd-fiche-count");
	renderQuizTypeIcon(count, deps.quiz.quizType);
	ajouter(count, "span", undefined, t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));

	/* Le nombre de LECTURES, à côté : jamais montré à 0 ni hors Learn
	   (deps.quiz.readings vaut alors 0, src/lecture-etape.ts). Une pastille de
	   PLUS, sans icône (comme la date de l'origine juste dessous) : le « · »
	   qui les sépare est le MÊME que celui de l'origine, posé par la même
	   règle CSS (`.qbd-fiche-meta .qbd-fiche-chip + .qbd-fiche-chip::before`) —
	   rien à écrire ici, il suffit d'ajouter une pastille de plus. */
	if (deps.quiz.readings > 0) {
		const lectures = ajouter(chips, "span", "qbd-fiche-chip qbd-fiche-readings");
		ajouter(lectures, "span", undefined, t(deps.quiz.readings === 1 ? "dashboard.common.readingsOne" : "dashboard.common.readingsOther", { count: deps.quiz.readings }));
	}

	/* D'où vient le quiz : le logo, le modèle, puis la date, sur une ligne ;
	   l'infobulle donne l'identifiant exact. */
	if (deps.origine) {
		const o = deps.origine;
		const bloc = ajouter(infos, "div", "qbd-fiche-origin");
		bloc.title = o.tooltip;
		const logo = ajouter(bloc, "span", "qbd-provider-logo qbd-fiche-origin-logo qbd-provider-logo--" + o.logo);
		setBrandLogo(logo, o.logo);
		ajouter(bloc, "span", "qbd-fiche-origin-model", o.source);
		ajouter(bloc, "span", "qbd-fiche-origin-date", o.date);
	}

	/* PLUS DE PROGRESSION ICI (2026-09-26) : la barre et le meilleur score
	   vivent dans l'onglet Progression du dossier, où l'on peut aussi gérer
	   ses scores ; leur place laisse descendre les actions sur cette ligne. */
	return meta;
}

/* Au-delà, une option ne tient plus dans une bulle à côté des autres : la
   liste passe en colonne. Compté sur le texte BRUT, LaTeX compris. */
const OPTION_COURTE = 32;

/** L'en-tête d'une carte : son numéro, puis UNE SEULE étiquette en texte simple
    (icône + libellé), jamais de pastille de rôle en plus du type (2026-09-26 —
    « une seule étiquette par carte »). `pre`/`recall`/`test` n'ont plus de
    libellé propre ici : leur type suffit, le rôle reste modifiable dans la
    barre « Rôle » de l'éditeur (detail-edition.ts). Partagé avec les cartes
    de la liste de l'éditeur (detail.ts), qui y ajoutent leurs commandes :
    rendu, pour qu'elles s'y greffent. */
/** The circle a question wears in the list, the grid and the editor: the
    displayed number on blue, or the book on purple for a reading. Nothing
    for a numberless non-reading (`numero` 0). Shared, never redrawn, so the
    editor cannot drift from the list. */
export function renderNumero(parent: HTMLElement, q: DraftQuestion, numero: number): HTMLElement | null {
	if (q.role === "read") {
		/* A reading has no question number (src/lecture-etape.ts): its circle
		   carries the book, in the readings' purple (the reading bead, the
		   resource button), in place of a number and of the small icon before
		   its label (2026-09-29). */
		const rond = ajouter(parent, "span", "qbd-fiche-num qbd-fiche-num--read");
		icone(rond, "book-open", "qbd-fiche-num-icon");
		return rond;
	}
	// 0: a card without a question number — its type's icon says what it is.
	return numero > 0 ? ajouter(parent, "span", "qbd-fiche-num", String(numero)) : null;
}

export function renderTop(card: HTMLElement, q: DraftQuestion, numero: number): HTMLElement {
	const top = ajouter(card, "span", "qbd-fiche-q-top");
	renderNumero(top, q, numero);
	if (q.role === "read") {
		// Its type would teach nothing: a reading expects no answer.
		ajouter(top, "span", "qbd-fiche-q-type", t("engine.lesson.roleRead"));
		return top;
	}
	if (q.role === "explain") {
		// Une explication est toujours libre : son type n'apprendrait rien non plus.
		icone(top, "pen-line", "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", t("engine.lesson.roleExplain"));
	} else if (q._type === "text" && usesMathField(q)) {
		/* The editor files an equation under "text" and a program's output
		   under "bash" (it has no type of their own), and the card said
		   "Free text" / "Bash terminal" (2026-09-27). The LABEL tells what the
		   learner will see; the editor's types are unchanged. */
		icone(top, "sigma", "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", t("dashboard.fiche.type.equation"));
	} else if (q._type === "bash" && q._terminalVariant && !isShellVariant(q._terminalVariant)) {
		icone(top, "square-code", "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", t("dashboard.fiche.type.programOutput"));
	} else {
		const def = Q_TYPES.find(d => d.key === q._type);
		if (def) icone(top, def.lucide, "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", def?.label ?? q._type);
	}
	return top;
}

/** A fill-in-the-blanks' text, its code in its ```lang block, each blank an
    EMPTY slot: like the options without the right one, the card never gives
    the answer (2026-09-29 — the card showed only the instruction, "Complete
    this C program", and never the program). */
function renderTrous(card: HTMLElement, q: DraftQuestion): void {
	const gabarit = typeof q.cloze === "string" ? q.cloze : "";
	if (!gabarit.trim()) return;
	const { marked } = markSlots(gabarit);
	const el = ajouter(card, "div", "qbd-fiche-trous");
	el.innerHTML = fillSlots(
		codeClozeHtml(marked) ?? restoreCodeSlots(texteQuizHtml(protectCodeSlots(marked))),
		() => `<span class="qbd-fiche-trou" aria-hidden="true"></span>`,
	);
	if (gabarit.includes("$")) void mathifyElement(el);
}

/** Les options d'un QCM, SANS la bonne, marquées A, B, C… : rien ne se
    coche ici. Toutes courtes : des bulles côte à côte ; sinon une colonne. */
function renderOptions(card: HTMLElement, q: DraftQuestion): void {
	if ((q._type !== "single" && q._type !== "multi") || q.role === "read" || !q.options?.length) return;
	/* Options that are IMAGES (`![[capture.png]]`) were written out as raw
	   text on the card (2026-09-27): they go through the same rendering as
	   the prompt (`texteQuizHtml`, images resolved) and show as thumbnails. */
	const images = q.options.every(o => /^\s*!\[\[[^\]]+\]\]\s*$/.test(o));
	const courtes = images || q.options.every(o => o.length <= OPTION_COURTE);
	const opts = ajouter(card, "span", images ? "qbd-fiche-opts is-pills is-images" : courtes ? "qbd-fiche-opts is-pills" : "qbd-fiche-opts");
	q.options.forEach((o, j) => {
		const line = ajouter(opts, "span", "qbd-fiche-opt");
		ajouter(line, "span", "qbd-fiche-opt-letter", String.fromCharCode(65 + j));
		/* Une option est du texte de quiz : même porte que dans le quiz
		   (`renderInlineText`), sans quoi `[10, 20, 30]` s'affichait
		   avec ses accents graves (2026-09-26). */
		const txt = ajouter(line, "span", "qbd-fiche-opt-text");
		txt.innerHTML = o.includes("![[") ? texteQuizHtml(o) : renderInlineText(o);
		if (o.includes("$")) void mathifyElement(txt);
	});
}

/** Minuscules sans accents : « équation » se trouve en tapant « equation ». */
function plier(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Les indices des questions VISIBLES qui contiennent la recherche (énoncé,
    options, ou le cours de leur étape). Une lecture absorbée par son étape
    (src/lecture-etape.ts) n'a pas de carte : son texte se trouve dans les
    cartes des questions qu'elle surplombe. */
function filtrer(questions: DraftQuestion[], lecon: boolean, recherche: string): number[] {
	const r = plier(recherche.trim());
	const tous = questionsVisibles(questions, lecon);
	if (!r) return tous;
	return tous.filter(i => {
		const q = questions[i];
		// Une lecture courte n'a pas de carte : son texte se cherche dans
		// celle de sa question hôte. Toute autre lecture a SA carte.
		const l = lectureCourteDe(questions, lecon, i);
		const cours = l === null ? [] : [questions[l].title || "", questionText(questions[l])];
		return plier([questionText(q), ...(q.options ?? []), ...cours].join(" ")).includes(r);
	});
}

/** The questions, in a grid, filtered by the search. */
function renderBody(root: HTMLElement, attirer: () => void, deps: FicheDeps): () => void {
	const body = ajouter(root, "div", "qbd-fiche-body");

	function peindre(): void {
		body.replaceChildren();
		const idx = filtrer(deps.questions, deps.lecon, etat.recherche);
		if (idx.length === 0) {
			ajouter(body, "p", "qbd-fiche-empty", t("dashboard.fiche.searchEmpty"));
			return;
		}
		renderGrille(body, idx, deps, attirer);
		if (etat.fondu) {
			etat.fondu = false;
			body.querySelectorAll<HTMLElement>(".qbd-fiche-q").forEach(c => c.animate(
				[{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 60, easing: "ease-out", fill: "backwards" },
			));
		}
	}
	peindre();
	return peindre;
}

/** GRILLE : une carte par question. Pas un bouton : on répond en jouant le
    quiz ; un clic fait briller « Commencer le quiz ». */
/** Sets `a-suivre` (rest of the text below) and `a-precede` (text above) on
    a scrolling area, at every scroll and every size change (formulas
    rendered, window resized). Exported: a folder's lists scroll with the same
    fades (`folder-sections.ts`).

    NEVER READ THE GEOMETRY RIGHT AFTER APPENDING (phone audit, 2026-10-07).
    The first reading used to run at once, "the grid already being in the
    document": each of the 27 cards of a quiz page forced a layout of the page
    built so far, 27 times in a row, a 400 ms task under a 6x CPU slowdown
    (the profile put it all in this function) right when the page slides in.
    The `ResizeObserver` delivers its first observation after the next
    layout, once for every card, and the frame callback covers a browser
    without it: the first reading comes one frame later, a single layout
    for the whole grid. */
export function suivreDebord(zone: HTMLElement): void {
	const maj = (): void => {
		const bas = zone.scrollTop + zone.clientHeight < zone.scrollHeight - 2;
		zone.classList.toggle("a-suivre", bas);
		zone.classList.toggle("a-precede", zone.scrollTop > 2);
	};
	zone.addEventListener("scroll", maj, { passive: true });
	if (typeof ResizeObserver !== "undefined") {
		const ro = new ResizeObserver(maj);
		ro.observe(zone);
		for (const enfant of Array.from(zone.children)) ro.observe(enfant);
	}
	// One frame later, once the fonts and the formulas are in place.
	requestAnimationFrame(maj);
}

function renderGrille(body: HTMLElement, idx: number[], deps: FicheDeps, attirer: () => void): void {
	// Budget de coloration des blocs de code (code-highlight.ts) remis à zéro
	// UNE fois pour TOUTE la grille (tour 4) : `texteQuizHtml`, appelé une
	// fois par carte plus bas, ne remet plus le budget lui-même — sans quoi
	// une grille de 50 cartes rechargeait 50 budgets pleins (8,2 s mesurés).
	reinitialiserBudgetRendu();
	const grille = ajouter(body, "div", "qbd-fiche-grid");
	// Numéros AFFICHÉS : ils sautent les lectures absorbées, comme le quiz.
	const numeros = numerosAffiches(deps.questions, deps.lecon);
	for (const i of idx) {
		const q = deps.questions[i];
		const n = numeros[i] ?? i + 1;
		const card = ajouter(grille, "div", "qbd-fiche-q qbd-fiche-card");
		// Une lecture de Learn n'a pas de numéro (0) : la carte n'en montre pas.
		renderTop(card, q, numeros[i] ?? n);
		/* Le CONTENU défile dans sa propre zone, sous l'en-tête de la carte :
		   un fondu en bas tant qu'il reste à lire (jamais une ligne coupée
		   net), en haut dès qu'on a descendu (2026-09-26). Le fondu porte sur
		   cette zone, pas sur la carte : sa bordure reste entière. */
		const corps = ajouter(card, "div", "qbd-fiche-card-corps");
		/* Une lecture COURTE (src/lecture-etape.ts) n'a pas de carte : son
		   texte se lit au-dessus de sa question hôte, comme dans le quiz, en
		   texte atténué et sans cadre. Toute autre lecture a SA carte. */
		const l = lectureCourteDe(deps.questions, deps.lecon, i);
		const texteCourt = l === null ? "" : (deps.questions[l].prompt || "");
		if (texteCourt.trim()) {
			const el = ajouter(corps, "div", "qbd-fiche-q-lecture-courte");
			el.innerHTML = texteQuizHtml(texteCourt);
			if (texteCourt.includes("$")) void mathifyElement(el);
		}
		/* L'énoncé ENTIER, rendu comme dans le quiz (paragraphes, listes, blocs
		   de code colorés) : en texte nu d'une ligne, un bloc de code montrait
		   ses ``` et perdait ses retours à la ligne (2026-09-26). Même porte
		   que l'aperçu de l'éditeur, qui repasse par la liste blanche. */
		const enonce = q.prompt || q.title || "";
		if (enonce.trim()) {
			const el = ajouter(corps, "div", "qbd-fiche-q-text");
			el.innerHTML = texteQuizHtml(enonce);
			if (enonce.includes("$")) void mathifyElement(el);
		} else {
			texte(corps, "span", "qbd-fiche-q-text", t("dashboard.quiz.promptEmpty"));
		}
		renderOptions(corps, q);
		renderTrous(corps, q);
		suivreDebord(corps);
		/* CLIC = ÉDITER CETTE QUESTION (2026-09-26) : la carte ouvre l'éditeur
		   dessus. Toujours aucune réponse ici ; répondre se fait en jouant. */
		const editer = deps.onEditQuestion;
		if (!editer) { card.addEventListener("click", attirer); continue; }
		card.classList.add("is-editable");
		card.tabIndex = 0;
		card.setAttribute("role", "button");
		// A reading has no number (0): it gets its own label, so no two
		// buttons of the grid share one.
		card.setAttribute("aria-label", q.role === "read"
			? t("dashboard.fiche.editReading", { title: stripInlineMarkdown(q.title).trim() || `${t("engine.lesson.roleRead")} ${i + 1}` })
			: t("dashboard.fiche.editQuestion", { n }));
		card.addEventListener("click", () => editer(i));
		card.addEventListener("keydown", (e) => {
			if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
			e.preventDefault();
			editer(i);
		});
	}
}
