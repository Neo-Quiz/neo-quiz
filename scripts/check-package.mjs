/**
 * L'EMPAQUETAGE — la configuration résolue d'electron-builder, et le paquet
 * s'il existe.
 *
 * Ce que ce script empêche, et qu'une relecture ne voit pas :
 *   - une version qui diverge entre le package de l'application et son
 *     lockfile (deux numéros, l'un jamais suivi) ;
 *   - un `appId` ou un `executableName` changé « par cohérence » : le premier
 *     est la clé de registre par laquelle NSIS retrouve l'installation à
 *     remplacer (le changer fait de chaque mise à jour une seconde
 *     installation), le second est le nom du binaire dans l'AppImage — et un
 *     caractère interdit dedans (`@`) a fait échouer chaque run CI Linux
 *     jusqu'au 2026-09-12 ;
 *   - `deleteAppDataOnUninstall` passé à vrai : la mise à jour désinstalle
 *     l'ancienne version, et perdrait les réglages avec elle ;
 *   - `node_modules` et les sourcemaps dans l'asar (3 659 fichiers de poids
 *     mort au 2026-09-12 : `chokidar` est bundlé par esbuild, `lucide` par Vite).
 *
 *     npm run check:package
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { makeReporter } from "./lib/load-src.mjs";
import { reecrireLatestYml } from "./update-info-after-signing.mjs";

/* `signtoolOptions.publisherName` n'est pas encore posé : le CN du
   certificat ne se lit que dans le journal CI, sur le premier exe signé par
   `release-signing`. Cette constante changera dans le MÊME commit que
   `electron-builder.config.mjs` quand ce CN sera connu — une valeur qui ne
   correspond pas EXACTEMENT au certificat fait refuser chaque mise à jour. */
const PUBLISHER_ATTENDU = null;

function sha512Base64(chemin) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha512");
		createReadStream(chemin)
			.on("data", (bloc) => hash.update(bloc))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("base64")));
	});
}

const racine = fileURLToPath(new URL("..", import.meta.url));
const appWindows = `${racine}apps/windows/`;
const uninstallerNsis = readFileSync(`${appWindows}installer/uninstaller.nsh`, "utf8");
const noyauInstalleur = readFileSync(`${appWindows}installer/noyau.ts`, "utf8");

const r = makeReporter("Empaquetage — configuration résolue");

const { default: configurer } = await import(pathToFileURL(`${appWindows}electron-builder.config.mjs`).href);
const config = await configurer();
const application = JSON.parse(await readFile(`${appWindows}package.json`, "utf8"));
const lockfile = JSON.parse(await readFile(`${appWindows}package-lock.json`, "utf8"));

r.check("le lockfile suit la version de l'application",
	[lockfile.version, lockfile.packages?.[""]?.version], [application.version, application.version]);
r.check("appId est immuable", config.appId, "com.ahmed.neoquiz");
r.check("executableName est immuable et sûr pour un chemin",
	[config.executableName, /^[a-z0-9.-]+$/.test(config.executableName ?? "")], ["neo-quiz", true]);
r.check("les artefacts ont un nom sans espace",
	[config.win?.artifactName, config.linux?.artifactName],
	["neo-quiz-setup-${version}.${ext}", "neo-quiz-${version}-${arch}.${ext}"]);
/* LES TROIS SORTIES LINUX. Une cible perdue ne fait rougir aucun build : la
   release sortirait simplement sans son .deb ou sans son ARM64, et la page de
   téléchargement offrirait un lien mort. Et `${arch}` dans le nom n'est pas
   décoratif : sans lui les deux AppImage s'écrasent (voir la note de la config). */
r.check("Linux produit AppImage x64, AppImage arm64 et deb amd64",
	(Array.isArray(config.linux?.target) ? config.linux.target : [])
		.map(cible => `${cible.target}:${(cible.arch ?? []).join(",")}`).sort(),
	["AppImage:x64,arm64", "deb:x64"].sort());
/* Les deux champs SANS LESQUELS LE BUILD LINUX ENTIER S'ARRÊTE — la cible
   `deb` les exige, les AppImage non, et c'est ainsi que la release 1.0.6 est
   sortie sans sa partie Linux. Leur disparition doit rougir ici, pas en CI. */
r.check("le .deb a la page d'accueil et le mainteneur qu'il exige",
	[config.extraMetadata?.homepage, (config.linux?.maintainer ?? "").includes("@")],
	["https://neo-quiz.github.io/", true]);
/* Le champ Maintainer voyage dans chaque paquet public. */
r.check("le mainteneur du .deb ne publie pas d'adresse personnelle",
	/users\.noreply\.github\.com>$/.test(config.linux?.maintainer ?? ""), true);
/* CE QUE `apt show neo-quiz` AFFICHE. Aucune de ces trois valeurs ne fait
   échouer un build — c'est pour ça qu'elles manquaient toutes les trois dans
   le .deb 1.0.7, dont le control file portait « Description: » vide et
   « License: unknown ». Elles ne se voient qu'en lisant le paquet produit. */
r.check("le .deb se présente : description, licence, résumé, catégorie",
	[
		(config.extraMetadata?.description ?? "").length > 20,
		config.extraMetadata?.license,
		(config.linux?.synopsis ?? "").length > 10,
		config.deb?.packageCategory,
	],
	[true, "MIT", true, "education"]);
/* LES DÉPENDANCES QUI DÉCIDENT SI LE PAQUET S'INSTALLE. Les défauts
   d'electron-builder précèdent la transition `t64` de Debian ; sur une Debian
   testing (Kali) les noms renommés pourraient ne plus résoudre. La forme
   `ancien | nouveau` marche dans les deux cas. Et le recommandé par défaut,
   `libappindicator3-1`, a été retiré de Debian trixie. */
r.check("les dépendances renommées par la transition t64 ont leur alternative",
	["libgtk-3-0", "libnotify4", "libatspi2.0-0", "libsecret-1-0"]
		.filter(nom => !(config.deb?.depends ?? []).includes(`${nom} | ${nom}t64`)),
	[]);
r.check("le .deb ne recommande pas un paquet retiré de Debian",
	(config.deb?.recommends ?? ["libappindicator3-1"]).length, 0);
r.check("le nom des artefacts Linux porte l'architecture",
	(config.linux?.artifactName ?? "").includes("${arch}"), true);
r.check("la fenêtre Linux est associée à son entrée .desktop",
	[config.linux?.desktop?.entry?.Name, config.linux?.desktop?.entry?.StartupWMClass],
	["Neo Quiz", "neo-quiz"]);
r.check("files exclut node_modules et les sourcemaps",
	[config.files.includes("!node_modules/**"), config.files.includes("!dist-electron/**/*.map")],
	[true, true]);
r.check("la désinstallation garde les données", config.nsis?.deleteAppDataOnUninstall, false);
/* L'INSTALLATION EST PAR UTILISATEUR, ET CE CAS EXISTE POUR QU'ELLE LE RESTE.

   `perMachine: true` définit `INSTALL_MODE_PER_ALL_USERS` chez
   electron-builder, qui met `RequestExecutionLevel admin` dans le MANIFESTE de
   l'installeur : Windows élève avant que NSIS ne démarre, et l'invite UAC
   revient à CHAQUE mise à jour — celles-ci relancent le même installeur. C'est
   le défaut corrigé le 2026-09-18, et il ne se voit nulle part ailleurs : le
   paquet se construit, se signe et s'installe exactement pareil. Seul
   l'utilisateur le voit, une fenêtre à la fois.

   Le commutateur du bootstrapper va avec (`/currentuser`,
   `installer/noyau.ts`) : sans lui, une installation trouvée dans `HKLM`
   ferait repartir NSIS en mode machine, donc en UAC, malgré cette clé. */
r.check("l'installation reste par utilisateur (pas d'élévation à chaque mise à jour)",
	config.nsis?.perMachine, false);
r.check("le bootstrapper lance l'installeur en mode utilisateur",
	{ currentuser: noyauInstalleur.includes('"/currentuser"'), allusers: noyauInstalleur.includes('"/allusers"') },
	{ currentuser: true, allusers: false });
r.check("désinstallation : fenêtre native minimale avec seulement la progression réelle",
	[
		config.nsis?.oneClick,
		config.nsis?.perMachine,
		uninstallerNsis.includes("removeDefaultUninstallWelcomePage"),
		uninstallerNsis.includes("MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationSimple"),
		uninstallerNsis.includes('SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Neo Quiz"'),
		uninstallerNsis.includes("SetCtlColors $NeoQuizFond 000000 F6F6F6"),
		uninstallerNsis.includes("SetCtlColors $NeoQuizCadreProgression 000000 BFC1C4"),
		uninstallerNsis.includes("SetCtlColors $NeoQuizPisteProgression 000000 E5E5E5"),
		uninstallerNsis.includes("SetCtlColors $NeoQuizRemplissageProgression 000000 00B83F"),
		uninstallerNsis.includes("PBM_GETPOS"),
		uninstallerNsis.includes("NeoQuizRemplissageProgression"),
		uninstallerNsis.includes("IntOp $R1 330 * $R0"),
		uninstallerNsis.includes("IntOp $R2 116 * $R0"),
		uninstallerNsis.includes("Désinstallation en cours..."),
		uninstallerNsis.includes("NeoQuizBarreTitre"),
		uninstallerNsis.includes("CreateRoundRectRgn"),
		uninstallerNsis.includes("NeoQuizAnimerSpinner"),
		uninstallerNsis.includes('"STR:$R2%"'),
	],
	[false, false, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false]);
r.check("author.name est celui attendu par winget et SignPath", config.extraMetadata?.author?.name, "Ahmed Mili");
r.check("publisherName n'est posé qu'une fois le CN du certificat connu",
	config.win?.signtoolOptions?.publisherName ?? null, PUBLISHER_ATTENDU);
/* LA CLÉ `publish` : c'est elle qui fait générer `latest*.yml` et embarquer
   `app-update.yml` — sans elle, electron-updater n'a aucun flux à lire et
   se tait. Le dépôt est FIXE : un rendu ne choisit jamais d'où vient une
   mise à jour. */
/* La clé `installedSize` du pourcentage d'installation (`apps/windows/
   installer/noyau.ts`, `progressionInstallation`) doit traverser la
   signature INTACTE : `reecrireLatestYml` ne cible que les lignes
   `sha512:`/`size:`, jamais `installedSize:`. */
r.check("la réécriture après signature préserve installedSize",
	reecrireLatestYml(
		["version: 1.0.2", "files:", "  - url: a.exe", "    sha512: AAA", "    size: 10", "path: a.exe",
			"sha512: AAA", "installedSize: 314159265", "releaseDate: 'x'", ""].join("\n"),
		{ sha512: "BBB", size: "20" },
	),
	["version: 1.0.2", "files:", "  - url: a.exe", "    sha512: BBB", "    size: 20", "path: a.exe",
		"sha512: BBB", "installedSize: 314159265", "releaseDate: 'x'", ""].join("\n"));
r.check("publish vise les releases GitHub du dépôt",
	[config.publish?.provider, config.publish?.owner, config.publish?.repo],
	["github", "Neo-Quiz", "neo-quiz"]);
r.done();

/* LE PAQUET, s'il a été construit (`npm run pack:win` laisse `win-unpacked/`).
   `@electron/asar` est une dépendance transitive d'electron-builder : on la
   résout depuis `apps/windows`, sans l'ajouter aux dépendances. */
const asar = `${appWindows}dist-installer/win-unpacked/resources/app.asar`;
if (existsSync(asar)) {
	const p = makeReporter("Empaquetage — contenu de app.asar");
	const require = createRequire(`${appWindows}package.json`);
	const { listPackage } = require("@electron/asar");
	const chemins = listPackage(asar).map(c => c.replace(/\\/g, "/"));
	p.check("aucun node_modules dans l'asar", chemins.filter(c => c.includes("/node_modules/")).length, 0);
	p.check("aucune sourcemap dans l'asar", chemins.filter(c => c.endsWith(".map")).length, 0);
	p.check("les deux sorties sont là",
		[chemins.includes("/dist-electron/main.cjs"), chemins.includes("/dist-electron/preload.cjs"), chemins.includes("/dist/index.html")],
		[true, true, true]);
	for (const f of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
		p.check(`Embedded Pyodide: ${f}`, chemins.some(c => c.endsWith(`/dist-electron/code/pyodide/${f}`)), true);
	}
	/* Le paquet porte son flux (`app-update.yml`, écrit par electron-builder à
	   côté de l'asar), et le dossier de sortie porte les métadonnées que la
	   release publie. La version de `latest.yml` DOIT être celle du manifeste :
	   c'est elle qu'electron-updater compare à `app.getVersion()`. */
	const updatePath = `${appWindows}dist-installer/win-unpacked/resources/app-update.yml`;
	p.check("app-update.yml est dans le paquet", existsSync(updatePath), true);
	/* `app-update.yml` est ce qu'electron-updater lit au démarrage installé
	   pour savoir où chercher une mise à jour : provider github, dépôt fixe —
	   sans quoi il ne saurait pas qu'il doit lire /releases/latest. */
	const updateBrut = existsSync(updatePath) ? readFileSync(updatePath, "utf8") : "";
	p.check("app-update.yml vise les releases GitHub du dépôt",
		[/^provider:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim(),
			/^owner:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim(),
			/^repo:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim()],
		["github", "Neo-Quiz", "neo-quiz"]);
	const latest = `${appWindows}dist-installer/latest.yml`;
	p.check("latest.yml existe à côté de l'installeur", existsSync(latest), true);
	p.check("latest.yml porte la version de l'application",
		existsSync(latest) ? /^version:\s*(.+)$/m.exec(readFileSync(latest, "utf8"))?.[1]?.trim() : null,
		application.version);
	/* `installedSize` alimente le pourcentage d'installation du bootstrapper
	   (`apps/windows/installer/noyau.ts`, `progressionInstallation`) : sans
	   elle, il reste indéterminé. `scripts/write-installed-size.mjs` doit
	   l'avoir écrite dans le MÊME `pack:win` que celui qui a produit
	   `win-unpacked` — une tolérance de ±2 % couvre le léger écart entre le
	   dossier mesuré et le fichier `latest.yml` généré au même instant. */
	const latestYmlBrut = existsSync(latest) ? readFileSync(latest, "utf8") : "";
	const installedSizePubliee = Number(/^installedSize:\s*(.+)$/m.exec(latestYmlBrut)?.[1]?.trim());
	p.check("latest.yml porte installedSize", Number.isInteger(installedSizePubliee) && installedSizePubliee > 0, true);
	const dossierWinUnpacked = `${appWindows}dist-installer/win-unpacked`;
	if (existsSync(dossierWinUnpacked)) {
		const tailleReelleWinUnpacked = await (async function tailleDossier(dossier) {
			const { readdir, stat } = await import("node:fs/promises");
			let total = 0;
			for (const entree of await readdir(dossier, { withFileTypes: true })) {
				const chemin = `${dossier}/${entree.name}`;
				if (entree.isDirectory()) total += await tailleDossier(chemin);
				else if (entree.isFile()) total += (await stat(chemin)).size;
			}
			return total;
		})(dossierWinUnpacked);
		const ecart = Math.abs(installedSizePubliee - tailleReelleWinUnpacked) / tailleReelleWinUnpacked;
		p.check("installedSize correspond au vrai win-unpacked (±2 %)", ecart <= 0.02, true);
	}
	/* Le contrôle qui rougit si l'exe a été remplacé (par ex. par sa version
	   signée) sans repasser par `scripts/update-info-after-signing.mjs` :
	   `latest.yml` et le blockmap décriraient alors un fichier qui n'existe
	   plus, et electron-updater rejetterait la mise à jour chez chaque
	   utilisateur. */
	const latestBrut = existsSync(latest) ? readFileSync(latest, "utf8") : "";
	const nomExe = /^path:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
	const cheminExe = nomExe ? `${appWindows}dist-installer/${nomExe}` : null;
	p.check("latest.yml nomme un exe présent dans dist-installer",
		cheminExe ? existsSync(cheminExe) : false, true);
	if (cheminExe && existsSync(cheminExe)) {
		const attenduSha512 = /^\s*sha512:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
		const attenduTaille = /^\s*size:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
		const obtenuSha512 = await sha512Base64(cheminExe);
		const obtenuTaille = String((await readFile(cheminExe)).length);
		p.check("le sha512 de l'exe correspond à latest.yml", obtenuSha512, attenduSha512);
		p.check("la taille de l'exe correspond à latest.yml", obtenuTaille, attenduTaille);
		p.check("le blockmap de l'exe existe", existsSync(`${cheminExe}.blockmap`), true);
	}
	p.done();
} else {
	console.log("Empaquetage — contenu de app.asar : aucun paquet local (npm run pack:win), groupe sauté");
}
