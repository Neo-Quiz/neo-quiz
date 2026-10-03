/* ══════════════════════════════════════════════════════════
   THE SYNC PAGE (shared by the Windows app and the Android app)

   Task 6 of the Android v1 plan, redesigned on 2026-10-01 to be as simple as
   possible. The page is the same on both platforms and knows nothing of
   Syncthing: it receives functions from its host (`SyncPageDeps`) and, on a
   device that has a camera, a scanner. `src/` imports nothing from `apps/`,
   so the shape of the state is `sync-etat.ts`, which the Windows bridge also
   imports.

   What it shows, top to bottom (redesigned on 2026-10-03 to match Neo
   Calendar's page): a status line and one short sentence; ONE big button,
   "Show my ID", that opens a dialog with the full ID, Copy / Share and its QR
   code; the requests of devices that added this one, each with Accept /
   Ignore; the paired devices, with "Add a device" under the list, which opens
   a dialog to type (or scan) the other device's ID; and a footer that names
   Syncthing with a "Learn more" link. Pairing needs the ID on ONE side only:
   the other side just accepts. Accepting goes through the same
   `appairer` as typing an ID, which the host confirms in a NATIVE dialog the
   page cannot answer: nothing is paired without it, and nothing is accepted
   on its own.

   The page never sees a path, a port or a key, only device ids and names. A
   name is the remote's: it is only ever put in `textContent`.
══════════════════════════════════════════════════════════ */

import QRCode from "qrcode";
import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { currentLang, hourOptions, t } from "../i18n";
import type { Changement, EtatSync } from "./sync-etat";

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
	/** The pairing QR code that changes, where the host has it (Windows): the
	    "Show my ID" dialog shows `texte` and asks again every `periodeMs`,
	    then calls `fermer`. Without it the QR code is the plain ID. */
	qr?: {
		suivant(): Promise<{ texte: string; periodeMs: number } | null>;
		fermer(): Promise<void>;
	};
}

/** What the user typed or pasted → the canonical `AAAAAAA-…` form: spaces and
    dashes dropped, upper case, regrouped by 7 when it is 56 characters long.
    Anything else is left for the host to refuse as invalid. */
export function normaliserCode(brut: string): string {
	/* A scanned pairing QR code (`neo-quiz://pair?device=…&code=…`): only the
	   device id is taken here; the host still validates it. */
	const qr = /^neo-quiz:\/\/pair\?(.*)$/i.exec(brut.trim());
	if (qr) brut = new URLSearchParams(qr[1]).get("device") ?? "";
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

/** Midnight, local time, of the day of `ms`. */
function debutDuJour(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

const PHRASE_NOW = { ajoute: "settings.sync.changeNowAdded", modifie: "settings.sync.changeNowModified", supprime: "settings.sync.changeNowDeleted" } as const;
const PHRASE_PAST = { ajoute: "settings.sync.changePastAdded", modifie: "settings.sync.changePastModified", supprime: "settings.sync.changePastDeleted" } as const;

/** One change as a sentence that ages with the clock: "DESKTOP just modified
    Neo Quiz.md" in its first minute, then "… 5 min ago", "… at 16:30:15"
    today, "… yesterday at 16:30", "… on 1 Oct at 16:30". Only the file or
    folder NAME is in the sentence; its folder is shown apart. */
export function phraseChangement(c: Changement, maintenant: number = Date.now()): string {
	const nom = c.chemin.split("/").pop() || c.chemin;
	const quoi = c.dossier ? t("settings.sync.changeFolder", { name: nom }) : nom;
	const age = maintenant - c.quand;
	if (age < 60_000) return t(PHRASE_NOW[c.action], { device: c.appareil, what: quoi });
	const heure = (secondes: boolean): string => new Intl.DateTimeFormat(currentLang(), { ...hourOptions(), minute: "2-digit", ...(secondes ? { second: "2-digit" } : {}) }).format(c.quand);
	const jour = debutDuJour(maintenant);
	let quand: string;
	if (age < 60 * 60_000) quand = t("settings.sync.whenMinutes", { n: Math.floor(age / 60_000) });
	else if (c.quand >= jour) quand = t("settings.sync.changeAt", { time: heure(true) });
	else if (c.quand >= debutDuJour(jour - 1)) quand = t("settings.sync.changeYesterday", { time: heure(false) });
	else {
		const memeAnnee = new Date(c.quand).getFullYear() === new Date(maintenant).getFullYear();
		const date = new Intl.DateTimeFormat(currentLang(), memeAnnee ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(c.quand);
		quand = t("settings.sync.changeOn", { date, time: heure(false) });
	}
	return t(PHRASE_PAST[c.action], { device: c.appareil, what: quoi, when: quand });
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

/** The Syncthing logo (Simple Icons, CC0), drawn in place: nothing to load,
    so nothing missing offline. Same mark as Neo Calendar's sync page. */
const SYNCTHING_PATH = "M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm0 2.412c3.115 0 5.885 1.5 7.629 3.815a1.834 1.834 0 0 1 1.564 3.162c.23.818.354 1.68.354 2.57a9.504 9.504 0 0 1-2.166 6.05c.128.281.189.595.162.92a1.854 1.854 0 0 1-2.004 1.678 1.86 1.86 0 0 1-.877-.322A9.486 9.486 0 0 1 12 21.505c-3.84 0-7.154-2.277-8.668-5.552-.3-.01-.601-.092-.879-.254-.858-.51-1.144-1.634-.633-2.513.164-.276.39-.493.653-.643a9.62 9.62 0 0 1-.02-.584c0-5.265 4.282-9.547 9.547-9.547zm0 1.227a8.311 8.311 0 0 0-8.31 8.683c.22.036.439.111.644.23.323.2.564.484.713.805l6.984-.644a1.78 1.78 0 0 1 .787-1.08c.288-.19.612-.286.936-.295.34-.01.68.08.978.254l3.51-2.914a1.82 1.82 0 0 1 .317-1.84A8.3 8.3 0 0 0 12 3.638zm7.027 5.98-3.502 2.91a1.829 1.829 0 0 1-.23 1.719l1.904 2.744c.212-.06.436-.085.668-.066.238.024.46.092.66.193a8.285 8.285 0 0 0 1.793-5.16 8.38 8.38 0 0 0-.265-2.092 1.835 1.835 0 0 1-1.028-.248zm-6.886 4.315-6.975.644a1.8 1.8 0 0 1-.66 1.004A8.312 8.312 0 0 0 12 20.279a8.294 8.294 0 0 0 3.938-.986 1.845 1.845 0 0 1-.075-.69c.028-.341.148-.65.332-.908L14.29 14.95a1.839 1.839 0 0 1-2.148-1.015z";
const SYNCTHING_URL = "https://syncthing.net";

function logoSyncthing(parent: HTMLElement): void {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("class", "qbd-sync-logo");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	const path = document.createElementNS(ns, "path");
	path.setAttribute("d", SYNCTHING_PATH);
	svg.appendChild(path);
	parent.appendChild(svg);
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

	/* ── This device: ONE big button; the ID, its QR and sharing live in its dialog ── */
	const moi = ajouter(racine, "section", "qbd-sync-section");
	moi.hidden = true;
	const afficherIdBtn = bouton(moi, "qr-code", t("settings.sync.showId"), "qbd-sync-bouton qbd-sync-bouton-principal qbd-sync-bouton-grand");
	afficherIdBtn.setAttribute("aria-haspopup", "dialog");

	/* ── Requests from devices that added this one ── */
	const demandesSection = ajouter(racine, "section", "qbd-sync-section");
	demandesSection.hidden = true;
	titre(demandesSection, t("settings.sync.requests"));
	const demandesCarte = ajouter(demandesSection, "div", "qbd-sync-carte");

	/* ── Paired devices ── */
	const appareilsSection = ajouter(racine, "section", "qbd-sync-section");
	titre(appareilsSection, t("settings.sync.devices"));
	const appareilsCarte = ajouter(appareilsSection, "div", "qbd-sync-carte");

	/* ── Adding a device lives in the devices section, under the list it extends ── */
	const ajout = ajouter(appareilsSection, "div", "qbd-sync-ajout");
	const ajouterBouton = bouton(ajout, "plus", t("settings.sync.addButton"), "qbd-sync-bouton qbd-sync-bouton-ajout");
	ajouterBouton.setAttribute("aria-haspopup", "dialog");

	/* ── Recent changes: ONE full-width button (like Syncthing's "Recent
	   Changes"), which opens a dialog: today by default, the older ones
	   behind a link ── */
	const changementsSection = ajouter(racine, "section", "qbd-sync-section");
	changementsSection.hidden = true;
	const changementsBtn = bouton(changementsSection, "info", t("settings.sync.changes"), "qbd-sync-bouton qbd-sync-bouton-large");
	changementsBtn.setAttribute("aria-haspopup", "dialog");
	/** The open dialog's list, repainted on each state and every 5 s. */
	let dialogueChangements: { carte: HTMLElement; plusAnciens: HTMLButtonElement; fermer(): void } | null = null;
	let voirAnciens = false;

	/* ── Footer: what sync runs on, for whoever has never heard of it ── */
	const pied = ajouter(racine, "footer", "qbd-sync-pied");
	logoSyncthing(pied);
	ajouter(pied, "span", "qbd-sync-pied-nom", "Syncthing");
	ajouter(pied, "span", "qbd-sync-pied-sep", "·").setAttribute("aria-hidden", "true");
	const enSavoirPlus = ajouter(pied, "a", "qbd-sync-lien", t("settings.sync.learnMore"));
	enSavoirPlus.href = SYNCTHING_URL;
	enSavoirPlus.addEventListener("click", ev => {
		ev.preventDefault();
		void currentHost().shell.openUrl(SYNCTHING_URL).catch(() => false);
	});

	let demonte = false;
	let dernierEtat: EtatSync | null = null;
	const ignorees = new Set<string>();
	let fermerMenu: () => void = () => undefined;
	/** The open "Show my ID" dialog, repainted on each state, closed when
	    sync stops. */
	let dialogueId: { fermer(): void; arreter(): void; peindre(e: EtatSync): void } | null = null;
	let fermerAjout: () => void = () => undefined;

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
		/* Escape closes the menu only (captured and stopped here), so the
		   dialog around it stays open. */
		const echap = (ev: KeyboardEvent): void => { if (ev.key === "Escape") { ev.stopPropagation(); fermerMenu(); ancre.focus(); } };
		document.addEventListener("pointerdown", dehors, true);
		document.addEventListener("keydown", echap, true);
		fermerMenu = () => {
			document.removeEventListener("pointerdown", dehors, true);
			document.removeEventListener("keydown", echap, true);
			m.remove();
			ancre.setAttribute("aria-expanded", "false");
			fermerMenu = () => undefined;
		};
		m.querySelector<HTMLElement>(".qbd-sync-menu-item")?.focus();
	}

	async function rafraichir(): Promise<void> {
		try { const e = await deps.etat(); if (!demonte) peindre(e); } catch { /* the push will follow */ }
	}

	async function partagerId(canal: CanalPartage): Promise<void> {
		let ok = false;
		try { ok = await deps.partager(canal); } catch { ok = false; }
		if (demonte) return;
		if (!ok) currentHost().ui.notice(t("settings.sync.shareFailed"));
		else if (canal === "discord") currentHost().ui.notice(t("settings.sync.copiedDiscord"), 6000);
	}

	/* ── "Show my ID": a landscape dialog, the QR code on the left; on the
	   right the name, the full ID, Copy and Share, and the countdown to the
	   next code when the host rotates it ── */
	function ouvrirId(): void {
		if (dialogueId || !dernierEtat?.appareil) return;
		const qrHote = deps.qr;
		requireHost("modals").open({
			className: "qbd-sync-modal qbd-sync-modal-id",
			/* The device's name lives in the title, said once: "Device ID -
			   DESKTOP-1U89520", the wording of the former ID section. */
			title: dernierEtat.nom ? t("settings.sync.idModalTitle", { name: dernierEtat.nom }) : t("settings.sync.idModalTitleBare"),
			onOpen: handle => {
				const corps = ajouter(handle.contentEl, "div", "qbd-sync-dialogue-id");
				const gauche = ajouter(corps, "div", "qbd-sync-dialogue-qr");
				const qr = ajouter(gauche, "img", "qbd-sync-qr");
				qr.alt = t("settings.sync.qrAlt");
				qr.hidden = true;
				const barre = ajouter(gauche, "div", "qbd-sync-compte");
				barre.hidden = !qrHote;
				const jauge = ajouter(barre, "div", "qbd-sync-compte-jauge");
				const droite = ajouter(corps, "div", "qbd-sync-dialogue");
				/* The ID in the code block of the install dialog (`ai-install-modal.ts`):
				   the copy button is an icon INSIDE it, top right, its label off
				   screen, and it turns into a check for a moment once copied. */
				const blocId = ajouter(droite, "div", "qbd-install-code qbd-sync-code markdown-rendered markdown-preview-view");
				const idTexte = ajouter(ajouter(blocId, "pre"), "code");
				const copierBtn = ajouter(blocId, "button", "qbd-btn qbd-install-copy");
				copierBtn.type = "button";
				const copierIcone = ajouter(copierBtn, "span", "qbd-btn-icon qbd-btn-icon--sm");
				currentHost().ui.setIcon(copierIcone, "copy");
				const copierTexte = ajouter(copierBtn, "span", "qbd-sr-only", t("settings.sync.copy"));
				const zonePartage = ajouter(droite, "div", "qbd-sync-menu-zone");
				const partagerBtn = bouton(zonePartage, "share-2", t("settings.sync.share"), "qbd-sync-bouton qbd-sync-bouton-principal");
				partagerBtn.setAttribute("aria-haspopup", mobile ? "false" : "menu");
				ajouter(droite, "p", "qbd-sync-aide", t("settings.sync.idScanHint"));

				let ferme = false;
				let idCourant: string | null = null;
				let texteQr: string | null = null;
				const appareilsAvant = dernierEtat?.appareils.length ?? 0;
				let minuteur: ReturnType<typeof setTimeout> | null = null;

				function poserQr(texte: string): void {
					if (texte === texteQr) return;
					texteQr = texte;
					void QRCode.toDataURL(texte, { margin: 2, width: 240, errorCorrectionLevel: "M" })
						.then(url => { if (!ferme && texteQr === texte) { qr.src = url; qr.hidden = false; } })
						.catch(() => { qr.hidden = true; });
				}
				/* The countdown: a bar that fills up over the period, restarted at
				   each new code (no seconds written: with 2 s they said nothing). */
				function lancerDecompte(periodeMs: number): void {
					jauge.style.transition = "none";
					jauge.style.transform = "scaleX(0)";
					void jauge.offsetWidth;
					jauge.style.transition = `transform ${periodeMs}ms linear`;
					jauge.style.transform = "scaleX(1)";
				}
				async function tourner(): Promise<void> {
					if (ferme || !qrHote) return;
					let r: Awaited<ReturnType<NonNullable<SyncPageDeps["qr"]>["suivant"]>> = null;
					try { r = await qrHote.suivant(); } catch { r = null; }
					if (ferme) return;
					if (!r) {
						/* No code: the plain ID instead, and no countdown. */
						if (idCourant) poserQr(idCourant);
						barre.hidden = true;
						return;
					}
					poserQr(r.texte);
					barre.hidden = false;
					lancerDecompte(r.periodeMs);
					minuteur = setTimeout(() => { void tourner(); }, r.periodeMs);
				}

				let retourCopie: ReturnType<typeof setTimeout> | null = null;
				copierBtn.addEventListener("click", () => {
					if (!idCourant) return;
					void deps.copier(idCourant).then(ok => {
						if (demonte || ferme) return;
						if (!ok) { currentHost().ui.notice(t("settings.sync.shareFailed")); return; }
						copierIcone.replaceChildren();
						currentHost().ui.setIcon(copierIcone, "check");
						copierTexte.textContent = t("settings.sync.copied");
						copierBtn.dataset.copie = "1";
						if (retourCopie) clearTimeout(retourCopie);
						retourCopie = setTimeout(() => {
							copierIcone.replaceChildren();
							currentHost().ui.setIcon(copierIcone, "copy");
							copierTexte.textContent = t("settings.sync.copy");
							delete copierBtn.dataset.copie;
						}, 1500);
					});
				});
				partagerBtn.addEventListener("click", () => {
					if (!idCourant) return;
					if (mobile) { void partagerId("systeme"); return; }
					menu(partagerBtn, zonePartage, [
						{ icone: "mail", texte: t("settings.sync.shareMail"), agir: () => { void partagerId("courriel"); } },
						{ icone: "message-circle", texte: t("settings.sync.shareDiscord"), agir: () => { void partagerId("discord"); } },
					]);
				});
				dialogueId = {
					fermer: () => handle.close(),
					arreter: () => {
						ferme = true;
						if (minuteur) clearTimeout(minuteur);
						if (retourCopie) clearTimeout(retourCopie);
						if (qrHote) void qrHote.fermer().catch(() => undefined);
					},
					peindre: e => {
						if (!e.actif || !e.appareil) { handle.close(); return; }
						/* A device was just paired (a phone scanned the code and the
						   owner said yes): the dialog has done its job. */
						if (e.appareils.length > appareilsAvant) {
							handle.close();
							currentHost().ui.notice(t("settings.sync.added"), 6000);
							return;
						}
						if (e.appareil === idCourant) return;
						idCourant = e.appareil;
						idTexte.textContent = e.appareil;
						if (!qrHote) poserQr(e.appareil);
					},
				};
				if (dernierEtat) dialogueId.peindre(dernierEtat);
				void tourner();
				partagerBtn.focus();
			},
			onClose: () => { fermerMenu(); dialogueId?.arreter(); dialogueId = null; },
		});
	}

	/* ── "Add a device": type, paste or scan the other device's ID ── */
	function ouvrirAjout(): void {
		if (!dernierEtat?.actif) return;
		requireHost("modals").open({
			className: "qbd-sync-modal",
			title: t("settings.sync.addButton"),
			onOpen: handle => {
				const corps = ajouter(handle.contentEl, "div", "qbd-sync-dialogue");
				ajouter(corps, "p", "qbd-sync-aide", t("settings.sync.addHint"));
				const champ = ajouter(corps, "input", "qbd-sync-champ");
				champ.type = "text";
				champ.spellcheck = false;
				champ.autocomplete = "off";
				champ.placeholder = t("settings.sync.addPlaceholder");
				champ.setAttribute("aria-label", t("settings.sync.addPlaceholder"));
				const message = ajouter(corps, "p", "qbd-sync-message qbd-sync-message-erreur");
				message.setAttribute("role", "alert");
				const piedDialogue = ajouter(corps, "div", "qbd-sync-dialogue-pied");
				const scannerBtn = deps.scanner ? bouton(piedDialogue, "scan-line", t("settings.sync.scan")) : null;
				ajouter(piedDialogue, "span", "qbd-sync-espace");
				const annulerBtn = bouton(piedDialogue, "x", t("settings.sync.cancel"));
				const validerBtn = bouton(piedDialogue, "check", t("settings.sync.add"), "qbd-sync-bouton qbd-sync-bouton-principal");

				let ferme = false;
				async function soumettre(brut: string): Promise<void> {
					const code = normaliserCode(brut);
					if (!code) { champ.focus(); return; }
					validerBtn.disabled = true;
					message.textContent = "";
					try {
						const res = await deps.appairer(code);
						if (demonte || ferme) return;
						if (res === "ok") {
							handle.close();
							currentHost().ui.notice(t("settings.sync.added"), 6000);
						} else if (res !== "annule") {
							/* "annule": the owner declined the native dialog, nothing to report. */
							message.textContent = t(res === "invalide" ? "settings.sync.invalid" : "settings.sync.unavailable");
						}
					} catch {
						if (!demonte && !ferme) message.textContent = t("settings.sync.unavailable");
					} finally {
						validerBtn.disabled = false;
					}
					await rafraichir();
				}
				validerBtn.addEventListener("click", () => { void soumettre(champ.value); });
				annulerBtn.addEventListener("click", () => handle.close());
				champ.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); void soumettre(champ.value); } });
				scannerBtn?.addEventListener("click", () => {
					void deps.scanner!().then(code => {
						if (code && !demonte && !ferme) { champ.value = code; void soumettre(code); }
					}).catch(() => undefined);
				});
				fermerAjout = () => { if (!ferme) { ferme = true; handle.close(); } };
				champ.focus();
			},
			onClose: () => { fermerAjout = () => undefined; },
		});
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

	function ouvrirChangements(): void {
		if (dialogueChangements) return;
		voirAnciens = false;
		requireHost("modals").open({
			className: "qbd-sync-modal qbd-sync-modal-changements",
			title: t("settings.sync.changes"),
			onOpen: handle => {
				const corps = ajouter(handle.contentEl, "div", "qbd-sync-dialogue");
				const carte = ajouter(corps, "div", "qbd-sync-carte qbd-sync-carte-changements");
				const plusAnciens = ajouter(corps, "button", "qbd-sync-lien qbd-sync-lien-bouton");
				plusAnciens.type = "button";
				plusAnciens.addEventListener("click", () => { voirAnciens = !voirAnciens; if (dernierEtat) peindreChangements(dernierEtat); });
				dialogueChangements = { carte, plusAnciens, fermer: () => handle.close() };
				if (dernierEtat) peindreChangements(dernierEtat);
			},
			onClose: () => { dialogueChangements = null; },
		});
	}
	changementsBtn.addEventListener("click", ouvrirChangements);

	function peindreChangements(e: EtatSync): void {
		const liste = e.changements;
		changementsSection.hidden = !e.actif || liste === undefined;
		if (changementsSection.hidden || !liste) { dialogueChangements?.fermer(); return; }
		if (!dialogueChangements) return;
		const { carte: changementsCarte, plusAnciens } = dialogueChangements;
		const maintenant = Date.now();
		const jour = debutDuJour(maintenant);
		const anciens = liste.filter(c => c.quand < jour).length;
		const visibles = voirAnciens ? liste : liste.filter(c => c.quand >= jour);
		changementsCarte.replaceChildren();
		if (visibles.length === 0) {
			ajouter(ajouter(changementsCarte, "div", "qbd-sync-ligne"), "span", "qbd-sync-vide", t("settings.sync.changesNoneToday"));
		}
		for (const c of visibles) {
			const l = ajouter(changementsCarte, "div", "qbd-sync-ligne");
			const bloc = ajouter(l, "div", "qbd-sync-id-bloc");
			ajouter(bloc, "span", "qbd-sync-changement", phraseChangement(c, maintenant));
			const parent = c.chemin.includes("/") ? c.chemin.slice(0, c.chemin.lastIndexOf("/")) : "";
			if (parent) ajouter(bloc, "span", "qbd-sync-sous", parent);
		}
		plusAnciens.hidden = anciens === 0;
		plusAnciens.textContent = t(voirAnciens ? "settings.sync.changesHideOlder" : "settings.sync.changesShowOlder", { n: anciens });
	}

	function peindre(e: EtatSync): void {
		if (demonte) return;
		dernierEtat = e;
		const s = statutGlobal(e);
		statutTexte.textContent = s.texte;
		statut.dataset.ton = s.ton;
		moi.hidden = !e.actif || !e.appareil;
		dialogueId?.peindre(e);
		ajouterBouton.disabled = !e.actif;
		if (!e.actif) fermerAjout();
		peindreDemandes(e);
		peindreAppareils(e);
		peindreChangements(e);
	}

	afficherIdBtn.addEventListener("click", ouvrirId);
	ajouterBouton.addEventListener("click", ouvrirAjout);

	/* Last-seen times age without any push: repaint the list now and then. */
	const horloge = setInterval(() => { if (dernierEtat && !demonte) peindreAppareils(dernierEtat); }, 60_000);
	/* The change sentences age faster ("just" lasts a minute): every 5 s. */
	const horlogeChangements = setInterval(() => { if (dernierEtat && !demonte) peindreChangements(dernierEtat); }, 5_000);

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
		clearInterval(horlogeChangements);
		fermerMenu();
		dialogueId?.fermer();
		dialogueChangements?.fermer();
		fermerAjout();
		desabonner();
		racine.remove();
	};
}
