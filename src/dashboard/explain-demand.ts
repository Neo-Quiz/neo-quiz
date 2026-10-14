/**
 * AN EXPLAIN TURN SENT FROM THE AI PAGE (2026-10-14). An Explain chat is
 * continued there with no quiz page open: the whole quiz is read again from
 * its note, with no question on screen and no edit instruction (proposals
 * only exist in the Explain window), and the tutor method for a question at
 * the end of the context. The course is not read here: an agent working in
 * the quiz's folder opens it.
 *
 * PURE: no DOM, no host. The note is read by the caller (`ai.ts`).
 * `npm run check:explain-chat` holds it.
 */
import type { ChatExplain } from "./chat-record";
import type { DemandeExplication } from "./file-generation-app";
import { consigneExplication, contexteQuiz } from "../explain-prompt";
import { extractExamOptions, parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";

/** The default longest explanation, in characters: a full explanation (error
    diagnosis, steps, every wrong option, example, check question) fits. */
export const EXPLAIN_MAX_CHARS_DEFAULT = 4000;

/** The Explain part of a turn sent from the AI page for the quiz `mark`
    names, from the text of its note. Null when the note holds no readable
    quiz block (the quiz is gone, or broken). */
export function explainDemandFromNote(note: string, mark: ChatExplain): DemandeExplication | null {
	const block = QUIZ_BLOCK_RE.exec(note);
	if (!block) return null;
	let questions: Record<string, unknown>[];
	try {
		questions = extractExamOptions(parseQuizSource(block[1], { logErrors: false })).questions as unknown as Record<string, unknown>[];
	} catch {
		return null;
	}
	if (!questions.length) return null;
	const cut = mark.path.lastIndexOf("/");
	const folder = cut > 0 ? mark.path.slice(0, cut) : undefined;
	const context = contexteQuiz(questions, { quiz: mark.quiz, folder: folder ? folder.slice(folder.lastIndexOf("/") + 1) : "", courant: -1 })
		+ "\n" + consigneExplication(false);
	return { mark: { ...mark }, context, course: "", position: "", ...(folder ? { folder } : {}) };
}
