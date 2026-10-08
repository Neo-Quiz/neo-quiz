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
import { getOwnRequests, getPairedPeers, getPeerConnected, getRemoteGenerations, lastPcEver, onRemoteGenerations } from "./remote-generations";
import { ilYA } from "./sync-page";

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
		peers: getPairedPeers(), chats: getChats(), own: getOwnRequests(), device: chatDevice(),
	});
}

const phrase = (s: PcStatus): string => t(("ai.pc.state." + s.reason) as "ai.pc.state.ready");

/** The PC button, right after "+": its colour is the PC's status, a tap opens the window. */
export function poserBoutonPc(parent: HTMLElement, chat: () => ChatRecord | null): HTMLButtonElement {
	const host = currentHost();
	const b = ajouter(parent, "button", "qbd-ai-composer-pc");
	b.type = "button";
	b.setAttribute("aria-label", t("ai.pc.button"));
	const peindre = (): void => {
		if (!b.isConnected) { pcBoutons.delete(peindre); return; }
		const s = etatPc(chat);
		b.dataset.tone = s.tone;
		b.title = phrase(s);
		b.replaceChildren();
		host.ui.setIcon(ajouter(b, "span", "qbd-ai-composer-pc-icone"), "laptop");
	};
	pcBoutons.add(peindre);
	if (!abonne) {
		abonne = true;
		const tout = (): void => { for (const p of [...pcBoutons]) p(); };
		onRemoteGenerations(tout);
		onChatsChanged(tout);
	}
	peindre();
	b.addEventListener("click", () => ouvrirFenetrePc(etatPc(chat)));
	return b;
}

/** The window: name, state in words, last sight, what runs, the provider, the paired devices. */
function ouvrirFenetrePc(s: PcStatus): void {
	requireHost("modals").open({
		className: "qbd-ai-pc-modal",
		title: s.name ?? t("ai.pc.title"),
		onOpen: (m) => {
			const c = m.contentEl;
			const etat = ajouter(c, "div", "qbd-ai-pc-state");
			etat.dataset.tone = s.tone;
			currentHost().ui.setIcon(ajouter(etat, "span", "qbd-ai-pc-state-icone"), "laptop");
			ajouter(etat, "span", "qbd-ai-pc-state-texte", phrase(s));
			const ligne = (cle: string, valeur: string, erreur = false): void => {
				const l = ajouter(c, "div", "qbd-ai-pc-row" + (erreur ? " is-error" : ""));
				ajouter(l, "span", "qbd-ai-pc-row-cle", cle);
				ajouter(l, "span", "qbd-ai-pc-row-valeur", valeur);
			};
			const vu = getPeerConnected() ? t("ai.pc.seenNow") : s.seenAt === null ? t("ai.pc.seenNever") : ilYA(s.seenAt);
			ligne(t("ai.pc.lastSeenLabel"), vu);
			if (s.error) ligne(t("ai.pc.error"), s.error, true);
			ligne(t("ai.pc.runningNow"), s.running.length > 0 ? s.running.map(r => r.text).join(" · ") : t("ai.pc.idle"));
			ligne(t("ai.pc.provider"), s.provider ?? t("ai.pc.providerUnknown"));
			const pairs = getPairedPeers();
			if (pairs.length > 0) {
				ajouter(c, "div", "qbd-ai-pc-devices-titre", t("ai.pc.devices"));
				for (const p of pairs) {
					const l = ajouter(c, "div", "qbd-ai-pc-device");
					ajouter(l, "span", "qbd-ai-pc-device-nom", p.name || t("ai.pc.fallbackName"));
					ajouter(l, "span", "qbd-ai-pc-device-etat", p.paused ? t("ai.pc.devicePaused") : p.connected ? t("ai.pc.deviceOn") : t("ai.pc.deviceOff")).dataset.on = String(p.connected && !p.paused);
				}
				ajouter(c, "p", "qbd-ai-pc-note", t("ai.pc.usedNote"));
			}
		},
	});
}
