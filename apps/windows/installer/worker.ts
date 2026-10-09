/* ══════════════════════════════════════════════════════════
   TRAVAILLEUR DU BOOTSTRAPPER

   L'interface reste au niveau de l'utilisateur. Seul ce processus télécharge
   puis exécute NSIS : lancé directement quand l'utilisateur peut écrire dans
   le dossier d'installation, par Windows après l'UAC sinon (`main.ts`,
   `elevationRequise`). Il ne rend aucune fenêtre : son unique sortie est le
   tube nommé créé par le processus de l'interface, ce qui permet à celui-ci
   de relancer Neo Quiz SANS lui transmettre des droits administrateur.
══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { get } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import {
	argumentsNsis,
	paquetInstallable,
	reessayer,
	resoudrePaquet,
	suivre,
	suiviInitial,
	telechargerAvecReessais,
	urlLatestYml,
	type BaremeInstallation,
	type PaquetInstallable,
} from "./noyau";
import { tailleDossier, tailleTemporairesNsis } from "./sondage";
import { appendLog, isAppRunning } from "./probe";
import type {
	ChargeTravailleur,
	CodeErreurInstallateur,
	CommandeTravailleur,
	InstallerErrorDetail,
	InstallerStep,
	MessageTravailleur,
} from "./protocole";

const USER_AGENT = "Neo-Quiz-Installer";
const MAX_REDIRECTIONS = 5;

/** The raw facts of a failure (errno, HTTP status, host, exit code): they go
    to the window, where `diagnosis.ts` names the cause, and to the log. */
type FaitsErreur = Omit<InstallerErrorDetail, "step" | "downloadVerified" | "appRunning">;

export class ErreurTravailleur extends Error {
	constructor(readonly code: CodeErreurInstallateur, readonly faits: FaitsErreur = {}, readonly nonLance = false) {
		super([code, faits.errno, faits.http && `HTTP ${faits.http}`, faits.host, faits.message].filter(Boolean).join(": "));
	}
}

/** The errno (or OpenSSL code) of a Node error, never a guess. */
function errnoDe(erreur: unknown): string | undefined {
	const code = (erreur as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

const journaliser = appendLog;

/** A socket silent this long is dead: a VPN or proxy that drops the
    connection without closing it would otherwise freeze the bar forever. */
const DELAI_INACTIVITE_MS = 30_000;

const attendre = (ms: number): Promise<void> => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

/** Le paquet est REVALIDÉ par le noyau, jamais cru : l'URL doit être celle
    que la version implique, sinon un principal compromis ferait télécharger
    et exécuter n'importe quel fichier avec les droits administrateur. */
function paquetValide(value: unknown): value is PaquetInstallable {
	if (!value || typeof value !== "object") return false;
	const p = value as Record<string, unknown>;
	if (typeof p.version !== "string" || typeof p.nom !== "string" || typeof p.url !== "string" ||
		typeof p.taille !== "number" || typeof p.sha512 !== "string" ||
		!(p.tailleInstallee === null || typeof p.tailleInstallee === "number")) return false;
	const reconstruit = paquetInstallable({
		version: p.version, nom: p.nom, taille: p.taille, sha512: p.sha512, tailleInstallee: p.tailleInstallee,
	});
	return !!reconstruit && reconstruit.nom === p.nom && reconstruit.url === p.url &&
		reconstruit.taille === p.taille && reconstruit.sha512 === p.sha512 &&
		reconstruit.tailleInstallee === p.tailleInstallee;
}

function decoderCharge(encoded: string): ChargeTravailleur | null {
	try {
		const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
		if (!value || typeof value !== "object") return null;
		const v = value as Record<string, unknown>;
		if (typeof v.secret !== "string" || !/^[0-9a-f]{64}$/i.test(v.secret)) return null;
		if (typeof v.dossier !== "string" || !isAbsolute(v.dossier)) return null;
		const dossier = resolve(v.dossier);
		/* Un dossier racine (`C:\`) transformerait un installateur d'application
		   en écrivain général du volume. Le choix explicite d'un sous-dossier
		   garde la portée de l'élévation étroite. */
		if (parse(dossier).root === dossier) return null;
		if (!paquetValide(v.paquet)) return null;
		return { secret: v.secret, dossier, paquet: v.paquet };
	} catch {
		return null;
	}
}

function hoteTelechargementAutorise(url: URL): boolean {
	return url.protocol === "https:" &&
		(url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com"));
}

async function ouvrirReponse(url: URL, signal: AbortSignal, redirections = 0): Promise<IncomingMessage> {
	if (!hoteTelechargementAutorise(url) || redirections > MAX_REDIRECTIONS) {
		/* A redirect outside GitHub is what a captive portal or a filtering
		   proxy does: a network block, named as such. */
		throw new ErreurTravailleur("network", { errno: "EREDIRECT", host: url.hostname, message: "redirected outside GitHub or too many redirects" });
	}
	return await new Promise<IncomingMessage>((resolvePromise, reject) => {
		const requete = get(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" } }, reponse => {
			const code = reponse.statusCode ?? 0;
			if (code >= 300 && code < 400 && reponse.headers.location) {
				reponse.resume();
				let suivante: URL;
				try {
					suivante = new URL(reponse.headers.location, url);
				} catch {
					reject(new ErreurTravailleur("network", { errno: "EREDIRECT", host: url.hostname, message: "invalid redirect" }));
					return;
				}
				void ouvrirReponse(suivante, signal, redirections + 1).then(resolvePromise, reject);
				return;
			}
			if (code !== 200) {
				reponse.resume();
				reject(new ErreurTravailleur("network", { http: code, host: url.hostname, message: url.pathname }));
				return;
			}
			resolvePromise(reponse);
		});
		requete.setTimeout(DELAI_INACTIVITE_MS, () => {
			requete.destroy(Object.assign(new Error(`no data for ${DELAI_INACTIVITE_MS / 1000} s`), { code: "ETIMEDOUT" }));
		});
		requete.once("error", erreur => {
			if (signal.aborted) reject(erreur);
			else reject(new ErreurTravailleur("network", { errno: errnoDe(erreur), host: url.hostname, message: erreur.message }));
		});
	});
}

/** A small text file of the release (`latest.yml`), through the SAME network
    stack as the download: the main process reads the release with it, and
    "Try again" uses it as its quick connection test, so a test that passes
    means the download can pass too. Bounded in time and size. */
export async function lireTexteGithub(url: string, delaiMs = 15_000): Promise<string> {
	const controleur = new AbortController();
	let expire = false;
	const minuterie = setTimeout(() => { expire = true; controleur.abort(); }, delaiMs);
	try {
		const reponse = await ouvrirReponse(new URL(url), controleur.signal);
		let texte = "";
		for await (const morceau of reponse) {
			texte += String(morceau);
			if (texte.length > 64 * 1024) {
				reponse.destroy();
				throw new ErreurTravailleur("network", { errno: "EBADRELEASE", message: "latest.yml larger than 64 KB" });
			}
		}
		return texte;
	} catch (erreur) {
		if (expire) {
			throw new ErreurTravailleur("network", { errno: "ETIMEDOUT", host: new URL(url).hostname, message: `no answer within ${delaiMs / 1000} s` });
		}
		if (erreur instanceof ErreurTravailleur) throw erreur;
		throw new ErreurTravailleur("network", { errno: errnoDe(erreur), message: String((erreur as Error)?.message ?? erreur) });
	} finally {
		clearTimeout(minuterie);
	}
}

/** The release `latest.yml` describes. A file that is not a valid
    description (an HTML page a proxy serves with 200) is `EBADRELEASE`. */
export async function lirePaquetPublie(version: unknown, delaiMs?: number): Promise<PaquetInstallable> {
	const paquet = resoudrePaquet(await lireTexteGithub(urlLatestYml(version), delaiMs));
	if (!paquet) throw new ErreurTravailleur("release", { errno: "EBADRELEASE", message: "latest.yml does not describe one installer" });
	return paquet;
}

async function telecharger(
	paquet: PaquetInstallable,
	destination: string,
	signal: AbortSignal,
	surProgression: (recus: number) => void,
): Promise<void> {
	/* A previous attempt may have left a partial file (flag "wx" below). */
	await rm(destination, { force: true });
	const reponse = await ouvrirReponse(new URL(paquet.url), signal);
	/* sha512 en base64 : l'empreinte de `latest.yml`, celle qu'electron-updater
	   vérifie aussi, et que `check:package` compare à l'exe avant publication. */
	const hash = createHash("sha512");
	let recus = 0;
	let dernierEnvoi = 0;
	const observer = new Transform({
		transform(morceau: Buffer, _encodage, rappel) {
			recus += morceau.length;
			hash.update(morceau);
			const maintenant = Date.now();
			if (maintenant - dernierEnvoi >= 100 || recus === paquet.taille) {
				dernierEnvoi = maintenant;
				surProgression(recus);
			}
			rappel(null, morceau);
		},
	});
	try {
		await pipeline(reponse, observer, createWriteStream(destination, { flags: "wx" }), { signal });
	} catch (erreur) {
		if (signal.aborted || erreur instanceof ErreurTravailleur) throw erreur;
		/* A reset or truncated body mid-download is a network failure (before
		   desktop-v1.20.61 it surfaced as "could not continue"); a refused write
		   (antivirus, full disk) is an installation one. */
		const errno = errnoDe(erreur) ?? "EUNKNOWN";
		const ecriture = /^(EPERM|EACCES|EBUSY|ENOSPC|EROFS|EMFILE|ENOENT)$/.test(errno);
		throw new ErreurTravailleur(ecriture ? "installation" : "network", {
			errno,
			host: new URL(paquet.url).hostname,
			message: `${String((erreur as Error)?.message ?? erreur)} after ${recus} of ${paquet.taille} bytes`,
		});
	}
	if (recus !== paquet.taille) {
		throw new ErreurTravailleur("integrity", { message: `size ${recus}, expected ${paquet.taille}` });
	}
	if (hash.digest("base64") !== paquet.sha512) {
		throw new ErreurTravailleur("integrity", { message: "sha512 differs from latest.yml" });
	}
}

/** Is the file at `chemin` exactly the published package? Size, then the
    sha512 of every byte: a download kept from a failed attempt is reused only
    on this proof, so "Try again" never relaxes the integrity check. */
async function fichierConforme(chemin: string, paquet: PaquetInstallable): Promise<boolean> {
	try {
		if ((await stat(chemin)).size !== paquet.taille) return false;
		const hash = createHash("sha512");
		for await (const morceau of createReadStream(chemin)) hash.update(morceau as Buffer);
		return hash.digest("base64") === paquet.sha512;
	} catch {
		return false;
	}
}

async function lancerNsis(
	installeur: string,
	dossier: string,
	bareme: BaremeInstallation,
	surProgression: (pourcent: number | null) => void,
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		/* L'environnement est celui du travailleur, INTACT : voir la note de
		   `tailleTemporairesNsis` pour ce que coûterait de le remplacer. */
		const enfant = spawn(installeur, argumentsNsis(dossier), {
			windowsHide: true,
			stdio: "ignore",
		});
		const depart = Date.now();
		/* Tout l'état roulant vit dans le noyau (`suivre`), et pas ici : le creux
		   du dossier, celui du dossier temporaire, et le maximum extrait sont des
		   DÉCISIONS — celle qui distingue l'ancienne version déplacée par le
		   désinstalleur des octets de la vraie extraction, notamment — et elles
		   doivent s'éprouver sans lancer NSIS. Ce qui reste ici est le sondage
		   lui-même : lire deux dossiers, et publier. */
		let suivi = suiviInitial(bareme);
		let sondageEnCours = false;
		surProgression(suivi.dernier);
		const sonder = async (): Promise<void> => {
			if (sondageEnCours) return;
			sondageEnCours = true;
			try {
				const [courant, tempCourant] = await Promise.all([
					tailleDossier(dossier),
					tailleTemporairesNsis(depart),
				]);
				suivi = suivre(bareme, suivi, {
					ecoule: Date.now() - depart,
					dossier: courant,
					temporaire: tempCourant,
				});
				surProgression(suivi.dernier);
			} catch {
				// Le sondage ne doit jamais faire échouer l'installation.
			} finally {
				sondageEnCours = false;
			}
		};
		/* 150 ms : les deux dossiers font ensemble moins de deux mille fichiers
		   et un sondage coûte quelques millisecondes (mesuré : 0 à 5 ms), mais
		   les étapes aveugles avancent au temps écoulé — la barre doit bouger
		   assez souvent pour que ce soit un glissement et non des sauts. */
		const minuterie = setInterval(() => { void sonder(); }, 150);
		const terminer = (): void => clearInterval(minuterie);
		enfant.once("error", erreur => {
			terminer();
			/* nonLance: the installer never started (file locked or deleted by an
			   antivirus, or blocked by Windows). */
			reject(new ErreurTravailleur("installation", { errno: errnoDe(erreur) ?? "UNKNOWN", message: erreur.message }, true));
		});
		enfant.once("exit", code => {
			terminer();
			if (code === 0) {
				surProgression(100);
				resolvePromise();
			} else {
				reject(new ErreurTravailleur("installation", { exitCode: code ?? -1, message: `NSIS exit code ${code}` }));
			}
		});
	});
}

async function nettoyerInstallationFraiche(dossier: string, supprimerDossier: boolean): Promise<void> {
	/* Pendant NSIS on ne tue pas brutalement le processus : une interruption au
	   milieu d'une écriture peut laisser registre/raccourcis incohérents. La
	   demande est mémorisée, NSIS termine sa transaction, puis une installation
	   FRAÎCHE est désinstallée proprement avant de rendre « annulé ». Une mise
	   à jour existante n'est jamais supprimée : mieux vaut conserver une app
	   cohérente que détruire la version précédente en prétendant annuler. */
	let desinstalleur: string | null = null;
	try {
		const noms = await readdir(dossier);
		const nom = noms.find(item => /^uninstall.*\.exe$/i.test(item));
		if (nom) desinstalleur = join(dossier, nom);
	} catch {
		// Le dossier peut déjà avoir disparu : rien à nettoyer.
	}
	if (desinstalleur) {
		await new Promise<void>(resolvePromise => {
			const enfant = spawn(desinstalleur as string, ["/S"], { windowsHide: true, stdio: "ignore" });
			let fini = false;
			const terminer = (): void => {
				if (fini) return;
				fini = true;
				clearTimeout(limite);
				resolvePromise();
			};
			const limite = setTimeout(() => {
				try { enfant.kill(); } catch { /* déjà terminé */ }
				terminer();
			}, 20_000);
			enfant.once("error", terminer);
			enfant.once("exit", terminer);
		});
	}
	if (supprimerDossier) {
		try { await rm(dossier, { recursive: true, force: true }); } catch { /* meilleur effort */ }
	}
}

async function ouvrirTube(nom: string): Promise<Socket> {
	return await new Promise<Socket>((resolvePromise, reject) => {
		const socket = connect(nom);
		socket.once("connect", () => resolvePromise(socket));
		socket.once("error", reject);
	});
}

function envoyer(socket: Socket, message: MessageTravailleur): void {
	socket.write(`${JSON.stringify(message)}\n`);
}

function ecouterCommandes(socket: Socket, surCommande: (commande: CommandeTravailleur) => void): void {
	let reste = "";
	socket.setEncoding("utf8");
	socket.on("data", morceau => {
		reste += morceau;
		for (;;) {
			const fin = reste.indexOf("\n");
			if (fin < 0) break;
			const ligne = reste.slice(0, fin);
			reste = reste.slice(fin + 1);
			try {
				const valeur: unknown = JSON.parse(ligne);
				if (valeur && typeof valeur === "object" && (valeur as { type?: unknown }).type === "annuler") {
					surCommande({ type: "annuler" });
				}
			} catch {
				/* Un message IPC corrompu ne doit jamais devenir une commande : le
				   tube est ignoré jusqu'à la prochaine ligne valide. */
			}
		}
	});
}

async function terminerTube(socket: Socket): Promise<void> {
	await new Promise<void>(resolvePromise => socket.end(resolvePromise));
}

/** Where a downloaded package waits between attempts. The name is the
    validated package name (`neo-quiz-setup-X.Y.Z.exe`), never a path received
    from elsewhere; the file is only ever launched after `fichierConforme`. */
function cheminCache(nom: string): string {
	return join(tmpdir(), "neo-quiz-installer-cache", nom);
}

/** Entry point called by `main.ts` when the portable was relaunched with the
    worker's private flag. Returns a process exit code; it never shows a raw
    string to the user, it sends the raw FACTS of a failure to the window. */
export async function executerTravailleur(nomTube: string, chargeEncodee: string): Promise<number> {
	const charge = decoderCharge(chargeEncodee);
	if (!charge) {
		await journaliser("worker payload rejected (exit 2)");
		return 2;
	}

	let socket: Socket;
	try {
		socket = await ouvrirTube(nomTube);
	} catch (erreur) {
		await journaliser(`worker could not open the pipe (exit 3): ${String(erreur)}`);
		return 3;
	}
	envoyer(socket, { type: "auth", secret: charge.secret });
	await journaliser(`worker started for ${charge.paquet.nom} into ${charge.dossier}`);

	const annulation = new AbortController();
	let dossierExistait = true;
	try { await access(charge.dossier); } catch { dossierExistait = false; }
	let installationExistante = true;
	try { await access(join(charge.dossier, "neo-quiz.exe")); } catch { installationExistante = false; }
	ecouterCommandes(socket, commande => {
		if (commande.type === "annuler") annulation.abort();
	});

	const cheminPaquet = cheminCache(charge.paquet.nom);
	/* The step running when a failure happens, and whether the package was
	   already downloaded AND verified: "Try again" then resumes at the
	   installation (see `diagnosis.ts`, `resumeFrom`). */
	let etape: InstallerStep = "download";
	let telechargementVerifie = false;
	let garderPaquet = false;
	try {
		await mkdir(join(tmpdir(), "neo-quiz-installer-cache"), { recursive: true });
		const paquet = await telechargerAvecReessais(charge.paquet, {
			telecharger: p => telecharger(p, cheminPaquet, annulation.signal, recus => {
				envoyer(socket, { type: "telechargement", recus, total: p.taille });
			}),
			relirePaquet: async () => {
				try {
					return await lirePaquetPublie(charge.paquet.version);
				} catch {
					return null;
				}
			},
			attendre: ms => annulation.signal.aborted ? Promise.resolve() : attendre(ms),
			journal: message => { void journaliser(message); },
			dejaVerifie: async p => {
				try { await access(cheminPaquet); } catch { return false; }
				envoyer(socket, { type: "verification" });
				if (await fichierConforme(cheminPaquet, p)) return true;
				/* A kept file that no longer matches is never launched. */
				await rm(cheminPaquet, { force: true });
				return false;
			},
		});
		if (annulation.signal.aborted) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}
		telechargementVerifie = true;
		etape = "launch";

		envoyer(socket, { type: "verification" });
		if (annulation.signal.aborted) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}
		/* Measured BEFORE the launch: it tells whether NSIS will first remove an
		   old version (one more blind step, which the scale accounts for) and it
		   is the starting floor of the copy into place. */
		const initial = await tailleDossier(charge.dossier);
		/* Only a launch that never started is retried (Defender still holds the
		   fresh file: EBUSY/EACCES/EPERM). A NSIS run that started and failed
		   is never replayed automatically: it may have changed the installation. */
		await reessayer(
			() => lancerNsis(
				cheminPaquet,
				charge.dossier,
				{ paquet: paquet.taille, installe: paquet.tailleInstallee, initial },
				pourcent => {
					envoyer(socket, { type: "installation", pourcent });
				},
			),
			erreur => erreur instanceof ErreurTravailleur && erreur.nonLance,
			attendre,
			message => { void journaliser(`NSIS launch: ${message}`); },
		);
		if (annulation.signal.aborted) {
			if (!installationExistante) await nettoyerInstallationFraiche(charge.dossier, !dossierExistait);
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}

		etape = "postcheck";
		const executable = join(charge.dossier, "neo-quiz.exe");
		try {
			await access(executable);
		} catch (erreur) {
			/* NSIS said 0 but the app is not there: removed right after being
			   written, which is what an antivirus quarantine looks like. */
			throw new ErreurTravailleur("installation", { errno: errnoDe(erreur), message: "neo-quiz.exe missing after a successful setup" });
		}
		envoyer(socket, { type: "termine", executable });
		await terminerTube(socket);
		return 0;
	} catch (erreur) {
		if (annulation.signal.aborted) {
			if (!installationExistante) await nettoyerInstallationFraiche(charge.dossier, !dossierExistait);
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}
		const code = erreur instanceof ErreurTravailleur ? erreur.code : "generic";
		const faits: FaitsErreur = erreur instanceof ErreurTravailleur
			? erreur.faits
			: { errno: errnoDe(erreur), message: String((erreur as Error)?.message ?? erreur).slice(0, 300) };
		/* NSIS started then failed: is the app open (its files locked)? Asked
		   only here, and only of `tasklist` with constant arguments. */
		const step: InstallerStep = erreur instanceof ErreurTravailleur && erreur.nonLance ? "launch"
			: faits.exitCode !== undefined ? "install"
			: etape;
		const appRunning = step === "install" ? await isAppRunning() : false;
		const detail: InstallerErrorDetail = {
			...faits,
			step,
			...(telechargementVerifie ? { downloadVerified: true } : {}),
			...(appRunning ? { appRunning: true } : {}),
		};
		/* A verified package is kept for "Try again"; anything else (partial,
		   wrong digest) is removed. */
		garderPaquet = telechargementVerifie;
		await journaliser(`installation failed (${code}) ${JSON.stringify(detail)}: ${erreur instanceof Error ? erreur.stack ?? erreur.message : String(erreur)}`);
		envoyer(socket, { type: "erreur", code, detail });
		await terminerTube(socket);
		return 1;
	} finally {
		if (!garderPaquet) await rm(cheminPaquet, { force: true });
	}
}
