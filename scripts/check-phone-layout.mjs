/**
 * Non-regression of the phone / desktop layout split (src/phone-layout.ts).
 * Phone layout = mobile platform AND width < 600 CSS px; a tablet (>= 600) and
 * the Windows app always get the desktop layout.
 *
 *     npm run check:phone-layout
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/phone-layout.ts", ({ isPhoneLayout, PHONE_LAYOUT_QUERY }) => {
	const r = makeReporter("Phone layout");
	r.check("phone portrait", isPhoneLayout(393, true), true);
	r.check("599 px is a phone", isPhoneLayout(599, true), true);
	r.check("600 px is the desktop layout", isPhoneLayout(600, true), false);
	r.check("tablet portrait (720 dp)", isPhoneLayout(720, true), false);
	r.check("tablet landscape (1152 dp)", isPhoneLayout(1152, true), false);
	r.check("Windows never has a phone layout", isPhoneLayout(400, false), false);
	r.check("zero or NaN width is not a phone layout", [isPhoneLayout(NaN, true), isPhoneLayout(Infinity, true)], [false, false]);
	r.check("media query stops below 600", PHONE_LAYOUT_QUERY, "(max-width: 599.98px)");
	r.done();
});
