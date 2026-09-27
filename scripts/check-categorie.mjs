/**
 * LA CATÉGORIE D'UN QUIZ (`src/dashboard/categorie-quiz.ts`), sur le code réel.
 *
 * Ce qu'il empêche : un cours de Python pris pour du général parce que le
 * nom du PDF porte des majuscules ou des accents ; la lettre C d'une phrase
 * (« c'est ») prise pour le langage C ; un dossier qui l'emporte sur la
 * pièce jointe ; et une égalité tranchée au hasard au lieu de `general`.
 *
 *     npm run check:categorie
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/categorie-quiz.ts", ({ CATEGORIES, detecterCategorie, categorieChoisie, estCategorie }) => {
	const r = makeReporter("Catégorie d'un quiz");
	const d = (indices) => detecterCategorie(indices);

	r.check("les catégories connues, general d'abord", CATEGORIES, ["general", "python", "c", "bash", "sql", "web", "maths", "reseau"]);
	r.check("rien : general", [d({}), d({ pieces: [], dossier: "", demande: "   " })], ["general", "general"]);

	// 1. Les pièces jointes.
	r.check("pièce jointe : chaque catégorie par son nom de fichier",
		[
			"CM1 - Introduction à Python.pdf", "TP C - Pointeurs.pdf", "Cours Linux.pdf", "TD Bases de données.pdf",
			"HTML et CSS.md", "Mathématiques - Second degré.pdf", "Réseaux - Adressage IP.pdf", "Histoire.pdf",
		].map(p => d({ pieces: [p] })),
		["python", "c", "bash", "sql", "web", "maths", "reseau", "general"]);
	r.check("pièce jointe : un fichier .py, .c, .sh", [d({ pieces: ["exo.py"] }), d({ pieces: ["main.c"] }), d({ pieces: ["install.sh"] })], ["python", "c", "bash"]);
	r.check("pièce jointe : la majorité des fichiers l'emporte",
		d({ pieces: ["CM1 Python.pdf", "CM2 Python.pdf", "Annexe SQL.pdf"] }), "python");
	r.check("pièce jointe : égalité entre deux catégories → on passe à l'indice suivant",
		[d({ pieces: ["Python.pdf", "SQL.pdf"] }), d({ pieces: ["Python.pdf", "SQL.pdf"], dossier: "Efrei/SQL" })], ["general", "sql"]);

	// 2. Le dossier de destination.
	r.check("dossier : un segment du chemin", [d({ dossier: "Efrei/Programmation Python/CM" }), d({ dossier: "Efrei/Programmation C" })], ["python", "c"]);
	r.check("dossier : la pièce jointe l'emporte sur le dossier", d({ pieces: ["Cours SQL.pdf"], dossier: "Efrei/Python" }), "sql");

	// 3. La demande.
	r.check("demande : les mots du sujet",
		[d({ demande: "Fais un quiz sur les listes en Python" }), d({ demande: "les pointeurs en C" }), d({ demande: "quiz sur les requêtes SQL et les jointures" }), d({ demande: "le modèle OSI et TCP" })],
		["python", "c", "sql", "reseau"]);
	r.check("demande : la lettre c d'une phrase n'est pas le langage C",
		[d({ demande: "c'est un cours d'histoire" }), d({ demande: "Écris un quiz, c est urgent" }), d({ demande: "en cours de route" })], ["general", "general", "general"]);
	r.check("demande : un mot inclus dans un autre ne compte pas (pythonesque, sqlite reste sql)",
		[d({ demande: "un humour pythonesque" }), d({ demande: "sqlite en pratique" })], ["general", "sql"]);
	r.check("le dossier l'emporte sur la demande", d({ dossier: "Cours/Réseau", demande: "un quiz Python" }), "reseau");
	r.check("demande à égalité : general", d({ demande: "Python et SQL" }), "general");

	// Le choix de l'utilisateur.
	r.check("choix Automatique : la détection ; choix explicite : lui, même general",
		[categorieChoisie("auto", { pieces: ["Python.pdf"] }), categorieChoisie("maths", { pieces: ["Python.pdf"] }), categorieChoisie("general", { pieces: ["Python.pdf"] })],
		["python", "maths", "general"]);
	r.check("estCategorie : les seules valeurs connues", [estCategorie("python"), estCategorie("auto"), estCategorie("Python"), estCategorie(3)], [true, false, false, false]);
	r.done();
});
