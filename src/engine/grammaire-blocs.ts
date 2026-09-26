/* ══════════════════════════════════════════════════════════
   GRAMMAIRE DES BLOCS d'un texte de quiz — UNE seule définition

   Le pendant de `grammaire-inline.ts` pour ce qui tient sur PLUSIEURS
   lignes : paragraphes séparés par une ligne vide, listes à puces et
   numérotées, blocs de code ```…```, tableaux `| a | b |`, titres `#`,
   citations `>`. Demande du 2026-09-26 : tout texte d'un quiz s'écrit en
   markdown, comme dans Discord et Obsidian, et plus jamais en HTML.

   Deux lecteurs la partagent, comme pour l'inline :
   - `rendreBlocs` ci-dessous, appelé par le rendu du quiz
     (engine/sanitizer.ts `rendreTexteQuiz`) ;
   - `decouperBlocs`, dont le champ à aperçu en direct de l'éditeur
     (editor/champ-direct-deco.ts) tire des POSITIONS dans le texte source.

   LA RÈGLE DE COMPATIBILITÉ. Un texte d'une seule ligne, ou d'un seul
   paragraphe (aucune ligne vide intérieure, aucune liste, aucun bloc de
   code, aucun tableau…), n'a PAS de blocs : `rendreBlocs` rend `null` et
   l'appelant garde le rendu d'avant, octet pour octet (sauts de ligne en
   `<br>`). La preuve d'équivalence de la grammaire inline (200 000 entrées)
   reste donc vraie pour tous ces textes — l'immense majorité d'un quiz.

   PUR : ni DOM, ni hôte. L'échappement et le rendu inline sont PASSÉS par
   l'appelant, pour qu'il n'en existe qu'une définition (engine/sanitizer.ts) :
   tout contenu de bloc passe par eux, le code d'un bloc est échappé tel quel,
   et les seules balises écrites ici sont les nôtres.
══════════════════════════════════════════════════════════ */

import { motifCodeDouble, motifCodeSimple } from "./grammaire-inline";

/** Un intervalle `[debut, fin[` du texte source. */
export interface Zone { debut: number; fin: number }

export type Alignement = "left" | "center" | "right" | null;

export interface ItemListe {
	debut: number;
	fin: number;
	/** Largeur de l'indentation (tabulation = 2) : elle fait le niveau. */
	indent: number;
	ordonne: boolean;
	/** Le numéro écrit (listes numérotées), 0 pour une puce. */
	numero: number;
	/** Le marqueur et l'espace qui le suit (`- `, `12. `), indentation exclue. */
	marqueur: Zone;
	/** Le texte de l'élément, rendu en inline. */
	zone: Zone;
}

export type Bloc =
	| { genre: "paragraphe"; debut: number; fin: number; zone: Zone }
	| { genre: "titre"; debut: number; fin: number; niveau: number; marqueur: Zone; zone: Zone }
	| { genre: "citation"; debut: number; fin: number; lignes: { marqueur: Zone; zone: Zone }[] }
	| { genre: "liste"; debut: number; fin: number; items: ItemListe[] }
	| { genre: "code"; debut: number; fin: number; langue: string; ouverture: Zone; contenu: Zone | null; fermeture: Zone | null }
	| { genre: "tableau"; debut: number; fin: number; entete: Zone[]; separateur: Zone; alignements: Alignement[]; rangees: Zone[][] };

interface Ligne { debut: number; fin: number; texte: string }

/* Les motifs de début de bloc. Chacun exige ce qui le distingue d'une
   phrase ordinaire : l'espace après `-`, `#` ou le numéro (« -5 °C », « #1 »
   restent du texte), trois accents graves SEULS sur leur ligne avec au plus
   un mot de langage (« ```a``` » reste du code inline). */
const MOTIF_CLOTURE = /^( {0,3})(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const MOTIF_TITRE = /^( {0,3})(#{1,6})[ \t]+(?=\S)/;
const MOTIF_CITATION = /^( {0,3})>[ \t]?/;
const MOTIF_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(?=\S)/;

function lignesDe(texte: string): Ligne[] {
	const out: Ligne[] = [];
	let debut = 0;
	for (;;) {
		const nl = texte.indexOf("\n", debut);
		const fin = nl < 0 ? texte.length : nl;
		out.push({ debut, fin, texte: texte.slice(debut, fin) });
		if (nl < 0) return out;
		debut = nl + 1;
	}
}

const vide = (l: Ligne): boolean => l.texte.trim() === "";

/** Les cellules d'une ligne de tableau, en zones. Le `|` d'un code inline
    (`` `a || b` ``) n'est pas un séparateur : un tableau de syntaxe en porte
    souvent. Les bords `|` facultatifs sont retirés, chaque cellule rognée. */
function cellules(l: Ligne): Zone[] {
	const t = l.texte;
	const bornes: number[] = [];
	for (let i = 0; i < t.length; i++) {
		if (t[i] === "`") {
			let n = 1;
			while (t[i + n] === "`") n++;
			const ferme = t.indexOf("`".repeat(n), i + n);
			if (ferme >= 0) { i = ferme + n - 1; continue; }
			i += n - 1;
			continue;
		}
		/* Une formule non plus : `$|x|$`, `P(A|B)` ou `\{x | x > 0\}` dans une
		   cellule sont des maths, pas trois cellules (I3, revue du 2026-09-26).
		   `$$…$$`, ou `$…$` collé à son contenu des deux côtés (l'heuristique
		   d'Obsidian, celle de engine/mathjax.ts) : « | 5$ | 10$ | » reste deux
		   prix dans deux cellules. Un `\$` n'ouvre rien. */
		if (t[i] === "$" && t[i - 1] !== "\\") {
			if (t[i + 1] === "$") {
				const fin = t.indexOf("$$", i + 2);
				if (fin > i + 2) { i = fin + 1; continue; }
			} else if (t[i + 1] && !/\s/.test(t[i + 1])) {
				const fin = t.indexOf("$", i + 1);
				if (fin > i + 1 && !/\s/.test(t[fin - 1])) { i = fin; continue; }
			}
		}
		// `\|` est une barre LITTÉRALE (GFM), rendue « | » dans sa cellule.
		if (t[i] === "\\" && t[i + 1] === "|") { i++; continue; }
		if (t[i] === "|") bornes.push(i);
	}
	let d = 0;
	let f = t.length;
	while (d < f && /\s/.test(t[d])) d++;
	while (f > d && /\s/.test(t[f - 1])) f--;
	const internes = bornes.filter(b => b >= d && b < f);
	if (internes[0] === d) { d++; internes.shift(); }
	if (internes.length && internes[internes.length - 1] === f - 1) { f--; internes.pop(); }
	const zones: Zone[] = [];
	let a = d;
	for (const b of [...internes, f]) {
		let x = a;
		let y = b;
		while (x < y && /\s/.test(t[x])) x++;
		while (y > x && /\s/.test(t[y - 1])) y--;
		zones.push({ debut: l.debut + x, fin: l.debut + y });
		a = b + 1;
	}
	return zones;
}

function alignements(l: Ligne): Alignement[] | null {
	if (!l.texte.includes("|")) return null;
	const out: Alignement[] = [];
	for (const z of cellules(l)) {
		const c = l.texte.slice(z.debut - l.debut, z.fin - l.debut);
		if (!/^:?-+:?$/.test(c)) return null;
		const g = c.startsWith(":");
		const dr = c.endsWith(":");
		out.push(g && dr ? "center" : dr ? "right" : g ? "left" : null);
	}
	return out;
}

function debutTableau(lignes: Ligne[], i: number): Alignement[] | null {
	const l = lignes[i];
	if (!l.texte.includes("|") || i + 1 >= lignes.length) return null;
	const al = alignements(lignes[i + 1]);
	if (!al || al.length !== cellules(l).length) return null;
	return al;
}

/** Cette ligne ouvre-t-elle un bloc qui interrompt un paragraphe ? */
function ouvreUnBloc(lignes: Ligne[], i: number): boolean {
	const t = lignes[i].texte;
	return MOTIF_CLOTURE.test(t) || MOTIF_TITRE.test(t) || MOTIF_CITATION.test(t)
		|| MOTIF_ITEM.test(t) || debutTableau(lignes, i) !== null;
}

/** Nombre de `$$` d'un texte : impair, une formule de bloc est encore
    ouverte, et ses lignes (même vides) appartiennent au paragraphe. */
const doublesDollars = (t: string): number =>
	// Un `$$` DANS un code inline (`` `$$` `` de bash) n'ouvre rien : le
	// compter figeait tout le texte en un paragraphe (M4, revue du 2026-09-26).
	(t.replace(motifCodeDouble(), "").replace(motifCodeSimple(), "").match(/\$\$/g) || []).length;

/**
 * Les blocs d'un texte de quiz, dans l'ordre, avec leurs positions. Les
 * lignes vides ne sont d'aucun bloc.
 */
export function decouperBlocs(texte: string): Bloc[] {
	/* Une seule ligne n'est jamais qu'un paragraphe : « > écrase », « + public,
	   - privé » ou « 2. Réponse » écrits sur une ligne restent du texte, comme
	   avant les blocs (règle de compatibilité). */
	if (!texte.includes("\n")) {
		return texte.trim() ? [{ genre: "paragraphe", debut: 0, fin: texte.length, zone: { debut: 0, fin: texte.length } }] : [];
	}
	const lignes = lignesDe(texte);
	const blocs: Bloc[] = [];
	let i = 0;
	while (i < lignes.length) {
		const l = lignes[i];
		if (vide(l)) { i++; continue; }

		// Bloc de code : littéral jusqu'à une clôture de même caractère, au
		// moins aussi longue (ou jusqu'à la fin du texte).
		const cl = l.texte.match(MOTIF_CLOTURE);
		if (cl) {
			const marque = cl[2];
			let j = i + 1;
			const ferme = (t: string): boolean => {
				const m = t.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
				return !!m && m[1][0] === marque[0] && m[1].length >= marque.length;
			};
			while (j < lignes.length && !ferme(lignes[j].texte)) j++;
			const dernier = j < lignes.length ? j : lignes.length - 1;
			// `j` vaut `lignes.length` pour un bloc jamais refermé : son contenu
			// court alors jusqu'à la dernière ligne.
			const contenu = j > i + 1 ? { debut: lignes[i + 1].debut, fin: lignes[j - 1].fin } : null;
			blocs.push({
				genre: "code", debut: l.debut, fin: lignes[dernier].fin, langue: cl[3],
				ouverture: { debut: l.debut, fin: l.fin }, contenu,
				fermeture: j < lignes.length ? { debut: lignes[j].debut, fin: lignes[j].fin } : null,
			});
			i = j + 1;
			continue;
		}

		const ti = l.texte.match(MOTIF_TITRE);
		if (ti) {
			const d = l.debut + ti[1].length;
			const fz = l.debut + l.texte.replace(/\s+$/, "").length;
			blocs.push({
				genre: "titre", debut: l.debut, fin: l.fin, niveau: ti[2].length,
				marqueur: { debut: d, fin: l.debut + ti[0].length }, zone: { debut: l.debut + ti[0].length, fin: fz },
			});
			i++;
			continue;
		}

		if (MOTIF_CITATION.test(l.texte)) {
			const lignesCit: { marqueur: Zone; zone: Zone }[] = [];
			const d = l.debut;
			let fin = l.fin;
			while (i < lignes.length) {
				const m = lignes[i].texte.match(MOTIF_CITATION);
				if (!m) break;
				const x = lignes[i];
				lignesCit.push({
					marqueur: { debut: x.debut + m[1].length, fin: x.debut + m[0].length },
					zone: { debut: x.debut + m[0].length, fin: x.fin },
				});
				fin = x.fin;
				i++;
			}
			blocs.push({ genre: "citation", debut: d, fin, lignes: lignesCit });
			continue;
		}

		const al = debutTableau(lignes, i);
		if (al) {
			const entete = cellules(l);
			const rangees: Zone[][] = [];
			let j = i + 2;
			while (j < lignes.length && !vide(lignes[j]) && lignes[j].texte.includes("|")) {
				// Une rangée plus longue que l'en-tête ne perd rien : le tableau
				// s'élargit au rendu (`rendreBlocs`).
				rangees.push(cellules(lignes[j]));
				j++;
			}
			blocs.push({
				genre: "tableau", debut: l.debut, fin: lignes[j - 1].fin, entete,
				separateur: { debut: lignes[i + 1].debut, fin: lignes[i + 1].fin }, alignements: al, rangees,
			});
			i = j;
			continue;
		}

		if (MOTIF_ITEM.test(l.texte)) {
			const items: ItemListe[] = [];
			while (i < lignes.length) {
				const x = lignes[i];
				const m = x.texte.match(MOTIF_ITEM);
				if (!m) break;
				const numero = /\d/.test(m[2]) ? parseInt(m[2], 10) : 0;
				items.push({
					debut: x.debut, fin: x.fin,
					indent: m[1].replace(/\t/g, "  ").length,
					ordonne: numero > 0 || /\d/.test(m[2]), numero,
					marqueur: { debut: x.debut + m[1].length, fin: x.debut + m[0].length },
					zone: { debut: x.debut + m[0].length, fin: x.debut + x.texte.replace(/\s+$/, "").length },
				});
				i++;
			}
			blocs.push({ genre: "liste", debut: items[0].debut, fin: items[items.length - 1].fin, items });
			continue;
		}

		// Paragraphe : jusqu'à une ligne vide ou l'ouverture d'un autre bloc —
		// sauf dans une formule `$$…$$` encore ouverte.
		const d = l.debut;
		let fin = l.fin;
		let dollars = doublesDollars(l.texte);
		i++;
		while (i < lignes.length) {
			const x = lignes[i];
			if (dollars % 2 === 0 && (vide(x) || ouvreUnBloc(lignes, i))) break;
			dollars += doublesDollars(x.texte);
			fin = x.fin;
			i++;
		}
		blocs.push({ genre: "paragraphe", debut: d, fin, zone: { debut: d, fin } });
	}
	return blocs;
}

/** Un texte à blocs, ou un texte « simple » que l'appelant rend comme avant ? */
export function aDesBlocs(blocs: readonly Bloc[]): boolean {
	return !(blocs.length === 0 || (blocs.length === 1 && blocs[0].genre === "paragraphe"));
}

/* ── Le rendu HTML ─────────────────────────────────────────── */

export interface OutilsRendu {
	/** Un morceau de texte, en HTML inline (échappé d'abord). Les sauts de
	    ligne y deviennent `<br>`. */
	inline(morceau: string): string;
	/** Échappement du texte littéral (le contenu d'un bloc de code). */
	echapper(texte: string): string;
	/** Coloration syntaxique d'un bloc de code (engine/code-highlight.ts),
	    ou `null` si l'appelant n'en fournit pas — le bloc reste alors du
	    texte échappé nu, comme avant. La fonction elle-même retombe sur
	    `null` pour un langage inconnu ou toute erreur de tokenisation. */
	colorerCode?(code: string, langue: string): string | null;
}

function rendreListe(texte: string, items: ItemListe[], o: OutilsRendu): string {
	let html = "";
	const pile: { indent: number; ordonne: boolean }[] = [];
	const fermer = (): void => { html += pile.pop()?.ordonne ? "</li></ol>" : "</li></ul>"; };
	for (const it of items) {
		while (pile.length > 0 && it.indent < pile[pile.length - 1].indent) fermer();
		const sommet = pile[pile.length - 1];
		if (!sommet || it.indent > sommet.indent) {
			const debut = it.ordonne && it.numero !== 1 ? ` start="${it.numero}"` : "";
			html += it.ordonne ? `<ol class="quiz-md-liste"${debut}>` : `<ul class="quiz-md-liste">`;
			pile.push({ indent: it.indent, ordonne: it.ordonne });
		} else {
			html += "</li>";
		}
		html += "<li>" + o.inline(texte.slice(it.zone.debut, it.zone.fin));
	}
	while (pile.length) fermer();
	return html;
}

const STYLE_ALIGNEMENT = (a: Alignement): string => (a ? ` style="text-align: ${a}"` : "");

/**
 * Le HTML d'un texte à blocs, ou `null` pour un texte simple (voir la règle
 * de compatibilité en tête de module) : l'appelant le rend alors comme avant.
 */
export function rendreBlocs(texte: string, o: OutilsRendu): string | null {
	const blocs = decouperBlocs(texte);
	if (!aDesBlocs(blocs)) return null;
	const tranche = (z: Zone): string => texte.slice(z.debut, z.fin);
	return blocs.map(b => {
		switch (b.genre) {
			case "paragraphe":
				return `<p class="quiz-md-p">${o.inline(tranche(b.zone))}</p>`;
			case "titre":
				return `<h${b.niveau} class="quiz-md-titre">${o.inline(tranche(b.zone))}</h${b.niveau}>`;
			case "citation":
				return `<blockquote class="quiz-md-citation">${o.inline(b.lignes.map(l => tranche(l.zone)).join("\n"))}</blockquote>`;
			case "liste":
				return rendreListe(texte, b.items, o);
			case "code": {
				/* La langue n'entre que sous sa forme sûre (lettres, chiffres,
				   `+#.-`), dans une classe : c'est ce que le motif de clôture
				   accepte, rien d'autre ne peut y arriver. */
				const classe = b.langue ? ` class="language-${o.echapper(b.langue)}"` : "";
				const contenu = b.contenu ? tranche(b.contenu) : "";
				// Coloré si un langage est nommé ET reconnu ; sinon le texte
				// échappé nu, exactement comme avant l'ajout de la coloration.
				const html = (b.langue && o.colorerCode ? o.colorerCode(contenu, b.langue) : null) ?? o.echapper(contenu);
				return `<pre class="quiz-md-code"><code${classe}>${html}</code></pre>`;
			}
			case "tableau": {
				/* Autant de colonnes que la rangée la plus longue : les cases
				   manquantes (en-tête ou rangée) restent vides. Le `\|` d'une
				   cellule devient « | » AVANT l'inline, qui l'échappe comme tout
				   texte. */
				const colonnes = Math.max(b.entete.length, ...b.rangees.map(r => r.length));
				const cellule = (z: Zone | undefined): string => (z ? o.inline(tranche(z).replace(/\\\|/g, "|")) : "");
				const indices = Array.from({ length: colonnes }, (_, k) => k);
				const tete = indices.map(k => `<th${STYLE_ALIGNEMENT(b.alignements[k] ?? null)}>${cellule(b.entete[k])}</th>`).join("");
				const corps = b.rangees.map(r => "<tr>" + indices.map(k =>
					`<td${STYLE_ALIGNEMENT(b.alignements[k] ?? null)}>${cellule(r[k])}</td>`).join("") + "</tr>").join("");
				return `<table class="quiz-md-table"><thead><tr>${tete}</tr></thead><tbody>${corps}</tbody></table>`;
			}
		}
	}).join("");
}
