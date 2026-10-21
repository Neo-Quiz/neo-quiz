import { ajouter } from "../dom";
import { t } from "../i18n";
import type { EngineCtx } from "../types/engine-ctx";

/* ══════════════════════════════════════════════════════════
   THE WARNING BEFORE A PYTHON RUN. Python runs natively on the PC, with
   access to its files and the Internet: the modal is shown before EVERY run
   of every quiz, unless the user ticked « Don't show again for this quiz » for
   that exact code. The key is `<note path>#<sha256 of the code>`, so a quiz
   whose code changed by one character asks again (a shared quiz may swap the
   code under a dismissed warning). A host without modals never runs unwarned.
══════════════════════════════════════════════════════════ */

/** `<sourcePath>#<sha256 hex of the code>`, through Web Crypto (no Node). */
export async function cleAvertissement(sourcePath: string, code: string): Promise<string> {
	const octets = new TextEncoder().encode(code);
	const condense = new Uint8Array(await crypto.subtle.digest("SHA-256", octets));
	let hex = "";
	for (const b of condense) hex += b.toString(16).padStart(2, "0");
	return `${sourcePath}#${hex}`;
}

/** Resolves `true` when the run may go ahead: already dismissed for this key,
    or the user pressed Run. Escape, the backdrop, the cross and Cancel resolve
    `false`, as does a host without modals or without a warning store. */
export async function demanderAvertissement(ctx: EngineCtx, cle: string): Promise<boolean> {
	const store = ctx.host.code?.avertissement;
	if (!store) return false;
	try {
		if (await store.masque(cle)) return true;
	} catch { /* unreadable store: ask */ }
	const modals = ctx.host.modals;
	if (!modals) return false;
	return new Promise<boolean>(resolve => {
		let repondu = false;
		const repondre = (ok: boolean): void => { if (!repondu) { repondu = true; resolve(ok); } };
		modals.open({
			className: "qbd-code-warning-modal",
			title: t("engine.code.warningTitle"),
			onOpen: m => {
				const c = m.contentEl;
				ajouter(c, "p", "qbd-code-warning-text", t("engine.code.warningText"));
				const ligne = ajouter(c, "label", "qbd-share-pick-row");
				const box = ajouter(ligne, "input", "qbd-share-pick-box");
				box.type = "checkbox";
				ajouter(ligne, "span", "qbd-share-pick-title", t("engine.code.warningDontShow"));
				const boutons = ajouter(c, "div", "qb-confirm-buttons");
				const annuler = ajouter(boutons, "button", "qb-btn", t("engine.code.warningCancel"));
				annuler.type = "button";
				annuler.addEventListener("click", () => m.close());
				const lancer = ajouter(boutons, "button", "qb-btn qb-btn-accent", t("engine.code.warningRun"));
				lancer.type = "button";
				lancer.addEventListener("click", () => {
					if (box.checked) void store.masquer(cle).catch(() => undefined);
					repondre(true);
					m.close();
				});
				lancer.focus();
			},
			onClose: () => repondre(false),
		});
	});
}
