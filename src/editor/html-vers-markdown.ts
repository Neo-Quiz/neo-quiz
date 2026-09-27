import { rendreTexteQuiz } from "../engine/sanitizer";
import type { RenduImages } from "../engine/sanitizer";
import { sansColoration } from "../engine/code-highlight";

/* ══════════════════════════════════════════════════════════
   HTML → MARKDOWN, sans perte ou pas du tout (2026-09-26)

   Un quiz s'écrit en markdown, comme dans Discord et Obsidian : un champ
   de l'éditeur ne montre plus jamais `<p>`, `<strong>` ou `<code>`. Les
   quiz déjà écrits en HTML (`promptHtml`, `explainHtml`, `lessonHtml`, ou
   un `prompt` généré avec des balises) sont convertis à leur ouverture dans
   l'éditeur (editor/convert.ts), et l'écriture suivante enregistre le
   markdown.

   SANS PERTE, PROUVÉ À CHAQUE FOIS. La conversion n'est gardée que si le
   markdown obtenu, repassé par le VRAI rendu du quiz (`rendreTexteQuiz`,
   engine/sanitizer.ts), donne le même HTML que la source, à la
   normalisation près (espaces, `<b>` = `<strong>`, `<p>` ou ligne vide…).
   Sinon la fonction rend `null` et l'appelant garde le HTML tel quel —
   tableau à cellules fusionnées, image dimensionnée, couleur, balise
   inconnue, commentaire.

   L'ÉCHAPPEMENT. La grammaire du quiz n'a pas d'échappement par
   antislash : `C:\Users\*\AppData` doit garder ses antislashs visibles
   (`check:md`). Un texte dont les caractères seraient LUS comme du markdown
   (`*mot*`, un accent grave, une ligne qui commence par « - ») ne peut donc
   pas être protégé : la vérification le voit, et le HTML est gardé. Les
   caractères HTML (`<`, `>`, `&`), eux, redeviennent du texte et sont
   échappés par le rendu, comme tout texte.

   PUR : ni DOM, ni hôte — un analyseur strict, écrit ici, qui refuse ce
   qu'il ne sait pas lire au lieu de le deviner. `npm run check:html-markdown`.
══════════════════════════════════════════════════════════ */

interface Texte { type: "texte"; valeur: string }
interface Element { type: "el"; nom: string; attrs: Record<string, string>; enfants: Noeud[] }
type Noeud = Texte | Element;

/* ── Lecture stricte du HTML ─────────────────────────────── */

/* Les entités nommées courantes d'un texte français ou technique. Toute autre
   entité fait garder le HTML plutôt que de deviner son caractère. */
const ENTITES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
	hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", laquo: "\u00ab", raquo: "\u00bb",
	lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", middot: "\u00b7",
	eacute: "\u00e9", egrave: "\u00e8", ecirc: "\u00ea", agrave: "\u00e0", acirc: "\u00e2",
	ccedil: "\u00e7", ugrave: "\u00f9", ocirc: "\u00f4", icirc: "\u00ee", Eacute: "\u00c9",
	euro: "\u20ac", times: "\u00d7", divide: "\u00f7", deg: "\u00b0", rarr: "\u2192", larr: "\u2190",
	harr: "\u2194", rArr: "\u21d2", le: "\u2264", ge: "\u2265", ne: "\u2260", copy: "\u00a9",
};

/** Les entités décodées ; `null` sur une entité nommée inconnue (la
    garder littérale changerait ce qui s'affiche). Un `&` qui n'ouvre pas
    d'entité est du texte, comme pour le navigateur. */
function decoder(t: string): string | null {
	let ok = true;
	const out = t.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (m, e: string) => {
		if (e[0] === "#") {
			const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) { ok = false; return m; }
			return String.fromCodePoint(n);
		}
		if (!Object.prototype.hasOwnProperty.call(ENTITES, e)) { ok = false; return m; }
		return ENTITES[e];
	});
	return ok ? out : null;
}

const TITRES = ["h1", "h2", "h3", "h4", "h5", "h6"];
/** Les seules balises lues. Toute autre (`span` attribué, `div`, `u`,
    `sub`, `font`…) fait garder le HTML. */
const CONNUS = new Set(["p", "br", "strong", "b", "em", "i", "del", "s", "strike", "code", "pre", "ul", "ol", "li",
	"a", "img", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "span", ...TITRES]);
const VIDES = new Set(["br", "img"]);
/** Un bloc qui ouvre ferme le `<p>` en cours, comme dans le navigateur. */
const FERMENT_P = new Set(["p", "ul", "ol", "pre", "table", "blockquote", "li", ...TITRES]);
/** Ce que le navigateur ferme de lui-même quand un parent se ferme. */
const FERMETURE_IMPLICITE = new Set(["p", "li", "td", "th", "tr", "thead", "tbody"]);

/** La profondeur d'imbrication lue au plus (M1 de la revue du 2026-09-26 :
    5 000 `<strong>` imbriqués faisaient déborder la pile et rendaient le quiz
    entier inouvrable dans l'éditeur). */
const PROFONDEUR_MAX = 64;

const MOTIF_OUVRANTE =/^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const MOTIF_ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** L'arbre d'un fragment HTML, ou `null` s'il sort de ce que ce lecteur sait
    lire sans deviner. */
function analyser(html: string): Noeud[] | null {
	const racine: Element = { type: "el", nom: "#racine", attrs: {}, enfants: [] };
	const pile: Element[] = [racine];
	const haut = (): Element => pile[pile.length - 1];
	let texte = "";
	const vider = (): boolean => {
		if (!texte) return true;
		const d = decoder(texte);
		texte = "";
		if (d === null) return false;
		haut().enfants.push({ type: "texte", valeur: d });
		return true;
	};
	let i = 0;
	while (i < html.length) {
		if (html[i] !== "<") { texte += html[i++]; continue; }
		const reste = html.slice(i);
		if (/^<[!?]/.test(reste)) return null;
		const fin = reste.match(/^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/);
		if (fin) {
			if (!vider()) return null;
			const nom = fin[1].toLowerCase();
			let k = pile.length - 1;
			while (k > 0 && pile[k].nom !== nom) k--;
			if (k === 0) {
				// Un `</p>` sans ouvrante : le navigateur y crée un paragraphe vide.
				if (nom !== "p") return null;
				haut().enfants.push({ type: "el", nom: "p", attrs: {}, enfants: [] });
			} else {
				for (let j = pile.length - 1; j > k; j--) if (!FERMETURE_IMPLICITE.has(pile[j].nom)) return null;
				pile.length = k;
			}
			i += fin[0].length;
			continue;
		}
		const ouv = reste.match(MOTIF_OUVRANTE);
		if (ouv) {
			if (!vider()) return null;
			const nom = ouv[1].toLowerCase();
			if (!CONNUS.has(nom)) return null;
			if (ouv[3] && !VIDES.has(nom)) return null;
			const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
			for (const a of ouv[2].matchAll(MOTIF_ATTR)) {
				const v = decoder(a[2] ?? a[3] ?? a[4] ?? "");
				if (v === null) return null;
				attrs[a[1].toLowerCase()] = v;
			}
			if (FERMENT_P.has(nom)) while (haut().nom === "p") pile.pop();
			if (nom === "li" && haut().nom === "li") pile.pop();
			if ((nom === "td" || nom === "th" || nom === "tr") && (haut().nom === "td" || haut().nom === "th")) pile.pop();
			if (nom === "tr" && haut().nom === "tr") pile.pop();
			const el: Element = { type: "el", nom, attrs, enfants: [] };
			haut().enfants.push(el);
			if (!VIDES.has(nom)) pile.push(el);
			// Au-delà de cette profondeur, aucun quiz réel : le HTML est gardé,
			// avant que les lectures récursives ne débordent la pile.
			if (pile.length > PROFONDEUR_MAX) return null;
			i += ouv[0].length;
			continue;
		}
		// Un `<` suivi d'une lettre qui n'est pas une balise lisible : ambigu.
		if (/^<\/?[a-zA-Z]/.test(reste)) return null;
		texte += "<";
		i++;
	}
	if (!vider()) return null;
	return racine.enfants;
}

/* ── Écriture du markdown ────────────────────────────────── */

class Refus extends Error {}
const refuser = (): never => { throw new Refus(); };

const ALIAS: Record<string, string> = { b: "strong", i: "em", s: "del", strike: "del" };
const nomCanon = (n: string): string => ALIAS[n] ?? n;
const MARQUES: Record<string, string> = { strong: "**", em: "*", del: "~~" };
const EN_LIGNE = new Set(["strong", "em", "del", "code", "a", "img", "br", "span"]);
const URL_LIEN = /^(https?:\/\/|mailto:)[^\s()<>]+$/i;
const SRC_IMAGE = /^[^\s()<>]+$/;

/** Les attributs d'un élément, tous admis ? */
function seulement(el: Element, admis: string[]): void {
	for (const a of Object.keys(el.attrs)) if (!admis.includes(a)) refuser();
}

const blancs = (t: string): string => t.replace(/[ \t\n\r\f]+/g, " ");

/** Le texte brut d'un élément dont le contenu est littéral (code). */
function brut(noeuds: Noeud[], dansPre: boolean): string {
	return noeuds.map(n => {
		if (n.type === "texte") return n.valeur;
		if (n.nom === "br" && dansPre) { seulement(n, []); return "\n"; }
		return refuser();
	}).join("");
}

function enLigne(noeuds: Noeud[]): string {
	return noeuds.map(n => {
		if (n.type === "texte") return blancs(n.valeur);
		const nom = nomCanon(n.nom);
		if (!EN_LIGNE.has(nom)) refuser();
		switch (nom) {
			case "br": seulement(n, []); return "\n";
			case "span": seulement(n, []); return enLigne(n.enfants);
			case "code": {
				seulement(n, []);
				const c = blancs(brut(n.enfants, false));
				if (!c.trim() || c.includes("``")) refuser();
				return c.includes("`") ? "``" + c + "``" : "`" + c + "`";
			}
			case "a": {
				seulement(n, ["href", "target", "rel"]);
				const href = n.attrs.href ?? "";
				const t = enLigne(n.enfants).trim();
				if (!URL_LIEN.test(href) || !t || /[[\]\n]/.test(t)) refuser();
				return `[${t}](${href})`;
			}
			case "img": {
				const src = n.attrs.src ?? "";
				// `md2html` écrivait un `![[…]]` du vault en `<img class="qb-md-img">`.
				if (n.attrs.class === "qb-md-img") {
					seulement(n, ["src", "class"]);
					if (!src || /[\]\n]/.test(src)) refuser();
					return `![[${src}]]`;
				}
				seulement(n, ["src", "alt"]);
				const alt = n.attrs.alt ?? "";
				if (!SRC_IMAGE.test(src) || /[[\]\n]/.test(alt)) refuser();
				return `![${alt}](${src})`;
			}
			default: {
				seulement(n, []);
				const interieur = enLigne(n.enfants);
				const m = interieur.match(/^(\s*)([\s\S]*?)(\s*)$/) as RegExpMatchArray;
				return m[2] ? m[1] + MARQUES[nom] + m[2] + MARQUES[nom] + m[3] : interieur;
			}
		}
	}).join("");
}

/** Un paragraphe : l'inline, rogné, chaque ligne aussi. */
function paragraphe(noeuds: Noeud[]): string {
	return enLigne(noeuds).split("\n").map(l => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const estBlanc = (n: Noeud): boolean => n.type === "texte" && !n.valeur.replace(/[ \t\n\r\f]+/g, "");

function liste(el: Element, indent: string): string {
	const ordonnee = el.nom === "ol";
	seulement(el, ordonnee ? ["start"] : []);
	let numero = ordonnee && el.attrs.start !== undefined ? Number(el.attrs.start) : 1;
	if (!Number.isInteger(numero) || numero < 0) refuser();
	const lignes: string[] = [];
	for (const li of el.enfants) {
		// Les `<br>` et les blancs ENTRE les éléments (`md2html` en mettait) ne
		// s'affichent pas comme du texte d'élément : ignorés.
		if (estBlanc(li) || (li.type === "el" && li.nom === "br")) continue;
		if (li.type !== "el" || li.nom !== "li") return refuser();
		seulement(li, []);
		const enfants = li.enfants.filter(n => !estBlanc(n));
		const sous = enfants.length && enfants[enfants.length - 1].type === "el"
			&& ["ul", "ol"].includes((enfants[enfants.length - 1] as Element).nom)
			? enfants.pop() as Element : null;
		let contenu: Noeud[] = enfants;
		if (enfants.length === 1 && enfants[0].type === "el" && enfants[0].nom === "p") {
			seulement(enfants[0], []);
			contenu = enfants[0].enfants;
		}
		const t = paragraphe(contenu);
		if (!t || t.includes("\n")) refuser();
		const marque = ordonnee ? `${numero++}. ` : "- ";
		lignes.push(indent + marque + t);
		if (sous) lignes.push(liste(sous, indent + " ".repeat(marque.length)));
	}
	if (!lignes.length) refuser();
	return lignes.join("\n");
}

function blocCode(pre: Element): string {
	seulement(pre, []);
	const enfants = pre.enfants.filter(n => !estBlanc(n));
	let langue = "";
	let contenu: string;
	if (enfants.length === 1 && enfants[0].type === "el" && enfants[0].nom === "code") {
		const code = enfants[0];
		seulement(code, ["class"]);
		if (code.attrs.class !== undefined) {
			const m = code.attrs.class.match(/^language-([\w+#.-]+)$/);
			if (!m) refuser();
			langue = (m as RegExpMatchArray)[1];
		}
		contenu = brut(code.enfants, true);
	} else {
		contenu = brut(pre.enfants, true);
	}
	contenu = contenu.replace(/^\n+/, "").replace(/\n+$/, "");
	let cloture = "```";
	while (contenu.split("\n").some(l => /^ {0,3}(`{3,}|~{3,})/.test(l) && l.trim().startsWith(cloture))) cloture += "`";
	return cloture + langue + "\n" + (contenu ? contenu + "\n" : "") + cloture;
}

function tableau(table: Element): string {
	seulement(table, []);
	const rangees: { cellules: string[]; entete: boolean }[] = [];
	const lireRangees = (noeuds: Noeud[], dansTete: boolean): void => {
		for (const n of noeuds) {
			if (estBlanc(n)) continue;
			if (n.type !== "el") return refuser();
			if (n.nom === "thead" || n.nom === "tbody") { seulement(n, []); lireRangees(n.enfants, n.nom === "thead"); continue; }
			if (n.nom !== "tr") return refuser();
			seulement(n, []);
			const cellules: string[] = [];
			let toutesTh = true;
			for (const c of n.enfants) {
				if (estBlanc(c)) continue;
				if (c.type !== "el" || (c.nom !== "th" && c.nom !== "td")) return refuser();
				// Cellules fusionnées, alignement, style : le tableau reste en HTML.
				seulement(c, []);
				if (c.nom === "td") toutesTh = false;
				const t = paragraphe(c.enfants);
				if (t.includes("\n") || t.includes("|")) refuser();
				cellules.push(t);
			}
			rangees.push({ cellules, entete: dansTete || toutesTh });
		}
	};
	lireRangees(table.enfants, false);
	// Le markdown n'a qu'une ligne d'en-tête, obligatoire, et des lignes égales.
	if (!rangees.length || !rangees[0].entete || rangees.slice(1).some(r => r.entete)) refuser();
	const n = rangees[0].cellules.length;
	if (!n || rangees.some(r => r.cellules.length !== n)) refuser();
	const ligne = (cs: string[]): string => "| " + cs.join(" | ") + " |";
	return [ligne(rangees[0].cellules), ligne(rangees[0].cellules.map(() => "---")), ...rangees.slice(1).map(r => ligne(r.cellules))].join("\n");
}

/** Les blocs d'un conteneur (la racine, une citation), en markdown. */
function blocs(noeuds: Noeud[]): string[] {
	const sortie: string[] = [];
	let enCours: Noeud[] = [];
	const clore = (): void => {
		const t = paragraphe(enCours);
		if (t) sortie.push(t);
		enCours = [];
	};
	for (const n of noeuds) {
		if (n.type === "texte" || EN_LIGNE.has(nomCanon(n.nom))) { enCours.push(n); continue; }
		clore();
		if (n.nom === "p") { seulement(n, []); const t = paragraphe(n.enfants); if (t) sortie.push(t); continue; }
		if (TITRES.includes(n.nom)) {
			seulement(n, []);
			const t = paragraphe(n.enfants);
			if (!t || t.includes("\n")) refuser();
			sortie.push("#".repeat(Number(n.nom[1])) + " " + t);
			continue;
		}
		if (n.nom === "ul" || n.nom === "ol") { sortie.push(liste(n, "")); continue; }
		if (n.nom === "pre") { sortie.push(blocCode(n)); continue; }
		if (n.nom === "table") { sortie.push(tableau(n)); continue; }
		if (n.nom === "blockquote") {
			seulement(n, []);
			const interieur = blocs(n.enfants);
			// Une citation d'UN paragraphe : ses lignes sont rendues en inline.
			if (interieur.length !== 1) refuser();
			sortie.push(interieur[0].split("\n").map(l => "> " + l).join("\n"));
			continue;
		}
		refuser();
	}
	clore();
	return sortie;
}

/* ── La preuve : normaliser deux HTML et les comparer ─────── */

/** Séparateur de paragraphe de la forme normale : un caractère d'usage
    privé, qu'aucun texte de quiz ne contient. */
const PARA = "\uE010";
const BLOCS_CANON = "(?:ul|ol|li|pre|table|tr|th|td|h[1-6]|blockquote)";

const echapperCanon = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrCanon = (t: string): string => echapperCanon(t).replace(/"/g, "&quot;");

function attributsCanon(el: Element, nom: string): string {
	const a = el.attrs;
	if (nom === "a") return ` href="${attrCanon(a.href ?? "")}"`;
	if (nom === "ol") return a.start !== undefined && a.start !== "1" ? ` start="${attrCanon(a.start)}"` : "";
	if (nom === "code") return a.class && /^language-/.test(a.class) ? ` class="${attrCanon(a.class)}"` : "";
	return Object.keys(a).filter(k => !["class", "target", "rel"].includes(k)).sort()
		.map(k => ` ${k}="${attrCanon(a[k])}"`).join("");
}

function canon(noeuds: Noeud[], pre: boolean): string {
	let s = "";
	for (const n of noeuds) {
		if (n.type === "texte") { s += echapperCanon(pre ? n.valeur : blancs(n.valeur)); continue; }
		const nom = nomCanon(n.nom);
		// Enveloppes sans rendu propre (le rendu écrit toujours `thead`/`tbody`,
		// une source peut les omettre : la ligne `th` dit l'en-tête).
		if (nom === "span" || nom === "thead" || nom === "tbody") { s += canon(n.enfants, pre); continue; }
		if (nom === "br") { s += pre ? "\n" : "<br>"; continue; }
		if (nom === "img") {
			s += n.attrs.class === "qb-md-img"
				? echapperCanon(`![[${n.attrs.src ?? ""}]]`)
				: `<img src="${attrCanon(n.attrs.src ?? "")}" alt="${attrCanon(n.attrs.alt ?? "")}">`;
			continue;
		}
		if (nom === "p") { s += PARA + canon(n.enfants, pre) + PARA; continue; }
		if (nom === "pre") {
			let c = canon(n.enfants, true);
			if (!c.startsWith("<code")) c = "<code>" + c + "</code>";
			s += "<pre>" + c.replace(/^(<code[^>]*>)\n+/, "$1").replace(/\n+(<\/code>)$/, "$1") + "</pre>";
			continue;
		}
		s += `<${nom}${attributsCanon(n, nom)}>` + canon(n.enfants, pre) + `</${nom}>`;
	}
	return s;
}

/** La forme normale d'un HTML de quiz : ce qui s'affiche pareil s'écrit
    pareil. `null` si le lecteur strict ne le lit pas. */
function formeNormale(html: string): string | null {
	const arbre = analyser(html);
	if (!arbre) return null;
	let s = canon(arbre, false);
	const bloc = `</?${BLOCS_CANON}\\b[^>]*>`;
	s = s.replace(/(<br>\s*){2,}/g, PARA);
	for (let avant = ""; avant !== s;) {
		avant = s;
		s = s
			.replace(new RegExp(`[ \\t]*(${PARA}|<br>|${bloc})[ \\t]*`, "g"), "$1")
			.replace(new RegExp(`${PARA}{2,}`, "g"), PARA)
			.replace(new RegExp(`${PARA}(${bloc})`, "g"), "$1")
			.replace(new RegExp(`(${bloc})${PARA}`, "g"), "$1")
			.replace(new RegExp(`<br>(${PARA}|${bloc})`, "g"), "$1")
			.replace(new RegExp(`(${PARA}|${bloc})<br>`, "g"), "$1")
			.replace(/<(strong|em|del)><\/\1>/g, "")
			// Une espace au bord d'une emphase s'affiche pareil dehors.
			.replace(/ *<(strong|em|del)> +/g, " <$1>")
			.replace(/ +<\/(strong|em|del)> */g, "</$1> ");
	}
	return s.replace(new RegExp(`^[${PARA}\\s]+|[${PARA}\\s]+$`, "g"), "");
}

/** Les images, rendues sous une forme que `formeNormale` relit : un
    `![[…]]` reste le texte qu'il est dans un champ `*Html` (le moteur l'y
    remplace de la même façon des deux côtés). */
const IMAGES_CANON: RenduImages = {
	embed: spec => echapperCanon(`![[${spec}]]`),
	image: (alt, src) => `<img src="${attrCanon(src)}" alt="${attrCanon(alt)}">`,
};

/** La forme normale du HTML que le quiz rend pour `texte`, SANS coloration
    (`sansColoration`, code-highlight.ts) : cette comparaison est HORS de
    tout rendu affiché, et `canon()` déballe de toute façon tous les
    `<span>` — colorer ici ne servait à rien et coûtait tout. Le tour 3
    remettait au contraire le budget À PLEIN à chaque appel : chaque champ
    de chaque question, à l'ouverture d'une page de quiz, recolorait jusqu'à
    5 000 caractères deux fois (9 à 18 s mesurés sur un quiz partagé
    hostile, revue du 2026-09-26, tour 4). À budget nul, les deux côtés
    comparés sont rendus à l'identique et indépendamment l'un de l'autre, et
    le budget du rendu en cours est rendu intact. */
function rendreCanon(texte: string): string | null {
	return sansColoration(() => formeNormale(rendreTexteQuiz(texte, IMAGES_CANON)));
}

/** Le markdown rend-il le même HTML que `cible` (déjà normalisée) ? */
function rendMeme(markdown: string, cible: string): boolean {
	return rendreCanon(markdown) === cible;
}

/* ── Les deux entrées ────────────────────────────────────── */

/**
 * Un champ `*Html` (`promptHtml`, `explainHtml`, `lessonHtml`) en markdown ;
 * `null` quand la conversion perdrait quelque chose — l'appelant garde alors
 * le HTML.
 */
export function htmlVersMarkdown(html: string): string | null {
	return sansException(() => {
		const arbre = analyser(html);
		if (!arbre) return null;
		const md = blocs(arbre).join("\n\n");
		const cible = formeNormale(html);
		if (cible === null || !md.trim() || !rendMeme(md, cible)) return null;
		return md;
	});
}

/** Une conversion qui échoue, de QUELQUE façon que ce soit (un `Refus`, mais
    aussi une pile débordée), rend `null` : le HTML est gardé, et la page du
    quiz s'ouvre quand même. */
function sansException(f: () => string | null): string | null {
	try {
		return f();
	} catch {
		return null;
	}
}

/** Les balises qui s'ouvrent et se ferment dans un texte : autant d'ouvrantes
    que de fermantes, pour chacune. */
function balisesAppariees(texte: string, noms: readonly string[]): boolean {
	return noms.every(nom => {
		const ouvrantes = (texte.match(new RegExp(`<${nom}(\\s[^<>]*)?>`, "gi")) || []).length;
		const fermantes = (texte.match(new RegExp(`</${nom}\\s*>`, "gi")) || []).length;
		return ouvrantes === fermantes;
	});
}

const NOMS_DE_BLOC = ["p", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "thead", "tbody", "tr", "th", "td"];
const NOMS_EN_LIGNE = ["strong", "b", "em", "i", "code", "del", "s", "a"];

/** Un champ TEXTE n'est lu comme du HTML que s'il en a la FORME ENTIÈRE : il
    commence par une balise de bloc, chaque bloc ouvert est refermé
    explicitement, et aucun texte ne traîne hors des blocs. « Quelle balise
    ouvre un paragraphe : <p> ? » CITE une balise : c'est du texte, dont la
    balise est la réponse (I1 de la revue du 2026-09-26). */
function formeHtmlEntiere(texte: string): boolean {
	if (!/^\s*<(p|pre|ul|ol|h[1-6]|blockquote|table)(\s[^<>]*)?>/i.test(texte)) return false;
	if (!balisesAppariees(texte, NOMS_DE_BLOC)) return false;
	const arbre = analyser(texte);
	return !!arbre && arbre.every(n => (n.type === "texte" ? !n.valeur.trim() : NOMS_DE_BLOC.includes(n.nom)));
}

/** Des balises que ce module sait convertir, hors code inline. */
const BALISE_CONVERTIBLE = /<\/?(p|br|strong|b|em|i|del|s|code|pre|ul|ol|li|a|img|h[1-6]|blockquote|table|thead|tbody|tr|th|td)(\s[^<>]*)?\/?>/i;
const BALISE_DE_BLOC = /<(p|pre|ul|ol|li|h[1-6]|blockquote|table)(\s[^<>]*)?>/i;

/**
 * Un champ TEXTE qui contient des balises (un `prompt` généré en HTML) en
 * markdown ; `null` s'il n'y a rien à convertir ou si la conversion perdrait
 * quelque chose.
 * - Avec des balises de BLOC (`<p>`, `<ul>`, `<pre>`…), le texte EST du HTML
 *   (que le quiz affiche aujourd'hui balises comprises) : il est lu comme
 *   tel.
 * - Avec des balises INLINE seulement (`<strong>`, `<code>`, `<br>`…), que le
 *   rendu du texte interprète déjà, la conversion doit rendre EXACTEMENT ce
 *   que le quiz affiche aujourd'hui ; les sauts de ligne restent des sauts.
 */
export function texteBaliseVersMarkdown(texte: string): string | null {
	const horsCode = texte.replace(/``[^\n]+?``|`[^`\n]+`/g, "");
	if (!BALISE_CONVERTIBLE.test(horsCode)) return null;
	// Au moindre doute, rien : une balise citée reste du texte.
	if (BALISE_DE_BLOC.test(horsCode)) return formeHtmlEntiere(texte) ? htmlVersMarkdown(texte) : null;
	if (!balisesAppariees(horsCode, NOMS_EN_LIGNE)) return null;
	return sansException(() => {
		const arbre = analyser(texte.replace(/\r?\n/g, "<br>"));
		if (!arbre) return null;
		const md = blocs(arbre).join("\n\n");
		// Sans coloration, comme `rendMeme` : voir `rendreCanon`.
		const cible = rendreCanon(texte);
		if (cible === null || !md.trim() || md === texte || !rendMeme(md, cible)) return null;
		return md;
	});
}
