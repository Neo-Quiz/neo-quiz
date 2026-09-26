import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DraftQuestion } from "../editor/utils";
import { renderQuizPreviewCard } from "../editor/question-preview";
import { isRichHtml, Q_TYPES } from "../editor/utils";
import { _htmlToText } from "../editor/modals";
import { createFormBridge } from "./detail-form-bridge";
import { creerChampDirect } from "../editor/champ-direct";
import type { FormBridge } from "./detail-form-bridge";

/* ══════════════════════════════════════════════════════════
   DETAIL QUESTION — panneau principal de la page « quiz »

   Deux états d'UNE même carte (contrat Excalidraw 2026-07-21) :
   - CONSULTATION : le VRAI rendu du quiz (editor/question-preview.ts,
     mêmes classes que le moteur), à son état INITIAL — la bonne réponse
     n'y est jamais distinguée (demande explicite d'Ahmed) ;
   - ÉDITION : titre, énoncé, les champs propres au TYPE de la question,
     l'explication, puis les sections repliables (document, leçon,
     ressource, indice).

   Depuis le 2026-07-31 la page édite TOUS les types, pas seulement les
   choix : les formulaires viennent de l'éditeur via `detail-form-bridge`,
   ce qui a permis de retirer l'éditeur en trois colonnes sans rien perdre.
   Le renvoi « ouvrir l'éditeur complet » n'a donc plus lieu d'être.
══════════════════════════════════════════════════════════ */

/* ── Consultation ─────────────────────────────────────────── */

/** Le VRAI rendu du quiz (mêmes classes que le moteur), pas une imitation :
    demande d'Ahmed 2026-07-21 « il faut que ça ressemble au vrai rendu des
    quiz à droite ». Tout passe par editor/question-preview.ts, partagé avec
    l'aperçu de l'éditeur — un seul markup à suivre si le moteur change. */
export function renderQuestionView(parent: HTMLElement, q: DraftQuestion, index: number, sourcePath?: string): void {
	renderQuizPreviewCard(parent, q, {
		fallbackTitle: `Question ${index + 1}`,
		// Le chemin de la NOTE, pour que ses `![[…]]` se résolvent comme dans le
		// quiz. Absent pour un quiz encore en mémoire (résultat d'une génération).
		sourcePath,
		// Pas de bouton d'indice ici : l'indice se lit en jouant, la page
		// d'un quiz sert à relire et corriger.
	});
}

/* ── Édition ──────────────────────────────────────────────── */

export interface EditCallbacks {
	/** Une donnée a changé : persister (débounce côté appelant) + rafraîchir la liste. */
	onChange(): void;
	/** Un ajout/retrait a changé la STRUCTURE : re-render du panneau. */
	onStructureChange(): void;
}

export function renderQuestionEdit(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, sourcePath?: string): void {
	const bridge = createFormBridge({
		onChange: cb.onChange,
		onStructureChange: cb.onStructureChange,
		sourcePath,
	});

	/* Refonte de l'éditeur (2026-09-26) : le formulaire en SECTIONS NOMMÉES,
	   dans cet ordre — Titre, Question, les champs du type, Explication, puis
	   les sections repliables (Document, Leçon, Ressource, Indice). Chaque
	   section porte son libellé en petites capitales ; les champs ont le
	   style des contrôles de Neo Calendar (editor-page.css). */
	parent.classList.add("qbd-qz-form");
	renderTitleField(parent, q, cb);
	renderPromptField(parent, q, cb, bridge);

	// ── Les champs du TYPE (réponses, emplacements, paires, gabarit…) ──
	// Rendus par le formulaire de l'éditeur : mêmes classes, mêmes règles
	// (jamais moins de deux réponses, au moins une bonne, réindexation à la
	// suppression) que ce que produisait l'éditeur en onglet.
	const typeSec = bloc(parent, t("dashboard.quiz.editAnswers"));
	const def = Q_TYPES.find(d => d.key === q._type);
	if (def) {
		// Le TYPE à côté du libellé : « Réponses · Appariement ».
		const type = ajouter(typeSec.firstElementChild as HTMLElement, "span", "qbd-qz-fsec-type");
		currentHost().ui.setIcon(ajouter(type, "span", "qbd-qz-fsec-type-icon"), def.lucide);
		ajouter(type, "span", undefined, def.label);
	}
	const typeBox = ajouter(typeSec, "div", "qbd-qz-type-box");
	bridge.renderTypeFields(typeBox, q);

	renderExplain(parent, q, cb, bridge);
	renderExtras(parent, q, cb, bridge);
}

/** Une section NOMMÉE, toujours ouverte : son libellé, puis ce que
    l'appelant y écrit. Le libellé est le premier enfant. */
function bloc(parent: HTMLElement, label: string): HTMLElement {
	const sec = ajouter(parent, "section", "qbd-qz-fsec");
	const head = ajouter(sec, "div", "qbd-qz-fsec-label");
	ajouter(head, "span", undefined, label);
	return sec;
}

/* ── Titre et énoncé ──────────────────────────────────────── */

function renderTitleField(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks): void {
	const field = bloc(parent, t("dashboard.quiz.editTitle"));
	// Champ direct : le titre s'affiche rendu comme dans le quiz.
	const place = ajouter(field, "div", "qbd-qz-input qb-direct qb-direct--ligne");
	creerChampDirect(place, {
		valeur: q.title || "",
		multiligne: false,
		placeholder: t("dashboard.quiz.editTitlePlaceholder"),
		etiquette: t("dashboard.quiz.editTitle"),
		onChange: (v) => {
			q.title = v;
			// Un titre SAISI est un titre d'auteur, même s'il ressemble au motif
			// automatique : sans ce drapeau, le prochain réordonnancement le
			// remplacerait par « Question N ».
			q._userModifiedTitle = true;
			cb.onChange();
		},
	});
}

function renderPromptField(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	// Champ NU (label + zone de saisie), pas une carte dans une carte — le
	// double cadre gris de la première version faisait lourd. La zone vient
	// du formulaire de l'éditeur : elle apporte la barre d'entités HTML, le
	// raccourci ``` + Entrée et le collage d'image vers le vault — trois
	// capacités que la version maison n'avait pas.
	const rich = isRichHtml(q._promptHtml);
	const field = bloc(parent, t("dashboard.quiz.editPrompt"));
	field.classList.add("qbd-qz-fsec--prompt");

	const value = rich
		? (q._promptHtml || "").replace(/<br\s*\/?>/gi, "\n")
		: (q.prompt || "");

	bridge.field(field, "", value, t("dashboard.quiz.editPromptPlaceholder"), true, (v) => {
		if (rich) {
			// On édite le HTML LUI-MÊME : c'est la seule façon de garder un
			// tableau ou un bloc de code qu'aucun texte brut ne rendrait.
			q._promptHtml = v;
			q._useHtmlPrompt = true;
		} else {
			q.prompt = v;
			/* Ce texte vient de l'AUTEUR, pas d'un HTML aplati : le marquer est
			   ce qui le fait réémettre s'il finit par cohabiter avec un
			   `promptHtml` — sans quoi il disparaissait au rechargement suivant
			   (revue codex 2026-07-31). */
			q._promptSource = true;
			// L'énoncé redevient du texte : le HTML pré-rendu d'un import
			// l'écraserait au rendu suivant (et à l'export, cf. export.ts).
			q._useHtmlPrompt = false;
			delete q._promptHtml;
		}
		cb.onChange();
	}, rich);

}

/* ── Sections optionnelles ────────────────────────────────── */

/** Document, leçon, ressource, indice : tout ce qui entoure la question.
    Repliées par défaut, sauf celles qui portent déjà une valeur — on ne
    cache pas à l'auteur un contenu qu'il a écrit. */
function renderExtras(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	const extras = (q._extraFields ||= {});
	const readExtra = (key: string): string => {
		const v = extras[key];
		return typeof v === "string" ? v : "";
	};
	const writeExtra = (key: string, value: string): void => {
		// Une chaîne vide SUPPRIME la clé plutôt que d'écrire `passage: ''`
		// dans la note — un champ vide n'est pas une donnée.
		if (value.trim()) extras[key] = value; else delete extras[key];
		cb.onChange();
	};

	// ── Document (support de compréhension) ──
	const hasDoc = !!(readExtra("passage") || readExtra("passageId"));
	const doc = section(parent, "book-open-text", t("editor.passage.section"), hasDoc);
	ajouter(doc, "div", "qbd-qz-section-help", t("editor.passage.help"));
	bridge.field(doc, t("editor.passage.textLabel"), readExtra("passage"), t("editor.passage.textPlaceholder"), true,
		v => writeExtra("passage", v));
	bridge.field(doc, t("editor.passage.titleLabel"), readExtra("passageTitle"), t("editor.passage.titlePlaceholder"), false,
		v => writeExtra("passageTitle", v));
	bridge.field(doc, t("editor.passage.idLabel"), readExtra("passageId"), t("editor.passage.idPlaceholder"), false,
		v => writeExtra("passageId", v));

	/* ── Leçon (mode "lesson", renommé depuis "learn") ──
	   Le mode leçon AFFICHE ce texte avant la question ; sans champ, Ahmed
	   pouvait le lire dans ses quiz mais pas le corriger — la page devait être
	   « tout aussi complète ». Champ TYPÉ (q.lesson/_lessonHtml), et non plus
	   dans les `_extraFields` génériques : editor/convert.ts a déjà ramené
	   l'ancien nom "learn" au nouveau à la lecture, et cette section n'écrit
	   donc plus jamais que le nouveau (même règle que l'explication ci-dessous).
	   HTML si le contenu en porte, même règle que l'énoncé et l'explication :
	   l'aplatir à la première frappe effacerait une mise en forme.
	   `q.lesson` N'EST PAS dérivé d'un HTML non riche par convert.ts (round 1
	   de revue, FINDING 2 : cette dérivation faisait réécrire les deux champs
	   à l'export). La zone non-HTML doit quand même montrer quelque chose de
	   lisible pour une leçon qui n'a QUE du HTML non riche : dérivé ICI, pour
	   l'AFFICHAGE seul — tant que l'auteur ne tape rien, `q.lesson` reste
	   vide et l'export continue de n'écrire que `lessonHtml`, inchangé. */
	const richLesson = isRichHtml(q._lessonHtml);
	const lesson = section(parent, "graduation-cap", t("editor.lesson.section"), !!(q.lesson || q._lessonHtml));
	ajouter(lesson, "div", "qbd-qz-section-help", t("editor.lesson.help"));
	const lessonAffichage = richLesson ? (q._lessonHtml || "")
		: (q.lesson || (q._lessonHtml ? _htmlToText(q._lessonHtml) : ""));
	const lessonValeur = lessonAffichage.replace(/<br\s*\/?>/gi, "\n");
	bridge.field(lesson, "", lessonValeur,
		t("editor.lesson.placeholder"), true, v => {
			if (richLesson) {
				q._lessonHtml = v;
			} else {
				q.lesson = v;
				// Le HTML pré-rendu d'un import cède la main au texte fraîchement
				// saisi — même règle que l'explication (export.ts sinon réémet l'ancien).
				delete q._lessonHtml;
			}
			cb.onChange();
		}, richLesson);

	// ── Bouton ressource ──
	renderResourceSection(parent, q, cb, bridge);

	// ── Indice ──
	const hint = section(parent, "lightbulb", t("editor.hint.label"), !!q.hint);
	bridge.field(hint, "", (q.hint || "").replace(/<br\s*\/?>/gi, "\n"), t("editor.hint.placeholder"), true, v => {
		q.hint = v;
		cb.onChange();
	});
}

/** L'explication (après correction) : une section NOMMÉE, toujours ouverte,
    juste après les champs du type — c'est ce qu'on corrige le plus souvent
    avec la réponse (refonte 2026-09-26 ; elle était repliée en dernier). */
function renderExplain(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	// Même règle que l'énoncé : une explication qui porte du HTML s'édite en
	// HTML, sinon la première correction l'aplatirait.
	const richExplain = isRichHtml(q._explainHtml);
	const explain = bloc(parent, t("editor.form.explainSection"));
	const explainValue = (richExplain ? (q._explainHtml || "") : (q.explain || ""))
		.replace(/<br\s*\/?>/gi, "\n");
	bridge.field(explain, "", explainValue, t("editor.form.explainPlaceholder"), true, v => {
		if (richExplain) {
			/* Le HTML édité ici fait foi, mais le texte de secours n'a pas à
			   DISPARAÎTRE pour autant : l'export sait désormais écrire les deux,
			   et le vider effaçait un champ que l'auteur n'avait pas touché
			   (revue codex 2026-07-31). */
			q._explainHtml = v;
		} else {
			q.explain = v;
			// Le HTML pré-rendu d'un import cède la main au texte fraîchement
			// saisi — sinon l'export réémettrait l'ancien (cf. export.ts).
			delete q._explainHtml;
		}
		cb.onChange();
	}, richExplain);
}

/** Le bouton « ressource » n'existe que s'il est activé : son interrupteur
    vit dans l'en-tête de la section, comme dans l'éditeur. */
function renderResourceSection(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	const has = !!q.resourceButton;
	const fileName = q.resourceButton?.fileName || "";
	const label = fileName
		? t("editor.form.resourceSectionWithFile", { file: fileName })
		: t("editor.form.resourceSection");
	const box = section(parent, "paperclip", label, has);
	/* `box.parentElement`, et non `box` : `section()` rend l'INNER, dont le
	   parent est le corps — et c'est le CORPS qui est le frère de l'en-tête
	   (`wrap > head, body`, puis `body > inner`). Écrit sur `box`, ce calcul
	   rendait TOUJOURS `null` : `if (head)` ne s'est jamais exécuté et
	   l'interrupteur « activer la ressource » n'a pas été construit une seule
	   fois depuis le 2026-07-31 (67d3a88), alors que son CSS (30 lignes) et ses
	   clés i18n existaient. Un bloc mort ne rougit nulle part : c'est la
	   conversion de la tranche 3 qui l'a réveillé, en cherchant à l'éprouver. */
	const head = box.parentElement?.previousElementSibling as HTMLElement | null;

	if (head) {
		const toggle = ajouter(head, "button", "qbd-qz-section-toggle" + (has ? " is-on" : ""));
		toggle.type = "button";
		toggle.setAttribute("aria-pressed", String(has));
		toggle.title = t(has ? "editor.toggle.disable" : "editor.toggle.enable");
		ajouter(toggle, "span", "qbd-qz-section-toggle-dot");
		toggle.addEventListener("click", (e) => {
			// L'en-tête ouvre/ferme la section : l'interrupteur, lui, active la
			// ressource — sans stopPropagation le clic ferait les deux.
			e.preventDefault();
			e.stopPropagation();
			// Libellé de DÉPART : contenu (modifiable puis écrit dans le .md),
			// pas un jeton de format — traduit à la création.
			q.resourceButton = has ? null : { label: t("editor.form.resourceDefaultLabel"), fileName: "" };
			cb.onChange();
			cb.onStructureChange();
		});
	}

	const rb = q.resourceButton;
	if (!rb) return;
	bridge.field(box, t("editor.form.resourceLabel"), rb.label, t("editor.form.resourceLabelPlaceholder"), false,
		v => { rb.label = v; cb.onChange(); });
	bridge.field(box, t("editor.form.resourceFileName"), rb.fileName, t("editor.form.resourceFilePlaceholder"), false,
		v => { rb.fileName = v; cb.onChange(); });
	ajouter(box, "div", "qbd-qz-section-help", t("editor.form.resourceHelp"));
}

/** Section repliable : en-tête cliquable + corps. Renvoie l'INNER (l'appelant
    y écrit ses champs) ; l'en-tête se retrouve par
    `parentElement.previousElementSibling` quand il faut y greffer un
    interrupteur — l'inner est fils UNIQUE du corps, c'est donc le CORPS qui est
    le frère de l'en-tête. Ce cran oublié a coûté six semaines d'interrupteur
    mort. */
function section(parent: HTMLElement, icon: string, label: string, open: boolean): HTMLElement {
	const wrap = ajouter(parent, "div", "qbd-qz-section" + (open ? "" : " is-collapsed"));
	const head = ajouter(wrap, "button", "qbd-qz-section-head");
	head.type = "button";
	head.setAttribute("aria-expanded", String(open));
	// UN seul glyphe, tourné par CSS : deux icônes échangées par setIcon() ne
	// peuvent pas transitionner (cf. obsidian:plugin-dev §6 ter).
	const ui = currentHost().ui;
	ui.setIcon(ajouter(head, "span", "qbd-qz-section-chevron"), "chevron-right");
	ui.setIcon(ajouter(head, "span", "qbd-qz-section-icon"), icon);
	ajouter(head, "span", "qbd-qz-section-label", label);

	// Corps TOUJOURS monté, réduit à 0 par la classe : sans lui il n'y aurait
	// rien à révéler à l'ouverture.
	const body = ajouter(wrap, "div", "qbd-qz-section-body");
	const inner = ajouter(body, "div", "qbd-qz-section-inner");

	head.addEventListener("click", () => {
		const collapsed = wrap.classList.contains("is-collapsed");
		wrap.classList.add("is-animating");
		wrap.classList.toggle("is-collapsed", !collapsed);
		head.setAttribute("aria-expanded", String(collapsed));
		const stop = (): void => wrap.classList.remove("is-animating");
		body.addEventListener("transitionend", function onEnd(e: TransitionEvent) {
			if (e.target !== body || e.propertyName !== "grid-template-rows") return;
			body.removeEventListener("transitionend", onEnd);
			stop();
		});
		// Filet : transitionend ne part jamais en reduced-motion.
		window.setTimeout(stop, 320);
	});

	return inner;
}
