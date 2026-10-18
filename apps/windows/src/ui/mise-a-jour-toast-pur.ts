/* ══════════════════════════════════════════════════════════
   THE UPDATE TOAST: the pure decision (`ui/mise-a-jour-toast.ts` draws it)

   When does the toast show, and which button does it carry? No DOM, no
   bridge: `check:updater` tests it as is. Updates cannot be switched off
   (2026-09-17), so there is no "disabled" case to handle here.
══════════════════════════════════════════════════════════ */
import type { EtatMiseAJour } from "../../electron/pont";

export type ToastMaj = { action: "install" | "download"; version: string };

/**
 * `prete` (downloaded): the toast offers "Restart and update". `disponible`
 * on a METERED connection (nothing downloads until a click): it offers
 * "Download". Anything else, including a download in progress, shows nothing.
 * `fermee` is the version the user dismissed (in memory, until the next
 * launch): it stays closed for that version and comes back for the next one.
 */
export function decisionToast(etat: EtatMiseAJour, fermee: string | null): ToastMaj | null {
	const version = etat.version;
	if (!version || version === fermee) return null;
	if (etat.phase === "prete") return { action: "install", version };
	if (etat.phase === "disponible" && etat.limitee === true) return { action: "download", version };
	return null;
}
