// Ratchet on animations that never end. A still page must run nothing: an
// infinite animation on an element that is always on screen costs a frame on
// every vsync (phone audit, 2026-10-08: the Resume button's light sweep and the
// current bead's sweep kept the WebView at 10 to 39 % of a core on Home).
//
// Every infinite animation of the shared CSS must be listed here, either:
//  - "transient": it only exists while something is happening (a spinner while
//    loading, a pulse while generating, the caret of a code terminal) and the
//    element is gone or the class removed when it ends;
//  - "phone-off": always present on a page, so `mobile.css` must switch it off
//    under `.nq-mobile` (checked below: the rule must exist).
// A new infinite animation fails this check until it is classified.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIRS = [join(root, "src/assets/css"), join(root, "apps/windows/src/assets")];

const KNOWN = {
	"qbd-stars-bob": "transient", "qbd-stars-twinkle": "transient", // effort slider of the Generate page (desktop only)
	"fx-btn-primary-spin": "transient", "fx-btn-ghost-spin": "transient", // .is-loading buttons
	"quiz-code-run-spin": "transient", // a running code block
	"quiz-command-caret-blink": "transient", // the caret of a terminal block
	"qbd-effort-rainbow": "transient", // Generate page
	"qbd-ai-logo-travail": "transient", "qbd-ai-reflet": "transient", "qbd-ai-plan-tourne": "transient", "qbd-ai-plan-respire": "transient",
	"qbd-ai-nudge-float": "transient", "qbd-install-spin": "transient", "qbd-video-install-balayage": "transient",
	"qbd-web-sonar": "transient", "qbd-glide": "transient", "qbd-usage-spin": "transient", "qbd-cli-maj-tourne": "transient", // Generate page and its installers
	"qbd-btn-shine": "transient", // `.qbd-btn--shine`: no element carries it today
	"qbd-cta3d-reflet": "phone-off",
	"qbd-folder-spin": "transient", "qbd-folder-sweep": "transient", // a folder row while its file opens
	"qbd-generating-pulse": "transient", "qbd-generating-spin": "transient", // the rail while a generation runs
	"qbd-ai-fil-bas-point": "transient", // typing dots of the scroll-to-bottom button, only while a generation runs
	"quiz-timer-pulse": "transient", // the timer of a test about to end
	"nqm-spin": "transient", // Moodle window spinner
	"nq-perle-reflet": "phone-off",
	"nq-usage-pulse": "transient", "nq-maj-tourne": "transient", "nq-verifier-tour": "transient", "nq-verifier-balayage": "transient", // desktop title bar and menu
};
// For each "phone-off" animation, the text its neutralising rule in mobile.css must contain.
const PHONE_OFF_RULE = {
	"qbd-cta3d-reflet": ".nq-mobile .qbd-cta3d-clip svg",
	"nq-perle-reflet": ".nq-mobile #neo-quiz-root > .qbd-qz .quiz-nav .quiz-tab.active",
};

function* files(dir) {
	for (const n of readdirSync(dir)) {
		const p = join(dir, n);
		if (statSync(p).isDirectory()) yield* files(p);
		else if (p.endsWith(".css")) yield p;
	}
}

const found = new Map();
for (const dir of CSS_DIRS) for (const f of files(dir)) {
	const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const keyframes = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
	for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)[;}]/g)) {
		for (const part of m[1].split(/,(?![^(]*\))/)) {
			if (!/\binfinite\b/.test(part)) continue;
			const name = part.trim().split(/\s+/).find(w => keyframes.has(w));
			if (name) found.set(name, f.slice(root.length + 1));
		}
	}
}

let bad = 0;
for (const [name, file] of found) {
	if (!KNOWN[name]) { console.error(`FAIL ${name} (${file}): unlisted infinite animation; classify it in scripts/check-idle-animations.mjs`); bad++; }
}
for (const name of Object.keys(KNOWN)) {
	if (!found.has(name)) { console.error(`FAIL ${name}: listed but no longer infinite anywhere; remove it from the list`); bad++; }
}
const mobile = readFileSync(join(root, "src/assets/css/mobile.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
for (const [name, selector] of Object.entries(PHONE_OFF_RULE)) {
	const at = mobile.indexOf(selector);
	const block = at < 0 ? "" : mobile.slice(at, mobile.indexOf("}", at));
	if (!/animation:\s*none/.test(block)) { console.error(`FAIL ${name}: mobile.css has no "${selector} { animation: none }"`); bad++; }
}
for (const [name, kind] of Object.entries(KNOWN)) if (kind === "phone-off" && !PHONE_OFF_RULE[name]) { console.error(`FAIL ${name}: phone-off without a checked rule`); bad++; }
console.log(`${found.size} infinite animations, ${bad} problem(s)`);
process.exitCode = bad ? 1 : 0;
