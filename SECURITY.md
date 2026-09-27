# Security

Please **do not** open a public issue for a vulnerability.

Report it privately through
[GitHub Security Advisories](https://github.com/Neo-Quiz/neo-quiz/security/advisories/new)
on this repository. Include the product (desktop app or Obsidian plugin), its
version, and enough detail to reproduce the problem.

## Supported versions

Only the latest release of each product receives fixes: the desktop app
updates itself, and the plugin updates through BRAT.

## What matters most

- **Shared quizzes are untrusted input.** A quiz received from someone else
  carries its author's text and HTML. Any way for a quiz to run script or
  read a file is a vulnerability.
- **The desktop app's file access is limited** to the folders you opened.
  Any way for the app window to read, write or open a file outside them is a
  vulnerability.
- **AI generation runs the CLIs you installed** (Claude Code, Codex, Ollama)
  without any tool: the model cannot open files or run commands. Any way to
  make it do so is a vulnerability.
