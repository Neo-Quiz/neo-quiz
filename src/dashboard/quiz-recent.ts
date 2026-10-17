import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { MASTERY_THRESHOLD } from "./quiz-mastery";
import type { ModuleGroup } from "./quiz-modules";

/* ══════════════════════════════════════════════════════════
   QUIZ RECENT — regroupement des quiz par DERNIÈRE ACTIVITÉ
   Deuxième axe de « Mes quiz » (à côté de quiz-modules.ts, par
   module/UE, et quiz-type.ts, par type) : trois fenêtres de
   temps, du plus récent au plus ancien. Module PUR comme les
   autres axes : aucune dépendance à Obsidian ni au DOM, aucun
   appel à t() (la traduction des libellés se fait au rendu,
   dans quizzes.ts).
══════════════════════════════════════════════════════════ */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clé stable d'un groupe — sert aussi de clé de dépliage dans
 *  settings.quizzesExpandedFolders (préfixe « recent: », sûr par
 *  construction : cf. le commentaire complet dans quizzes.ts). */
export type RecentGroupKey = "recent:7d" | "recent:30d" | "recent:older";

export interface RecentGroup {
	key: RecentGroupKey;
	/** Quiz du groupe, triés par activité DÉCROISSANTE. */
	quizzes: QuizIndexEntry[];
	total: number;
	/** Quiz du groupe dont bestScore >= MASTERY_THRESHOLD. */
	mastered: number;
}

/**
 * « Dernière activité » = max(dernière partie jouée, dernière modification
 * du fichier). `lastPlayed` seul est vide pour la grande majorité des quiz
 * d'Ahmed (jamais commencés) : grouper dessus enverrait presque tout dans
 * « plus d'un mois » et ne répondrait pas à la question « sur quoi je
 * bossais ? ». Un quiz édité hier EST récent, même sans avoir été joué.
 */
function lastActivity(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): number {
	const s = stats[quiz.path];
	return Math.max((s && s.lastPlayed) || 0, quiz.mtime || 0);
}

function isMastered(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): boolean {
	const s = stats[quiz.path];
	return !!s && s.bestScore >= MASTERY_THRESHOLD;
}

/**
 * Construit les groupes d'activité à partir des quiz DÉJÀ FILTRÉS (recherche
 * + pastille appliquées par l'appelant, même contrat que buildQuizTree). Un
 * groupe SANS quiz est omis du résultat (jamais affiché à 0).
 */
export function buildRecentGroups(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>
): RecentGroup[] {
	const now = Date.now();
	const buckets: Record<RecentGroupKey, QuizIndexEntry[]> = {
		"recent:7d": [], "recent:30d": [], "recent:older": []
	};
	for (const q of quizzes) {
		const age = now - lastActivity(q, stats);
		if (age <= 7 * DAY_MS) buckets["recent:7d"].push(q);
		else if (age <= 30 * DAY_MS) buckets["recent:30d"].push(q);
		else buckets["recent:older"].push(q);
	}
	const order: RecentGroupKey[] = ["recent:7d", "recent:30d", "recent:older"];
	const groups: RecentGroup[] = [];
	for (const key of order) {
		const list = buckets[key];
		if (list.length === 0) continue;
		list.sort((a, b) => lastActivity(b, stats) - lastActivity(a, stats));
		groups.push({
			key,
			quizzes: list,
			total: list.length,
			mastered: list.filter(q => isMastered(q, stats)).length
		});
	}
	return groups;
}

/** Sections d'activité pour l'axe « Récent » — cartes de MODULE, jamais de
    quiz (règle Ahmed 2026-07-18 : « on ne doit voir que les dossiers »). */
export interface RecentModuleGroup {
	key: RecentGroupKey;
	/** Modules du groupe, triés par activité DÉCROISSANTE. */
	modules: ModuleGroup[];
}

/** Récence d'un module = la plus récente activité de SES quiz (un module
    vide date de 0 → « plus d'un mois »). Un groupe vide est omis. */
export function buildRecentModuleGroups(
	modules: ModuleGroup[],
	stats: Record<string, QuizStatRecord>,
): RecentModuleGroup[] {
	const now = Date.now();
	const activity = (m: ModuleGroup) => m.quizzes.reduce((mx, q) => Math.max(mx, lastActivity(q, stats)), 0);
	const buckets: Record<RecentGroupKey, ModuleGroup[]> = {
		"recent:7d": [], "recent:30d": [], "recent:older": []
	};
	for (const m of modules) {
		const age = now - activity(m);
		if (age <= 7 * DAY_MS) buckets["recent:7d"].push(m);
		else if (age <= 30 * DAY_MS) buckets["recent:30d"].push(m);
		else buckets["recent:older"].push(m);
	}
	const order: RecentGroupKey[] = ["recent:7d", "recent:30d", "recent:older"];
	return order
		.filter(key => buckets[key].length > 0)
		.map(key => ({ key, modules: buckets[key].sort((a, b) => activity(b) - activity(a)) }));
}
