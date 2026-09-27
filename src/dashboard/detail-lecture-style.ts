import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DraftQuestion } from "../editor/utils";
import { lireLecture, STYLES_LECTURE } from "../lecture-style";
import type { StyleLecture } from "../lecture-style";
import { createSelect } from "./ui-select";
import { bloc } from "./detail-question";
import type { EditCallbacks } from "./detail-question";
import type { FormBridge } from "./detail-form-bridge";

/* ══════════════════════════════════════════════════════════
   LE STYLE DE LECTURE D'UN COURS, DANS « PLUS » (2026-09-26)

   Spec : docs/superpowers/specs/2026-09-26-styles-de-lecture-design.md §5.
   Une section de « Plus » (detail-edition.ts), pour l'élément `read` que
   l'on édite : la lecture elle-même, ou le cours de l'étape affiché
   au-dessus de la question. « Plus » plutôt qu'à côté du cours : c'est là
   que vivent déjà les champs qui ne se cliquent pas dans le rendu, et le
   cours rendu reste une page à lire, sans contrôle posé dessus.

   - un sélecteur de style (`ui-select` : Page, Étapes, Tableau) ;
   - selon le style, la liste des étapes, ou les en-têtes et les lignes du
     tableau (cases séparées par « | ») ;
   - « À retenir » : Aucun, Cartes à retourner, Récapitulatif coché, et
     leur liste.

   Les quatre champs sont des CLÉS DU FORMAT (`lecture`, `etapes`,
   `tableau`, `retenir`), jamais traduites, écrites dans `_extraFields` :
   c'est par là qu'editor/convert.ts les lit et qu'editor/export.ts les
   réécrit, à l'identique. La lecture de ce qui est écrit passe par
   `lireLecture` (src/lecture-style.ts), la même que le moteur.
══════════════════════════════════════════════════════════ */

const LIBELLES_STYLE: Record<StyleLecture, TransKey> = {
	page: "editor.lecture.stylePage",
	etapes: "editor.lecture.styleEtapes",
	tableau: "editor.lecture.styleTableau",
};

type FormeChoisie = "aucun" | "cartes" | "recap";

/** Une ligne de tableau écrite « a | b | c » → ses cases. */
function cases(ligne: string): string[] {
	return ligne.split("|").map(c => c.trim());
}

/**
 * La section « Style de lecture » de `cible` (un élément `read`).
 * `onListeChange` : le style décide si la lecture est un écran à part ou
 * un cours au-dessus des questions (src/lecture-etape.ts) — la liste de
 * gauche et le panneau changent avec lui.
 */
export function renderStyleLecture(box: HTMLElement, cible: DraftQuestion, cb: EditCallbacks, bridge: FormBridge, onListeChange: () => void): void {
	const extras = (cible._extraFields ||= {});
	const l = lireLecture(extras);
	const sec = bloc(box, t("editor.lecture.section"));
	sec.classList.add("qbd-lecture-style");
	ajouter(sec, "div", "qbd-qz-section-help", t("editor.lecture.help"));

	// ── Le style ──
	const ligneStyle = ajouter(sec, "div", "qbd-lecture-style-ligne");
	ajouter(ligneStyle, "span", "qbd-lecture-style-nom", t("editor.lecture.style"));
	const style = createSelect(ligneStyle, {
		value: l.style,
		options: STYLES_LECTURE.map(s => ({ value: s, label: t(LIBELLES_STYLE[s]) })),
		onChange: (v) => {
			const s = STYLES_LECTURE.find(x => x === v);
			if (!s || s === lireLecture(extras).style) return;
			extras.lecture = s;
			cb.onChange();
			onListeChange();
		},
	});
	style.el.setAttribute("aria-label", t("editor.lecture.style"));

	if (l.style === "etapes") {
		/* MÉTHODE (`methode: true`, clé du format) : des étapes à appliquer
		   sur la question qui suit, lues au-dessus d'elle même longues
		   (src/lecture-etape.ts `estLectureCourte`). Un interrupteur : la
		   case native, annoncée comme telle. */
		const ligneMethode = ajouter(sec, "label", "qbd-lecture-style-ligne qbd-lecture-style-methode");
		const caseMethode = ajouter(ligneMethode, "input");
		caseMethode.type = "checkbox";
		caseMethode.setAttribute("role", "switch");
		caseMethode.checked = extras.methode === true;
		ajouter(ligneMethode, "span", undefined, t("editor.lecture.methode"));
		caseMethode.addEventListener("change", () => {
			if (caseMethode.checked) extras.methode = true; else delete extras.methode;
			cb.onChange();
			// Au-dessus de la question ou écran à part : la liste change.
			onListeChange();
		});
		ajouter(sec, "div", "qbd-qz-section-help", t("editor.lecture.methodeHelp"));
		listeTextes(sec, t("editor.lecture.etapes"), l.etapes, t("editor.lecture.etapePlaceholder"), bridge, cb,
			items => { if (items.length) extras.etapes = items; else delete extras.etapes; });
	}

	if (l.style === "tableau") {
		const tab = l.tableau ?? { colonnes: [], lignes: [] };
		const ecrireTableau = (colonnes: string[], lignes: string[][]): void => {
			if (!colonnes.some(c => c) && !lignes.length) delete extras.tableau;
			else extras.tableau = { colonnes, lignes };
		};
		let colonnes = tab.colonnes;
		let lignes = tab.lignes;
		bridge.field(sec, t("editor.lecture.colonnes"), colonnes.join(" | "), t("editor.lecture.colonnesPlaceholder"), false, v => {
			colonnes = v.trim() ? cases(v) : [];
			ecrireTableau(colonnes, lignes);
			cb.onChange();
		});
		listeTextes(sec, t("editor.lecture.lignes"), lignes.map(r => r.join(" | ")), t("editor.lecture.lignePlaceholder"), bridge, cb, items => {
			lignes = items.map(cases);
			ecrireTableau(colonnes, lignes);
		});
	}

	// ── « À retenir » ──
	const forme: FormeChoisie = l.retenir?.forme ?? "aucun";
	const ligneRetenir = ajouter(sec, "div", "qbd-lecture-style-ligne");
	ajouter(ligneRetenir, "span", "qbd-lecture-style-nom", t("editor.lecture.retenir"));
	const choix = createSelect(ligneRetenir, {
		value: forme,
		options: [
			{ value: "aucun", label: t("editor.lecture.retenirAucun") },
			{ value: "cartes", label: t("editor.lecture.retenirCartes") },
			{ value: "recap", label: t("editor.lecture.retenirRecap") },
		],
		onChange: (v) => {
			if (v === forme) return;
			const avant = lireLecture(extras).retenir;
			if (v === "aucun") delete extras.retenir;
			else if (v === "cartes") {
				/* Les points d'un récapitulatif deviennent des rectos : rien de
				   ce qui était écrit ne se perd au changement de forme. */
				const items = avant?.forme === "recap" ? avant.items.map(s => ({ recto: s, verso: "" })) : [{ recto: "", verso: "" }];
				extras.retenir = { forme: "cartes", items };
			} else if (v === "recap") {
				const items = avant?.forme === "cartes" ? avant.items.map(c => `${c.recto} : ${c.verso}`) : [""];
				extras.retenir = { forme: "recap", items };
			}
			cb.onChange();
			cb.onStructureChange();
		},
	});
	choix.el.setAttribute("aria-label", t("editor.lecture.retenir"));

	/* Les éléments tels qu'ÉCRITS (vides compris, pour pouvoir en taper un
	   nouveau) : `lireLecture` écarte les vides, l'éditeur ne doit pas. */
	const brut = extras.retenir as { forme?: unknown; items?: unknown } | undefined;
	const itemsBruts = Array.isArray(brut?.items) ? brut.items : [];
	if (forme === "recap") {
		listeTextes(sec, "", itemsBruts.map(s => typeof s === "string" ? s : ""), t("editor.lecture.pointPlaceholder"), bridge, cb,
			items => { extras.retenir = { forme: "recap", items }; }, true);
	}
	if (forme === "cartes") {
		listeCartes(sec, itemsBruts.map(c => {
			const o = c && typeof c === "object" ? c as { recto?: unknown; verso?: unknown } : {};
			return { recto: typeof o.recto === "string" ? o.recto : "", verso: typeof o.verso === "string" ? o.verso : "" };
		}), bridge, cb, items => { extras.retenir = { forme: "cartes", items }; });
	}
}

/** Un bouton d'icône Lucide, libellé pour le lecteur d'écran. */
function boutonIcone(parent: HTMLElement, icone: string, libelle: string, texteVisible = false): HTMLButtonElement {
	const b = ajouter(parent, "button", "qbd-lecture-style-btn");
	b.type = "button";
	b.setAttribute("aria-label", libelle);
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-lecture-style-btn-icone"), icone);
	if (texteVisible) ajouter(b, "span", undefined, libelle);
	return b;
}

/**
 * Une liste de textes éditable : un champ par élément, un bouton pour le
 * retirer, un pour en ajouter. Une frappe écrit la liste (`ecrire`) sans
 * repeindre ; ajouter ou retirer repeint le panneau.
 * `gardeVides` : écrire aussi les éléments vides (un point de
 * récapitulatif qu'on vient d'ajouter) ; sinon ils sont omis à l'écriture.
 */
function listeTextes(parent: HTMLElement, titre: string, depart: string[], placeholder: string, bridge: FormBridge, cb: EditCallbacks, ecrire: (items: string[]) => void, gardeVides = false): void {
	const items = depart.length ? [...depart] : [""];
	const liste = ajouter(parent, "div", "qbd-lecture-style-liste");
	if (titre) ajouter(liste, "div", "qbd-lecture-style-titre", titre);
	const propres = (): string[] => gardeVides ? [...items] : items.filter(s => s.trim() !== "");
	items.forEach((valeur, i) => {
		const ligne = ajouter(liste, "div", "qbd-lecture-style-item");
		bridge.field(ligne, "", valeur, placeholder, false, v => {
			items[i] = v;
			ecrire(propres());
			cb.onChange();
		});
		boutonIcone(ligne, "x", t("editor.lecture.retirer")).addEventListener("click", () => {
			items.splice(i, 1);
			ecrire(propres());
			cb.onChange();
			cb.onStructureChange();
		});
	});
	boutonIcone(liste, "plus", t("editor.lecture.ajouter"), true).addEventListener("click", () => {
		items.push("");
		ecrire(gardeVides ? [...items] : [...propres(), ""]);
		cb.onChange();
		cb.onStructureChange();
	});
}

/** La liste des cartes à retourner : recto et verso par carte. */
function listeCartes(parent: HTMLElement, depart: { recto: string; verso: string }[], bridge: FormBridge, cb: EditCallbacks, ecrire: (items: { recto: string; verso: string }[]) => void): void {
	const items = depart.length ? depart.map(c => ({ ...c })) : [{ recto: "", verso: "" }];
	const liste = ajouter(parent, "div", "qbd-lecture-style-liste");
	items.forEach((carte, i) => {
		const ligne = ajouter(liste, "div", "qbd-lecture-style-item is-carte");
		bridge.field(ligne, t("editor.lecture.recto"), carte.recto, "", false, v => { carte.recto = v; ecrire(items); cb.onChange(); });
		bridge.field(ligne, t("editor.lecture.verso"), carte.verso, "", false, v => { carte.verso = v; ecrire(items); cb.onChange(); });
		boutonIcone(ligne, "x", t("editor.lecture.retirer")).addEventListener("click", () => {
			items.splice(i, 1);
			ecrire(items);
			cb.onChange();
			cb.onStructureChange();
		});
	});
	boutonIcone(liste, "plus", t("editor.lecture.ajouter"), true).addEventListener("click", () => {
		items.push({ recto: "", verso: "" });
		ecrire(items);
		cb.onChange();
		cb.onStructureChange();
	});
}
