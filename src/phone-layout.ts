/**
 * Phone layout versus desktop layout on the Android app: a decision on the
 * VIEWPORT WIDTH, never on the platform.
 *
 * Android's large-screen rules: a window narrower than 600 dp is a phone
 * (bottom bar, sheets, single column); 600 dp and wider (a tablet, either
 * orientation) gets the desktop layout (left rail, central panel). On Android
 * a CSS pixel is a dp. The platform (`HostPlatform.isMobile`) keeps deciding
 * CAPABILITIES only (no CLI, send-to-PC flow, relay...); a tablet has the same
 * features as a phone and the layout of a PC.
 *
 * The Windows app never has a phone layout, whatever the window width.
 *
 * `npm run check:phone-layout` tests the pure part on its real code.
 */

import { currentHost } from "./host/current";

/** Width in CSS px from which the desktop layout applies (Android "medium" window class). */
export const PHONE_LAYOUT_MAX_WIDTH = 600;

/** Media query that matches exactly while the phone layout applies (width < 600). */
export const PHONE_LAYOUT_QUERY = `(max-width: ${PHONE_LAYOUT_MAX_WIDTH - 0.02}px)`;

/** The pure decision: a mobile-platform window narrower than 600 CSS px. */
export function isPhoneLayout(width: number, isMobilePlatform: boolean): boolean {
	return isMobilePlatform && Number.isFinite(width) && width < PHONE_LAYOUT_MAX_WIDTH;
}

/** The decision for the window as it is right now. Call it at render time, never cache it
 *  in a top-level constant: the page reloads when the answer flips (`main.ts`). */
export function phoneLayoutNow(): boolean {
	return isPhoneLayout(window.innerWidth, currentHost().platform.isMobile);
}
