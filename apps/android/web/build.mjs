// Builds the web side of the Android app:
//  1. the renderer of apps/windows (Vite, renderer only, no Electron main process),
//  2. the bridge shim (typechecked, then bundled by esbuild as an IIFE),
//  3. both copied into app/src/main/assets/web/.
// Exit code is non-zero on any failure (process.exitCode, never process.exit()).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const windowsApp = join(repo, "apps", "windows");
const assets = join(here, "..", "app", "src", "main", "assets", "web");

function run(label, command, args, cwd) {
	console.log(`[android:web] ${label}`);
	const r = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
	if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status ?? r.error})`);
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

	if (!existsSync(join(assets, "index.html")) || !existsSync(join(assets, "neo-shim.js"))) {
		throw new Error("assets incomplete");
	}
	console.log(`[android:web] assets ready in ${assets}`);
} catch (e) {
	console.error(`[android:web] ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
}
