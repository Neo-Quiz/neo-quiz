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

/* THE "/" MENU (`src/dashboard/slash-commands.ts`): which commands a prefix
   lists, and which text is a whole app command (never a request). */
await withSrcModule("src/dashboard/slash-commands.ts", ({ findSlashCommand, exactCommand }) => {
	const r = makeReporter("/ menu");
	const noms = (texte) => findSlashCommand(texte, texte.length)?.commandes.map(c => c.name) ?? null;
	r.check("\"/\" lists the four commands", noms("/"), ["exam", "clear", "model", "resume"]);
	r.check("\"/c\" lists /clear only", noms("/c"), ["clear"]);
	r.check("\"/ex\" lists /exam", noms("/ex"), ["exam"]);
	r.check("an unknown command lists nothing", noms("/zzz"), null);
	r.check("not at the start of the field", noms("x /clear"), null);
	r.check("text after an app command lists nothing", noms("/clear now"), null);
	r.check("\"/exam algo\" stays the exam level", findSlashCommand("/exam algo", 10)?.exam, true);
	r.check("\"/ex\" is not the exam level yet", findSlashCommand("/ex", 3)?.exam, false);
	r.check("\"/clear\" is a whole command", exactCommand("/clear"), "clear");
	r.check("case and spaces around are tolerated", exactCommand("  /Model "), "model");
	r.check("\"/resume\" is a whole command", exactCommand("/resume"), "resume");
	r.check("\"/clear now\" is not", exactCommand("/clear now"), null);
	r.check("\"x /clear\" is not", exactCommand("x /clear"), null);
	r.check("\"/exam\" keeps its own flow", exactCommand("/exam"), null);
	r.done();
});

/* CLAUDE CODE'S COMMANDS in the "/" menu (`src/dashboard/cli-commands.ts`):
   the list is untrusted (a process, a file on disk), so it is parsed as
   hostile input; a typed command is a raw command turn only when Claude
   listed it and the app does not own the name. */
import { readFileSync } from "node:fs";
await withSrcModule("src/dashboard/cli-commands.ts", ({ parseCliCommands, commandsFromLine, findCliCommand, listCliCommands, getCliCommands, setCliCommands }) => {
	const r = makeReporter("Claude Code commands");
	const ligne = readFileSync("scripts/fixtures/live/claude-session.jsonl", "utf8").split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).map(x => x?.l).find(l => l?.type === "control_response" && l.response?.response?.commands);
	r.check("the real init line has its commands", Array.isArray(ligne?.response?.response?.commands), true);
	// The fixture is redacted ("<skill>"): its name is not a valid one, so it is dropped.
	r.check("a redacted name is dropped, not thrown on", commandsFromLine(ligne), []);
	const vrai = JSON.parse(JSON.stringify(ligne));
	vrai.response.response.commands[0].name = "review";
	r.check("the init line parses to its commands", commandsFromLine(vrai), [{ name: "review", description: "<description> (user)" }]);
	r.check("another line is null", [commandsFromLine({ type: "assistant" }), commandsFromLine(null), commandsFromLine("x"), commandsFromLine({ type: "control_response", response: { response: {} } })], [null, null, null, null]);
	for (const v of [null, undefined, 3, "x", {}, { commands: [] }]) r.check("a non-array gives []: " + JSON.stringify(v), parseCliCommands(v), []);
	const beaucoup = Array.from({ length: 301 }, (_, i) => ({ name: "c" + i, description: "d" }));
	r.check("301 items are cut to 300", parseCliCommands(beaucoup).length, 300);
	const mauvais = ["../x", "a b", "", "x".repeat(65), 5, null, "-a", "a/b"].map(name => ({ name, description: "d" }));
	r.check("bad names are dropped", parseCliCommands([...mauvais, null, 7, "s", [1]]), []);
	r.check("a 64-char name is kept", parseCliCommands([{ name: "x".repeat(64) }]).length, 1);
	r.check("control characters are cleaned", parseCliCommands([{ name: "a", description: "x\u0000y\nz", argumentHint: "[a]\u0007" }]), [{ name: "a", description: "x y z", argumentHint: "[a]" }]);
	r.check("descriptions are cut to 200 code points, hints to 100", [[...parseCliCommands([{ name: "a", description: "\u{1F600}".repeat(250) }])[0].description].length, [...parseCliCommands([{ name: "a", description: "", argumentHint: "h".repeat(150) }])[0].argumentHint].length], [200, 100]);
	r.check("a number in place of a string", parseCliCommands([{ name: "a", description: 5, argumentHint: 6 }]), [{ name: "a", description: "" }]);
	r.check("__proto__ keys never throw nor pollute", [parseCliCommands(JSON.parse('[{"__proto__":{"x":1},"name":"a","description":"d"}]')), ({}).x], [[{ name: "a", description: "d" }], undefined]);
	const connues = parseCliCommands([{ name: "review", description: "Review" }, { name: "clear", description: "x" }, { name: "model" }, { name: "compact", description: "c", argumentHint: "[focus]" }]);
	r.check("\"/review foo\" is a command turn", findCliCommand("/review foo", connues), "review");
	r.check("trimmed", findCliCommand("  /review ", connues), "review");
	r.check("an app command is not", [findCliCommand("/clear", connues), findCliCommand("/model", connues), findCliCommand("/exam", connues)], [null, null, null]);
	r.check("an unknown name is a normal request", findCliCommand("/unknown", connues), null);
	r.check("\"x /review\" is a normal request", findCliCommand("x /review", connues), null);
	r.check("a longer name is not a prefix match", findCliCommand("/reviewer", connues), null);
	r.check("the menu hides names the app owns and filters by prefix", [listCliCommands(connues, "").map(c => c.name), listCliCommands(connues, "co").map(c => c.name), listCliCommands(connues, "cl")], [["review", "compact"], ["compact"], []]);
	// No localStorage under Node: memory only, and a read never throws.
	r.check("no storage: empty list, no throw", getCliCommands(), []);
	setCliCommands(connues);
	r.check("the last list is kept in memory", getCliCommands().length, 4);
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
	r.check("a preparation asks one question per examinable point", sys("learn", 0).includes("MOST EXAMINABLE points") && sys("learn", 0).includes("NEVER two questions on the same point"), true);
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
	r.check("a Learn step: one question per examinable point", sys("learn").includes("MOST EXAMINABLE points") && sys("learn").includes("NEVER two questions on the same point"), true);
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
