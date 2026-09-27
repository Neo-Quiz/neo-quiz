import { currentHost, requireHost } from "../host/current";
import { placerIndicateur } from "./seg-indic";
import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DirEntry } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { freeNotePath } from "./folder-create";
import { ajouterLien, lireContenuDossier, nomSansExtension, retirerLien, titreDepuisUrl, urlValide } from "./folder-contents";
import { openConfirmModal } from "../editor/modals";
import { estImage, fileIcon } from "./file-icons";
import type { LienDossier } from "./folder-contents";
import { suivreDebord } from "./detail-fiche";

/** Le nombre de lignes qu'une liste de section montre avant de défiler dans
    son cadre. Le même 8 est écrit dans `dashboard-folder.css`
    (`.qbd-folder-list--defile`, `max-height`). */
const LIGNES_VISIBLES = 8;

/* ══════════════════════════════════════════════════════════
   LES TROIS SECTIONS D'UN DOSSIER — Documents, Liens, Notes

   Sous la grille des quiz de la page d'un dossier (référence StudySmarter,
   capture Ahmed 2026-09-17) : trois sections à compteur, chacune avec son
   état vide (icône, phrase, bouton) et sa liste. Le CONTENU vient de
   `folder-contents.ts` ; ici on ne fait que le peindre et brancher les
   trois actions.

   Le rendu est en deux temps parce que `listDir` est asynchrone et que la
   page se rend en synchrone : on pose le conteneur, on remplit à l'arrivée
   — et seulement s'il est encore dans le document, la page a pu être
   repeinte entre-temps.
══════════════════════════════════════════════════════════ */

export interface FolderSectionsDeps {
	ctx: DashboardShellCtx;
	/** Le chemin du CONTRAT du dossier ouvert. */
	folder: string;
	/** Repeint la page (les compteurs et les listes) après une action. */
	rerender: () => void;
}

/* L'onglet ouvert de chaque dossier, gardé pendant la session : repeindre la
   page (ajout d'un fichier, retour d'un quiz) ne doit pas ramener à
   « Documents » celui qui regardait ses notes. */
const ongletParDossier = new Map<string, number>();

export function renderFolderSections(parent: HTMLElement, deps: FolderSectionsDeps): void {
	/* UNE tuile pour les trois (2026-09-25) : Documents, Liens et Notes en
	   ONGLETS, dans la même matière que les cartes de quiz mais bordée de
	   POINTILLÉS — la zone des ressources se distingue sans changer de
	   texture. Un état vide ne s'affiche plus que si l'on ouvre son onglet. */
	const wrap = ajouter(parent, "div", "qbd-folder-sections");
	const estQuiz = (path: string): boolean => !!deps.ctx.scanner.getQuiz(path);
	void lireContenuDossier(deps.folder, estQuiz).then(contenu => {
		if (!wrap.isConnected) return;
		const onglets = ajouter(wrap, "div", "qbd-folder-tabs");
		onglets.setAttribute("role", "tablist");
		const indic = ajouter(onglets, "div", "qbd-folder-tabs-indic");
		/* L'action de l'onglet ouvert, en haut à droite de la tuile, sur la
		   ligne des onglets (2026-09-25) : en pied de liste, elle descendait
		   avec les documents et sortait de l'écran. Une par onglet, seule
		   celle de l'onglet ouvert est visible. */
		const actions = ajouter(onglets, "div", "qbd-folder-tabs-actions");
		const sections: HTMLElement[] = [];
		const boutons: HTMLElement[] = [];
		const boutonsAction: HTMLElement[] = [];
		const montrer = (i: number, anime: boolean): void => {
			ongletParDossier.set(deps.folder, i);
			sections.forEach((sec, k) => { sec.hidden = k !== i; });
			boutonsAction.forEach((b, k) => { b.hidden = k !== i; });
			boutons.forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
			placerIndicateur(indic, boutons[i], anime);
		};
		const ajouterSection = (spec: SectionSpec): void => {
			const i = sections.length;
			const b = ajouter(onglets, "button", "qbd-folder-tab");
			b.type = "button";
			b.setAttribute("role", "tab");
			currentHost().ui.setIcon(ajouter(b, "span", "qbd-folder-tab-icon"), spec.icon);
			ajouter(b, "span", undefined, t(spec.title));
			ajouter(b, "span", "qbd-folder-tab-count", String(spec.count));
			b.addEventListener("click", () => montrer(i, true));
			onglets.insertBefore(b, actions);
			boutons.push(b);
			const action = ajouter(actions, "button", "qbd-folder-section-action");
			action.type = "button";
			currentHost().ui.setIcon(ajouter(action, "span", "qbd-folder-section-action-icon"), spec.action.icon);
			ajouter(action, "span", undefined, t(spec.action.label));
			action.addEventListener("click", spec.action.onClick);
			boutonsAction.push(action);
			sections.push(renderSection(wrap, deps, spec));
		};
		ajouterSection({
			icon: "file-text", title: "dashboard.folder.documents", count: contenu.documents.length,
			emptyTitle: "dashboard.folder.documentsEmptyTitle", emptyHint: "dashboard.folder.documentsEmptyHint",
			action: { icon: "upload", label: "dashboard.folder.addFiles", onClick: () => void ajouterDesFichiers(deps, choisirFichiers()) },
			/* Le glisser-déposer (demande Ahmed 2026-09-17) : des fichiers lâchés
			   sur le panneau prennent le même chemin que « Ajouter des fichiers ». */
			onDrop: (fichiers) => void ajouterDesFichiers(deps, Promise.resolve(fichiers)),
			items: contenu.documents.map(e => ({
				icon: fileIcon(e.name), label: nomSansExtension(e.name), meta: extensionAffichee(e.name),
				thumb: urlImage(e),
				onOpen: () => void ouvrirDocument(deps, e),
				onDelete: () => void confirmerSuppressionFichier(deps, e),
			})),
		});
		ajouterSection({
			icon: "link", title: "dashboard.folder.links", count: contenu.liens.length,
			emptyTitle: "dashboard.folder.linksEmptyTitle", emptyHint: "dashboard.folder.linksEmptyHint",
			action: { icon: "plus", label: "dashboard.folder.addLink", onClick: () => ouvrirModalLien(deps) },
			items: contenu.liens.map(l => ({
				icon: "globe", label: l.title, meta: titreDepuisUrl(l.url),
				onOpen: () => { window.open(l.url, "_blank"); },
				onDelete: () => confirmerPuis(t("dashboard.folder.deleteLinkTitle", { name: l.title }), t("dashboard.folder.deleteLinkMessage"), () => retirerLeLien(deps, l)),
			})),
		});
		ajouterSection({
			icon: "sticky-note", title: "dashboard.folder.notes", count: contenu.notes.length,
			emptyTitle: "dashboard.folder.notesEmptyTitle", emptyHint: "dashboard.folder.notesEmptyHint",
			action: { icon: "pen-line", label: "dashboard.folder.createNote", onClick: () => void creerUneNote(deps) },
			items: contenu.notes.map(e => ({
				icon: fileIcon(e.name), label: nomSansExtension(e.name), meta: "md",
				onOpen: () => void ouvrirNote(deps, e),
				onDelete: () => void confirmerSuppressionFichier(deps, e),
			})),
		});
		// Mesuré au prochain cadre : les onglets doivent être posés.
		requestAnimationFrame(() => montrer(ongletParDossier.get(deps.folder) ?? 0, false));
	});
}

interface SectionSpec {
	icon: string;
	title: TransKey;
	count: number;
	emptyTitle: TransKey;
	emptyHint: TransKey;
	action: { icon: string; label: TransKey; onClick: () => void };
	/** Des fichiers lâchés sur le panneau. Absent = le panneau ne reçoit rien. */
	onDrop?: (fichiers: File[]) => void;
	/** `thumb` : l'URL d'une VIGNETTE, qui prend la place de l'icône. Une
	    image se reconnaît à ce qu'elle montre, pas à un glyphe partagé par
	    tous les fichiers de son format. */
	items: { icon: string; label: string; meta: string; thumb?: string | null; onOpen: () => void; onDelete: () => void }[];
}

function renderSection(parent: HTMLElement, deps: FolderSectionsDeps, spec: SectionSpec): HTMLElement {
	const host = currentHost();
	/* UNE zone par section (retour Ahmed 2026-09-17, à l'écran) : le panneau
	   contient tout — l'en-tête, la liste ou l'état vide, ET le bouton, dans
	   son pied. La v1 posait le bouton en pilule blanche au-dessus d'une boîte
	   séparée : deux objets pour une section, et une pilule qui n'était pas
	   celle de l'application. Depuis les onglets, son bouton est sur la
	   ligne des onglets (renderFolderSections). */
	const section = ajouter(parent, "section", "qbd-folder-section" + (spec.items.length === 0 ? " qbd-folder-section--vide" : ""));
	// Plus d'en-tête dans la section : son titre et son compteur sont l'ONGLET.

	if (spec.items.length === 0) {
		const vide = ajouter(section, "div", "qbd-folder-empty");
		ajouter(vide, "div", "qbd-folder-empty-title", t(spec.emptyTitle));
		ajouter(vide, "div", "qbd-folder-empty-hint", t(spec.emptyHint));
	} else {
		/* AU-DELÀ DE HUIT LIGNES, la liste défile DANS son cadre (2026-09-26) :
		   un dossier de 37 documents rendait la page interminable. Même
		   défilement que les cartes de la grille d'un quiz (ascenseur fin,
		   fondus haut et bas, `suivreDebord`) ; la molette passe à la page une
		   fois la liste au bout. La hauteur vit dans le CSS
		   (`.qbd-folder-list--defile`). */
		const defile = spec.items.length > LIGNES_VISIBLES;
		const liste = ajouter(section, "div", "qbd-folder-list" + (defile ? " qbd-folder-list--defile" : ""));
		for (const it of spec.items) {
			/* Deux boutons par rangée — ouvrir (toute la largeur) et supprimer
			   (la corbeille, révélée au survol) — dans un `div` : un bouton dans
			   un bouton n'est pas du HTML, et le clavier ne saurait plus lequel
			   il actionne. */
			const item = ajouter(liste, "div", "qbd-folder-item");
			const ouvrir = ajouter(item, "button", "qbd-folder-item-open");
			ouvrir.type = "button";
			/* La vignette REMPLACE l'icône, elle ne s'y ajoute pas : deux
			   marques pour un fichier feraient une rangée bavarde. Une image
			   qui ne se charge pas (fichier disparu entre le listage et le
			   rendu) rend la main au glyphe plutôt que de laisser un trou. */
			const boite = ajouter(ouvrir, "span", "qbd-folder-item-icon");
			if (it.thumb) {
				const vignette = ajouter(boite, "img", "qbd-folder-item-thumb");
				vignette.src = it.thumb;
				vignette.alt = "";
				vignette.draggable = false;
				vignette.addEventListener("error", () => { boite.replaceChildren(); host.ui.setIcon(boite, it.icon); });
			} else {
				host.ui.setIcon(boite, it.icon);
			}
			// `textContent` (via `ajouter`) : ces noms viennent du disque.
			ajouter(ouvrir, "span", "qbd-folder-item-name", it.label);
			ajouter(ouvrir, "span", "qbd-folder-item-meta", it.meta);
			ouvrir.addEventListener("click", it.onOpen);
			const supprimer = ajouter(item, "button", "qbd-folder-item-delete");
			supprimer.type = "button";
			supprimer.setAttribute("aria-label", t("dashboard.folder.deleteAction"));
			host.ui.setIcon(supprimer, "trash-2");
			supprimer.addEventListener("click", (e) => { e.stopPropagation(); it.onDelete(); });
		}
		if (defile) suivreDebord(liste);
	}

	if (spec.onDrop) {
		// Le libellé du voile de dépose, lu par le CSS (`attr(data-drop-hint)`).
		section.dataset.dropHint = t("dashboard.folder.dropHint");
		brancherDepot(section, spec.onDrop);
	}

	return section;
}

/* ── Documents ── */

function extensionAffichee(nom: string): string {
	const point = nom.lastIndexOf(".");
	return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
}

/** Copie les fichiers choisis DANS le dossier : `<input type=file>` (le même
    geste que l'import d'un dossier partagé, folder-create.ts), puis
    `writeBinary` sous un nom libre — deux « CM1.pdf » ne s'écrasent pas. */
export async function ajouterDesFichiers(deps: FolderSectionsDeps, choix: Promise<File[]>): Promise<void> {
	const fichiers = await choix;
	if (fichiers.length === 0) return;
	const host = currentHost();
	let copies = 0;
	for (const f of fichiers) {
		try {
			const point = f.name.lastIndexOf(".");
			const stem = point > 0 ? f.name.slice(0, point) : f.name;
			const ext = point > 0 ? f.name.slice(point) : "";
			await host.fs.writeBinary(await freeNotePath(deps.folder, stem, ext), new Uint8Array(await f.arrayBuffer()));
			copies++;
		} catch {
			host.ui.notice(t("dashboard.folder.fileAddError", { name: f.name }));
		}
	}
	if (copies > 0) {
		host.ui.notice(t(copies === 1 ? "dashboard.folder.filesAddedOne" : "dashboard.folder.filesAddedOther", { count: copies }));
		deps.rerender();
	}
}

export function choisirFichiers(): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.addEventListener("change", () => resolve(Array.from(input.files ?? [])));
		input.click();
	});
}

/** L'URL d'affichage d'une image du dossier, ou `null` pour tout le reste.
    Par le CONTRAT (`links.resourceUrl`) : sous l'application, c'est le
    protocole `app://neo-res/`, borné au périmètre par le processus
    principal comme les canaux de fichiers. L'index fait autorité — un
    fichier qu'il ne connaît pas encore rend `null`, et la rangée garde son
    glyphe. */
function urlImage(e: DirEntry): string | null {
	if (!estImage(e.name)) return null;
	const host = currentHost();
	return host.links.resourceUrl(host.fs.getFile(e.path) ?? e.path);
}

/** L'image s'ouvre DANS l'application, centrée dans un modal (Ahmed,
    2026-09-17) ; tout le reste part à l'application du système. Le repli
    compte : une image que l'index ne résout pas n'a pas d'URL, et mieux
    vaut la visionneuse du système qu'un modal vide. */
async function ouvrirDocument(deps: FolderSectionsDeps, e: DirEntry): Promise<void> {
	const url = urlImage(e);
	if (!url) { await ouvrirFichier(deps, e); return; }
	requireHost("modals").open({
		className: "qbd-image-modal",
		title: e.name,
		onOpen: (m) => {
			const img = ajouter(m.contentEl, "img", "qbd-image-modal-img");
			img.src = url;
			img.alt = e.name;
			img.draggable = false;
		},
	});
}

/** Un document ou une note s'ouvre avec l'application du système. Par le
    contrat d'abord (`shell.openExternal`, qui veut un `HostFile` de l'index —
    l'application y met TOUS les fichiers, `.md` ou non), sinon par l'hôte
    (`ctx.openPath`, un chemin nu) : un fichier écrit à l'instant peut ne pas
    être encore dans l'index, que le surveillant recale avec un délai. */
async function ouvrirFichier(deps: FolderSectionsDeps, e: DirEntry): Promise<void> {
	const host = currentHost();
	const f = host.fs.getFile(e.path);
	let ok = f ? await host.shell.openExternal(f) : false;
	if (!ok && deps.ctx.openPath) ok = await deps.ctx.openPath(e.path);
	if (!ok) host.ui.notice(t("dashboard.folder.openFailed", { name: e.name }));
}

/** Une note vierge dans le dossier, puis ouverte avec l'application du
    système : l'application n'a pas d'éditeur de notes, Obsidian en est un. */
export async function creerUneNote(deps: FolderSectionsDeps): Promise<void> {
	const host = currentHost();
	try {
		const path = await freeNotePath(deps.folder, t("dashboard.folder.newNoteDefaultName"));
		await host.fs.write(path, "");
		deps.rerender();
		await ouvrirNote(deps, { name: path.split("/").pop() as string, path, isFolder: false });
	} catch {
		host.ui.notice(t("dashboard.folder.noteCreateError"));
	}
}

/** Le glisser-déposer sur un panneau : la classe `is-dragover` pendant le
    survol (le CSS éclaire le liseré), les fichiers à la dépose. `dragenter`
    et `dragleave` se déclenchent aussi en passant d'un ENFANT du panneau à un
    autre — d'où le compteur, sans lequel le liseré clignoterait à chaque
    rangée traversée. */
export function brancherDepot(section: HTMLElement, onDrop: (fichiers: File[]) => void): void {
	let profondeur = 0;
	section.addEventListener("dragenter", (e) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		profondeur++;
		section.classList.add("is-dragover");
	});
	section.addEventListener("dragover", (e) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
	});
	section.addEventListener("dragleave", () => {
		profondeur = Math.max(0, profondeur - 1);
		if (profondeur === 0) section.classList.remove("is-dragover");
	});
	section.addEventListener("drop", (e) => {
		e.preventDefault();
		profondeur = 0;
		section.classList.remove("is-dragover");
		const fichiers = Array.from(e.dataTransfer?.files ?? []);
		if (fichiers.length > 0) onDrop(fichiers);
	});
}

/** L'avertissement AVANT toute suppression (demande Ahmed 2026-09-17) : la
    même modale que la suppression d'une question de l'éditeur. */
function confirmerPuis(titre: string, message: string, action: () => Promise<void>, details?: string): void {
	openConfirmModal(titre, message, t("dashboard.folder.deleteAction"), t("dashboard.folder.deleteCancel"), (confirme) => {
		if (confirme) void action();
	}, details);
}

/** La confirmation d'un document ou d'une note porte sa DATE DE MODIFICATION
    (Ahmed, 2026-09-17) : on sait ce qu'on efface. Par l'hôte (`fileMtime`)
    d'abord — le contrat ne date que les notes —, sinon par l'index pour une
    note, sinon sans date. Formatée dans la langue de l'interface. */
async function confirmerSuppressionFichier(deps: FolderSectionsDeps, e: DirEntry): Promise<void> {
	let mtime = deps.ctx.fileMtime ? await deps.ctx.fileMtime(e.path) : null;
	if (!mtime) mtime = currentHost().fs.getFile(e.path)?.mtime || null;
	let details: string | undefined;
	if (mtime) {
		try {
			const quand = new Intl.DateTimeFormat(currentLang(), { dateStyle: "long", timeStyle: "short" }).format(new Date(mtime));
			details = t("dashboard.folder.deleteFileModified", { date: quand });
		} catch {
			details = undefined;
		}
	}
	confirmerPuis(t("dashboard.folder.deleteFileTitle", { name: e.name }), t("dashboard.folder.deleteFileMessage"), () => mettreALaCorbeille(deps, e), details);
}

/** À la CORBEILLE, jamais effacé : `fs.trash` déplace, et c'est ce que la
    modale annonce. Un document supprimé par erreur se retrouve. */
async function mettreALaCorbeille(deps: FolderSectionsDeps, e: DirEntry): Promise<void> {
	const host = currentHost();
	try {
		await host.fs.trash(e.path);
		deps.rerender();
	} catch {
		host.ui.notice(t("dashboard.folder.deleteFailed", { name: e.name }));
	}
}

async function retirerLeLien(deps: FolderSectionsDeps, l: LienDossier): Promise<void> {
	try {
		await retirerLien(deps.folder, l.url);
		deps.rerender();
	} catch {
		currentHost().ui.notice(t("dashboard.folder.linkAddError"));
	}
}

/* ── Notes ── */

/** Une note s'ouvre dans OBSIDIAN quand sa racine est un vault
    (`ctx.openInObsidian`, demande Ahmed 2026-09-17) : c'est là qu'elle
    s'écrit. Sinon, par le système, comme un document. */
async function ouvrirNote(deps: FolderSectionsDeps, e: DirEntry): Promise<void> {
	if (deps.ctx.openInObsidian && await deps.ctx.openInObsidian(e.path)) return;
	await ouvrirFichier(deps, e);
}

/* ── Liens ── */

export function ouvrirModalLien(deps: FolderSectionsDeps): void {
	let url = "";
	let titre = "";
	requireHost("modals").open({
		className: "qbd-medit-modal",
		title: t("dashboard.folder.linkModalTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.folder.linkUrlLabel"));
			const champUrl = ajouter(c, "input", "qbd-medit-input");
			champUrl.type = "url";
			champUrl.placeholder = "https://";
			champUrl.addEventListener("input", () => { url = champUrl.value; });
			ajouter(c, "p", "qbd-medit-label", t("dashboard.folder.linkTitleLabel"));
			const champTitre = ajouter(c, "input", "qbd-medit-input");
			champTitre.type = "text";
			champTitre.addEventListener("input", () => { titre = champTitre.value; });
			window.setTimeout(() => champUrl.focus(), 0);

			const valider = async (): Promise<void> => {
				const propre = urlValide(url);
				if (!propre) { currentHost().ui.notice(t("dashboard.folder.linkInvalid")); return; }
				const lien: LienDossier = { url: propre, title: titre.trim() || titreDepuisUrl(propre) };
				try {
					await ajouterLien(deps.folder, lien);
				} catch {
					currentHost().ui.notice(t("dashboard.folder.linkAddError"));
					return;
				}
				m.close();
				deps.rerender();
			};
			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.folder.linkAdd"));
			save.addEventListener("click", () => { void valider(); });
			for (const champ of [champUrl, champTitre]) {
				champ.addEventListener("keydown", (e) => { if (e.key === "Enter") void valider(); });
			}
		},
	});
}
