/* ══════════════════════════════════════════════════════════
   WHERE A REQUEST CAME FROM AND WHERE IT RUNS (PURE)

   A request has two devices: the one that SENT it (a phone, or the PC the
   user is sitting at) and the one that RUNS it (always a PC). The Generate
   page names both under the message, with the icon of each kind of device,
   and says what state the request is in on the runner.

   Names come from the devices' own files (`devices/<id>.json`); a phone
   writes no such file, so its name travels in the request (`fromName`) and is
   kept in the record. With neither, the caller shows a readable fallback.
   The kind of a device with no file is deduced: a sender that is not the
   runner is a phone. No DOM, no host, no clock.
══════════════════════════════════════════════════════════ */

import type { DeviceFile } from "./devices";

export type DeviceRole = "phone" | "laptop" | "desktop";

/** The Lucide icon of each kind of device. */
export const ROLE_ICON: Record<DeviceRole, "smartphone" | "laptop" | "monitor"> = { phone: "smartphone", laptop: "laptop", desktop: "monitor" };

export interface DeviceRef {
	id: string;
	/** The name the device gave itself, or null when nothing names it. */
	name: string | null;
	role: DeviceRole;
	/** The device this window runs on. */
	self: boolean;
}

export interface OriginContext {
	/** This device's id. */
	self: string;
	/** This device's own name, for when no device file names it (a phone). */
	selfName?: string;
	devices: ReadonlyArray<Pick<DeviceFile, "device" | "name" | "kind">>;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** One device: file first (name and kind), then the name the request carried, then the deduced kind. `isSender` and `runnerId` decide the kind of a device with no file. */
export function resolveDevice(id: string, ctx: OriginContext, hint: { name?: string; sender?: boolean; runnerId?: string } = {}): DeviceRef {
	const file = ctx.devices.find(d => same(d.device, id));
	const self = !!id && same(id, ctx.self);
	const name = file?.name.trim() || hint.name?.trim() || (self ? ctx.selfName?.trim() : "") || null;
	const role: DeviceRole = file ? file.kind : hint.sender && hint.runnerId !== undefined && !same(id, hint.runnerId) ? "phone" : "laptop";
	return { id, name, role, self };
}

/** The device that ran a recorded request: what the record says, else the device that wrote the chat when it is not the sender (an old record of a phone request), else the sender itself. */
export function runnerOf(q: { from: string; on?: string }, chatOrigin: string): string {
	return q.on || (chatOrigin && !same(q.from, chatOrigin) ? chatOrigin : q.from);
}

export function recordOrigin(q: { from: string; fromName?: string; on?: string }, chatOrigin: string, ctx: OriginContext): { sender: DeviceRef; runner: DeviceRef } {
	const runnerId = runnerOf(q, chatOrigin);
	return {
		sender: resolveDevice(q.from, ctx, { name: q.fromName, sender: true, runnerId }),
		runner: resolveDevice(runnerId, ctx),
	};
}

export interface DeviceWords { phone: string; pc: string; self: string }

/** "Xiaomi 13T Pro", "DESKTOP-1U89520 (this device)": the name, else a readable word for the kind. */
export function deviceLabel(d: DeviceRef, words: DeviceWords): string {
	const base = d.name || (d.role === "phone" ? words.phone : words.pc);
	return d.self ? `${base} (${words.self})` : base;
}

export type RequestStatus = "waiting" | "expired" | "running" | "paused" | "done" | "stopped" | "failed";

/** The sender of a chat for the sidebar: the first request's sender, else the device that wrote the chat. */
export function chatSender(requests: ReadonlyArray<{ from: string; fromName?: string }>, origin: string): { id: string; name?: string } {
	const first = requests[0];
	return first ? { id: first.from, ...(first.fromName ? { name: first.fromName } : {}) } : { id: origin };
}
