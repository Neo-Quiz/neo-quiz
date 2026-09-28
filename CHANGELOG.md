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

### Added
- Course terms: the key terms of a quiz are underlined in its readings, explanations and hints; hover, focus or tap one to read its definition in a bubble. Generated quizzes come with their glossary, and the quiz editor has a Vocabulary window to change it.
- Generate detects the subject of a quiz (Python, C, Bash / Linux, SQL, Web, Maths, Networking) from the attached files' names, the destination folder and your request, and says so next to the options button ("Python detected"). The prompt is then adapted to the subject: for Python, fenced runnable examples, questions on what `print` displays, and each idiom shown in its compact form, its result and its loop equivalent. The subject can be changed in the quiz options (Automatic by default).
- Generated quizzes give every Learn question a hint, with key words in bold, a concrete example and, for a hard question, two or three levels; explanations put their two or three key words in bold; a reading explains every compact line in full; a step that introduces terms has at least one flashcard; ordering items are single lines of inline code.
- Hints with several levels: a hard question can give a light clue first, then "Next hint" reveals a more precise one, up to the last; the levels already seen stay on screen. The editor adds or removes levels under Hint. Written answers now have their hint too, and the key words of a hint or an explanation are shown in blue.
- Learn courses come in several reading styles chosen by the AI for the content: a reading page, numbered steps or a comparison table, with key points as flip cards or a checked recap; the style can be changed in the editor.
- Wallpaper brightness and blur sliders in Settings, under the wallpaper, applied live as you drag.
- A ⋯ button at the top right of a folder opens the same menu as its card (edit, open the folder, copy its path, archive, move, delete).
- Share a folder or a quiz: a Share button at the top right of a folder, and a Share entry in the ⋯ menu of every card. Discord puts the file (a .zip for a folder, a .md for a quiz) in the clipboard and brings Discord to the front, ready to paste; Save file asks where to save it and shows it in the explorer.
- The back and forward buttons of a mouse move through the pages you visited, like in a browser: home, My quizzes, a folder, a quiz page. On a quiz being played, the back button returns to the list.
- Attaching several documents now makes one quiz per document instead of one long quiz: CM1, CM2 and CM3 give three quizzes, each with its own line in the generation queue, generated one after the other and saved as soon as it is ready. A document that fails shows its error on its line and the others go on; with a website, the site reopens for the next document once the previous answer is received.
- A Time format setting: times are shown in 24-hour format by default, whatever the interface language, and can be switched to 12-hour (AM/PM) in Settings.
- Flashcards: a Learn recall can be a card that you flip, then rate "Review again" or "I knew it" (Space or Enter flips, 1 and 2 rate); your rating counts in spaced review. The editor has a Flashcard type, and a course page shows a cards icon for a quiz made only of flashcards.
- Resume where you left off: a quiz you close in the middle — even by closing the app — reopens on the same question with your answers, from its folder's button (Resume · quiz · Q7/23), its card or its course page. Try again starts over; timed exams are not resumed.
- Every time you reach a quiz's score is kept as an attempt: the Progress tab of a folder shows each course's best score, and lists its attempts (date, score) with a button to delete one — the best score is recalculated, and Undo puts it back. Scores from before this version appear as one "before history" attempt. Spaced review is never affected.
- A Review plan tab in every folder: related tasks (review the questions due today), upcoming exams (several per folder, each with a name and a date, added, edited and deleted there), the folder's ring, the next step button and the study modes. Questions only become due once the folder has an upcoming exam; the nearest one sets the review pace. To review today and the exam date left the Progress tab, and Edit folder links to the exams.
- A composer at the bottom of the Review plan: type what you want and it opens Generate with the folder as destination, its documents attached and your request, and starts the quiz generation.
- Learn quizzes show how many readings they hold next to the number of questions.
- A quiz can be moved to another folder from its card menu (Move to), keeping its review history. Move to opens its list of folders as a submenu on hover, with an arrow on the right: every folder of My quizzes is offered, empty ones included, with its own icon and color and grouped under its course unit; a folder moved to another vault shows the Obsidian logo next to each vault. It moves both files of a course shown as one card (Learn and Practice).
- A Run button on every Python code block shown in a quiz (readings, explanations, hints, and a question's own code once the quiz is corrected, never before, since running it would give the answer away): runs the code in the Python sandbox and shows its output, or its error, in a panel built into the same block, right below the code, like an editor's output panel — a sandbox issue (unavailable, timed out) is shown as a discreet notice instead.
- A hard question may let you run its own program once its last hint is revealed, when the quiz was generated that way; never on a question asking what a program prints.
- The quiz editor has a "Running the code is the last hint" switch under Hint, available once the question holds a Python, C or C++ block and has two hint levels; generated quizzes set it on hard questions where running the program helps.
- Zoom goes from 25 % to 150 %, on the same steps as a browser. Zooming (Ctrl + wheel or Display > Interface scale) shows the new percentage at the top of the window, with − and + buttons and Reset to go back to 100 %; it goes away on its own after a few seconds.
- C and C++ code blocks run in a quiz like Python ones: the compiler (Clang, in WebAssembly, isolated from your files and the network) is downloaded the first time you run C or C++, and can be removed in Settings › Languages.

### Changed
- The played quiz shows its mode as a Learn or Practice pill before its title, instead of a "Learn:" prefix; the note's path no longer appears on hover.
- Hovering an answer no longer turns its circle blue; the blue ring stays for keyboard focus only.
- On a quiz page, the Learn or Practice mode is no longer shown in blue, nor the active side of the Learn | Practice switch: blue is kept for buttons.
- In a quiz being played, the close cross, the title and the row of question beads stay at the top and the previous and next arrows at the bottom, at the same place whatever the length of the question: only the question scrolls between them, and the mouse wheel scrolls it anywhere in the panel.
- Launching a quiz: its content stays still while the panel rises.
- The document above a comprehension question shows in full, the page scrolling instead of a scrollbar inside the document.
- The labels of flashcards, ordering, matching and the screen before the score are no longer in capitals.
- The current question bead keeps the full colour of its rating (green, amber) instead of turning almost black.
- The button that opens a file from a quiz (a Packet Tracer activity, a PDF) is a raised purple button with a paperclip icon, placed after the content of its card instead of above it, and shows the file name on hover.
- Question beads: the current bead has a moving shine, an answered bead is a clear blue (green, amber or red once rated or corrected), and hovering a reading bead shows the reading title above it.
- Numeric answers show their unit at the right of the field, and the equation field matches the other answer fields.
- Ordering and matching: empty slots are hollow with a numbered pill, the items are raised pieces with a grip that sink when pressed and turn blue when picked up, a placed item sits raised in its slot, and the instructions are shorter.
- Terminal questions open in a terminal window with a title bar (Command Prompt, Windows PowerShell, bash).
- Text answer fields are flat like the answer choices, without a blue border or glow, and start at the height of the expected answer instead of ten lines; an explanation in your own words starts at four lines.
- Image answers are laid out in a grid of equal columns, and the "Select one or more answers" line is a small note instead of a banner.
- Flashcards are a real card that turns over in 3D: the question on the front (click it or press Space), the answer on the back, then two raised buttons to rate yourself, coloured once chosen.
- Answer choices are raised buttons like the arrows, sinking when pressed and springing back when released; hovering lightens the face and tints the circle blue without sliding or glowing; a chosen answer turns blue, with a white radio dot (a white box with a check for multiple choice) instead of a flat blue block with a folded corner.
- The screen before the score is redesigned: an icon, what is left to do in a sentence, a progress bar ("1 / 16 answered") and the questions to go back to as numbered beads like the navigation above, instead of a red warning and a row of "Q1" tags in a bordered box.
- The Hint button has the same grey as the question beads.
- The program output field reads "Program output…" in italics and clears when you click it; the text cursor is blue.
- The path at the bottom of a folder card is cut in the middle, like a file name: its start and the folder's own name stay visible, instead of the whole path scrolling in a loop.
- Question and folder cards react like StudySmarter: a slightly lighter background and soft shadow on hover, a smooth press on click; folders no longer lift, and a folder's page fades in. The question list of the editor reacts the same way, its blue outline only marking the current question.
- Starting a quiz slides it up over the page, which steps back behind it, like StudySmarter, without darkening it; leaving reverses it. The page now stays in place behind the quiz for as long as you play, as a stacked sheet hidden behind it, and comes back to front — with its score and progress refreshed — instead of being rebuilt. Only the wallpaper shows through the quiz's glass, never the page behind it, during the slide as while you play.
- A question asking what a program prints is answered right in the output area of its code block, on one line with "Program output" as placeholder, instead of in a separate, oversized field.
- Hovering a question card, a button or an icon no longer shows a plain browser tooltip repeating its label; the tooltips left carry what the screen does not show (a full file name or path, why a button is disabled, the exact model of a generated quiz).
- A quiz being played has a one-line header like StudySmarter: a close cross and "Learn: title" (or Practice); the question count is gone and the note's path only shows, just above the title, when you hover the title.
- The questions of a quiz being played are a row of numbered beads on a thread that fills up to the current question, which is larger: green or red once corrected, a violet bead with a book for a reading, a bead with a flag for the results. Every question stays visible and clickable on a single line: when there are too many for full-size beads, they become small dots with a number every five, and the beads under the pointer grow like the macOS Dock.
- A Learn reading no longer shows "About N minutes of reading".
- In a folder, the Documents, Links and Notes lists scroll within their frame beyond eight rows, instead of making the page endless.
- The app now sits in a centered panel, with your wallpaper fully visible around it; cards inside are plain surfaces instead of glass tiles. A soft blue glow lights the top of the window; entering a folder briefly flashes the folder's color, then the glow fades away inside the folder and comes back when you leave.
- Generating a quiz now reads like a conversation on claude.ai: each request appears as your message, with a live "working" reply underneath that turns into the finished quiz, and the composer stays at the bottom; a running generation is stopped from the composer button only.
- A PDF attached in Generate shows up at once, with its name and a small loading wheel; its first page and its text follow, and sending waits until the text is read. A PDF that cannot be read says so on its card.
- Attaching a file in the Generate composer now animates like claude.ai: the tile rises in at once with a soft shimmer while it loads, then the page preview fades in from blur.
- The + button of the Generate composer opens a claude.ai-style menu: add files or images (now Ctrl+U), or mention a note or document with @.
- In a folder, "New quiz" sits in the header between the view tabs and the menu, instead of the full-width "Add content" bar above the quizzes.
- The quiz editor shows each question as it looks once answered and corrected, and you edit it right there: click a text to change it, click an answer's letter to mark it right, hover to add or remove an answer, click to reorder or re-pair; rarely used fields are under More.
- In the editor, the correct answer, options, orderings and matchings are changed directly in the question's corrected render.
- Quizzes are written in markdown everywhere, like Discord and Obsidian: generation no longer produces HTML, and quizzes that contained HTML open in the editor as markdown.
- A quiz page is laid out like StudySmarter: the back arrow above the title, the folder under it, then a line with the mode, the number of questions and where the quiz comes from, ending with Edit, Start the quiz and a ⋮ menu, then a search box that filters questions by their text and options, accents ignored, above every question shown in full as a card in a grid, each card scrolling on its own. Answers are still never shown there.
- The colored choices of Add content and of Create a folder carry a soft glow of their color rising from the bottom, which brightens on hover.
- The quiz editor was redrawn: the same header as the quiz page (title, folder, Done and Start as raised buttons), question cards like the grid's, forms in named sections with calmer fields, an icon toolbar for formatting, answers marked right by a green switch instead of full red and green boxes, and the blue arrows of the quiz to move between questions.
- Hint and I don't know are now one help button that goes up a step: Hint first, whose text then stays under the question instead of opening a window, then I don't know where it applies. The button is a neutral pill you press down, with an amber bulb or a question mark.
- Start the quiz, on a course page, and the next step button of a folder (Resume, Review, Learn or Practice) are blue buttons raised above their edge that sink when clicked, with a light that sweeps across them every few seconds.
- The previous and next arrows of a question, its main buttons (Check, Flip, Show score, Try again) and the question tabs (Q1, Q2… Results) are buttons you press down: a darker edge under them, and they sink when clicked. The quiz now uses one blue and one green everywhere, both dark enough for white text to read clearly: the selected answer, the arrows, the main buttons and the current tab share the same blue (the selected answer was a lighter sky blue), and correct answers and Results the same emerald; the current question is the only solid blue tab, answered ones are tinted blue, right and wrong ones green and red, and Results is a deep emerald.
- In a Learn, moving on from a question asked before the lesson without answering it counts as "I don't know" instead of stopping you with a message.
- The Learn and the Practice of a same course show as one card on My quizzes and on the home page. Every quiz card now shows its title and total number of questions, a progress ring with its percentage (blue in progress, green mastered), and one pill per mode that starts that mode; hovering a pill gives its number of questions. The status badge and the buttons inside the card are gone. A setting keeps Learn and Practice apart, and cards inside a folder no longer repeat the folder name nor show the ring, whose details are in the folder's Progress tab.
- Inside a folder, the title keeps the folder color but loses its dark shadow, its icon glows softly; the back arrow, redrawn, sits above the title, the quiz and mastered counters leave the header. A Content | Progress switch sits next to the title: Content opens on two buttons side by side, Add content and a button for the next step, which resumes a quiz you left unfinished first, then reviews the questions due today in the folder, then the next unfinished Learn, then Practice, then the quizzes and the resources, over the full width; Add content replaces the New quiz button and gathers everything a folder can receive: drop or upload files, add a link, generate a quiz with AI, create a blank quiz, import a shared quiz, create a note; Progress shows the folder's ring and three tiles (mastered, in progress, not started) instead of the side panel, then what is due for review today in this folder with a Review button, the exam date (added or changed from there), and every course with its Learn and Practice progress.
- Inside a folder, Documents, Links and Notes share one dashed tile with a tab for each, instead of three stacked frames, with the tab's button (Upload files, Add a link, Create a note) at the top right; the folder remembers the last tab opened.
- My quizzes can be grouped by Recent (the default) or by Folder, which puts each folder under the folder that contains it; grouping by course unit moves to a Custom section of the menu, since it depends on your own course.
- A folder without a chosen icon gets one that fits its name instead of a book everywhere: a bug for Ethical Hacking, blocks for software architecture, a terminal for scripting, a router for networks, a radar for technology watch. The icon picker offers about a hundred icons grouped by theme.
- Generated quizzes put code, commands, identifiers and paths between backticks, so they show in a code font and Python names such as __init__ keep their underscores.
- A timed quiz opens on a screen that announces the timer (duration, number of questions, one Start button) instead of asking to choose between learning and exam mode.
- Question cards show a single plain label (the question type, or In your own words) instead of type and role badges.
- The button that opens a quiz in the editor now reads "Edit".
- Easier reading in a quiz: the question text is larger than before and its title smaller, and the note's location under the quiz title uses the interface font instead of a code font.
- Code blocks in quizzes use a Tokyo Night theme with an embedded JetBrains Mono font and syntax highlighting, and generated quizzes always name the code language.
- Math in quiz text is set in the typeface of mathematics, Computer Modern, as in LaTeX, exam papers and Obsidian: digits, signs and variables alike, slightly larger than the sentence around it.
- A generated Learn note now stays short: at most 20 questions unless the course truly needs more, and a Practice bank holds 10 to 20. Every question asked before the reading comes with a hint, and a note that lacks one says so.
- The quiz no longer shows "Slice N of M" above a Learn question: only its role remains, and "In your own words" is now named as such instead of "Check".
- A numeric question written with math now opens the equation editor and its math keyboard. The answer can be typed as a number, a fraction, a power or a product (3 × 255, 3/4 as a fraction, 2 to the power 10) and is still compared by value, within the question's tolerance.
- Learn and Practice now show as a badge on quiz cards and on the quiz page, instead of in the title. A Practice bank also finds the Learn note of the same source when the request had no attachment.
- On quiz cards, the question type is now an icon before the question count, named on hover, instead of a second badge.
- Labels, badges and section titles are no longer forced to all caps.
- The quiz page opens on a sheet: on the left the folder, the title, the goal and the question count on one line (hovering them explains the mode and names the question type), the model that generated the quiz with the date below it, the progress once started, a large Start button and the editor; on the right every question, readable at a glance and without the answers, along a numbered path with its type icon and, in a Learn note, its role; short choices sit side by side, long ones in a column, and only the list scrolls. Clicking a question makes the Start button shine instead of opening it, the same shine that plays on arrival and every few seconds, and leaving the editor returns to the sheet. The stat tiles under the title are now one line of text, and models show their readable name (Sonnet 5 rather than claude-sonnet-5).
- The Practice hint now says the bank prepares you for your exam, rather than promising your exam's format.
- The quiz mode picker in the editor offers Learn and Practice, and no longer shows the Quiz, Lesson and Exam modes or their timer settings.
- Edit is a neutral raised button next to Start the quiz, the question grid shows at most three columns, and every card has the same height, its extra content scrolling inside it.
- The editor's text fields show their text as the quiz will: code as a code pill, bold, italic and formulas rendered. The markdown signs (backticks, stars, dollars) only reappear around the cursor, like in Obsidian.
- Generating a quiz no longer opens a blocking window: each request appears as a sent message under the composer, you can keep sending more while one is running, and they run one after another in a queue you can cancel. If a generated quiz cannot be saved, it stays on its line: save it again or open it without saving, without generating it twice.
- In Learn quizzes a reading is no longer counted as a question: it has no number, and its tab is a book. Every reading is its own screen, after the "before the reading" questions, shown in full without a scrolling box, and is never repeated above a question. Only short steps, or steps marked as a method to apply, are shown open above the first question that follows.
- Writing an answer in your own words no longer has a Check button: you write it and move on, and it self-assesses on the results screen instead, where each written answer shows what you wrote, the correct answer, the explanation, and two icon-only buttons to mark it right or wrong; a written answer left unassessed doesn't count against your score.

### Fixed
- Moving to another question no longer makes the quiz as tall as its longest reading for the length of the slide, and no longer flashes a scrollbar at the end of each move.
- Fill in the blanks with a blank inside a formula ($du = ▢ dx$) shows the formula around the blank instead of raw LaTeX, and a blank whose answer is itself written in LaTeX (a fraction) is a blank again.
- An answer typed in the equation editor is no longer marked wrong for how the editor writes it: a derivative prime (f'(3) = 6), a decimal comma (1,5 for 1.5) and a fraction typed with a slash (15/7) now match the expected answer.
- A numeric answer given in percent counts as a percent: 62,5 % is accepted for a probability of 0.625, and 0,625 % no longer is; a question whose unit is % still reads 25 % as 25. A number starting with its decimal point (.49) is read too.
- A revealed hint no longer fades in again each time you pick another answer: only a newly revealed level appears with its animation.
- A quiz page shows image answers as thumbnails instead of their raw text, and labels an equation as Equation and a program output question as Program output instead of Free text and Bash terminal.
- Opening or closing a quiz no longer lets a band of wallpaper open between the page and the quiz sliding over it.
- "What does this program print?" on C, C++ or any language other than Python: the answer field sits right under the code, as for Python, instead of a tall separate box.
- Fill in the blanks on code is shown as one code block that keeps its indentation, instead of one spaced-out line per paragraph with the loop body at the level of its `for`. The "Fill in the N blanks" banner above the text is gone.
- Move to no longer reports a failure when the quiz did move, if its old file had already disappeared at the last moment; and a failed move can no longer remove another file created under the same name in the meantime.
- Moving a folder to another vault (Move to in its menu) failed with "already exists" whenever the folder was not at the root of its vault; the current vault is no longer offered as a destination.
- Inline code containing a dollar sign, such as `$HOME` and `$PATH` in the same sentence, is shown in full instead of losing part of the text.
- Going back from a quiz started from a card (its Learn or Practice pill, the next step button of a folder, the home page) now returns to that quiz's page, whose back arrow returns to its folder, instead of the list of folders.
- The AI tools (Claude Code, Codex, Antigravity) can only be started with the exact options Neo Quiz uses for a generation: an option that would let them run commands on their own is refused.
- Opening a file from a quiz refuses more kinds of programs and scripts, including when the name ends with a dot or a space, which Windows ignores.
- A typographic apostrophe (’) in a translated message or a folder path no longer breaks the scripts that install and connect the AI tools, and can no longer be used to run something else in them.
- Importing a shared folder or quiz only brings in its notes (.md): any other file in the archive is left out.
- "Create with AI" from a folder no longer keeps the files of the previous folder in the request.
- A quiz copied from a website is read even when the model forgot a comma between two fields or inserted section headings between questions, instead of being rejected.
- A Learn path whose model forgot to mark it as Learn is saved as Learn, not as a Practice bank.
- In Learn quizzes, a "from memory" matching, ordering or fill-in question keeps its real interaction instead of turning into a free-text answer.
- A terminal question whose language is a real program (Python, Java…) is now an editable code block labelled "Program output", instead of a command prompt ("C:\>") that suggested typing a command; real shell prompts (cmd, PowerShell, bash) keep an adapted prompt (`C:\>`, `PS>`, `$`).
- Every written-answer field now starts at the height of the expected answer (one to a few lines) instead of always opening ten lines tall, and grows as you type.
- A single-line code block (```` ```python … ``` ````) inside an ordering item or an option is shown as inline code, syntax-highlighted when the language is recognized, instead of showing its raw backticks.
- The explanation shown after correcting a question now uses the same font and size as the question text, instead of a smaller, harder to read one.
- `\neq`, `\ne`, `\notin` and `\not=` now show their diagonal stroke instead of an empty box.
- A terminal window no longer flashes on screen when the app checks the Antigravity account (Settings, generation): Antigravity's own background update check, which opened it, is now turned off for the processes the app launches. CLI account status also loads in the background right after launch, so Settings shows it immediately.

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
