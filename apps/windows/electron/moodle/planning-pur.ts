/* THE TIMETABLE OF THE MOODLE WINDOW, pure part (no disk, no network).

   The user pastes the link of their school timetable (an ICS feed: MyEfrei and
   most schools give one). The main process downloads it (`planning.ts`) and
   this module reads it: each module of the Moodle window shows the hours and
   the sessions of the timetable whose title or description carries its code.

   The feed is UNTRUSTED text from a third party: everything is bounded (size,
   events, fields) and nothing of it is ever rendered as HTML. The link itself
   holds a personal token: it never leaves the main process (`planning.ts`). */

import { nomHoteInterdit } from "./adresse";

export const MAX_LIEN = 2048;
export const MAX_ICS_OCTETS = 5 * 1024 * 1024;
export const MAX_SEANCES = 5000;
/** Text kept per session for matching (title + description). */
const MAX_TEXTE = 1000;
/** A session longer than this is not a class (an exam week, a holiday block): skipped. */
const MAX_MINUTES = 12 * 60;

export interface LienPlanning { url: string; hote: string }
/** `debut`: start in minutes on a naive clock (only compared with other starts);
    `cle`: identity of the session in the feed (UID, recurrence id, start). */
export interface Seance { texte: string; minutes: number; debut: number; cle: string }
/** `fin`: end of the last session, exams included (epoch ms; naive local for
    a feed without UTC times, a few hours off at most). `epreuves`: the starts
    of its exam sessions, which `minutes` and `seances` do NOT count (a
    syllabus volume counts teaching hours, not the written test). */
export interface Volume { minutes: number; seances: number; fin: number; epreuves: number[] }

/** An exam session, not a class: the activity field of an Efrei timetable
    ("Activité: DE", devoir écrit; "CE", the English written test), or a
    title that says so in any school's words. The title only: a course can be
    CALLED "Contrôle de gestion", so "contrôle" is never a sign. */
export function estEpreuve(texte: string): boolean {
	const nl = texte.indexOf("\n");
	const titre = nl < 0 ? texte : texte.slice(0, nl);
	if (/Activit[ée]\s*:\s*(DE|CE|DS|EXAM|EXAMEN|PARTIEL)\b/i.test(texte)) return true;
	return /(^|[^\p{L}])(examens?|exams?|partiels?|midterms?|final exam|devoir surveill[ée])(?![\p{L}])/iu.test(titre) || /(^|[^A-Za-z])DS(?![A-Za-z])/.test(titre);
}

export interface OptionsLien { /** Tests only: accept `http:` and a port. */ http?: boolean }

/** The timetable link the user pasted, or null. `webcal:` (what many
    calendars give) is read as `https:`. Only a public DNS name over https,
    without user info or port: the same rule as a Moodle site. */
export function lienPlanning(brut: unknown, opts: OptionsLien = {}): LienPlanning | null {
	if (typeof brut !== "string") return null;
	let s = brut.trim();
	if (!s || s.length > MAX_LIEN) return null;
	if (/^webcals?:\/\//i.test(s)) s = "https://" + s.replace(/^webcals?:\/\//i, "");
	let u: URL;
	try { u = new URL(s); } catch { return null; }
	if (u.protocol !== (opts.http ? "http:" : "https:")) return null;
	if (u.username || u.password || u.hash) return null;
	const h = u.hostname.toLowerCase();
	if (!opts.http) {
		if (u.port) return null;
		if (!h.includes(".") || h.endsWith(".local") || /^[\d.]+$/.test(h) || h.startsWith("[") || nomHoteInterdit(h)) return null;
	}
	return { url: u.href, hote: h };
}

/** Hosts that need no question: the timetable of the school whose Moodle is built in. */
export const HOTES_PLANNING_CONNUS: ReadonlySet<string> = new Set(["www.myefrei.fr", "myefrei.fr"]);

/** The value of an ICS text property, unescaped. */
const desechapper = (v: string): string => v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Splits `NAME;PARAM=...:VALUE` at the first colon outside double quotes. */
function decouper(ligne: string): { nom: string; params: string; valeur: string } | null {
	let guillemets = false;
	for (let i = 0; i < ligne.length; i++) {
		const c = ligne[i];
		if (c === "\"") guillemets = !guillemets;
		else if (c === ":" && !guillemets) {
			const tete = ligne.slice(0, i);
			const pv = tete.indexOf(";");
			return { nom: (pv < 0 ? tete : tete.slice(0, pv)).toUpperCase(), params: pv < 0 ? "" : tete.slice(pv + 1).toUpperCase(), valeur: ligne.slice(i + 1) };
		}
	}
	return null;
}

/** An ICS date-time as minutes on a naive clock, and whether it is UTC; null for a date alone or garbage. */
function instant(valeur: string, params: string): { min: number; utc: boolean } | null {
	if (/VALUE=DATE(?!-)/.test(params)) return null;
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(valeur.trim());
	if (!m) return null;
	const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
	if (!Number.isFinite(ms)) return null;
	return { min: ms / 60000, utc: m[7] === "Z" };
}

/** `PT1H30M`, `PT90M`, `P0DT2H`: minutes, or null. */
function duree(valeur: string): number | null {
	const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(valeur.trim().toUpperCase());
	if (!m || valeur.trim().length < 3) return null;
	return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) + Math.floor((+(m[4] ?? 0)) / 60);
}

/** The sessions of an ICS feed: one per timed event, cancelled ones dropped,
    duplicates (same UID, recurrence id and start) counted once. Recurrence
    rules are NOT expanded: a school feed lists each session (MyEfrei does). */
export function lireIcs(texte: string): Seance[] {
	if (texte.length > MAX_ICS_OCTETS) texte = texte.slice(0, MAX_ICS_OCTETS);
	const lignes = texte.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
	const out: Seance[] = [];
	const vus = new Set<string>();
	let ev: Record<string, { params: string; valeur: string }> | null = null;
	for (const ligne of lignes) {
		if (out.length >= MAX_SEANCES) break;
		const u = ligne.toUpperCase();
		if (u === "BEGIN:VEVENT") { ev = {}; continue; }
		if (u === "END:VEVENT") {
			const e = ev;
			ev = null;
			if (!e) continue;
			if ((e.STATUS?.valeur ?? "").trim().toUpperCase() === "CANCELLED") continue;
			const debut = e.DTSTART ? instant(e.DTSTART.valeur, e.DTSTART.params) : null;
			if (!debut) continue;
			let minutes: number | null = null;
			if (e.DTEND) {
				const fin = instant(e.DTEND.valeur, e.DTEND.params);
				if (fin && fin.utc === debut.utc) minutes = fin.min - debut.min;
			} else if (e.DURATION) {
				minutes = duree(e.DURATION.valeur);
			}
			if (minutes === null || !(minutes > 0) || minutes > MAX_MINUTES) continue;
			const cle = `${e.UID?.valeur ?? ""}|${e["RECURRENCE-ID"]?.valeur ?? ""}|${e.DTSTART.valeur}`;
			if (vus.has(cle)) continue;
			vus.add(cle);
			const texteEv = `${desechapper(e.SUMMARY?.valeur ?? "")}\n${desechapper(e.DESCRIPTION?.valeur ?? "")}`.slice(0, MAX_TEXTE);
			out.push({ texte: texteEv, minutes: Math.round(minutes), debut: debut.min, cle: cle.slice(0, 300) });
			continue;
		}
		if (!ev) continue;
		const p = decouper(ligne);
		// The first occurrence of a property wins; a field is bounded before it is kept.
		if (p && !(p.nom in ev) && /^[A-Z-]{1,40}$/.test(p.nom)) ev[p.nom] = { params: p.params.slice(0, 200), valeur: p.valeur.slice(0, 4000) };
	}
	return out;
}

/** The sessions known after a new download. A school feed is often a SLIDING
    window (MyEfrei keeps about one week of the past): a session that fell out
    of it is still a session the module had, so a known session that starts
    BEFORE the first one of the new feed is kept. From that point on, the new
    feed is the truth (a session it no longer lists was cancelled or moved).
    The most recent `MAX_SEANCES` are kept. */
export function fusionnerSeances(connues: readonly Seance[], nouvelles: readonly Seance[]): Seance[] {
	if (!nouvelles.length) return [...connues];
	const seuil = Math.min(...nouvelles.map(s => s.debut));
	const cles = new Set(nouvelles.map(s => s.cle));
	const passees = connues.filter(s => s.debut < seuil && !cles.has(s.cle));
	return [...passees, ...nouvelles].sort((a, b) => a.debut - b.debut).slice(-MAX_SEANCES);
}

/** Upper case, and a dash or space between the letters and the digits of a
    code dropped: `XCS-413` and `XCS413` are the same module. */
const normaliser = (s: string): string => s.toUpperCase().replace(/([A-Z])[-_ ]+(?=\d)/g, "$1");

/** The hours and sessions of each code: a session counts for a code when its
    text carries the code as a word (`XTI306-2627PSA01` counts for `XTI306`,
    `XTI3061` does not). Codes without a session are absent. */
export function volumesParCode(seances: readonly Seance[], codes: readonly string[]): Record<string, Volume> {
	const out: Record<string, Volume> = {};
	const textes = seances.map(s => ({ t: normaliser(s.texte), m: s.minutes, d: s.debut, e: estEpreuve(s.texte) }));
	for (const code of new Set(codes)) {
		const n = normaliser(code);
		if (!/^[A-Z0-9]{2,32}$/.test(n)) continue;
		const re = new RegExp(`(?<![A-Z0-9])${n}(?![0-9])`);
		let minutes = 0;
		let nb = 0;
		let fin = 0;
		const epreuves: number[] = [];
		for (const s of textes) {
			if (!re.test(s.t)) continue;
			fin = Math.max(fin, (s.d + s.m) * 60000);
			if (s.e) { if (epreuves.length < 10) epreuves.push(s.d * 60000); continue; }
			minutes += s.m;
			nb++;
		}
		if (nb || epreuves.length) out[code] = { minutes, seances: nb, fin, epreuves: epreuves.sort((a, b) => a - b) };
	}
	return out;
}
