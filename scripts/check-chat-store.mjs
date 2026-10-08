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

await withSrcModule("src/dashboard/chat-store.ts", async (S) => {
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

	// 9. Synced backend (phase 2)
	{
		const rq = (id, over = {}) => ({ id, at: 1, from: "me", text: "t", mode: "learn", documents: [], results: [], state: "done", ...over });
		const chat = (id, updatedAt, origin, requests = [rq("r")], over = {}) => ({ id, origin, createdAt: 1, updatedAt, requests, ...over });
		const backend = (own, others) => {
			const saved = [];
			return { saved, device: "me", own: () => own, others: () => others, saveOwn: async (c) => { saved.push(structuredClone(c)); } };
		};
		const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, m }; };

		// 9a. merged view
		S.detachChatBackend();
		let st = mem(); let b = backend([chat("mine", 5, "me")], [[chat("theirs", 6, "pc")]]);
		await S.attachChatBackend(b, st);
		r.check("the store lists own and other devices' chats", S.getChats(st).map(c => c.id).sort(), ["mine", "theirs"]);

		// 9b. an edit of a foreign chat is never written, a delete of it is a tombstone in OUR file
		S.setChats([...S.getChats(st).map(c => c.id === "theirs" ? { ...c, title: "edited" } : c)], st);
		await S.flushChats();
		r.check("a live foreign chat is not copied into our file", b.saved.at(-1).map(c => c.id), ["mine"]);
		S.removeChat("theirs", 9, st); await S.flushChats();
		r.check("deleting a foreign chat writes its tombstone in our file", b.saved.at(-1).map(c => [c.id, c.deleted === true]), [["mine", false], ["theirs", true]]);
		r.check("a backend never touches window storage", st.m.has("neo-quiz.chats"), false);

		// 9c. migration of window storage, once
		S.detachChatBackend();
		st = mem(); st.setItem("neo-quiz.chats", JSON.stringify({ v: 1, chats: [chat("old", 3, "me"), chat("alien", 3, "someone-else")] }));
		b = backend([], []);
		await S.attachChatBackend(b, st);
		r.check("window-storage chats are moved to our file once (own origin only)", b.saved.at(-1).map(c => c.id), ["old"]);
		r.check("the flag is set after the write and the old key is kept", [st.getItem("neo-quiz.chats-synced"), st.getItem("neo-quiz.chats") !== null], ["1", true]);
		S.detachChatBackend();
		const b2 = backend(b.saved.at(-1), []);
		const before = b2.saved.length;
		await S.attachChatBackend(b2, st);
		r.check("a second attach does not import again", b2.saved.length, before);

		// 9d. a failed first write leaves the flag unset (retry at next start), the view stays
		S.detachChatBackend();
		st = mem(); st.setItem("neo-quiz.chats", JSON.stringify({ v: 1, chats: [chat("old", 3, "me")] }));
		const failing = { ...backend([chat("kept", 2, "me")], []), saveOwn: async () => { throw new Error("disk"); } };
		await S.attachChatBackend(failing, st).catch(() => {});
		r.check("a failed migration write does not set the flag", st.getItem("neo-quiz.chats-synced"), null);
		r.check("a failed migration still shows the readable chats", S.getChats(st).map(c => c.id), ["kept"]);

		// 9e. reload picks up another device's change
		S.detachChatBackend();
		st = mem(); const others = [[chat("p", 1, "pc")]]; b = backend([], others);
		await S.attachChatBackend(b, st);
		others[0].push(chat("q", 2, "pc"));
		r.check("reload reports a change and lists the new chat", [S.reloadFromBackend(), S.getChats(st).map(c => c.id).sort()], [true, ["p", "q"]]);
		r.check("a reload with nothing new reports no change", S.reloadFromBackend(), false);

		// 9f. a reload never reverts an edit that is pending or failed to save
		S.detachChatBackend();
		st = mem(); const o2 = [[chat("p", 1, "pc")]]; b = backend([chat("mine", 1, "me")], o2);
		await S.attachChatBackend(b, st);
		S.setChats(S.getChats(st).map(c => c.id === "mine" ? { ...c, title: "new", updatedAt: 5 } : c), st);
		o2[0].push(chat("q", 2, "pc"));
		r.check("reload is skipped while a save is pending", [S.reloadFromBackend(), S.getChats(st).find(c => c.id === "mine").title], [false, "new"]);
		await S.flushChats();
		r.check("reload resumes once the save succeeded", S.reloadFromBackend(), true);
		S.detachChatBackend();
		let fail = true;
		const flakyBackend = { ...backend([chat("mine", 1, "me")], o2), saveOwn: async () => { if (fail) throw new Error("disk"); } };
		await S.attachChatBackend(flakyBackend, st);
		S.setChats(S.getChats(st).map(c => c.id === "mine" ? { ...c, title: "edit", updatedAt: 6 } : c), st);
		await S.flushChats();
		o2[0].push(chat("z", 3, "pc"));
		r.check("reload is skipped after a failed save, the edit stays", [S.reloadFromBackend(), S.getChats(st).find(c => c.id === "mine").title], [false, "edit"]);
		fail = false;
		S.setChats(S.getChats(st), st); await S.flushChats();
		r.check("the next change retries and reload resumes", S.reloadFromBackend(), true);
		S.detachChatBackend();
	}
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
