/**
 * LE REFLET DE L'INSTALLATION — ce dont dépend qu'une mise à jour aboutisse.
 *
 * `apps/windows/electron/fenetre-maj-liens.ts` est du Node pur : ce contrôle
 * tourne sur de VRAIS dossiers temporaires, comme `check:electron-fs`. Il
 * n'éprouve pas la fenêtre (Electron ne se charge pas ici) mais ce qui la rend
 * possible ET SANS DANGER — car le risque n'est pas qu'elle soit laide, c'est
 * qu'elle EMPÊCHE la mise à jour qu'elle accompagne.
 *
 * Trois défauts réels, chacun silencieux, sont tenus ici :
 *
 * 1. UN REFLET À MOITIÉ FAIT. `refleter` renonce au premier échec. Un arbre
 *    Electron incomplet ne lance pas une fenêtre dégradée : il lance un
 *    processus qui meurt, ou pire, qui affiche une erreur Chromium par-dessus
 *    une mise à jour en cours.
 * 2. UN EXÉCUTABLE QUI GARDE SON NOM. C'est par le NOM DE FICHIER que NSIS tue
 *    (`nsProcess::KillProcess "neo-quiz.exe"`). Un reflet qui garderait le nom
 *    d'origine donnerait une fenêtre tuée à la seconde même où elle devient
 *    utile — et rien ne le dirait, puisque la mise à jour, elle, réussirait.
 * 3. UN NETTOYAGE TROP LARGE, OU TROP ÉTROIT. Trop large, il emporte le
 *    temporaire d'un autre programme ; trop étroit, il laisse des liens durs
 *    qui, l'original disparu, pèsent le poids entier de l'ancienne version.
 *
 *     npm run check:fenetre-maj
 */
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Un faux arbre d'installation : un exécutable, un fichier de données, un
    sous-dossier — la forme d'un paquet Electron, en trois fichiers. */
async function arbreFactice(base, nomExecutable) {
	const dossier = await mkdtemp(join(base, "faux-install-"));
	await writeFile(join(dossier, nomExecutable), "MZ-exe");
	await writeFile(join(dossier, "icudtl.dat"), "donnees");
	await mkdir(join(dossier, "resources"), { recursive: true });
	await writeFile(join(dossier, "resources", "app.asar"), "asar");
	return dossier;
}

async function listerRecursif(racine) {
	const sortie = [];
	for (const entree of await readdir(racine, { withFileTypes: true })) {
		if (entree.isDirectory()) {
			for (const enfant of await listerRecursif(join(racine, entree.name))) {
				sortie.push(`${entree.name}/${enfant}`);
			}
		} else {
			sortie.push(entree.name);
		}
	}
	return sortie.sort();
}

async function existe(chemin) {
	try {
		await stat(chemin);
		return true;
	} catch {
		return false;
	}
}

await withSrcModule("apps/windows/electron/fenetre-maj-liens.ts", async ({
	cheminTemoin,
	donneesMajDepuisArguments,
	langueDepuisArguments,
	marquerDemarrage,
	nettoyerLiensMaj,
	NOM_EXECUTABLE_MAJ,
	PREFIXE_LIENS,
	preparerReflet,
	refleter,
	versionDepuisArguments,
	DRAPEAU_FENETRE_MAJ,
}) => {
	const r = makeReporter("Mise à jour — le reflet de l'installation");
	const base = await mkdtemp(join(tmpdir(), "quiz-maj-"));
	try {
		/* ── Le reflet ── */
		const source = await arbreFactice(base, "neo-quiz.exe");
		const cible = join(base, "reflet");
		await mkdir(cible, { recursive: true });
		const fait = await refleter(source, cible, "neo-quiz.exe");
		r.check("reflet : l'arbre entier est repris, sous-dossiers compris", fait, true);
		r.check("reflet : chaque fichier est là, et l'exécutable a CHANGÉ DE NOM",
			await listerRecursif(cible),
			[NOM_EXECUTABLE_MAJ, "icudtl.dat", "resources/app.asar"].sort());

		/* Le point le plus important du module : ce sont les MÊMES octets, pas
		   une copie. Un lien dur partage son numéro d'inœud avec l'original ;
		   une copie en aurait un autre, et pèserait le poids de l'arbre. */
		const original = await stat(join(source, "neo-quiz.exe"));
		const reflet = await stat(join(cible, NOM_EXECUTABLE_MAJ));
		r.check("reflet : lien DUR, pas copie — mêmes octets sur le disque",
			[reflet.ino === original.ino, reflet.nlink >= 2],
			[true, true]);

		/* Une source absente ne doit pas produire un demi-reflet silencieux. */
		r.check("reflet : une source introuvable échoue, elle ne réussit pas à vide",
			await refleter(join(base, "nexiste-pas"), join(base, "vide"), "neo-quiz.exe"), false);

		/* ── La préparation complète ── */
		const source2 = await arbreFactice(base, "neo-quiz.exe");
		const exeLie = await preparerReflet(source2, "neo-quiz.exe", base);
		r.check("préparation : renvoie l'exécutable à lancer, sous son nouveau nom",
			typeof exeLie === "string" && exeLie.endsWith(NOM_EXECUTABLE_MAJ), true);
		r.check("préparation : le dossier porte le préfixe que le nettoyage reconnaît",
			exeLie.slice(base.length + 1).startsWith(PREFIXE_LIENS), true);

		/* Un arbre SANS l'exécutable attendu : le reflet réussirait (les autres
		   fichiers se lient), mais il n'y aurait rien à lancer. Sans ce cas, on
		   lancerait un chemin inexistant et la mise à jour partirait sans
		   fenêtre — en ayant laissé un dossier derrière elle. */
		const sansExe = await mkdtemp(join(base, "sans-exe-"));
		await writeFile(join(sansExe, "icudtl.dat"), "donnees");
		const avantSansExe = (await readdir(base)).length;
		r.check("préparation : sans l'exécutable attendu, elle renonce",
			await preparerReflet(sansExe, "neo-quiz.exe", base), null);
		r.check("préparation : et elle ne laisse AUCUN demi-reflet derrière elle",
			(await readdir(base)).length, avantSansExe);

		/* L'AUTRE chemin d'échec : le reflet lui-même se casse en route (source
		   disparue, volume différent — `link` ne traverse pas les volumes). Le
		   dossier déjà créé doit repartir avec lui, sinon le nettoyage suivant
		   prendrait ce squelette pour un reflet valide. */
		const avantSourceMorte = (await readdir(base)).length;
		r.check("préparation : un reflet interrompu renonce",
			await preparerReflet(join(base, "source-disparue"), "neo-quiz.exe", base), null);
		r.check("préparation : et le dossier entamé repart avec lui",
			(await readdir(base)).length, avantSourceMorte);

		/* ── Le nettoyage ── */
		const intrus = join(base, "temporaire-d-un-autre");
		await mkdir(intrus, { recursive: true });
		await nettoyerLiensMaj(base);
		r.check("nettoyage : les reflets sont emportés", await existe(exeLie), false);
		r.check("nettoyage : ce qui ne porte pas le préfixe est LAISSÉ INTACT",
			await existe(intrus), true);

		/* ── Le témoin de fin ── */
		const temoin = cheminTemoin(base);
		r.check("témoin : il n'existe pas tant que l'application n'a pas démarré",
			await existe(temoin), false);
		const avant = Date.now();
		await marquerDemarrage(base);
		const info = await stat(temoin);
		r.check("témoin : le démarrage de l'application l'écrit, daté d'après",
			[await existe(temoin), info.mtimeMs >= avant - 1000], [true, true]);

		/* ── Les arguments, qui viennent d'un PROCESSUS et non de nous ── */
		const argv = ["neo-quiz-maj.exe", DRAPEAU_FENETRE_MAJ, "1.11.0", "fr", "--user-data-dir=X"];
		r.check("arguments : la version et la langue sont relues telles qu'écrites",
			[versionDepuisArguments(argv), langueDepuisArguments(argv)], ["1.11.0", "fr"]);
		r.check("arguments : sans le drapeau, rien n'est lu",
			[versionDepuisArguments(["neo-quiz.exe"]), langueDepuisArguments(["neo-quiz.exe"])], ["", "en"]);
		/* La version est AFFICHÉE dans la fenêtre : tout ce qui n'est pas un
		   `X.Y.Z` est écarté plutôt que peint à l'écran. */
		r.check("arguments : une version qui n'est pas X.Y.Z n'est pas affichée",
			["1.11", "v1.11.0", "<img src=x>", "1.11.0-beta", ""].map(v =>
				versionDepuisArguments([DRAPEAU_FENETRE_MAJ, v, "fr"])),
			["", "", "", "", ""]);
		r.check("arguments : une langue inconnue retombe sur l'anglais",
			["de", "FR", "", "fr-FR"].map(l => langueDepuisArguments([DRAPEAU_FENETRE_MAJ, "1.11.0", l])),
			["en", "en", "en", "en"]);

		const dossierAbs = join(base, "install");
		const valides = donneesMajDepuisArguments([DRAPEAU_FENETRE_MAJ, "1.11.0", "fr",
			"--neo-quiz-maj-paquet=123", "--neo-quiz-maj-installe=456", `--neo-quiz-maj-dossier=${dossierAbs}`, "--neo-quiz-maj-pid=789"]);
		r.check("arguments de mesure : valeurs valides lues",
			valides, { paquet: 123, installe: 456, dossier: dossierAbs, pid: 789 });
		const abimes = donneesMajDepuisArguments([DRAPEAU_FENETRE_MAJ, "1.11.0", "fr",
			"--neo-quiz-maj-paquet=-5", "--neo-quiz-maj-installe=1e9", "--neo-quiz-maj-dossier=relatif/x", "--neo-quiz-maj-pid=abc"]);
		r.check("arguments de mesure : négatif, notation, chemin relatif ou pid non numérique écartés",
			abimes, { paquet: 0, installe: null, dossier: null, pid: null });
		r.check("arguments de mesure : absents = rien à mesurer",
			donneesMajDepuisArguments([DRAPEAU_FENETRE_MAJ, "1.11.0", "fr"]), { paquet: 0, installe: null, dossier: null, pid: null });

	} finally {
		await rm(base, { recursive: true, force: true }).catch(() => undefined);
	}

	r.done();
});
