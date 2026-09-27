import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
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

type ModuleEditState = Required<Pick<ModuleOverride, "name" | "ue">>
	& Omit<ModuleOverride, "name" | "ue">;

// Toute extension persistée doit casser tsc tant que ce reconstructeur ne la
// traite pas explicitement, sinon une simple édition effacerait le nouveau champ.
const MODULE_EDIT_HANDLED_FIELDS = {
	name: true,
	ue: true,
	color: true,
	icon: true,
	path: true,
} satisfies Record<keyof ModuleOverride, true>;

/** Centralise le contrat de persistance du modal pour que la date civile reste
    identique jusqu'à l'adaptateur et que son effacement retire vraiment la clé. */
export function buildModuleOverride(folder: string, state: ModuleEditState): ModuleOverride {
	void MODULE_EDIT_HANDLED_FIELDS;
	const ov: ModuleOverride = {};
	if (state.name.trim() && state.name.trim() !== folder) ov.name = state.name.trim();
	// `null` force « Sans UE », tandis qu'`undefined` conserverait l'UE de la note.
	ov.ue = state.ue;
	if (state.color) ov.color = state.color;
	if (state.icon) ov.icon = state.icon;
	/* REPORTÉ TEL QUEL, jamais recalculé : ce modal ne désigne aucun dossier,
	   il édite un nom et des couleurs. L'appelant lui passe le chemin DÉJÀ
	   DÉCLARÉ (et rien quand il n'y en a pas) — sans ce report, renommer un
	   dossier effacerait son chemin, et « Nouveau quiz » y retomberait sur le
	   segment seul. On ne promeut PAS ici un chemin déduit d'un quiz : il vaut
	   pour ce quiz, et il se recalcule tout seul au rendu suivant. */
	if (state.path) ov.path = state.path;
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
	/* Le chemin DÉCLARÉ, lu dans l'override et non dans le groupe : celui du
	   groupe peut être déduit d'un quiz, et le persister figerait dans les
	   réglages une valeur qui, aujourd'hui, se recalcule seule. */
	const path = ctx.settings.quizzesModuleOverrides?.[group.folder]?.path;
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
		const ov = buildModuleOverride(group.folder, { name, ue, color, icon, path });
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

			// ── Couleur (8 pastilles ; re-cliquer la pastille active la retire →
			// retour au liseré par avancement) + pastille « couleur personnalisée »
			// (roue chromatique) qui ouvre le picker recopié de neo-calendar ──
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.moduleEditColor"));
			const row = ajouter(c, "div", "qbd-medit-colors");
			const paintDots = () => {
				row.replaceChildren();
				for (const col of MODULE_PALETTE) {
					const dot = ajouter(row, "button", "qbd-medit-dot");
					dot.type = "button";
					dot.style.background = col;
					if (col === color) currentHost().ui.setIcon(dot, "check");
					dot.addEventListener("click", () => {
						color = color === col ? undefined : col;
						paintDots();
						apply();
					});
				}
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
			if (dirty) ctx.saveSettings().catch(() => {});
		},
	});
}

/* ── « New folder » — le bouton pilule du header (l'équivalent de « Create
   Study Set » chez StudySmarter, libellé adapté). Crée un VRAI dossier du
   vault sous le parent commun des modules existants, et le déclare dans les
   overrides pour que sa carte (vide) apparaisse immédiatement. ── */

/** Parent le plus fréquent des dossiers de module (déduit des chemins de
    quiz) ; "" = racine du vault si rien n'est déductible. */
export function commonModuleParent(quizzes: QuizIndexEntry[], map: ModuleMap): string {
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
	return best;
}

export function openNewFolderModal(
	ctx: DashboardShellCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onCreated: () => void
): void {
	let name = "";

	requireHost("modals").open({
		className: "qbd-medit-modal",
		title: t("dashboard.quizzes.newFolderTitle"),
		onOpen: (m) => {
			const create = async (): Promise<void> => {
				const clean = name.trim().replace(/[\\/:*?"<>|]/g, "-");
				if (!clean) return;
				const parent = commonModuleParent(quizzes, map);
				const path = parent ? `${parent}/${clean}` : clean;
				try {
					// `mkdirs` ne rejette pas si le dossier existe déjà : le test
					// d'existence qui le précédait n'apportait rien. Un DOSSIER ne
					// se cherche de toute façon pas dans l'index des `.md`.
					await currentHost().fs.mkdirs(path);
				} catch {
					currentHost().ui.notice(t("dashboard.quizzes.newFolderError"));
					return;
				}
				// Déclaré en override : la carte du dossier (0 quiz) apparaît tout de
				// suite, sans attendre qu'un premier quiz y soit créé.
				/* Avec son CHEMIN (2026-09-17) : la clé n'est qu'un segment, et un
				   dossier vide n'a aucun quiz d'où déduire le reste. Sans lui,
				   « Nouveau quiz » dans le dossier qu'on vient de créer écrivait
				   hors des dossiers ouverts. `path` est déjà calculé deux lignes
				   plus haut, c'est là qu'on créé le dossier. */
				const overrides = { ...(ctx.settings.quizzesModuleOverrides || {}) };
				if (!overrides[clean]) overrides[clean] = { name: clean, path };
				ctx.settings.quizzesModuleOverrides = overrides;
				ctx.saveSettings().catch(() => {});
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
