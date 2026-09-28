/* ══════════════════════════════════════════════════════════
   THE WINDOWS HOST — CODE EXECUTION, A PASS-THROUGH TO THE MAIN PROCESS

   `HostCode` (src/host/types.ts) on the RENDERER side. This module runs
   nothing itself: the code goes to the main process's sandbox
   (electron/code-sandbox.ts), a hidden window with no disk or network
   access (spec 2026-09-23-exercice-python-design.md §3). A bridge call that
   rejects (window closed mid-call) becomes `unavailable`, never an
   exception on the card. Only Python is wired end to end for now (task 8
   for the C/C++ pair).
══════════════════════════════════════════════════════════ */

import type { HostCode, CodeRun } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

export function createWindowsCode(pont: () => Pont): HostCode {
	return {
		languages: () => ["python"],
		run: job => pont().code.run(job).catch((): CodeRun => ({ status: "unavailable", stdout: "" })),
		warm: language => { void pont().code.warm(language).catch(() => undefined); },
	};
}
