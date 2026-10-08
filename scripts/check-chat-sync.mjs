/**
 * CHATS ACROSS DEVICES, pure core (`src/shared-state/chat-merge.ts`):
 * the merge of the per-device chat files, what a device may write, and the
 * path rule. Prevents: a request lost when two files hold the same chat, a
 * deleted chat coming back from an older copy, a device writing another
 * device's chat, a hostile path in a synced file becoming an Open target.
 *     npm run check:chat-sync
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/shared-state/chat-merge.ts", (M) => {
	const r = makeReporter("Chat sync - merge");
	const rq = (id, at, over = {}) => ({ id, at, from: "pc", text: "t" + id, mode: "learn", documents: [], results: [], state: "done", ...over });
	const chat = (id, updatedAt, origin, requests = [], over = {}) => ({ id, origin, createdAt: 1, updatedAt, requests, ...over });
	const ids = (list) => list.map(c => c.id).sort();

	r.check("two files, different chats: both", ids(M.mergeChats([[chat("a", 1, "pc")], [chat("b", 2, "ph")]])), ["a", "b"]);
	r.check("same id: the highest updatedAt gives the metadata",
		M.mergeChats([[chat("a", 5, "ph", [], { title: "new" })], [chat("a", 3, "ph", [], { title: "old" })]])[0].title, "new");
	r.check("order of the files does not matter",
		M.mergeChats([[chat("a", 3, "ph", [], { title: "old" })], [chat("a", 5, "ph", [], { title: "new" })]])[0].title, "new");
	// Review focus 1: union of requests.
	const phone = chat("a", 9, "ph", [rq("r1", 1, { from: "ph" })]);
	const pc = chat("a", 5, "ph", [rq("r2", 2, { from: "ph" })]);
	r.check("union of requests: neither file loses a request, in order of sending",
		M.mergeChats([[phone], [pc]])[0].requests.map(q => q.id), ["r1", "r2"]);
	r.check("the same request in both copies appears once, the copy of the winner is kept",
		M.mergeChats([[chat("a", 9, "ph", [rq("r1", 1, { text: "winner" })])], [chat("a", 5, "ph", [rq("r1", 1, { text: "loser" })])]])[0].requests.map(q => q.text), ["winner"]);
	// Tombstones.
	r.check("a newer tombstone hides the chat and empties it",
		M.mergeChats([[chat("a", 1, "pc", [rq("r", 1)])], [chat("a", 9, "pc", [], { deleted: true })]]).map(c => [c.deleted === true, c.requests.length]), [[true, 0]]);
	r.check("an older tombstone loses to a newer chat (continued after the delete)",
		M.mergeChats([[chat("a", 2, "pc", [], { deleted: true })], [chat("a", 8, "pc", [rq("r", 1)])]]).map(c => [c.deleted === true, c.requests.length]), [[false, 1]]);
	r.check("a tie on updatedAt: the tombstone wins, whatever the order",
		[M.mergeChats([[chat("a", 5, "pc", [rq("r", 1)])], [chat("a", 5, "pc", [], { deleted: true })]])[0].deleted, M.mergeChats([[chat("a", 5, "pc", [], { deleted: true })], [chat("a", 5, "pc", [rq("r", 1)])]])[0].deleted], [true, true]);

	// What a device may write.
	const mine = chat("m", 5, "ph"), foreign = chat("f", 5, "pc", [rq("r", 1)]);
	r.check("own file: own chats only, a live foreign chat is never copied",
		ids(M.ownToWrite([mine, foreign], "ph", [[foreign]])), ["m"]);
	const tomb = chat("f", 9, "pc", [], { deleted: true });
	r.check("deleting a foreign chat writes a tombstone for it in OUR file",
		M.ownToWrite([mine, tomb], "ph", [[foreign]]).map(c => [c.id, c.deleted === true]), [["m", false], ["f", true]]);
	r.check("a tombstone already held by another file, as recent, is not copied again",
		ids(M.ownToWrite([mine, tomb], "ph", [[tomb]])), ["m"]);
	r.check("a LATER tombstone is written even if an older one exists elsewhere",
		ids(M.ownToWrite([mine, { ...tomb, updatedAt: 20 }], "ph", [[tomb]])), ["f", "m"]);

	// Binding decision: a request of ANOTHER device's chat, held by no other
	// file, is written in our file as a copy (same origin, only those requests).
	const pcChat = chat("p", 5, "pc", [rq("r-pc", 1, { from: "pc" })]);
	const phoneInPcChat = rq("r-ph", 2, { from: "ph" });
	const copied = M.ownToWrite([chat("p", 6, "pc", [rq("r-pc", 1, { from: "pc" }), phoneInPcChat])], "ph", [[pcChat]]);
	r.check("a phone request inside a PC chat survives the phone's next save: one copy, only the phone's request",
		copied.map(c => [c.id, c.origin, c.requests.map(q => q.id)]), [["p", "pc", ["r-ph"]]]);
	r.check("the copy keeps the origin of the chat (never changed)",
		copied.every(c => c.origin === "pc"), true);
	r.check("a request the PC file already holds is not duplicated into the phone's copy",
		M.ownToWrite([chat("p", 5, "pc", [rq("r-pc", 1, { from: "pc" })])], "ph", [[pcChat]]), []);
	r.check("the copy merges back with the PC file without duplicates",
		M.mergeChats([copied, [pcChat]])[0].requests.map(q => q.id), ["r-pc", "r-ph"]);

	// Paths.
	r.check("relative path inside the root", M.relativeToRoot("Root/Maths/q.md", "Root"), "Maths/q.md");
	r.check("a path in another root is outside", M.relativeToRoot("Other/q.md", "Root"), "");
	r.check("a root id that is only a prefix of another is outside", M.relativeToRoot("Root2/q.md", "Root"), "");
	r.check("the internal folder is never an Open target", M.relativeToRoot("Root/.neo-quiz/chats/x.json", "Root"), "");
	for (const bad of ["../x.md", "a/../x.md", "/abs.md", "C:/x.md", "c:\\x.md", "a\\b.md", "", "a//b.md", "a/./b.md"]) {
		r.check("hostile stored path refused: " + JSON.stringify(bad), M.absoluteInRoot(bad, "Root"), "");
	}
	r.check("a clean stored path comes back absolute", M.absoluteInRoot("Maths/q.md", "Root"), "Root/Maths/q.md");
	r.check("single-root host (empty id): paths are left as they are", [M.relativeToRoot("Maths/q.md", ""), M.absoluteInRoot("Maths/q.md", "")], ["Maths/q.md", "Maths/q.md"]);
	const withPaths = chat("p", 1, "pc", [rq("r", 1, { documents: [{ name: "cm.md", path: "Root/cm.md" }, { name: "x", path: "Elsewhere/x.md" }], results: [{ kind: "quiz", title: "T", path: "Root/A/q.md" }, { kind: "quiz", title: "U", path: "Elsewhere/u.md" }, { kind: "text", text: "hi" }] })]);
	const file = M.chatsToFile([withPaths], "Root")[0].requests[0];
	r.check("to file: paths relative, outside paths blanked, titles and names kept",
		[file.documents, file.results], [[{ name: "cm.md", path: "cm.md" }, { name: "x" }], [{ kind: "quiz", title: "T", path: "A/q.md" }, { kind: "quiz", title: "U", path: "" }, { kind: "text", text: "hi" }]]);
	r.check("from file under another root id: relative paths re-anchored", M.chatsFromFile(M.chatsToFile([withPaths], "Root"), "/storage/Neo Quiz")[0].requests[0].results[0].path, "/storage/Neo Quiz/A/q.md");
	r.check("round trip of a chat with no path is the identity", M.chatsFromFile(M.chatsToFile([chat("z", 1, "pc", [rq("r", 1)])], "Root"), "Root"), [chat("z", 1, "pc", [rq("r", 1)])]);
	r.done();
});
