/**
 * Whether the Explain composer accepts a message for the question on screen.
 *
 * Asking before answering would give the answer away, so a question stays
 * locked until it is corrected. A reading card has no answer to give away,
 * so it is always open.
 */
export function composerOpen(question: { role?: unknown } | undefined, corrected: boolean): boolean {
	if (!question) return false;
	return question.role === "read" || corrected;
}
