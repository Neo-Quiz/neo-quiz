/* The one count of a quiz, shared by the work-view row, the result card and
   the queue, so the same quiz never shows two numbers. A reading card (the
   `role: "read"` of a Learn) is not a question: it is counted apart. */
import { t } from "../i18n";

export interface ComptesQuiz {
	questions: number;
	readings: number;
}

/** Counts the items of a quiz: those with `role: "read"` are readings. */
export function compterItems(items: readonly { role?: unknown }[]): ComptesQuiz {
	let readings = 0;
	for (const item of items) if (item.role === "read") readings++;
	return { questions: items.length - readings, readings };
}

/** "29 questions · 10 readings"; without a reading, "29 questions" alone. */
export function libelleComptes(c: ComptesQuiz): string {
	const questions = t(c.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: c.questions });
	return c.readings > 0 ? `${questions} · ${libelleLectures(c.readings)}` : questions;
}

/** "≈ 35 min", "≈ 4 h 10", "≈ 2 h"; the empty string without an estimate. */
export function libelleDuree(minutes: number | undefined): string {
	if (!minutes || minutes <= 0) return "";
	if (minutes < 60) return t("dashboard.common.durationMin", { count: minutes });
	const h = Math.floor(minutes / 60), m = minutes % 60;
	return m === 0 ? t("dashboard.common.durationH", { h }) : t("dashboard.common.durationHM", { h, m });
}

/** "10 readings" / "1 reading"; the empty string when there is none. */
export function libelleLectures(n: number): string {
	if (n <= 0) return "";
	return t(n === 1 ? "dashboard.common.readingsOne" : "dashboard.common.readingsOther", { count: n });
}
