/**
 * Non-regression of the sandboxed HTML frame (src/engine/html-frame-core.ts).
 *
 * A Learn reading (`html`) and an "Explain" answer (a fenced html block) may
 * carry a whole interactive page, and a SHARED quiz can carry it too: the page
 * is hostile code. What keeps the app safe is exactly this module's output:
 * the iframe `sandbox` attribute (never `allow-same-origin`), the CSP injected
 * FIRST in the document, the size cap, and the narrow height message filter.
 *
 * The REAL module is loaded (scripts/lib/load-src.mjs), not a copy.
 *
 *     npm run check:html-frame
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/html-frame-core.ts", (m) => {
	const r = makeReporter("Cadre HTML isolé (noyau)");
	const {
		FRAME_SANDBOX, FRAME_CSP, FRAME_MAX_BYTES, FRAME_MIN_HEIGHT, FRAME_MAX_HEIGHT, FRAME_DEFAULT_THEME,
		buildSrcdoc, acceptHeight, frameMarkup, splitHtmlBlocks, htmlDeLecture, acceptFrameUrl, escapeAttr,
	} = m;
	const labels = { title: "T", tooLarge: "Too large" };

	// --- sandbox -------------------------------------------------------
	r.check("sandbox attribute is exactly allow-scripts", FRAME_SANDBOX, "allow-scripts");
	const html = frameMarkup("<p>hi</p>", FRAME_DEFAULT_THEME, labels);
	r.check("the iframe carries that exact sandbox attribute", /<iframe[^>]* sandbox="allow-scripts"[ >]/.test(html), true);
	r.check("no forbidden sandbox token anywhere in the markup",
		["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-forms", "allow-modals", "allow-downloads"].filter(t => html.includes(t)), []);
	r.check("content goes by srcdoc, never a src URL", [/ srcdoc="/.test(html), /<iframe[^>]* src=/.test(html)], [true, false]);

	// --- CSP -----------------------------------------------------------
	const EXPECTED_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
	r.check("CSP is exactly the specified one", FRAME_CSP, EXPECTED_CSP);
	const doc = buildSrcdoc("<script>alert(1)</script>");
	r.check("a normal page builds", doc.ok, true);
	const sd = doc.srcdoc;
	const iCsp = sd.indexOf('<meta http-equiv="Content-Security-Policy" content="' + EXPECTED_CSP + '">');
	r.check("the CSP meta is present", iCsp >= 0, true);
	r.check("the CSP comes BEFORE the author's page (and the first script)", iCsp >= 0 && iCsp < sd.indexOf("<script>alert(1)"), true);
	r.check("the neutral <base target=_self> is present", sd.includes('<base target="_self">'), true);
	r.check("no network in the CSP: connect-src none, no http(s) source", [FRAME_CSP.includes("connect-src 'none'"), /https?:/.test(FRAME_CSP)], [true, false]);

	// --- height script after the author's page -------------------------
	const iAuteur = sd.indexOf("alert(1)");
	const iHauteur = sd.indexOf('type:"nq-height"');
	r.check("the height script comes AFTER the author's script", iAuteur >= 0 && iHauteur > iAuteur, true);
	r.check("the height script reports to the parent with the bounded message", sd.includes("parent.postMessage({type:"), true);

	// --- size ----------------------------------------------------------
	const juste = "x".repeat(FRAME_MAX_BYTES);
	r.check("exactly 200 KB is accepted", buildSrcdoc(juste).ok, true);
	const trop = buildSrcdoc("x".repeat(FRAME_MAX_BYTES + 1));
	r.check("200 KB + 1 byte is refused", [trop.ok, trop.reason], [false, "tooLarge"]);
	// Size is in UTF-8 BYTES, not characters: 70000 x 3-byte characters is 210 KB.
	r.check("size counts UTF-8 bytes", buildSrcdoc("€".repeat(70000)).reason, "tooLarge");
	r.check("an empty or non-string page is refused", [buildSrcdoc("  ").reason, buildSrcdoc(42).reason, buildSrcdoc(null).reason], ["empty", "empty", "empty"]);
	r.check("a too large page shows the message, not a frame", frameMarkup("x".repeat(FRAME_MAX_BYTES + 1), FRAME_DEFAULT_THEME, labels).includes("<iframe"), false);

	// --- theme ---------------------------------------------------------
	const hostile = buildSrcdoc("<p>a</p>", { ...FRAME_DEFAULT_THEME, accent: "red;}</style><script>x()</script>", font: "a</style>" });
	r.check("a hostile theme value cannot close the style block", [hostile.srcdoc.includes("<script>x()"), hostile.srcdoc.includes("red;}")], [false, false]);
	r.check("theme variables are exposed to the page", ["--nq-bg", "--nq-fg", "--nq-accent", "--nq-font"].filter(v => !sd.includes(v)), []);

	// --- height message filter ----------------------------------------
	const ok = { type: "nq-height", h: 300 };
	r.check("a message from the frame with a valid height is accepted", acceptHeight(ok, true), 300);
	r.check("a message NOT from the frame's window is ignored", acceptHeight(ok, false), null);
	r.check("another type is ignored", acceptHeight({ type: "other", h: 300 }, true), null);
	r.check("a non-numeric or non-finite height is ignored",
		[acceptHeight({ type: "nq-height", h: "300" }, true), acceptHeight({ type: "nq-height", h: NaN }, true), acceptHeight({ type: "nq-height", h: Infinity }, true), acceptHeight({ type: "nq-height" }, true)], [null, null, null, null]);
	r.check("non-object payloads are ignored", [acceptHeight("nq-height", true), acceptHeight(null, true), acceptHeight([1], true), acceptHeight(300, true)], [null, null, null, null]);
	r.check("the height is bounded to [40, 4000]", [acceptHeight({ type: "nq-height", h: 1 }, true), acceptHeight({ type: "nq-height", h: 99999 }, true), acceptHeight({ type: "nq-height", h: -5 }, true)], [FRAME_MIN_HEIGHT, FRAME_MAX_HEIGHT, FRAME_MIN_HEIGHT]);
	r.check("bounds are 40 and 4000", [FRAME_MIN_HEIGHT, FRAME_MAX_HEIGHT], [40, 4000]);

	// --- markup escaping -----------------------------------------------
	const piege = frameMarkup('"><img src=x onerror=alert(1)>', FRAME_DEFAULT_THEME, labels);
	r.check("the page is attribute-escaped in srcdoc and in the code view (no raw tag escapes)", /<img src=x/.test(piege), false);

	r.check("a double quote in the page cannot end the srcdoc attribute", /<iframe[^>]* srcdoc="[^"]*" style="height:120px">[<][/]iframe>/.test(frameMarkup(String.fromCharCode(34) + " onload=" + String.fromCharCode(34) + "x", FRAME_DEFAULT_THEME, labels)), true);
	// --- Explain: fenced blocks ----------------------------------------
	const seg = splitHtmlBlocks("Intro\n```html\n<p>a</p>\n```\nOutro\n```python\nprint(1)\n```\n");
	r.check("an html fence becomes a frame segment, the python fence stays text",
		seg.map(s => s.kind), ["text", "html", "text"]);
	r.check("the html segment holds the page", seg[1].value, "<p>a</p>\n");
	r.check("a block still being written is pending", splitHtmlBlocks("A\n```html\n<p>half").map(s => s.kind), ["text", "pending"]);
	r.check("two blocks", splitHtmlBlocks("```html\n<i>1</i>\n```\nx\n```html\n<i>2</i>\n```").filter(s => s.kind === "html").length, 2);
	r.check("no fence: text only", splitHtmlBlocks("plain").map(s => s.kind), ["text"]);

	// --- reading field -------------------------------------------------
	r.check("html of a raw block item", htmlDeLecture({ role: "read", html: "<p>x</p>" }), "<p>x</p>");
	r.check("html of an editor draft (_extraFields)", htmlDeLecture({ _extraFields: { html: "<p>y</p>" } }), "<p>y</p>");
	r.check("absent, blank or non-string html is no page", [htmlDeLecture({}), htmlDeLecture({ html: "  " }), htmlDeLecture({ html: 3 }), htmlDeLecture(null)], [null, null, null, null]);
	// --- hosts that publish the page (Android: HtmlFrameRoute.kt) -------
	const route = frameMarkup("<p>hi</p>", FRAME_DEFAULT_THEME, labels, true);
	r.check("by route: no srcdoc and no src on the iframe (the document waits in data-nq-doc)",
		[/ srcdoc=/.test(route), /<iframe[^>]* src=/.test(route), /<iframe[^>]* data-nq-doc="/.test(route)], [false, false, true]);
	r.check("by route: the sandbox is still exactly allow-scripts, no forbidden token",
		[/<iframe[^>]* sandbox="allow-scripts"[ >]/.test(route), ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-forms", "allow-modals", "allow-downloads"].filter(t => route.includes(t))], [true, []]);
	r.check("by route: the document in data-nq-doc is the same srcdoc (CSP first), attribute-escaped",
		[route.includes("data-nq-doc=\"" + escapeAttr(buildSrcdoc("<p>hi</p>").srcdoc) + "\""), route.includes("&lt;meta http-equiv=&quot;Content-Security-Policy&quot;")], [true, true]);
	r.check("by route: a double quote in the page cannot end the attribute",
		/<iframe[^>]* data-nq-doc="[^"]*" style="height:120px">[<][/]iframe>/.test(frameMarkup(String.fromCharCode(34) + " onload=" + String.fromCharCode(34) + "x", FRAME_DEFAULT_THEME, labels, true)), true);
	r.check("by route: a too large page still shows the message, not a frame", frameMarkup("x".repeat(FRAME_MAX_BYTES + 1), FRAME_DEFAULT_THEME, labels, true).includes("<iframe"), false);
	const GOOD = "/__frame/" + "0123456789abcdef".repeat(2);
	r.check("a route path from the host is accepted only in its exact shape", acceptFrameUrl(GOOD), GOOD);
	r.check("anything else is never set as an iframe src",
		[
			"https://evil.example/__frame/" + "a".repeat(32), "//evil.example/x", "javascript:alert(1)", "data:text/html,x", GOOD + "?x=1", GOOD + "#x",
			"/__frame/" + "A".repeat(32), "/__frame/" + "a".repeat(31), "/__frame/" + "a".repeat(33), "/assets/web/index.html", "/__frame/../" + "a".repeat(32), "", null, undefined, 42, {},
		].map(v => acceptFrameUrl(v)),
		new Array(16).fill(null));
	r.done();
});
