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
import { ajouter } from "../dom";
import { t } from "../i18n";
import { checkClaudeCode, checkCodex, refreshCliCaches, setBrandLogo } from "./ai-providers";

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

/** The last meaningful line a failed update printed: what the panel shows
    as the reason. Colour codes and blank lines dropped, at most 240 chars. */
export function raisonEchec(stderr: string, stdout: string): string {
	// eslint-disable-next-line no-control-regex
	const lignes = `${stderr}\n${stdout}`.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	return (lignes[lignes.length - 1] ?? "").slice(0, 240);
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

/** A dismissed update stays hidden until a newer one comes out (per viewer). */
const CLE_IGNOREE = "nq-maj-cli-ignoree:";
function ignoree(m: MajCli): boolean {
	try { return localStorage.getItem(CLE_IGNOREE + m.outil) === m.derniere; } catch { return false; }
}
function ignorer(m: MajCli): void {
	try { localStorage.setItem(CLE_IGNOREE + m.outil, m.derniere); } catch { /* storage unavailable: shown again next time */ }
}

/**
 * Mounts the banner into `parent` when an update is available: one row per
 * CLI (logo, "Codex 0.159.0 → 0.160.0", Update) and a close button. Empty otherwise. `apres` runs after a successful update
 * (the page re-reads its providers and models). Returns the unmount.
 */
export function monterBandeauMaj(parent: HTMLElement, apres: () => void, opts: { fermable?: boolean } = {}): () => void {
	const fermable = opts.fermable !== false;
	let demonte = false;
	const zone = ajouter(parent, "div", "qbd-cli-maj");
	zone.hidden = true;
	zone.setAttribute("role", "status");

	function peindre(majs: MajCli[]): void {
		if (demonte) return;
		const visibles = fermable ? majs.filter(m => !ignoree(m)) : majs;
		zone.replaceChildren();
		zone.hidden = visibles.length === 0;
		if (zone.hidden) return;
		const tete = ajouter(zone, "div", "qbd-cli-maj-tete");
		ajouter(tete, "span", "qbd-cli-maj-titre", t("ai.update.title"));
		if (fermable) {
			const fermer = ajouter(tete, "button", "qbd-cli-maj-fermer");
			fermer.type = "button";
			fermer.setAttribute("aria-label", t("ai.update.dismiss"));
			currentHost().ui.setIcon(fermer, "x");
			fermer.addEventListener("click", () => { for (const m of visibles) ignorer(m); zone.hidden = true; });
		}
		for (const m of visibles) {
			const l = ajouter(zone, "div", "qbd-cli-maj-ligne");
			let erreur: HTMLElement | null = null;
			const nom = ajouter(l, "span", `qbd-cli-maj-nom is-${m.outil}`);
			setBrandLogo(ajouter(nom, "span", "qbd-cli-maj-logo"), LOGOS[m.outil]);
			ajouter(nom, "span", undefined, NOMS[m.outil]);
			ajouter(l, "span", "qbd-cli-maj-versions", `${m.installee} → ${m.derniere}`);
			const b = ajouter(l, "button", "qbd-cli-maj-bouton");
			b.type = "button";
			const icone = ajouter(b, "span", "qbd-cli-maj-bouton-icone");
			currentHost().ui.setIcon(icone, "download");
			const libelle = ajouter(b, "span", undefined, t("ai.update.button"));
			b.addEventListener("click", () => {
				b.disabled = true;
				b.classList.add("is-loading");
				b.setAttribute("aria-busy", "true");
				icone.replaceChildren();
				currentHost().ui.setIcon(icone, "loader");
				libelle.textContent = t("ai.update.updating");
				erreur?.remove();
				erreur = null;
				void mettreAJour(m.outil).then(res => {
					if (demonte) return;
					if (!res.ok) {
						/* Why it failed, then what to do: the npm command to run by
						   hand, and the package's page (2026-10-05). */
						erreur = ajouter(zone, "div", "qbd-cli-maj-erreur");
						l.after(erreur);
						ajouter(erreur, "p", "qbd-cli-maj-erreur-titre", t("ai.update.failed", { name: NOMS[m.outil] }));
						if (res.raison) ajouter(erreur, "p", "qbd-cli-maj-erreur-raison", res.raison);
						ajouter(erreur, "p", "qbd-cli-maj-erreur-aide", t("ai.update.manual"));
						ajouter(erreur, "code", "qbd-cli-maj-erreur-cmd", `npm install -g ${PAQUETS[m.outil]}@latest`);
						const lien = ajouter(erreur, "a", "qbd-cli-maj-erreur-lien", t("ai.update.packagePage"));
						const url = `https://www.npmjs.com/package/${PAQUETS[m.outil]}`;
						lien.href = url;
						lien.addEventListener("click", ev => { ev.preventDefault(); void currentHost().shell.openUrl(url); });
						b.disabled = false;
						b.classList.remove("is-loading");
						b.removeAttribute("aria-busy");
						icone.replaceChildren();
						currentHost().ui.setIcon(icone, "download");
						libelle.textContent = t("ai.update.button");
						return;
					}
					currentHost().ui.notice(t("ai.update.done", { name: NOMS[m.outil], version: m.derniere }));
					apres();
					void majsDisponibles().then(peindre).catch(() => undefined);
				});
			});
		}
	}

	void majsDisponibles().then(peindre).catch(() => undefined);
	return () => { demonte = true; zone.remove(); };
}
