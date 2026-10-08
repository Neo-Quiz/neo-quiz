/**
 * GENERATIONS (`src/shared-state/generations.ts`): what a PC publishes about
 * what it is generating, how a reader judges it stale, and the 5 s throttle.
 * Prevents: a dead PC shown as generating forever (clock skew included),
 * a progress write on every chunk, a hostile file read as an entry.
 *     npm run check:generations
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/shared-state/generations.ts", (G) => {
	const r = makeReporter("Generations");
	const entry = (over = {}) => ({ requestId: "r1", chatId: "c1", from: "ph", text: "Make a quiz", mode: "learn", startedAt: 1, provider: "claude-cli", model: "m", progress: { question: 3 }, ...over });
	const file = (at, running = [entry()]) => ({ v: 1, at, running });

	r.check("a valid file is read back", G.readGenerations(file(10))?.running.length, 1);
	for (const [n, raw] of [["null", null], ["v2", { v: 2, at: 1, running: [] }], ["no at", { v: 1, running: [] }], ["running not a list", { v: 1, at: 1, running: {} }], ["string", "x"]]) {
		r.check("unreadable: " + n, G.readGenerations(raw), null);
	}
	r.check("a bad entry is dropped, the others kept", G.readGenerations(file(1, [entry(), { requestId: 3 }, entry({ requestId: "r2" })]))?.running.map(e => e.requestId), ["r1", "r2"]);
	r.check("text is cut to 200 characters", G.readGenerations(file(1, [entry({ text: "x".repeat(900) })]))?.running[0].text.length, 200);
	r.check("negative or non-numeric progress is dropped", G.readGenerations(file(1, [entry({ progress: { question: -1 } }), entry({ requestId: "r2", progress: { question: "9" } })]))?.running.length, 0);
	r.check("more than 20 entries are cut", G.readGenerations(file(1, Array.from({ length: 40 }, (_, i) => entry({ requestId: "r" + i }))))?.running.length, 20);

	// Staleness (review focus 3)
	r.check("fresh", G.isStale(file(1_000_000), 1_000_000 + 119_000), false);
	r.check("2 minutes old is stale", G.isStale(file(1_000_000), 1_000_000 + 121_000), true);
	r.check("stamped in the future (skew) is stale", G.isStale(file(1_000_000 + 600_000), 1_000_000), true);
	r.check("slightly ahead (a few seconds of skew) is still live", G.isStale(file(1_000_000 + 5_000), 1_000_000), false);

	// Throttle
	const f1 = file(1000);
	r.check("first write", G.shouldWrite(null, f1, 1000, false), true);
	const last = { json: JSON.stringify({ ...f1, at: 0 }), at: 1000 };
	r.check("same content: no write, even long after", G.shouldWrite(last, file(9000), 9000, false), false);
	const changed = file(2000, [entry({ progress: { question: 4 } })]);
	r.check("changed within 5 s: held back", G.shouldWrite(last, changed, 3000, false), false);
	r.check("changed after 5 s: written", G.shouldWrite(last, changed, 6001, false), true);
	r.check("an entry leaving is written at once", G.shouldWrite(last, file(2000, []), 1500, true), true);
	r.check("a keep-alive: nothing changed but 60 s passed while something runs: written", G.shouldWrite(last, file(61_000), 61_000, false), true);

	// Entry from a queue group
	const line = (id, etat, over = {}) => ({ id, etat, debut: 5, demande: { text: "\n  First line\nsecond", notes: [], mode: "learn", count: 20, reglages: { aiProvider: "claude-cli", aiModel: "m" }, chatId: "c1", requestId: "r1", sentAt: 3, ...over } });
	const text = "[ {prompt: 'a', options: []}, {prompt: 'b'}, {prompt: 'c'}";
	const e = G.entryOfGroup({ key: "r1", chatId: "c1", lines: [line(1, "cours")] }, () => text, "ph");
	r.check("entry: question counted from the live text, total from the count", [e.progress, e.text, e.requestId, e.chatId], [{ question: 3, total: 20 }, "First line", "r1", "c1"]);
	r.check("a group with nothing live has no entry", G.entryOfGroup({ key: "r1", chatId: "c1", lines: [line(1, "prete")] }, () => "", "ph"), null);
	r.check("a waiting group is an entry with question 0", G.entryOfGroup({ key: "r1", chatId: "c1", lines: [line(1, "attente")] }, () => "", "ph").progress, { question: 0, total: 20 });
	r.check("a request from the phone keeps its sender", G.entryOfGroup({ key: "r1", chatId: "c1", lines: [line(1, "cours", { fromDevice: "phone-1" })] }, () => "", "pc").from, "phone-1");

	// The tick as the writer runs it: the transcript GROWS between two ticks,
	// so the content really changes and the 5 s rule alone decides.
	const grow = { t: "[ {prompt: 'a'}, {prompt: 'b'}" };
	const group = { key: "r1", chatId: "c1", lines: [line(1, "cours")] };
	const tick1 = G.entryOfGroup(group, () => grow.t, "ph");
	const written = { json: JSON.stringify({ v: 1, at: 0, running: [tick1] }), at: 0 };
	grow.t += ", {prompt: 'c'}";
	const tick2 = { v: 1, at: 5000, running: [G.entryOfGroup(group, () => grow.t, "ph")] };
	r.check("after 5 s with the transcript grown: written", G.shouldWrite(written, tick2, 5000, false), true);
	r.check("before 5 s with the transcript grown: held back", G.shouldWrite(written, { ...tick2, at: 4000 }, 4000, false), false);

	r.check("last PC seen: the freshest non-stale file", G.lastPcSeen([{ device: "a", file: file(1000) }, { device: "b", file: file(50_000) }, { device: "c", file: file(0) }], 60_000), "b");
	r.check("last PC seen: none when all are stale", G.lastPcSeen([{ device: "a", file: file(1000) }], 900_000), null);
	r.done();
});
