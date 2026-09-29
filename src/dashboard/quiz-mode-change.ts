import type { EditorExamOptions } from "../types/editor-ctx";
import { clampExamDuration, fallbackExamDuration } from "../quiz-utils";
import { nomDeNote, separerNomDeNote, type ModeQuiz } from "../quiz-format";

/* ══════════════════════════════════════════════════════════
   CHANGING A TEST'S MODE IN THE EDITOR — a PURE module.

   Spec docs/superpowers/specs/2026-09-29-test-practice-exam-design.md §5.1:
   Practice ⇄ Exam only. A Learn is not convertible — its slices, `pre`,
   `read` and `recall` make no sense in a Test, and a Test has none of what
   a Learn requires; to get a Test of a course, generate it.

   - To Exam: `mode: "exam"` and a duration — the one already there, else
     the fallback rule (1 min 30 per question, rounded to 5 minutes).
   - To Practice: `mode: "quiz"` (an explicit Practice) and NO duration.
     Explicit rather than no mode at all: custom keys kept on the object
     (`_extra`) would otherwise be written as an object without a mode, which
     the format may take for a question.
   - Hints stay in the file either way; an Exam simply does not show them.
   - The glossary and the unknown keys follow untouched.
══════════════════════════════════════════════════════════ */

/** The mode an editor option set stands for: "lesson" is a Learn. */
export function modeOfOptions(options: EditorExamOptions | null | undefined): ModeQuiz {
	return options?.mode === "lesson" ? "learn" : options?.mode === "exam" ? "exam" : "practice";
}

/** The new configuration for `to`; `null` when the change is not allowed
    (a Learn, or a Test asked to become a Learn). */
export function changeMode(options: EditorExamOptions | null | undefined, to: "practice" | "exam", questionCount: number): EditorExamOptions | null {
	if (modeOfOptions(options) === "learn") return null;
	const base: EditorExamOptions = { ...(options ?? {}) };
	if (to === "exam") {
		return {
			...base,
			mode: "exam",
			durationMinutes: clampExamDuration(base.durationMinutes) ?? fallbackExamDuration(questionCount),
		};
	}
	const { durationMinutes: _retiree, ...reste } = base;
	return { ...reste, mode: "quiz" };
}

/** The note's new name when its mode goes from `from` to `to`: its suffix
    changes (" — Practice" ↔ " — Exam") and a collision counter is dropped —
    `freeNotePath` adds a new one if the target name is taken. `null` when
    the name does not carry the suffix of its current mode — a note named by
    hand keeps its name. */
export function noteNameForMode(basename: string, from: ModeQuiz, to: ModeQuiz): string | null {
	if (from === to) return null;
	const parts = separerNomDeNote(basename, from);
	return parts ? nomDeNote(parts.base, to) : null;
}
