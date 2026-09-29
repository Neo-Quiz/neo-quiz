import { openTestSetupModal } from "../../../../src/engine/test-setup-modal";
import type { TestSetupHost } from "../../../../src/engine/test-launch";
import { isExamSetup } from "../../../../src/test-setup";
import type { TestSetupsApp } from "../review/test-setups";

/* ══════════════════════════════════════════════════════════
   THE APP'S SIDE OF "SET UP YOUR TEST" (spec 2026-09-29-test-setup-modal-design.md
   §1-§2): what the engine's `testSetup.choose` does in this app.

   - Opens the modal on the settings last used for this quiz (else the
     engine's default, the file's own); the modal asks the player.
   - Remembers what was chosen, per quiz path.
   - Never writes the note: "Keep exam mode" lives in the quiz's "⋯" menus
     (`dashboard/exam-keep-menu.ts`). A quiz whose note says `mode: "exam"`
     still opens with Exam mode on, through the engine's default.
   - Cancelling remembers nothing.

   `choose` is called at launch AND on "Try again", and cannot tell them
   apart: the FIRST call of a page is the launch. Only a cancelled launch
   closes the page (`launchCancelled`); a cancelled retry leaves the engine on
   its results.
══════════════════════════════════════════════════════════ */

export interface TestSetupPage {
	/** What the engine gets as `testSetup`. */
	host: TestSetupHost;
	/** True when a modal is open. */
	modalOpen(): boolean;
	/** Closes the open modal, if any: `choose` then answers `null`. */
	cancelModal(): void;
	/** The launch was cancelled: the player never started this test. */
	launchCancelled(): boolean;
}

export interface TestSetupPageOptions {
	path: string;
	/** The quiz's title, shown in the modal. */
	title: string;
	remembered: TestSetupsApp;
}

export function createTestSetupPage(opts: TestSetupPageOptions): TestSetupPage {
	let first = true;
	let cancelledLaunch = false;
	let abort: AbortController | null = null;

	const host: TestSetupHost = {
		async choose(defaults, questionCount, examByDefault) {
			const launch = first;
			first = false;
			const controller = new AbortController();
			abort = controller;
			/* A retry proposes the setup just played; a launch, what was last used.
			   Except that a note which keeps Exam mode always opens on an Exam: a
			   plain test played since (one-off) must not hide what the menu's
			   "Keep exam mode" says. An Exam played last still brings back its
			   duration. */
			const last = launch ? opts.remembered.read(opts.path) : null;
			const choice = await openTestSetupModal({
				title: opts.title,
				questionCount,
				defaults: last && (!examByDefault || isExamSetup(last)) ? last : defaults,
			}, controller.signal);
			if (abort === controller) abort = null;
			if (choice === null) {
				if (launch) cancelledLaunch = true;
				return null;
			}
			opts.remembered.remember(opts.path, choice);
			return choice;
		},
	};

	return {
		host,
		modalOpen: () => abort !== null,
		cancelModal: () => abort?.abort(),
		launchCancelled: () => cancelledLaunch,
	};
}
