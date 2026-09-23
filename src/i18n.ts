import { EN } from "./i18n/en";
import { FR } from "./i18n/fr";
import { hostOrNull } from "./host/current";

/* ══════════════════════════════════════════════════════════
   I18N — langue de l'interface
   Anglais par défaut (plugin destiné à la liste communautaire),
   français complet, et mode « auto » calé sur la langue d'Obsidian.
   La langue des QUIZ GÉNÉRÉS ne passe PAS par ici : le modèle répond
   dans la langue du sujet fourni (cf. le prompt système d'ai-client).
══════════════════════════════════════════════════════════ */

/** Langues réellement traduites. */
export type Lang = "en" | "fr";
/** Valeur du réglage : « auto » suit Obsidian. */
export type LangSetting = "auto" | Lang;

/** Clés de traduction : le dictionnaire anglais fait référence — une clé
    absente de FR est une erreur de compilation, jamais une chaîne manquante
    à l'écran. */
export type TransKey = keyof typeof EN;

const DICTS: Record<Lang, Record<TransKey, string>> = { en: EN, fr: FR };

/* Langue effective, recalculée par setLanguage (chargement + changement du
   réglage). Jamais lue au chargement des modules : un libellé doit être
   traduit AU RENDU, sinon changer de langue n'aurait d'effet qu'au prochain
   redémarrage. */
let current: Lang = "en";
let setting: LangSetting = "auto";

/* ── Langue de l'HÔTE ──
   Sous Obsidian, `window.i18next.language` donne la langue CHOISIE DANS
   OBSIDIAN (« fr »), pas celle de l'OS ni du navigateur — c'est la seule
   source correcte pour le mode auto. Ce n'est pas une API publique (absente
   d'obsidian.d.ts), et c'est pourquoi elle est lue par l'HÔTE, qui assume ce
   genre de chose, et exposée ici comme une simple étiquette BCP-47.

   `hostOrNull` et non `currentHost` : ce module peut être sollicité avant
   l'installation de l'hôte (chargement des modules). Les replis —
   `navigator.language` puis `<html lang>` puis l'anglais — couvrent ce cas
   ET la fenêtre de l'app avant son premier rendu. */
function detectHostLang(): Lang {
	try {
		const depuisHote = hostOrNull()?.platform.uiLanguage;
		const lang = depuisHote || navigator.language || document.documentElement.lang || "";
		// « fr », « fr-FR », « fr_FR » → fr ; tout le reste → en (seules deux
		// langues sont traduites, inutile de deviner au-delà).
		return /^fr\b/i.test(lang.replace(/_/g, "-")) ? "fr" : "en";
	} catch (e) {
		return "en";
	}
}

/** Applique le réglage de langue. À appeler au chargement du plugin et à
    chaque changement du réglage (les vues sont redessinées par l'appelant). */
export function setLanguage(value?: LangSetting): void {
	setting = value === "en" || value === "fr" ? value : "auto";
	current = setting === "auto" ? detectHostLang() : setting;
}

/** Langue affichée en ce moment (« en » / « fr ») — jamais « auto ». */
export function currentLang(): Lang {
	return current;
}

/** Valeur brute du réglage (pour le SettingTab). */
export function langSetting(): LangSetting {
	return setting;
}

/* ── Format de l'heure ──
   24 h PAR DÉFAUT, quelle que soit la langue : l'anglais de l'interface
   affichait « 06:35 PM », qui « ne correspond pas » à Ahmed (2026-09-23).
   12 h reste un choix du réglage. Indépendant de la langue : on peut lire
   l'interface en anglais et vouloir 18:35. */
export type HourCycle = "24h" | "12h";
let hourCycle: HourCycle = "24h";

/** Applique le réglage ; toute autre valeur que « 12h » vaut 24 h. */
export function setHourCycle(value?: string): void {
	hourCycle = value === "12h" ? "12h" : "24h";
}

export function currentHourCycle(): HourCycle {
	return hourCycle;
}

/** Les options d'`Intl.DateTimeFormat` pour l'HEURE d'une date, à ajouter à
    toute mise en forme qui en montre une : 24 h sur deux chiffres (09:05,
    18:35, 00:05 après minuit — `hourCycle: "h23"`), 12 h sans zéro devant
    (9:05 AM, 6:35 PM). */
export function hourOptions(cycle: HourCycle = hourCycle): Intl.DateTimeFormatOptions {
	return cycle === "12h"
		? { hour: "numeric", hourCycle: "h12" }
		: { hour: "2-digit", hourCycle: "h23" };
}

/** Traduit une clé. `vars` remplace les jetons {nom} du libellé :
    t("ai.status.claudeOk", { version: "2.1.251" }). */
export function t(key: TransKey, vars?: Record<string, string | number>): string {
	const dict = DICTS[current] || EN;
	// Repli sur l'anglais si une clé manque à l'exécution (dictionnaire chargé
	// d'une version antérieure) — mieux qu'une clé nue affichée à l'écran.
	const raw = dict[key] ?? EN[key] ?? String(key);
	if (!vars) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
		name in vars ? String(vars[name]) : m);
}
