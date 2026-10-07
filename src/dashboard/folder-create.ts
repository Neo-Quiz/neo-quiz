import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { HostModalHandle } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleMap } from "./quiz-modules";
import { openNewFolderModal, commonModuleParent, defaultParent } from "./module-edit";
import { IMPORT_LIMITS, ZipReadError, nomNoteImportee } from "./zip";
import { exportBaseName, folderNameFromArchive } from "./share-names";
import { ImportPathTooLongError, applyPlan, planFor, receiveArchive, scanTarget } from "./share-import";
import type { ReceivedArchive } from "./share-import";
import type { DiscardReason, ImportPlan } from "./share-plan";
import { sha256Hex } from "./share-manifest";
import { LOG_PREFIX } from "../branding";
import { makeDefault } from "../editor/utils";
import { exportAllWithFence } from "../editor/export";

/* ══════════════════════════════════════════════════════════
   CREATE FOLDER — modal « Créer un dossier » calqué sur StudySmarter
   (capture Ahmed 2026-07-19) : trois cartes-options empilées (icône
   teintée + titre + description + chevron). Créer avec l'IA → page
   Générer ; Ensemble vide → openNewFolderModal ; Importer → un zip partagé
   est dézippé et recréé dans le vault. Accents de la démo (vert/bleu/
   violet) posés inline, teinte dérivée en CSS.
══════════════════════════════════════════════════════════ */

/** An option row of the creation modal (tinted icon + title + description,
    no chevron since 2026-09-29) — shared by BOTH creation modals: same DOM,
    same classes. `modal` is null on the empty home (`home.ts`), where the
    same options render on the page: nothing to close. */
export function createOptionCard(modal: HostModalHandle | null, parent: HTMLElement, icon: string, accent: string, title: string, desc: string, onPick: () => void): void {
	const card = ajouter(parent, "button", "qbd-create-option");
	card.type = "button";
	card.style.setProperty("--accent", accent);
	const ic = ajouter(card, "div", "qbd-create-option-icon");
	currentHost().ui.setIcon(ic, icon);
	const txt = ajouter(card, "div", "qbd-create-option-text");
	ajouter(txt, "div", "qbd-create-option-title", title);
	ajouter(txt, "div", "qbd-create-option-desc", desc);
	card.addEventListener("click", () => { modal?.close(); onPick(); });
}

export function openCreateFolderModal(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onDone: () => void
): void {
	requireHost("modals").open({
		className: "qbd-create-modal",
		// t() AU RENDU (à l'ouverture du modal), jamais dans une constante de
		// haut niveau : une chaîne figée au chargement ignorerait un changement
		// de langue.
		title: t("dashboard.quizzes.createFolderTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			/* MASQUÉE (pas grisée) quand l'hôte ne sait pas servir « ai » : la
			   carte FERME la modale avant de naviguer, donc un hôte qui refuse
			   cette navigation (l'application, dont le routeur consulte le MÊME
			   `canOpen`) laisserait l'utilisateur devant un écran inchangé, sans
			   notice ni page. Même geste et même source de vérité unique que les
			   CTA « Générer » de l'accueil (`home.ts`, deux fois). */
			/* No "Create with AI" here any more (2026-09-29): a folder is created
			   first, its quizzes are generated from inside it. */
			createOptionCard(m, c, "folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
				() => openNewFolderModal(ctx, map, quizzes, onDone));
			/* "Create with AI" is back (2026-10-05): creating is this modal's
			   one job, AI included; it opens the Generate page. */
			if (ctx.canOpen("ai")) {
				createOptionCard(m, c, "sparkles", "#3ddc84", t("dashboard.quizzes.createAiTitle"), t("dashboard.quizzes.createAiDesc"),
					() => ctx.navigate("ai"));
			}
			/* The first two CREATE, this one ATTACHES an existing folder (any
			   folder on the PC), the last one IMPORTS what was received. */
			if (ctx.openExistingFolder) {
				createOptionCard(m, c, "folder-open", "#f5a524", t("dashboard.quizzes.createOpenTitle"), t("dashboard.quizzes.createOpenDesc"),
					() => ctx.openExistingFolder!(onDone));
			}
			/* Import has its own button beside "New folder" on a PC; a phone
			   has no room for a third floating button, so it stays here. */
			if (currentHost().platform.isMobile) {
				createOptionCard(m, c, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
					() => void importSharedFolder(ctx, map, quizzes, onDone));
			}
		},
	});
}

/* ── Import of a received archive (.zip) or quiz (.md). File picking is
   cross-platform (an <input type=file>, no Node). The decision is
   `share-plan.ts` (pure), the writing `share-import.ts` (staging, then one
   rename); this module is the part that talks to the user. ── */

function pickFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) { resolve(null); return; }
			/* Refused BEFORE reading: `arrayBuffer()` of a multi-gigabyte file
			   would hold it all in memory first. */
			if (file.size > IMPORT_LIMITS.archive) { currentHost().ui.notice(t("share.import.tooLarge")); resolve(null); return; }
			resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}

const why = (reason: DiscardReason): string => t(`share.why.${reason}` as "share.why.corrupt");

/** A short list for a notice: the first five names, then a count. */
function shortList(items: string[]): string {
	return items.slice(0, 5).join(", ") + (items.length > 5 ? ` +${items.length - 5}` : "");
}

/** Reads a received archive, or says why it cannot be (and returns null). */
async function receive(bytes: Uint8Array): Promise<ReceivedArchive | null> {
	try {
		return await receiveArchive(bytes);
	} catch (e) {
		const code = e instanceof ZipReadError ? e.code : "invalid";
		currentHost().ui.notice(t(
			code === "too-large" || code === "too-many" ? "share.import.tooLarge"
				: code === "zip64" ? "share.import.zip64"
				: code === "multi-disk" ? "share.import.multiDisk"
				: code === "overlap" || code === "duplicate" ? "share.import.overlap"
				: code === "unsafe-path" ? "share.import.unsafePath"
				: "share.import.unreadable"));
		return null;
	}
}

/** Tells the user what an import did: added, skipped as identical, renamed,
    left out (each with its reason), plus the notices of the archive itself.
    Called for a plan that wrote something AND for one that wrote nothing. */
function report(plan: ImportPlan, name: string): void {
	const ui = currentHost().ui;
	const notes = plan.writes.filter(w => w.kind === "note").length;
	const images = plan.writes.length - notes;
	if (plan.writes.length > 0) {
		// Each count agrees with its own noun ("1 image", not "1 images"), and a
		// part with nothing in it is left out.
		const parts = [
			notes > 0 ? t(notes === 1 ? "share.import.added.notes.one" : "share.import.added.notes", { count: notes }) : "",
			images > 0 ? t(images === 1 ? "share.import.added.images.one" : "share.import.added.images", { count: images }) : "",
		].filter(Boolean);
		const what = parts.length === 2 ? t("share.import.added.and", { a: parts[0], b: parts[1] }) : parts[0];
		ui.notice(t("share.import.added", { name, what }));
	} else if (plan.duplicates.length > 0 && plan.discarded.length === 0) {
		ui.notice(t("share.import.nothing"));
	} else if (plan.discarded.length === 0 || plan.discarded.every(d => d.reason === "unsupported-type")) {
		ui.notice(t("share.import.empty"));
	}
	if (plan.writes.length > 0 && plan.duplicates.length > 0) ui.notice(t("share.import.duplicates", { count: plan.duplicates.length }));
	if (plan.renamed.length > 0) ui.notice(t("share.import.renamed", { count: plan.renamed.length, list: shortList(plan.renamed.map(r => `${r.from} -> ${r.to}`)) }));
	if (plan.discarded.length > 0) {
		ui.notice(t("share.import.skipped", { count: plan.discarded.length, list: shortList(plan.discarded.map(d => `${d.name.split(/[\\/]/).pop()} (${why(d.reason)})`)) }));
	}
	if (plan.missing.length > 0) ui.notice(t("share.import.missing", { count: plan.missing.length, list: shortList(plan.missing) }));
	if (plan.notices.includes("newer-format")) ui.notice(t("share.import.newerFormat"));
	if (plan.notices.includes("manifest-invalid")) ui.notice(t("share.import.manifestInvalid"));
}

/** The notice for a failed import: the path-too-long case names the file. */
function noticeFailure(e: unknown): void {
	currentHost().ui.notice(e instanceof ImportPathTooLongError
		? t("share.import.pathTooLong", { name: e.fileName })
		: t("share.import.failed"));
}

export async function importSharedFolder(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onDone: () => void
): Promise<void> {
	const picked = await pickFile(".zip,application/zip");
	if (!picked) return;
	await importArchiveAsFolder(ctx, map, quizzes, picked, onDone);
}

/** Recreates a received archive as a NEW folder (the file picker's step is
    `importSharedFolder`; this is the rest, so a check can drive the real
    import without a file dialog). The folder's look (colour, icon, name,
    unit) comes from the archive's manifest, for a new folder only. */
export async function importArchiveAsFolder(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	picked: { name: string; bytes: Uint8Array },
	onDone: () => void
): Promise<void> {
	const received = await receive(picked.bytes);
	if (!received) return;
	const plan = planFor(received, new Map(), false, folderNameFromArchive(picked.name));
	if (plan.writes.length === 0) { report(plan, plan.folderName); return; }
	const parent = commonModuleParent(quizzes, map, defaultParent());
	let folderPath: string;
	try {
		folderPath = await applyPlan(plan, { kind: "new", parent: parent ?? "", name: plan.folderName });
	} catch (e) {
		noticeFailure(e);
		return;
	}

	// Declared as an override: the module card appears at once.
	const folderKey = folderPath.split("/").pop() as string;
	// No prototype: a key such as `constructor` must stay a plain key (`baseNameVerdict` also refuses those names).
	const overrides: NonNullable<typeof ctx.settings.quizzesModuleOverrides> = Object.assign(Object.create(null), ctx.settings.quizzesModuleOverrides || {});
	const previous = overrides[folderKey] || {};
	const look = plan.settings;
	/* The card carries the FOLDER name, suffix included: two imports of the
	   same archive must not give two cards both called "Demo". With its PATH:
	   only a declared folder with one shows as a card (`declaredFolders`). A
	   setting already stored under that key is never overwritten. */
	overrides[folderKey] = {
		...(look?.color ? { color: look.color } : {}),
		...(look?.icon ? { icon: look.icon } : {}),
		...(look?.ue ? { ue: look.ue } : {}),
		...previous,
		name: previous.name || (look?.name && folderKey === plan.folderName ? look.name : folderKey),
		path: folderPath,
	};
	ctx.settings.quizzesModuleOverrides = overrides;
	ctx.saveSettings().catch((e) => console.warn(`${LOG_PREFIX} saving the imported folder's settings failed:`, e));
	report(plan, folderKey);
	onDone();
}

/* ── Drill-down d'un dossier : créer un quiz dedans / y importer un quiz reçu.
   (Le header y remplace « New folder », qui n'a pas de sens dans un dossier —
   demande Ahmed 2026-07-19.) ── */

/** Chemin libre dans `folder` : « nom.md », sinon « nom (2).md »…
    `folder` vide = racine du vault (module « racine », légitime). `ext` n'est
    `.md` que par défaut : l'ajout de fichiers d'un dossier garde celle du
    fichier choisi.

    `fs.exists` (le DISQUE) et non `fs.getFile` (l'index des `.md`), alors même
    qu'il s'agit d'une NOTE : `fs.write` écrit d'abord sur le disque, et l'index
    ne le suit pas partout. L'hôte Obsidian passe désormais par le vault, qui
    indexe aussitôt ; l'application, elle, l'apprend par un surveillant DÉBOUNCÉ
    de 300 ms (`apps/windows/src/host/fs.ts`). Interroger l'index y rendrait deux
    fois le même nom libre dans les boucles d'import, et la seconde note
    écraserait la première. Le disque, lui, dit la vérité sous les deux hôtes. */
export async function freeNotePath(folder: string, name: string, ext = ".md"): Promise<string> {
	const base = exportBaseName(name, "quiz");
	const prefix = folder ? `${folder}/` : "";
	let path = `${prefix}${base}${ext}`;
	for (let n = 2; await currentHost().fs.exists(path); n++) path = `${prefix}${base} (${n})${ext}`;
	return path;
}

/** Le dossier physique peut manquer (module déclaré par simple override).
    `mkdirs` ne rejette pas s'il est déjà là : le test d'existence qui le
    précédait n'apportait rien. */
export async function ensureFolder(folder: string): Promise<void> {
	if (folder) await currentHost().fs.mkdirs(folder);
}

/** « New quiz » : note pré-remplie d'une question vierge (le même défaut que
    l'éditeur), puis ouverture directe dans l'éditeur visuel. */
export async function createQuizInFolder(ctx: DashboardShellCtx, folder: string): Promise<void> {
	try {
		await ensureFolder(folder);
		const path = await freeNotePath(folder, t("dashboard.quizzes.newQuizDefaultName"));
		await currentHost().fs.write(path, exportAllWithFence([makeDefault("single")]) + "\n");
		// En ÉDITION d'emblée : la question qu'on vient de créer est vierge.
		// Appel optionnel : l'application n'a pas d'éditeur avant la tranche 3,
		// et la note créée reste alors simplement fermée.
		await ctx.openQuizPath?.(path, { edit: true });
	} catch {
		currentHost().ui.notice(t("dashboard.quizzes.newQuizError"));
	}
}

/** « Import » : un .md partagé (quiz seul) ou un .zip (plusieurs notes) est
    recréé DANS le dossier ouvert — le pendant réception de quizShareSource. */
export async function importQuizIntoFolder(ctx: DashboardShellCtx, folder: string, onDone: () => void): Promise<void> {
	const picked = await pickFile(".md,.zip,text/markdown,application/zip");
	if (!picked) return;
	await importFileIntoFolder(folder, picked, onDone);
}

/** Writes a shared quiz (.md) or a shared folder's archive (.zip) into
    `folder`: the ONE path of the file picker and of a file dropped on an
    empty folder (2026-09-29). Whatever brought the file, the same plan and the
    same staged write: existing files are never overwritten, an identical quiz
    is not duplicated, a different one with the same name becomes "Name (2)". */
export async function importFileIntoFolder(folder: string, picked: { name: string; bytes: Uint8Array }, onDone: () => void): Promise<void> {
	let received: ReceivedArchive | null;
	let isQuiz = false;
	if (/\.zip$/i.test(picked.name)) {
		received = await receive(picked.bytes);
		if (!received) return;
	} else {
		if (picked.bytes.length > IMPORT_LIMITS.entry) { currentHost().ui.notice(t("share.import.tooLarge")); return; }
		isQuiz = true;
		const quizName = `${nomNoteImportee(picked.name) ?? "Quiz"}.md`;
		received = { files: [{ name: quizName, bytes: picked.bytes, sha256: await sha256Hex(picked.bytes) }], skipped: [], junk: 0 };
	}
	try {
		const existing = await scanTarget(folder, received.files);
		const plan = planFor(received, existing, true, folder.split("/").pop() || folder);
		if (isQuiz && plan.discarded.some(d => d.reason === "no-quiz")) { currentHost().ui.notice(t("share.import.noQuiz")); return; }
		if (plan.writes.length > 0) await applyPlan(plan, { kind: "into", folder });
		report(plan, folder.split("/").pop() || folder);
	} catch (e) {
		noticeFailure(e);
		return;
	}
	onDone();
}
