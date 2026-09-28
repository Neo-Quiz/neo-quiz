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
/* Decodes AT MOST what can still fit under the cap, never the whole chunk
   (security review 2026-09-28): a program or a diagnostic cascade can hand
   over megabytes in ONE write, and decoding all of it just to throw the
   excess away costs memory and time for nothing. A UTF-16 unit never needs
   more than 3 bytes of UTF-8 (a 4-byte sequence gives two units), so
   (room + 1) * 4 bytes always reach the one unit past the cap that the
   callers use to notice an overflow. */
const decodeBounded = (bytes, used) => new TextDecoder().decode(bytes.subarray(0, (LIMIT - used + 1) * 4));
/* The linker refuses to grow the program's memory past this (256 MiB): with
   no maximum, a loop of `malloc` reached 4 GiB (3.3 GB measured on the
   host, 2026-09-28) inside the hidden window and took the machine with it.
   Past the cap `malloc` answers NULL, like on any small machine. */
const MAX_MEMORY = "-Wl,--max-memory=268435456";

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
		? ["clang++", "-O1", "-std=c++20", "-fno-exceptions", MAX_MEMORY, source, "-o", "a.wasm"]
		: ["clang", "-O1", "-std=c17", MAX_MEMORY, source, "-o", "a.wasm"];
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
		diagnostics += decodeBounded(bytes, diagnostics.length);
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
		output += decodeBounded(bytes, output.length);
		if (output.length > LIMIT) { output = output.slice(0, LIMIT); tooLong = true; }
	};
	const { WASI, File, OpenFile, ConsoleStdout, wasi: wasiDefs } = o.shim;
	/* stdin is READ-ONLY. The shim's `readonly` flag on `File` only guards
	   `fd_write`/`fd_pwrite`: `fd_allocate` (`posix_fallocate(0, …)`) and
	   `fd_filestat_set_size` (`ftruncate(0, …)`) grow the file's JS buffer
	   regardless, OUTSIDE the wasm memory and so outside `--max-memory`
	   (1.9 GB measured, 2026-09-28). Every mutating entry point answers
	   EBADF, like a descriptor opened for reading only; `fd_read`,
	   `fd_pread` and `fd_seek` stay the shim's own. */
	class ReadOnlyStdin extends OpenFile {
		fd_write() { return { ret: wasiDefs.ERRNO_BADF, nwritten: 0 }; }
		fd_pwrite() { return { ret: wasiDefs.ERRNO_BADF, nwritten: 0 }; }
		fd_allocate() { return wasiDefs.ERRNO_BADF; }
		fd_filestat_set_size() { return wasiDefs.ERRNO_BADF; }
	}
	const fds = [
		new ReadOnlyStdin(new File(new TextEncoder().encode(m.stdin ?? ""), { readonly: true })),
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
