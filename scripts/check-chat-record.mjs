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

	// Provider, model, effort: labels frozen at the send.
	const lu = (over) => C.readChats({ v: 1, chats: [chat("a", 1, { requests: [req("r", 1, over)] })] })[0].requests[0];
	r.check("settings round trip", [lu({ provider: "codex", model: "gpt-5.5", effort: "high" })].map(q => [q.provider, q.model, q.effort])[0], ["codex", "gpt-5.5", "high"]);
	r.check("an old request without settings stays valid", [lu({}).provider, lu({}).model, lu({}).effort], [undefined, undefined, undefined]);
	r.check("garbage settings are dropped one by one, the request kept",
		[lu({ provider: 3, model: "x".repeat(C.MAX_LABEL + 1), effort: "hi" + String.fromCharCode(10) + "gh" })].map(q => [q.id, q.provider, q.model, q.effort])[0], ["r", undefined, undefined, undefined]);
	r.check("an empty label is dropped", lu({ provider: "", model: "m" }).provider, undefined);

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

/* The clarifying questions Generate asks when a request is vague (spec
   2026-10-07-generate-auto-kind): kept with the request, read back from
   storage, answered once, never revived into a deleted chat. */
await withSrcModule(["src/dashboard/chat-record.ts", "src/dashboard/chat-requests.ts"], (C, Q) => {
	const r = makeReporter("Chat record: clarifying questions");
	const op = (label) => ({ label, description: "d " + label });
	const qs = [{ header: "Level", question: "Which level?", multiple: false, options: [op("Beginner"), op("Advanced")], default: 0 }, { header: "Parts", question: "Which parts?", multiple: true, options: [op("A"), op("B"), op("C")], default: 2 }];
	const base = { id: "r1", at: 5, from: "d1", text: "Python", mode: "learn", documents: [], results: [], state: "done" };
	const read = (reqs) => C.readChats({ v: 1, chats: [{ id: "a", origin: "d1", createdAt: 1, updatedAt: 1, requests: reqs }] })[0].requests;
	r.check("an old request (no questions) loads unchanged", read([base])[0].clarify, undefined);
	r.check("questions and answers are read back", read([{ ...base, clarify: { questions: qs, answers: [["Beginner"], ["A", "my own"]] } }])[0].clarify, { questions: qs, answers: [["Beginner"], ["A", "my own"]] });
	r.check("pending questions have no answers", "answers" in read([{ ...base, clarify: { questions: qs } }])[0].clarify, false);
	r.check("a skipped question is an empty answer, read back as such", read([{ ...base, clarify: { questions: qs, answers: [[], ["A"]] } }])[0].clarify.answers, [[], ["A"]]);
	r.check("the default option is read back, a bad one becomes the first", [read([{ ...base, clarify: { questions: qs } }])[0].clarify.questions.map(x => x.default), read([{ ...base, clarify: { questions: [{ ...qs[0], default: 9 }, { ...qs[1], default: "x" }] } }])[0].clarify.questions.map(x => x.default)], [[0, 2], [0, 0]]);
	r.check("a header over 12 characters is cut on reading", read([{ ...base, clarify: { questions: [{ ...qs[0], header: "x".repeat(30) }, qs[1]] } }])[0].clarify.questions[0].header.length, 12);
	r.check("answers of the wrong length are ignored, the questions kept", read([{ ...base, clarify: { questions: qs, answers: [["x"]] } }])[0].clarify.answers, undefined);
	const bad = [["no questions", { questions: [] }], ["three questions", { questions: [...qs, qs[0]] }], ["one option", { questions: [{ question: "q", options: [op("a")] }] }],
		["five options", { questions: [{ question: "q", options: ["a", "b", "c", "d", "e"].map(op) }] }], ["option as a bare string", { questions: [{ question: "q", options: ["a", "b"] }] }], ["no question text", { questions: [{ options: [op("a"), op("b")] }] }]];
	for (const [nom, mauvais] of bad) r.check("bad questions are dropped, the request kept: " + nom, [read([{ ...base, clarify: mauvais }]).length, read([{ ...base, clarify: mauvais }])[0].clarify], [1, undefined]);

	const doc = [{ name: "cm1.pdf" }];
	const withQ = Q.addClarify([], "c1", "d1", 10, { id: "r1", text: "Python", documents: doc, mode: "learn" }, { questions: qs });
	r.check("addClarify makes the chat with the pending request", [withQ.length, withQ[0].requests[0].clarify.answers, withQ[0].requests[0].results.length, withQ[0].title], [1, undefined, 0, "Python"]);
	r.check("addClarify adds a request to an existing chat, in order", Q.addClarify(withQ, "c1", "d1", 20, { id: "r2", text: "x", documents: [], mode: "practice" }, { questions: qs })[0].requests.map(q => q.id), ["r1", "r2"]);
	r.check("addClarify never revives a deleted chat", Q.addClarify([{ id: "c1", origin: "d1", createdAt: 1, updatedAt: 1, deleted: true, requests: [] }], "c1", "d1", 5, { id: "r", text: "t", documents: [], mode: "learn" }, { questions: qs })[0].requests, []);

	const answers = [["Beginner"], ["A", "B"]];
	const ok = Q.answerClarify(withQ, "c1", "r1", answers, 30);
	r.check("answerClarify records the answers", [ok.changed, ok.chats[0].requests[0].clarify.answers, ok.chats[0].updatedAt], [true, answers, 30]);
	r.check("answerClarify keeps the questions", ok.chats[0].requests[0].clarify.questions, qs);
	r.check("questions already answered are not answered twice", Q.answerClarify(ok.chats, "c1", "r1", answers, 40).changed, false);
	r.check("a wrong number of answers changes nothing", Q.answerClarify(withQ, "c1", "r1", [["x"]], 40).changed, false);
	r.check("an unknown chat or request changes nothing", [Q.answerClarify(withQ, "zz", "r1", answers, 1).changed, Q.answerClarify(withQ, "c1", "zz", answers, 1).changed], [false, false]);
	r.check("the original list is never mutated", withQ[0].requests[0].clarify.answers, undefined);

	// After a reload of the page the in-memory request is gone: only a request with no document can be rebuilt.
	const pend = { ...base, clarify: { questions: qs, genre: "both" } };
	r.check("the kind to generate is read back, `both` included", read([pend])[0].clarify.genre, "both");
	r.check("an unknown kind is ignored", read([{ ...base, clarify: { questions: qs, genre: "exam" } }])[0].clarify.genre, undefined);
	r.check("resume: a pending request with no document is rebuilt from the record (text and kind)", Q.resumeSource(read([pend])[0]), { text: "Python", genre: "both" });
	r.check("resume: without a stored kind, the request's mode", [Q.resumeSource(read([{ ...base, mode: "practice", clarify: { questions: qs } }])[0])?.genre, Q.resumeSource(read([{ ...base, clarify: { questions: qs } }])[0])?.genre], ["practice", "learn"]);
	r.check("resume: a request that carried a document cannot be rebuilt (its text is never kept)", Q.resumeSource(read([{ ...pend, documents: [{ name: "cm1.pdf" }] }])[0]), null);
	r.check("resume: an answered request, or one with no questions, has nothing to resume", [Q.resumeSource(read([{ ...pend, clarify: { ...pend.clarify, answers: [["a"], ["b"]] } }])[0]), Q.resumeSource(read([base])[0])], [null, null]);

	// The queue's record of the same request keeps the questions and their answers.
	const ligne = { id: 1, etat: "prete", demande: { text: "Python", notes: [], images: [], mode: "learn", requestId: "r1", chatId: "c1", sentAt: 10 }, resultat: { titre: "T", chemin: "t.md" } };
	const rec = Q.recordRequest({ key: "r1", chatId: "c1", lines: [ligne] }, "d1", 50, ok.chats[0].requests[0]);
	const frozen = { ...ligne, demande: { ...ligne.demande, reglages: { aiProvider: "codex", aiModel: "gpt-5.5", aiEffort: "high" } } };
	const recS = Q.recordRequest({ key: "r1", chatId: "c1", lines: [frozen] }, "d1", 50);
	r.check("the settings frozen at the send are recorded", [recS.provider, recS.model, recS.effort], ["codex", "gpt-5.5", "high"]);
	const recS2 = Q.recordRequest({ key: "r1", chatId: "c1", lines: [{ ...frozen, demande: { ...frozen.demande, reglages: { aiProvider: "ollama", aiModel: "m", aiEffort: "low" } } }] }, "d1", 60, recS);
	r.check("a request already recorded keeps its first settings", [recS2.provider, recS2.model], ["codex", "gpt-5.5"]);
	r.check("recording the generation keeps the questions and answers", [rec.clarify.answers, rec.results.length], [answers, 1]);
	r.done();
});
