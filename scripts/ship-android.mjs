/*
 * Ships the Android app:
 *
 *   npm run ship:android                     versionName / versionCode from apps/android/app/build.gradle.kts
 *   npm run ship:android -- --notes "Text"   the one-line notes the app shows with the update
 *
 * WHAT IT DOES, in this order (the last step is the only one that publishes
 * the update to phones, because phones read docs/android-latest.json):
 *
 *   1. guards: branch main, clean tree, HEAD already pushed, version code
 *      higher than the published manifest, release tag `android-v<name>` free
 *      (locally, on origin, and as a GitHub release);
 *   2. builds the signed release APK in the clean worktree
 *      %LOCALAPPDATA%\Temp\nq-release-07e7a972 (detached at HEAD; ignored build
 *      output only, the worktree must still be clean afterwards);
 *   3. computes the SHA-256 and the size of the APK;
 *   4. creates the GitHub release `android-v<name>` with the asset
 *      `NeoQuiz-<name>.apk`, `--latest=false`: desktop releases and the
 *      "latest" pointer (read by the desktop installer) are never touched.
 *      release.yml reacts to `desktop-v*` tags only, so this tag builds nothing;
 *   5. checks the uploaded asset has the size computed in step 3;
 *   6. writes docs/android-latest.json, commits "Publish Android <name>" and
 *      pushes main (site.yml deploys docs/ to https://neo-quiz.github.io).
 *
 * The app downloads only that manifest, then verifies size and SHA-256 of the
 * APK against it. Secrets: the keystore password is handled by
 * apps/android/scripts/with-keystore-password.ps1, never printed here.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Neo-Quiz/neo-quiz";
const GRADLE_FILE = "apps/android/app/build.gradle.kts";
const MANIFEST_FILE = "docs/android-latest.json";
const WORKTREE = path.join(process.env.LOCALAPPDATA ?? path.join(process.env.HOME ?? "", "AppData", "Local"), "Temp", "nq-release-07e7a972");
/**
 * SHA-256 of the signing certificate of the installed app (CN=Ahmed MILI, O=Neo Quiz),
 * the one registered in the Google Play Console. Obtained on 2026-10-07 with
 * `apksigner verify --print-certs` (build-tools 36.0.0) on the release APK built at
 * f837fa10 by the same signing pipeline (with-keystore-password.ps1). A build signed by
 * anything else is refused before it is uploaded.
 */
export const SIGNER_SHA256 = "8d99aac7f6415753ea01b3fd13d447225524a76bcd8f102a63b68d9021676088";
const APPLICATION_ID = "com.ahmedmili.neoquiz";
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** versionCode and versionName out of the Gradle file. */
export function readVersion(gradleText) {
	const code = /^\s*versionCode\s*=\s*(\d+)\s*$/m.exec(gradleText);
	const name = /^\s*versionName\s*=\s*"([^"]+)"\s*$/m.exec(gradleText);
	if (!code || !name) throw new Error("versionCode / versionName not found in " + GRADLE_FILE);
	if (!SEMVER.test(name[1])) throw new Error(`versionName "${name[1]}" is not x.y.z`);
	return { versionCode: Number(code[1]), versionName: name[1] };
}

/** The manifest the app reads: exactly these keys (UpdateRules.parse on the phone). */
export function buildManifest({ versionCode, versionName, sha256, size, notes }) {
	return {
		versionCode,
		versionName,
		url: `https://github.com/${REPO}/releases/download/android-v${versionName}/NeoQuiz-${versionName}.apk`,
		sha256,
		size,
		notes,
	};
}

function run(cmd, args, options = {}) {
	return execFileSync(cmd, args, { encoding: "utf8", cwd: root, ...options }).trim();
}

function fail(message) {
	console.error(`ship:android: ${message}`);
	process.exitCode = 1;
}

/** apksigner (newest build-tools of the SDK): the signer must be the pinned one, and the app not debuggable. */
function checkSignature(apk) {
	const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
	const tools = path.join(sdk, "build-tools");
	const newest = readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
	const dir = path.join(tools, newest);
	const isWindows = process.platform === "win32";
	const out = execFileSync(path.join(dir, isWindows ? "apksigner.bat" : "apksigner"), ["verify", "--print-certs", apk], { encoding: "utf8", shell: isWindows });
	const signers = [...out.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/g)].map((m) => m[1]);
	if (signers.length !== 1 || signers[0] !== SIGNER_SHA256) throw new Error(`signer ${signers.join(",") || "none"} is not the pinned one`);
	const aapt = path.join(dir, isWindows ? "aapt2.exe" : "aapt2");
	const badging = execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (!badging.includes(`package: name='${APPLICATION_ID}'`)) throw new Error("the APK package name is not " + APPLICATION_ID);
	if (/application-debuggable/.test(badging)) throw new Error("the APK is debuggable");
}

function main() {
	const argv = process.argv.slice(2);
	const at = argv.indexOf("--notes");
	const versionInfo = readVersion(readFileSync(path.join(root, GRADLE_FILE), "utf8"));
	const { versionCode, versionName } = versionInfo;
	const notes = at >= 0 ? String(argv[at + 1] ?? "") : `Neo Quiz for Android ${versionName}`;
	if (!notes || notes.length > 1000) return fail("notes must be 1 to 1000 characters");
	const tag = `android-v${versionName}`;

	// 1. guards
	if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") return fail("not on main");
	if (run("git", ["status", "--porcelain"])) return fail("the working tree is not clean");
	run("git", ["fetch", "origin", "main", "--tags", "--quiet"]);
	const head = run("git", ["rev-parse", "HEAD"]);
	if (head !== run("git", ["rev-parse", "origin/main"])) return fail("HEAD is not exactly origin/main: pull or push so they are equal first");
	// The published manifest is read from origin/main, never from a possibly stale working copy (absent: versionCode 0).
	const shown = spawnSync("git", ["show", `origin/main:${MANIFEST_FILE}`], { cwd: root, encoding: "utf8" });
	const publishedCode = shown.status === 0 ? JSON.parse(shown.stdout).versionCode : 0;
	if (!(versionCode > publishedCode)) return fail(`versionCode ${versionCode} is not above the published ${publishedCode}`);
	if (run("git", ["tag", "-l", tag])) return fail(`tag ${tag} already exists locally`);
	if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`])) return fail(`tag ${tag} already exists on origin`);
	if (spawnSync("gh", ["release", "view", tag, "--repo", REPO], { cwd: root, stdio: "ignore" }).status === 0) return fail(`release ${tag} already exists`);

	// 2. build in the clean worktree
	if (!existsSync(WORKTREE)) return fail(`worktree ${WORKTREE} not found`);
	const wt = (args, options = {}) => execFileSync("git", ["-C", WORKTREE, ...args], { encoding: "utf8", ...options }).trim();
	if (wt(["status", "--porcelain"])) return fail("the release worktree is not clean");
	wt(["checkout", "--detach", head]);
	// Stale ignored files (old web assets, build outputs) must never reach the APK. Kept: the linked
	// node_modules, dist-pack, the SDK path, the Gradle cache and the Syncthing libs (hash-pinned by the build).
	wt(["clean", "-fdx", "-e", "node_modules", "-e", "dist-pack", "-e", "local.properties", "-e", ".gradle", "-e", "jniLibs"]);
	console.log(`Building ${tag} from ${head.slice(0, 8)} in ${WORKTREE}`);
	const isWindows = process.platform === "win32";
	const npm = isWindows ? "npm.cmd" : "npm";
	execFileSync(npm, ["run", "android:web"], { cwd: WORKTREE, stdio: "inherit", shell: isWindows });
	execFileSync(
		"pwsh",
		["-NoProfile", "-File", "apps/android/scripts/with-keystore-password.ps1", isWindows ? "./gradlew.bat" : "./gradlew", "assembleRelease", "--no-daemon"],
		{ cwd: path.join(WORKTREE, "apps", "android"), stdio: "inherit" },
	);
	if (wt(["status", "--porcelain"])) return fail("the release worktree is not clean after the build");
	const built = path.join(WORKTREE, "apps", "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
	if (!existsSync(built)) return fail("app-release.apk not found (is the release build signed? an unsigned APK is app-release-unsigned.apk)");
	const meta = JSON.parse(readFileSync(path.join(path.dirname(built), "output-metadata.json"), "utf8"));
	const element = meta.elements?.[0];
	if (!element || element.versionCode !== versionCode || element.versionName !== versionName) return fail("the built APK does not carry the expected versionCode / versionName");
	if (meta.applicationId !== APPLICATION_ID) return fail(`applicationId is ${meta.applicationId}, expected ${APPLICATION_ID}`);
	if (meta.variantName !== "release") return fail(`variant is ${meta.variantName}, expected release`);
	checkSignature(built);

	// 3. digest
	const staging = mkdtempSync(path.join(tmpdir(), "nq-android-ship-"));
	const asset = path.join(staging, `NeoQuiz-${versionName}.apk`);
	copyFileSync(built, asset);
	const bytes = readFileSync(asset);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const size = statSync(asset).size;
	console.log(`APK ${size} bytes, sha256 ${sha256}`);

	// 4. the release (never latest, never a desktop release)
	execFileSync("gh", [
		"release", "create", tag, asset,
		"--repo", REPO, "--target", head, "--latest=false",
		"--title", `Neo Quiz for Android ${versionName}`, "--notes", notes,
	], { cwd: root, stdio: "inherit" });

	// 5. the uploaded asset, downloaded back, has the size AND the SHA-256 computed above
	const check = mkdtempSync(path.join(tmpdir(), "nq-android-verify-"));
	run("gh", ["release", "download", tag, "--repo", REPO, "--pattern", `NeoQuiz-${versionName}.apk`, "--dir", check]);
	const back = readFileSync(path.join(check, `NeoQuiz-${versionName}.apk`));
	if (back.length !== size || createHash("sha256").update(back).digest("hex") !== sha256) {
		return fail(`the uploaded asset does not match the built APK; manifest NOT written. Delete nothing: fix by a NEW version (published versions are never deleted).`);
	}

	// 6. the manifest, then main
	const manifest = buildManifest({ versionCode, versionName, sha256, size, notes });
	mkdirSync(path.join(root, "docs"), { recursive: true });
	writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
	run("git", ["add", "--", MANIFEST_FILE]);
	run("git", ["commit", "-m", `Publish Android ${versionName}`, "--", MANIFEST_FILE]);
	try {
		run("git", ["push", "origin", "main"], { stdio: "inherit" });
	} catch (e) {
		console.error([
			"",
			`The release ${tag} IS published but the manifest commit was not pushed. Recover with:`,
			"  git fetch origin main",
			"  git pull --rebase origin main",
			"  git push origin main",
			`(the local commit "Publish Android ${versionName}" already holds ${MANIFEST_FILE}; if it was lost, write this file again:)`,
			JSON.stringify(manifest, null, 2),
		].join("\n"));
		throw e;
	}
	console.log(`Published Android ${versionName}. Phones see it once the site deploys ${MANIFEST_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main();
	} catch (e) {
		fail(e instanceof Error ? e.message : String(e));
	}
}
