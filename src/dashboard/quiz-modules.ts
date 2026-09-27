import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isMastered } from "./quiz-mastery";

/* ══════════════════════════════════════════════════════════
   QUIZ MODULES — regroupement des quiz par MODULE et par UE.
   Module PUR : aucune dépendance à Obsidian ni au DOM (le texte
   de la note de correspondance est lu par l'appelant et passé en
   argument). La hiérarchie UE → module → quiz vient d'une note
   « Dashboard » : des encadrés `> [!portals] <UE>` suivis de liens
   wiki vers les dossiers de module.
══════════════════════════════════════════════════════════ */

/** Un module tel que déclaré dans la note : dossier, nom affiché, UE. */
export interface ModuleInfo {
	/** Dossier de module = 1er segment sous le dossier d'année. Sert de clé. */
	folder: string;
	/** Nom affiché (alias du lien, ou le dossier faute d'alias). */
	name: string;
	/** Titre de l'UE parente, ou null si le module n'est dans aucun encadré. */
	ue: string | null;
	/** Couleur du liseré choisie dans « Modifier dossier » (override réglages) —
	    absente = liseré par état d'avancement (comportement historique). */
	color?: string;
	/** Icône Lucide choisie dans « Modifier dossier » (carré teinté de la carte)
	    — absente = icône par défaut (cf. module-card.ts). */
	icon?: string;
	/**
	 * LE CHEMIN RÉEL DU DOSSIER, et non son seul segment (2026-09-17).
	 *
	 * `folder` est une CLÉ — un segment, « XTI301 - Écosystème Python » —
	 * parce que c'est tout ce qu'un lien de la note de correspondance permet
	 * de nommer. Ça suffit pour regrouper et pour afficher ; ça ne suffit pas
	 * pour ÉCRIRE. Un chemin du contrat commence par l'identifiant d'une
	 * racine ouverte (`Efrei/…`), et `fs.write("XTI301 - Écosystème
	 * Python/x.md")` échouait sur « chemin hors des dossiers ouverts ».
	 *
	 * Absent = inconnu, et l'appelant retombe sur `folder` — le comportement
	 * d'avant, qui reste juste pour un module posé à la racine d'un dossier
	 * ouvert.
	 */
	path?: string;
}

/** Override persisté par le modal « Modifier dossier » (menu ⋯ d'un module).
    Chaque champ absent = on garde la valeur de la note de correspondance.
    `ue: null` force « Sans UE » (≠ absent). */
export interface ModuleOverride {
	name?: string;
	ue?: string | null;
	color?: string;
	icon?: string;
	/** Le chemin du contrat du dossier (cf. `ModuleInfo.path`). Écrit par les
	    modals qui DÉSIGNENT un dossier — « Créer un dossier vide » et « Ouvrir
	    un dossier existant » —, parce qu'eux le connaissent. C'est la seule
	    source de vérité pour un dossier déclaré SANS quiz : sans quiz dedans,
	    il n'y a aucun chemin d'où le déduire. */
	path?: string;
	/* PAS DE `examDate` ICI, et c'est délibéré (2026-09-17) : ces overrides
	   sont indexés par NOM DE SEGMENT, qui confond deux dossiers homonymes
	   ouverts depuis deux racines — acceptable pour une couleur, pas pour un
	   horizon de rétention. La date vit désormais sous la clé de module de
	   l'hôte (`DashboardShellCtx.examDate`). Les valeurs déjà écrites sous
	   cette clé restent sur le disque, ignorées : elles n'ont jamais eu
	   d'effet, aucun lecteur ne les a jamais relues. */
}

/** Applique les overrides réglages PAR-DESSUS la table issue de la note.
    Retourne une nouvelle map (l'originale, mise en cache, reste intacte). */
export function applyModuleOverrides(map: ModuleMap, overrides: Record<string, ModuleOverride>): ModuleMap {
	const byFolder = new Map(map.byFolder);
	const ueOrder = [...map.ueOrder];
	for (const [folder, ov] of Object.entries(overrides)) {
		const base = byFolder.get(folder) ?? { folder, name: folder, ue: null };
		const merged: ModuleInfo = {
			folder,
			name: ov.name?.trim() || base.name,
			ue: ov.ue !== undefined ? ov.ue : base.ue,
			color: ov.color ?? base.color,
			icon: ov.icon ?? base.icon,
			path: ov.path ?? base.path,
		};
		byFolder.set(folder, merged);
		// Une UE inventée dans le modal doit exister dans l'axe UE.
		if (merged.ue && !ueOrder.includes(merged.ue)) ueOrder.push(merged.ue);
	}
	return { byFolder, ueOrder };
}

/** Table issue de la note : dossier → info, + ordre d'apparition des UE. */
export interface ModuleMap {
	byFolder: Map<string, ModuleInfo>;
	/** Titres d'UE dans l'ordre du document (pour l'axe « Par UE »). */
	ueOrder: string[];
}

const CALLOUT_RE = /^>\s*\[!portals\]\s*(.+?)\s*$/;
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;

/* Extrait le SEGMENT de dossier de module d'un chemin de lien : le premier
   segment situé après un dossier « année » (repéré par « B1 (…) », « B2 (…) »,
   etc.). Si aucun dossier année n'est reconnu, on prend le dernier segment de
   dossier (le lien pointe soit vers le dossier, soit vers une note dedans —
   dans les deux cas le dossier de module est l'avant-dernier ou le dernier
   segment ; on retient le segment sous l'année pour être robuste aux deux). */
function moduleFolderFromLinkPath(linkPath: string): string {
	const segs = linkPath.split("/").filter(Boolean);
	const yearIdx = segs.findIndex(s => /\bB\d+\s*\(/.test(s));
	if (yearIdx >= 0 && yearIdx + 1 < segs.length) return segs[yearIdx + 1];
	// Repli : avant-dernier segment si le lien finit par une note homonyme,
	// sinon le dernier. On ne peut pas distinguer note/dossier depuis le texte ;
	// le 1er segment sous l'année couvre le vault réel d'Ahmed.
	return segs.length >= 2 ? segs[segs.length - 2] : segs[segs.length - 1] || "";
}

/** Parse le texte de la note de correspondance. Tolérant : lignes hors
    encadré ignorées ; note sans encadré → map vide (dégradation propre). */
export function parseModuleMap(noteText: string): ModuleMap {
	const byFolder = new Map<string, ModuleInfo>();
	const ueOrder: string[] = [];
	let currentUe: string | null = null;
	for (const raw of noteText.split(/\r?\n/)) {
		const co = raw.match(CALLOUT_RE);
		if (co) {
			currentUe = co[1];
			if (!ueOrder.includes(currentUe)) ueOrder.push(currentUe);
			continue;
		}
		// Une ligne de lien n'appartient à une UE que sous un encadré ; une
		// ligne « > » vide ou du texte libre ne remet pas currentUe à null
		// (les encadrés Obsidian sont des blocs de lignes « > … » contiguës,
		// mais une ligne blanche entre deux encadrés suffit à séparer —
		// gérée par le fait qu'un nouvel encadré réassigne currentUe).
		const lk = raw.match(LINK_RE);
		if (!lk || currentUe === null) continue;
		const folder = moduleFolderFromLinkPath(lk[1]);
		if (!folder) continue;
		const name = (lk[2] || folder).trim();
		if (!byFolder.has(folder)) byFolder.set(folder, { folder, name, ue: currentUe });
	}
	return { byFolder, ueOrder };
}

/** Module d'un quiz : plus proche dossier ANCÊTRE reconnu dans la table.
    Fallback : dossier parent immédiat, UE null (jamais de disparition). */
export function moduleForQuiz(quizPath: string, map: ModuleMap): ModuleInfo {
	const segs = quizPath.split("/").filter(Boolean);
	// segs sans le fichier : on remonte du plus profond vers la racine.
	for (let i = segs.length - 2; i >= 0; i--) {
		const hit = map.byFolder.get(segs[i]);
		/* Le chemin RÉEL se DÉDUIT ici, et c'est le seul endroit qui le peut :
		   on tient à la fois le segment reconnu et sa POSITION dans le chemin
		   du quiz. Un `path` déjà déclaré (override) l'emporte — lui vaut pour
		   le module entier, quand celui-ci ne vaut que pour ce quiz-là. */
		if (hit) return hit.path ? hit : { ...hit, path: segs.slice(0, i + 1).join("/") };
	}
	const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
	return { folder: parent, name: parent, ue: null, path: segs.slice(0, -1).join("/") || undefined };
}

/** Un module affiché : ses quiz + agrégats. */
export interface ModuleGroup {
	folder: string;
	name: string;
	ue: string | null;
	/** Chemin réel du dossier (cf. `ModuleInfo.path`) : celui de la
	    déclaration, sinon celui déduit du premier quiz du groupe. Absent pour
	    un dossier déclaré sans quiz ET sans chemin — les déclarations d'avant
	    le 2026-09-17. */
	path?: string;
	/** Couleur de liseré override (cf. ModuleInfo.color). */
	color?: string;
	/** Icône Lucide override (cf. ModuleInfo.icon). */
	icon?: string;
	quizzes: QuizIndexEntry[];
	total: number;
	mastered: number;
}

/** Regroupe les quiz DÉJÀ FILTRÉS par module. Un module sans quiz n'existe
    pas. Tri alphabétique par nom (jamais par nombre). */
export function buildModuleGroups(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	/** Dossiers à afficher MÊME sans quiz (créés/édités via les modals —
	    sans ça, un « Nouveau dossier » vide n'apparaîtrait jamais). */
	alwaysInclude: string[] = []
): ModuleGroup[] {
	const acc = new Map<string, ModuleGroup>();
	for (const folder of alwaysInclude) {
		const info = map.byFolder.get(folder) ?? { folder, name: folder, ue: null };
		acc.set(folder, { folder, name: info.name, ue: info.ue, color: info.color, icon: info.icon, path: info.path, quizzes: [], total: 0, mastered: 0 });
	}
	for (const q of quizzes) {
		const m = moduleForQuiz(q.path, map);
		let g = acc.get(m.folder);
		if (!g) { g = { folder: m.folder, name: m.name, ue: m.ue, color: m.color, icon: m.icon, path: m.path, quizzes: [], total: 0, mastered: 0 }; acc.set(m.folder, g); }
		/* Un groupe né d'`alwaysInclude` (déclaré, 0 quiz) n'a de chemin que
		   celui de sa déclaration. Le premier quiz qui s'y range le lui donne
		   si elle n'en portait pas — les dossiers déclarés avant le
		   2026-09-17 n'en ont aucun. */
		if (!g.path && m.path) g.path = m.path;
		g.quizzes.push(q);
	}
	const groups = [...acc.values()];
	for (const g of groups) {
		g.total = g.quizzes.length;
		g.mastered = g.quizzes.filter(q => isMastered(q, stats)).length;
	}
	groups.sort((a, b) => a.name.localeCompare(b.name));
	return groups;
}

/** Un groupe d'UE : ses modules + agrégats. */
export interface UeGroup {
	/** Titre d'UE, ou null pour les modules sans UE. */
	ue: string | null;
	/** Clé de repli stable : « ue:<titre> » (le « : » est interdit dans un
	    chemin Obsidian → aucune collision avec une vraie clé de dossier). */
	key: string;
	modules: ModuleGroup[];
	total: number;
	mastered: number;
}

/** Regroupe des modules par UE. UE dans l'ordre du document (map.ueOrder) ;
    « Sans UE » (modules non résolus) toujours en DERNIER. */
export function buildUeGroups(modules: ModuleGroup[], map: ModuleMap): UeGroup[] {
	const byUe = new Map<string, ModuleGroup[]>();
	for (const m of modules) {
		const k = m.ue ?? "";
		if (!byUe.has(k)) byUe.set(k, []);
		byUe.get(k)!.push(m);
	}
	const groups: UeGroup[] = [];
	const push = (ue: string | null) => {
		const list = byUe.get(ue ?? "");
		if (!list || !list.length) return;
		groups.push({
			ue,
			key: ue === null ? "ue:__none__" : "ue:" + ue,
			modules: list,
			total: list.reduce((s, m) => s + m.total, 0),
			mastered: list.reduce((s, m) => s + m.mastered, 0),
		});
	};
	for (const ue of map.ueOrder) push(ue);
	push(null); // « Sans UE » en dernier
	return groups;
}


/** Un groupe de l'axe « Dossier » : les modules qui partagent un même
    dossier parent. */
export interface FolderGroup {
	/** Chemin du dossier parent ("" si inconnu) — sert de clé. */
	parent: string;
	/** Ce qu'on affiche : le dernier segment du parent. */
	label: string;
	modules: ModuleGroup[];
}

/** L'axe « Dossier » (2026-09-24) : un en-tête par dossier PARENT des
    modules — « B2 (2026-2027) » pour les cours, « Neo Quiz » pour les
    générés, « Personal » pour les modèles. Il vaut pour tout le monde, là où
    l'axe UE suppose un cursus déclaré. Groupes et modules par ordre
    alphabétique ; un module sans chemin connu va dans un groupe sans nom, en
    dernier. PURE. */
export function buildFolderGroups(modules: ModuleGroup[]): FolderGroup[] {
	const parParent = new Map<string, ModuleGroup[]>();
	for (const m of modules) {
		const segs = (m.path ?? "").split("/").filter(Boolean);
		const parent = segs.slice(0, -1).join("/");
		if (!parParent.has(parent)) parParent.set(parent, []);
		parParent.get(parent)!.push(m);
	}
	const groupes = [...parParent.entries()].map(([parent, mods]) => ({
		parent,
		label: parent.split("/").pop() ?? "",
		modules: [...mods].sort((a, b) => a.name.localeCompare(b.name)),
	}));
	return groupes.sort((a, b) => (a.parent === "" ? 1 : 0) - (b.parent === "" ? 1 : 0) || a.label.localeCompare(b.label));
}

/** Les dossiers que montre « Mes quiz » : ceux qui ont des quiz, ceux que
    l'utilisateur a DÉCLARÉS (Nouveau dossier / Modifier dossier) même vides,
    sauf les archivés, et le sas des quiz générés même vide. Une seule
    écriture, lue par la page ET par « Déplacer vers » : le sous-menu ne
    proposait que les dossiers qui avaient déjà un quiz (2026-09-27). */
export function modulesAffiches(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	declares: string[],
	archives: string[],
	sas: string | undefined,
): ModuleGroup[] {
	const modules = buildModuleGroups(quizzes, stats, map, declares.filter(f => !archives.includes(f)));
	/* LE SAS DES QUIZ GÉNÉRÉS EXISTE MÊME VIDE : c'est là que les générations
	   arrivent, et le vider le faisait disparaître de la page (2026-09-20).
	   Ajouté sans quiz s'il n'y est pas déjà, avec l'override de dossier
	   (couleur, icône) s'il en a un. */
	if (sas && !modules.some(m => m.path === sas)) {
		const nom = sas.split("/").pop() || sas;
		const info = map.byFolder.get(nom);
		modules.push({ folder: nom, name: info?.name ?? nom, ue: info?.ue ?? null, color: info?.color, icon: info?.icon, path: sas, quizzes: [], total: 0, mastered: 0 });
		modules.sort((a, b) => a.name.localeCompare(b.name));
	}
	return modules;
}

/** Ce groupe est-il le SAS des quiz générés ? Par le CHEMIN, jamais par le
    nom (`DashboardShellCtx.generatedFolder`). Un groupe sans chemin (déclaré
    avant le 2026-09-17, sans quiz) n'est jamais le sas : le sas contient
    toujours au moins un quiz dès qu'on le voit, donc il a toujours un chemin. */
export function estLeSas(group: ModuleGroup, sas: string | undefined): boolean {
	return !!sas && !!group.path && group.path === sas;
}
