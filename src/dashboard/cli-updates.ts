/* ══════════════════════════════════════════════════════════
   UPDATES OF THE AI CLIs (2026-10-03), MonoCode's "Harness update available".

   Why: the models offered for Claude Code and Codex are read from each CLI's
   own cache, and an OLD CLI does not know the newest models. Someone still
   on Claude Code 2.1.126 could not find Opus 5.5 without several manual
   steps and restarts. So the app compares the installed version with the
   latest published one and offers ONE click to update.

   The latest version comes from the npm registry
   (`registry.npmjs.org/<package>/latest`, a host of the network list). The
   update itself is the CLI's own official command (`claude update`, `codex
   update`), the only new call shape allowed by `gabarits-cli.ts`. After it,
   the CLI caches are re-read, so the new models show at once.
══════════════════════════════════════════════════════════ */

import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { checkClaudeCode, checkCodex, refreshCliCaches } from "./ai-providers";

export type OutilMaj = "claude" | "codex";

export interface MajCli {
	outil: OutilMaj;
	installee: string;
	derniere: string;
}

const PAQUETS: Record<OutilMaj, string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
const NOMS: Record<OutilMaj, string> = { claude: "Claude Code", codex: "Codex" };
/** The brand logo shown before each name (`BRAND_LOGOS` keys). */
const LOGOS: Record<OutilMaj, string> = { claude: "claude", codex: "openai" };
/** The latest versions are asked again after six hours at most. */
const TTL_MS = 6 * 60 * 60 * 1000;
/** An update downloads a binary: five minutes before giving up. */
const DUREE_MAX_MS = 5 * 60 * 1000;

/** "2.1.288" → [2, 1, 288]; anything after a `-` or a space is ignored. */
function parties(v: string): number[] {
	return v.trim().split(/[\s-]/)[0]!.split(".").map(n => Number.parseInt(n, 10)).map(n => (Number.isFinite(n) ? n : 0));
}

/** Is `a` strictly newer than `b`? Missing parts count as 0 ("1.2" = "1.2.0"). */
export function estPlusRecente(a: string, b: string): boolean {
	const x = parties(a);
	const y = parties(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return false;
}

/** A version as npm writes it, and nothing else (it ends up in the UI). */
const VERSION = /^\d{1,4}(?:\.\d{1,6}){1,3}$/;

const derniere: Partial<Record<OutilMaj, { at: number; version: string | null }>> = {};

async function derniereVersion(outil: OutilMaj): Promise<string | null> {
	const c = derniere[outil];
	if (c && Date.now() - c.at < TTL_MS) return c.version;
	let version: string | null = null;
	try {
		const r = await requireHost("net").fetchJson({ url: `https://registry.npmjs.org/${PAQUETS[outil]}/latest` });
		if (r && r.status === 200 && r.body) {
			const v = (JSON.parse(r.body) as { version?: unknown }).version;
			if (typeof v === "string" && VERSION.test(v)) version = v;
		}
	} catch { /* offline: no update shown */ }
	derniere[outil] = { at: Date.now(), version };
	return version;
}

/** The CLIs that are installed AND behind their latest version. */
export async function majsDisponibles(): Promise<MajCli[]> {
	if (!currentHost().platform.isDesktopApp) return [];
	const sondes: Array<[OutilMaj, Promise<{ ok: boolean; version?: string }>]> = [["claude", checkClaudeCode()], ["codex", checkCodex()]];
	const out: MajCli[] = [];
	for (const [outil, sonde] of sondes) {
		const s = await sonde.catch(() => ({ ok: false }));
		const installee = s.ok && "version" in s ? (s.version ?? "") : "";
		if (!installee || !VERSION.test(installee.split(/[\s-]/)[0]!)) continue;
		const d = await derniereVersion(outil);
		if (d && estPlusRecente(d, installee)) out.push({ outil, installee, derniere: d });
	}
	return out;
}

/** What the panel shows as the reason of a failed update: the last line
    that names an error, else the last line printed (a CLI often ends on a
    "retrying…" that explains nothing). Colour codes and blank lines
    dropped, at most 240 chars. */
export function raisonEchec(stderr: string, stdout: string): string {
	// eslint-disable-next-line no-control-regex
	const lignes = `${stderr}\n${stdout}`.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const erreurs = lignes.filter(l => /\b(error|err!|failed|fail|denied|eacces|eperm|enoent|not found|unable|cannot|could not|forbidden|refused|timed? ?out)\b/i.test(l));
	const retenues = erreurs.length ? erreurs : lignes;
	return (retenues[retenues.length - 1] ?? "").slice(0, 240);
}

export type ResultatMaj = { ok: true } | { ok: false; raison: string };

/** Runs the CLI's own update. On failure, the reason it gave (2026-10-05:
    a bare "could not be updated" left the owner with nothing to do). */
export async function mettreAJour(outil: OutilMaj): Promise<ResultatMaj> {
	try {
		const r = await requireHost("process").run({ tool: outil, args: ["update"], stdin: "", timeoutMs: DUREE_MAX_MS });
		if (r.code !== 0) return { ok: false, raison: raisonEchec(r.stderr, r.stdout) || t("ai.update.noReason", { code: String(r.code ?? "?") }) };
	} catch (e) {
		return { ok: false, raison: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240) };
	}
	/* The new version, and the models it knows, at once: the version probes
	   are asked again and the CLI caches re-read. */
	await Promise.all([outil === "claude" ? checkClaudeCode(true) : checkCodex(true), refreshCliCaches().catch(() => false)]);
	return { ok: true };
}

/* ══════════════════════════════════════════════════════════
   AUTOMATIC UPDATES (2026-10-10). The banner with its Update button is gone:
   at the app's start and every six hours, a CLI behind its latest version is
   updated in the background with its own command, even during a generation.
   Both CLIs install each version BESIDE the previous ones and switch a
   pointer (`~/.local/share/claude/versions/`, Codex's `releases/` and its
   `current` link), so a running CLI keeps its version and the next run
   takes the new one. Two exceptions wait for a click in the logo menu: a
   metered connection, and a failed update (no retry loop). The logo menu
   (`apps/windows/src/ui/menu-app.ts`) shows these states, and nothing else.
══════════════════════════════════════════════════════════ */

export type PhaseMajCli = "en-cours" | "echec" | "attente";
/** `logo`: a `BRAND_LOGOS` key (`setBrandLogo`). */
export interface EtatMajCli { outil: OutilMaj; nom: string; logo: string; derniere: string; phase: PhaseMajCli; raison?: string }

const etatsCli = new Map<OutilMaj, EtatMajCli>();
const abonnesCli = new Set<(etats: EtatMajCli[]) => void>();
let limiteeCli: () => Promise<boolean> = async () => false;
let passeEnCours: Promise<void> = Promise.resolve();

function publierCli(): void {
	const liste = [...etatsCli.values()];
	for (const a of abonnesCli) a(liste);
}

/** The CLI updates the logo menu has to show (running, failed, waiting for a click). */
export function suivreMajCli(rappel: (etats: EtatMajCli[]) => void): () => void {
	abonnesCli.add(rappel);
	rappel([...etatsCli.values()]);
	return () => { abonnesCli.delete(rappel); };
}

async function lancerMaj(m: MajCli): Promise<void> {
	etatsCli.set(m.outil, { outil: m.outil, nom: NOMS[m.outil], logo: LOGOS[m.outil], derniere: m.derniere, phase: "en-cours" });
	publierCli();
	const r = await mettreAJour(m.outil);
	if (r.ok) etatsCli.delete(m.outil);
	else etatsCli.set(m.outil, { outil: m.outil, nom: NOMS[m.outil], logo: LOGOS[m.outil], derniere: m.derniere, phase: "echec", raison: r.raison });
	publierCli();
}

/** One pass: every CLI behind is updated, unless the connection is metered or
    its last update failed; `force` is the CLI whose row was clicked. */
async function passeMajCli(force: OutilMaj | null): Promise<void> {
	const majs = await majsDisponibles();
	const limitee = await limiteeCli().catch(() => false);
	for (const outil of [...etatsCli.keys()]) {
		if (etatsCli.get(outil)?.phase !== "en-cours" && !majs.some(m => m.outil === outil)) etatsCli.delete(outil);
	}
	publierCli();
	for (const m of majs) {
		const avant = etatsCli.get(m.outil);
		if (avant?.phase === "en-cours") continue;
		if (force !== m.outil && (limitee || avant?.phase === "echec")) {
			if (limitee && avant?.phase !== "echec") { etatsCli.set(m.outil, { outil: m.outil, nom: NOMS[m.outil], logo: LOGOS[m.outil], derniere: m.derniere, phase: "attente" }); publierCli(); }
			continue;
		}
		await lancerMaj(m);
	}
}

const enchainer = (force: OutilMaj | null): Promise<void> =>
	(passeEnCours = passeEnCours.then(() => passeMajCli(force)).catch(() => undefined));

/** Starts the automatic CLI updates (desktop app only); returns the stop. */
export function demarrerMajCliAuto(deps: { limitee(): Promise<boolean> }): () => void {
	if (!currentHost().platform.isDesktopApp) return () => {};
	limiteeCli = deps.limitee;
	void enchainer(null);
	const minuteur = window.setInterval(() => { void enchainer(null); }, TTL_MS);
	return () => window.clearInterval(minuteur);
}

/** The click on a CLI row of the logo menu: update this one now. */
export function relancerMajCli(outil: OutilMaj): void {
	void enchainer(outil);
}
