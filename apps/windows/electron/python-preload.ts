/* LE PRÉCHARGEMENT DU BAC À SABLE PYTHON — distinct de `preload.ts` :
   cette fenêtre ne reçoit AUCUN canal de l'app. Trois fonctions, et rien
   d'autre : recevoir un travail, recevoir une demande de chauffe, rendre
   un résultat. Python tourne dans un worker, qui n'atteint pas ce monde. */
import { contextBridge, ipcRenderer } from "electron";
import type { PythonJob, PythonRun } from "../../../src/host/types";
import { CANAUX_BAC } from "./python-canaux";

contextBridge.exposeInMainWorld("neoPython", {
	surTravail: (cb: (job: PythonJob & { id: number }) => void) => {
		ipcRenderer.on(CANAUX_BAC.travail, (_e, job: PythonJob & { id: number }) => cb(job));
	},
	surChauffe: (cb: () => void) => {
		ipcRenderer.on(CANAUX_BAC.chauffe, () => cb());
	},
	rendre: (id: number, res: PythonRun) => ipcRenderer.send(CANAUX_BAC.resultat, id, res),
	pret: (id: number) => ipcRenderer.send(CANAUX_BAC.pret, id),
});
