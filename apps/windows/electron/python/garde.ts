/* ══════════════════════════════════════════════════════════
   THE GATE BEFORE A PYTHON RUN, in the MAIN process (final review I1, I2)

   Python runs natively, with the user's files and the Internet. The window
   (the renderer) may be compromised: whatever it says, it must never be
   able to run code that nobody at this PC accepted. So the decision lives
   here, behind two native dialogs written and translated by this process:

   - A LOCAL RUN (a click on ▶ in this PC's window): a warning before EVERY
     run, with the code itself in the dialog (first 20 lines, each cut at 200
     characters, an explicit line when something is hidden). "Don't show
     again for this quiz" remembers `<sourcePath>#<sha256 of the code>`, the
     hash computed HERE from the bytes about to run, in a file under
     `userData/python/` that no bridge channel reads or writes (never the
     `reglages` store). A window that lies about `sourcePath` can only reuse
     a key for byte-identical code the user already accepted.
   - A REMOTE RUN (asked by a paired phone, `distant.ts`): one authorization
     per device, asked the first time that device's request is about to run,
     remembered in another main-only file with the public key that signed
     the request; a refusal is remembered too, per Syncthing device, so a
     device cannot make the question come back until the owner removes it in
     Settings. The phone showed its own warning.

   One dialog at a time: a second request while one is open is refused, so a
   window cannot stack dialogs. No Electron import: the dialog is injected
   (`canaux.ts` passes `dialog.showMessageBox` on the main window), so
   `scripts/check-python-service.mjs` drives this module with a fake one.
══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_PREFIX } from "../../../../src/branding";
import type { CodeRun } from "../../../../src/host/types";

/** Keys remembered at most; the oldest are dropped first. */
export const MAX_AVERTISSEMENTS = 500;
/** Devices remembered at most (a phone, a tablet: a handful in practice). */
export const MAX_APPAREILS = 50;
/** What the dialog shows of the code. */
export const LIGNES_APERCU = 20;
export const LARGEUR_APERCU = 200;
/** A sourcePath longer than this is refused (a contract path is short). */
export const MAX_SOURCE_PATH = 1024;

/** Bidi overrides and isolates, zero-width and direction marks, BOM: text
    that hides or reorders what the reader sees (Trojan Source). */
const INVISIBLES = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/;
const INVISIBLES_G = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g;
/** Other control characters (tab excepted) are shown as a replacement too:
    the dialog is plain text, but a CR or an escape must not shape it. */
const CONTROLES_G = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

export interface ApercuCode {
	/** The lines shown, already cut and cleaned. */
	lignes: string[];
	/** Lines of the code that are not shown (past the 20th). */
	restantes: number;
	/** At least one line is longer than 200 characters. */
	longues: boolean;
	/** The code holds bidi or invisible characters. */
	invisibles: boolean;
}

/** What the dialog shows of `code`. Pure. */
export function apercuCode(code: string): ApercuCode {
	const toutes = code.replace(/\r\n?/g, "\n").split("\n");
	if (toutes.length > 1 && toutes[toutes.length - 1] === "") toutes.pop();
	const nettoyer = (l: string): string => l.replace(/\t/g, "    ").replace(INVISIBLES_G, "�").replace(CONTROLES_G, "�");
	return {
		lignes: toutes.slice(0, LIGNES_APERCU).map((l) => {
			const propre = nettoyer(l);
			return propre.length > LARGEUR_APERCU ? propre.slice(0, LARGEUR_APERCU) + "…" : propre;
		}),
		restantes: Math.max(0, toutes.length - LIGNES_APERCU),
		longues: toutes.some((l) => l.length > LARGEUR_APERCU),
		invisibles: INVISIBLES.test(code),
	};
}

/** The texts of the two dialogs, resolved by the MAIN process (`t()` on the
    language `main.ts` set), never received from the window. */
export interface LibellesGarde {
	titre: string;
	message: string;
	lancer: string;
	annuler: string;
	nePlusAfficher: string;
	lignesRestantes(n: number): string;
	lignesLongues: string;
	invisibles: string;
	appareilTitre: string;
	appareilMessage(nom: string): string;
	appareilDetail: string;
	autoriser: string;
	refuser: string;
}

/** The options handed to the native dialog (a subset of Electron's). */
export interface OptionsDialogue {
	type: "warning" | "question";
	title: string;
	message: string;
	detail: string;
	buttons: string[];
	defaultId: number;
	cancelId: number;
	noLink: true;
	checkboxLabel?: string;
	checkboxChecked?: boolean;
}
export type DialogueNatif = (o: OptionsDialogue) => Promise<{ response: number; checkboxChecked: boolean }>;

/** The detail of the run warning: the code, then what it does not show. */
export function detailAvertissement(code: string, l: LibellesGarde): string {
	const a = apercuCode(code);
	const notes: string[] = [];
	if (a.restantes > 0) notes.push(l.lignesRestantes(a.restantes));
	if (a.longues) notes.push(l.lignesLongues);
	if (a.invisibles) notes.push(l.invisibles);
	return a.lignes.join("\n") + (notes.length ? "\n\n" + notes.join("\n") : "");
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `texte`. */
export const sha256 = (texte: string | Uint8Array): string => createHash("sha256").update(texte).digest("hex");

/* ── The two main-only files ── */

/** A small JSON file read once, then kept in memory and rewritten whole
    (temp file, then rename). Unreadable or malformed: empty. */
function fichierJson<T>(chemin: string, lire: (brut: unknown) => T, vide: () => T, serialiser: (v: T) => unknown): { valeur(): T; ecrire(v: T): void } {
	let courant: T | null = null;
	return {
		valeur() {
			if (courant === null) {
				try { courant = lire(JSON.parse(readFileSync(chemin, "utf8"))); } catch { courant = vide(); }
			}
			return courant;
		},
		ecrire(v) {
			courant = v;
			try {
				mkdirSync(dirname(chemin), { recursive: true });
				writeFileSync(chemin + ".tmp", JSON.stringify(serialiser(v)), "utf8");
				renameSync(chemin + ".tmp", chemin);
			} catch (e) {
				/* Kept in memory for this session; asked again after a restart. */
				console.warn(LOG_PREFIX, "python gate file not written:", chemin, e);
			}
		},
	};
}

export interface MemoireAvertissements { contient(cle: string): boolean; ajouter(cle: string): void }

export function creerMemoireAvertissements(chemin: string): MemoireAvertissements {
	const f = fichierJson<string[]>(chemin, (b) => {
		const cles = (b as { cles?: unknown } | null)?.cles;
		return Array.isArray(cles) ? cles.filter((c): c is string => typeof c === "string").slice(-MAX_AVERTISSEMENTS) : [];
	}, () => [], (cles) => ({ v: 1, cles }));
	return {
		contient: (cle) => f.valeur().includes(cle),
		ajouter(cle) {
			const liste = f.valeur().filter((c) => c !== cle);
			liste.push(cle);
			f.ecrire(liste.slice(-MAX_AVERTISSEMENTS));
		},
	};
}
/** A device allowed to run Python here: its Neo Quiz id (its folder name in
    `.neo-quiz/code-runs/requests/`), bound to the Syncthing device that
    writes there AND to the public key that signs its requests (pinned on the
    owner's "Allow": Syncthing's word on who wrote a file is the sender's
    own), and the name shown when it was allowed. */
export interface AppareilAutorise { appareil: string; syncthing: string; cle: string; nom: string; at: number }
/** A Syncthing device the owner refused: asked again only once removed in Settings. */
export interface AppareilRefuse { syncthing: string; nom: string; at: number }
/** What Settings lists (`neo:python/appareils`), keyed by Syncthing device. */
export interface LigneAppareil { id: string; nom: string; etat: "autorise" | "refuse"; at: number }

export interface AutorisationsAppareils {
	/** The entry of this Neo Quiz device id, if any. */
	trouver(appareil: string): AppareilAutorise | null;
	/** The allowed entry bound to this Syncthing device, if any. */
	parSyncthing(syncthing: string): AppareilAutorise | null;
	ajouter(a: AppareilAutorise): void;
	refuse(syncthing: string): boolean;
	refuser(r: AppareilRefuse): void;
	lister(): LigneAppareil[];
	/** Forgets every entry of this Syncthing device: its next request asks again. */
	oublier(syncthing: string): void;
}

/** A public key as `code-run-request.ts` accepts it (base64url, 65 bytes). */
const CLE_PUBLIQUE = /^[A-Za-z0-9_-]{87}$/;

export function creerAutorisationsAppareils(chemin: string): AutorisationsAppareils {
	type Contenu = { appareils: AppareilAutorise[]; refus: AppareilRefuse[] };
	const f = fichierJson<Contenu>(chemin, (b) => {
		const o = (b ?? {}) as { appareils?: unknown; refus?: unknown };
		/* An entry without a pinned key (written before requests were signed)
		   is dropped: that device is asked again. */
		const appareils = (Array.isArray(o.appareils) ? o.appareils : []).filter((a): a is AppareilAutorise => !!a && typeof a === "object"
			&& typeof (a as AppareilAutorise).appareil === "string" && typeof (a as AppareilAutorise).syncthing === "string"
			&& typeof (a as AppareilAutorise).cle === "string" && CLE_PUBLIQUE.test((a as AppareilAutorise).cle)
			&& typeof (a as AppareilAutorise).nom === "string" && typeof (a as AppareilAutorise).at === "number").slice(-MAX_APPAREILS);
		const refus = (Array.isArray(o.refus) ? o.refus : []).filter((r): r is AppareilRefuse => !!r && typeof r === "object"
			&& typeof (r as AppareilRefuse).syncthing === "string" && typeof (r as AppareilRefuse).nom === "string"
			&& typeof (r as AppareilRefuse).at === "number").slice(-MAX_APPAREILS);
		return { appareils, refus };
	}, () => ({ appareils: [], refus: [] }), (c) => ({ v: 2, ...c }));
	const meme = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
	return {
		trouver: (appareil) => f.valeur().appareils.find((a) => meme(a.appareil, appareil)) ?? null,
		parSyncthing: (syncthing) => f.valeur().appareils.find((a) => a.syncthing === syncthing) ?? null,
		ajouter(a) {
			const c = f.valeur();
			const appareils = c.appareils.filter((x) => !meme(x.appareil, a.appareil) && x.syncthing !== a.syncthing);
			appareils.push(a);
			f.ecrire({ appareils: appareils.slice(-MAX_APPAREILS), refus: c.refus.filter((r) => r.syncthing !== a.syncthing) });
		},
		refuse: (syncthing) => f.valeur().refus.some((r) => r.syncthing === syncthing),
		refuser(r) {
			const c = f.valeur();
			const refus = c.refus.filter((x) => x.syncthing !== r.syncthing);
			refus.push(r);
			f.ecrire({ appareils: c.appareils.filter((a) => a.syncthing !== r.syncthing), refus: refus.slice(-MAX_APPAREILS) });
		},
		lister() {
			const c = f.valeur();
			return [
				...c.appareils.map((a): LigneAppareil => ({ id: a.syncthing, nom: nomAffiche(a.nom) || a.syncthing.slice(0, 7), etat: "autorise", at: a.at })),
				...c.refus.map((r): LigneAppareil => ({ id: r.syncthing, nom: nomAffiche(r.nom) || r.syncthing.slice(0, 7), etat: "refuse", at: r.at })),
			];
		},
		oublier(syncthing) {
			const c = f.valeur();
			f.ecrire({ appareils: c.appareils.filter((a) => a.syncthing !== syncthing), refus: c.refus.filter((r) => r.syncthing !== syncthing) });
		},
	};
}

/* ── The gate ── */

export interface GardePython {
	/** A local run: `true` when this exact code may run now (already
	    dismissed for this key, or Run pressed). Cancel, a closed dialog, a
	    dialog already open, a bad `sourcePath`: `false`. */
	autoriserLocal(sourcePath: unknown, code: string): Promise<boolean>;
	/** A remote device's first run: the owner's answer, or `null` when there is
	    none (a dialog already open, a dialog that failed). */
	autoriserAppareil(nom: string): Promise<"autoriser" | "refuser" | null>;
}

export interface DepsGarde {
	dialogue: DialogueNatif;
	libelles(): LibellesGarde;
	avertissements: MemoireAvertissements;
}

/** A device name as the dialog shows it: one line, no control or bidi character, 64 at most. */
export const nomAffiche = (nom: string): string => nom.replace(INVISIBLES_G, "").replace(CONTROLES_G, " ").replace(/\s+/g, " ").trim().slice(0, 64);

export function creerGardePython(deps: DepsGarde): GardePython {
	let ouvert = false;
	async function unSeul<T>(defaut: T, f: () => Promise<T>): Promise<T> {
		if (ouvert) return defaut;
		ouvert = true;
		try { return await f(); } catch (e) { console.warn(LOG_PREFIX, "python gate dialog failed:", e); return defaut; } finally { ouvert = false; }
	}
	return {
		async autoriserLocal(sourcePath, code) {
			if (typeof sourcePath !== "string" || sourcePath.length === 0 || sourcePath.length > MAX_SOURCE_PATH) return false;
			const cle = sourcePath + "#" + sha256(code);
			if (deps.avertissements.contient(cle)) return true;
			return unSeul(false, async () => {
				const l = deps.libelles();
				const { response, checkboxChecked } = await deps.dialogue({
					type: "warning",
					title: l.titre,
					message: l.message,
					detail: detailAvertissement(code, l),
					buttons: [l.lancer, l.annuler],
					defaultId: 1,
					cancelId: 1,
					noLink: true,
					checkboxLabel: l.nePlusAfficher,
					checkboxChecked: false,
				});
				if (response !== 0) return false;
				if (checkboxChecked === true) deps.avertissements.ajouter(cle);
				return true;
			});
		},
		autoriserAppareil(nom) {
			return unSeul<"autoriser" | "refuser" | null>(null, async () => {
				const l = deps.libelles();
				const { response } = await deps.dialogue({
					type: "question",
					title: l.appareilTitre,
					message: l.appareilMessage(nomAffiche(nom) || "?"),
					detail: l.appareilDetail,
					buttons: [l.autoriser, l.refuser],
					defaultId: 1,
					cancelId: 1,
					noLink: true,
				});
				/* Refuse, Esc and closing the dialog are all `cancelId`: a refusal. */
				return response === 0 ? "autoriser" : "refuser";
			});
		},
	};
}

/* ── The one path from the bridge to a Python spawn ── */

export interface JobPorte {
	code: string;
	/** Present for a phone's request only (`distant.ts` judges it whole). */
	distant?: unknown;
	/** The note of a local run: the warning's key. */
	sourcePath?: unknown;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface DepsPorte {
	garde: Pick<GardePython, "autoriserLocal">;
	distant: { executer(job: { code: string; distant: unknown; signal?: AbortSignal }): Promise<CodeRun> };
	service: { run(job: { code: string; timeoutMs: number; signal?: AbortSignal }): Promise<CodeRun> };
	/** Counts the run as "in progress" (`canaux.ts`'s `trackRun`); a dialog
	    waiting for an answer is never inside it. */
	suivre<T>(op: () => Promise<T>): Promise<T>;
}

/** What `canaux.ts` calls for every Python job of the window: a phone's
    request goes to `distant.ts`, anything else passes the native warning
    first. Never a spawn without one or the other. */
export async function executerPorte(job: JobPorte, deps: DepsPorte): Promise<CodeRun> {
	if (job.distant !== undefined) return deps.suivre(() => deps.distant.executer({ code: job.code, distant: job.distant, signal: job.signal }));
	if (!(await deps.garde.autoriserLocal(job.sourcePath, job.code))) return { status: "unavailable", stdout: "", error: "cancelled" };
	if (job.signal.aborted) return { status: "unavailable", stdout: "" };
	return deps.suivre(() => deps.service.run({ code: job.code, timeoutMs: job.timeoutMs, signal: job.signal }));
}
