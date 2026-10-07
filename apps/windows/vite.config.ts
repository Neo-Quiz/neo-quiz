import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

/*
 * L'app importe le code partagé par CHEMIN RELATIF (../../../src/…), sans
 * alias, sans symlink, sans copie. C'est la décision D2 du plan : Neo Calendar
 * a 132 fichiers de même nom entre ses deux dépôts, dont 83 ont divergé. Une
 * mécanique qui rend la copie possible finit par en produire une ; un chemin
 * relatif ne peut pas diverger, il n'y a qu'un fichier au bout.
 *
 * `server.fs.allow` est la contrepartie obligatoire : par défaut Vite refuse
 * de SERVIR un fichier hors de son propre dossier, et sans cette ligne le
 * serveur de développement renverrait 403 sur chaque import de `src/`.
 * Le build de production, lui, n'en a pas besoin — d'où un échec qui
 * n'apparaît qu'en `dev`.
 */
const racineDepot = fileURLToPath(new URL("../../", import.meta.url));

/* The app version, for the manifest of a shared archive (`ui/partage.ts`). */
const versionApp = (JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string }).version;

export default defineConfig({
	define: { __APP_VERSION__: JSON.stringify(versionApp) },
	clearScreen: false,
	/*
	 * `./` et non `/` : la fenêtre Electron charge `dist/index.html` par
	 * `loadFile`, donc en `file://`, où un chemin ABSOLU (« /assets/… ») désigne
	 * la racine du DISQUE et non celle du paquet. Sans cette ligne, le rendu
	 * construit s'ouvre sur une page blanche, aucune feuille et aucun script
	 * chargés — et rien dans la console d'un navigateur ordinaire ne l'aurait
	 * montré, puisque le serveur de développement, lui, sert bien « / ».
	 */
	base: "./",
	server: {
		port: 1421,
		strictPort: true,
		fs: { allow: [racineDepot] },
		/* `dist-electron/` est la sortie du PROCESSUS PRINCIPAL, reconstruite à
		   chaque `npm run dev` : la surveiller ferait recharger la page du rendu
		   pour un fichier qu'elle ne charge pas. */
		watch: { ignored: ["**/dist-electron/**"] },
	},
	/*
	 * CodeMirror est une dépendance de l'APP, mais c'est le code partagé
	 * (`src/editor/champ-direct.ts`) qui l'importe : résolu depuis `src/`, il
	 * trouverait la copie de la racine du dépôt (tirée par `obsidian`), et un
	 * autre module pourrait trouver celle de l'app. Deux instances de
	 * `@codemirror/state` font refuser les extensions de l'une par l'autre
	 * (« Unrecognized extension value »). `dedupe` force l'unique copie de
	 * `apps/windows/node_modules`, celle que fixe son lockfile.
	 */
	resolve: { dedupe: ["@codemirror/state", "@codemirror/view"] },
	envPrefix: ["VITE_"],
	build: {
		target: "es2021",
		cssMinify: "esbuild",
		outDir: "dist",
		sourcemap: true,
	},
});
