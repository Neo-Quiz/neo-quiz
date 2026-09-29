import test from "node:test";
import assert from "node:assert/strict";
import { lireUnreleased, deduireNiveau, niveauEntre, rang, figer, extraire } from "./changelog.mjs";

const EXEMPLE = `# Changelog

Intro.

## [Unreleased]

### Added
- One-click install of Claude Code.

### Fixed
- Provider dots line up.

## [1.1.0] - 2026-09-17

### Added
- Wallpapers.
`;

test("lireUnreleased rend les quatre listes, vides ou non", () => {
	assert.deepEqual(lireUnreleased(EXEMPLE), {
		sections: {
			Breaking: [],
			Added: ["One-click install of Claude Code."],
			Changed: [],
			Fixed: ["Provider dots line up."],
		},
	});
});

test("lireUnreleased rend null sans section Unreleased", () => {
	assert.equal(lireUnreleased("# Changelog\n\n## [1.0.0] - 2026-09-13\n"), null);
});

test("deduireNiveau : Breaking gives a major, anything else a patch (a minor is typed), nothing null", () => {
	const vide = { Breaking: [], Added: [], Changed: [], Fixed: [] };
	assert.equal(deduireNiveau({ ...vide, Breaking: ["x"], Fixed: ["y"] }), "major");
	assert.equal(deduireNiveau({ ...vide, Changed: ["x"] }), "patch");
	assert.equal(deduireNiveau({ ...vide, Added: ["x"], Fixed: ["y"] }), "patch");
	assert.equal(deduireNiveau({ ...vide, Fixed: ["y"] }), "patch");
	assert.equal(deduireNiveau(vide), null);
});

test("niveauEntre lit le saut, et refuse un recul", () => {
	assert.equal(niveauEntre("1.1.0", "2.0.0"), "major");
	assert.equal(niveauEntre("1.1.0", "1.2.0"), "minor");
	assert.equal(niveauEntre("1.1.0", "1.1.1"), "patch");
	assert.equal(niveauEntre("1.1.0", "1.1.0"), null);
	assert.equal(niveauEntre("1.1.0", "1.0.9"), null);
});

test("rang ordonne les niveaux", () => {
	assert.ok(rang("major") > rang("minor") && rang("minor") > rang("patch"));
});

test("figer renomme Unreleased, rouvre une section vide, garde le reste", () => {
	const fige = figer(EXEMPLE, "1.2.0", "2026-09-20");
	assert.ok(fige.includes("## [Unreleased]\n\n## [1.2.0] - 2026-09-20\n\n### Added\n- One-click install of Claude Code."));
	assert.ok(fige.endsWith("## [1.1.0] - 2026-09-17\n\n### Added\n- Wallpapers.\n"));
	assert.equal(fige.indexOf("## [Unreleased]"), fige.lastIndexOf("## [Unreleased]"));
});

test("extraire rend le corps d'une version, sans son titre", () => {
	assert.equal(extraire(EXEMPLE, "1.1.0"), "### Added\n- Wallpapers.");
	assert.throws(() => extraire(EXEMPLE, "9.9.9"), /9\.9\.9/);
});

test("figer : Unreleased en dernière ligne, sans saut final, ne perd aucun octet", () => {
	assert.equal(figer("# Changelog\n\n## [Unreleased]", "1.2.0", "2026-09-20"),
		"# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-09-20\n\n");
});

test("extraire accepte une version à suffixe", () => {
	assert.equal(extraire("## [1.2.0-beta] - 2026-09-20\n\n### Fixed\n- x\n", "1.2.0-beta"), "### Fixed\n- x");
});
