/* The Android bridge shim: implements the `Pont` type (apps/windows/electron/
   pont.ts) on top of the WebView message channel that `addWebMessageListener`
   injects as `window.neoAndroid`. Every leaf method forwards its name and
   arguments to Kotlin; a missing method is a compile error, so the two sides
   cannot drift silently.

   Wire format (also documented in AppWebView.kt):
     JS -> Kotlin   {"id":number,"canal":string,"args":any[]}
     Kotlin reply   {"id":number,"ok":true,"valeur":any}
                    {"id":number,"ok":false,"erreur":string}
     Kotlin event   {"evenement":string,"donnees":any}

   The wire keys keep the names of the Windows bridge on purpose. */

import type { Pont, EvenementDisque, EtatFenetre, EtatSync } from "../../windows/electron/pont";
import type { EtatMiseAJour } from "../../windows/electron/mise-a-jour-etat";

interface NeoAndroidPort {
	postMessage(message: string): void;
	onmessage: ((event: { data: string }) => void) | null;
}

declare global {
	interface Window {
		/** Injected by `addWebMessageListener` (AppWebView.kt). */
		neoAndroid: NeoAndroidPort;
		/** `surRetour`: the renderer's answer to the Back key (true = it went back). Android only, not part of `Pont`. */
		neoPlatform: {
			mobile: boolean;
			/** Where the renderer builds the URLs of quiz images (`electron/ressources.ts`); Kotlin serves it (`ResourceRoute.kt`). */
			resourceBase: string;
			surRetour(gestionnaire: () => boolean): void;
			/** Publishes the bottom tab bar's state; Kotlin draws it outside the WebView (`NavBarView.kt`). */
			barre(etat: unknown): void;
			/** A tap on a tab of that native bar: its index. */
			surBarreClic(rappel: (index: number) => void): void;
		};
	}
}

interface Pending {
	resolve: (valeur: unknown) => void;
	reject: (erreur: Error) => void;
}

const pending = new Map<number, Pending>();
const listeners = new Map<string, Set<(donnees: any) => void>>();
let nextId = 1;

/** Calls a Kotlin channel. Rejects with the error string Kotlin replied with. */
function appeler<T = unknown>(canal: string, args: unknown[] = []): Promise<T> {
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		try {
			window.neoAndroid.postMessage(JSON.stringify({ id, canal, args }));
		} catch (e) {
			pending.delete(id);
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

/** Bytes cross the bridge as base64 (JSON.stringify of a Uint8Array is an object of indexes). */
function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Registers a callback for a pushed event; returns the unsubscribe. */
function abonner<D>(evenement: string, rappel: (donnees: D) => void): () => void {
	let set = listeners.get(evenement);
	if (!set) {
		set = new Set();
		listeners.set(evenement, set);
	}
	set.add(rappel);
	return () => {
		set!.delete(rappel);
	};
}

function onMessage(event: { data: string }): void {
	let msg: any;
	try {
		msg = JSON.parse(event.data);
	} catch {
		console.warn("[neo-android] unreadable message from Kotlin");
		return;
	}
	if (typeof msg.evenement === "string") {
		for (const cb of listeners.get(msg.evenement) ?? []) cb(msg.donnees);
		return;
	}
	const p = pending.get(msg.id);
	if (!p) return;
	pending.delete(msg.id);
	if (msg.ok) p.resolve(msg.valeur);
	else p.reject(new Error(String(msg.erreur ?? "unknown")));
}

const pont: Pont = {
	demarrer: (racines) => appeler("demarrer", [racines]),

	fichiers: {
		read: (abs) => appeler("fichiers.read", [abs]),
		readCached: (abs) => appeler("fichiers.readCached", [abs]),
		readBinary: async (abs) => fromBase64(await appeler<string>("fichiers.readBinary", [abs])),
		write: (abs, contenu) => appeler("fichiers.write", [abs, contenu]),
		writeBinary: (abs, data) => appeler("fichiers.writeBinary", [abs, toBase64(data)]),
		append: (abs, contenu) => appeler("fichiers.append", [abs, contenu]),
		lirePourEcriture: (abs) => appeler("fichiers.lirePourEcriture", [abs]),
		ecrireSiInchange: (abs, contenuLu, contenu) => appeler("fichiers.ecrireSiInchange", [abs, contenuLu, contenu]),
		exists: (abs) => appeler("fichiers.exists", [abs]),
		mkdirs: (abs) => appeler("fichiers.mkdirs", [abs]),
		trash: (abs, racine) => appeler("fichiers.trash", [abs, racine]),
		list: (dossier) => appeler("fichiers.list", [dossier]),
		remove: (abs) => appeler("fichiers.remove", [abs]),
		rename: (de, vers) => appeler("fichiers.rename", [de, vers]),
		stat: (abs) => appeler("fichiers.stat", [abs]),
		statEntree: (abs) => appeler("fichiers.statEntree", [abs]),
		listerDossier: (dossier) => appeler("fichiers.listerDossier", [dossier]),
		liste: (racine) => appeler("fichiers.liste", [racine]),
	},

	async surveiller(onEvenement) {
		const off = abonner<EvenementDisque>("evenement", onEvenement);
		try {
			await appeler("surveiller");
		} catch (e) {
			off();
			throw e;
		}
		return off;
	},

	dialogue: {
		choisirDossier: () => appeler("dialogue.choisirDossier"),
	},

	reglages: {
		lire: (cle) => appeler("reglages.lire", [cle]),
		ecrire: (cle, valeur) => appeler("reglages.ecrire", [cle, valeur]),
		supprimer: (cle) => appeler("reglages.supprimer", [cle]),
	},

	partage: {
		enregistrer: (nom, octets) => appeler("partage.enregistrer", [nom, toBase64(octets)]),
	},

	systeme: {
		ouvrir: (abs) => appeler("systeme.ouvrir", [abs]),
		copierTexte: (texte) => appeler("systeme.copierTexte", [texte]),
		vaultsObsidian: () => appeler("systeme.vaultsObsidian"),
		dossierDefaut: () => appeler("systeme.dossierDefaut"),
		choisirDossierDefaut: () => appeler("systeme.choisirDossierDefaut"),
		choisirFichiers: (kind) => appeler("systeme.choisirFichiers", [kind]),
		relancer: () => appeler("systeme.relancer"),
	},

	reseau: {
		fetch: (req, requeteId) => appeler("reseau.fetch", [req, requeteId]),
		annuler: (requeteId) => appeler("reseau.annuler", [requeteId]),
	},

	processus: {
		run: (spec, requeteId, flux) => appeler("processus.run", [spec, requeteId, flux]),
		annuler: (requeteId) => appeler("processus.annuler", [requeteId]),
		lireCache: (tool) => appeler("processus.lireCache", [tool]),
		ollamaInstalle: () => appeler("processus.ollamaInstalle"),
		demarrerOllama: () => appeler("processus.demarrerOllama"),
		openTerminal: () => appeler("processus.openTerminal"),
		connecter: (tool, ancre) => appeler("processus.connecter", [tool, ancre]),
		attendreFinTerminal: () => appeler("processus.attendreFinTerminal"),
		surTerminalPose: (rappel) => abonner<void>("processus.terminalPose", () => rappel()),
		surCachesCli: (rappel) => abonner("processus.cachesCli", rappel),
		surFlux: (rappel) => abonner<{ requeteId: number; texte: string }>("processus.flux", (d) => rappel(d.requeteId, d.texte)),
		surNavigateurOuvert: (rappel) => abonner<void>("processus.navigateurOuvert", () => rappel()),
		replacerTerminal: (ancre) => appeler("processus.replacerTerminal", [ancre]),
		comptesEtat: (outils) => appeler("processus.comptesEtat", [outils]),
		comptesUsage: (tool) => appeler("processus.comptesUsage", [tool]),
		comptesDeconnecter: (tool) => appeler("processus.comptesDeconnecter", [tool]),
		comptesUsageTerminal: (tool) => appeler("processus.comptesUsageTerminal", [tool]),
	},

	fenetre: {
		prete: () => appeler("fenetre.prete"),
		surFermeture: (rappel) => {
			// The callback stays in the page; Kotlin only learns it is armed.
			abonner<void>("fenetre.fermeture", () => {
				void rappel().then(() => appeler("fenetre.fermetureTerminee"));
			});
			return appeler("fenetre.surFermeture");
		},
		reduire: () => appeler("fenetre.reduire"),
		premierPlan: () => appeler("fenetre.premierPlan"),
		agrandirOuRestaurer: () => appeler("fenetre.agrandirOuRestaurer"),
		fermer: () => appeler("fenetre.fermer"),
		pleinEcran: () => appeler("fenetre.pleinEcran"),
		etat: () => appeler<EtatFenetre>("fenetre.etat"),
		surEtat: (rappel) => abonner<EtatFenetre>("fenetre.etat", rappel),
	},

	affichage: {
		zoom: (facteur) => appeler("affichage.zoom", [facteur]),
		recharger: () => appeler("affichage.recharger"),
		outilsDev: () => appeler("affichage.outilsDev"),
	},

	miseAJour: {
		etat: () => appeler<EtatMiseAJour>("miseAJour.etat"),
		surEtat: (rappel) => abonner<EtatMiseAJour>("miseAJour.etat", rappel),
		verifier: () => appeler("miseAJour.verifier"),
		installer: () => appeler("miseAJour.installer"),
	},

	collage: {
		attendre: (jeton) => appeler("collage.attendre", [jeton]),
		arreter: () => appeler("collage.arreter"),
		surTexte: (rappel) => abonner("collage.texte", rappel),
	},

	depot: {
		disposer: (options) => appeler("depot.disposer", [options]),
		ecrire: (nom, octets) => appeler("depot.ecrire", [nom, octets]),
		preparer: (absolus) => appeler("depot.preparer", [absolus]),
		glisser: (absolus, saisi, image) => appeler("depot.glisser", [absolus, saisi, image]),
		terminer: () => appeler("depot.terminer"),
	},

	video: {
		etat: () => appeler("video.etat"),
		infosInstallation: () => appeler("video.infosInstallation"),
		async installer(surProgression) {
			const off = abonner<{ recus: number; total: number | null }>("video.progression", (d) => surProgression(d.recus, d.total));
			try {
				return await appeler("video.installer");
			} finally {
				off();
			}
		},
		transcrire: (id) => appeler("video.transcrire", [id]),
		annuler: (id) => appeler("video.annuler", [id]),
	},

	sync: {
		etat: () => appeler("sync.etat"),
		appairer: (deviceId, nom) => appeler("sync.appairer", nom ? [deviceId, String(nom)] : [deviceId]),
		oublier: (deviceId) => appeler("sync.oublier", [deviceId]),
		renommer: (deviceId, nom) => appeler("sync.renommer", [deviceId, String(nom)]),
		ignorer: (deviceId) => appeler("sync.ignorer", [deviceId]),
		partagerId: (canal) => appeler("sync.partagerId", [canal]),
		surEtat: (rappel) => abonner<EtatSync>("sync.etat", rappel),
		surDonneesRecues: (rappel) => abonner<void>("sync.donneesRecues", () => rappel()),
		scanner: () => appeler("sync.scanner"),
		scannerAppairer: () => appeler("sync.scannerAppairer"),
	},

	android: {
		calendrier: (table, textes) => appeler("android.calendrier", [table, textes]),
		revisionDemandee: () => appeler<boolean>("android.revisionDemandee"),
	},

	code: {
		run: (job) => appeler("code.run", [job]),
		warm: (language) => appeler("code.warm", [language]),
	},

	langages: {
		etat: (nom) => appeler("langages.etat", [nom]),
		async installer(nom, surProgression) {
			const off = abonner<{ recus: number; total: number }>("langages.progression", (d) => surProgression(d.recus, d.total));
			try {
				return await appeler("langages.installer", [nom]);
			} finally {
				off();
			}
		},
		supprimer: (nom) => appeler("langages.supprimer", [nom]),
	},
};

window.neoAndroid.onmessage = onMessage;
(window as unknown as { neo: Pont }).neo = pont;

/* The Back key: Kotlin pushes `android.retour` and waits for the verdict on
   `android.retourTraite`; `false` (or no answer in time) leaves the app. */
let gestionnaireRetour: (() => boolean) | null = null;
abonner<void>("android.retour", () => {
	let traite = false;
	try {
		traite = gestionnaireRetour?.() ?? false;
	} catch (e) {
		console.warn("[neo-android] back handler failed", e);
	}
	void appeler("android.retourTraite", [traite]).catch(() => {});
});
window.neoPlatform = { mobile: true, resourceBase: `${location.origin}/neo-res/`, surRetour: (gestionnaire) => { gestionnaireRetour = gestionnaire; },
	barre: (etat) => { void appeler("android.barre", [etat]).catch(() => {}); },
	surBarreClic: (rappel) => { abonner<number>("android.barreClic", rappel); },
};
