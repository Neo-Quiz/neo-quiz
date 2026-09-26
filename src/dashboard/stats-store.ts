import { t } from "../i18n";
import type { StatsRecord } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   STATS STORE — Stockage persistant des scores et progression
   Persistance déléguée à l'hôte (StatsStoreHost) : `settings.quizStats`
   côté greffon, les réglages de l'application côté Windows.
   Mises à jour en mémoire synchrones, sauvegarde debouncée.
══════════════════════════════════════════════════════════ */

/** Une arrivée au score (2026-09-26) : ce que l'onglet Progression liste et
    permet de supprimer. `date` l'identifie. */
export interface Tentative {
	date: number;
	/** 0..100 ; `null` pour un quiz à réponses libres (pas de pourcentage). */
	pct: number | null;
	/** Le résumé d'avant l'historique (meilleur score, dernière partie),
	    lu comme UNE tentative : rien n'est perdu, et il se supprime aussi. */
	ancienne?: true;
}

/** Au-delà, les plus anciennes tombent — la meilleure est toujours gardée. */
export const MAX_TENTATIVES = 50;

/**
 * Enregistrement de stats persisté par quiz (data[path] ci-dessous) —
 * sur-ensemble de `StatsRecord` (types/quiz.ts, la forme d'entrée de
 * updateRecord) avec les 2 champs de suivi propres au store.
 */
export interface QuizStatRecord extends StatsRecord {
	lastPlayed: number;
	attempts: number;
	tentatives?: Tentative[];
}

/**
 * Ce dont le store a besoin de son hôte, et rien de plus.
 *
 * C'était un `obsidian.Plugin` entier ; il n'en employait que deux choses.
 * Le réduire à celles-ci est ce qui permet à l'application de le servir
 * sans fabriquer un faux greffon — et rend le store éprouvable hors
 * d'Obsidian, ce qu'il n'était pas.
 */
export interface StatsStoreHost {
	/** Les stats persistées, ou un objet vide au premier démarrage. */
	getStats(): Record<string, QuizStatRecord>;
	/** Écrit la table entière. Appelée en différé (500 ms) par le store. */
	saveStats(data: Record<string, QuizStatRecord>): Promise<void>;
}

export interface StatsStore {
	load(): void;
	updateRecord(path: string, update: StatsRecord): QuizStatRecord;
	getRecord(path: string): QuizStatRecord | null;
	getAll(): Record<string, QuizStatRecord>;
	deleteRecord(path: string): void;
	/** Remet un enregistrement TEL QUEL (annulation d'une suppression). */
	restoreRecord(path: string, record: QuizStatRecord): void;
	formatRelativeTime(timestamp: number): string;
	/**
	 * Les stats suivent une note renommée. PUBLIQUE, et non plus un
	 * abonnement pris par le store lui-même (voir plus bas) : c'est l'hôte,
	 * seul à recevoir l'évènement de renommage (vault Obsidian, ou un
	 * détecteur côté application), qui relaie vers cette méthode.
	 */
	renamed(oldPath: string, newPath: string): void;
	/** Retire la tentative de cette date ; rend ce qui a été retiré (pour
	    l'annulation), `null` si rien ne correspond. Le journal de révision
	    n'est pas touché. */
	supprimerTentative(path: string, date: number): Tentative | null;
	/** Restaure une tentative (annulation d'une suppression). */
	restaurerTentative(path: string, tentative: Tentative): void;
	destroy(): void;
}

/** Les tentatives d'un enregistrement, de la plus récente à la plus
    ancienne. Un enregistrement d'avant l'historique (pas de liste, mais des
    tentatives comptées) en rend une seule, marquée `ancienne`. */
export function tentativesDe(r: QuizStatRecord | null | undefined): Tentative[] {
	if (!r) return [];
	const liste = Array.isArray(r.tentatives) ? r.tentatives
		: r.attempts > 0 ? [{ date: r.lastPlayed, pct: r.bestScore, ancienne: true as const }] : [];
	return [...liste].sort((a, b) => b.date - a.date);
}

/** Meilleur score et nombre de tentatives, DÉRIVÉS de la liste. */
function recalculer(r: QuizStatRecord, liste: Tentative[]): QuizStatRecord {
	const pcts = liste.map(x => x.pct).filter((p): p is number => typeof p === "number");
	return {
		...r,
		tentatives: liste,
		bestScore: pcts.length ? Math.max(...pcts) : 0,
		attempts: liste.length,
		questionsDone: liste.length ? r.questionsDone : 0,
	};
}

/** Garde les `MAX_TENTATIVES` plus récentes, et la meilleure quoi qu'il arrive. */
function plafonner(liste: Tentative[]): Tentative[] {
	const triee = [...liste].sort((a, b) => b.date - a.date);
	if (triee.length <= MAX_TENTATIVES) return triee;
	const meilleure = triee.reduce((m, x) => ((x.pct ?? -1) > (m.pct ?? -1) ? x : m), triee[0]);
	const gardees = triee.slice(0, MAX_TENTATIVES);
	if (!gardees.includes(meilleure)) gardees[gardees.length - 1] = meilleure;
	return gardees;
}

export function createStatsStore(host: StatsStoreHost): StatsStore {
	const DEBOUNCE_MS = 500;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let lastTimestamp = 0;
	let data: Record<string, QuizStatRecord> = {}; // path → { bestScore, questionsDone, totalQuestions, lastPlayed, attempts, tentatives }

	/* ── Charger les stats depuis l'hôte ── */
	function load(): void {
		data = host.getStats();
	}

	/* ── Debounced save ── */
	function scheduleSave(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			host.saveStats(data).catch(() => {});
			saveTimer = null;
		}, DEBOUNCE_MS);
	}

	/* ── Mettre à jour un enregistrement ── */
	function updateRecord(path: string, update: StatsRecord): QuizStatRecord {
		const existing: QuizStatRecord = data[path] || {
			bestScore: 0, questionsDone: 0, totalQuestions: 0, lastPlayed: 0, attempts: 0,
		};
		let maintenant = Date.now();
		if (maintenant <= lastTimestamp) maintenant = lastTimestamp + 1;
		lastTimestamp = maintenant;
		const tentative: Tentative = { date: maintenant, pct: update.texteLibre ? null : (update.bestScore || 0) };
		const base: QuizStatRecord = {
			...existing,
			questionsDone: Math.max(existing.questionsDone, update.questionsDone || 0),
			totalQuestions: update.totalQuestions || existing.totalQuestions,
			lastPlayed: maintenant,
		};
		data[path] = recalculer(base, plafonner([...tentativesDe(existing), tentative]));
		scheduleSave();
		return data[path];
	}

	/* ── Récupérer les stats d'un quiz ── */
	function getRecord(path: string): QuizStatRecord | null {
		return data[path] || null;
	}

	/* ── Récupérer toutes les stats ── */
	function getAll(): Record<string, QuizStatRecord> {
		return { ...data };
	}

	/* ── Supprimer les stats d'un quiz ── */
	function deleteRecord(path: string): void {
		if (data[path]) {
			delete data[path];
			scheduleSave();
		}
	}

	function restoreRecord(path: string, record: QuizStatRecord): void {
		data[path] = { ...record };
		scheduleSave();
	}

	/* ── Formater un timestamp en temps relatif ──
	   Appelée AU RENDU par les vues : les libellés suivent donc la langue
	   courante sans que le store ait à être reconstruit. */
	function formatRelativeTime(timestamp: number): string {
		if (!timestamp) return "—"; // tiret cadratin : pas de texte à traduire
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return t("dashboard.time.justNow");
		if (minutes < 60) return t("dashboard.time.minutes", { n: minutes });
		if (hours < 24) return t("dashboard.time.hours", { n: hours });
		if (days < 30) return t("dashboard.time.days", { n: days });
		if (days < 365) {
			// 1..12 mois → l'anglais accorde (« 1 month ago »), pas le français.
			const months = Math.floor(days / 30);
			return t(months === 1 ? "dashboard.time.monthsOne" : "dashboard.time.monthsOther", { n: months });
		}
		return t("dashboard.time.overYear");
	}

	/* ── Renommage : les stats suivent la note ──
	   Le store indexe par CHEMIN. Sans cette migration, renommer un quiz
	   (menu ⋯ « Rename », ou l'explorateur d'Obsidian) remettait sa
	   progression à zéro en apparence, et l'ancienne clé restait orpheline
	   dans data.json. Un DOSSIER renommé déplace aussi toutes les notes qu'il
	   contient — d'où le préfixe.

	   CE N'EST PLUS UN ABONNEMENT PRIS ICI : `createStatsStore` recevait
	   auparavant un `Plugin` entier et s'abonnait lui-même à
	   `plugin.app.vault.on("rename", …)`. Réduit à `StatsStoreHost`, le store
	   ne peut plus le faire — ni `app`, ni `registerEvent` n'en font partie.
	   La méthode reste PUBLIQUE : c'est l'appelant, seul à recevoir
	   l'évènement de renommage (le greffon, via `vault.on`), qui la relaie. */
	function renamed(oldPath: string, newPath: string): void {
		const prefix = oldPath + "/";
		let moved = false;
		for (const key of Object.keys(data)) {
			if (key !== oldPath && !key.startsWith(prefix)) continue;
			const rec = data[key];
			delete data[key];
			data[key === oldPath ? newPath : newPath + key.slice(oldPath.length)] = rec;
			moved = true;
		}
		if (moved) scheduleSave();
	}

	/** Retire la tentative de cette date ; rend ce qui a été retiré (pour
	    l'annulation), `null` si rien ne correspond. Le journal de révision
	    n'est pas touché. */
	function supprimerTentative(path: string, date: number): Tentative | null {
		const r = data[path];
		if (!r) return null;
		const liste = tentativesDe(r);
		const i = liste.findIndex(x => x.date === date);
		if (i < 0) return null;
		const [retiree] = liste.splice(i, 1);
		data[path] = recalculer(r, liste);
		scheduleSave();
		return retiree;
	}

	function restaurerTentative(path: string, tentative: Tentative): void {
		const r = data[path];
		if (!r) return;
		const liste = tentativesDe(r).filter(x => x.date !== tentative.date);
		data[path] = recalculer(r, plafonner([...liste, tentative]));
		scheduleSave();
	}

	function destroy(): void {
		if (saveTimer) {
			clearTimeout(saveTimer);
			// Sauvegarde immédiate des données en attente
			host.saveStats(data).catch(() => {});
		}
	}

	return {
		load,
		updateRecord,
		getRecord,
		getAll,
		deleteRecord,
		restoreRecord,
		formatRelativeTime,
		renamed,
		supprimerTentative,
		restaurerTentative,
		destroy
	};
}
