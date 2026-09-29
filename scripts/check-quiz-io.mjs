/**
 * Regression check for the WIRING of how a quiz-blocks block is written.
 *
 * `check:export` guards the SHAPE of the block produced (`exportAll`) and
 * `audit-vaults.mjs` the round trip on real vaults. Between the two, the
 * wiring of `src/dashboard/detail-io.ts` had NOTHING: neither the
 * compare-and-swap on the block, nor the preservation of line endings, nor
 * that of the fences, nor the replacement by FUNCTION that protects the `$…$`
 * of a maths quiz. All four are fixes of real bugs (codex review of
 * 2026-07-31), and two of them regressed the very night they were written.
 * Since 2026-09-29 it also holds "Keep exam mode" (section 14), the write that
 * starts from the test setup modal.
 *
 * This file covers the ONLY paths by which the app rewrites a user's note:
 * what it breaks, it breaks in someone's work.
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

/* Several entries, and `splitting` makes `src/host/current.ts` a SHARED chunk
   (see scripts/lib/load-src.mjs): the host this script installs is therefore
   the one `detail-io.ts` sees. One build per entry would give each its own
   copy of the singleton, and `currentHost()` would throw on the module under
   test. */
await withSrcModule(
	["src/dashboard/detail-io.ts", "src/host/current.ts", "src/editor/export.ts", "src/dashboard/exam-keep.ts"],
	async (io, hote, exp, keepMod) => {
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

	/* ─────────── 12. an EXAM through the real round trip ─────────── */

	{
		/* Spec 2026-09-29 §1.1: an Exam is `mode: 'exam'` and its duration.
		   Written by hand with the retired keys next to them: a save must keep
		   the mode, the duration and the unknown key, and drop the retired
		   keys — before the editor model was reduced, the save rewrote an Exam
		   as `examMode: true`, which reading no longer recognises: the note lost
		   its mode and gained an empty question. */
		const sourceExamen = [
			"[",
			"	{",
			"		id: 'q1',",
			"		title: 'Unite',",
			"		prompt: \"Enonce.\",",
			"		options: ['un', 'deux'],",
			"		correctIndex: 0,",
			"		explain: 'Parce que.',",
			"	},",
			"",
			"	{",
			"		mode: 'exam',",
			"		examDurationMinutes: 125,",
			"		examAutoSubmit: false,",
			"		examShowTimer: false,",
			"		owner: 'alice',",
			"	},",
			"]",
		].join(LF);
		const v = vault(note({ source: sourceExamen }));
		const lu = await io.loadQuizDraft(v.chemin);
		r.check("12. an Exam is read with its duration",
			typeof lu === "object" ? [lu.examOptions?.mode, lu.examOptions?.durationMinutes, lu.questions.length] : lu, ["exam", 125, 1]);
		lu.questions[0].prompt = "Enonce modifie";
		r.check("12. the save goes through", await io.saveQuizDraft(lu), true);
		const bloc = JSON5.parse(v.contenu.slice(v.contenu.indexOf("[", v.contenu.indexOf(OUVERTURE)), v.contenu.lastIndexOf("]") + 1));
		r.check("12. rewritten as mode: 'exam' and its duration, unknown key kept, retired keys dropped",
			bloc.at(-1), { mode: "exam", examDurationMinutes: 125, owner: "alice" });
		const relu = await io.loadQuizDraft(v.chemin);
		r.check("12. read back as an Exam, no phantom question",
			typeof relu === "object" ? [relu.examOptions?.mode, relu.examOptions?.durationMinutes, relu.questions.length] : relu, ["exam", 125, 1]);
	}

	/* ─────────── 13. (removed) ───────────
	   The editor used to switch a Test between Practice and Exam (spec
	   2026-09-29 §5.1). It no longer does: "Keep exam mode" (section 14) is the
	   only writer of `mode: 'exam'` and `examDurationMinutes`, and section 12
	   holds what the editor's own save does with an existing configuration. */

	/* ─────────── 14. "KEEP EXAM MODE" (spec 2026-09-29-test-setup-modal §2) ─────────── */

	{
		/* Started from the "Set up your test" modal, on a note the user did not
		   ask to edit: it writes `mode: 'exam'` and `examDurationMinutes` and
		   NOTHING else. Every expectation below is a whole note written out by
		   hand, compared byte for byte (`premierEcart`), never derived from the
		   code under test. The comparison against a re-export is deliberate
		   too: `saveQuizDraft` would drop the comments and re-lay the block. */
		const RE_BLOC = new RegExp(FENCE + "quiz-blocks[^\\n]*\\n([\\s\\S]*?)\\r?\\n[ \\t]*" + FENCE);
		const bloc = (contenu) => contenu.match(RE_BLOC)[1];
		const Q1 = "\t{ id: 'q1', title: 'Unite', prompt: \"Enonce.\", options: ['un', 'deux'], correctIndex: 0 },";
		const CONFIG_EXAM = (minutes) => ["", "\t// Exam", "\t{", "\t\tmode: 'exam',", "\t\texamDurationMinutes: " + minutes + ",", "\t},"];
		const keepOn = (v, minutes) => io.saveKeepExam(v.chemin, bloc(v.contenu), { minutes });
		const keepOff = (v) => io.saveKeepExam(v.chemin, bloc(v.contenu), null);

		// a. no configuration yet: an Exam configuration is appended in the exporter's layout
		{
			const v = vault(note({ source: ["[", Q1, "]"].join(LF) }));
			const avant = v.contenu;
			r.check("14a. on, no configuration: the write succeeds", await keepOn(v, 45), true);
			r.check("14a. the configuration is appended, every other byte is the note's",
				premierEcart(v.contenu, note({ source: ["[", Q1, ...CONFIG_EXAM(45), "]"].join(LF) })), "identiques");
			// off puts the note back EXACTLY as it was, blank line and comment included
			r.check("14a. off after on gives the original note back", await keepOff(v), true);
			r.check("14a. … byte for byte", premierEcart(v.contenu, avant), "identiques");
		}

		// b. a hand-written inline configuration: its own keys and layout stay
		{
			const v = vault(note({ source: ["[", Q1, "\t{ mode: 'quiz', owner: 'alice' },", "]"].join(LF) }));
			r.check("14b. on: the write succeeds", await keepOn(v, 30), true);
			r.check("14b. mode changed, duration inserted after it, the custom key untouched",
				premierEcart(v.contenu, note({ source: ["[", Q1, "\t{ mode: 'exam', examDurationMinutes: 30, owner: 'alice' },", "]"].join(LF) })), "identiques");
		}

		// c. an Exam with comments and retired keys: only the duration's number moves
		{
			const cfg = (m) => ["\t// Exam, kept", "\t{", "\t\tmode: 'exam', // as the teacher wants it", "\t\texamDurationMinutes: " + m + ",", "\t\texamAutoSubmit: false,", "\t\towner: 'alice',", "\t},"];
			const v = vault(note({ source: ["[", Q1, "", ...cfg(125), "]"].join(LF) }));
			r.check("14c. a new duration: the write succeeds", await keepOn(v, 60), true);
			r.check("14c. only the number changed (comments, retired key, custom key intact)",
				premierEcart(v.contenu, note({ source: ["[", Q1, "", ...cfg(60), "]"].join(LF) })), "identiques");
			const apres = v.contenu;
			r.check("14c. the same setting again is a success", await keepOn(v, 60), true);
			r.check("14c. … and changes nothing", premierEcart(v.contenu, apres), "identiques");
		}

		// d. off on an Exam whose other keys would not keep it recognised as a configuration
		{
			const cfg = (mode, extra) => ["\t{", "\t\tmode: '" + mode + "',", ...extra, "\t\texamAutoSubmit: false,", "\t\towner: 'alice',", "\t},"];
			const v = vault(note({ source: ["[", Q1, ...cfg("exam", ["\t\texamDurationMinutes: 125,"]), "]"].join(LF) }));
			r.check("14d. off: the write succeeds", await keepOff(v), true);
			/* Removing `mode` would leave `{ examAutoSubmit, owner }`, which the
			   format reads as a QUESTION: the object keeps an explicit Practice. */
			r.check("14d. the duration goes, the mode becomes an explicit Practice, nothing else moves",
				premierEcart(v.contenu, note({ source: ["[", Q1, ...cfg("quiz", []), "]"].join(LF) })), "identiques");
		}

		// e. off on an Exam that a glossary keeps recognised: both keys go, the glossary is untouched
		{
			const cfg = (withKeys) => ["\t{", ...(withKeys ? ["\t\tmode: 'exam',", "\t\texamDurationMinutes: 45,"] : []),
				"\t\tglossary: [{ term: 'pile', definition: 'LIFO, } ] // not a comment' }],", "\t},"];
			const v = vault(note({ source: ["[", Q1, ...cfg(true), "]"].join(LF) }));
			r.check("14e. off: the write succeeds", await keepOff(v), true);
			r.check("14e. both keys removed, the glossary (with brackets and slashes in a string) untouched",
				premierEcart(v.contenu, note({ source: ["[", Q1, ...cfg(false), "]"].join(LF) })), "identiques");
		}

		// f. CRLF, an opening line with attributes, an indented closing fence
		{
			const ouverture = OUVERTURE + " data-owner=alice";
			const fermeture = "  " + FENCE;
			const v = vault(note({ source: ["[", Q1, "]"].join(LF), ouverture, fermeture, eol: CRLF }));
			r.check("14f. CRLF note: the write succeeds", await keepOn(v, 90), true);
			r.check("14f. line endings, fences and attributes are the note's own",
				premierEcart(v.contenu, note({ source: ["[", Q1, ...CONFIG_EXAM(90), "]"].join(LF), ouverture, fermeture, eol: CRLF })), "identiques");
			r.check("14f. no lone line feed anywhere", /[^\r]\n/.test(v.contenu), false);
		}

		// g. the replacement is by function: `$1`, `$&`, `$` + backtick survive
		{
			const v = vault(note());
			const lignes = SOURCE.split(LF);
			lignes.pop();
			r.check("14g. a maths quiz: the write succeeds", await keepOn(v, 45), true);
			r.check("14g. the trap statement is intact, the configuration appended",
				premierEcart(v.contenu, note({ source: [...lignes, ...CONFIG_EXAM(45), "]"].join(LF) })), "identiques");
		}

		// h. the scanner is not fooled by brackets, commas and comment openers inside a string
		{
			const q = "\t{ id: 'q1', prompt: \"x } ] , // not a comment /* nor this\", options: ['a', 'b'], correctIndex: 0 },";
			const v = vault(note({ source: ["[", q, "]"].join(LF) }));
			r.check("14h. a tricky statement: the write succeeds", await keepOn(v, 45), true);
			r.check("14h. … and the statement is untouched",
				premierEcart(v.contenu, note({ source: ["[", q, ...CONFIG_EXAM(45), "]"].join(LF) })), "identiques");
		}

		// i. a configuration written first, without a trailing comma
		{
			const v = vault(note({ source: ["[", "\t{ mode: 'quiz' },", Q1, "]"].join(LF) }));
			r.check("14i. first-position configuration: the write succeeds", await keepOn(v, 45), true);
			r.check("14i. edited in place",
				premierEcart(v.contenu, note({ source: ["[", "\t{ mode: 'exam', examDurationMinutes: 45 },", Q1, "]"].join(LF) })), "identiques");
		}

		// j. compare-and-swap: a block that changed since it was read is never written over
		{
			const v = vault(note({ source: ["[", Q1, "]"].join(LF) }));
			const lu = bloc(v.contenu);
			const dehors = note({ source: ["[", Q1.replace("Unite", "Change dehors"), "]"].join(LF) });
			v.contenu = dehors;
			r.check("14j. a stale block: nothing is written, and it says so",
				await io.saveKeepExam(v.chemin, lu, { minutes: 45 }), false);
			r.check("14j. the note keeps the other writer's version", v.contenu, dehors);
		}

		// k. cases that must not write
		{
			const learn = note({ source: ["[", Q1, "\t{ mode: 'learn', glossary: [] },", "]"].join(LF) });
			const v = vault(learn);
			r.check("14k. a Learn is refused", await keepOn(v, 45), false);
			r.check("14k. … and left as it was", v.contenu, learn);
			const cassee = note({ source: ["[", "\t{ id: 'q1', prompt: 'x' " ].join(LF) });
			const w = vault(cassee);
			r.check("14k. an unreadable block is refused", await io.saveKeepExam(w.chemin, bloc(w.contenu), { minutes: 45 }), false);
			r.check("14k. … and left as it was", w.contenu, cassee);
			const sans = note({ source: ["[", Q1, "]"].join(LF) });
			const x = vault(sans);
			r.check("14k. off with no configuration is already done", await keepOff(x), true);
			r.check("14k. … and changes nothing", x.contenu, sans);
			r.check("14k. an empty block is refused", [keepMod.applyKeepExam("[]", { minutes: 45 }), keepMod.applyKeepExam("", { minutes: 45 })], [null, null]);
		}

		// l. an Exam without a duration gets one, right after its mode
		{
			const v = vault(note({ source: ["[", Q1, "\t{ mode: 'exam' }", "]"].join(LF) }));
			r.check("14l. duration added: the write succeeds", await keepOn(v, 40), true);
			r.check("14l. inserted after the mode, the missing comma added",
				premierEcart(v.contenu, note({ source: ["[", Q1, "\t{ mode: 'exam', examDurationMinutes: 40 }", "]"].join(LF) })), "identiques");
		}

		// m. the bounds are the caller's; the module writes what it is given, and re-reads it
		r.check("14m. the edited block reads back as an Exam",
			JSON5.parse(keepMod.applyKeepExam(["[", Q1, "]"].join(LF), { minutes: 300 })).at(-1), { mode: "exam", examDurationMinutes: 300 });
	}

	r.done();
	hote.uninstallHost();
});
