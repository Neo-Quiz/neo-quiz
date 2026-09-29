import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { HostModalHandle } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleMap } from "./quiz-modules";
import { openNewFolderModal, commonModuleParent } from "./module-edit";
import { nomNoteImportee, parseZip } from "./zip";
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
			/* MASQUÉE sous le greffon, comme la carte IA et pour une raison du
			   même ordre : sous Obsidian, le vault EST le dossier ouvert, il n'y
			   a aucun dossier à désigner. Les deux premières CRÉENT, celle-ci
			   RATTACHE de l'existant, la dernière IMPORTE du reçu. */
			if (ctx.openExistingFolder) {
				createOptionCard(m, c, "folder-open", "#f5a524", t("dashboard.quizzes.createOpenTitle"), t("dashboard.quizzes.createOpenDesc"),
					() => ctx.openExistingFolder!(onDone));
			}
			createOptionCard(m, c, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
				() => void importSharedFolder(ctx, map, quizzes, onDone));
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
			resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}

export async function importSharedFolder(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onDone: () => void
): Promise<void> {
	const picked = await pickFile(".zip,application/zip");
	if (!picked) return;
	// Seules les notes `.md` au nom sûr entrent (voir `nomNoteImportee`).
	const entries = parseZip(picked.bytes).filter(e => nomNoteImportee(e.name) !== null);
	if (entries.length === 0) {
		currentHost().ui.notice(t("dashboard.quizzes.importEmpty"));
		return;
	}
	// Dossier cible : base du zip, assainie, sous le parent commun des modules ;
	// suffixe (2), (3)… si un dossier du même nom existe déjà.
	const base = picked.name.replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim() || "Import";
	const parent = commonModuleParent(quizzes, map);
	const root = parent ? `${parent}/${base}` : base;
	let folderPath = root;
	/* `fs.exists` (le DISQUE) et non `fs.getFile` : ce dernier ne consulte que
	   l'index des `.md`, où un DOSSIER n'est jamais. Il répondrait donc
	   toujours « absent », la boucle ne dédoublonnerait rien, et deux dossiers
	   du même nom se retrouveraient fondus en silence. */
	for (let n = 2; await currentHost().fs.exists(folderPath); n++) folderPath = `${root} (${n})`;

	try {
		await currentHost().fs.mkdirs(folderPath);
		for (const e of entries) {
			/* Aplatir : on n'écrit que le nom de note, jamais un sous-chemin
			   d'archive, et SEULEMENT une note `.md` (`nomNoteImportee`,
			   2026-09-25) : l'archive vient d'un tiers, et un `.exe`, un `.lnk`
			   ou un fichier caché n'ont rien à faire dans un dossier de cours. */
			const noteName = nomNoteImportee(e.name);
			if (!noteName) continue;
			/* Le MÊME dédoublonnage que les autres imports, et pour une raison
			   neuve : deux entrées venues de sous-dossiers différents s'aplatissent
			   parfois sur le même nom, et `fs.write` REMPLACE là où `vault.create`
			   rejetait — la première note disparaissait sans un mot, là où
			   l'utilisateur voyait autrefois une erreur d'import. */
			await currentHost().fs.write(await freeNotePath(folderPath, noteName), e.content);
		}
	} catch {
		currentHost().ui.notice(t("dashboard.quizzes.importError"));
		return;
	}

	// Déclaré en override : la carte du module apparaît tout de suite.
	const folderKey = folderPath.split("/").pop() as string;
	const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
	if (!overrides[folderKey]) overrides[folderKey] = { name: base };
	ctx.settings.quizzesModuleOverrides = overrides;
	ctx.saveSettings().catch(() => {});
	currentHost().ui.notice(t("dashboard.quizzes.importDone", { name: base, count: entries.length }));
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
	const base = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "quiz";
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
			const entries = parseZip(picked.bytes).filter(e => nomNoteImportee(e.name) !== null && QUIZ_BLOCK_RE.test(e.content));
			if (entries.length === 0) { currentHost().ui.notice(t("dashboard.quizzes.importEmpty")); return; }
			for (const e of entries) {
				await currentHost().fs.write(await freeNotePath(folder, nomNoteImportee(e.name) as string), e.content);
			}
			currentHost().ui.notice(t("dashboard.quizzes.importDone", { name: folder.split("/").pop() || folder, count: entries.length }));
		} else {
			const content = new TextDecoder().decode(picked.bytes);
			if (!QUIZ_BLOCK_RE.test(content)) { currentHost().ui.notice(t("dashboard.quizzes.importNoQuiz")); return; }
			// Le nom venu du sélecteur, assaini comme une entrée d'archive.
			const name = nomNoteImportee(picked.name) ?? "Quiz";
			await currentHost().fs.write(await freeNotePath(folder, name), content);
			currentHost().ui.notice(t("dashboard.quizzes.importQuizDone", { name }));
		}
	} catch {
		currentHost().ui.notice(t("dashboard.quizzes.importError"));
		return;
	}
	onDone();
}
