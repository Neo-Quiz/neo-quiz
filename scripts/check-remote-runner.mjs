/**
 * THE REMOTE FLOW, both ends. Part 1: the phone's sender core
 * (`src/dashboard/remote-send.ts`). Part 2 (Task 12): the PC runner
 * (`src/dashboard/remote-runner.ts`).
 *     npm run check:remote-runner
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/remote-send.ts", "src/shared-state/remote-request.ts"], (S, R) => {
	const r = makeReporter("Remote send");
	const PC = "11111111-1111-4111-8111-111111111111", PH = "22222222-2222-4222-8222-222222222222", NOW = 1_800_000_000_000;
	const input = (over = {}) => ({ chatId: "chat-1234", text: "Quiz on lists", mode: "learn", documents: [{ path: "Python/cm1.md" }], ...over });
	const ctx = { device: PH, target: PC, now: NOW, newId: () => "lq3k2-abc123" };
	const built = S.buildRequest(input(), { ...ctx, deviceName: "Pixel" });
	r.check("a built request passes the PC's own validator (same schema, no drift)", R.validateRemote(built, { device: PC, fileDevice: PH, fileId: "lq3k2-abc123", now: NOW + 1000 }).ok, true);
	r.check("count null / no types are left out, not written as null", Object.keys(S.buildRequest(input({ count: null }), ctx)).sort(), ["at", "chatId", "documents", "from", "id", "mode", "target", "text", "v"]);
	const refuses = (i, c = ctx) => { try { S.buildRequest(i, c); return "built"; } catch { return "refused"; } };
	r.check("text beyond 20 000 characters is refused when building", refuses(input({ text: "x".repeat(20_001) })), "refused");
	r.check("more than 10 documents are refused when building", refuses(input({ documents: Array.from({ length: 11 }, (_, i) => ({ path: `d${i}.md` })) })), "refused");
	r.check("a document outside the synced folder is refused when building", refuses(input({ documents: [{ path: "../x.md" }] })), "refused");
	r.check("a chat id that is not a slug is refused when building", refuses(input({ chatId: "Chat 1" })), "refused");
	r.check("a generated request id matches the slug", R.SLUG.test(S.buildRequest(input(), { ...ctx, newId: undefined }).id), true);

	const gens = (device, at) => ({ device, file: { v: 1, at, running: [] } });
	r.check("target: the origin of an existing chat when it is alive", S.pickTarget({ origin: "pcA" }, [gens("pcA", NOW - 1000), gens("pcB", NOW - 500)], NOW), "pcA");
	r.check("target: the freshest PC when the origin is silent", S.pickTarget({ origin: "pcA" }, [gens("pcA", NOW - 900_000), gens("pcB", NOW - 500)], NOW), "pcB");
	r.check("target: the freshest PC for a chat started on the phone", S.pickTarget(null, [gens("pcA", NOW - 5000), gens("pcB", NOW - 500)], NOW), "pcB");
	r.check("target: none when every PC is stale (the composer offers the relay)", S.pickTarget(null, [gens("pcA", NOW - 900_000)], NOW), null);
	const chat = (reqs) => ({ id: "c", origin: "pc", createdAt: 1, updatedAt: 1, requests: reqs.map(id => ({ id })) });
	r.check("settled: our request found in a chat file can be deleted, the others stay", S.settled([{ id: "a" }, { id: "b" }], [chat(["a", "z"])]), ["a"]);
	r.done();
});
