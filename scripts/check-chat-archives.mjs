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
