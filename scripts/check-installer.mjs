import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { build } from "esbuild";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/**
 * BOOTSTRAPPER D'INSTALLATION — les invariants qui évitent de télécharger ou
 * lancer le mauvais exécutable.
 *
 * Ce script charge `apps/windows/installer/noyau.ts` par le même harnais que
 * les autres contrôles : aucune réplique de la sélection de release ni des
 * arguments NSIS ne vit ici. Il lit aussi les VRAIS fichiers de publication :
 * le bootstrapper n'est utile que si la release et le site le distribuent.
 *
 *     npm run check:installer
 */
const racine = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflow = readFileSync(resolve(racine, ".github/workflows/release.yml"), "utf8");
const ci = readFileSync(resolve(racine, ".github/workflows/ci.yml"), "utf8");
const autoRelease = readFileSync(resolve(racine, ".github/workflows/auto-release-desktop.yml"), "utf8");
const siteEn = readFileSync(resolve(racine, "docs/index.html"), "utf8");
const renduInstallateur = readFileSync(resolve(racine, "apps/windows/installer/renderer-reference.ts"), "utf8");
const principalInstallateur = readFileSync(resolve(racine, "apps/windows/installer/main.ts"), "utf8");
const principalUi = readFileSync(resolve(racine, "apps/windows/installer/main-ui.ts"), "utf8");
const preloadInstallateur = readFileSync(resolve(racine, "apps/windows/installer/preload.ts"), "utf8");
const travailleurInstallateur = readFileSync(resolve(racine, "apps/windows/installer/worker.ts"), "utf8");
const configBootstrapper = readFileSync(resolve(racine, "apps/windows/installer/electron-builder.config.mjs"), "utf8");
const configApplication = readFileSync(resolve(racine, "apps/windows/electron-builder.config.mjs"), "utf8");
const manifesteApp = JSON.parse(readFileSync(resolve(racine, "apps/windows/package.json"), "utf8"));
const verrouApp = JSON.parse(readFileSync(resolve(racine, "apps/windows/package-lock.json"), "utf8"));
/* Le correctif du conteneur portable : un fichier du DÉPÔT, appliqué à
   `node_modules` par `patch-package` au `postinstall`. Il se lit donc ici sans
   que `apps/windows/node_modules` existe — ce job de CI ne l'installe pas. */
const versionAppBuilder = verrouApp.packages?.["node_modules/app-builder-lib"]?.version ?? "";
const cheminCorrectif = resolve(racine, `apps/windows/patches/app-builder-lib+${versionAppBuilder}.patch`);
const correctifPortable = existsSync(cheminCorrectif) ? readFileSync(cheminCorrectif, "utf8") : "";
const protocoleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/protocole.ts"), "utf8");
const styleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/style-details.css"), "utf8");
const principalApplication = readFileSync(resolve(racine, "apps/windows/electron/main.ts"), "utf8");
const pontApplication = readFileSync(resolve(racine, "apps/windows/electron/pont.ts"), "utf8");
const preloadApplication = readFileSync(resolve(racine, "apps/windows/electron/preload.ts"), "utf8");
const canauxApplication = readFileSync(resolve(racine, "apps/windows/electron/canaux.ts"), "utf8");
const renduApplication = readFileSync(resolve(racine, "apps/windows/src/main.ts"), "utf8");

const noyauInstallateur = readFileSync(resolve(racine, "apps/windows/installer/noyau.ts"), "utf8");

/* The REAL entry point, bundled exactly as `installer/construire.mjs` does.
   Reading the sources cannot see that `main.ts` fell out of the bundle: from
   2026-09-27 (623e9360) `main-ui.ts` no longer imported it, and every
   installer shipped since opened no window (only the portable container's
   splash, forever) while all the checks stayed green. */
const bundlePrincipal = (await build({
	entryPoints: [resolve(racine, "apps/windows/installer/main-ui.ts")],
	bundle: true, write: false, platform: "node", format: "cjs", target: "node22",
	external: ["electron"], logLevel: "silent",
})).outputFiles[0].text;

await withSrcModule("apps/windows/installer/noyau.ts", ({ resoudrePaquet, paquetInstallable, progressionInstallation, suivre, suiviInitial, argumentsNsis, langueDepuisLocale, urlLegale, URL_LATEST_YML, urlLatestYml, versionEpinglee }) => {
	const r = makeReporter("Installateur — bootstrapper");
	/* Un PNG peut avoir un en-tête valide tout en affichant des pixels abîmés.
	   Décompresser les IDAT vérifie aussi leur somme de contrôle zlib. */
	let erreurBouclier = null;
	try {
		const png = readFileSync(resolve(racine, "apps/windows/installer/uac-shield.png"));
		if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("signature PNG invalide");
		const blocs = [];
		for (let position = 8; position < png.length;) {
			if (position + 12 > png.length) throw new Error("bloc PNG tronqué");
			const taille = png.readUInt32BE(position);
			const fin = position + 12 + taille;
			if (fin > png.length) throw new Error("données PNG tronquées");
			if (png.toString("ascii", position + 4, position + 8) === "IDAT") {
				blocs.push(png.subarray(position + 8, fin - 4));
			}
			position = fin;
		}
		if (!inflateSync(Buffer.concat(blocs)).length) throw new Error("pixels PNG absents");
	} catch (erreur) {
		erreurBouclier = erreur.message;
	}
	r.check("bouclier : les pixels du PNG se décompressent sans corruption", erreurBouclier, null);
	/* La SOURCE de la release. L'API REST de GitHub, sans jeton, refuse au-delà
	   de 60 appels par heure et par adresse IP : le bootstrapper 1.0.16 la
	   lisait et s'ouvrait sur « n'a pas pu être préparée » chez quiconque
	   partageait son IP avec 60 lancements dans l'heure — Ahmed le premier, le
	   soir des douze releases. La redirection `releases/…/download/` de
	   github.com n'a pas ce plafond, et `latest.yml` est le fichier
	   qu'electron-updater lit déjà. Casser l'un des trois fichiers → rouge. */
	r.check("source : le repli reste latest.yml par la redirection releases/latest",
		URL_LATEST_YML, "https://github.com/Neo-Quiz/neo-quiz/releases/latest/download/latest.yml");
	/* ÉPINGLÉ depuis la 1.5.0 : `NeoQuiz-X.Y.Z.exe` lit le `latest.yml` de SA
	   release, pas de la dernière. Un exe nommé 1.4.0 qui installait la 1.5.0
	   était une surprise, et c'est ce qui interdisait à la page de
	   téléchargement de le servir pour une ancienne version. */
	r.check("source : un bootstrapper X.Y.Z lit le latest.yml de la release desktop-vX.Y.Z",
		urlLatestYml("1.6.0"), "https://github.com/Neo-Quiz/neo-quiz/releases/download/desktop-v1.6.0/latest.yml");
	/* La version ENTRE DANS L'URL. Elle vient d'`app.getVersion()`, donc du
	   `package.json` embarqué — un fichier qu'un exe trafiqué peut porter.
	   Tout ce qui n'est pas `X.Y.Z` retombe sur `latest` : jamais un segment
	   composé avec ce qu'on nous donne. La répétition de la CI
	   (`0.0.0-repetition`) prend le même chemin, et c'est voulu : aucune
	   release ne porte ce numéro. */
	r.check("source : une version qui n'est pas X.Y.Z ne compose aucune URL et retombe sur latest",
		["0.0.0-repetition", "../../evil", "1.6.0/../../x", "", undefined, null, "v1.6.0", "1.6"].map(urlLatestYml),
		Array(8).fill("https://github.com/Neo-Quiz/neo-quiz/releases/latest/download/latest.yml"));
	r.check("source : versionEpinglee ne laisse passer que X.Y.Z",
		[versionEpinglee("1.6.0"), versionEpinglee("10.20.30"), versionEpinglee("1.6.0-beta"), versionEpinglee(" 1.6.0")],
		["1.6.0", "10.20.30", null, null]);
	// Un LITTÉRAL d'URL, pas le mot dans un commentaire qui explique l'interdit.
	r.check("source : aucun fichier du bootstrapper n'interroge api.github.com (60 req/h/IP)",
		[noyauInstallateur, principalInstallateur, travailleurInstallateur].map(f => /["'`]https:\/\/api\.github\.com/.test(f)),
		[false, false, false]);
	/* Le principal doit passer SA version, pas relire la constante de repli :
	   sinon l'épinglage existe dans le noyau et ne sert à personne. */
	r.check("source : le principal lit l'URL épinglée sur sa propre version",
		[principalInstallateur.includes("await fetch(urlLatestYml(app.getVersion())"),
			principalInstallateur.includes("await fetch(URL_LATEST_YML")],
		[true, false]);

	/* Le `latest.yml` d'electron-builder, tel que publié pour desktop-v1.0.16
	   (le vrai fichier, empreinte comprise) : le sous-ensemble YAML que le
	   noyau doit lire, ni plus ni moins. */
	const version = "1.0.16";
	const nom = `neo-quiz-setup-${version}.exe`;
	const sha512 = "VvB5vz58mqpsBD0AlFZhc5AqaJPxeEAHfdBDj4iu8j/sf41vbGKdVLeC6dr16Q9I1CuNc4tuOJzNcebd67ggvw==";
	const taille = 113062631;
	const latestYml = [
		`version: ${version}`,
		"files:",
		`  - url: ${nom}`,
		`    sha512: ${sha512}`,
		`    size: ${taille}`,
		`path: ${nom}`,
		`sha512: ${sha512}`,
		"releaseDate: '2026-09-15T19:41:31.633Z'",
		"",
	].join("\n");
	const attendu = {
		version,
		nom,
		url: `https://github.com/Neo-Quiz/neo-quiz/releases/download/desktop-v${version}/${nom}`,
		taille,
		sha512,
		tailleInstallee: null,
	};

	r.check("release : latest.yml donne le NSIS versionné, sa taille et son sha512",
		resoudrePaquet(latestYml), attendu);
	r.check("release : les fins de ligne Windows ne changent rien",
		resoudrePaquet(latestYml.replace(/\n/g, "\r\n")), attendu);
	r.check("release : le nom fixe `neo-quiz-setup.exe` n'est jamais installable",
		resoudrePaquet(latestYml.replace(new RegExp(nom, "g"), "neo-quiz-setup.exe")), null);
	r.check("release : sans empreinte sha512, rien n'est installable",
		resoudrePaquet(latestYml.replace(/^sha512: .*$/m, "")), null);
	r.check("release : une empreinte racine différente de l'entrée files est refusée",
		resoudrePaquet(latestYml.replace(/^sha512: .*$/m, `sha512: ${"A".repeat(86)}==`)), null);
	r.check("release : sans taille, rien n'est installable (progression et intégrité en dépendent)",
		resoudrePaquet(latestYml.replace(/^ {4}size: .*$/m, "")), null);
	r.check("release : une pré-version n'est jamais installée par le bootstrapper",
		resoudrePaquet(latestYml.replace(new RegExp(version, "g"), `${version}-beta.1`)), null);
	r.check("release : un texte sans rapport (page d'erreur HTML) ne vaut rien",
		resoudrePaquet("<!DOCTYPE html><html><body>Not Found</body></html>"), null);
	/* Le travailleur élevé reconstruit le paquet depuis les champs reçus : une
	   URL qui n'est pas celle que la version implique ne doit jamais passer. */
	r.check("travailleur : l'URL est déduite de la version, jamais lue",
		paquetInstallable({ version, nom, taille, sha512 })?.url, attendu.url);
	r.check("travailleur : un nom qui ne suit pas la version est refusé",
		paquetInstallable({ version, nom: "neo-quiz-setup-9.9.9.exe", taille, sha512 }), null);
	r.check("travailleur : une taille non entière ou nulle est refusée",
		[paquetInstallable({ version, nom, taille: 0, sha512 }), paquetInstallable({ version, nom, taille: 1.5, sha512 })],
		[null, null]);

	/* Le pourcentage d'installation compte les octets écrits contre
	   `installedSize`, publié par la CI sous une clé racine facultative de
	   `latest.yml`. Absente, non entière, nulle, négative, ou plus petite que
	   le setup lui-même → `tailleInstallee: null`, jamais une valeur devinée. */
	const tailleInstallee = 400_000_000;
	const latestYmlAvecTailleInstallee = `${latestYml}installedSize: ${tailleInstallee}\n`;
	r.check("installedSize : lue et validée quand elle est publiée",
		resoudrePaquet(latestYmlAvecTailleInstallee)?.tailleInstallee, tailleInstallee);
	r.check("installedSize : absente sur les releases qui ne la publient pas encore (1.0.0, 1.0.1)",
		resoudrePaquet(latestYml)?.tailleInstallee, null);
	r.check("installedSize : non entière, nulle, négative ou plus petite que le setup → null",
		[
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: 12.5 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: 0 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: -1 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille - 1 })?.tailleInstallee,
		],
		[null, null, null, null, null]);
	r.check("installedSize : un logiciel installé plus gros que son setup est accepté",
		paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille + 1 })?.tailleInstallee,
		taille + 1);

	/* `progressionInstallation` (noyau pur) : le calcul qui remplace le
	   comptage du SEUL dossier d'installation. La mesure du 2026-09-16
	   (`scripts/mesurer-installation.mjs`) a montré que NSIS n'y écrit que
	   pendant 6 à 12 % de la durée, et tout à la fin : ce que ces cas
	   éprouvent, c'est que la barre avance AUSSI pendant les étapes où ce
	   dossier ne bouge pas. Chaque cas est DISCRIMINANT — casser la règle
	   qu'il éprouve doit le faire rougir. */
	const paquet = 113_000_000;
	const installe = 390_000_000;
	const neuve = { paquet, installe, initial: 0 };
	const maj = { paquet, installe, initial: installe };
	const arrondi = valeur => (valeur === null ? null : Math.round(valeur * 10) / 10);
	const progression = (bareme, observation) =>
		arrondi(progressionInstallation(bareme, { ecoule: 0, dossier: 0, creux: 0, extrait: 0, dernier: null, ...observation }));

	r.check("progression : sans taille installée publiée, indéterminée de bout en bout",
		progression({ paquet, installe: null, initial: 0 },
			{ ecoule: 5_000, dossier: 200_000_000, extrait: 400_000_000 }), null);

	/* L'ÉTAPE AVEUGLE. NSIS ne dit rien pendant son démarrage (et, en mise à
	   jour, pendant la désinstallation de l'ancienne version) : ni octet dans
	   le dossier d'installation, ni octet notable dans le temporaire. C'est le
	   seul endroit du calcul qui avance au temps — il doit avancer VRAIMENT,
	   et ne jamais atteindre son palier. */
	r.check("aveugle : la barre part de zéro", progression(neuve, { ecoule: 0 }), 0);
	r.check("aveugle : la barre avance avec le temps",
		progression(neuve, { ecoule: 1_600 }) > progression(neuve, { ecoule: 400 }), true);
	r.check("aveugle : le palier de l'étape n'est jamais dépassé, même après une minute",
		progression(neuve, { ecoule: 60_000 }) <= 40, true);
	r.check("aveugle : la barre avance ENCORE après la durée mesurée de l'étape",
		progression(neuve, { ecoule: 6_000 }) > progression(neuve, { ecoule: 3_100 }), true);
	r.check("aveugle : une mise à jour monte plus haut (une étape aveugle de plus) mais plus lentement",
		[progression(maj, { ecoule: 1_600 }) < progression(neuve, { ecoule: 1_600 }),
			progression(maj, { ecoule: 60_000 }) > progression(neuve, { ecoule: 60_000 })],
		[true, true]);

	/* LE BRUIT DU DOSSIER TEMPORAIRE. NSIS y pose ses plugins (~136 Ko) dès la
	   première demi-seconde, et y recopie l'ancien désinstalleur (~226 Ko) en
	   mise à jour. Sans seuil, ces quelques centaines de kilooctets feraient
	   sauter la barre au palier d'extraction avant que rien ne soit extrait. */
	r.check("extraction : le bruit des plugins ne déclenche pas l'étape des octets",
		progression(neuve, { ecoule: 0, extrait: 3 * 1024 * 1024 }), 0);
	r.check("extraction : au-delà du seuil, la barre compte les octets du temporaire",
		progression(neuve, { ecoule: 0, extrait: (paquet + installe) / 2 }), 55);
	r.check("extraction : le total est l'archive PLUS son contenu extrait, qui y coexistent",
		progression(neuve, { ecoule: 0, extrait: paquet + installe }), 70);

	/* LA MISE EN PLACE. Le premier octet posé dans le dossier d'installation
	   fait quitter l'étape d'extraction, quelle que soit la valeur du
	   temporaire : c'est la dernière étape qui écrit. */
	r.check("mise en place : comptée depuis le CREUX, pas depuis zéro",
		progression(maj, { dossier: 10_000_000 + installe / 2, creux: 10_000_000, extrait: paquet + installe }), 89.5);
	r.check("mise en place : un dossier au niveau de son creux n'a encore rien reçu",
		progression(maj, { ecoule: 0, dossier: 10_000_000, creux: 10_000_000 }), 0);
	r.check("mise en place : une mise à jour qui RÉTRÉCIT ne publie aucun recul",
		progression(maj, { ecoule: 0, dossier: 0, creux: 0, dernier: 60 }), 60);
	r.check("mise en place : plafonnée à 99, jamais 100 avant le code de sortie 0 de NSIS",
		progression(neuve, { dossier: 10 * installe, creux: 0, extrait: paquet + installe }), 99);
	r.check("progression : jamais de valeur republiée en dessous de la précédente",
		progression(neuve, { ecoule: 0, extrait: (paquet + installe) / 2, dernier: 90 }), 90);

	/* LE RELEVÉ RÉEL D'UNE MISE À JOUR, mesuré le 2026-09-16 par
	   `npm run report:installation` — et la régression qu'il a attrapée AVANT
	   publication. Le désinstalleur d'electron-builder ne supprime pas
	   l'ancienne version sur place : il DÉPLACE le dossier d'installation dans
	   le dossier temporaire (d'où les 390 713 279 octets à 7 176 ms, pile le
	   poids de l'ancienne version) puis l'efface de là. Une première version
	   du correctif comptait ces octets comme de l'extraction et calait la
	   barre 1,6 seconde sur ce maximum. Ces trois cas rejouent le relevé par
	   `suivre`, le seul endroit où cette distinction se décide. */
	const baremeReel = { paquet: 113_062_565, installe: 389_985_505, initial: 390_211_664 };
	const releve = [
		[6_953, 390_211_664, 483_695],
		[7_065, 390_211_664, 483_695],
		[7_176, 0, 390_713_279],
		[7_290, 0, 322_257_850],
		[7_388, 0, 52_791_151],
		[7_497, 0, 113_175_094],
		[7_715, 0, 147_150_406],
		[8_476, 0, 245_857_175],
		[8_694, 0, 496_593_687],
		[9_234, 32_475_055, 503_160_599],
	];
	let suivi = suiviInitial(baremeReel);
	const publiees = [];
	for (const [ecoule, dossier, temporaire] of releve) {
		suivi = suivre(baremeReel, suivi, { ecoule, dossier, temporaire });
		publiees.push(arrondi(suivi.dernier));
	}
	r.check("relevé réel : l'ancienne version déplacée dans le temporaire ne compte pas comme extraction",
		publiees[3] < publiees[5], true);
	r.check("relevé réel : une fois la vraie extraction commencée, chaque relevé fait monter la barre",
		publiees.slice(5).every((valeur, index, tous) => index === 0 || valeur > tous[index - 1]), true);
	r.check("relevé réel : aucun recul sur toute la séquence",
		publiees.every((valeur, index, tous) => index === 0 || valeur >= tous[index - 1]), true);

	/* NSIS EFFACE SON DOSSIER TEMPORAIRE en partant, et rien ne garantit que
	   ce soit après la dernière mise en place : ce qui a été extrait ne doit
	   pas se dé-extraire. Sans le maximum, le sondage suivant retomberait
	   sous le seuil, donc dans l'étape aveugle. */
	/* LA DÉSINSTALLATION QUI ÉCHOUE ET SE RÉTRACTE, vue à l'écran le
	   2026-09-16 : `un.atomicRMDir` d'electron-builder déplace les fichiers
	   hors du dossier, la désinstallation échoue, il les REMET. Le dossier
	   retrouve sa taille ; le creux, lui, est un cliquet et garde la valeur
	   basse. Sans garde, `dossier - creux` valait des centaines de mégaoctets
	   et la barre affichait 84 % alors que rien n'avait été installé. */
	r.check("désinstallation rétractée : un dossier qui regrossit sans extraction n'est PAS une mise en place",
		(() => {
			let etat = suiviInitial(maj);
			etat = suivre(maj, etat, { ecoule: 1_000, dossier: maj.initial, temporaire: 100_000 });
			etat = suivre(maj, etat, { ecoule: 2_000, dossier: 200_000_000, temporaire: 100_000 });
			etat = suivre(maj, etat, { ecoule: 3_000, dossier: maj.initial, temporaire: 100_000 });
			return etat.dernier < 60;
		})(), true);

	r.check("extraction : ce qui est extrait ne se dé-extrait pas quand NSIS vide son temporaire",
		(() => {
			let etat = suiviInitial(neuve);
			etat = suivre(neuve, etat, { ecoule: 500, dossier: 0, temporaire: 0 });
			etat = suivre(neuve, etat, { ecoule: 1_000, dossier: 0, temporaire: 300_000_000 });
			const haut = etat.extrait;
			etat = suivre(neuve, etat, { ecoule: 1_200, dossier: 0, temporaire: 0 });
			return [haut > 0, etat.extrait === haut];
		})(), [true, true]);

	const dossier = "C:\\Program Files\\Neo Quiz";
	const args = argumentsNsis(dossier);
	/* PAR UTILISATEUR depuis le 2026-09-18, et le commutateur DOIT être
	   explicite : `assistedInstaller.nsh` choisit sinon son mode d'après le
	   REGISTRE, et une installation machine trouvée dans `HKLM` le ferait
	   repartir en mode machine — donc en UAC — malgré `perMachine: false`.
	   C'est tout l'objet de la bascule : plus d'élévation, ni à l'installation
	   ni à chaque mise à jour. */
	r.check("NSIS : le mode utilisateur est explicite", args[0], "/currentuser");
	r.check("NSIS : le mode silencieux est explicite", args.includes("/S"), true);
	r.check("NSIS : /D reste le dernier argument", args.at(-1), `/D=${dossier}`);

	/* Le site ne doit jamais retomber sur le NSIS visible. Le lien statique
	   mène à la release tant qu'aucun bootstrapper n'est publié ; dès que
	   `latest.json` porte un `NeoQuiz-X.Y.Z.exe`, le JS le remplace par
	   l'asset exact. Ce repli évite un 404 pendant la transition. */
	r.check("publication : release construit le bootstrapper",
		workflow.includes("npm run pack:installer"), true);
	r.check("publication : release attache le bootstrapper par son motif versionné",
		workflow.includes("apps/windows/dist-installer-bootstrapper/NeoQuiz-*.exe"), true);
	r.check("publication : l'alias NSIS public a disparu",
		workflow.includes("neo-quiz-setup.exe\n"), false);

	/* UN SEUL fichier public, nommé par `artifactName` comme `Obsidian-1.13.7.exe`.
	   La copie `-fr.exe` et l'ancien nom fixe ont disparu avec la langue « dans
	   le fichier » : la langue de l'installeur est celle de Windows. */
	r.check("publication : le nom public est versionné, via artifactName",
		configBootstrapper.includes('artifactName: "NeoQuiz-${version}.exe"'), true);
	r.check("publication : plus de copie française ni d'ancien nom fixe",
		[workflow.includes("-fr.exe"), workflow.includes("Install-NeoQuiz"), ci.includes("Install-NeoQuiz"),
			siteEn.includes("Install-NeoQuiz")],
		[false, false, false, false]);
	r.check("publication : la CI archive le bootstrapper par son motif",
		ci.includes("apps/windows/dist-installer-bootstrapper/NeoQuiz-*.exe"), true);

	const debutPromotion = workflow.indexOf("- name: Verify app release assets and promote latest");
	const debutLatestJson = workflow.indexOf("- name: Write latest.json from the release");
	const blocPromotion = debutPromotion >= 0 && debutLatestJson > debutPromotion
		? workflow.slice(debutPromotion, debutLatestJson)
		: "";
	/* `latest.yml` figure parmi les assets exigés AVANT la promotion : c'est
	   désormais le fichier que le bootstrapper lit par `releases/latest`, en
	   plus d'electron-updater. Promue sans lui, la release afficherait « n'a
	   pas pu être préparée » à tous les nouveaux venus. */
	r.check("publication : desktop devient latest seulement après les assets complets",
		[
			workflow.includes("make_latest: ${{ steps.version.outputs.product == 'app' }}"),
			workflow.includes('make_latest: "true"'),
			blocPromotion.includes('"NeoQuiz-${VERSION}.exe"'),
			blocPromotion.includes('"neo-quiz-setup-${VERSION}.exe"'),
			blocPromotion.includes('"latest.yml"'),
			blocPromotion.includes("-f make_latest=true"),
		],
		[false, false, true, true, true, true]);

	/* Deux portes vers release.yml (un bump poussé depuis chatgpt.com, et le
	   tag que `git ship` pousse d'un seul `--atomic` avec le commit) : la
	   seconde ne doit pas relancer un build que la première a déjà lancé. */
	r.check("publication : auto-release s'abstient dès que le tag existe sur origin",
		autoRelease.includes('git ls-remote --tags origin "refs/tags/$TAG"'), true);

	r.check("expérience : chargement immédiat, étape 3 directe et annulation partout",
		[
			principalInstallateur.includes('webContents.once("dom-ready"'),
			renduInstallateur.includes('etat.phase === "elevation" || etat.phase === "telechargement"'),
			renduInstallateur.includes('installer.cancelDialog.title'),
			/* DEUX raisons de griser, pas une : l'annulation déjà demandée, et
			   l'étape « démarrage » où il n'y a plus rien à annuler. Le bouton
			   reste AFFICHÉ dans les deux cas — le faire disparaître laisserait
			   croire qu'on a perdu le contrôle. */
			renduInstallateur.includes("annuler.disabled = !annulable || annulationDemandee"),
			principalInstallateur.includes('if (socketTravailleur) {'),
			travailleurInstallateur.includes('if (commande.type === "annuler") annulation.abort();'),
		],
		[true, true, true, true, true, true]);

	const debutProgression = renduInstallateur.indexOf("function rendreEtapeProgression");
	const debutDemarrage = renduInstallateur.indexOf("function rendreDemarrage", debutProgression);
	const blocProgression = debutProgression >= 0 && debutDemarrage > debutProgression
		? renduInstallateur.slice(debutProgression, debutDemarrage)
		: "";
	/* AUCUNE ÉTAPE NE REMPLACE L'AUTRE D'UN COUP, et l'animation ne se déclenche
	   QUE sur un changement d'étape. La condition est indispensable : un rendu
	   complet provoqué par autre chose — la modale de confirmation qui s'ouvre —
	   rejouerait sinon l'animation derrière elle, et on aurait recréé le
	   clignotement par un autre chemin. */
	r.check("étapes : transition à chaque changement, et seulement là",
		[
			renduInstallateur.includes("const changeEtape = etape !== derniereEtapeRendue;"),
			renduInstallateur.includes('if (changeEtape) contenu.lastElementChild?.classList.add("nqi-entre");'),
			styleInstallateur.includes(".nqi-entre {"),
		],
		[true, true, true]);

	/* UN MESSAGE DE PROGRESSION NE REBÂTIT PAS LA PAGE. Chaque message du
	   travailleur — toutes les 100 ms au téléchargement, 150 ms à
	   l'installation — passait par `rendre()`, donc par `replaceChildren()` :
	   la modale de confirmation était recréée dix fois par seconde et son
	   animation d'entrée rejouait sans fin (clignotement vu à l'écran le
	   2026-09-16), le bouton était recréé sous le curseur, et le FOCUS clavier
	   était détruit à chaque fois. Le rafraîchissement doit passer AVANT le
	   rendu complet, et `rendre()` doit oublier les nœuds qu'il détruit. */
	r.check("progression : un message qui avance la barre ne reconstruit pas le DOM",
		[
			renduInstallateur.includes("if (phasePrecedente === nouvelEtat.phase && rafraichirProgression()) return;"),
			renduInstallateur.includes("progressionVive = null;"),
		],
		[true, true]);

	/* L'étape « démarrage » garde la rangée d'actions, Annuler grisé, avec
	   l'infobulle qui dit pourquoi. Sans ce cas, la rangée pourrait disparaître
	   à nouveau sans que rien ne rougisse — et c'est précisément ce qui faisait
	   croire que le bouton « ne marche pas ». */
	const debutDemarrageSeul = renduInstallateur.indexOf("function rendreDemarrage");
	const blocDemarrage = debutDemarrageSeul >= 0
		? renduInstallateur.slice(debutDemarrageSeul, renduInstallateur.indexOf("\n}", debutDemarrageSeul))
		: "";
	r.check("annulation : la rangée d'actions reste pendant « démarrage », grisée et expliquée",
		[
			blocDemarrage.includes("rendreActionsProgression(etape, false)"),
			renduInstallateur.includes('t("installer.cancelUnavailable")'),
		],
		[true, true]);

	r.check("expérience : mentions légales absentes à partir de l'étape 3",
		[blocProgression.includes("rendreLegal("), renduInstallateur.includes("rendreLegal(panneau);")],
		[false, true]);

	r.check("fin installation : spinner dans l'installeur jusqu'à ce que l'app soit prête",
		[
			principalInstallateur.includes('envoyerEtat({ phase: "demarrage" });'),
			protocoleInstallateur.includes('phase: "demarrage"'),
			renduInstallateur.includes('if (etat.phase === "demarrage")'),
			renduInstallateur.includes('rendreDemarrage(contenu);'),
			renduInstallateur.includes('installer.status.launching'),
			styleInstallateur.includes(".nqi-launching-stage"),
			renduInstallateur.includes('fermer.disabled = etat.phase === "demarrage";'),
			principalInstallateur.includes("let fenetreDemarrage: BrowserWindow | null = null;"),
			principalInstallateur.includes('mode: "launch"'),
			renduInstallateur.includes('modeAffichage === "launch"'),
		],
		[true, true, true, true, true, true, true, false, false, false]);

	r.check("fin installation : la vraie app devient visible seulement quand elle est prête",
		[
			principalApplication.includes('fenetre.once("ready-to-show", () => fenetre?.show())'),
			pontApplication.includes("prete(): Promise<void>;"),
			pontApplication.includes('fenetrePrete: "neo:fenetre/prete"'),
			preloadApplication.includes("prete: () => ipcRenderer.invoke(CANAUX.fenetrePrete)"),
			canauxApplication.includes("ipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());"),
			principalApplication.includes("if (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;"),
			renduApplication.includes("void demarrer().finally(() =>"),
			renduApplication.includes("pont().fenetre.prete()"),
			principalInstallateur.includes("attendreFenetreApplication(pid)"),
		],
		[false, true, true, true, true, true, true, true, true]);

	/* LE BOOTSTRAPPER N'EST PLUS COMPRESSÉ depuis le 2026-09-22 (`fd8b23a`),
	   retour sur la décision du 2026-09-17 (`82c0c42`, `normal`, 97 Mo).
	   MESURÉ en local, double-clic → fenêtre Electron : 3,7 s en `normal`,
	   0,9 s en `store` ; l'exe passe à ~314 Mo, accepté pour que la fenêtre
	   soit là dès le clic.
	   Ce qui reste vrai, et que ce cas garde : la SECONDE extraction est
	   toujours évitée — le principal relance `process.execPath` et ne repasse
	   jamais par `PORTABLE_EXECUTABLE_FILE` (il ne lit que
	   `PORTABLE_EXECUTABLE_DIR`, pour savoir qu'un aperçu attend son signal). */
	r.check("démarrage : le bootstrapper n'est pas compressé et évite la seconde extraction",
		[
			configBootstrapper.includes('compression: "store"'),
			configBootstrapper.includes('compression: "normal"'),
			principalInstallateur.includes('const executable = process.execPath;'),
			// Le code, pas le commentaire qui explique pourquoi on ne le relit plus.
			principalInstallateur.includes("process.env.PORTABLE_EXECUTABLE_FILE"),
		],
		[true, false, true, false]);

	/* LE CONTENEUR PORTABLE NE DÉMARRE PLUS EN SILENCE, NI SUR UNE PAGE CLAIRE.

	   `portable.nsi` d'electron-builder pose `SetSilent silent` : rien à
	   l'écran tant qu'Electron n'est pas extrait puis démarré. De `e46e0b7` à
	   `fd8b23a`, une page de progression NSIS claire comblait ce vide ; depuis
	   `fd8b23a` (2026-09-22), le conteneur peint `installer/ecran-initial.bmp`
	   — le premier écran de l'installeur, rendu par Electron — dans une
	   fenêtre sans bordure à la place exacte de la fenêtre Electron (mesuré :
	   ~60 ms, même rectangle 720×640), et ne la retire qu'au SIGNAL écrit par
	   le principal une fois sa propre fenêtre peinte par-dessus.

	   Le correctif vit dans un patch du dépôt : l'option native
	   `portable.splashImage` peindrait un fond PLEIN ÉCRAN (BgImage), détruit
	   dès le lancement d'Electron — pire que le silence. Ce qui est gardé :
	   - l'image est déclarée, et le gabarit patché la peint dans une fenêtre
	     STATIC (et non BgImage) ;
	   - elle n'est retirée qu'au signal `neo-quiz-splash-done`, écrit par le
	     principal sous le même nom ;
	   - l'archive est extraite DIRECTEMENT dans le dossier temporaire, au lieu
	     d'être extraite puis RECOPIÉE (312 Mo d'écriture en moins).

	   Le nom du fichier porte la version d'`app-builder-lib` : un `npm update`
	   qui la change fait tomber `correctifPortable` à vide et rougir ce cas —
	   c'est le seul rappel qu'un gabarit neuf doit être re-patché. */
	r.check("démarrage : le conteneur portable montre le premier écran au lieu de se taire",
		[
			manifesteApp.scripts?.postinstall === "patch-package",
			manifesteApp.devDependencies?.["patch-package"] !== undefined,
			configBootstrapper.includes('splashImage: "installer/ecran-initial.bmp"'),
			correctifPortable.includes("-    BgImage::SetBg $PLUGINSDIR\\splash.bmp"),
			correctifPortable.includes('t "STATIC"'),
			correctifPortable.includes('+!define NEO_QUIZ_SPLASH_DONE "neo-quiz-splash-done"'),
			principalInstallateur.includes('const SIGNAL_ECRAN_INITIAL = "neo-quiz-splash-done";'),
			correctifPortable.includes("-      !insertmacro extractEmbeddedAppPackage"),
			correctifPortable.includes("+      !insertmacro extractEmbeddedAppPackageDirectly"),
		],
		[true, true, true, true, true, true, true, true, true]);

	/* CE QUE LE CONTENEUR N'EMBARQUE PAS — et ce qu'il garde.

	   Tout ce que le portable embarque est réécrit sur le disque de
	   l'utilisateur AVANT la première fenêtre, et payé une seconde fois au
	   téléchargement. Deux retraits, mesurés sur trois répétitions :
	   les 53 `.pak` de langues que l'installeur ne sait pas parler
	   (`LangueInstallateur` n'a que `en` et `fr`) et le compilateur HLSL
	   d'exécution, qui ne sert qu'à WebGPU et à D3D12 — 102,2 Mo d'exe et
	   4,35 s d'attente deviennent 88,2 Mo et 3,70 s.

	   Ce qui RESTE embarqué compte autant : `vk_swiftshader.dll`,
	   `vulkan-1.dll` et `d3dcompiler_47.dll` (11 Mo) sont les replis d'une
	   machine sans GPU utilisable — le poste même qui a motivé ce chantier —
	   et `LICENSES.chromium.html` (20 Mo) accompagne obligatoirement une
	   redistribution binaire de Chromium. Un futur dégraissage les verrait
	   comme les trois plus gros fichiers restants ; ce cas dit pourquoi ils
	   sont là.

	   L'APPLICATION ne suit PAS ce régime : elle s'installe une fois et vit
	   ensuite sur le disque, où rien ne se réextrait. Copier ces réglages dans
	   sa config amputerait l'installé pour économiser sur ce qui ne coûte
	   plus rien. */
	r.check("conteneur : seules les langues que l'installeur parle, et pas le compilateur HLSL",
		[
			configBootstrapper.includes('electronLanguages: ["en-US", "fr"]'),
			configBootstrapper.includes('"dxcompiler.dll", "dxil.dll"'),
			configBootstrapper.includes("vk_swiftshader.dll"),
			configBootstrapper.includes("LICENSES.chromium.html"),
			// L'application garde tout : ni langues coupées, ni fichier retiré.
			configApplication.includes("electronLanguages"),
			configApplication.includes("afterPack"),
		],
		[true, true, true, true, false, false]);

	/* La langue de l'installeur est celle de WINDOWS (`app.getLocale()`), la
	   même déduction que l'application en mode « auto ». Plus de langue « dans
	   le fichier » (nom `-fr.exe`, flux `Zone.Identifier`), plus d'écriture de
	   `language` dans les réglages de l'app : moins fiable que le système, et
	   deux assets pour un seul exe. */
	r.check("langue : la locale française, sous ses trois formes, vaut « fr »",
		["fr", "fr-FR", "fr_CA"].map(langueDepuisLocale), ["fr", "fr", "fr"]);
	r.check("langue : toute autre locale vaut « en » (l'interface n'a que deux langues)",
		["en-US", "de-DE", "", "frites"].map(langueDepuisLocale), ["en", "en", "en", "en"]);
	r.check("langue : le principal lit Windows et n'écrit plus les réglages de l'application",
		[
			principalInstallateur.includes("langue = langueDepuisLocale(app.getLocale());"),
			principalInstallateur.includes("Zone.Identifier"),
			principalInstallateur.includes("settings.json"),
			noyauInstallateur.includes("langueDepuisNom"),
		],
		[true, false, false, false]);

	/* Les deux liens du texte légal étaient des <span> sans cible jusqu'à la
	   1.0.16. Ils ouvrent maintenant les pages du site, par un canal qui ne
	   reçoit qu'un NOM de page : l'URL est composée par le noyau. Toujours en
	   anglais depuis le 2026-09-27 : le site n'a plus de version française. */
	r.check("légal : l'URL est composée depuis deux constantes, en anglais",
		[urlLegale("terms"), urlLegale("privacy")],
		["https://neo-quiz.github.io/terms.html", "https://neo-quiz.github.io/privacy.html"]);
	r.check("légal : les deux pages existent dans docs/",
		["docs/terms.html", "docs/privacy.html"].map(f => existsSync(resolve(racine, f))),
		[true, true]);
	r.check("légal : les liens de l'installeur sont cliquables et passent par le canal nommé",
		[
			renduInstallateur.includes('lienLegal(ligne, "terms", t("installer.legal.terms"));'),
			renduInstallateur.includes('lienLegal(ligne, "privacy", t("installer.legal.privacy"));'),
			renduInstallateur.includes("window.neoInstaller.ouvrirLien(page);"),
			preloadInstallateur.includes("ipcRenderer.send(CANAUX_INSTALLATEUR.ouvrirLien, page)"),
			principalUi.includes('if (page !== "terms" && page !== "privacy") return;'),
			principalUi.includes("shell.openExternal(urlLegale(page))"),
			renduInstallateur.includes('"span", "nqi-legal-link"'),
		],
		[true, true, true, true, true, true, false]);

	r.check("bundle principal : la fenêtre, le travailleur et le signal du splash y sont",
		[
			bundlePrincipal.includes("new import_electron.BrowserWindow("),
			bundlePrincipal.includes("--neo-quiz-installer-worker"),
			bundlePrincipal.includes("neo-quiz-splash-done"),
			bundlePrincipal.includes("requestSingleInstanceLock"),
		],
		[true, true, true, true]);

	for (const [langue, site] of [["EN", siteEn]]) {
		r.check(`site ${langue} : Windows ne pointe plus sur l'ancien NSIS`,
			site.includes("releases/latest/download/neo-quiz-setup.exe"), false);
		// Un seul installeur, retrouvé par MOTIF : la page ne porte aucune version.
		r.check(`site ${langue} : Windows cible le bootstrapper versionné par son motif`,
			[
				site.includes("var MOTIF_INSTALLEUR_WINDOWS = /^NeoQuiz-\\d+\\.\\d+\\.\\d+\\.exe$/i;"),
				site.includes("trouverActif(donnees.assets, MOTIF_INSTALLEUR_WINDOWS)"),
				site.includes('afficherVersion("windows", donnees, MOTIF_INSTALLEUR_WINDOWS, null)'),
			],
			[true, true, true]);
		/* Le choix de version est REVENU le 2026-09-18 (il n'existait plus depuis
		   `16e1f21`). Ce qui reste interdit, et ce que ce cas garde, c'est le
		   FAUX choix : un bootstrapper publié AVANT l'épinglage lit
		   `releases/latest/download/latest.yml` en dur et installe la DERNIÈRE
		   version quelle que soit la sienne. Le menu ne liste que la dernière
		   release et les releases épinglées, et ne sert JAMAIS un autre asset
		   que le bootstrapper : servir le NSIS brut (`neo-quiz-setup-X.Y.Z.exe`,
		   sans fenêtre, sous un autre nom) pour les anciennes a été essayé et
		   refusé par Ahmed le jour même — ces versions sortent du menu. Le
		   plancher est FIGÉ dans la page faute de source lisible, et doit rester
		   celui de la release qui a introduit `urlLatestYml` : plus bas, la page
		   servirait un bootstrapper figé sur `latest` pour une ancienne version
		   — le mensonge de départ. Et le menu ne liste que les tags de
		   l'APPLICATION : les releases du greffon (`X.Y.Z` nu) partagent le même
		   flux et ne portent aucun installeur Windows. */
		r.check(`site ${langue} : le menu ne propose que des versions dont le bootstrapper tient parole`,
			[
				site.includes("activerSelecteurVersion();"),
				site.includes('var PREMIERE_VERSION_EPINGLEE = "1.6.0";'),
				site.includes("return String(release.tag_name || \"\") === tagDernier || bootstrapperEpingle(version);"),
				site.includes("var actif = trouverActif(release.assets, MOTIF_INSTALLEUR_WINDOWS);"),
				site.includes("var MOTIF_TAG_APP = /^desktop-v\\d+\\.\\d+\\.\\d+$/;"),
				// Le NSIS brut ne revient pas dans le menu : aucun MOTIF ni LITTÉRAL
				// qui le désigne — pas le nom entre accents graves dans le commentaire
				// qui explique l'interdit (le script de la page n'écrit ses chaînes
				// qu'entre guillemets).
				/\/\^neo-quiz-setup-|["']neo-quiz-setup-/.test(site),
			],
			[true, true, true, true, true, false]);
		r.check(`site ${langue} : le pied de page mène aux deux pages légales`,
			[site.includes('href="terms.html"'), site.includes('href="privacy.html"')], [true, true]);
	}
	/* Le site n'est plus qu'en anglais depuis le 2026-09-27 : plus de page
	   française, plus de sélecteur ni de devinette de langue. Les anciens liens
	   `/fr/…` (installeurs déjà publiés) repartent vers la page anglaise par la
	   404 de la racine, comme le préfixe `/neo-quiz/` d'avant le dépôt du site. */
	const page404 = readFileSync(resolve(racine, "docs/404.html"), "utf8");
	r.check("site : anglais seul, anciens chemins /fr/ et /neo-quiz/ redirigés",
		[
			existsSync(resolve(racine, "docs/fr")),
			siteEn.includes("nq-langue"),
			siteEn.includes('href="fr/'),
			page404.includes('.replace(/^\\/neo-quiz(?=\\/|$)/, "")'),
			page404.includes('.replace(/^\\/fr(?=\\/|$)/, "")'),
		],
		[false, false, false, true, true]);

	r.done();
});

/* THE PRESENTATION SHARED BY THE BOOTSTRAPPER AND THE UPDATE WINDOW
   (`installer/presentation.ts`). The update window must show the same steps as
   the installer: this pins the phase -> (percent, label, detail) mapping both
   consume, and the phase the update window derives from what it can observe. */
await withSrcModule("apps/windows/installer/presentation.ts", ({ libellesProgression, etatFenetreMaj, formatPourcent, formatOctets, detailTelechargement }) => {
	const r = makeReporter("Présentation partagée (installeur et fenêtre de mise à jour)");
	const verif = libellesProgression({ phase: "verification" }, null);
	r.check("vérification : barre indéterminée, un libellé, aucun détail",
		[verif.pourcent, verif.statut.length > 0, verif.detail], [null, true, null]);
	const sans = libellesProgression({ phase: "installation", pourcent: null }, null);
	r.check("installation sans pourcentage : indéterminée, libellé distinct de la vérification",
		[sans.pourcent, sans.statut !== verif.statut], [null, true]);
	const avec = libellesProgression({ phase: "installation", pourcent: 42.5 }, null);
	r.check("installation à 42,5 % : la barre porte 42,5 et le libellé le pourcentage formaté",
		[avec.pourcent, avec.statut.includes(formatPourcent(42.5)), avec.statut !== sans.statut], [42.5, true, true]);
	const dl = libellesProgression({ phase: "telechargement", recus: 50_000_000, total: 200_000_000 }, null);
	r.check("téléchargement : 25 %, octets reçus et total dans le détail",
		[dl.pourcent, dl.detail?.includes(formatOctets(50_000_000)), dl.detail?.includes(formatOctets(200_000_000))], [25, true, true]);
	r.check("téléchargement : un débit connu ajoute un temps restant",
		detailTelechargement(50_000_000, 200_000_000, 5_000_000) !== detailTelechargement(50_000_000, 200_000_000, null), true);
	const demarrage = libellesProgression({ phase: "demarrage" }, null);
	r.check("démarrage : barre pleine", demarrage.pourcent, 100);
	r.check("fenêtre de mise à jour : l'appli encore là = vérification, partie = installation (avec le pourcentage)",
		[etatFenetreMaj(true, 50), etatFenetreMaj(false, null), etatFenetreMaj(false, 63)],
		[{ phase: "verification" }, { phase: "installation", pourcent: null }, { phase: "installation", pourcent: 63 }]);
	r.done();
});
