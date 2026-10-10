/* ══════════════════════════════════════════════════════════
   LE REFLET DE L'INSTALLATION — le noyau, sans Electron

   Ce que la fenêtre de mise à jour a de dangereux ne tient pas à sa fenêtre
   mais à ces quelques fonctions de fichiers : c'est d'elles que dépend le fait
   qu'une mise à jour aboutisse ou ÉCHOUE. Elles vivent donc à part, sans
   Electron, pour que `npm run check:fenetre-maj` les éprouve sur un VRAI
   dossier temporaire — même règle que `mise-a-jour-etat.ts` face à
   `mise-a-jour.ts`, ou `garde-ia.ts` face à `canaux.ts`.

   POURQUOI UN REFLET. Entre le clic sur « Mettre à jour » et la réouverture de
   l'application, NSIS travaille 10,5 s sur un NVMe (mesuré le 2026-09-16,
   `mesurer-installation.mjs`) et bien davantage sur un disque lent ou plein.
   L'application est fermée : sans fenêtre, l'écran est VIDE tout ce temps.

   Cette fenêtre ne peut pas être un second processus de l'application : NSIS
   commence par TUER tout processus dont le nom de fichier est `neo-quiz.exe`
   (`CHECK_APP_RUNNING`, `nsProcess::KillProcess`), puis il RENOMME le dossier
   d'installation avant d'y poser la version neuve (`un.atomicRMDir`). Un
   processus lancé depuis ce dossier serait tué par son nom ; et s'il ne l'était
   pas, il risquerait d'empêcher le renommage, c'est-à-dire de FAIRE ÉCHOUER la
   mise à jour — bien pire qu'une attente sans fenêtre.

   D'où des LIENS DURS : le dossier d'installation est reflété dans le
   temporaire, où l'exécutable prend un autre nom. Ce sont les mêmes fichiers
   sous un second nom. (Since 2026-10-09, except `app.asar`, which is
   copied: see `COPIES`.) Le processus lancé de là échappe
   au kill par nom, et le renommage du dossier d'origine reste permis.

   ÉPROUVÉ (2026-09-20, sur le vrai arbre Electron de 297 Mo) : 18 liens en
   26 ms et zéro octet copié ; le processus SURVIT au kill par nom ; le
   renommage du dossier d'installation RÉUSSIT pendant qu'il tourne ; la version
   neuve s'installe et l'ancien dossier se supprime entièrement.
══════════════════════════════════════════════════════════ */

import { copyFileSync, rmSync } from "node:fs";
import { link, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { sansAsar } from "../installer/sondage";

export type LangueFenetre = "en" | "fr";

/** Le drapeau qui fait de ce lancement une FENÊTRE DE MISE À JOUR et non
    l'application. Lu par `main.ts` avant toute autre décision. */
export const DRAPEAU_FENETRE_MAJ = "--neo-quiz-fenetre-maj";

/** Le préfixe des dossiers de reflet, dans le temporaire de l'utilisateur.
    `nettoyerLiensMaj` ne supprime que ce qui le porte. */
export const PREFIXE_LIENS = "neo-quiz-maj-";

/** The name the executable takes in the mirror. ANYTHING BUT the app's: NSIS
    kills by file name.

    Not `neo-quiz-maj.exe` any more (2026-10-09): windows under that name
    hard-linked `resources/app.asar` and kept it open, so the in-place install
    could not replace it. The new installer kills every process still named
    `neo-quiz-maj.exe` (`installer/uninstaller.nsh`, `customInit`) to rescue
    the versions that launch such a window; a window under the new name holds
    only its own copy of the asar and is never killed.

    Not `neo-quiz-fenetre.exe` either (2026-10-10): those windows (1.20.59 to
    1.20.69) still held the installed `app.asar`, this time through their
    progress probe (`installer/sondage.ts`), and are killed the same way. */
export const NOM_EXECUTABLE_MAJ = "neo-quiz-progression.exe";

/** The names of the windows of 1.20.69 and before, killed by the installer. */
export const ANCIENS_NOMS_EXECUTABLE_MAJ = ["neo-quiz-maj.exe", "neo-quiz-fenetre.exe"] as const;

/** Files COPIED into the mirror instead of linked. Electron keeps
    `app.asar` open for its whole life; through a hard link that is the
    INSTALLED file, and the installer, which now writes the new version over
    the old one in place, could not replace it: on a laptop every file of
    1.20.58 was installed except `app.asar`, still 1.20.55, after a long
    stall at about 79 %, and the app restarted on the old code. A copy costs
    about 35 MB in the temp folder for the length of the update. */
const COPIES = new Set(["app.asar"]);

/* `sansAsar` (in `installer/sondage.ts`): Electron's patched `fs` reads a
   `.asar` FILE as a folder, so a copy of it fails and `rm` leaves it behind
   (every old mirror still held its `app.asar`, about 32 MB each). */

/** Le témoin que l'APPLICATION écrit à son démarrage. C'est le signal de fin
    que la fenêtre attend : quand l'application relancée par NSIS l'a touché, la
    mise à jour est faite et il n'y a plus rien à montrer.

    Un fichier, et non un canal : les deux processus n'ont ni profil commun ni
    verrou d'instance commun (c'est tout l'objet de `--user-data-dir`), et rien
    ne garantit l'ordre de leur démarrage. */
export function cheminTemoin(base = tmpdir()): string {
	return join(base, "neo-quiz-demarrage");
}

/** Appelé au démarrage de l'APPLICATION. N'échoue jamais bruyamment : une
    erreur d'écriture laisse simplement la fenêtre expirer d'elle-même. */
export async function marquerDemarrage(base = tmpdir()): Promise<void> {
	await writeFile(cheminTemoin(base), String(Date.now()), "utf8").catch(() => undefined);
}

/** Reflète un arbre par des liens durs. Renvoie faux dès le premier échec : un
    arbre à moitié lié ne lancerait rien de bon, et il vaut mieux renoncer à la
    fenêtre que lancer un Electron incomplet. */
export async function refleter(source: string, cible: string, nomExecutable: string): Promise<boolean> {
	let entrees;
	try {
		entrees = await readdir(source, { withFileTypes: true });
	} catch {
		return false;
	}
	for (const entree of entrees) {
		const depuis = join(source, entree.name);
		/* The executable, and it alone, changes name. The other files keep
		   theirs: Electron looks them up by exact name (`resources.pak`,
		   `icudtl.dat`, `resources/app.asar`...). */
		const nom = entree.name === nomExecutable ? NOM_EXECUTABLE_MAJ : entree.name;
		const vers = join(cible, nom);
		try {
			if (COPIES.has(entree.name)) {
				/* Checked first: with asar support on, Electron may describe
				   `app.asar` as a folder. */
				sansAsar(() => copyFileSync(depuis, vers));
			} else if (entree.isDirectory()) {
				await mkdir(vers, { recursive: true });
				if (!(await refleter(depuis, vers, nomExecutable))) return false;
			} else if (entree.isFile()) {
				/* A hard link does not cross volumes: if the temp folder is on
				   another disk than the install, `link` throws here and the update
				   runs without a window, as before. */
				await link(depuis, vers);
			}
			/* A symbolic link does not exist in an Electron package on Windows;
			   meeting one means the tree is not the one we think, and mirroring
			   it blindly would be worse than giving up. */
		} catch {
			return false;
		}
	}
	return true;
}

/** Prépare le reflet d'un arbre et renvoie le chemin de l'exécutable à lancer,
    ou `null` si quoi que ce soit a manqué — le dossier entamé est alors retiré,
    pour ne pas laisser un demi-reflet que le nettoyage prendrait pour un vrai. */
export async function preparerReflet(dossier: string, nomExecutable: string, base = tmpdir()): Promise<string | null> {
	let liens: string;
	try {
		liens = await mkdtemp(join(base, PREFIXE_LIENS));
	} catch {
		return null;
	}
	const renoncer = async (): Promise<null> => {
		await rm(liens, { recursive: true, force: true }).catch(() => undefined);
		return null;
	};
	if (!(await refleter(dossier, liens, nomExecutable))) return await renoncer();
	const exeLie = join(liens, NOM_EXECUTABLE_MAJ);
	try {
		await stat(exeLie);
	} catch {
		return await renoncer();
	}
	return exeLie;
}

/** Les reflets d'une mise à jour PASSÉE. Appelé au démarrage : la fenêtre ne
    peut pas supprimer l'arbre depuis lequel elle s'exécute, et le seul moment
    où plus personne ne le tient est le lancement suivant.

    Un lien dur ne pèse rien tant que l'original existe ; après une mise à jour
    l'original a disparu, et ces liens sont alors la SEULE référence aux fichiers
    de l'ancienne version — ils pèsent son poids entier. */
export async function nettoyerLiensMaj(base = tmpdir()): Promise<void> {
	let entrees;
	try {
		entrees = await readdir(base, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entree of entrees) {
		if (!entree.isDirectory() || !entree.name.startsWith(PREFIXE_LIENS)) continue;
		try {
			sansAsar(() => rmSync(join(base, entree.name), { recursive: true, force: true }));
		} catch {
			/* A mirror still in use (its window running): the next start. */
		}
	}
}

/** La version à afficher, lue depuis les arguments de ce lancement. Tout ce qui
    n'est pas un `X.Y.Z` est ignoré : cette chaîne est AFFICHÉE, et rien n'oblige
    les arguments d'un processus à être ceux qu'on a écrits. */
export function versionDepuisArguments(argv: readonly string[]): string {
	const index = argv.indexOf(DRAPEAU_FENETRE_MAJ);
	if (index < 0) return "";
	const valeur = argv[index + 1];
	return valeur && /^\d+\.\d+\.\d+$/.test(valeur) ? valeur : "";
}

/** La langue TRANSMISE par l'application. Elle n'est pas redéduite ici : la
    fenêtre tourne sur un profil vide, où le réglage `language` n'existe pas, et
    une application réglée en français annonçait sa mise à jour en anglais.
    L'anglais reste le repli, comme partout ailleurs. */
export function langueDepuisArguments(argv: readonly string[]): LangueFenetre {
	const index = argv.indexOf(DRAPEAU_FENETRE_MAJ);
	return index >= 0 && argv[index + 2] === "fr" ? "fr" : "en";
}

/** What the update window needs to measure the installation, passed by the app
    that launches it (`--neo-quiz-maj-*=value`). It is only READ: sizes for the
    percentage, the install folder to weigh, and the pid of the launching app
    (still running = NSIS has not started). Anything malformed yields `null`
    fields and the window falls back to an indeterminate bar. */
export interface DonneesMaj {
	paquet: number;
	installe: number | null;
	dossier: string | null;
	pid: number | null;
}

export function donneesMajDepuisArguments(argv: readonly string[]): DonneesMaj {
	const lire = (nom: string): string | null => {
		const prefixe = `--neo-quiz-maj-${nom}=`;
		const arg = argv.find(a => a.startsWith(prefixe));
		return arg ? arg.slice(prefixe.length) : null;
	};
	const entier = (v: string | null): number | null => {
		if (v === null || !/^\d{1,15}$/.test(v)) return null;
		const n = Number(v);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	};
	const dossier = lire("dossier");
	return {
		paquet: entier(lire("paquet")) ?? 0,
		installe: entier(lire("installe")),
		dossier: dossier && isAbsolute(dossier) ? dossier : null,
		pid: entier(lire("pid")),
	};
}
