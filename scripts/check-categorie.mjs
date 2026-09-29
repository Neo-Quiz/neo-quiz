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

	/* The ids are PERSISTED with a queued request: the original eight, from
	   2026-09-26, must never be renamed or dropped (their ORDER is display
	   only). */
	r.check("known subjects: general first", CATEGORIES[0], "general");
	r.check("known subjects: the original eight kept", ["general", "python", "c", "bash", "sql", "web", "maths", "reseau"].filter(c => !CATEGORIES.includes(c)), []);
	r.check("known subjects: no duplicate id", new Set(CATEGORIES).size, CATEGORIES.length);
	r.check("rien : general", [d({}), d({ pieces: [], dossier: "", demande: "   " })], ["general", "general"]);

	// 1. Les pièces jointes.
	r.check("pièce jointe : chaque catégorie par son nom de fichier",
		[
			"CM1 - Introduction à Python.pdf", "TP C - Pointeurs.pdf", "Cours Linux.pdf", "TD Bases de données.pdf",
			"HTML et CSS.md", "Mathématiques - Second degré.pdf", "Réseaux - Adressage IP.pdf", "Recettes de cuisine.pdf",
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
		[d({ demande: "c'est un cours de cuisine" }), d({ demande: "Écris un quiz, c est urgent" }), d({ demande: "en cours de route" })], ["general", "general", "general"]);
	r.check("demande : un mot inclus dans un autre ne compte pas (pythonesque, sqlite reste sql)",
		[d({ demande: "un humour pythonesque" }), d({ demande: "sqlite en pratique" })], ["general", "sql"]);
	r.check("le dossier l'emporte sur la demande", d({ dossier: "Cours/Réseau", demande: "un quiz Python" }), "reseau");
	r.check("demande à égalité : general", d({ demande: "physique et chimie" }), "general");

	// Le choix de l'utilisateur.
	r.check("choix Automatique : la détection ; choix explicite : lui, même general",
		[categorieChoisie("auto", { pieces: ["Python.pdf"] }), categorieChoisie("maths", { pieces: ["Python.pdf"] }), categorieChoisie("general", { pieces: ["Python.pdf"] })],
		["python", "maths", "general"]);
	// The subjects added on 2026-09-29.
	r.check("new subjects: by file name",
		["TP C++ - Classes.pdf", "Cours Java.pdf", "Intro C#.pdf", "Thermodynamique.pdf", "Chimie organique.pdf", "Biologie cellulaire.pdf",
			"Histoire - Guerre froide.pdf", "Droit des contrats.pdf", "Anglais - TOEIC.pdf", "Code de la route.pdf", "Cybersécurité - OWASP.pdf"].map(p => d({ pieces: [p] })),
		["cpp", "java", "csharp", "physique", "chimie", "bio", "histoire", "droit", "anglais", "conduite", "secu"]);
	r.check("C++ and C# are not C", [d({ pieces: ["cours c++.pdf"] }), d({ pieces: ["cours c#.pdf"] }), d({ pieces: ["main.cpp"] }), d({ pieces: ["Program.cs"] })], ["cpp", "csharp", "cpp", "csharp"]);
	r.check("javascript is web, not java", d({ pieces: ["Javascript avancé.pdf"] }), "web");
	r.check("a broad subject gives way to a specific one (histoire de Python, gestion mémoire)",
		[d({ demande: "l'histoire de Python" }), d({ demande: "la gestion de la mémoire virtuelle" }), d({ demande: "les équations du mouvement en physique" })],
		["python", "os", "physique"]);
	r.check("neural networks are AI, not networking", d({ demande: "les réseaux de neurones" }), "ia");
	r.check("a language named in a sentence is the quiz's language, not its subject",
		[d({ demande: "un quiz en anglais sur la Révolution française" }), d({ demande: "fais-le en français" })], ["histoire", "general"]);
	r.check("a language named in a file name is the subject", [d({ pieces: ["Anglais S3.pdf"] }), d({ pieces: ["Espagnol.pdf"] })], ["anglais", "espagnol"]);
	r.check("folder: the deepest segment wins",
		[d({ dossier: "Efrei/Bachelor Cybersécurité/XTI301 - Écosystème Python" }), d({ dossier: "Efrei/Bachelor Cybersécurité/XTI305 - Ethical Hacking 1" }), d({ dossier: "Efrei/Bachelor Cybersécurité/Divers" })],
		["python", "secu", "secu"]);

	// The lexicon (2026-09-29): school and university notions, not a few words.
	r.check("lexicon: notions name their subject",
		["nombres relatifs", "math", "les fractions en 4ème", "théorème de Pythagore", "les vecteurs", "la loi d'Ohm", "l'oxydoréduction",
			"la photosynthèse", "la Révolution française", "le passé simple et le subjonctif", "les figures de style", "l'offre et la demande",
			"le seuil de rentabilité", "les biais cognitifs", "la descente de gradient", "les tables de hachage", "le modèle OSI", "docker et kubernetes"].map(demande => d({ demande })),
		["maths", "maths", "maths", "maths", "maths", "physique", "chimie", "bio", "histoire", "francais", "litterature", "eco", "gestion", "psycho", "ia", "algo", "reseau", "cloud"]);
	r.check("lexicon: an everyday word is not a subject (vue, coût, déterminant)",
		[d({ demande: "un point de vue critique" }), d({ demande: "le coût de la vie" })], ["general", "general"]);
	r.check("a phrase belongs to one subject (injection SQL, fibre optique, binôme de Newton)",
		[d({ demande: "l'injection SQL" }), d({ demande: "la fibre optique" }), d({ demande: "le binôme de Newton" })], ["secu", "reseau", "maths"]);
	r.check("a programming language gives way to the field it serves",
		[d({ demande: "les algorithmes de tri en Python" }), d({ demande: "les listes en Python" })], ["algo", "python"]);
	r.check("languages: a study word or a file name makes the subject",
		[d({ demande: "vocabulaire arabe" }), d({ demande: "apprendre le japonais" }), d({ demande: "cours d'italien" }), d({ demande: "Korean grammar" }),
			d({ demande: "les hiragana" }), d({ pieces: ["Italien - Leçon 3.pdf"] }), d({ pieces: ["Chinois.pdf"] })],
		["arabe", "japonais", "italien", "coreen", "japonais", "italien", "chinois"]);
	r.check("languages: a language name in a file with another subject is that subject",
		d({ pieces: ["Histoire en français.pdf"] }), "histoire");

	r.check("an .html attachment is a document first: its name, the folder, the request decide before its extension",
		[d({ pieces: ["revision-xti301.html"], dossier: "Efrei/XTI301 - Écosystème Python" }),
			d({ pieces: ["python-cheatsheet.html"] }),
			d({ pieces: ["revision.html"], demande: "les listes en Python" }),
			d({ pieces: ["index.html"] }),
			d({ pieces: ["index.html", "style.css"], dossier: "Efrei/XTI301 - Écosystème Python" })],
		["python", "python", "python", "web", "web"]);

	r.check("estCategorie : les seules valeurs connues", [estCategorie("python"), estCategorie("auto"), estCategorie("Python"), estCategorie(3)], [true, false, false, false]);
	r.done();
});
