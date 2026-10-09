/* ══════════════════════════════════════════════════════════
   WHY AN INSTALLATION FAILED, AND WHAT TO DO (pure core)

   A bare "The installation could not continue" told the user nothing: not the
   cause, not what to change before clicking "Try again" (seen on a friend's PC,
   2026-10-09). This module turns the raw facts of a failure (errno, HTTP
   status, NSIS exit code, the step that was running) plus what the main
   process observed around it (an active VPN interface, DNS for another host,
   free disk space) into ONE cause from a closed list, with a short title, an
   explanation and one or two concrete steps, in English and French.

   Pure: no Node, no Electron, no DOM. Main, worker and renderer use it, and
   `npm run check:installer` exercises every rule on simulated errors.
══════════════════════════════════════════════════════════ */

import { t, type TransKey } from "../../../src/i18n";
import type {
	InstallerCause,
	InstallerDiagnosis,
	InstallerErrorDetail,
	InstallerStep,
	RetryAction,
	RetryResume,
} from "./protocole";

/* ─────────── VPN detection ─────────── */

/** Interface-name patterns of common VPN clients, with the name shown to the
    user. Windows reports the adapter's friendly name, which these clients set
    (`NordLynx`, `ProtonVPN`, `CloudflareWARP`, `Tailscale`...). An adapter the
    user renamed is not recognised: the message then stays VPN-agnostic. */
const VPN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
	[/nordlynx/i, "NordLynx"],
	[/proton/i, "ProtonVPN"],
	[/mullvad/i, "Mullvad"],
	[/cloudflare\s*-?\s*warp|^warp\b/i, "Cloudflare WARP"],
	[/tailscale/i, "Tailscale"],
	[/zerotier/i, "ZeroTier"],
	[/anyconnect|cisco/i, "Cisco AnyConnect"],
	[/forti/i, "FortiClient"],
	[/globalprotect|pangp/i, "GlobalProtect"],
	[/hamachi/i, "Hamachi"],
	[/openvpn/i, "OpenVPN"],
	[/wireguard|^wg\d*$/i, "WireGuard"],
	[/wintun/i, "Wintun"],
	[/tap-?windows|^tap\b|\btap\d/i, "TAP-Windows"],
];

/** Shape of `os.networkInterfaces()`, reduced to what is read. */
export type NetworkInterfaces = Record<string, ReadonlyArray<{ internal: boolean }> | undefined>;

/** The first VPN interface that is up with a non-internal address. Node lists
    only interfaces that are up, so a disconnected client is not reported. */
export function detectVpn(interfaces: NetworkInterfaces): { name: string; iface: string } | null {
	for (const [iface, addresses] of Object.entries(interfaces)) {
		if (!addresses?.some(address => !address.internal)) continue;
		const match = VPN_PATTERNS.find(([pattern]) => pattern.test(iface));
		if (match) return { name: match[1], iface };
	}
	return null;
}

/* ─────────── classification ─────────── */

const DNS_ERRORS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
const NO_ROUTE_ERRORS = new Set(["ENETUNREACH", "ENETDOWN"]);
const NETWORK_ERRORS = new Set([
	"ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ECONNABORTED", "EHOSTUNREACH", "EPIPE",
	"ESOCKETTIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
	// Our own codes: a redirect outside GitHub (captive portal, proxy page), a
	// `latest.yml` that is not one (an HTML page served with 200).
	"EREDIRECT", "EBADRELEASE",
]);
/** OpenSSL / Node certificate and handshake errors: someone between the PC and
    GitHub presents a certificate Node does not trust. */
function isTlsError(errno: string): boolean {
	return /^(CERT_|UNABLE_TO_|ERR_TLS_|ERR_SSL_)/.test(errno) ||
		errno === "SELF_SIGNED_CERT_IN_CHAIN" || errno === "DEPTH_ZERO_SELF_SIGNED_CERT" || errno === "EPROTO";
}
/** A file the installer just wrote could not be written, opened or found:
    what an antivirus does to a freshly downloaded program. */
const BLOCKED_FILE_ERRORS = new Set(["EPERM", "EACCES", "EBUSY", "ENOENT", "UNKNOWN", "EINVAL"]);

/** What the main process observed around the failure. */
export interface DiagnosisContext {
	/** Display name of an active VPN, or null. */
	vpn: string | null;
	/** Does DNS work for a host other than GitHub? `null` when not probed. */
	dnsElsewhere: boolean | null;
	/** Is the free space at the install location below what is needed?
	    Only consulted when NSIS itself failed: a low disk does not explain a
	    connection reset. */
	diskShort: boolean;
}

/** The cause, from the closed list. Order matters: the most specific fact
    wins, and `unknown` is only reached when no rule names the failure. */
export function diagnose(detail: InstallerErrorDetail, context: DiagnosisContext, code?: string): InstallerCause {
	const errno = detail.errno ?? "";
	if (errno === "ENOSPC") return "diskFull";
	if (code === "integrity") return "integrity";
	if (isTlsError(errno)) return "tlsInspection";
	if (DNS_ERRORS.has(errno)) return context.dnsElsewhere === false ? "offline" : "blocked";
	if (NO_ROUTE_ERRORS.has(errno)) return "offline";
	if (detail.http !== undefined) {
		if (detail.http === 404) return "publishing";
		if (detail.http === 429 || detail.http >= 500) return "server";
		return "blocked";
	}
	if (NETWORK_ERRORS.has(errno)) return context.dnsElsewhere === false ? "offline" : "blocked";
	if (detail.step === "download" && BLOCKED_FILE_ERRORS.has(errno)) return "antivirus";
	if ((detail.step === "launch" || detail.step === "worker") && BLOCKED_FILE_ERRORS.has(errno)) return "antivirus";
	if (detail.step === "postcheck") return "antivirus";
	if (detail.step === "install" && detail.exitCode !== undefined) {
		if (context.diskShort) return "diskFull";
		return detail.appRunning ? "appOpen" : "windowsRefused";
	}
	if (detail.step === "open") return "launch";
	return "unknown";
}

/** Where "Try again" resumes: a verified download is never fetched again. */
export function resumeFrom(detail: InstallerErrorDetail, cause: InstallerCause): RetryResume {
	if (detail.step === "init") return "init";
	if (cause === "launch") return "open";
	return detail.downloadVerified ? "install" : "download";
}

/** What "Try again" does before resuming. */
export interface RetryPlan {
	/** A quick request to GitHub first: if it still fails, say so at once
	    instead of starting the whole download again. */
	testConnection: boolean;
	/** Read `latest.yml` again (a version being published, or replaced). */
	reloadRelease: boolean;
	resume: RetryResume;
}

export function retryPlan(diagnosis: Pick<InstallerDiagnosis, "cause" | "resume">): RetryPlan {
	const { cause, resume } = diagnosis;
	return {
		testConnection: resume !== "init" && resume !== "open" &&
			(cause === "offline" || cause === "blocked" || cause === "tlsInspection"),
		reloadRelease: resume !== "init" && resume !== "open" &&
			(cause === "publishing" || cause === "integrity" || cause === "server"),
		resume,
	};
}

/** The status line shown while a retry runs. */
export function retryAction(plan: RetryPlan): RetryAction {
	if (plan.testConnection) return "connection";
	if (plan.reloadRelease) return "release";
	if (plan.resume === "open") return "open";
	return plan.resume === "install" ? "install" : "download";
}

/* ─────────── parsing a worker message ─────────── */

const STEPS: readonly InstallerStep[] = ["init", "worker", "download", "verify", "launch", "install", "postcheck", "open", "connection"];

function shortText(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
	return clean ? clean.slice(0, max) : undefined;
}

function integer(value: unknown): number | undefined {
	return Number.isInteger(value) && Math.abs(value as number) < 2 ** 32 ? value as number : undefined;
}

/** A detail received over the worker pipe, rebuilt field by field: nothing
    unbounded or unexpected reaches the window. */
export function parseErrorDetail(value: unknown): InstallerErrorDetail | null {
	if (!value || typeof value !== "object") return null;
	/* Own properties only: nothing inherited is read as a fact. */
	const v: Record<string, unknown> = Object.fromEntries(Object.entries(value));
	if (!STEPS.includes(v.step as InstallerStep)) return null;
	const detail: InstallerErrorDetail = { step: v.step as InstallerStep };
	const errno = shortText(v.errno, 64);
	if (errno && /^[A-Z0-9_]+$/.test(errno)) detail.errno = errno;
	const http = integer(v.http);
	if (http !== undefined && http >= 100 && http <= 599) detail.http = http;
	const host = shortText(v.host, 253);
	if (host && /^[a-z0-9.-]+$/i.test(host)) detail.host = host;
	const exitCode = integer(v.exitCode);
	if (exitCode !== undefined) detail.exitCode = exitCode;
	const message = shortText(v.message, 300);
	if (message) detail.message = message;
	if (v.appRunning === true) detail.appRunning = true;
	if (v.downloadVerified === true) detail.downloadVerified = true;
	return detail;
}

/* ─────────── what the window shows ─────────── */

/** The raw lines under "Technical details", copied as is. `key: value`, in
    English: they are meant for whoever helps, not translated prose. */
export function technicalDetails(
	cause: InstallerCause,
	detail: InstallerErrorDetail,
	context: DiagnosisContext & { vpnInterface?: string | null; version?: string | null; logPath?: string | null },
): string {
	const lines = [`cause: ${cause}`, `step: ${detail.step}`];
	if (detail.errno) lines.push(`error: ${detail.errno}`);
	if (detail.http !== undefined) lines.push(`http: ${detail.http}`);
	if (detail.host) lines.push(`host: ${detail.host}`);
	if (detail.exitCode !== undefined) lines.push(`exit code: ${detail.exitCode}`);
	if (detail.appRunning) lines.push("neo-quiz.exe running: yes");
	if (detail.downloadVerified) lines.push("download verified: yes");
	lines.push(`vpn: ${context.vpn ? `${context.vpn}${context.vpnInterface ? ` (${context.vpnInterface})` : ""}` : "none detected"}`);
	if (context.dnsElsewhere !== null) lines.push(`dns for another host: ${context.dnsElsewhere ? "ok" : "failed"}`);
	if (context.diskShort) lines.push("free space: too low");
	if (detail.message) lines.push(`message: ${detail.message}`);
	if (context.version) lines.push(`version: ${context.version}`);
	if (context.logPath) lines.push(`log: ${context.logPath}`);
	return lines.join("\n");
}

export interface DiagnosisTexts {
	title: string;
	body: string;
	steps: string[];
	/** "Same problem on the new attempt", or null. */
	again: string | null;
}

interface CauseKeys {
	title: TransKey;
	body: TransKey;
	step: TransKey;
	/** Variant naming the active VPN (network and TLS causes only). */
	vpn?: { title: TransKey; body: TransKey; step: TransKey };
}

/** Every cause has its keys here: a missing one is a compile error, not an
    English fallback leaking into the French window. */
const CAUSE_KEYS: Record<InstallerCause, CauseKeys> = {
	offline: {
		title: "installer.diagnosis.offline.title", body: "installer.diagnosis.offline.body", step: "installer.diagnosis.offline.step",
		vpn: { title: "installer.diagnosis.offline.title", body: "installer.diagnosis.offline.vpnBody", step: "installer.diagnosis.offline.vpnStep" },
	},
	blocked: {
		title: "installer.diagnosis.blocked.title", body: "installer.diagnosis.blocked.body", step: "installer.diagnosis.blocked.step",
		vpn: { title: "installer.diagnosis.blocked.vpnTitle", body: "installer.diagnosis.blocked.vpnBody", step: "installer.diagnosis.vpnStep" },
	},
	tlsInspection: {
		title: "installer.diagnosis.tlsInspection.title", body: "installer.diagnosis.tlsInspection.body", step: "installer.diagnosis.tlsInspection.step",
		vpn: { title: "installer.diagnosis.tlsInspection.vpnTitle", body: "installer.diagnosis.tlsInspection.vpnBody", step: "installer.diagnosis.vpnStep" },
	},
	integrity: {
		title: "installer.diagnosis.integrity.title", body: "installer.diagnosis.integrity.body", step: "installer.diagnosis.integrity.step",
		vpn: { title: "installer.diagnosis.integrity.title", body: "installer.diagnosis.integrity.vpnBody", step: "installer.diagnosis.vpnStep" },
	},
	publishing: { title: "installer.diagnosis.publishing.title", body: "installer.diagnosis.publishing.body", step: "installer.diagnosis.publishing.step" },
	server: { title: "installer.diagnosis.server.title", body: "installer.diagnosis.server.body", step: "installer.diagnosis.server.step" },
	diskFull: { title: "installer.diagnosis.diskFull.title", body: "installer.diagnosis.diskFull.body", step: "installer.diagnosis.diskFull.step" },
	antivirus: { title: "installer.diagnosis.antivirus.title", body: "installer.diagnosis.antivirus.body", step: "installer.diagnosis.antivirus.step" },
	windowsRefused: { title: "installer.diagnosis.windowsRefused.title", body: "installer.diagnosis.windowsRefused.body", step: "installer.diagnosis.windowsRefused.step" },
	appOpen: { title: "installer.diagnosis.appOpen.title", body: "installer.diagnosis.appOpen.body", step: "installer.diagnosis.appOpen.step" },
	launch: { title: "installer.diagnosis.launch.title", body: "installer.diagnosis.launch.body", step: "installer.diagnosis.launch.step" },
	unknown: { title: "installer.diagnosis.unknown.title", body: "installer.diagnosis.unknown.body", step: "installer.diagnosis.unknown.step" },
};

/** Title, explanation and numbered steps, translated AT RENDER time. With an
    active VPN, network and TLS causes NAME it; a retry that hits the same
    cause says it is still blocked. */
export function diagnosisTexts(diagnosis: Pick<InstallerDiagnosis, "cause" | "vpn" | "again" | "exitCode">): DiagnosisTexts {
	const { cause, vpn, again } = diagnosis;
	const keys = CAUSE_KEYS[cause];
	const vars = { vpn: vpn ?? "", code: diagnosis.exitCode ?? "?" };
	const last = t(cause === "launch" ? "installer.diagnosis.launch.step2" : "installer.diagnosis.thenRetry");
	if (vpn && keys.vpn) {
		return {
			title: t(again ? "installer.diagnosis.stillVpnTitle" : keys.vpn.title, vars),
			body: t(keys.vpn.body, vars),
			steps: [t(keys.vpn.step, vars), last],
			again: null,
		};
	}
	return {
		title: t(keys.title, vars),
		body: t(keys.body, vars),
		steps: [t(keys.step, vars), last],
		again: again ? t("installer.diagnosis.again") : null,
	};
}

/** The status shown while "Try again" works. */
const RETRY_KEYS: Record<RetryAction, TransKey> = {
	connection: "installer.retrying.connection",
	release: "installer.retrying.release",
	download: "installer.retrying.download",
	install: "installer.retrying.install",
	open: "installer.retrying.open",
};

export function retryStatus(action: RetryAction): string {
	return t(RETRY_KEYS[action]);
}
