import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { embedTargets, isShareableImage, packShare } from "../../../../src/dashboard/share-pack";
import type { ZipEntry, ZipFile } from "../../../../src/dashboard/zip";
import { nomImageImportee } from "../../../../src/dashboard/zip";
import { dedupeNames, exportBaseName } from "../../../../src/dashboard/share-names";
import { QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { LOG_PREFIX } from "../../../../src/branding";
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import type { ModuleGroup } from "../../../../src/dashboard/quiz-modules";
import { pont } from "../host/pont";
import { PARTAGE_OCCUPE } from "../../electron/pont";

/* ══════════════════════════════════════════════════════════
   « PARTAGER » un quiz ou un dossier (2026-09-25), le modal du greffon
   (`src/dashboard/share.ts`, retiré le 2026-09-13) porté dans l'application.
   On n'a pas de lien mais un FICHIER : le zip des quiz d'un dossier, ou le
   .md d'un quiz réduit à son bloc — ce que « Importer » sait relire. Since
   2026-10-03 it goes straight to the system's share panel (see
   `ouvrirPartage`). The file is built HERE; the main process
   (`electron/partage.ts`) only receives a name and bytes.
══════════════════════════════════════════════════════════ */

export type CiblePartage = { quiz: QuizIndexEntry } | { group: ModuleGroup };

interface Fichier { nom: string; octets: Uint8Array; imagesLaissees: number }

/** A name the importer accepts (shared rules, `share-names.ts`): NFC, no
    forbidden character, no Windows device name, capped. */
function nomSur(nom: string, repli: string): string {
	return exportBaseName(nom || repli, repli);
}

/** The images the given notes embed, as files of the share: each one resolved
    from its note the way the quiz resolves it, read as bytes, once. An image
    that cannot be read counts as left out (the share still goes). */
async function imagesDes(notes: { chemin: string; contenu: string }[]): Promise<{ images: ZipFile[]; perdues: number }> {
	const host = currentHost();
	const vues = new Map<string, ZipFile | null>();
	const images: ZipFile[] = [];
	let perdues = 0;
	for (const n of notes) {
		for (const cible of embedTargets(n.contenu)) {
			const fichier = host.links.resolve(cible, n.chemin);
			if (!fichier || !isShareableImage(fichier.name) || vues.has(fichier.path)) continue;
			// A name the importer would refuse (device name, too long) is left out
			// and counted, never shipped: an archive must import what it carries.
			const nomEnvoye = nomImageImportee(fichier.name);
			if (nomEnvoye === null) { vues.set(fichier.path, null); perdues++; continue; }
			try {
				const entree = { name: nomEnvoye, bytes: await host.fs.readBinary(fichier.path) };
				vues.set(fichier.path, entree);
				images.push(entree);
			} catch {
				vues.set(fichier.path, null);
				perdues++;
			}
		}
	}
	return { images, perdues };
}

/** The file to share, or `null` (and a message) when nothing is readable or
    the notes alone are over the bound. A folder is a .zip of its quizzes and
    the images they embed; a quiz is its block as a .md, or, when it embeds
    images, a .zip with them (a .md cannot carry them). */
export async function construire(cible: CiblePartage): Promise<Fichier | null> {
	const host = currentHost();
	const fs = host.fs;
	const maintenant = new Date();
	if ("quiz" in cible) {
		const contenu = await fs.read(cible.quiz.path);
		const bloc = contenu.match(QUIZ_BLOCK_RE);
		if (!bloc) { host.ui.notice(t("dashboard.detail.noBlockInNote")); return null; }
		const texte = bloc[0].replace(/\r\n/g, "\n") + "\n";
		const nom = nomSur(cible.quiz.title, "quiz");
		const { images, perdues } = await imagesDes([{ chemin: cible.quiz.path, contenu: texte }]);
		if (images.length === 0) return { nom: `${nom}.md`, octets: new TextEncoder().encode(texte), imagesLaissees: perdues };
		const paquet = packShare([{ name: `${nom}.md`, content: texte }], images, maintenant);
		if (!paquet.bytes) { host.ui.notice(t("dashboard.quizzes.shareTooLarge")); return null; }
		return { nom: `${nom}.zip`, octets: paquet.bytes, imagesLaissees: paquet.imagesOut + perdues };
	}
	const entrees: ZipEntry[] = [];
	const lus: { chemin: string; contenu: string }[] = [];
	for (const q of cible.group.quizzes) {
		try {
			const contenu = await fs.read(q.path);
			const fichierNote = q.path.split("/").pop() as string;
			entrees.push({ name: `${exportBaseName(fichierNote.replace(/\.md$/i, ""), "quiz")}.md`, content: contenu });
			lus.push({ chemin: q.path, contenu });
		} catch { /* un quiz disparu entre le scan et le clic : on partage le reste */ }
	}
	if (entrees.length === 0) { host.ui.notice(t("dashboard.detail.fileNotFound")); return null; }
	// Two quizzes of different sub-folders can share a file name: unique, case-insensitively.
	const uniques = dedupeNames(entrees.map(e => e.name));
	entrees.forEach((e, i) => { e.name = uniques[i]; });
	const { images, perdues } = await imagesDes(lus);
	const paquet = packShare(entrees, images, maintenant);
	if (!paquet.bytes) { host.ui.notice(t("dashboard.quizzes.shareTooLarge")); return null; }
	return { nom: `${nomSur(cible.group.name, "quizzes")}.zip`, octets: paquet.bytes, imagesLaissees: paquet.imagesOut + perdues };
}

/** One line on what a share left out, or nothing when it carried everything. */
function noterLaissees(fichier: Fichier): void {
	if (fichier.imagesLaissees > 0) currentHost().ui.notice(t("dashboard.quizzes.shareImagesLeftOut", { count: fichier.imagesLaissees }));
}

/** "Share" on a quiz or a folder: the file is built here, then handed to
    the system's own share panel. Windows: its Share panel (Discord,
    WhatsApp, Outlook, Nearby Share…), opened by the main process
    (`partageNatif`). Android: its share sheet, which `partage.enregistrer`
    opens there. No dialog of ours in between (2026-10-03): the system panel
    already lists every app that can take the file. */
export function ouvrirPartage(cible: CiblePartage): void {
	void (async () => {
		try {
			const fichier = await construire(cible);
			if (!fichier) return;
			const natif = pont().partageNatif;
			const ok = natif
				? await natif.fichier(fichier.nom, fichier.octets)
				: (await pont().partage.enregistrer(fichier.nom, fichier.octets)) !== null;
			if (ok) noterLaissees(fichier);
			else if (natif) currentHost().ui.notice(t("dashboard.quizzes.shareSaveError"));
		} catch (e) {
			signalerEchec(e, "partage impossible");
		}
	})();
}

/** Un partage déjà en cours n'est pas une panne : on le dit. L'IPC
    d'Electron ne garde que le MESSAGE d'une erreur, d'où le `includes`. */
function signalerEchec(e: unknown, contexte: string): void {
	if (e instanceof Error && e.message.includes(PARTAGE_OCCUPE)) {
		currentHost().ui.notice(t("dashboard.quizzes.shareBusy"));
		return;
	}
	console.error(`${LOG_PREFIX} ${contexte} :`, e);
	currentHost().ui.notice(t("dashboard.quizzes.shareSaveError"));
}
