/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — L'EXÉCUTION DE CODE, UN PASSE-PLAT VERS LE PRINCIPAL

   `HostCode` (src/host/types.ts) côté RENDU. Ce module n'exécute rien :
   le code part au bac à sable du principal (electron/code-sandbox.ts), fenêtre
   cachée sans disque ni réseau (spec 2026-09-23-exercice-python-design.md
   §3). Un pont qui rejette (fenêtre fermée pendant l'appel) devient
   `unavailable`, jamais une exception dans la carte. Seul Python est câblé
   jusqu'au bout pour l'instant (tâche 8 pour le duo C/C++).
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
