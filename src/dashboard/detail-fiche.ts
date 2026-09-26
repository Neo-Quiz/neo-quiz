import { currentHost } from "../host/current";
import { placerIndicateur, DUREE_GLISSEMENT } from "./seg-indic";
import { ajouter } from "../dom";
import { poserBouton3d, poserBouton3dNeutre } from "./cta3d";
import { t } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { ModeQuiz } from "../quiz-format";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { texteQuizHtml } from "../editor/question-preview";
import { renderInlineText } from "../engine/sanitizer";
import { reinitialiserBudgetRendu } from "../engine/code-highlight";
import { quizModeLabel, renderQuizTypeIcon } from "./quiz-card";
import { setBrandLogo } from "./ai-providers";
import { attachHoverTip } from "./hover-tip";
import { lectureDeLEtape, numerosAffiches, questionsVisibles } from "../lecture-etape";

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
	/** Lance le quiz (le bouton de l'hôte, avec l'écriture en attente). */
	onStart(el: HTMLElement): void;
	/** Passe la page en édition. */
	onEdit(): void;
	/** Ouvre l'éditeur sur CETTE question (clic sur sa carte). Absente : le
	    clic fait briller « Commencer le quiz », comme avant. */
	onEditQuestion?(index: number): void;
	/** Quitte la page. */
	onBack(): void;
	/** L'autre mode du même cours : la pastille du mode devient un sélecteur
	    Learn | Practice, dont l'autre segment ouvre ce quiz. */
	autreMode?: { mode: ModeQuiz; open(): void };
	/** Le menu « ⋮ » du quiz, le même que celui de sa carte. Absent : pas de bouton. */
	menu?(anchor: HTMLElement): void;
}

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

export function renderFiche(parent: HTMLElement, deps: FicheDeps): void {
	if (etat.chemin !== deps.quiz.path) {
		etat.chemin = deps.quiz.path;
		etat.recherche = "";
	}
	const root = ajouter(parent, "div", "qbd-fiche");
	renderHead(root, deps);
	/* UNE ligne sous le titre : les infos à gauche, la recherche au centre,
	   les actions à droite (2026-09-26 : chacune à sa hauteur, elles
	   n'étaient alignées sur rien). */
	const tools = ajouter(root, "div", "qbd-fiche-tools");
	renderMeta(tools, deps);
	const recherche = ajouter(tools, "div", "qbd-fiche-tools-center");
	const attirer = renderActions(tools, deps);
	renderBody(root, recherche, attirer, deps);
}

/** L'en-tête : la flèche retour, le dossier et le titre. */
function renderHead(root: HTMLElement, deps: FicheDeps): void {
	/* La flèche retour AU-DESSUS du titre (2026-09-26), comme dans un
	   dossier : à gauche, dossier, titre, ligne d'infos et barre partent
	   tous de la même verticale. Même bouton que le retour de l'en-tête :
	   un seul retour dans tout le dashboard. */
	const back = ajouter(root, "button", "qbd-quizzes-crumb-back qbd-fiche-back");
	back.type = "button";
	back.setAttribute("aria-label", t("dashboard.quiz.back"));
	// Flèche dessinée en CSS (masque), comme tout bouton retour du dashboard.
	ajouter(back, "span", "qbd-quizzes-crumb-icon");
	back.addEventListener("click", () => deps.onBack());

	const head = ajouter(root, "header", "qbd-fiche-head");

	// Le DOSSIER du quiz — le seul segment du chemin qui dise d'où il sort
	// (même règle que les cartes). Racine du vault : rien.
	const titres = ajouter(head, "div", "qbd-fiche-titles");
	const dossier = deps.quiz.path.split("/").slice(0, -1).filter(Boolean).pop();
	// Le titre D'ABORD, le dossier en sous-titre dessous (2026-09-26).
	ajouter(titres, "h2", "qbd-fiche-title", deps.quiz.title);
	if (dossier) ajouter(titres, "div", "qbd-fiche-kicker", dossier);
}

/** Les actions, au bout de la ligne d'infos, et la fonction qui attire
    l'œil sur « Commencer le quiz ». DESCENDUES d'une ligne (2026-09-26) :
    à la hauteur du titre, elles étaient loin de la barre et des questions ;
    à celle des pastilles, la main les trouve plus vite. */
function renderActions(meta: HTMLElement, deps: FicheDeps): () => void {
	const actions = ajouter(meta, "div", "qbd-fiche-actions");
	const edit = ajouter(actions, "button", "qbd-fiche-edit");
	edit.type = "button";
	icone(edit, "square-pen", "qbd-btn-icon");
	ajouter(edit, "span", undefined, t("dashboard.quiz.editor"));
	poserBouton3dNeutre(edit);
	edit.addEventListener("click", () => deps.onEdit());

	const start = ajouter(actions, "button", "qbd-fiche-start");
	start.type = "button";
	icone(start, "play", "qbd-btn-icon");
	ajouter(start, "span", undefined, t("dashboard.quiz.welcomeStart"));
	/* Le bouton 3D de Brilliant, dans le bleu des flèches (2026-09-25) : face
	   surélevée qui s'enfonce au clic, et le REFLET qui balaie — un SVG à
	   part, pour que `attirer` puisse relancer son cycle (cta3d.ts). */
	const reflet = poserBouton3d(start);
	start.addEventListener("click", () => deps.onStart(start));
	/* ENTRÉE = « Commencer le quiz » quand rien n'a le focus (2026-09-26),
	   avec l'enfoncement du clic : la face descend, PUIS le quiz part. Pas
	   quand on écrit (recherche), ni sur un bouton ou une carte focalisés
	   (Entrée leur appartient), ni sous une modale. L'écouteur se retire
	   de lui-même dès que la fiche quitte le document. */
	const surEntree = (e: KeyboardEvent): void => {
		if (!start.isConnected) { document.removeEventListener("keydown", surEntree); return; }
		if (e.key !== "Enter" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
		const cible = e.target instanceof HTMLElement ? e.target : null;
		if (cible && cible !== document.body && cible.closest("input, textarea, select, button, a, [contenteditable], [role=button], [tabindex]")) return;
		if (document.querySelector(".modal-container, [role=dialog], [aria-modal=true]")) return;
		e.preventDefault();
		start.classList.add("is-pressing");
		window.setTimeout(() => {
			start.classList.remove("is-pressing");
			if (start.isConnected) deps.onStart(start);
		}, reduit() ? 0 : 130);
	};
	document.addEventListener("keydown", surEntree);

	/* « ⋮ » : le menu de la carte du quiz, comme l'en-tête d'un dossier. */
	const menu = deps.menu;
	if (menu) {
		const plus = ajouter(actions, "button", "qbd-folder-more-btn");
		plus.type = "button";
		plus.setAttribute("aria-label", t("dashboard.card.more"));
		plus.title = t("dashboard.card.more");
		currentHost().ui.setIcon(plus, "ellipsis-vertical");
		plus.addEventListener("click", () => menu(plus));
	}

	/* Relance le reflet sur-le-champ (remis au début de son cycle). Rien
	   sans animations. */
	return () => {
		if (reduit()) return;
		for (const a of reflet.getAnimations()) a.currentTime = 0;
	};
}

/** La ligne d'infos : le mode (ou le sélecteur Learn | Practice), le nombre
    de questions, l'origine ; les actions s'y ajoutent au bout. */
/** La même ligne d'infos pour l'en-tête de l'ÉDITEUR (2026-09-26) : le
    mode seul (sans bascule Learn | Practice : on édite CE quiz), le nombre
    de questions, l'origine. */
export function renderInfosQuiz(parent: HTMLElement, quiz: QuizIndexEntry, origine: FicheOrigine | null): HTMLElement {
	return renderMeta(parent, { quiz, origine });
}

function renderMeta(root: HTMLElement, deps: Pick<FicheDeps, "quiz" | "origine" | "autreMode">): HTMLElement {
	const meta = ajouter(root, "div", "qbd-fiche-meta");
	/* Les pastilles, puis l'ORIGINE (modèle et date) sur la ligne du dessous,
	   à la place qu'occupait la recherche, partie au centre (2026-09-26) ;
	   les actions au bout. */
	const infos = ajouter(meta, "div", "qbd-fiche-meta-infos");
	const chips = ajouter(infos, "div", "qbd-fiche-chips");
	/* Le MODE, avec son icône, et au survol son explication : la bulle du
	   sélecteur Learn | Practice de la page « Générer », mêmes textes. */
	const pastilleMode = (parent: HTMLElement, m: ModeQuiz, cls: string, tag: "span" | "button"): HTMLElement => {
		const el = ajouter(parent, tag, cls);
		icone(el, m === "learn" ? "book-open" : "dumbbell", "qbd-fiche-mode-icon");
		ajouter(el, "span", undefined, quizModeLabel(m));
		attachHoverTip(el, (tip) => {
			tip.classList.add("qbd-hover-tip--card");
			ajouter(tip, "div", "qbd-hover-tip-title", m === "learn" ? t("ai.mode.learn") : t("ai.mode.practice"));
			ajouter(tip, "div", "qbd-hover-tip-body", m === "learn" ? t("ai.mode.learnTip") : t("ai.mode.practiceTip"));
		});
		return el;
	};
	const autre = deps.autreMode;
	if (autre && autre.mode !== deps.quiz.mode) {
		const choix = ajouter(chips, "div", "qbd-fiche-modes");
		choix.setAttribute("role", "group");
		/* Le bloc qui glisse, comme dans la page « Générer » (2026-09-25) : au
		   clic, il glisse vers l'autre mode pendant que les questions
		   s'effacent, PUIS sa fiche s'ouvre et les siennes apparaissent. */
		const indic = ajouter(choix, "div", "qbd-fiche-mode-indic");
		const segs = (["learn", "practice"] as const).map(m => {
			const actif = m === deps.quiz.mode;
			const seg = pastilleMode(choix, m, "qbd-fiche-mode-seg" + (actif ? " is-active" : ""), "button");
			(seg as HTMLButtonElement).type = "button";
			seg.setAttribute("aria-pressed", actif ? "true" : "false");
			return { actif, seg };
		});
		const courant = segs.find(s => s.actif)!.seg;
		requestAnimationFrame(() => placerIndicateur(indic, courant, false));
		for (const { actif, seg } of segs) {
			if (actif) continue;
			let parti = false;
			seg.addEventListener("click", () => {
				if (parti) return;
				parti = true;
				courant.classList.remove("is-active");
				seg.classList.add("is-active");
				placerIndicateur(indic, seg, true);
				const sansAnim = reduit();
				if (!sansAnim) {
					etat.fondu = true;
					root.querySelectorAll<HTMLElement>(".qbd-fiche-q").forEach(c => c.animate(
						[{ opacity: 1 }, { opacity: 0 }],
						{ duration: DUREE_GLISSEMENT, easing: "ease-out", fill: "forwards" },
					));
				}
				window.setTimeout(() => autre.open(), sansAnim ? 0 : DUREE_GLISSEMENT);
			});
		}
	} else {
		pastilleMode(chips, deps.quiz.mode, "qbd-fiche-chip is-accent qbd-fiche-mode", "span");
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
export function renderTop(card: HTMLElement, q: DraftQuestion, numero: number): HTMLElement {
	const top = ajouter(card, "span", "qbd-fiche-q-top");
	// 0 : une lecture de Learn restée un écran, qui n'a pas de numéro de
	// question (src/lecture-etape.ts) — son icône de livre suffit.
	if (numero > 0) ajouter(top, "span", "qbd-fiche-num", String(numero));
	if (q.role === "read") {
		// Une lecture n'attend pas de réponse : son type n'apprendrait rien.
		icone(top, "book-open", "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", t("engine.lesson.roleRead"));
	} else if (q.role === "explain") {
		// Une explication est toujours libre : son type n'apprendrait rien non plus.
		icone(top, "pen-line", "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", t("engine.lesson.roleExplain"));
	} else {
		const def = Q_TYPES.find(d => d.key === q._type);
		if (def) icone(top, def.lucide, "qbd-fiche-q-icon");
		ajouter(top, "span", "qbd-fiche-q-type", def?.label ?? q._type);
	}
	return top;
}

/** Les options d'un QCM, SANS la bonne, marquées A, B, C… : rien ne se
    coche ici. Toutes courtes : des bulles côte à côte ; sinon une colonne. */
function renderOptions(card: HTMLElement, q: DraftQuestion): void {
	if ((q._type !== "single" && q._type !== "multi") || q.role === "read" || !q.options?.length) return;
	const courtes = q.options.every(o => o.length <= OPTION_COURTE);
	const opts = ajouter(card, "span", courtes ? "qbd-fiche-opts is-pills" : "qbd-fiche-opts");
	q.options.forEach((o, j) => {
		const line = ajouter(opts, "span", "qbd-fiche-opt");
		ajouter(line, "span", "qbd-fiche-opt-letter", String.fromCharCode(65 + j));
		/* Une option est du texte de quiz : même porte que dans le quiz
		   (`renderInlineText`), sans quoi `[10, 20, 30]` s'affichait
		   avec ses accents graves (2026-09-26). */
		const txt = ajouter(line, "span", "qbd-fiche-opt-text");
		txt.innerHTML = renderInlineText(o);
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
		const l = lectureDeLEtape(questions, lecon, i);
		const cours = l === null ? [] : [questions[l].title || "", questionText(questions[l])];
		return plier([questionText(q), ...(q.options ?? []), ...cours].join(" ")).includes(r);
	});
}

/** La recherche, et les questions dessous, en grille. */
function renderBody(root: HTMLElement, place: HTMLElement, attirer: () => void, deps: FicheDeps): void {
	const recherche = ajouter(place, "label", "qbd-fiche-search");
	icone(recherche, "search", "qbd-fiche-search-icon");
	const champ = ajouter(recherche, "input", "qbd-fiche-search-input");
	champ.type = "search";
	champ.placeholder = t("dashboard.fiche.search");
	champ.setAttribute("aria-label", t("dashboard.fiche.search"));
	champ.value = etat.recherche;
	champ.addEventListener("input", () => { etat.recherche = champ.value; peindre(); });

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
}

/** GRILLE : une carte par question. Pas un bouton : on répond en jouant le
    quiz ; un clic fait briller « Commencer le quiz ». */
/** Pose `a-suivre` (reste du texte en bas) et `a-precede` (texte au-dessus)
    sur une zone qui défile, à chaque défilement et à chaque changement de
    taille (formules rendues, fenêtre redimensionnée). Exportée : les listes
    d'un dossier (`folder-sections.ts`) défilent avec les mêmes fondus. */
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
	// Tout de suite (la grille est déjà dans le document), puis au cadre
	// suivant, une fois les polices et les formules posées.
	maj();
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
		const n = numeros[i] || i + 1;
		const card = ajouter(grille, "div", "qbd-fiche-q qbd-fiche-card");
		// Une lecture de Learn n'a pas de numéro (0) : la carte n'en montre pas.
		renderTop(card, q, numeros[i] ?? n);
		/* Le CONTENU défile dans sa propre zone, sous l'en-tête de la carte :
		   un fondu en bas tant qu'il reste à lire (jamais une ligne coupée
		   net), en haut dès qu'on a descendu (2026-09-26). Le fondu porte sur
		   cette zone, pas sur la carte : sa bordure reste entière. */
		const corps = ajouter(card, "div", "qbd-fiche-card-corps");
		// Le cours de l'étape, au-dessus de la question : son titre seul.
		const l = lectureDeLEtape(deps.questions, deps.lecon, i);
		if (l !== null) {
			const ligne = ajouter(corps, "span", "qbd-fiche-q-lecture");
			icone(ligne, "book-open");
			texte(ligne, "span", "qbd-fiche-q-lecture-titre", deps.questions[l].title || t("engine.passage.defaultTitle"));
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
		suivreDebord(corps);
		/* CLIC = ÉDITER CETTE QUESTION (2026-09-26) : la carte ouvre l'éditeur
		   dessus. Toujours aucune réponse ici ; répondre se fait en jouant. */
		const editer = deps.onEditQuestion;
		if (!editer) { card.addEventListener("click", attirer); continue; }
		card.classList.add("is-editable");
		card.tabIndex = 0;
		card.setAttribute("role", "button");
		card.setAttribute("aria-label", t("dashboard.fiche.editQuestion", { n }));
		card.title = t("dashboard.fiche.editQuestion", { n });
		card.addEventListener("click", () => editer(i));
		card.addEventListener("keydown", (e) => {
			if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
			e.preventDefault();
			editer(i);
		});
	}
}
