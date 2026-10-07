import { t } from "../../../../src/i18n";
import { currentHost, requireHost } from "../../../../src/host/current";
import { embedTargets, isShareableImage, packShareV1 } from "../../../../src/dashboard/share-pack";
import type { ShareFileIn } from "../../../../src/dashboard/share-pack";
import { IMAGE_IMPORT_MAX_BYTES } from "../../../../src/dashboard/zip";
import { baseNameVerdict, dedupeNames, exportBaseName } from "../../../../src/dashboard/share-names";
import { receiveArchive } from "../../../../src/dashboard/share-import";
import { planImport } from "../../../../src/dashboard/share-plan";
import { createOptionCard } from "../../../../src/dashboard/folder-create";
import { LOG_PREFIX } from "../../../../src/branding";
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import type { ModuleGroup } from "../../../../src/dashboard/quiz-modules";
import { pont } from "../host/pont";
import { PARTAGE_OCCUPE } from "../../electron/pont";

/* ══════════════════════════════════════════════════════════
   « PARTAGER » un quiz ou un dossier (2026-09-25), le modal du greffon
   (`src/dashboard/share.ts`, retiré le 2026-09-13) porté dans l'application.
   On n'a pas de lien mais un FICHIER : le zip des quiz d'un dossier, ou la
   NOTE ENTIÈRE d'un quiz (depuis le 2026-10-07, plus son seul bloc) — ce que « Importer » sait relire. Since
   2026-10-03 it goes straight to the system's share panel (see
   `ouvrirPartage`). The file is built HERE; the main process
   (`electron/partage.ts`) only receives a name and bytes.

   Since 2026-10-07 an archive is FORMAT 1 (`neo-quiz.json`, see
   `share-manifest.ts`): paths relative to the shared folder (sub-folders
   kept, so `![](img/photo.jpg)` still resolves), the size and SHA-256 of
   every file, the folder's look, and a self-check: the bytes are run through
   the importer's own planner before they leave, so an exporter bug cannot
   ship a file the importer would refuse.
══════════════════════════════════════════════════════════ */

/** A quiz, a whole folder, or a selection of quizzes (named after its folder). */
export type CiblePartage = { quiz: QuizIndexEntry } | { group: ModuleGroup } | { quizzes: QuizIndexEntry[]; name: string };

interface Fichier { nom: string; octets: Uint8Array; imagesLaissees: number }

declare const __APP_VERSION__: string | undefined;
const appVersion = (): string => (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown");

/** A name the importer accepts (shared rules, `share-names.ts`): NFC, no
    forbidden character, no Windows device name, capped. */
function nomSur(nom: string, repli: string): string {
	return exportBaseName(nom || repli, repli);
}

const dossierDe = (chemin: string): string => (chemin.includes("/") ? chemin.slice(0, chemin.lastIndexOf("/")) : "");

/** `chemin` relative to `base` ("" = no base), or null when it lies outside. */
function relatif(chemin: string, base: string): string | null {
	if (!base) return chemin;
	return chemin.startsWith(`${base}/`) ? chemin.slice(base.length + 1) : null;
}

/** The directory all the given paths share (the deepest one), "" if none. */
function dossierCommun(chemins: string[]): string {
	if (chemins.length === 0) return "";
	let commun = dossierDe(chemins[0]).split("/").filter(Boolean);
	for (const c of chemins.slice(1)) {
		const d = dossierDe(c).split("/").filter(Boolean);
		let i = 0;
		while (i < commun.length && i < d.length && commun[i] === d[i]) i++;
		commun = commun.slice(0, i);
	}
	return commun.join("/");
}

/** A relative path with every segment through the shared name rules. The last
    segment keeps its extension AS WRITTEN (`figure.PNG`). `null` when the file
    name itself is unusable (a device name...). */
function cheminSur(rel: string, estNote: boolean): string | null {
	const parts = rel.split("/").filter(Boolean);
	const dernier = parts.pop() as string;
	const dot = dernier.lastIndexOf(".");
	const stem = dot > 0 ? dernier.slice(0, dot) : dernier;
	const ext = estNote ? ".md" : dot > 0 ? dernier.slice(dot) : "";
	const v = baseNameVerdict(stem);
	if (!v.ok) return estNote ? `${exportBaseName(stem, "quiz")}${ext}` : null;
	return [...parts.map(p => exportBaseName(p, "folder")), `${v.name}${ext}`].join("/");
}

/** The images the given notes embed (from the WHOLE note, body included), as
    files of the share. Each one is resolved from its note the way the quiz
    resolves it, read as bytes, once; placed relative to `base` when it lies
    inside it, else flat at the root. One that cannot be read, or whose name
    the importer would refuse (device name, too long), counts as left out
    (the share still goes). */
async function imagesDes(notes: { chemin: string; contenu: string }[], base: string): Promise<{ images: ShareFileIn[]; perdues: number }> {
	const host = currentHost();
	const vues = new Set<string>();
	const images: ShareFileIn[] = [];
	let perdues = 0;
	for (const n of notes) {
		for (const cible of embedTargets(n.contenu)) {
			const fichier = host.links.resolve(cible, n.chemin);
			if (!fichier || !isShareableImage(fichier.name) || vues.has(fichier.path)) continue;
			vues.add(fichier.path);
			const rel = cheminSur(relatif(fichier.path, base) ?? fichier.name, false);
			if (rel === null) { perdues++; continue; }
			try {
				const bytes = await host.fs.readBinary(fichier.path);
				if (bytes.length > IMAGE_IMPORT_MAX_BYTES) { perdues++; continue; }
				images.push({ path: rel, kind: "image", bytes });
			} catch (e) {
				console.warn(`${LOG_PREFIX} share: image unreadable:`, fichier.path, e);
				perdues++;
			}
		}
	}
	return { images, perdues };
}

/** Runs the produced archive through the importer's planner, in memory: every
    note must come back, nothing refused, nothing missing. */
async function verifier(octets: Uint8Array, notes: number): Promise<boolean> {
	try {
		const recu = await receiveArchive(octets);
		const plan = planImport({ files: recu.files, skipped: recu.skipped, junk: recu.junk, quizOnly: false, existing: new Map(), fallbackName: "check" });
		return plan.writes.filter(w => w.kind === "note").length === notes && plan.discarded.length === 0 && plan.missing.length === 0 && plan.notices.length === 0;
	} catch (e) {
		console.error(`${LOG_PREFIX} share: self-check threw:`, e);
		return false;
	}
}

/** The file to share, or `null` (and a message) when nothing is readable or
    the notes alone are over the bound. A folder is a .zip of its quizzes and
    the images they cite; a quiz (or a selection of quizzes) carries its WHOLE
    NOTE, the .md exactly as it is on disk, and every image cited anywhere in
    the note: a lone quiz without images is that .md, anything else a .zip. */
export async function construire(cible: CiblePartage): Promise<Fichier | null> {
	const host = currentHost();
	const fs = host.fs;
	const maintenant = new Date();
	const app = appVersion();
	const group = "group" in cible ? cible.group : null;
	const quizzes = "quiz" in cible ? [cible.quiz] : "quizzes" in cible ? cible.quizzes : (group as ModuleGroup).quizzes;
	const base = group
		? (group.path && group.quizzes.every(q => q.path.startsWith(`${group.path}/`)) ? group.path : dossierCommun(group.quizzes.map(q => q.path)))
		: quizzes.length === 1 ? dossierDe(quizzes[0].path) : dossierCommun(quizzes.map(q => q.path));
	const lus: { chemin: string; contenu: string; octets: Uint8Array; rel: string }[] = [];
	let illisibles = 0;
	for (const q of quizzes) {
		try {
			// The note's own bytes: BOM and line endings reach the receiver untouched.
			const octets = await fs.readBinary(q.path);
			lus.push({ chemin: q.path, contenu: new TextDecoder().decode(octets), octets, rel: cheminSur(relatif(q.path, base) ?? (q.path.split("/").pop() as string), true) as string });
		} catch (e) {
			// A quiz that vanished between the scan and the click: the rest is shared, and it is said.
			console.warn(`${LOG_PREFIX} share: quiz unreadable:`, q.path, e);
			illisibles++;
		}
	}
	if (lus.length === 0) { host.ui.notice(t("dashboard.detail.fileNotFound")); return null; }
	if (illisibles > 0) host.ui.notice(t("share.export.unreadable", { count: illisibles }));
	const { images, perdues } = await imagesDes(lus, base);
	if (lus.length === 1 && !group) {
		// One quiz: named after its title, as a bare .md when no image goes with it.
		const nom = nomSur(quizzes[0].title, "quiz");
		if (images.length === 0) return { nom: `${nom}.md`, octets: lus[0].octets, imagesLaissees: perdues };
		const paquet = await packShareV1([{ path: `${nom}.md`, kind: "note", bytes: lus[0].octets }], images, { app, kind: "quizzes", name: nom }, maintenant);
		if (!paquet.bytes) { host.ui.notice(t("dashboard.quizzes.shareTooLarge")); return null; }
		if (!(await verifier(paquet.bytes, 1))) { host.ui.notice(t("share.export.selfCheck")); return null; }
		return { nom: `${nom}.zip`, octets: paquet.bytes, imagesLaissees: paquet.imagesOut + perdues };
	}
	// Two quizzes can end up with the same path once cleaned: unique, case-insensitively.
	const uniques = dedupeNames(lus.map(l => l.rel));
	const notes: ShareFileIn[] = lus.map((l, i) => ({ path: uniques[i], kind: "note", bytes: l.octets }));
	const nom = nomSur(group ? group.name : "quizzes" in cible ? cible.name : "", "quizzes");
	const paquet = await packShareV1(notes, images, group
		? { app, kind: "folder", name: nom, folder: { name: group.name, color: group.color, icon: group.icon, ue: group.ue ?? undefined } }
		: { app, kind: "quizzes", name: nom }, maintenant);
	if (!paquet.bytes) { host.ui.notice(t("dashboard.quizzes.shareTooLarge")); return null; }
	if (!(await verifier(paquet.bytes, notes.length))) { host.ui.notice(t("share.export.selfCheck")); return null; }
	return { nom: `${nom}.zip`, octets: paquet.bytes, imagesLaissees: paquet.imagesOut + perdues };
}

/** One line on what a share left out, or nothing when it carried everything. */
function noterLaissees(fichier: Fichier): void {
	if (fichier.imagesLaissees > 0) currentHost().ui.notice(t("dashboard.quizzes.shareImagesLeftOut", { count: fichier.imagesLaissees }));
}

/** "Share" on a quiz or a folder: the file is built here, then handed to
    the system's own share panel. Windows: its Share panel (Discord,
    WhatsApp, Outlook, Nearby Share…), opened by the main process
    (`partageNatif`). Android: its share sheet, which `partage.enregistrer`
    opens there. If the Windows panel cannot be opened, the user is offered
    to SAVE the file where they choose (the main process's own dialog: the
    location comes from the user, never from the window). */
export function ouvrirPartage(cible: CiblePartage): void {
	void (async () => {
		let fichier: Fichier | null = null;
		try {
			fichier = await construire(cible);
			if (!fichier) return;
			const natif = pont().partageNatif;
			const ok = natif
				? await natif.fichier(fichier.nom, fichier.octets)
				: (await pont().partage.enregistrer(fichier.nom, fichier.octets)) !== null;
			if (ok) noterLaissees(fichier);
			else if (natif) proposerEnregistrer(fichier);
		} catch (e) {
			if (e instanceof Error && e.message.includes(PARTAGE_OCCUPE)) {
				currentHost().ui.notice(t("dashboard.quizzes.shareBusy"));
			} else {
				console.error(`${LOG_PREFIX} partage impossible :`, e);
				if (fichier && pont().partageNatif) proposerEnregistrer(fichier);
				else currentHost().ui.notice(t("dashboard.quizzes.shareSaveError"));
			}
		}
	})();
}

/** The fallback when the share panel failed: a small window with one action,
    "Save the file…", which opens the native save dialog. */
function proposerEnregistrer(fichier: Fichier): void {
	requireHost("modals").open({
		className: "qbd-create-modal",
		title: t("share.export.panelTitle"),
		onOpen: (m) => {
			createOptionCard(m, m.contentEl, "download", "#4573ff", t("share.export.saveFile"), t("share.export.panelFailed"), () => {
				void pont().partage.enregistrer(fichier.nom, fichier.octets).then(
					(chemin) => { if (chemin) { currentHost().ui.notice(t("share.export.saved", { path: chemin })); noterLaissees(fichier); } },
					(e) => { console.error(`${LOG_PREFIX} save failed:`, e); currentHost().ui.notice(t("share.export.saveFailed")); },
				);
			});
		},
	});
}
