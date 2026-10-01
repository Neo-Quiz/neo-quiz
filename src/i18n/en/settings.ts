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

	/* ── Settings › Sync (task 6 of the Android v1 plan): the Sync page, shared by the apps ── */
	"settings.sync.title": "Sync",
	"settings.sync.hint": "Keeps your quiz folder identical on all your devices, directly between them, with no account and no server of ours. Add each device on the other one: one side shows its code, the other types it.",
	"settings.sync.thisDevice": "This device",
	"settings.sync.thisDeviceHint": "Give this code to your other devices, or let them scan the picture.",
	"settings.sync.idLabel": "Device code",
	"settings.sync.qrAlt": "QR code of this device's code",
	"settings.sync.copy": "Copy",
	"settings.sync.copied": "Copied",
	"settings.sync.addTitle": "Add a device",
	"settings.sync.addHint": "Type or paste the code shown on the other device.",
	"settings.sync.addPlaceholder": "Device code",
	"settings.sync.add": "Add",
	"settings.sync.scan": "Scan",
	"settings.sync.added": "Device added. Add this device on it as well to start syncing.",
	"settings.sync.invalid": "This is not a valid device code.",
	"settings.sync.unavailable": "Sync could not start on this device.",
	"settings.sync.devices": "Your devices",
	"settings.sync.noDevices": "No device added yet.",
	"settings.sync.connected": "Connected",
	"settings.sync.disconnected": "Not connected",
	"settings.sync.forget": "Forget",
	"settings.sync.forgetLabel": "Forget {name}",
	"settings.sync.folder": "Quiz folder",
	"settings.sync.folderIdle": "Up to date",
	"settings.sync.folderSyncing": "Syncing",
	"settings.sync.folderSyncingPercent": "Syncing, {percent} %",
	"settings.sync.folderError": "Sync error",
	"settings.sync.folderAbsent": "Not set up",
	"settings.sync.inactive": "Sync is not available here.",
	"settings.sync.starting": "Starting sync…",
} as const;
