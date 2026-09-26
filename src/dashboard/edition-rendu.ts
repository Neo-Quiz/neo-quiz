import { t } from "../i18n";
import { ajouter } from "../dom";
import { renderQuizPreviewCard } from "../editor/question-preview";
import { creerChampDirect, libererChamps } from "../editor/champ-direct";
import type { ChampDirect } from "../editor/champ-direct";
import { poserBarreFormat } from "../editor/format-toolbar";
import type { DraftQuestion } from "../editor/utils";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

/* ══════════════════════════════════════════════════════════
   ÉDITER UNE QUESTION DANS SON RENDU CORRIGÉ (chantier 2026-09-26, tâche 3)

   La question s'affiche telle que l'apprenant la verra après correction
   (`renderQuizPreviewCard(…, { corrige: true })`), et chaque texte qui porte
   `data-edit` devient modifiable d'un clic : l'élément cède sa place au champ
   à aperçu en direct (editor/champ-direct.ts), qui contient le texte SOURCE
   du brouillon (markdown, `$…$`) — jamais le HTML rendu.

   Règles :
   - un seul champ ouvert à la fois ; en ouvrir un autre valide le premier ;
   - Entrée (champ court), Ctrl/Cmd+Entrée (champ long) ou perte du focus
     valide ; Échap annule ;
   - une valeur inchangée n'écrit RIEN (ni brouillon, ni `onChange`) ;
   - l'écriture suit exactement les setters du formulaire
     (dashboard/detail-question.ts, editor/editor-form.ts) : même brouillon,
     même sauvegarde différée, donc même bloc écrit dans la note.

   Les champs `*Html` pré-rendus (`_promptHtml`, `_explainHtml`) ne sont pas
   éditables ici : ils s'éditent en HTML dans « Plus » (tâche 5).
══════════════════════════════════════════════════════════ */

export interface DepsEditionRendu {
	/** Chemin de la note, pour résoudre ses `![[…]]` comme le moteur. */
	sourcePath?: string;
	/** Titre affiché quand la question n'en porte pas (« Question 3 »). */
	titreDeRepli?: string;
	/** Une donnée a changé : la sauvegarde différée existante. */
	onChange(): void;
	/** Repeindre la question (et ce que l'appelant affiche autour). */
	rendre(): void;
}

/** Ce qu'un élément `data-edit` désigne dans le brouillon. */
interface Cible { champ: string; index: number }

/** Les textes LONGS : champ multiligne, barre de mise en forme au-dessus. */
const MULTILIGNES = new Set(["prompt", "explain", "answer", "cloze"]);

/* Le champ à rouvrir après un repeint : quand un clic sur un AUTRE texte
   valide le champ ouvert, l'appelant repeint (souvent en remontant une
   nouvelle instance sur le même hôte) et l'élément cliqué n'existe plus.
   La nouvelle instance le retrouve ici, par son hôte. */
const aRouvrir = new WeakMap<HTMLElement, Cible>();

function lireCible(el: HTMLElement): Cible | null {
	const champ = el.getAttribute("data-edit");
	if (!champ) return null;
	return { champ, index: Number(el.getAttribute("data-index") ?? "0") || 0 };
}

/** Le texte SOURCE que désigne une cible — ce que le formulaire montrerait. */
function valeurSource(q: DraftQuestion, c: Cible): string {
	const de = (liste: string[] | undefined): string => (liste || [])[c.index] ?? "";
	switch (c.champ) {
		case "title": return q.title || "";
		case "prompt": return q.prompt || "";
		case "explain": return q.explain || "";
		case "answer": return q.answer || "";
		case "cloze": return q.cloze || "";
		case "option": return de(q.options);
		case "slot": return de(q.slots);
		case "possibility": return de(q.possibilities);
		case "row": return de(q.rows);
		case "choice": return de(q.choices);
		case "accepted": return de(q.acceptedAnswers);
		default: return "";
	}
}

/** Écrit `v` dans le brouillon, par les mêmes setters que le formulaire. */
function ecrire(q: DraftQuestion, c: Cible, v: string): void {
	const dans = (liste: string[]): void => { liste[c.index] = v; };
	switch (c.champ) {
		case "title":
			q.title = v;
			// Un titre SAISI est un titre d'auteur : sans ce drapeau, le prochain
			// réordonnancement le remplacerait par « Question N ».
			q._userModifiedTitle = true;
			return;
		case "prompt":
			// Même règle que renderPromptField : le texte de l'auteur fait foi,
			// le HTML pré-rendu d'un import lui cède la place.
			q.prompt = v;
			q._promptSource = true;
			q._useHtmlPrompt = false;
			delete q._promptHtml;
			return;
		case "explain":
			q.explain = v;
			delete q._explainHtml;
			return;
		case "answer": q.answer = v; return;
		case "cloze": q.cloze = v; return;
		case "option": dans(q.options ||= []); return;
		case "slot": dans(q.slots ||= []); return;
		case "possibility": dans(q.possibilities ||= []); return;
		case "row": dans(q.rows ||= []); return;
		case "choice": dans(q.choices ||= []); return;
		case "accepted": dans(q.acceptedAnswers ||= []); return;
	}
}

function selecteur(c: Cible): string {
	return `[data-edit="${c.champ}"]` + (c.champ === "title" || MULTILIGNES.has(c.champ) ? "" : `[data-index="${c.index}"]`);
}

/**
 * Rend la question `q` corrigée dans `host` et la rend éditable. Renvoie la
 * fonction de nettoyage (écouteurs retirés, champ ouvert validé sans repeint).
 */
export function monterEditionRendu(host: HTMLElement, q: DraftQuestion, deps: DepsEditionRendu): () => void {
	let vivant = true;
	let carte: HTMLElement;
	let ouvert: { cible: Cible; el: HTMLElement; champ: ChampDirect; initiale: string } | null = null;

	function peindre(): void {
		libererChamps(host);
		host.replaceChildren();
		carte = renderQuizPreviewCard(host, q, {
			fallbackTitle: deps.titreDeRepli || t("editor.render.untitled"),
			sourcePath: deps.sourcePath,
			corrige: true,
		});
		carte.classList.add("qb-er");
		carte.querySelectorAll<HTMLElement>("[data-edit]").forEach(el => {
			el.tabIndex = 0;
			el.title = t("editor.render.clickToEdit");
		});
		/* Les `*Html` : visibles, pas éditables ici — ils le disent. */
		const html: HTMLElement[] = [];
		if (q._promptHtml) html.push(...carte.querySelectorAll<HTMLElement>(".quiz-question:not([data-edit])"));
		if (q._explainHtml) html.push(...carte.querySelectorAll<HTMLElement>(".quiz-explain:not([data-edit])"));
		for (const el of html) {
			el.classList.add("qb-er-html");
			el.title = t("editor.render.htmlInMore");
		}
	}

	/** Ferme le champ ouvert. `garder` : écrire la valeur si elle a changé. */
	function fermer(garder: boolean, repeindre: boolean): void {
		const o = ouvert;
		if (!o) return;
		ouvert = null; // avant tout : le `focusout` du retrait ne revalide pas.
		const v = o.champ.valeur();
		o.champ.detruire();
		if (garder && v !== o.initiale) {
			ecrire(q, o.cible, v);
			deps.onChange();
		}
		if (!repeindre) return;
		deps.rendre();
		/* L'appelant a pu remonter une instance neuve (celle-ci est alors
		   nettoyée) ; sinon, c'est à celle-ci de retrouver le rendu. */
		if (vivant) {
			peindre();
			const suivante = aRouvrir.get(host);
			aRouvrir.delete(host);
			if (suivante) ouvrirCible(suivante);
		}
	}

	function ouvrirCible(c: Cible): void {
		const el = carte.querySelector<HTMLElement>(selecteur(c));
		if (el) ouvrir(el);
	}

	function ouvrir(el: HTMLElement): void {
		const cible = lireCible(el);
		if (!cible || ouvert?.el === el) return;
		if (ouvert) {
			// Un seul champ ouvert : l'autre est validé, puis celui-ci rouvert
			// dans le rendu repeint.
			aRouvrir.set(host, cible);
			fermer(true, true);
			return;
		}
		const multiligne = MULTILIGNES.has(cible.champ);
		const initiale = valeurSource(q, cible);

		/* MÊME encombrement : le champ prend place DANS l'élément (il garde ses
		   classes, donc sa typo et son cadre de quiz). Une zone de saisie ne
		   peut pas avoir d'enfants : un `<div>` aux mêmes classes la remplace. */
		let boite = el;
		if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
			boite = document.createElement("div");
			boite.className = el.className;
			for (const a of ["data-edit", "data-index"]) {
				const v = el.getAttribute(a);
				if (v !== null) boite.setAttribute(a, v);
			}
			el.replaceWith(boite);
		}
		boite.replaceChildren();
		boite.classList.add("is-editing");
		boite.removeAttribute("title");

		const cadre = ajouter(boite, "div", "qb-er-cadre" + (multiligne ? " qb-er-cadre--multi" : ""));
		const place = document.createElement("div");
		place.className = "qb-direct " + (multiligne ? "qb-direct--multi" : "qb-direct--ligne");
		const champ = creerChampDirect(place, {
			valeur: initiale,
			multiligne,
			placeholder: cible.champ === "title" ? deps.titreDeRepli : undefined,
			etiquette: t("editor.render.clickToEdit"),
			onChange: () => { /* lu à la validation */ },
			onEntree: () => fermer(true, true),
			onEchap: () => fermer(false, true),
			extensions: multiligne
				? [Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => { fermer(true, true); return true; } }]))]
				: [],
		});
		if (multiligne) poserBarreFormat(cadre, champ.vue, false, () => { /* l'écouteur du champ suit */ }, () => { /* hauteur automatique */ });
		cadre.appendChild(place);

		/* Perte du focus = validation, sauf vers la barre (déjà protégée par
		   son `mousedown`) et sauf quand c'est la FENÊTRE qui perd le focus :
		   changer d'application ne doit pas fermer le champ. */
		cadre.addEventListener("focusout", (e: FocusEvent) => {
			if (ouvert?.champ !== champ) return;
			if (e.relatedTarget instanceof Node && cadre.contains(e.relatedTarget)) return;
			if (!document.hasFocus()) return;
			fermer(true, true);
		});

		ouvert = { cible, el: boite, champ, initiale };
		champ.focus();
		champ.vue.dispatch({ selection: { anchor: champ.vue.state.doc.length } });
	}

	/* ── Écouteurs délégués, posés une fois sur l'hôte ── */
	const surPointeur = (e: PointerEvent): void => {
		// Un clic sur un AUTRE texte pendant qu'un champ est ouvert : la perte
		// du focus qui suit va valider et repeindre ; on note où rouvrir.
		if (!ouvert || !(e.target instanceof Element)) return;
		if (ouvert.el.contains(e.target)) return;
		const autre = e.target.closest<HTMLElement>("[data-edit]");
		const cible = autre && host.contains(autre) ? lireCible(autre) : null;
		if (cible) aRouvrir.set(host, cible);
	};
	const surClic = (e: MouseEvent): void => {
		if (!(e.target instanceof Element)) return;
		const el = e.target.closest<HTMLElement>("[data-edit]");
		if (!el || !host.contains(el) || el.classList.contains("is-editing")) return;
		e.preventDefault(); // un lien rendu dans le texte ne part pas
		ouvrir(el);
	};
	const surTouche = (e: KeyboardEvent): void => {
		if (e.key !== "Enter" && e.key !== " ") return;
		const el = e.target instanceof HTMLElement ? e.target : null;
		if (!el || !el.hasAttribute("data-edit") || el.classList.contains("is-editing")) return;
		e.preventDefault();
		ouvrir(el);
	};
	host.addEventListener("pointerdown", surPointeur, true);
	host.addEventListener("click", surClic);
	host.addEventListener("keydown", surTouche);

	peindre();
	const enAttente = aRouvrir.get(host);
	aRouvrir.delete(host);
	if (enAttente) ouvrirCible(enAttente);

	return () => {
		if (!vivant) return;
		vivant = false;
		host.removeEventListener("pointerdown", surPointeur, true);
		host.removeEventListener("click", surClic);
		host.removeEventListener("keydown", surTouche);
		// Page fermée ou repeinte ailleurs : ce qui a été tapé n'est pas perdu.
		fermer(true, false);
		libererChamps(host);
	};
}
