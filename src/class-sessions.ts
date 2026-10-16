/* ══════════════════════════════════════════════════════════
   A FOLDER'S CLASS SESSIONS (2026-10-16). Pure: no DOM, no host, no i18n.

   Three optional folder settings, synced and merged like the folder's name or
   colour (`MODULE_FIELDS`, `src/shared-state/merge.ts`): how many class
   sessions the course has, how long one lasts, how many there are per week.
   Each is stored as a decimal integer STRING (every folder setting is a
   string), within its bounds; anything else (`"0"`, `"06"`, `"6.5"`, `"1e2"`,
   a number, out of bounds) is damaged and read as absent, never guessed.
══════════════════════════════════════════════════════════ */

export const CLASS_SESSION_BOUNDS = {
	/** Number of class sessions of the course. */
	sessions: { min: 1, max: 200 },
	/** Length of one session, in minutes. */
	sessionMinutes: { min: 15, max: 600 },
	/** Sessions per week. */
	sessionsPerWeek: { min: 1, max: 14 },
} as const;

export type ClassSessionField = keyof typeof CLASS_SESSION_BOUNDS;
export const CLASS_SESSION_FIELDS = Object.keys(CLASS_SESSION_BOUNDS) as ClassSessionField[];

/** The number a stored value stands for, or null when it is absent or damaged. */
export function classSessionNumber(field: ClassSessionField, v: unknown): number | null {
	if (typeof v !== "string" || !/^[1-9][0-9]{0,3}$/.test(v)) return null;
	const n = Number(v);
	const b = CLASS_SESSION_BOUNDS[field];
	return n >= b.min && n <= b.max ? n : null;
}

export function isClassSessionValue(field: ClassSessionField, v: string): boolean {
	return classSessionNumber(field, v) !== null;
}

export interface ClassSessions {
	count?: number;
	minutes?: number;
	perWeek?: number;
}

/** The valid fields of a folder's settings; damaged ones are left out. */
export function readClassSessions(settings: Partial<Record<ClassSessionField, unknown>> | undefined): ClassSessions {
	const out: ClassSessions = {};
	const count = classSessionNumber("sessions", settings?.sessions);
	const minutes = classSessionNumber("sessionMinutes", settings?.sessionMinutes);
	const perWeek = classSessionNumber("sessionsPerWeek", settings?.sessionsPerWeek);
	if (count !== null) out.count = count;
	if (minutes !== null) out.minutes = minutes;
	if (perWeek !== null) out.perWeek = perWeek;
	return out;
}

/** What a typed field gives: `empty` (the field is cleared), a valid stored
    value, or `invalid` (nothing is written for it). Surrounding spaces are
    tolerated; anything else is taken as typed. */
export type ClassSessionInput = { kind: "empty" } | { kind: "value"; v: string } | { kind: "invalid" };

export function parseClassSessionInput(field: ClassSessionField, text: string): ClassSessionInput {
	const s = text.trim();
	if (!s) return { kind: "empty" };
	return isClassSessionValue(field, s) ? { kind: "value", v: s } : { kind: "invalid" };
}

/** The class-session length of a folder (a contract path), from the folder settings: the entry whose stored `path` is the folder, else the entry named like its last segment. Undefined when unknown. */
export function lectureMinutesOfFolder(overrides: Record<string, unknown> | undefined, folder: string): number | undefined {
	const all = overrides ?? {};
	const byPath = Object.values(all).find(o => !!o && typeof o === "object" && (o as { path?: unknown }).path === folder);
	const ov = byPath ?? all[folder.split("/").pop() as string];
	return readClassSessions(ov && typeof ov === "object" ? ov as Partial<Record<ClassSessionField, unknown>> : undefined).minutes;
}
