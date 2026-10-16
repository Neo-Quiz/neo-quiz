import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t, type TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { moduleForQuiz, estLeSas } from "./quiz-modules";
import type { ModuleGroup, ModuleMap, ModuleOverride } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import { openColorPicker } from "./color-picker";
import { openIconPicker } from "./icon-picker";
import { moduleIcon } from "./module-icons";
import { MODULE_PALETTE, moduleAccent } from "./module-color";
import { suggestIcons } from "./icon-suggest";
import { saveSettingsReporting } from "./save-settings";
import { CLASS_SESSION_BOUNDS, CLASS_SESSION_FIELDS, classSessionNumber, parseClassSessionInput } from "../class-sessions";
import type { ClassSessionField } from "../class-sessions";

type ModuleEditState = Required<Pick<ModuleOverride, "name" | "ue">>
	& Omit<ModuleOverride, "name" | "ue">;

// Any persisted field added to `ModuleOverride` must break tsc until this
// rebuilder handles it explicitly, otherwise a plain edit would erase the new field.
const MODULE_EDIT_HANDLED_FIELDS = {
	name: true,
	ue: true,
	color: true,
	icon: true,
	path: true,
	hidden: true,
	sessions: true,
	sessionMinutes: true,
	sessionsPerWeek: true,
} satisfies Record<keyof ModuleOverride, true>;

/** The modal's persistence contract in one place, so that the civil date stays
    identical down to the adapter and clearing it really removes the key. */
export function buildModuleOverride(folder: string, state: ModuleEditState): ModuleOverride {
	void MODULE_EDIT_HANDLED_FIELDS;
	const ov: ModuleOverride = {};
	if (state.name.trim() && state.name.trim() !== folder) ov.name = state.name.trim();
	// `null` forces "No UE", while `undefined` would keep the UE of the mapping note.
	ov.ue = state.ue;
	if (state.color) ov.color = state.color;
	if (state.icon) ov.icon = state.icon;
	/* CARRIED OVER AS IS, never recomputed: this modal designates no folder,
	   it edits a name and colours. The caller passes it the path ALREADY
	   DECLARED (and nothing when there is none). Without this, renaming a
	   folder would erase its path, and "New quiz" there would fall back on the
	   bare segment. A path deduced from a quiz is NOT promoted here: it holds
	   for that quiz, and it is recomputed on its own at the next render. */
	if (state.path) ov.path = state.path;
	// Carried over too: editing the name or colour of a hidden folder must not show it again.
	if (state.hidden) ov.hidden = state.hidden;
	// Class sessions: only a valid value is written; empty or damaged = absent.
	for (const f of CLASS_SESSION_FIELDS) {
		const v = state[f];
		if (v !== undefined && classSessionNumber(f, v) !== null) ov[f] = v;
	}
	return ov;
}

/* ══════════════════════════════════════════════════════════
   MODULE EDIT — modal « Modifier dossier », calqué sur celui de
   StudySmarter (capture Excalidraw 2026-07-18) : nom du dossier,
   UE (leur « Matière »), pastilles de couleur. SANS le toggle
   « Rendre ce dossier publique » (exclu explicitement par Ahmed).
   AUTO-SAVE (pas de bouton Enregistrer) : tout est local, donc chaque
   changement est appliqué à l'override EN MÉMOIRE aussitôt (apply()),
   puis persisté sur disque + grille rafraîchie une seule fois à la
   fermeture (onClose) — pas de martèlement I/O pendant le drag du
   picker, où onChange émet ~60×/s. Persistance : override réglages
   (quizzesModuleOverrides) — la note de correspondance n'est JAMAIS
   réécrite par le plugin.
══════════════════════════════════════════════════════════ */

export function openModuleEditModal(
	ctx: DashboardShellCtx,
	group: ModuleGroup,
	map: ModuleMap,
	onSaved: () => void
): void {
	let name = group.name || group.folder;
	let ue = group.ue;
	let color = group.color;
	let icon = group.icon;
	/* Le SAS des quiz générés se reconnaît au CHEMIN (`estLeSas`), comme la
	   carte et le titre du dossier ouvert : c'est ce qui fait que l'aperçu
	   d'icône et la teinte du modal montrent ce que l'utilisateur voit
	   ailleurs, et non le défaut générique. */
	const genere = estLeSas(group, ctx.generatedFolder?.());
	/* The DECLARED path, read from the override and not from the group: the
	   group's may be deduced from a quiz, and persisting it would freeze in
	   the settings a value that is, today, recomputed on its own. Same for
	   the hidden flag, which this modal does not edit. */
	const path = ctx.settings.quizzesModuleOverrides?.[group.folder]?.path;
	const hidden = ctx.settings.quizzesModuleOverrides?.[group.folder]?.hidden;
	/* The class sessions as stored when the modal opens. A field typed out of
	   its bounds keeps its stored value (nothing is written for it, it shows
	   red), it never becomes a guessed or a cleared one. */
	const sessionsAtOpen: Partial<Record<ClassSessionField, string>> = {};
	for (const f of CLASS_SESSION_FIELDS) {
		const v = ctx.settings.quizzesModuleOverrides?.[group.folder]?.[f];
		if (v !== undefined && classSessionNumber(f, v) !== null) sessionsAtOpen[f] = v;
	}
	const sessions: Partial<Record<ClassSessionField, string>> = { ...sessionsAtOpen };
	/** Un changement au moins a eu lieu → onClose persiste + rafraîchit. */
	let dirty = false;

	/* Auto-save : reconstruit l'override depuis l'état courant, l'écrit dans
	   les settings EN MÉMOIRE (synchrone) et rafraîchit la grille AUSSITÔT —
	   la carte du dossier se recolore à chaque clic de couleur (temps réel),
	   sans attendre la fermeture. effectiveMap() relit les overrides à chaque
	   rendu, donc onSaved() reflète le changement immédiatement. La seule
	   écriture disque est différée à onClose (pas de martèlement I/O). */
	const apply = (): void => {
		const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
		const ov = buildModuleOverride(group.folder, { name, ue, color, icon, path, hidden, ...sessions });
		overrides[group.folder] = ov;
		ctx.settings.quizzesModuleOverrides = overrides;
		dirty = true;
		onSaved();
	};

	requireHost("modals").open({
		className: "qbd-medit-modal",
		// t() AU RENDU (à l'ouverture), jamais dans une constante de haut
		// niveau : une chaîne figée au chargement ignorerait un changement de
		// langue.
		title: t("dashboard.quizzes.moduleEditTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			// Accent effectif (couleur choisie sinon dérivée du nom) dès l'ouverture :
			// il teinte l'aperçu d'icône ci-dessous ; paintDots() le met à jour quand
			// la couleur change.
			c.style.setProperty("--mod-color", moduleAccent({ folder: group.folder, color }, { generated: genere }));

			// ── Icône EN HAUT (au-dessus du nom, demande Ahmed 2026-07-19) : aperçu
			// carré teinté ; clic → picker avec recherche + suggestions du module ──
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditIcon"));
			const iconBtn = ajouter(c, "button", "qbd-medit-icon-btn");
			iconBtn.type = "button";
			iconBtn.setAttribute("aria-label", t("dashboard.quizzes.moduleEditIcon"));
			iconBtn.title = t("dashboard.quizzes.moduleEditIcon");
			const paintIcon = () => { iconBtn.replaceChildren(); currentHost().ui.setIcon(iconBtn, moduleIcon({ icon, name, ue }, { generated: genere })); };
			paintIcon();
			iconBtn.addEventListener("click", () => {
				// Portalé au PANNEAU du modal (comme le color picker) → pas de vol
				// de focus, et le menu ne passe pas derrière le panneau.
				// Suggestions d'après le nom + l'UE COURANTS.
				openIconPicker(iconBtn, icon, (nom) => { icon = nom; paintIcon(); apply(); }, m.panelEl, suggestIcons(name, ue));
			});

			// ── Nom du dossier ──
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditName"));
			const nameInput = ajouter(c, "input", "qbd-medit-input");
			nameInput.type = "text";
			nameInput.value = name;
			nameInput.addEventListener("input", () => { name = nameInput.value; apply(); });

			// ── UE (la « Matière » de StudySmarter) ──
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditUe"));
			const ueBtn = ajouter(c, "button", "qbd-select qbd-medit-select");
			ueBtn.type = "button";
			const ueLabel = ajouter(ueBtn, "span", "qbd-select-label");
			const ueChev = ajouter(ueBtn, "span", "qbd-select-chevron");
			currentHost().ui.setIcon(ueChev, "chevron-down");
			const paintUe = () => { ueLabel.textContent = ue ?? t("dashboard.quizzes.noUe"); };
			paintUe();
			ueBtn.addEventListener("click", () => {
				// UE connues (note + overrides) + « Sans UE ». Le menu est portalé au
				// body (ui-select) : il flotte par-dessus le modal sans le refermer.
				const options: Array<string | null> = [...map.ueOrder, null];
				openActionMenu(ueBtn, options.map(opt => ({
					icon: opt === ue ? "check" : undefined,
					label: opt ?? t("dashboard.quizzes.noUe"),
					onClick: () => { ue = opt; paintUe(); apply(); },
				})));
			});

			/* « Gérer les examens » (tâche 4, 2026-09-26) remplace le champ de
			   date unique : plusieurs examens par dossier vivent désormais dans
			   l'onglet Planning (`folder-planning.ts`), qui les affiche ET les
			   édite — un seul champ ici aurait dupliqué cette édition à deux
			   endroits. Le bouton ferme CE modal (il n'a plus rien à faire ici)
			   et ouvre directement l'onglet. Absent si l'hôte ne sait pas y
			   naviguer (même garde qu'avant : `group.quizzes.length` — un
			   dossier sans quiz n'a aucune clé de module où ranger un examen). */
			if (ctx.openFolderTab && group.quizzes.length) {
				const gererBtn = ajouter(c, "button", "qbd-folder-section-action qbd-medit-manage-exams");
				gererBtn.type = "button";
				currentHost().ui.setIcon(ajouter(gererBtn, "span", "qbd-folder-section-action-icon"), "calendar-days");
				ajouter(gererBtn, "span", undefined, t("dashboard.planning.manageExams"));
				gererBtn.addEventListener("click", () => {
					m.close();
					ctx.openFolderTab!(group.folder, "planning");
				});
			}

			// ── Class sessions: three small number fields, empty = unknown.
			// After "Manage exams", which stays right under the UE. ──
			renderClassSessionFields(c, sessions, sessionsAtOpen, apply);

			// ── Couleur (8 pastilles ; re-cliquer la pastille active la retire →
			// retour au liseré par avancement) + pastille « couleur personnalisée »
			// (roue chromatique) qui ouvre le picker recopié de neo-calendar ──
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditColor"));
			const row = ajouter(c, "div", "qbd-medit-colors");
			const paintDots = () => {
				row.replaceChildren();
				MODULE_PALETTE.forEach((col, i) => {
					const dot = ajouter(row, "button", "qbd-medit-dot");
					dot.type = "button";
					const nom = t(`dashboard.quizzes.moduleColor${i}` as TransKey);
					dot.setAttribute("aria-label", nom);
					dot.title = nom;
					dot.style.background = col;
					if (col === color) currentHost().ui.setIcon(dot, "check");
					dot.addEventListener("click", () => {
						color = color === col ? undefined : col;
						paintDots();
						apply();
					});
				});
				// 9e cercle : couleur personnalisée. Roue chromatique au repos ;
				// quand une couleur HORS palette est active, il la porte + check.
				const custom = ajouter(row, "button", "qbd-medit-dot qbd-medit-dot--custom");
				custom.type = "button";
				custom.setAttribute("aria-label", t("dashboard.quizzes.moduleEditCustomColor"));
				custom.title = t("dashboard.quizzes.moduleEditCustomColor");
				const isCustom = !!color && !MODULE_PALETTE.includes(color);
				if (isCustom && color) {
					custom.style.background = color;
					currentHost().ui.setIcon(custom, "check");
				}
				custom.addEventListener("click", () => {
					// Aperçu live : onChange arrive en continu pendant le drag ;
					// le repaint recrée les pastilles, le picker (fixed) reste.
					// Portalé au PANNEAU du modal (m.panelEl), pas au body : sinon le
					// focus trap du modal ramène le focus de l'input hex vers le champ
					// « nom » dès qu'on clique dedans (bug de sélection).
					openColorPicker(custom, color ?? MODULE_PALETTE[0], (hex) => {
						color = hex;
						paintDots();
						apply();
					}, m.panelEl);
				});
				// La couleur courante teinte aussi l'aperçu d'icône (var --mod-color,
				// comme la carte). Défaut = accent quand aucune couleur n'est choisie.
				// L'aperçu d'icône montre l'accent EFFECTIF (couleur choisie sinon
				// dérivée du nom) — WYSIWYG avec la carte.
				c.style.setProperty("--mod-color", moduleAccent({ folder: group.folder, color }, { generated: genere }));
			};
			paintDots();
			// Pas de bouton « Enregistrer » : auto-save (apply() sur chaque
			// changement) + flush à onClose. Fermeture par clic-dehors / Échap.
		},
		onClose: () => {
			// La grille a déjà été rafraîchie en direct par apply() ; il ne reste
			// qu'à flusher les settings sur disque UNE fois (pas 60×/s pendant le
			// drag du picker). saveSettings ne s'appelle que si un changement a eu
			// lieu. Le corps du modal, lui, est vidé par l'HÔTE (contrat
			// `HostModalHandle`) : l'appelant n'a rien à y faire.
			if (dirty) saveSettingsReporting(() => ctx.saveSettings());
		},
	});
}

const SESSION_LABEL_KEYS: Record<ClassSessionField, TransKey> = {
	sessions: "dashboard.quizzes.moduleEditSessionsCount",
	sessionMinutes: "dashboard.quizzes.moduleEditSessionsLength",
	sessionsPerWeek: "dashboard.quizzes.moduleEditSessionsPerWeek",
};

/** The "Class sessions" part of "Edit folder". `sessions` is the modal's
    state, mutated in place; `atOpen` is what an invalid field falls back to. */
function renderClassSessionFields(
	c: HTMLElement,
	sessions: Partial<Record<ClassSessionField, string>>,
	atOpen: Partial<Record<ClassSessionField, string>>,
	apply: () => void,
): void {
	ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditSessions"));
	const list = ajouter(c, "div", "qbd-medit-sessions");
	for (const f of CLASS_SESSION_FIELDS) {
		const id = `qbd-medit-session-${f}`;
		const row = ajouter(list, "div", "qbd-medit-session-row");
		const label = ajouter(row, "label", "qbd-medit-session-label", t(SESSION_LABEL_KEYS[f]));
		label.htmlFor = id;
		const input = ajouter(row, "input", "qbd-medit-input qbd-medit-session-input");
		input.id = id;
		input.type = "text";
		input.inputMode = "numeric";
		input.autocomplete = "off";
		input.maxLength = 4;
		input.value = sessions[f] ?? "";
		const { min, max } = CLASS_SESSION_BOUNDS[f];
		const error = ajouter(list, "p", "qbd-medit-hint qbd-medit-session-error", t("dashboard.quizzes.moduleEditSessionsRange", { min, max }));
		error.id = `${id}-error`;
		error.hidden = true;
		input.setAttribute("aria-describedby", error.id);
		input.addEventListener("input", () => {
			const parsed = parseClassSessionInput(f, input.value);
			const invalid = parsed.kind === "invalid";
			input.setAttribute("aria-invalid", String(invalid));
			error.hidden = !invalid;
			const next = parsed.kind === "value" ? parsed.v : parsed.kind === "empty" ? undefined : atOpen[f];
			if (next === sessions[f]) return;
			if (next === undefined) delete sessions[f]; else sessions[f] = next;
			apply();
		});
	}
}

/* ── « New folder » — le bouton pilule du header (l'équivalent de « Create
   Study Set » chez StudySmarter, libellé adapté). Crée un VRAI dossier du
   vault sous le parent commun des modules existants, et le déclare dans les
   overrides pour que sa carte (vide) apparaisse immédiatement. ── */

/** Parent le plus fréquent des dossiers de module (déduit des chemins de
    quiz). Nothing deducible (empty catalogue: first folder of a fresh
    install, a filtered list) gives `fallback`: the default root, as a
    contract path. Without it the new folder was the bare path "name", which
    belongs to no open root, and every attempt failed ("outside the opened
    folders"). */
export function commonModuleParent(quizzes: QuizIndexEntry[], map: ModuleMap, fallback = ""): string {
	const counts = new Map<string, number>();
	for (const q of quizzes) {
		const folder = moduleForQuiz(q.path, map).folder;
		const segs = q.path.split("/").filter(Boolean);
		const idx = segs.indexOf(folder);
		if (idx < 0) continue;
		const prefix = segs.slice(0, idx).join("/");
		counts.set(prefix, (counts.get(prefix) || 0) + 1);
	}
	let best = "", bestN = 0;
	for (const [prefix, n] of counts) if (n > bestN) { best = prefix; bestN = n; }
	return best || fallback;
}

/** The default root as a contract path: where a folder goes when no quiz
    says otherwise. */
export function defaultParent(): string {
	const paths = currentHost().paths;
	return paths.contractPath(paths.defaultRoot().id, "");
}

/** The toast for a failed `mkdirs`: says WHY when the cause is known. */
export function newFolderErrorMessage(err: unknown): string {
	const detail = err instanceof Error ? err.message : String(err);
	if (/hors des dossiers ouverts/.test(detail)) return t("dashboard.quizzes.newFolderErrorOutside");
	return t("dashboard.quizzes.newFolderErrorReason", { reason: detail });
}

export function openNewFolderModal(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onCreated: () => void
): void {
	let name = "";
	// One request at a time: a second click while one runs did nothing useful
	// but stack a second identical failure toast.
	let busy = false;

	requireHost("modals").open({
		className: "qbd-medit-modal",
		title: t("dashboard.quizzes.newFolderTitle"),
		onOpen: (m) => {
			const create = async (): Promise<void> => {
				const clean = name.trim().replace(/[\\/:*?"<>|]/g, "-");
				if (busy || !clean) return;
				const parent = commonModuleParent(quizzes, map, defaultParent());
				const path = parent ? `${parent}/${clean}` : clean;
				busy = true;
				try {
					// `mkdirs` ne rejette pas si le dossier existe déjà : le test
					// d'existence qui le précédait n'apportait rien. Un DOSSIER ne
					// se cherche de toute façon pas dans l'index des `.md`.
					await currentHost().fs.mkdirs(path);
				} catch (e) {
					currentHost().ui.notice(newFolderErrorMessage(e));
					return;
				} finally {
					busy = false;
				}
				// Déclaré en override : la carte du dossier (0 quiz) apparaît tout de
				// suite, sans attendre qu'un premier quiz y soit créé.
				/* Avec son CHEMIN (2026-09-17) : la clé n'est qu'un segment, et un
				   dossier vide n'a aucun quiz d'où déduire le reste. Sans lui,
				   « Nouveau quiz » dans le dossier qu'on vient de créer écrivait
				   hors des dossiers ouverts. `path` est déjà calculé deux lignes
				   plus haut, c'est là qu'on créé le dossier. */
				const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
				/* An entry left WITHOUT a path (color or UE set on a folder that
				   later disappeared) still gets this one: kept as it was, the new
				   folder would show no card and stay unwritable. */
				overrides[clean] = { ...(overrides[clean] || {}), name: overrides[clean]?.name || clean, path };
				ctx.settings.quizzesModuleOverrides = overrides;
				saveSettingsReporting(() => ctx.saveSettings());
				m.close();
				onCreated();
			};

			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditName"));
			const input = ajouter(c, "input", "qbd-medit-input");
			input.type = "text";
			input.addEventListener("input", () => { name = input.value; });
			window.setTimeout(() => input.focus(), 0);

			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.quizzes.newFolderCta"));
			save.addEventListener("click", () => { void create(); });
			input.addEventListener("keydown", (e) => { if (e.key === "Enter") void create(); });
		},
	});
}
