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

/** Formule mise à l'abri AVANT toute autre passe : `$$…$$` ou `$…$`. Un `\$`
    ÉCHAPPÉ n'ouvre pas une formule (« Prix \$5 … \$10 »). Groupe 1 : le
    caractère qui précède (à rendre tel quel), groupe 2 : la formule. */
export function motifFormule(): RegExp {
	return /(^|[^\\])(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
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
 * - les `![[…]]` coupent le texte en morceaux traités à part
 *   (`renderTextWithEmbeds`) ;
 * - un saut de ligne y devient `<br>` AVANT les passes : il n'est donc pas un
 *   blanc pour elles, et un `MD_MARK` le remplace ici.
 * Le HTML n'est pas interprété, sauf un `<code>…</code>` écrit à la main, dont
 * le rendu fait un code : son contenu est littéral, rien n'y est découpé.
 */
export function decouperInline(texte: string): SegmentInline[] {
	const sortie: SegmentInline[] = [];
	const embed = /!\[\[[^\]]+\]\]/g;
	let debut = 0;
	for (let m = embed.exec(texte); m; m = embed.exec(texte)) {
		decouperMorceau(texte.slice(debut, m.index), debut, sortie);
		debut = m.index + m[0].length;
	}
	decouperMorceau(texte.slice(debut), debut, sortie);
	return sortie;
}

function decouperMorceau(source: string, base: number, sortie: SegmentInline[]): void {
	if (!source) return;
	const segs: SegmentInline[] = [];
	let masque = source.replace(/\n/g, MD_MARK);
	const couvrir = (d: number, f: number): void => {
		masque = masque.slice(0, d) + MD_MARK.repeat(f - d) + masque.slice(f);
	};
	/* Un code mis à l'abri AVALE ce qui a été reconnu avant lui en son sein :
	   `` `a $x$ b` `` est rendu `<code>a $x$ b</code>`, et une formule dans un
	   code n'est jamais rendue. */
	const avaler = (d: number, f: number): void => {
		for (let i = segs.length - 1; i >= 0; i--) {
			if (segs[i].debut >= d && segs[i].fin <= f) segs.splice(i, 1);
		}
	};

	// 1. Les formules, sur le texte d'origine (première passe du rendu).
	for (const m of [...masque.matchAll(motifFormule())]) {
		const d = (m.index ?? 0) + m[1].length;
		const f = (m.index ?? 0) + m[0].length;
		const l = m[2].startsWith("$$") ? 2 : 1;
		segs.push({ genre: "formule", debut: d, fin: f, ouvre: l, ferme: l });
		couvrir(d, f);
	}

	// 2. Un `<code>` écrit à la main (le rendu le restaure en balise).
	for (const m of [...masque.matchAll(/<code>[\s\S]*?<\/code>/gi)]) {
		const d = m.index ?? 0;
		avaler(d, d + m[0].length);
		couvrir(d, d + m[0].length);
	}

	// 3. Le code, double accent grave avant le simple.
	for (const [motif, l] of [[motifCodeDouble, 2], [motifCodeSimple, 1]] as const) {
		for (const m of [...masque.matchAll(motif())]) {
			const d = m.index ?? 0;
			const f = d + m[0].length;
			avaler(d, f);
			segs.push({ genre: "code", debut: d, fin: f, ouvre: l, ferme: l });
			couvrir(d, f);
		}
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
