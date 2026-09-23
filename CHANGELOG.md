# Changelog

All notable changes to the Neo Quiz desktop app are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow [Semantic Versioning](https://semver.org/):
a **major** version breaks something you rely on (quiz format, review log,
settings location), a **minor** version adds or changes something you can
see, a **patch** version only fixes what a previous version already promised.

`git ship` reads the `[Unreleased]` section to pick the next number, and
refuses to ship when it is empty. Each GitHub release carries its section as
release notes.

## [Unreleased]

### Changed
- Learn and Practice now show as a badge next to the question type, on quiz cards and on the quiz page, instead of in the title. A Practice bank also finds the Learn note of the same source when the request had no attachment.

## [1.19.0] - 2026-09-23

### Added
- The Generate page has a Learn | Practice switch: Learn builds a step-by-step learning path through a course, Practice an exam-style exercise bank. The number of questions and their type can be left on Auto.
- Generated notes are named after their source: "<course> — Learn" and "<course> — Practice". A Practice bank points each question to the part of the Learn note that teaches it, and anything missing from a generated note (explanations, reading, recall) is reported by name.

### Fixed
- A question no longer turns into a blank page after going to the next question and back.
- Math formulas in the app are now laid out properly: exponents, fractions and roots no longer collapse into plain text, and \dots (…) is displayed instead of an error.
- Reading cards of a Learn note no longer carry two empty answer options.
- The Claude Code model list now follows the model catalog that Claude Code downloads itself, like Codex: new models (such as Opus 5.5) appear with their exact names as soon as the command-line tool knows them, and older ones move under "More models".

### Changed
- In the Claude model menu, a model that requires usage credits (such as Fable 5.1 on a Pro plan) is shown greyed out at the top of the list and can no longer be picked; a saved choice falls back to the default model. Only the newest model of each family stays in the main list, older ones move under "More models".
- The model list updates on its own as soon as Claude Code or Codex refreshes its model files, without reopening the menu. It never runs the command-line tool to do so.
- The side rail no longer shows the app logo above its buttons.

## [1.18.0] - 2026-09-23

### Added
- Every question now has previous and next arrow buttons under it, in every question type. On the last question, the next arrow takes you to the submit screen or your results, like the right arrow key.

### Changed
- The installer no longer asks for administrator permission when you click Install: Neo Quiz installs in your user folder, which needs none. The Windows permission prompt only appears if the chosen folder requires it.

### Fixed
- In the preview of a video tile, the YouTube link is now clickable and opens in your browser.

## [1.17.0] - 2026-09-23

### Added
- A YouTube link pasted into the prompt now becomes a video tile in the composer: the video's transcript and description are read in their original language and attached to your request like a document, for command-line and web channels alike. Reading videos requires yt-dlp, which the app offers to install from its official release the first time. A link from another site still tells you, under the prompt, that it will not be read.

## [1.16.0] - 2026-09-22

### Changed
- The installer window now appears the instant you open `NeoQuiz-X.Y.Z.exe`, in its final dark style, instead of a light progress box followed by several seconds of waiting. The download is larger (about 310 MB instead of 100 MB) because the installer no longer needs to decompress itself before showing anything.

## [1.15.0] - 2026-09-22

### Added
- The assistant menu marks every channel a free account can use with a "Free" badge, and a new "Paid assistants" settings section lets you hide the subscription-only assistants (Claude Code, Codex CLI) from that menu. Hiding the one you were using falls back to the first free assistant instead of leaving a dead selection.

### Fixed
- The app window now appears much faster on first launch: the file watcher no longer crawls and monitors `.git`, `.obsidian`, `node_modules` and other hidden folders it was going to discard anyway.
- The app window now appears noticeably faster on cold starts: the file watcher's initial scan used to run before the window was shown and slow that down, it now starts right after instead.
- Generating a quiz through a web channel (Mistral) no longer occasionally leaves the prompt box empty: the paste is now retried if the page redirects right after the first attempt, and each attempt replaces any text already there instead of risking a blind keystroke into the wrong window.
- The retried paste above no longer overwrites text typed in the meantime, and no longer keeps running in the background after the action is cancelled.

## [1.14.1] - 2026-09-21

### Fixed
- Stopping the wait for a website now shows the actual website name in the confirmation title instead of the raw `{site}` placeholder.
- Stopping the wait for a website no longer hides your browser window from the desktop and taskbar while its sound keeps playing: the window is properly restored to its previous state and guarded against being minimized or hidden during focus transitions.

## [1.14.0] - 2026-09-21

### Changed
- Claude Code and Codex show their official logos in full color in the assistant menu, instead of the single-color silhouettes.

### Fixed
- In the waiting dialog, only "Send the prompt" carries the blue accent now — the site name after it reads in the normal ink.
- Every numbered step of the waiting dialog highlights its own action in blue: "Drag the file below onto the page" no longer reads as plain text next to the copy step that was already blue.
- Stopping the wait for a website no longer leaves your browser window minimized with its sound still playing: the window is always brought back visible at its place, without stealing focus from Neo Quiz.
- When Neo Quiz starts your browser itself, your prompt now reaches the page on the first try: the side-by-side layout no longer targets the invisible window the browser shows while it is still starting up.

## [1.13.0] - 2026-09-21

### Added
- Mistral joins the list of assistants you can send a quiz prompt to, through chat.mistral.ai. It is the one with a student price in France, and its free tier is enough to generate a quiz.

### Changed
- The assistant menu now shows each command-line tool's own logo next to it, instead of repeating the brand's.

## [1.12.1] - 2026-09-21

### Fixed
- Your Antigravity quota now appears by itself: clicking the usage icon opens the CLI and runs `/usage` for you, instead of leaving you to type it.

## [1.12.0] - 2026-09-21

### Added
- Settings now list your Claude Code, Codex, Antigravity and Ollama CLI accounts with the address each one is signed in with, and let you sign in and out directly without opening a terminal.
- Every connected account gets a usage icon: hover it for Claude Code and Codex to see the five-hour and weekly windows with their reset times, click it for Ollama to open your usage page on ollama.com, and click it for Antigravity to open its CLI, where `/usage` shows your quota.
- Signing in to Antigravity now says up front that the link Google gives you is only valid for a minute, and offers you a fresh one instead of leaving you on a window that no longer responds.

## [1.11.0] - 2026-09-20

### Added
- Updating Neo Quiz no longer leaves an empty screen: a small window in the installer's own style stays on screen while the update installs, and steps aside by itself the moment Neo Quiz reopens. It costs nothing to show — the window runs from a mirror of the installation made of hard links, so not a single byte is copied — and if that mirror cannot be made, the update proceeds silently as before rather than being held up.
- Gemini joins the providers, between ChatGPT and Perplexity, with its two channels: Antigravity CLI, Google's terminal tool that generates with your Google account (Gemini CLI itself stopped serving personal accounts, free, Pro and Ultra alike, on June 18, 2026), and gemini.google.com. The CLI installs from the app like the others, with Google's official installer, and its model list comes from the tool itself ("agy models"), so a new model appears without an update.
- The header of a quiz page now shows when it was generated: the tile that named the model carries the exact date and time underneath, with the logo of whoever generated it.
- Perplexity can generate a quiz from the web too: picking "perplexity.ai" opens it with your request already written, waiting for you to send it. Perplexity's usual link ("?q=") searches straight away, which would leave no time to attach a course; Neo Quiz uses the one that only fills the box.
- ChatGPT can now generate a quiz from the web too: picking "chatgpt.com" opens chatgpt.com with your request already written in the composer, and the answer you copy comes back into Neo Quiz, exactly like claude.ai. ChatGPT shows no warning banner above the request, so no dialog is shown when you pick it.

### Changed
- In a provider's submenu, the website now comes before the command-line tool: it works right away, for everyone, without installing anything.
- The submenu always opens on the right of the menu, the way its arrow points: the menu itself now leaves room for it, shifting left when it sits against the window's edge. It used to flip the submenu to the left, or lay it over the menu.
- "Claude Code CLI" is back to "Claude Code" in the menu.
- Connecting Antigravity CLI needs nothing typed in the terminal: the window opens the Google sign-in page in your browser by itself, waits for you to allow it, and closes once Gemini has answered.
- The install dialog no longer closes as soon as the tool is detected: it says "Signing in to your account in the terminal…" and stays until the terminal window has closed, so the sign-in that follows the installation is never mistaken for a missing step.
- While a tool installs or connects, Neo Quiz moves to the right half of the screen and the terminal window takes the left half, so both stay visible; Neo Quiz comes back to its place when the terminal closes.
- The PowerShell window that installs or connects a tool now counts down "3... 2... 1..." before closing on success, instead of vanishing after two silent seconds; and if anything goes wrong in it, it stays open on the error instead of closing. Its full output is also kept in a file (neo-quiz-installation.txt in your temporary folder), for the case where the window is gone before you could read it.
- The "Generated" folder no longer shows the Documents, Links and Notes sections: only generated quizzes are ever written there, so the three boxes stayed empty for good. Every other folder keeps them.
- In that same folder, the header button is now "Generate" and opens the Generate page, instead of "New quiz" which offered to create a blank quiz or import one, neither of which lands there.

### Fixed
- Ollama's cloud model list keeps itself up to date again: the app asks ollama.com for the current catalogue when Ollama is selected (at most once every six hours), so a newly published cloud model such as DeepSeek V4.1 Flash shows up in the model list without an update of Neo Quiz. The refresh used to live in the plugin's settings tab, which the reader plugin no longer has, and nothing had taken over. The whole cloud catalogue is now listed after the default selection, on every plan: a paid account only ever saw the seven default models, and a free account never saw a paid model outside them; on a free account, the paid ones still go to "More models" with their badge.
- A newer version of one variant no longer removes the others: DeepSeek V4 Pro stayed in the list when DeepSeek V4.1 Flash came out, and Kimi K2.7 Code is no longer treated as an old version of Kimi K3. Only genuinely superseded versions leave (GLM-5.2 for GLM-5.3, DeepSeek V4 Flash for V4.1 Flash).
- A quiz generated from a website no longer shows its channel's internal name twice ("chatgpt-web" over "CHATGPT-WEB"): the tile reads "chatgpt.com", the name of the site itself. A quiz generated by a CLI still shows its model.
- The installer now shows a window right away instead of looking like nothing happened: it used to unpack itself in complete silence, which on a slow or nearly full disk lasted long enough that people relaunched it or gave up. A small progress window appears in under a third of a second and steps aside once the installer itself is on screen. The file to download is 14 MB lighter as well, and unpacking writes 385 MB less to the disk, so the installer is ready sooner and needs less room while it works.

## [1.10.0] - 2026-09-19

### Added
- The AI now names the quiz it generates: the file takes the title the model chose ("Python : types, listes et exceptions") instead of the first line of your request. If the model gives no title, the request is used as before.

### Changed
- The AI only generates fill-in-the-blank questions for a language quiz (vocabulary, grammar, a passage in the language being learned), where that format actually appears in exams; never for science, programming, law or other subjects. Existing quizzes are unchanged.
- Confirmation dialogs ("Delete quiz", "Delete module", "Delete question") follow the standard destructive-confirmation layout: a red icon in a tinted disc, the title and message beside it, "Cancel" and a red "Delete" on the right, with hover, press and keyboard-focus states.
- Deleting a quiz can be undone with Ctrl+Z (the "Quiz deleted" message says so): the note comes back as it was, with its statistics. A note that changed in between is left alone. Works for a whole module too.
- When you copy the answer from claude.ai, the waiting dialog turns into "Answer received" with a check mark and the name of the quiz being created, then closes on the quiz page, which slides in. Before, the quiz page replaced the dialog in the same frame.
- The update indicator in the rail now works like Neo Calendar's: while the new version downloads, a small blue pill above Settings shows the percentage; once it is ready, the pill becomes the update icon and "Update" appears under it on hover (and once, on its own, when the download finishes). Clicking installs and shows "Installing…".
- In the Ollama model menu, the selected model is marked by its cloud icon turning blue instead of a check mark, and paid models in "More models" can no longer be selected: clicking one opens Ollama's pricing page.
- Each step of a generation (generating, error, waiting for sign-in, waiting for claude.ai) now appears in a centered dialog. Closing it stops the generation, or cancels the wait, and your request goes back to the composer.
- When you generate with claude.ai, Neo Quiz moves to the right half of the screen and opens your browser on the left. When the answer arrives, Neo Quiz returns to its previous size, centered, in front, and the browser window goes back to where it was, maximized if it was.
- Files attached to a claude.ai request are no longer pasted into the prompt as text. The waiting dialog shows them as stacks of pages that you drag onto claude.ai, all in one gesture, so a PDF arrives as a PDF. They sit on a single row of equal frames; hovering one fans out every stack and turns the other names blue, since they all leave together.
- While you drag files onto claude.ai, the image under the cursor is a fanned stack with the file you grabbed on top and, as in File Explorer, the number of files in a blue badge.
- While a request is being generated or waits for claude.ai, the composer keeps it (text and attachments) behind the dialog, with the send button greyed out, instead of emptying itself and showing the request in a bubble. It is cleared once the quiz is created.
- On claude.ai, the provider button now reads "claude.ai" next to the Claude logo instead of "Claude · claude.ai".
- The cross that cancels a generation or a wait turns red like the close button of a Windows 11 title bar, and its "Cancel" tooltip looks like a Windows 11 tooltip.
- Images now work with claude.ai too: they are dragged along with the other files. In the composer, an image is a card of the same size as a document's, next to it, and clicking it opens a preview.

### Fixed
- A fill-in-the-blank question whose statement repeated the text with its {{blanks}} no longer shows it twice: only the instruction stays above the blanks.
- Deleting a generated quiz now moves its note to the recycle bin: the note was left behind with only the technical header Neo Quiz had written, still listed as a quiz, and deleting it again said "no block found". Such a leftover note is now removed too.
- The format name "quiz-blocks" no longer appears in the app's messages: "No quiz found in this note", "already contains a quiz".
- An answer copied from claude.ai is now recognised even when the model rewrote or dropped the token on its first line (Haiku did both): any copied JSON5 array of questions is taken as the answer. Only what you copy after clicking Open counts: what was already in the clipboard at that moment (the prompt, the answer of an earlier generation) is never taken, so an old answer no longer creates a quiz before you have even sent the request.
- A quiz whose question shows a code block (a Python snippet, for instance) was rejected as "text instead of a quiz": the code block inside the question was mistaken for the block around the whole answer.
- A long file name no longer hides its extension: it is cut in the middle ("GNU dd…let.md") in the files to drag onto claude.ai.
- The outline of the composer no longer changes as the mouse moves: hovering and clicking give the same outline, and it only goes away when you click elsewhere on the page, not when you open one of its menus.
- In the files to drag onto claude.ai, the scroll bar no longer vanishes under the mouse.
- A course PDF sent to claude.ai no longer goes through the clipboard: the request stays in the link as long as claude.ai accepts it, instead of stopping at the much shorter limit of the Windows command line.
- Generating with claude.ai from a long request (files attached, so the prompt travels through the clipboard) failed at once with "JSON5: invalid character 'Y'": Neo Quiz mistook the prompt it had just copied for the answer. It now ignores the text it copied itself and waits for the real answer.

## [1.9.0] - 2026-09-19

### Changed
- Every dialog in Neo Quiz now looks and moves like a Windows 11 dialog: a light dark backdrop without blur, and the dialog settles into place from slightly larger instead of sliding up. The quiz hint window follows the same style.
- "Waiting for sign-in" now appears in a centered dialog; closing it cancels the wait.
- The "Install" button in the provider menu shows that it was pressed before the install dialog opens.

### Fixed
- In the provider menu, only the "Install" button opens the install dialog, and it lights up only when you hover it, not the whole line.
- The "Waiting for sign-in" screen is centered like the rest of the Generate page, instead of stuck to the left. Once the account is connected it says "Account connected." and no longer "Sending your request again…" when there was no request to send.

## [1.8.0] - 2026-09-19

### Changed
- In the provider menu, a provider that is not installed shows an "Install" button instead of a red dot. It opens the install dialog, where you can install automatically or follow the manual steps.

### Fixed
- Once your account is connected, Neo Quiz comes back to the front, ready to generate. While it waits for you to sign in, it no longer also shows "not connected" under the composer before noticing the sign-in.
- Installing Codex automatically no longer stops on "Start Codex now? [y/N]": the window goes straight on to signing you in.
- After "Install automatically", the dialog closes by itself once the tool is detected, and the tool you installed becomes the selected provider as soon as your account is connected. You install Claude Code, Codex or Ollama to use it: no extra click to pick it afterwards.
- On a free Ollama account, the model menu now lists only the cloud models your account includes; paid ones move to "More models", with a Pro badge and an Upgrade link. Neo Quiz finds out which is which by asking Ollama for each model, without generating anything or using your included usage.

## [1.7.0] - 2026-09-19

### Added
- Neo Quiz now checks that your account is connected as soon as you pick a provider, and again when you come back to the window, instead of waiting for your first quiz to fail. When it is not, a notice under the composer offers "Sign in": a terminal for Claude Code and Codex, your browser for Ollama (cloud models need an Ollama account; no command to type).
- On a free Ollama account, cloud models that need a paid plan carry a "Pro" badge and an "Upgrade" link in the model menu, like claude.ai does. Neo Quiz learns which ones from Ollama's own recommendations and from the models it has already been refused.

### Changed
- "The Codex CLI is not installed" reads "Codex CLI is not installed".
- The note about the red warning that claude.ai shows above a question sent from Neo Quiz now appears once, in a dialog when you pick claude.ai in the provider menu, with a "Don't show this again" box, instead of on every waiting card. It uses claude.ai's own colors so you recognize the banner there.
- While Neo Quiz waits for the answer from claude.ai, it now shows a small centered dialog instead of a full-width card: one sentence ("Send the prompt on claude.ai, then copy the answer"), a single "Reopen claude.ai" button, and waves around the icon instead of the generation shimmer, since nothing is being generated here. Closing the dialog cancels the wait; its close button turns red and says "Cancel" on hover. Your request no longer shows as a sent message bubble for a website, only for providers that generate inside Neo Quiz.

### Fixed
- The PowerShell window that installs or signs in to Claude Code or Codex now finds the tool it just installed (it looks in the same folders Neo Quiz does), only says "connected" when the sign-in actually succeeded, and closes by itself two seconds later. When something fails, the window stays open with the error instead of a false success message.
- With a free Ollama account, picking a model that needs a paid plan now says so in plain words, with an "Upgrade" button, instead of a generic HTTP 402 error. Neo Quiz remembers it and marks that model in the menu next time.
- Switching provider while "Waiting for sign-in" was shown left that card on screen, still watching the previous tool. It is dismissed now.
- Right after "Install automatically" finishes, the page waits for the sign-in that the same window is already asking for, instead of leaving you to discover it at the first quiz.
- The cloud icons in the Ollama model menu line up in one column again.

## [1.6.0] - 2026-09-18

### Added
- Generate with claude.ai, from the provider menu: the site opens with your question already typed in, you send it and copy the answer, and the quiz is created in Neo Quiz on its own. The menu now lists one line per brand (Claude, ChatGPT, Perplexity, Ollama) and lets you pick the channel, the CLI on your machine or the website, on a second level. chatgpt.com and perplexity.ai are listed but not wired up yet.

### Changed
- `NeoQuiz-X.Y.Z.exe` now installs the version its name says. Until now every installer read the latest release, so an older one you had kept would silently install the newest version. From this release on, the download page lets you pick any version from a menu on the Windows tile, and every pick gives you the same installer window; versions published before this one are not offered, because their installer would not keep its word.

## [1.5.0] - 2026-09-18

### Changed
- The install window carries the provider's logo, in its brand colour, next to the title, and says less: the sentence under the button repeated word for word what the Windows confirmation says two seconds later, and the four manual steps are down to one line each.

## [1.4.0] - 2026-09-18

### Fixed
- The "Install manually" section of the install window is readable again: its heading is back on one line (the chevron used to stretch over the label), the command no longer breaks in the middle of a word, and the copy button sits inside the code block, appearing on hover like in Obsidian, instead of overlapping its own label below the block. The collapsible heading and the copy button now show a hand cursor.

### Changed
- Neo Quiz installs for your account, in `%LOCALAPPDATA%\Programs\Neo Quiz`, instead of `Program Files`. Windows no longer asks for administrator rights: not when you install it, and above all not on every update, which now applies with a click and a restart.

**Uninstall your current version once before installing this one.** Windows picks the install mode from what it finds in the registry, so an existing "for all users" install keeps asking for elevation whatever this version does. Your settings and your open folders are kept.

## [1.3.0] - 2026-09-18

### Fixed
- Installing a CLI automatically now runs *exactly* the command the dialog shows you. For Codex the two had drifted apart, and the one the terminal ran could fail (`OSArchitecture` not found) on a machine where the printed one installed fine.

### Added
- When a generation fails because the CLI account is not signed in, the error card now offers **Sign in** instead of *Try again*: Neo Quiz opens a terminal on `codex login` (or `claude auth login`), waits while you sign in, shows you the moment it detects the account, and sends your request again by itself.

### Changed
- The installer download is 273 MB lighter: `NeoQuiz-X.Y.Z.exe` was stored uncompressed (371 MB) and is now compressed (97 MB). It self-extracts in a few seconds on first launch instead of not at all.
- Releases are Windows only from now on: the Linux job is asleep (kept commented in the workflow), and the download page's Linux tile points at 1.2.0, the last release with Linux packages.

## [1.2.4] - 2026-09-17

### Fixed
- The release packages are attached again: the upload step no longer depends on a third-party action whose floating tag broke every large upload (1.2.1, 1.2.2 and 1.2.3 shipped incomplete).

## [1.2.3] - 2026-09-17

### Fixed
- The Linux packages are attached to the release again: the release workflow listed the same AppImage twice, and the two concurrent uploads of the same file failed the job (1.2.1 and 1.2.2 shipped without their Linux packages).

## [1.2.2] - 2026-09-17

### Fixed
- The install command in the install window is syntax-coloured (command, flags, string, URL) instead of plain grey text.

## [1.2.1] - 2026-09-17

### Fixed
- The install window's "Install manually" section no longer looks like a grey folder header with a stray count.
- A provider that is no longer installed is no longer kept as the selected one: the selection goes back to "none" instead of showing a model nothing can run (settings survive a reinstall, so a previous choice used to stick).

## [1.2.0] - 2026-09-17

### Added
- Install Claude Code, the Codex CLI or Ollama from the app: a provider that is missing opens a window that explains what it is, installs it in one click (PowerShell opens with the official installer) and detects it once it is there. Manual steps stay available.

### Changed
- The hint under the composer no longer shows a raw command; it opens the same window.
- The welcome screen no longer shows a code block: it offers to generate a quiz, create an empty folder, open an existing folder or import a quiz.
- The "+" button of the composer opens the file picker directly; "Add notes" is gone (use "@" to attach a note). The shortcut is Ctrl+E.
- The note preview hides properties by default (a button shows them), keeps file links readable and renders callouts like Obsidian.

### Fixed
- The dots in the AI provider menu line up whatever the length of the status text.
- The "Add files" shortcut now works in the app.
- A PDF added with "Add files" can now be opened from its preview, like one attached with "@".
- Two destination folders with the same name (two "Generated") are told apart: each entry shows its folder icon and the root it belongs to.

## [1.1.0] - 2026-09-17

### Added
- Thirty-five built-in wallpapers, five per theme, with a picker in Settings; a folder of your own images still works.
- "Open an existing folder" when creating a folder: pick any folder you already have, an Obsidian vault folder for instance.
- A destination folder for generated quizzes, chosen in the generation options.
- A folder page lists its documents, links and notes below its quizzes; "Create with AI" from a folder attaches them for you.
- PDF attachments: their text is extracted and their first page shown on the card; a click opens a preview.
- A rendered preview of attached notes (headings, lists, callouts, tables, code).
- Folder cards show their path, and the folder can be opened or its path copied from the card menu.

### Changed
- The "Generated" folder is a staging area, not a subject: no progress panel, a sparkles icon.
- The AI provider menu shows a dot only when something is wrong (server stopped, not installed).
- Attachments in the composer are cards, like on claude.ai.
- Two play modes, Learn and Exam; "Practice" is gone.

### Fixed
- Creating a new quiz inside a nested folder failed.
- Folder cards no longer jump on hover, and their glow no longer switches off.
- Two neighbouring folder cards no longer get different widths.

## [1.0.3] - 2026-09-16

### Added
- Linux packages: AppImage (x86_64 and ARM64) and a .deb, with automatic updates for both.

### Fixed
- The installer shows real progress instead of an idle bar that jumps to 99 %.
- Running the installer over an existing installation now says "Neo Quiz is already installed" and offers to open it.
- The installer window no longer flickers while downloading.

Version 1.0.2 was withdrawn the same day; its changes are part of 1.0.3.

## [1.0.1] - 2026-09-15

### Added
- A Language setting (auto, English, French) in Settings › General.

### Changed
- The installer is redesigned after Google Play Games: one window, one button, the install location and the disk space on one line.
- The installer reads the release manifest directly and no longer depends on the GitHub API rate limit.

### Fixed
- The application window stays hidden until it is ready to be shown.

## [1.0.0] - 2026-09-13

### Added
- The Neo Quiz desktop app, independent from the Obsidian plugin: read, review, edit and generate quizzes from the folders you open, with automatic updates.
