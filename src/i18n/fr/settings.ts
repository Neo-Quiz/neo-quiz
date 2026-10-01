import type { EN_SETTINGS } from "../en/settings";

/* Réglages du plugin — français. Le type force l'exhaustivité : une clé
   ajoutée à l'anglais et oubliée ici casse `npm run check`. */
export const FR_SETTINGS: Record<keyof typeof EN_SETTINGS, string> = {
	"settings.language.name": "Langue",
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

	/* ── Réglages › Synchronisation (tâche 6 du plan Android v1) : la page, commune aux applications ── */
	"settings.sync.title": "Synchronisation",
	"settings.sync.hint": "Garde ton dossier de quiz identique sur tous tes appareils, directement de l'un à l'autre, sans compte ni serveur chez nous. Ajoute chaque appareil sur l'autre : un côté affiche son code, l'autre le saisit.",
	"settings.sync.thisDevice": "Cet appareil",
	"settings.sync.thisDeviceHint": "Donne ce code à tes autres appareils, ou laisse-les scanner l'image.",
	"settings.sync.idLabel": "Code de l'appareil",
	"settings.sync.qrAlt": "QR code du code de cet appareil",
	"settings.sync.copy": "Copier",
	"settings.sync.copied": "Copié",
	"settings.sync.addTitle": "Ajouter un appareil",
	"settings.sync.addHint": "Saisis ou colle le code affiché sur l'autre appareil.",
	"settings.sync.addPlaceholder": "Code de l'appareil",
	"settings.sync.add": "Ajouter",
	"settings.sync.scan": "Scanner",
	"settings.sync.added": "Appareil ajouté. Ajoute celui-ci sur l'autre pour lancer la synchronisation.",
	"settings.sync.invalid": "Ce n'est pas un code d'appareil valide.",
	"settings.sync.unavailable": "La synchronisation n'a pas pu démarrer sur cet appareil.",
	"settings.sync.devices": "Tes appareils",
	"settings.sync.noDevices": "Aucun appareil ajouté pour l'instant.",
	"settings.sync.connected": "Connecté",
	"settings.sync.disconnected": "Non connecté",
	"settings.sync.forget": "Oublier",
	"settings.sync.forgetLabel": "Oublier {name}",
	"settings.sync.folder": "Dossier de quiz",
	"settings.sync.folderIdle": "À jour",
	"settings.sync.folderSyncing": "Synchronisation en cours",
	"settings.sync.folderSyncingPercent": "Synchronisation, {percent} %",
	"settings.sync.folderError": "Erreur de synchronisation",
	"settings.sync.folderAbsent": "Non configuré",
	"settings.sync.inactive": "La synchronisation n'est pas disponible ici.",
	"settings.sync.starting": "Démarrage de la synchronisation…",
};
