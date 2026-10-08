/* ══════════════════════════════════════════════════════════
   THE GENERATE PAGE ON A PHONE, laid out like the Claude app's chat

   Top bar (menu on the left, the chat's title, "new conversation" on the
   right), the list of chats as a LEFT DRAWER over a scrim, and next to the
   "+" of the composer the PC icon whose colour is the PC's status
   (`pc-status.ts`). Everything here is DOM glue; the verdicts are pure.
   Phone only: the desktop page never calls this module.
══════════════════════════════════════════════════════════ */

import { PRODUCT_NAME } from "../branding";
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { chatTitle } from "./chat-record";
import type { ChatRecord } from "./chat-record";
import { activeChatId, chatDevice, onChatsChanged } from "./chat-session";
import { getChats } from "./chat-store";
import { pcStatus } from "./pc-status";
import type { PcStatus } from "./pc-status";
import { chooseDevice, chosenPc, getDevices, getOwnRequests, getOwnSettings, getPairedPeers, getPeerConnected, getRemoteGenerations, lastPcEver, onRemoteGenerations, remoteModel, setRemoteModel } from "./remote-generations";
import { deviceInfo, pcIcon, soleOnlinePc } from "../shared-state/devices";
import { isStale } from "../shared-state/generations";
import { openActionMenu } from "./ui-select";
import { ilYA } from "./sync-page";
import { demanderClaudeCode } from "./ai-remote";

/** The drawer survives a repaint of the page only while it stays open: a chosen chat closes it. */
let tiroirOuvert = false;

/** Horizontal travel (px) that opens or closes the drawer. */
const GESTE_PX = 60;
/** The strip at the left edge from which a swipe opens the drawer. */
const BORD_PX = 24;

export interface BarreHaute { majTitre(): void; majNouveau(): void }

/** The top bar and the drawer around `lateral` (the page's nav). Returns what must be refreshed when the chat or the queue change. */
export function poserBarreHaute(container: HTMLElement, lateral: HTMLElement, opts: { peutCreer: () => boolean; creer: () => void }): BarreHaute {
	const host = currentHost();
	const barre = ajouter(container, "div", "qbd-ai-topbar");
	container.insertBefore(barre, container.firstChild);
	const menu = ajouter(barre, "button", "qbd-ai-topbar-btn");
	menu.type = "button";
	menu.setAttribute("aria-label", t("ai.chat.menu"));
	host.ui.setIcon(menu, "align-left");
	const titre = ajouter(barre, "div", "qbd-ai-topbar-title");
	const nouveau = ajouter(barre, "button", "qbd-ai-topbar-btn");
	nouveau.type = "button";
	nouveau.setAttribute("aria-label", t("ai.chat.new"));
	host.ui.setIcon(nouveau, "message-square-plus");
	nouveau.addEventListener("click", () => { if (opts.peutCreer()) opts.creer(); });

	const voile = ajouter(container, "div", "qbd-ai-scrim");
	lateral.classList.add("qbd-ai-drawer");
	// Like the Claude app drawer: the product name in serif above the entries.
	lateral.insertBefore(ajouter(lateral, "div", "qbd-ai-drawer-titre", PRODUCT_NAME), lateral.firstChild);
	const appliquer = (): void => {
		lateral.classList.toggle("is-open", tiroirOuvert);
		voile.classList.toggle("is-open", tiroirOuvert);
		menu.setAttribute("aria-expanded", String(tiroirOuvert));
	};
	const basculer = (ouvert: boolean): void => { tiroirOuvert = ouvert; appliquer(); };
	menu.addEventListener("click", () => basculer(!tiroirOuvert));
	voile.addEventListener("click", () => basculer(false));
	// A tap on an entry or a chat is a choice: the drawer gets out of the way (the entry's own handler runs first).
	lateral.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest(".qbd-ai-chat-ouvrir, .qbd-ai-lateral-item, .qbd-ai-lateral-recherche")) basculer(false);
	});
	// Swipe left on the drawer or the scrim closes it; swipe right from the left edge opens it.
	// The touches stop here: the app's page-to-page swipe must not also fire.
	let depart: { x: number; y: number; bord: boolean } | null = null;
	const debut = (e: TouchEvent, bord: boolean): void => {
		const p = e.touches[0];
		depart = p ? { x: p.clientX, y: p.clientY, bord } : null;
	};
	const fin = (e: TouchEvent): void => {
		const p = e.changedTouches[0];
		const d = depart;
		depart = null;
		if (!p || !d) return;
		const dx = p.clientX - d.x;
		if (Math.abs(dx) < GESTE_PX || Math.abs(dx) < Math.abs(p.clientY - d.y) * 1.5) return;
		if (d.bord && dx > 0) basculer(true);
		else if (!d.bord && dx < 0) basculer(false);
	};
	for (const el of [lateral, voile]) {
		el.addEventListener("touchstart", (e) => { e.stopPropagation(); debut(e, false); }, { passive: true });
		el.addEventListener("touchend", (e) => { e.stopPropagation(); fin(e); }, { passive: true });
	}
	container.addEventListener("touchstart", (e) => {
		const p = e.touches[0];
		if (p && p.clientX <= BORD_PX && !tiroirOuvert) debut(e, true);
	}, { passive: true });
	container.addEventListener("touchend", (e) => { if (depart?.bord) fin(e); }, { passive: true });
	appliquer();

	const majTitre = (): void => {
		const id = activeChatId();
		const chat = getChats().find(c => c.id === id && !c.deleted);
		titre.textContent = chat ? chatTitle(chat) : "";
	};
	const majNouveau = (): void => { nouveau.disabled = !opts.peutCreer(); };
	majTitre();
	majNouveau();
	return { majTitre, majNouveau };
}

/* ── The PC icon next to "+" ── */

const pcBoutons = new Set<() => void>();
let abonne = false;

function etatPc(chat: () => ChatRecord | null): PcStatus {
	return pcStatus({
		chat: chat(), files: getRemoteGenerations(), now: Date.now(), lastEver: lastPcEver(), peerConnected: getPeerConnected(),
		peers: getPairedPeers(), chats: getChats(), own: getOwnRequests(), device: chatDevice(), devices: getDevices(), chosen: chosenPc(),
	});
}

const phrase = (s: PcStatus): string => t(("ai.pc.state." + s.reason) as "ai.pc.state.ready");

/** The icon of the target PC: a laptop or a desktop from its device file (a laptop when unknown). Its colour is the state. */
const iconeDe = (s: PcStatus): string => pcIcon(s.kind ? { kind: s.kind } : null);

/** The PC button, right after "+": its icon is the PC's kind, its colour is the PC's status, a tap opens the window. */
export function poserBoutonPc(parent: HTMLElement, chat: () => ChatRecord | null): HTMLButtonElement {
	const host = currentHost();
	const b = ajouter(parent, "button", "qbd-ai-composer-pc");
	b.type = "button";
	b.setAttribute("aria-label", t("ai.pc.button"));
	// The same bubble as the provider one, above the icon while no PC is available; a tap opens the window.
	const bulle = ajouter(parent, "button", "qbd-ai-provider-nudge", t("ai.pc.nudge"));
	bulle.type = "button";
	bulle.addEventListener("click", () => ouvrirFenetrePc(chat));
	const placer = (): void => {
		requestAnimationFrame(() => {
			if (bulle.hidden) return;
			const gauche = Math.max(0, b.offsetLeft + b.offsetWidth / 2 - bulle.offsetWidth / 2);
			bulle.style.left = `${gauche}px`;
			bulle.style.setProperty("--pointe", `${b.offsetLeft + b.offsetWidth / 2 - gauche}px`);
			bulle.classList.add("is-placed");
		});
	};
	const peindre = (): void => {
		if (!b.isConnected) { pcBoutons.delete(peindre); bulle.remove(); return; }
		const s = etatPc(chat);
		const etait = bulle.hidden;
		bulle.hidden = s.tone === "ok";
		if (bulle.hidden) bulle.classList.remove("is-placed");
		else if (etait || !bulle.classList.contains("is-placed")) placer();
		b.dataset.tone = s.tone;
		b.title = phrase(s);
		b.replaceChildren();
		host.ui.setIcon(ajouter(b, "span", "qbd-ai-composer-pc-icone"), iconeDe(s));
	};
	pcBoutons.add(peindre);
	if (!abonne) {
		abonne = true;
		const tout = (): void => { for (const p of [...pcBoutons]) p(); };
		onRemoteGenerations(tout);
		onChatsChanged(tout);
	}
	peindre();
	b.addEventListener("click", () => ouvrirFenetrePc(chat));
	return b;
}

/** The window: one plain list of the PCs (icon, name, a small state dot); a tap makes one the target, the target is checked. */
function ouvrirFenetrePc(chat: () => ChatRecord | null): void {
	requireHost("modals").open({
		className: "qbd-ai-pc-modal",
		title: t("ai.pc.nudge"),
		onOpen: (m) => {
			const c = m.contentEl;
			const peindre = (): void => {
				c.replaceChildren();
				const s = etatPc(chat);
				const now = Date.now();
				const files = getRemoteGenerations();
				const devices = getDevices();
				const seul = soleOnlinePc(getPairedPeers(), devices);
				// The device files, plus the target itself when it only has a generations file (an older PC app).
				const liste = devices.map(d => ({ id: d.device, name: d.name || t("ai.pc.fallbackName"), kind: d.kind }));
				if (s.device && !deviceInfo(devices, s.device)) liste.push({ id: s.device, name: s.name || t("ai.pc.fallbackName"), kind: "laptop" as const });
				if (liste.length === 0) {
					ajouter(c, "p", "qbd-ai-pc-note", t("ai.pc.state.never"));
					return;
				}
				for (const d of liste) {
					const choisi = d.id === s.device;
					const f = files.find(x => x.device === d.id);
					const tone = choisi ? s.tone : (f && !isStale(f.file, now)) || seul === d.id ? "ok" : "off";
					const l = ajouter(c, "button", "qbd-ai-pc-device");
					l.type = "button";
					l.setAttribute("role", "radio");
					l.setAttribute("aria-checked", String(choisi));
					currentHost().ui.setIcon(ajouter(l, "span", "qbd-ai-pc-device-icone"), pcIcon({ kind: d.kind }));
					ajouter(l, "span", "qbd-ai-pc-device-nom", d.name);
					ajouter(l, "span", "qbd-ai-pc-dot").dataset.tone = tone;
					const coche = ajouter(l, "span", "qbd-ai-pc-device-coche");
					if (choisi) currentHost().ui.setIcon(coche, "check");
					l.addEventListener("click", () => { chooseDevice(d.id); peindre(); });
				}
				// One short line for the selected device.
				if (s.device) ajouter(c, "p", "qbd-ai-pc-note", phrase(s));
				// The one remote setting: a PC on another provider can be set to Claude Code from here.
				if (s.device && s.reason === "notClaude") {
					const cible = s.device;
					const envoye = getOwnSettings().some(q => q.target.toLowerCase() === cible.toLowerCase());
					const b = ajouter(c, "button", "qbd-ai-pc-set", envoye ? t("ai.pc.setClaudeSent") : t("ai.pc.setClaude"));
					b.type = "button";
					b.disabled = envoye;
					b.addEventListener("click", () => {
						b.disabled = true;
						demanderClaudeCode(cible).then(peindre, (e: unknown) => { console.warn("setting request not sent:", e); peindre(); });
					});
				}
			};
			peindre();
		},
	});
}

/* ── The model pill: "Claude Code · <model>" ── */

/** The Claude models the target PC lists in its device file, empty when it has none (or no PC is known). */
function modelesDuPc(chat: () => ChatRecord | null): Array<{ id: string; label: string }> {
	const s = etatPc(chat);
	return deviceInfo(getDevices(), s.device)?.claudeModels ?? [];
}

/** The pill in the composer's bottom row. The only provider is Claude Code; a tap lists the target PC's own Claude models (the same menu component as the other action menus). The choice is a phone setting, sent as the request's optional `model`. */
export function poserPuceModele(parent: HTMLElement, chat: () => ChatRecord | null): HTMLButtonElement {
	const b = ajouter(parent, "button", "qbd-ai-model-pill");
	b.type = "button";
	const peindre = (): void => {
		if (!b.isConnected) { pcBoutons.delete(peindre); return; }
		const modeles = modelesDuPc(chat);
		const choix = remoteModel();
		const courant = modeles.find(m => m.id === choix);
		b.hidden = modeles.length === 0;
		b.replaceChildren();
		ajouter(b, "span", "qbd-ai-model-pill-texte", courant ? t("ai.model.pill", { model: courant.label }) : t("ai.model.pillDefault"));
		currentHost().ui.setIcon(ajouter(b, "span", "qbd-ai-model-pill-chevron"), "chevron-down");
	};
	pcBoutons.add(peindre);
	b.addEventListener("click", () => {
		const modeles = modelesDuPc(chat);
		const choix = remoteModel();
		openActionMenu(b, modeles.map(m => ({ label: m.label, checked: m.id === choix, onClick: () => { setRemoteModel(m.id); } })), { className: "qbd-menu-claude" });
	});
	peindre();
	return b;
}
