/* THE CODE SANDBOX'S PRELOAD — distinct from `preload.ts`: this window
   receives NO channel from the app. Three functions, nothing else: receive
   a job, receive a warm-up request, render a result. The code itself runs
   in a worker, which this world never reaches. */
import { contextBridge, ipcRenderer } from "electron";
import type { CodeJob, CodeLanguage, CodeRun } from "./code-sandbox";
import { CANAUX_BAC } from "./code-canaux";

contextBridge.exposeInMainWorld("neoCode", {
	surTravail: (cb: (job: CodeJob & { id: number }) => void) => {
		ipcRenderer.on(CANAUX_BAC.travail, (_e, job: CodeJob & { id: number }) => cb(job));
	},
	surChauffe: (cb: (language: CodeLanguage) => void) => {
		ipcRenderer.on(CANAUX_BAC.chauffe, (_e, language: CodeLanguage) => cb(language));
	},
	rendre: (id: number, res: CodeRun) => ipcRenderer.send(CANAUX_BAC.resultat, id, res),
	pret: (id: number) => ipcRenderer.send(CANAUX_BAC.pret, id),
});
