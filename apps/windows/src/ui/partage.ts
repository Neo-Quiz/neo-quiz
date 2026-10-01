import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { currentHost, requireHost } from "../../../../src/host/current";
import { embedTargets, isShareableImage, packShare } from "../../../../src/dashboard/share-pack";
import type { ZipEntry, ZipFile } from "../../../../src/dashboard/zip";
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
   .md d'un quiz réduit à son bloc — ce que « Importer » sait relire. Aucune
   application ne se laisse joindre un fichier par automatisation : Discord
   reçoit donc le fichier dans le presse-papiers, et l'utilisateur colle.
   Le fichier est construit ICI, écrit et lancé par le principal
   (`electron/partage.ts`), qui ne reçoit qu'un nom et des octets.
══════════════════════════════════════════════════════════ */

/** Logo Discord — Simple Icons (un seul tracé, rempli). */
const DISCORD_PATH = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

export type CiblePartage = { quiz: QuizIndexEntry } | { group: ModuleGroup };

interface Fichier { nom: string; octets: Uint8Array; imagesLaissees: number }

function nomSur(nom: string, repli: string): string {
	return (nom || repli).replace(/[\\/:*?"<>|]/g, "-").trim() || repli;
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
			try {
				const entree = { name: fichier.name, bytes: await host.fs.readBinary(fichier.path) };
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
async function construire(cible: CiblePartage): Promise<Fichier | null> {
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
			entrees.push({ name: q.path.split("/").pop() as string, content: contenu });
			lus.push({ chemin: q.path, contenu });
		} catch { /* un quiz disparu entre le scan et le clic : on partage le reste */ }
	}
	if (entrees.length === 0) { host.ui.notice(t("dashboard.detail.fileNotFound")); return null; }
	const { images, perdues } = await imagesDes(lus);
	const paquet = packShare(entrees, images, maintenant);
	if (!paquet.bytes) { host.ui.notice(t("dashboard.quizzes.shareTooLarge")); return null; }
	return { nom: `${nomSur(cible.group.name, "quizzes")}.zip`, octets: paquet.bytes, imagesLaissees: paquet.imagesOut + perdues };
}

/** One line on what a share left out, or nothing when it carried everything. */
function noterLaissees(fichier: Fichier): void {
	if (fichier.imagesLaissees > 0) currentHost().ui.notice(t("dashboard.quizzes.shareImagesLeftOut", { count: fichier.imagesLaissees }));
}

export function ouvrirPartage(cible: CiblePartage): void {
	requireHost("modals").open({
		className: "qbd-share-modal",
		title: t("quiz" in cible ? "dashboard.quizzes.shareQuizTitle" : "dashboard.quizzes.shareTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-share-hint", t("dashboard.quizzes.shareHint"));
			const rangee = ajouter(c, "div", "qbd-share-apps");
			const retour = ajouter(c, "div", "qbd-share-feedback");

			// ── Discord : le fichier dans le presse-papiers, Discord devant.
			// Windows seulement (le principal refuse ailleurs) : absent plutôt
			// qu'un bouton qui échoue à coup sûr. ──
			if (navigator.userAgent.includes("Windows")) {
				const discord = ajouter(rangee, "button", "qbd-share-app qbd-share-app--discord");
				discord.type = "button";
				discord.title = t("dashboard.quizzes.shareCopyHint");
				const icone = ajouter(discord, "div", "qbd-share-app-icon");
				logoDiscord(icone);
				const badge = ajouter(icone, "div", "qbd-share-app-badge");
				currentHost().ui.setIcon(badge, "copy");
				ajouter(discord, "span", "qbd-share-app-label", "Discord");
				discord.addEventListener("click", () => {
					discord.disabled = true;
					/* La confirmation ATTEND le résultat : on ne fête que ce qui
					   est parti (leçon du greffon, revue du 2026-07-31). */
					void (async () => {
						try {
							const fichier = await construire(cible);
							if (!fichier) return;
							if (!await pont().partage.discord(fichier.nom, fichier.octets)) {
								currentHost().ui.notice(t("dashboard.quizzes.shareSaveError"));
								return;
							}
							discord.classList.add("is-copied");
							badge.replaceChildren();
							currentHost().ui.setIcon(badge, "check");
							retour.replaceChildren();
							currentHost().ui.setIcon(ajouter(retour, "span", "qbd-share-feedback-icon"), "check");
							ajouter(retour, "span", undefined, t("dashboard.quizzes.shareCopiedToast"));
							retour.classList.add("is-visible");
							noterLaissees(fichier);
							window.setTimeout(() => m.close(), 2600);
						} catch (e) {
							signalerEchec(e, "partage Discord impossible");
						} finally {
							discord.disabled = false;
						}
					})();
				});
			}

			// ── Enregistrer le fichier, où l'on veut. ──
			const enregistrer = ajouter(rangee, "button", "qbd-share-app");
			enregistrer.type = "button";
			currentHost().ui.setIcon(ajouter(enregistrer, "div", "qbd-share-app-icon"), "download");
			/* On a phone there is no "save as" dialog: the file goes to the system share
			   sheet (Files, Drive, Discord, mail...), and the notice of a saved PATH would
			   be wrong. */
			const telephone = navigator.userAgent.includes("Android");
			ajouter(enregistrer, "span", "qbd-share-app-label", t(telephone ? "dashboard.quizzes.shareSheet" : "dashboard.quizzes.shareSave"));
			enregistrer.addEventListener("click", () => {
				m.close();
				void (async () => {
					try {
						const fichier = await construire(cible);
						if (!fichier) return;
						const chemin = await pont().partage.enregistrer(fichier.nom, fichier.octets);
						if (chemin && !telephone) currentHost().ui.notice(t("dashboard.quizzes.fileSaved", { path: chemin }));
						if (chemin) noterLaissees(fichier);
					} catch (e) {
						signalerEchec(e, "enregistrement du partage impossible");
					}
				})();
			});
		},
	});
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

function logoDiscord(parent: HTMLElement): void {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("aria-hidden", "true");
	const p = document.createElementNS(NS, "path");
	p.setAttribute("d", DISCORD_PATH);
	svg.appendChild(p);
	parent.appendChild(svg);
}
