/* ══════════════════════════════════════════════════════════
   MODULE ICONS — données pures (aucune dépendance à Obsidian).

   Extrait d'icon-picker.ts (tour de correction 1, tâche 6) : ces deux
   constantes ne sont que des DONNÉES (une liste de noms Lucide, un
   fallback), mais icon-picker.ts importe par ailleurs `setIcon` et
   `getIconIds` d'Obsidian pour son propre rendu (le sélecteur). Les fichiers
   qui n'ont besoin QUE du fallback (module-card.ts, quizzes.ts) importaient
   donc transitivement Obsidian pour rien : Vite/Rolldown résout tous les
   imports d'un fichier avant tout tree-shaking, si bien qu'importer une
   simple constante d'un fichier par ailleurs impur suffisait à faire
   échouer le bundle de l'application (cf. task-6-report.md).
══════════════════════════════════════════════════════════ */

import { suggestIcons } from "./icon-suggest";

/** Grille CURÉE affichée par défaut (sans recherche) — un jeu lisible et beau
    pour des matières / modules ; la recherche donne accès à tout le set Lucide. */
/* Rangée PAR THÈME, six par ligne de la grille (élargie le 2026-09-24 : 58
   icônes ne couvraient ni la conception, ni le hacking, ni la veille, ni
   les langues au-delà d'une seule). Chaque icône que propose icon-suggest.ts
   y figure ; `check:module-edit` vérifie que tous les noms existent. */
export const MODULE_ICONS = [
	// Études
	"book", "book-open", "book-text", "book-marked", "notebook", "notebook-text",
	"library", "graduation-cap", "school", "file-text", "scroll-text", "presentation",
	"lightbulb", "brain", "target", "trophy", "star", "folder",
	// Sciences
	"calculator", "sigma", "square-function", "pi", "chart-line", "chart-pie",
	"atom", "flask-conical", "microscope", "dna", "telescope", "orbit",
	// Code et conception
	"code", "code-xml", "braces", "terminal", "square-terminal", "file-code",
	"binary", "git-branch", "package", "blocks", "workflow", "component",
	"layers", "boxes", "container", "puzzle", "bug", "bot",
	// Matériel, systèmes, réseaux
	"cpu", "circuit-board", "memory-stick", "hard-drive", "monitor", "laptop",
	"server", "server-cog", "monitor-cog", "database", "table-2", "wrench",
	"network", "router", "wifi", "share-2", "cloud", "globe",
	// Sécurité
	"shield", "shield-check", "shield-alert", "lock", "key-round", "fingerprint",
	"scan-search", "radar", "siren", "activity", "eye", "skull",
	// Communication, langues, veille
	"languages", "book-a", "message-square", "messages-square", "mic", "newspaper",
	"rss", "users", "handshake", "mail", "megaphone", "map",
	// Travail, droit, économie
	"briefcase", "briefcase-business", "id-card", "list-checks", "kanban", "clipboard-check",
	"file-check", "file-badge", "scale", "gavel", "trending-up", "coins",
	// Création
	"palette", "pen-tool", "layout-dashboard", "layout-panel-top", "layout-template", "copy",
	"music", "film", "camera", "rocket", "sparkles",
];

/** Icône d'un module sans choix explicite (fallback carte + aperçu modal). */
export const DEFAULT_MODULE_ICON = "book";
/** L'icône du SAS des quiz générés (`ctx.generatedFolder`) : la même que le
    bouton « Générer » du rail et la carte « Créer avec l'IA » — c'est le
    même geste vu depuis l'autre bout. */
export const GENERATED_MODULE_ICON = "sparkles";


/** L'icône d'un module : la sienne, sinon celle du SAS, sinon la première
    que suggère son NOM (et son UE) — « Ethical Hacking » a son insecte,
    « Administration système » son serveur (Ahmed, 2026-09-24) —, sinon le
    défaut. Un nom sans mot-clé reconnu garde le livre.
    UNE SEULE RÈGLE pour les trois lecteurs (la carte, le titre d'un dossier
    ouvert, le modal « Modifier dossier ») — symétrique de `moduleAccent`.
    Le modal la recalculait à la main et ignorait le SAS : il montrait un
    livre là où la carte montrait l'étincelle, et son aperçu contredisait
    ce que l'utilisateur avait sous les yeux (Ahmed, 2026-09-17). */
export function moduleIcon(m: { icon?: string; name?: string; ue?: string | null }, opts?: { generated?: boolean }): string {
	if (m.icon) return m.icon;
	if (opts?.generated) return GENERATED_MODULE_ICON;
	return (m.name ? suggestIcons(m.name, m.ue ?? null, 1)[0] : undefined) || DEFAULT_MODULE_ICON;
}