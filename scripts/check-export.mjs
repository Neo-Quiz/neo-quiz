/**
 * Non-régression de l'ÉCRITURE d'un bloc quiz-blocks.
 *
 * `exportAll()` est le seul chemin par lequel le plugin réécrit une note. Un
 * bloc qu'il produirait mal ne se relit plus : la sauvegarde est alors refusée
 * en silence (garde de detail-io.ts) et le travail de l'utilisateur reste en
 * mémoire jusqu'à ce qu'il ferme Obsidian. Deux défauts de ce genre ont déjà
 * existé — un objet imbriqué sorti en `[object Object]`, et deux questions de
 * même titre recevant le même identifiant.
 *
 *     npm run check:export
 */
import JSON5 from "json5";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* `_htmlToText` (editor/modals.ts) passe par le DOM ; hors navigateur, ce
   bouchon reproduit ce que le vrai en ferait — sauts de ligne aux frontieres
   de bloc, entites decodees (cf. scripts/audit-vaults.mjs, meme raison). */
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

const question = (over) => ({
	_type: "single", _id: "x", title: "Titre", prompt: "Énoncé",
	options: ["a", "b"], correctIndex: 0, hint: "", explain: "",
	resourceButton: null, _useHtmlPrompt: false, ...over,
});

await withSrcModule("src/editor/export.ts", ({ exportAll }) => {
	const r = makeReporter("Export");

	/** Le bloc se relit-il, et que vaut la clé demandée ? */
	const relire = (questions, lire) => {
		const source = exportAll(questions, null);
		try {
			return lire(JSON5.parse(source));
		} catch (e) {
			return "JSON5 INVALIDE : " + e.message + "\n" + source;
		}
	};

	// Champs personnalisés : ils viennent d'un bloc écrit à la main et doivent
	// ressortir tels quels, quelle que soit leur forme.
	const extra = (valeur) => relire([question({ _extraFields: { v: valeur } })], p => p[0].v);
	r.check("objet imbriqué", extra({ a: 1, b: "deux" }), { a: 1, b: "deux" });
	r.check("tableau d'objets", extra([{ x: 1 }, { x: 2 }]), [{ x: 1 }, { x: 2 }]);
	r.check("null", extra(null), null);
	r.check("tableau de chaînes", extra(["un", "deux"]), ["un", "deux"]);
	r.check("apostrophes", extra("l'été c'est l'été"), "l'été c'est l'été");
	r.check("saut de ligne", extra("ligne1\nligne2"), "ligne1\nligne2");
	r.check("unicode", extra("α β 甲 → ✓"), "α β 甲 → ✓");
	r.check("antislash", extra("C:\\Users\\a"), "C:\\Users\\a");
	r.check("nombre", extra(42), 42);
	r.check("booléen", extra(true), true);
	// JSON5 accepte NaN et Infinity ; `JSON.stringify` les rendait `null`, ce
	// qui changeait la valeur en silence à la première sauvegarde.
	r.check("NaN imbriqué", Number.isNaN(extra({ x: NaN }).x), true);
	r.check("Infinity imbriqué", extra({ x: Infinity }).x, Infinity);
	r.check("objet profond", extra({ a: { b: { c: [1, "deux", null] } } }), { a: { b: { c: [1, "deux", null] } } });
	r.check("clé à apostrophe", extra({ "l'a": 1 }), { "l'a": 1 });

	// Identifiants : ancre HTML de la question et clé des résultats sauvegardés.
	const ids = (questions) => relire(questions, p => p.map(q => q.id));
	r.check("titres identiques → ids distincts",
		ids([question({ title: "Même titre" }), question({ title: "Même titre" })]),
		["m-me-titre", "m-me-titre-2"]);
	r.check("titre non latin → repli sur qN",
		ids([question({ title: "你好" })]), ["q1"]);
	r.check("titre de ponctuation → repli sur qN",
		ids([question({ title: "---" })]), ["q1"]);
	r.check("id d'origine préservé",
		ids([question({ title: "Autre titre", _sourceId: "nr-single" })]), ["nr-single"]);
	// Un identifiant EXPLICITE occupe sa place : le slug d'une question sans id
	// ne doit pas tomber dessus (deux ancres HTML identiques dans la page).
	r.check("slug généré n'écrase pas un id explicite",
		ids([question({ title: "X", _sourceId: "meme-titre" }), question({ title: "Même titre" })]),
		["meme-titre", "m-me-titre"]);
	r.check("deux ids explicites identiques restent distincts",
		ids([question({ _sourceId: "dup" }), question({ _sourceId: "dup" })]),
		["dup", "dup-2"]);
	// Un slug DÉRIVÉ ne prend pas la place d'un id explicite qui vient plus BAS.
	r.check("slug cède la place à un id explicite ultérieur",
		ids([question({ title: "cible" }), question({ _sourceId: "cible" })]),
		["cible-2", "cible"]);
	// Objets profonds et formes non ordinaires.
	r.check("objet profond (12 niveaux)", (() => {
		let v = "feuille";
		for (let i = 0; i < 12; i++) v = { n: v };
		return extra(v);
	})(), (() => { let v = "feuille"; for (let i = 0; i < 12; i++) v = { n: v }; return v; })());
	r.check("tableau creux", extra([1, , 3]), [1, null, 3]);
	r.check("date", typeof extra(new Date(0)), "string");

	/* Constats de la revue codex du 2026-07-31. */
	// Une clé de PREMIER niveau qui n'est pas un identifiant doit être citée :
	// `a-b: {...}` rendait le bloc illisible, donc la sauvegarde refusée EN
	// SILENCE — toutes les retouches restaient en mémoire.
	r.check("clé de premier niveau non identifiante",
		relire([question({ _extraFields: { "a-b": { x: 1 } } })], p => p[0]["a-b"]),
		{ x: 1 });
	r.check("clé de premier niveau à espace",
		relire([question({ _extraFields: { "deux mots": 1 } })], p => p[0]["deux mots"]), 1);
	r.check("clé identifiante laissée nue",
		exportAll([question({ _extraFields: { monChamp: 1 } })], null).includes("monChamp: 1"), true);
	// `String(-0)` rend « 0 » : le signe disparaissait sans que personne
	// n'ait touché à la valeur.
	r.check("zéro négatif", Object.is(extra(-0), -0), true);
	r.check("zéro négatif imbriqué", Object.is(extra({ x: -0 }).x, -0), true);
	// Un identifiant explicite garde SA réservation, mais un candidat SUFFIXÉ
	// n'en est plus une : sans cette nuance, la seule question qui avait un
	// identifiant unique le perdait.
	r.check("suffixe n'usurpe pas une réservation ultérieure",
		ids([question({ _sourceId: "dup" }), question({ _sourceId: "dup" }), question({ _sourceId: "dup-2" })]),
		["dup", "dup-3", "dup-2"]);
	// L'identifiant retenu est MÉMORISÉ : sinon le slug se recalculait à la
	// retouche suivante du titre, et l'ancre HTML changeait sous les pieds des
	// résultats déjà sauvegardés.
	r.check("slug mémorisé sur la question", (() => {
		const q = question({ title: "Alpha" });
		exportAll([q], null);
		const premier = q._sourceId;
		q.title = "Beta";
		return [premier, JSON5.parse(exportAll([q], null))[0].id];
	})(), ["alpha", "alpha"]);

	// Le mode du bloc est réémis sous sa forme d'origine.
	const mode = (examOptions) => {
		const parsed = JSON5.parse(exportAll([question({})], examOptions));
		return parsed[parsed.length - 1];
	};
	/* "lesson" et non "learn" : `examOptions.mode` arrive ici déjà NORMALISÉ
	   par readModeConfig (task 0 du lot mode leçon, 2026-08-31) — l'export ne
	   reçoit donc plus jamais l'ancien nom, seulement le nouveau. */
	r.check("mode lesson conservé",
		mode({ mode: "lesson", enabled: false, durationMinutes: 10, autoSubmit: true, showTimer: true }),
		{ mode: "learn" });
	r.check("mode examen avec chrono",
		mode({ mode: "exam", enabled: true, durationMinutes: 20, autoSubmit: true, showTimer: false }),
		{ examMode: true, examDurationMinutes: 20, examAutoSubmit: true, examShowTimer: false });

	/* Renommage lesson (task 0) : le nom hérité d'une QUESTION (`learnHtml`)
	   est lu en repli mais jamais réécrit — seul `lessonHtml` doit apparaître
	   dans le bloc produit, et le mode doit être normalisé lui aussi.
	   Adapté du brief au style `r.check` du fichier plutôt que `assert.ok`
	   (aucun module `assert` importé ici, et le reporter local continue les
	   autres cas après un échec au lieu de stopper au premier). Guillemets
	   SIMPLES dans la dernière assertion, pour coller à la convention réelle
	   de json5Value/esc5 (guillemets doubles dans le brief, probablement une
	   inattention — l'export n'a jamais émis que des guillemets simples). */
	const lessonWritten = exportAll(
		[{ prompt: "Q", options: ["a", "b"], correctIndex: 0, learnHtml: "<p>L</p>" }],
		{ mode: "lesson" }
	);
	r.check("ancien nom de question converti a l'ecriture", lessonWritten.includes("lessonHtml"), true);
	r.check("ancien nom de question plus jamais ecrit", lessonWritten.includes("learnHtml"), false);
	r.check("mode Learn écrit sous son nom", lessonWritten.includes("mode: 'learn'"), true);
	r.check("l'ancien nom lesson n'est plus écrit", lessonWritten.includes("mode: 'lesson'"), false);

	/* Task 2 du lot mode lecon : `slice`/`role` d'une question survivent a
	   l'ecriture — c'est exactement le genre de champ qui a deja disparu en
	   silence (`textVariant: 'command'` non reconnu avait efface 23 invites
	   de terminal d'un quiz reel). Adapte du brief au style `r.check` /
	   `relire` du fichier (le brief employait `assert.ok`, absent d'ici) et
	   aux guillemets simples de la convention reelle de json5Value/esc5. */
	const sliceRole = relire(
		[{ id: "b", slice: 2, role: "recall", prompt: "R ?", type: "text", answer: "y" }],
		p => ({ slice: p[0].slice, role: p[0].role }));
	r.check("slice conserve a l'ecriture", sliceRole.slice, 2);
	r.check("role conserve a l'ecriture", sliceRole.role, "recall");
	r.check("role ecrit entre guillemets simples",
		exportAll([{ id: "b", slice: 2, role: "recall", prompt: "R ?" }], null).includes("role: 'recall',"),
		true);

	/* Une valeur HORS CONTRAT ne doit jamais etre recopiee telle quelle : ce
	   n'est pas un champ personnalise ordinaire (`_extraFields` copie
	   n'importe quoi), ces deux-la pilotent le comportement du moteur
	   (buildLessonModel, task 3 du lot) et une valeur absurde doit disparaitre
	   plutot que de casser la boucle en silence. */
	const sliceRoleInvalides = relire(
		[{ id: "c", slice: 0, role: "bogus", prompt: "P" }],
		p => ({ slice: p[0].slice, role: p[0].role }));
	r.check("slice invalide (< 1) tu a l'ecriture", sliceRoleInvalides.slice, undefined);
	r.check("role inconnu tu a l'ecriture", sliceRoleInvalides.role, undefined);

	/* Plan 1 Learn/Practice : le rôle `explain` (« à toi d'expliquer ») et
	   les champs `topic` / `timeLimit` survivent à une réécriture. */
	r.check("rôle explain conservé",
		relire([{ id: "e", slice: 1, role: "explain", prompt: "Explique", type: "text", answer: "m" }], p => p[0].role), "explain");
	r.check("topic et timeLimit conservés",
		relire([question({ _extraFields: { topic: "listes vs tuples", timeLimit: 20 } })], p => [p[0].topic, p[0].timeLimit]),
		["listes vs tuples", 20]);
	r.check("objectives de l'objet Learn conservés",
		(() => { const s = exportAll([question()], { mode: "lesson", enabled: false, durationMinutes: 10, autoSubmit: true, showTimer: true, _extra: { objectives: ["Définir une liste"] } }); return JSON5.parse(s).at(-1).objectives; })(),
		["Définir une liste"]);
	r.check("slice non entier tu a l'ecriture",
		relire([{ id: "d", slice: 1.5, prompt: "P" }], p => p[0].slice), undefined);

	r.done();
});

/* LECTURE du mode : reconnaissance et lecture doivent parler le meme
   vocabulaire. Un bloc ecrit a la main dit volontiers `mode: 'Learn'` ; le
   refuser en ferait une question fantome, l'accepter sans le normaliser le
   relirait comme un mode quiz. Et une chaine `mode` etrangere au plugin ne
   doit PAS faire disparaitre une vraie question. */
await withSrcModule(["src/quiz-utils.ts", "src/editor/convert.ts"], (qu, convert) => {
	const r = makeReporter("Mode du bloc");
	const idx = (items) => qu.findQuizModeConfigIndex(items);
	const q = { title: "Une question", prompt: "Enonce", options: ["a", "b"], correctIndex: 0 };

	r.check("mode exact reconnu", idx([q, { mode: "learn" }]), 1);
	r.check("mode a la casse tolerante", idx([q, { mode: "Learn" }]), 1);
	r.check("mode a espaces tolere", idx([q, { mode: " exam " }]), 1);
	r.check("examMode booleen reconnu", idx([q, { examMode: true }]), 1);
	r.check("mode en TETE reconnu", idx([{ mode: "learn" }, q]), 0);
	// Ce qui ne doit surtout PAS etre pris pour une configuration.
	r.check("chaine mode etrangere ignoree",
		idx([{ title: "Quel mode choisir ?", mode: "transport" }, q]), -1);
	r.check("question complete avec mode etranger, en dernier",
		idx([q, { title: "Mode sombre ?", mode: "dark", options: ["Oui", "Non"], correctIndex: 0 }]), -1);
	// En TETE, le critere est strict : un element qui a des reponses est une
	// question, meme s'il porte un mode valide.
	r.check("question a reponses en tete n'est pas une config",
		idx([{ title: "x", mode: "learn", options: ["a", "b"], correctIndex: 0 }, q]), -1);
	// Une VRAIE question en derniere position, portant un champ `mode` : elle
	// disparaissait entierement — identifiant, titre, options et reponse.
	r.check("question reelle en dernier avec un mode",
		idx([q, { id: "q2", title: "Sans enonce", options: ["oui", "non"], correctIndex: 1, mode: "learn" }]), -1);
	// La ligne vide heritee du bug de la question fantome, elle, reste une
	// configuration : ses options sont des coquilles.
	r.check("ligne vide finale reconnue comme configuration",
		idx([q, { id: "q6", title: "Question 6", options: ["", ""], correctIndex: 0, mode: "learn" }]), 1);
	// Une cle personnalisee nommee comme un champ de question ne doit pas
	// empecher de reconnaitre une configuration legitime.
	r.check("configuration a cle `type` personnalisee",
		idx([q, { mode: "learn", type: "teacher-profile", owner: "alice" }]), 1);
	// ... et une question HISTORIQUE complete ne doit pas etre avalee.
	r.check("question historique avec mode",
		idx([q, { mode: "learn", promptHtml: "<p>2 + 2 ?</p>", text: true, answer: "4" }]), -1);
	// Les marqueurs suivent EXACTEMENT les predicats du moteur.
	r.check("marge numerique = question, pas configuration",
		idx([q, { mode: "learn", tolerance: 0.25, unit: "kg" }]), -1);
	r.check("`text` imbrique n'est pas un marqueur",
		idx([q, { mode: "learn", text: { variant: "bash" }, owner: "alice" }]), 1);
	r.check("`text: true` est un marqueur",
		idx([q, { mode: "learn", text: true, answer: "4" }]), -1);
	r.check("bloc sans configuration", idx([q, q]), -1);
	r.check("bloc vide", idx([]), -1);

	// "lesson" et non "learn" : readModeConfig normalise l'alias hérité au nom
	// canonique (task 0 du lot mode leçon, 2026-08-31).
	r.check("lecture normalisee", convert.readModeConfig({ mode: "Learn" }).mode, "lesson");
	r.check("lecture d'un booleen", convert.readModeConfig({ examMode: true }).mode, "exam");

	r.done();
});

/* VARIANTES DE TERMINAL : l'editeur n'en connait que trois, le moteur une
   douzaine d'alias. La forme ECRITE doit ressortir telle quelle — la reduire
   a la forme canonique reecrirait la note, et ne pas la reconnaitre du tout
   effacait la variante ET son invite (22 questions Cisco reelles). */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Variantes de terminal");
	const tour = (brut) => {
		const q = convert.convertParsedToInternal(brut);
		return JSON5.parse(exp.exportAll([q], null))[0];
	};
	const base = { id: "x", title: "T", prompt: "Ecris la commande", type: "text", acceptedAnswers: ["enable"] };

	const cisco = tour({ ...base, textVariant: "command", commandPrefix: "Town-Hall#" });
	r.check("alias `command` reconnu et reemis", cisco.textVariant, "command");
	r.check("invite Cisco conservee", cisco.commandPrefix, "Town-Hall#");

	const bash = tour({ ...base, terminalVariant: "bash", commandPrefix: "user@srv:~$ " });
	r.check("invite bash conservee", bash.commandPrefix, "user@srv:~$ ");
	r.check("cle d'origine conservee", bash.terminalVariant, "bash");
	r.check("pas de cle concurrente ajoutee", bash.textVariant, undefined);

	const zsh = tour({ ...base, textVariant: "zsh" });
	r.check("alias `zsh` conserve", zsh.textVariant, "zsh");

	const ps = tour({ ...base, textVariant: "PowerShell", commandPrefix: "PS C:\>" });
	r.check("casse d'origine conservee", ps.textVariant, "PowerShell");
	r.check("invite PowerShell conservee", ps.commandPrefix, "PS C:\>");

	// Une question texte SANS variante ne doit pas en gagner une.
	const nu = tour({ ...base });
	r.check("pas de variante inventee", [nu.textVariant, nu.terminalVariant], [undefined, undefined]);

	/* Une carte de LECTURE (`role: 'read'`) n'a ni options ni réponse. La
	   conversion lui donnait deux options vides par défaut, que l'écriture
	   recopiait : chaque Learn généré en portait sur toutes ses cartes de
	   lecture, et la page du quiz les affichait en « … » (2026-09-23). */
	const lecture = tour({ id: "l", title: "Lecture", prompt: "Passage.", slice: 1, role: "read" });
	r.check("une carte de lecture s'écrit sans options ni réponse",
		["options" in lecture, "correctIndex" in lecture, lecture.role, lecture.slice], [false, false, "read", 1]);
	const choixVide = tour({ id: "q", title: "Q", prompt: "?" });
	r.check("une question à choix sans options garde ses deux options vides (éditeur)",
		[choixVide.options, choixVide.correctIndex], [["", ""], 0]);

	r.done();
});

/* INDICE À PLUSIEURS NIVEAUX (2026-09-26) : `hint` en chaîne reste une
   chaîne, un tableau de niveaux reste un tableau, dans l'ordre ; une valeur
   invalide est ignorée ; un niveau vidé dans l'éditeur n'est pas écrit. */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Indice à niveaux (aller-retour)");
	const base = { id: "h", title: "T", prompt: "P ?", options: ["a", "b"], correctIndex: 0 };
	const tour = (brut) => JSON5.parse(exp.exportAll([convert.convertParsedToInternal(brut)], null))[0];
	r.check("chaîne : relue en chaîne", tour({ ...base, hint: "Pense à **range**." }).hint, "Pense à **range**.");
	r.check("tableau : relu en tableau, dans l'ordre",
		tour({ ...base, hint: ["Léger", "Comme `range(1, 3)` qui donne `[1, 2]`.", "Révélateur"] }).hint,
		["Léger", "Comme `range(1, 3)` qui donne `[1, 2]`.", "Révélateur"]);
	r.check("deux écritures de suite : identique", tour(tour({ ...base, hint: ["a", "b"] })).hint, ["a", "b"]);
	r.check("tableau d'un seul niveau utile : écrit en chaîne", tour({ ...base, hint: ["", "Seul"] }).hint, "Seul");
	r.check("valeur invalide ignorée : nombre, objet, tableau sans texte",
		[tour({ ...base, hint: 42 }).hint, tour({ ...base, hint: { a: 1 } }).hint, tour({ ...base, hint: ["", 3] }).hint], [undefined, undefined, undefined]);
	const brouillon = convert.convertParsedToInternal({ ...base, hint: ["un", "deux", "trois"] });
	r.check("brouillon : premier niveau dans hint, les suivants à part", [brouillon.hint, brouillon._hintMore], ["un", ["deux", "trois"]]);
	brouillon._hintMore = ["", "trois"];
	r.check("un niveau vidé n'est pas écrit", JSON5.parse(exp.exportAll([brouillon], null))[0].hint, ["un", "trois"]);
	r.done();
});

/* STYLES DE LECTURE (2026-09-26, spec des styles §2 et §6) : chaque style et
   chaque forme de « À retenir » font l'aller-retour lecture → écriture →
   lecture À L'IDENTIQUE, valeurs inconnues comprises — seul leur RENDU
   retombe sur « page » (src/lecture-style.ts), la note ne change pas. */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Styles de lecture (aller-retour)");
	const tour = (brut) => JSON5.parse(exp.exportAll([convert.convertParsedToInternal(brut)], null))[0];
	const champs = (o) => ({ lecture: o.lecture, etapes: o.etapes, tableau: o.tableau, retenir: o.retenir, methode: o.methode });
	const lecture = (o) => ({ id: "l", title: "Lecture", prompt: "Texte.", slice: 1, role: "read", ...o });
	const cas = {
		"page + cartes": lecture({ lecture: "page", retenir: { forme: "cartes", items: [{ recto: "`d.get`", verso: "Renvoie **None**" }] } }),
		"étapes + récapitulatif": lecture({ lecture: "etapes", etapes: ["Créer `.venv`", "L'activer : `.venv\\Scripts\\activate`"], retenir: { forme: "recap", items: ["On active d'abord", "$x^2$"] } }),
		"étapes marquées méthode": lecture({ lecture: "etapes", etapes: ["Un", "Deux"], methode: true }),
		"tableau aux lignes inégales":lecture({ lecture: "tableau", tableau: { colonnes: ["", "Python", "C"], lignes: [["Exécution", "Interprété", "Compilé"], ["Mémoire", "Auto"]] } }),
		"valeurs inconnues ou mal formées": lecture({ lecture: "callout", etapes: "pas une liste", retenir: { forme: "glossaire", items: 3 } }),
		"aucun champ (quiz d'avant)": lecture({}),
	};
	for (const [nom, brut] of Object.entries(cas)) {
		r.check(`${nom} : relu à l'identique`, champs(tour(brut)), champs(brut));
	}
	const deux = tour(tour(cas["tableau aux lignes inégales"]));
	r.check("deux écritures de suite : toujours identique", champs(deux), champs(cas["tableau aux lignes inégales"]));
	r.check("une lecture sans champ n'en gagne aucun",
		Object.keys(tour(cas["aucun champ (quiz d'avant)"])).filter(k => ["lecture", "etapes", "tableau", "retenir", "methode"].includes(k)), []);
	r.done();
});

/* CONTENU QUI NE DOIT PAS BOUGER A L'ECRITURE. Chacun de ces cas a ete une
   perte ou une corruption reelle : rien ne levait, rien ne s'affichait, et la
   sauvegarde annoncait un succes. */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Fidelite de l'ecriture");
	const BR = String.fromCharCode(10);   // saut de ligne, construit par code
	const tour = (brut) => JSON5.parse(exp.exportAll([convert.convertParsedToInternal(brut)], null))[0];
	const base = { id: "x", title: "T" };

	// `md2html` ne connait pas la regle de flanc du rendu.
	const mult = tour({ ...base, prompt: "Ici 3*4*5 est une multiplication.", options: ["a", "b"], correctIndex: 0 });
	r.check("multiplication non convertie", mult.prompt, "Ici 3*4*5 est une multiplication.");
	r.check("pas de promptHtml invente", mult.promptHtml, undefined);

	// Le markdown de BLOC reste du markdown : le moteur le rend (2026-09-26,
	// engine/grammaire-blocs.ts) ; il partait avant vers `md2html`.
	const liste = tour({ ...base, prompt: "Choisis :" + BR + "- un" + BR + "- deux", options: ["a", "b"], correctIndex: 0 });
	r.check("liste gardee en markdown", [liste.prompt, liste.promptHtml], ["Choisis :" + BR + "- un" + BR + "- deux", undefined]);

	// Une explication en HTML RICHE survit a une sauvegarde qui ne la touche pas.
	const riche = tour({ ...base, prompt: "P", options: ["a", "b"], correctIndex: 0,
		explainHtml: "<blockquote><strong>Contexte</strong> — libre.</blockquote>" });
	r.check("HTML riche conserve", riche.explainHtml, "<blockquote><strong>Contexte</strong> — libre.</blockquote>");

	// Les deux champs coexistent : le moteur affiche le HTML, l'export doit l'ecrire.
	const deux = tour({ ...base, prompt: "P", options: ["a", "b"], correctIndex: 0,
		explain: "texte de repli", explainHtml: "<strong>riche</strong>" });
	r.check("les deux explications conservees",
		[deux.explainHtml, deux.explain], ["<strong>riche</strong>", "texte de repli"]);

	// La reponse « 0 » d'une question numerique.
	const zero = tour({ ...base, type: "text", numeric: true, acceptedAnswers: [0] });
	r.check("reponse zero conservee", zero.acceptedAnswers, ["0"]);

	// Le marqueur historique `text: true`.
	const legacy = tour({ ...base, text: true, answer: "oui" });
	r.check("marqueur `text: true` reconnu", legacy.type, "text");
	r.check("reponse d'une question historique conservee", legacy.acceptedAnswers, ["oui"]);

	// Un bouton de ressource enrichi.
	const res = tour({ ...base, prompt: "P", options: ["a", "b"], correctIndex: 0,
		resourceButton: { label: "Voir", fileName: "c.pdf", page: 7, meta: { checksum: "abc" } } });
	r.check("bouton de ressource complet", res.resourceButton,
		{ label: "Voir", fileName: "c.pdf", page: 7, meta: { checksum: "abc" } });

	// Un gabarit de trous VIDE reste une question a trous.
	const vide = tour({ ...base, prompt: "P", cloze: "", caseSensitive: true });
	r.check("gabarit vide reste un cloze", [vide.cloze, vide.caseSensitive], ["", true]);

	// Un exercice de code : ses champs multi-lignes et ses tableaux survivent,
	// et il ne gagne AUCUNE option fantôme de choix unique.
	const code = tour({ ...base, prompt: "Maximum", language: "python",
		solution: "a = int(input('a : '))\nprint(a)", starter: "a = ...\n",
		inputs: ["24\n18", "3\n7"], asserts: "assert True", hints: ["Pense à int().", "Compare avec if."],
		explain: "int() convertit." });
	r.check("exercice de code : champs conservés",
		[code.language, code.solution, code.starter, code.inputs, code.asserts, code.hints, code.explain],
		["python", "a = int(input('a : '))\nprint(a)", "a = ...\n", ["24\n18", "3\n7"], "assert True", ["Pense à int().", "Compare avec if."], "int() convertit."]);
	r.check("exercice de code : ni options ni correctIndex", [code.options, code.correctIndex], [undefined, undefined]);

	// Une carte mémoire : flashcard, recto, verso, explication, et RIEN d'autre.
	const carte = tour({ ...base, prompt: "Que renvoie `type([])` ?", flashcard: true, answer: "`<class 'list'>`", explain: "Liste vide." });
	r.check("carte : flashcard, prompt, answer, explain conservés",
		[carte.flashcard, carte.prompt, carte.answer, carte.explain],
		[true, "Que renvoie `type([])` ?", "`<class 'list'>`", "Liste vide."]);
	r.check("carte : ni type, ni options fantômes, ni correctIndex",
		["type", "options", "correctIndex", "acceptedAnswers"].filter(k => k in carte), []);
	const carteVide = tour({ ...base, prompt: "P", flashcard: true });
	r.check("carte sans verso reste une carte (verso vide écrit)", [carteVide.flashcard, carteVide.answer], [true, ""]);

	// Formes IMBRIQUEES, que le moteur lit en repli.
	const ord = tour({ ...base, prompt: "P",
		ordering: { items: ["A", "B"], correctOrder: [1, 0], slotLabels: ["Premier", "Second"] } });
	r.check("classement imbrique conserve",
		[ord.possibilities, ord.correctOrder, ord.slots],
		[["A", "B"], [1, 0], ["Premier", "Second"]]);
	const mat = tour({ ...base, prompt: "P",
		matching: { rows: ["22", "80"], choices: ["SSH", "HTTP"], correctMap: [1, 0] } });
	r.check("association imbriquee conservee",
		[mat.rows, mat.choices, mat.correctMap], [["22", "80"], ["SSH", "HTTP"], [1, 0]]);
	// Les cinq champs de reponse sont UNIONNES par le moteur.
	const deuxRep = tour({ ...base, type: "text", acceptedAnswers: ["oui"], acceptableAnswers: ["yes"] });
	r.check("reponses unionnees", deuxRep.acceptedAnswers, ["oui", "yes"]);
	// Variante imbriquee : le TYPE doit etre terminal, donc l'invite survit.
	const imb = tour({ ...base, type: "text", text: { variant: "bash" }, commandPrefix: "srv$ ", answer: "ls" });
	r.check("invite d'une variante imbriquee conservee", imb.commandPrefix, "srv$ ");
	// ... et AUCUNE seconde declaration de variante n'est ajoutee : la forme
	// imbriquee est deja reemise par les champs personnalises.
	r.check("pas de variante en double",
		[imb.textVariant, imb.terminalVariant, imb.text], [undefined, undefined, { variant: "bash" }]);
	// L'union des reponses ne doit pas produire de doublon...
	const doublon = tour({ ...base, type: "text", acceptedAnswers: ["oui"], acceptableAnswers: ["oui"] });
	r.check("union sans doublon", doublon.acceptedAnswers, ["oui"]);
	// ... et `correctAnswers`, desormais consomme, n'est plus reemis a cote.
	const trois = tour({ ...base, type: "text", acceptedAnswers: ["a"], correctAnswers: ["b"] });
	r.check("correctAnswers fondu", [trois.acceptedAnswers, trois.correctAnswers], [["a", "b"], undefined]);

	// Les champs d'EXAMEN portes par une QUESTION sont des cles inconnues
	// comme les autres : l'export ne les ecrit que pour l'objet de
	// configuration, donc les declarer connues les faisait disparaitre.
	const exam = tour({ ...base, prompt: "P", options: ["a", "b"], correctIndex: 0,
		examDurationMinutes: 37, examAutoSubmit: false });
	r.check("champs d'examen d'une question conserves",
		[exam.examDurationMinutes, exam.examAutoSubmit], [37, false]);

	// Un `prompt` texte ECRIT dans la note survit a cote de son `promptHtml`...
	const deuxEnonces = tour({ ...base, prompt: "texte de repli", promptHtml: "<strong>riche</strong>",
		options: ["a", "b"], correctIndex: 0 });
	r.check("les deux enonces conserves",
		[deuxEnonces.promptHtml, deuxEnonces.prompt], ["<strong>riche</strong>", "texte de repli"]);
	// ... mais un texte DERIVE d'un HTML que le markdown ne sait pas dire n'est
	// pas ajoute a une note qui ne l'avait pas.
	const htmlSeul = tour({ ...base, promptHtml: "<u>riche</u>", options: ["a", "b"], correctIndex: 0 });
	r.check("pas de prompt invente", [htmlSeul.prompt, htmlSeul.promptHtml], [undefined, "<u>riche</u>"]);
	// Un HTML seul CONVERTIBLE, lui, devient le markdown de l'enonce (2026-09-26).
	const converti = tour({ ...base, promptHtml: "<strong>riche</strong>", options: ["a", "b"], correctIndex: 0 });
	r.check("HTML seul converti en markdown", [converti.prompt, converti.promptHtml], ["**riche**", undefined]);

	// PROSE qui ressemble a du HTML : elle ne doit PAS partir vers md2html,
	// sinon on rouvre la corruption que tout le reste evite.
	const prose = tour({ ...base, prompt: "Ici 3 <x et y> 4 et 3*4*5 aussi.", options: ["a", "b"], correctIndex: 0 });
	r.check("prose a chevrons laissee en texte", prose.prompt, "Ici 3 <x et y> 4 et 3*4*5 aussi.");
	// Une balise ATTRIBUEE avec sa fermante, elle, a besoin du chemin HTML :
	// le rendu ne restaure que les balises nues et couperait le fragment.
	const attr = tour({ ...base, prompt: 'Use <strong data-x="1">bold</strong> ici', options: ["a", "b"], correctIndex: 0 });
	r.check("balise attribuee passee en HTML", typeof attr.promptHtml, "string");

	// Une cle `__proto__` est une cle comme une autre.
	const proto = tour({ ...base, prompt: "P", options: ["a", "b"], correctIndex: 0, ["__proto__"]: { garde: 1 } });
	r.check("cle __proto__ conservee",
		Object.prototype.hasOwnProperty.call(proto, "__proto__"), true);

	r.done();
});

/* RESERVATION D'UN NOM DE FICHIER. Un `exists` puis un `write` laisse une
   fenetre : deux collages d'image rapproches obtenaient le meme chemin et la
   seconde image effacait la premiere. La reservation doit fermer cette course
   DANS une fenetre — c'est la seule qui arrive en pratique. */
await withSrcModule("src/unique-path.ts", async ({ reserveFreePath, releaseReservedPath }) => {
	const r = makeReporter("Reservation de nom");
	const surDisque = new Set(["a/img.png"]);
	// `exists` volontairement lent : c'est la fenetre par laquelle les deux
	// chaines passaient avant que l'une n'ait ecrit.
	const existe = async (c) => { await new Promise(res => setTimeout(res, 10)); return surDisque.has(c); };

	const paire = await Promise.all([
		reserveFreePath("a/img", ".png", existe),
		reserveFreePath("a/img", ".png", existe),
	]);
	r.check("deux appels concurrents donnent deux noms", paire[0] !== paire[1], true);
	r.check("le nom deja pris sur le disque est evite",
		paire.includes("a/img.png"), false);

	const trio = await Promise.all([
		reserveFreePath("a/img", ".png", existe),
		reserveFreePath("a/img", ".png", existe),
		reserveFreePath("a/img", ".png", existe),
	]);
	r.check("trois appels concurrents, trois noms", new Set(trio).size, 3);

	// Suffixe personnalise (partage : « quiz (2).md »).
	const libre = new Set();
	const partage = await reserveFreePath("Downloads/quiz", ".md",
		async (c) => libre.has(c), (n) => ` (${n})`);
	r.check("premier nom sans suffixe", partage, "Downloads/quiz.md");

	// Tout pris : la fonction LEVE plutot que de rendre un chemin occupe.
	let leve = false;
	try { await reserveFreePath("x/y", ".md", async () => true); } catch { leve = true; }
	r.check("echec bruyant quand tout est pris", leve, true);

	// Une ecriture RATEE doit RENDRE le nom : sinon la session le condamne, et
	// le collage suivant sauterait un nom pourtant libre.
	const jamaisSurDisque = async () => false;
	const n1 = await reserveFreePath("z/note", ".md", jamaisSurDisque);
	releaseReservedPath(n1);
	const n2 = await reserveFreePath("z/note", ".md", jamaisSurDisque);
	r.check("nom rendu apres un echec d'ecriture", [n1, n2], ["z/note.md", "z/note.md"]);

	// Windows et macOS ne distinguent pas la casse : deux appels concurrents ne
	// doivent pas obtenir `Quiz.zip` et `quiz.zip`, qui sont le MEME fichier.
	const casse = await Promise.all([
		reserveFreePath("d/Quiz", ".zip", jamaisSurDisque),
		reserveFreePath("d/quiz", ".zip", jamaisSurDisque),
	]);
	r.check("la casse ne cree pas deux fois le meme fichier",
		casse[0].toLowerCase() !== casse[1].toLowerCase(), true);

	r.done();
});

/* Task 5 (2026-09-02) : la règle d'identité a été extraite dans
   src/quiz-ids.ts pour être partagée avec le SCANNER — l'ordonnanceur a
   besoin de la même clé en lecture et en écriture. Ces cas figent le
   comportement que l'extraction ne doit pas avoir changé. */
await withSrcModule("src/quiz-ids.ts", ({ assignQuestionIds }) => {
	const r = makeReporter("Identité de question");

	r.check("un id explicite est conservé",
		assignQuestionIds([{ id: "abc" }]), ["abc"]);
	r.check("sans id, le titre donne un slug",
		assignQuestionIds([{ title: "Le protocole TCP" }]), ["le-protocole-tcp"]);
	r.check("un titre non latin se replie sur qN",
		assignQuestionIds([{ title: "Λορεμ ;;;" }]), ["q1"]);
	r.check("deux titres identiques sont départagés",
		assignQuestionIds([{ title: "Même" }, { title: "Même" }]), ["m-me", "m-me-2"]);

	/* Le cas de la revue codex 2026-07-31 : un slug dérivé ne doit pas
	   prendre la réservation d'une question qui vient PLUS BAS. */
	r.check("un slug évite les réservations à venir",
		assignQuestionIds([{ id: "dup" }, { title: "dup" }, { id: "dup-2" }]),
		["dup", "dup-3", "dup-2"]);

	// Deux ids explicites identiques : la seconde est suffixée.
	r.check("un id explicite dupliqué est suffixé",
		assignQuestionIds([{ id: "x" }, { id: "x" }]), ["x", "x-2"]);

	/* Fix round 1 (2026-09-03), revue du controleur.
	   Le contrat d'entree laissait les deux regles diverger : `id: '   '` etait
	   "explicite" ici (chaine non vide au sens de `!!v`) mais "absent" pour
	   editor/convert.ts (qui exige `.trim()`), et un `id` non-chaine (JSON5 lu
	   par le scanner de la task 6, non type a l'execution) traversait tel quel
	   une signature qui promet un `string[]`. */
	r.check("un id tout en espaces n'est pas explicite (miroir de convert.ts)",
		assignQuestionIds([{ id: "   " }]), ["q1"]);
	r.check("un id non-chaine n'est pas explicite",
		assignQuestionIds([{ id: 42, title: "Nombre" }]), ["nombre"]);

	/* STABILITE : la propriete que ce module existe pour garantir. Inserer une
	   question EN TETE ne doit pas changer la cle de celles qui suivent — sinon
	   leur historique de revision (task 6) se retrouverait attache a la
	   mauvaise question a la prochaine sauvegarde. Vaut pour un id explicite
	   (ne depend jamais de l'index) ; le repli positionnel `qN` reste, lui,
	   sensible a la position par construction (ticket controleur, non traite
	   dans ce lot — 3 questions sur 774, l'editeur fige la cle des la premiere
	   sauvegarde). Les deux appels sont compares : avant et apres insertion,
	   « a » et « b » gardent la meme cle. */
	const avant = assignQuestionIds([{ id: "a" }, { id: "b" }]);
	const apres = assignQuestionIds([{ id: "z" }, { id: "a" }, { id: "b" }]);
	r.check("avant insertion", avant, ["a", "b"]);
	r.check("apres insertion en tete, memes cles pour a et b", apres.slice(1), avant);

	r.check("bloc vide", assignQuestionIds([]), []);

	r.done();
});
