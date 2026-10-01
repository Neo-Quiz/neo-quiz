/**
 * The Syncthing binary the Windows app embeds, pinned by hand.
 *
 * The app refuses to trust the network for this: `fetch-syncthing.mjs` only
 * accepts a zip whose SHA-256 equals `zipSha256`, and `check-package.mjs`
 * only accepts a packaged `syncthing.exe` whose SHA-256 equals `exeSha256`.
 * Bumping the version means rewriting these four values by hand, after
 * cross-checking the zip hash with the release's own published
 * `sha256sum.txt.asc` (done for 2.1.5 on 2026-10-01: the line for
 * `syncthing-windows-amd64-v2.1.5.zip` carries the same hash).
 */
export const SYNCTHING = {
	version: "2.1.5",
	zipName: "syncthing-windows-amd64-v2.1.5.zip",
	zipUrl: "https://github.com/syncthing/syncthing/releases/download/v2.1.5/syncthing-windows-amd64-v2.1.5.zip",
	checksumsUrl: "https://github.com/syncthing/syncthing/releases/download/v2.1.5/sha256sum.txt.asc",
	zipSha256: "39571e4d0900c2a2cab14c0b170f49751340a869e49734ccc8079d9b98a7974b",
	/** The entry of the zip that is extracted, and nothing else. */
	exeEntry: "syncthing-windows-amd64-v2.1.5/syncthing.exe",
	exeSha256: "36a0f7bc372f64fa7cc4f5654fa324c0dd9f7fef2e07565e00c6e1cf73f50344",
	exeSize: 27448104,
};
