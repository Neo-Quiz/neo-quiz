import { currentHost } from "../host/current";
import { placerIndicateur, DUREE_GLISSEMENT } from "./seg-indic";
import { ajouter } from "../dom";
import { poserBouton3d } from "./cta3d";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { QuestionRole } from "../types/quiz";
import type { ModeQuiz } from "../quiz-format";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { quizModeLabel, renderQuizTypeIcon } from "./quiz-card";
import { setBrandLogo } from "./ai-providers";
import { attachHoverTip } from "./hover-tip";

/* ══════════════════════════════════════════════════════════
   FICHE D'UN QUIZ — ce que la page montre à l'ouverture

   ORGANISATION DE STUDYSMARTER (2026-09-26), qui remplace la fiche fixe à
   gauche et la frise verticale du 2026-09-23 (« c'est beau mais c'est mal
   organisé ») : un EN-TÊTE sur toute la largeur (retour, dossier et titre à
   gauche ; Éditeur, Commencer le quiz et ⋮ à droite), une ligne d'infos
   (mode, nombre de questions, origine, progression), une BARRE d'outils
   (grille | liste, recherche), puis les questions sur toute la largeur.

   DEUX VUES, comme StudySmarter, essayées toutes deux dans l'app :
   - GRILLE : toutes les questions en cartes, vues d'un coup ;
   - LISTE : les questions en colonne à gauche, celle qu'on choisit en
     grand à droite, avec ← → pour passer de l'une à l'autre.
   Cliquer une carte de la grille l'ouvre dans la liste. La vue choisie est
   une commodité de l'utilisateur : `localStorage`, et la grille à défaut.

   AUCUNE RÉPONSE ici : on relit le quiz pour savoir ce qui attend, pas pour
   en apprendre la solution. Seules les options d'un QCM sont montrées, sans
   la bonne ; les autres types n'affichent que leur énoncé. Répondre ne se
   fait qu'en jouant le quiz : cliquer la question agrandie fait briller
   « Commencer le quiz » (règle du 2026-09-23, gardée).

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
	stat: QuizStatRecord;
	/** Absente pour une note écrite à la main ou un quiz partagé. */
	origine: FicheOrigine | null;
	/** Lance le quiz (le bouton de l'hôte, avec l'écriture en attente). */
	onStart(el: HTMLElement): void;
	/** Passe la page en édition. */
	onEdit(): void;
	/** Quitte la page. */
	onBack(): void;
	/** L'autre mode du même cours : la pastille du mode devient un sélecteur
	    Learn | Practice, dont l'autre segment ouvre ce quiz. */
	autreMode?: { mode: ModeQuiz; open(): void };
	/** Le menu « ⋮ » du quiz, le même que celui de sa carte. Absent : pas de bouton. */
	menu?(anchor: HTMLElement): void;
}

type Vue = "grille" | "liste";
const CLE_VUE = "neo-quiz.fiche.vue";

function lireVue(): Vue {
	try { return localStorage.getItem(CLE_VUE) === "liste" ? "liste" : "grille"; } catch { return "grille"; }
}
function ecrireVue(v: Vue): void {
	try { localStorage.setItem(CLE_VUE, v); } catch { /* simple commodité : sans stockage, la grille */ }
}

/* L'état de la barre, gardé entre deux repeints du MÊME quiz (la page se
   repeint sur des événements extérieurs) ; remis à zéro sur un autre quiz. */
const etat = { chemin: "", selection: 0, recherche: "", fondu: false };

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

/** Oublie la recherche et la question choisie : appelée par la page à
    chaque ARRIVÉE (navigation), jamais à un repeint interne. Le fondu d'un
    changement de mode, lui, doit survivre à l'arrivée sur l'autre quiz. */
export function oublierFiche(): void {
	etat.chemin = "";
	etat.selection = 0;
	etat.recherche = "";
}

export function renderFiche(parent: HTMLElement, deps: FicheDeps): void {
	if (etat.chemin !== deps.quiz.path) {
		etat.chemin = deps.quiz.path;
		etat.selection = 0;
		etat.recherche = "";
	}
	const root = ajouter(parent, "div", "qbd-fiche");
	const attirer = renderHead(root, deps);
	renderMeta(root, deps);
	renderBody(root, attirer, deps);
}

/** L'en-tête, et la fonction qui attire l'œil sur « Commencer le quiz ». */
function renderHead(root: HTMLElement, deps: FicheDeps): () => void {
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

	// Le DOSSIER du quiz, au-dessus du titre — le seul segment du chemin qui
	// dise d'où il sort (même règle que les cartes). Racine du vault : rien.
	const titres = ajouter(head, "div", "qbd-fiche-titles");
	const dossier = deps.quiz.path.split("/").slice(0, -1).filter(Boolean).pop();
	if (dossier) ajouter(titres, "div", "qbd-fiche-kicker", dossier);
	ajouter(titres, "h2", "qbd-fiche-title", deps.quiz.title);

	const actions = ajouter(head, "div", "qbd-fiche-actions");
	const edit = ajouter(actions, "button", "qbd-btn qbd-btn--ghost qbd-qz-edit-btn qbd-fiche-edit");
	edit.type = "button";
	icone(edit, "square-pen", "qbd-btn-icon");
	ajouter(edit, "span", undefined, t("dashboard.quiz.editor"));
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
    de questions, l'origine, la progression. */
function renderMeta(root: HTMLElement, deps: FicheDeps): void {
	const meta = ajouter(root, "div", "qbd-fiche-meta");
	const chips = ajouter(meta, "div", "qbd-fiche-chips");
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
	const count = ajouter(chips, "span", "qbd-fiche-chip");
	renderQuizTypeIcon(count, deps.quiz.quizType);
	ajouter(count, "span", undefined, t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));

	/* D'où vient le quiz : le logo, le modèle, puis la date, sur une ligne ;
	   l'infobulle donne l'identifiant exact. */
	if (deps.origine) {
		const o = deps.origine;
		const bloc = ajouter(meta, "div", "qbd-fiche-origin");
		bloc.title = o.tooltip;
		const logo = ajouter(bloc, "span", "qbd-provider-logo qbd-fiche-origin-logo qbd-provider-logo--" + o.logo);
		setBrandLogo(logo, o.logo);
		ajouter(bloc, "span", "qbd-fiche-origin-model", o.source);
		ajouter(bloc, "span", "qbd-fiche-origin-date", o.date);
	}

	/* La progression, seulement quand elle dit quelque chose : une barre vide
	   sous un quiz jamais commencé n'apprend rien, le bouton suffit. */
	const total = deps.stat.totalQuestions || deps.quiz.questions;
	const done = Math.min(deps.stat.questionsDone, total);
	if (done > 0 || deps.stat.attempts > 0) {
		const progress = ajouter(meta, "div", "qbd-fiche-progress");
		const bar = ajouter(progress, "div", "qbd-fiche-bar");
		ajouter(bar, "div", "qbd-fiche-fill").style.width = `${total > 0 ? Math.round(done / total * 100) : 0}%`;
		const legend = ajouter(progress, "div", "qbd-fiche-legend");
		ajouter(legend, "span", undefined, t("dashboard.quiz.welcomeProgress", { done, total }));
		if (deps.stat.attempts > 0) {
			const best = ajouter(legend, "span", "qbd-fiche-best", t("dashboard.detail.metaBest", { score: deps.stat.bestScore }));
			if (deps.stat.bestScore >= 80) best.classList.add("is-good");
			else if (deps.stat.bestScore >= 60) best.classList.add("is-fair");
		}
	}
}

/* Le RÔLE d'une question de Learn, quand il en change la nature : une
   lecture étiquetée « Choix unique » mentait sur ce qu'elle est. `test`
   (la vérification de fin de partie) est une question ordinaire : son type
   suffit. */
const ROLE_KEYS: Partial<Record<QuestionRole, TransKey>> = {
	pre: "engine.lesson.rolePre",
	read: "engine.lesson.roleRead",
	explain: "engine.lesson.roleExplain",
	recall: "engine.lesson.roleRecall",
};

/* Au-delà, une option ne tient plus dans une bulle à côté des autres : la
   liste passe en colonne. Compté sur le texte BRUT, LaTeX compris. */
const OPTION_COURTE = 32;

/** L'en-tête d'une carte : son numéro, l'icône et le nom du type, puis le rôle d'un Learn. */
function renderTop(card: HTMLElement, q: DraftQuestion, numero: number): void {
	const top = ajouter(card, "span", "qbd-fiche-q-top");
	ajouter(top, "span", "qbd-fiche-num", String(numero));
	const roleKey = q.role ? ROLE_KEYS[q.role] : undefined;
	// Une lecture n'attend pas de réponse, une explication est toujours libre :
	// leur type n'apprendrait rien.
	if (q.role === "read") icone(top, "book-open", "qbd-fiche-q-icon");
	if (q.role !== "read" && q.role !== "explain") {
		const def = Q_TYPES.find(d => d.key === q._type);
		if (def) icone(top, def.lucide, "qbd-fiche-q-icon");
		ajouter(top, "span", undefined, def?.label ?? q._type);
	}
	if (roleKey) ajouter(top, "span", "qbd-fiche-q-role", t(roleKey));
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
		texte(line, "span", "qbd-fiche-opt-text", o);
	});
}

/** Minuscules sans accents : « équation » se trouve en tapant « equation ». */
function plier(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Les indices des questions qui contiennent la recherche (énoncé ou options). */
function filtrer(questions: DraftQuestion[], recherche: string): number[] {
	const r = plier(recherche.trim());
	const tous = questions.map((_, i) => i);
	if (!r) return tous;
	return tous.filter(i => {
		const q = questions[i];
		return plier([questionText(q), ...(q.options ?? [])].join(" ")).includes(r);
	});
}

/** La barre (grille | liste, recherche) et les questions dessous. */
function renderBody(root: HTMLElement, attirer: () => void, deps: FicheDeps): void {
	let vue = lireVue();
	const tools = ajouter(root, "div", "qbd-fiche-tools");
	const vues = ajouter(tools, "div", "qbd-fiche-views");
	vues.setAttribute("role", "group");
	const boutonsVue = (["grille", "liste"] as const).map(v => {
		const b = ajouter(vues, "button", "qbd-fiche-view");
		b.type = "button";
		const label = t(v === "grille" ? "dashboard.fiche.viewGrid" : "dashboard.fiche.viewList");
		b.setAttribute("aria-label", label);
		b.title = label;
		currentHost().ui.setIcon(b, v === "grille" ? "layout-grid" : "layout-list");
		b.addEventListener("click", () => { if (vue !== v) { vue = v; ecrireVue(v); peindre(); } });
		return { v, b };
	});

	const recherche = ajouter(tools, "label", "qbd-fiche-search");
	icone(recherche, "search", "qbd-fiche-search-icon");
	const champ = ajouter(recherche, "input", "qbd-fiche-search-input");
	champ.type = "search";
	champ.placeholder = t("dashboard.fiche.search");
	champ.setAttribute("aria-label", t("dashboard.fiche.search"));
	champ.value = etat.recherche;
	champ.addEventListener("input", () => { etat.recherche = champ.value; peindre(); });

	const body = ajouter(root, "div", "qbd-fiche-body");

	/* ← → dans la vue liste, sauf quand on écrit dans la recherche. */
	root.addEventListener("keydown", (e) => {
		if (vue !== "liste" || e.target === champ || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
		const idx = filtrer(deps.questions, etat.recherche);
		const pos = idx.indexOf(etat.selection);
		const suivante = idx[pos + (e.key === "ArrowRight" ? 1 : -1)];
		if (suivante === undefined) return;
		e.preventDefault();
		etat.selection = suivante;
		peindre();
	});

	function peindre(): void {
		for (const { v, b } of boutonsVue) {
			b.classList.toggle("is-active", v === vue);
			b.setAttribute("aria-pressed", v === vue ? "true" : "false");
		}
		const defile = body.querySelector<HTMLElement>(".qbd-fiche-rail")?.scrollTop ?? 0;
		body.replaceChildren();
		body.dataset.vue = vue;
		const idx = filtrer(deps.questions, etat.recherche);
		if (idx.length === 0) {
			ajouter(body, "p", "qbd-fiche-empty", t("dashboard.fiche.searchEmpty"));
			return;
		}
		if (vue === "grille") renderGrille(body, idx, deps, (i) => {
			etat.selection = i;
			vue = "liste";
			ecrireVue(vue);
			peindre();
		});
		else {
			if (!idx.includes(etat.selection)) etat.selection = idx[0];
			renderListe(body, idx, deps, attirer, defile, (i) => { etat.selection = i; peindre(); });
		}
		if (etat.fondu) {
			etat.fondu = false;
			body.querySelectorAll<HTMLElement>(".qbd-fiche-q").forEach(c => c.animate(
				[{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 60, easing: "ease-out", fill: "backwards" },
			));
		}
	}
	peindre();
}

/** GRILLE : une carte par question ; cliquer l'ouvre dans la liste. */
function renderGrille(body: HTMLElement, idx: number[], deps: FicheDeps, ouvrir: (i: number) => void): void {
	const grille = ajouter(body, "div", "qbd-fiche-grid");
	for (const i of idx) {
		const q = deps.questions[i];
		const card = ajouter(grille, "button", "qbd-fiche-q qbd-fiche-card");
		card.type = "button";
		renderTop(card, q, i + 1);
		texte(card, "span", "qbd-fiche-q-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
		renderOptions(card, q);
		card.addEventListener("click", () => ouvrir(i));
	}
}

/** LISTE : les questions en colonne, celle choisie en grand à droite. */
function renderListe(body: HTMLElement, idx: number[], deps: FicheDeps, attirer: () => void, defile: number, choisir: (i: number) => void): void {
	const split = ajouter(body, "div", "qbd-fiche-split");
	const rail = ajouter(split, "div", "qbd-fiche-rail");
	let active: HTMLElement | null = null;
	for (const i of idx) {
		const q = deps.questions[i];
		const row = ajouter(rail, "button", "qbd-fiche-row" + (i === etat.selection ? " is-active" : ""));
		row.type = "button";
		if (i === etat.selection) { active = row; row.setAttribute("aria-current", "true"); }
		renderTop(row, q, i + 1);
		texte(row, "span", "qbd-fiche-row-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
		row.addEventListener("click", () => choisir(i));
	}
	rail.scrollTop = defile;
	const courante = active;
	if (courante) {
		/* Le repeint vient de retirer l'élément qui avait le focus (la ligne
		   cliquée, la carte de la grille) : le focus est retombé sur le
		   document, hors de la fiche, et ← → ne l'atteignaient plus. On le
		   rend à la ligne choisie ; jamais volé à la recherche. */
		if (!document.activeElement || document.activeElement === document.body) courante.focus({ preventScroll: true });
		requestAnimationFrame(() => courante.scrollIntoView({ block: "nearest" }));
	}

	const detail = ajouter(split, "div", "qbd-fiche-detail");
	const q = deps.questions[etat.selection];
	// Pas un bouton : on répond en jouant le quiz ; un clic fait briller « Commencer ».
	const card = ajouter(detail, "div", "qbd-fiche-q qbd-fiche-big");
	renderTop(card, q, etat.selection + 1);
	texte(card, "p", "qbd-fiche-big-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
	renderOptions(card, q);
	card.addEventListener("click", attirer);

	const pos = idx.indexOf(etat.selection);
	const nav = ajouter(detail, "div", "qbd-fiche-nav");
	const fleche = (sens: -1 | 1): void => {
		const b = ajouter(nav, "button", "qbd-fiche-nav-btn");
		b.type = "button";
		b.setAttribute("aria-label", t(sens < 0 ? "dashboard.quiz.prev" : "dashboard.quiz.next"));
		currentHost().ui.setIcon(b, sens < 0 ? "chevron-left" : "chevron-right");
		const cible = idx[pos + sens];
		if (cible === undefined) b.disabled = true;
		else b.addEventListener("click", () => choisir(cible));
	};
	fleche(-1);
	ajouter(nav, "span", "qbd-fiche-nav-pos", t("dashboard.fiche.position", { n: pos + 1, total: idx.length }));
	fleche(1);
}
