/**
 * THE DEVICE FILES (`src/shared-state/devices.ts`): what a PC publishes about
 * itself (name, kind, Claude models) and how every other device reads it.
 *     npm run check:devices
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/shared-state/devices.ts", "src/dashboard/device-publisher.ts"], async (D, P) => {
	const r = makeReporter("Device files");
	const PC = "11111111-1111-4111-8111-111111111111";
	const good = (over = {}) => ({ v: 1, device: PC, name: "Aero", kind: "laptop", claudeModels: [{ id: "opus", label: "Opus 5" }], updatedAt: 5, ...over });
	const read = (raw, id = PC) => D.readDevice(raw, id);
	r.check("a good file is read", read(good()), good());
	r.check("unknown version, non-object and arrays are ignored", [read(good({ v: 2 })), read(null), read([]), read("x")], [null, null, null, null]);
	r.check("the file must name the device its file name designates (case-insensitive)", [read(good({ device: "22222222-2222-4222-8222-222222222222" })), read(good({ device: PC.toUpperCase() })) !== null], [null, true]);
	r.check("a kind that is not laptop/desktop drops the file", [read(good({ kind: "tablet" })), read(good({ kind: undefined }))], [null, null]);
	r.check("a non-finite updatedAt drops the file", [read(good({ updatedAt: "x" })), read(good({ updatedAt: Infinity }))], [null, null]);
	r.check("a garbage name becomes empty, never an error", [read(good({ name: 5 })).name, read(good({ name: "a" + String.fromCharCode(0) + "b" })).name, read(good({ name: "x".repeat(65) })).name], ["", "", ""]);
	r.check("garbage model entries are dropped alone, valid ones stay", read(good({ claudeModels: [{ id: "--bad", label: "x" }, { id: "opus", label: "O" }, 5, null, { id: "a b" }, { id: "opus", label: "dup" }, { id: "sonnet" }] })).claudeModels, [{ id: "opus", label: "O" }, { id: "sonnet", label: "sonnet" }]);
	r.check("models not an array: none", read(good({ claudeModels: "opus" })).claudeModels, []);
	r.check("at most 20 models", read(good({ claudeModels: Array.from({ length: 50 }, (_, i) => ({ id: "m" + i, label: "M" })) })).claudeModels.length, 20);
	r.check("only <uuid>.json designates a device (conflict copies, temp and foreign names do not)", ["a.json", PC + ".json.tmp", PC + ".sync-conflict-20260101-000000-ABCDEFG.json", PC + ".json"].map(D.deviceOfFileName), [null, null, null, PC]);
	r.check("the file size cap is small", D.MAX_DEVICE_CHARS <= 50_000, true);

	const built = D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [{ id: "opus", label: "Opus 5" }, { id: "-x", label: "bad" }] }, 9);
	r.check("a built file keeps only models the request charset allows, and re-reads as itself", [built.claudeModels, read(built)], [[{ id: "opus", label: "Opus 5" }], built]);
	r.check("write only at start or on a content change; updatedAt alone is not a change", [D.shouldWriteDevice(null, built), D.shouldWriteDevice(D.contentKey(built), { ...built, updatedAt: 99 }), D.shouldWriteDevice(D.contentKey(built), { ...built, kind: "desktop" }), D.shouldWriteDevice(D.contentKey(built), { ...built, claudeModels: [] })], [true, false, true, true]);
	r.check("icon: monitor for a desktop, laptop for a laptop and when unknown", [D.pcIcon({ kind: "desktop" }), D.pcIcon({ kind: "laptop" }), D.pcIcon(null)], ["monitor", "laptop", "laptop"]);

	// The publisher: one write at start, none while idle, one per real change, a failed write is retried.
	let models = [{ id: "opus", label: "Opus 5" }], clock = 1, fail = false;
	const writes = [];
	const pub = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "laptop" }), models: () => models, write: async f => { if (fail) throw new Error("disk"); writes.push(f); }, now: () => clock++ });
	await pub.check();
	for (let i = 0; i < 30; i++) await pub.check();
	r.check("30 idle checks after the first write: nothing more is written", writes.length, 1);
	models = [...models, { id: "sonnet", label: "Sonnet 5" }];
	await pub.check(); await pub.check();
	r.check("a changed model list writes once", [writes.length, writes[1].claudeModels.length], [2, 2]);
	models = []; fail = true;
	await pub.check();
	r.check("a failed write is not counted as written", writes.length, 2);
	fail = false; await pub.check();
	r.check("and is retried at the next check", writes.length, 3);
	const none = P.createDevicePublisher({ device: PC, info: async () => null, models: () => [], write: async f => { writes.push(f); } });
	await none.check();
	r.check("no name/kind available: nothing is written", writes.length, 3);
	// A restart or page reload: the file left on disk with the same content is not written again; a different one is.
	const disk = [];
	const again = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "laptop" }), models: () => [{ id: "opus", label: "Opus 5" }], write: async f => { disk.push(f); }, readOwn: async () => D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [{ id: "opus", label: "Opus 5" }] }, 1) });
	await again.check(); await again.check();
	r.check("after a restart with the same content on disk: nothing is written", disk.length, 0);
	const changed = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "desktop" }), models: () => [], write: async f => { disk.push(f); }, readOwn: async () => D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [] }, 1) });
	await changed.check(); await changed.check();
	r.check("after a restart with a different content on disk: one write", disk.length, 1);
	r.done();
});
