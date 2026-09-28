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
/* The message types (`chauffer`, `executer`, `pret`) are the page's
   protocol, shared with worker-python.mjs and page.js: kept as they are. */
const LIMIT = 20000;
const BASE = "neo-code://app/languages/c/";
let tools = null;
const load = () => (tools ??= Promise.all([
	import(BASE + "clang/bundle.js"),
	import(BASE + "wasi-shim/index.js"),
]).then(([clang, shim]) => ({ runClang: clang.runClang, shim })));
const bound = (s) => (s.length > LIMIT ? s.slice(0, LIMIT) : s);

self.onmessage = async (e) => {
	const m = e.data;
	if (m.type === "chauffer") { load().catch(() => { tools = null; }); return; }
	if (m.type !== "executer") return;
	let o;
	try { o = await load(); }
	catch (err) { self.postMessage({ id: m.id, res: { status: "not-installed", stdout: "", error: bound(String(err)) } }); return; }
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
	/* Bounded WHILE it grows, like stdout below: a template-instantiation
	   error cascade can write megabytes of diagnostics within the timeout. */
	let diagnostics = "";
	const captureStderr = (bytes) => {
		if (!bytes || diagnostics.length > LIMIT) return;
		diagnostics += new TextDecoder().decode(bytes);
		if (diagnostics.length > LIMIT) diagnostics = diagnostics.slice(0, LIMIT);
	};
	try {
		const files = await o.runClang(flags, { [source]: m.code }, { stderr: captureStderr });
		wasm = files["a.wasm"];
		if (!wasm) throw new Error(diagnostics || "compilation produced no output");
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: "compile-error", stdout: "", error: bound(diagnostics || String(err?.message ?? err)) } });
		return;
	}
	let output = "", tooLong = false;
	const write = (bytes) => {
		if (tooLong) return;
		output += new TextDecoder().decode(bytes);
		if (output.length > LIMIT) { output = output.slice(0, LIMIT); tooLong = true; }
	};
	const { WASI, File, OpenFile, ConsoleStdout } = o.shim;
	const fds = [
		new OpenFile(new File(new TextEncoder().encode(m.stdin ?? ""))),
		new ConsoleStdout(write),
		new ConsoleStdout(write),
	];
	const wasi = new WASI([source.replace(/\..*$/, "")], [], fds);
	try {
		const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasm), { wasi_snapshot_preview1: wasi.wasiImport });
		const code = wasi.start(inst);
		self.postMessage({ id: m.id, res: { status: tooLong ? "too-long" : "ok", stdout: output, ...(code ? { error: `exit ${code}` } : {}) } });
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: tooLong ? "too-long" : "error", stdout: output, error: bound(String(err?.message ?? err)) } });
	}
};
