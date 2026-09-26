/* ══════════════════════════════════════════════════════════
   GRAMMAIRE INLINE d'un texte de quiz — UNE seule définition

   Les motifs qui décident ce qui est une formule, du code, du gras, de
   l'italique ou du barré. Deux lecteurs les partagent :
   - `inlineMarkdown` (engine/sanitizer.ts), qui en fait du HTML pour le
     rendu du quiz ;
   - `decouperInline` ci-dessous, qui en fait des POSITIONS dans le texte
     source, pour le champ à aperçu en direct de l'éditeur
     (editor/champ-direct.ts) : là, le texte reste la source, et seuls ses
     marqueurs sont masqués autour du curseur.

   Deux grammaires finiraient par diverger : un `*` pris pour de l'italique
   dans le champ et laissé tel quel dans le quiz, et l'éditeur mentirait sur
   ce que l'apprenant verra. D'où ce module, pur (ni DOM, ni hôte), que
   `check:md` éprouve des deux côtés à la fois.
══════════════════════════════════════════════════════════ */

/** Balise de mise à l'abri (maths, code) : U+0000, un caractère de contrôle
    qu'aucun texte de quiz réel ne contient. Construit par code — un NUL
    littéral dans une source TypeScript ne survit pas à un outil de
    formatage. */
export const MD_MARK = String.fromCharCode(0);

/** Pour `decouperMorceau` : un saut de ligne, et un U+0000 venu du texte. */
const SAUT_MASQUE = String.fromCharCode(0xe011);
const HORS_JETON_MASQUE = String.fromCharCode(0xfffd);

/** Formule mise à l'abri AVANT toute autre passe : `$$…$$` ou `$…$`. Un `\$`
    ÉCHAPPÉ n'ouvre pas une formule (« Prix \$5 … \$10 »). Groupe 1 : le
    caractère qui précède (à rendre tel quel), groupe 2 : la formule. */
export function motifFormule(): RegExp {
	/* Jamais à travers un jeton de mise à l'abri (`MD_MARK`) : le code passe
	   AVANT la formule, et une formule qui enjamberait un code le couperait. */
	return new RegExp("(^|[^\\\\])(\\$\\$[^" + MD_MARK + "]*?\\$\\$|\\$[^$\\n" + MD_MARK + "]+\\$)", "g");
}

/** Code en double accent grave, testé AVANT le simple : c'est la forme
    markdown d'un code qui CONTIENT un accent grave (``a ` b``). */
export function motifCodeDouble(): RegExp {
	return /``([^\n]+?)``/g;
}

export function motifCodeSimple(): RegExp {
	return /`([^`\n]+)`/g;
}

/** Une suite de QUATRE étoiles ou plus n'est pas de l'emphase : aucune
    combinaison de gras et d'italique ne s'écrit ainsi. */
export function motifEtoilesMultiples(): RegExp {
	return /\*{4,}/g;
}

/**
 * Motif d'un délimiteur markdown apparié (`**`, `*`, `~~`), avec la règle de
 * FLANC GAUCHE : le délimiteur ouvrant ne peut suivre ni une lettre, ni un
 * chiffre, ni un antislash. C'est ce qui distingue de l'emphase deux cas très
 * courants dans un quiz technique :
 *   - `3*4*5` — une multiplication, pas de l'italique ;
 *   - `C:\Users\*\AppData\*\Cache` — un chemin Windows, où `\*` est d'ailleurs
 *     la forme markdown d'une étoile littérale.
 * Le contenu, lui, doit commencer et finir collé au délimiteur (`(?=\S)` …
 * `\S`) : « 3 * 4 * 5 », espacé, n'est pas non plus de l'emphase.
 * Groupe 1 : le caractère qui précède, groupe 2 : le contenu.
 */
export function motifFlanc(delim: string): RegExp {
	// `\p{L}\p{N}` et non `0-9A-Za-zÀ-ÿ` : une multiplication écrite avec des
	// variables grecques, arabes ou chinoises (`α*β*γ`, `甲*乙*丙`) est une
	// multiplication elle aussi — la classe ASCII la rendait en italique.
	return new RegExp(
		"(^|[^\\p{L}\\p{N}\\\\" + delim.replace(/\\/g, "") + "])"
		+ delim + "(?=\\S)((?:(?!" + delim + ")[\\s\\S])*?\\S)" + delim,
		"gu",
	);
}

export type GenreEmphase = "grasItalique" | "gras" | "italique" | "barre";

/** Les emphases, dans l'ORDRE où elles s'appliquent : triple AVANT double
    avant simple, sinon les balises se croisent (<strong><em>…</strong></em>). */
export const EMPHASES: ReadonlyArray<{ genre: GenreEmphase; delim: string; long: number }> = [
	{ genre: "grasItalique", delim: "\\*\\*\\*", long: 3 },
	{ genre: "gras", delim: "\\*\\*", long: 2 },
	{ genre: "italique", delim: "\\*", long: 1 },
	{ genre: "barre", delim: "~~", long: 2 },
];

/* ── Images et liens : le découpage en MORCEAUX ─────────────────
   Avant les passes inline, le texte est coupé autour de ce qui n'est pas du
   texte : les `![[…]]` d'Obsidian (comme toujours, et avant tout le reste),
   puis les images `![alt](src)` et les liens `[texte](https://…)` du
   markdown. Un lien ne s'ouvre que sur `http(s)://` ou `mailto:` : tout
   autre schéma (`javascript:`…) n'est pas un lien et reste du texte. Une
   image ou un lien écrits DANS un code inline (`` `![a](b)` ``) restent du
   code. Les `![[…]]` gardent leur règle historique : coupés partout. */

export type Morceau =
	| { genre: "texte"; debut: number; fin: number }
	| { genre: "embed"; debut: number; fin: number; spec: string }
	| { genre: "image"; debut: number; fin: number; alt: string; src: string }
	| { genre: "lien"; debut: number; fin: number; texteDebut: number; texteFin: number; url: string };

const MOTIF_EMBED = /!\[\[([^\]]+)\]\]/g;
const MOTIF_LIEN_IMAGE = /(!?)\[([^[\]\n]*)\]\(([^\s()<>]+)\)/g;
const URL_DE_LIEN = /^(https?:\/\/|mailto:)/i;

/** Les codes inline d'un morceau (double accent grave d'abord), en zones. */
function zonesDeCode(texte: string): Array<[number, number]> {
	const zones: Array<[number, number]> = [];
	let masque = texte;
	for (const motif of [motifCodeDouble(), motifCodeSimple()]) {
		for (const m of [...masque.matchAll(motif)]) {
			const d = m.index ?? 0;
			zones.push([d, d + m[0].length]);
			masque = masque.slice(0, d) + MD_MARK.repeat(m[0].length) + masque.slice(d + m[0].length);
		}
	}
	return zones;
}

function decouperImagesEtLiens(texte: string, base: number, sortie: Morceau[]): void {
	if (!texte) return;
	const codes = zonesDeCode(texte);
	let curseur = 0;
	for (const m of texte.matchAll(MOTIF_LIEN_IMAGE)) {
		const d = m.index ?? 0;
		const f = d + m[0].length;
		if (codes.some(([a, b]) => d < b && f > a)) continue;
		const image = m[1] === "!";
		if (!image && (!m[2].trim() || !URL_DE_LIEN.test(m[3]))) continue;
		if (d > curseur) sortie.push({ genre: "texte", debut: base + curseur, fin: base + d });
		if (image) sortie.push({ genre: "image", debut: base + d, fin: base + f, alt: m[2], src: m[3] });
		else sortie.push({ genre: "lien", debut: base + d, fin: base + f, texteDebut: base + d + 1, texteFin: base + d + 1 + m[2].length, url: m[3] });
		curseur = f;
	}
	if (curseur < texte.length) sortie.push({ genre: "texte", debut: base + curseur, fin: base + texte.length });
}

/** Le texte coupé en morceaux : texte, `![[…]]`, image, lien. Les morceaux de
    texte ne sont jamais vides. */
export function decouperMorceaux(texte: string): Morceau[] {
	const sortie: Morceau[] = [];
	let debut = 0;
	for (const m of texte.matchAll(MOTIF_EMBED)) {
		const d = m.index ?? 0;
		decouperImagesEtLiens(texte.slice(debut, d), debut, sortie);
		sortie.push({ genre: "embed", debut: d, fin: d + m[0].length, spec: m[1] });
		debut = d + m[0].length;
	}
	decouperImagesEtLiens(texte.slice(debut), debut, sortie);
	return sortie;
}

/* ── Le découpage en POSITIONS ─────────────────────────────── */

export type GenreSegment = "formule" | "code" | GenreEmphase;

/** Un segment du texte SOURCE : `[debut, fin[` marqueurs compris ; `ouvre` et
    `ferme` sont les longueurs des marqueurs à chaque bout. */
export interface SegmentInline {
	genre: GenreSegment;
	debut: number;
	fin: number;
	ouvre: number;
	ferme: number;
}

/**
 * Les segments d'un texte de quiz, tels que le RENDU les verrait.
 *
 * Mêmes motifs, même ordre que `inlineMarkdown`. Là où le rendu remplace un
 * morceau par un jeton de mise à l'abri (`MD_MARK` + index + `MD_MARK`) ou par
 * une balise, on remplace ici les mêmes caractères par autant de `MD_MARK` :
 * vu des passes suivantes, c'est équivalent — ni lettre, ni chiffre en bord de
 * jeton, ni blanc, ni étoile —, et les positions restent celles du texte
 * source. Deux traits du rendu sont reproduits :
 * - les `![[…]]`, images et liens coupent le texte en morceaux traités à
 *   part (`decouperMorceaux`, `renderTextWithEmbeds`) ; le texte d'un lien
 *   est découpé comme un morceau à lui seul ;
 * - un saut de ligne y devient `<br>` AVANT les passes : il n'est donc pas un
 *   blanc pour elles, et un caractère d'usage privé le remplace ici.
 * Le HTML n'est pas interprété, sauf un `<code>…</code>` écrit à la main, dont
 * le rendu fait un code : son contenu est littéral, rien n'y est découpé.
 */
export function decouperInline(texte: string): SegmentInline[] {
	const sortie: SegmentInline[] = [];
	for (const m of decouperMorceaux(texte)) {
		if (m.genre === "texte") decouperMorceau(texte.slice(m.debut, m.fin), m.debut, sortie);
		else if (m.genre === "lien") decouperMorceau(texte.slice(m.texteDebut, m.texteFin), m.texteDebut, sortie);
	}
	sortie.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
	return sortie;
}

function decouperMorceau(source: string, base: number, sortie: SegmentInline[]): void {
	if (!source) return;
	const segs: SegmentInline[] = [];
	/* Un saut de ligne est un `<br>` pour le rendu : ni blanc, ni lettre, ni
	   jeton. Un caractère d'usage privé le tient ici — pas `MD_MARK`, que la
	   formule refuse de traverser alors qu'elle traverse un `<br>`. Un U+0000
	   du texte est remplacé comme au rendu (`HORS_JETON`, sanitizer.ts). */
	let masque = source.replace(/\n/g, SAUT_MASQUE).split(MD_MARK).join(HORS_JETON_MASQUE);
	const couvrir = (d: number, f: number): void => {
		masque = masque.slice(0, d) + MD_MARK.repeat(f - d) + masque.slice(f);
	};

	// 1. Un `<code>` écrit à la main (le rendu le restaure en balise).
	for (const m of [...masque.matchAll(/<code>[\s\S]*?<\/code>/gi)]) {
		const d = m.index ?? 0;
		couvrir(d, d + m[0].length);
	}

	// 2. Le code, double accent grave avant le simple — AVANT la formule,
	//    comme au rendu : `` `a $x$ b` `` est un code, sans formule.
	for (const [motif, l] of [[motifCodeDouble, 2], [motifCodeSimple, 1]] as const) {
		for (const m of [...masque.matchAll(motif())]) {
			const d = m.index ?? 0;
			const f = d + m[0].length;
			segs.push({ genre: "code", debut: d, fin: f, ouvre: l, ferme: l });
			couvrir(d, f);
		}
	}

	// 3. Les formules, qui ne traversent aucun code déjà couvert.
	for (const m of [...masque.matchAll(motifFormule())]) {
		const d = (m.index ?? 0) + m[1].length;
		const f = (m.index ?? 0) + m[0].length;
		const l = m[2].startsWith("$$") ? 2 : 1;
		segs.push({ genre: "formule", debut: d, fin: f, ouvre: l, ferme: l });
		couvrir(d, f);
	}

	// 4. Quatre étoiles et plus : littérales.
	for (const m of [...masque.matchAll(motifEtoilesMultiples())]) {
		const d = m.index ?? 0;
		couvrir(d, d + m[0].length);
	}

	/* 5. Les emphases. Le rendu remplace les MARQUEURS par des balises et
	   laisse le contenu aux passes suivantes (`**fort *italique* ici**`) : on
	   ne couvre donc que les marqueurs. */
	for (const { genre, delim, long } of EMPHASES) {
		for (const m of [...masque.matchAll(motifFlanc(delim))]) {
			const d = (m.index ?? 0) + m[1].length;
			const f = (m.index ?? 0) + m[0].length;
			segs.push({ genre, debut: d, fin: f, ouvre: long, ferme: long });
			couvrir(d, d + long);
			couvrir(f - long, f);
		}
	}

	for (const s of segs) sortie.push({ ...s, debut: s.debut + base, fin: s.fin + base });
	sortie.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
}
