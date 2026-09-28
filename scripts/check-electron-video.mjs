/**
 * Vérification du LANCEMENT de yt-dlp par le processus principal
 * (apps/windows/electron/video.ts) — tâche 2 du chantier « vidéos YouTube »
 * (docs/superpowers/plans/2026-09-22-videos-youtube.md).
 *
 * CE QUE CES CAS EMPÊCHENT, et qu'aucun typecheck ne voit :
 * — un identifiant hors regex qui ferait lancer yt-dlp sur une URL composée
 *   de n'importe quoi (il est revalidé AVANT tout lancement, et l'URL est
 *   reconstruite, jamais reçue de la fenêtre) ;
 * — un chemin d'exécutable venu du rendu : la résolution est copie gérée
 *   PUIS recherche sur un PATH étendu, jamais un paramètre ;
 * — des arguments qui dériveraient de la liste figée (les arguments exacts
 *   des deux appels sont relus dans le journal du faux yt-dlp) ;
 * — un dossier temporaire qui survivrait à une transcription ;
 * — un yt-dlp qui traîne après le délai (l'ARBRE est tué, pas le seul
 *   parent — le faux dort, et le témoin est son pid) ;
 * — une miniature en échec qui ferait échouer la transcription (elle vaut
 *   null, jamais bloquant) ;
 * — plus de DEUX transcriptions en parallèle.
 *
 * SUR DE VRAIS PROCESS : le faux yt-dlp est la FIXTURE
 * scripts/fixtures/video/faux-youtube.mjs (un script qui lance Node, le
 * lanceur du nom demandé — `.cmd` sous Windows, un sh ailleurs — les deux
 * formes d'une vraie installation), écrit dans un dossier temporaire et
 * INJECTÉ par l'environnement donné — jamais installé sur la machine,
 * jamais le vrai PATH. Le faux journalise ses appels dans un fichier pour
 * que le contrôle puisse dire « aucun appel n'a eu lieu ».
 *
 *     npm run check:electron-video
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Le nom sous lequel la résolution cherche yt-dlp sur CETTE plateforme
    (`extensionsExecutables`) : `yt-dlp.exe` sous Windows, `yt-dlp` sur le
    runner Linux de la CI, où un `yt-dlp.exe` n'était jamais vu. */
const NOM_EXE_SYSTEME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

/** Le délai de garde d'UN cas : de vrais process tournent, un cas figé
    masquerait tous les suivants (voir check-electron-process.mjs). */
const DELAI_CAS_MS = 60000;

async function cas(r, nom, fn) {
	let minuteur = null;
	const garde = new Promise((_, reject) => {
		minuteur = setTimeout(() => reject(new Error("DÉLAI DÉPASSÉ (" + DELAI_CAS_MS + " ms) : le cas n'a jamais rendu la main")), DELAI_CAS_MS);
	});
	try {
		await Promise.race([fn(), garde]);
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	} finally {
		clearTimeout(minuteur);
	}
}

const dodo = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── LE FAUX YT-DLP ──
   Ses trois comportements sont clés par l'IDENTIFIANT de la vidéo
   (déduit de l'URL que `transcrire` reconstruit), comme la spec les
   décrit : « Private video » est le marqueur VERBATIM de yt-dlp pour
   une vidéo privée/supprimée/restreinte (sonde et spec §3.2) — donnée
   de test, pas une chaîne d'interface. Le sommeil est réglable par
   l'environnement : les 5 s de production doivent être éprouvables en
   millisecondes. Le source du faux vit dans la FIXTURE
   scripts/fixtures/video/faux-youtube.mjs — lisible, citable tel
   quel : le contrôle le recopie dans le dossier du faux. */
const FAUX_MJS = join("scripts", "fixtures", "video", "faux-youtube.mjs");

/** Le lanceur du nom demandé : `.cmd` sous Windows (l'extension que
    PATHEXT fait trouver), un script sh exécutable ailleurs. */
const fauxLanceur = (dossier) => process.platform === "win32"
	? { corps: '@echo off\r\n"' + process.execPath + '" "' + join(dossier, "faux.mjs") + '" %*\r\n', nom: "yt-dlp.cmd" }
	: { corps: '#!/bin/sh\nexec "' + process.execPath + '" "' + join(dossier, "faux.mjs") + '" "$@"\n', nom: "yt-dlp" };

/** Un environnement où seul `dossier` est joignable, et où rien du vrai
    disque de la machine n'entre : ni APPDATA ni LOCALAPPDATA, d'où
    `dossiersCli` et les dossiers de Python ne tirent que des chemins sous
    le dossier temporaire du contrôle (inexistants → sautés). `plus`
    rajoute ce qu'un cas veut injecter (APPDATA, LOCALAPPDATA…). */
const envDe = (dossier, maison, plus = {}) => ({
	PATH: dossier,
	SystemRoot: process.env.SystemRoot,
	ComSpec: process.env.ComSpec,
	PATHEXT: process.env.PATHEXT,
	TEMP: process.env.TEMP,
	TMP: process.env.TMP,
	USERPROFILE: maison,
	HOME: maison,
	...plus,
});

/** PATHEXT arrive en MAJUSCULES sous Windows : le chemin trouvé porte
    « .EXE » là où le fichier posé s'appelle « .exe » — même fichier,
    système insensible à la casse (voir check-electron-process.mjs). */
const bas = (p) => (typeof p === "string" ? p.toLowerCase() : p);

/** Le rejet d'une `transcrire`, réduit à ce que la spec fait porter vers
    le rendu : le CODE (jamais un message traduit) et son détail de
    journal. Une résolution est un rejet sans `code` (introuvable hors du
    module) : nommé pour qu'il ne passe jamais inaperçu. */
const nomDuRejet = async (promesse) => {
	try {
		await promesse;
		return "(aucun rejet)";
	} catch (e) {
		return e && e.code ? { code: e.code, detail: e.detail ?? null } : "EXCEPTION: " + (e && e.message ? e.message : String(e));
	}
};

/* Les libellés du document, FIXTURES du contrôle : la production les
   compose par `t()` dans la langue de l'UI, À CHAQUE transcription
   (canaux.ts, tâche 4) ; ici ils passent tels quels par `DepsVideo` —
   avec une MARQUE sur le dernier, pour que ce soit CE QUI PASSE par les
   deps qui se retrouve dans le document, et pas une constante du
   module. */
const LIBELLES = {
	chaine: "Chaîne",
	duree: "Durée",
	langue: "Langue",
	manuel: "sous-titres manuels",
	auto: "sous-titres automatiques",
	description: "Description",
	transcription: "Transcription-FIXTURE",
};

await withSrcModule("apps/windows/electron/video.ts", async ({ executableYtDlp, transcrire, annulerVideo }) => {
	const r = makeReporter("Électron — yt-dlp");
	const racine = mkdtempSync(join(tmpdir(), "quiz-video-"));
	const maison = join(racine, "maison");
	mkdirSync(maison, { recursive: true });

	/* Le FAUX yt-dlp : le script de la fixture et son lanceur du nom
	   demandé, écrits dans le dossier du faux. */
	const faux = mkdtempSync(join(racine, "faux-"));
	writeFileSync(join(faux, "faux.mjs"), readFileSync(FAUX_MJS, "utf8"));
	const nomLanceur = fauxLanceur(faux).nom;
	const lanceur = join(faux, nomLanceur);
	writeFileSync(lanceur, fauxLanceur(faux).corps, nomLanceur === "yt-dlp" ? { mode: 0o755 } : undefined);
	const journal = join(faux, "journal.txt");

	/* La FIXTURE réelle de la tâche 1 (un vrai `yt-dlp -J` réduit) : le
	   faux la sert telle quelle pour `-J` — la transcription éprouvée est
	   donc celle du noyau, pas une réplique. */
	const fixture = join(process.cwd(), "scripts", "fixtures", "video", "fr.json");
	const idBonne = "nh9e18bXpzc";
	const urlBonne = "https://www.youtube.com/watch?v=" + idBonne;
	/* Le journal et la fixture sont INJECTÉS par l'environnement : c'est
	   ainsi que le faux sait où journaliser ses appels et quoi servir à
	   `-J`, et le contrôle peut lire les arguments réels des appels. */
	const envFaux = {
		PATH: faux,
		SystemRoot: process.env.SystemRoot,
		ComSpec: process.env.ComSpec,
		PATHEXT: process.env.PATHEXT,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		USERPROFILE: maison,
		HOME: maison,
		NQ_VIDEO_JOURNAL: journal,
		NQ_VIDEO_FIXTURE: fixture,
	};

	/* La miniature est TOUJOURS injectée (le vrai fetch joindrait
	   i.ytimg.com — un contrôle ne doit rien lire du réseau). */
	const miniatureInjectee = "data:image/jpeg;base64,MINIATURE";
	const depsLecture = {
		env: envFaux,
		delaiMs: 20000,
		miniature: async (url) => url === "https://i.ytimg.com/vi/" + idBonne + "/maxresdefault.jpg" ? miniatureInjectee : "data:image/jpeg;base64,autre",
		/* Les libellés du document, FIXTURES (voir LIBELLES ci-dessus) :
		   la transcription éprouvée porte ceux-ci dans son document. */
		libelles: LIBELLES,
	};

	try {
		/* ── LA RÉSOLUTION DE L'EXÉCUTABLE ── */
		await cas(r, "executableYtDlp : la copie gérée du dossier d'app AVANT tout", async () => {
			/* Un `yt-dlp.exe` posé dans la copie gérée, ALORS QUE le fake
			   est sur le PATH injecté : la copie gérée doit gagner — un
			   yt-dlp téléchargé par la tâche 3 et un yt-dlp du PATH
			   peuvent coexister, et seul le premier est retenu. */
			const app = mkdtempSync(join(racine, "app-"));
			mkdirSync(join(app, "outils"), { recursive: true });
			writeFileSync(join(app, "outils", NOM_EXE_SYSTEME), "un faux exécutable (jamais lancé ici)");
			const trouve = await executableYtDlp(envFaux, app);
			r.check("executableYtDlp : la copie gérée du dossier d'app est prioritaire",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(app, "outils", NOM_EXE_SYSTEME)), source: "app" });
			/* L'ordre réel : la copie gérée est cherchée AVANT le PATH —
			   c'est ce que ce cas et le suivant, inversés, montrent. */
			const sansCopie = await executableYtDlp(envFaux, join(racine, "vide"));
			r.check("executableYtDlp : sinon le PATH étendu",
				{ chemin: bas(sansCopie && sansCopie.chemin), source: sansCopie && sansCopie.source },
				{ chemin: bas(lanceur), source: "systeme" });
		});

		await cas(r, "executableYtDlp : un dossier des Scripts de Python est dans la recherche", async () => {
			/* pip pose yt-dlp dans `Python3*\Scripts` — un glob, pas un
			   chemin fixe (les versions changent sous un même PATH). Le
			   dossier est INJECTÉ par LOCALAPPDATA : rien du vrai disque
			   n'est lu, et un dossier absent de la liste est simplement
			   sauté par le code, ce que ce cas prouve en même temps
			   (Python311 est sans Scripts : sauté). Le PATH injecté ne
			   pointe vers RIEN : le dossier de Python doit gagner par
			   lui-même, pas parce que le fake y était déjà. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const local = mkdtempSync(join(racine, "local-"));
			mkdirSync(join(local, "Programs", "Python", "Python312", "Scripts"), { recursive: true });
			mkdirSync(join(local, "Programs", "Python", "Python311"), { recursive: true });
			const nomFaux = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
			const dossierScripts = join(local, "Programs", "Python", "Python312", "Scripts");
			writeFileSync(join(dossierScripts, nomFaux), "faux");
			const trouve = await executableYtDlp(envDe(vide, maison, { LOCALAPPDATA: local }), join(racine, "vide"));
			r.check("executableYtDlp : le dossier Python3*/Scripts de LOCALAPPDATA est trouvé",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(dossierScripts, nomFaux)), source: "systeme" });
		});

		await cas(r, "executableYtDlp : WinGet\\Links est dans la recherche", async () => {
			const vide = mkdtempSync(join(racine, "vide-"));
			const local = mkdtempSync(join(racine, "winget-"));
			mkdirSync(join(local, "Microsoft", "WinGet", "Links"), { recursive: true });
			const nomFaux = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
			writeFileSync(join(local, "Microsoft", "WinGet", "Links", nomFaux), "faux");
			const trouve = await executableYtDlp(envDe(vide, maison, { LOCALAPPDATA: local }), join(racine, "vide"));
			r.check("executableYtDlp : WinGet\\Links est trouvé",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(local, "Microsoft", "WinGet", "Links", nomFaux)), source: "systeme" });
		});

		await cas(r, "executableYtDlp : rien nulle part → null", async () => {
			/* Ni copie gérée, ni PATH, ni dossiers dérivés : tout est sous
			   un dossier temporaire vide. `null` est l'état NORMAL d'une
			   machine sans yt-dlp, pas une panne. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const trouve = await executableYtDlp(envDe(vide, vide), vide);
			r.check("executableYtDlp : rien nulle part → null", trouve, null);
		});

		/* ── TRANSCRIRE ── */
		await cas(r, "un identifiant hors regex est rejeté AVANT tout lancement", async () => {
			/* Le journal du faux est le SEUL témoin : une résolution qui
			   lancerait quoi que ce soit y laisserait une ligne. 5
			   caractères (court) ET 15 : les deux moitiés du regex. */
			for (const id of ["court", "bien_trop_long1"]) {
				const rejet = await nomDuRejet(transcrire(id, depsLecture));
				r.check("un identifiant hors regex est rejeté AVANT tout lancement (" + id.length + " car.)",
					{ rejet, appels: existsSync(journal) ? readFileSync(journal, "utf8") : "" },
					{ rejet: { code: "inconnue", detail: "identifiant : " + id }, appels: "" });
				rmSync(journal, { force: true });
			}
		});

		await cas(r, "sans yt-dlp, la transcription rejette « absent » sans lancer", async () => {
			/* Le journal est quand même injecté : s'il y avait eu un
			   lancement, il y serait — c'est ce qui rend l'assert
			   `appels: false` porteur, et non aveugle. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const rejet = await nomDuRejet(transcrire(idBonne, { env: envDe(vide, maison, { NQ_VIDEO_JOURNAL: journal }), delaiMs: 20000, miniature: async () => null, libelles: LIBELLES }));
			r.check("sans yt-dlp, la transcription rejette « absent » sans lancer",
				{ rejet, appels: existsSync(journal) }, { rejet: { code: "absent", detail: null }, appels: false });
		});

		await cas(r, "une transcription sert les DEUX listes d'arguments figées", async () => {
			const res = await transcrire(idBonne, depsLecture);
			const appels = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
			/* LA LISTE FIGÉE, l'un après l'autre. Le `-o` est sous un
			   dossier temporaire que SEUL le principal connaît ; le
			   gabarit `s.%(ext)s` est celui de la liste figée. */
			r.check("les arguments du premier appel (les métadonnées -J) sont figés",
				appels[0], ["--no-warnings", "-J", "--skip-download", urlBonne]);
			r.check("les arguments du second appel (la piste auto) sont figés, -o dans le temporaire",
				{ debut: appels[1].slice(0, 8), oAbsolu: isAbsolute(appels[1][8]), fin: appels[1].slice(9), gabarit: appels[1][8].endsWith("s.%(ext)s") },
				{
					debut: ["--no-warnings", "--skip-download", "--write-auto-subs", "--sub-langs", "fr-orig", "--sub-format", "json3", "-o"],
					oAbsolu: true,
					fin: [urlBonne],
					gabarit: true,
				});
			r.check("l'URL est reconstruite, jamais reçue de l'appelant", [appels[0][3], appels[1][9]], [urlBonne, urlBonne]);
			/* LE RÉSULTAT, du document au nom de fichier (fixture réelle). */
			r.check("le résultat porte le document, son nom, titre, durée, langue, type, miniature",
				{
					document: res.document.includes("[00:00] bonjour la vidéo") && res.document.includes("## Transcription-FIXTURE"),
					nom: res.nom, titre: res.titre, dureeS: res.dureeS, langue: res.langue, type: res.type, miniature: res.miniature,
				},
				{ document: true, nom: "Les variables en Python®.md", titre: "Les variables en Python®", dureeS: 366, langue: "fr", type: "auto", miniature: miniatureInjectee });
			/* LE DOSSIER TEMPORAIRE est supprimé en finally : il n'est
			   connu que par le `-o` que le faux a journalisé. */
			r.check("le dossier temporaire est supprimé", existsSync(dirname(appels[1][8])), false);
			rmSync(journal, { force: true });
		});

		await cas(r, "« Private video » rejette videoIndisponible après un seul appel", async () => {
			const rejet = await nomDuRejet(transcrire("privee12345", depsLecture));
			const appels = existsSync(journal) ? readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean) : [];
			/* UN seul appel : les métadonnées suffisent à savoir que la
			   vidéo est privée — on ne va pas chercher des sous-titres. */
			r.check("« Private video » rejette videoIndisponible après un seul appel",
				{
					rejetCode: rejet && rejet.code,
					detail: rejet && rejet.detail ? rejet.detail.includes("Private video") : false,
					appels: appels.length,
				},
				{ rejetCode: "videoIndisponible", detail: true, appels: 1 });
			rmSync(journal, { force: true });
		});

		await cas(r, "un yt-dlp qui traîne est tué, ARBRE compris, et rejette « delai »", async () => {
			/* Le délai est RÉDUIT par deps (les 5 s du faux seraient
			   ingérables) ; le témoin est le PID du faux, écrit au début
			   de son travail : `taskkill /T` (Windows) ou le groupe
			   (ailleurs) ne doit laisser AUCUN descendant. */
			const rejet = await nomDuRejet(transcrire("lente123456", { ...depsLecture, delaiMs: 700 }));
			const lignes = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean);
			const debut = lignes.find((l) => l.startsWith("DEBUT "));
			const pid = debut ? Number(debut.split(" ")[1]) : null;
			/* La mort de l'arbre se voit aussi après quelques tours : un
			   process tué ne répond plus à kill(pid, 0). */
			let mort = false;
			for (let i = 0; i < 100 && !mort; i++) {
				await dodo(50);
				try { if (typeof pid === "number") { process.kill(pid, 0); } else { break; } } catch (e) { mort = true; }
			}
			r.check("un yt-dlp qui traîne rejette « delai »",
				{ rejet: rejet && rejet.code, pid: typeof pid }, { rejet: "delai", pid: "number" });
			r.check("l'arbre est mort après le rejet", mort, true);
			/* Et le faux n'a JAMAIS fini son sommeil : aucune ligne FIN. */
			r.check("le faux tué n'a jamais écrit FIN", lignes.some((l) => l.startsWith("FIN")), false);
			rmSync(journal, { force: true });
		});

		await cas(r, "une miniature en échec vaut null, jamais bloquant", async () => {
			const res = await transcrire(idBonne, { ...depsLecture, miniature: async () => { throw new Error("réseau en panne"); } });
			r.check("une miniature en échec vaut null, la transcription continue",
				{ miniature: res.miniature, document: res.document.length > 0 },
				{ miniature: null, document: true });
		});

		await cas(r, "deux transcriptions au plus en parallèle, la troisième attend", async () => {
			/* Le FAUX dort 400 ms par appel : trois appels partent
			   ENSEMBLE, la file en retient deux, et la troisième ne
			   DÉBUTE qu'après une fin — lu dans l'ORDRE du journal. */
			const envLente = envDe(faux, maison, {
				NQ_VIDEO_JOURNAL: journal,
				NQ_VIDEO_FIXTURE: fixture,
				NQ_VIDEO_SOMMEIL_MS: 400,
			});
			const trois = [
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null, libelles: LIBELLES }),
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null, libelles: LIBELLES }),
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null, libelles: LIBELLES }),
			];
			const resultats = await Promise.all(trois);
			const lignes = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean);
			const premierFin = lignes.findIndex((l) => l.startsWith("FIN"));
			const troisiemeDebut = lignes.map((l, i) => l.startsWith("DEBUT") ? i : -1).filter((i) => i >= 0)[2];
			r.check("deux transcriptions au plus en parallèle, les trois aboutissent",
				{
					trois: resultats.every((x) => x.titre === "Les variables en Python®"),
					ordres: premierFin >= 0 && troisiemeDebut > premierFin,
					/* Chaque transcription porte DEUX appels yt-dlp (-J puis la
					   piste) : six départs pour trois transcriptions, et le
					   troisième ne déute qu'après une libération — lu dans
					   l'ORDRE du journal. */
					appels: lignes.filter((l) => l.startsWith("DEBUT")).length,
				},
				{ trois: true, ordres: true, appels: 6 });
			rmSync(journal, { force: true });
		});

		await cas(r, "annuler(id) pendant la transcription rejette « annule » et tue l'ARBRE", async () => {
			/* Le faux dort 4 s par appel : les métadonnées sont EN VOL
			   quand l'annulation part (le témoin est son pid, écrit au
			   début de son travail — le même que le cas « delai »). */
			const envLente = envDe(faux, maison, {
				NQ_VIDEO_JOURNAL: journal,
				NQ_VIDEO_FIXTURE: fixture,
				NQ_VIDEO_SOMMEIL_MS: 4000,
			});
			const promesse = transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null, libelles: LIBELLES });
			/* Le pid du faux, écrit au début de son travail : annuler À CET
			   instant, et non après la fin — sinon on n'annule rien. */
			let pid = null;
			for (let i = 0; i < 100 && pid === null; i++) {
				await dodo(50);
				const ligne = existsSync(journal) ? readFileSync(journal, "utf8").split(/\r?\n/).find((l) => l.startsWith("DEBUT ")) : null;
				if (ligne) pid = Number(ligne.split(" ")[1]);
			}
			annulerVideo("lente123456");
			const rejet = await nomDuRejet(promesse);
			/* Un process annulé ne répond plus à kill(pid, 0) : l'ARBRE est
			   mort, pas le seul parent — c'est ce que `lancer` promet à
			   l'abandon d'un signal. */
			let mort = false;
			for (let i = 0; i < 100 && !mort; i++) {
				await dodo(50);
				try { if (typeof pid === "number") { process.kill(pid, 0); } else { break; } } catch (e) { mort = true; }
			}
			r.check("la transcription annulée rejette { code: \"annule\" }",
				{ rejet: rejet && rejet.code, pid: typeof pid }, { rejet: "annule", pid: "number" });
			r.check("l'arbre du faux est mort après le rejet", mort, true);
			/* Le faux tué n'a jamais fini son sommeil : aucune ligne FIN. */
			r.check("le faux tué n'a jamais écrit FIN", existsSync(journal) ? readFileSync(journal, "utf8").includes("FIN") : false, false);
			/* La transcription a QUITTÉ le registre en finally : annuler
			   encore n'est plus rien — et ne doit pas jeter. */
			annulerVideo("lente123456");
			r.check("annuler un identifiant sans transcription vivante est un no-op", true, true);
			rmSync(journal, { force: true });
		});
	} finally {
		/* Même règle qu'avecFichiers : Windows garde un handle quelques
		   dizaines de ms après la mort d'un process — `maxRetries`, et
		   un échec NOMMÉ plutôt que silencieux. */
		try {
			rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		} catch (e) {
			console.warn("[neo-quiz] dossier temporaire du contrôle non effacé :", racine, e);
		}
	}

	/* ── LES HÔTES DU RÉSEAU ──
	   La miniature (i.ytimg.com) et, pour la tâche 3, l'installation
	   (github.com et les deux hôtes d'assets) : la liste est la RÈGLE du
	   pont, son extension est une décision de la spec §3.2, pas un
	   raccourci. Chargée à part : c'est le module du réseau qui la porte. */
	await withSrcModule("apps/windows/electron/reseau.ts", async ({ HOTES_AUTORISES }) => {
		const r = makeReporter("Électron — les hôtes des vidéos");
		r.check("la liste du réseau porte github, ses assets et i.ytimg.com",
			["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "i.ytimg.com"].map((h) => HOTES_AUTORISES.has(h)),
			[true, true, true, true]);
		r.done();
	});

	r.done();
});/* ══════════════════════════════════════════════════════════
   TÂCHE 3 — INSTALLER, RENSEIGNER, METTRE À JOUR, L'ÉTAT

   CE QUE CES CAS EMPÊCHENT, et qu'aucun typecheck ne voit :
   — la version lue par l'API REST de GitHub (son quota ferait croire
     à une panne hors ligne) : l'étiquette vient de la REDIRECTION de
     /releases/latest, et de nulle part ailleurs ;
   — un tag venu d'un Location hostile, qui composerait l'URL de
     téléchargement d'autre chose qu'une release yt-dlp (l'étiquette
     est validée AVANT toute URL composée) ;
   — un saut de redirection vers un hôte hors de la liste du réseau
     (chaque destination est re-jugée, jamais le seul hôte d'entrée) ;
   — des octets posés sans empreinte vérifiée, ou vérifiés contre un
     SHA2-256SUMS d'une AUTRE release (la même étiquette, toujours) ;
   — un .part qui survivrait à un échec : RIEN ne reste sur le
     disque, ni le temporaire ni le fichier final ;
   — une progression qui ne se verrait qu'une fois à 100 % : elle est
     parue en octets, du premier paquet au total ;
   — un asset x64 posé pour une machine arm64 (l'architecture est
     INJECTÉE : le cas arm64 est éprouvé sans y tourner) ;
   — un `yt-dlp -U` lancé plus d'une fois par 24 h (l'horodatage est
     écrit AVANT le lancement : un -U en échec non plus), et JAMAIS
     sur une copie système ;
   — un état qui divergerait de la résolution réelle (il en dérive).

   La miniature, elle, prouve la conversion des OCTETS transportés en
   `data:` URI, et son échec qui ne fait pas échouer la transcription.

   RIEN n'est installé sur la machine : la release est FAUSSE, servie
   depuis un dossier temporaire par un transport INJECTÉ (jamais le
   réseau) ; le `yt-dlp -U` est lancé sur un faux du même harnais que
   la tâche 2, derrière le lanceur du nom demandé, dans le dossier
   d'app INJECTÉ — jamais le vrai PATH.
═══════════════════════════════════════════════════════════ */
import { createHash } from "node:crypto";
import { readdirSync, utimesSync } from "node:fs";

/* ── LA FAUSSE RELEASE ──
   Deux assets, et leurs empreintes RÉELLES (le contrôle recalcule
   SHA-256 lui-même ; le SHA2-256SUMS menteur du cas « empreinte
   fausse » est fabriqué sur le même gabarit : 64 hex, deux espaces,
   le nom d'asset). */
const TAG = "2026.08.19";
const URL_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest";
const empreinteDes = (octets) => createHash("sha256").update(octets).digest("hex");
const exe = Buffer.from("FAUX YT-DLP EXE — les octets que l'installeur doit relire à l'identique. ".repeat(300), "utf8");
const exeArm64 = Buffer.from("FAUX YT-DLP ARM64 — d'autres octets, pour que la copie x64 ne valide jamais un arm64. ".repeat(300), "utf8");
const racineRelease = mkdtempSync(join(tmpdir(), "quiz-release-"));
writeFileSync(join(racineRelease, "yt-dlp.exe"), exe);
writeFileSync(join(racineRelease, "yt-dlp_arm64.exe"), exeArm64);
writeFileSync(join(racineRelease, "SHA2-256SUMS"), empreinteDes(exe) + "  yt-dlp.exe\n" + empreinteDes(exeArm64) + "  yt-dlp_arm64.exe\n", "utf8");

/* Le transport INJECTÉ : répond à la redirection de /releases/latest
   (Location RELATIVE, comme github la rend), à HEAD (content-length)
   et au GET (l'asset streame par DEUX paquets — la progression doit
   se voir ENTRE eux, pas une fois à la fin). Chaque URL demandée est
   journalisée : le témoin de l'asset arm64, de la même étiquette pour
   les deux fichiers et des sauts de redirection. JAMAIS le réseau. */
const faireTransport = (options = {}) => {
	const demandees = [];
	const transport = async (url, init) => {
		demandees.push(init.method + " " + url);
		const u = new URL(url);
		if (u.pathname === "/yt-dlp/yt-dlp/releases/latest") {
			return { status: 302, entete: (n) => (n === "location" ? "/yt-dlp/yt-dlp/releases/tag/" + TAG : null), texte: async () => "" };
		}
		const m = u.pathname.match(/^\/yt-dlp\/yt-dlp\/releases\/download\/([^/]+)\/(.+)$/);
		if (!m || m[1] !== TAG) return { status: 404, entete: () => null, texte: async () => "" };
		const nom = m[2];
		/* La redirection d'asset, INJECTÉE : la destination est celle que
		   github pose réellement (release-assets…), ou celle d'un cas
		   « hors liste » — c'est le contrôle qui la choisit. */
		if (init.method === "GET" && u.hostname === "github.com" && (options.redirigeAssets || (options.redirigeVers && options.redirigeVers.nom === nom))) {
			const lieu = options.redirigeVers && options.redirigeVers.nom === nom ? options.redirigeVers.url : "https://release-assets.githubusercontent.com" + u.pathname;
			return { status: 302, entete: (n) => (n === "location" ? lieu : null), texte: async () => "" };
		}
		if (options.echec && options.echec.nom === nom && options.echec.method === init.method) throw new Error("transport en panne pour " + nom);
		if (init.method === "HEAD") {
			const octets = readFileSync(join(racineRelease, nom));
			/* L'en-tête content-length EST RETIRABLE (sansTaille) : un serveur
			   qui ne le porte pas ne doit jamais faire croire à une taille
			   nulle — la modale afficherait « 0 o » (revue du 2026-09-23). */
			return { status: 200, entete: (n) => (!options.sansTaille && n === "content-length" ? String(octets.length) : null), texte: async () => "" };
		}
		const contenu = nom === "SHA2-256SUMS" && options.sommes ? Buffer.from(options.sommes, "utf8") : readFileSync(join(racineRelease, nom));
		return {
			status: 200,
			entete: () => null,
			texte: async () => contenu.toString("latin1"),
			octets: () => (async function* () {
				const moitie = Math.ceil(contenu.length / 2);
				yield contenu.subarray(0, moitie);
				if (moitie < contenu.length) yield contenu.subarray(moitie);
			})(),
		};
	};
	transport.demandees = demandees;
	return transport;
};

/* Le faux yt-dlp de la MISE À JOUR : il journalise ses arguments et
   sort avec NQ_MAJ_SORTIE (0 par défaut) — l'échec de -U est réglable
   par l'environnement, comme le sommeil de la fixture de la tâche 2. */
const CORPS_MAJ = [
	"import { appendFileSync } from 'node:fs';",
	"const journal = process.env.NQ_MAJ_JOURNAL;",
	"if (journal) appendFileSync(journal, JSON.stringify(process.argv.slice(2)) + '\\n');",
	"process.exit(Number(process.env.NQ_MAJ_SORTIE || 0));",
].join("\n");

const poserFauxMaj = (dossier) => {
	writeFileSync(join(dossier, "faux.mjs"), CORPS_MAJ, "utf8");
	const lanceur = fauxLanceur(dossier);
	writeFileSync(join(dossier, lanceur.nom), lanceur.corps, lanceur.nom === "yt-dlp" ? { mode: 0o755 } : undefined);
	return lanceur;
};

await withSrcModule("apps/windows/electron/video-installation.ts", async ({ infosInstallation, installer, mettreAJourSiDu, etat }) => {
	const r = makeReporter("Électron — installation de yt-dlp");
	const racine = mkdtempSync(join(tmpdir(), "quiz-installer-"));
	const maison = join(racine, "maison");
	mkdirSync(maison, { recursive: true });
	/* SANS APPDATA ni LOCALAPPDATA : la copie gérée ne peut venir que du
	   dossier d'app INJECTÉ, et rien du vrai disque de la machine
	   n'entre dans la résolution. */
	const envInstalle = envDe(join(racine, "vide"), maison);

	try {
		/* ── LES INFOS D'INSTALLATION (la modale) ── */
		await cas(r, "infosInstallation : l'étiquette vient de la REDIRECTION, la date en découle, la taille du HEAD", async () => {
			const t = faireTransport();
			const infos = await infosInstallation({ transport: t });
			r.check("version, datePublication (ISO), taille, url",
				{ version: infos.version, date: infos.datePublication, taille: infos.taille, url: infos.url, appels: t.demandees },
				{
					version: TAG,
					date: "2026-08-19",
					taille: exe.length,
					url: URL_LATEST,
					appels: ["GET " + URL_LATEST, "HEAD https://github.com/yt-dlp/yt-dlp/releases/download/" + TAG + "/yt-dlp.exe"],
				});
		});

		await cas(r, "infosInstallation hors ligne : tout null, SANS exception (la modale dit « dernière version publiée »)", async () => {
			const infos = await infosInstallation({ transport: async () => { throw new Error("réseau en panne"); } });
			r.check("hors ligne → tout null, l'url reste cliquable", infos, { version: null, datePublication: null, taille: null, url: URL_LATEST });
		});

		/* L'EN-TÊTE content-length ABSENT : Number(null) vaudrait 0, et la
		   modale aurait affiché « 0 o » (revue du 2026-09-23, bloquant).
		   Deux témoins : les infos, puis la progression D'UNE INSTALLATION —
		   un total inconnu doit y rester null, jamais 0 ni 100 % faux. */
		await cas(r, "infosInstallation : un HEAD sans content-length rend taille null, JAMAIS 0", async () => {
			const infos = await infosInstallation({ transport: faireTransport({ sansTaille: true }) });
			r.check("taille null, la version et la date restent lues",
				{ version: infos.version, datePublication: infos.datePublication, taille: infos.taille },
				{ version: TAG, datePublication: "2026-08-19", taille: null });
		});

		await cas(r, "installer : sans content-length, la progression reste en octets avec un total toujours null", async () => {
			const app = mkdtempSync(join(racine, "app-sans-taille-"));
			const vues = [];
			await installer((recus, total) => vues.push([recus, total]), { transport: faireTransport({ sansTaille: true }), dossierApp: app, env: envInstalle });
			r.check("la copie est posée et le total est null sur CHAQUE appel de progression",
				{ exe: existsSync(join(app, "outils", "yt-dlp.exe")), vues: vues.length > 0 && vues.every((v) => v[0] > 0 && v[1] === null) },
				{ exe: true, vues: true });
		});

		/* ── L'INSTALLATION ── */
		await cas(r, "installer : empreinte juste → la copie est à <app>/outils/yt-dlp.exe, la progression est parue en octets, aucun .part", async () => {
			const app = mkdtempSync(join(racine, "app-"));
			const t = faireTransport();
			const vues = [];
			await installer((recus, total) => vues.push([recus, total]), { transport: t, dossierApp: app, env: envInstalle });
			r.check("la copie gérée est posée à l'identique, sans temporaire",
				{ exe: existsSync(join(app, "outils", "yt-dlp.exe")), contenu: readFileSync(join(app, "outils", "yt-dlp.exe")).equals(exe), part: existsSync(join(app, "outils", "yt-dlp.exe.part")) },
				{ exe: true, contenu: true, part: false });
			r.check("la progression est parue en OCTETS (premier paquet, puis le total), total = la longueur du HEAD",
				vues.length >= 2 && vues[0][0] < exe.length && vues[vues.length - 1][0] === exe.length && vues.every((v) => v[1] === exe.length),
				true);
			r.check("les infos, l'exe et ses sommes sont demandés sous la MÊME étiquette",
				t.demandees.filter((u) => u.startsWith("GET ")).map((u) => new URL(u.slice(4)).pathname),
				[
					"/yt-dlp/yt-dlp/releases/latest",
					"/yt-dlp/yt-dlp/releases/download/" + TAG + "/SHA2-256SUMS",
					"/yt-dlp/yt-dlp/releases/download/" + TAG + "/yt-dlp.exe",
				]);
		});

		await cas(r, "installer : empreinte fausse → rejet « empreinte », AUCUN fichier (ni final ni .part)", async () => {
			const app = mkdtempSync(join(racine, "app-"));
			/* Le même gabarit de SHA2-256SUMS, l'empreinte de yt-dlp.exe
			   remplacée par 64 zéros : un exe qui valide ça serait un exe
			   qui n'est pas celui de la release. */
			const sommesFausses = "0".repeat(64) + "  yt-dlp.exe\n" + empreinteDes(exeArm64) + "  yt-dlp_arm64.exe\n";
			const rejet = await nomDuRejet(installer(() => {}, { transport: faireTransport({ sommes: sommesFausses }), dossierApp: app, env: envInstalle }));
			r.check("le rejet est typé « empreinte » et rien ne reste",
				{ code: rejet && rejet.code, exe: existsSync(join(app, "outils", "yt-dlp.exe")), part: existsSync(join(app, "outils", "yt-dlp.exe.part")) },
				{ code: "empreinte", exe: false, part: false });
		});

		await cas(r, "installer : le réseau en panne rejette « reseau » et laisse le disque VIDE", async () => {
			const app = mkdtempSync(join(racine, "app-"));
			const rejet = await nomDuRejet(installer(() => {}, { transport: faireTransport({ echec: { nom: "yt-dlp.exe", method: "GET" } }), dossierApp: app, env: envInstalle }));
			r.check("le rejet est typé « reseau » et rien n'est resté",
				{ code: rejet && rejet.code, fichiers: existsSync(join(app, "outils")) ? readdirSync(join(app, "outils")).length : 0 },
				{ code: "reseau", fichiers: 0 });
			// The raw message (a local path, a signed URL) stays in the main
			// process log: only a fixed detail may reach the renderer.
			r.check("the raw transport message does not reach the rejection's detail",
				{ fuite: !!(rejet && rejet.detail && rejet.detail.includes("transport en panne")) },
				{ fuite: false });
		});

		await cas(r, "installer : une redirection hors de la liste d'hôtes est refusée, rien sur le disque", async () => {
			const app = mkdtempSync(join(racine, "app-"));
			const t = faireTransport({ redirigeVers: { nom: "yt-dlp.exe", url: "https://pirate.example/yt-dlp.exe" } });
			const rejet = await nomDuRejet(installer(() => {}, { transport: t, dossierApp: app, env: envInstalle }));
			r.check("le saut vers pirate.example est refusé AVANT le transport",
				{ code: rejet && rejet.code, sauts: t.demandees.filter((u) => u.includes("pirate.example")).length, fichiers: existsSync(join(app, "outils")) ? readdirSync(join(app, "outils")).length : 0 },
				{ code: "reseau", sauts: 0, fichiers: 0 });
		});

		await cas(r, "arm64 : l'asset yt-dlp_arm64.exe est pris, la copie reste yt-dlp.exe, la redirection est suivie vers release-assets", async () => {
			const app = mkdtempSync(join(racine, "app-"));
			const t = faireTransport({ redirigeAssets: true });
			await installer(() => {}, { transport: t, dossierApp: app, env: envInstalle, arch: "arm64" });
			r.check("l'asset arm64 est téléchargé par la redirection, posé sous yt-dlp.exe",
				{
					asset: t.demandees.some((u) => u.includes("/download/" + TAG + "/yt-dlp_arm64.exe")),
					assets: t.demandees.some((u) => u.includes("release-assets.githubusercontent.com")),
					sommes: t.demandees.some((u) => u.includes("/download/" + TAG + "/SHA2-256SUMS")),
					pose: readFileSync(join(app, "outils", "yt-dlp.exe")).equals(exeArm64),
				},
				{ asset: true, assets: true, sommes: true, pose: true });
		});

		/* ── LA MISE À JOUR — copie gérée seule, au plus une fois par 24 h ── */
		await cas(r, "mettreAJourSiDu : la copie gérée est lancée sur -U, l'horodatage posé, frais il tient la suivante, vieux il relance", async () => {
			const app = mkdtempSync(join(racine, "maj-"));
			mkdirSync(join(app, "outils"), { recursive: true });
			/* La « copie gérée » du contrôle : le même lanceur que la
			   tâche 2, posé DANS le dossier d'app injecté — sa résolution
			   (source « app ») le trouve, et `lancer` le lance. */
			const dossierFauxMaj = mkdtempSync(join(racine, "faux-maj-"));
			const lanceurMaj = poserFauxMaj(dossierFauxMaj);
			writeFileSync(join(app, "outils", lanceurMaj.nom), lanceurMaj.corps, lanceurMaj.nom === "yt-dlp" ? { mode: 0o755 } : undefined);
			const journalMaj = join(dossierFauxMaj, "journal.txt");
			const envMaj = { ...envDe(join(racine, "vide"), maison), NQ_MAJ_JOURNAL: journalMaj };
			const appels = () => (existsSync(journalMaj) ? readFileSync(journalMaj, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);
			await mettreAJourSiDu({ env: envMaj, dossierApp: app, delaiMs: 20000 });
			r.check("-U est lancé sur la copie gérée et l'horodatage est posé",
				{ appels: appels(), maj: existsSync(join(app, "outils", "yt-dlp.maj")) },
				{ appels: [["-U"]], maj: true });
			/* L'HORODATAGE FRAIS tient la suivante : au plus une fois par
			   24 h — l'essai est compté AVANT le lancement, donc un -U en
			   échec non plus. */
			const avant = appels().length;
			await mettreAJourSiDu({ env: envMaj, dossierApp: app, delaiMs: 20000 });
			r.check("l'horodatage frais ne relance pas -U", appels().length, avant);
			/* Et un horodatage VIEUX de 25 h relance : la garde est une
			   fenêtre de 24 h, pas un once. */
			const vieux = new Date(Date.now() - 25 * 60 * 60 * 1000);
			utimesSync(join(app, "outils", "yt-dlp.maj"), vieux, vieux);
			await mettreAJourSiDu({ env: envMaj, dossierApp: app, delaiMs: 20000 });
			r.check("un horodatage de plus de 24 h relance -U", appels().length, avant + 1);
			rmSync(journalMaj, { force: true });
		});

		await cas(r, "mettreAJourSiDu : une copie du PATH SEULE n'est jamais touchée", async () => {
			const appVide = mkdtempSync(join(racine, "sans-geree-"));
			/* Le yt-dlp n'est QUE sur le PATH injecté (source « systeme ») :
			   la copie gérée est absente, donc RIEN ne doit être lancé ni
			   horodaté — un `-U` sur celle de pip ou winget serait une
			   écriture hors du dossier de l'app. Le journal du faux est le
			   témoin : aucun lancement n'y laisse une ligne. */
			const dossierFauxPath = mkdtempSync(join(racine, "faux-path-"));
			const lanceur = poserFauxMaj(dossierFauxPath);
			const journal = join(dossierFauxPath, "journal.txt");
			const envSysteme = { ...envDe(dossierFauxPath, maison), NQ_MAJ_JOURNAL: journal };
			await mettreAJourSiDu({ env: envSysteme, dossierApp: join(racine, "vide"), delaiMs: 20000 });
			r.check("aucun -U lancé, aucun horodatage posé",
				{ appels: existsSync(journal), maj: existsSync(join(appVide, "outils", "yt-dlp.maj")) },
				{ appels: false, maj: false });
		});

		await cas(r, "mettreAJourSiDu : un -U qui échoue est avalé et journalisé, sans exception", async () => {
			const app = mkdtempSync(join(racine, "echec-"));
			mkdirSync(join(app, "outils"), { recursive: true });
			const dossierFaux = mkdtempSync(join(racine, "faux-echec-"));
			const lanceur = poserFauxMaj(dossierFaux);
			writeFileSync(join(app, "outils", lanceur.nom), lanceur.corps, lanceur.nom === "yt-dlp" ? { mode: 0o755 } : undefined);
			const journal = join(dossierFaux, "journal.txt");
			/* L'ÉCHEC EST AVALÉ ET JOURNALISÉ : le contrôle capture
			   console.warn pour l'affirmer — et rendre sa sortie
			   propre (le warn est le comportement testé, pas un
			   bruit). */
			const warns = [];
			const avantWarn = console.warn;
			console.warn = (...lignes) => warns.push(lignes.map(String).join(" "));
			try {
				await mettreAJourSiDu({ env: { ...envDe(join(racine, "vide"), maison), NQ_MAJ_JOURNAL: journal, NQ_MAJ_SORTIE: "1" }, dossierApp: app, delaiMs: 20000 });
			} finally {
				console.warn = avantWarn;
			}
			/* L'APPEL a rendu la main (sinon `cas` verrait une exception),
			   l'horodatage est posé, et le lancement a eu lieu — le
			   journal du faux le porte, la console du principal aussi. */
			r.check("l'échec de -U est avalé, l'essai compté, le lancement journalisé",
				{ maj: existsSync(join(app, "outils", "yt-dlp.maj")), appels: existsSync(journal) ? readFileSync(journal, "utf8").includes("-U") : false, journalise: warns.some((w) => w.includes("yt-dlp -U a échoué")) },
				{ maj: true, appels: true, journalise: true });
		});

		/* ── L'ÉTAT (reporté de la tâche 2 par la revue du pair) ── */
		await cas(r, "etat() : la copie gérée vaut { present: true, source: \"app\" }, le PATH vaut \"systeme\", rien vaut null", async () => {
			const app = mkdtempSync(join(racine, "etat-"));
			mkdirSync(join(app, "outils"), { recursive: true });
			writeFileSync(join(app, "outils", NOM_EXE_SYSTEME), "un exécutable (jamais lancé ici)");
			const vide = mkdtempSync(join(racine, "vide-"));
			const dossierPath = mkdtempSync(join(racine, "path-"));
			writeFileSync(join(dossierPath, NOM_EXE_SYSTEME), "un exécutable du PATH");
			const avecCopie = await etat({ env: envDe(vide, maison), dossierApp: app });
			const sansRien = await etat({ env: envDe(vide, vide), dossierApp: join(racine, "vide") });
			const duPath = await etat({ env: envDe(dossierPath, maison), dossierApp: join(racine, "vide") });
			r.check("la copie gérée", avecCopie, { present: true, source: "app" });
			r.check("rien nulle part", sansRien, { present: false, source: null });
			r.check("un yt-dlp du PATH", duPath, { present: true, source: "systeme" });
		});
	} finally {
		try {
			rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
			rmSync(racineRelease, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		} catch (e) {
			console.warn("[neo-quiz] dossier temporaire du contrôle non effacé :", e);
		}
	}
	r.done();
});

/* ── LA LECTURE D'UNE VIDÉO — les deux cas manquants de la revue ──
   `pasDeSousTitres` : des métadonnées SANS piste admissible (la
   fixture `sans-pistes.json`, injectée par l'environnement) rejettent
   l'erreur typée après UN SEUL appel au faux — son journal est le
   témoin du jamais-lancé. Et la miniature, avec la fonction de
   PRODUCTION (`miniatureParDefaut`) et un transport injecté : les
   octets deviennent une `data:` URI exacte, et un échec du transport
   vaut null SANS faire échouer la transcription. */
await withSrcModule("apps/windows/electron/video.ts", async ({ transcrire, miniatureParDefaut }) => {
	const r = makeReporter("Électron — lecture d'une vidéo (tâche 3)");
	const racine = mkdtempSync(join(tmpdir(), "quiz-video3-"));
	const maison = join(racine, "maison");
	mkdirSync(maison, { recursive: true });
	const faux = mkdtempSync(join(racine, "faux-"));
	writeFileSync(join(faux, "faux.mjs"), readFileSync(FAUX_MJS, "utf8"));
	const lanceur = fauxLanceur(faux);
	writeFileSync(join(faux, lanceur.nom), lanceur.corps, lanceur.nom === "yt-dlp" ? { mode: 0o755 } : undefined);
	const journal = join(faux, "journal.txt");
	const envSansPistes = {
		PATH: faux,
		SystemRoot: process.env.SystemRoot,
		ComSpec: process.env.ComSpec,
		PATHEXT: process.env.PATHEXT,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		USERPROFILE: maison,
		HOME: maison,
		NQ_VIDEO_JOURNAL: journal,
		NQ_VIDEO_FIXTURE: join(process.cwd(), "scripts", "fixtures", "video", "sans-pistes.json"),
	};
	try {
		await cas(r, "des métadonnées SANS piste admissible rejettent « pasDeSousTitres » et le second appel n'est JAMAIS lancé", async () => {
			const rejet = await nomDuRejet(transcrire("nh9e18bXpzc", { env: envSansPistes, delaiMs: 20000, miniature: async () => null, libelles: LIBELLES }));
			const appels = existsSync(journal) ? readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean) : [];
			r.check("l'erreur typée, après UN seul appel (les métadonnées)",
				{ code: rejet && rejet.code, detail: rejet && rejet.detail, appels: appels.length },
				{ code: "pasDeSousTitres", detail: null, appels: 1 });
			/* Le second appel (--write-subs / --write-auto-subs) n'est
			   JAMAIS lancé : le journal du faux ne porte que la ligne -J. */
			r.check("aucun appel de sous-titres dans le journal",
				appels.some((l) => l.includes("--write-subs") || l.includes("--write-auto-subs")),
				false);
			rmSync(journal, { force: true });
		});

		await cas(r, "la miniature : les octets du transport injecté deviennent une data: URI exacte", async () => {
			const octets = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
			const transport = async () => ({ status: 200, text: async () => octets.toString("latin1") });
			const dataUri = await miniatureParDefaut("https://i.ytimg.com/vi/nh9e18bXpzc/maxresdefault.jpg", transport);
			r.check("les octets transportés sont relus à l'identique en base64",
				dataUri, "data:image/jpeg;base64," + octets.toString("base64"));
		});

		await cas(r, "un transport de miniature en échec vaut miniature null, SANS faire échouer la transcription", async () => {
			/* La DÉFAUT de la production derrière un transport qui
			   jette : la transcription est le travail, la vignette un
			   ornement — l'erreur du transport meurt dans le null,
			   pas dans le document. Le warn du transport échoué,
			   lui, porte le diagnostic (`fetchBorne` de reseau.ts,
			   jugée ailleurs) : capturé pour que la sortie du
			   contrôle reste propre, et affirmé — un échec avalé
			   sans être NOMMÉ ressemblerait à une panne ignorée. */
			const warns = [];
			const avantWarn = console.warn;
			console.warn = (...lignes) => warns.push(lignes.map(String).join(" "));
			try {
				const res = await transcrire("nh9e18bXpzc", {
					env: { ...envSansPistes, NQ_VIDEO_FIXTURE: join(process.cwd(), "scripts", "fixtures", "video", "fr.json") },
					delaiMs: 20000,
					miniature: (url) => miniatureParDefaut(url, async () => { throw new Error("réseau en panne"); }),
					libelles: LIBELLES,
				});
				r.check("la transcription porte son document, une miniature nulle, et l'échec du transport est nommé",
					{ miniature: res.miniature, document: res.document.length > 0, nommee: warns.length > 0 },
					{ miniature: null, document: true, nommee: true });
			} finally {
				console.warn = avantWarn;
			}
		});
	} finally {
		try {
			rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		} catch (e) {
			console.warn("[neo-quiz] dossier temporaire du contrôle non effacé :", racine, e);
		}
	}
	r.done();
});