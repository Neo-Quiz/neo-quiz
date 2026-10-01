# AI generation


Press `Ctrl+Shift+D` to open the **Dashboard**, then go to **Generate**: describe a topic, paste a text, attach notes or images, and get a ready-to-edit quiz.

Generation runs through the **AI tools you already have installed locally**: the app never asks for an API key and never stores one. Your requests go through your own CLI session and count against your own subscription.

| Provider | Requires | Notes |
|---|---|---|
| **Claude** | [Claude Code](https://claude.com/claude-code) CLI, `/login` | Pro / Max / Team / Enterprise account |
| **ChatGPT** | [Codex CLI](https://learn.chatgpt.com/docs/codex/cli), `codex login` | The Codex *CLI*, not the Codex desktop app |
| **Kimi** | [Kimi Code](https://www.kimi.com/code) CLI, `/login` | Paid Kimi Code plan |
| **Ollama** | [Ollama](https://ollama.com/download) | Local models, and cloud models via `ollama signin` |

The model list of each provider is read from the CLI itself, so new models show up on their own, without an app update. The app detects each tool and tells you what is missing (not installed, server stopped, not signed in) with the exact command to fix it.

Quizzes are generated **in the language of your prompt**: ask in French, get a French quiz; ask in Arabic, get an Arabic one. This is independent of the app's interface language.

**What a generation costs you:** every generation reports what it consumed, tokens in and out, and the price in dollars when the provider publishes one. Claude Code returns a real cost per request; the others run on a flat-rate plan and have no per-request price, so the panel says so instead of showing a misleading `$0.00`. Kimi Code reports no token counts at all, and the panel says that too. Nothing is ever estimated.

Turn on **Show subscription usage** in the settings and the panel also reads how much of your plan is left, from the CLI already installed on your machine: the 5-hour and 7-day windows for Claude, the plan window for Codex. It is off by default, and reachable from the Generate page before you start, so you can check what is left without spending anything to find out.

---
