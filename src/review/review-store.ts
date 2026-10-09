import type { HostFs, HostPaths, HostRoot, HostWatcher } from "../host/types";
import type { QuizIndexEntry } from "../dashboard/scanner";
import { applyModuleOverrides, moduleForQuiz, type ModuleOverride } from "../dashboard/quiz-modules";
import {
	applyRenames, DEFAULT_PARAMS, planToday, dayOutcome as dayOutcomeOf,
	type DayOutcome, type LogLine, type Plan, type ReviewEvent, type ReviewGrade, type ScheduledItem, type SchedulerParams,
} from "../scheduler";
import { signalOf } from "../scheduler/state";
import type { QuestionRole } from "../types/quiz";
import type { LogFile } from "./log-file";
import { createJournalSet } from "./journal-set";
import { transposerLignes } from "./transpose";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   L'ADAPTATEUR DE L'ORDONNANCEUR

   Le noyau (`src/scheduler/`) ne voit que des chaînes opaques et des
   nombres. Ce module lit et écrit les octets, construit le catalogue, suit
   les renommages — et depuis la tranche 2, ROUTE entre plusieurs journaux.

   IL A CHANGÉ DE STATUT, et il faut le dire plutôt que de le laisser
   deviner. La spec de l'ordonnanceur (§3) le rangeait dans `dashboard/`
   « par choix : c'est le dossier que le chantier 4 supprime », et le
   qualifiait de JETABLE. À partir du moment où l'application écrit le même
   journal, ce n'est plus l'adaptateur d'un hôte : c'est le format d'un
   fichier partagé. Le supprimer avec le tableau de bord emporterait
   l'application avec lui.

   LA CLÉ DU JOURNAL EST LOCALE, JAMAIS PRÉFIXÉE. Sur le disque, une clé
   vaut « Cours/reseau.md::adressage-ip » : relative à SA racine, identique
   sous les deux hôtes. En mémoire, quand l'application ouvre plusieurs
   dossiers, les clés portent le préfixe de leur racine pour ne pas se
   confondre. La conversion se fait ICI et nulle part ailleurs
   (`paths.localPath` / `paths.contractPath`) : une clé recomposée à la main
   ferait diverger les deux historiques sans que personne ne le voie.
══════════════════════════════════════════════════════════ */

/** Exportée : c'est la SEULE composition de clé du dépôt (le côté app la
    consommait en la recomposant à la main dans `catalogue.ts` — un même
    résultat aujourd'hui, mais qui aurait divergé d'un lecteur à l'autre le
    jour où le séparateur change). Le découpage inverse, lui, reste répété à
    plusieurs endroits — chantier différé, non repris ici. */
export const keyOfQuestion = (path: string, id: string): string => `${path}::${id}`;

/** Le chemin d'une clé de question (`chemin::id` → `chemin`). */
function cheminDeCle(q: string): string {
	const i = q.lastIndexOf("::");
	return i > 0 ? q.slice(0, i) : q;
}

export interface ReviewStoreDeps {
	fs: HostFs;
	watcher: HostWatcher;
	paths: HostPaths;
	/** Le catalogue du moment, en clés du CONTRAT. Appelé à chaque plan :
	    une question supprimée d'une note disparaît du plan le jour même. */
	catalogue(): ScheduledItem[];
	/** module → date d'examen (ms) ou null. Appelé à chaque plan. */
	horizons(): Record<string, number | null>;
	/** L'heure. INJECTÉE, pas lue : c'est ce qui rend les jeux de cas
	    reproductibles, et c'est déjà la règle du noyau. */
	now(): number;
	params?: SchedulerParams;
}

export interface ReviewStore {
	load(): Promise<void>;
	record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
	/** Un renommage OBSERVÉ (fichier ou dossier), en chemins du contrat. */
	renamed(from: string, to: string): void;
	/** Un déplacement VOULU d'un dossier entre deux racines (menu « Déplacer
	    vers… »), en chemins du contrat. Si les deux chemins tombent dans la
	    même racine, c'est un renommage : délégué à `renamed`. Sinon, les
	    lignes du journal SOURCE qui concernent ce dossier sont transposées
	    (préfixe réécrit) et ajoutées au journal CIBLE — le journal source
	    garde les siennes, en ajout seul, comme toujours. */
	moved(from: string, to: string): Promise<void>;
	plan(now: number): Plan;
	/** How the day starting at `dayStart` (local midnight, ms) went: the
	    home page week (spec 2026-09-29-home-page-design.md §3.2). */
	dayOutcome(dayStart: number): DayOutcome;
	keyOf(path: string, id: string): string;
	/** READ ONLY: how many times the learner answered this question (a key of the
	    contract) and how many were missed. `null` when a journal is not loaded or
	    holds nothing about it. */
	history(key: string): { attempts: number; misses: number } | null;
	destroy(): void;
}

export function createReviewStore(deps: ReviewStoreDeps): ReviewStore {
	const params = deps.params ?? DEFAULT_PARAMS;
	let detruit = false;

	/* UN JOURNAL PAR RACINE. Les racines sont figées à la construction : en
	   ajouter une exige de reconstruire le store, ce que l'application fait
	   déjà en rechargeant sa fenêtre (l'hôte est un singleton). */
	const journaux = new Map<string, { root: HostRoot; fichier: LogFile }>();
	for (const root of deps.paths.roots()) {
		journaux.set(root.id, { root, fichier: createJournalSet({ fs: deps.fs, legacyPath: root.reviewLog, dir: root.reviewJournalDir, deviceId: root.deviceId }) });
	}

	/** La clé LOCALE (ce qui est écrit) d'une clé du contrat, avec sa racine. */
	function versLocal(q: string): { rootId: string; local: string } | null {
		const chemin = cheminDeCle(q);
		const root = deps.paths.rootOf(chemin);
		if (!root) return null;
		const suffixe = q.slice(chemin.length); // « ::id », ou "" pour un chemin nu
		return { rootId: root.id, local: deps.paths.localPath(chemin) + suffixe };
	}

	/** L'inverse, pour ce qui sort d'un journal. */
	function versContrat(rootId: string, q: string): string {
		const chemin = cheminDeCle(q);
		const suffixe = q.slice(chemin.length);
		return deps.paths.contractPath(rootId, chemin) + suffixe;
	}

	/* Toutes les lignes, en clés du CONTRAT. La conversion se fait AVANT la
	   concaténation, et c'est ce qui empêche un renommage d'une racine de
	   rattraper une clé d'une autre : préfixées, elles ne se ressemblent plus. */
	function toutesLesLignes(): LogLine[] {
		const out: LogLine[] = [];
		for (const [rootId, { fichier }] of journaux) {
			for (const l of fichier.lines()) {
				out.push(l.t === "rename"
					? { ...l, from: versContrat(rootId, l.from), to: versContrat(rootId, l.to) }
					: { ...l, q: versContrat(rootId, l.q) });
			}
		}
		return out;
	}

	async function load(): Promise<void> {
		/* En parallèle : dix dossiers sur un disque réseau, en série, feraient
		   attendre le premier rendu pour rien. Une racine illisible ne doit pas
		   emporter les autres — d'où le `catch` par racine. */
		await Promise.all([...journaux.values()].map(async ({ root, fichier }) => {
			try {
				await fichier.load();
			} catch (e) {
				console.warn(LOG_PREFIX, "journal illisible pour", root.name, e);
			}
		}));
	}

	function record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void {
		if (detruit || !entries.length) return;
		const at = deps.now();
		/* Regroupées par racine : une réponse est écrite dans le journal du
		   dossier auquel appartient sa question (spec §6), jamais ailleurs. */
		const parRacine = new Map<string, LogLine[]>();
		for (const e of entries) {
			const cible = versLocal(e.q);
			if (!cible) { console.warn(LOG_PREFIX, "clé hors de toute racine, ignorée:", e.q); continue; }
			const ligne: ReviewEvent = { t: "answer", q: cible.local, at, grade: e.grade };
			if (e.role) ligne.role = e.role;
			const lot = parRacine.get(cible.rootId);
			if (lot) lot.push(ligne); else parRacine.set(cible.rootId, [ligne]);
		}
		for (const [rootId, lot] of parRacine) journaux.get(rootId)?.fichier.append(lot);
	}

	/* `applyRenames` attend des préfixes exacts ; garder un slash final
	   fabriquerait « Cours// » et orphelinerait l'historique du dossier. */
	const sansSlashFinal = (path: string): string => path.endsWith("/") ? path.slice(0, -1) : path;
	const correspondAuChemin = (q: string, path: string): boolean =>
		q === path || q.startsWith(path + "/") || q.startsWith(path + "::");

	function renamed(fromBrut: string, toBrut: string): void {
		if (detruit) return;
		const from = sansSlashFinal(fromBrut);
		const to = sansSlashFinal(toBrut);
		if (from === to) return;
		const source = deps.paths.rootOf(from);
		const cible = deps.paths.rootOf(to);
		/* Un déplacement d'une racine à une AUTRE n'est pas un renommage : les
		   deux journaux sont distincts, et une ligne écrite dans l'un ne
		   déplacerait rien dans l'autre. On ne fabrique donc rien — l'historique
		   reste attaché à l'ancien dossier, ce qui est au moins vrai. */
		if (!source || !cible || source.id !== cible.id) return;

		const journal = journaux.get(source.id);
		if (!journal) return;
		/* Une ligne de renommage n'existe que si elle DÉPLACE réellement une
		   clé. Rejouer d'abord les renommages déjà journalisés est nécessaire
		   pour qu'un second déplacement reconnaisse le chemin COURANT plutôt
		   que le chemin historique.

		   GARDE : tant que `fichier.loaded()` n'est pas vrai, `lines()` peut
		   être vide alors que le fichier sur disque contient déjà de
		   l'historique — le filtre de pertinence ne doit alors filtrer AUCUN
		   événement, sous peine de l'ignorer pour de bon (même piège que
		   l'ancien `dashboard/review-store.ts`, régression qu'un test dédié
		   éprouve). Une ligne inutile ne coûte rien ; un renommage perdu est
		   irréversible. */
		const local = deps.paths.localPath(from);
		const localTo = deps.paths.localPath(to);
		if (journal.fichier.loaded() && !applyRenames(journal.fichier.lines()).some(line => correspondAuChemin(line.q, local))) return;
		journal.fichier.append([{ t: "rename", from: local, to: localTo, at: deps.now() }]);
	}

	async function moved(fromBrut: string, toBrut: string): Promise<void> {
		if (detruit) return;
		const from = sansSlashFinal(fromBrut);
		const to = sansSlashFinal(toBrut);
		if (from === to) return;
		const source = deps.paths.rootOf(from);
		const cible = deps.paths.rootOf(to);
		if (!source || !cible) return;
		/* Même racine : ce n'est pas un déplacement entre journaux, c'est un
		   renommage — `renamed` sait déjà quoi en faire (et rejoue les
		   renommages déjà journalisés avant de filtrer, ce que `moved` n'a
		   pas à refaire). */
		if (source.id === cible.id) { renamed(from, to); return; }

		const journalSource = journaux.get(source.id);
		const journalCible = journaux.get(cible.id);
		if (!journalSource || !journalCible) return;
		/* Le journal source peut ne pas avoir été chargé si `load()` a échoué
		   pour cette racine (disque réseau absent, etc.) : sans lignes, rien à
		   transposer, mais on ne DOIT pas fabriquer un déplacement à partir
		   d'un historique qu'on n'a pas encore lu. */
		if (!journalSource.fichier.loaded()) await journalSource.fichier.load();

		const localFrom = deps.paths.localPath(from);
		const localTo = deps.paths.localPath(to);
		const lignesSource = applyRenames(journalSource.fichier.lines());
		const transposees = transposerLignes(lignesSource, localFrom, localTo);
		if (!transposees.length) return;
		/* L'ALLER-RETOUR (revue finale de la tranche 9) : un module déplacé du
		   vault vers le défaut puis RAMENÉ. Le journal du vault a gardé ses
		   lignes d'origine (ajout seul), et les transposées de retour sont
		   exactement les mêmes : les annexer une seconde fois compterait
		   chaque réponse deux fois (`streak`, `lapses`, budget du jour). On
		   lit donc le journal cible et on n'ajoute que ce qu'il n'a pas déjà,
		   à l'identique (même clé, même instant, même note). Le journal
		   reste en ajout seul : on filtre ce qu'on ÉCRIT, jamais ce qui est. */
		if (!journalCible.fichier.loaded()) await journalCible.fichier.load();
		const deja = new Set(journalCible.fichier.lines().map(empreinte));
		const neuves = transposees.filter(l => !deja.has(empreinte(l)));
		if (neuves.length) journalCible.fichier.append(neuves);
	}

	/** L'identité d'une ligne, pour la déduplication de `moved` : tous ses
	    champs, dans un ordre fixe. */
	function empreinte(l: LogLine): string {
		return l.t === "answer"
			? `a|${l.q}|${l.at}|${l.grade}`
			: `r|${l.from}|${l.to}|${l.at}`;
	}

	/* Les renommages que l'HÔTE sait nommer : fichiers (`onChange`) et
	   dossiers (`onRenameDir`). Le second canal n'est pas un luxe — un dossier
	   renommé déplace toutes ses notes en une seule ligne, et sans lui
	   l'historique de tout un module deviendrait orphelin d'un coup. */
	const desabonner: Array<() => void> = [
		deps.watcher.onChange(ev => { if (ev.kind === "rename") renamed(ev.oldPath, ev.file.path); }),
		deps.watcher.onRenameDir(ev => renamed(ev.from, ev.to)),
	];

	function history(key: string): { attempts: number; misses: number } | null {
		if (detruit) return null;
		for (const { fichier } of journaux.values()) if (!fichier.loaded()) return null;
		let attempts = 0, misses = 0;
		for (const e of applyRenames(toutesLesLignes())) {
			if (e.q !== key) continue;
			const signal = signalOf(e);
			if (signal === null) continue; // pre-test, reading card, skipped: not an attempt
			attempts++;
			if (signal === "fail") misses++;
		}
		return attempts ? { attempts, misses } : null;
	}

	function plan(now: number): Plan {
		const d = new Date(now);
		// Seul l'hôte connaît le fuseau : le noyau ne manipule aucun calendrier.
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		return planToday({
			now, dayStart,
			items: deps.catalogue(),
			events: toutesLesLignes(),
			horizons: deps.horizons(),
			params,
		});
	}

	function dayOutcome(dayStart: number): DayOutcome {
		// The end of the day is the NEXT local midnight, never `+ 24 h`: a
		// daylight saving change makes a day 23 or 25 hours long.
		const d = new Date(dayStart);
		const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
		return dayOutcomeOf({
			dayStart, dayEnd,
			items: deps.catalogue(),
			events: toutesLesLignes(),
			horizons: deps.horizons(),
			params,
		});
	}

	function destroy(): void {
		if (detruit) return;
		detruit = true;
		for (const d of desabonner) { try { d(); } catch (e) { /* best effort */ } }
		desabonner.length = 0;
		for (const { fichier } of journaux.values()) fichier.destroy();
	}

	return { load, record, renamed, moved, plan, dayOutcome, keyOf: keyOfQuestion, history, destroy };
}

/** Construit les seules données que le noyau comprend. `moduleForQuiz` reste
    l'unique règle de rattachement : l'adaptateur lui fournit la même table de
    dossiers que le dashboard, dérivée ici des overrides persistés. */
export function buildReviewCatalogue(
	quizzes: ReadonlyArray<QuizIndexEntry>,
	overrides: Record<string, ModuleOverride>
): ScheduledItem[] {
	const map = applyModuleOverrides({ byFolder: new Map(), ueOrder: [] }, overrides);
	const out: ScheduledItem[] = [];
	for (const quiz of quizzes) {
		const module = moduleForQuiz(quiz.path, map).folder;
		for (const it of quiz.items) {
			const item: ScheduledItem = {
				q: keyOfQuestion(quiz.path, it.id),
				module,
				// La tranche sépare les familles confusables d'un même chapitre
				// tant qu'aucun `topic` n'est déclaré par le contenu.
				source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
			};
			if (it.role) item.role = it.role;
			out.push(item);
		}
	}
	return out;
}

/**
 * Une date d'examen saisie (`AAAA-MM-JJ`) en epoch ms, à MINUIT LOCAL.
 *
 * Le constructeur ISO texte serait UTC et pourrait déplacer l'examen d'un
 * jour selon le fuseau. Et la garde `Number.isFinite` n'est pas décorative :
 * `horizonFor` (le noyau) ne se protège pas d'un horizon NaN — il a raison,
 * il ne reçoit qu'un `number | null` déjà validé. Une année à six chiffres
 * passe le premier filtre et produit un timestamp NaN, qui empoisonnerait
 * silencieusement toutes les échéances du module.
 */
export function parseExamDate(brut: unknown): number | null {
	if (typeof brut !== "string" || !brut) return null;
	const [a, m, j] = brut.split("-").map(Number);
	if (!a || !m || !j) return null;
	const t = new Date(a, m - 1, j).getTime();
	return Number.isFinite(t) ? t : null;
}

/**
 * An exam date (`YYYY-MM-DD`) written out in full for `lang`, first letter
 * capitalised: "Wednesday, September 30, 2026" / "Mercredi 30 septembre 2026".
 * The single place an exam date is shown, so the picker field, the exam rows
 * and the home page cannot drift apart. An unreadable date is returned as is.
 */
export function formatExamDate(iso: string, lang: string): string {
	const ms = parseExamDate(iso);
	if (ms === null) return iso;
	const text = new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(new Date(ms));
	return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}

/** What an exam's weight number means: a coefficient ("coef. 2") or a share of
    the grade in percent ("20 %"). An exam with no unit stored is a "coef". */
export type ExamWeightUnit = "coef" | "percent";

/** A weight is valid in (0, 100], whatever its unit. */
function validExamWeight(n: number): boolean {
	return Number.isFinite(n) && n > 0 && n <= 100;
}

/**
 * A typed exam weight. "" is none (`undefined`); "2,5" and "2.5" are 2.5; a
 * trailing "%" ("20%", "20 %") makes it a percentage whatever `defaultUnit`
 * says, otherwise the number takes `defaultUnit` (the unit toggle's state).
 * Anything else (not a number, zero, negative, above 100) is invalid (`null`).
 */
export function parseExamWeight(raw: string, defaultUnit: ExamWeightUnit = "coef"): { value: number; unit: ExamWeightUnit } | undefined | null {
	const text = raw.trim();
	if (!text) return undefined;
	const match = /^(\d+[.,]?\d*|[.,]\d+)\s*(%?)$/.exec(text);
	if (!match) return null;
	const value = Number(match[1].replace(",", "."));
	return validExamWeight(value) ? { value, unit: match[2] ? "percent" : defaultUnit } : null;
}

/**
 * The weight fields of a persisted exam, validated: `null` when the weight is
 * invalid (a bad number, a unit that is neither "coef" nor "percent", a unit
 * without a number) so the caller drops the weight and keeps the exam. Only a
 * percentage stores its unit; a coefficient is written without one, as before.
 */
export function readExamWeight(coefficient: unknown, weightUnit: unknown): { coefficient: number; weightUnit?: "percent" } | null {
	if (typeof coefficient !== "number" || !validExamWeight(coefficient)) return null;
	if (weightUnit === undefined || weightUnit === "coef") return { coefficient };
	return weightUnit === "percent" ? { coefficient, weightUnit } : null;
}
