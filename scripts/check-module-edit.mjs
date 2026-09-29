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

/* ONE COURSE, ONE CARD (2026-09-24, three modes since 2026-09-29, spec
   2026-09-29-test-practice-exam-design §5.2): the Learn, the Practice and the
   Exam of a course — same folder, same title, at most one quiz per mode —
   are brought together, Learn first, then Practice, then Exam. */
await withSrcModule("src/dashboard/course-pairs.ts", async ({ regrouperParCours, quizFreres }) => {
	const r = makeReporter("Course — its modes brought together");
	const q = (path, title, mode) => ({ path, title, mode, questions: 20 });
	const D = "Efrei/B2/XTI301";
	const nom = (x) => x.path.split("/").pop();
	const liste = [
		q(`${D}/CM1 — Exam.md`, "CM1", "exam"), q(`${D}/CM1 — Practice.md`, "CM1", "practice"), q(`${D}/CM1 — Learn.md`, "CM1", "learn"),
		q(`${D}/CM2 — Learn.md`, "CM2", "learn"), q(`${D}/TP1 — Practice.md`, "TP1", "practice"), q(`${D}/TP1 — Exam.md`, "TP1", "exam"),
		q(`Autre/CM2 — Practice.md`, "CM2", "practice"),
	];
	const cartes = regrouperParCours(liste, true);
	r.check("a course = one card with its modes by order, in place of its first quiz",
		cartes.map(c => [nom(c.quiz), c.freres.map(nom)]),
		[["CM1 — Learn.md", ["CM1 — Practice.md", "CM1 — Exam.md"]], ["CM2 — Learn.md", []], ["TP1 — Practice.md", ["TP1 — Exam.md"]], ["CM2 — Practice.md", []]]);
	r.check("the other modes of a quiz, by order", quizFreres(liste[0], liste).map(nom), ["CM1 — Learn.md", "CM1 — Practice.md"]);
	r.check("a namesake in ANOTHER folder is not brought together", quizFreres(liste[3], liste), []);
	r.check("two quizzes of the same mode do not form a course",
		quizFreres(q(`${D}/X.md`, "X", "learn"), [q(`${D}/X.md`, "X", "learn"), q(`${D}/X 2.md`, "X", "learn")]), []);
	r.check("two of one mode among three: no course either",
		quizFreres(q(`${D}/Y.md`, "Y", "exam"), [q(`${D}/Y.md`, "Y", "exam"), q(`${D}/Y 2.md`, "Y", "exam"), q(`${D}/Y — Learn.md`, "Y", "learn")]), []);
	r.check("setting off: one card per quiz", regrouperParCours(liste, false).map(c => c.freres.length), [0, 0, 0, 0, 0, 0, 0]);
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
