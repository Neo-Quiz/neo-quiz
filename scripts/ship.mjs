/*
 * Livre une version d'un seul geste :
 *
 *   git ship "Fix collapse ghost pixels"   le travail, puis le correctif suivant (x.y.Z+1)
 *   git ship 1.2.0 "Sortie"                 un numéro explicite : c'est ainsi qu'une MINEURE sort
 *   git ship                                l'arbre est déjà propre : bump seul
 *
 * L'alias se pose une fois :
 *
 *   git config --global alias.ship '!node scripts/ship.mjs'
 *
 * Git exécute un alias `!` depuis la racine du dépôt, si bien que le chemin
 * relatif suffit : la commande n'existe que là où ce fichier existe.
 *
 * CE QUE FAIT LA COMMANDE, dans cet ordre :
 *
 *   1. les gardes — branche main, aucune opération git en cours, étiquette
 *      déjà prise, distant qui n'a pas avancé sans nous ;
 *   2. les vérifications (`runChecks`) — rien ne se commite avant qu'elles passent ;
 *   3. le commit du travail, quand il y en a — après confirmation de ce qui est balayé ;
 *   4. la montée de version de la cible choisie (`set-version.mjs`) ;
 *   5. le commit « Version X » et le tag `desktop-vX` ;
 *   6. le push, atomique, de la branche ET de l'étiquette.
 *
 * Le push est la DERNIÈRE étape, et il est atomique. Tout ce qui casse avant
 * lui reste local, donc rattrapable ; et une branche refusée n'abandonne pas
 * derrière elle une étiquette poussée toute seule, qui déclencherait une
 * release sur un commit que personne d'autre n'a.
 *
 * PIÈGE ÉVITÉ — `git push --follow-tags` n'envoie que les étiquettes
 * ANNOTÉES ; une étiquette légère (`git tag vX`, sans `-a`) reste locale en
 * silence, la branche part seule, et `release.yml` (déclenché sur le tag) ne
 * se déclenche jamais. Cette commande ne s'en remet pas à `--follow-tags` :
 * elle nomme l'étiquette EXPLICITEMENT dans le même `git push --atomic`,
 * exactement comme le commit et la branche — cette forme pousse l'étiquette
 * quel que soit son type, léger compris.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { LEVELS, isVersion, setVersion, currentVersion, nextVersion } from "./set-version.mjs";
import { FICHIER, lireUnreleased, deduireNiveau, niveauEntre, rang, figer } from "./changelog.mjs";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".."
);

const BRANCH = "main";

/**
 * Ce que la ligne de commande demande. Le niveau est facultatif — une
 * livraison sur deux ne fait que réparer — et le message aussi, puisque le
 * travail peut déjà être commité.
 */
export function readArguments(args) {
	const words = [];
	let watch = false;

	for (const argument of args) {
		if (argument === "--watch") {
			watch = true;
			continue;
		}
		if (argument.startsWith("-")) {
			throw new Error(
				`Drapeau inconnu : « ${argument} ». Option : --watch.`
			);
		}
		words.push(argument);
	}

	let request = null;
	if (words.length > 0 && LEVELS.includes(words[0])) {
		throw new Error(
			`Pour l'application, le niveau ne se tape plus : il se déduit de la section [Unreleased] de ${FICHIER}. ` +
				"Écris ce que la version change sous ### Added, ### Changed ou ### Fixed, puis `git ship \"Message\"`."
		);
	} else if (words.length > 0 && isVersion(words[0])) {
		request = words.shift();
	}

	const message = words.shift();

	if (words.length > 0) {
		throw new Error(
			`Un mot de trop : « ${words.join(" ")} ». Le message du commit ` +
				"tient entre guillemets, en un seul argument."
		);
	}

	return { request, message, watch };
}

/**
 * Le numéro de la prochaine version de l'APPLICATION, lu dans le CHANGELOG.
 * `demandee` (un numéro explicite) est admise si elle vaut AU MOINS le niveau
 * que la section annonce : livrer 1.1.1 avec une entrée « Added » serait le
 * mensonge exact que le système interdit.
 */
export function versionDepuisChangelog(texte, courante, demandee) {
	const lu = lireUnreleased(texte);
	const niveau = lu ? deduireNiveau(lu.sections) : null;
	if (!niveau) {
		throw new Error(
			`Rien dans la section [Unreleased] de ${FICHIER} : écris ce que cette version change ` +
				"(### Breaking, ### Added, ### Changed, ### Fixed) avant de la livrer."
		);
	}
	if (!demandee) return { version: nextVersion(courante, niveau), niveau };
	const saut = niveauEntre(courante, demandee);
	if (!saut || rang(saut) < rang(niveau)) {
		const remplies = sectionsNonVides(lu.sections).join(", ");
		throw new Error(
			`${demandee} ne peut pas suivre ${courante} : la section [Unreleased] contient ${remplies}, ` +
				`ce qui impose au moins un niveau ${niveau} (${nextVersion(courante, niveau)}).`
		);
	}
	return { version: demandee, niveau };
}

function sectionsNonVides(sections) {
	return Object.entries(sections).filter(([, l]) => l.length).map(([s]) => s);
}

/**
 * Y a-t-il un commit de travail à faire avant la montée de version ? Les deux
 * désaccords possibles entre l'arbre et la ligne de commande s'arrêtent ici,
 * avant que quoi que ce soit ne bouge.
 */
export function worksToCommit(message, dirty) {
	if (dirty && !message) {
		throw new Error(
			"Des changements attendent d'être commités : donne leur message.\n" +
				'  git ship "Ce que ça change"'
		);
	}
	if (!message) return false;
	if (!dirty) {
		throw new Error(
			`Rien à commiter : « ${message} » ne s'accrocherait à aucun ` +
				"changement. Sans message, la commande monte la version seule."
		);
	}
	return true;
}

export function actionsUrl(remote) {
	const found = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
	return found ? `https://github.com/${found[1]}/actions` : undefined;
}

/*
 * FINDING 1 (revue) — sur Windows, `npm` est un script `npm.cmd` : il n'est
 * PAS lançable par `execFileSync` sans shell (CreateProcess veut un vrai
 * exécutable). Plutôt que `shell: true` — qui rouvrirait la question de
 * l'échappement pour des chemins de vault à espaces et accents — on résout
 * le nom du binaire, et les arguments restent un tableau passé tel quel,
 * jamais interprétés par un shell. `git`/`node`/`gh` sont de vrais .exe :
 * seul `npm` a besoin de ce détour.
 */
export function resolveCommand(command, platform = process.platform) {
	return platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

/* Depuis Node 20.12 (CVE-2024-27980), lancer un `.cmd` SANS shell rejette
   `EINVAL` : `npm.cmd` doit passer par `cmd.exe`. Les arguments viennent tous
   de ce fichier (jamais de l'utilisateur), donc le shell n'ouvre rien. */
export function spawnOptions(command) {
	return { cwd: repositoryRoot, stdio: "inherit", shell: /\.cmd$/i.test(command) };
}

/*
 * Les coffres Obsidian d'Ahmed contre lesquels `check:markers` et
 * `audit-vaults.mjs` font leur aller-retour (mêmes chemins que le script
 * `check:markers` de package.json). Cette commande n'échoue jamais sur leur
 * ABSENCE — un autre poste, ou ces dossiers déplacés, ne doit pas empêcher de
 * livrer — mais échoue dur sur tout ce qu'ils révèlent quand ils sont là.
 */
export const REAL_VAULTS = [
	"C:/obsidian-vaults/Personal",
	"C:/obsidian-vaults/Efrei",
];

/**
 * Les vérifications à lancer avant de commiter quoi que ce soit, dans l'ordre
 * du moins cher au plus cher : le typecheck d'abord (quelques secondes,
 * attrape la majorité des régressions), puis les trois seuls jeux de cas du
 * projet (`check:md`/`check:export` — rapides, sans
 * dépendance externe, sur le code réel via esbuild), lancés à CHAQUE livraison
 * plutôt que seulement quand le rendu ou l'écriture semblent touchés : une
 * commande qui devine ce qui a changé pour décider quoi vérifier est plus
 * fragile que trois passes systématiques de quelques secondes chacune.
 *
 * `check:markers` (8570 champs, 2026-07-31) et `audit-vaults.mjs` (67 quiz)
 * portent sur de VRAIS vaults : plus lourds, et absents sur une machine qui
 * n'a pas `C:\obsidian-vaults`. Ils sont lancés seulement si au moins un des
 * chemins de `REAL_VAULTS` existe — cette commande vit sur le poste d'Ahmed,
 * où ils existent toujours, donc en pratique ils tournent à chaque livraison ;
 * ailleurs (CI, un autre poste), le silence à leur sujet ne doit pas empêcher
 * de publier. C'est ce deuxième filet qui a trouvé le pire défaut de la
 * refonte de l'éditeur (`textVariant: 'command'` effaçant 23 invites de
 * terminal, cf. CLAUDE.md) : une commande de livraison qui l'omet livrerait
 * en connaissance de cause un risque déjà identifié.
 */
export function checksToRun(existingVaults = REAL_VAULTS.filter(existsSync)) {
	const checks = [
		{ label: "typecheck", command: resolveCommand("npm"), args: ["run", "check"] },
		{ label: "check:changelog", command: resolveCommand("npm"), args: ["run", "check:changelog"] },
		{ label: "check:md", command: resolveCommand("npm"), args: ["run", "check:md"] },
		{ label: "check:export", command: resolveCommand("npm"), args: ["run", "check:export"] },
	];

	if (existingVaults.length > 0) {
		checks.push({
			label: "check:markers",
			command: resolveCommand("npm"),
			args: ["run", "check:markers"],
		});
		checks.push({
			label: "audit-vaults",
			command: resolveCommand("node"),
			args: ["scripts/audit-vaults.mjs", ...existingVaults],
		});
	}

	return { checks, skippedVaults: existingVaults.length === 0 };
}

/*
 * FINDING 2 (revue) — un arbre « sale » n'est pas forcément du travail en
 * cours : une fusion ou un rebasage interrompus par des conflits laissent
 * l'arbre sale aussi, avec des marqueurs `<<<<<<<` dedans. Rien dans
 * `runChecks` ne les repère (le typecheck ne lit pas le Markdown/CSS, et
 * `check:md`/`check:export` ne relisent pas le dépôt lui-même). Ces cinq
 * noms sont la façon dont Git marque une opération en cours ; leur présence
 * dans le dossier `.git` est vérifiée AVANT toute autre garde, puisqu'elle
 * ne coûte aucun accès réseau.
 */
export const OPERATION_MARKERS = [
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"rebase-merge",
	"rebase-apply",
	// FINDING 2 (revue, round 2) — un picorage ou un retour en arrière portant
	// sur PLUSIEURS commits, interrompu SANS conflit (donc sans CHERRY_PICK_HEAD
	// ni REVERT_HEAD), ne laisse que ce répertoire : la séquence est suspendue,
	// pas annulée. L'oublier laissait livrer en plein milieu d'une séquence.
	"sequencer",
];

/** Le premier marqueur présent, ou `null` — pure, pour rester testable sans dépôt réel. */
export function ongoingOperationFrom(existingMarkers) {
	return OPERATION_MARKERS.find((marker) => existingMarkers.includes(marker)) ?? null;
}

/*
 * FINDING 4 (revue, round 1) — `git add -A` balaie tout l'arbre, y compris
 * une modification qui n'appartient à aucun chantier (ça s'est produit : une
 * retouche personnelle de `dashboard-ai.css`, protégée toute la nuit). Entre
 * restreindre la portée du commit et demander confirmation, la seconde avait
 * été retenue — mais une confirmation par « o/N » se tape sans lire, surtout
 * à la troisième utilisation (FINDING 1, round 2). La confirmation ne
 * disparaît pas : elle se durcit. Il ne suffit plus de taper une touche
 * réflexe — il faut recopier le NOMBRE de chemins affichés, ce qui n'est
 * possible qu'en les ayant comptés, donc regardés.
 */
export function stagedPathsFrom(porcelain) {
	return porcelain
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter(Boolean)
		.map((line) => line.slice(3));
}

export function confirmStagePrompt(paths) {
	return [
		"`git add -A` va inclure :",
		...paths.map((relativePath) => `  ${relativePath}`),
		"",
		`Tape ${paths.length} pour confirmer (autre chose annule) : `,
	].join("\n");
}

/** Le nombre recopié doit être EXACTEMENT celui affiché — pas « o », pas « oui ». */
export function confirmsStaging(answer, pathCount) {
	return answer.trim() === String(pathCount);
}

/*
 * FINDING 1 (revue, round 2) — un script de livraison finit toujours par
 * être appelé depuis un autre script (CI, un autre outil) un jour ou l'autre.
 * Sans terminal attaché, `readline.question()` ne se résout jamais sur une
 * entrée fermée immédiatement : le process se termine avec un code 0, sans
 * avoir rien poussé, en laissant croire à l'appelant que la livraison a eu
 * lieu — le pire résultat possible pour cet outil. Refuser AVANT d'ouvrir
 * `readline` est donc une garde, pas un détail d'UX : elle transforme un
 * blocage silencieux en échec bruyant, immédiat, à code de sortie non nul.
 */
export function requiresInteractiveConfirmation(commitWork, isTTY) {
	return commitWork && !isTTY;
}

/*
 * La séquence finale — commit de version, étiquette, push — n'était pas
 * testable sans exécuter `ship()` : c'est cette zone d'ombre qui a caché le
 * défaut n°1 (npm.cmd) jusqu'à une revue humaine. Extraire chaque tableau
 * d'arguments en fonction pure rend visible, sans rien exécuter, la
 * propriété qui compte le plus ici : `pushArgs` nomme l'étiquette
 * EXPLICITEMENT à côté de la branche, jamais via `--follow-tags`.
 */
export function versionCommitArgs(version) {
	return ["commit", "-am", `Version ${version}`];
}

export function tagArgs(version) {
	return ["tag", `desktop-v${version}`];
}

export function pushArgs(version) {
	return ["push", "--atomic", "origin", BRANCH, tagArgs(version)[1]];
}

/*
 * FINDING 3 (revue, round 2) — après un push refusé (branche derrière, par
 * exemple), l'étiquette locale « Version X » reste posée : une relivraison
 * la retrouve. L'ancien message disait alors « cette version est publiée »
 * dans les DEUX cas, ce qui est faux quand l'étiquette n'a jamais atteint
 * origin — et pousse à tort vers une manœuvre côté distant. Les deux cas
 * sont distingués : `remote` vient de `git ls-remote --tags origin`, une
 * question posée directement au distant, indépendante de ce que `git fetch`
 * a rapatrié dans les refs locales.
 */
export function describeTagConflict({ local, remote }, version) {
	const tag = tagArgs(version)[1];
	if (remote) {
		return `L'étiquette ${tag} existe sur origin : cette version est déjà publiée.`;
	}
	if (local) {
		return (
			`L'étiquette ${tag} existe déjà en LOCAL seulement (probablement ` +
			"une livraison précédente interrompue avant le push) : " +
			`\`git tag -d ${tag}\` avant de relivrer, ou choisis un autre numéro.`
		);
	}
	return null;
}

function git(args, options = {}) {
	return execFileSync("git", args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		...options,
	});
}

/** Les mêmes commandes, mais leur sortie va à l'écran : on suit ce qui se passe. */
function run(command, args) {
	console.log(`  ${command} ${args.join(" ")}`);
	execFileSync(resolveCommand(command), args, spawnOptions(resolveCommand(command)));
}

function runChecks() {
	const { checks, skippedVaults } = checksToRun();

	console.log("Vérifications avant livraison :");
	for (const check of checks) {
		console.log(`\n— ${check.label}`);
		execFileSync(check.command, check.args, spawnOptions(check.command));
	}
	if (skippedVaults) {
		console.log(
			"\n(check:markers et audit-vaults ignorés : aucun vault de " +
				"REAL_VAULTS n'existe sur ce poste)"
		);
	}
	console.log("");
}

/** Pose la question et rend la réponse brute ; ferme l'interface dans tous les cas. */
async function ask(promptText) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(promptText);
	} finally {
		rl.close();
	}
}

/**
 * Ce qui doit être vrai avant de toucher à quoi que ce soit. Chacune de ces
 * vérifications a sa raison d'être ici plutôt qu'au moment du push : passé le
 * premier commit, l'échec laisse un dépôt à démêler à la main.
 */
function guard(version) {
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	if (branch !== BRANCH) {
		throw new Error(
			`Une version se livre depuis ${BRANCH}, pas depuis « ${branch} ».`
		);
	}

	// Le moins cher d'abord : aucun accès réseau, juste lire `.git`.
	const gitDir = git(["rev-parse", "--git-dir"]).trim();
	const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repositoryRoot, gitDir);
	const present = OPERATION_MARKERS.filter((marker) =>
		existsSync(path.join(absoluteGitDir, marker))
	);
	const marker = ongoingOperationFrom(present);
	if (marker) {
		throw new Error(
			`Une opération est en cours (${marker}) : termine-la ou annule-la ` +
				"(git merge/rebase/cherry-pick --abort) avant de livrer."
		);
	}

	// FINDING 4 (revue, round 2) — deux pannes très différentes partageaient un
	// seul message. `git remote get-url` échoue seulement si 'origin' n'existe
	// pas ; si elle réussit mais que le fetch échoue ensuite, la cause est
	// réseau ou authentification — pas un remote absent. Les deux catch
	// parlent maintenant chacun de sa propre panne, sans se faire passer pour
	// l'autre.
	try {
		git(["remote", "get-url", "origin"]);
	} catch (error) {
		throw new Error(
			"Aucun remote 'origin' configuré. -> git remote add origin <url>"
		);
	}

	try {
		// FINDING 3, round 1 (revue) — `--tags` rapporte aussi les étiquettes du
		// distant : sans lui, une étiquette déjà poussée par ailleurs n'était
		// découverte qu'au push, laissant un commit « Version X » local à démêler.
		git(["fetch", "--quiet", "--tags", "origin", BRANCH]);
	} catch (error) {
		throw new Error(
			`Impossible de récupérer 'origin' (${error.message.trim()}).\n` +
				`Réseau, authentification, ou branche absente sur le distant ? ` +
				`Vérifie : git fetch origin ${BRANCH}`
		);
	}

	// FINDING 3, round 2 (revue) — `git tag --list` ne dit pas si l'étiquette
	// vient d'origin ou n'a jamais quitté ce poste ; `ls-remote` interroge le
	// distant directement, sans dépendre de ce que le fetch a rapatrié.
	const tag = tagArgs(version)[1];
	const local = git(["tag", "--list", tag]).trim() !== "";
	const remote = git(["ls-remote", "--tags", "origin", tag]).trim() !== "";
	const conflict = describeTagConflict({ local, remote }, version);
	if (conflict) throw new Error(conflict);

	// Le distant a-t-il avancé sans nous ? Le savoir maintenant coûte un
	// fetch (déjà fait ci-dessus) ; le savoir au push coûte un commit et une
	// étiquette à défaire.
	const behind = git(["rev-list", "--count", `HEAD..origin/${BRANCH}`]).trim();

	if (behind !== "0") {
		throw new Error(
			`origin/${BRANCH} a ${behind} commit(s) d'avance. ` +
				"Rattrape-les avant de livrer :\n  git pull --rebase"
		);
	}
}

async function ship(args) {
	const { request, message, watch } = readArguments(args);

	const porcelain = git(["status", "--porcelain"]);
	const dirty = porcelain.trim() !== "";
	const commitWork = worksToCommit(message, dirty);

	let version;
	const changelog = await readFile(path.join(repositoryRoot, FICHIER), "utf8");
	({ version } = versionDepuisChangelog(changelog, await currentVersion(), request));
	guard(version);

	runChecks();

	if (commitWork) {
		// FINDING 1 (revue, round 2) — refuser AVANT d'ouvrir `readline` : sans
		// terminal, la question ne se résoudrait jamais et le process finirait
		// avec un code 0 sans avoir rien poussé — l'appelant croirait à tort
		// que la livraison a eu lieu.
		if (requiresInteractiveConfirmation(commitWork, process.stdin.isTTY)) {
			throw new Error(
				"Confirmation impossible : aucun terminal attaché à l'entrée " +
					"standard. `git ship` avec un message a besoin d'un humain " +
					"pour confirmer `git add -A` — lance-le depuis un terminal."
			);
		}

		const paths = stagedPathsFrom(porcelain);
		const answer = await ask(confirmStagePrompt(paths));
		if (!confirmsStaging(answer, paths.length)) {
			throw new Error(
				"Livraison annulée : confirmation refusée avant `git add -A`."
			);
		}
		run("git", ["add", "-A"]);
		run("git", ["commit", "-m", message]);
	}

	console.log(`\nVersion ${version} :`);
	for (const relativePath of await setVersion(version)) {
		console.log(`  ${relativePath}`);
	}

	const date = new Date().toISOString().slice(0, 10);
	await writeFile(path.join(repositoryRoot, FICHIER), figer(changelog, version, date), "utf8");
	console.log(`  ${FICHIER}`);

	console.log("");
	run("git", versionCommitArgs(version));
	run("git", tagArgs(version));
	run("git", pushArgs(version));

	const actions = actionsUrl(git(["remote", "get-url", "origin"]).trim());
	console.log(`\nVersion ${version} livrée.`);
	if (actions) console.log(`  ${actions}`);

	if (watch) {
		// `gh` peut manquer, et une CI que l'on n'a pas pu suivre ne défait
		// pas une version déjà poussée : la commande a fait son travail.
		try {
			run("gh", ["run", "watch", "--exit-status"]);
		} catch (error) {
			console.error(`\nSuivi impossible : ${error.message}`);
		}
	}
}

const invokedScript = process.argv[1]
	? pathToFileURL(path.resolve(process.argv[1])).href
	: undefined;

if (invokedScript === import.meta.url) {
	try {
		await ship(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
