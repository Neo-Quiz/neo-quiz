import { ecrireReglage, lireReglage } from "./folder";

/* This device's identifier, generated once and kept in the app settings under
   `deviceId`. It names the device's own review log file
   (`.neo-quiz/journal/<deviceId>.jsonl`): two devices that sync the same
   folder must never write the same file. Resolved at startup, BEFORE the
   host roots are built (`main.ts`). A value that is not a UUID (hand-edited,
   truncated) is replaced: it ends up in a file name. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deviceId(): Promise<string> {
	const stored = await lireReglage<unknown>("deviceId");
	if (typeof stored === "string" && UUID.test(stored)) return stored;
	const fresh = crypto.randomUUID();
	await ecrireReglage("deviceId", fresh);
	return fresh;
}
