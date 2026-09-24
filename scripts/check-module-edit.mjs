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
