/**
 * THE CHATS of the Generate page (`src/dashboard/chat-archives.ts`), on the
 * real code and a fake storage.
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

await withSrcModule("src/dashboard/chat-archives.ts", ({ saveChat, readArchivedChats, deleteArchivedChat, groupChatsByDay, MAX_ARCHIVED_CHATS }) => {
	const r = makeReporter("Chats of Generate");
	const memoire = (plafond = Infinity) => {
		const m = new Map();
		return {
			getItem: k => (m.has(k) ? m.get(k) : null),
			setItem: (k, v) => { if (v.length > plafond) throw new Error("QuotaExceededError"); m.set(k, v); },
		};
	};
	const chat = (id, date, q, a) => ({ id, date, title: q, turns: [{ role: "user", text: q }, { role: "assistant", text: a }] });

	let s = memoire();
	r.check("a chat with an answer is kept", [saveChat(chat("c1", 1, "q", "a"), s), readArchivedChats(s).length], [true, 1]);
	r.check("a chat with no answer is not kept", [saveChat({ id: "c2", date: 2, turns: [{ role: "user", text: "q" }] }, s), readArchivedChats(s).length], [false, 1]);
	r.check("an empty answer is not an answer", [saveChat(chat("c3", 3, "q", "  "), s), readArchivedChats(s).length], [false, 1]);

	saveChat(chat("c4", 5, "q2", "a2"), s);
	r.check("newest first", readArchivedChats(s).map(c => c.id), ["c4", "c1"]);
	saveChat({ ...chat("c1", 9, "q", "a"), turns: [...chat("c1", 9, "q", "a").turns, { role: "user", text: "q3" }, { role: "assistant", text: "a3" }] }, s);
	r.check("saved again, a conversation is replaced and moves up", [readArchivedChats(s).map(c => c.id), readArchivedChats(s)[0].turns.length], [["c1", "c4"], 4]);
	deleteArchivedChat("c4", s);
	r.check("a chat can be deleted", readArchivedChats(s).map(c => c.id), ["c1"]);

	s = memoire();
	for (let i = 0; i < MAX_ARCHIVED_CHATS + 5; i++) saveChat(chat("q" + i, i + 1, "q" + i, "a"), s);
	r.check("the oldest leave first", [readArchivedChats(s).length, readArchivedChats(s)[0].id], [MAX_ARCHIVED_CHATS, "q" + (MAX_ARCHIVED_CHATS + 4)]);

	s = memoire(4000);
	for (let i = 0; i < 60; i++) saveChat(chat("p" + i, i + 1, "q" + i, "x".repeat(100)), s);
	const pleins = readArchivedChats(s);
	r.check("a full storage keeps the newest chats", [pleins.length > 0, pleins.length < 60, pleins[0].id], [true, true, "p59"]);

	for (const brut of ["not json", "{}", "[1,2]", JSON.stringify([{ id: 1, date: "x", turns: [] }]), JSON.stringify([{ id: "a", date: 1, turns: [{ role: "system", text: "x" }] }]), JSON.stringify([{ id: "a", date: 1, title: 3, turns: [] }])]) {
		const m = memoire();
		m.setItem("neo-quiz.archived-chats", brut);
		r.check("unreadable value gives an empty list: " + brut.slice(0, 20), readArchivedChats(m), []);
	}

	const refuse = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
	r.check("a refused storage never throws", [readArchivedChats(refuse), saveChat(chat("c", 1, "q", "a"), refuse)], [[], true]);

	// The days, in LOCAL time: 30 Sept 2026 at 00:10, then 23:50 the day before.
	const now = new Date(2026, 8, 30, 15, 0).getTime();
	const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();
	const jours = groupChatsByDay([
		chat("a", at(30, 0, 10), "a", "x"), chat("b", at(29, 23, 50), "b", "x"), chat("c", at(29, 8), "c", "x"),
		chat("d", at(28, 12), "d", "x"), chat("e", new Date(2026, 7, 20, 12).getTime(), "e", "x"),
	], now, 30);
	r.check("today, yesterday, a date, each day once",
		jours.map(j => [j.kind, j.chats.map(c => c.id).join(""), j.old]),
		[["today", "a", false], ["yesterday", "bc", false], ["day", "d", false], ["day", "e", true]]);
	r.check("an old day is past the recent days", groupChatsByDay([chat("f", new Date(2026, 7, 31, 12).getTime(), "f", "x")], now, 30)[0].old, false);
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
		{ id: "s1", date: 20, title: "Pile et file", turns: [{ role: "user", text: "Pile et file" }, { role: "assistant", text: "Une pile est LIFO." }] },
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
	r.check("a preparation keeps the usual size of one quiz (at most 20 in a Learn)", sys("learn", 0).includes("at most 20 questions"), true);
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
	r.check("a Learn step keeps its 20-question cap", sys("learn").includes("at most 20 questions"), true);
	r.check("a Test step keeps 10 to 20 questions", sys("practice").includes("between 10 and 20 questions"), true);
	r.check("never an uncapped quantity", /no fixed (maximum|number)/i.test(sys("learn") + sys("practice")), false);
	r.done();
});
