/**
 * THE CHAT STORE and the ACTIVE CHAT (`src/dashboard/chat-store.ts`,
 * `chat-session.ts`), on the real code and a fake storage.
 *
 * What it prevents: a full or refused storage throwing, or losing the newest
 * chat; a chat that disappears from the screen of the session because the
 * write failed; a deleted chat coming back; the legacy archive imported twice
 * (or deleted: the old key must stay for a rollback); a hostile stored value
 * or active-chat id breaking the page; a reload that forgets the chat on screen.
 *
 *     npm run check:chat-store
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const memory = (limit = Infinity) => {
	const m = new Map();
	return {
		m,
		getItem: k => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => { if (v.length > limit) throw new Error("QuotaExceededError"); m.set(k, v); },
	};
};
const legacy0 = JSON.stringify([{ id: "o", date: 7, title: "O", turns: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] }]);
const req = (id, at, text = "t") => ({ id, at, from: "d1", text, mode: "practice", documents: [], results: [], state: "done" });
const chat = (id, updatedAt, text = "t") => ({ id, origin: "d1", createdAt: 1, updatedAt, requests: [req("r1", 1, text)] });

await withSrcModule("src/dashboard/chat-store.ts", (S) => {
	const r = makeReporter("Chat store");
	let s = memory();
	r.check("empty storage: no chats", S.getChats(s), []);
	S.getChats(s).push(chat("x", 1));
	r.check("getChats hands out a copy", S.getChats(s), []);
	r.check("set then get round-trips", [S.setChats([chat("a", 5), chat("b", 9)], s), S.getChats(s).map(c => c.id).sort()], [true, ["a", "b"]]);
	r.check("stored in the record shape", JSON.parse(s.m.get("neo-quiz.chats")).v, 1);

	S.removeChat("a", 50, s);
	const after = S.getChats(s).find(c => c.id === "a");
	r.check("delete is a tombstone: kept, empty, dated, flagged", [after.deleted, after.requests.length, after.updatedAt], [true, 0, 50]);
	r.check("a tombstone survives the bound and a reread", JSON.parse(s.m.get("neo-quiz.chats")).chats.some(c => c.id === "a" && c.deleted), true);

	// A full storage: the newest chats stay on disk, and the session still sees ALL of them.
	s = memory(3000);
	const many = Array.from({ length: 40 }, (_, i) => chat("p" + i, i + 1, "x".repeat(150)));
	r.check("a full storage never throws", (() => { try { S.setChats(many, s); return true; } catch { return false; } })(), true);
	r.check("the session keeps every chat in memory", S.getChats(s).length, 40);
	const onDisk = JSON.parse(s.m.get("neo-quiz.chats") ?? '{"chats":[]}').chats;
	r.check("on disk, fewer chats, and the newest stayed", [onDisk.length > 0, onDisk.length < 40, onDisk.some(c => c.id === "p39")], [true, true, true]);

	{
		// Oldest live chat goes first, one at a time; tombstones stay; nothing fits -> false.
		const m = memory(1100);
		const three = [chat("old", 1, "x".repeat(300)), chat("mid", 2, "x".repeat(300)), chat("new", 3, "x".repeat(300)), { id: "gone", origin: "d1", createdAt: 1, updatedAt: 0, deleted: true, requests: [] }];
		const ok = S.setChats(three, m);
		const ids = JSON.parse(m.m.get("neo-quiz.chats")).chats.map(c => c.id).sort();
		r.check("full storage drops the oldest one at a time, keeps the tombstone", [ok, ids.includes("new"), ids.includes("old"), ids.includes("gone"), ids.length < 4], [true, true, false, true, true]);
		const tiny = memory(5);
		r.check("nothing fits: false, and the session still has the chats", [S.setChats([chat("a", 1)], tiny), S.getChats(tiny).length], [false, 1]);
		const flagS = memory(5);
		flagS.m.set("neo-quiz.archived-chats", legacy0);
		r.check("an import that cannot fit does not record success", [S.importLegacyOnce("dev", flagS), flagS.m.has("neo-quiz.chats-imported")], [0, false]);
	}
	const refused = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
	r.check("a refused storage never throws, and keeps the session", [S.getChats(refused), S.setChats([chat("z", 1)], refused), S.getChats(refused).map(c => c.id)], [[], false, ["z"]]);

	for (const raw of ["not json", "{}", "[1]", JSON.stringify({ v: 1, chats: "x" }), JSON.stringify({ v: 1, chats: [{ id: 1 }] })]) {
		const m = memory();
		m.setItem("neo-quiz.chats", raw);
		r.check("corrupt value gives an empty list: " + raw.slice(0, 18), S.getChats(m), []);
	}

	// One-time import of the legacy text-only archive.
	s = memory();
	const legacy = JSON.stringify([{ id: "old", date: 7, title: "Old", turns: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] }]);
	s.setItem("neo-quiz.archived-chats", legacy);
	r.check("import: one chat imported", S.importLegacyOnce("dev", s), 1);
	const imp = S.getChats(s)[0];
	r.check("imported chat keeps its text, as a text result", [imp.id, imp.origin, imp.requests[0].text, imp.requests[0].results[0].text], ["old", "dev", "q", "a"]);
	r.check("import happens ONCE", [S.importLegacyOnce("dev", s), S.getChats(s).length], [0, 1]);
	{
		// Even with the chat list emptied, the flag alone stops a second import.
		const m = memory();
		m.setItem("neo-quiz.archived-chats", legacy);
		S.importLegacyOnce("dev", m);
		m.m.delete("neo-quiz.chats");
		S.setChats([], m);
		r.check("the flag alone stops a second import", S.importLegacyOnce("dev", m), 0);
	}
	r.check("the legacy key is left untouched (rollback)", s.m.get("neo-quiz.archived-chats"), legacy);
	S.removeChat("old", 99, s);
	r.check("a deleted imported chat does not come back at the next start", [S.importLegacyOnce("dev", s), S.getChats(s).find(c => c.id === "old").deleted], [0, true]);

	s = memory(10);
	s.m.set("neo-quiz.archived-chats", legacy);
	S.importLegacyOnce("dev", s);
	r.check("an import whose write failed is retried next time (flag not set)", s.m.has("neo-quiz.chats-imported"), false);
	{
		// First write refused, second call in the same session with a storage that now accepts.
		let refuse = true;
		const m = memory();
		const flaky = { getItem: k => m.getItem(k), setItem: (k, v) => { if (refuse && k === "neo-quiz.chats") throw new Error("denied"); m.setItem(k, v); } };
		m.setItem("neo-quiz.archived-chats", legacy);
		S.importLegacyOnce("dev", flaky);
		r.check("refused first import: flag not set", m.m.has("neo-quiz.chats-imported"), false);
		refuse = false;
		S.importLegacyOnce("dev", flaky);
		r.check("retry in the same session: flag set only once the chats are on disk", [m.m.has("neo-quiz.chats-imported"), JSON.parse(m.m.get("neo-quiz.chats") ?? '{"chats":[]}').chats.map(c => c.id)], [true, ["old"]]);
	}
	r.check("nothing to import: still no throw, flag set", (() => { const m = memory(); S.importLegacyOnce("dev", m); return m.m.has("neo-quiz.chats-imported"); })(), true);
	r.done();
});

const session = memory();
await withSrcModule("src/dashboard/chat-session.ts", (C) => {
	const r = makeReporter("Active chat");
	const first = C.activeChatId(session);
	r.check("a chat is always on screen, with a valid id", /^[a-z0-9][a-z0-9-]{3,63}$/.test(first), true);
	r.check("the id is stable while the page lives", C.activeChatId(session), first);
	let calls = 0;
	const stop = C.onChatsChanged(() => { calls++; });
	C.setActiveChat("chat-aaaa", session);
	C.setActiveChat("chat-aaaa", session);
	r.check("switching notifies once, and not for the same chat", [C.activeChatId(session), calls], ["chat-aaaa", 1]);
	C.setActiveChat("../etc/x", session);
	r.check("a hostile id is refused", C.activeChatId(session), "chat-aaaa");
	const fresh = C.startNewChat(session);
	r.check("new chat: a fresh id, notified", [fresh !== "chat-aaaa", C.activeChatId(session), calls], [true, fresh, 2]);
	stop();
	C.notifyChatsChanged();
	r.check("an unsubscribed listener hears nothing", calls, 2);
	r.check("the id of this device is a string", typeof C.chatDevice(), "string");
	r.done();
});

// A reload: a NEW module instance on the same session storage keeps the chat on screen.
const before = session.m.get("neo-quiz.active-chat");
await withSrcModule("src/dashboard/chat-session.ts", (C) => {
	const r = makeReporter("Active chat after a reload");
	r.check("the chat on screen survives a reload", C.activeChatId(session), before);
	r.done();
});
const hostile = memory();
hostile.setItem("neo-quiz.active-chat", "../../x");
await withSrcModule("src/dashboard/chat-session.ts", (C) => {
	const r = makeReporter("Active chat, hostile value");
	const id = C.activeChatId(hostile);
	r.check("a hostile stored id is replaced, not trusted", [id !== "../../x", /^[a-z0-9][a-z0-9-]{3,63}$/.test(id)], [true, true]);
	r.done();
});
