import type { ParsedQuizItem } from "../types/quiz";
import { idsForRawItems } from "../quiz-ids";
import { extractExamOptions, parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";
import { QUESTION_ROLES } from "../types/quiz";
import type { QuestionRole } from "../types/quiz";
import type { Host, HostFile } from "../host/types";
import { lireFrontmatterNeoQuiz } from "../quiz-frontmatter";
import { nombreDeQuestions, nombreDeLectures } from "../lecture-etape";
import { estCarte, modeDuBloc, titreSansMode } from "../quiz-format";
import type { ModeQuiz } from "../quiz-format";
import type { NeoQuizFrontmatter } from "../quiz-frontmatter";

/* ══════════════════════════════════════════════════════════
   QUIZ SCANNER — Indexeur de vault
   Scanne les fichiers markdown pour trouver les blocs quiz-blocks,
   extrait les métadonnées (titre, nombre de questions, types),
   et maintient un cache à jour via les events vault.
══════════════════════════════════════════════════════════ */

/**
 * Tag de type de question détecté par le scan (parseQuizMeta ci-dessous).
 * Les branches `type === "ordering"` / `type === "matching"` ne matchent
 * jamais en pratique avec les quiz réellement exportés par l'éditeur
 * (editor/export.ts ne pose `type` que pour la variante texte, cf.
 * types/quiz.ts) — comportement de scanner.js préservé tel quel, pas « corrigé ».
 */
export type QuestionTypeTag = "single" | "multiple" | "text" | "ordering" | "matching" | "flashcard";

/**
 * Type global d'un quiz — un TAG stable, pas un libellé.
 * Il est calculé au SCAN et gardé en cache (QuizIndexEntry) : y stocker le
 * libellé traduit l'aurait figé dans la langue du démarrage (le cache ne se
 * reconstruit qu'au rechargement du plugin), et un changement de langue aurait
 * fait diverger toutes les entrées du diff de scanFile ci-dessous. La
 * traduction se fait donc au rendu (quiz-card.ts, detail.ts) via la clé
 * « dashboard.quizType.<tag> ».
 */
export type QuizTypeTag = "mixed" | "single" | "multiple" | "text" | "ordering" | "matching" | "flashcard";

/** Forme minimale lue sur un item brut du tableau JSON5 par le scanner. */
interface RawQuizItem extends Pick<ParsedQuizItem, "id"> {
	examMode?: boolean;
	multiSelect?: boolean;
	type?: string;
	title?: string;
	role?: string;
	slice?: number;
}

/**
 * Référence légère d'une question, pour l'ORDONNANCEUR.
 *
 * Le scanner parse déjà chaque bloc mais n'en retenait que le NOMBRE de
 * questions. Relire les notes à chaque calcul de plan referait un travail
 * déjà fait ; le coût de ces entrées est d'environ 70 Ko pour les 774
 * questions des vaults réels.
 */
export interface QuizItemRef {
	/** Identifiant attribué par la MÊME règle qu'à l'écriture (quiz-ids.ts) :
	    une clé de lecture qui divergerait ferait perdre l'historique à la
	    première sauvegarde depuis l'éditeur. */
	id: string;
	role?: QuestionRole;
	slice?: number;
}

/** Métadonnées extraites d'un bloc quiz-blocks (parseQuizMeta). */
export interface QuizMeta {
	questions: number;
	/** Le nombre de LECTURES (`role: "read"`) du bloc, TOUTES comptées,
	    absorbées ou restées un écran (src/lecture-etape.ts `nombreDeLectures`) ;
	    0 hors Learn. Affiché à côté de `questions`, jamais inclus dedans. */
	readings: number;
	items: QuizItemRef[];
	types: QuestionTypeTag[];
	quizType: QuizTypeTag;
	/** L'OBJECTIF du bloc (`modeDuBloc`) : Learn s'il porte `{ mode: "learn" }`,
	    Practice sinon. Affiché en badge, à droite du type ; son suffixe
	    éventuel (« — Learn ») est retiré du titre (`titreSansMode`). */
	mode: ModeQuiz;
	/** Le bloc est une Leçon POUR LE MOTEUR (`extractExamOptions(...).quizMode
	    === "lesson"`, qui accepte aussi `mode: 'lesson'`, contrairement à
	    `mode`) : ce que la règle des lectures absorbées lit
	    (src/lecture-etape.ts). Optionnel pour les entrées fabriquées ailleurs
	    (absent = pas une Leçon). */
	lecon?: boolean;
}

/**
 * Entrée du cache du scanner (une par note contenant un bloc quiz-blocks).
 * `title` vaut `file.basename` sans le suffixe de son mode (« — Learn »,
 * « — Practice » : le badge le dit déjà, 2026-09-23), dans
 * scanVault ET scanFile — scanFile.js d'origine omettait ce champ sur les
 * mises à jour incrémentales, un oubli de recopie qui rendait `quiz.title`
 * `undefined` après le premier `create`/`modify` ; corrigé ici en alignant
 * scanFile sur scanVault pour que le champ reste honnêtement non-optionnel).
 */
export interface QuizIndexEntry extends QuizMeta {
	path: string;
	basename: string;
	title: string;
	mtime: number;
	/** Qui a généré ce quiz — absent d'un quiz écrit à la main ou partagé
	    sans frontmatter (lireFrontmatterNeoQuiz). */
	generated?: NeoQuizFrontmatter;
}

/**
 * API du scanner de quiz, produite par createScanner(app) (dashboard.js
 * l'assigne à plugin._scanner, lu ensuite via DashboardView.scanner /
 * DashboardCtx.scanner).
 */
export interface Scanner {
	init(): Promise<void>;
	destroy(): void;
	scanVault(): Promise<void>;
	scanFile(file: HostFile): Promise<void>;
	getQuizzes(): QuizIndexEntry[];
	getQuiz(path: string): QuizIndexEntry | null;
	getTotalQuestions(): number;
	onChange(callback: (quizzes: QuizIndexEntry[]) => void): () => void;
}

export function createScanner(host: Host): Scanner {
	const cache = new Map<string, QuizIndexEntry>(); // path → entrée
	const listeners: Array<(quizzes: QuizIndexEntry[]) => void> = [];
	let desabonner: (() => void) | null = null;
	let scanning = false;

	/* ── Parse un bloc quiz-blocks pour extraire les métadonnées ── */
	function parseQuizMeta(source: string): QuizMeta | null {
		try {
			// La détection de la configuration reste partagée avec le moteur : deux
			// filtres locaux finiraient par construire des catalogues différents.
			const brut = parseQuizSource(source, { logErrors: false });
			const extrait = extractExamOptions(brut);
			const sansConfig = extrait.questions as unknown as Array<RawQuizItem | null | undefined>;
			// Le mode tel que le MOTEUR le lit : c'est lui qui décide si les
			// lectures d'étape sont absorbées (src/lecture-etape.ts).
			const lecon = extrait.quizMode === "lesson";

			// Conserver les positions du tableau BRUT est aussi important que la
			// déduplication : l'éditeur attribue un qN même aux éléments parasites.
			// `idsForRawItems` (quiz-ids.ts) : la même tolérance qu'ici (`q?.id`,
			// `q?.title`) désormais partagée avec engine.ts, plutôt que retapée.
			const ids = idsForRawItems(sansConfig);
			const questions = sansConfig.map((q, i) => ({ q, id: ids[i] })).filter(
				(item): item is { q: RawQuizItem; id: string } => !!item.q && typeof item.q === "object"
			);

			if (questions.length === 0) return null;

			const items: QuizItemRef[] = questions.map(({ q, id }) => ({
				id,
				...(typeof q.role === "string" && (QUESTION_ROLES as readonly string[]).includes(q.role)
					? { role: q.role as QuestionRole }
					: {}),
				...(typeof q.slice === "number" ? { slice: q.slice } : {}),
			}));

			// Détecter les types de questions
			const typeSet = new Set<QuestionTypeTag>();
			for (const { q } of questions) {
				if (estCarte(q)) typeSet.add("flashcard");
				else if (q.multiSelect) typeSet.add("multiple");
				else if (q.type === "text") typeSet.add("text");
				else if (q.type === "ordering") typeSet.add("ordering");
				else if (q.type === "matching") typeSet.add("matching");
				else typeSet.add("single");
			}

			// Déterminer le type global du quiz (tag stable — traduit au rendu)
			let quizType: QuizTypeTag;
			if (typeSet.size > 1) quizType = "mixed";
			else if (typeSet.has("single")) quizType = "single";
			else if (typeSet.has("multiple")) quizType = "multiple";
			else if (typeSet.has("text")) quizType = "text";
			else if (typeSet.has("ordering")) quizType = "ordering";
			else if (typeSet.has("matching")) quizType = "matching";
			else if (typeSet.has("flashcard")) quizType = "flashcard";
			else quizType = "mixed";

			// Le titre affiché vient du nom de la note (défini au niveau du cache),
			// pas de la 1re question (qui vaut souvent « Question 1 »).
			return {
				/* Le NOMBRE de questions affiché (carte, fiche, infos) saute les
				   lectures d'un Learn, absorbées par leur étape ou restées un
				   écran (src/lecture-etape.ts) : un cours n'est pas une question.
				   `items`, lui, les garde toutes — c'est le catalogue de
				   l'ordonnanceur, rangé par identifiant. */
				questions: nombreDeQuestions(questions.map(x => x.q), lecon),
				readings: nombreDeLectures(questions.map(x => x.q), lecon),
				items,
				lecon,
				types: Array.from(typeSet),
				quizType,
				mode: modeDuBloc(brut as unknown[])
			};
		} catch {
			return null;
		}
	}

	/* ── Extrait le premier bloc quiz-blocks d'un contenu markdown ── */
	function extractQuizSource(content: string): string | null {
		const match = content.match(QUIZ_BLOCK_RE);
		return match ? match[1].trim() : null;
	}

	/* ── Scan complet du vault ── */
	async function scanVault(): Promise<void> {
		scanning = true;
		cache.clear();

		const markdownFiles = host.fs.listMarkdown();

		for (const file of markdownFiles) {
			try {
				const content = await host.fs.readCached(file.path);
				const quizSource = extractQuizSource(content);
				if (!quizSource) continue;

				const meta = parseQuizMeta(quizSource);
				if (!meta) continue;

				cache.set(file.path, {
					path: file.path,
					basename: file.basename,
					title: titreSansMode(file.basename, meta.mode),
					...meta,
					mtime: file.mtime,
					generated: lireFrontmatterNeoQuiz(content) || undefined,
				});
			} catch {
				// Ignorer les erreurs de lecture
			}
		}

		scanning = false;
		notifyListeners();
	}

	/* ── Scan incrémental d'un seul fichier ── */
	async function scanFile(file: HostFile): Promise<void> {
		try {
			const content = await host.fs.readCached(file.path);
			const quizSource = extractQuizSource(content);

			if (!quizSource) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const meta = parseQuizMeta(quizSource);
			if (!meta) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const entry: QuizIndexEntry = {
				path: file.path,
				basename: file.basename,
				title: titreSansMode(file.basename, meta.mode),
				...meta,
				mtime: file.mtime,
				generated: lireFrontmatterNeoQuiz(content) || undefined,
			};
			// L'autosave d'Obsidian déclenche `modify` toutes les ~2 s
			// pendant la frappe : ne notifier (→ re-render sidebar + vue)
			// que si les données AFFICHÉES ont changé — mtime exclu.
			const prev = cache.get(file.path);
			cache.set(file.path, entry);
			const changed = !prev || JSON.stringify({ ...prev, mtime: 0 }) !== JSON.stringify({ ...entry, mtime: 0 });
			if (changed) notifyListeners();
		} catch {
			// Fichier inaccessible, on l'enlève du cache
			const removed = cache.delete(file.path);
			if (removed) notifyListeners();
		}
	}

	/* ── Récupérer les quiz indexés ── */
	function getQuizzes(): QuizIndexEntry[] {
		return Array.from(cache.values());
	}

	/* ── Récupérer un quiz par chemin ── */
	function getQuiz(path: string): QuizIndexEntry | null {
		return cache.get(path) || null;
	}

	/* ── Récupérer le nombre total de questions ── */
	function getTotalQuestions(): number {
		let total = 0;
		for (const quiz of cache.values()) {
			total += quiz.questions;
		}
		return total;
	}

	/* ── Écouteurs de changements ── */
	function onChange(callback: (quizzes: QuizIndexEntry[]) => void): () => void {
		listeners.push(callback);
		return () => {
			const idx = listeners.indexOf(callback);
			if (idx >= 0) listeners.splice(idx, 1);
		};
	}

	function notifyListeners(): void {
		for (const cb of listeners) {
			try { cb(getQuizzes()); } catch { /* ignore */ }
		}
	}

	/* ── Setup du watcher ── */
	function setupWatcher(): void {
		/* Un SEUL abonnement, aiguillé sur `ev.kind` : le contrat unifie les
		   quatre évènements d'Obsidian. `rename` reste un évènement DISTINCT de
		   delete+create parce que le journal de révision suit ses clés par
		   renommage — le reconstituer à partir de deux évènements est impossible.
		   Le garde `scanning` remonte ici : il était répété trois fois. */
		desabonner = host.watcher.onChange(ev => {
			if (scanning) return;
			if (ev.kind === "create" || ev.kind === "modify") {
				if (ev.file.extension === "md") void scanFile(ev.file);
				return;
			}
			if (ev.kind === "delete") {
				if (cache.delete(ev.path)) notifyListeners();
				return;
			}
			/* rename : l'ancienne clé sort du cache, et la nouvelle est
			   rescannée — y compris quand l'ancien chemin n'était PAS indexé,
			   sinon un quiz créé par renommage resterait invisible. */
			const avait = cache.delete(ev.oldPath);
			if (ev.file.extension === "md") void scanFile(ev.file);
			else if (avait) notifyListeners();
		});
	}

	/* ── Initialisation ── */
	async function init(): Promise<void> {
		setupWatcher();
		await scanVault();
	}

	function destroy(): void {
		desabonner?.();
		desabonner = null;
		listeners.length = 0;
		cache.clear();
	}

	return {
		init,
		destroy,
		scanVault,
		scanFile,
		getQuizzes,
		getQuiz,
		getTotalQuestions,
		onChange
	};
}
