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

	/* A RELOADED PAGE (2026-09-30): the queue saved before the reload comes
	   back. The running line stays running (it attaches to its CLI), unless
	   its answer had arrived: then only the note is left to write. A line
	   being stopped is gone. New lines never reuse an id — a resume key is
	   built from it. */
	let h = F.fileVide();
	for (const x of [{ texte: "A" }, { texte: "B" }, { texte: "C" }]) h = F.ajouter(h, x).file;
	h = F.demarrerSuivant(h, 700).file;
	r.check("completer: the answer rides with the running line", F.ligne(F.completer(h, 1, { texte: "A", produit: ["q"] }), 1)?.demande.produit, ["q"]);
	r.check("completer: never on a waiting line", F.ligne(F.completer(h, 2, { texte: "B", produit: ["q"] }), 2)?.demande.produit, undefined);
	const aProduit = (dm) => !!dm.produit;
	let rest = F.restaurer(h, aProduit);
	r.check("restaurer: the running line keeps running, with its start time", [F.ligne(rest, 1)?.etat, F.ligne(rest, 1)?.debut], ["cours", 700]);
	rest = F.restaurer(F.completer(h, 1, { texte: "A", produit: ["q"] }), aProduit);
	r.check("restaurer: a running line whose answer arrived only writes its note",
		[F.ligne(rest, 1)?.etat, F.ligne(rest, 1)?.demande.produit], ["enregistrement", ["q"]]);
	r.check("restaurer: its note write does not take the queue's place", F.demarrerSuivant(rest, 800).ligne?.demande.texte, "B");
	rest = F.restaurer(F.annuler(h, 1).file, aProduit);
	r.check("restaurer: a line being stopped is gone", rest.lignes.map(l => l.id), [2, 3]);
	r.check("restaurer: new ids never reuse an old one", F.ajouter(F.restaurer({ lignes: h.lignes, prochainId: 1 }, aProduit), { texte: "D" }).id, 4);

	// Chats (2026-10-02): a restored line keeps the chat and the request it was sent in;
	// a line saved before chats carries none and stays valid.
	{
		let q = F.fileVide();
		q = F.ajouter(q, { text: "a", chatId: "c1", requestId: "r1", sentAt: 5 }).file;
		q = F.ajouter(q, { text: "old" }).file;
		const re = F.restaurer(JSON.parse(JSON.stringify(q)), () => false);
		r.check("a restored line keeps its chat, its request and its send time", [re.lignes[0].demande.chatId, re.lignes[0].demande.requestId, re.lignes[0].demande.sentAt], ["c1", "r1", 5]);
		r.check("a line saved before chats is restored with none of them", [re.lignes[1].demande.chatId, re.lignes[1].demande.requestId], [undefined, undefined]);
	}

	/* CONCURRENT CHATS (2026-10-09, spec 2026-10-09-concurrent-chats-design):
	   one running line per chat, chats side by side up to 8, Antigravity and
	   remote requests one at a time across chats. */
	{
		const regles = { max: 8, chat: d => d.chat ?? "legacy", groupe: d => (d.agy ? "agy" : d.remote ? "remote" : null) };
		const lance = (g, t) => F.demarrerPrets(g, t, regles);
		let g = F.fileVide();
		g = F.ajouter(g, { chat: "A" }).file;
		g = F.ajouter(g, { chat: "B" }).file;
		g = F.ajouter(g, { chat: "A" }).file;
		let x = lance(g, 10);
		r.check("two chats start together, the second request of chat A waits", [x.lignes.map(l => l.id), x.file.lignes.map(l => l.etat)], [[1, 2], ["cours", "cours", "attente"]]);
		g = F.terminer(x.file, 1, { titre: "q", chemin: "q.md" });
		x = lance(g, 20);
		r.check("chat A's next request starts once its first is done", [x.lignes.map(l => l.id), x.lignes[0]?.debut], [[3], 20]);
		// A stopped line holds its chat until it is settled.
		let h = F.fileVide();
		h = F.ajouter(h, { chat: "A" }).file;
		h = F.ajouter(h, { chat: "A" }).file;
		h = lance(h, 1).file;
		h = F.annuler(h, 1).file;
		r.check("a stopped line (arret) still holds its chat", lance(h, 2).lignes, []);
		h = F.solder(h, 1);
		r.check("… and frees it once settled", lance(h, 3).lignes.map(l => l.id), [2]);
		// The global cap.
		let k = F.fileVide();
		for (let i = 0; i < 10; i++) k = F.ajouter(k, { chat: "C" + i }).file;
		const pk = lance(k, 1);
		r.check("at most 8 run at once, in send order", [pk.lignes.length, pk.lignes.map(l => l.id).join(",")], [8, "1,2,3,4,5,6,7,8"]);
		r.check("past the cap, nothing more starts", lance(pk.file, 2).lignes, []);
		// Groups.
		let m = F.fileVide();
		m = F.ajouter(m, { chat: "A", agy: true }).file;
		m = F.ajouter(m, { chat: "B", agy: true }).file;
		m = F.ajouter(m, { chat: "C" }).file;
		m = F.ajouter(m, { chat: "D", remote: true }).file;
		m = F.ajouter(m, { chat: "E", remote: true }).file;
		r.check("Antigravity waits for Antigravity, not Claude; a remote request waits for a remote one", lance(m, 1).lignes.map(l => l.id), [1, 3, 4]);
		// A line without a chat belongs to the legacy chat.
		let n = F.fileVide();
		n = F.ajouter(n, {}).file;
		n = F.ajouter(n, {}).file;
		r.check("two lines without a chat share the legacy chat", lance(n, 1).lignes.map(l => l.id), [1]);
		r.check("nothing waiting: nothing starts, the same file", (() => { const e = F.fileVide(); return lance(e, 1).file === e; })(), true);
	}

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

/* U2 (2026-10-01): "N quizzes" is ONE generation over ALL the documents
   (`decouperParFichier` with `enUnePasse`), whose answer holds one quiz per
   document; `enregistrerLot` writes one note per document, named exactly as the
   per-document generation names it (`enregistrerQuiz`), and is all-or-nothing
   on the ANSWER (a wrong count never reaches it: the parser refuses first)
   while a failed write keeps what was already saved. */
await withSrcModule(["src/dashboard/generation-demande.ts", "src/host/current.ts"], async (gd, hote) => {
	const r = makeReporter("N quizzes in ONE pass");
	const doc = (name) => ({ name, content: "texte " + name, source: "file" });
	const msg = (docs, images = 0) => ({ text: "Fais un quiz", notes: docs.map(doc), images: Array.from({ length: images }, () => ({ file: {} })) });
	const noms = (msgs) => msgs.map(m => m.notes.map(n => n.name));

	const un = gd.decouperParFichier(msg(["CM1.md", "CM2.md", "CM3.md"]), false, true);
	r.check("one pass: ONE request carrying every document, flagged per document", [noms(un), un[0].parDocument], [[["CM1.md", "CM2.md", "CM3.md"]], true]);
	r.check("one pass: the instruction is kept", un[0].text, "Fais un quiz");
	r.check("one pass: '1 quiz' stays one request, not flagged",
		(() => { const m = gd.decouperParFichier(msg(["CM1.md", "CM2.md"]), true, true); return [noms(m), m[0].parDocument]; })(), [[["CM1.md", "CM2.md"]], undefined]);
	r.check("one pass: an image keeps ONE plain quiz", gd.decouperParFichier(msg(["CM1.md", "CM2.md"], 1), false, true)[0].parDocument, undefined);
	r.check("one pass: a single document is never flagged", gd.decouperParFichier(msg(["CM1.md"]), false, true)[0].parDocument, undefined);
	r.check("without the one-pass condition: one request per document, as before",
		noms(gd.decouperParFichier(msg(["CM1.md", "CM2.md"]), false, false)), [["CM1.md"], ["CM2.md"]]);
	r.check("which providers read in one pass: every one but Ollama (its structured answer holds a single quiz)",
		["claude-cli", "claude-code", "codex", "antigravity-cli", "claude-web", "ollama"].map(gd.lectureEnUnePasse), [true, true, true, true, true, false]);

	const ecrits = new Map();
	const existants = new Set();
	let echecApres = Infinity;
	hote.installHost({
		fs: {
			mkdirs: async () => {},
			exists: async (p) => existants.has(p),
			write: async (p, contenu) => { if (ecrits.size >= echecApres) throw new Error("disque plein"); ecrits.set(p, contenu); existants.add(p); },
			getFile: () => null,
		},
		paths: {
			contractPath: (root, local) => root + "/" + local,
			defaultRoot: () => ({ id: "R", name: "Neo Quiz" }),
			localPath: (p) => (p === "R" ? "" : p.replace(/^R\//, "")),
			rootOf: () => ({ id: "R", name: "Neo Quiz" }),
		},
		ui: { notice: () => {} },
	});
	const scanner = { scanFile: async () => {}, getQuiz: (p) => ({ path: p, title: p, basename: p }), getQuizzes: () => [] };
	const reglages = { aiProvider: "claude-cli", aiModel: "m", aiEffort: "medium", aiOutputFolder: "Quizzes" };
	const q = (n) => ({ title: "Q" + n, prompt: "Énoncé " + n + " ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que." });
	const noms3 = ["CM1.pdf", "CM2.pdf", "CM3.pdf"];
	const base = { modeDemande: "practice", destination: "R/Cours/Réseaux", reglages, usage: null, scanner };
	const lot = noms3.map((d, i) => ({ document: d, questions: [q(i + 1)], titre: "Titre du modèle " + i }));
	const demande = { text: "Fais un quiz", notes: noms3.map(n => ({ name: n })) };

	/* The names of the per-document generation, as a reference. */
	const refs = [];
	for (const d of noms3) {
		const questions = [q(1)];
		const e = await gd.enregistrerQuiz({ ...base, draft: gd.brouillonDe(questions), questions, titreModele: "x", demande: { text: "Fais un quiz", notes: [{ name: d }] } });
		refs.push(e.path);
	}
	ecrits.clear(); existants.clear();
	const vus = [];
	const faits = await gd.enregistrerLot({ ...base, demande, lot, apresChaque: (f) => vus.push(f.length) });
	r.check("one note per document, named exactly like the per-document generation", faits?.map(f => f.chemin), refs);
	r.check("each note's source is ITS document", [...ecrits.values()].map(c => /\n\s+source: "(CM\d)"\n/.exec(c)?.[1]), ["CM1", "CM2", "CM3"]);
	r.check("each note holds ITS questions", [...ecrits.values()].map(c => /Énoncé (\d)/.exec(c)?.[1]), ["1", "2", "3"]);
	r.check("the result lists the document, title and question count of each quiz", faits?.map(f => [f.document, f.questions]), noms3.map(n => [n, 1]));
	r.check("progress is reported after each note", vus, [1, 2, 3]);

	/* A write that fails midway: what was saved is kept, a retry writes the rest ONLY. */
	ecrits.clear(); existants.clear();
	echecApres = 1;
	let gardes = [];
	let res = await gd.enregistrerLot({ ...base, demande, lot, apresChaque: (f) => { gardes = f; } });
	r.check("a failed write: null, and the note already written is reported", [res, gardes.map(f => f.document), ecrits.size], [null, ["CM1.pdf"], 1]);
	echecApres = Infinity;
	res = await gd.enregistrerLot({ ...base, demande, lot }, gardes);
	r.check("the retry writes only the missing notes, no duplicate (no '(2)')", [res?.map(f => f.document), ecrits.size, [...ecrits.keys()].some(p => /\(2\)/.test(p))], [noms3, 3, false]);
	hote.uninstallHost();
	r.done();
});

/* U2, through the REAL queue (`file-generation-app.ts`) with a fake CLI: ONE
   request over three documents is ONE line and ONE CLI call that carries every
   document, its answer (one quiz per document) saves THREE notes, and a wrong
   answer saves nothing and fails the line. No real CLI, no disk, no network. */
await withSrcModule(["src/dashboard/file-generation-app.ts", "src/host/current.ts"], async (app, hote) => {
	const r = makeReporter("N quizzes in ONE pass - the queue");
	const classes = new Set();
	globalThis.document = { documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
	const noms3 = ["CM1.pdf", "CM2.pdf", "CM3.pdf"];
	const q = (n) => ({ title: "Q" + n, prompt: "Énoncé " + n + " ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que." });
	const bloc = (nom, n) => `{ document: ${JSON.stringify(nom)}, title: "Titre ${n}", quiz: [${JSON.stringify(q(n))}, { mode: "quiz", glossary: [] }] }`;
	let reponse = "";
	const appels = [];
	const ecrits = new Map();
	hote.installHost({
		platform: { isDesktopApp: true },
		process: { lireCache: async () => null, run: async (spec) => {
			appels.push(spec);
			const flux = JSON.stringify({ type: "result", is_error: false, result: reponse, usage: { input_tokens: 1, output_tokens: 1 } });
			return { stdout: flux + "\n", stderr: "", code: 0 };
		} },
		fs: { mkdirs: async () => {}, exists: async (p) => ecrits.has(p), write: async (p, c) => { ecrits.set(p, c); }, getFile: () => null, read: async () => "" },
		paths: {
			contractPath: (root, local) => root + "/" + local, defaultRoot: () => ({ id: "R", name: "Neo Quiz" }),
			localPath: (p) => (p === "R" ? "" : p.replace(/^R\//, "")), rootOf: () => ({ id: "R", name: "Neo Quiz" }),
		},
		ui: { notice: () => {} },
	});
	const scanner = { scanFile: async () => {}, getQuiz: (p) => ({ path: p, title: p, basename: p }), getQuizzes: () => [] };
	const reglages = { aiProvider: "claude-code", aiModel: "sonnet", aiEffort: "medium", aiOutputFolder: "Quizzes" };
	const file = app.fileDeGeneration({ settings: { get: () => ({ ...reglages }), save: async () => {} }, scanner });
	const demande = { text: "Fais un quiz", notes: noms3.map(n => ({ name: n, content: "contenu de " + n, source: "file" })), images: [], parDocument: true,
		mode: "practice", count: null, type: "Mixte", destination: "R/Cours", reglages, categorie: "general" };
	const attendre = async () => { for (let i = 0; i < 200 && file.lignes().some(l => l.etat === "attente" || l.etat === "cours" || l.etat === "enregistrement"); i++) await new Promise(res => setTimeout(res, 10)); };
	await new Promise(res => setTimeout(res, 50)); // the (empty) saved queue is read back first

	reponse = "```json5\n[" + [bloc(noms3[2], 3), bloc(noms3[0], 1), bloc(noms3[1], 2)].join(",\n") + "]\n```";
	file.envoyer(demande);
	await attendre();
	const l = file.lignes()[0];
	r.check("one request: ONE line and ONE CLI call", [file.lignes().length, appels.length], [1, 1]);
	r.check("the one call carries EVERY document, named in order", noms3.every((n, i) => appels[0].stdin.includes("--- " + n + " ---") && appels[0].stdin.includes(`${i + 1}. ${n}`)), true);
	r.check("the line is ready, with one result per document", [l.etat, l.resultat?.quiz?.length], ["prete", 3]);
	r.check("three notes saved, one per document, named as for a single document",
		[...ecrits.keys()].sort(), ["R/Cours/CM1 — Practice.md", "R/Cours/CM2 — Practice.md", "R/Cours/CM3 — Practice.md"]);
	r.check("each note holds its own quiz", [...ecrits.entries()].sort().map(([, c]) => /Énoncé (\d)/.exec(c)?.[1]), ["1", "2", "3"]);

	/* A wrong count: an error on the line, nothing saved, the one CLI call made. */
	ecrits.clear();
	file.fermer(l.id);
	reponse = "```json5\n[" + [bloc(noms3[0], 1), bloc(noms3[1], 2)].join(",\n") + "]\n```";
	file.envoyer(demande);
	await attendre();
	const l2 = file.lignes()[0];
	r.check("a wrong count of quizzes: the line fails with the reason, nothing is saved",
		[l2.etat, l2.echec, /2 quizzes for 3 documents/.test(l2.erreur ?? ""), ecrits.size], ["echouee", "generation", true, 0]);
	r.check("the Claude call carries --strict-mcp-config and no --mcp-config", [appels[0].args.includes("--strict-mcp-config"), appels[0].args.includes("--mcp-config")], [true, false]);
	/* Defence in depth: a line from another device never launches a provider with live tools. */
	file.fermer(l2.id);
	const avant = appels.length;
	file.envoyer({ ...demande, parDocument: false, notes: [], fromDevice: "phone-1", reglages: { ...reglages, aiProvider: "codex" } });
	await attendre();
	const l3 = file.lignes()[0];
	r.check("a remote line on Codex fails at launch and no CLI is started", [l3.etat, appels.length - avant], ["echouee", 0]);
	file.fermer(l3.id);
	reponse = "```json5\n[" + [bloc(noms3[0], 1)].join(",\n") + "]\n```";
	file.envoyer({ ...demande, parDocument: false, notes: [], fromDevice: "phone-1" });
	await attendre();
	r.check("a remote line on Claude does launch", appels.length - avant, 1);
	hote.uninstallHost();
	delete globalThis.document;
	r.done();
});

/* The composer's output folder survives a reload (ai-settings-host.ts):
   the folder last chosen is read back on arrival, only while it is still
   one of the folders offered; anything else falls back to the default (""). */
await withSrcModule("src/dashboard/ai-settings-host.ts", (S) => {
	const r = makeReporter("Destination du composer — relue au retour");
	const offerts = ["Efrei/XTI301", "Efrei/XTI302"];
	r.check("un dossier choisi et toujours offert est relu tel quel", S.destinationMemorisee("Efrei/XTI302", offerts), "Efrei/XTI302");
	r.check("aucun choix persisté : le dossier par défaut", S.destinationMemorisee(undefined, offerts), "");
	r.check("un choix vide : le dossier par défaut", S.destinationMemorisee("", offerts), "");
	r.check("un dossier supprimé depuis : retombe sur le défaut, pas écrit là", S.destinationMemorisee("Efrei/Supprime", offerts), "");
	r.check("une valeur abîmée ou hors liste : le défaut", S.destinationMemorisee("../../Privé", offerts), "");
	r.check("les réglages par défaut ne portent aucun choix persisté", S.aiSettingsDefaults().aiComposerDestination, "");
	r.done();
});
