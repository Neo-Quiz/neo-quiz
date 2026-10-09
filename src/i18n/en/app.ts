/* Domaine « app » : ce qui n'existe QUE dans l'application autonome — la
   fenêtre, le choix du dossier, les états vides. Le greffon n'en charge
   aucune clé à l'écran, mais le dictionnaire reste commun : deux
   dictionnaires divergeraient. */
export const EN_APP = {
	"app.window.title": "Neo Quiz",
	/* ── Le premier écran, avant tout choix de dossier ──
	   Un écran vide est une INVITATION, pas un constat : il dit ce qu'il y a
	   à faire, et pourquoi c'est sans risque. Une application qui demande un
	   dossier doit dire ce qu'elle en fera. */
	"app.empty.title": "Choose a quiz folder",
	"app.empty.body": "Neo Quiz plays the quizzes in your notes, right where they already live. Nothing is copied, nothing is moved.",
	"app.empty.yourVaults": "Your notes folders",
	"app.empty.pickFolder": "Choose a folder",
	"app.error.startup": "Neo Quiz could not start: {error}",

	/* ── La page d'un quiz ──
	   NI clé de RETOUR, NI clé « aucun bloc dans cette note » ici :
	   « dashboard.quiz.back » et « dashboard.detail.noBlockInNote » existent déjà
	   et disent exactement la même chose, la page les emprunte. Seule la panne de
	   LECTURE est propre à l'application : sous Obsidian le fichier est déjà
	   ouvert par le coffre, ici il vient du disque et la cause doit être nommée —
	   un message qui avale la cause rend la panne indiagnosticable. */
	"app.quiz.readError": "Could not read {path}: {error}",
	"app.quiz.close": "Close the quiz",

	/* ── La confirmation NATIVE d'un hôte Ollama hors liste ──
	   Affichée par le PROCESSUS PRINCIPAL (`electron/canaux.ts`, garde de la
	   clé `ai`), jamais par la fenêtre : un rendu compromis ne doit pas
	   pouvoir rédiger la question qu'on lui pose. Le principal traduit avec
	   ce même dictionnaire, sur la langue du système (`app.getLocale()`), la
	   source que la fenêtre lit elle aussi par `navigator.language`. */
	/* L'écriture des réglages IA a été REFUSÉE par le processus principal
	   (URL illisible, hôte refusé). La page le dit : un réglage qu'on croit
	   enregistré et qui disparaît au redémarrage est pire qu'un refus. */
	"app.aiSettings.refused": "Could not save the AI settings: {error}",
	"app.syncPair.title": "Pair this device?",
	"app.syncPair.message": "This device will be able to read and change every file of your Neo Quiz folder.",
	"app.syncPair.messageQr": "“{name}” scanned your QR code.",
	"app.syncPair.detail": "Device ID: {id}",
	"app.syncPair.detailName": "Announced name: {name}",
	"app.syncPair.allow": "Pair",
	"app.syncPair.deny": "Cancel",
	"app.syncShare.body": "To sync with my device “{name}” in Neo Quiz, open Settings, then Sync, Add a device and paste this whole message, or open this link on the other device:\n\n{link}",
	"app.aiHost.title": "Allow this Ollama server?",
	"app.aiHost.message": "Neo Quiz will send your requests and the notes you attach to {host}.",
	"app.aiHost.detail": "This server is neither a known host nor on your local network. Allow it only if you set it up yourself.",
	"app.aiHost.allow": "Allow",
	"app.aiHost.deny": "Cancel",
	"app.moodleHost.title": "Allow this Moodle site?",
	"app.moodleHost.message": "Neo Quiz will sign in to {host} and download your course files from it.",
	"app.moodleHost.detail": "Allow it only if it is your school's Moodle. Nothing is ever sent to it except your login and read requests.",
	"app.moodleHost.allow": "Allow",
	"app.moodleHost.deny": "Cancel",

	/* ── Mise à jour automatique (application seulement) ── */
	"app.update.restart": "Restart to update",
	"app.update.downloading": "Downloading update",
	"app.update.size": "{done} MB / {total} MB",
	"app.update.install": "Update",
	"app.update.installing": "Installing…",
	/* Metered connection: the version waits for a click instead of downloading. */
	"app.update.download": "Download",
	"app.update.meteredAvailable": "Update available ({version}) - metered connection",
	/* Android app: the updater (banner and the Settings row). */
	"app.update.android.available": "Update available ({version})",
	"app.update.android.install": "Install",
	"app.update.android.downloading": "Downloading {version}…",
	"app.update.android.ready": "Installing {version}…",
	"app.update.android.allow": "Allow Neo Quiz to install apps in the settings that just opened, then tap Install again.",
	"app.update.android.err.network": "Could not reach the update server.",
	"app.update.android.err.invalid": "The update information is not valid.",
	"app.update.android.err.mismatch": "The download did not match what was announced, so it was discarded.",
	"app.update.android.err.install": "Android did not install the update.",
	"app.update.android.row": "Updates",
	"app.update.android.version": "Version {version}",
	"app.update.android.check": "Check",
	"app.update.android.checking": "Checking…",
	"app.update.android.upToDate": "Up to date",
	/* Outcome of "Check for updates" shown IN the menu button. */
	"app.update.btn.checking": "Checking…",
	"app.update.btn.upToDate": "Up to date",
	"app.update.btn.downloading": "v{version} downloading",
	"app.update.btn.ready": "v{version} ready",
	"app.update.btn.waiting": "v{version} on hold",
	"app.update.btn.failed": "Check failed",
	"app.update.btn.devBuild": "Dev build",
	/* La fenêtre qui reste à l'écran pendant que NSIS travaille, lancée
	   depuis un reflet de l'installation (`electron/fenetre-maj.ts`). */
	"app.update.window.title": "Updating Neo Quiz",
	"app.update.window.failed": "The update did not finish. Close this window and open Neo Quiz again.",
	"app.update.window.close": "Close",

	/* ── Barre de titre et menu d'application (application seulement) ── */
	"app.titlebar.menu": "Application menu",
	"app.titlebar.minimize": "Minimize",
	"app.titlebar.maximize": "Maximize",
	"app.titlebar.restore": "Restore",
	"app.titlebar.close": "Close",
	"app.menu.checkUpdates": "Check for updates…",
	"app.menu.settings": "Settings…",
	"app.menu.view": "Display",
	"app.menu.reload": "Reload",
	"app.menu.fullscreen": "Toggle full screen",
	"app.menu.devtools": "Show developer tools",
	"app.menu.changeWallpaper": "Change wallpaper…",
	"app.zoom.in": "Zoom in",
	"app.zoom.out": "Zoom out",
	"app.zoom.reset": "Reset",

	/* ── Le dossier de quiz par défaut, et les emplacements supplémentaires
	   (tranche 9) — Réglages, application seulement : le greffon n'a rien à
	   choisir, il lit le vault qui le contient. ── */
	"app.settings.defaultFolder": "Quiz folder",
	"app.settings.defaultFolderHint": "Neo Quiz creates its quizzes here. Change it and the previous folder is kept as an additional location — nothing is moved or copied.",
	"app.settings.changeDefaultFolder": "Change",
	"app.settings.extraFolders": "Additional locations",
	/* Les vaults d'Obsidian sont ouverts SANS CLIC au démarrage : le
	   sous-titre le dit, sinon leur présence dans la liste passe pour une
	   chose qu'on aurait faite soi-même et oubliée. Ce qu'une croix implique —
	   le dossier reste sur le disque, et n'est plus rouvert — est passé dans
	   l'INFOBULLE du bouton : deux phrases pour quatre lignes de liste
	   pesaient plus que ce qu'elles expliquaient, et celle-là ne se lit qu'au
	   moment où l'on vise la croix. */
	"app.settings.extraFoldersHint": "Your notes folders open by themselves.",
	"app.settings.extraFoldersHintMobile": "Other folders Neo Quiz reads quizzes from.",
	"app.settings.folderAlreadyOpen": "This folder is already open.",
	"app.settings.folderInsideOpen": "This folder is already inside one of your open folders. Add it from Folders → New folder → Open an existing folder.",
	"app.settings.folderContainsOpen": "This folder contains one of your open folders.",

	/* ── Réglages « Comptes » (application seulement) ──
	   Les quatre CLI de génération, avec de quoi se (dé)connecter. Antigravity
	   ne publie aucun forfait : sa ligne montre l'adresse seule, `plan` y
	   reste `null` et la colonne ne s'affiche pas. */
	"app.settings.accounts": "CLI accounts",
	/* ── Réglages « Canaux payants » (application seulement) ──
	   Une case par canal qui exige un abonnement : décochée, il sort du menu
	   des fournisseurs. Les canaux gratuits n'y figurent jamais — ils n'ont
	   rien à payer, ils restent. */
	"app.settings.paidChannels": "Paid assistants",
	"app.settings.paidChannelsHint": "These assistants need a subscription. Turn one off to remove it from the generation menu; turn it on again to bring it back.",
	"app.settings.paidChannelRow": "Show “{name}” in the generation menu",
	"app.comptes.claude": "Claude Code",
	"app.comptes.codex": "Codex CLI",
	"app.comptes.agy": "Antigravity CLI",
	"app.comptes.ollama": "Ollama",
	"app.comptes.notInstalled": "Not installed",
	"app.comptes.notConnected": "Not signed in",
	"app.comptes.connectedNoEmail": "Signed in",
	// L'espace réservé du squelette, posé avant toute lecture — même ligne
	// pour l'adresse et pour le bouton, remplacée par la vraie valeur dès
	// qu'elle arrive.
	"app.comptes.loading": "…",
	// La lecture des comptes a ÉCHOUÉ (le pont a rejeté) : un état d'erreur
	// lisible plutôt qu'une liste vide qui resterait vide pour toujours.
	"app.comptes.loadError": "Could not read your AI accounts.",
	"app.comptes.install": "Install",
	"app.comptes.connect": "Sign in",
	"app.comptes.disconnect": "Sign out",
	"app.comptes.connectFailed": "Could not sign in to {name}.",
	"app.comptes.logoutTitle": "Sign out of {name}?",
	"app.comptes.logoutMessage": "Neo Quiz will sign this account out of {name}.",
	"app.comptes.logoutDetail": "This signs out the whole machine, including any terminal session where you're already signed in.",
	"app.comptes.logoutConfirm": "Sign out",
	"app.comptes.cancel": "Cancel",
	"app.comptes.logoutFailed": "Could not sign out of {name}.",

	/* ── Popover d'usage au survol d'une ligne Claude ou Codex ──
	   Les seuls deux outils dont le forfait est lisible (`usageCompte`, typé
	   "claude" | "codex"). Quatre messages d'échec, un par `UsageReadError`
	   (`usage-format.ts`) — aucun ne laisse le popover vide. */
	"app.comptes.usageOf": "Usage of {name}",
	"app.comptes.usageOpen": "Open usage on ollama.com",
	"app.comptes.usageOpenFailed": "Could not open ollama.com.",
	// Antigravity : son quota ne se lit que dans son REPL (`/usage`), le clic
	// ouvre un terminal interactif. L'invite y est traduite PAR LE PRINCIPAL
	// (`canaux.ts`) — cette clé n'est lue que pour l'info-bulle du bouton.
	"app.comptes.usageTerminal": "Open Antigravity CLI to check your quota (/usage)",
	"app.comptes.usageTerminalHint": "Opening your quota… if it does not appear, type /usage. Quit Antigravity when you're done.",
	"app.comptes.usageTerminalFailed": "Could not open the Antigravity CLI.",
	"app.comptes.usageTerminalOpened": "Antigravity CLI is opening in a terminal, and your quota appears there in a few seconds. On its very first launch it asks you to set it up first.",
	// Antigravity n'attend que 60 secondes, EN INTERNE, sans rien dire : le
	// script de connexion affiche ces deux textes, traduits par le principal
	// (`canaux.ts`) — jamais un texte venu du rendu dans un script.
	"app.comptes.agyCountdown": "You have 60 seconds after the browser opens to paste the code here. If it expires, press Enter to get a new link.",
	"app.comptes.agyExpired": "The link expired. Press Enter for a new one, or close this window.",
	"app.comptes.usage.resetsAt": "Resets {moment}",
	"app.comptes.usage.errorRateLimited": "The provider is rate-limiting usage reads right now.",
	"app.comptes.usage.errorRateLimitedDelay": "The provider is rate-limiting usage reads. Try again in {delai}.",
	"app.comptes.usage.errorUnauthenticated": "This account isn't readable — sign in again.",
	"app.comptes.usage.errorUnavailable": "Couldn't reach the usage endpoint.",
	"app.comptes.usage.errorNeverRun": "Codex hasn't run on this machine yet.",
	// Codex n'a pas d'état courant : sa lecture vient du dernier fichier de
	// session écrit sur disque, une photo prise au dernier lancement du CLI.
	"app.comptes.usage.codexSnapshot": "Snapshot taken {age}.",
	// `mesureAt` absent (mtime illisible) : dire D'OÙ viennent les chiffres,
	// sans prétendre QUAND — une date fausse serait pire qu'une date absente.
	"app.comptes.usage.codexSnapshotSansDate": "From the last time Codex ran — the exact time isn't available.",

	/* ── Réglages « Général » (application seulement) ── */
	"app.settings.general": "General",
	"app.settings.explainPromptReset": "Reset",
	"app.settings.explainTitle": "Explain",
	"app.settings.explainHint": "In the Explain window you write your own question. Behind the scenes, every message carries the whole quiz (the question you opened it from marked, with your answer), the text of the notes and PDFs of its folder and its pictures.",
	"app.settings.examPrompt": "/exam prompt",
	"app.settings.examPromptHint": "The request /exam writes for you once an exam is picked. {exam}, {module} and {date} are replaced by the exam's own; what you type in the composer is added under it.",
	"app.settings.silence": "Silent mode",
	"app.settings.silenceHint": "No sound and no notification when a quiz or an explanation is ready.",
	"app.settings.explainMaxChars": "Longest explanation",
	"app.settings.explainMaxCharsHint": "In characters. The AI provider is asked to stay under it.",
	"app.settings.navFolders": "Folders",
	"app.settings.navAi": "AI",
	"app.settings.navAppearance": "Appearance",
	"app.settings.nav": "Settings sections",
	"app.settings.back": "Back to settings",
	"app.settings.languageAuto": "Automatic (follow the system)",
	"app.settings.timeFormat": "Time format",
	"app.settings.timeFormat24": "24-hour ({example})",
	"app.settings.timeFormat12": "12-hour ({example})",

	/* ── Fond d'écran (application seulement) ── */
	/* Les mises à jour : le titre remplace « About », retiré le 2026-09-17 — le
	   menu d'application sert déjà la version et « Check for updates… », et une
	   section qui ne fait que les répéter donne deux endroits à tenir à jour.
	   Ne reste ici que ce que le menu n'a pas : le RÉGLAGE. */
	"app.settings.updates": "Updates",

	"app.settings.wallpaper": "Wallpaper",
	/* Le crédit d'une photo embarquée : la licence d'Unsplash demande de citer
	   l'auteur là où c'est raisonnable, et la ligne sous le nom de la photo est
	   l'endroit où il est lu. Le NOM de l'auteur ne se traduit jamais. */
	"app.fond.credit": "Photo by {auteur} — Unsplash",
	"app.fond.yours": "From your folder",
	"app.fond.name.cloudlaced-ranges": "Ridges and clouds",
	"app.fond.name.panorama-valley": "Panoramic valley",
	"app.fond.name.golden-snow-range": "Golden range",
	"app.fond.name.cloudveil-fjord": "Fjord under the clouds",
	"app.fond.name.golden-summit": "Golden summit",
	"app.fond.name.violet-forest-bloom": "Flowering undergrowth",
	"app.fond.name.white-forest-flowers": "Wood anemones",
	"app.fond.name.fog-treeline": "Treetops in the fog",
	"app.fond.name.pines-in-mist": "Pines in the mist",
	"app.fond.name.sunrays-forest": "Rays through the beeches",
	"app.fond.name.whale-tail-cliffs": "Whale below the cliffs",
	"app.fond.name.island-sunset": "Island at sunset",
	"app.fond.name.tropical-palm-coast": "Tropical coast",
	"app.fond.name.coastal-hills-dusk": "Hills at dusk",
	"app.fond.name.turquoise-shallows": "Turquoise shallows",
	"app.fond.name.gapstow-autumn": "Gapstow Bridge",
	"app.fond.name.autumn-forest-path": "Autumn path",
	"app.fond.name.golden-hour-ridge": "Ridges at golden hour",
	"app.fond.name.golden-larches": "Golden larches",
	"app.fond.name.aspen-valley": "Aspen valley",
	"app.fond.name.milky-way-trail": "Trail under the Milky Way",
	"app.fond.name.starlit-snow-peak": "Peak under the stars",
	"app.fond.name.monument-valley-stars": "Starry Monument Valley",
	"app.fond.name.aurora-over-water": "Aurora over the water",
	"app.fond.name.half-dome-stars": "Half Dome under the stars",
	"app.fond.name.sunlit-canyon": "Sunlit canyon",
	"app.fond.name.amber-dunes": "Amber dunes",
	"app.fond.name.ochre-desert": "Ochre desert",
	"app.fond.name.dune-sunrise": "Sunrise over the dunes",
	"app.fond.name.canyon-dusk": "Canyon at dusk",
	"app.fond.name.golden-gate-night": "Golden Gate at night",
	"app.fond.name.city-from-above": "City from above",
	"app.fond.name.night-grid": "Night grid",
	"app.fond.name.brooklyn-bridge-night": "Brooklyn Bridge at night",
	"app.fond.name.harbour-lights": "Harbour lights",
	"app.fond.cat.mountains": "Mountains",
	"app.fond.cat.forest": "Forest",
	"app.fond.cat.ocean": "Ocean",
	"app.fond.cat.autumn": "Autumn",
	"app.fond.cat.night": "Night",
	"app.fond.cat.desert": "Desert",
	"app.fond.cat.city": "City",
	"app.fond.none": "Pick one below, or open a folder of your own.",
	"app.fond.noneShort": "None",
	"app.fond.choose": "Choose a folder",
	"app.fond.change": "Change",
	"app.fond.remove": "Remove",
	"app.fond.disparue": "The wallpaper image is gone; the first image of the folder is used.",
	"app.fond.dossierVide": "No image in that folder; the built-in wallpaper is used.",
	"app.fond.luminosite": "Wallpaper brightness",
	"app.fond.flou": "Wallpaper blur",
	"app.fond.pourcent": "{n}%",
	"app.fond.pixels": "{n} px",
	"app.fond.effetsNonEcrits": "The wallpaper brightness and blur could not be saved.",

	/* ── Installer un CLI depuis l'app : la confirmation NATIVE du principal ── */
	"app.connectCli.done": "{name} is connected. Back to Neo Quiz…",
	"app.connectCli.failed": "Signing in to {name} failed. Close this window and try again from Neo Quiz.",

	/* ── The daily review notification (Android): strings handed to the app's native side with the table of due counts ── */
	"app.notification.reviewTitle": "Time to review",
	"app.notification.reviewBodyOne": "{count} question to review today",
	"app.notification.reviewBodyOther": "{count} questions to review today",
} as const;
