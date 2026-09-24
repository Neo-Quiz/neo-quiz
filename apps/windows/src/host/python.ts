/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — L'EXÉCUTION PYTHON, UN PASSE-PLAT VERS LE PRINCIPAL

   `HostPython` (src/host/types.ts) côté RENDU. Ce module n'exécute rien :
   le code part au bac à sable du principal (electron/python.ts), fenêtre
   cachée sans disque ni réseau (spec 2026-09-23-exercice-python-design.md
   §3). Un pont qui rejette (fenêtre fermée pendant l'appel) devient
   `unavailable`, jamais une exception dans la carte.
══════════════════════════════════════════════════════════ */

import type { HostPython, PythonRun } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

export function createWindowsPython(pont: () => Pont): HostPython {
	return {
		run: job => pont().python.run(job).catch((): PythonRun => ({ status: "unavailable", stdout: "" })),
		warm: () => { void pont().python.warm().catch(() => undefined); },
	};
}
