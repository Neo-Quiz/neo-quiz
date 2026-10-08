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

/* ══════════════════════════════════════════════════════════
   QUIZ MENU — contenu du menu ⋯ des cartes de « Mes quiz ».
   Dérivé de la capture StudySmarter d'Ahmed (Excalidraw, 2026-07-18) :
   Share / Edit / Rename / Archive / Delete (rouge), adaptés au plugin :
   - Share    → copie le bloc ```quiz-blocks``` dans le presse-papier ;
   - Rename   → renomme la NOTE (le titre d'un quiz EST son basename,
                cf. scanner.ts) — carte de quiz seulement, la carte de
                module renomme déjà via « Edit » ;
   - Archive  → masque le quiz partout, revient via la pilule « Archivés » ;
   - Delete   → supprime le bloc de la note (corbeille si la note ne
                contenait que lui) + ses stats, après confirmation.
   (« Pause study reminders » retiré le 2026-07-21 à la demande d'Ahmed —
   avec sa mécanique : sans entrée de menu, un quiz déjà suspendu serait
   resté hors du « À faire » sans aucun moyen de le reprendre.)

   Tranche 3 (tâche 9) : ce module ne connaît plus Obsidian. La suppression
   passe par `HostFs` (`process`, `trash`), les deux modales par
   `HostModals`. Partager et Renommer, eux, ne sont PAS des opérations du
   contrat : elles restent des membres OPTIONNELS du ctx (`shareQuiz?`,
   `renameQuiz?`), remplis par le greffon et absents de l'application — voir
   leur justification dans `types/dashboard-ctx.ts`. Le menu de la fenêtre
   a donc DEUX entrées sur quatre (Éditer, Supprimer), et pas une ligne
   grise de plus : une entrée absente se lit comme un hôte qui fait autre
   chose, une entrée désactivée comme une panne.
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

/* ── Renommage d'un quiz ──
   Le titre d'un quiz EST le basename de sa note (scanner.ts) : renommer =
   renommer le fichier, via `ctx.renameQuiz` — que le greffon remplit avec
   `fileManager.renameFile`, jamais `vault.rename`, pour qu'Obsidian réécrive
   les liens entrants ([[ancien nom]]) tout seul. `HostFs.rename` ne convient
   pas (il déplace des octets sans rien réécrire), d'où le membre optionnel du
   ctx plutôt qu'un appel au contrat : voir `types/dashboard-ctx.ts`.
   Les stats suivent : stats-store écoute l'évènement de renommage du
   surveillant (il couvre donc AUSSI un renommage fait à la main dans
   l'explorateur).

   RÉPARTITION DES GARDES. La modale ne fait que ce que les deux hôtes savent
   faire pareil : assainir le nom, ignorer un nom vide ou inchangé, vérifier
   que la note existe encore (`fs.getFile`). La collision avec un fichier
   déjà présent, le renommage lui-même et l'AFFICHAGE de la cause d'un échec
   (Notice « existe déjà », « impossible ») appartiennent à l'hôte, dans
   `renameQuiz` : lui seul sait comment son index voit la cible. Le rappel
   rend `true` si renommé, `false` sinon — la modale se ferme sur `true`,
   RESTE OUVERTE sur `false` pour que l'utilisateur corrige le nom au lieu
   de le retaper. */
function openRenameQuizModal(
	quiz: QuizIndexEntry,
	renameQuiz: (quiz: QuizIndexEntry, nom: string) => Promise<boolean>,
	onDone: () => void,
): void {
	let name = quiz.basename;
	requireHost("modals").open({
		className: "qbd-medit-modal",
		// t() AU RENDU (à l'ouverture), jamais dans une constante de haut niveau.
		title: t("dashboard.quizzes.renameTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.renameLabel"));
			const input = ajouter(c, "input", "qbd-medit-input");
			input.type = "text";
			input.value = name;
			input.addEventListener("input", () => { name = input.value; });
			// Sélection du nom entier : le cas courant est de tout retaper.
			window.setTimeout(() => { input.focus(); input.select(); }, 0);

			const apply = async (): Promise<void> => {
				// Mêmes caractères interdits que freeNotePath (folder-create.ts).
				const nom = name.trim().replace(/[\\/:*?"<>|]/g, "-");
				if (!nom || nom === quiz.basename) { m.close(); return; }
				// La note a disparu entre l'ouverture du menu et le clic : rien à
				// corriger dans le nom, la modale se ferme (conduite d'avant).
				if (!currentHost().fs.getFile(quiz.path)) {
					currentHost().ui.notice(t("dashboard.detail.fileNotFound"));
					m.close();
					return;
				}
				// `false` : l'hôte a déjà dit pourquoi ; le nom saisi reste à
				// l'écran pour être corrigé.
				if (!await renameQuiz(quiz, nom)) return;
				m.close();
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

/** Delete d'un MODULE entier : chaque quiz passe par le même cœur. */
async function deleteModuleQuizzes(ctx: DashboardShellCtx, group: ModuleGroup): Promise<void> {
	/* Une note qui résiste n'arrête pas les autres, et ne fait pas passer la
	   suppression pour un échec total : chaque quiz est indépendant, et laisser
	   une exception remonter d'ici laissait le module A MOITIÉ supprimé avec
	   une interface qui ne se redessinait même pas (revue codex 2026-07-31). */
	let echecs = 0;
	if (estLeSas(group, ctx.generatedFolder?.())) return;
	derniereSuppression = [];
	for (const q of group.quizzes) {
		// Fichier introuvable (ou dossier à ce chemin — `getFile` rend null
		// dans les deux cas) : c'est un échec comme un autre, pas un silence.
		// Le compter est la seule façon pour l'utilisateur de savoir que le
		// module n'a pas été entièrement supprimé.
		if (!currentHost().fs.getFile(q.path)) { echecs++; continue; }
		try {
			// Un `false` — aucun bloc trouvé — est un échec comme un autre :
			// l'annoncer comme un succès faisait croire le module entièrement
			// supprimé (revue codex 2026-07-31).
			if (!await deleteQuizCore(ctx, q)) echecs++;
		} catch (e) {
			echecs++;
			console.error("[quiz-blocks] suppression impossible :", q.path, e);
		}
	}
	currentHost().ui.notice(echecs
		? t("dashboard.quizzes.deletedPartial", { count: echecs })
		: deletedNotice());
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
	try {
		await host.fs.rename(quiz.path, to);
	} catch (e) {
		/* REVUE (2026-09-27) : le `catch` affichait TOUJOURS « existe déjà »,
		   y compris pour une panne disque ou un permis refusé sans rapport
		   avec un homonyme. L'hôte (`apps/windows/electron/fichiers.ts`) pose un message reconnaissable pour
		   la collision (« <chemin> existe déjà ») — seul ce cas garde le
		   toast précis ; tout le reste devient un échec générique, la cause
		   réelle dans la console pour qui doit diagnostiquer. */
		/* RE-REVUE (2026-09-27, Mineur 7) : classer par SOUS-CHAÎNE plutôt que
		   par une propriété `code: "EEXIST"` posée par les deux hôtes — laissé
		   ainsi volontairement. `moveQuizTo` s'exécute dans le RENDU de
		   l'application, et l'erreur qu'il reçoit a alors déjà traversé l'IPC
		   Electron (`ipcRenderer.invoke`), qui ne reconstruit qu'un `Error`
		   nu (`name`, `message`, `stack`) — une propriété `code` posée côté
		   principal ne survit pas au passage et se lirait `undefined` ici,
		   sans qu'aucun test ne le révèle (le contrôle du greffon ne passe,
		   lui, jamais par l'IPC). La sous-chaîne, elle, EST le message et
		   franchit l'IPC intacte (revue précédente, confirmé). Un message
		   `EPERM` qui contiendrait par hasard « existe déjà » (un chemin
		   pathologique) resterait mal classé, mais c'est le risque le plus
		   faible des deux. */
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes("existe déjà")) {
			host.ui.notice(t("dashboard.quizzes.moveQuizExists"));
		} else {
			console.error("[quiz-blocks] déplacement de quiz impossible :", quiz.path, "->", to, e);
			host.ui.notice(t("dashboard.quizzes.moveQuizError"));
		}
		return null;
	}
	// Historique de révision : même appel que `moveModuleTo`, qui sait déjà
	// distinguer un déplacement DANS la même racine (un renommage, réécrit en
	// place) d'un déplacement ENTRE deux racines (transposé).
	await ctx.reviewStore?.moved(quiz.path, to);
	/* STATS (indexées par chemin) : `statsStore` n'est PAS optionnel sur ctx,
	   on l'appelle donc sans garde. Nécessaire ici et pas seulement souhaitable :
	   un hôte dont `HostFs.rename` n'émet aucun évènement de renommage
	   (le contrat ne l'y oblige pas) laisserait `statsStore.renamed` sans appelant. Idempotent : si l'évènement finissait quand même
	   par arriver (détecteur de renommage de l'app), le second appel ne
	   trouve plus l'ancienne clé et ne fait rien. */
	ctx.statsStore.renamed(quiz.path, to);
	/* Everything the host keeps under this path (saved sessions, remembered
	   test setups; exams and folder settings for a folder move): the host
	   renames its own keys (`DashboardShellCtx.movedPrefix`). Before
	   2026-10-01 a session in progress stayed indexed under the OLD path after a
	   move and never resumed, an accepted limit while the session store was
	   not reachable from this shared module. */
	await ctx.movedPrefix?.(quiz.path, to);
	return to;
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
export function buildQuizCardMenu(ctx: DashboardShellCtx, rerender: () => void, map: ModuleMap): (quiz: QuizIndexEntry, anchorEl?: HTMLElement) => ActionMenuItem[] {
	return (quiz, anchorEl) => {
		/* Capturés dans des constantes : le rétrécissement de type d'un `if`
		   sur `ctx.shareQuiz` ne survivrait pas jusqu'au `onClick`. */
		const { shareQuiz, renameQuiz } = ctx;
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
		// Même règle que Partager : sans `renameQuiz`, pas d'entrée. Rendre
		// « Renommer » sur `HostFs.rename` casserait les liens entrants en
		// silence — une entrée qui n'existe pas vaut mieux qu'une qui ment.
		if (renameQuiz) items.push({
			// « text-cursor-input » et non un crayon : « Edit » (pencil) ouvre
			// déjà l'éditeur de questions — deux crayons se confondraient.
			icon: "text-cursor-input",
			label: t("dashboard.quizzes.menuRename"),
			onClick: () => { openRenameQuizModal(quiz, renameQuiz, rerender); },
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
		const freres = quizFreres(quiz, ctx.scanner.getQuizzes());
		const confirmerUn = (q: QuizIndexEntry): void => {
			openConfirm({
				title: t("dashboard.quizzes.deleteConfirmTitle"),
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
								title: t("dashboard.quizzes.deleteConfirmTitle"),
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
			label: t("dashboard.quizzes.menuDeleteModule"),
			danger: true,
			onClick: () => {
				openConfirm({
					title: t("dashboard.quizzes.deleteConfirmTitle"),
					body: t("dashboard.quizzes.deleteModuleConfirmBody", { count: g.quizzes.length, name: g.name }),
					cta: t("dashboard.quizzes.deleteConfirmCta"),
					warning: true,
				}, () => { void deleteModuleQuizzes(ctx, g).then(rerender); });
			},
		});
		return items;
	};
}
