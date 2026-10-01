/* ══════════════════════════════════════════════════════════
   THE SYNC PAGE (shared by the Windows app and the Android app)

   Task 6 of the Android v1 plan. Keeps the quiz folder identical on the
   owner's devices through the embedded Syncthing. The page is the same on
   both platforms and knows nothing of Syncthing: it receives four functions
   from its host (`SyncPageDeps`) and, on a device that has a camera, a fifth
   to scan a code. `src/` imports nothing from `apps/`, so the shape of the
   state is `sync-etat.ts`, which the Windows bridge also imports.

   Pairing is manual and symmetric: this device shows its code (text, copy
   button and QR) and takes the other's. The page never sees a path, a port
   or a key, only device ids and names.
══════════════════════════════════════════════════════════ */

import QRCode from "qrcode";
import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { EtatSync } from "./sync-etat";

export interface SyncPageDeps {
	etat(): Promise<EtatSync>;
	appairer(deviceId: string): Promise<"ok" | "invalide" | "indisponible">;
	oublier(deviceId: string): Promise<void>;
	surEtat(rappel: (etat: EtatSync) => void): () => void;
	/** Copies text to the clipboard through the host; `false` if it could not. */
	copier(texte: string): Promise<boolean>;
	/** Only where there is a camera: resolves with the scanned device code, or
	    `null` if the user gave up. */
	scanner?(): Promise<string | null>;
}

/** What the user typed or pasted → the canonical `AAAAAAA-…` form: spaces and
    dashes dropped, upper case, regrouped by 7 when it is 56 characters long.
    Anything else is left for the host to refuse as invalid. */
export function normaliserCode(brut: string): string {
	const nu = brut.replace(/[\s-]+/g, "").toUpperCase();
	return nu.length === 56 ? (nu.match(/.{7}/g) ?? []).join("-") : brut.trim().toUpperCase();
}

export function libelleDossier(e: EtatSync["dossier"]): string {
	switch (e.etat) {
		case "idle": return t("settings.sync.folderIdle");
		case "syncing": return e.pourcentage === null
			? t("settings.sync.folderSyncing")
			: t("settings.sync.folderSyncingPercent", { percent: e.pourcentage });
		case "error": return t("settings.sync.folderError");
		default: return t("settings.sync.folderAbsent");
	}
}

function bouton(parent: HTMLElement, icone: string, texte: string): HTMLButtonElement {
	const b = ajouter(parent, "button", "qbd-sync-bouton");
	b.type = "button";
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-sync-bouton-icone"), icone);
	ajouter(b, "span", undefined, texte);
	return b;
}

function section(parent: HTMLElement, titre: string, aide?: string): HTMLElement {
	const s = ajouter(parent, "section", "qbd-sync-section");
	ajouter(s, "h3", "qbd-sync-titre", titre);
	if (aide) ajouter(s, "p", "qbd-sync-aide", aide);
	return ajouter(s, "div", "qbd-sync-carte");
}

/** Mounts the page into `parent`; the returned function unmounts it. */
export function monterSync(parent: HTMLElement, deps: SyncPageDeps): () => void {
	const racine = ajouter(parent, "div", "qbd-sync");
	ajouter(racine, "p", "qbd-sync-aide", t("settings.sync.hint"));

	/* ── This device ── */
	const moi = section(racine, t("settings.sync.thisDevice"), t("settings.sync.thisDeviceHint"));
	const ligneId = ajouter(moi, "div", "qbd-sync-ligne");
	const idBloc = ajouter(ligneId, "div", "qbd-sync-id-bloc");
	ajouter(idBloc, "span", "qbd-sync-etiquette", t("settings.sync.idLabel"));
	const idTexte = ajouter(idBloc, "code", "qbd-sync-id", t("settings.sync.starting"));
	const copier = bouton(ligneId, "copy", t("settings.sync.copy"));
	copier.disabled = true;
	const ligneQr = ajouter(moi, "div", "qbd-sync-ligne qbd-sync-ligne-qr");
	const qr = ajouter(ligneQr, "img", "qbd-sync-qr");
	qr.alt = t("settings.sync.qrAlt");
	qr.hidden = true;

	/* ── Add a device ── */
	const ajout = section(racine, t("settings.sync.addTitle"), t("settings.sync.addHint"));
	const ligneAjout = ajouter(ajout, "div", "qbd-sync-ligne");
	const champ = ajouter(ligneAjout, "input", "qbd-sync-champ");
	champ.type = "text";
	champ.spellcheck = false;
	champ.autocomplete = "off";
	champ.placeholder = t("settings.sync.addPlaceholder");
	champ.setAttribute("aria-label", t("settings.sync.addTitle"));
	const ajouterBtn = bouton(ligneAjout, "plus", t("settings.sync.add"));
	const scannerBtn = deps.scanner ? bouton(ligneAjout, "scan-line", t("settings.sync.scan")) : null;
	const message = ajouter(ajout, "p", "qbd-sync-message");
	message.setAttribute("role", "status");
	message.setAttribute("aria-live", "polite");

	/* ── Paired devices ── */
	const appareilsCarte = section(racine, t("settings.sync.devices"));

	/* ── The folder ── */
	const dossierCarte = section(racine, t("settings.sync.folder"));
	const ligneDossier = ajouter(dossierCarte, "div", "qbd-sync-ligne");
	ajouter(ligneDossier, "span", "qbd-sync-etiquette", "Neo Quiz");
	const dossierEtat = ajouter(ligneDossier, "span", "qbd-sync-etat", t("settings.sync.starting"));

	let demonte = false;
	let idCourant: string | null = null;

	function dire(texte: string, erreur: boolean): void {
		message.textContent = texte;
		message.classList.toggle("qbd-sync-message-erreur", erreur);
	}

	async function soumettre(brut: string): Promise<void> {
		const code = normaliserCode(brut);
		if (!code) return;
		ajouterBtn.disabled = true;
		try {
			const res = await deps.appairer(code);
			if (demonte) return;
			if (res === "ok") {
				champ.value = "";
				dire(t("settings.sync.added"), false);
			} else {
				dire(t(res === "invalide" ? "settings.sync.invalid" : "settings.sync.unavailable"), true);
			}
		} catch {
			if (!demonte) dire(t("settings.sync.unavailable"), true);
		} finally {
			ajouterBtn.disabled = false;
		}
		try { const e = await deps.etat(); if (!demonte) peindre(e); } catch { /* the push will follow */ }
	}

	function peindreAppareils(e: EtatSync): void {
		appareilsCarte.replaceChildren();
		if (e.appareils.length === 0) {
			ajouter(ajouter(appareilsCarte, "div", "qbd-sync-ligne"), "span", "qbd-sync-vide", t("settings.sync.noDevices"));
			return;
		}
		for (const a of e.appareils) {
			const l = ajouter(appareilsCarte, "div", "qbd-sync-ligne");
			const texte = ajouter(l, "div", "qbd-sync-id-bloc");
			ajouter(texte, "span", "qbd-sync-nom", a.nom);
			ajouter(texte, "code", "qbd-sync-id-court", a.id.slice(0, 7));
			const etat = ajouter(l, "span", a.connecte ? "qbd-sync-etat qbd-sync-etat-ok" : "qbd-sync-etat");
			ajouter(etat, "span", "qbd-sync-point").setAttribute("aria-hidden", "true");
			ajouter(etat, "span", undefined, t(a.connecte ? "settings.sync.connected" : "settings.sync.disconnected"));
			const oubli = bouton(l, "trash-2", t("settings.sync.forget"));
			oubli.setAttribute("aria-label", t("settings.sync.forgetLabel", { name: a.nom }));
			oubli.addEventListener("click", () => {
				oubli.disabled = true;
				void deps.oublier(a.id)
					.catch(() => undefined)
					.then(() => deps.etat())
					.then(n => { if (!demonte) peindre(n); })
					.catch(() => undefined);
			});
		}
	}

	function peindre(e: EtatSync): void {
		if (demonte) return;
		if (!e.actif || !e.appareil) {
			idTexte.textContent = t("settings.sync.inactive");
			copier.disabled = true;
			qr.hidden = true;
			idCourant = null;
		} else if (e.appareil !== idCourant) {
			idCourant = e.appareil;
			idTexte.textContent = e.appareil;
			copier.disabled = false;
			void QRCode.toDataURL(e.appareil, { margin: 2, width: 176, errorCorrectionLevel: "M" })
				.then(url => { if (!demonte && idCourant === e.appareil) { qr.src = url; qr.hidden = false; } })
				.catch(() => { qr.hidden = true; });
		}
		ajouterBtn.disabled = !e.actif;
		peindreAppareils(e);
		dossierEtat.textContent = libelleDossier(e.dossier);
		dossierEtat.classList.toggle("qbd-sync-etat-erreur", e.dossier.etat === "error");
	}

	copier.addEventListener("click", () => {
		if (!idCourant) return;
		void deps.copier(idCourant).then(ok => {
			if (!ok || demonte) return;
			const avant = copier.lastElementChild!;
			avant.textContent = t("settings.sync.copied");
			setTimeout(() => { if (!demonte) avant.textContent = t("settings.sync.copy"); }, 1500);
		});
	});
	ajouterBtn.addEventListener("click", () => { void soumettre(champ.value); });
	champ.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); void soumettre(champ.value); } });
	scannerBtn?.addEventListener("click", () => {
		void deps.scanner!().then(code => {
			if (code && !demonte) { champ.value = code; void soumettre(code); }
		}).catch(() => undefined);
	});

	/* Subscribe BEFORE the first read, and let a pushed state win over a read
	   that was already in flight: it is the more recent. */
	let pousse = false;
	const desabonner = deps.surEtat(e => { pousse = true; peindre(e); });
	void deps.etat().then(e => { if (!pousse) peindre(e); }).catch(() => {
		if (!demonte) peindre({ actif: false, appareil: null, appareils: [], dossier: { etat: "absent", pourcentage: null } });
	});

	return () => {
		demonte = true;
		desabonner();
		racine.remove();
	};
}
