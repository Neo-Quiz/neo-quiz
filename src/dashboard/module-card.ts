import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import { moduleIcon } from "./module-icons";
import { poserLogoObsidian } from "./brand-icons";
import { couperCheminAuMilieu } from "./file-icons";
import { moduleAccent } from "./module-color";
import { openMenuOnRightClick } from "./quiz-card";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz). Design
   « folder card 6a » (handoff claude design validé Ahmed 2026-07-18) :
   halo radial coloré dans l'angle HAUT-GAUCHE (dans le fond), carré
   d'icône + titre colorés de l'accent du dossier, stats, ligne
   séparatrice, bouton ••• en pied ; hover = élévation + lueur colorée.
   L'accent (var --accent, posé inline) vient du modal ou du hash du nom
   (module-color.ts) ; tout le reste se dérive en CSS via color-mix.
   Cliquer entre dans le module.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void,
	/* onMenu (opt-in) : la carte ne compose plus le menu et ne l'ouvre plus —
	   elle signale un clic sur « ⋯ » et rend son ancre. L'ouverture appartient
	   à l'hôte (ctx.openModuleMenu) : c'est ce qui évite à ce fichier
	   d'importer `ui-select.ts`, donc Obsidian, donc de rendre TOUTE la carte
	   (et tout ce qui la consomme) inutilisable dans la fenêtre de
	   l'application — l'import était inconditionnel là où le menu, lui,
	   était déjà optionnel (tour de correction 1, tâche 6). */
	onMenu?: (group: ModuleGroup, anchor: HTMLElement) => void,
	/* onPickIcon (opt-in) : clic sur la pastille d'icône → change l'icône
	   directement (raccourci, sans ouvrir « Modifier dossier »). L'appelant
	   fournit le comportement (picker + persistance) car la carte n'a pas
	   accès aux settings. */
	onPickIcon?: (group: ModuleGroup, anchor: HTMLElement) => void,
	/* generated (opt-in) : ce dossier est le SAS des quiz générés
	   (`ctx.generatedFolder`). Icône de l'IA à défaut d'une icône choisie, et
	   pas de « maîtrisés » : on n'y progresse pas, on y passe. */
	opts?: { generated?: boolean }
): HTMLDivElement {
	const card = ajouter(container, "div", "qbd-module-card");
	if (opts?.generated) card.classList.add("qbd-module-card--generated");
	// Accent du dossier (couleur choisie, sinon dérivée du nom) → toute la
	// teinte de la carte se dérive de --accent en CSS.
	card.style.setProperty("--accent", moduleAccent(group, { generated: !!opts?.generated }));

	// ── En-tête : pastille d'icône + titre coloré / sous-titre UE ──
	const header = ajouter(card, "div", "qbd-module-card__header");
	const iconBox = ajouter(header, "div", "qbd-module-card__icon");
	currentHost().ui.setIcon(iconBox, moduleIcon(group, { generated: !!opts?.generated }));
	if (onPickIcon) {
		// La pastille devient un raccourci « changer l'icône » ; le clic ne doit
		// PAS aussi entrer dans le module.
		// Pas de `title` : Obsidian en ferait une infobulle native flottante
		// parasite (cf. plugin-dev §0 bis) ; le highlight au survol suffit d'indice.
		iconBox.classList.add("qbd-module-card__icon--editable");
		iconBox.addEventListener("click", (e) => {
			e.stopPropagation();
			onPickIcon(group, iconBox);
		});
	}
	const titles = ajouter(header, "div", "qbd-module-card__titles");
	// Titre = nom du module. Fallback : un quiz sans ancêtre reconnu donne un
	// nom vide (moduleForQuiz) — jamais de titre blanc.
	ajouter(titles, "div", "qbd-module-card__title", group.name || t("dashboard.quizzes.noFolder"));
	// Sous-titre = UE, omis si non résolu (l'en-tête garde son alignement haut).
	if (group.ue) ajouter(titles, "div", "qbd-module-card__subtitle", group.ue);

	// ── Stats : « N quiz • N maîtrisés » (nombres en gras, séparateur discret) ──
	const stats = ajouter(card, "div", "qbd-module-card__stats");
	const addStat = (n: number, key: "dashboard.quizzes.moduleQuizzesOne" | "dashboard.quizzes.moduleQuizzesOther" | "dashboard.quizzes.folderMasteredOne" | "dashboard.quizzes.folderMasteredOther") => {
		const span = ajouter(stats, "span");
		ajouter(span, "strong", undefined, String(n));
		// La clé produit « {count} quizzes » : on retire le chiffre de tête (déjà
		// en gras) — seul le libellé traduit reste. `appendText` (Obsidian) devient
		// `Element.append` (DOM standard) : une chaîne y est déjà posée comme
		// nœud TEXTE, jamais interprétée comme du HTML — même garantie.
		span.append(" " + t(key, { count: n }).replace(/^\s*\d+\s*/, ""));
	};
	addStat(group.total, group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther");
	if (!opts?.generated) {
		ajouter(stats, "span", "sep", "•");
		addStat(group.mastered, group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther");
	}

	// ── Spacer + ligne séparatrice + pied (bouton ••• = menu existant) ──
	ajouter(card, "div", "qbd-module-card__spacer");
	ajouter(card, "div", "qbd-module-card__divider");
	const footer = ajouter(card, "div", "qbd-module-card__footer");
	/* LE CHEMIN, COUPÉ AU MILIEU (2026-09-27), comme un nom de fichier : la
	   tête (racine, dossiers intermédiaires) se tronque avec ses points de
	   suspension, la queue (le dossier lui-même) reste entière —
	   `couperCheminAuMilieu`, file-icons.ts. Il remplace le chemin entier qui
	   défilait en boucle depuis le 2026-09-17 : en mouvement, c'était le DÉBUT
	   qui disparaissait, et c'est lui qui situe. La coupe est faite par le CSS
	   (`text-overflow` sur la tête) : un chemin court tient en entier, sans
	   mesure au rendu ni observateur de taille.
	   Il ne réagit toujours à rien (`pointer-events: none`, CSS) : c'est la
	   carte qui reçoit le survol et le clic. */
	const racine = group.path ? currentHost().paths.rootOf(group.path) : null;
	if (group.path && racine) {
		const chemin = ajouter(footer, "div", "qbd-module-card__path");
		/* La pastille du vault, AVANT le chemin et hors de lui : elle dit d'où
		   vient le dossier, elle ne fait pas partie du chemin — la laisser
		   tronquer avec la tête serait perdre l'information. */
		if (racine.vault) {
			const marque = ajouter(chemin, "span", "qbd-module-card__path-vault");
			poserLogoObsidian(marque, t("dashboard.quizzes.obsidianVault"));
		}
		const texte = ajouter(chemin, "span", "qbd-module-card__path-texte");
		const { tete, queue } = couperCheminAuMilieu(`${racine.name}/${currentHost().paths.localPath(group.path)}`);
		ajouter(texte, "span", "qbd-module-card__path-tete", tete);
		if (queue) ajouter(texte, "span", "qbd-module-card__path-queue", queue);
	}
	if (onMenu) {
		const moreBtn = ajouter(footer, "button", "qbd-card-more qbd-module-card__menu");
		moreBtn.type = "button";
		moreBtn.setAttribute("aria-label", t("dashboard.card.more"));
		currentHost().ui.setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			// Ouvrir le menu ne doit PAS aussi entrer dans le module.
			e.stopPropagation();
			onMenu(group, moreBtn);
		});
		// A right click opens this same menu (quiz-card.ts).
		openMenuOnRightClick(card, () => onMenu(group, moreBtn));
	}

	card.addEventListener("click", () => onOpen(group));
	// Keyboard: the card is a button; Enter/Space open it like a click. Only
	// when the card itself has focus, so the menu button keeps its own keys.
	card.tabIndex = 0;
	card.setAttribute("role", "button");
	card.setAttribute("aria-label", group.name || t("dashboard.quizzes.noFolder"));
	card.addEventListener("keydown", (e) => {
		if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
		e.preventDefault();
		onOpen(group);
	});
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
