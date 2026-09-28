/* THE C/C++ WORKER. Compiles with Clang + LLD in WebAssembly (@yowasp/clang,
   from the downloaded pack) to wasm32-wasi, then runs the program under a
   WASI shim with stdin/stdout in memory: no file of the machine, no network,
   no process. Consumed by ONE run, like the Python worker: the page kills
   it at the result or at the timeout. Compile flags are the app's, never
   the quiz's.

   `-fno-exceptions` on the C++ compile is NOT optional (measured 2026-09-28,
   spec 2026-09-28-c-cpp-execution-design.md §6): the default invocation
   fails to LINK even a `<iostream>`-only "hello world" with no `throw` —
   `wasm-ld` reports `undefined symbol: __cxa_allocate_exception` and
   `__cxa_throw`, because this build's WASI sysroot does not ship the C++
   exception-handling runtime. Every C++ block therefore runs with
   exceptions disabled. */
const PLAFOND = 20000;
const BASE = "neo-code://app/languages/c/";
let outils = null;
const charger = () => (outils ??= Promise.all([
	import(BASE + "clang/bundle.js"),
	import(BASE + "wasi-shim/index.js"),
]).then(([clang, shim]) => ({ runClang: clang.runClang, shim })));
const borner = (s) => (s.length > PLAFOND ? s.slice(0, PLAFOND) : s);

self.onmessage = async (e) => {
	const m = e.data;
	if (m.type === "chauffer") { charger().catch(() => { outils = null; }); return; }
	if (m.type !== "executer") return;
	let o;
	try { o = await charger(); }
	catch (err) { self.postMessage({ id: m.id, res: { status: "not-installed", stdout: "", error: borner(String(err)) } }); return; }
	self.postMessage({ id: m.id, type: "pret" });

	const cpp = m.language === "cpp";
	const source = cpp ? "main.cpp" : "main.c";
	const flags = cpp
		? ["clang++", "-O1", "-std=c++20", "-fno-exceptions", source, "-o", "a.wasm"]
		: ["clang", "-O1", "-std=c17", source, "-o", "a.wasm"];
	let wasm;
	/* `runClang`'s thrown `Exit` carries only `.code` (the process exit
	   status) — its `.message` is the generic "Exited with status N", never
	   the diagnostic text (measured, same spec section). The compiler's
	   actual message (what the learner needs to see, e.g. "expected ';'
	   after return statement") only reaches us through the `stderr`
	   callback of `RunOptions`. */
	let diagnostics = "";
	const captureStderr = (bytes) => { if (bytes) diagnostics += new TextDecoder().decode(bytes); };
	try {
		const files = await o.runClang(flags, { [source]: m.code }, { stderr: captureStderr });
		wasm = files["a.wasm"];
		if (!wasm) throw new Error(diagnostics || "compilation produced no output");
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: "compile-error", stdout: "", error: borner(diagnostics || String(err?.message ?? err)) } });
		return;
	}
	let sortie = "", tropLong = false;
	const ecrire = (octets) => {
		if (tropLong) return;
		sortie += new TextDecoder().decode(octets);
		if (sortie.length > PLAFOND) { sortie = sortie.slice(0, PLAFOND); tropLong = true; }
	};
	const { WASI, File, OpenFile, ConsoleStdout } = o.shim;
	const fds = [
		new OpenFile(new File(new TextEncoder().encode(m.stdin ?? ""))),
		new ConsoleStdout(ecrire),
		new ConsoleStdout(ecrire),
	];
	const wasi = new WASI([source.replace(/\..*$/, "")], [], fds);
	try {
		const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasm), { wasi_snapshot_preview1: wasi.wasiImport });
		const code = wasi.start(inst);
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "ok", stdout: sortie, ...(code ? { error: `exit ${code}` } : {}) } });
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "error", stdout: sortie, error: borner(String(err?.message ?? err)) } });
	}
};
