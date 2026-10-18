import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isMastered } from "./quiz-mastery";
import { estCategorie, type CategorieQuiz } from "./categorie-quiz";

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
	/** Subject chosen by hand (cf. ModuleOverride.subject), a known id or absent. */
	subject?: CategorieQuiz;
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
	/** `"1"`: the folder is hidden from the lists ("Hide from list" of its ⋯
	    menu, `folder-hidden.ts`) and its reviews are paused. Absent = shown.
	    Synced like the other fields (`src/shared-state/merge.ts`). */
	hidden?: string;
	/** The course's class sessions ("Edit folder"): their number, the length
	    of one in minutes, how many per week. Decimal integer strings, each
	    optional; read through `readClassSessions` (`src/class-sessions.ts`),
	    which leaves a damaged value out. Synced like the other fields. */
	sessions?: string;
	sessionMinutes?: string;
	sessionsPerWeek?: string;
	/** The folder's subject chosen by hand ("Edit folder"): a `CategorieQuiz` id,
	    absent = deduced from its path and name. Synced like the other fields. */
	subject?: string;
	/* PAS DE `examDate` ICI, et c'est délibéré (2026-09-17) : ces overrides
	   sont indexés par NOM DE SEGMENT, qui confond deux dossiers homonymes
	   ouverts depuis deux racines — acceptable pour une couleur, pas pour un
	   horizon de rétention. La date vit désormais sous la clé de module de
	   l'hôte (`DashboardShellCtx.examDate`). Les valeurs déjà écrites sous
	   cette clé restent sur le disque, ignorées : elles n'ont jamais eu
	   d'effet, aucun lecteur ne les a jamais relues. */
}

/** The folders shown as a card even with no quiz: only the overrides that
    carry a `path`. An override without one is cosmetic data (color, icon, UE)
    for a folder its quizzes reveal; on its own it names no folder at all.
    Counting every key used to keep a card alive after its folder was gone
    from the disk: an archive imported as "X (2)", then deleted, left an empty
    "X" card behind forever, with no path and nowhere to write. */
export function declaredFolders(overrides: Record<string, ModuleOverride> | undefined): string[] {
	return Object.entries(overrides || {}).filter(([, ov]) => !!ov?.path).map(([key]) => key);
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
			subject: estCategorie(ov.subject) ? ov.subject : base.subject,
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

/* Extracts the module folder SEGMENT of a link path: the first segment after a
   "year" folder ("B1 (…)", "B2 (…)", or "B2 2026-2027" since 2026-10-15). When
   no year folder is recognised, the last folder segment (the link points either
   at the folder or at a note inside it: in both cases the module folder is the
   last or second-to-last segment; the segment under the year is kept to be
   robust to both). */
const YEAR_SEGMENT_RE = /\bB\d+\s*\(|^B\d+\s+\d{4}-\d{4}(?!\d)/;
export function moduleFolderFromLinkPath(linkPath: string): string {
	const segs = linkPath.split("/").filter(Boolean);
	const yearIdx = segs.findIndex(s => YEAR_SEGMENT_RE.test(s));
	if (yearIdx >= 0 && yearIdx + 1 < segs.length) return segs[yearIdx + 1];
	// Fallback: the second-to-last segment when the link ends with a note of the
	// same name, else the last. Text alone cannot tell a note from a folder; the
	// first segment under the year covers the real vaults.
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

/** The subject chosen by hand for the folder holding `quizPath` ("Edit folder"):
    the override of the deepest folder of the path that has one (the overrides
    are keyed by folder segment, like `moduleForQuiz`). */
export function folderSubjectOf(quizPath: string, overrides: Record<string, ModuleOverride> | undefined): CategorieQuiz | undefined {
	const segs = quizPath.split("/").filter(Boolean);
	for (let i = segs.length - 2; i >= 0; i--) {
		const s = overrides?.[segs[i]]?.subject;
		if (estCategorie(s)) return s;
	}
	return undefined;
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
	/** Subject chosen by hand (cf. ModuleInfo.subject). */
	subject?: CategorieQuiz;
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
		acc.set(folder, { folder, name: info.name, ue: info.ue, color: info.color, icon: info.icon, subject: info.subject, path: info.path, quizzes: [], total: 0, mastered: 0 });
	}
	for (const q of quizzes) {
		const m = moduleForQuiz(q.path, map);
		let g = acc.get(m.folder);
		if (!g) { g = { folder: m.folder, name: m.name, ue: m.ue, color: m.color, icon: m.icon, subject: m.subject, path: m.path, quizzes: [], total: 0, mastered: 0 }; acc.set(m.folder, g); }
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

/** The folders "My quizzes" shows: those with quizzes and those the user
    DECLARED (New folder / Edit folder) even empty, except the `excluded` ones
    (the hidden folders). One rule, read by the page AND by "Move to": the
    submenu used to offer only the folders that already had a quiz
    (2026-09-27). */
export function modulesAffiches(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	declares: string[],
	excluded: string[],
): ModuleGroup[] {
	return buildModuleGroups(quizzes, stats, map, declares.filter(f => !excluded.includes(f)));
}
