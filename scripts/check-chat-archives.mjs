/**
 * THE CHATS of the Generate page (`src/dashboard/chat-archives.ts`, legacy reader
 * only) and its search, on the real code and a fake storage.
 *
 * What it prevents: a chat with no answer saved (an empty conversation would
 * fill the sidebar); a conversation saved again as it goes on appearing twice;
 * the list growing without bound, or a FULL storage losing the newest chat; a
 * corrupted or hostile stored value breaking the page instead of giving an
 * empty list; a refused storage (private window) throwing; and the days of the
 * sidebar (today, yesterday, a date, the folded old ones) read in UTC or
 * split across one day.
 *
 *     npm run check:chat-archives
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/chat-archives.ts", ({ readArchivedChats }) => {
	const r = makeReporter("Legacy chat archive reader");
	const m = (brut) => ({ getItem: () => brut });
	const bon = [{ id: "c1", date: 1, title: "q", turns: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] }, { id: "c2", date: 5, turns: [] }];
	r.check("the archive is read newest first", readArchivedChats(m(JSON.stringify(bon))).map(c => c.id), ["c2", "c1"]);
	for (const brut of ["not json", "{}", "[1,2]", JSON.stringify([{ id: 1, date: "x", turns: [] }]), JSON.stringify([{ id: "a", date: 1, turns: [{ role: "system", text: "x" }] }]), JSON.stringify([{ id: "a", date: 1, title: 3, turns: [] }])]) {
		r.check("unreadable value gives an empty list: " + brut.slice(0, 20), readArchivedChats(m(brut)), []);
	}
	r.check("a refused storage never throws", readArchivedChats({ getItem: () => { throw new Error("denied"); } }), []);
	r.done();
});

/* THE SEARCH of the Generate page (`src/dashboard/search-items.ts`): every
   word must appear, accents and case ignored; a tab keeps its kind; with no
   query, the most recent first, capped. */
await withSrcModule("src/dashboard/search-items.ts", ({ searchItems }) => {
	const r = makeReporter("Search of Generate");
	const quizzes = [
		{ path: "Cours/Réseaux TCP.md", title: "Réseaux TCP", mtime: 30 },
		{ path: "Cours/Python.md", title: "Python", mtime: 10 },
	];
	const chats = [
		{ id: "s1", date: 20, title: "Pile et file", text: "Pile et file\nUne pile est LIFO." },
	];
	const titres = (q, tab, max) => searchItems(q, tab, quizzes, chats, max).map(i => i.kind + ":" + i.title);
	r.check("no query: newest first, both kinds", titres("", "all"), ["quiz:Réseaux TCP", "session:Pile et file", "quiz:Python"]);
	r.check("accents and case ignored", titres("RESEAUX", "all"), ["quiz:Réseaux TCP"]);
	r.check("every word must appear", titres("reseaux python", "all"), []);
	r.check("a session is found by what was said", titres("lifo", "all"), ["session:Pile et file"]);
	r.check("the Quizzes tab shows no session", titres("", "quizzes"), ["quiz:Réseaux TCP", "quiz:Python"]);
	r.check("the Sessions tab shows no quiz", titres("", "sessions"), ["session:Pile et file"]);
	r.check("capped", titres("", "all", 2).length, 2);
	r.done();
});

/* THE /exam COMMAND (`src/dashboard/exam-command.ts`): the menu opens on the
   command or a beginning of it, at the START of the field only; what follows
   the full command filters the exams; a sent "/exam subject" keeps the subject. */
await withSrcModule("src/dashboard/exam-command.ts", ({ trouverCommandeExam, retirerCommandeExam }) => {
	const r = makeReporter("/exam command");
	const cmd = (texte) => trouverCommandeExam(texte, texte.length);
	r.check("\"/\" alone opens the menu", cmd("/")?.requete, "");
	r.check("a beginning of the command too", cmd("/ex")?.requete, "");
	r.check("\"/prepare-exam\" is not a command", cmd("/prepare-exam"), null);
	r.check("what follows filters", cmd("/exam réseaux")?.requete, "réseaux");
	r.check("another command opens nothing", cmd("/help"), null);
	r.check("a filter after an unfinished command opens nothing", cmd("/ex réseaux"), null);
	r.check("not at the start of the field", cmd("revoir /exam"), null);
	r.check("not on a second line", cmd("/exam\nsujet"), null);
	r.check("the command leaves the subject", retirerCommandeExam("/exam Les piles"), { texte: "Les piles", commande: true });
	r.check("no command, the text as it is", retirerCommandeExam("/examen"), { texte: "/examen", commande: false });
	r.done();
});

/* THE PREPARATION PROMPT (`composerPrompts`): each step says what it is,
   the exam is named, the quantity has no cap, and a Learn cites its pages. */
await withSrcModule("src/dashboard/ai-client.ts", ({ composerPrompts }) => {
	const r = makeReporter("/exam prompts");
	const examen = { nom: "Contrôle réseaux", date: "2026-10-02", module: "XTI301" };
	const sys = (mode, palier) => composerPrompts("x", { mode, preparation: { examen, palier, paliers: 3 } }).systemPrompt;
	r.check("the exam is named", sys("learn", 0).includes("Contrôle réseaux"), true);
	r.check("the Learn step", sys("learn", 0).includes("THIS STEP: the Learn path"), true);
	r.check("Test 1 is the fundamentals", sys("practice", 1).includes("FUNDAMENTALS"), true);
	r.check("the last Test is at the exam's level", sys("practice", 3).includes("AT THE EXAM'S LEVEL"), true);
	r.check("a preparation asks one question per examinable point", sys("learn", 0).includes("cover EVERY EXAMINABLE POINT") && sys("learn", 0).includes("NEVER two questions on the same point"), true);
	r.check("a Learn cites its sources", composerPrompts("x", { mode: "learn" }).systemPrompt.includes('"cite"'), true);
	r.check("a Test does not", composerPrompts("x", { mode: "practice" }).systemPrompt.includes('"cite"'), false);
	r.check("no preparation block without /exam", composerPrompts("x", { mode: "practice" }).systemPrompt.includes("EXAM PREPARATION"), false);
	r.done();
});

/* One Learn PER DOCUMENT of an exam: its step names the document, its title too. */
await withSrcModule("src/dashboard/ai-client.ts", ({ composerPrompts }) => {
	const r = makeReporter("/exam per document");
	const sys = composerPrompts("x", { mode: "learn", preparation: { examen: { nom: "CC", date: "2026-10-02", module: "XTI301" }, palier: 0, paliers: 3, document: "CM2 - Listes.pdf" } }).systemPrompt;
	r.check("the Learn names its document", sys.includes('the document "CM2 - Listes.pdf"'), true);
	r.check("its title names it without the extension", sys.includes("CC — Learn CM2 - Listes"), true);
	r.done();
});

/* The NAME of a preparation's quiz is imposed: the exam, then the step. */
await withSrcModule("src/dashboard/file-generation-app.ts", ({ titrePreparation }) => {
	const r = makeReporter("/exam quiz names");
	const examen = { nom: "Contrôle continu - 20%", date: "2026-09-30", module: "XTI301" };
	r.check("a Test is named after the exam and its level", titrePreparation({ mode: "practice", preparation: { examen, palier: 2, paliers: 3 } }), "Contrôle continu - 20% — Test 2");
	r.check("a Learn names its document, without the extension", titrePreparation({ mode: "learn", preparation: { examen, palier: 0, paliers: 3, document: "CM2 - Programmation Python.pdf" } }), "Contrôle continu - 20% — Learn CM2 - Programmation Python");
	r.check("outside a preparation, the model's title", titrePreparation({ mode: "learn" }), undefined);
	r.done();
});

/* THE PLAN the model writes after reading every document: a JSON array,
   fenced or not, read leniently, the type imposed by Learn | Test. */
await withSrcModule("src/dashboard/ai-client.ts", ({ lirePlan }) => {
	const r = makeReporter("/exam plan");
	const brut = 'Voici le plan :\n```json\n[{ "title": "Listes", "type": "learn", "covers": "les listes" }, { "title": "Tuples", "type": "test", "covers": "tuples" }, { "type": "learn" }]\n```';
	r.check("valid steps kept, a step without title dropped", lirePlan(brut).map(e => e.titre + ":" + e.type), ["Listes:learn", "Tuples:practice"]);
	r.check("Learn | Test imposes the type", lirePlan(brut, "learn").map(e => e.type), ["learn", "learn"]);
	r.check("an unreadable answer gives no plan", lirePlan("désolé, je ne peux pas"), []);
	r.check("at most 12 steps", lirePlan(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ title: "Q" + i, type: "test" })))).length, 12);
	r.done();
});

/* A step of the model's plan keeps the usual size too (eight Learns of 52 to
   113 questions on 2026-09-30): never "as many as needed". */
await withSrcModule("src/dashboard/ai-client.ts", ({ composerPrompts }) => {
	const r = makeReporter("/exam plan step size");
	const sys = (mode) => composerPrompts("x", { mode, preparation: { examen: { nom: "CC", date: "2026-10-02", module: "XTI301" }, palier: 0, paliers: 3, titre: "Listes", focus: "les listes", plan: ["Listes", "Tuples"], etape: 1, etapes: 2 } }).systemPrompt;
	r.check("a Learn step: one question per examinable point", sys("learn").includes("cover EVERY EXAMINABLE POINT") && sys("learn").includes("NEVER two questions on the same point"), true);
	r.check("a Test step: one question per examinable point", sys("practice").includes("as many questions as the source has EXAMINABLE POINTS"), true);
	r.check("never an uncapped quantity", /no fixed (maximum|number)/i.test(sys("learn") + sys("practice")), false);
	r.done();
});

/* THE EXAMINABLE POINTS of a plan step: read from the plan, and given to
   the quiz as the only ones it asks about, one question each. */
await withSrcModule("src/dashboard/ai-client.ts", ({ lirePlan, composerPrompts }) => {
	const r = makeReporter("/exam examinable points");
	const plan = lirePlan('[{ "title": "Listes", "type": "learn", "covers": "les listes", "points": ["len", "append", "", 3, "slicing [n:p:step]"] }]');
	r.check("the points are read, empty or non-text ones dropped", plan[0].points, ["len", "append", "slicing [n:p:step]"]);
	r.check("a plan without points still reads", lirePlan('[{ "title": "T", "type": "test" }]')[0].points, []);
	const sys = composerPrompts("x", { mode: "learn", preparation: { palier: 0, paliers: 3, titre: "Listes", focus: "les listes", plan: ["Listes"], etape: 1, etapes: 1, points: ["len", "append"] } }).systemPrompt;
	r.check("the step's points are listed, one question each", [sys.includes("- len"), sys.includes("- append"), sys.includes("ONE question per point")], [true, true, true]);
	r.done();
});
