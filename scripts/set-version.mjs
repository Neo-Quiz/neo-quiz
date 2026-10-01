/*
 * Monte la version de l'application d'un seul geste :
 *
 *   npm run version:set -- patch             2.4.0-beta → 2.4.1-beta (app)
 *   npm run version:set -- minor             2.4.1-beta → 2.5.0-beta (app)
 *   npm run version:set -- major             2.5.0-beta → 3.0.0-beta (app)
 *   npm run version:set -- 3.0.0             le numéro exact, quand il le faut
 *
 * CE QUE DIT UN NUMÉRO. Les trois nombres ne sont pas décoratifs : ils
 * répondent à « qu'est-ce que ça change pour moi ? ».
 *
 *   MAJEUR    l'utilisateur perd une habitude : un format de quiz qui ne se
 *             relit plus comme avant, un réglage qui disparaît.
 *   MINEUR    quelque chose de neuf que l'on peut faire et que l'on ne
 *             pouvait pas. Rien ne casse.
 *   CORRECTIF rien de neuf : ce qui existait déjà marche enfin comme il
 *             devait.
 *
 * SUFFIXE. Un bump GARDE le suffixe qu'il trouve : une série `-beta` reste en
 * beta jusqu'à ce qu'un numéro exact, écrit en toutes lettres sans suffixe,
 * la fasse sortir de ce statut. Perdre ou gagner un suffixe en bumpant
 * serait changer le statut d'une release par accident — c'est
 * `.github/workflows/release.yml` qui décide `prerelease` sur la présence
 * d'un `-` dans le tag, donc ce choix a un effet direct sur GitHub.
 *
 * UN FICHIER PORTE LE NUMÉRO. L'application vit dans
 * `apps/windows/package.json` (lockfile synchronisé, tags `desktop-vX.Y.Z`) ;
 * la version de `package.json` racine est statique et ignorée,
 * volontairement.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_FILE = "apps/windows/package.json";
const LOCKFILE = "apps/windows/package-lock.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const LEVELS = ["major", "minor", "patch"];

export function isVersion(value) {
	return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** Le suffixe survit au bump ; un numéro exact peut changer le statut. */
export function nextVersion(current, level) {
	if (!isVersion(current)) throw new Error(`Version actuelle illisible : « ${current} ».`);
	const [, core, suffix] = current.match(/^(\d+\.\d+\.\d+)(-.+)?$/);
	const [major, minor, patch] = core.split(".").map(Number);
	let bumped;
	switch (level) {
		case "major": bumped = `${major + 1}.0.0`; break;
		case "minor": bumped = `${major}.${minor + 1}.0`; break;
		case "patch": bumped = `${major}.${minor}.${patch + 1}`; break;
		default: throw new Error(`Niveau attendu parmi ${LEVELS.join(", ")}, reçu « ${level} ».`);
	}
	return suffix ? bumped + suffix : bumped;
}

export async function currentVersion() {
	const file = VERSION_FILE;
	const { version } = JSON.parse(await readFile(path.join(repositoryRoot, file), "utf8"));
	if (!isVersion(version)) throw new Error(`Version introuvable ou illisible dans ${file}.`);
	return version;
}

export async function resolveVersion(request) {
	if (LEVELS.includes(request)) return nextVersion(await currentVersion(), request);
	if (isVersion(request)) return request;
	throw new Error(`Attendu : ${LEVELS.join(" | ")} ou un numéro comme 1.0.0, reçu « ${request} ».`);
}

/** Remplace une version unique en préservant la mise en forme du fichier. */
export function withVersion(text, version, file = VERSION_FILE) {
	const pattern = /("version"\s*:\s*")[^"]+(")/g;
	const found = [...text.matchAll(pattern)].length;
	if (found !== 1) throw new Error(`${file} : 1 occurrence de "version" attendue, ${found} trouvée(s).`);
	return text.replace(pattern, (_, prefix, suffix) => prefix + version + suffix);
}

export async function setVersion(version) {
	if (!isVersion(version)) {
		throw new Error(`Version attendue sous la forme 1.2.3 ou 1.2.3-beta, reçu « ${version} ».`);
	}
	const file = VERSION_FILE;
	const before = await readFile(path.join(repositoryRoot, file), "utf8");
	const after = withVersion(before, version, file);
	const changes = [{ file, before, after }];
	{
		const lockBefore = await readFile(path.join(repositoryRoot, LOCKFILE), "utf8");
		const lock = JSON.parse(lockBefore);
		if (!isVersion(lock.version) || !isVersion(lock.packages?.[""]?.version)) {
			throw new Error(LOCKFILE + ' : versions racine et packages[""] attendues.');
		}
		lock.version = version;
		lock.packages[""].version = version;
		const indent = /\n([ \t]+)"/.exec(lockBefore)?.[1] ?? "  ";
		const eol = lockBefore.includes("\r\n") ? "\r\n" : "\n";
		const lockAfter = (JSON.stringify(lock, null, indent) + "\n").replaceAll("\n", eol);
		changes.push({ file: LOCKFILE, before: lockBefore, after: lockAfter });
	}
	const touched = changes.filter(change => change.after !== change.before);
	if (touched.length === 0) throw new Error(`Rien à changer dans ${file}.`);
	// Tous les documents sont validés avant la première écriture.
	for (const change of touched) {
		await writeFile(path.join(repositoryRoot, change.file), change.after);
	}
	return touched.map(change => change.file);
}

const invokedScript = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedScript === import.meta.url) {
	try {
		const words = process.argv.slice(2);
		if (words.length !== 1) throw new Error("Attendu : major | minor | patch | X.Y.Z.");
		const version = await resolveVersion(words[0]);
		for (const file of await setVersion(version)) console.log("  " + file);
		const tag = "desktop-v" + version;
		console.log(`
Version ${version}. Reste à publier :`);
		console.log(`  git commit -am "Version ${version}"`);
		console.log(`  git tag ${tag} && git push --atomic origin main ${tag}`);
		console.log(`
Ou, la prochaine fois : git ship "Ce que ça change"`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
