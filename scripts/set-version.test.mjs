import test from "node:test";
import assert from "node:assert/strict";

import { isVersion, nextVersion, withVersion } from "./set-version.mjs";

test("un numéro simple est reconnu", () => {
	assert.equal(isVersion("2.4.0"), true);
});

test("un numéro avec suffixe -beta est reconnu", () => {
	assert.equal(isVersion("2.4.0-beta"), true);
});

test("un suffixe multi-segments (rc.1) est reconnu", () => {
	assert.equal(isVersion("2.4.0-rc.1"), true);
});

test("un texte qui n'est pas un numéro est rejeté", () => {
	assert.equal(isVersion("patch"), false);
	assert.equal(isVersion("2.4"), false);
	assert.equal(isVersion(undefined), false);
});

test("patch monte le dernier chiffre", () => {
	assert.equal(nextVersion("2.4.0", "patch"), "2.4.1");
});

test("minor remet le patch à zéro", () => {
	assert.equal(nextVersion("2.4.3", "minor"), "2.5.0");
});

test("major remet minor et patch à zéro", () => {
	assert.equal(nextVersion("2.4.3", "major"), "3.0.0");
});

test("le suffixe -beta survit à un bump patch", () => {
	assert.equal(nextVersion("2.4.0-beta", "patch"), "2.4.1-beta");
});

test("le suffixe -beta survit à un bump minor", () => {
	assert.equal(nextVersion("2.4.0-beta", "minor"), "2.5.0-beta");
});

test("le suffixe -beta survit à un bump major", () => {
	assert.equal(nextVersion("2.4.0-beta", "major"), "3.0.0-beta");
});

test("un niveau inconnu est refusé", () => {
	assert.throws(() => nextVersion("2.4.0", "bogus"), /Niveau attendu/);
});

test("une version actuelle illisible est refusée", () => {
	assert.throws(() => nextVersion("deux-point-quatre", "patch"), /illisible/);
});

test("withVersion remplace l'unique occurrence de version", () => {
	const before = `{\n  "id": "quiz-blocks",\n  "version": "2.4.0-beta",\n  "main": "main.js"\n}\n`;
	const after = withVersion(before, "2.5.0-beta");
	assert.match(after, /"version": "2\.5\.0-beta"/);
	// Rien d'autre que la ligne de version n'a bougé.
	assert.equal(after.replace('"2.5.0-beta"', '"2.4.0-beta"'), before);
});

test("withVersion échoue plutôt que de deviner si aucune version n'est trouvée", () => {
	assert.throws(() => withVersion(`{"id": "quiz-blocks"}`, "2.5.0"), /occurrence/);
});

test("withVersion échoue si le manifest porte deux occurrences de version", () => {
	const doubled = `{"version": "2.4.0-beta", "version": "2.4.0-beta"}`;
	assert.throws(() => withVersion(doubled, "2.5.0"), /occurrence/);
});


// Les fixtures exécutent le vrai script dans un dépôt temporaire : aucun
// numéro du checkout partagé ne peut être modifié pendant les tests.
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "neo-quiz-version-"));
	t.after(async () => {
		assert.equal(path.dirname(root), path.resolve(tmpdir()));
		assert.ok(path.basename(root).startsWith("neo-quiz-version-"));
		await rm(root, { recursive: true, force: true });
	});
	for (const dir of ["scripts", "apps/windows", "src/assets"]) {
		await mkdir(path.join(root, dir), { recursive: true });
	}
	await copyFile(new URL("./set-version.mjs", import.meta.url), path.join(root, "scripts/set-version.mjs"));
	const documents = {
		"package.json": { name: "neo-quiz", version: "9.0.0", private: true },
		"apps/windows/package.json": { name: "@neo-quiz/windows", version: "1.0.0", private: true },
		"apps/windows/package-lock.json": {
			name: "@neo-quiz/windows", version: "1.0.0", lockfileVersion: 3,
			packages: { "": { name: "@neo-quiz/windows", version: "1.0.0" },
				"node_modules/example": { version: "5.4.3", integrity: "unchanged" } },
		},
	};
	for (const [file, document] of Object.entries(documents)) {
		await writeFile(path.join(root, file), JSON.stringify(document, null, 2) + "\n");
	}
	const script = path.join(root, "scripts/set-version.mjs");
	return {
		root, script, api: await import(pathToFileURL(script).href),
		read: async file => JSON.parse(await readFile(path.join(root, file), "utf8")),
		raw: file => readFile(path.join(root, file), "utf8"),
	};
}

test("la lecture et les bumps visent l'application par défaut", async t => {
	const f = await fixture(t);
	assert.equal(await f.api.currentVersion(), "1.0.0");
	assert.equal(await f.api.resolveVersion("minor"), "1.1.0");
	assert.equal(await f.api.resolveVersion("1.2.0-rc.1"), "1.2.0-rc.1");
});

test("un bump application synchronise le package et les deux versions racine du lockfile", async t => {
	const f = await fixture(t);
	const rootBefore = await f.raw("package.json");
	assert.deepEqual(await f.api.setVersion("1.1.0-rc.1"), ["apps/windows/package.json", "apps/windows/package-lock.json"]);
	assert.equal((await f.read("apps/windows/package.json")).version, "1.1.0-rc.1");
	const lock = await f.read("apps/windows/package-lock.json");
	assert.equal(lock.version, "1.1.0-rc.1");
	assert.equal(lock.packages[""].version, "1.1.0-rc.1");
	assert.deepEqual(lock.packages["node_modules/example"], { version: "5.4.3", integrity: "unchanged" });
	assert.equal(await f.raw("package.json"), rootBefore);
	assert.equal(await f.api.resolveVersion("patch"), "1.1.1-rc.1");
});

test("la CLI livre l'application et annonce son tag par défaut", async t => {
	const f = await fixture(t);
	const result = spawnSync(process.execPath, [f.script, "patch"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.equal((await f.read("apps/windows/package.json")).version, "1.0.1");
	assert.match(result.stdout, /git tag desktop-v1\.0\.1/);
});

test("une version invalide ou inchangée ne modifie aucun fichier", async t => {
	const f = await fixture(t);
	const before = await f.raw("apps/windows/package.json");
	await assert.rejects(f.api.setVersion("invalid"), /Version attendue/);
	await assert.rejects(f.api.setVersion("1.0.0"), /Rien à changer/);
	assert.equal(await f.raw("apps/windows/package.json"), before);
});

test("un lockfile incomplet échoue avant de modifier le package", async t => {
	const f = await fixture(t);
	const before = await f.raw("apps/windows/package.json");
	await writeFile(path.join(f.root, "apps/windows/package-lock.json"), JSON.stringify({ version: "1.0.0", packages: {} }));
	await assert.rejects(f.api.setVersion("1.0.1"), /lockfile|packages/i);
	assert.equal(await f.raw("apps/windows/package.json"), before);
});
