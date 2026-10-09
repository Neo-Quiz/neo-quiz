/* ══════════════════════════════════════════════════════════
   THE LINE UNDER A REQUEST: who sent it, where it runs, what state it is in

   The decisions (names, kinds, icons) are the pure `request-origin.ts`; this
   file only paints them. Text goes through `textContent`, never HTML: a
   device name comes from a synced file.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { chatDevice } from "./chat-session";
import { getDevices, getOwnDeviceName } from "./remote-generations";
import { ROLE_ICON, deviceLabel, resolveDevice } from "../shared-state/request-origin";
import type { DeviceRef, DeviceWords, OriginContext, RequestStatus } from "../shared-state/request-origin";

export function originContext(): OriginContext {
	return { self: chatDevice(), selfName: getOwnDeviceName(), devices: getDevices() };
}

const words = (): DeviceWords => ({ phone: t("ai.origin.phone"), pc: t("ai.origin.pc"), self: t("ai.origin.thisDevice") });

/** "Xiaomi 13T Pro", "DESKTOP-1U89520 (this device)". */
export const labelOf = (d: DeviceRef): string => deviceLabel(d, words());

/** The state of a request on the device that runs it, in one sentence. */
export function statusText(kind: RequestStatus, runner: DeviceRef, error?: string): string {
	const device = labelOf(runner);
	switch (kind) {
		case "waiting": return t("ai.reqstatus.waiting", { device });
		case "expired": return t("ai.remote.expired");
		case "running": return t("ai.reqstatus.running", { device });
		case "paused": return t("ai.reqstatus.paused", { device });
		case "done": return t("ai.reqstatus.done", { device });
		case "stopped": return t("ai.reqstatus.stopped", { device });
		case "failed": return error ? t("ai.reqstatus.failedWhy", { device, reason: error }) : t("ai.reqstatus.failed", { device });
	}
}

function segment(parent: HTMLElement, d: DeviceRef, text: string): void {
	const seg = ajouter(parent, "span", "qbd-ai-origine-seg");
	currentHost().ui.setIcon(ajouter(seg, "span", "qbd-ai-origine-icone"), ROLE_ICON[d.role]);
	ajouter(seg, "span", "qbd-ai-origine-texte", text);
}

/** "Sent from A · Run on B" under the message, with the icon of each kind of device. One device that sent and ran it: one segment. */
export function peindreOrigine(parent: HTMLElement, sender: DeviceRef, runner: DeviceRef): void {
	const ligne = ajouter(parent, "div", "qbd-ai-origine");
	if (sender.id.toLowerCase() === runner.id.toLowerCase()) {
		segment(ligne, runner, t("ai.origin.sameDevice", { device: labelOf(runner) }));
		return;
	}
	segment(ligne, sender, t("ai.origin.sentFrom", { device: labelOf(sender) }));
	ajouter(ligne, "span", "qbd-ai-origine-sep", "·");
	segment(ligne, runner, t("ai.origin.runOn", { device: labelOf(runner) }));
}

/** The sender and the runner of a request that is not in the record (live line, waiting file, other device's run). */
export function refsOf(senderId: string, senderName: string | undefined, runnerId: string): { sender: DeviceRef; runner: DeviceRef } {
	const ctx = originContext();
	return { sender: resolveDevice(senderId, ctx, { name: senderName, sender: true, runnerId }), runner: resolveDevice(runnerId, ctx) };
}
