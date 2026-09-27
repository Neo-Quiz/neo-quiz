/* ══════════════════════════════════════════════════════════
   LA SECTION « COMPTES » DES RÉGLAGES

   Quatre lignes, `claude`, `codex`, `agy`, `ollama`, dans cet ordre fixe.
   L'état vient de DEUX sources assemblées : `host.process.etatComptes()` pour
   les trois premières (un seul appel, groupé côté principal), et
   `checkOllamaCompte()` (`src/dashboard/ai-providers.ts`) pour la quatrième —
   Ollama n'a pas de fichier de jetons que le principal pourrait lire comme les
   trois autres, seul son serveur local sait répondre. `ollamaInstalle()` du
   même contrat dit si le binaire existe, séparément de la connexion : sans
   lui la ligne Ollama ne pourrait jamais proposer « Installer ».

   MÊME PATRON QUE `fond.ts` (`monterReglagesFond`) : une fonction qui monte
   la section, dessine un premier état (ici : un squelette), puis redessine
   après chaque lecture ou action. Aucun abonnement au pont : rien ne pousse
   de changement depuis le principal, une action redessine elle-même après
   avoir agi.
══════════════════════════════════════════════════════════ */

import type { CliTool, EtatCompte } from "../../../../src/host/types";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t, currentLang } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { openConfirmModal } from "../../../../src/editor/modals";
import { checkOllamaCompte, setBrandLogo, sondeConnexion } from "../../../../src/dashboard/ai-providers";
import { demarrerConnexionCli, poserCroixAnnuler, renderCarteAttenteConnexion } from "../../../../src/dashboard/connexion-cli";
import type { OutilConnectable } from "../../../../src/dashboard/connexion-cli";
import { pont } from "../host/pont";
import { CLE_REGLAGES_IA } from "../../electron/pont";
import { LOG_PREFIX } from "../../../../src/branding";
import type { UsageRead, UsageReadError, UsageRow } from "../../../../src/dashboard/usage-format";
import { usageRowLabel, formatResetMoment, formatAge, formatDuration } from "../../../../src/dashboard/usage-format";

/** L'ordre d'affichage, fixé par le cahier des charges — jamais celui que
    rendrait `etatComptes()` (qui ne connaît pas Ollama). */
const ORDRE: CliTool[] = ["claude", "codex", "agy", "ollama"];

/** L'intervalle de la sonde « le compte est-il connecté ? », même valeur que
    la page « Générer » (`ai.ts`) : c'est la même attente, avec la même
    modale (`connexion-cli.ts`). */
const SONDE_CONNEXION_POLL_MS = 3000;

/** Le logo de MARQUE par outil, posé par `setBrandLogo` (`ai-providers.ts`),
    même patron que le sélecteur de fournisseur de la page « Générer »
    (`ai.ts`, `buildProviderControl`) : `qbd-provider-logo qbd-provider-logo--<nom>`
    puis `setBrandLogo(el, nom)`. Ce ne sont pas des icônes Lucide — le
    catalogue Lucide n'a aucun logo de marque, et les poser à la main ici
    aurait divergé du sélecteur qui affiche déjà ces mêmes logos. */
const LOGOS: Record<CliTool, string> = {
	claude: "claude",
	codex: "openai",
	agy: "antigravity",
	ollama: "ollama",
};

/** L'adresse du serveur Ollama telle qu'enregistrée par la page « Générer »
    (mêmes réglages IA, clé `CLE_REGLAGES_IA`). `undefined` fait retomber
    `checkOllamaCompte` sur son défaut local. */
async function lireAiOllamaUrl(): Promise<string | undefined> {
	const brut = await pont().reglages.lire(CLE_REGLAGES_IA);
	const url = brut && typeof brut === "object" ? (brut as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	return typeof url === "string" ? url : undefined;
}

/** Le nom affiché, traduit — jamais le nom brut de `PROVIDERS`
    (`ai-providers.ts`), qui dit « Claude » quand cette ligne doit dire
    « Claude Code » : c'est le compte du CLI, pas celui du fournisseur. */
function nomOutil(outil: CliTool): string {
	switch (outil) {
		case "claude": return t("app.comptes.claude");
		case "codex": return t("app.comptes.codex");
		case "agy": return t("app.comptes.agy");
		case "ollama": return t("app.comptes.ollama");
	}
}

/** L'état de la ligne Ollama, assemblé depuis deux appels que `EtatCompte`
    ne distingue pas ailleurs : `ollamaInstalle()` (le binaire existe-t-il ?)
    et `checkOllamaCompte()` (le serveur répond-il, connecté ?). Rend aussi
    `signinUrl` (quand le démon répond 401 avec une adresse de connexion) :
    c'est elle que le bouton « Se connecter » ouvrira, Ollama n'ayant pas de
    CLI de connexion (voir `surClicAction`). */
async function etatOllama(): Promise<{ etat: EtatCompte; signinUrl: string | null }> {
	const proc = requireHost("process");
	const [installe, compte] = await Promise.all([
		proc.ollamaInstalle(),
		lireAiOllamaUrl().then(checkOllamaCompte),
	]);
	return {
		etat: {
			outil: "ollama",
			installe,
			connecte: compte.connecte,
			// L'adresse vient de `POST /api/me` (`email`), le forfait de `plan` :
			// le serveur local est la seule source, comme pour les trois autres.
			email: compte.connecte ? compte.email : null,
			plan: compte.connecte ? compte.plan : null,
		},
		signinUrl: compte.connecte ? null : compte.signinUrl,
	};
}

/** Les quatre lignes, dans l'ORDRE fixe — les deux sources partent en
    parallèle, et on attend les DEUX avant de dessiner : celle qui répond la
    première (Ollama, sous la seconde) ne doit pas faire sauter la liste
    pendant que la plus lente (`etatComptes()`, ~1 s à cause d'Antigravity)
    arrive encore. */
async function lireEtats(): Promise<{ etats: EtatCompte[]; ollamaSigninUrl: string | null }> {
	const [trois, ollama] = await Promise.all([
		requireHost("process").etatComptes(),
		etatOllama(),
	]);
	const parOutil = new Map(trois.map(e => [e.outil, e] as const));
	const etats = ORDRE.map(outil => {
		if (outil === "ollama") return ollama.etat;
		return parOutil.get(outil) ?? { outil, installe: false, connecte: false, email: null, plan: null };
	});
	return { etats, ollamaSigninUrl: ollama.signinUrl };
}

/* ── LE CACHE MODULE DES DERNIERS ÉTATS LUS ──
   EN MÉMOIRE, jamais sur disque : un état figé sur disque afficherait au
   DÉMARRAGE SUIVANT un compte déconnecté depuis comme connecté, sans rien
   pour le corriger avant la fin de la lecture — en session, au contraire, le
   `redessiner()` de fond remplace le dessin du cache en quelques secondes,
   et une lecture en échec ne l'efface pas (les quatre lignes d'avant valent
   mieux qu'un message d'erreur). Rien de sensible dedans : `EtatCompte` ne
   porte qu'une adresse, un forfait et des booléens — aucun jeton ne sort
   jamais du principal (éprouvé par `check:electron-comptes`).

   POURQUOI IL EXISTE (Ahmed, 2026-09-21 : « parfois je vois que c'est vide »)
   : une lecture coûte environ une seconde (`agy models` est un aller-retour
   réseau), et rouvrir les réglages dans la même session repartait chaque
   fois du squelette — un écran vide une seconde de trop, à chaque ouverture.
   Au montage avec un cache : dessiner DESSUS tout de suite, sans squelette,
   puis laisser `redessiner()` remplacer en fond. Premier montage de la
   session (cache null) : squelette, comme avant. */
let cacheEtats: { etats: EtatCompte[]; ollamaSigninUrl: string | null } | null = null;

/** Remplit `cacheEtats`, sans jamais jeter — MÊME RÔLE que `refreshCliCaches`
    (`ai-providers.ts`) pour les modèles : un instantané de module qu'un
    lecteur affiche tout de suite, rafraîchi par un appel explicite plutôt que
    relu à chaque montage. Partagée par `redessiner()` (au montage de la
    section) et `amorcerCacheComptes()` (au lancement de l'application, avant
    qu'aucun réglage ne soit ouvert) : UN SEUL endroit qui écrit le cache. */
let lectureEnCours: Promise<{ etats: EtatCompte[]; ollamaSigninUrl: string | null } | null> | null = null;

/* UNE LECTURE À LA FOIS, PARTAGÉE (même patron que `usageEnCours`) : les
   réglages ouverts pendant l'amorçage du lancement (~1 s) attendent la
   lecture déjà partie au lieu d'en lancer une seconde — sinon huit sondes au
   lieu de quatre, et la plus ancienne pouvait écraser la plus récente dans
   `cacheEtats`.
   SAUF APRÈS UNE ACTION (`fraiche`) : une déconnexion qui vient de réussir
   ne doit pas recevoir une lecture partie AVANT elle, qui dirait encore
   « connecté ». Elle attend la lecture en cours, puis en lance une neuve. */
function rafraichirCache(fraiche = false): Promise<{ etats: EtatCompte[]; ollamaSigninUrl: string | null } | null> {
	if (lectureEnCours) {
		if (!fraiche) return lectureEnCours;
		return lectureEnCours.then(() => rafraichirCache(true));
	}
	lectureEnCours = (async () => {
		try {
			const resultat = await lireEtats();
			cacheEtats = resultat;
			return resultat;
		} catch (e) {
			console.warn(LOG_PREFIX, "lecture des comptes IA impossible:", e);
			return null;
		} finally {
			lectureEnCours = null;
		}
	})();
	return lectureEnCours;
}

/** Amorce le cache EN ARRIÈRE-PLAN, peu après le lancement de l'application —
    avant que l'utilisateur n'ait ouvert les réglages une seule fois. Sans
    cet appel, la première ouverture de la session repartait toujours du
    squelette pendant que les trois sondes tournaient (jusqu'à ~1 s, la
    plus lente étant `agy models`, un aller-retour réseau) : Ahmed,
    2026-09-27, « je vois que la section n'est pas chargée ». Appelée par
    `apps/windows/src/main.ts`, SANS attendre : un CLI absent ou une sonde
    lente ne doit jamais retarder l'affichage de la fenêtre. */
export function amorcerCacheComptes(): void {
	void rafraichirCache();
}

/** L'action que le bouton d'une ligne déclenche : c'est `installe` qui
    tranche la première branche, jamais `connecte` seul — un outil absent de
    la machine et un outil présent mais déconnecté ne peuvent pas partager le
    même bouton. */
function actionDe(etat: EtatCompte): "installer" | "connecter" | "deconnecter" {
	if (!etat.installe) return "installer";
	return etat.connecte ? "deconnecter" : "connecter";
}

/* ── Le popover d'usage (survol / focus d'une ligne Claude ou Codex) ──
   `usageCompte` n'accepte que ces deux outils — le compilateur refuse déjà
   Antigravity et Ollama à l'appel, ce module n'a pas besoin de le revérifier
   lui-même au-delà de ce type. */
type OutilAvecUsage = "claude" | "codex";

/** La page d'usage d'Ollama (session + semaine), ouverte au clic sur l'icône. */
const OLLAMA_USAGE_URL = "https://ollama.com/settings";

const DELAI_OUVERTURE_MS = 250;
const DELAI_FERMETURE_MS = 150;
/** Le résultat d'une lecture est gardé 60 s par outil : Claude coûte un
    aller-retour réseau, Codex une lecture de fichier — aucun des deux
    n'a besoin d'être relu à chaque survol de la même minute. */
const USAGE_CACHE_MS = 60_000;
const USAGE_SEUIL_AVERTISSEMENT = 80;
const USAGE_SEUIL_CRITIQUE = 95;

interface EntreeUsage { at: number; resultat: UsageRead; }

const usageCache = new Map<OutilAvecUsage, EntreeUsage>();
const usageEnCours = new Map<OutilAvecUsage, Promise<EntreeUsage>>();

/** Lecture de l'usage, gardée en cache. NE REJETTE JAMAIS : une exception du
    pont (Claude) ou de la lecture disque (Codex) devient une erreur
    `unavailable`, exactement comme le reste de ce module transforme les
    rejets du pont en un état affichable plutôt qu'en rejection non gérée. */
async function lireUsageAvecAge(outil: OutilAvecUsage): Promise<EntreeUsage> {
	const cache = usageCache.get(outil);
	if (cache && Date.now() - cache.at < USAGE_CACHE_MS) return cache;
	const enCours = usageEnCours.get(outil);
	if (enCours) return enCours;
	const promesse = requireHost("process").usageCompte(outil)
		.catch((e): UsageRead => {
			console.warn(LOG_PREFIX, "lecture d'usage impossible:", e);
			return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
		})
		.then((resultat): EntreeUsage => {
			const entree = { at: Date.now(), resultat };
			usageCache.set(outil, entree);
			usageEnCours.delete(outil);
			return entree;
		});
	usageEnCours.set(outil, promesse);
	return promesse;
}

function classeSeuil(pct: number): string {
	if (pct >= USAGE_SEUIL_CRITIQUE) return " is-critical";
	if (pct >= USAGE_SEUIL_AVERTISSEMENT) return " is-warning";
	return "";
}

/** Une jauge : réutilise `.qbd-ai-usage-gauge-bar`/`-fill` (dashboard-ai.css,
    posées mais jusqu'ici jamais consommées) plutôt que d'en redéfinir une —
    même barre que celle que l'écran d'usage du greffon aurait affichée. */
function poserLigneUsage(pop: HTMLElement, row: UsageRow): void {
	const ligneUsage = ajouter(pop, "div", "nq-usage-row");
	const info = ajouter(ligneUsage, "div", "nq-usage-row-info");
	ajouter(info, "div", "nq-usage-row-label", usageRowLabel(row));
	const reset = formatResetMoment(row.resetsAt, currentLang());
	if (reset) ajouter(info, "div", "nq-usage-row-reset", t("app.comptes.usage.resetsAt", { moment: reset }));
	ajouter(ligneUsage, "span", "nq-usage-row-pct", t("ai.usage.usedPercent", { n: Math.round(row.usedPercent) }));
	const barre = ajouter(ligneUsage, "div", "qbd-ai-usage-gauge-bar");
	const remplissage = ajouter(barre, "div", "qbd-ai-usage-gauge-fill" + classeSeuil(row.usedPercent));
	remplissage.style.width = Math.max(0, Math.min(100, row.usedPercent)) + "%";
}

/** Les QUATRE cas d'échec (`UsageReadError.kind`), chacun sa phrase — un
    popover qui resterait vide sur un échec serait indiscernable d'un bug. */
function poserErreurUsage(pop: HTMLElement, erreur: UsageReadError): void {
	const message = erreur.kind === "rate-limited"
		? (erreur.retryAfterSec != null
			? t("app.comptes.usage.errorRateLimitedDelay", { delai: formatDuration(erreur.retryAfterSec * 1000) })
			: t("app.comptes.usage.errorRateLimited"))
		: erreur.kind === "unauthenticated" ? t("app.comptes.usage.errorUnauthenticated")
			: erreur.kind === "jamais-lance" ? t("app.comptes.usage.errorNeverRun")
				: t("app.comptes.usage.errorUnavailable");
	ajouter(pop, "p", "nq-usage-error", message);
}

/** Affiché DÈS l'ouverture, avant que `usageCompte` ait répondu — sans ça, le
    popover apparaît vide puis se remplit d'un coup, ce qui saute à l'œil. */
function poserUsagePopoverChargement(pop: HTMLElement, outil: OutilAvecUsage): void {
	ajouter(pop, "div", "nq-usage-titre", nomOutil(outil));
	for (let i = 0; i < 2; i++) {
		const ligneUsage = ajouter(pop, "div", "nq-usage-row");
		const info = ajouter(ligneUsage, "div", "nq-usage-row-info");
		ajouter(info, "div", "nq-usage-row-label", t("app.comptes.loading"));
		const barre = ajouter(ligneUsage, "div", "qbd-ai-usage-gauge-bar");
		ajouter(barre, "div", "qbd-ai-usage-gauge-fill nq-usage-fill--attente");
	}
}

function poserUsagePopoverContenu(pop: HTMLElement, outil: OutilAvecUsage, entree: EntreeUsage): void {
	ajouter(pop, "div", "nq-usage-titre", nomOutil(outil));
	if (entree.resultat.error) {
		poserErreurUsage(pop, entree.resultat.error);
		return;
	}
	if (!entree.resultat.rows.length) {
		// Une lecture réussie sans AUCUNE ligne n'a pas de sens pour ces deux
		// outils (ils publient toujours au moins une jauge) ; un message
		// reste plus honnête qu'un cadre nu — même principe que les quatre
		// erreurs ci-dessus.
		ajouter(pop, "p", "nq-usage-error", t("app.comptes.usage.errorUnavailable"));
		return;
	}
	for (const row of entree.resultat.rows) poserLigneUsage(pop, row);
	if (outil === "codex") {
		// Codex n'a pas d'état courant : la lecture vient du dernier fichier
		// de session écrit sur disque, une photo prise au dernier LANCEMENT du
		// CLI (`mesureAt`, le mtime de ce fichier côté principal) — jamais
		// l'instant où NOUS venons de le lire (`entree.at`), qui daterait
		// faussement des chiffres potentiellement vieux de plusieurs jours.
		// `mesureAt` absent (mtime illisible) : on dit d'où viennent les
		// chiffres SANS prétendre quand — une date fausse serait pire qu'une
		// date absente, elle aurait l'air vraie.
		ajouter(pop, "p", "nq-usage-note", entree.resultat.mesureAt != null
			? t("app.comptes.usage.codexSnapshot", { age: formatAge(entree.resultat.mesureAt, Date.now()) })
			: t("app.comptes.usage.codexSnapshotSansDate"));
	}
}

export function monterReglagesComptes(section: HTMLElement): () => void {
	let detruit = false;
	/** L'adresse de connexion Ollama, retenue depuis le dernier redessin —
	    même rôle que `ollamaSigninUrl` dans `ai.ts` (`demarrerConnexion`) :
	    une carte affichée sans sonde préalable n'aurait pas cette adresse, et
	    le bouton la resonde une fois avant de renoncer (voir `surClicAction`). */
	let ollamaSigninUrl: string | null = null;

	const liste = ajouter(section, "div", "nq-comptes-liste");

	/** Les popovers d'usage OUVERTS — au plus un par ligne, mais une action
	    peut redessiner la liste pendant qu'un survol est en cours. Fermés
	    avant tout redessin et au démontage : un popover portalé au `<body>`
	    survit à sa ligne si personne ne le retire explicitement. */
	const popoversUsage = new Set<() => void>();
	function fermerPopoversUsage(): void {
		for (const fermer of Array.from(popoversUsage)) fermer();
	}

	/** Les minuteurs d'OUVERTURE en attente (survol démarré, popover pas
	    encore posé) — distincts de `popoversUsage`, qui ne connaît que ce
	    qu'`ouvrirMaintenant` a déjà inscrit. Sans ce second registre, fermer
	    les réglages pendant le délai d'ouverture (`DELAI_OUVERTURE_MS`) laisse
	    le minuteur se déclencher après coup et poser un popover portalé au
	    `<body>` qui ne se retire jamais (Ahmed, 2026-09-21). */
	const ouverturesEnAttente = new Set<() => void>();
	function annulerOuverturesEnAttente(): void {
		for (const annuler of Array.from(ouverturesEnAttente)) annuler();
	}

	/** Popover d'usage au survol ou au focus de l'ICÔNE d'usage d'une ligne
	    Claude ou Codex — jamais Antigravity ni Ollama : seul
	    `outil: OutilAvecUsage` (paramètre de cette fonction) rend l'appel
	    possible, le compilateur refuse déjà les deux autres à `usageCompte`.
	    L'ancre est l'icône, pas la ligne entière (retour d'écran 2026-09-21) :
	    un survol qui traverse la ligne pour atteindre le bouton d'action
	    déclenchait des lectures d'usage à chaque passage. */
	function attacherPopoverUsage(ancre: HTMLElement, outil: OutilAvecUsage): void {
		let popEl: HTMLElement | null = null;
		let minuteurOuverture: number | null = null;
		let minuteurFermeture: number | null = null;
		/* Incrémenté à chaque ouverture : une lecture qui répond après que ce
		   jeton a changé (fermé puis pas rouvert, ou rouvert une seconde fois)
		   ne doit jamais toucher un popover qui n'est plus le sien. */
		let jeton = 0;

		function annulerOuverture(): void {
			if (minuteurOuverture != null) { window.clearTimeout(minuteurOuverture); minuteurOuverture = null; }
			ouverturesEnAttente.delete(annulerOuverture);
		}
		function annulerFermeture(): void {
			if (minuteurFermeture != null) { window.clearTimeout(minuteurFermeture); minuteurFermeture = null; }
		}

		function fermer(): void {
			annulerOuverture();
			annulerFermeture();
			jeton++;
			if (popEl) { popEl.remove(); popEl = null; }
			popoversUsage.delete(fermer);
		}

		function positionner(): void {
			if (!popEl) return;
			const r = ancre.getBoundingClientRect();
			// Mesuré caché : sa taille dépend du contenu qu'on vient de poser
			// (squelette ou vraies jauges), inconnue avant qu'il soit dans le DOM.
			popEl.style.visibility = "hidden";
			const pr = popEl.getBoundingClientRect();
			// Bord DROIT du popover aligné sur celui de l'icône (retour d'écran
			// 2026-09-21 : calé sur r.left, il débordait de la modale des
			// réglages — le popover, portalé au body, n'est pas borné par elle).
			const left = Math.max(8, Math.min(r.right - pr.width, window.innerWidth - pr.width - 8));
			let top = r.bottom + 6;
			if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
			popEl.style.left = left + "px";
			popEl.style.top = top + "px";
			popEl.style.visibility = "";
		}

		function ouvrirMaintenant(): void {
			// La section a pu être démontée entre le survol et ce déclenchement
			// (délai d'ouverture, ou `focusin` juste avant fermeture) : poser un
			// popover portalé au `<body>` après coup le laisserait orphelin.
			if (detruit || popEl) return;
			annulerOuverture();
			annulerFermeture();
			const monJeton = ++jeton;
			popoversUsage.add(fermer);
			popEl = ajouter(document.body, "div", "nq-usage-popover");
			popEl.addEventListener("mouseenter", annulerFermeture);
			popEl.addEventListener("mouseleave", programmerFermeture);
			// AFFICHÉ AVANT la réponse, avec ses jauges en attente : un popover
			// qui apparaît vide puis se remplit sauterait à l'œil.
			poserUsagePopoverChargement(popEl, outil);
			positionner();
			// Pas de `.catch` : `lireUsageAvecAge` ne rejette jamais (elle
			// transforme toute exception en erreur affichable) — le `.then`
			// ci-dessous couvre sa seule issue possible.
			void lireUsageAvecAge(outil).then((entree) => {
				/* Trois façons pour cette réponse d'arriver « trop tard » : la
				   section a été démontée, ce popover a été fermé (et pas
				   rouvert), ou il a été rouvert une seconde fois depuis — dans
				   les trois cas `jeton` a changé, ne rien toucher. */
				if (detruit || monJeton !== jeton || !popEl) return;
				popEl.replaceChildren();
				poserUsagePopoverContenu(popEl, outil, entree);
				positionner();
			});
		}

		function programmerOuverture(): void {
			if (popEl || minuteurOuverture != null) return;
			annulerFermeture();
			ouverturesEnAttente.add(annulerOuverture);
			minuteurOuverture = window.setTimeout(() => { minuteurOuverture = null; ouverturesEnAttente.delete(annulerOuverture); ouvrirMaintenant(); }, DELAI_OUVERTURE_MS);
		}

		function programmerFermeture(): void {
			annulerOuverture();
			if (minuteurFermeture != null) return;
			minuteurFermeture = window.setTimeout(() => { minuteurFermeture = null; fermer(); }, DELAI_FERMETURE_MS);
		}

		ancre.addEventListener("mouseenter", programmerOuverture);
		ancre.addEventListener("mouseleave", programmerFermeture);
		// L'icône est un BOUTON focalisable : Tab jusqu'à elle ouvre le popover
		// sans délai — contrairement au survol, un geste clavier explicite n'a
		// pas besoin d'être filtré d'un passage rapide.
		ancre.addEventListener("focusin", ouvrirMaintenant);
		ancre.addEventListener("focusout", programmerFermeture);
	}

	/** Le logo et le nom, communs à la ligne SQUELETTE et à la ligne finale :
	    les deux seules choses connues sans attendre aucune lecture. Le logo de
	    marque est posé dans une pastille ronde de 32 px (référence d'écran
	    2026-09-21 : une pastille par ligne, pas un logo nu). */
	function poserEntete(ligne: HTMLElement, outil: CliTool): void {
		const pastille = ajouter(ligne, "span", "nq-comptes-logo");
		const icone = ajouter(pastille, "span", "qbd-provider-logo qbd-provider-logo--" + LOGOS[outil]);
		setBrandLogo(icone, LOGOS[outil]);
		const texte = ajouter(ligne, "div", "nq-comptes-texte");
		ajouter(texte, "span", "nq-comptes-nom", nomOutil(outil));
	}

	/** Le SQUELETTE : les quatre lignes, dans l'ordre fixe, avant toute
	    lecture — logo et nom connus tout de suite, un espace réservé à la
	    place de l'adresse et un bouton désactivé à la place de l'action. MÊME
	    STRUCTURE que `poserLigne` (mêmes classes, un bouton de même taille)
	    pour que la hauteur ne saute pas quand les vraies lignes la remplacent. */
	function poserSquelette(): void {
		fermerPopoversUsage();
		liste.replaceChildren();
		for (const outil of ORDRE) {
			const ligne = ajouter(liste, "div", "nq-comptes-ligne");
			ligne.dataset.outil = outil;
			poserEntete(ligne, outil);
			const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;
			ajouter(texte, "span", "nq-comptes-email", t("app.comptes.loading"));
			const droite = ajouter(ligne, "div", "nq-comptes-droite");
			const bouton = ajouter(droite, "button", "nq-comptes-action", t("app.comptes.loading"));
			bouton.type = "button";
			bouton.disabled = true;
		}
	}

	/** Une ligne, reconstruite en entier à chaque redessin — quatre lignes ne
	    justifient pas un diff fin, et ça garde ce module au niveau de
	    `fond.ts`, qui fait le même choix pour sa rangée unique. */
	function poserLigne(etat: EtatCompte): void {
		const ligne = ajouter(liste, "div", "nq-comptes-ligne");
		ligne.dataset.outil = etat.outil;
		poserEntete(ligne, etat.outil);
		const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;

		const etatTexte = !etat.installe
			? t("app.comptes.notInstalled")
			: !etat.connecte
				? t("app.comptes.notConnected")
				: (etat.email ?? t("app.comptes.connectedNoEmail"));
		ajouter(texte, "span", "nq-comptes-email", etatTexte);

		// La colonne droite : l'icône d'usage puis l'action, alignées sur
		// toutes les lignes.
		const droite = ajouter(ligne, "div", "nq-comptes-droite");

		// PAS DE BADGE DE FORFAIT (décision du 2026-09-21) : Antigravity n'en
		// publie aucun, nulle part — et un badge sur trois lignes sur quatre
		// aurait fait passer la quatrième pour cassée. Le forfait reste lu
		// (`etat.plan`, la page « Générer » s'en sert pour Ollama), pas montré.
		poserIconeUsage(droite, etat);

		const action = actionDe(etat);
		const bouton = ajouter(droite, "button", "nq-comptes-action");
		bouton.type = "button";
		// Une ligne de menu, pas un bouton à cadre (référence mesurée 2026-09-21)
		// : icône Lucide à gauche du libellé, `download` / `log-in` / `log-out`
		// selon l'action.
		currentHost().ui.setIcon(ajouter(bouton, "span", "nq-comptes-action-icone"),
			action === "installer" ? "download"
				: action === "connecter" ? "log-in" : "log-out");
		ajouter(bouton, "span", "nq-comptes-action-libelle", t(
			action === "installer" ? "app.comptes.install"
				: action === "connecter" ? "app.comptes.connect"
					: "app.comptes.disconnect",
		));
		bouton.addEventListener("click", () => {
			void surClicAction(etat.outil, action, bouton);
		});
	}

	/** L'icône d'usage, à gauche de l'action, sur une ligne CONNECTÉE seulement
	    (ailleurs elle n'ouvrirait qu'un cas d'échec) :
	    - Claude Code et Codex : le survol (ou le focus) ouvre le popover des
	      jauges, lues par le principal.
	    - Ollama : un clic ouvre `ollama.com/settings` dans le navigateur — la
	      seule page où Ollama montre l'usage de la session et de la semaine ;
	      `/api/me` ne le publie pas (ollama/ollama#12532).
	    - Antigravity : un clic ouvre un TERMINAL interactif où `agy` tourne,
	      prêt à recevoir `/usage` — son quota ne s'affiche nulle part ailleurs
	      (aucune page web, aucun mode headless ; vérifié le 2026-09-21). Un
	      trou à sa place ferait la seule ligne des quatre sans rien (décision
	      d'Ahmed du même jour : les quatre lignes portent chacune leur
	      accès à l'usage). */
	function poserIconeUsage(droite: HTMLElement, etat: EtatCompte): void {
		if (!etat.connecte) return;
		const icone = ajouter(droite, "button", "nq-comptes-usage");
		icone.type = "button";
		currentHost().ui.setIcon(icone, "gauge");
		if (etat.outil === "ollama") {
			icone.setAttribute("aria-label", t("app.comptes.usageOpen"));
			icone.title = t("app.comptes.usageOpen");
			icone.addEventListener("click", () => {
				void currentHost().shell.openUrl(OLLAMA_USAGE_URL).then((ouvert) => {
					if (!ouvert) currentHost().ui.notice(t("app.comptes.usageOpenFailed"));
				}).catch((e: unknown) => {
					console.warn(LOG_PREFIX, "ouverture de l'usage Ollama impossible:", e);
					currentHost().ui.notice(t("app.comptes.usageOpenFailed"));
				});
			});
			return;
		}
		if (etat.outil === "agy") {
			icone.setAttribute("aria-label", t("app.comptes.usageTerminal"));
			icone.title = t("app.comptes.usageTerminal");
			icone.addEventListener("click", () => {
				void requireHost("process").terminalUsageCli("agy").then((verdict) => {
					/* « indisponible » : hors Windows, ou le terminal n'a pas pu
					   être lancé — une Notice, jamais un bouton mort. */
					if (verdict !== "lance") { currentHost().ui.notice(t("app.comptes.usageTerminalFailed")); return; }
					/* LA CONSIGNE VIENT DE L'APPLICATION, PAS DU TERMINAL (mesuré
					   le 2026-09-21) : `agy` peint son interface sur l'ÉCRAN
					   ALTERNATIF du terminal, ce qui EFFACE la ligne que le
					   script y écrit avant de le lancer — elle ne reparaît qu'à
					   la sortie du CLI, quand elle ne sert plus. Une Notice, elle,
					   vit dans une fenêtre qu'`agy` ne peut pas repeindre. Elle
					   annonce aussi la configuration du PREMIER lancement : tant
					   qu'elle n'est pas faite, `agy` ouvre son assistant (choix du
					   thème, conditions d'utilisation) au lieu de son invite, et
					   `/usage` n'est pas encore atteignable. */
					currentHost().ui.notice(t("app.comptes.usageTerminalOpened"));
				}).catch((e: unknown) => {
					console.warn(LOG_PREFIX, "terminal d'usage Antigravity impossible:", e);
					currentHost().ui.notice(t("app.comptes.usageTerminalFailed"));
				});
			});
			return;
		}
		icone.setAttribute("aria-label", t("app.comptes.usageOf", { name: nomOutil(etat.outil) }));
		attacherPopoverUsage(icone, etat.outil);
	}

	/** Redessine la section entière. NE JETTE JAMAIS : son seul appelant est
	    `void redessiner()` (montage) ou une action sans `catch` — une
	    exception non rattrapée ici deviendrait une rejection non gérée, et la
	    section resterait vide EN PERMANENCE, sans un mot. `etatComptes()` est
	    un appel IPC ; un pont qui refuse REJETTE, ce n'est pas une hypothèse
	    d'école. */
	async function redessiner(apresAction = false): Promise<void> {
		// `rafraichirCache` écrit `cacheEtats` elle-même (partagée avec
		// `amorcerCacheComptes`) et ne jette jamais — `null` est son seul signal
		// d'échec, déjà journalisé par elle. Au montage, la lecture de
		// l'amorçage encore en vol est partagée ; après une action, jamais.
		const resultat = await rafraichirCache(apresAction);
		if (!resultat) {
			if (detruit) return;
			fermerPopoversUsage();
			/* Le message d'erreur ne remplace que le SQUELETTE (premier montage
			   sans cache) : des lignes déjà posées depuis le cache valent mieux
			   qu'un message d'erreur — on les garde telles quelles. */
			if (cacheEtats) return;
			liste.replaceChildren();
			ajouter(liste, "p", "nq-comptes-erreur", t("app.comptes.loadError"));
			return;
		}
		if (detruit) return;
		ollamaSigninUrl = resultat.ollamaSigninUrl;
		fermerPopoversUsage();
		liste.replaceChildren();
		for (const etat of resultat.etats) poserLigne(etat);
	}

	/** `bouton` est le même que `surClicAction` a désactivé avant d'ouvrir la
	    confirmation : cette fonction en est désormais RESPONSABLE jusqu'au
	    bout, sur les QUATRE issues possibles (succès, échec, exception,
	    annulé — l'annulation ne passe pas par ici, elle réactive déjà dans
	    son propre rappel). Un verrou posé et relâché sur une seule branche
	    est exactement le défaut déjà corrigé ailleurs dans ce chantier
	    (`process.ts`, l'arbre de process tué sur TOUTES les issues) : ici,
	    « échec » et « exception » redessinaient déjà la ligne PARFOIS via
	    `finally` dans `surClicAction`, mais `deconnecter` a son propre
	    chemin de retour anticipé qui, lui, ne touchait jamais `bouton`. */
	async function deconnecter(outil: CliTool, bouton: HTMLButtonElement): Promise<void> {
		let verdict: "ok" | "echec" | "indisponible";
		try {
			verdict = await requireHost("process").deconnecterCli(outil);
		} catch (e) {
			console.warn(LOG_PREFIX, "déconnexion impossible:", e);
			verdict = "echec";
		}
		if (detruit) return;
		if (verdict !== "ok") {
			currentHost().ui.notice(t("app.comptes.logoutFailed", { name: nomOutil(outil) }));
			// ÉCHEC OU EXCEPTION : la ligne ne se redessine pas (rien n'a changé
			// côté compte), donc RIEN d'autre ne réactivera ce bouton — sans ce
			// réveil explicite, il reste mort jusqu'à la fermeture des réglages.
			bouton.disabled = false;
			return;
		}
		// `"ok"` : la ligne est RE-SONDÉE, jamais supposée déconnectée — le
		// redessin remplace `bouton` par un bouton neuf, actif.
		await redessiner(true);
	}

	/**
	 * La connexion de Claude, Codex ou Antigravity : MÊME MODALE d'attente que
	 * la carte d'erreur de la page « Générer », par le module partagé
	 * `connexion-cli.ts` — un terminal s'ouvre, la modale se remonte sous lui
	 * dès qu'il est posé, et suit le navigateur s'il en ouvre un (les deux
	 * colonnes). Ne rend la main qu'à la fermeture de la modale (annulée, ou
	 * refermée après détection) : `surClicAction` redessine la ligne à ce
	 * moment-là, jamais avant.
	 */
	async function connecterAvecAttente(outil: OutilConnectable): Promise<void> {
		return new Promise<void>((resolve) => {
			let sonde: number | null = null;
			let connecteVu = false;
			let desabonnerConnexion: (() => void) | null = null;
			let corpsEl: HTMLElement | null = null;
			const couperSonde = (): void => {
				if (sonde !== null) { window.clearInterval(sonde); sonde = null; }
			};
			const modale = requireHost("modals").open({
				className: "qbd-web-wait-modal qbd-login-wait-modal",
				title: nomOutil(outil),
				onOpen: (m) => {
					corpsEl = m.contentEl;
					poserCroixAnnuler(m);
					renderCarteAttenteConnexion(corpsEl, connecteVu);
				},
				// Fermée par la croix/Échap (annulation) OU par nous-mêmes après
				// détection : dans les deux cas, tout ce que cette attente a posé
				// doit disparaître — la sonde, l'abonnement de repositionnement.
				onClose: () => {
					couperSonde();
					desabonnerConnexion?.();
					desabonnerConnexion = null;
					corpsEl = null;
					resolve();
				},
			});
			void (async () => {
				const verdict = await demarrerConnexionCli(outil, {
					modaleEl: modale.panelEl,
					// `lance` seulement : les deux autres verdicts ont déjà coupé
					// leurs abonnements dans `demarrerConnexionCli` lui-même.
					onDesabonner: (off) => { desabonnerConnexion = off; },
				});
				if (verdict !== "lance") {
					if (verdict === "indisponible") {
						currentHost().ui.notice(t("app.comptes.connectFailed", { name: nomOutil(outil) }));
					}
					// `annule` : l'utilisateur a dit non, rien de plus à dire.
					modale.close();
					return;
				}
				const sondeFn = sondeConnexion(outil);
				sonde = window.setInterval(() => {
					void sondeFn().then((connecte) => {
						// `sonde === null` : annulée pendant que la sonde tournait — son
						// résultat ne doit plus rien déclencher.
						if (!connecte || sonde === null || detruit) return;
						couperSonde();
						connecteVu = true;
						if (corpsEl) { corpsEl.replaceChildren(); renderCarteAttenteConnexion(corpsEl, true); }
						/* La seconde d'attente rend la détection LISIBLE, même règle
						   que la page « Générer » : sans elle, la coche et la fermeture
						   se remplaceraient dans la même image. */
						window.setTimeout(() => modale.close(), 1000);
					});
				}, SONDE_CONNEXION_POLL_MS);
			})();
		});
	}

	async function surClicAction(
		outil: CliTool,
		action: "installer" | "connecter" | "deconnecter",
		bouton: HTMLButtonElement,
	): Promise<void> {
		if (action === "deconnecter") {
			// FERMÉ AVANT D'OUVRIR LA MODALE, comme `redessiner` et
			// `poserSquelette` : le popover d'usage est à z-index 1000, au-dessus
			// de la couche modale (90), et resterait peint par-dessus la
			// confirmation sans ça.
			fermerPopoversUsage();
			// DÉSACTIVÉ AVANT D'OUVRIR LA CONFIRMATION, comme les deux autres
			// branches : sans ça, un double-clic rapide empile deux modales de
			// confirmation. Réactivé si l'utilisateur annule — `redessiner()`
			// (donc un bouton refait à neuf) ne suit que la confirmation.
			bouton.disabled = true;
			const name = nomOutil(outil);
			openConfirmModal(
				t("app.comptes.logoutTitle", { name }),
				t("app.comptes.logoutMessage", { name }),
				t("app.comptes.logoutConfirm"),
				t("app.comptes.cancel"),
				(confirme) => {
					if (!confirme) {
						bouton.disabled = false;
						return;
					}
					void deconnecter(outil, bouton);
				},
				t("app.comptes.logoutDetail"),
				"log-out",
			);
			return;
		}
		bouton.disabled = true;
		try {
			// OLLAMA N'A PAS DE CLI DE CONNEXION : `connecterCli("ollama")` rend
			// `indisponible` par contrat (pas de compte à connecter par terminal).
			// La vraie connexion ouvre le NAVIGATEUR sur l'adresse que le démon a
			// rendue à sa dernière sonde 401 — même chemin que `demarrerConnexion`
			// dans `dashboard/ai.ts`. Même règle de repli qu'elle : une adresse
			// absente (carte affichée sans sonde préalable) se resonde une fois
			// avant de renoncer.
			if (action === "connecter" && outil === "ollama") {
				if (!ollamaSigninUrl) {
					const compte = await checkOllamaCompte(await lireAiOllamaUrl());
					if (!compte.connecte && compte.signinUrl) ollamaSigninUrl = compte.signinUrl;
				}
				const ouvert = ollamaSigninUrl !== null && await currentHost().shell.openUrl(ollamaSigninUrl);
				if (!ouvert) currentHost().ui.notice(t("app.comptes.connectFailed", { name: nomOutil(outil) }));
				return;
			}
			if (action === "connecter") {
				// CLAUDE, CODEX, ANTIGRAVITY : même modale d'attente que la carte
				// d'erreur de la page « Générer » — voir `connecterAvecAttente`.
				await connecterAvecAttente(outil as OutilConnectable);
				return;
			}
			const verdict = await requireHost("process").installerCli(outil);
			if (verdict === "indisponible") {
				currentHost().ui.notice(t("app.comptes.installFailed", { name: nomOutil(outil) }));
			}
			// `"lance"` ou `"annule"` : rien à dire de plus ici, le terminal (s'il
			// est parti) fait le reste — la ligne se redessine, au pire inchangée.
		} catch (e) {
			// Un rejet du pont ou du serveur Ollama (panne réseau, IPC refusé) :
			// même message que le verdict `indisponible`, jamais une exception qui
			// remonterait jusqu'au clic et laisserait le bouton figé désactivé.
			console.warn(LOG_PREFIX, "action de compte impossible:", e);
			currentHost().ui.notice(t(
				action === "installer" ? "app.comptes.installFailed" : "app.comptes.connectFailed",
				{ name: nomOutil(outil) },
			));
		} finally {
			if (!detruit) await redessiner(true);
		}
	}

	/* Au montage : un cache de la session existe → dessiner DESSUS tout de
	   suite, SANS squelette (c'est le point de la TÂCHE B : rouvrir les
	   réglages ne doit pas repartir d'un écran vide), puis `redessiner()`
	   remplace en fond quand la lecture fraîche arrive. Premier montage de la
	   session (cache null) : squelette, comme avant. */
	if (cacheEtats) {
		ollamaSigninUrl = cacheEtats.ollamaSigninUrl;
		for (const etat of cacheEtats.etats) poserLigne(etat);
	} else {
		poserSquelette();
	}
	void redessiner();

	return () => { detruit = true; annulerOuverturesEnAttente(); fermerPopoversUsage(); };
}
