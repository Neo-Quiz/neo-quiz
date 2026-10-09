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
import { createWriteStream } from "node:fs";
import { access, appendFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { get } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
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
import type {
	ChargeTravailleur,
	CodeErreurInstallateur,
	CommandeTravailleur,
	MessageTravailleur,
} from "./protocole";

const USER_AGENT = "Neo-Quiz-Installer";
const MAX_REDIRECTIONS = 5;

class ErreurTravailleur extends Error {
	/** `detail` names the real cause (errno, HTTP status) for the log only. */
	constructor(readonly code: CodeErreurInstallateur, readonly detail?: string, readonly nonLance = false) {
		super(detail ? `${code}: ${detail}` : code);
	}
}

/** Best-effort log next to the temp files: the worker has no console, and a
    bare "installation could not continue" says nothing about the cause. */
async function journaliser(message: string): Promise<void> {
	try {
		await appendFile(join(tmpdir(), "neo-quiz-installer.log"), `${new Date().toISOString()} ${message}
`);
	} catch {
		// Logging must never fail the installation.
	}
}

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
		throw new ErreurTravailleur("network", "download host or redirect limit");
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
					reject(new ErreurTravailleur("network"));
					return;
				}
				void ouvrirReponse(suivante, signal, redirections + 1).then(resolvePromise, reject);
				return;
			}
			if (code !== 200) {
				reponse.resume();
				reject(new ErreurTravailleur("network", `HTTP ${code} for ${url.pathname}`));
				return;
			}
			resolvePromise(reponse);
		});
		requete.once("error", erreur => {
			if (signal.aborted) reject(erreur);
			else reject(new ErreurTravailleur("network", (erreur as NodeJS.ErrnoException).code ?? erreur.message));
		});
	});
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
		/* A reset or truncated body mid-download is a network failure, not a
		   generic one; a refused write (antivirus, disk) is an installation one. */
		const errno = (erreur as NodeJS.ErrnoException).code ?? String(erreur);
		const ecriture = /^(EPERM|EACCES|EBUSY|ENOSPC|EROFS|EMFILE)$/.test(errno);
		throw new ErreurTravailleur(ecriture ? "installation" : "network", `${errno} while downloading`);
	}
	if (recus !== paquet.taille) {
		throw new ErreurTravailleur("integrity", `size ${recus}, expected ${paquet.taille}`);
	}
	if (hash.digest("base64") !== paquet.sha512) {
		throw new ErreurTravailleur("integrity", "sha512 differs from latest.yml");
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
			/* nonLance: the installer never started (file locked by Defender). */
			reject(new ErreurTravailleur("installation", (erreur as NodeJS.ErrnoException).code ?? erreur.message, true));
		});
		enfant.once("exit", code => {
			terminer();
			if (code === 0) {
				surProgression(100);
				resolvePromise();
			} else {
				reject(new ErreurTravailleur("installation", `NSIS exit code ${code}`));
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

/** Point d'entrée appelé par `main.ts` quand le portable a été relancé avec
    le drapeau privé du travailleur. Retourne un code de processus, sans jamais
    afficher de chaîne brute à l'utilisateur. */
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

	const annulation = new AbortController();
	let dossierExistait = true;
	try { await access(charge.dossier); } catch { dossierExistait = false; }
	let installationExistante = true;
	try { await access(join(charge.dossier, "neo-quiz.exe")); } catch { installationExistante = false; }
	ecouterCommandes(socket, commande => {
		if (commande.type === "annuler") annulation.abort();
	});

	const temporaire = await mkdtemp(join(tmpdir(), "neo-quiz-installer-"));
	const cheminPaquet = join(temporaire, charge.paquet.nom);
	try {
		const paquet = await telechargerAvecReessais(charge.paquet, {
			telecharger: p => telecharger(p, cheminPaquet, annulation.signal, recus => {
				envoyer(socket, { type: "telechargement", recus, total: p.taille });
			}),
			relirePaquet: async () => {
				try {
					const reponse = await fetch(urlLatestYml(charge.paquet.version), { headers: { "User-Agent": USER_AGENT } });
					return reponse.ok ? resoudrePaquet(await reponse.text()) : null;
				} catch {
					return null;
				}
			},
			attendre: ms => annulation.signal.aborted ? Promise.resolve() : attendre(ms),
			journal: message => { void journaliser(message); },
		});
		if (annulation.signal.aborted) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}

		envoyer(socket, { type: "verification" });
		if (annulation.signal.aborted) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}
		/* Mesurée AVANT le lancement : elle dit si NSIS aura d'abord une
		   ancienne version à retirer — une étape aveugle de plus, que le barème
		   prend en compte — et elle sert de creux de départ à la mise en place. */
		const initial = await tailleDossier(charge.dossier);
		/* Only a launch that never started is retried (Defender still holds the
		   fresh file: EBUSY/EACCES/EPERM). A NSIS run that started and failed
		   is never replayed: it may have changed the installation. */
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

		const executable = join(charge.dossier, "neo-quiz.exe");
		try {
			await access(executable);
		} catch {
			throw new ErreurTravailleur("installation");
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
		await journaliser(`installation failed (${code}): ${erreur instanceof Error ? erreur.stack ?? erreur.message : String(erreur)}`);
		envoyer(socket, { type: "erreur", code });
		await terminerTube(socket);
		return 1;
	} finally {
		await rm(temporaire, { recursive: true, force: true });
		/* `dirname` est volontairement touché ici par le typechecker via cet
		   import utilisé : il rappelle que `cheminPaquet` reste dans notre
		   dossier temporaire et n'est jamais supprimé par un chemin reçu. */
		void dirname(cheminPaquet);
	}
}
