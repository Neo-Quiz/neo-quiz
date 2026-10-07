/**
 * THE PYTHON PACKAGE PROXY of the main process
 * (apps/windows/electron/paquets-python.ts, task 4 of
 * docs/superpowers/plans/2026-10-04-python-pack.md).
 *
 * WHAT THESE CASES PREVENT, which no typecheck sees:
 * - a file the pack's lock does not name reaching the network at all
 *   (the transport must never even be asked);
 * - bytes that do not match the lock's SHA-256 being served or cached
 *   (nothing may remain in `paquets/`, not even a `.part`);
 * - a body above 50 MB, a redirect to `http:` or to a host off the list,
 *   being accepted;
 * - a PyPI wheel being served whose bytes differ from the digest the
 *   index announced, or one that is not pure (`manylinux`);
 * - the download budget (500 MB) not stopping anything.
 *
 * NEVER THE NETWORK: an injected transport serves everything.
 *
 *     npm run check:code-packages
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Python package proxy");
const ok = (nom, condition) => r.check(nom, !!condition, true);
const tmp = mkdtempSync(join(tmpdir(), "neo-paquets-"));
const BASE = "https://cdn.jsdelivr.net/pyodide/v0.0.0/full/";
const sha = (b) => createHash("sha256").update(b).digest("hex");

function reponse(status, corps, entetes = {}) {
	return {
		status,
		entete: (nom) => entetes[nom.toLowerCase()] ?? null,
		texte: async () => Buffer.from(corps ?? []).toString("utf8"),
		octets: corps ? async function* () { const m = corps.length >> 1; yield corps.subarray(0, m); yield corps.subarray(m); } : undefined,
	};
}
/** A transport over a table url -> response factory; records every URL. */
function transport(table) {
	const demandees = [];
	const t = async (url, init) => {
		demandees.push(url);
		const f = table[url];
		return f ? f(init) : reponse(404, Buffer.alloc(0));
	};
	t.demandees = demandees;
	return t;
}
const statut = (p) => p.then((x) => x.status, () => "threw");
const dossierDe = (nom) => { const d = join(tmp, nom); mkdirSync(d, { recursive: true }); return d; };
function packAvecLock(nom, fichiers) {
	const d = dossierDe(nom);
	const packages = {};
	for (const [f, octets] of Object.entries(fichiers)) packages[f] = { file_name: f, sha256: sha(octets) };
	writeFileSync(join(d, "pyodide-lock.json"), JSON.stringify({ packages }));
	writeFileSync(join(d, "manifest.json"), "{}");
	return d;
}
const reste = (d) => (existsSync(join(d, "paquets")) ? readdirSync(join(d, "paquets")) : []);

try {
	await withSrcModule("apps/windows/electron/paquets-python.ts", async ({ hotePaquetAutorise, entreeDuLock, urlCdn, urlPypi, roueAdmise, Budget, servirPaquet, servirPypi }) => {
		const bon = Buffer.from("good wheel bytes ".repeat(50));
		const autre = Buffer.from("other wheel bytes ".repeat(50));

		// -- pure rules --
		const lockA = { packages: { numpy: { file_name: "numpy-1.whl", sha256: "a".repeat(64) } } };
		ok("entreeDuLock: matches by file_name", entreeDuLock(lockA, "numpy-1.whl")?.sha256 === "a".repeat(64));
		ok("entreeDuLock: unknown file is null", entreeDuLock(lockA, "x.whl") === null);
		ok("entreeDuLock: garbage lock is null", entreeDuLock(null, "x") === null && entreeDuLock({ packages: 3 }, "x") === null);
		ok("urlCdn joins base and file", urlCdn(BASE, "a.whl") === BASE + "a.whl");
		ok("urlPypi: index", urlPypi("simple/requests/") === "https://pypi.org/simple/requests/");
		ok("urlPypi: file", urlPypi("files/packages/ab/cd/x-1-py3-none-any.whl") === "https://files.pythonhosted.org/packages/ab/cd/x-1-py3-none-any.whl");
		ok("urlPypi: traversal and odd shapes refused", ["files/../x", "files/a/../x", "simple/../", "simple/x", "other/x", "files/a::$DATA", "simple/a%2fb/", "files/"].every((c) => urlPypi(c) === null));
		ok("roueAdmise: pure and pyodide wheels", roueAdmise("x-1-py3-none-any.whl") && roueAdmise("x-1-cp312-cp312-pyodide_2024_0_wasm32.whl") && roueAdmise("x-1-cp312-cp312-emscripten_3_1_58_wasm32.whl") && roueAdmise("numpy-2-cp314-cp314-pyemscripten_2026_0_wasm32.whl"));
		ok("roueAdmise: native and sdist refused", !roueAdmise("x-1-cp312-cp312-manylinux_2_17_x86_64.whl") && !roueAdmise("x-1.tar.gz") && !roueAdmise("pyodide-http-1-cp312-cp312-manylinux_2_17_x86_64.whl"));
		const b = new Budget(10);
		ok("Budget: spends then refuses", b.prendre(6) && !b.prendre(5) && b.prendre(4));

		// -- Pyodide packages --
		{
			const d = packAvecLock("ok", { "numpy-1.whl": bon });
			const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(200, bon) });
			ok("not in the lock: 404, nothing requested", (await statut(servirPaquet(d, "evil-1.whl", t, undefined, BASE))) === 404 && t.demandees.length === 0);
			ok("a name that is a path: 404, nothing requested", (await statut(servirPaquet(d, "../x.whl", t, undefined, BASE))) === 404 && t.demandees.length === 0);
			const rep = await servirPaquet(d, "numpy-1.whl", t, undefined, BASE);
			ok("listed + right bytes: 200 with the bytes", rep.status === 200 && Buffer.from(await rep.arrayBuffer()).equals(bon));
			ok("cached on disk, no `.part`", reste(d).join() === "numpy-1.whl");
			const avant = t.demandees.length;
			const rep2 = await servirPaquet(d, "numpy-1.whl", t, undefined, BASE);
			ok("second call: 200 and no request", rep2.status === 200 && t.demandees.length === avant);
		}
		{
			const d = packAvecLock("faux", { "numpy-1.whl": bon });
			const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(200, autre) });
			const s = await statut(servirPaquet(d, "numpy-1.whl", t, undefined, BASE));
			ok("listed + wrong bytes: refused", s !== 200 && s !== "threw");
			ok("wrong bytes: nothing in `paquets/`", reste(d).length === 0);
		}
		{
			const d = packAvecLock("cache-abime", { "numpy-1.whl": bon });
			mkdirSync(join(d, "paquets"));
			writeFileSync(join(d, "paquets", "numpy-1.whl"), autre);
			const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(200, bon) });
			const rep = await servirPaquet(d, "numpy-1.whl", t, undefined, BASE);
			ok("tampered cache is re-downloaded, never served", rep.status === 200 && Buffer.from(await rep.arrayBuffer()).equals(bon) && t.demandees.length === 1);
		}
		{
			const gros = Buffer.alloc(50 * 1024 * 1024 + 1, 1);
			const d = packAvecLock("gros", { "big-1.whl": gros });
			const t = transport({ [BASE + "big-1.whl"]: () => reponse(200, gros) });
			const s = await statut(servirPaquet(d, "big-1.whl", t, new Budget(10 * 1024 * 1024 * 1024), BASE));
			ok("body over 50 MB: refused, nothing on disk", s !== 200 && reste(d).length === 0);
		}
		{
			const d = packAvecLock("redir", { "numpy-1.whl": bon });
			for (const [nom, lieu] of [["http:", "http://cdn.jsdelivr.net/x"], ["unlisted host", "https://evil.example/x"]]) {
				const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(302, null, { location: lieu }) });
				const s = await statut(servirPaquet(d, "numpy-1.whl", t, undefined, BASE));
				ok(`redirect to ${nom}: never followed`, s !== 200 && t.demandees.length === 1 && reste(d).length === 0);
			}
		}
		{
			/* Redirects are judged against the 3 package hosts, NOT the app-wide list. */
			const d = packAvecLock("redir-app", { "numpy-1.whl": bon });
			for (const lieu of ["https://localhost/x", "https://github.com/x", "https://127.0.0.1/x", "https://api.anthropic.com/x"]) {
				const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(302, null, { location: lieu }) });
				const s = await statut(servirPaquet(d, "numpy-1.whl", t, undefined, BASE));
				ok(`redirect to ${lieu}: never followed`, s !== 200 && t.demandees.length === 1 && !t.demandees.includes(lieu) && reste(d).length === 0);
			}
			ok("hotePaquetAutorise: exactly the 3 hosts over https", hotePaquetAutorise("https://pypi.org/x") && hotePaquetAutorise("https://files.pythonhosted.org/x") && hotePaquetAutorise("https://cdn.jsdelivr.net/x") && !hotePaquetAutorise("https://github.com/x") && !hotePaquetAutorise("http://pypi.org/x"));
		}
		{
			/* The pack deleted while the download runs: paquets/ is never recreated. */
			const d = packAvecLock("supprime", { "numpy-1.whl": bon });
			const t = transport({ [BASE + "numpy-1.whl"]: () => { rmSync(join(d, "manifest.json")); return reponse(200, bon); } });
			const s = await statut(servirPaquet(d, "numpy-1.whl", t, undefined, BASE));
			ok("pack deleted mid-download: refused, paquets/ not recreated", s !== 200 && !existsSync(join(d, "paquets")));
		}
		{
			const d = packAvecLock("budget", { "numpy-1.whl": bon });
			const t = transport({ [BASE + "numpy-1.whl"]: () => reponse(200, bon) });
			ok("budget exhausted: 503, nothing on disk", (await statut(servirPaquet(d, "numpy-1.whl", t, new Budget(5), BASE))) === 503 && reste(d).length === 0);
		}
		{
			const d = packAvecLock("reseau", { "numpy-1.whl": bon });
			const t = async () => { throw new Error("offline"); };
			ok("network failure: 503", (await statut(servirPaquet(d, "numpy-1.whl", t, undefined, BASE))) === 503);
		}

		// -- PyPI --
		{
			const FILES = "https://files.pythonhosted.org/packages/ab/cd/";
			const roue = Buffer.from("pure wheel ".repeat(40));
			const index = JSON.stringify({ meta: { "api-version": "1.1" }, name: "demo", files: [
				{ filename: "demo-1-py3-none-any.whl", url: FILES + "demo-1-py3-none-any.whl", hashes: { sha256: sha(roue) }, "core-metadata": { sha256: "0".repeat(64) } },
				{ filename: "demo-1-cp312-cp312-manylinux_2_17_x86_64.whl", url: FILES + "demo-1-cp312-cp312-manylinux_2_17_x86_64.whl", hashes: { sha256: sha(roue) } },
				{ filename: "demo-1.tar.gz", url: FILES + "demo-1.tar.gz", hashes: { sha256: sha(roue) } },
				{ filename: "evil-1-py3-none-any.whl", url: "https://evil.example/evil-1-py3-none-any.whl", hashes: { sha256: sha(roue) } },
			] });
			const t = transport({
				"https://pypi.org/simple/demo/": (init) => (init.headers?.Accept === "application/vnd.pypi.simple.v1+json" ? reponse(200, Buffer.from(index)) : reponse(406, null)),
				[FILES + "demo-1-py3-none-any.whl"]: () => reponse(200, roue),
				[FILES + "demo-1-cp312-cp312-manylinux_2_17_x86_64.whl"]: () => reponse(200, roue),
			});
			const digests = new Map();
			const idx = await servirPypi("simple/demo/", t, digests);
			const j = await idx.json();
			ok("index: only the pure wheel stays, rewritten to the proxy, core-metadata dropped",
				idx.status === 200 && j.files.length === 1 && j.files[0].url === "file:///pypi/files/packages/ab/cd/demo-1-py3-none-any.whl" && !("core-metadata" in j.files[0]));
			const w = await servirPypi("files/packages/ab/cd/demo-1-py3-none-any.whl", t, digests);
			ok("wheel matching the announced digest: 200", w.status === 200 && Buffer.from(await w.arrayBuffer()).equals(roue));
			const t2 = transport({ [FILES + "demo-1-py3-none-any.whl"]: () => reponse(200, autre) });
			ok("wheel with a mismatching digest: 403", (await statut(servirPypi("files/packages/ab/cd/demo-1-py3-none-any.whl", t2, digests))) === 403);
			const t3 = transport({ [FILES + "demo-1-cp312-cp312-manylinux_2_17_x86_64.whl"]: () => reponse(200, roue) });
			const d2 = new Map([[FILES + "demo-1-cp312-cp312-manylinux_2_17_x86_64.whl", sha(roue)]]);
			ok("manylinux wheel: 403, never requested", (await statut(servirPypi("files/packages/ab/cd/demo-1-cp312-cp312-manylinux_2_17_x86_64.whl", t3, d2))) === 403 && t3.demandees.length === 0);
			ok("file never announced by an index: 403, never requested", (await statut(servirPypi("files/packages/ab/cd/other-1-py3-none-any.whl", t3, digests))) === 403 && t3.demandees.length === 0);
			/* A verified wheel is cached: asked twice, downloaded once. */
			const dp = packAvecLock("pypi-cache", {});
			const t4 = transport({ [FILES + "demo-1-py3-none-any.whl"]: () => reponse(200, roue) });
			const a = await servirPypi("files/packages/ab/cd/demo-1-py3-none-any.whl", t4, digests, undefined, dp);
			const b2 = await servirPypi("files/packages/ab/cd/demo-1-py3-none-any.whl", t4, digests, undefined, dp);
			ok("same PyPI wheel twice: 200 both, downloaded once", a.status === 200 && b2.status === 200 && t4.demandees.length === 1 && Buffer.from(await b2.arrayBuffer()).equals(roue));
			const idx2 = await servirPypi("simple/demo/", t, new Map());
			const n = t.demandees.filter((u) => u === "https://pypi.org/simple/demo/").length;
			ok("index answer cached per package for the session", idx2.status === 200 && n === 1);
			ok("PyPI budget exhausted: 503", (await statut(servirPypi("files/packages/ab/cd/demo-1-py3-none-any.whl", t, digests, new Budget(5)))) === 503);
		}
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
r.done();
