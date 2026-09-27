# Contributing to Neo Quiz

Thanks for your interest in Neo Quiz! Bug reports, ideas and pull requests
are all welcome.

## Reporting a bug or suggesting a feature

Open an [issue](https://github.com/Neo-Quiz/neo-quiz/issues/new). For a bug,
say which product (desktop app or Obsidian plugin) and which version you use,
what you did, what you expected and what happened. A screenshot or the quiz
block that triggers the problem helps a lot.

Security problems are the exception: never report them in a public issue, see
[SECURITY.md](SECURITY.md).

## Local development setup

```bash
npm ci
npm ci --prefix apps/windows
npm run app:dev        # the desktop app (Vite + Electron)
npm run build          # the Obsidian plugin, deployed to local vaults
```

## Repository layout

- `src/` is the shared code. It knows no host: it asks for what it needs
  through the contract in `src/host/types.ts`.
- `apps/obsidian/` is the Obsidian plugin (a quiz reader).
- `apps/windows/` is the desktop app (Electron). `apps/windows/electron/` is
  the main process, the only code that touches the disk.
- `src/scheduler/` is the spaced repetition scheduler, a pure module with no
  dependency on any host, screen or clock.
- `docs/` is the website, published to <https://neo-quiz.github.io>.

`CLAUDE.md` (in French) documents the architecture and every check script in
detail.

## Before opening a pull request

- Run `npm run check` (typecheck) and `npm run check:app` if you touched
  shared code. Each `check:*` script in `package.json` guards one past bug:
  run the ones related to your change. A script is judged by its exit code.
- If the change is visible to users, add one line under `## [Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md) (`Added`, `Changed` or `Fixed`).
- Keep modules small (about 350 lines at most).

## Rules

- **English everywhere in the code**: comments, names of functions,
  variables, types and files, log and error messages. Some older code still
  has French comments and names; they are translated little by little, when a
  file is modified.
- **Commit messages**: English, imperative, one line of 60 characters at
  most (for example `Fix sheet stack jump on return`).
- **No visible string hardcoded**: every UI string goes through
  `t("<domain>.<key>")` (`src/i18n.ts`). English (`src/i18n/en/`) is the
  reference; French (`src/i18n/fr/`) is typed, so a missing translation is a
  compile error.
- **Quiz HTML is untrusted**: a shared quiz carries its author's HTML.
  Everything a quiz displays goes through `src/engine/sanitizer.ts`.
- **Never rename persisted values**: the `quiz-blocks` note format and its
  keys, `PLUGIN_ID`, `appId` and `executableName`. Renaming them would break
  existing notes or installations.

## Releases

Maintainers publish with `git ship` (see `scripts/ship.mjs`): a
`desktop-vX.Y.Z` tag for the app, a bare `X.Y.Z` tag for the plugin. The
`release.yml` workflow builds, signs and publishes the release, and installed
apps update themselves from it.

## Code signing policy

See [install.md](docs/guide/install.md#code-signing-policy).
