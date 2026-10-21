# Android touch feedback implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review the tasks.

**Goal:** Give every mobile interactive surface immediate, consistent feedback, graceful release and accessible motion.

**Architecture:** Replace the delayed web ripple with one delegated press lifecycle and shared CSS tokens. Preserve component geometry and existing 3D page actions; use a state layer for flat surfaces. Keep native navigation stationary and remove the native ripple's initial sparkle.

**Tech stack:** TypeScript, CSS, Electron CDP, Kotlin Android Views.

**Spec:** Owner's mission in this session, supplemented by CLAUDE.md.

## Global constraints

- Work only on android-press; do not publish, change release versions or docs/android-latest.json.
- Feedback is mobile-only, immediate on pointerdown, cleared on release, cancellation, scrolling, blur and lost visibility; disabled controls never react.
- Shared tokens: 0 ms press, 200 ms ease-out release, scale .97, 10% state layer, 8% hover, 280 ms cubic-bezier(.2,.8,.2,1) disclosure.
- Reduced motion keeps the state layer without movement. Mouse hover rules belong in @media (hover: hover).
- Preserve layout and 3D actions on pages; modals use flat controls, black 30% smoke without blur and 1.05 to 1 entry over 250 ms.
- English code/comments, existing i18n, Lucide icons, no title attributes, uppercase labels or emojis.
- No adb until the other session's RAPPORT.md exists. Read-only navigation in the isolated app and on the phone; no quiz play or generation.
- Each implementation batch runs check, check:app, check:theme, check:view-enter, check:idle-animations and check:dashboard-dom; Kotlin changes run testDebugUnitTest.
- Commits: English imperative <=60 characters, blank line, Co-Authored-By: Codex <noreply@openai.com>.

## Review focus

- A touch changing into a scroll, long press, multi-touch or navigation must leave no stuck press.
- Nested interactive controls affect only the closest enabled target, never its parent card.
- Selected, destructive and disabled controls retain semantic colors in light and dark themes.
- Motion reduction never removes feedback, and flashcard transforms remain intact.
- Menus and modals survive rapid toggles and finish closing; 360/393/430 px have no overflow.

## Tasks

### Task 1: Shared mobile press system

Files: apps/windows/src/ui/ripple.ts, new src/assets/css/mobile/press.css, src/assets/css/index.css, relevant conflicting component CSS only.

- Inventory actionable DOM classes and existing active/hover/3D rules before implementation.
- Replace delayed ripple with delegated immediate feedback and explicit cancellation lifecycle. Reuse existing boot entry installRipple(). Choose semantic attributes/classes for surfaces whose markup is not natively interactive. Do not poll or observe the whole DOM.
- Define tokens once and use two feedback families. Preserve transforms via individual scale/translate where appropriate and do not animate layout.
- Cover buttons, cards, rows, tabs, chips, menu/model-picker items, answers, flashcards, navigation pearls, links, switches, checkboxes, fields, headers and composer controls.
- Verify pointer lifecycle behavior and real CDP computed styles, including selected/disabled/nested/reduced-motion cases. Run required controls, commit.

### Task 2: Disclosure and overlay motion

Files: shared disclosure helpers, their CSS, src/dashboard/ui-select.ts if necessary, modal motion CSS and lifecycle helpers as needed.

- Audit all expanding/collapsing mobile surfaces and overlays; retain ones already correct.
- Fix abrupt disclosures with grid rows, fade/slide and chevron rotation; ensure hidden controls cannot receive focus. Respect reduced motion.
- Align mobile modal smoke and 250 ms scale entry; ensure close lifecycle, flat modal actions and smooth menu/sheet transitions without breaking placement.
- Verify rapid toggles, open/close, reduced motion and model picker behavior. Run required controls and touched checks, commit.

### Task 3: Native stationary navigation feedback

Files: apps/android/app/src/main/java/com/ahmedmili/neoquiz/ui/NavBarView.kt and relevant JVM tests.

- Read history and Android RippleDrawable implementation to identify the initial flash cause.
- Remove the sparkle using supported native ripple configuration if verified; retain bounded Material ripple and 10% theme-derived color.
- Confirm no nav layout/position animation changes, run JVM tests and required checks, commit.

### Task 4: Read-only rendered verification and delivery

- Build, start isolated Electron on CDP 9231 with separate user data; capture baseline before implementation when possible.
- Inspect actual app at widths 360/393/430 with is-mobile and touch emulation. Capture rest/press/release per family. Verify scroll cancellation, reduced motion, overlays, console and overflow.
- Review the whole branch; fix findings and recheck. Add one Changed line to Unreleased.
- When the other report exists, merge android-bugs and build/install signed release from committed code in the specified clean release worktree. Verify read-only and capture.
- Stop only the isolated instance by its recorded PID. Write French RAPPORT.md with references, decisions, coverage, evidence, limitations and commits.
