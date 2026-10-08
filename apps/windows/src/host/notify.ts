import { currentHost } from "../../../../src/host/current";
import { pont } from "./pont";

/** A native desktop notification when the bridge has one, else an in-app notice. */
export async function notifyPc(title: string, body: string): Promise<boolean> {
	try { if (await pont().notification?.afficher(title, body)) return true; } catch { /* fall through */ }
	currentHost().ui.notice(title + (body ? ": " + body : ""));
	return false;
}
