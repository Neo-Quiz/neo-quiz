/* ══════════════════════════════════════════════════════════
   "TRUST THIS FOLDER?" — THE APP'S OWN QUESTION (2026-10-11)

   Asked when a chat first sends to a folder, as Claude Code asks when it
   opens one, in Neo Quiz's words: the full path of the folder, whether these are the user's own courses, and what the AI may do.
   Cancel and a neutral Trust: the delete modal's red and its long text were
   judged badly styled and too large. The answer is recorded by the main
   process (`apps/windows/src/host/process.ts`, `confiance(dossier, true)`).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";

/** Opens the question; `callback(true)` on Trust, called when the modal has closed. */
export function openTrustModal(folder: string, callback: (trusted: boolean) => void): void {
	let trusted = false;
	requireHost("modals").open({
		className: "qb-confirm-modal qb-trust-modal",
		onOpen: (m) => {
			const c = m.contentEl;
			const head = ajouter(c, "div", "qb-confirm-head");
			currentHost().ui.setIcon(ajouter(head, "div", "qb-confirm-icon"), "folder-lock");
			const text = ajouter(head, "div", "qb-confirm-text");
			ajouter(text, "h2", "qb-confirm-title", t("app.aiTrust.title"));
			// The FULL path of the folder, with Windows separators, wrapped rather than cut.
			const chip = ajouter(text, "div", "qb-trust-folder");
			currentHost().ui.setIcon(ajouter(chip, "span", "qb-trust-folder-icon"), "folder");
			ajouter(chip, "span", "qb-trust-folder-name", folder.replace(/\//g, "\\"));
			ajouter(text, "p", "qb-confirm-message", t("app.aiTrust.short"));
			ajouter(text, "p", "qb-confirm-message qb-trust-able", t("app.aiTrust.able"));

			const buttons = ajouter(c, "div", "qb-confirm-buttons");
			ajouter(buttons, "button", "qb-btn", t("app.aiTrust.cancel")).addEventListener("click", () => { trusted = false; m.close(); });
			const ok = ajouter(buttons, "button", "qb-btn", t("app.aiTrust.trust"));
			ok.addEventListener("click", () => { trusted = true; m.close(); });
			ok.focus();
		},
		onClose: () => callback(trusted),
	});
}
