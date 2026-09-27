/**
 * Non-régression du CÂBLAGE de l'écriture d'un bloc quiz-blocks.
 *
 * `check:export` garde la FORME du bloc produit (`exportAll`) et
 * `audit-vaults.mjs` l'aller-retour sur de vrais vaults. Entre les deux, le
 * câblage de `src/dashboard/detail-io.ts` n'avait RIEN : ni le
 * compare-and-swap sur le bloc, ni la préservation des fins de ligne, ni celle
 * des clôtures, ni le remplacement par FONCTION qui protège les `$…$` d'un
 * quiz de maths. Les quatre sont pourtant des correctifs de bugs réels (revue
 * codex du 2026-07-31), et deux d'entre eux ont régressé la nuit même où ils
 * ont été écrits.
 *
 * Ce fichier est le SEUL chemin par lequel la page réécrit une note de
 * l'utilisateur : ce qu'il casse, il le casse dans le travail de quelqu'un.
 *
 *     npm run check:quiz-io
 */
import JSON5 from "json5";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* `_htmlToText` (editor/modals.ts), atteint par `convertParsedToInternal`,
   passe par le DOM ; hors navigateur, ce bouchon reproduit ce que le vrai en
   ferait. MÊME bouchon que scripts/check-export.mjs, pour la même raison. */
globalThis.document = {
	createElement() {
		let html = "";
		const noeud = {
			set innerHTML(v) { html = String(v); },
			get textContent() {
				const LF = String.fromCharCode(10);
				return html
					.replace(/<br\s*\/?>/gi, LF)
					.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, LF)
					.replace(/<[^>]+>/g, "")
					.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
					.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
			},
			querySelectorAll() { return []; },
		};
		Object.defineProperty(noeud, "content", { get() { return noeud; } });
		return noeud;
	},
};

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const FENCE = String.fromCharCode(96, 96, 96);
const OUVERTURE = FENCE + "quiz-blocks";

/* Le JSON5 des notes d'essai. Écrit à la main, comme un utilisateur l'écrit —
   pas produit par `exportAll`, sinon la lecture n'éprouverait que l'écriture.
   L'énoncé porte les QUATRE motifs de remplacement dangereux : `$1`, `$2`,
   `$&` et l'apostrophe inversée `$` + accent grave. */
const ENONCE_PIEGE = "Maths : $1$ et $2$, plus $& et $"
	+ String.fromCharCode(96) + " littéraux, et l'apostrophe.";
const SOURCE = [
	"[",
	"	{",
	"		id: 'q1',",
	"		title: 'Unite',",
	'		prompt: "' + ENONCE_PIEGE + '",',
	"		options: ['un', 'deux'],",
	"		correctIndex: 0,",
	"	},",
	"]",
].join(LF);

/** Une note complète autour d'un bloc. Les clôtures et les fins de ligne sont
    des PARAMÈTRES : trois des huit cas ne parlent que d'elles. */
function note({ source = SOURCE, ouverture = OUVERTURE, fermeture = FENCE, eol = LF } = {}) {
	return ["# Cours", "", ouverture, ...source.split(LF), fermeture, "", "Texte apres le bloc."]
		.join(eol);
}

/** Position du bloc COMPLET (clôtures comprises) par découpe de chaînes.
    `indexOf`/`slice` et jamais `String.replace` : les motifs `$…` de la chaîne
    de remplacement sont précisément ce que le cas 7 met en cause. */
function bornesDuBloc(contenu, ouverture, fermeture) {
	const debut = contenu.indexOf(ouverture);
	const apresOuverture = debut + ouverture.length;
	const fin = contenu.indexOf(fermeture, apresOuverture) + fermeture.length;
	return { debut, fin };
}

/** Première divergence entre deux chaînes, CARACTÈRE PAR CARACTÈRE. Une
    expression régulière matcherait indifféremment la bonne et la mauvaise
    forme ; c'est l'index exact qu'on veut voir. */
function premierEcart(obtenu, attendu) {
	if (obtenu === attendu) return "identiques";
	let i = 0;
	while (i < obtenu.length && i < attendu.length && obtenu[i] === attendu[i]) i++;
	return "écart à l'index " + i
		+ " — attendu " + JSON.stringify(attendu.slice(i, i + 60))
		+ ", obtenu " + JSON.stringify(obtenu.slice(i, i + 60));
}

/* TROIS entrées, et `splitting` fait de `src/host/current.ts` un chunk PARTAGÉ
   (cf. scripts/lib/load-src.mjs) : l'hôte installé par ce script est donc bien
   celui que `detail-io.ts` voit. Un build par entrée donnerait à chacune sa
   copie du singleton, et `currentHost()` jetterait côté module vérifié. */
await withSrcModule(
	["src/dashboard/detail-io.ts", "src/host/current.ts", "src/editor/export.ts"],
	async (io, hote, exp) => {
	const r = makeReporter("Écriture d'un bloc");

	/** Un faux HÔTE sur une carte en mémoire : un chemin, un contenu, une date.
	    Seuls `getFile`, `read` et `process` sont fournis — tout autre membre
	    atteint jetterait bruyamment, ce qui vaut mieux qu'un double muet. */
	function vault(contenu, { chemin = "Cours/ch1.md", mtime = 1000, process } = {}) {
		const nom = chemin.split("/").pop();
		const etat = { contenu, chemin, mtime };
		etat.file = {
			path: chemin,
			name: nom,
			basename: nom.replace(/\.[^.]+$/, ""),
			extension: "md",
			get mtime() { return etat.mtime; },
		};
		hote.installHost({
			fs: {
				/* Un instantané FIGÉ à chaque appel, comme les vrais hôtes : le
				   `HostFile` rendu porte la date du moment, et `detail-io.ts` ne
				   doit jamais s'attendre à ce que celui qu'il tient se mette à
				   jour tout seul. */
				getFile: (p) => (p === chemin ? { ...etat.file, mtime: etat.mtime } : null),
				read: async (p) => {
					if (p !== chemin) throw new Error("ENOENT: " + p);
					return etat.contenu;
				},
				/* `process` par défaut : une seule invocation du rappel. Les cas
				   qui éprouvent le REJEU passent le leur. Toute écriture fait
				   AVANCER la date, et `getFile` la rend aussitôt — c'est « LA
				   FRAÎCHEUR APRÈS UNE ÉCRITURE » du contrat, sans laquelle
				   `saveQuizDraft` mémoriserait une date périmée. */
				process: async (p, mutate) => {
					if (process) await process(etat, mutate);
					else etat.contenu = mutate(etat.contenu);
					etat.mtime += 5000;
				},
			},
		});
		return etat;
	}

	/* ─────────── 1. un bloc lu puis réécrit SE RELIT ─────────── */

	{
		const v = vault(note());
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("1. lecture d'un bloc réel", typeof lu, "object");
		const ecrit = await io.saveQuizDraft(lu);
		r.check("1. la sauvegarde annonce un succès", ecrit, true);
		/* La RELECTURE, et c'est tout l'objet du cas : un bloc que `exportAll`
		   produirait mal ne se relit plus, la sauvegarde est refusée EN SILENCE
		   (garde `parseQuizSource(source)` de saveQuizDraft) et le travail de
		   l'utilisateur reste en mémoire jusqu'à la fermeture d'Obsidian. */
		const relu = await io.loadQuizDraft(v.chemin);
		r.check("1. le bloc réécrit se relit", typeof relu, "object");
		r.check("1. la question survit à l'aller-retour",
			typeof relu === "object" ? relu.questions.length : relu, 1);
		r.check("1. l'énoncé survit à l'aller-retour",
			typeof relu === "object" ? relu.questions[0].prompt : relu, ENONCE_PIEGE);
	}

	/* ─────────── 2. une note en CRLF reste en CRLF ─────────── */

	{
		const v = vault(note({ eol: CRLF }));
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Enonce modifie";
		r.check("2. la sauvegarde d'une note CRLF réussit", await io.saveQuizDraft(lu), true);
		/* Une note Windows (ou importée, ou synchronisée) est en CRLF ; y écrire
		   un bloc en LF la rend MIXTE, et le moindre changement d'une question
		   apparaît comme une réécriture du bloc entier dans un diff ou une
		   synchro. Un saut de ligne SEUL est donc l'échec. */
		const lfSeul = /[^\r]\n/.exec(v.contenu);
		r.check("2. aucun saut de ligne seul dans la note écrite", lfSeul === null, true);
		r.check("2. la note écrite est bien encore en CRLF", v.contenu.includes(CRLF), true);
	}

	/* ─────────── 3. le témoin est ce qui a été VRAIMENT écrit ─────────── */

	{
		const v = vault(note({ eol: CRLF }));
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Premiere frappe";
		r.check("3. la première sauvegarde passe", await io.saveQuizDraft(lu), true);
		lu.questions[0].prompt = "Seconde frappe";
		/* LE cas : mémoriser la version LF de l'export comme témoin du prochain
		   compare-and-swap fait échouer la sauvegarde SUIVANTE dans une note
		   CRLF — la première frappe passe, la seconde est perdue EN SILENCE
		   (revue codex 2026-07-31, régression du correctif CRLF de la même
		   nuit). */
		r.check("3. la seconde sauvegarde passe aussi", await io.saveQuizDraft(lu), true);
		r.check("3. la note porte bien la seconde frappe",
			v.contenu.includes("Seconde frappe"), true);
	}

	/* ─────────── 4. la ligne d'ouverture avec attributs est préservée ─────────── */

	{
		const ouverture = OUVERTURE + " data-owner=alice";
		const v = vault(note({ ouverture }));
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("4. la sauvegarde passe", await io.saveQuizDraft(lu), true);
		/* Réécrire une clôture CANONIQUE effaçait un ` ```quiz-blocks
		   data-owner=alice ` sans que personne ne l'ait demandé, et le
		   compare-and-swap ne pouvait pas s'en apercevoir : il ne compare que
		   le JSON5. */
		r.check("4. la ligne d'ouverture est intacte", v.contenu.includes(ouverture), true);
	}

	/* ─────────── 5. la fermante INDENTÉE est préservée ─────────── */

	{
		const fermeture = "  " + FENCE;
		const v = vault(note({ fermeture }));
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("5. la sauvegarde passe", await io.saveQuizDraft(lu), true);
		// Même défaut que le cas 4, dans un bloc imbriqué dans une liste.
		r.check("5. la fermante garde son indentation",
			v.contenu.includes(LF + fermeture), true);
	}

	/* ─────────── 6. compare-and-swap, et le rejeu du rappel ─────────── */

	{
		const v = vault(note());
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Ma frappe";
		/* QUELQU'UN D'AUTRE passe par là entre la lecture et l'écriture : une
		   seconde page ouverte sur la même note, l'éditeur markdown, une
		   synchro. Le garde `mtime` se lit AVANT `process` et deux pages
		   pouvaient le franchir toutes les deux, puis s'écraser l'une l'autre
		   en annonçant chacune un succès. */
		const dehors = note({ source: SOURCE.replace("Unite", "Titre change dehors") });
		v.contenu = dehors;
		r.check("6. la sauvegarde repart bredouille, et le DIT",
			await io.saveQuizDraft(lu), false);
		r.check("6. la note garde la version de l'autre écrivain", v.contenu, dehors);
	}

	{
		/* `process` a le droit de REJOUER son rappel (contrat de
		   `src/host/types.ts`), et c'est la DERNIÈRE invocation qui fait foi.
		   Ici le rejeu est NEUTRE : le contenu n'a pas bougé entre les deux. */
		let rappels = 0;
		const compter = (mutate) => (contenu) => { rappels++; return mutate(contenu); };
		const v = vault(note(), {
			process: async (etat, mutate) => {
				const m = compter(mutate);
				m(etat.contenu);                 // essai ABANDONNÉ
				etat.contenu = m(etat.contenu);  // celui qui fait foi
			},
		});
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Frappe apres rejeu";
		r.check("6bis. un rejeu neutre laisse la sauvegarde réussir",
			await io.saveQuizDraft(lu), true);
		r.check("6bis. le rappel a bien été invoqué DEUX fois", rappels, 2);
		r.check("6bis. la note porte la frappe", v.contenu.includes("Frappe apres rejeu"), true);
	}

	{
		/* Le rejeu qui compte : le PREMIER essai réussit, le SECOND trouve un
		   bloc étranger. Le résultat d'un essai abandonné ne doit pas survivre
		   au suivant — d'où le `ecrit = false` en TÊTE du rappel. Sans lui, la
		   page annoncerait un succès sur une note qu'elle n'a pas écrite. */
		const dehors = note({ source: SOURCE.replace("Unite", "Titre change dehors") });
		const v = vault(note(), {
			process: async (etat, mutate) => {
				mutate(etat.contenu);          // premier essai : le bloc est encore le nôtre
				etat.contenu = mutate(dehors); // second : quelqu'un est passé
			},
		});
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Ma frappe";
		r.check("6ter. un essai abandonné ne survit pas au rejeu",
			await io.saveQuizDraft(lu), false);
		r.check("6ter. la note garde la version de l'autre écrivain", v.contenu, dehors);
	}

	/* ─────────── 7. `$1$` et l'apostrophe inversée ─────────── */

	{
		/* LE SEUL cas de cette liste dont la casse ne produit AUCUNE erreur
		   visible : seulement une note silencieusement corrompue. Dans une
		   chaîne de remplacement, `$1`, `$&`, l'apostrophe inversée et `$'`
		   sont des motifs SPÉCIAUX — et un quiz de maths est plein de `$…$`.
		   « $1$ » aurait réinjecté la source entière du bloc à sa place. */
		const v = vault(note());
		const avant = v.contenu;
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("7. l'énoncé piégé est bien lu tel quel", lu.questions[0].prompt, ENONCE_PIEGE);
		r.check("7. la sauvegarde passe", await io.saveQuizDraft(lu), true);

		/* Le bloc ATTENDU, composé par DÉCOUPE de chaînes, jamais par
		   `String.replace` — l'outil en cause ne peut pas servir de témoin. */
		const { debut, fin } = bornesDuBloc(avant, OUVERTURE, FENCE);
		const attendu = avant.slice(0, debut)
			+ OUVERTURE + LF + exp.exportAll(lu.questions, lu.examOptions) + LF + FENCE
			+ avant.slice(fin);
		r.check("7. la note écrite, caractère par caractère",
			premierEcart(v.contenu, attendu), "identiques");

		// Et la preuve par la relecture : l'énoncé est toujours le même.
		const bornes = bornesDuBloc(v.contenu, OUVERTURE, FENCE);
		const json5 = v.contenu.slice(bornes.debut + OUVERTURE.length, bornes.fin - FENCE.length);
		/* La relecture est GARDÉE : un bloc corrompu fait jeter `JSON5.parse`,
		   et ce script MOURRAIT là — emportant en silence le cas 8, qui le
		   suit. C'est le défaut que `check:lesson` a déjà eu (onze groupes
		   cachés) ; on le refuse ici plutôt que de le redécouvrir. */
		let relu;
		try {
			relu = JSON5.parse(json5)[0].prompt;
		} catch (e) {
			relu = "BLOC ILLISIBLE : " + e.message;
		}
		r.check("7. l'énoncé relu du disque est intact", relu, ENONCE_PIEGE);
	}

	/* ─────────── 8. les deux erreurs de lecture ─────────── */

	{
		// Une page vide sans message est le pire des deux mondes : l'utilisateur
		// croit son quiz perdu. Chaque cause a son mot.
		const sansBloc = vault("# Une note ordinaire" + LF + LF + "Pas de quiz ici.");
		r.check("8. une note sans bloc rend « noBlock »",
			await io.loadQuizDraft(sansBloc.chemin), "noBlock");
		r.check("8. un chemin absent rend « fileNotFound »",
			await io.loadQuizDraft("Cours/inexistant.md"), "fileNotFound");
	}

	/* ─────────── 9. le brouillon et la modification EXTERNE ─────────── */

	{
		/* Ajouté APRÈS la conversion, et pour une raison nommée : `draftIsStale`
		   comparait `draft.file.stat.mtime` — un `TFile` VIVANT qu'Obsidian
		   mettait à jour en place. Traduit à la lettre en `draft.file.mtime`, il
		   compare un instantané FIGÉ à la valeur qui en est issue : la fonction
		   devient constante-FAUSSE, et une correction faite dans l'éditeur
		   markdown est écrasée par la frappe suivante SANS UN MOT. Ni
		   `check:export` ni les deux contrôles d'hôte ne regardent ça : la règle
		   est dans le code PARTAGÉ. */
		const v = vault(note());
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("9. un brouillon frais n'est pas périmé", io.draftIsStale(lu), false);
		/* SANS aucune sauvegarde de notre part : c'est le seul montage où
		   `draft.mtime` et l'instantané `draft.file` sont encore ÉGAUX, donc le
		   seul qui rougisse si la fonction relit l'instantané au lieu de
		   redemander à l'hôte. */
		v.mtime += 9000;
		r.check("9. une modification faite DEHORS rend le brouillon périmé",
			io.draftIsStale(lu), true);
	}

	{
		const v = vault(note());
		const lu = await io.loadQuizDraft(v.chemin);
		lu.questions[0].prompt = "Ma frappe";
		r.check("9. la sauvegarde passe", await io.saveQuizDraft(lu), true);
		/* NOTRE PROPRE écriture ne doit pas passer pour une modification externe :
		   c'est ce que la dernière ligne de `saveQuizDraft` achète, et elle n'y
		   arrive que si l'hôte rend un `mtime` FRAIS. Sinon : une Notice
		   « modifié dehors » après chaque sauvegarde. */
		r.check("9. notre propre écriture ne rend pas le brouillon périmé",
			io.draftIsStale(lu), false);
		v.mtime += 9000;
		r.check("9. … et une modification externe APRÈS la sauvegarde se voit encore",
			io.draftIsStale(lu), true);
	}

	/* ─────────── 10. le GLOSSAIRE traverse l'aller-retour réel ─────────── */

	{
		/* Bloc écrit à la main, comme un utilisateur l'écrirait : un objet Learn
		   avec un glossaire dont la définition porte les mêmes pièges que le cas
		   7 (apostrophes, backslash) plus un `$…$` et un saut de ligne — le
		   CHEMIN RÉEL (`loadQuizDraft` → `saveQuizDraft` → `loadQuizDraft`), pas
		   seulement `exportAll` isolé (déjà couvert par check-export.mjs). */
		/* Échappements (apostrophe, backslash, `$\frac{a}{b}$`) déjà couverts
		   octet pour octet par check-export.mjs (bloc « Glossaire ») — ici, la
		   définition reste simple : ce cas éprouve le CÂBLAGE réel
		   (loadQuizDraft/saveQuizDraft), pas une deuxième fois la grammaire
		   d'échappement. Une seule apostrophe, en double quotes JSON5 (pas
		   besoin d'échapper), suffit à prouver que le câblage ne la casse pas. */
		const sourceAvecGlossaire = [
			"[",
			"	{",
			"		id: 'q1',",
			"		title: 'Unite',",
			"		prompt: \"Enonce.\",",
			"		options: ['un', 'deux'],",
			"		correctIndex: 0,",
			"	},",
			"",
			"	// Learn",
			"	{",
			"		mode: 'learn',",
			"		glossary: [",
			"			{ term: \"pile\", definition: \"Structure ou le dernier sort en premier.\" },",
			"			{ term: \"l'appel\", definition: \"Definition avec une apostrophe.\", aliases: [\"LIFO\"] },",
			"		],",
			"	},",
			"]",
		].join(LF);
		const v = vault(note({ source: sourceAvecGlossaire }));
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("10. lecture d'un bloc réel avec glossaire", typeof lu, "object");
		r.check("10. le glossaire est lu dans examOptions.glossary",
			lu.examOptions?.glossary?.length, 2);
		r.check("10. `_extra` ne contient plus `glossary`",
			lu.examOptions?._extra ? Object.prototype.hasOwnProperty.call(lu.examOptions._extra, "glossary") : false,
			false);

		// Une frappe SANS toucher au glossaire : il doit survivre, intact.
		lu.questions[0].prompt = "Enonce modifie";
		r.check("10. la sauvegarde passe", await io.saveQuizDraft(lu), true);
		const relu = await io.loadQuizDraft(v.chemin);
		r.check("10. le glossaire survit à l'aller-retour réel (definition et alias)",
			typeof relu === "object" ? relu.examOptions?.glossary : relu,
			lu.examOptions.glossary);
		r.check("10. la question survit aussi",
			typeof relu === "object" ? relu.questions[0].prompt : relu, "Enonce modifie");
	}

	/* ─────────── 11. Practice SANS configuration : le glossaire en gagne une ─────────── */

	{
		/* Un quiz qui n'a ENCORE aucun objet de configuration (donc
		   `examOptions === null` après lecture) : c'est le cas que la modale
		   « Vocabulaire » (tâche 4, pas encore écrite) rencontrera en premier —
		   simulé ici en construisant l'`EditorExamOptions` à la main, SANS
		   `mode`, comme le ferait cette modale. */
		const v = vault(note());
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("11. pas encore de configuration", lu.examOptions, null);
		lu.examOptions = {
			enabled: false, durationMinutes: 10, autoSubmit: true, showTimer: true,
			glossary: [{ term: "pile", definition: "Structure LIFO." }],
		};
		r.check("11. la sauvegarde passe", await io.saveQuizDraft(lu), true);
		r.check("11. `mode: 'quiz'` a été écrit pour rester reconnaissable",
			v.contenu.includes("mode: 'quiz',"), true);
		const relu = await io.loadQuizDraft(v.chemin);
		r.check("11. relu comme une configuration, glossaire compris",
			typeof relu === "object" ? relu.examOptions?.glossary : relu,
			[{ term: "pile", definition: "Structure LIFO." }]);
		r.check("11. la question d'origine survit seule (pas de question fantôme)",
			typeof relu === "object" ? relu.questions.length : relu, 1);
	}

	r.done();
	hote.uninstallHost();
});
