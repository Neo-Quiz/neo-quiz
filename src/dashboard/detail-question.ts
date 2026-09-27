import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DraftQuestion } from "../editor/utils";
import { renderQuizPreviewCard } from "../editor/question-preview";
import { isRichHtml } from "../editor/utils";
import { _htmlToText } from "../editor/modals";
import type { FormBridge } from "./detail-form-bridge";

/* ══════════════════════════════════════════════════════════
   DETAIL QUESTION — panneau principal de la page « quiz »

   Deux états d'UNE même carte (contrat Excalidraw 2026-07-21) :
   - CONSULTATION : le VRAI rendu du quiz (editor/question-preview.ts,
     mêmes classes que le moteur), à son état INITIAL — la bonne réponse
     n'y est jamais distinguée (demande explicite d'Ahmed) ;
   - ÉDITION : le rendu CORRIGÉ, modifiable sur place, et le panneau
     « Plus » (dashboard/detail-edition.ts), qui monte d'ici les sections
     repliables (document, leçon, ressource, indice).
══════════════════════════════════════════════════════════ */

/* ── Consultation ─────────────────────────────────────────── */

/** Le VRAI rendu du quiz (mêmes classes que le moteur), pas une imitation :
    demande d'Ahmed 2026-07-21 « il faut que ça ressemble au vrai rendu des
    quiz à droite ». Tout passe par editor/question-preview.ts, partagé avec
    l'aperçu de l'éditeur — un seul markup à suivre si le moteur change. */
export function renderQuestionView(parent: HTMLElement, q: DraftQuestion, index: number, sourcePath?: string, lecture?: DraftQuestion): void {
	renderQuizPreviewCard(parent, q, {
		// Une lecture de Learn (index -1) n'a pas de numéro : repli neutre.
		fallbackTitle: index >= 0 ? `Question ${index + 1}` : t("editor.render.untitled"),
		// Le cours de l'étape (Learn), au-dessus de la question.
		lecture,
		// Le chemin de la NOTE, pour que ses `![[…]]` se résolvent comme dans le
		// quiz. Absent pour un quiz encore en mémoire (résultat d'une génération).
		sourcePath,
		// Pas de bouton d'indice ici : l'indice se lit en jouant, la page
		// d'un quiz sert à relire et corriger.
	});
}

/* ── Édition : les sections du panneau « Plus » ──────────────
   La question s'édite dans son RENDU corrigé depuis le 2026-09-26
   (dashboard/detail-edition.ts, edition-rendu.ts) ; le formulaire complet
   qui vivait ici (titre, énoncé, champs du type, explication) a disparu avec
   lui. Il reste ce qui entoure la question — document, leçon, ressource,
   indice —, monté dans « Plus ». */

export interface EditCallbacks {
	/** Une donnée a changé : persister (débounce côté appelant) + rafraîchir la liste. */
	onChange(): void;
	/** Un ajout/retrait a changé la STRUCTURE : re-render du panneau. */
	onStructureChange(): void;
}

/** Une section NOMMÉE, toujours ouverte : son libellé, puis ce que
    l'appelant y écrit. Le libellé est le premier enfant. */
export function bloc(parent: HTMLElement, label: string): HTMLElement {
	const sec = ajouter(parent, "section", "qbd-qz-fsec");
	const head = ajouter(sec, "div", "qbd-qz-fsec-label");
	ajouter(head, "span", undefined, label);
	return sec;
}

/* ── Sections optionnelles ────────────────────────────────── */

/** Document, leçon, ressource, indice : tout ce qui entoure la question.
    Repliées par défaut, sauf celles qui portent déjà une valeur — on ne
    cache pas à l'auteur un contenu qu'il a écrit. */
export function renderExtras(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
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
	renderHintSection(parent, q, cb, bridge);
}

/** L'indice, et ses NIVEAUX SUIVANTS (2026-09-26) : le premier niveau
    reste le champ d'avant ; « Ajouter un niveau » en pose un de plus, du
    moins au plus révélateur (src/quiz-hint.ts). Un niveau vidé n'est pas
    écrit (editor/export.ts). */
function renderHintSection(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	const suite = q._hintMore ?? [];
	const hint = section(parent, "lightbulb", t("editor.hint.label"), !!q.hint || suite.length > 0);
	ajouter(hint, "div", "qbd-qz-section-help", t("editor.hint.levelsHelp"));
	bridge.field(hint, suite.length ? t("editor.hint.level", { n: 1 }) : "", (q.hint || "").replace(/<br\s*\/?>/gi, "\n"), t("editor.hint.placeholder"), true, v => {
		q.hint = v;
		cb.onChange();
	});
	suite.forEach((valeur, i) => {
		const ligne = ajouter(hint, "div", "qbd-lecture-style-item");
		bridge.field(ligne, t("editor.hint.level", { n: i + 2 }), valeur.replace(/<br\s*\/?>/gi, "\n"), t("editor.hint.placeholderNext"), true, v => {
			suite[i] = v;
			q._hintMore = suite;
			cb.onChange();
		});
		boutonIndice(ligne, "x", t("editor.hint.removeLevel")).addEventListener("click", () => {
			suite.splice(i, 1);
			if (suite.length) q._hintMore = suite; else delete q._hintMore;
			cb.onChange();
			cb.onStructureChange();
		});
	});
	boutonIndice(hint, "plus", t("editor.hint.addLevel"), true).addEventListener("click", () => {
		q._hintMore = [...suite, ""];
		cb.onChange();
		cb.onStructureChange();
	});
}

/** Un bouton à icône, du même habillage que les listes d'une lecture
    (`qbd-lecture-style-btn`, detail-lecture-style.ts). */
function boutonIndice(parent: HTMLElement, icone: string, libelle: string, texteVisible = false): HTMLButtonElement {
	const b = ajouter(parent, "button", "qbd-lecture-style-btn");
	b.type = "button";
	b.setAttribute("aria-label", libelle);
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-lecture-style-btn-icone"), icone);
	if (texteVisible) ajouter(b, "span", undefined, libelle);
	return b;
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
		toggle.setAttribute("aria-label", t(has ? "editor.toggle.disable" : "editor.toggle.enable"));
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
    mort.
    `onToggle` : appelé à chaque bascule avec le nouvel état (« Plus » s'en
    sert pour rester ouvert d'un repeint à l'autre). */
export function section(parent: HTMLElement, icon: string, label: string, open: boolean, onToggle?: (ouvert: boolean) => void): HTMLElement {
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
		onToggle?.(collapsed);
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
