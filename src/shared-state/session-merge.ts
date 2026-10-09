import type { EtatQuestion, SessionQuiz } from "../engine/session";

/* ══════════════════════════════════════════════════════════
   MERGING THE SNAPSHOTS OF ONE QUIZ ACROSS DEVICES (2026-10-09)

   PURE: no DOM, no host, no clock. The old rule, "the snapshot written
   last wins WHOLE", lost progress: a phone that reopened an old snapshot
   and answered one question wrote a 6-question snapshot that outranked the
   laptop's 54, and the card went from 100 % to 11 %.

   Now the snapshots are merged QUESTION BY QUESTION, after a RESET POINT:

   - a tombstone (`tombe`) is a quiz finished or restarted; it is replaced
     in its device's file by that device's next snapshot, so the reset must
     also live IN the snapshots: `depuis` is when the attempt they belong to
     began. A snapshot of an older attempt (its `depuis` is before the
     latest attempt's) is ignored, whatever its `ecrite`;
   - a snapshot written before a tombstone is ignored; a tombstone newer
     than everything leaves the quiz reset;
   - a snapshot without `depuis` (written before this existed) is an
     attempt begun at an unknown date: it merges with the others, unless
     a reset point is later than it;
   - per question id, the most advanced entry wins (checked over not
     checked, then answered over not, then the latest snapshot);
   - the other fields come from the latest snapshot; `courante` never makes
     a reopened quiz go back: see `choisirCourante`.
══════════════════════════════════════════════════════════ */

export interface TombeSession { tombe: true; ecrite: number }
export type EntreeSession = SessionQuiz | TombeSession;

const estTombe = (s: EntreeSession): s is TombeSession => (s as TombeSession).tombe === true;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A question checked (Learn or text-only). */
export const estVerifiee = (q: EtatQuestion | undefined): boolean => !!q && (q.verifiee === true || q.verifieeLearn === true);

function aReponse(q: EtatQuestion): boolean {
	if (q.verdict || q.verifiee || q.verifieeLearn || q.jnsp || (typeof q.texte === "string" && q.texte.trim())) return true;
	const sel = q.selection;
	if (sel === null || sel === undefined || sel === "") return false;
	return Array.isArray(sel) ? sel.some(v => v !== null && v !== "") : true;
}

/** 3 checked and settled, 2 checked but missed (waiting for its retry),
    1 answered, 0 untouched. */
const avance = (q: EtatQuestion): number => (estVerifiee(q) ? (q.verdict === "missed" ? 2 : 3) : aReponse(q) ? 1 : 0);

const nbVerifiees = (p: SessionQuiz): number => Object.values(p.questions).filter(q => isRecord(q) && estVerifiee(q)).length;

/** The latest stamp among ALL the entries (a tombstone must outrank them). */
export function derniereEcriture(entrees: readonly EntreeSession[]): number {
	let m = 0;
	for (const e of entrees) if (e.ecrite > m) m = e.ecrite;
	return m;
}

/** The snapshots that count: those of the latest attempt, after the latest
    tombstone. */
export function photosRetenues(entrees: readonly EntreeSession[]): SessionQuiz[] {
	let tombe = -Infinity;
	for (const e of entrees) if (estTombe(e) && e.ecrite > tombe) tombe = e.ecrite;
	const photos = entrees.filter((e): e is SessionQuiz => !estTombe(e) && e.ecrite > tombe && isRecord(e.questions));
	let depuis = -Infinity;
	for (const p of photos) if (typeof p.depuis === "number" && Number.isFinite(p.depuis) && p.depuis <= p.ecrite && p.depuis > depuis) depuis = p.depuis;
	return photos.filter(p => {
		if (typeof p.depuis === "number" && Number.isFinite(p.depuis) && p.depuis <= p.ecrite) return p.depuis >= depuis;
		return p.ecrite >= depuis;
	});
}

/** Where to reopen. The latest snapshot's question, unless that snapshot
    is BEHIND another one (fewer questions checked): reopening must never go
    back. Then the question the most advanced snapshot stopped on, if it is
    not already checked; else the first unchecked question in the quiz's
    order (when `ids` is known); else that question anyway. */
function choisirCourante(photos: readonly SessionQuiz[], fusion: Record<string, EtatQuestion>, ids?: readonly string[]): string | null {
	const recente = photos.reduce((a, b) => (b.ecrite >= a.ecrite ? b : a));
	const plusAvancee = photos.reduce((a, b) => {
		const na = nbVerifiees(a), nb = nbVerifiees(b);
		return nb > na || (nb === na && b.ecrite > a.ecrite) ? b : a;
	});
	const c = recente.courante;
	const retarde = nbVerifiees(plusAvancee) > nbVerifiees(recente) || (c !== null && estVerifiee(fusion[c]) && plusAvancee !== recente);
	if (c !== null && !retarde) return c;
	const p = plusAvancee.courante;
	if (p !== null && !estVerifiee(fusion[p])) return p;
	const libre = ids?.find(id => !estVerifiee(fusion[id]));
	return libre ?? p ?? c;
}

/** The snapshot of one quiz after merging every device's entry, or `null`
    when the quiz is reset (a tombstone is the latest). `ids`: the quiz's
    question order, when the caller knows it. */
export function fusionnerPhotos(entrees: readonly EntreeSession[], ids?: readonly string[]): SessionQuiz | null {
	const photos = photosRetenues(entrees);
	if (photos.length === 0) return null;
	const parRecence = [...photos].sort((a, b) => a.ecrite - b.ecrite);
	const questions: Record<string, EtatQuestion> = {};
	const source: Record<string, number> = {};
	for (const p of parRecence) {
		for (const [id, q] of Object.entries(p.questions)) {
			if (!isRecord(q)) continue;
			const cur = questions[id];
			// Sorted by age: on a tie in progress the later snapshot replaces.
			if (!cur || avance(q) >= avance(cur)) { questions[id] = q; source[id] = p.ecrite; }
		}
	}
	const recente = parRecence[parRecence.length - 1];
	const connus = photos.map(p => p.depuis).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
	const out: SessionQuiz = { v: 1, courante: choisirCourante(photos, questions, ids), questions, ecrite: recente.ecrite };
	if (connus.length > 0) out.depuis = Math.min(...connus);
	if (recente.setup) out.setup = recente.setup;
	if (recente.msLeft !== undefined) out.msLeft = recente.msLeft;
	/* The retry queue: every snapshot's entries, those whose question is still
	   missed once merged (another device may have settled it since). The
	   resume point comes with the most advanced snapshot, whose queue weighs most. */
	const file: NonNullable<SessionQuiz["file"]> = [];
	for (const p of [...parRecence].reverse()) {
		for (const e of p.file ?? []) if (questions[e.id]?.verdict === "missed" && !file.some(x => x.id === e.id)) file.push(e);
	}
	if (file.length > 0) out.file = file;
	const avancee = photos.reduce((a, b) => (nbVerifiees(b) > nbVerifiees(a) || (nbVerifiees(b) === nbVerifiees(a) && b.ecrite > a.ecrite) ? b : a));
	if (avancee.suite !== undefined) out.suite = avancee.suite;
	if (avancee.enReprise !== undefined) out.enReprise = avancee.enReprise;
	return out;
}
