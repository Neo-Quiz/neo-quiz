// Fails when a `check:*` script of package.json is not run by ci.yml, so a red
// check can never go unnoticed again (check:folders sat red for 3 days).
import { readFileSync } from "node:fs";

// Scripts deliberately not run in CI, each with its reason.
const ALLOWED = {
  "check:watch": "tsc --watch, never terminates",
  "check:app": "full Vite + Electron build, already done by the pack:* CI steps",
};

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const steps = new Set(
  readFileSync(".github/workflows/ci.yml", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim()),
);
const missing = Object.keys(scripts).filter(
  (k) => k.startsWith("check:") && !(k in ALLOWED) && !steps.has(`run: npm run ${k}`),
);
for (const k of missing) console.error(`check:ci-coverage: ${k} is not run in ci.yml`);
process.exitCode = missing.length ? 1 : 0;
