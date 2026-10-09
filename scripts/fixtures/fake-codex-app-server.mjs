// A FAKE `codex app-server` for check:electron-process. It speaks the same
// line-delimited JSON-RPC, answers from canned data, and logs what it
// receives. It never touches a real account, a real credit, or auth.json.
// Behaviour is chosen by environment variables:
//   FAKE_LOG      file that receives one JSON line per event
//   FAKE_MODE     normal | hang | serverreq | slow
//   FAKE_OUTCOME  the `outcome` that consume answers
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (o) => { try { appendFileSync(process.env.FAKE_LOG, JSON.stringify({ ...o, t: Date.now() }) + "\n"); } catch { /* no log */ } };
const mode = process.env.FAKE_MODE || "normal";
log({ ev: "start", pid: process.pid, argv: process.argv.slice(2) });

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const READ = {
	rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1900000000 } },
	rateLimitResetCredits: {
		availableCount: 2,
		credits: [
			{ id: "credit-1", resetType: "codexRateLimits", status: "available", grantedAt: 1790000000, expiresAt: 1795000000, title: "Full reset (Weekly + 5 hr)", description: "<img src=x onerror=alert(1)> Thanks for using Codex!" },
			{ id: "credit-2", resetType: "codexRateLimits", status: "available", expiresAt: "2026-12-01T00:00:00Z", title: "Second", description: null },
			{ id: "credit-3", resetType: "codexRateLimits", status: "redeemed", title: "Used" },
		],
	},
};

createInterface({ input: process.stdin }).on("line", (line) => {
	let m;
	try { m = JSON.parse(line); } catch { return; }
	log({ ev: "recv", method: m.method, id: m.id, params: m.params, keys: Object.keys(m) });
	if (m.method === undefined && m.id !== undefined) { log({ ev: "response-to-server", msg: m }); return; }
	if (m.method === "initialize") return send({ id: m.id, result: { userAgent: "fake" } });
	if (m.method === "initialized") return;
	if (mode === "hang") return;
	const answer = (result) => { log({ ev: "answer", method: m.method }); send({ id: m.id, result }); };
	const reply = (result) => (mode === "slow" ? setTimeout(() => answer(result), 300) : answer(result));
	if (mode === "serverreq") send({ id: 900, method: "item/commandExecution/requestApproval", params: { command: "calc" } });
	if (m.method === "account/rateLimits/read") return reply(READ);
	if (m.method === "account/rateLimitResetCredit/consume") return reply({ outcome: process.env.FAKE_OUTCOME || "reset" });
	send({ id: m.id, error: { code: -32601, message: "Method not found" } });
});
setInterval(() => {}, 60000);
