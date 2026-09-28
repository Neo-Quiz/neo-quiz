/* ══════════════════════════════════════════════════════════
   THE WINDOWS HOST — CODE EXECUTION, A PASS-THROUGH TO THE MAIN PROCESS

   `HostCode` (src/host/types.ts) on the RENDERER side. This module runs
   nothing itself: the code goes to the main process's sandbox
   (electron/code-sandbox.ts), a hidden window with no disk or network
   access (spec 2026-09-23-exercice-python-design.md §3). A bridge call that
   rejects (window closed mid-call) becomes `unavailable`, never an
   exception on the card. C and C++ are offered before their pack is
   installed: ▶ then downloads it through `installer` (task 10) — one pack,
   `"c"`, serves both.
══════════════════════════════════════════════════════════ */

import type { HostCode, CodeRun } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

export function createWindowsCode(pont: () => Pont): HostCode {
	return {
		languages: () => ["python", "c", "cpp"],
		run: job => pont().code.run(job).catch((): CodeRun => ({ status: "unavailable", stdout: "" })),
		warm: language => { void pont().code.warm(language).catch(() => undefined); },
		installer: async (language, onProgress) => {
			// Python is built in: nothing to download.
			if (language !== "c" && language !== "cpp") return "ok";
			try {
				const res = await pont().langages.installer("c", (received, total) => onProgress(Math.floor((received * 100) / Math.max(1, total))));
				if (res.ok) return "ok";
				return res.code === "empreinte" ? "refused" : "offline";
			} catch {
				return "offline";
			}
		},
	};
}
