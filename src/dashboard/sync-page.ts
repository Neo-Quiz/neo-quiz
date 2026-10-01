/* ══════════════════════════════════════════════════════════
   THE SYNC PAGE (shared by the Windows app and the Android app)

   Task 6 of the Android v1 plan, redesigned on 2026-10-01 to be as simple as
   possible. The page is the same on both platforms and knows nothing of
   Syncthing: it receives functions from its host (`SyncPageDeps`) and, on a
   device that has a camera, a scanner. `src/` imports nothing from `apps/`,
   so the shape of the state is `sync-etat.ts`, which the Windows bridge also
   imports.

   What it shows, top to bottom: a status line; this device's ID with its QR
   code and ONE share button; ONE primary action, "Add a device" (type or scan
   the other device's ID); the requests of devices that added this one, each
   with Accept / Ignore; the paired devices. Pairing needs the ID on ONE side
   only: the other side just accepts. Accepting goes through the same
   `appairer` as typing an ID, which the host confirms in a NATIVE dialog the
   page cannot answer: nothing is paired without it, and nothing is accepted
   on its own.

   The page never sees a path, a port or a key, only device ids and names. A
   name is the remote's: it is only ever put in `textContent`.
══════════════════════════════════════════════════════════ */

import QRCode from "qrcode";
import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { EtatSync } from "./sync-etat";

export type CanalPartage = "courriel" | "discord" | "systeme";

export interface SyncPageDeps {
	etat(): Promise<EtatSync>;
	appairer(deviceId: string): Promise<"ok" | "invalide" | "indisponible" | "annule">;
	oublier(deviceId: string): Promise<void>;
	/** Ignore on a pairing request. */
	ignorer(deviceId: string): Promise<void>;
	surEtat(rappel: (etat: EtatSync) => void): () => void;
	/** Copies text to the clipboard through the host; `false` if it could not. */
	copier(texte: string): Promise<boolean>;
	/** Shares this device's ID through a channel the host builds itself;
	    `false` if it could not. A phone uses `systeme` (the share sheet), a PC
	    offers `courriel` and `discord` in a menu. */
	partager(canal: CanalPartage): Promise<boolean>;
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

export type TonStatut = "ok" | "neutre" | "erreur";

/** The one line that says how sync is doing. Order matters: a failure beats a
    transfer, a transfer beats "offline" (something is moving), and with no
    device there is nothing to be offline from. */
export function statutGlobal(e: EtatSync): { texte: string; ton: TonStatut } {
	if (!e.actif) return { texte: t("settings.sync.statusOff"), ton: "erreur" };
	if (e.dossier.etat === "error") return { texte: t("settings.sync.statusError"), ton: "erreur" };
	if (e.appareils.length === 0) return { texte: t("settings.sync.statusNone"), ton: "neutre" };
	if (e.dossier.etat === "syncing") {
		return {
			texte: e.dossier.pourcentage === null
				? t("settings.sync.statusSyncing")
				: t("settings.sync.statusSyncingPercent", { percent: e.dossier.pourcentage }),
			ton: "ok",
		};
	}
	if (!e.appareils.some(a => a.connecte)) return { texte: t("settings.sync.statusOffline"), ton: "neutre" };
	return { texte: t("settings.sync.statusUpToDate"), ton: "ok" };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ilYA(ms: number, maintenant: number = Date.now()): string {
	const min = Math.max(0, Math.floor((maintenant - ms) / 60_000));
	if (min < 1) return t("settings.sync.whenNow");
	if (min < 60) return t("settings.sync.whenMinutes", { n: min });
	if (min < 60 * 24) return t("settings.sync.whenHours", { n: Math.floor(min / 60) });
	return t("settings.sync.whenDays", { n: Math.floor(min / (60 * 24)) });
}

function icone(parent: HTMLElement, nom: string, classe: string): HTMLElement {
	const s = ajouter(parent, "span", classe);
	currentHost().ui.setIcon(s, nom);
	s.setAttribute("aria-hidden", "true");
	return s;
}

function bouton(parent: HTMLElement, nomIcone: string, texte: string, classe = "qbd-sync-bouton"): HTMLButtonElement {
	const b = ajouter(parent, "button", classe);
	b.type = "button";
	icone(b, nomIcone, "qbd-sync-bouton-icone");
	ajouter(b, "span", undefined, texte);
	return b;
}

function titre(parent: HTMLElement, texte: string): HTMLHeadingElement {
	return ajouter(parent, "h3", "qbd-sync-titre", texte);
}

interface EntreeMenu {
	icone: string;
	texte: string;
	agir(): void;
}

/** Mounts the page into `parent`; the returned function unmounts it. */
export function monterSync(parent: HTMLElement, deps: SyncPageDeps): () => void {
	const mobile = currentHost().platform.isMobile;
	const racine = ajouter(parent, "div", "qbd-sync");

	/* ── Status ── */
	const entete = ajouter(racine, "section", "qbd-sync-section");
	const statut = ajouter(entete, "p", "qbd-sync-statut");
	statut.setAttribute("role", "status");
	statut.setAttribute("aria-live", "polite");
	ajouter(statut, "span", "qbd-sync-point").setAttribute("aria-hidden", "true");
	const statutTexte = ajouter(statut, "span", undefined, t("settings.sync.starting"));
	ajouter(entete, "p", "qbd-sync-aide", t("settings.sync.hint"));

	/* ── This device: its ID, its QR code and ONE share button, nothing else ── */
	const moi = ajouter(racine, "section", "qbd-sync-section");
	moi.hidden = true;
	const moiTitre = titre(moi, t("settings.sync.idTitleBare"));
	const moiCorps = ajouter(moi, "div", "qbd-sync-moi");
	const qr = ajouter(moiCorps, "img", "qbd-sync-qr");
	qr.alt = t("settings.sync.qrAlt");
	qr.hidden = true;
	const moiTexte = ajouter(moiCorps, "div", "qbd-sync-moi-texte");
	const idTexte = ajouter(moiTexte, "code", "qbd-sync-id");
	const zonePartage = ajouter(moiTexte, "div", "qbd-sync-menu-zone");
	const partagerBtn = bouton(zonePartage, "share-2", t("settings.sync.share"));

	/* ── The one primary action ── */
	const ajout = ajouter(racine, "section", "qbd-sync-section");
	const ajouterBouton = bouton(ajout, "plus", t("settings.sync.addButton"), "qbd-sync-bouton qbd-sync-bouton-principal");
	ajouterBouton.setAttribute("aria-expanded", "false");
	const panneau = ajouter(ajout, "div", "qbd-sync-panneau");
	panneau.hidden = true;
	const etapes = ajouter(panneau, "ol", "qbd-sync-etapes");
	for (const cle of ["settings.sync.addStep1", "settings.sync.addStep2", "settings.sync.addStep3"] as const) ajouter(etapes, "li", undefined, t(cle));
	const ligneAjout = ajouter(panneau, "div", "qbd-sync-ligne-champ");
	const champ = ajouter(ligneAjout, "input", "qbd-sync-champ");
	champ.type = "text";
	champ.spellcheck = false;
	champ.autocomplete = "off";
	champ.placeholder = t("settings.sync.addPlaceholder");
	champ.setAttribute("aria-label", t("settings.sync.addPlaceholder"));
	const validerBtn = bouton(ligneAjout, "check", t("settings.sync.add"));
	const scannerBtn = deps.scanner ? bouton(ligneAjout, "scan-line", t("settings.sync.scan")) : null;
	const message = ajouter(panneau, "p", "qbd-sync-message");
	message.setAttribute("role", "status");
	message.setAttribute("aria-live", "polite");

	/* ── Requests from devices that added this one ── */
	const demandesSection = ajouter(racine, "section", "qbd-sync-section");
	demandesSection.hidden = true;
	titre(demandesSection, t("settings.sync.requests"));
	const demandesCarte = ajouter(demandesSection, "div", "qbd-sync-carte");

	/* ── Paired devices ── */
	const appareilsSection = ajouter(racine, "section", "qbd-sync-section");
	titre(appareilsSection, t("settings.sync.devices"));
	const appareilsCarte = ajouter(appareilsSection, "div", "qbd-sync-carte");

	let demonte = false;
	let idCourant: string | null = null;
	let dernierEtat: EtatSync | null = null;
	const ignorees = new Set<string>();
	let fermerMenu: () => void = () => undefined;

	/* ── A small menu under its button, closed by a click elsewhere or Escape ── */
	function menu(ancre: HTMLElement, zone: HTMLElement, entrees: EntreeMenu[]): void {
		const etaitOuvert = ancre.getAttribute("aria-expanded") === "true";
		fermerMenu();
		if (etaitOuvert) return;
		const m = ajouter(zone, "div", "qbd-sync-menu");
		m.setAttribute("role", "menu");
		ancre.setAttribute("aria-expanded", "true");
		for (const e of entrees) {
			const b = bouton(m, e.icone, e.texte, "qbd-sync-menu-item");
			b.setAttribute("role", "menuitem");
			b.addEventListener("click", () => { fermerMenu(); e.agir(); });
		}
		const dehors = (ev: Event): void => { if (!zone.contains(ev.target as Node)) fermerMenu(); };
		const echap = (ev: KeyboardEvent): void => { if (ev.key === "Escape") { fermerMenu(); ancre.focus(); } };
		document.addEventListener("pointerdown", dehors, true);
		document.addEventListener("keydown", echap);
		fermerMenu = () => {
			document.removeEventListener("pointerdown", dehors, true);
			document.removeEventListener("keydown", echap);
			m.remove();
			ancre.setAttribute("aria-expanded", "false");
			fermerMenu = () => undefined;
		};
		m.querySelector<HTMLElement>(".qbd-sync-menu-item")?.focus();
	}

	function dire(texte: string, erreur: boolean): void {
		message.textContent = texte;
		message.classList.toggle("qbd-sync-message-erreur", erreur);
	}

	async function rafraichir(): Promise<void> {
		try { const e = await deps.etat(); if (!demonte) peindre(e); } catch { /* the push will follow */ }
	}

	async function soumettre(brut: string): Promise<void> {
		const code = normaliserCode(brut);
		if (!code) return;
		validerBtn.disabled = true;
		try {
			const res = await deps.appairer(code);
			if (demonte) return;
			if (res === "ok") {
				champ.value = "";
				dire(t("settings.sync.added"), false);
			} else if (res === "annule") {
				dire("", false); // the owner declined the native dialog: nothing to report
			} else {
				dire(t(res === "invalide" ? "settings.sync.invalid" : "settings.sync.unavailable"), true);
			}
		} catch {
			if (!demonte) dire(t("settings.sync.unavailable"), true);
		} finally {
			validerBtn.disabled = false;
		}
		await rafraichir();
	}

	async function partagerId(canal: CanalPartage): Promise<void> {
		let ok = false;
		try { ok = await deps.partager(canal); } catch { ok = false; }
		if (demonte) return;
		if (!ok) currentHost().ui.notice(t("settings.sync.shareFailed"));
		else if (canal === "discord") currentHost().ui.notice(t("settings.sync.copiedDiscord"), 6000);
	}

	function peindreDemandes(e: EtatSync): void {
		/* An ignored id that is no longer pending is forgotten: if it asks again
		   later, it must show again. */
		for (const id of [...ignorees]) if (!e.demandes.some(d => d.id === id)) ignorees.delete(id);
		const visibles = e.demandes.filter(d => !ignorees.has(d.id));
		demandesSection.hidden = visibles.length === 0;
		demandesCarte.replaceChildren();
		for (const d of visibles) {
			const l = ajouter(demandesCarte, "div", "qbd-sync-ligne qbd-sync-demande");
			ajouter(l, "span", "qbd-sync-demande-texte", t("settings.sync.requestText", { name: d.nom }));
			const actions = ajouter(l, "div", "qbd-sync-actions");
			const ignorer = bouton(actions, "x", t("settings.sync.ignore"));
			const accepter = bouton(actions, "check", t("settings.sync.accept"), "qbd-sync-bouton qbd-sync-bouton-principal");
			ignorer.addEventListener("click", () => {
				ignorees.add(d.id);
				l.remove();
				if (!demandesCarte.firstChild) demandesSection.hidden = true;
				void deps.ignorer(d.id).catch(() => undefined);
			});
			accepter.addEventListener("click", () => {
				accepter.disabled = ignorer.disabled = true;
				void deps.appairer(d.id)
					.then(res => {
						if (demonte) return;
						if (res === "invalide" || res === "indisponible") currentHost().ui.notice(t(res === "invalide" ? "settings.sync.invalid" : "settings.sync.unavailable"));
					})
					.catch(() => { if (!demonte) currentHost().ui.notice(t("settings.sync.unavailable")); })
					.then(() => rafraichir());
			});
		}
		if (visibles.length > 0 && e.demandesPlus > 0) {
			ajouter(ajouter(demandesCarte, "div", "qbd-sync-ligne"), "span", "qbd-sync-vide", t("settings.sync.requestsMore", { n: e.demandesPlus }));
		}
	}

	function peindreAppareils(e: EtatSync): void {
		fermerMenu();
		appareilsCarte.replaceChildren();
		if (e.appareils.length === 0) {
			ajouter(ajouter(appareilsCarte, "div", "qbd-sync-ligne"), "span", "qbd-sync-vide", t("settings.sync.noDevices"));
			return;
		}
		for (const a of e.appareils) {
			const l = ajouter(appareilsCarte, "div", "qbd-sync-ligne");
			const texte = ajouter(l, "div", "qbd-sync-id-bloc");
			ajouter(texte, "span", "qbd-sync-nom", a.nom);
			const sous = a.connecte
				? t("settings.sync.connected")
				: a.vuLe === null ? t("settings.sync.offline") : t("settings.sync.offlineSeen", { when: ilYA(a.vuLe) });
			ajouter(texte, "span", a.connecte ? "qbd-sync-sous qbd-sync-sous-ok" : "qbd-sync-sous", sous);
			const zone = ajouter(l, "div", "qbd-sync-menu-zone");
			const plus = ajouter(zone, "button", "qbd-sync-plus");
			plus.type = "button";
			currentHost().ui.setIcon(plus, "ellipsis");
			plus.setAttribute("aria-label", t("settings.sync.moreLabel", { name: a.nom }));
			plus.setAttribute("aria-haspopup", "menu");
			plus.setAttribute("aria-expanded", "false");
			plus.addEventListener("click", () => menu(plus, zone, [{
				icone: "trash-2",
				texte: t("settings.sync.remove"),
				agir: () => {
					void deps.oublier(a.id)
						.catch(() => undefined)
						.then(() => rafraichir());
				},
			}]));
		}
	}

	function peindre(e: EtatSync): void {
		if (demonte) return;
		dernierEtat = e;
		const s = statutGlobal(e);
		statutTexte.textContent = s.texte;
		statut.dataset.ton = s.ton;

		if (!e.actif || !e.appareil) {
			moi.hidden = true;
			idCourant = null;
		} else {
			moi.hidden = false;
			moiTitre.textContent = e.nom ? t("settings.sync.idTitle", { name: e.nom }) : t("settings.sync.idTitleBare");
			if (e.appareil !== idCourant) {
				idCourant = e.appareil;
				idTexte.textContent = e.appareil;
				void QRCode.toDataURL(e.appareil, { margin: 2, width: 176, errorCorrectionLevel: "M" })
					.then(url => { if (!demonte && idCourant === e.appareil) { qr.src = url; qr.hidden = false; } })
					.catch(() => { qr.hidden = true; });
			}
		}
		ajouterBouton.disabled = !e.actif;
		validerBtn.disabled = !e.actif;
		peindreDemandes(e);
		peindreAppareils(e);
	}

	partagerBtn.addEventListener("click", () => {
		if (!idCourant) return;
		const id = idCourant;
		if (mobile) { void partagerId("systeme"); return; }
		menu(partagerBtn, zonePartage, [
			{
				icone: "copy",
				texte: t("settings.sync.copy"),
				agir: () => { void deps.copier(id).then(ok => { if (!demonte) currentHost().ui.notice(t(ok ? "settings.sync.copied" : "settings.sync.shareFailed")); }); },
			},
			{ icone: "mail", texte: t("settings.sync.shareMail"), agir: () => { void partagerId("courriel"); } },
			{ icone: "message-circle", texte: t("settings.sync.shareDiscord"), agir: () => { void partagerId("discord"); } },
		]);
	});
	partagerBtn.setAttribute("aria-haspopup", mobile ? "false" : "menu");
	ajouterBouton.addEventListener("click", () => {
		panneau.hidden = !panneau.hidden;
		ajouterBouton.setAttribute("aria-expanded", String(!panneau.hidden));
		if (!panneau.hidden) champ.focus();
	});
	validerBtn.addEventListener("click", () => { void soumettre(champ.value); });
	champ.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); void soumettre(champ.value); } });
	scannerBtn?.addEventListener("click", () => {
		void deps.scanner!().then(code => {
			if (code && !demonte) { champ.value = code; void soumettre(code); }
		}).catch(() => undefined);
	});

	/* Last-seen times age without any push: repaint the list now and then. */
	const horloge = setInterval(() => { if (dernierEtat && !demonte) peindreAppareils(dernierEtat); }, 60_000);

	/* Subscribe BEFORE the first read, and let a pushed state win over a read
	   that was already in flight: it is the more recent. */
	let pousse = false;
	const desabonner = deps.surEtat(e => { pousse = true; peindre(e); });
	void deps.etat().then(e => { if (!pousse) peindre(e); }).catch(() => {
		if (!demonte) peindre({ actif: false, appareil: null, nom: "", appareils: [], demandes: [], demandesPlus: 0, dossier: { etat: "absent", pourcentage: null } });
	});

	return () => {
		demonte = true;
		clearInterval(horloge);
		fermerMenu();
		desabonner();
		racine.remove();
	};
}
