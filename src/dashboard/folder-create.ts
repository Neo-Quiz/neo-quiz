import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { HostModalHandle } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleMap } from "./quiz-modules";
import { openNewFolderModal, commonModuleParent, defaultParent } from "./module-edit";
import { IMPORT_LIMITS, ZipReadError, classerArchive, nomNoteImportee, readZip } from "./zip";
import { exportBaseName, fitsPath, folderNameFromArchive } from "./share-names";
import type { ImportedArchive } from "./zip";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
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

/* ── Import d'un dossier partagé (.zip) : sélection cross-platform via un
   <input type=file> (desktop ET mobile, pas de dépendance Node), parseZip
   (store), puis recréation du dossier + de ses notes dans le vault. ── */

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
			if (file.size > IMPORT_LIMITS.archive) { currentHost().ui.notice(t("dashboard.quizzes.importTooLarge")); resolve(null); return; }
			resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}

/** A RECEIVED archive, sorted: what will be written, and every entry left out
    with the translated reason. Nothing is dropped without being listed. */
type ArchiveRecue = ImportedArchive & { ecartes: { name: string; raison: string }[] };

function raisonEcart(code: string): string {
	switch (code) {
		case "encrypted": return t("dashboard.quizzes.importWhy.encrypted");
		case "method": return t("dashboard.quizzes.importWhy.method");
		case "too-big": return t("dashboard.quizzes.importWhy.too-big");
		case "total": return t("dashboard.quizzes.importWhy.total");
		case "ratio": return t("dashboard.quizzes.importWhy.ratio");
		case "bad-crc": return t("dashboard.quizzes.importWhy.bad-crc");
		case "name-mismatch": return t("dashboard.quizzes.importWhy.name-mismatch");
		case "symlink": return t("dashboard.quizzes.importWhy.symlink");
		case "zip64": return t("dashboard.quizzes.importWhy.zip64");
		case "unsupported-type": return t("dashboard.quizzes.importWhy.unsupported-type");
		case "bad-name": return t("dashboard.quizzes.importWhy.bad-name");
		case "image-too-large": return t("dashboard.quizzes.importWhy.image-too-large");
		case "duplicate-image": return t("dashboard.quizzes.importWhy.duplicate-image");
		case "no-quiz": return t("dashboard.quizzes.importWhy.no-quiz");
		default: return t("dashboard.quizzes.importWhy.corrupt");
	}
}

/** Says what an import left out and why (first five, then a count). */
function annoncerEcartes(ecartes: ArchiveRecue["ecartes"]): void {
	if (ecartes.length === 0) return;
	const liste = ecartes.slice(0, 5).map(e => `${e.name.split(/[\\/]/).pop()} (${e.raison})`).join(", ")
		+ (ecartes.length > 5 ? ` +${ecartes.length - 5}` : "");
	currentHost().ui.notice(t("dashboard.quizzes.importSkipped", { count: ecartes.length, list: liste }));
}

/** The notes and images of a RECEIVED archive, or `null` (the window already
    said why): too big, not readable, or nothing importable in it. */
async function lireArchiveRecue(bytes: Uint8Array, quizOnly: boolean): Promise<ArchiveRecue | null> {
	const host = currentHost();
	try {
		const { files, skipped } = await readZip(bytes);
		const classe = classerArchive(files);
		const ecartes: ArchiveRecue["ecartes"] = [
			...skipped.map(x => ({ name: x.name, raison: raisonEcart(x.reason) })),
			...classe.ignored.map(x => ({ name: x.name, raison: raisonEcart(x.reason) })),
		];
		if (quizOnly) {
			const gardees = classe.notes.filter(n => QUIZ_BLOCK_RE.test(n.content));
			for (const n of classe.notes) if (!gardees.includes(n)) ecartes.push({ name: n.name, raison: raisonEcart("no-quiz") });
			classe.notes = gardees;
		}
		if (classe.notes.length === 0) { host.ui.notice(t("dashboard.quizzes.importEmpty")); annoncerEcartes(ecartes); return null; }
		return { ...classe, ecartes };
	} catch (e) {
		const code = e instanceof ZipReadError ? e.code : "invalid";
		host.ui.notice(t(
			code === "too-large" || code === "too-many" ? "dashboard.quizzes.importTooLarge"
				: code === "zip64" ? "dashboard.quizzes.importZip64"
				: code === "multi-disk" ? "dashboard.quizzes.importMultiDisk"
				: code === "overlap" ? "dashboard.quizzes.importOverlap"
				: code === "unsafe-path" ? "dashboard.quizzes.importUnsafePath"
				: "dashboard.quizzes.importUnreadable"));
		return null;
	}
}

/** An imported file whose target path would pass `PATH_MAX`. Thrown BEFORE
    anything is written, so the refusal leaves the disk untouched. */
export class ImportPathTooLongError extends Error {
	constructor(readonly fileName: string) { super(`import-path-too-long: ${fileName}`); }
}

/** Checks every target path of an archive against `PATH_MAX` (room kept for
    a " (n)" suffix), naming the first one that does not fit. */
function verifierChemins(folder: string, archive: ImportedArchive): void {
	for (const f of [...archive.notes, ...archive.images]) {
		if (!fitsPath(folder, `${f.name} (99)`)) throw new ImportPathTooLongError(f.name);
	}
}

/** The notice for a failed import: the path-too-long case names the file. */
function noticeEchecImport(e: unknown): void {
	currentHost().ui.notice(e instanceof ImportPathTooLongError
		? t("dashboard.quizzes.importPathTooLong", { name: e.fileName })
		: t("dashboard.quizzes.importError"));
}

/** Writes what a received archive carries into `folder`: every note under a
    FREE name (`freeNotePath`), every image under its own name, since quizzes
    cite it by name (`![[schema.png]]`). An image whose name is taken keeps
    the file already there when the bytes are the same, and is otherwise left
    out and counted: overwriting a file of the user's from a third party's
    archive is never acceptable. Returns what was written. */
async function ecrireArchive(folder: string, archive: ImportedArchive): Promise<{ notes: number; images: number; imagesKept: number }> {
	const fs = currentHost().fs;
	for (const n of archive.notes) {
		/* Flattened and `.md` only (`nomNoteImportee`, 2026-09-25): the archive
		   comes from a third party, and an `.exe`, a `.lnk` or a hidden file has
		   no place in a course folder. The same de-duplication as the other
		   imports: two entries from different sub-folders flatten to the same
		   name, and `fs.write` REPLACES. */
		await fs.write(await freeNotePath(folder, n.name.replace(/\.md$/i, "")), n.content);
	}
	let images = 0;
	let imagesKept = 0;
	for (const img of archive.images) {
		const path = `${folder}/${img.name}`;
		if (await fs.exists(path)) {
			const existing = await fs.readBinary(path).catch(() => null);
			if (existing && existing.length === img.bytes.length && existing.every((b, i) => b === img.bytes[i])) continue;
			imagesKept++;
			continue;
		}
		await fs.writeBinary(path, img.bytes);
		images++;
	}
	return { notes: archive.notes.length, images, imagesKept };
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
    import without a file dialog). */
export async function importArchiveAsFolder(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	picked: { name: string; bytes: Uint8Array },
	onDone: () => void
): Promise<void> {
	// Only `.md` notes with a safe name and raster images enter (`classerArchive`).
	const archive = await lireArchiveRecue(picked.bytes, false);
	if (!archive) return;
	// Dossier cible : base du zip, assainie, sous le parent commun des modules ;
	// suffixe (2), (3)… si un dossier du même nom existe déjà.
	// Same rules as any imported name (NFC, device names such as `CON.zip`, length,
	// the " (1)" a browser appends to a second download).
	const base = folderNameFromArchive(picked.name);
	const parent = commonModuleParent(quizzes, map, defaultParent());
	const root = parent ? `${parent}/${base}` : base;
	let folderPath = root;
	/* `fs.exists` (le DISQUE) et non `fs.getFile` : ce dernier ne consulte que
	   l'index des `.md`, où un DOSSIER n'est jamais. Il répondrait donc
	   toujours « absent », la boucle ne dédoublonnerait rien, et deux dossiers
	   du même nom se retrouveraient fondus en silence. */
	for (let n = 2; await currentHost().fs.exists(folderPath); n++) folderPath = `${root} (${n})`;

	let written: { notes: number; images: number; imagesKept: number };
	try {
		verifierChemins(folderPath, archive);
		await currentHost().fs.mkdirs(folderPath);
		written = await ecrireArchive(folderPath, archive);
	} catch (e) {
		noticeEchecImport(e);
		return;
	}

	// Déclaré en override : la carte du module apparaît tout de suite.
	const folderKey = folderPath.split("/").pop() as string;
	const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
	/* The card carries the FOLDER name, suffix included: two imports of the
	   same archive must not give two cards both called "Demo". With its PATH:
	   only a declared folder with one shows as a card (`declaredFolders`). */
	overrides[folderKey] = { ...(overrides[folderKey] || {}), name: overrides[folderKey]?.name || folderKey, path: folderPath };
	ctx.settings.quizzesModuleOverrides = overrides;
	ctx.saveSettings().catch(() => {});
	annoncerImport(folderKey, written);
	annoncerEcartes(archive.ecartes);
	onDone();
}

function annoncerImport(name: string, w: { notes: number; images: number; imagesKept: number }): void {
	const host = currentHost();
	host.ui.notice(w.images > 0
		? t("dashboard.quizzes.importDoneImages", { name, count: w.notes, images: w.images })
		: t("dashboard.quizzes.importDone", { name, count: w.notes }));
	if (w.imagesKept > 0) host.ui.notice(t("dashboard.quizzes.importImagesKept", { count: w.imagesKept }));
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
    empty folder (2026-09-29) — same name sanitising (`nomNoteImportee`),
    same quiz block check, whatever brought the file. */
export async function importFileIntoFolder(folder: string, picked: { name: string; bytes: Uint8Array }, onDone: () => void): Promise<void> {
	try {
		await ensureFolder(folder);
		if (/\.zip$/i.test(picked.name)) {
			const archive = await lireArchiveRecue(picked.bytes, true);
			if (!archive) return;
			verifierChemins(folder, archive);
			annoncerImport(folder.split("/").pop() || folder, await ecrireArchive(folder, archive));
			annoncerEcartes(archive.ecartes);
		} else {
			if (picked.bytes.length > IMPORT_LIMITS.entry) { currentHost().ui.notice(t("dashboard.quizzes.importTooLarge")); return; }
			const content = new TextDecoder().decode(picked.bytes);
			if (!QUIZ_BLOCK_RE.test(content)) { currentHost().ui.notice(t("dashboard.quizzes.importNoQuiz")); return; }
			// Le nom venu du sélecteur, assaini comme une entrée d'archive.
			const name = nomNoteImportee(picked.name) ?? "Quiz";
			await currentHost().fs.write(await freeNotePath(folder, name), content);
			currentHost().ui.notice(t("dashboard.quizzes.importQuizDone", { name }));
		}
	} catch (e) {
		noticeEchecImport(e);
		return;
	}
	onDone();
}
