// Builds the web side of the Android app:
//  1. the renderer of apps/windows (Vite, renderer only, no Electron main process),
//  2. the bridge shim (typechecked, then bundled by esbuild as an IIFE),
//  3. both copied into app/src/main/assets/web/.
// Exit code is non-zero on any failure (process.exitCode, never process.exit()).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { installSyncthing } from "./pins.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const windowsApp = join(repo, "apps", "windows");
const assetsRoot = join(here, "..", "app", "src", "main", "assets");
const assets = join(assetsRoot, "web");
const codeAssets = join(assetsRoot, "code");
const CODE_ORIGIN = "https://code.appassets.androidplatform.net";

function run(label, command, args, cwd) {
	console.log(`[android:web] ${label}`);
	const r = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
	if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status ?? r.error})`);
}

/** The code sandbox: the PC's page and workers. The language packs (Python, C/C++) are NOT embedded: the app downloads them (LanguagePacks.kt). */
function buildCodeSandbox() {
	rmSync(codeAssets, { recursive: true, force: true });
	mkdirSync(codeAssets, { recursive: true });
	const pcCode = join(windowsApp, "electron", "code");
	for (const f of ["index.html", "page.js", "worker-python.mjs"]) copyFileSync(join(pcCode, f), join(codeAssets, f));
	// worker-clang imports the pack by the PC scheme: point it at the Android code origin.
	const clang = readFileSync(join(pcCode, "worker-clang.mjs"), "utf8");
	if (!clang.includes("neo-code://app/")) throw new Error("worker-clang.mjs no longer names neo-code://app/: update the build");
	writeFileSync(join(codeAssets, "worker-clang.mjs"), clang.replaceAll("neo-code://app/", CODE_ORIGIN + "/"));
	copyFileSync(join(here, "code-shim.js"), join(assetsRoot, "code-shim.js"));
	console.log("[android:web] code sandbox ready (no language pack embedded)");
}

try {
	// Renderer only: `npm run build` of apps/windows would also build Electron.
	run("renderer (vite build)", "npx", ["vite", "build"], windowsApp);

	run("shim typecheck", "npx", ["tsc", "-p", join(here, "tsconfig.json")], repo);

	rmSync(assets, { recursive: true, force: true });
	mkdirSync(assets, { recursive: true });
	cpSync(join(windowsApp, "dist"), assets, { recursive: true, filter: (src) => !src.endsWith(".map") });

	await build({
		entryPoints: [join(here, "shim.ts")],
		outfile: join(assets, "neo-shim.js"),
		bundle: true,
		format: "iife",
		target: "es2020",
		logLevel: "warning",
	});

	buildCodeSandbox();

	// The embedded Syncthing (Task 10): pinned APKs, libraries under jniLibs (git-ignored).
	await installSyncthing(join(repo, "dist-pack", "syncthing-android"), join(here, "..", "app"));

	if (!existsSync(join(assets, "index.html")) || !existsSync(join(assets, "neo-shim.js"))) {
		throw new Error("assets incomplete");
	}
	console.log(`[android:web] assets ready in ${assets}`);
} catch (e) {
	console.error(`[android:web] ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
}
