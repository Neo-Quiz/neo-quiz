/* Réglages du plugin (SettingTab) — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/settings.ts, sinon le
   typecheck échoue (Record<TransKey, string>). */
export const EN_SETTINGS = {
	"settings.language.name": "Language",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.codeHighlighting.name": "Code block highlighting",
	"settings.codeHighlighting.desc": "Syntax-highlight quiz-blocks code blocks in Source mode.",

	/* ── À propos (application seulement) ── */
	"settings.about.repo": "Source code and releases on GitHub",

	/* ── Settings › Languages (app only): the downloadable language packs ── */
	"settings.languages.title": "Languages",
	"settings.languages.hint": "Python runs out of the box. The C and C++ compiler is downloaded the first time you run C or C++ code; it runs isolated from your files and the network.",
	"settings.languages.c": "C and C++ (Clang)",
	"settings.languages.installed": "Installed · version {version} · {size} MB",
	"settings.languages.notInstalled": "Not installed",
	"settings.languages.downloading": "Downloading… {percent} %",
	"settings.languages.download": "Download",
	"settings.languages.delete": "Delete",
	"settings.languages.offline": "The C/C++ compiler could not be downloaded (no connection).",
	"settings.languages.refused": "The downloaded compiler failed its integrity check and was not installed.",
} as const;
