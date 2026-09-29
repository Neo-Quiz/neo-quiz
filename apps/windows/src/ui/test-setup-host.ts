import { saveKeepExam } from "../../../../src/dashboard/detail-io";
import type { KeepExam } from "../../../../src/dashboard/exam-keep";
import { openTestSetupModal } from "../../../../src/engine/test-setup-modal";
import type { TestSetupHost } from "../../../../src/engine/test-launch";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { keepExamChange } from "../../../../src/test-setup";
import type { TestSetupsApp } from "../review/test-setups";

/* ══════════════════════════════════════════════════════════
   THE APP'S SIDE OF "SET UP YOUR TEST" (spec 2026-09-29-test-setup-modal-design.md
   §1-§2): what the engine's `testSetup.choose` does in this app.

   - Opens the modal on the settings last used for this quiz (else the
     engine's default, the file's own); the modal asks the player.
   - Remembers what was chosen, per quiz path.
   - Writes "Keep exam mode" into the note, through `detail-io`'s single
     write path, only when the test is STARTED and only when it changes what
     the note says (`keepExamChange`).
   - Cancelling writes nothing and remembers nothing.

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
	/** The block's source as read when the page opened: the compare-and-swap witness. */
	block: string;
	/** The note says `mode: "exam"`, and its duration in minutes. */
	kept: boolean;
	minutes: number | null;
	/** The note can hold "Keep exam mode" (any Test; a Learn never asks). */
	canKeep: boolean;
	remembered: TestSetupsApp;
}

export function createTestSetupPage(opts: TestSetupPageOptions): TestSetupPage {
	let first = true;
	let cancelledLaunch = false;
	let abort: AbortController | null = null;
	/* What the note says NOW: updated after each successful write, so a "Try
	   again" compares with the note as it is, not as it was on opening. */
	let block = opts.block;
	let kept = opts.kept;
	let minutes = opts.minutes;

	/** Writes the change; on success, follows the note (its new block is the
	    next witness). A refused write is said, once, and the test starts anyway. */
	async function writeKeep(change: KeepExam): Promise<void> {
		if (await saveKeepExam(opts.path, block, change)) {
			kept = change !== null;
			minutes = change ? change.minutes : null;
			try {
				const source = await currentHost().fs.read(opts.path);
				const match = source.match(QUIZ_BLOCK_RE);
				if (match) block = match[1];
			} catch {
				// The witness stays stale: the next write is refused rather than blind.
			}
			return;
		}
		currentHost().ui.notice(t("engine.testSetup.keepFailed"));
	}

	const host: TestSetupHost = {
		async choose(defaults, questionCount) {
			const launch = first;
			first = false;
			const controller = new AbortController();
			abort = controller;
			const choice = await openTestSetupModal({
				title: opts.title,
				questionCount,
				// A retry proposes the setup just played; a launch, what was last used.
				defaults: launch ? (opts.remembered.read(opts.path) ?? defaults) : defaults,
				examByDefault: kept,
				canKeep: opts.canKeep,
			}, controller.signal);
			if (abort === controller) abort = null;
			if (choice === null) {
				if (launch) cancelledLaunch = true;
				return null;
			}
			opts.remembered.remember(opts.path, choice.setup);
			if (opts.canKeep) {
				const change = keepExamChange(kept, minutes, choice.setup, choice.keep);
				if (change !== undefined) await writeKeep(change);
			}
			return choice.setup;
		},
	};

	return {
		host,
		modalOpen: () => abort !== null,
		cancelModal: () => abort?.abort(),
		launchCancelled: () => cancelledLaunch,
	};
}
