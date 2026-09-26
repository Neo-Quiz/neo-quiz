/* Domaine « ai » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/ai.ts (le typage de
   FR_AI l'impose). Clés préfixées « ai. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_AI = {
	/* ── Page « Générer » ── */
	"ai.page.title": "Generate a quiz",

	/* ── Composer ── */
	"ai.composer.placeholder": "What should the quiz be about?",
	"ai.composer.addContent": "Add content",
	/* ── L'aperçu d'une pièce jointe (clic sur sa carte) ── */
	"ai.preview.size": "{kb} KB",
	"ai.preview.linesOne": "{n} line",
	"ai.preview.linesOther": "{n} lines",
	"ai.preview.pagesOne": "{n} page",
	"ai.preview.pagesOther": "{n} pages",
	"ai.preview.pageAlt": "Page {n}",
	"ai.preview.rendering": "Rendering pages…",
	"ai.preview.renderFailed": "This PDF could not be drawn",
	"ai.preview.open": "Open",
	"ai.preview.openFailed": "Could not open {name}",
	"ai.preview.props": "Properties",
	"ai.composer.quizOptions": "Quiz options",
	"ai.composer.generate": "Generate quiz",
	"ai.composer.stop": "Stop",
	"ai.composer.open": "Open",
	"ai.add.filesTip": "Add files or images ({hotkey})",
	/* Picker « @ » : aucune entrée pour le token tapé. */
	"ai.mention.noMatch": "No matching file",
	/* Pied du menu : une garde anti-explosion a coupé l'indexation d'une ou
	   plusieurs racines externes — on ne tronque jamais en silence. */
	"ai.mention.truncated": "Too many files in {roots} — search may be incomplete",
	/* resolveExternalPath a renvoyé null (racine retirée des réglages pendant
	   que le menu était ouvert) : le token a déjà été effacé, rien n'est
	   attaché — jamais un échec silencieux. */
	"ai.mention.externalRootGone": "Couldn't attach “{name}”: its external folder was removed from settings",

	/* ── Usage IA (ce qu'une génération a coûté) ──
	   RÉDUIT à la tâche 2 du chantier « greffon lecteur » (2026-09-13) :
	   l'ÉCRAN « Limites d'utilisation » (`dashboard/ai-usage.ts`,
	   `usage-modal.ts`) est parti à la tâche 1 avec le reste du tableau de
	   bord — ce n'était plus « l'écran d'usage reste au greffon », il n'y a
	   plus de greffon-dashboard du tout. Ne restent que les clés que
	   `dashboard/usage-format.ts` compose encore pour le badge et l'infobulle
	   de la page « Générer » elle-même, consommées par l'APPLICATION. */
	"ai.usage.badge": "{tokens} tokens",
	"ai.usage.title": "Usage",
	"ai.usage.sessionCurrent": "Current session",
	"ai.usage.allModels": "All models",
	// Sans espace avant le %, contrairement au français : c'est la typographie
	// de chaque langue, pas une incohérence.
	"ai.usage.usedPercent": "{n}% used",
	"ai.usage.durationHoursMinutes": "{h} h {m} min",
	"ai.usage.durationMinutes": "{m} min",
	"ai.usage.durationDays": "{n} d",
	"ai.usage.justNow": "just now",
	"ai.usage.minutesAgo": "{n} min ago",
	"ai.usage.hoursAgo": "{n} h ago",
	"ai.usage.windowHours": "{n} h",
	"ai.usage.windowDays": "{n} d",
	"ai.usage.windowPlan": "Plan",

	/* ── Options de génération ── */
	/* Libellés des types de questions. La VALEUR envoyée au modèle reste
	   canonique (cf. TYPE_VALUES dans dashboard/ai.ts) : ces libellés ne
	   servent qu'à l'affichage. */
	"ai.type.mixed": "Auto",
	"ai.type.single": "Single choice",
	"ai.type.multiple": "Multiple choice",
	"ai.type.text": "Free text",
	"ai.type.comprehension": "Comprehension",

	/* ── Objectif Learn / Practice (composer) ── */
	"ai.mode.learn": "Learn",
	"ai.mode.practice": "Practice",
	"ai.mode.learnTip": "Learn a course step by step: a question before each passage, instant feedback, until it sticks.",
	"ai.mode.practiceTip": "Train on exercises to prepare for your exam, with every mistake explained.",
	"ai.mode.group": "Goal",
	"ai.options.auto": "Auto",
	"ai.options.autoHint": "Chosen by the AI",

	/* ── Fournisseurs (sous-titres du menu) ── */
	"ai.provider.choose": "Select a provider",
	"ai.provider.claudeSub": "Pro / Max account",
	"ai.provider.codexSub": "Codex CLI · ChatGPT subscription",
	"ai.provider.antigravitySub": "Antigravity CLI · Google account",
	"ai.model.cliDefault": "CLI default model",
	"ai.model.cliListUnavailable": "The model list could not be read: is Antigravity CLI installed and signed in?",
	"ai.provider.ollamaSub": "Local and cloud",

	/* ── Canaux (le second niveau du menu : par quelle voie on parle à la marque) ── */
	"ai.channel.cliSub": "On your machine",
	"ai.channel.webSub": "In your browser",
	"ai.channel.notWiredYet": "Design preview: {site} is not wired up yet.",
	"ai.channel.noImages": "Images can't be sent to a website. Remove them, or pick a CLI channel.",
	"ai.channel.copyFailed": "The prompt could not be copied to the clipboard.",
	"ai.channel.openFailed": "The browser could not be opened.",
	"ai.web.title": "**Send the prompt** on {site}",
	"ai.web.thenCopy": "Then **copy the code block** in one click: Neo Quiz picks it up by itself.",
	"ai.web.received": "Answer received",
	"ai.web.creating": "Creating the quiz…",
	"ai.web.creatingNamed": "Creating “{name}”…",
	"ai.web.manual": "Paste the answer here with Ctrl+V.",
	"ai.web.callout": "{site} will display a warning because your question was submitted via a link. This link comes from Neo Quiz, so you can send your question as usual.",
	"ai.web.stepsTitle": "On {site}",
	"ai.web.step.paste": "**Paste the prompt** (Ctrl+V): it is already in your clipboard.",
	"ai.web.step.drop": "**Drag the file below onto the page** and send.",
	"ai.web.step.dropMany": "**Drag the files below onto the page, all at once**, and send.",
	"ai.web.step.copy": "**Copy the code block** in one click: Neo Quiz picks it up by itself.",
	"ai.web.dragOne": "Drag",
	"ai.web.dragAll": "Drag all",
	"ai.web.dropFailed": "The files could not be dragged; attach them on the site yourself.",
	"ai.web.reopen": "Reopen {site}",
	"ai.web.cancel": "Cancel",
	"ai.web.cancelTitle": "Stop waiting for {site}?",
	"ai.web.cancelMessage": "Neo Quiz will stop listening for the answer. What you sent on {site} stays there.",
	"ai.web.cancelConfirm": "Stop",
	"ai.web.cancelKeep": "Keep waiting",
	"ai.web.warnTitle": "Before opening {site}",
	"ai.web.warnDismiss": "Don't show this again",
	"ai.web.warnOk": "Got it",

	/* ── Statuts (pastille + sous-titre du menu fournisseur) ── */
	"ai.status.claudeOk": "Claude Code v{version}",
	"ai.status.claudeMissing": "Claude Code not installed",
	"ai.status.codexOk": "Codex CLI v{version}",
	"ai.status.codexMissing": "Codex CLI not installed",
	"ai.status.antigravityOk": "Antigravity CLI v{version}",
	"ai.status.antigravityMissing": "Antigravity CLI not installed",
	// Affiché que le compte soit connecté ou non : le CLI et sa version, comme
	// pour Claude/Codex/Ollama. C'est la PASTILLE (verte/orange) qui porte
	// l'état — inutile de le répéter en toutes lettres (demande Ahmed).
	"ai.status.ollamaOk": "Ollama v{version}",
	"ai.status.ollamaLocalOne": "{count} local + cloud",
	"ai.status.ollamaLocalMany": "{count} local + cloud",
	"ai.status.ollamaCloudReady": "Cloud ready",
	"ai.status.serverStopped": "Server stopped",
	"ai.status.notInstalled": "Not installed",
	"ai.status.desktopOnly": "Desktop only",

	/* ── Hints contextuels sous le composer ── */
	"ai.hint.claudeDesktopOnly": "Generating with Claude is available on desktop only.",
	"ai.hint.claudeNotInstalled": "Claude Code is not installed.",
	"ai.hint.installClaude": "Install Claude Code",
	"ai.hint.codexDesktopOnly": "Generating with ChatGPT (Codex CLI) is available on desktop only.",
	"ai.hint.antigravityDesktopOnly": "Generating with Gemini (Antigravity CLI) is available on desktop only.",
	"ai.hint.codexNotInstalled": "Codex CLI is not installed.",
	"ai.hint.installCodex": "Install Codex CLI",
	"ai.hint.antigravityNotInstalled": "Antigravity CLI is not installed.",
	"ai.hint.installAntigravity": "Install Antigravity CLI",
	// Ni « installed », ni la version, ni ce qui se passera ensuite : le statut du
	// fournisseur donne déjà la version, et les modèles qui apparaissent se voient
	// (demande Ahmed). Ce message ne dit QUE ce qui manque et comment y remédier.
	"ai.hint.ollamaServerOff": "Ollama is installed but its server is not running.",
	"ai.hint.startOllama": "Start Ollama",
	"ai.hint.ollamaNotInstalled": "Ollama is not installed.",
	"ai.hint.installOllama": "Install Ollama",

	/* ── Le modal d'un fournisseur absent (spec « utilisable par n'importe qui », § 3b) ── */
	"ai.install.title.claude-code": "Claude Code is not installed",
	"ai.install.title.codex": "Codex CLI is not installed",
	"ai.install.title.ollama": "Ollama is not installed",
	"ai.install.title.antigravity-cli": "Antigravity CLI is not installed",
	"ai.install.what.claude-code": "Anthropic's command-line tool. Neo Quiz generates quizzes with your Claude account.",
	"ai.install.what.codex": "OpenAI's command-line tool, used with a ChatGPT subscription. Not the Codex desktop app.",
	"ai.install.what.ollama": "Free models on your own computer, no account needed.",
	"ai.install.what.antigravity-cli": "Google's command-line tool for Gemini, used with your Google account. It replaced Gemini CLI for personal accounts.",
	/* « Install » seul : c'est « Install manually », juste au-dessus, qui a
	   besoin de se qualifier ; le bouton principal fait l'installation, un
	   point c'est tout (Ahmed, 2026-09-20). */
	"ai.install.auto": "Install",
		"ai.install.manual": "Install manually",
	"ai.install.step1": "Open PowerShell: Windows + X, then I.",
	"ai.install.step1Unix": "Open a terminal.",
	"ai.install.step2": "Copy this command, paste it (right click) and press Enter:",
	"ai.install.step3.claude-code": "Then type claude and sign in with your Claude account.",
	"ai.install.step3.codex": "Then type codex login and sign in with your ChatGPT account.",
	"ai.install.step3.ollama": "Ollama starts by itself.",
	"ai.install.step3.antigravity-cli": "Then type agy and sign in with your Google account in the browser that opens.",
	"ai.install.step4": "Come back to Neo Quiz: it detects the installation.",
	"ai.install.learnMore": "Learn more",
	"ai.install.copy": "Copy",
	"ai.install.copied": "Copied",
	"ai.install.running": "Installing in PowerShell… Neo Quiz will detect it.",
	"ai.install.detected": "{name} v{version} is installed.",
	"ai.install.detectedNoVersion": "{name} is installed.",
	"ai.install.terminalFailed": "PowerShell could not be opened. Follow the manual steps below.",

	/* ── Connexion du compte, depuis l'écran d'échec de génération ── */
	"ai.login.button": "Sign in",
	"ai.login.reason.codex": "Your ChatGPT account is not connected yet.",
	"ai.login.reason.claude": "Your Claude account is not connected yet.",
	"ai.login.reason.agy": "Your Google account is not connected to Antigravity CLI yet.",
	"ai.login.reason.ollama": "Ollama is not connected to your account yet; cloud models need it.",
	"ai.login.waiting": "Waiting for sign-in",
	"ai.login.hint": "Finish signing in in the terminal window that just opened. Neo Quiz detects it by itself.",
	"ai.login.hintBrowser": "Finish signing in in the browser tab that just opened. Neo Quiz detects it by itself.",
	"ai.login.detected": "Account connected. Sending your request again…",
	"ai.login.connected": "Account connected.",
	"ai.login.terminalFailed": "PowerShell could not be opened. Sign in from a terminal, then try again.",
	"ai.upgrade.button": "Upgrade",

	/* ── Modèles : accroche courte (à droite du nom) et description ── */
	"ai.modelHint.mostPowerful": "most powerful",
	"ai.modelHint.recommended": "recommended",
	"ai.modelHint.everyday": "efficient day to day",
	"ai.modelHint.fastest": "fastest",
	"ai.modelHint.fast": "fast",
	"ai.modelHint.frontier": "frontier",
	"ai.modelHint.solid": "solid",
	"ai.modelHint.light": "light",
	"ai.modelDesc.fable": "For your toughest challenges",
	"ai.modelDesc.opus": "For complex tasks",
	"ai.modelDesc.sonnet": "Most efficient for everyday tasks",
	"ai.modelDesc.haiku": "Fastest for quick answers",
	"ai.modelDesc.codexSol": "Latest frontier model for agentic coding",
	"ai.modelDesc.codexTerra": "Balanced for everyday work",
	"ai.modelDesc.codexLuna": "Fast and affordable",
	"ai.modelDesc.codex55": "For complex coding and research",
	"ai.modelDesc.codex54": "Solid for everyday coding",
	"ai.modelDesc.codex54mini": "Light and fast for simple tasks",

	/* ── Badge d'accès à Fable (déduit du forfait lu dans le trousseau du CLI) ── */
	"ai.badge.included": "Included",
	"ai.badge.usageCredits": "Requires usage credits",
	"ai.badge.usageCreditsTip": "{model} runs on usage credits, billed separately from your plan.",
	/* Modèle Ollama cloud hors du plan gratuit (recommandations du démon ou
	   402 déjà essuyé) : badge dans la liste ET sur le trigger du menu. */
	"ai.badge.pro": "Pro",
	/* ── Pastille d'un canal GRATUIT dans le sous-menu des fournisseurs ──
	   UNE seule pastille existe (décision du 2026-09-22) : elle dit « gratuit »,
	   jamais « payant ». Un canal payant n'en porte aucune — son statut se lit
	   par l'ABSENCE de cette pastille, jamais par une seconde qui la
	   contredirait. Pas de montant, pas de quota : cf. `Canal.gratuit` dans
	   ai-providers.ts pour ce qui rendrait cette chaîne fausse. */
	"ai.badge.free": "Free",

	/* ── Niveaux d'effort : seuls les sous-titres sont traduits (low, medium,
	   high… sont le vocabulaire des CLI, identique dans toutes les langues). ── */
	"ai.effort.ultracodeSub": "xhigh + workflows",
	"ai.effort.ultraSub": "max + auto delegation",

	/* ── Scène : chargement, erreur, résultat ── */
	"ai.loading.title": "Creating your quiz…",
	/* Un quiz par fichier joint, sur un site : le suivant s'ouvre. */
	"ai.batch.webNext": "“{file}” is saved. Next file: {next}.",
	/* La file de génération (spec 2026-09-26) : une ligne par envoi, sous le
	   composer. « Creating your quiz… » (ai.loading.title) dit la ligne en
	   cours, « Try again » (ai.error.retry) et « Stop » (ai.composer.stop)
	   sont repris tels quels. */
	"ai.queue.label": "Generation queue",
	"ai.queue.waiting": "Waiting",
	"ai.queue.open": "Open",
	"ai.queue.cancel": "Remove from the queue",
	"ai.queue.close": "Close",
	"ai.queue.readyNotice": "“{title}” is ready. Open it from Generate.",
	"ai.queue.missing": "This quiz can no longer be found. It may have been moved or deleted.",
	/* Le modèle a répondu mais la note n'a pas pu être écrite : le quiz est
	   gardé, on réécrit sans relancer la génération, ou on l'ouvre tel quel. */
	"ai.queue.saving": "Saving…",
	"ai.queue.retrySave": "Try saving again",
	"ai.queue.openUnsaved": "Open without saving",
	"ai.queue.busy": "Finish or cancel the request in progress first.",
	"ai.error.title": "Generation failed",
	"ai.error.retry": "Try again",
	"ai.error.checkSettings": "Check your AI settings in the plugin settings.",
	/* L'hôte ne sait pas lancer de CLI (rejet `indisponible` de
	   `host.process.run`). Ce n'est ni une panne ni une absence d'installation :
	   le dire autrement enverrait l'utilisateur réinstaller un CLI qu'il a déjà. */
	/* L'application n'embarque pas de moteur PDF (`HostPdf`, membre optionnel
	   du contrat, absent côté app) : le PDF est refusé, jamais joint vide. */
	"ai.error.pdfUnsupportedInApp": "PDF attachments are not supported in the Neo Quiz app yet. Attach the text or an image instead.",
	"ai.error.providerUnavailable": "This provider is not available here yet. Pick Ollama, or generate the quiz from the Obsidian plugin.",
	"ai.result.count": "{count} questions generated",
	"ai.result.untitled": "Generated quiz",
	"ai.result.save": "Save",
	"ai.result.insert": "Insert into a note",

	/* ── Notices ── */
	"ai.notice.pdfNoText": "“{name}”: no extractable text (scanned PDF?)",
	"ai.notice.unsupportedFormat": "Unsupported format: {files} (images, PDF, .md, .txt)",
	"ai.notice.noteAlreadyAttached": "“{name}” is already attached",
	"ai.notice.noteReadFailed": "Could not read “{name}”",
	/* Chemins cités dans le prompt et attachés automatiquement (prompt-paths.ts). */
	"ai.notice.pathsAttached": "Attached from your request: {files}",
	"ai.notice.linksNotRead": "Links are not read: the model only sees the address, not the page. Attach the content as a file instead.",
	"ai.notice.pathsUnresolved": "Not found in your vault or configured folders: {files}",
	"ai.notice.pathsAmbiguous": "{count} files match “{file}” — write a longer path to pick one.",
	"ai.notice.pathsTooMany": "Only the first {max} files named in your request were attached.",
	"ai.notice.blockExists": "“{name}” already contains a quiz. Open the editor to change it.",
	"ai.notice.quizInserted": "Quiz inserted into “{name}”",
	"ai.notice.insertFailed": "Insertion failed",
	"ai.notice.saveFailed": "The generated quiz could not be saved.",

	/* ── Erreurs de génération (affichées dans l'écran d'erreur) ── */
	"ai.err.unknown": "Unknown error",
	"ai.err.notAnArray": "The AI response is not an array of questions.",
	/* Le modèle a répondu autre chose qu'un quiz. Ces deux messages remplacent
	   l'erreur brute du parseur JSON5, incompréhensible sur de la prose. */
	"ai.err.noFileAccess": "The quiz generator has no access to your files — it only sees what is in the composer. Paths written in your request are attached automatically when they can be found; when they cannot, attach the notes or documents with “+” or “@”, or paste their content.",
	"ai.err.notQuiz": "The model replied with text instead of a quiz: “{preview}…”",
	"ai.err.invalidModelClaude": "Invalid Claude model name: {model}",
	"ai.err.claudeNotInstalled": "Claude Code is not installed. Install it from claude.com/claude-code, then sign in with /login.",
	"ai.err.claudeTimeout": "Claude did not answer within the time limit ({minutes} min). Try again.",
	"ai.err.claudeNotLoggedIn": "Claude account not connected. In a terminal, run \"claude\" then /login with your Pro/Max/Team/Enterprise account.",
	"ai.err.claudeRateLimit": "You have reached the usage limit of your Claude subscription. Try again later.",
	"ai.err.claudeUnreadable": "Unreadable Claude Code response. Try again.",
	"ai.err.claudeEmpty": "Claude returned no response. Try again or switch model.",
	"ai.err.claudeCode": "Claude Code error: {detail}",
	"ai.err.claude": "Claude error: {detail}",
	"ai.err.invalidModelCodex": "Invalid Codex model name: {model}",
	"ai.err.codexNotInstalled": "Codex is not installed. Install it (npm i -g @openai/codex), then sign in with “codex login”.",
	"ai.err.codexTimeout": "ChatGPT (Codex) did not answer within the time limit ({minutes} min). Try again.",
	"ai.err.codexNotLoggedIn": "ChatGPT account not connected. In a terminal, run “codex login”.",
	"ai.err.codexRateLimit": "You have reached the usage limit of your ChatGPT subscription. Try again later.",
	"ai.err.codexEmpty": "ChatGPT (Codex) returned no response. Try again or switch model.",
	"ai.err.codex": "Codex error: {detail}",
	"ai.err.invalidModelAntigravity": "Invalid Antigravity model name: {model}",
	"ai.err.antigravityNotInstalled": "Antigravity CLI is not installed. Install it (irm https://antigravity.google/cli/install.ps1 | iex), then run “agy” once and sign in with your Google account.",
	"ai.err.antigravityTimeout": "Gemini (Antigravity) did not answer within the time limit ({minutes} min). Try again.",
	"ai.err.antigravityNotLoggedIn": "Google account not connected. Reinstall Antigravity CLI from Neo Quiz to sign in, or run “agy” in a terminal and sign in with your Google account.",
	"ai.err.antigravityRateLimit": "You have reached the usage limit of your Antigravity plan for now. Try again later.",
	"ai.err.antigravityNoImages": "Antigravity CLI cannot take images: it runs without any tool, so it has no way to open them. Use a website channel, or Claude Code, for a quiz built from an image.",
	"ai.err.antigravityEmpty": "Gemini (Antigravity) returned no response. Try again or switch model.",
	"ai.err.antigravity": "Antigravity error: {detail}",
	"ai.err.none": "none",
	"ai.err.httpStatus": "Error {status}",
	"ai.err.ollamaModelMissing": "Model \"{model}\" is not installed.\nRun in a terminal: ollama pull {model}\nAvailable models: {models}",
	"ai.err.ollamaModelNotFound": "Model \"{model}\" is not installed.\nRun: ollama pull {model}",
	"ai.err.ollamaUnreachable": "Cannot reach Ollama at {url}.\nMake sure the server is running (ollama serve).",
	"ai.err.ollamaUnreachableShort": "Cannot reach Ollama at {url}. Make sure the server is running.",
	"ai.err.ollamaOutOfMemory": "Not enough memory for this model{detail}.\nPick a smaller model from the list.",
	"ai.err.ollamaSubscription": "This model requires an Ollama subscription: https://ollama.com/upgrade",
	"ai.err.ollamaPlan": "{model} is not included in your free Ollama account. Add usage credits or upgrade your plan, or pick a free model.",
	"ai.err.ollamaSignin": "Ollama is not connected to your account yet; cloud models need it.",
	"ai.err.ollamaHttp": "Ollama error ({status}): {detail}",
	"ai.err.ollama": "Ollama error: {detail}",
	"ai.err.ollamaEmpty": "Ollama returned no response. Make sure the model is installed.",

	/* ── La lecture d'une vidéo YouTube (les libellés du document) ──
	   Composés PAR LE PROCESSUS PRINCIPAL (canaux.ts) à CHAQUE
	   transcription, dans la langue de l'UI de l'application — jamais
	   dans une constante top-level : `t()` doit être appelé au rendu
	   (CLAUDE.md), un libellé figé au démarrage ignorerait le changement
	   de langue. Ils passent par `DepsVideo` (`apps/windows/electron/
	   video.ts`) et vivent dans le document joint à la DEMANDE — ce sont
	   des données du document, pas des textes d'écran (la tuile et la
	   modale portent les leurs, tâches 5 et 6). */
	"ai.video.doc.chaine": "Channel",
	"ai.video.doc.duree": "Duration",
	"ai.video.doc.langue": "Language",
	"ai.video.doc.manuel": "manual subtitles",
	"ai.video.doc.auto": "automatic subtitles",
	"ai.video.doc.description": "Description",
	"ai.video.doc.transcription": "Transcript",

	/* ── La modale d'installation de yt-dlp (spec « Vidéos YouTube » § 4,
	   autorité liante) ── La date de création est formatée par
	   Intl.DateTimeFormat dans la langue de l'UI ; la taille, en Mo à une
	   décimale, passe par la variable {taille} (l'unité vit ICI, MB / Mo,
	   jamais dans le code). */
	"ai.video.modal.title": "Read YouTube videos",
	"ai.video.modal.quoi": "yt-dlp is a free, open-source tool (public domain, Unlicense), successor of youtube-dl, maintained by a community on GitHub. Created on {date}.",
	"ai.video.modal.role": "Here, it only reads a video's title, description and subtitles, in the video's original language. It never downloads the video itself.",
	"ai.video.modal.pourquoi": "The model cannot open a link: without it, the model invents or refuses. With it, the transcript is attached to your request like a document.",
	"ai.video.modal.lien": "Official release on github.com/yt-dlp/yt-dlp",
	"ai.video.modal.version": "Version {version}, published on {date}",
	"ai.video.modal.taille": "Download size: {taille} MB",
	/* Version illisible (hors ligne) : la ligne dit « dernière version
	   publiée » et prévient que l'installation échouera proprement. */
	"ai.video.modal.versionInconnue": "Latest published version (it could not be read — you may be offline). The install will fail cleanly if it cannot be reached.",
	"ai.video.modal.installation": "Installed in the Neo Quiz folder, without administrator rights. Its SHA-256 checksum is verified before it is used.",
	"ai.video.modal.installer": "Install",
	"ai.video.modal.annuler": "Cancel",
	"ai.video.modal.progression": "Downloading yt-dlp…",
	"ai.video.modal.pourcent": "{percent} %",
	"ai.video.modal.installe": "yt-dlp is installed.",
	"ai.video.modal.erreur.reseau": "The download failed: the official release could not be reached. Check your connection, then try again.",
	"ai.video.modal.erreur.empreinte": "The downloaded file did not match its official checksum (SHA-256). It was discarded — nothing was left on your disk. Try again.",
	"ai.video.modal.erreur.inconnue": "The installation failed. Try again.",

	/* ── La tuile vidéo du composer (spec « Vidéos YouTube » § 5) ── Un lien
	   YouTube écrit dans la demande devient une carte ; la transcription
	   prête part comme une pièce jointe. Le badge porte le CODE brut de la
	   piste (« fr », « pt-BR ») et son TYPE traduit ci-dessous. */
	"ai.video.reading": "Reading the video…",
	"ai.video.installer": "Reading videos requires yt-dlp",
	"ai.video.installButton": "Install",
	"ai.video.retry": "Try again",
	"ai.video.remove": "Remove video",
	"ai.video.badge.auto": "auto subtitles",
	"ai.video.badge.manuel": "subtitles",
	"ai.video.erreur.absent": "yt-dlp is no longer available. Install it again from the video tile.",
	"ai.video.erreur.reseau": "The video could not be reached. Check your connection, then try again.",
	"ai.video.erreur.pasDeSousTitres": "This video has no transcript in its original language, so it cannot be attached.",
	"ai.video.erreur.videoIndisponible": "This video is unavailable (private, removed, or age-restricted).",
	"ai.video.erreur.delai": "Reading this video took too long. Try again.",
	"ai.video.erreur.inconnue": "Reading this video failed. Try again.",
	"ai.video.otherLinks": "This link will not be read by the model: only YouTube videos are.",
	"ai.video.notJoinedOne": "1 video could not be read and was not attached.",
	"ai.video.notJoinedOther": "{count} videos could not be read and were not attached.",

	/* ── Vérification à l'arrivée d'une note générée (spec Learn/Practice §2) ── */
	"ai.format.noExplain": "No explanation for {count} question(s): {names}.",
	"ai.format.unknownSlice": "{count} question(s) point to a slice the Learn note does not have: {names}.",
	"ai.format.noSlice": "{count} question(s) belong to no slice: {names}.",
	"ai.format.incompleteSlice": "Slice {slice} is missing: {roles}.",
	"ai.format.noObjectives": "The Learn note has no learning objectives.",
	"ai.format.preNoHint": "{count} question(s) asked before the reading have no hint: {names}.",
	"ai.format.flashcardNoAnswer": "{count} flashcard(s) have no answer on the back: {names}.",
	"ai.format.notLearn": "The model did not produce a learning path: the note was saved as a Practice bank.",

} as const;
