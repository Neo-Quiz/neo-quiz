import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import { buildUeGroups, declaredFolders, estLeSas, modulesAffiches, moduleForQuiz } from "./quiz-modules";
import { moduleIcon } from "./module-icons";
import { moduleAccent } from "./module-color";
import { poserLogoObsidian } from "./brand-icons";
import { openModuleEditModal } from "./module-edit";
import type { ActionMenuItem } from "./ui-select";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import type { QuizStatRecord } from "./stats-store";
import { neContientQueLeFrontmatterNeoQuiz } from "../quiz-frontmatter";
import { isFolderArchived, setFolderArchived } from "./folder-archive";
import { freeNotePath } from "./folder-create";
import { parMode, quizFreres } from "./course-pairs";
import { quizModeIcon, quizModeLabel } from "./quiz-card";
import { keepExamMenuItem } from "./exam-keep-menu";
import { openShareChooser } from "./share-choose";
import { baseNameVerdict, fitsPath, NAME_MAX } from "./share-names";
import { separerNomDeNote } from "../quiz-format";

/* ══════════════════════════════════════════════════════════
   QUIZ MENU — the "⋯" menu of the cards of "My quizzes" (also opened by a
   right click on the card). From the StudySmarter reference (2026-07-18):
   Share / Edit / Rename / Archive / Delete (red), adapted:
   - Share     → the share window (a quiz's note, or a folder's archive);
   - Rename    → renames the NOTE (a quiz's title IS its name, scanner.ts),
                 quiz cards only: a folder card renames through "Edit";
   - Duplicate → a byte-for-byte copy of the note, "<title> (copy)";
   - Archive   → folders only (`folder-archive.ts`);
   - Delete    → removes the block from the note (to the trash when the note
                 held nothing else) and its stats, after a confirmation.
   ("Pause study reminders" was removed on 2026-07-21, with its mechanism:
   without a menu entry, a quiz already paused would have stayed out of
   "To do" with no way to resume it.)

   This module knows no host: files go through `HostFs`, modals through
   `HostModals`. Share stays an OPTIONAL ctx member (`shareQuiz?`). Rename
   was one too, absent from the app on purpose while only Obsidian could
   rewrite incoming links; since the plugin was removed (2026-10-01) the app
   is the host, and Rename is built on the contract (`renameQuizzes`). An
   absent entry reads as a host doing something else, a greyed one as a
   failure: entries a host cannot honour are left out, never greyed.
══════════════════════════════════════════════════════════ */

/* `isFolderArchived`/`setFolderArchived` ont déménagé dans `folder-archive.ts`
   (tour de correction 1, tâche 6) : ces deux fonctions ne lisaient déjà QUE
   les cinq réglages de `DashboardShellCtx` (tâche 5), sans rien d'Obsidian —
   les garder ici forçait home.ts et quizzes.ts (qui n'en ont besoin QUE pour
   ça) à importer transitivement `Notice`/`TFile` via ce fichier. Ce module ne
   les utilise plus qu'en INTERNE (import ci-dessus, `buildModuleCardMenu`) ;
   home.ts et quizzes.ts importent désormais `folder-archive.ts` directement. */

/* ── Confirmations : l'ARCHIVAGE est direct dans les deux sens (demande
   Ahmed 2026-07-19), Delete confirme en rouge. ── */

interface ConfirmSpec {
	title: string;
	body: string;
	cta: string;
	/** true = bouton rouge (`qb-btn-danger`) : Delete uniquement. */
	warning?: boolean;
}

/**
 * Runs a file gesture started from a menu (delete a quiz, move it, take a folder
 * out of the app). A rejection is logged and SHOWN, never dropped: a bare
 * `void task().then(rerender)` left the user with no message and a stale page
 * when the host refused (a full disk, a revoked permission, a folder that
 * moved). The page refreshes in every case, because the disk may have changed
 * before the failure.
 */
export async function runFileGesture(task: () => Promise<unknown>, failureKey: TransKey, rerender: () => void): Promise<void> {
	try {
		await task();
	} catch (e) {
		console.error("[quiz-blocks] file gesture failed:", e);
		currentHost().ui.notice(t(failureKey));
	}
	rerender();
}

/**
 * `onConfirm` est appelé AU CLIC, juste après avoir demandé la fermeture —
 * comme le faisait la classe d'avant, et à la différence d'`openConfirmModal`
 * (`editor/modals.ts`, qui attend la disparition). La différence ne se voit
 * pas ici : ce que `onConfirm` lance est une écriture ASYNCHRONE, et le
 * repeint n'arrive qu'à son terme, bien après les 240 ms de l'animation.
 *
 * Les classes sont celles d'`openConfirmModal` (`qb-confirm-buttons`,
 * `qb-btn`, `qb-btn-danger`), qui vivent dans le CSS PARTAGÉ
 * (`src/assets/css/editor/`) chargé par les deux hôtes — et non les classes
 * natives d'Obsidian (`modal-button-container`, `mod-cta`, `mod-warning`) que
 * la tâche 9 avait gardées : la fenêtre n'a aucun CSS pour celles-ci, et
 * « Supprimer » et « Annuler » y étaient deux `<button>` bruts
 * INDISCERNABLES. Deux surfaces qui confirment une suppression ne peuvent
 * pas avoir chacune leur habillage.
 */
function openConfirm(spec: ConfirmSpec, onConfirm: () => void): void {
	requireHost("modals").open({
		/* Pas de titre d'hôte : la disposition est celle des confirmations
		   destructives de référence (Tailwind UI, reprise par GitHub et
		   Linear ; Ahmed, 2026-09-19 : « le meilleur modal pour ça ») — une
		   icône dans un disque teinté à gauche, le titre et le message à
		   côté, les boutons à droite. Le titre est donc DANS le corps. */
		className: "qb-confirm-modal" + (spec.warning ? " qb-confirm-modal--danger" : ""),
		onOpen: (m) => {
			const c = m.contentEl;
			const entete = ajouter(c, "div", "qb-confirm-head");
			const disque = ajouter(entete, "div", "qb-confirm-icon");
			currentHost().ui.setIcon(disque, spec.warning ? "trash-2" : "alert-circle");
			const texte = ajouter(entete, "div", "qb-confirm-text");
			ajouter(texte, "h2", "qb-confirm-title", spec.title);
			ajouter(texte, "p", "qb-confirm-message", spec.body);
			const row = ajouter(c, "div", "qb-confirm-buttons");
			const cancel = ajouter(row, "button", "qb-btn", t("editor.action.cancel"));
			cancel.addEventListener("click", () => m.close());
			const ok = ajouter(row, "button", spec.warning ? "qb-btn qb-btn-danger" : "qb-btn", spec.cta);
			ok.addEventListener("click", () => { m.close(); onConfirm(); });
		},
		/* Pas de `contentEl.empty()` : l'hôte vide le corps lui-même après la
		   disparition (contrat de `HostModalHandle`). */
	});
}

/* ── The rename modal ──
   The field holds the quiz's TITLE (without its mode suffix, put back by
   `renameQuizzes`). The modal only ignores an empty or unchanged name and a
   note gone since the menu opened; the name rules, the collision test and the
   message for each refusal belong to `renameQuizzes`. On `false` the modal
   STAYS OPEN so the user fixes the name instead of retyping it. */
function openRenameQuizModal(ctx: DashboardShellCtx, quizzes: QuizIndexEntry[], onDone: () => void): void {
	const quiz = quizzes[0];
	let name = quiz.title;
	requireHost("modals").open({
		className: "qbd-medit-modal",
		// t() at render (on open), never in a top-level constant.
		title: t("dashboard.quizzes.renameTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.renameLabel"));
			const input = ajouter(c, "input", "qbd-medit-input");
			input.type = "text";
			input.value = name;
			input.addEventListener("input", () => { name = input.value; });
			// The whole name selected: the usual case is to retype it.
			window.setTimeout(() => { input.focus(); input.select(); }, 0);
			// Incoming [[links]] in other notes are not rewritten: said once, quietly.
			ajouter(c, "p", "qbd-medit-hint", t("dashboard.quizzes.renameLinksHint"));

			let busy = false;
			const apply = async (): Promise<void> => {
				if (busy) return;
				if (!name.trim() || name.trim() === quiz.title) { m.close(); return; }
				// The note vanished between the menu and the click: nothing to fix in the name.
				if (!currentHost().fs.getFile(quiz.path)) {
					currentHost().ui.notice(t("dashboard.detail.fileNotFound"));
					m.close();
					return;
				}
				busy = true;
				try {
					// `false`: the reason is already shown; the typed name stays to be fixed.
					if (!await renameQuizzes(ctx, quizzes, name)) return;
				} finally { busy = false; }
				m.close();
				currentHost().ui.notice(t("dashboard.quizzes.renamed"));
				onDone();
			};
			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.quizzes.renameCta"));
			save.addEventListener("click", () => { void apply(); });
			input.addEventListener("keydown", (e) => { if (e.key === "Enter") void apply(); });
		},
	});
}

/* ── Annuler la dernière suppression (Ctrl+Z, Ahmed 2026-09-19) ──
   Ce qu'il faut pour remettre une note comme elle était : son contenu
   d'AVANT, ce qu'on a écrit à la place (ou rien, si elle est partie à la
   corbeille), et ses statistiques. Une seule opération retenue, la dernière
   — un module entier en compte plusieurs. La corbeille garde sa copie : la
   restauration réécrit le contenu au chemin d'origine, sans rien retirer de
   la corbeille (aucun hôte n'expose « sortir de la corbeille »). */
interface SuppressionAnnulable {
	path: string;
	avant: string;
	/** Ce qui a été écrit à la place ; `null` si la note est à la corbeille. */
	apres: string | null;
	stats: QuizStatRecord | null;
}
let derniereSuppression: SuppressionAnnulable[] = [];

/** Remet en place la dernière suppression. `false` s'il n'y a rien à
    annuler ; une note modifiée depuis (ou recréée) n'est pas touchée. */
export async function annulerDerniereSuppression(ctx: DashboardShellCtx): Promise<boolean> {
	const lot = derniereSuppression;
	if (lot.length === 0) return false;
	derniereSuppression = [];
	const fs = currentHost().fs;
	let restaures = 0;
	for (const s of lot) {
		try {
			let ok = false;
			if (s.apres === null) {
				/* Partie à la corbeille : le chemin doit être LIBRE. */
				if (await fs.exists(s.path)) continue;
				await fs.write(s.path, s.avant);
				ok = true;
			} else {
				/* Le bloc seul retiré : compare-and-swap sur ce qu'on avait écrit. */
				await fs.process(s.path, (content) => {
					ok = content === s.apres;
					return ok ? s.avant : content;
				});
			}
			if (!ok) continue;
			if (s.stats) ctx.statsStore?.restoreRecord(s.path, s.stats);
			const file = fs.getFile(s.path);
			if (file) await ctx.scanner.scanFile(file);
			restaures++;
		} catch (e) {
			console.error("[quiz-blocks] restauration impossible :", s.path, e);
		}
	}
	currentHost().ui.notice(t(restaures === lot.length ? "dashboard.quizzes.restored" : "dashboard.quizzes.restoredPartial", { count: lot.length - restaures }));
	return restaures > 0;
}

/** "Quiz deleted", with the Ctrl+Z hint only where a keyboard is expected:
    a phone has no Ctrl+Z, and the hint promised a gesture it cannot make. */
function deletedNotice(): string {
	return t(currentHost().platform.isMobile ? "dashboard.quizzes.deletedPhone" : "dashboard.quizzes.deleted");
}

async function deleteQuiz(ctx: DashboardShellCtx, quiz: QuizIndexEntry): Promise<void> {
	// `getFile` rend null pour un dossier comme pour un absent : la garde
	// reste nécessaire, seule sa forme a changé (`instanceof TFile` avant).
	if (!currentHost().fs.getFile(quiz.path)) {
		currentHost().ui.notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	// La note peut ne plus contenir de bloc (supprimé ailleurs entre-temps) :
	// annoncer « Quiz supprimé » serait alors faux.
	derniereSuppression = [];
	if (await deleteQuizCore(ctx, quiz)) currentHost().ui.notice(deletedNotice());
	else currentHost().ui.notice(t("dashboard.detail.noBlockInNote"));
}

/**
 * Cœur du delete, sans Notice (partagé quiz seul / module entier). L'appelant
 * a déjà vérifié que la note est au catalogue (`fs.getFile`).
 *
 * `fs.process` et non `read` + `write` : entre les deux, ce que
 * l'utilisateur venait d'écrire ailleurs dans la note était écrasé — et si ce
 * qu'il avait écrit était la seule chose qui restait, la note partait À LA
 * CORBEILLE sur la foi d'une lecture périmée (revue codex 2026-07-31). La
 * décision « il ne reste rien » se prend donc sur le contenu RÉEL au moment de
 * l'écriture, et la mise à la corbeille n'a lieu qu'après.
 */
async function deleteQuizCore(ctx: DashboardShellCtx, quiz: QuizIndexEntry): Promise<boolean> {
	const fs = currentHost().fs;
	const stats = ctx.statsStore?.getRecord(quiz.path) ?? null;
	let videApresRetrait = false;
	let avaitUnBloc = false;
	/** Ce qu'on a écrit à la place du contenu d'origine (pour l'annulation). */
	let ecrit: string | null = null;
	/** Le contenu vu par le dernier passage du rappel — le témoin d'un
	    éventuel `trash`. */
	let vu = "";
	await fs.process(quiz.path, (content) => {
		// Le rappel peut être rejoué : repartir de zéro à chaque essai.
		vu = content;
		avaitUnBloc = QUIZ_BLOCK_RE.test(content);
		if (!avaitUnBloc) { videApresRetrait = false; return content; }
		const remaining = content.replace(QUIZ_BLOCK_RE, "");
		/* Vide aussi quand il ne reste que le frontmatter `neo-quiz:` que
		   l'application avait écrit : ce n'est pas le contenu de l'utilisateur. */
		videApresRetrait = remaining.trim().length === 0 || neContientQueLeFrontmatterNeoQuiz(remaining);
		// Rien d'autre dans la note : on ne la vide pas pour la jeter juste
		// après — on la laisse telle quelle et c'est la corbeille qui l'emporte.
		ecrit = videApresRetrait ? null : remaining;
		return videApresRetrait ? content : remaining;
	});
	/* Aucun bloc trouvé : la note a été vidée ailleurs entre-temps. On ne
	   touche ni au fichier ni aux statistiques — supprimer l'enregistrement
	   d'un quiz qu'on n'a pas supprimé effacerait un historique de révision
	   pour rien (revue codex 2026-07-31). */
	if (!avaitUnBloc) {
		/* Sauf la carcasse d'une suppression d'avant : le bloc parti, le
		   frontmatter de l'application resté (c'est ce que faisait ce code
		   jusqu'au 2026-09-19). Elle n'a rien de l'utilisateur : corbeille. */
		if (neContientQueLeFrontmatterNeoQuiz(vu)) {
			await fs.trash(quiz.path);
			ctx.statsStore?.deleteRecord(quiz.path);
			derniereSuppression.push({ path: quiz.path, avant: vu, apres: null, stats });
			return true;
		}
		return false;
	}
	if (videApresRetrait) {
		/* COMPARE-AND-SWAP avant la corbeille : entre le rappel et ici,
		   quelqu'un a pu ajouter du texte à la note. La jeter emporterait ce
		   texte (revue codex 2026-07-31). Si elle a changé, on se rabat sur le
		   retrait du seul bloc — la note reste, avec ce qui vient d'y être
		   écrit. */
		let jetee = false;
		await fs.process(quiz.path, (content) => {
			if (content !== vu) {
				jetee = false;
				ecrit = content.replace(QUIZ_BLOCK_RE, "");
				return ecrit;
			}
			jetee = true;
			return content;
		});
		/* La note ne contenait que le quiz : corbeille (RÉCUPÉRABLE), jamais de
		   suppression définitive — c'est ce que `fs.trash` promet, chaque hôte
		   avec sa propre convention.
		   Fenêtre résiduelle assumée : une écriture arrivée entre ce
		   compare-and-swap et `trash` partira quand même à la corbeille.
		   Aucun hôte n'expose de « jeter si inchangé », et c'est précisément
		   parce qu'on ne peut pas la fermer que la corbeille est le seul geste
		   admis ici — l'utilisateur récupère sa note en un clic. */
		if (jetee) await fs.trash(quiz.path);
	}
	ctx.statsStore?.deleteRecord(quiz.path);
	derniereSuppression.push({ path: quiz.path, avant: vu, apres: ecrit, stats });
	return true;
}

/** Deletes every quiz of a course card (its Learn and its Test): each one
    through the same core, one after the other; a failure is counted, never
    thrown, so a course is never half-deleted without a word. */
async function deleteCourseQuizzes(ctx: DashboardShellCtx, quizzes: readonly QuizIndexEntry[]): Promise<void> {
	let failures = 0;
	/* A fresh undo batch, as the single and folder deletes start one: without
	   it Ctrl+Z after "Delete both" also brought back quizzes deleted earlier. */
	derniereSuppression = [];
	for (const q of quizzes) {
		try {
			if (!await deleteQuizCore(ctx, q)) failures++;
		} catch {
			failures++;
		}
	}
	currentHost().ui.notice(failures > 0
		? t("dashboard.quizzes.deletedPartial", { count: failures })
		: deletedNotice());
}

/** The folder on disk that "Delete folder" may send to the trash, or `null`:
    never a root itself, never a folder holding the generated-quizzes folder,
    and nothing for a group declared without a path. */
function trashableFolder(ctx: DashboardShellCtx, group: ModuleGroup): string | null {
	const sas = ctx.generatedFolder?.();
	if (!group.path || currentHost().paths.localPath(group.path) === "") return null;
	if (sas && (sas === group.path || sas.startsWith(group.path + "/"))) return null;
	return group.path;
}

/** "Delete folder": the FOLDER goes to the host's trash (recoverable) with
    everything in it, and its declaration is forgotten on every device.

    Until 2026-10-08 this gesture only deleted the folder's quizzes. A folder
    the user DECLARED ("New folder", "Open an existing folder") is shown even
    with no quiz (`modulesAffiches`), so its empty card stayed on the page
    after every delete, with no gesture left to remove it. */
export async function deleteFolder(ctx: DashboardShellCtx, group: ModuleGroup): Promise<void> {
	if (estLeSas(group, ctx.generatedFolder?.())) return;
	const host = currentHost();
	const folder = trashableFolder(ctx, group);
	const inside = (p: string): boolean => !!folder && p.startsWith(folder + "/");
	/* A fresh undo batch: the folder itself cannot be brought back from here
	   (it is in the trash), and Ctrl+Z must not revive an older delete. */
	derniereSuppression = [];
	let echecs = 0;
	/* Quizzes filed under this folder's key but living OUTSIDE its path (a
	   namesake folder in another root): removed one by one, as before. A
	   note that resists does not stop the others. */
	for (const q of group.quizzes) {
		if (inside(q.path)) continue;
		if (!host.fs.getFile(q.path)) { echecs++; continue; }
		try {
			if (!await deleteQuizCore(ctx, q)) echecs++;
		} catch (e) {
			echecs++;
			console.error("[quiz-blocks] quiz delete failed:", q.path, e);
		}
	}
	// A folder already gone from disk only loses its declaration.
	if (folder && await host.fs.exists(folder)) await host.fs.trash(folder);
	for (const q of group.quizzes) if (inside(q.path)) ctx.statsStore?.deleteRecord(q.path);
	/* Forget every declaration of this folder: its key, and any other key
	   pointing at the same path. Removing the key tombstones each field in
	   the synced folder settings, so another device does not bring it back. */
	const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
	for (const [key, ov] of Object.entries(overrides)) {
		if (key === group.folder || (group.path && ov?.path === group.path)) delete overrides[key];
	}
	ctx.settings.quizzesModuleOverrides = overrides;
	if (ctx.settings.quizzesArchivedFolders?.includes(group.folder)) {
		ctx.settings.quizzesArchivedFolders = ctx.settings.quizzesArchivedFolders.filter(f => f !== group.folder);
	}
	await ctx.saveSettings();
	host.ui.notice(echecs
		? t("dashboard.quizzes.deletedPartial", { count: echecs })
		: t("dashboard.quizzes.folderDeleted", { name: group.name }));
}

/* ── Move ONE quiz to another known folder ──
   Unlike `moveModuleTo` (which moves a whole FOLDER between two roots),
   this moves a quiz's NOTE to a "My quizzes" folder chosen in the submenu —
   the same destination folders as the page (the groups of
   `buildUeGroups`/`buildModuleGroups`, on the same `map`). With a new
   `basename` it also RENAMES the note in place: a Test's mode change
   (" — Practice" ↔ " — Exam", dashboard/detail.ts).

   A free name through `freeNotePath` (the same guard as "New quiz" /
   `folder-create.ts`): never an overwrite, a namesake gets " (2)".

   `targetName` ONLY names the target in messages (success, folder gone) —
   never used to write, where only `targetFolder` (a contract path) counts.

   NOT fixed here, reported by the re-review of 2026-09-27 as PREDATING this
   work and out of its batch: `freeNotePath` (`folder-create.ts`) only
   escapes Windows' forbidden characters, never reserved names (`CON`,
   `NUL`, `COM1`…) nor a trailing dot/space — such a name lands on disk but
   becomes nearly undeletable from Explorer (Minor 3,
   `move-to-rereview.md`). And `bornerEcriture` (`perimetre.ts`) resolves
   the path on EACH call rather than once for the operation: an intermediate
   folder replaced by a junction between two resolutions would leave the
   perimeter (Minor 4, same review) — it would already take an actor writing
   to disk outside the app, which the bridge does not allow to create. */
export async function moveQuizTo(ctx: DashboardShellCtx, quiz: QuizIndexEntry, targetFolder: string, targetName: string,
	/* A NEW file name (without `.md`), for a rename in place: changing a
	   Test's mode renames "— Practice" ↔ "— Exam" (spec 2026-09-29 §5.1) —
	   the same path as a move, so review history and stats follow. Absent:
	   the note keeps its name. */
	basename: string = quiz.basename): Promise<string | null> {
	const host = currentHost();
	/* REVUE (2026-09-27) : un dossier CONNU du catalogue (il a déjà un quiz,
	   donc un `ModuleGroup`) peut avoir disparu du DISQUE depuis — supprimé
	   hors de l'app pendant que le catalogue en mémoire le référence encore.
	   Sans cette garde, `freeNotePath` boucle sur un dossier absent (il
	   rendrait le premier nom, `exists` étant faux partout) et `rename`
	   échoue ensuite avec une erreur système brute (`ENOENT` sur le dossier
	   PARENT), que le `catch` plus bas afficherait comme une erreur générique
	   — correct, mais moins clair que de le dire ICI, avant même d'écrire. */
	if (!(await host.fs.exists(targetFolder))) {
		host.ui.notice(t("dashboard.quizzes.moveFolderMissing", { target: targetName }));
		return null;
	}
	const to = await freeNotePath(targetFolder, basename);
	return await relocateQuiz(ctx, quiz, to, "dashboard.quizzes.moveQuizExists", "dashboard.quizzes.moveQuizError") ? to : null;
}

/**
 * Moves or renames ONE quiz note to `to`, then carries everything keyed by its
 * path: the review log, the stats, and what the host keeps under that path
 * (sessions, test setups). The ONE path of "Move to", of a Test's mode change
 * and of "Rename": a rename is a move into the same folder, so history,
 * progress and the session follow it exactly as they follow a move.
 *
 * `existsKey` / `errorKey`: the message for a name collision and for any other
 * failure. `false` once that message is shown; nothing else was changed.
 */
async function relocateQuiz(ctx: DashboardShellCtx, quiz: QuizIndexEntry, to: string, existsKey: TransKey, errorKey: TransKey): Promise<boolean> {
	const host = currentHost();
	try {
		if (sameFileName(quiz.path, to)) await renameCaseOnly(quiz.path, to);
		else await host.fs.rename(quiz.path, to);
	} catch (e) {
		/* The host puts a recognisable message on a collision ("<path> existe
		   déjà", `apps/windows/electron/fichiers.ts`): only that case keeps the
		   precise toast; anything else (a full disk, a refused permission) is a
		   generic failure, its real cause in the console. Classified by
		   SUBSTRING on purpose (re-review 2026-09-27, Minor 7): this runs in the
		   renderer, and the error has crossed Electron's IPC, which rebuilds a
		   bare `Error` (`name`, `message`, `stack`): a `code` property set by the
		   main process would read `undefined` here. The message does cross. */
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes("existe déjà")) {
			host.ui.notice(t(existsKey));
		} else {
			console.error("[quiz-blocks] could not move the quiz:", quiz.path, "->", to, e);
			host.ui.notice(t(errorKey));
		}
		return false;
	}
	// Review history: the same call as `moveModuleTo`, which already tells a
	// move WITHIN one root (rewritten in place) from one BETWEEN two roots.
	await ctx.reviewStore?.moved(quiz.path, to);
	/* STATS (keyed by path). Needed here, not just nice to have: a host whose
	   `HostFs.rename` emits no rename event (the contract does not require
	   one) would leave `statsStore.renamed` without a caller. Idempotent: if
	   the event still comes (the app's rename detector), the second call no
	   longer finds the old key and does nothing. */
	ctx.statsStore.renamed(quiz.path, to);
	/* Everything the host keeps under this path (saved sessions, remembered
	   test setups; exams and folder settings for a folder move): the host
	   renames its own keys (`DashboardShellCtx.movedPrefix`). Before
	   2026-10-01 a session in progress stayed indexed under the OLD path after a
	   move and never resumed. */
	await ctx.movedPrefix?.(quiz.path, to);
	return true;
}

/** Two paths that name the same file on a case-insensitive file system
    (Windows, Android's shared storage): NFC, case folded. */
function sameFileName(a: string, b: string): boolean {
	return a !== b && a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}

/** "cm1" -> "CM1": the target IS the source on a case-insensitive disk, so the
    host's no-overwrite rename refuses it. Through a hidden temporary name, and
    back to the source if the second step fails. */
async function renameCaseOnly(from: string, to: string): Promise<void> {
	const fs = currentHost().fs;
	const tmp = `${parentFolder(to)}/.renaming-${Date.now().toString(36)}.md`;
	await fs.rename(from, tmp);
	try {
		await fs.rename(tmp, to);
	} catch (e) {
		await fs.rename(tmp, from).catch(() => undefined);
		throw e;
	}
}

/* ── Rename / duplicate a quiz ──
   A quiz's title IS its note's name without the mode suffix (`titreSansMode`,
   scanner.ts). The field shows that TITLE, the one the card shows; the suffix
   (" — Learn", " — Practice", " — Exam") is put back automatically. Showing it
   would let a slip in the field remove it, and a note without its suffix stops
   pairing with the other modes of its course (`course-pairs.ts`) and loses the
   type the file explorer reads.

   Name rules: those of a share (`share-names.ts`: NFC, forbidden and invisible
   characters, Windows device names, length). A name already in the folder, in
   any case, is refused with a message and nothing is written: unlike "Move to"
   or "New quiz", a name the user typed is never turned into "Name (2)".

   Incoming wikilinks ([[old name]]) in other notes are NOT rewritten: no host
   keeps an index of incoming links since the Obsidian plugin was removed
   (2026-10-01). The modal says so in one line. */

/** The suffix a note's name carries after its title (" — Exam"), or "". */
function modeSuffix(quiz: QuizIndexEntry): string {
	const parts = separerNomDeNote(quiz.basename, quiz.mode);
	return parts ? quiz.basename.slice(parts.base.length, quiz.basename.length - parts.counter.length) : "";
}

function parentFolder(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

function inFolder(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}

/** Is a file named `name` (with extension) already in `folder`, in any case? */
async function nameTaken(folder: string, name: string): Promise<boolean> {
	const host = currentHost();
	const target = name.normalize("NFC").toLowerCase();
	const entries = await host.fs.listDir(folder);
	if (entries.some(e => e.name.normalize("NFC").toLowerCase() === target)) return true;
	return host.fs.exists(inFolder(folder, name));
}

export type QuizNameVerdict = { ok: true; basename: string } | { ok: false; key: TransKey };

/** The note name `title` gives `quiz` (its mode suffix kept), or why it cannot. */
export function quizNoteName(quiz: QuizIndexEntry, title: string): QuizNameVerdict {
	const v = baseNameVerdict(title);
	if (!v.ok) return { ok: false, key: v.reason === "empty" ? "dashboard.quizzes.renameEmpty" : "dashboard.quizzes.renameReserved" };
	const basename = v.name + modeSuffix(quiz);
	if (basename.length > NAME_MAX || !fitsPath(parentFolder(quiz.path), basename + ".md")) return { ok: false, key: "dashboard.quizzes.renameTooLong" };
	return { ok: true, basename };
}

/**
 * Renames the quizzes of a card (one quiz, or the modes of a course, which
 * keep their pairing) to `title`, each keeping its own mode suffix. Every
 * target is checked BEFORE the first rename: a refused name writes nothing.
 * `true` once renamed; `false` after showing why (the modal then stays open
 * for the name to be fixed).
 */
export async function renameQuizzes(ctx: DashboardShellCtx, quizzes: QuizIndexEntry[], title: string): Promise<boolean> {
	const host = currentHost();
	const targets: Array<{ quiz: QuizIndexEntry; to: string }> = [];
	for (const quiz of quizzes) {
		const v = quizNoteName(quiz, title);
		if (!v.ok) { host.ui.notice(t(v.key)); return false; }
		const folder = parentFolder(quiz.path);
		const to = inFolder(folder, `${v.basename}.md`);
		if (to === quiz.path) continue;
		if (!sameFileName(quiz.path, to) && await nameTaken(folder, `${v.basename}.md`)) {
			host.ui.notice(t("dashboard.quizzes.renameExists"));
			return false;
		}
		targets.push({ quiz, to });
	}
	for (const { quiz, to } of targets) {
		if (!await relocateQuiz(ctx, quiz, to, "dashboard.quizzes.renameExists", "dashboard.quizzes.renameError")) return false;
	}
	return true;
}

/** Most copies tried before giving up (" (copy 2)" ... " (copy 999)"). */
const COPY_ATTEMPTS = 999;

/**
 * Duplicates the quizzes of a card: the same note, byte for byte, in the same
 * folder, as "<title> (copy)" — then "(copy 2)", "(copy 3)"... — each keeping
 * its mode suffix, under the same rules and collision test as a rename. A
 * course is copied whole, under ONE copy number, so the copies pair together.
 * Only the note: an image cited by a relative path in the same folder stays
 * valid, and nothing keyed by the old path (history, stats, session,
 * attempts) is carried: the copy has another path, so other review keys
 * (`keyOfQuestion`), and starts as a new quiz. The new paths, or `null` after
 * showing why.
 */
export async function duplicateQuizzes(quizzes: QuizIndexEntry[]): Promise<string[] | null> {
	const host = currentHost();
	if (quizzes.length === 0) return null;
	const word = t("dashboard.quizzes.copyWord");
	for (let n = 1; n <= COPY_ATTEMPTS; n++) {
		const mark = n === 1 ? ` (${word})` : ` (${word} ${n})`;
		const targets: string[] = [];
		let taken = false;
		for (const quiz of quizzes) {
			// A long title is cut so that the mark and the suffix still fit.
			const room = NAME_MAX - mark.length - modeSuffix(quiz).length;
			const v = quizNoteName(quiz, quiz.title.slice(0, Math.max(1, room)).trimEnd() + mark);
			if (!v.ok) { host.ui.notice(t(v.key)); return null; }
			const folder = parentFolder(quiz.path);
			if (await nameTaken(folder, `${v.basename}.md`)) { taken = true; break; }
			targets.push(inFolder(folder, `${v.basename}.md`));
		}
		if (taken) continue;
		for (const [i, quiz] of quizzes.entries()) {
			await host.fs.writeBinary(targets[i], await host.fs.readBinary(quiz.path));
		}
		return targets;
	}
	host.ui.notice(t("dashboard.quizzes.duplicateError"));
	return null;
}

/* ── Menus ── */

/** Menu ⋯ d'une carte de quiz — l'ordre et la rangée rouge suivent la
    référence StudySmarter. Bâti AU CLIC (le nom du quiz peut avoir changé).
    AUCUNE entrée d'archivage : l'archivage n'existe qu'au niveau dossier
    (Ahmed 2026-07-19). `map` sert au sous-menu « Déplacer vers » : les
    dossiers connus de « Mes quiz », groupés par UE. `anchorEl`, comme pour
    `buildModuleCardMenu`, est l'ancre où poser ce sous-menu — absent (appelant
    qui ne le fournirait pas encore), pas d'entrée « Déplacer vers » : un
    sous-menu sans rien où s'ancrer ne s'ouvrirait nulle part. */
export function buildQuizCardMenu(ctx: DashboardShellCtx, rerender: () => void, map: ModuleMap): (quiz: QuizIndexEntry, anchorEl?: HTMLElement, solo?: boolean) => ActionMenuItem[] {
	return (quiz, anchorEl, solo) => {
		/* Capturés dans des constantes : le rétrécissement de type d'un `if`
		   sur `ctx.shareQuiz` ne survivrait pas jusqu'au `onClick`. */
		const { shareQuiz } = ctx;
		const items: ActionMenuItem[] = [];
		// Poussée seulement si l'hôte sait partager : une entrée grise se lit
		// comme une panne, une entrée absente comme un hôte qui fait autre
		// chose (même geste que `onMenu?` sur les cartes, tranche 2.5).
		if (shareQuiz) items.push({
			icon: "share-2",
			label: t("dashboard.quizzes.menuShare"),
			// Même modal de partage que les dossiers (Discord / enregistrer),
			// avec le .md du quiz seul — remplace l'ancienne copie de bloc
			// texte, jugée insuffisante (demande Ahmed 2026-07-19).
			onClick: () => { shareQuiz({ quiz }); },
		});
		items.push({
			icon: "pencil",
			label: t("dashboard.detail.edit"),
			// La page du quiz, en ÉDITION, DANS le dashboard : ouvrir un
			// onglet à côté ferait deux surfaces pour le même quiz, alors
			// qu'un clic sur la carte mène déjà à cette page.
			onClick: () => { ctx.navigate("detail", { quiz, edit: true }); },
		});
		/* « Déplacer vers » — juste après Edit (demande Ahmed 2026-09-27). Les
		   dossiers CONNUS : ceux de la page « Mes quiz » (`modulesAffiches`), vides compris,
		   sur les quiz du catalogue entier (pas seulement ceux affichés/filtrés
		   à l'écran), qui portent un CHEMIN réel (`g.path`) — un groupe déclaré
		   sans quiz ni chemin n'est nulle part où écrire. Le dossier COURANT du
		   quiz est RETIRÉ de la liste (jamais grisé : demande Ahmed, ne pas
		   toucher au composant de menu partagé pour un état désactivé). */
		if (anchorEl) {
			const dossierActuel = moduleForQuiz(quiz.path, map).path;
			// Les MÊMES dossiers que la page « Mes quiz », vides compris.
			const archives = ctx.settings.quizzesArchivedFolders || [];
			const sas = ctx.generatedFolder?.();
			const groupes = modulesAffiches(ctx.scanner.getQuizzes(), {}, map,
				declaredFolders(ctx.settings.quizzesModuleOverrides), archives, sas)
				.filter(g => g.path && g.path !== dossierActuel && !archives.includes(g.folder));
			/* Un SOUS-MENU ouvert au survol, flèche à droite (Ahmed, 2026-09-27),
			   au lieu d'un second menu qui remplaçait le premier au clic. */
			const sousItems: ActionMenuItem[] = [];
			let derniereUe: string | undefined;
			const ues = buildUeGroups(groupes, map);
			const plusieursUe = ues.length > 1;
			for (const ue of ues) {
				for (const g of ue.modules) {
					const generated = estLeSas(g, sas);
					sousItems.push({
						// L'icône et la couleur de la CARTE du dossier (2026-09-27).
						icon: moduleIcon(g, { generated }),
						iconColor: moduleAccent(g, { generated }),
						label: g.name,
						/* L'UE en INTERTITRE, à la place du filet, et plus en
						   accessoire à droite : il mangeait la place du nom du
						   dossier (Ahmed, 2026-09-27). Seulement quand il y a
						   plusieurs UE : seule, elle ne distingue rien. */
						section: plusieursUe && derniereUe !== ue.key ? (ue.ue ?? t("dashboard.quizzes.noUe")) : undefined,
						onClick: () => {
							/* A course brought together (its modes on one card,
							   `course-pairs.ts`) moves as a whole: moving only one of
							   its files would split the course without a word
							   (2026-09-27). The others only move once the first has;
							   when one fails, `moveQuizTo` says so itself. */
							const freres = quizFreres(quiz, ctx.scanner.getQuizzes());
							void runFileGesture(async () => {
								const to = await moveQuizTo(ctx, quiz, g.path as string, g.name);
								if (!to) return;
								for (const f of freres) await moveQuizTo(ctx, f, g.path as string, g.name);
								currentHost().ui.notice(t("dashboard.quizzes.movedQuiz", { target: g.name }));
							}, "dashboard.quizzes.moveQuizError", rerender);
						},
					});
					derniereUe = ue.key;
				}
			}
			if (sousItems.length > 0) items.push({
				icon: "folder-input",
				label: t("dashboard.quizzes.menuMoveQuiz"),
				submenu: sousItems,
			});
		}
		// « Keep exam mode » (a Test only): checkable, written into the note.
		const keepExam = keepExamMenuItem(ctx, quiz, rerender);
		if (keepExam) items.push(keepExam);
		/* Rename and Duplicate act on the quizzes of the CARD: the modes of a
		   course together (the copies and the new names keep them paired), a
		   single quiz on a folder page (`solo`). Both go through the contract
		   (`HostFs.rename`, `readBinary`/`writeBinary`), so every host has them. */
		const deLaCarte = solo ? [quiz] : [quiz, ...quizFreres(quiz, ctx.scanner.getQuizzes())];
		items.push({
			// "text-cursor-input", not a pencil: "Edit" (pencil) already opens
			// the question editor, two pencils would be confused.
			icon: "text-cursor-input",
			label: t("dashboard.quizzes.menuRename"),
			onClick: () => { openRenameQuizModal(ctx, deLaCarte, rerender); },
		});
		items.push({
			icon: "copy-plus",
			label: t("dashboard.quizzes.menuDuplicate"),
			onClick: () => {
				void runFileGesture(async () => {
					if (await duplicateQuizzes(deLaCarte)) currentHost().ui.notice(t("dashboard.quizzes.duplicated"));
				}, "dashboard.quizzes.duplicateError", rerender);
			},
		});
		/* « Copier le chemin » — le chemin ABSOLU, comme le Ctrl+Maj+C de
		   l'explorateur (Ahmed, 2026-09-17). Sans `absolutePath`, pas d'entrée :
		   même règle que Partager et Renommer, une entrée qui ne peut pas tenir
		   sa promesse ne s'affiche pas. L'échec de la copie se DIT — le
		   presse-papiers peut être refusé, et un menu qui se ferme sans rien
		   faire laisserait croire que c'est copié. */
		if (ctx.absolutePath && ctx.copyText) items.push({
			icon: "copy",
			label: t("dashboard.quizzes.menuCopyPath"),
			onClick: () => {
				const absolu = ctx.absolutePath?.(quiz.path);
				if (!absolu) { currentHost().ui.notice(t("dashboard.quizzes.pathCopyFailed")); return; }
				void ctx.copyText?.(absolu).then(ok => {
					currentHost().ui.notice(t(ok ? "dashboard.quizzes.pathCopied" : "dashboard.quizzes.pathCopyFailed"));
				});
			},
		});
		/* A course brought together (its quizzes on one card, `course-pairs.ts`)
		   says WHICH quiz goes (2026-09-29): "Delete quiz" on such a card did
		   not tell whether the Learn, the Test or both would be removed. A
		   submenu names each quiz by its type, then offers all of them. Every
		   path still confirms, and goes through `deleteQuizCore`. */
		/* `solo`: the card stands for this one quiz only (the folder page
		   shows one card per quiz), so Delete removes just it. */
		const freres = solo ? [] : quizFreres(quiz, ctx.scanner.getQuizzes());
		const confirmerUn = (q: QuizIndexEntry): void => {
			openConfirm({
				title: t("dashboard.quizzes.deleteConfirmTitle", { title: freres.length ? `${q.title} (${quizModeLabel(q.mode)})` : q.title }),
				/* With its type (2026-09-29): the Learn and the Test of a course
				   share their title, and "Delete « CM1 »?" did not say which. */
				body: t("dashboard.quizzes.deleteConfirmBody", { title: freres.length ? `${q.title} (${quizModeLabel(q.mode)})` : q.title }),
				cta: t("dashboard.quizzes.deleteConfirmCta"),
				warning: true,
			}, () => { void runFileGesture(() => deleteQuiz(ctx, q), "dashboard.quizzes.deleteError", rerender); });
		};
		if (freres.length === 0) {
			items.push({
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDelete"),
				danger: true,
				onClick: () => confirmerUn(quiz),
			});
		} else {
			const cours = [quiz, ...freres].sort(parMode);
			items.push({
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDelete"),
				danger: true,
				submenu: [
					...cours.map((q): ActionMenuItem => ({
						icon: quizModeIcon(q.mode),
						label: t("dashboard.quizzes.menuDeleteType", { type: quizModeLabel(q.mode) }),
						danger: true,
						onClick: () => confirmerUn(q),
					})),
					{
						icon: "trash-2",
						label: t(cours.length === 2 ? "dashboard.quizzes.menuDeleteBoth" : "dashboard.quizzes.menuDeleteAll", { count: cours.length }),
						danger: true,
						onClick: () => {
							openConfirm({
								title: t("dashboard.quizzes.deleteCourseConfirmTitle", { count: cours.length, title: quiz.title }),
								body: t("dashboard.quizzes.deleteCourseConfirmBody", { count: cours.length, title: quiz.title }),
								cta: t("dashboard.quizzes.deleteConfirmCta"),
								warning: true,
							}, () => { void deleteCourseQuizzes(ctx, cours).then(rerender); });
						},
					},
				],
			});
		}
		return items;
	};
}

/** Menu ⋯ d'une carte de module — mêmes rangées que la carte de quiz
    (demande Excalidraw 2026-07-18), adaptées au niveau module :
    Share = zip des notes du module (envoyable sur Discord), Edit = nom /
    UE / couleur du dossier (le renommage du module vit là, d'où l'absence
    d'entrée « Rename » ici), Archive = LE DOSSIER (flag unique
    quizzesArchivedFolders — jamais par quiz), Delete = tous les quiz du
    module (confirmation avec le compte). */
/** Déplace le dossier `g.folder` vers la racine `toRoot`, sous le même nom
    de dossier, puis transpose l'historique de révision qui lui appartient
    (§2.3 de la spec) — voir `moveModuleTo` plus bas pour le détail. Séparée
    de `buildModuleCardMenu` pour rester testable sans DOM. */
export async function moveModuleTo(ctx: DashboardShellCtx, g: ModuleGroup, toRootId: string): Promise<boolean> {
	const host = currentHost();
	/* Le CHEMIN du dossier, jamais `g.folder`, qui n'est que son NOM
	   (« Templates » pour « Personal/Templates ») : le renommage visait un
	   chemin inexistant et échouait en disant « existe déjà » (2026-09-27).
	   L'entrée n'est offerte qu'à un dossier qui a un chemin. */
	const source = g.path;
	if (!source || estLeSas(g, ctx.generatedFolder?.())) return false;
	const localFrom = host.paths.localPath(source);
	// Une RACINE entière (un quiz posé à la racine, `localFrom === ""`) ne se
	// déplace jamais par ce chemin : le menu la masque déjà (B-mineur,
	// 2026-09-27), ce second garde-fou protège l'appel direct.
	if (localFrom === "") return false;
	// Dernier segment du chemin local : « B1/Cours/Reseaux » → « Reseaux ».
	// Le dossier arrive à la racine cible SOUS LE MÊME NOM (spec §2.3), pas
	// sous son chemin complet — un module d'un vault n'a pas à recréer toute
	// l'arborescence de son ancien vault dans le dossier par défaut.
	const nomDossier = localFrom.split("/").pop() ?? localFrom;
	const to = host.paths.contractPath(toRootId, nomDossier);
	/* The catalogue's paths BEFORE the rename: the watcher (300 ms debounce)
	   may swap them for the new ones before `movedPrefix` runs. */
	const cheminsAvant = ctx.scanner?.getQuizzes().map(q => q.path);
	try {
		await host.fs.rename(source, to);
	} catch (e) {
		/* Le contrat de `rename` refuse d'écraser : un homonyme existe déjà
		   à la cible, rien n'a bougé. Toute autre erreur est un échec
		   générique — même tri, par le message, que `moveQuizTo`. */
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes("existe déjà")) {
			host.ui.notice(t("dashboard.quizzes.moveExists"));
		} else {
			console.error("[quiz-blocks] déplacement de dossier impossible :", source, "->", to, e);
			host.ui.notice(t("dashboard.quizzes.moveFolderError"));
		}
		return false;
	}
	await ctx.reviewStore?.moved(source, to);
	/* Stats (by path, prefix-aware) and everything the host keeps by path or
	   module key (exams, sessions, test setups, folder settings) follow the
	   folder; before 2026-10-01 only the review log did. */
	ctx.statsStore.renamed(source, to);
	await ctx.movedPrefix?.(source, to, cheminsAvant);
	return true;
}

export function buildModuleCardMenu(ctx: DashboardShellCtx, rerender: () => void, map: ModuleMap): (g: ModuleGroup, anchorEl?: HTMLElement) => ActionMenuItem[] {
	return (g, anchorEl) => {
		const archived = isFolderArchived(ctx, g.folder);
		/* The "Generated" folder can be neither renamed, archived, moved nor
		   deleted (by its PATH): it is where generations land. */
		const fixe = estLeSas(g, ctx.generatedFolder?.());
		const { shareQuiz } = ctx;
		const host = currentHost();
		const items: ActionMenuItem[] = [];
		// Absente, jamais grise : voir `buildQuizCardMenu`.
		if (shareQuiz) items.push({
			icon: "share-2",
			label: t("dashboard.quizzes.menuShare"),
			// A small window first: the whole folder, or a choice of its quizzes.
			onClick: () => { openShareChooser(g, shareQuiz); },
		});
		if (!fixe) items.push({
			icon: "pencil",
			label: t("dashboard.detail.edit"),
			// Modal « Modifier dossier » calqué sur StudySmarter (nom / UE /
			// couleur, sans le toggle public) — remplace l'ancienne ouverture
			// de la note de correspondance, jugée non fonctionnelle.
			onClick: () => { openModuleEditModal(ctx, g, map, rerender); },
		});
		/* LE DOSSIER, vu du système : l'ouvrir dans l'explorateur et copier
		   son chemin. Tout tient à `g.path` — un groupe DÉCLARÉ sans quiz ni
		   dossier n'en a pas, et deux entrées qui ne mèneraient nulle part
		   valent moins que leur absence (même règle que Partager). */
		if (g.path && ctx.openFolder) items.push({
			icon: "folder-open",
			label: t("dashboard.quizzes.menuOpenFolder"),
			onClick: () => {
				void ctx.openFolder?.(g.path as string).then(ok => {
					if (!ok) host.ui.notice(t("dashboard.folder.openFailed", { name: g.name }));
				});
			},
		});
		if (g.path && ctx.absolutePath && ctx.copyText) items.push({
			icon: "copy",
			label: t("dashboard.quizzes.menuCopyPath"),
			onClick: () => {
				const absolu = ctx.absolutePath?.(g.path as string);
				if (!absolu) { host.ui.notice(t("dashboard.quizzes.pathCopyFailed")); return; }
				void ctx.copyText?.(absolu).then(ok => {
					host.ui.notice(t(ok ? "dashboard.quizzes.pathCopied" : "dashboard.quizzes.pathCopyFailed"));
				});
			},
		});
		if (!fixe) items.push({
			icon: "archive",
			label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
			// Direct dans les deux sens (demande Ahmed 2026-07-19 : plus
			// aucune confirmation d'archivage). Un seul flag par DOSSIER :
			// opérationnel même quand la grille ne montre aucun quiz du
			// module (l'ancien modèle par-quiz rendait « Unarchive »
			// inopérant sur un module entièrement archivé, g.quizzes filtré
			// étant vide).
			onClick: () => { setFolderArchived(ctx, g.folder, !archived); rerender(); },
		});
		// Une seule racine (le vault, sous Obsidian) : rien où déplacer.
		// `anchorEl` manquant (appelant qui n'aurait pas encore été mis à jour) :
		// même chose, plutôt que d'ouvrir un sous-menu sans rien à y ancrer.
		const roots = host.paths.roots();
		// `localPath(g.path) === ""` : `g` n'est pas un DOSSIER mais la
		// RACINE elle-même (un quiz posé à la racine, sans sous-dossier —
		// `quiz-modules.ts` lui donne alors `path = <rootId>`). La déplacer
		// déplacerait tout le vault ; masquer l'entrée plutôt que de laisser
		// `moveModuleTo` échouer sur « existe déjà » (revue du 2026-09-27, B-mineur).
		if (!fixe && anchorEl && roots.length > 1 && g.path && host.paths.localPath(g.path) !== "") {
			// Sous-menu au survol, comme « Move to » d'un quiz (2026-09-27).
			const rootDeG = host.paths.rootOf(g.path);
			const cibles = roots.filter(root => root.id !== rootDeG?.id);
			if (cibles.length > 0) items.push({
				icon: "folder-input",
				label: t("dashboard.quizzes.menuMove"),
				submenu: cibles.map(root => ({
					// Le logo d'Obsidian pour un vault, comme au pied des cartes.
					icon: "folder",
					renderIcon: root.vault ? (el: HTMLElement) => { poserLogoObsidian(el, t("dashboard.quizzes.obsidianVault")); } : undefined,
					label: root.name,
					onClick: () => {
						openConfirm({
							title: t("dashboard.quizzes.moveConfirmTitle"),
							body: t("dashboard.quizzes.moveConfirmBody", { name: g.name, target: root.name }),
							cta: t("dashboard.quizzes.moveConfirmCta"),
						}, () => {
							void moveModuleTo(ctx, g, root.id).then(ok => {
								if (ok) {
									host.ui.notice(t("dashboard.quizzes.moved", { target: root.name }));
									rerender();
								}
							}).catch(e => {
								/* `moveModuleTo` reports a failed rename itself; this catches
								   anything thrown AFTER it (review log, stats, host keys) or
								   before it, which used to be an unhandled rejection: no
								   notice at all. The folder may already have moved, so the
								   page refreshes too. */
								console.error("[quiz-blocks] folder move failed:", g.path, "->", root.id, e);
								host.ui.notice(t("dashboard.quizzes.moveFolderError"));
								rerender();
							});
						});
					},
				})),
			});
		}
		/* A folder opened from elsewhere on the PC is a root of its own: it can be
		   taken out of Neo Quiz (files untouched), never the default one. */
		const racineDeG = g.path ? host.paths.rootOf(g.path) : null;
		if (ctx.removeExtraRoot && racineDeG && racineDeG.id !== host.paths.defaultRoot().id) items.push({
			icon: "folder-minus",
			label: t("dashboard.quizzes.menuRemoveRoot"),
			onClick: () => {
				openConfirm({
					title: t("dashboard.quizzes.removeRootTitle", { name: racineDeG.name }),
					body: t("dashboard.quizzes.removeRootBody"),
					cta: t("dashboard.quizzes.removeRootCta"),
					warning: true,
				}, () => { void runFileGesture(async () => { await ctx.removeExtraRoot?.(racineDeG.id); }, "dashboard.quizzes.removeRootError", rerender); });
			},
		});
		if (!fixe) items.push({
			icon: "trash-2",
			label: t("dashboard.quizzes.menuDeleteFolder"),
			danger: true,
			onClick: () => {
				openConfirm({
					title: t("dashboard.quizzes.deleteFolderConfirmTitle", { name: g.name }),
					body: t(trashableFolder(ctx, g) ? "dashboard.quizzes.deleteFolderConfirmBody" : "dashboard.quizzes.deleteFolderConfirmBodyNoDisk", { name: g.name }),
					cta: t("dashboard.quizzes.deleteConfirmCta"),
					warning: true,
				}, () => { void runFileGesture(() => deleteFolder(ctx, g), "dashboard.quizzes.deleteFolderError", rerender); });
			},
		});
		return items;
	};
}
