/**
 * Aller-retour LECTURE → ÉCRITURE sur tous les quiz de vrais vaults.
 *
 * À lancer AVANT une release, ou après toute retouche de la chaîne
 * `convertParsedToInternal` / `exportAll` :
 *
 *     node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
 *
 * Chaque bloc quiz-blocks est converti comme la page le fait, réexporté, puis
 * relu. Un bloc qui ne se relit pas est une sauvegarde qui ÉCHOUERA EN SILENCE
 * chez l'utilisateur : la page refuse d'écrire un JSON5 invalide (garde de
 * detail-io.ts), et le travail reste en mémoire jusqu'à la fermeture
 * d'Obsidian. C'est précisément ce qu'aucun test unitaire ne voit venir — il
 * faut de VRAIS quiz, avec leurs champs personnalisés et leurs bizarreries.
 *
 * Aucun fichier n'est modifié : tout se passe en mémoire.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { withSrcModule } from "./lib/load-src.mjs";

const racines = process.argv.slice(2);
if (racines.length === 0) {
	console.error("Usage : node scripts/audit-vaults.mjs <chemin-de-vault> [autre-vault…]");
	process.exit(2);
}

/* `_htmlToText` (editor/modals.ts) passe par le DOM. Hors navigateur, ce
   bouchon doit reproduire ce que le VRAI DOM en ferait — sinon l'audit invente
   des divergences : un bouchon qui ne décodait pas les entités faisait passer
   `&gt;` pour du texte, que l'écriture ré-échappait en `&amp;gt;`, et un
   bouchon qui ignorait les frontières de bloc collait « répondreLe premier ».
   Quatre lignes de plus, et l'audit cesse de mentir. */
globalThis.document = {
	createElement() {
		let html = "";
		const noeud = {
			set innerHTML(v) { html = String(v); },
			get textContent() {
				return html
					.replace(/<br\s*\/?>/gi, "\n")
					// Fin d'un élément de BLOC = saut de ligne, comme
					// `insertAdjacentText("beforeend", "\n")` du vrai code.
					.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
					.replace(/<[^>]+>/g, "")
					// Les entités sont DÉCODÉES par l'analyseur HTML.
					.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
					.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
			},
			querySelectorAll() { return []; },
		};
		/* `<template>` : le code réel lit `tpl.content` (document propriétaire
		   INERTE — c'est ce qui empêche un `<img onerror>` de s'exécuter). Le
		   bouchon n'a pas de vrai DOM ; se renvoyer lui-même suffit pour ce que
		   cet audit vérifie, à savoir la VALIDITÉ du bloc réécrit. */
		Object.defineProperty(noeud, "content", { get() { return noeud; } });
		return noeud;
	},
};

function walk(dir, out) {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (e.name.endsWith(".md")) out.push(p);
	}
	return out;
}

const fichiers = racines.flatMap(r => walk(r, []));
console.log(fichiers.length + " notes examinées dans " + racines.length + " vault(s)");

/* `QUIZ_BLOCK_RE` du plugin, jamais une copie : une regex recopiée ici était
   PLUS STRICTE que l'originale (fence sans attribut, fermante non indentée) et
   sautait en silence des blocs que le plugin, lui, charge — un audit vert ne
   disait alors rien de ces quiz-là (revue codex 2026-07-31). */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts", "src/quiz-utils.ts"],
	(convert, exp, { QUIZ_BLOCK_RE, findQuizModeConfigIndex }) => {
		let quiz = 0, questions = 0, casses = 0, divergents = 0, perdus = 0, altere = 0;

		/* Champs que l'aller-retour REMPLACE légitimement par un équivalent :
		   `prompt` devient `promptHtml` dès qu'il contient du markdown, et
		   réciproquement pour l'explication, la leçon, le support et les
		   options. Tout le reste doit survivre à l'identique — un champ qui
		   disparaît est du travail perdu chez l'utilisateur, en silence, et
		   c'est la seule chose que ni le typage ni la relecture n'attrapent.
		   `learn`/`learnHtml` → `lesson`/`lessonHtml` : renommage du mode
		   "learn" en "lesson" (task 0 du lot mode leçon, 2026-08-31) —
		   editor/export.ts n'écrit plus jamais les anciens noms, donc une
		   entrée qui les portait ressort forcément sous les nouveaux ; rien
		   n'est perdu, seule la clé change. */
		const EQUIVALENTS = {
			prompt: ["prompt", "promptHtml"], promptHtml: ["prompt", "promptHtml"],
			explain: ["explain", "explainHtml"], explainHtml: ["explain", "explainHtml"],
			learn: ["learn", "learnHtml", "lesson", "lessonHtml"],
			learnHtml: ["learn", "learnHtml", "lesson", "lessonHtml"],
			lesson: ["lesson", "lessonHtml"], lessonHtml: ["lesson", "lessonHtml"],
			passage: ["passage", "passageHtml"], passageHtml: ["passage", "passageHtml"],
			options: ["options", "optionHtml"], optionHtml: ["options", "optionHtml"],
			terminalVariant: ["terminalVariant", "textVariant"],
			textVariant: ["terminalVariant", "textVariant"],
		};
		/* Les quatre formes de réponse libre que le moteur agrège
		   (engine/terminal.ts getTextAcceptedAnswers) : l'export les fond dans
		   `acceptedAnswers`. Ce n'est une perte que si la VALEUR n'y est plus —
		   d'où la comparaison sur le contenu et non sur le nom du champ. */
		const FONDUS = ["answer", "correctText", "acceptableAnswers", "correctAnswers"];
		/** Une valeur vide n'a rien à perdre : `placeholder: ''`, `caseSensitive:
		    false`, `options: []` disparaissent sans que personne n'y perde. */
		const vide = (v) => v === "" || v === false || v === null || v === undefined
			|| (Array.isArray(v) && v.every(x => x === "" || x === null || x === undefined));

		/* Champs dont on compare la VALEUR d'un bord à l'autre, et les champs de
		   sortie qui peuvent la porter. */
		const PAIRES = [
			["title", ["title"]],
			["hint", ["hint"]],
			["cloze", ["cloze"]],
			["prompt", ["prompt", "promptHtml"]],
			["promptHtml", ["promptHtml", "prompt"]],
			["explain", ["explain", "explainHtml"]],
			["explainHtml", ["explainHtml", "explain"]],
		];
		/* Mise à l'abri des `<` d'un champ TEXTE le temps du dépouillement des
		   balises. Construit par code : un caractère de contrôle littéral dans
		   une source ne survit pas à un outil de formatage. */
		const ABRI = String.fromCharCode(1);

		/** Le texte VU, seule forme commune à un champ texte et à son jumeau
		    HTML : entités décodées, espaces normalisés — et balises retirées
		    SEULEMENT pour un champ HTML. Les retirer d'un champ texte mangeait
		    un `<IPv6dePC2>` écrit littéralement par l'auteur, que le moteur
		    échappe et affiche très bien. */
		/* DU MARKDOWN PARTOUT (2026-09-26) : un champ `*Html` convertible ressort
		   en markdown (editor/html-vers-markdown.ts). Le texte VU se compare
		   alors d'un côté sans balises, de l'autre sans marqueurs de bloc :
		   - une balise INLINE (`<strong>`, `<code>`…) ne sépare pas deux mots —
		     « l'<strong>humain</strong> » se lit « l'humain », pas « l' humain » ;
		   - puces, numéros, `#`, `>`, clôtures ```, séparateurs et `|` de
		     tableau, syntaxe des liens et images ne sont pas du texte lu. */
		const INLINE_HTML = /<\/?(strong|b|em|i|code|a|span|del|s|strike|u|mark|kbd|samp|small|sub|sup|font)\b[^>]*>/gi;
		const ENTITES = { nbsp: " ", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", rarr: "→" };
		// Une ligne SEULE n'a pas de blocs au rendu (engine/grammaire-blocs.ts) :
		// « + public, - privé » s'y lit tel quel.
		// Le contenu d'un bloc ``` est littéral : un `# commentaire` Python y
		// reste lu.
		const marqueursDeBloc = (s) => !s.includes("\n") ? s : s.split("\n").reduce((acc, ligne) => {
			if (/^[ \t]*(`{3,}|~{3,})/.test(ligne)) { acc.code = !acc.code; acc.lignes.push(" "); return acc; }
			acc.lignes.push(acc.code ? ligne : ligne
				.replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/, " ")
				.replace(/^[ \t]*([-*+]|\d{1,9}[.)])[ \t]+/, "")
				.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, "")
				.replace(/^[ \t]{0,3}>[ \t]?/, ""));
			return acc;
		}, { code: false, lignes: [] }).lignes.join("\n")
			.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, " $2 ")
			.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, "$1");
		/* `converti` : la paire est un champ `*Html` devenu markdown. SEULEMENT
		   là, les marqueurs de bloc et les `|` de tableau sont retirés (revue du
		   2026-09-26, M5) ; ailleurs, un aller-retour qui perdrait un `|`
		   (`a || b`) ou une puce doit toujours se voir. */
		const enTexte = (v, estHtml, converti = false) => (estHtml
			? String(v ?? "").replace(INLINE_HTML, "")
				.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
				.replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
				.replace(/&([a-z]+);/gi, (m, n) => ENTITES[n] ?? m)
			: (converti ? marqueursDeBloc(String(v ?? "")) : String(v ?? "")).replace(/</g, ABRI))
			// Un `![[fichier]]` et le `<img src="fichier">` que md2html en fait
			// désignent la MÊME image : les ramener tous deux au nom de fichier.
			.replace(/!\[\[([^\]|]+)[^\]]*\]\]/g, " $1 ")
			.replace(/<img[^>]*\bsrc="([^"]*)"[^>]*>/gi, " $1 ")
			.replace(/<br\s*\/?>/gi, " ")
			// Une balise commence par une lettre, comme pour le navigateur : le
			// `<< EOF >` d'un bloc de code écrit par md2html est du TEXTE, qu'il
			// affiche — le prendre pour une balise le faisait disparaître.
			.replace(/<\/?[a-zA-Z][^>]*>/g, " ")
			.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
			// Les marqueurs markdown eux-mêmes ne comptent pas : `**gras**` en
			// texte et `<strong>gras</strong>` en HTML disent la même chose.
			.replace(/[*_`~]/g, "")
			.replace(/\|/g, converti ? "" : "|")
			.replace(/\s+/g, " ").trim()
			// Les `<` d'un champ texte, mis à l'abri plus haut, reviennent.
			.replace(new RegExp(ABRI, "g"), "<");

		const survit = (cle, avant, apres) => {
			if (vide(avant[cle])) return true;
			/* Un index de bonne réponse SANS options n'en désigne aucune : c'est
			   un vestige d'un squelette de QCM que la génération IA laisse sur
			   une question devenue texte à trous. Le perdre ne perd rien. */
			if ((cle === "correctIndex" || cle === "correctIndices")
				&& !apres.options && !apres.optionHtml) return true;
			if (FONDUS.includes(cle)) {
				const attendus = [].concat(avant[cle]).map(String);
				const obtenus = (apres.acceptedAnswers || []).map(String);
				return attendus.every(a => obtenus.includes(a));
			}
			return (EQUIVALENTS[cle] || [cle]).some(k => apres[k] !== undefined);
		};

		for (const f of fichiers) {
			const contenu = readFileSync(f, "utf8");
			const m = contenu.match(QUIZ_BLOCK_RE);
			if (!m) continue;
			let parsed;
			try { parsed = JSON5.parse(m[1]); } catch { continue; }   // bloc déjà cassé : pas notre affaire
			if (!Array.isArray(parsed)) continue;
			quiz++;

			const qs = [];
			let examOptions = null;
			// Par son INDEX : le critère dépend de la POSITION dans le bloc
			// (quiz-utils.ts), un test élément par élément ne peut pas le savoir.
			const configIdx = findQuizModeConfigIndex(parsed);
			parsed.forEach((item, i) => {
				if (i === configIdx) { examOptions = convert.readModeConfig(item); return; }
				qs.push(convert.convertParsedToInternal(item));
			});
			questions += qs.length;

			const source = exp.exportAll(qs, examOptions);
			let relu;
			try {
				relu = JSON5.parse(source);
			} catch (e) {
				casses++;
				console.error("ILLISIBLE  " + f + "\n           " + e.message);
				continue;
			}
			/* Le mode réémet un objet de configuration ; le compte doit suivre.
			   Même règle que l'export (editor/export.ts exportAll) : un mode
			   `lesson` (readModeConfig normalise déjà l'alias hérité "learn" —
			   task 0 du lot mode leçon, 2026-08-31), un examen actif, un mode
			   `quiz` ÉCRIT, ou des clés personnalisées à rendre. */
			const emetConfig = !!examOptions && (examOptions.mode === "lesson"
				|| examOptions.enabled || examOptions.mode === "quiz"
				|| !!examOptions._extra);
			const attendu = qs.length + (emetConfig ? 1 : 0);
			if (relu.length !== attendu) {
				divergents++;
				console.error("COMPTE     " + f + "\n           " + relu.length + " éléments au lieu de " + attendu);
				continue;
			}

			/* CHAMP PAR CHAMP : un bloc qui se relit peut quand même avoir perdu
			   une explication ou un indice en route — et c'est la perte la plus
			   silencieuse qui soit, puisque rien n'échoue. On compare les
			   questions dans l'ordre, l'objet de mode retiré des deux côtés. */
			const entree = parsed.filter((_, i) => i !== configIdx);
			const sortie = relu.filter((_, i) => i !== findQuizModeConfigIndex(relu));
			entree.forEach((avant, i) => {
				const apres = sortie[i];
				if (!avant || typeof avant !== "object" || Array.isArray(avant) || !apres) return;
				for (const cle of Object.keys(avant)) {
					if (survit(cle, avant, apres)) continue;
					perdus++;
					console.error("PERDU      " + f + "\n           question " + (i + 1)
						+ " : le champ `" + cle + "` a disparu");
				}
				/* Un champ peut aussi être là et avoir CHANGÉ. C'est par là que
				   sont passés le `<blockquote>` aplati d'une explication et le
				   « 3*4*5 » réécrit `3<em>4</em>5` : rien ne disparaissait, tout
				   était altéré. On compare le TEXTE VU par l'apprenant, seule
				   forme commune à un champ texte et à son jumeau HTML. */
				for (const [avantCle, apresCles] of PAIRES) {
					if (avant[avantCle] === undefined) continue;
					const bCle = apresCles.find(k => apres[k] !== undefined);
					const b = bCle === undefined ? undefined : apres[bCle];
					if (b === undefined) continue;   // déjà signalé comme perdu
					// Un champ `*Html` devenu markdown (editor/html-vers-markdown.ts).
					const converti = /Html$/.test(avantCle) && !/Html$/.test(bCle);
					const a = enTexte(avant[avantCle], /Html$/.test(avantCle), converti);
					const c = enTexte(b, /Html$/.test(bCle), converti);
					if (a === c) continue;
					altere++;
					let d = 0;
					while (d < a.length && d < c.length && a[d] === c[d]) d++;
					console.error("ALTÉRÉ     " + f + "\n           question " + (i + 1)
						+ " : `" + avantCle + "` diverge au caractère " + d
						+ "\n             avant : …" + a.slice(Math.max(0, d - 20), d + 60)
						+ "\n             après : …" + c.slice(Math.max(0, d - 20), d + 60));
				}
			});
		}

		console.log("\nquiz : " + quiz + " | questions : " + questions
			+ " | blocs illisibles : " + casses + " | comptes divergents : " + divergents
			+ " | champs perdus : " + perdus + " | champs altérés : " + altere);
		// `exitCode` et non `exit()` : la pile doit se dérouler pour que
		// `withSrcModule` retire son dossier temporaire.
		if (casses || divergents || perdus || altere) process.exitCode = 1;
	});
