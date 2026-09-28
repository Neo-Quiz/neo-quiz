import type { EN_SETTINGS } from "../en/settings";

/* Réglages du plugin — français. Le type force l'exhaustivité : une clé
   ajoutée à l'anglais et oubliée ici casse `npm run check`. */
export const FR_SETTINGS: Record<keyof typeof EN_SETTINGS, string> = {
	"settings.language.name": "Langue",
	"settings.language.desc": "Langue de l'interface. « Automatique » suit la langue d'Obsidian. Sans effet sur la langue des quiz générés, qui suit toujours celle de votre demande.",
	"settings.language.auto": "Automatique (suivre Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.codeHighlighting.name": "Coloration des blocs de code",
	"settings.codeHighlighting.desc": "Colore la syntaxe des blocs de code quiz-blocks en mode Source.",

	/* ── À propos (application seulement) ── */
	"settings.about.repo": "Code source et versions sur GitHub",

	"settings.languages.title": "Langages",
	"settings.languages.hint": "Python fonctionne tel quel. Le compilateur C et C++ se télécharge la première fois que vous exécutez du code C ou C++ ; il tourne isolé de vos fichiers et du réseau.",
	"settings.languages.c": "C et C++ (Clang)",
	"settings.languages.installed": "Installé · version {version} · {size} Mo",
	"settings.languages.notInstalled": "Non installé",
	"settings.languages.downloading": "Téléchargement… {percent} %",
	"settings.languages.download": "Télécharger",
	"settings.languages.delete": "Supprimer",
	"settings.languages.offline": "Le compilateur C/C++ n'a pas pu être téléchargé (pas de connexion).",
	"settings.languages.refused": "Le compilateur téléchargé n'a pas passé la vérification d'intégrité : il n'a pas été installé.",
};
