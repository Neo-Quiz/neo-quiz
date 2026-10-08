/**
 * THE CHATS OF THE GENERATE PAGE, pure cores (`chat-requests.ts`,
 * `chat-thread.ts`, `chat-list.ts`, `conversation-context.ts`): lines of the
 * queue grouped into requests, reconciled into chat records, the thread and
 * the sidebar list derived from record + live lines, the context of a
 * follow-up.
 *
 * What it prevents: a request that made several quizzes drawn or recorded as
 * several requests (the same text repeated); a closed reply erasing an answer
 * from the record; a line saved before chats existed crashing the page; a
 * chat deleted by the user coming back from a late save; a finished reply
 * hidden while a sibling still runs.
 *
 *     npm run check:chat-thread
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const line = (id, etat, over = {}, resultat) => ({
	id, etat, resultat,
	demande: { text: "make quizzes", notes: [], images: [], mode: "practice", chatId: "c1", requestId: "r1", sentAt: 1000, ...over },
});
const quiz = (titre, chemin, questions = 5) => ({ titre, chemin, questions });

await withSrcModule(["src/dashboard/chat-requests.ts", "src/dashboard/chat-record.ts"], (R, C) => {
	const r = makeReporter("Requests and records");
	const g = (...lines) => R.groupLines(lines);

	r.check("two lines of one send are ONE request group", g(line(1, "prete", {}, quiz("A", "a.md")), line(2, "prete", {}, quiz("B", "b.md"))).map(x => [x.key, x.lines.length]), [["r1", 2]]);
	r.check("Stop follows the active chat: another chat's run is not its run",
		[R.runningLineOfChat([line(1, "cours", { chatId: "a" })], "b")?.id ?? null, R.runningLineOfChat([line(1, "cours", { chatId: "a" }), line(2, "attente", { chatId: "b" })], "b")?.id ?? null, R.runningLineOfChat([line(1, "cours", { chatId: "a" })], "a")?.id], [null, null, 1]);
	r.check("two sends are two groups, in order", g(line(1, "prete", { requestId: "r1" }), line(2, "prete", { requestId: "r2" })).map(x => x.key), ["r1", "r2"]);
	r.check("a line saved before chats: the legacy chat, its own request", g(line(7, "prete", { chatId: undefined, requestId: undefined, sentAt: undefined })).map(x => [x.chatId, x.key]), [[C.LEGACY_CHAT_ID, "line-7"]]);

	const dev = "d1";
	const un = R.recordRequest(g(line(1, "prete", { notes: [{ name: "CM1.pdf", path: "Cours/CM1.pdf" }] }, quiz("A", "a.md")), line(2, "prete", { notes: [{ name: "CM2.pdf" }] }, quiz("B", "b.md")))[0], dev, 5000);
	r.check("one request: the text once, the documents by name, a card per quiz, done",
		[un.id, un.text, un.documents, un.results.map(x => x.title), un.state, un.at, un.from], ["r1", "make quizzes", [{ name: "CM1.pdf", path: "Cours/CM1.pdf" }, { name: "CM2.pdf" }], ["A", "B"], "done", 1000, dev]);
	const lot = R.recordRequest(g(line(1, "prete", {}, { titre: "3 quizzes", chemin: "a.md", quiz: [quiz("A", "a.md"), quiz("B", "b.md"), quiz("C", "c.md")] }))[0], dev, 5000);
	r.check("a one-pass line: one request, three cards", [lot.results.length, lot.results.map(x => x.path)], [3, ["a.md", "b.md", "c.md"]]);
	const prose = R.recordRequest(g(line(1, "prete", {}, { titre: "", chemin: "", texte: "Here is the answer" }))[0], dev, 5000);
	r.check("a written answer is a text result", prose.results, [{ kind: "text", text: "Here is the answer" }]);
	r.check("a request still waiting or running is not recorded yet", R.recordRequest(g(line(1, "attente"), line(2, "cours"))[0], dev, 5000), null);
	const part = R.recordRequest(g(line(1, "prete", {}, quiz("A", "a.md")), line(2, "cours"))[0], dev, 5000);
	r.check("one answer in, a sibling still running: kept, as interrupted until it ends", [part.state, part.results.length], ["stopped", 1]);
	const ko = R.recordRequest(g(line(1, "echouee", {}, undefined))[0], dev, 5000, undefined);
	r.check("a failed line is a failed request (the message is kept)", [ko.state], ["failed"]);
	const ko2 = R.recordRequest(R.groupLines([{ ...line(1, "echouee"), erreur: "boom" }])[0], dev, 5000);
	r.check("the error of a failed request is kept", ko2.error, "boom");
	r.check("a stopped line (arret) is a stopped request", R.recordRequest(g(line(1, "arret"))[0], dev, 5000).state, "stopped");
	r.check("a plan line and its steps: one request, the plan as a text answer then the quizzes",
		R.recordRequest(g(line(1, "prete", { planifier: true }, { titre: "", chemin: "", texte: "Plan: 2 quizzes" }), line(2, "prete", { planifier: false }, quiz("S1", "s1.md")), line(3, "prete", { planifier: false }, quiz("S2", "s2.md")))[0], dev, 5000).results.map(x => x.kind),
		["text", "quiz", "quiz"]);

	// Reconcile.
	const groups = g(line(1, "prete", {}, quiz("A", "a.md")), line(2, "prete", {}, quiz("B", "b.md")));
	let rec = R.reconcileChats([], groups, dev, 5000);
	r.check("reconcile creates the chat: origin, title, one request", [rec.changed, rec.chats.length, rec.chats[0].origin, rec.chats[0].title, rec.chats[0].requests.length, rec.chats[0].createdAt, rec.chats[0].updatedAt], [true, 1, dev, "make quizzes", 1, 1000, 5000]);
	const encore = R.reconcileChats(rec.chats, groups, dev, 9000);
	r.check("reconciling again changes nothing (idempotent, no rewrite of updatedAt)", [encore.changed, encore.chats[0].updatedAt], [false, 5000]);
	// The user closed reply A; B is still in the queue: A must stay in the record.
	const seulB = R.reconcileChats(rec.chats, g(line(2, "prete", {}, quiz("B", "b.md"))), dev, 9000);
	r.check("a closed reply never erases an answer from the record", [seulB.changed, seulB.chats[0].requests[0].results.map(x => x.title)], [false, ["A", "B"]]);
	const plus = R.reconcileChats(rec.chats, g(line(1, "prete", {}, quiz("A", "a.md")), line(2, "prete", {}, quiz("B", "b.md")), line(3, "prete", {}, quiz("C", "c.md"))), dev, 9000);
	r.check("a new answer is added, the chat moves up", [plus.changed, plus.chats[0].requests[0].results.length, plus.chats[0].updatedAt], [true, 3, 9000]);
	const dead = [{ ...rec.chats[0], deleted: true, requests: [] }];
	r.check("a deleted chat is never resurrected by a late save", R.reconcileChats(dead, groups, dev, 9000).changed, false);
	const deux = R.reconcileChats(rec.chats, g(line(5, "prete", { requestId: "r2", sentAt: 2000, text: "again" }, quiz("D", "d.md"))), dev, 9000);
	r.check("a second send: a second request in the same chat, in order of sending", deux.chats[0].requests.map(q => [q.id, q.text]), [["r1", "make quizzes"], ["r2", "again"]]);
	const autre = R.reconcileChats(rec.chats, g(line(6, "prete", { chatId: "c2", requestId: "r9" }, quiz("Z", "z.md"))), dev, 9000);
	r.check("another chat: another record", autre.chats.map(c => c.id), ["c1", "c2"]);

	const old = { chatId: undefined, requestId: undefined, sentAt: undefined };
	const rien0 = () => true;
	const legacy = R.reconcileChats([], g(line(7, "prete", old, quiz("A", "a.md")), line(8, "prete", old, quiz("B", "b.md"))), dev, 5000);
	r.check("lines saved before chats land in ONE fixed chat, one request each, no crash", [legacy.chats.map(c => c.id), legacy.chats[0].requests.map(q => [q.id, q.at])], [[C.LEGACY_CHAT_ID], [["line-7", 5000], ["line-8", 5000]]]);
	r.check("a legacy line is never closable while its chat is on screen", R.closableLines([line(7, "prete", old, quiz("A", "a.md"))], C.LEGACY_CHAT_ID, rien0).map(l => l.id), []);

	// A line that left the queue carried the documents, the text and the failure: they stay recorded.
	const full = R.reconcileChats([], g(
		line(1, "prete", { text: "from A", mode: "learn", notes: [{ name: "CM1.pdf", path: "Cours/CM1.pdf" }] }, quiz("A", "a.md")),
		line(2, "echouee", { text: "from B", notes: [{ name: "CM2.pdf" }] })), dev, 5000);
	const rest = R.reconcileChats(full.chats, g(line(3, "prete", { requestId: "r1", text: "other", mode: "practice", notes: [{ name: "CM3.pdf" }] }, quiz("C", "c.md"))), dev, 9000);
	const q0 = rest.chats[0].requests[0];
	r.check("closed lines: text, mode, documents, state and results survive the lines that remain", [q0.text, q0.mode, q0.documents.map(d => d.name), q0.state, q0.results.map(x => x.title)], ["from A", "learn", ["CM1.pdf", "CM2.pdf", "CM3.pdf"], "failed", ["A", "C"]]);
	const withErr = R.reconcileChats([], R.groupLines([{ ...line(1, "echouee"), erreur: "boom" }]), dev, 5000);
	const afterErr = R.reconcileChats(withErr.chats, g(line(2, "prete", { requestId: "r1" }, quiz("C", "c.md"))), dev, 9000);
	r.check("a closed failed line: the error stays and the request is not softened to done", [afterErr.chats[0].requests[0].state, afterErr.chats[0].requests[0].error], ["failed", "boom"]);
	const stopped = R.reconcileChats([], g(line(1, "arret"), line(2, "prete", {}, quiz("A", "a.md"))), dev, 5000);
	const afterStop = R.reconcileChats(stopped.chats, g(line(2, "prete", {}, quiz("A", "a.md"))), dev, 9000);
	r.check("a closed stopped line: the request stays stopped", afterStop.chats[0].requests[0].state, "stopped");

	// closableLines: a finished reply leaves the queue only when its WHOLE request is finished,
	// is already in the record, and its chat is not on screen.
	const rien = () => true;
	const fin = [line(1, "prete", { chatId: "c1" }, quiz("A", "a.md")), line(2, "prete", { chatId: "c1" }, quiz("B", "b.md"))];
	r.check("a finished request of another chat can leave the queue", R.closableLines(fin, "c2", rien).map(l => l.id), [1, 2]);
	r.check("the chat on screen keeps its replies", R.closableLines(fin, "c1", rien).map(l => l.id), []);
	r.check("a request with a sibling still running keeps ALL its replies", R.closableLines([line(1, "prete", {}, quiz("A", "a.md")), line(2, "cours")], "c2", rien).map(l => l.id), []);
	r.check("a reply not yet in the record stays", R.closableLines(fin, "c2", () => false).map(l => l.id), []);
	r.check("a failed line stays (its Try again is live)", R.closableLines([line(1, "echouee")], "c2", rien).map(l => l.id), []);
	// A deleted chat: nothing to show or retry, so its ended lines (failed and stopped too) go; a running one never.
	const gone = id => id === "c1";
	r.check("a deleted chat's finished lines leave the queue even unrecorded", R.closableLines(fin, "c2", () => false, gone).map(l => l.id), [1, 2]);
	r.check("a deleted chat's failed and stopped lines leave too", R.closableLines([line(1, "echouee"), line(2, "arret")], "c2", () => false, gone).map(l => l.id), [1, 2]);
	r.check("a deleted chat's request with a line still running is never touched", R.closableLines([line(1, "prete", {}, quiz("A", "a.md")), line(2, "cours")], "c2", () => false, gone).map(l => l.id), []);
	r.check("another chat's failed line still stays", R.closableLines([line(1, "echouee", { chatId: "c3" })], "c2", rien, gone).map(l => l.id), []);
	// A remote request that never produced a line is recorded as failed (the PC runner).
	const PC = "11111111-1111-4111-8111-111111111111", PH = "22222222-2222-4222-8222-222222222222";
	const rreq = { v: 1, id: "lq3k2-fail01", at: 100, from: PH, target: PC, chatId: "chat-9999", text: "Quiz on lists", mode: "learn", documents: [{ path: "Python/cm1.md" }] };
	const made = R.addFailedRequest([], rreq, PC, "Root", 500, "boom");
	r.check("an unknown chat is created with the PC as origin", [made.length, made[0].id, made[0].origin, made[0].updatedAt], [1, "chat-9999", PC, 500]);
	const qf = made[0].requests[0];
	r.check("the request is failed, from the phone, with the message and the absolute document", [qf.state, qf.from, qf.error, qf.documents, qf.results], ["failed", PH, "boom", [{ name: "cm1.md", path: "Root/Python/cm1.md" }], []]);
	const known = [{ id: "chat-9999", origin: PH, createdAt: 1, updatedAt: 1, requests: [{ id: "earlier", at: 50, from: PH, text: "x", mode: "learn", documents: [], results: [], state: "done" }] }];
	const appended = R.addFailedRequest(known, rreq, PC, "Root", 600, "boom");
	r.check("a known chat gets the request appended in time order, its origin kept, updatedAt bumped", [appended[0].requests.map(q => q.id), appended[0].origin, appended[0].updatedAt], [["earlier", "lq3k2-fail01"], PH, 600]);
	const twice = R.addFailedRequest(appended, rreq, PC, "Root", 700, "boom");
	r.check("the same request id is never recorded twice (idempotent, updatedAt untouched)", [twice[0].requests.length, twice[0].updatedAt], [2, 600]);
	r.check("a deleted chat stays deleted", R.addFailedRequest([{ ...known[0], deleted: true }], rreq, PC, "Root", 600, "boom")[0].requests.length, 1);
	r.check("an input list is never mutated", [known.length, known[0].requests.length], [1, 1]);
	r.done();
});

await withSrcModule(["src/dashboard/chat-thread.ts", "src/dashboard/chat-list.ts", "src/dashboard/chat-record.ts"], (T, L, C) => {
	const r = makeReporter("Thread and list");
	const req = (id, at, over = {}) => ({ id, at, from: "d1", text: "t" + id, mode: "practice", documents: [], results: [], state: "done", ...over });
	const rec = (id, updatedAt, requests, over = {}) => ({ id, origin: "d1", createdAt: 1, updatedAt, requests, ...over });
	const keys = (items) => items.map(i => i.kind + ":" + i.key);

	// Thread: record requests + live groups of the chat on screen, in order of sending.
	const chat = rec("c1", 9, [req("r1", 100), req("r2", 200)]);
	r.check("a chat from the record: its requests, oldest first", keys(T.threadItems(chat, [], "c1")), ["record:r1", "record:r2"]);
	r.check("no chat yet and no line: an empty thread", T.threadItems(null, [], "c1"), []);
	const live = [line(1, "cours", { requestId: "r3", sentAt: 300 })];
	r.check("a live request comes after the recorded ones", keys(T.threadItems(chat, live, "c1")), ["record:r1", "record:r2", "live:r3"]);
	r.check("a request in the record AND in the queue is shown once, from the live lines", keys(T.threadItems(chat, [line(1, "prete", { requestId: "r2", sentAt: 200 }, quiz("A", "a.md"))], "c1")), ["record:r1", "live:r2"]);
	r.check("lines of another chat never show", keys(T.threadItems(chat, [line(1, "cours", { chatId: "c2", requestId: "x" })], "c1")), ["record:r1", "record:r2"]);
	r.check("a stopped line (arret) is not shown live: the record's 'stopped' request takes over",
		keys(T.threadItems(rec("c1", 9, [req("r1", 100, { state: "stopped" })]), [line(1, "arret", { requestId: "r1", sentAt: 100 })], "c1")), ["record:r1"]);
	r.check("a deleted chat shows nothing", T.threadItems({ ...chat, deleted: true, requests: [] }, [], "c1"), []);
	r.check("a line saved before chats shows in the legacy chat, after the recorded ones",
		keys(T.threadItems(null, [line(4, "prete", { chatId: undefined, requestId: undefined, sentAt: undefined }, quiz("A", "a.md"))], C.LEGACY_CHAT_ID)), ["live:line-4"]);

	// Context tours.
	const chatDocs = rec("c1", 9, [req("r1", 100, { text: "from the PDFs", documents: [{ name: "CM1.pdf" }], results: [{ kind: "quiz", title: "CM1 Intro", path: "Cours/CM1.md" }, { kind: "text", text: "A written answer" }] })]);
	const tours = T.toursOfThread(T.threadItems(chatDocs, [], "c1"));
	r.check("a recorded request becomes a tour: text, documents by name, quiz by title and path, answers", [tours.length, tours[0].text, tours[0].notes.map(n => n.name), tours[0].quizzes, tours[0].answers], [1, "from the PDFs", ["CM1.pdf"], [{ title: "CM1 Intro", questions: [], path: "Cours/CM1.md" }], ["A written answer"]]);
	const liveTours = T.toursOfThread(T.threadItems(null, [
		line(1, "prete", { notes: [{ name: "A.pdf", content: "AAA" }], produit: { questions: [{ prompt: "q1" }], titre: "QA" } }, quiz("QA", "qa.md")),
		line(2, "prete", { notes: [{ name: "B.pdf", content: "BBB" }], produit: { questions: [{ prompt: "q2" }], titre: "QB" } }, quiz("QB", "qb.md")),
	], "c1"));
	r.check("two lines of one send: ONE tour, both documents with their content, both quizzes with their questions",
		[liveTours.length, liveTours[0].notes.map(n => n.name + ":" + n.content), liveTours[0].quizzes.map(q => q.title + ":" + q.questions.length)], [1, ["A.pdf:AAA", "B.pdf:BBB"], ["QA:1", "QB:1"]]);
	const manyRec = rec("cm", 1, Array.from({ length: T.MAX_CONTEXT_REQUESTS + 5 }, (_, i) => req("q" + i, i + 1)));
	const manyTours = T.toursOfThread(T.threadItems(manyRec, [], "cm"));
	r.check("a follow-up carries only the last requests of a long chat", [manyTours.length, manyTours[0].text, manyTours[manyTours.length - 1].text], [T.MAX_CONTEXT_REQUESTS, "tq5", "tq" + (T.MAX_CONTEXT_REQUESTS + 4)]);
	r.check("a planning line is not a quiz tour of its own", T.toursOfThread(T.threadItems(null, [line(1, "prete", { planifier: true, produit: undefined }, { titre: "", chemin: "", texte: "plan" })], "c1"))[0].quizzes, []);

	// Sidebar list.
	const now = new Date(2026, 8, 30, 15, 0).getTime();
	const list = L.chatListItems([rec("a", 50, [req("r", 1, { text: "Alpha" })]), rec("dead", 99, [], { deleted: true })], [], now);
	r.check("the list: record chats, tombstones hidden", list.map(i => [i.id, i.title, i.date, i.running]), [["a", "Alpha", 50, false]]);
	const run = L.chatListItems([rec("a", 50, [req("r", 1, { text: "Alpha" })])], [line(1, "cours", { chatId: "a", requestId: "r9", sentAt: 70 })], now);
	r.check("a chat with a running request is flagged, and dated from the latest activity", [run[0].running, run[0].date], [true, 70]);
	const vif = L.chatListItems([], [line(1, "cours", { chatId: "fresh", text: "Brand new\nsecond line", sentAt: 80 })], now);
	r.check("a chat that only exists in the queue is listed, running, titled by its request", vif.map(i => [i.id, i.title, i.running, i.date]), [["fresh", "Brand new", true, 80]]);
	r.check("a waiting line counts as running", L.chatListItems([], [line(1, "attente", { chatId: "w" })], now)[0].running, true);
	r.check("a finished line is not running", L.chatListItems([], [line(1, "prete", { chatId: "w" }, quiz("A", "a.md"))], now)[0].running, false);
	r.check("newest first", L.chatListItems([rec("a", 10, [req("r", 1)]), rec("b", 30, [req("r", 1)]), rec("c", 20, [req("r", 1)])], [], now).map(i => i.id), ["b", "c", "a"]);

	// Days, in LOCAL time.
	const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();
	const it = (id, date) => ({ id, title: id, date, running: false });
	const jours = L.groupItemsByDay([it("a", at(30, 0, 10)), it("b", at(29, 23, 50)), it("c", at(29, 8)), it("d", at(28, 12)), it("e", new Date(2026, 7, 20, 12).getTime())], now, 30);
	r.check("today, yesterday, a date, each day once",
		jours.map(j => [j.kind, j.chats.map(c => c.id).join(""), j.old]),
		[["today", "a", false], ["yesterday", "bc", false], ["day", "d", false], ["day", "e", true]]);

	// One request that made several quizzes: ONE item, every result, once in the context.
	const multi = [line(1, "prete", { requestId: "r5", sentAt: 500 }, quiz("A", "a.md")), line(2, "prete", { requestId: "r5", sentAt: 500 }, quiz("B", "b.md"))];
	const multiRec = rec("c1", 9, [req("r5", 500, { results: [{ kind: "quiz", title: "A", path: "a.md" }, { kind: "quiz", title: "B", path: "b.md" }] })]);
	r.check("several quizzes of one request: ONE live item with both lines", T.threadItems(null, multi, "c1").map(i => [i.kind, i.key, i.lines.length]), [["live", "r5", 2]]);
	r.check("several quizzes of one request: ONE record item with both results", T.threadItems(multiRec, [], "c1").map(i => [i.kind, i.request.results.length]), [["record", 2]]);
	const both = T.toursOfThread(T.threadItems(multiRec, multi, "c1"));
	r.check("in the record AND live: the context lists the request once", both.length, 1);
	// Phase 2: a chat of another device is flagged, and a running indicator also comes from that device's generations (Task 7)
	{
		const mk = (id, origin) => ({ id, origin, createdAt: 1, updatedAt: 5, requests: [{ id: "r", at: 1, from: origin, text: "Q", mode: "learn", documents: [], results: [], state: "done" }] });
		const items = L.chatListItems([mk("a", "me"), mk("b", "pc")], [], 10, "me");
		r.check("the list marks the chats started on another device", items.map(i => [i.id, i.foreign]).sort(), [["a", false], ["b", true]]);
	}
	// Phase 2: progress read from another device's generations file
	{
		const chatRec = { id: "c1", origin: "pc", createdAt: 1, updatedAt: 5, requests: [{ id: "done1", at: 1, from: "pc", text: "Q1", mode: "learn", documents: [], results: [], state: "done" }] };
		const entry = (over = {}) => ({ requestId: "run1", chatId: "c1", from: "ph", text: "Q2", mode: "learn", startedAt: 10, provider: "p", model: "m", progress: { question: 12, total: 20 }, ...over });
		const gens = (at) => [{ device: "pc", file: { v: 1, at, running: [entry()] } }];
		const NOW = 1_000_000;
		const live = T.threadItems(chatRec, [], "c1", gens(NOW - 1000), NOW);
		r.check("a request running on another device appears after the recorded ones, with its progress",
			live.map(i => [i.kind, i.key]), [["record", "done1"], ["remote", "run1"]]);
		r.check("not stale while fresh", live.at(-1).stale, false);
		r.check("an old file shows the entry as paused", T.threadItems(chatRec, [], "c1", gens(NOW - 300_000), NOW).at(-1).stale, true);
		r.check("the entry of another chat is not in this thread", T.threadItems(chatRec, [], "other", gens(NOW), NOW).some(i => i.kind === "remote"), false);
		const recorded = { ...chatRec, requests: [...chatRec.requests, { ...chatRec.requests[0], id: "run1" }] };
		r.check("once recorded, the request is shown from the record only", T.threadItems(recorded, [], "c1", gens(NOW), NOW).map(i => i.kind), ["record", "record"]);
		const items = L.chatListItems([chatRec], [], NOW, "me", gens(NOW));
		r.check("the sidebar shows the running indicator for a request running elsewhere", items[0].running, true);
		r.check("but not when that file is stale", L.chatListItems([chatRec], [], NOW, "me", gens(NOW - 300_000))[0].running, false);
		// A chat known ONLY from another device's running generation (no chats file has it yet) is listed, running.
		const onlyRemote = L.chatListItems([], [], NOW, "me", gens(NOW));
		r.check("a chat known only from a generation running on another device is listed, running, titled by its request", onlyRemote.map(i => [i.id, i.title, i.running]), [["c1", "Q2", true]]);
		r.check("a stale generation file keeps its new chat listed, paused", L.chatListItems([], [], NOW, "me", gens(NOW - 300_000)).map(i => [i.id, i.running]), [["c1", false]]);
		r.check("a generation file older than 24 h lists no chat of its own", L.chatListItems([], [], NOW, "me", gens(NOW - 25 * 3600e3)), []);
		r.check("a deleted chat is not kept by a stale generation file", L.chatListItems([{ ...chatRec, deleted: true, requests: [] }], [], NOW, "me", gens(NOW - 300_000)), []);
		r.check("a deleted chat is not brought back by a generation running on another device", L.chatListItems([{ ...chatRec, deleted: true, requests: [] }], [], NOW, "me", gens(NOW)), []);
		// Once the result lands, the chat record has the id: the chat is listed ONCE, as the real chat.
		const merged = L.chatListItems([chatRec], [], NOW, "me", gens(NOW));
		r.check("once its chat record lands, the chat is listed once, under the record", merged.map(i => [i.id, i.running]), [["c1", true]]);
	}
	// Phase 3: the phone's own waiting requests
	{
		const NOW = 1_800_000_000_000;
		const own = (id, over = {}) => ({ v: 1, id, at: NOW - 1000, from: "ph", target: "pc", chatId: "c1", text: "Q " + id, mode: "learn", documents: [], ...over });
		const items = T.threadItems(null, [], "c1", [], NOW, [own("w1"), own("w2", { chatId: "other" }), own("w3", { at: NOW - 30 * 3600e3 })]);
		r.check("a waiting request of this chat is shown; another chat's is not; an old one is expired",
			items.map(i => [i.key, i.kind === "pending" ? i.state : i.kind]), [["w3", "expired"], ["w1", "waiting"]]);
		const running = T.threadItems(null, [], "c1", [{ device: "pc", file: { v: 1, at: NOW, running: [{ requestId: "w1", chatId: "c1", from: "ph", text: "Q", mode: "learn", startedAt: NOW, provider: "p", model: "m", progress: { question: 1 } }] } }], NOW, [own("w1")]);
		r.check("once the PC reports it running, only the progress item shows", running.map(i => i.kind), ["remote"]);
		const done = T.threadItems({ id: "c1", origin: "pc", createdAt: 1, updatedAt: 1, requests: [{ id: "w1", at: 1, from: "ph", text: "Q", mode: "learn", documents: [], results: [], state: "done" }] }, [], "c1", [], NOW, [own("w1")]);
		r.check("once recorded, only the record shows", done.map(i => i.kind), ["record"]);
		r.check("a pending item carries the PC its request was sent to", T.threadItems(null, [], "c1", [], NOW, [own("w1", { target: "pcX" })]).map(i => i.target), ["pcX"]);
		r.check("a pending request is never a tour of the context", T.toursOfThread(T.threadItems(null, [], "c1", [], NOW, [own("w1")])), []);
	}
	r.done();
});

// The Open button of a quiz card (chat-record-vue.ts): offered when the card names a quiz.
await withSrcModule(["src/shared-state/chat-merge.ts"], (M) => {
	const r = makeReporter("Card Open");
	r.check("Open is offered for a quiz path under the root", M.canOpenCard("Root/A/q.md"), true);
	r.check("Open is offered for a quiz path of another root (it keeps Open)", M.canOpenCard("Other/q.md"), true);
	r.check("no Open for a card without a quiz path (a written or failed result)", M.canOpenCard(""), false);
	r.done();
});

// What the phone may send from its composer: a text or Markdown document inside the Neo Quiz folder, and only those.
await withSrcModule(["src/dashboard/remote-send.ts"], (S) => {
	const r = makeReporter("Phone documents");
	const ROOT = "C:/Neo Quiz";
	r.check("a Markdown document of the folder can go", S.refusPourTelephone({ name: "cours.md", path: ROOT + "/Python/cours.md" }, ROOT), null);
	r.check("a text document of the folder can go", S.refusPourTelephone({ name: "notes.txt", path: ROOT + "/notes.txt" }, ROOT), null);
	r.check("a document outside the folder is refused", S.refusPourTelephone({ name: "cours.md", path: "D:/Cours/cours.md" }, ROOT), "ai.remote.insideFolderOnly");
	r.check("a document with no path (picked from the device) is refused", S.refusPourTelephone({ name: "cours.md" }, ROOT), "ai.remote.insideFolderOnly");
	r.check("the internal folder of the sync is never sent", S.refusPourTelephone({ name: "x.md", path: ROOT + "/.neo-quiz/x.md" }, ROOT), "ai.remote.insideFolderOnly");
	r.check("an image of the folder is refused: text only", S.refusPourTelephone({ name: "schema.png", path: ROOT + "/schema.png" }, ROOT), "ai.remote.textOnly");
	r.check("a PDF of the folder is refused: text only", S.refusPourTelephone({ name: "cm1.pdf", path: ROOT + "/cm1.pdf" }, ROOT), "ai.remote.textOnly");
	r.done();
});

// Where the phone sends: the PC that owns the chat, else the last PC seen fresh, else the origin or the last PC ever seen (even stale). Never none while one was seen.
await withSrcModule(["src/dashboard/remote-send.ts"], (S) => {
	const r = makeReporter("Targets and expiry");
	const NOW = 1_800_000_000_000;
	const fresh = (device, at = NOW - 1000) => ({ device, file: { v: 1, at, running: [] } });
	const stale = (device) => ({ device, file: { v: 1, at: NOW - 600_000, running: [] } });
	r.check("the chat's PC when it is fresh", S.targetOf({ origin: "A" }, [fresh("A"), fresh("B")], NOW, "B"), "A");
	r.check("another fresh PC when the chat's PC is off", S.targetOf({ origin: "A" }, [stale("A"), fresh("B")], NOW, null), "B");
	r.check("a new chat: the last PC ever seen, even stale", S.targetOf(null, [stale("A")], NOW, "A"), "A");
	r.check("the chat's PC, even stale, before the last PC ever seen", S.targetOf({ origin: "A" }, [stale("A")], NOW, "B"), "A");
	r.check("no PC ever seen: no target at all (never an empty one)", S.targetOf(null, [], NOW, null), null);
	r.check("a PC is reachable while its file is fresh", S.pcFresh("A", [fresh("A")], NOW), true);
	r.check("a stale or absent PC is not reachable", [S.pcFresh("A", [stale("A")], NOW), S.pcFresh("B", [fresh("A")], NOW)], [false, false]);
	r.check("idle PC: stale file but a paired device connected = reachable", S.pcReachable("A", [stale("A")], NOW, true), true);
	r.check("idle PC: no file at all but connected = reachable", S.pcReachable("A", [], NOW, true), true);
	r.check("nothing connected and a stale file = not reachable", S.pcReachable("A", [stale("A")], NOW, false), false);
	r.check("a fresh file is reachable even when not connected", S.pcReachable("A", [fresh("A")], NOW, false), true);
	r.check("no PC ever seen is never reachable", S.pcReachable(null, [], NOW, true), false);
	r.check("the device seen most recently, stale or not", S.latestDevice([stale("A"), fresh("B", NOW - 5000)]), "B");
	const own = (id, at) => ({ v: 1, id, at, from: "ph", target: "pc", chatId: "c1", text: "Q", mode: "learn", documents: [] });
	const rec = new Set(["done"]);
	const sync = S.ownAfterSync([own("wait", NOW - 1000), own("old", NOW - 25 * 3600e3), own("done", NOW - 1000)], [], rec, NOW);
	r.check("on disk: a waiting request is kept, not dropped", sync.keep.some(q => q.id === "wait") && !sync.drop.includes("wait"), true);
	r.check("on disk: a recorded request is dropped and not kept", [sync.drop.includes("done"), sync.keep.some(q => q.id === "done")], [true, false]);
	r.check("on disk: an expired request is deleted but stays listed (Expired)", [sync.drop.includes("old"), sync.keep.some(q => q.id === "old")], [true, true]);
	const later = S.ownAfterSync([], sync.keep, rec, NOW + 1000);
	r.check("an expired request already deleted from disk is still listed this session", later.keep.map(q => q.id), ["old"]);
	r.check("a remembered waiting request that left the disk is not listed", S.ownAfterSync([], [own("gone", NOW - 1000)], rec, NOW).keep, []);
	r.check("a remembered request recorded meanwhile is no longer listed", S.ownAfterSync([], sync.keep, new Set(["old"]), NOW).keep, []);
	r.done();
});

await withSrcModule(["src/dashboard/chat-settings.ts"], (S) => {
	const r = makeReporter("Settings on chat switch");
	const rq = (id, over = {}) => ({ id, at: 1, from: "pc", text: "t", mode: "learn", documents: [], results: [], state: "done", ...over });
	const MODELS = { "claude-code": ["opus", "sonnet"], codex: ["gpt-5.5", "gpt-5.4"], site: [] };
	const EFF = { opus: ["low", "high", "max"], "gpt-5.5": ["low", "high"] };
	const env = (current, over = {}) => ({
		providerOffered: (id) => id in MODELS && id !== "gone",
		models: (id) => MODELS[id] ?? [],
		defaultModel: (id) => MODELS[id]?.[0] ?? "",
		efforts: (id, m) => EFF[m] ?? [],
		current, ...over,
	});
	const cur = { provider: "claude-code", model: "sonnet", effort: "low" };
	const chat = (...requests) => ({ requests });
	r.check("a valid triple is applied", S.settingsOnSwitch(chat(rq("a", { provider: "codex", model: "gpt-5.5", effort: "high" })), env(cur)), { aiProvider: "codex", aiModel: "gpt-5.5", aiEffort: "high" });
	r.check("the LAST request with settings wins", S.settingsOnSwitch(chat(rq("a", { provider: "codex", model: "gpt-5.4" }), rq("b", { provider: "claude-code", model: "opus", effort: "max" }), rq("c")), env(cur)), { aiModel: "opus", aiEffort: "max" });
	r.check("an empty chat changes nothing", S.settingsOnSwitch(chat(), env(cur)), null);
	r.check("no chat changes nothing", S.settingsOnSwitch(null, env(cur)), null);
	r.check("a chat without recorded settings changes nothing", S.settingsOnSwitch(chat(rq("a")), env(cur)), null);
	r.check("an unavailable provider changes nothing", S.settingsOnSwitch(chat(rq("a", { provider: "gone", model: "x", effort: "high" })), env(cur)), null);
	r.check("an unknown provider changes nothing", S.settingsOnSwitch(chat(rq("a", { provider: "../etc", model: "x" })), env(cur)), null);
	r.check("an unknown model on a valid other provider: the provider's default model, no effort", S.settingsOnSwitch(chat(rq("a", { provider: "codex", model: "nope", effort: "high" })), env(cur)), { aiProvider: "codex", aiModel: "gpt-5.5" });
	r.check("an unknown model on the same provider keeps the current model", S.settingsOnSwitch(chat(rq("a", { provider: "claude-code", model: "nope", effort: "max" })), env(cur)), null);
	r.check("an effort not valid for the model is not applied", S.settingsOnSwitch(chat(rq("a", { provider: "claude-code", model: "opus", effort: "ultra" })), env(cur)), { aiModel: "opus" });
	r.check("a site provider (no models) is applied alone", S.settingsOnSwitch(chat(rq("a", { provider: "site", model: "x" })), env(cur)), { aiProvider: "site", aiModel: "" });
	r.check("already on those settings: nothing to save", S.settingsOnSwitch(chat(rq("a", { provider: "claude-code", model: "sonnet", effort: "low" })), env(cur)), null);
	r.done();
});
