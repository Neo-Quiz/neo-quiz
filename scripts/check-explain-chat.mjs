/**
 * THE PURE CORE OF AN EXPLAIN CHAT (`src/dashboard/explain-chat.ts`) and the
 * position of the learner (`positionCourante`, `src/explain-prompt.ts`).
 *
 * What it prevents: a quiz reopening another quiz's chat, a deleted or
 * unmarked chat taking its place, a recorded turn doubled by its live line, a
 * line of another chat showing in this thread, a failed line without its
 * error, a turn whose position is not the LAST thing sent (so "this" points
 * to the wrong slide), a position naming another question, and a recorded
 * answer that lost the place of its AI work (`runs`).
 *
 *     npm run check:explain-chat
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/explain-chat.ts", "src/explain-prompt.ts", "src/explain-follow.ts", "src/dashboard/explain-demand.ts"], (C, P, F, D) => {
	const r = makeReporter("Explain chats, pure core");
	const { chatForQuiz, explainMessages, explainTurnTexts } = C;
	const { positionCourante } = P;

	const mk = (id, updatedAt, explain, extra = {}) => ({ id, origin: "pc", createdAt: 1, updatedAt, requests: [], ...(explain ? { explain } : {}), ...extra });
	const E = (path = "r/q.md") => ({ path, quiz: "Q" });
	const chats = [mk("a", 3, E()), mk("b", 9, E()), mk("c", 20, E(), { deleted: true }), mk("d", 30, null), mk("f", 50, E("r/other.md"))];
	r.check("newest live chat of the quiz", chatForQuiz(chats, "r/q.md")?.id ?? null, "b");
	r.check("no chat for another quiz", chatForQuiz(chats, "r/none.md"), null);
	r.check("never a chat without the mark", chatForQuiz([mk("d", 30, null)], "r/q.md"), null);
	r.check("path must match exactly", chatForQuiz(chats, "r/other.md")?.id ?? null, "f");

	const rec = { ...mk("b", 9, E()), requests: [{ id: "r1", at: 100, from: "pc", text: "why?", mode: "learn", state: "done", documents: [{ name: "a.png" }], results: [{ kind: "text", text: "because" }] }] };
	const line = (id, chatId, requestId, etat, extra = {}) => ({ id, etat, debut: 200, demande: { text: "and then?", chatId, requestId, sentAt: 200, notes: [], images: [], explication: { mark: E(), context: "", course: "", position: "" } }, ...extra });
	const lines = [line(7, "b", "r2", "cours"), line(8, "other", "r9", "cours"), line(9, "b", "r1", "prete", { resultat: { titre: "", chemin: "", texte: "because" } })];
	const msgs = explainMessages(rec, lines, "b");
	r.check("recorded turn, then the running one", msgs.map(m => m.role + ":" + m.text).join("|"), "user:why?|assistant:because|user:and then?|assistant:");
	r.check("running answer flagged with its line", [msgs[3].running, msgs[3].lineId], [true, 7]);
	r.check("a line of another chat never shows", msgs.length, 4);
	r.check("a recorded request is not doubled by its line", msgs.filter(m => m.text === "because").length, 1);
	r.check("documents of a recorded request", msgs[0].documents.join(), "a.png");
	const RUN = { runId: "00000000-0000-4000-8000-000000000001", fromSeq: 3, toSeq: 8 };
	const recLive = { ...rec, requests: [{ ...rec.requests[0], runs: [RUN] }] };
	const live = explainMessages(recLive, [], "b");
	r.check("a recorded answer that ran live keeps its runs, its question none", [live[1].runs, "runs" in live[0]], [[RUN], false]);
	r.check("a recorded answer without a live turn has no runs", "runs" in msgs[1], false);
	const failed = explainMessages(null, [line(10, "b", "r3", "echouee", { erreur: "boom" })], "b");
	r.check("a failed line shows its error", [failed[1].error, failed[1].running], ["boom", false]);

	const tt = explainTurnTexts({ context: "CTX", course: "COURSE", message: "MSG", position: "POS" });
	r.check("full turn: context, course, message, then the position LAST", [tt.full.includes("CTX"), tt.full.includes("COURSE"), tt.full.indexOf("MSG") < tt.full.indexOf("POS"), tt.full.trimEnd().endsWith("POS")], [true, true, true, true]);
	r.check("follow-up: the message, then the position", [tt.followUp.startsWith("MSG"), tt.followUp.trimEnd().endsWith("POS"), tt.followUp.includes("CTX")], [true, true, false]);
	const np = explainTurnTexts({ context: "CTX", course: "", message: "MSG", position: "" });
	r.check("no position (from the AI page): the message alone", np.followUp, "MSG");

	const qs = [{ title: "Intro", prompt: "What is a stack?", options: ["LIFO", "FIFO"], correctIndex: 0 }, { title: "Queues", prompt: "What is a queue?", options: ["LIFO", "FIFO"], correctIndex: 1 }];
	const pos = positionCourante(qs, { courant: 1, myAnswer: "LIFO", correct: false });
	r.check("position names the slide out of the total", pos.includes("slide 2 of 2"), true);
	r.check("position holds that whole question and the learner's answer, not another one", [pos.includes("What is a queue?"), pos.includes("Learner's answer: LIFO"), pos.includes("What is a stack?")], [true, true, false]);
	r.check("no position for a missing slide", positionCourante(qs, { courant: 5 }), "");
	// The lock: asking before answering would give the answer away; a reading card stays open.
	const { composerOpen } = F;
	r.check("a reading card is open before any answer", composerOpen({ role: "read" }, false), true);
	r.check("a question is locked until it is corrected", composerOpen({}, false), false);
	r.check("a corrected question is open", composerOpen({}, true), true);
	r.check("no question on screen: nothing to lock on", composerOpen(undefined, true), false);

	// A turn sent from the AI page: the whole quiz from the note, no slide on screen.
	const { explainDemandFromNote } = D;
	const NL = String.fromCharCode(10);
	const note = ["# Q", "", "```quiz-blocks", "[", '  { title: "Intro", prompt: "What is a stack?", options: ["LIFO", "FIFO"], correctIndex: 0 },', '  { title: "Queues", prompt: "What is a queue?", options: ["LIFO", "FIFO"], correctIndex: 1 },', "]", "```", ""].join(NL);
	const dem = explainDemandFromNote(note, { path: "r/Cours/q.md", quiz: "Q" });
	r.check("the demand holds BOTH questions and no slide marked", [dem?.context.includes("What is a stack?"), dem?.context.includes("What is a queue?"), dem?.context.includes("<<< QUESTION ON SCREEN >>>")], [true, true, false]);
	r.check("no course read, no position, the quiz's folder", [dem?.course, dem?.position, dem?.folder], ["", "", "r/Cours"]);
	r.check("the demand keeps the chat's mark", dem?.mark, { path: "r/Cours/q.md", quiz: "Q" });
	r.check("the tutor method closes the context", dem?.context.trimEnd().endsWith(P.consigneExplication(false).trimEnd()), true);
	r.check("a note without a quiz block: no demand", explainDemandFromNote("# Just text" + NL, { path: "r/q.md", quiz: "Q" }), null);
	r.check("a broken quiz block: no demand", explainDemandFromNote(["```quiz-blocks", "[ { oops", "```", ""].join(NL), { path: "r/q.md", quiz: "Q" }), null);
	r.check("a quiz at the root: no folder", explainDemandFromNote(note, { path: "q.md", quiz: "Q" })?.folder, undefined);
	r.done();
});
