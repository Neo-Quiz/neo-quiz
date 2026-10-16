/** Vérifie le contrat de persistance du modal « Modifier dossier » :
 * ce que `buildModuleOverride` écrit dans `quizzesModuleOverrides`, et surtout
 * ce qu'il n'y écrit PLUS.
 *
 * LA DATE D'EXAMEN N'EST PLUS UN OVERRIDE (2026-09-17), et c'est la règle que
 * ce script tient. Les overrides sont indexés par `ModuleGroup.folder`, un NOM
 * DE SEGMENT sans l'identifiant de la racine : deux dossiers ouverts ayant
 * chacun un sous-dossier « Generated » partagent la même entrée. Pour une
 * couleur, c'est un défaut visible ; pour un HORIZON DE RÉTENTION, c'est une
 * matière dont les révisions se resserrent à cause de l'examen d'une autre.
 * La date vit désormais sous la clé de module de l'hôte
 * (`DashboardShellCtx.setExamDate`), qui porte la racine.
 *
 * Le dernier cas est le CLIQUET : il passe une date malgré tout, comme le
 * ferait un appelant qui la remettrait « pour aller vite », et exige qu'elle
 * ne soit pas persistée. Sans lui, le retour en arrière ne rougirait nulle
 * part — le champ réapparaîtrait simplement dans le JSON, sans lecteur. */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/module-edit.ts", async ({ buildModuleOverride }) => {
	const r = makeReporter("Modal module — override persisté");
	const folder = "Reseaux";

	const renseigne = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		color: "#336699",
		icon: "network",
	});
	r.check("les champs renseignés sont conservés", renseigne, {
		name: "Réseaux",
		ue: "UE 3",
		color: "#336699",
		icon: "network",
	});

	const nomIdentique = buildModuleOverride(folder, {
		name: "Reseaux",
		ue: "UE 3",
	});
	r.check("un nom identique au dossier ne crée pas d'override", nomIdentique, {
		ue: "UE 3",
	});

	const sansUe = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: null,
	});
	r.check("Sans UE reste un override explicite", sansUe, {
		name: "Réseaux",
		ue: null,
	});

	/* Le cliquet. `examDate` n'est plus dans le type, donc ce cas ne peut venir
	   que d'un appelant JavaScript ou d'un retour en arrière — les deux doivent
	   échouer à l'écrire. */
	const avecDate = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		examDate: "2027-06-01",
	});
	r.check("une date d'examen n'entre PAS dans les overrides", "examDate" in avecDate, false);

	/* LE CHEMIN SURVIT À UNE ÉDITION (2026-09-17). Un dossier déclaré par
	   « Ouvrir un dossier existant » porte son chemin du contrat dans
	   l'override ; le modal « Modifier dossier » RECONSTRUIT l'override entier
	   à chaque frappe, et sans ce report, renommer le dossier effaçait son
	   chemin — « Nouveau quiz » y retombait sur le segment seul, et échouait. */
	const avecChemin = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		path: "Efrei/B2 (2026-2027)/Reseaux",
	});
	r.check("le chemin déclaré est reporté tel quel", avecChemin.path, "Efrei/B2 (2026-2027)/Reseaux");
	r.check("et un override sans chemin n'en invente pas", "path" in renseigne, false);

	/* A HIDDEN folder (2026-10-15): editing its name or colour must not show it again. */
	const masque = buildModuleOverride(folder, { name: "Réseaux", ue: "UE 3", hidden: "1" });
	r.check("the hidden flag is carried over by an edit", masque.hidden, "1");
	r.check("and an override that is not hidden does not become so", "hidden" in renseigne, false);

	/* CLASS SESSIONS (2026-10-16): carried over by an edit, a damaged value never written. */
	const seances = buildModuleOverride(folder, { name: "Réseaux", ue: "UE 3", sessions: "6", sessionMinutes: "300", sessionsPerWeek: "1" });
	r.check("the three class-session fields are carried over by an edit",
		[seances.sessions, seances.sessionMinutes, seances.sessionsPerWeek], ["6", "300", "1"]);
	const abimes = buildModuleOverride(folder, { name: "Réseaux", ue: "UE 3", sessions: "0", sessionMinutes: "14", sessionsPerWeek: "15" });
	r.check("a value out of bounds is never written (0 sessions, 14 min, 15 per week)",
		["sessions" in abimes, "sessionMinutes" in abimes, "sessionsPerWeek" in abimes], [false, false, false]);
	const bornes = buildModuleOverride(folder, { name: "Réseaux", ue: "UE 3", sessions: "200", sessionMinutes: "600", sessionsPerWeek: "14" });
	r.check("the upper bounds are kept (200, 600, 14)", [bornes.sessions, bornes.sessionMinutes, bornes.sessionsPerWeek], ["200", "600", "14"]);
	const formes = ["06", "6.5", "1e2", " 6", "-1", "201", "", "６"].map(v => "sessions" in buildModuleOverride(folder, { name: "R", ue: null, sessions: v }));
	r.check("only a plain decimal integer is a value (06, 6.5, 1e2, spaces, -1, 201, empty, full-width digit dropped)", formes, formes.map(() => false));
	r.check("an override with no session field gets none", ["sessions", "sessionMinutes", "sessionsPerWeek"].some(f => f in renseigne), false);

	r.done();
});

/* HIDDEN FOLDERS (2026-10-15, `src/dashboard/folder-hidden.ts`): which quizzes
   a hidden folder takes out of the lists and out of the review catalogue, by
   the same folder rule as the page (`moduleForQuiz`), and the flag set and
   cleared in the settings. */
await withSrcModule("src/dashboard/folder-hidden.ts", async ({ hiddenFolders, hiddenQuizTest, setFolderHidden }) => {
	const r = makeReporter("Hidden folders");
	const overrides = { Reseaux: { hidden: "1", path: "Efrei/B2/Reseaux" }, Maths: { color: "#f00" }, Odd: { hidden: "yes" } };
	r.check("only the value \"1\" hides a folder", hiddenFolders(overrides), ["Reseaux"]);
	r.check("no settings, nothing hidden", hiddenFolders(undefined), []);
	const test = hiddenQuizTest(overrides);
	r.check("a quiz of the hidden folder is hidden, one of another folder is not",
		[test("Efrei/B2/Reseaux/tcp.md"), test("Efrei/B2/Maths/algebre.md"), test("Efrei/q.md")], [true, false, false]);
	r.check("a quiz in a SUB-folder of the hidden folder is hidden too (its nearest known ancestor, as the page groups it)",
		hiddenQuizTest(overrides)("Efrei/B2/Reseaux/TD/td1.md"), true);
	r.check("the nearest known folder wins: a hidden sub-folder hides its quizzes even inside a module of the note",
		hiddenQuizTest({ TD: { hidden: "1" } }, { byFolder: new Map([["Reseaux", { folder: "Reseaux", name: "Reseaux", ue: "UE" }]]), ueOrder: ["UE"] })("Efrei/B2/Reseaux/TD/td1.md"), true);
	const ctx = { settings: { quizzesModuleOverrides: { Maths: { color: "#f00" } } }, saves: 0, saveSettings: async () => { ctx.saves++; } };
	await setFolderHidden(ctx, "Maths", true);
	await setFolderHidden(ctx, "Info", true);
	r.check("hide: the flag joins the folder's settings, a folder with none gets an entry",
		ctx.settings.quizzesModuleOverrides, { Maths: { color: "#f00", hidden: "1" }, Info: { hidden: "1" } });
	await setFolderHidden(ctx, "Maths", false);
	await setFolderHidden(ctx, "Info", false);
	r.check("show: the field is removed (never another value), an entry left empty goes",
		ctx.settings.quizzesModuleOverrides, { Maths: { color: "#f00" } });
	r.check("every change is saved", ctx.saves, 4);
	r.done();
});

/* ── Parent of a NEW folder (regression 2026-10-01) ──
   An empty catalogue (first folder of a fresh install, a filtered list) used
   to give "" , so the new folder was the bare path "1": no open root owns it
   and every click on "Create" failed with the same toast. The default root
   must be the fallback. */
await withSrcModule("src/dashboard/module-edit.ts", async ({ commonModuleParent }) => {
	const r = makeReporter("Nouveau dossier — parent");
	const vide = { byFolder: new Map() };
	r.check("catalogue vide : retombe sur la racine par défaut", commonModuleParent([], vide, "Neo Quiz"), "Neo Quiz");
	r.check("sans repli, comportement inchangé", commonModuleParent([], vide), "");
	const quiz = { path: "Efrei/B2/Reseaux/q.md" };
	const map = { byFolder: new Map([["Reseaux", { folder: "Reseaux", name: "Reseaux", ue: null }]]) };
	r.check("un quiz connu l'emporte sur le repli", commonModuleParent([quiz], map, "Neo Quiz"), "Efrei/B2");
	r.done();
});

/* ── Le chemin réel d'un module, là où il se DÉDUIT et là où il se PORTE ──
   `folder` est un segment ; ce qu'on écrit veut un chemin du contrat. */
await withSrcModule("src/dashboard/quiz-modules.ts", async ({ moduleForQuiz, applyModuleOverrides, buildModuleGroups }) => {
	const r = makeReporter("Modules — le chemin réel d'un dossier");
	const vide = { byFolder: new Map(), ueOrder: [] };

	r.check("sans table, le module est le parent immédiat, ET son chemin complet",
		moduleForQuiz("Neo Quiz/Generated/langage C.md", vide),
		{ folder: "Generated", name: "Generated", ue: null, path: "Neo Quiz/Generated" });
	r.check("un quiz à la racine d'un dossier ouvert : le segment est déjà le chemin",
		moduleForQuiz("Neo Quiz/x.md", vide).path, "Neo Quiz");

	const table = { byFolder: new Map([["XTI301", { folder: "XTI301", name: "Python", ue: "S3" }]]), ueOrder: ["S3"] };
	r.check("un module reconnu plus haut dans le chemin rend le chemin JUSQU'À lui",
		moduleForQuiz("Efrei/B2 (2026-2027)/XTI301/TP/quiz.md", table).path,
		"Efrei/B2 (2026-2027)/XTI301");

	const declare = applyModuleOverrides(vide, { XTI301: { name: "Python", path: "Efrei/B2 (2026-2027)/XTI301" } });
	r.check("un override porte son chemin dans la table",
		declare.byFolder.get("XTI301")?.path, "Efrei/B2 (2026-2027)/XTI301");
	r.check("et ce chemin DÉCLARÉ l'emporte sur celui déduit d'un quiz",
		moduleForQuiz("Autre/XTI301/quiz.md", declare).path, "Efrei/B2 (2026-2027)/XTI301");

	const groupes = buildModuleGroups(
		[{ path: "Neo Quiz/Generated/a.md", title: "a", questionCount: 1 }],
		{}, declare, ["XTI301"]);
	const parDossier = new Map(groupes.map(g => [g.folder, g.path]));
	r.check("un dossier déclaré SANS quiz a le chemin de sa déclaration",
		parDossier.get("XTI301"), "Efrei/B2 (2026-2027)/XTI301");
	r.check("un dossier jamais déclaré a le chemin déduit de son premier quiz",
		parDossier.get("Generated"), "Neo Quiz/Generated");

	r.done();
});

/* Year folders in the links of the module map note (spec 2026-10-15, §4): the
   course is the segment right under `B<n> YYYY-YYYY`, as under `B<n> (…)`. A
   note one folder deeper tells the year rule from the fallback (second-to-last
   segment). */
await withSrcModule("src/dashboard/quiz-modules.ts", async ({ moduleFolderFromLinkPath, parseModuleMap }) => {
	const r = makeReporter("Modules — year folders in links");
	r.check("B2 2026-2027/XTI303 …/note resolves to the course folder",
		moduleFolderFromLinkPath("B2 2026-2027/XTI303 - Conception/XTI303 - Conception.md"), "XTI303 - Conception");
	r.check("one folder deeper: still the course, never the sub-folder",
		moduleFolderFromLinkPath("B2 2026-2027/XTI303 - Conception/TP/note.md"), "XTI303 - Conception");
	r.check("B2 (…) still recognised", moduleFolderFromLinkPath("Efrei/B2 (2026-2027)/XTI301/TP/q.md"), "XTI301");
	r.check("not a year folder (a plain B folder): the fallback", moduleFolderFromLinkPath("B2 notes/XTI303/TP/note.md"), "TP");
	const map = parseModuleMap("> [!portals] UE31\n> - [[B2 2026-2027/XTI303 - Conception/TP/note|Conception]]\n");
	r.check("the module map reads it", [...map.byFolder.keys()], ["XTI303 - Conception"]);
	r.done();
});


/* CE QUE LE MODAL MONTRE, et non plus seulement ce qu'il écrit. Il résolvait
   lui-même l'icône et la teinte (`DEFAULT_MODULE_ICON`, `hashAccent`) : sur le
   SAS des quiz générés, son aperçu affichait un livre violet quand la carte,
   elle, montrait l'étincelle bleue (Ahmed, 2026-09-17). Les deux règles sont
   désormais des fonctions PURES, partagées par les trois lecteurs — c'est
   elles que ce bloc éprouve, puisque le modal n'en a plus d'autre. */
await withSrcModule("src/dashboard/module-icons.ts", async ({ moduleIcon }) => {
	const r = makeReporter("Module — l'icône affichée");
	r.check("un module sans icône prend le défaut", moduleIcon({}), "book");
	r.check("le SAS sans icône prend celle de l'IA", moduleIcon({}, { generated: true }), "sparkles");
	r.check("une icône choisie l'emporte, même sur le SAS",
		moduleIcon({ icon: "network" }, { generated: true }), "network");
	/* Une chaîne vide vient d'un champ effacé, pas d'un choix : elle doit
	   retomber sur le défaut comme une absence, sinon la pastille se vide. */
	r.check("une icône vide vaut une absence", moduleIcon({ icon: "" }, { generated: true }), "sparkles");
	/* Sans icône choisie, le NOM décide (2026-09-24) : un livre partout ne
	   disait rien de la matière. Noms réels des modules d'Ahmed. */
	r.check("le nom choisit l'icône d'un module sans choix", [
		moduleIcon({ name: "XTI305 - Ethical Hacking 1 - Initiation" }),
		moduleIcon({ name: "XTI303 - Conception & Architecture logicielle" }),
		moduleIcon({ name: "XTI302 - Administration système avancées & Scripting" }),
		moduleIcon({ name: "XCS319 - Outils de Veille en Cybersécurité" }),
		moduleIcon({ name: "XTI403 - CCNA 2" }),
	], ["hat-glasses", "blocks", "square-terminal", "radar", "router"]);
	/* En début de mot seulement : « écosystème » ne vaut pas « système », ni
	   « outils » le mot-clé « ui ». */
	r.check("un mot-clé au milieu d'un mot ne compte pas",
		[moduleIcon({ name: "Écosystème" }), moduleIcon({ name: "Outils" })], ["book", "book"]);
	r.check("un nom sans mot-clé garde le livre ; un choix l'emporte sur le nom",
		[moduleIcon({ name: "Divers" }), moduleIcon({ name: "XTI403 - CCNA 2", icon: "star" })], ["book", "star"]);
	r.done();
});

/* The default colour of a module with a code is the colour of its code
   PREFIX (2026-10-10): every XTI module shares one colour, every XCS another,
   in the palette of the former Moodle plugin; a chosen colour still wins, and
   a name without a code keeps the colour derived from it. */
await withSrcModule("src/dashboard/module-color.ts", async ({ moduleAccent, codePrefix, hashAccent }) => {
	const r = makeReporter("Module — default colour by code prefix");
	r.check("the prefix is read at the start of the name, or of the last path segment",
		[codePrefix("XTI303 - Conception"), codePrefix("Neo Quiz/XMUT401 - English"), codePrefix("Divers"), codePrefix("XTI303A")],
		["XTI", "XMUT", null, null]);
	r.check("two modules of the same prefix share one colour",
		moduleAccent({ folder: "XTI301 - Écosystème Python" }), moduleAccent({ folder: "XTI305 - Ethical Hacking" }));
	r.check("two prefixes have two colours",
		moduleAccent({ folder: "XTI301 - Python" }) !== moduleAccent({ folder: "XCS320 - Outils" }), true);
	r.check("a chosen colour wins over the prefix", moduleAccent({ folder: "XTI301 - Python", color: "#123456" }), "#123456");
	r.check("a name without a code keeps the derived colour", moduleAccent({ folder: "Divers" }), hashAccent("Divers"));
	r.done();
});

/* Chaque icône de la grille et des suggestions EXISTE dans le catalogue que
   l'application dessine (`lucide`) : un nom inconnu donne une pastille vide,
   sans la moindre erreur. */
await withSrcModule(["src/dashboard/module-icons.ts", "src/dashboard/icon-suggest.ts"], async (mi, is) => {
	const r = makeReporter("Module — les icônes existent");
	const { icons } = await import("../apps/windows/node_modules/lucide/dist/esm/lucide.mjs");
	const pascal = n => n.split("-").map(p => p[0].toUpperCase() + p.slice(1)).join("");
	const tous = [...new Set([...mi.MODULE_ICONS, ...is.iconesDesRegles()])];
	r.check("aucune icône inconnue de lucide", tous.filter(n => !icons[pascal(n)]), []);
	r.check("chaque suggestion est aussi dans la grille", is.iconesDesRegles().filter(n => !mi.MODULE_ICONS.includes(n)), []);
	r.done();
});

/* ONE CARD PER QUIZ (2026-10-10): the Learn, the Practice and the Exam of a
   course are three cards, each its own quiz. The grouping that brought them
   together (course-pairs.ts) is gone, and its cases with it. What stays is the
   title of a note whose block was switched to exam mode: its mode suffix is
   not in the title, and it still reads as "Practice" in the file explorer. */
await withSrcModule("src/quiz-format.ts", ({ titreSansMode }) => {
	const r = makeReporter("Quiz — titre sans suffixe de mode");
	const q = (path, title, mode) => ({ path, title, mode, questions: 20 });
	const D = "Efrei/B2/XTI301";
	const s = (base, mode) => q(`${D}/${base}.md`, titreSansMode(base, mode), mode);
	const kept = [s("CM1 — Learn", "learn"), s("CM1 — Practice", "exam"), s("TP1 — Exam (2)", "practice")];
	r.check("a Practice-named note in exam mode is titled without its suffix",
		[kept[1].title, kept[2].title], ["CM1", "TP1 (2)"]);
	r.done();
});

/* The card date (2026-10-10): the long form in the interface language, the
   short one for a phone, the time for the bubble. Local time, so the fixture
   is built with the Date constructor and not a UTC string. */
await withSrcModule("src/dashboard/card-date.ts", ({ cardDate }) => {
	const r = makeReporter("Carte — date de création");
	const ms = new Date(2026, 9, 9, 22, 30).getTime();
	r.check("the long date in French, then in English",
		[cardDate(ms, "fr").long, cardDate(ms, "en").long], ["9 octobre 2026", "October 9, 2026"]);
	r.check("the short date on a phone, the time 24-hour",
		[cardDate(ms, "fr").short, cardDate(ms, "fr").time], ["9 oct. 2026", "22:30"]);
	r.done();
});

await withSrcModule("src/dashboard/quiz-modules.ts", async ({ buildFolderGroups }) => {
	const r = makeReporter("Module — l'axe Dossier");
	const m = (name, path) => ({ folder: name, name, ue: null, path, quizzes: [], total: 0, mastered: 0 });
	const B2 = "Efrei/Bachelor/B2 (2026-2027)";
	const g = buildFolderGroups([
		m("XTI305", B2 + "/XTI305"), m("Generated", "Neo Quiz/Generated"), m("XTI301", B2 + "/XTI301"),
		m("Templates", "Personal/Templates"), m("Orphelin", undefined),
	]);
	r.check("un en-tête par dossier parent, alphabétique, le groupe sans chemin en dernier",
		g.map(x => [x.label, x.modules.map(y => y.name)]),
		[["B2 (2026-2027)", ["XTI301", "XTI305"]], ["Neo Quiz", ["Generated"]], ["Personal", ["Templates"]], ["", ["Orphelin"]]]);
	r.done();
});

await withSrcModule("src/dashboard/quiz-modules.ts", async ({ estLeSas }) => {
	const r = makeReporter("Module — reconnaître le SAS");
	const sas = "Neo Quiz/Generated";
	r.check("le dossier dont le CHEMIN est celui du sas", estLeSas({ folder: "Generated", path: sas }, sas), true);
	/* Le piège que le chemin évite : un dossier qui porte le même NOM ailleurs
	   dans le vault n'est pas le sas. */
	r.check("un homonyme ailleurs n'est pas le sas",
		estLeSas({ folder: "Generated", path: "Autre/Generated" }, sas), false);
	r.check("sans sas déclaré (le greffon), aucun dossier ne l'est",
		estLeSas({ folder: "Generated", path: sas }, undefined), false);
	r.check("un groupe sans chemin n'est jamais le sas", estLeSas({ folder: "Generated" }, sas), false);
	r.done();
});

/* A DECLARED FOLDER IS ONE WITH A PATH (2026-10-05): an override without one
   (an archive imported as "X (2)", then deleted from the disk) kept an empty
   "X" card on the page forever, with no path and nowhere to write. */
await withSrcModule("src/dashboard/quiz-modules.ts", async ({ declaredFolders, modulesAffiches }) => {
	const r = makeReporter("Module — dossiers déclarés");
	const overrides = {
		"XTI301": { color: "#3b82f6", path: "Neo Quiz/XTI301" },
		"XTI301 (2)": { name: "XTI301" },
		"Templates": { color: "#b6b6b6" },
	};
	r.check("seuls les overrides qui portent un chemin", declaredFolders(overrides), ["XTI301"]);
	r.check("aucun override", declaredFolders(undefined), []);
	const map = { byFolder: new Map(), ueOrder: [] };
	r.check("le fantôme sans chemin ne fait aucune carte",
		modulesAffiches([], {}, map, declaredFolders(overrides), [], undefined).map(g => g.folder), ["XTI301"]);
	/* A pathless override still dresses a folder its QUIZZES reveal: only the
	   empty card goes, never a folder with a quiz in it. */
	r.check("un dossier sans chemin déclaré garde sa carte s'il contient un quiz",
		modulesAffiches([{ path: "Personal/Templates/T.md", title: "T" }], {}, map, declaredFolders(overrides), [], undefined)
			.map(g => g.folder).sort(), ["Templates", "XTI301"]);
	r.done();
});

/* LE CHEMIN AU PIED D'UNE CARTE DE DOSSIER, coupé AU MILIEU (2026-09-27) :
   la tête (racine, intermédiaires) se tronque en CSS, la queue — le dernier
   segment avec son séparateur — reste entière. Une queue vide ou réduite à
   « / » tronquerait le dossier lui-même. */
await withSrcModule("src/dashboard/file-icons.ts", async ({ couperCheminAuMilieu }) => {
	const r = makeReporter("Carte de dossier — le chemin coupé au milieu");
	r.check("un chemin profond : la queue est le dernier segment",
		couperCheminAuMilieu("Efrei/Bachelor/B2 (2026-2027)/Reseaux"),
		{ tete: "Efrei/Bachelor/B2 (2026-2027)", queue: "/Reseaux" });
	r.check("la tête et la queue recomposent le chemin, rien n'est perdu",
		Object.values(couperCheminAuMilieu("Personal/Cours/Python")).join(""), "Personal/Cours/Python");
	r.check("une racine seule n'a pas de queue", couperCheminAuMilieu("Personal"), { tete: "Personal", queue: "" });
	r.check("la racine d'un dossier ouvert (chemin local vide) ne finit pas par « / »",
		couperCheminAuMilieu("Personal/"), { tete: "Personal", queue: "" });
	r.check("des séparateurs doublés ou inversés ne font pas une queue vide",
		couperCheminAuMilieu("Efrei//B2\\Reseaux/"), { tete: "Efrei/B2", queue: "/Reseaux" });
	r.done();
});

/* THE CLASS-SESSION LINE under a folder's title (2026-10-16,
   `src/dashboard/class-sessions-line.ts`): only the known parts, no total
   without a count and a length, nothing when the three are absent. */
await withSrcModule(["src/dashboard/class-sessions-line.ts", "src/i18n.ts", "src/class-sessions.ts"], async ({ classSessionsLine, sessionDuration }, i18n, cs) => {
	const r = makeReporter("Folder class sessions - line and reader");
	const nb = (s) => s.replace(/\u00a0/g, " ");
	const line = (s) => nb(classSessionsLine(s));
	i18n.setLanguage("en");
	r.check("durations: 5 h, 2 h 30, 1 h 05, 45 min, 27 h 30",
		[300, 150, 65, 45, 1650].map(m => nb(sessionDuration(m))), ["5 h", "2 h 30", "1 h 05", "45 min", "27 h 30"]);
	r.check("all three: count of length, rhythm, total", line({ count: 6, minutes: 300, perWeek: 1 }), "6 sessions of 5 h · 1 per week · 30 h");
	r.check("count and length: the total, no rhythm", line({ count: 11, minutes: 150 }), "11 sessions of 2 h 30 · 27 h 30");
	r.check("a single session: no total that repeats its length", line({ count: 1, minutes: 180 }), "1 session of 3 h");
	r.check("count alone: no total", line({ count: 4 }), "4 sessions");
	r.check("count and rhythm: no total", line({ count: 4, perWeek: 2 }), "4 sessions · 2 per week");
	r.check("rhythm and length, no count", line({ minutes: 150, perWeek: 1 }), "1 session of 2 h 30 per week");
	r.check("rhythm alone (plural)", line({ perWeek: 2 }), "2 sessions per week");
	r.check("length alone", line({ minutes: 45 }), "Sessions of 45 min");
	r.check("nothing known: nothing at all", classSessionsLine({}), "");
	r.check("the separator keeps the dot on the line before (no-break space)", classSessionsLine({ count: 6, perWeek: 1 }).includes("\u00a0· "), true);
	i18n.setLanguage("fr");
	r.check("FR: all three", line({ count: 6, minutes: 300, perWeek: 1 }), "6 séances de 5 h · 1 par semaine · 30 h");
	r.check("FR: rhythm and length", line({ minutes: 150, perWeek: 1 }), "1 séance de 2 h 30 par semaine");
	r.check("FR: one session", line({ count: 1, minutes: 180 }), "1 séance de 3 h");
	i18n.setLanguage("en");
	r.check("reader: damaged values are left out, never guessed",
		cs.readClassSessions({ sessions: "6", sessionMinutes: "14", sessionsPerWeek: 1 }), { count: 6 });
	r.check("reader: nothing stored, nothing read", cs.readClassSessions(undefined), {});
	r.check("typed input: empty clears, a valid value is kept, the rest is invalid",
		[cs.parseClassSessionInput("sessions", "  "), cs.parseClassSessionInput("sessions", " 12 "), cs.parseClassSessionInput("sessionMinutes", "601")],
		[{ kind: "empty" }, { kind: "value", v: "12" }, { kind: "invalid" }]);
	r.done();
});
