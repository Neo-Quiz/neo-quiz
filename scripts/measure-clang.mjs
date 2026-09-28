// scripts/measure-clang.mjs — measures what the C/C++ compiler pack would
// cost: package size (raw and gzipped), compile timing (cold/warm/larger
// input/C++), and how a compile error is reported. Feeds the decision gate
// in docs/superpowers/specs/2026-09-28-c-cpp-execution-design.md §6 and the
// PACK_FILES list Task 9's builder copies into the downloadable pack.
// Prints, never fails: every step is wrapped so one broken measurement does
// not hide the rest. Uses process.exitCode, never process.exit(), so any
// caller-side temp-dir cleanup still runs.
import { runClang } from "../apps/windows/node_modules/@yowasp/clang/gen/bundle.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { WASI } from "node:wasi";

const CLANG_DIR = "apps/windows/node_modules/@yowasp/clang";
const WASI_SHIM_DIR = "apps/windows/node_modules/@bjorn3/browser_wasi_shim";

// The files @yowasp/clang needs to compile BOTH C and C++: runClang and
// runLLVM share one Application instance (gen/bundle.js), which fetches all
// four core wasm modules plus the resource tarball (headers, libc, libc++)
// on first use, regardless of which language is compiled — there is no
// smaller C-only subset.
const PACK_FILES = [
	"gen/bundle.js",
	"gen/llvm.core.wasm",
	"gen/llvm.core2.wasm",
	"gen/llvm.core3.wasm",
	"gen/llvm.core4.wasm",
	"gen/llvm-resources.tar",
].map((rel) => join(CLANG_DIR, rel));

const HELLO_C = '#include <stdio.h>\nint main(void){ printf("hello %d\\n", 6*7); return 0; }\n';
const HELLO_CPP = '#include <iostream>\nint main(){ std::cout << "hello " << 6*7 << std::endl; }\n';
const LONG_C = HELLO_C + Array.from({ length: 100 }, (_, i) => `int f${i}(int x){ return x + ${i}; }`).join("\n");
const BROKEN_C = "int main(void){ return 0 }\n"; // missing semicolon, on purpose

async function time(label, fn) {
	const t0 = performance.now();
	const r = await fn();
	console.log(`${label}: ${Math.round(performance.now() - t0)} ms`);
	return r;
}

async function runWasi(wasm) {
	const wasi = new WASI({ version: "preview1", returnOnExit: true });
	const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasm), { wasi_snapshot_preview1: wasi.wasiImport });
	return wasi.start(inst);
}

async function compile(label, args, files) {
	try {
		return await time(label, () => runClang(args, files, { fetchProgress: () => {} }));
	} catch (err) {
		console.log(`${label}: FAILED — ${err?.constructor?.name}: ${err?.message}`);
		return null;
	}
}

async function measureCompiles() {
	const c1 = await compile("C hello, first compile (cold)", ["clang", "-O1", "-std=c17", "main.c", "-o", "a.wasm"], { "main.c": HELLO_C });
	await compile("C hello, second compile (warm)", ["clang", "-O1", "-std=c17", "main.c", "-o", "a.wasm"], { "main.c": HELLO_C });
	await compile("C 100-line compile", ["clang", "-O1", "-std=c17", "main.c", "-o", "a.wasm"], { "main.c": LONG_C });

	// The default `clang++ file.cpp -o a.wasm` FAILS at link time on this
	// package: the prebuilt libc++abi.a for wasm32-unknown-wasip1 does not
	// define the exception-handling runtime (__cxa_throw and friends), and
	// -fwasm-exceptions makes it worse (a different, larger set of missing
	// symbols). Demonstrated here so the finding is not lost; the working
	// build for this pack disables C++ exceptions with -fno-exceptions.
	await compile("C++ hello compile, default flags (expected to fail)", ["clang++", "-O1", "-std=c++20", "main.cpp", "-o", "a.wasm"], { "main.cpp": HELLO_CPP });
	const cpp = await compile("C++ hello compile, -fno-exceptions (first clang++ call)", ["clang++", "-O1", "-std=c++20", "-fno-exceptions", "main.cpp", "-o", "a.wasm"], { "main.cpp": HELLO_CPP });
	await compile("C++ hello compile, -fno-exceptions (warm)", ["clang++", "-O1", "-std=c++20", "-fno-exceptions", "main.cpp", "-o", "a.wasm"], { "main.cpp": HELLO_CPP });

	if (c1?.["a.wasm"]) {
		try {
			await runWasi(c1["a.wasm"]);
		} catch (err) {
			console.log(`C run FAILED — ${err?.constructor?.name}: ${err?.message}`);
		}
	}
	if (cpp?.["a.wasm"]) {
		try {
			await runWasi(cpp["a.wasm"]);
		} catch (err) {
			console.log(`C++ run FAILED — ${err?.constructor?.name}: ${err?.message}`);
		}
	}
}

async function measureCompileError() {
	let stderrText = "";
	try {
		await runClang(["clang", "-O1", "-std=c17", "bad.c", "-o", "a.wasm"], { "bad.c": BROKEN_C }, {
			fetchProgress: () => {},
			stderr: (bytes) => { if (bytes !== null) stderrText += new TextDecoder().decode(bytes); },
		});
		console.log("compile error test: NO ERROR THROWN (unexpected)");
	} catch (err) {
		console.log("compile error test — thrown value constructor:", err?.constructor?.name);
		console.log("compile error test — err.code:", err?.code);
		console.log("compile error test — err.message:", err?.message);
		console.log("compile error test — stderr callback text:", JSON.stringify(stderrText));
	}
}

function measurePackage() {
	console.log("\n-- package file sizes --");
	let total = 0;
	const walk = (d) => {
		for (const n of readdirSync(d)) {
			const p = join(d, n);
			const s = statSync(p);
			if (s.isDirectory()) walk(p);
			else {
				total += s.size;
				if (s.size > 1e6) console.log(`  ${(s.size / 1e6).toFixed(1)} MB  ${p}`);
			}
		}
	};
	walk(CLANG_DIR);
	console.log(`@yowasp/clang package total: ${(total / 1e6).toFixed(1)} MB`);

	console.log("\n-- PACK_FILES (needed to compile both C and C++) --");
	let packRaw = 0;
	let packGz = 0;
	for (const p of PACK_FILES) {
		const bytes = readFileSync(p);
		const gz = gzipSync(bytes, { level: 9 });
		packRaw += bytes.length;
		packGz += gz.length;
		console.log(`  ${p}: ${(bytes.length / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gz`);
	}
	console.log(`PACK_FILES total: ${(packRaw / 1e6).toFixed(1)} MB raw, ${(packGz / 1e6).toFixed(1)} MB gz`);

	console.log("\n-- @bjorn3/browser_wasi_shim (Task 2's in-browser WASI shim, not node:wasi) --");
	try {
		let shimRaw = 0;
		let shimGz = 0;
		const walkShim = (d) => {
			for (const n of readdirSync(d)) {
				const p = join(d, n);
				const s = statSync(p);
				if (s.isDirectory()) walkShim(p);
				else if (n.endsWith(".js") && n !== "tsconfig.tsbuildinfo") {
					const bytes = readFileSync(p);
					const gz = gzipSync(bytes, { level: 9 });
					shimRaw += bytes.length;
					shimGz += gz.length;
					console.log(`  ${p}: ${bytes.length} B raw, ${gz.length} B gz`);
				}
			}
		};
		walkShim(join(WASI_SHIM_DIR, "dist"));
		console.log(`browser_wasi_shim dist/*.js total: ${shimRaw} B raw, ${shimGz} B gz`);
	} catch (err) {
		console.log(`  could not measure browser_wasi_shim: ${err?.message}`);
	}

	console.log(`\nheap used: ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
}

try {
	await measureCompiles();
} catch (err) {
	console.log(`measureCompiles FAILED — ${err?.constructor?.name}: ${err?.message}`);
}
try {
	await measureCompileError();
} catch (err) {
	console.log(`measureCompileError FAILED — ${err?.constructor?.name}: ${err?.message}`);
}
try {
	measurePackage();
} catch (err) {
	console.log(`measurePackage FAILED — ${err?.constructor?.name}: ${err?.message}`);
}
