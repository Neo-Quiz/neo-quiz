/**
 * THE ARCHIVED CHATS of the Generate page (`src/dashboard/chat-archives.ts`),
 * on the real code and a fake storage.
 *
 * What it prevents: a chat with no answer archived (an empty "New" clicked
 * twice would fill the list); the list growing without bound; a corrupted or
 * hostile stored value breaking the page instead of giving an empty list; a
 * refused storage (private window) throwing at the click of "New".
 *
 *     npm run check:chat-archives
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/chat-archives.ts", ({ archiveChat, readArchivedChats, deleteArchivedChat, MAX_ARCHIVED_CHATS }) => {
	const r = makeReporter("Archived chats");
	const memoire = () => {
		const m = new Map();
		return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); } };
	};
	const chat = (q, a) => [{ role: "user", text: q }, { role: "assistant", text: a }];

	let s = memoire();
	r.check("a chat with an answer is kept", [archiveChat(chat("q", "a"), 1, s), readArchivedChats(s).length], [true, 1]);
	r.check("a chat with no answer is not kept", [archiveChat([{ role: "user", text: "q" }], 2, s), readArchivedChats(s).length], [false, 1]);
	r.check("an empty answer is not an answer", [archiveChat(chat("q", "  "), 3, s), readArchivedChats(s).length], [false, 1]);

	archiveChat(chat("q2", "a2"), 5, s);
	r.check("newest first", readArchivedChats(s).map(c => c.turns[0].text), ["q2", "q"]);
	const id = readArchivedChats(s)[0].id;
	deleteArchivedChat(id, s);
	r.check("a chat can be deleted", readArchivedChats(s).map(c => c.turns[0].text), ["q"]);

	s = memoire();
	for (let i = 0; i < MAX_ARCHIVED_CHATS + 5; i++) archiveChat(chat("q" + i, "a"), i + 1, s);
	r.check("the oldest leave first", [readArchivedChats(s).length, readArchivedChats(s)[0].turns[0].text], [MAX_ARCHIVED_CHATS, "q" + (MAX_ARCHIVED_CHATS + 4)]);

	for (const brut of ["not json", "{}", "[1,2]", JSON.stringify([{ id: 1, date: "x", turns: [] }]), JSON.stringify([{ id: "a", date: 1, turns: [{ role: "system", text: "x" }] }])]) {
		const m = memoire();
		m.setItem("neo-quiz.archived-chats", brut);
		r.check("unreadable value gives an empty list: " + brut.slice(0, 20), readArchivedChats(m), []);
	}

	const refuse = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
	r.check("a refused storage never throws", [readArchivedChats(refuse), archiveChat(chat("q", "a"), 1, refuse)], [[], true]);
	r.done();
});
