/* Preload of the update window (`fenetre-maj.ts`): one function, minimise.
   The main process checks the sender before acting, so nothing else is
   reachable from the page. Built to CommonJS like the other preloads
   (`sandbox: true`, see `construire.mjs`). */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("neoMaj", {
	reduire: (): void => ipcRenderer.send("neo-maj-reduire"),
});
