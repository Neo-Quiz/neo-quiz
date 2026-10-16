import { LOG_PREFIX } from "../../../../src/branding";
import { currentHost } from "../../../../src/host/current";
import { pont } from "./pont";

/** The actions of clickable notifications, by token; the oldest goes past 30 (the main process keeps no more). */
const actions = new Map<string, () => void>();
let ecoute = false;
function ecouter(): void {
	if (ecoute) return;
	const api = pont().notification;
	if (!api?.surClic) return;
	ecoute = true;
	api.surClic(jeton => {
		const action = actions.get(jeton);
		actions.delete(jeton);
		try { action?.(); } catch (e) { console.warn(LOG_PREFIX, "notification action failed:", e); }
	});
}

/** A native desktop notification when the bridge has one, else an in-app notice (which has no click). */
export async function notifyPc(title: string, body: string, onClick?: () => void): Promise<boolean> {
	let jeton: string | undefined;
	if (onClick) {
		ecouter();
		jeton = "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		actions.set(jeton, onClick);
		while (actions.size > 30) actions.delete(actions.keys().next().value as string);
	}
	try { if (await pont().notification?.afficher(title, body, jeton)) return true; } catch { /* fall through */ }
	if (jeton) actions.delete(jeton);
	currentHost().ui.notice(title + (body ? ": " + body : ""));
	return false;
}
