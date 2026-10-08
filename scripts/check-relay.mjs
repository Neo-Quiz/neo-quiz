/**
 * THE RELAY (`src/dashboard/relay.ts`): the prompt shared to an AI app and the
 * answer pasted back. Prevents: a relay prompt that drifts from the PC's, a
 * pasted answer executed or polluting prototypes, a wrong or oversized paste
 * being saved, two quizzes silently merged.
 *     npm run check:relay
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/relay.ts", "src/dashboard/ai-client.ts", "src/dashboard/ai-web.ts", "src/dashboard/generation-demande.ts"], (RL, AC, AW, GD) => {
	const r = makeReporter("Relay");
	const doc = { name: "cm1.md", content: "# Lists\nA list is ordered." };
	const input = { text: "Make a Learn on lists", mode: "learn", documents: [doc], count: 10 };
	const built = RL.buildRelayPrompt(input, "tok123abc9");

	// Parity with the PC: the same builders, byte for byte, for the same request.
	const msg = { text: input.text, notes: [{ ...doc, source: "vault" }], images: [] };
	const { source, prompt } = GD.composerDemande(msg);
	const pc = AC.composerPrompts(prompt, { count: 10, type: undefined, source, mode: "learn" });
	r.check("the relay text is the web channel's text of the PC's prompts", built.text, AW.texteWeb(pc, "tok123abc9"));
	r.check("the PC's system prompt is inside the relay text", built.text.includes(pc.systemPrompt.split("\n")[0]), true);
	r.check("the documents' content travels in the prompt", built.text.includes("A list is ordered."), true);
	r.check("the token is in the instruction", built.text.includes("tok123abc9"), true);
	r.check("a Test is chosen only when the words say so", [RL.buildRelayPrompt({ ...input, mode: undefined, text: "Make a test on lists" }).mode, RL.buildRelayPrompt({ ...input, mode: undefined, text: "teach me lists" }).mode, RL.buildRelayPrompt({ ...input, mode: undefined, text: "lists" }).mode], ["practice", "learn", "learn"]);
	r.check("a fresh token each time when none is given", RL.buildRelayPrompt(input).token !== RL.buildRelayPrompt(input).token, true);

	const q = (n) => `{ prompt: "Q${n}", options: ["a","b"], correctIndex: 0, explain: "because" }`;
	const quiz = `[ ${q(1)}, ${q(2)} ]`;
	const ok = (t, m = "practice", tok) => RL.extractQuizAnswer(t, m, tok);
	r.check("a quiz-blocks fence inside prose", ok("Here you go:\n```quiz-blocks\n" + quiz + "\n```\nEnjoy").ok, true);
	r.check("a json5 fence with the token comment", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("a json fence with the token comment", ok("```json\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("a bare array with no fence", ok(quiz).ok, true);
	r.check("prose then a bare array", ok("Sure!\n" + quiz).ok, true);
	r.check("the questions are returned", ok("```quiz-blocks\n" + quiz + "\n```").questions.length, 2);
	r.check("two quiz-blocks fences are refused, nothing guessed", ok("```quiz-blocks\n" + quiz + "\n```\n```quiz-blocks\n" + quiz + "\n```").reason, "several");
	r.check("two token fences are refused", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```\n```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").reason, "several");
	r.check("a quiz-blocks fence and a token fence are two candidates", ok("```quiz-blocks\n" + quiz + "\n```\n```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").reason, "several");
	r.check("nothing quiz-like", ok("I cannot help with that.").reason, "none");
	r.check("prose with brackets is not a quiz", ok("See [1] and [2].").ok, false);
	r.check("empty paste", [ok("").reason, ok("  \n").reason], ["empty", "empty"]);
	r.check("an oversized paste is refused before parsing", ok("x".repeat(RL.MAX_ANSWER_CHARS + 1)).reason, "too-large");
	r.check("exactly the bound is read", ok(" ".repeat(RL.MAX_ANSWER_CHARS - quiz.length) + quiz).ok, true);
	r.check("an answer carrying ANOTHER request's token is refused", ok("```json5\n// neo-quiz otherothe1\n" + quiz + "\n```", "practice", "tok123abc9").reason, "other-request");
	r.check("the right token is accepted", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("an answer with no token at all is accepted as a bare array", ok("```json5\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	const bad = ok("```quiz-blocks\n[ { prompt: 'a', options: [ }\n```");
	r.check("malformed JSON that looks like a quiz is invalid, with the parser's position", [bad.reason, typeof bad.detail], ["invalid", "string"]);
	r.check("an empty array has no questions", ok("```quiz-blocks\n[]\n```").reason, "no-questions");
	r.check("an array of non-objects has no questions", ok("```quiz-blocks\n[1,2,3]\n```").reason, "no-questions");
	const learn = ok("```quiz-blocks\n" + quiz + "\n```", "learn");
	r.check("a Learn answer with no objectives fails the format check, naming what is missing", [learn.reason, String(learn.detail).includes("sansObjectifs")], ["format", true]);
	const noExplain = ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0 } ]\n```");
	r.check("a Test answer with no explanation fails the format check", [noExplain.reason, String(noExplain.detail).includes("sansExplication")], ["format", true]);

	// HTML: kept as data (legitimate keys), sanitised at render by the four doors; never executed here.
	const withHtml = `[ { prompt: "Q", options: ["a","b"], correctIndex: 0, explainHtml: "<img src=x onerror=alert(1)>", promptHtml: "<script>1</script>" } ]`;
	const res = ok("```quiz-blocks\n" + withHtml + "\n```");
	r.check("an answer whose only explanation is explainHtml is accepted, the key kept", [res.ok, res.questions?.[0]?.explainHtml], [true, "<img src=x onerror=alert(1)>"]);
	r.check("an inline <script> in a text field is kept as text", JSON.stringify(ok("```quiz-blocks\n[ { prompt: \"<script>1</script>\", options: [\"a\",\"b\"], correctIndex: 0, explain: \"x\" } ]\n```").questions).includes("<script>"), true);

	// Prototype pollution
	const pol = ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0, explain: 'x', \"__proto__\": { \"polluted\": true }, \"constructor\": { \"prototype\": { \"polluted\": true } } } ]\n```");
	r.check("no own __proto__ key and nothing polluted", [pol.ok, Object.hasOwn(pol.questions[0], "__proto__"), Object.hasOwn(pol.questions[0], "constructor"), ({}).polluted, Object.prototype.polluted], [true, false, false, undefined, undefined]);

	// Hostile shapes
	r.check("NaN is refused", ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: NaN, explain: 'x' } ]\n```").reason, "invalid");
	r.check("Infinity is refused", ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0, explain: 'x', n: -Infinity } ]\n```").reason, "invalid");
	const dr = ok("[".repeat(50000) + "]".repeat(50000));
	r.check("deep nesting never throws and is not a quiz", [typeof dr.ok, dr.ok], ["boolean", false]);
	r.check("a nested fence inside a string does not crash", typeof ok("```quiz-blocks\n[ { prompt: 'a ``` b', options: ['a','b'], correctIndex: 0, explain: 'x' } ]\n```").ok, "boolean");
	r.check("a code expression is data, never run", ok("```quiz-blocks\n[ { prompt: (()=>1)(), options: ['a'] } ]\n```").ok, false);
	r.done();
});

await withSrcModule(["src/dashboard/relay-flow.ts", "src/dashboard/chat-requests.ts"], async (F, CR) => {
	const r = makeReporter("Relay flow");
	const q = `[ { prompt: "Q1", options: ["a","b"], correctIndex: 0, explain: "x" } ]`;
	const entry = { path: "Root/Generated/Lists - Practice.md", title: "Lists - Practice", basename: "Lists - Practice", mtime: 1 };
	function rig(over = {}) {
		const saved = [], shared = []; let chats = [];
		const deps = {
			device: "phone-0001", rootId: "Root", now: () => 5000,
			share: async (text, files) => { shared.push([text, files.map(f => f.nom)]); return true; },
			readClipboard: async () => "```quiz-blocks\n" + q + "\n```",
			readDocument: async (rel) => rel.endsWith("gone.md") ? null : ({ name: rel.split("/").pop(), content: "DOC " + rel, bytes: new TextEncoder().encode("DOC " + rel) }),
			save: async (e) => { saved.push(e); return entry; },
			scanner: {}, reglages: () => ({ aiOutputFolder: "Generated" }),
			chats: { get: () => chats, set: (l) => { chats = l; } }, ...over,
		};
		return { deps, saved, shared, chats: () => chats };
	}
	const req = { chatId: "chat-1234", text: "Make a test on lists", documents: [{ path: "Python/cm1.md" }], destination: "" };

	{ const g = rig({ readDocument: async (rel) => ({ name: "big.md", content: "x".repeat(200_000), bytes: new Uint8Array(3) }) });
		let key = null; try { await F.startRelay(g.deps, req); } catch (e) { key = e.key; }
		r.check("a prompt over the share cap is refused before Kotlin, with its own message, nothing shared", [key, g.shared.length], ["ai.relay.tooLong", 0]);
	}
	{ const g = rig({ readDocument: async () => ({ name: "notes.pdf", content: "x", bytes: new Uint8Array(1) }) });
		let key = null; try { await F.startRelay(g.deps, req); } catch (e) { key = e.key; }
		r.check("a document extension the share refuses is refused before Kotlin", [key, g.shared.length], ["ai.remote.textOnly", 0]);
	}
	{ const g = rig({ readDocument: async () => ({ name: "notes.markdown", content: "x", bytes: new Uint8Array(1) }) });
		r.check(".markdown is shareable (Kotlin accepts it too)", (await F.startRelay(g.deps, req)) !== null, true);
	}
	{ const g = rig();
		const s = await F.startRelay(g.deps, req);
		r.check("the prompt and the documents are shared; a Test is chosen from the words", [g.shared.length, g.shared[0][1], s.mode], [1, ["cm1.md"], "practice"]);
		const out = await F.pasteAnswer(g.deps, s);
		r.check("a valid paste saves one quiz and answers with its title and path", [out.ok, out.title, out.path], [true, "Lists - Practice", "Root/Generated/Lists - Practice.md"]);
		r.check("it is saved like a generated quiz: the request text and document names, the chosen mode", [g.saved.length, g.saved[0].modeDemande, g.saved[0].demande.notes.map(n => n.name)], [1, "practice", ["cm1.md"]]);
		const rec = g.chats().find(c => c.id === "chat-1234").requests[0];
		r.check("the request is recorded in OUR chat, from this device, with the quiz card", [g.chats()[0].origin, rec.from, rec.state, rec.results, rec.documents], ["phone-0001", "phone-0001", "done", [{ kind: "quiz", title: "Lists - Practice", path: "Root/Generated/Lists - Practice.md" }], [{ name: "cm1.md", path: "Root/Python/cm1.md" }]]);
		r.check("the request id is the session's", rec.id, s.requestId);
		const again = await F.pasteAnswer(g.deps, s);
		r.check("a second paste on a consumed session saves nothing more and says so", [again.ok, again.reason, g.saved.length, g.chats()[0].requests.length], [false, "already-saved", 1, 1]);
	}
	{ const g = rig({ readClipboard: async () => "I cannot do that." });
		const out = await F.pasteAnswer(g.deps, await F.startRelay(g.deps, req));
		r.check("a paste with no quiz saves nothing and says why", [out.ok, out.reason, g.saved.length, g.chats().length], [false, "none", 0, 0]);
	}
	{ const g = rig({ readClipboard: async () => null });
		const out = await F.pasteAnswer(g.deps, await F.startRelay(g.deps, req));
		r.check("an empty clipboard saves nothing", [out.reason, g.saved.length], ["clipboard-empty", 0]);
	}
	{ const g = rig({ readClipboard: async () => "```json5\n// neo-quiz someoneelse9\n" + q + "\n```" });
		const out = await F.pasteAnswer(g.deps, await F.startRelay(g.deps, req));
		r.check("an answer for another request is not saved", [out.reason, g.saved.length], ["other-request", 0]);
	}
	{ const g = rig({ save: async () => null });
		const s = await F.startRelay(g.deps, req);
		const out = await F.pasteAnswer(g.deps, s);
		r.check("a save that fails is reported, nothing recorded", [out.reason, g.chats().length], ["save-failed", 0]);
		g.deps.save = async () => entry;
		r.check("a failed save does not consume the session: a retry works", (await F.pasteAnswer(g.deps, s)).ok, true);
	}
	{ const g = rig();
		const s = await F.startRelay(g.deps, { ...req, documents: [{ path: "Python/gone.md" }] });
		r.check("an unreadable document stops the relay before anything is shared", [s, g.shared.length], [null, 0]);
		const h = rig({ share: async () => false });
		r.check("a share sheet that did not open gives no session", await F.startRelay(h.deps, req), null);
	}
	{ const g = rig({ readClipboard: async () => "```quiz-blocks\n[ { prompt: \"Q\", options: [\"a\",\"b\"], correctIndex: 0, explain: \"x\", explainHtml: \"<img src=x onerror=alert(1)>\" } ]\n```" });
		await F.pasteAnswer(g.deps, await F.startRelay(g.deps, req));
		r.check("the questions reach the saver as parsed data (sanitised at render)", g.saved.length, 1);
	}
	{ // A PC chat: the phone's copy keeps the PC's origin; ownToWrite keeps only requests no other file holds.
		const g = rig();
		const pc = { id: "chat-1234", origin: "pc-0001", createdAt: 1, updatedAt: 1, requests: [{ id: "old", at: 1, from: "pc-0001", text: "x", mode: "learn", documents: [], results: [], state: "done" }] };
		g.deps.chats.set([pc]);
		const out = await F.pasteAnswer(g.deps, await F.startRelay(g.deps, req));
		const c = g.chats()[0];
		r.check("relay into a PC chat keeps the PC origin and appends the request", [out.ok, c.origin, c.requests.map(x => x.id).length, c.requests.at(-1).from], [true, "pc-0001", 2, "phone-0001"]);
	}
	{ // The bytes of a document, bounded, through the bridge.
		const fs = (size, bytes) => ({ size: async () => size, readBinary: async () => bytes });
		const ok = await F.readRelayDocument(fs(3, new TextEncoder().encode("abc")), "Root", "Python/cm1.md");
		r.check("a document is read as text and bytes", [ok?.name, ok?.content, ok?.bytes.length], ["cm1.md", "abc", 3]);
		r.check("an oversized document is refused before reading", await F.readRelayDocument(fs(9_000_000, new Uint8Array(1)), "Root", "Python/cm1.md"), null);
		r.check("a binary document is refused", await F.readRelayDocument(fs(2, new Uint8Array([0xff, 0xfe])), "Root", "Python/cm1.md"), null);
		r.check("a path escaping the root is refused", await F.readRelayDocument(fs(3, new Uint8Array(3)), "Root", "../x.md"), null);
	}
	{ // appendRequest: the one helper under the relay and addFailedRequest.
		const rq = { id: "r1", at: 10, from: "p", text: "t", mode: "learn", documents: [], results: [], state: "done" };
		const made = CR.appendRequest([], "c1", rq, "p", 50);
		r.check("appendRequest creates an unknown chat with the device as origin", [made[0].origin, made[0].updatedAt, made[0].requests.length], ["p", 50, 1]);
		const twice = CR.appendRequest(made, "c1", rq, "p", 99);
		r.check("appendRequest is idempotent on the request id", [twice[0].updatedAt, twice[0].requests.length], [50, 1]);
		r.check("appendRequest leaves a deleted chat deleted", CR.appendRequest([{ ...made[0], deleted: true }], "c1", { ...rq, id: "r2" }, "p", 60)[0].requests.length, 1);
	}
	r.done();
});

// Section 3: the refusal messages of the phone's relay, in both dictionaries.
await withSrcModule(["src/i18n/en/ai.ts", "src/i18n/fr/ai.ts"], (EN, FR) => {
	const r = makeReporter("Relay messages");
	const reasons = ["empty", "too-large", "none", "several", "other-request", "invalid", "no-questions", "format", "clipboard-empty", "save-failed", "already-saved"];
	r.check("every refusal has an English message", reasons.filter(x => !(("ai.relay.err." + x) in EN.EN_AI)), []);
	r.check("every refusal has a French message", reasons.filter(x => !(("ai.relay.err." + x) in FR.FR_AI)), []);
	r.done();
});
