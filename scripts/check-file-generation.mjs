/**
 * LA FILE DE GÉNÉRATION — le noyau pur (`src/dashboard/file-generation.ts`).
 *
 * Ce que ce script empêche : deux générations lancées de front (le verrou
 * par outil du processus principal refuserait la seconde), une demande qui
 * passe devant une autre envoyée avant elle, une suivante qui démarre alors
 * que le processus annulé n'a pas encore rendu la main, un réessai qui
 * repart en tête de file, et une ligne en cours qu'une croix ferait
 * disparaître sans rien arrêter.
 *
 *     npm run check:file-generation
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/file-generation.ts", (F) => {
	const r = makeReporter("File de génération — noyau pur");
	const etats = (f) => f.lignes.map(l => `${l.demande}:${l.etat}`).join(" ");

	// Trois envois de suite : CM1, TP1, TD1.
	let f = F.fileVide();
	for (const d of ["CM1", "TP1", "TD1"]) f = F.ajouter(f, d).file;
	const avant = f;
	r.check("trois envois : trois lignes en attente, dans l'ordre d'envoi", etats(f), "CM1:attente TP1:attente TD1:attente");
	r.check("des identifiants distincts et croissants", f.lignes.map(l => l.id), [1, 2, 3]);

	let d = F.demarrerSuivant(f, 1000);
	f = d.file;
	r.check("démarrer : la PREMIÈRE envoyée part", d.ligne?.demande, "CM1");
	r.check("le départ garde l'heure donnée, pas une horloge", d.ligne?.debut, 1000);
	r.check("la file d'origine n'est pas mutée", etats(avant), "CM1:attente TP1:attente TD1:attente");

	d = F.demarrerSuivant(f, 2000);
	r.check("une seule à la fois : rien ne part tant qu'une tourne", [d.ligne, etats(d.file)], [null, "CM1:cours TP1:attente TD1:attente"]);

	// Annuler une ligne EN ATTENTE : elle quitte la file, rien à tuer.
	let a = F.annuler(f, 3);
	f = a.file;
	r.check("annuler en attente : la ligne quitte la file, sans processus à tuer", [etats(f), a.arreter], ["CM1:cours TP1:attente", false]);

	// Fin de CM1 : prête, puis TP1 part.
	f = F.terminer(f, 1, { titre: "CM1 — Learn" });
	r.check("terminer : la ligne est prête et garde son résultat", [F.ligne(f, 1)?.etat, F.ligne(f, 1)?.resultat?.titre], ["prete", "CM1 — Learn"]);
	d = F.demarrerSuivant(f, 3000);
	f = d.file;
	r.check("la suivante démarre dès que la précédente est prête", d.ligne?.demande, "TP1");

	// Annuler la ligne EN COURS : elle passe en arrêt et OCCUPE la place.
	f = F.ajouter(f, "TP2").file;
	a = F.annuler(f, 2);
	f = a.file;
	r.check("annuler en cours : un processus à tuer, la ligne passe en arrêt", [a.arreter, F.ligne(f, 2)?.etat], [true, "arret"]);
	r.check("rien ne démarre avant que le processus annulé rende la main", F.demarrerSuivant(f, 4000).ligne, null);
	r.check("une réponse arrivée après l'annulation est ignorée", F.ligne(F.terminer(f, 2, { titre: "x" }), 2)?.etat, "arret");
	f = F.solder(f, 2);
	r.check("solder retire la ligne annulée", etats(f), "CM1:prete TP2:attente");
	d = F.demarrerSuivant(f, 5000);
	f = d.file;
	r.check("la suivante part après l'annulation", d.ligne?.demande, "TP2");

	// Échec puis réessai : la demande repasse DERRIÈRE celles qui attendaient.
	f = F.ajouter(f, "TP3").file;
	f = F.echouer(f, 4, "compte non connecté");
	r.check("échouer : l'erreur est gardée", [F.ligne(f, 4)?.etat, F.ligne(f, 4)?.erreur], ["echouee", "compte non connecté"]);
	f = F.reessayer(f, 4);
	r.check("réessayer remet la demande en FIN de file", etats(f), "CM1:prete TP3:attente TP2:attente");
	d = F.demarrerSuivant(f, 6000);
	r.check("après un réessai, l'ordre d'envoi des autres est conservé", d.ligne?.demande, "TP3");
	f = d.file;

	// La croix : seulement sur une ligne terminée.
	r.check("la croix ne ferme pas une ligne en cours", etats(F.fermer(f, 5)), etats(f));
	r.check("la croix ne ferme pas une ligne en attente", etats(F.fermer(f, 4)), etats(f));
	f = F.fermer(f, 1);
	r.check("la croix ferme une ligne prête", etats(f), "TP3:cours TP2:attente");
	f = F.echouer(f, 5, "boom");
	f = F.fermer(f, 5);
	r.check("la croix ferme une ligne échouée", etats(f), "TP2:attente");
	r.check("réessayer une ligne qui n'a pas échoué ne fait rien", etats(F.reessayer(f, 4)), "TP2:attente");
	r.check("annuler une ligne inconnue ne fait rien", F.annuler(f, 99).arreter, false);

	// ÉCHEC D'ENREGISTREMENT : le quiz produit n'est jamais perdu, et le
	// nouvel essai n'est qu'une écriture — un seul lancement de CLI au total.
	let g = F.fileVide();
	let lancements = 0;
	const demarrer = (t) => { const x = F.demarrerSuivant(g, t); g = x.file; if (x.ligne) lancements++; return x.ligne; };
	g = F.ajouter(g, { texte: "CM4" }).file;
	g = F.ajouter(g, { texte: "CM5" }).file;
	demarrer(100);
	g = F.echouerEnregistrement(g, 1, "disque plein", { texte: "CM4", produit: ["q1", "q2"] });
	const echec = F.ligne(g, 1);
	r.check("échec d'enregistrement : la ligne échoue en gardant le quiz produit",
		[echec?.etat, echec?.echec, echec?.demande.produit], ["echouee", "enregistrement", ["q1", "q2"]]);
	r.check("« Réessayer » (la génération) est refusé : il relancerait le CLI", F.ligne(F.reessayer(g, 1), 1)?.etat, "echouee");
	demarrer(200);
	r.check("la file continue avec la demande suivante", F.ligne(g, 2)?.etat, "cours");
	// CM5 finit : la file est libre, un réessai qui passerait par elle relancerait le CLI.
	g = F.terminer(g, 2, { titre: "CM5 — Learn" });
	g = F.reessayerEnregistrement(g, 1);
	r.check("réessayer l'enregistrement : la ligne réécrit, à sa place", [F.ligne(g, 1)?.etat, g.lignes.map(l => l.id)], ["enregistrement", [1, 2]]);
	r.check("l'essai d'enregistrement n'occupe pas la file et ne relance rien", demarrer(300), null);
	g = F.echouerEnregistrement(g, 1, "encore plein", { texte: "CM4", produit: ["q1", "q2"] });
	g = F.reessayerEnregistrement(g, 1);
	g = F.terminer(g, 1, { titre: "CM4 — Learn" });
	r.check("le second essai aboutit : la ligne est prête", F.ligne(g, 1)?.etat, "prete");
	r.check("un seul lancement de CLI pour CM4, un pour CM5", lancements, 2);
	g = F.ajouter(g, { texte: "CM6" }).file;
	demarrer(400);
	r.check("réessayer l'enregistrement d'un échec de GÉNÉRATION ne fait rien",
		F.ligne(F.reessayerEnregistrement(F.echouer(g, 3, "boom"), 3), 3)?.etat, "echouee");

	r.done();
});

/* LA RÉCEPTION D'UNE GÉNÉRATION (lot D, 2026-09-27) : `brouillonDe`
   (`src/dashboard/generation-demande.ts`) est le premier point du chemin de
   retour qui relit le tableau brut rendu par le modèle — file comme canal
   web (`ai.ts`) l'appellent tel quel. Le glossaire écrit dans l'objet de
   configuration final doit y survivre, PAS finir dans une question fantôme
   ni disparaître avec le reste de la configuration. */
await withSrcModule("src/dashboard/generation-demande.ts", ({ brouillonDe, nombreDeQuestions }) => {
	const r = makeReporter("Réception d'une génération — glossaire");
	const genere = [
		{ title: "Q", prompt: "Qu'est-ce qu'une pile ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que." },
		{ mode: "quiz", glossary: [{ term: "pile", definition: "Structure **LIFO**.", aliases: ["LIFO"] }] },
	];
	const draft = brouillonDe(genere);
	r.check("le glossaire généré traverse brouillonDe jusqu'au brouillon",
		draft.examOptions?.glossary, [{ term: "pile", definition: "Structure **LIFO**.", aliases: ["LIFO"] }]);
	r.check("l'objet de configuration ne devient pas une question",
		draft.questions.length, 1);
	r.check("sans glossaire dans la réponse : un brouillon sans glossaire, pas une erreur",
		brouillonDe([genere[0]]).examOptions, null);

	/* LE COMPTEUR DE LA FILE (lot D, régression relevée en revue) :
	   `ResultatFile.questions` et le `questionCount` journalisé dans l'usage
	   (`file-generation-app.ts`) comptent `nombreDeQuestions`, jamais
	   `questions.length` tout court — sans quoi ajouter un glossaire à un
	   Practice de deux questions en affichait trois. Discriminant : le même
	   tableau, avec et sans configuration finale, doit rendre le MÊME compte. */
	r.check("nombreDeQuestions : l'objet de configuration final n'est pas une question",
		nombreDeQuestions(genere), 1);
	r.check("nombreDeQuestions : sans configuration, inchangé",
		nombreDeQuestions([genere[0]]), 1);
	r.check("nombreDeQuestions : une configuration SCINDÉE en deux objets ne compte que pour un objet",
		nombreDeQuestions([genere[0], { mode: "quiz" }, { glossary: [{ term: "pile", definition: "LIFO." }] }]), 1);
	r.done();
});

/* "N QUIZZES <-> 1 QUIZ" AND THE NAME OF AN EXAM (spec 2026-09-29 §4.3-§4.5),
   through the real `generation-demande.ts`: the split rule now takes the
   user's choice, the toggle's default follows the mode, and a request over
   SEVERAL documents made as ONE quiz is named after the destination folder
   (the module), with no Learn to follow. `enregistrerQuiz` runs against an
   in-memory host, so the note's real path and frontmatter are what is
   checked, not a copy of the naming rule. */
await withSrcModule(["src/dashboard/generation-demande.ts", "src/host/current.ts", "src/quiz-format.ts"], async (gd, hote, format) => {
	const r = makeReporter("N quizzes <-> 1 quiz, name of a Test");
	const doc = (name) => ({ name, content: "texte " + name, source: "file" });
	const msg = (docs, images = 0) => ({ text: "Fais un quiz", notes: docs.map(doc), images: Array.from({ length: images }, () => ({ file: {} })) });
	const noms = (msgs) => msgs.map(m => m.notes.map(n => n.name));

	r.check("split: N quizzes (one per document) when not chosen as one quiz",
		noms(gd.decouperParFichier(msg(["CM1.md", "CM2.md", "CM3.md"]), false)), [["CM1.md"], ["CM2.md"], ["CM3.md"]]);
	r.check("split: ONE quiz over every document when chosen",
		noms(gd.decouperParFichier(msg(["CM1.md", "CM2.md", "CM3.md"]), true)), [["CM1.md", "CM2.md", "CM3.md"]]);
	r.check("split: an image keeps ONE quiz whatever the choice",
		[false, true].map(c => noms(gd.decouperParFichier(msg(["CM1.md", "CM2.md"], 1), c))), [[["CM1.md", "CM2.md"]], [["CM1.md", "CM2.md"]]]);
	r.check("split: a single document is never split",
		[false, true].map(c => noms(gd.decouperParFichier(msg(["CM1.md"]), c))), [[["CM1.md"]], [["CM1.md"]]]);
	r.check("split: each sub-request keeps the instruction",
		gd.decouperParFichier(msg(["CM1.md", "CM2.md"]), false).map(m => m.text), ["Fais un quiz", "Fais un quiz"]);

	r.check("the toggle is offered with at least two documents and no image",
		[[0, 0], [1, 0], [2, 0], [5, 0], [2, 1], [1, 1], [0, 2]].map(([d, i]) => gd.canChooseQuizCount(d, i)), [false, false, true, true, false, false, false]);
	/* An in-memory host: the destination folder, the files already there, and
	   what was written. Only what `enregistrerQuiz` reaches is provided. */
	const ecrits = new Map();
	const existants = new Set();
	const notices = [];
	hote.installHost({
		fs: {
			mkdirs: async () => {},
			exists: async (p) => existants.has(p),
			write: async (p, contenu) => { ecrits.set(p, contenu); existants.add(p); },
			getFile: () => null,
		},
		paths: {
			contractPath: (root, local) => root + "/" + local,
			defaultRoot: () => ({ id: "R", name: "Neo Quiz" }),
			localPath: (p) => (p === "R" ? "" : p.replace(/^R\//, "")),
			rootOf: () => ({ id: "R", name: "Neo Quiz" }),
		},
		ui: { notice: (m) => notices.push(m) },
	});
	const scanner = { scanFile: async () => {}, getQuiz: (p) => ({ path: p }), getQuizzes: () => [] };
	const reglages = { aiProvider: "claude-cli", aiModel: "m", aiEffort: "medium", aiOutputFolder: "Quizzes" };
	const question = { title: "Q", prompt: "Énoncé ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que." };
	const enregistrer = async (mode, docs, { destination = "R/Cours/Réseaux", noteLearn } = {}) => {
		const questions = [question];
		const entry = await gd.enregistrerQuiz({
			draft: gd.brouillonDe(questions), questions, modeDemande: mode, demande: { text: "Fais un quiz", notes: docs.map(n => ({ name: n })) },
			destination, reglages, usage: null, noteLearn, planTranches: undefined, scanner,
		});
		return { path: entry?.path, contenu: entry ? ecrits.get(entry.path) : undefined };
	};

	let e = await enregistrer("practice", ["CM1.pdf"]);
	r.check("Test, one document: <course> — Practice.md, source = the course",
		[e.path, /\n\s+source: "CM1"\n/.test(e.contenu)], ["R/Cours/Réseaux/CM1 — Practice.md", true]);
	e = await enregistrer("practice", ["CM1.pdf", "CM2.pdf", "CM3.pdf"]);
	r.check("Test, several documents in ONE quiz: <module> — Practice.md, source = the module",
		[e.path, /\n\s+source: "Réseaux"\n/.test(e.contenu)], ["R/Cours/Réseaux/Réseaux — Practice.md", true]);
	e = await enregistrer("practice", ["CM1.pdf", "CM2.pdf"]);
	r.check("the same module, a second Test: freeNotePath's counter", e.path, "R/Cours/Réseaux/Réseaux — Practice (2).md");
	e = await enregistrer("practice", ["CM1.pdf", "CM2.pdf"], { destination: "R" });
	r.check("a module that is the root itself: the root's name", e.path, "R/Neo Quiz — Practice.md");
	e = await enregistrer("practice", ["CM1.pdf"], { noteLearn: "CM1 — Learn" });
	r.check("Test on ONE document keeps its learn: link",
		[e.path, /learn: "?\[\[CM1 — Learn\]\]"?/.test(e.contenu)], ["R/Cours/Réseaux/CM1 — Practice (2).md", true]);
	r.check("a generated Test carries no exam configuration: it reads back as a plain Test",
		(() => { const items = format.lireBlocQuiz(e.contenu); return [format.modeDuBloc(items), items.some(it => it && it.examDurationMinutes !== undefined)]; })(), ["practice", false]);

	/* `lienLearn`: never for a Test over several documents. */
	const learn = { path: "R/Cours/Réseaux/CM1 — Learn.md", basename: "CM1 — Learn", mode: "learn", generated: { source: "CM1", generatedAt: "2026-09-23T10:00:00Z" } };
	const avecLearn = { getQuizzes: () => [learn] };
	const lu = async (mode, docs) => Object.keys(await gd.lienLearn(avecLearn, mode, "R/Cours/Réseaux", msg(docs)));
	hote.uninstallHost();
	/* The Learn note holds a real slice plan: without one `lienLearn` finds
	   nothing whatever the rule, and the cases below would prove nothing. */
	const noteLearn = ["```quiz-blocks", "[{ title: 'Types', prompt: 'x', role: 'read', slice: 1 }]", "```", ""].join("\n");
	hote.installHost({ fs: { read: async () => noteLearn }, ui: { notice: () => {} } });
	r.check("lienLearn: a Practice on ONE document follows its Learn (the control the next case relies on)",
		await lu("practice", ["CM1.md"]), ["plan", "note"]);
	r.check("lienLearn: nothing for a Test over several documents (no single Learn to follow), nor for a Learn",
		[await lu("practice", ["CM1.md", "CM2.md"]), await lu("learn", ["CM1.md"])], [[], []]);
	hote.uninstallHost();
	r.done();
});
