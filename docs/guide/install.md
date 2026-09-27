# Install


### Desktop app (Windows, Linux)

The desktop app reads the same quiz folders and the same review log as the plugin, and generates quizzes with the same local AI tools.

1. Go to **[neo-quiz download page](https://neo-quiz.github.io/)** and click Download, or grab `neo-quiz-setup-<version>.exe` / `neo-quiz-<version>.AppImage` from the [releases page](https://github.com/Neo-Quiz/neo-quiz/releases).
2. **Windows:** the installer is not code-signed, so SmartScreen shows "Windows protected your PC" on first run. Click **More info**, then **Run anyway**. Pick an install folder; the app is per-user and needs no admin rights.
3. **Linux:** `chmod +x neo-quiz-<version>.AppImage` and run it. Without FUSE, run it with `--appimage-extract-and-run`.

**Updating:** download the new installer and run it over the existing installation. Your folders and settings live in `%APPDATA%\Neo Quiz` and are kept; the review log lives in your quiz folder (`.neo-quiz/`) and is never touched. The version you are running is shown at the bottom of **Settings**.

**Uninstalling** removes the app only. Your quiz folders and their review log stay where they are.

### Obsidian plugin

Two clicks, nothing to copy:

1. **Install BRAT**, the Obsidian plugin that installs plugins from GitHub and keeps them updated: [obsidian://show-plugin?id=obsidian42-brat](obsidian://show-plugin?id=obsidian42-brat) (or Settings, Community plugins, Browse, search "BRAT").
2. **Install Neo Quiz**: [obsidian://brat?plugin=Neo-Quiz/neo-quiz](obsidian://brat?plugin=Neo-Quiz/neo-quiz). Obsidian opens and BRAT adds Neo Quiz to the current vault; enable it if asked.

Updates then arrive on their own through BRAT. Manually: BRAT settings, *Add Beta Plugin*, paste `https://github.com/Neo-Quiz/neo-quiz`.

### Code signing policy

The Windows installer is not code-signed. Windows SmartScreen therefore shows "Windows protected your PC" the first time you run it; the updates that follow arrive from inside the app and carry no such warning.

- Committers, reviewers and approvers: [Ahmed Mili](https://github.com/ahmed-mili), the sole maintainer. Every release is built by GitHub Actions from a tagged commit of this repository and approved by him.
- Privacy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. AI generation talks only to the local CLI or Ollama server you configure; the Ollama model catalogue is fetched from ollama.com when you open the model list.

---
