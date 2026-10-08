/**
 * REMOTE REQUESTS (`src/shared-state/remote-request.ts`): a synced file that
 * makes the PC launch a CLI. Every rule of the spec's "security boundary" as a
 * discriminating case. Prevents: a malformed, foreign, replayed, flooded,
 * expired or path-escaping request being run.
 *     npm run check:remote-request
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/shared-state/remote-request.ts", (R) => {
	const r = makeReporter("Remote request");
	const PC = "11111111-1111-4111-8111-111111111111", PH = "22222222-2222-4222-8222-222222222222", NOW = 1_800_000_000_000;
	const good = (over = {}) => ({ v: 1, id: "lq3k2-abc123", at: NOW - 1000, from: PH, target: PC, chatId: "chat-1234", text: "Make a Learn on lists", mode: "learn", documents: [{ path: "Python/cm1.md" }], ...over });
	const ctx = (over = {}) => ({ device: PC, fileDevice: PH, fileId: "lq3k2-abc123", now: NOW, ...over });
	const v = (raw, c = ctx()) => R.validateRemote(raw, c);

	r.check("a good request is accepted", v(good()).ok, true);
	r.check("optional fields are kept", v(good({ fromName: "Pixel", types: ["Choix unique"], count: 12 })).request, good({ fromName: "Pixel", types: ["Choix unique"], count: 12 }));
	for (const [n, raw] of [["null", null], ["array", []], ["string", "x"], ["v2", good({ v: 2 })], ["missing text", (() => { const g = good(); delete g.text; return g; })()]]) {
		r.check("invalid: " + n, [v(raw).ok, v(raw).reason], [false, "invalid"]);
	}
	// Unknown fields rejected (spec): a request cannot carry a provider, a model, a path to a CLI, a setting
	for (const extra of ["provider", "model", "effort", "cliPath", "settings", "args", "flags", "destination", "reglages"]) {
		r.check("unknown field refused: " + extra, v({ ...good(), [extra]: "x" }).reason, "invalid");
	}
	r.check("unknown field inside a document refused", v(good({ documents: [{ path: "a.md", content: "x" }] })).reason, "invalid");
	// Identity
	r.check("file name must equal the id", v(good(), ctx({ fileId: "other-id-123" })).reason, "invalid");
	r.check("id must be a plain slug", v(good({ id: "../x" }), ctx({ fileId: "../x" })).reason, "invalid");
	r.check("directory must equal `from` (no impersonation)", v(good(), ctx({ fileDevice: "33333333-3333-4333-8333-333333333333" })).reason, "wrong-sender");
	r.check("`from` must be a device id", v(good({ from: "bob" }), ctx({ fileDevice: "bob" })).reason, "wrong-sender");
	r.check("a request addressed to another PC is not ours", v(good({ target: "33333333-3333-4333-8333-333333333333" })).reason, "wrong-target");
	r.check("our own directory is never read as a sender", v(good({ from: PC }), ctx({ fileDevice: PC })).reason, "wrong-sender");
	// Time (review focus 3)
	r.check("23 h old is accepted", v(good({ at: NOW - 23 * 3600e3 })).ok, true);
	r.check("25 h old is expired", v(good({ at: NOW - 25 * 3600e3 })).reason, "expired");
	r.check("4 minutes in the future is tolerated (clock skew)", v(good({ at: NOW + 4 * 60e3 })).ok, true);
	r.check("an hour in the future is refused", v(good({ at: NOW + 3600e3 })).reason, "future");
	r.check("a non-finite time is invalid", v(good({ at: "now" })).reason, "invalid");
	// Sizes
	r.check("text of exactly 20 000 characters is accepted", v(good({ text: "x".repeat(20_000) })).ok, true);
	r.check("text of 20 001 characters is refused", v(good({ text: "x".repeat(20_001) })).reason, "invalid");
	r.check("blank text is refused", v(good({ text: "  \n " })).reason, "invalid");
	r.check("a NUL in the text is refused", v(good({ text: "a\0b" })).reason, "invalid");
	r.check("10 documents are accepted", v(good({ documents: Array.from({ length: 10 }, (_, i) => ({ path: `d${i}.md` })) })).ok, true);
	r.check("11 documents are refused", v(good({ documents: Array.from({ length: 11 }, (_, i) => ({ path: `d${i}.md` })) })).reason, "invalid");
	r.check("more than 8 types are refused", v(good({ types: Array.from({ length: 9 }, () => "Choix unique") })).reason, "invalid");
	r.check("count must be a whole number from 1 to 100", [0, 1.5, 101, "9"].map(c => v(good({ count: c })).ok), [false, false, false, false]);
	r.check("mode is learn or practice only", [v(good({ mode: "exam" })).ok, v(good({ mode: "practice" })).ok], [false, true]);
	// Paths (review focus 5)
	for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd.md", "C:/x.md", "c:\\x.md", "a\\b.md", "a/b.md::$DATA", "a/b.md ", "a/b.md.", ".neo-quiz/chats/pc.json.md", ".neo-quiz/requests/x.md", "x.exe", "run.bat", "a/b.pdf", "", "a//b.md", "a/./b.md", "x?.md", "con.md\0", "a".repeat(600) + ".md"]) {
		r.check("document path refused: " + JSON.stringify(bad.slice(0, 40)), v(good({ documents: [{ path: bad }] })).reason, "invalid");
	}
	for (const ok of ["a.md", "Cours/CM 1.md", "Cours/notes.txt", "Cours/é à.markdown"]) {
		r.check("document path accepted: " + ok, v(good({ documents: [{ path: ok }] })).ok, true);
	}
	r.check("a control character in the sender name is refused", v(good({ fromName: "Pix\nel" })).reason, "invalid");
	r.check("a sender name longer than 64 is refused", v(good({ fromName: "x".repeat(65) })).reason, "invalid");

	// Admission
	const taken = (n, at) => Array.from({ length: n }, (_, i) => ({ id: "t" + i, from: PH, at }));
	r.check("a fresh request runs", R.admit({ id: "new", from: PH }, { taken: [], busy: false }, NOW), "run");
	r.check("a request already taken never runs again (restart, replay)", R.admit({ id: "t0", from: PH }, { taken: taken(1, NOW - 10), busy: false }, NOW), "known");
	r.check("another remote request is running: wait", R.admit({ id: "new", from: PH }, { taken: [], busy: true }, NOW), "busy");
	r.check("6 taken in the last hour: the 7th waits", R.admit({ id: "new", from: PH }, { taken: taken(6, NOW - 1000), busy: false }, NOW), "rate");
	r.check("5 taken: the 6th runs", R.admit({ id: "new", from: PH }, { taken: taken(5, NOW - 1000), busy: false }, NOW), "run");
	r.check("6 taken but over an hour ago: runs", R.admit({ id: "new", from: PH }, { taken: taken(6, NOW - 3601e3), busy: false }, NOW), "run");
	r.check("a request already known wins over busy", R.admit({ id: "t0", from: PH }, { taken: taken(1, NOW), busy: true }, NOW), "known");

	// Pending state shown on the phone
	const st = (over) => R.pendingState({ id: "x", at: NOW - 1000 }, { recorded: new Set(), running: new Set(), now: NOW, ...over });
	r.check("pending: waiting", st({}), "waiting");
	r.check("pending: running when the PC reports it", st({ running: new Set(["x"]) }), "running");
	r.check("pending: done once recorded in a chat file (wins over running)", st({ recorded: new Set(["x"]), running: new Set(["x"]) }), "done");
	r.check("pending: expired after 24 h without answer", R.pendingState({ id: "x", at: NOW - 25 * 3600e3 }, { recorded: new Set(), running: new Set(), now: NOW }), "expired");
	r.check("pending: a done request is never shown expired", R.pendingState({ id: "x", at: NOW - 30 * 3600e3 }, { recorded: new Set(["x"]), running: new Set(), now: NOW }), "done");

	// Hostile input
	r.check("a parsed __proto__ key is refused", v(JSON.parse(JSON.stringify(good()).slice(0, -1) + ',"__proto__":{"a":1}}')).reason, "invalid");
	r.check("a constructor key is refused", v(JSON.parse(JSON.stringify(good()).slice(0, -1) + ',"constructor":{}}')).reason, "invalid");
	r.check("a __proto__ key inside a document is refused", v(good({ documents: [JSON.parse('{"path":"a.md","__proto__":{}}')] })).reason, "invalid");
	for (const [n, over] of [["id number", { id: 5 }], ["text array", { text: ["a"] }], ["chatId object", { chatId: {} }], ["mode array", { mode: ["learn"] }], ["target number", { target: 1 }], ["documents string", { documents: "a.md" }], ["document string", { documents: ["a.md"] }], ["document null", { documents: [null] }], ["path number", { documents: [{ path: 1 }] }], ["types string", { types: "x" }], ["type number", { types: [1] }], ["fromName number", { fromName: 1 }]]) {
		r.check("wrong type refused: " + n, v(good(over)).ok, false);
	}
	for (const at of [NaN, Infinity, -Infinity, null, undefined, "1"]) r.check("time refused: " + String(at), v(good({ at })).ok, false);
	r.check("a request from the epoch is expired", v(good({ at: 0 })).reason, "expired");
	r.check("a huge documents array is refused", v(good({ documents: new Array(1_000_000).fill({ path: "a.md" }) })).reason, "invalid");
	r.check("a sparse documents array is refused", v(good({ documents: [, { path: "a.md" }] })).ok, false);
	r.check("a sparse types array is refused", v(good({ types: [, "x"] })).ok, false);
	r.check("a non-object input is refused", [undefined, 1, true, NaN].map(x => v(x).ok), [false, false, false, false]);
	for (const [n, bad] of [["RTL override", "a/‮x.md"], ["RTL isolate", "a/⁧x.md"], ["zero width space", "a/b​.md"], ["BOM", "﻿a.md"], ["fullwidth dots", "．．/x.md"], ["fullwidth slash", "a／x.md"], ["fullwidth colon", "C：/x.md"], ["one dot leader", "․․/x.md"], ["NFD accent", "é.md"], ["Windows device", "con.md"], ["device in a folder", "a/NUL.txt"], ["com1 with extension", "com1.txt"], ["dot-ended directory", "a./b.md"], ["space-ended directory", "a /b.md"], ["tilde short name", "PROGRA~1/x.md"], ["DEL", "a\u007fb.md"], ["C1 control", "a\u0085b.md"], ["line separator", "a b.md"], ["internal folder, other case", ".NEO-QUIZ/x.md"], ["internal folder, trailing dot", ".neo-quiz./x.md"], ["bare extension", ".md"], ["UNC", "//host/share/x.md"], ["backslash UNC", "\\\\host\\x.md"]]) {
		r.check("hostile path refused: " + n, v(good({ documents: [{ path: bad }] })).reason, "invalid");
	}
	r.check("name with bidi control refused", v(good({ fromName: "a‮b" })).reason, "invalid");
	r.check("name with zero width refused", v(good({ fromName: "a​b" })).reason, "invalid");
	r.check("text with a bidi override is kept as data", v(good({ text: "a‮b" })).ok, true);
	r.check("text with a C0 control other than tab/newline is refused", v(good({ text: "a\u0007b" })).reason, "invalid");
	r.check("text with newline, tab, CRLF is accepted", v(good({ text: "a\n\tb\r\nc" })).ok, true);
	r.check("the id slug is exported and strict", [R.SLUG.test("lq3k2-abc123"), R.SLUG.test("../x"), R.SLUG.test("A-bcd"), R.SLUG.test("ab")], [true, false, false, false]);
	r.check("device id regex is exported", [R.DEVICE.test(PC), R.DEVICE.test("bob")], [true, false]);
	r.check("the result is a copy, never the raw object", (() => { const g = good(); const out = v(g).request; return out !== g && out.documents !== g.documents; })(), true);
	r.check("a non-finite clock rate-limits", R.admit({ id: "new", from: PH }, { taken: [], busy: false }, NaN), "rate");
	r.check("a taken entry with a corrupt time still counts", R.admit({ id: "new", from: PH }, { taken: Array.from({ length: 6 }, (_, i) => ({ id: "t" + i, at: NaN })), busy: false }, NOW), "rate");
	r.check("pending: a non-finite clock is never expired", R.pendingState({ id: "x", at: NOW }, { recorded: new Set(), running: new Set(), now: NaN }), "waiting");
	r.check("pending: a corrupt request time is expired", R.pendingState({ id: "x", at: NaN }, { recorded: new Set(), running: new Set(), now: NOW }), "expired");
	// Fix round 1
	const A = "abcdef01-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bcdef012-bbbb-4bbb-8bbb-bbbbbbbbbbbb", AU = A.toUpperCase(), BU = B.toUpperCase();
	const cx = (over = {}) => ctx({ device: A, fileDevice: B, ...over });
	const gd = (over = {}) => good({ from: B, target: A, ...over });
	r.check("letters ids differ in case (sanity)", [A !== AU, B !== BU], [true, true]);
	r.check("own id in upper case is still us as sender", v(gd({ from: AU }), cx({ fileDevice: AU })).reason, "wrong-sender");
	r.check("own folder in upper case is still us", v(gd({ from: A }), cx({ fileDevice: AU })).reason, "wrong-sender");
	r.check("sender folder in other case is the same device", v(gd({ from: BU }), cx()).ok, true);
	r.check("target in upper case is this device", v(gd({ target: AU }), cx()).ok, true);
	for (const n of ["COM¹.md", "lpt².txt", "COM³.md", "CONIN$.md", "conout$.txt", "nul .md", "nul  .txt", "a/con .md", "aux.tar.md", "NUL.x.md"]) r.check("device name refused: " + JSON.stringify(n), v(good({ documents: [{ path: n }] })).reason, "invalid");
	r.check("a name merely starting like a device is fine", v(good({ documents: [{ path: "console.md" }] })).ok, true);
	r.check("same id from two senders is not known", R.admit({ id: "same", from: PH }, { taken: [{ id: "same", from: PC, at: NOW }], busy: false }, NOW), "run");
	r.check("same sender and id (any case) is known", R.admit({ id: "same", from: B }, { taken: [{ id: "same", from: BU, at: NOW }], busy: false }, NOW), "known");
	r.done();
});
