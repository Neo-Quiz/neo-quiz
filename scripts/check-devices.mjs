/**
 * THE DEVICE FILES (`src/shared-state/devices.ts`): what a PC publishes about
 * itself (name, kind, Claude models) and how every other device reads it.
 *     npm run check:devices
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/shared-state/devices.ts", "src/dashboard/device-publisher.ts", "src/dashboard/pc-status.ts"], async (D, P, PS) => {
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
	let stale = D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [] }, 1);
	const changed = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "desktop" }), models: () => [], write: async f => { disk.push(f); stale = f; }, readOwn: async () => stale });
	await changed.check(); await changed.check();
	r.check("after a restart with a different content on disk: one write", disk.length, 1);
	// A peer overwrites our own file: restored at the next check, and an identical file costs no write.
	let onDisk = D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [{ id: "opus", label: "Opus 5" }] }, 1);
	const fixes = [];
	const guard = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "laptop" }), models: () => [{ id: "opus", label: "Opus 5" }], write: async f => { fixes.push(f); onDisk = f; }, readOwn: async () => onDisk });
	await guard.check(); await guard.check();
	r.check("own file identical on disk: nothing written, however many checks", fixes.length, 0);
	onDisk = D.buildDevice({ device: PC, name: "Fake", kind: "desktop", models: [{ id: "evil", label: "Evil" }] }, 2);
	await guard.check();
	r.check("a file overwritten on disk by a peer is rewritten at the next check", [fixes.length, fixes[0].name, onDisk.name], [1, "Aero", "Aero"]);
	await guard.check(); await guard.check();
	r.check("and once restored, idle checks write nothing again", fixes.length, 1);
	// TEXT_UNSAFE: every edge of every range still matches, and the characters just outside do not.
	const nameOf = c => D.buildDevice({ device: PC, name: "a" + String.fromCharCode(c) + "b", kind: "laptop", models: [] }, 1).name;
	const unsafe = [0x00, 0x1f, 0x7f, 0x9f, 0xad, 0x200b, 0x200f, 0x2028, 0x202e, 0x2060, 0x206f, 0xfeff, 0xfff0, 0xffff];
	const safe = [0x20, 0x7e, 0xa0, 0xac, 0xae, 0x200a, 0x2010, 0x2027, 0x202f, 0x205f, 0x2070, 0xfefe, 0xff00, 0xffef];
	r.check("TEXT_UNSAFE: each range edge is refused", unsafe.filter(c => nameOf(c) !== ""), []);
	r.check("TEXT_UNSAFE: the neighbours just outside the ranges are kept", safe.filter(c => nameOf(c) === ""), []);
	// The optional provider: validated like the other labels, published, and a non-Claude PC is red on the phone.
	r.check("provider: a good id is kept, garbage or absent is dropped (never an error)", [read(good({ provider: "ollama" })).provider, read(good({ provider: "Evil;rm" })).provider, read(good({ provider: 5 })).provider, "provider" in read(good())], ["ollama", undefined, undefined, false]);
	let prov = "claude-code";
	const provDisk = [];
	const provPub = P.createDevicePublisher({ device: PC, info: async () => ({ name: "Aero", kind: "laptop" }), models: () => [], provider: () => prov, write: async f => { provDisk.push(f); } });
	await provPub.check(); await provPub.check(); prov = "ollama"; await provPub.check();
	r.check("the publisher writes the provider and rewrites when it changes", provDisk.map(f => f.provider), ["claude-code", "ollama"]);
	const g = { device: PC, file: { v: 1, at: 1000, running: [] } };
	const status = provider => PS.pcStatus({ chat: null, files: [g], now: 1500, lastEver: PC, peerConnected: true, peers: [], chats: [], own: [], device: "ph", devices: [D.buildDevice({ device: PC, name: "Aero", kind: "laptop", models: [], provider }, 1)] });
	r.check("a reachable PC whose provider is not Claude Code is red with that reason", [status("ollama").tone, status("ollama").reason], ["error", "notClaude"]);
	r.check("Claude Code, or a file without provider: not red", [status("claude-code").reason, status(undefined).reason], ["ready", "ready"]);
	r.done();
});
