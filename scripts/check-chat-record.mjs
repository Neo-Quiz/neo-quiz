/**
 * THE CHAT RECORD (`src/dashboard/chat-record.ts`): the shape the Generate
 * page keeps its chats in (spec 2026-10-02, phase 1), on the real code.
 *
 * What it prevents: a hostile or corrupt stored value breaking the page; a
 * result lost or doubled when a request is saved again; the legacy text-only
 * archive imported as one request per turn pair instead of per question; the
 * list growing past 200 chats, or a tombstone being dropped by the bound (a
 * deleted chat would come back).
 *
 *     npm run check:chat-record
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/chat-record.ts", (C) => {
	const r = makeReporter("Chat record");
	const req = (id, at, over = {}) => ({ id, at, from: "d1", text: "t" + id, mode: "practice", documents: [], results: [], state: "done", ...over });
	const chat = (id, updatedAt, over = {}) => ({ id, origin: "d1", createdAt: 1, updatedAt, requests: [req("r1", 1)], ...over });

	r.check("a valid file is read back", C.readChats({ v: 1, chats: [chat("a", 5)] }).map(c => c.id), ["a"]);
	for (const [nom, brut] of [["null", null], ["array", []], ["v2", { v: 2, chats: [chat("a", 1)] }], ["no chats", { v: 1 }], ["chats not a list", { v: 1, chats: {} }]]) {
		r.check("unreadable file gives an empty list: " + nom, C.readChats(brut), []);
	}
	r.check("a chat with a bad id or a non-numeric date is dropped, the others kept",
		C.readChats({ v: 1, chats: [chat("a", 1), { ...chat("b", 1), id: 3 }, { ...chat("c", 1), updatedAt: "x" }] }).map(c => c.id), ["a"]);
	const sale = C.readChats({ v: 1, chats: [chat("a", 1, { requests: [
		req("ok", 1), { ...req("bad-mode", 2), mode: "exam" }, { ...req("bad-state", 3), state: "running" },
		{ ...req("bad-result", 4), results: [{ kind: "quiz", title: "T", path: "p.md" }, { kind: "quiz", title: 3, path: "p" }, { kind: "x" }, { kind: "text", text: "hi" }] },
		{ ...req("bad-doc", 5), documents: [{ name: "a.pdf", path: "x/a.pdf" }, { name: 3 }] },
	] })] })[0].requests;
	r.check("a bad request is dropped, a bad result or document is dropped inside its request",
		sale.map(q => q.id + ":" + q.results.length + ":" + q.documents.length), ["ok:0:0", "bad-result:2:0", "bad-doc:0:1"]);
	r.check("a tombstone is read as such", C.readChats({ v: 1, chats: [{ ...chat("a", 1), deleted: true, requests: [] }] })[0].deleted, true);
	const longue = C.readChats({ v: 1, chats: [chat("a", 1, { requests: [req("r", 1, { results: [{ kind: "text", text: "x".repeat(C.MAX_RESULT_TEXT + 50) }] })] })] })[0].requests[0].results[0].text.length;
	r.check("a text answer is bounded", longue, C.MAX_RESULT_TEXT);

	// Results merge: nothing lost, nothing doubled.
	const q1 = { kind: "quiz", title: "A", path: "a.md" }, q2 = { kind: "quiz", title: "B", path: "b.md" }, t1 = { kind: "text", text: "plan" };
	r.check("merge keeps the old ones and adds the new ones", C.mergeResults([q1], [q2, t1]), [q1, q2, t1]);
	r.check("merge never doubles a quiz (same path) nor a text", C.mergeResults([q1, t1], [{ ...q1, title: "A2" }, t1]), [q1, t1]);
	r.check("merge with nothing new changes nothing", C.mergeResults([q1], []), [q1]);

	// Legacy archive: one request per user turn, answers as text results.
	const arch = [{ id: "old1", date: 100, title: "T", turns: [
		{ role: "user", text: "q1" }, { role: "assistant", text: "a1" },
		{ role: "user", text: "q2" }, { role: "assistant", text: "a2" }, { role: "assistant", text: "a2b" },
	] }, { id: "old2", date: 50, turns: [{ role: "assistant", text: "Quiz made: X" }] }];
	const mig = C.chatsFromArchive(arch, "dev");
	r.check("legacy: ids, origin, dates kept", mig.map(c => [c.id, c.origin, c.createdAt, c.updatedAt, c.title]), [["old1", "dev", 100, 100, "T"], ["old2", "dev", 50, 50, undefined]]);
	r.check("legacy: one request per user turn, all its answers as text results",
		mig[0].requests.map(q => [q.text, q.results.map(x => x.text), q.state, q.from]), [["q1", ["a1"], "done", "dev"], ["q2", ["a2", "a2b"], "done", "dev"]]);
	r.check("legacy: an assistant-only chat (plan steps) keeps its answer with an empty request text", [mig[1].requests.length, mig[1].requests[0].text, mig[1].requests[0].results[0].text], [1, "", "Quiz made: X"]);
	r.check("legacy request ids are unique inside a chat", new Set(mig[0].requests.map(q => q.id)).size, 2);

	// The bound: 200 live chats, newest first; tombstones are kept whatever the count.
	const beaucoup = Array.from({ length: C.MAX_CHATS + 5 }, (_, i) => chat("c" + i, i + 10));
	const mort = { ...chat("dead", 1), deleted: true, requests: [] };
	const bornes = C.boundChats([...beaucoup, mort]);
	r.check("bound: the newest 200 live chats stay", [bornes.filter(c => !c.deleted).length, bornes.some(c => c.id === "c0"), bornes.some(c => c.id === "c204")], [C.MAX_CHATS, false, true]);
	r.check("bound: a tombstone is never dropped", bornes.some(c => c.id === "dead"), true);

	// Titles.
	r.check("title: explicit wins", C.chatTitle({ title: "Mine", requests: [req("a", 1)] }), "Mine");
	r.check("title: first non-blank line of the first request", C.chatTitle({ requests: [req("a", 1, { text: "\n  Hello there\nmore" })] }), "Hello there");
	r.check("title: else the first document, else the first quiz", [
		C.chatTitle({ requests: [req("a", 1, { text: " ", documents: [{ name: "CM1.pdf" }] })] }),
		C.chatTitle({ requests: [req("a", 1, { text: "", results: [q1] })] }),
		C.chatTitle({ requests: [] }),
	], ["CM1.pdf", "A", ""]);
	r.done();
});

/* The question Generate asks when a request does not say Learn or Test
   (spec 2026-10-07-generate-auto-kind): kept with the request, read back from
   storage, answered once, never revived into a deleted chat. */
await withSrcModule(["src/dashboard/chat-record.ts", "src/dashboard/chat-requests.ts"], (C, Q) => {
	const r = makeReporter("Chat record: the asked kind");
	const ask = { question: "Learn or practise?", options: [{ label: "Learn", kind: "learn" }, { label: "Test", kind: "practice" }, { label: "Both", kind: "both" }] };
	const base = { id: "r1", at: 5, from: "d1", text: "pointeurs", mode: "practice", documents: [], results: [], state: "done" };
	const read = (reqs) => C.readChats({ v: 1, chats: [{ id: "a", origin: "d1", createdAt: 1, updatedAt: 1, requests: reqs }] })[0].requests;
	r.check("an old request (no question) loads unchanged", read([base])[0].ask, undefined);
	r.check("a question and its answer are read back", read([{ ...base, ask: { ...ask, chosen: "both" } }])[0].ask, { ...ask, chosen: "both" });
	r.check("a pending question has no chosen", "chosen" in read([{ ...base, ask }])[0].ask, false);
	for (const [nom, mauvais] of [["one option", { ...ask, options: ask.options.slice(0, 1) }], ["five options", { ...ask, options: [...ask.options, ...ask.options] }],
		["unknown kind", { ...ask, options: [ask.options[0], { label: "x", kind: "exam" }] }], ["no question text", { options: ask.options }]]) {
		r.check("a bad question is dropped, the request kept: " + nom, [read([{ ...base, ask: mauvais }]).length, read([{ ...base, ask: mauvais }])[0].ask], [1, undefined]);
	}
	r.check("an unknown chosen kind is ignored", read([{ ...base, ask: { ...ask, chosen: "exam" } }])[0].ask.chosen, undefined);

	const doc = [{ name: "cm1.pdf" }];
	const withAsk = Q.addAsk([], "c1", "d1", 10, { id: "r1", text: "pointeurs", documents: doc }, ask);
	r.check("addAsk makes the chat with the pending request", [withAsk.length, withAsk[0].requests[0].ask.chosen, withAsk[0].requests[0].results.length, withAsk[0].title], [1, undefined, 0, "pointeurs"]);
	const second = Q.addAsk(withAsk, "c1", "d1", 20, { id: "r2", text: "autre", documents: [] }, ask);
	r.check("addAsk adds a request to an existing chat, in order", second[0].requests.map(q => q.id), ["r1", "r2"]);
	r.check("addAsk never revives a deleted chat", Q.addAsk([{ id: "c1", origin: "d1", createdAt: 1, updatedAt: 1, deleted: true, requests: [] }], "c1", "d1", 5, { id: "r", text: "t", documents: [] }, ask)[0].requests, []);

	const ok = Q.answerAsk(withAsk, "c1", "r1", "both", 30);
	r.check("answerAsk records the choice and the kind it generates", [ok.changed, ok.chats[0].requests[0].ask.chosen, ok.chats[0].requests[0].mode, ok.chats[0].updatedAt], [true, "both", "learn", 30]);
	r.check("answerAsk keeps the question and its options", ok.chats[0].requests[0].ask.options, ask.options);
	r.check("a Test choice records mode practice", Q.answerAsk(withAsk, "c1", "r1", "practice", 30).chats[0].requests[0].mode, "practice");
	r.check("a question already answered is not answered twice", Q.answerAsk(ok.chats, "c1", "r1", "learn", 40).changed, false);
	r.check("an unknown chat or request changes nothing", [Q.answerAsk(withAsk, "zz", "r1", "learn", 1).changed, Q.answerAsk(withAsk, "c1", "zz", "learn", 1).changed], [false, false]);
	r.check("the original list is never mutated", withAsk[0].requests[0].ask.chosen, undefined);

	// The queue's record of the same request keeps the question (recordRequest).
	const ligne = { id: 1, etat: "prete", demande: { text: "pointeurs", notes: [], images: [], mode: "learn", requestId: "r1", chatId: "c1", sentAt: 10 }, resultat: { titre: "T", chemin: "t.md" } };
	const g = { key: "r1", chatId: "c1", lines: [ligne] };
	const rec = Q.recordRequest(g, "d1", 50, ok.chats[0].requests[0]);
	r.check("recording the generation keeps the question and its answer", [rec.ask.chosen, rec.results.length], ["both", 1]);
	r.done();
});
