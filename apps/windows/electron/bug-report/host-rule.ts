/* Address rule of the bug report network use (main process): https only, on
   exactly three hosts (the relay, github.com, api.github.com), default port,
   no credentials in the URL. Redirects are never followed (see `device-flow.ts`). */

/** True when `url` may be requested (or shown to the user) for a bug report. */
export function isAllowedHost(url: string, relay: string): boolean {
	let u: URL;
	let r: URL;
	try {
		u = new URL(url);
		r = new URL(relay);
	} catch {
		return false;
	}
	if (r.protocol !== "https:" || u.protocol !== "https:") return false;
	if (u.username !== "" || u.password !== "") return false;
	if (u.port !== "") return false;   // `new URL` drops an explicit :443, so any remaining port is a different one
	if (r.port !== "") return false;
	const h = u.hostname.toLowerCase();
	return h === r.hostname.toLowerCase() || h === "github.com" || h === "api.github.com";
}
