/* A follow-up message of the Generate page ("make it multiple choice") is a
   request of its own for the queue: the model sees nothing of the earlier
   turns unless they travel with it. This pure module writes that context from
   the earlier lines — the user's earlier requests, the documents attached,
   and what the quizzes produced so far contain — so every provider (CLI or
   Ollama) gets the same conversation. */

export interface TourPrecedent {
	text: string;
	/** Documents attached to that request, already read. */
	notes: { name: string; content: string }[];
	/** The quizzes it produced (one entry per quiz): title and raw questions. */
	quizzes: { title?: string; questions: unknown[] }[];
}

const MAX_PROMPT_CHARS = 140;
const MAX_QUESTIONS_LISTED = 12;

function promptOf(q: unknown): string {
	if (!q || typeof q !== "object") return "";
	const o = q as Record<string, unknown>;
	const p = o.prompt ?? o.title ?? o.question;
	return typeof p === "string" ? p.replace(/\s+/g, " ").trim() : "";
}

/** The documents to carry over: the earlier ones, each once (by name, the
    latest content wins). */
export function documentsHeritiers(tours: readonly TourPrecedent[]): { name: string; content: string }[] {
	const parNom = new Map<string, { name: string; content: string }>();
	for (const tour of tours) for (const n of tour.notes) parNom.set(n.name, n);
	return [...parNom.values()];
}

/** The text placed before a follow-up request; "" when nothing came before. */
export function contexteConversation(tours: readonly TourPrecedent[]): string {
	if (!tours.length) return "";
	const blocs = tours.map((tour, i) => {
		const lignes = ["Earlier request " + (i + 1) + ":", tour.text.trim() || "(no text)"];
		if (tour.notes.length) lignes.push("Documents attached: " + tour.notes.map(n => n.name).join(", "));
		for (const q of tour.quizzes) {
			const prompts = q.questions.map(promptOf).filter(Boolean);
			lignes.push("Quiz produced" + (q.title ? " \"" + q.title + "\"" : "") + " (" + prompts.length + " questions)" + (prompts.length ? ":" : ""));
			for (const p of prompts.slice(0, MAX_QUESTIONS_LISTED)) lignes.push("- " + (p.length > MAX_PROMPT_CHARS ? p.slice(0, MAX_PROMPT_CHARS) + "…" : p));
			if (prompts.length > MAX_QUESTIONS_LISTED) lignes.push("- … (" + (prompts.length - MAX_QUESTIONS_LISTED) + " more)");
		}
		return lignes.join("\n");
	});
	return "CONVERSATION SO FAR (the new request below continues it: \"redo it\", \"make it multiple choice\" refer to the quizzes above and their documents):\n\n" + blocs.join("\n\n");
}
