/* ══════════════════════════════════════════════════════════
   THE PC'S STATUS, as the phone's composer shows it — pure

   One verdict for the icon next to "+" and the window it opens: blue when a
   request will be taken, grey when the PC is away (paused, not reachable,
   never seen), red when something is wrong (the last request failed or
   expired, or the PC cannot run the phone's requests). Reachability reuses
   the same rules as the relay note (`pickTarget`, `pcReachable`).
══════════════════════════════════════════════════════════ */

import type { ChatRecord } from "./chat-record";
import type { PairedPeer } from "./remote-generations";
import { pcReachable, pickTarget, preferredPc } from "./remote-send";
import { deviceInfo, soleOnlinePc } from "../shared-state/devices";
import type { DeviceFile, DeviceKind } from "../shared-state/devices";
import { isStale } from "../shared-state/generations";
import type { GenerationsFile, RunningEntry } from "../shared-state/generations";
import type { RemoteRequest } from "../shared-state/remote-request";
import { pendingState } from "../shared-state/remote-request";

export type PcTone = "ok" | "off" | "error";
/** Why the tone is what it is: the window says it in words. */
export type PcReason = "running" | "ready" | "paused" | "away" | "never" | "failed" | "expired";

export interface PcStatus {
	tone: PcTone;
	reason: PcReason;
	/** The journal id of the PC a request would go to, null when none was ever seen. */
	device: string | null;
	/** Its computer kind from its device file, null when unknown (the icon then defaults to a laptop). */
	kind: DeviceKind | null;
	/** Its name when it can be told (a single paired device, or a single connected one), else null. */
	name: string | null;
	/** Epoch ms of the last sign of life, null when never. */
	seenAt: number | null;
	running: RunningEntry[];
	/** "Provider · model" of what the PC runs now, else of the last request, else null. */
	provider: string | null;
	/** The text of the last failure, for the "failed" reason. */
	error: string | null;
}

export interface PcStatusInput {
	chat: { origin: string } | null;
	files: ReadonlyArray<{ device: string; file: GenerationsFile }>;
	now: number;
	lastEver: string | null;
	peerConnected: boolean;
	peers: ReadonlyArray<PairedPeer>;
	chats: ReadonlyArray<ChatRecord>;
	own: ReadonlyArray<RemoteRequest>;
	device: string;
	/** The device files read from the synced folder (name, kind, models). */
	devices?: ReadonlyArray<DeviceFile>;
	/** The PC tapped in the PC window, if any. */
	chosen?: string | null;
}

/** The name of the PC when it is unambiguous: the only paired device, else the only connected one. */
export function pcName(peers: ReadonlyArray<PairedPeer>): string | null {
	if (peers.length === 1) return peers[0].name || null;
	const on = peers.filter(p => p.connected && !p.paused);
	return on.length === 1 ? on[0].name || null : null;
}

const label = (provider?: string, model?: string): string | null => [provider, model].filter(Boolean).join(" · ") || null;

export function pcStatus(i: PcStatusInput): PcStatus {
	const devices = i.devices ?? [];
	const device = pickTarget(i.chat, i.files, i.now, i.lastEver, preferredPc(i.chosen ?? null, devices), soleOnlinePc(i.peers, devices));
	const info = deviceInfo(devices, device);
	const file = device ? i.files.find(f => f.device === device)?.file ?? null : null;
	const peerSeen = i.peers.reduce<number | null>((m, p) => p.seenAt !== null && (m === null || p.seenAt > m) ? p.seenAt : m, null);
	const seenAt = i.peerConnected ? i.now : file?.at ?? peerSeen;
	const running = file && !isStale(file, i.now) ? file.running : [];
	const reachable = pcReachable(device, i.files, i.now, i.peerConnected);
	const mine = i.chats.flatMap(c => c.requests).filter(r => r.from === i.device).sort((a, b) => b.at - a.at);
	const newest = mine[0];
	const lastLabel = label(newest?.provider, newest?.model);
	const base = { device, kind: info?.kind ?? null, name: info?.name || pcName(i.peers), seenAt, running, error: null as string | null };
	const live = running[0] ? label(running[0].provider, running[0].model) : null;
	const expired = i.own.some(q => pendingState(q, { recorded: new Set(), running: new Set(), now: i.now }) === "expired");
	if (device && newest?.state === "failed" && newest.error) return { ...base, tone: "error", reason: "failed", provider: lastLabel, error: newest.error };
	if (device && expired) return { ...base, tone: "error", reason: "expired", provider: lastLabel };
	if (!device) return { ...base, tone: "off", reason: "never", provider: null };
	if (!reachable) return { ...base, tone: "off", reason: i.peers.length > 0 && i.peers.every(p => p.paused) ? "paused" : "away", provider: lastLabel };
	return { ...base, tone: "ok", reason: running.length > 0 ? "running" : "ready", provider: live ?? lastLabel };
}
