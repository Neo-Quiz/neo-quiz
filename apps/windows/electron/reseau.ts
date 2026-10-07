/* ══════════════════════════════════════════════════════════
   LE RÉSEAU — TOUT HTTP PART DU PRINCIPAL, DERRIÈRE UNE LISTE D'HÔTES

   Tâche 2 de la génération IA dans l'application
   (docs/superpowers/plans/2026-09-11-generation-ia-app.md). C'est
   l'implémentation de `HostNet` (`src/host/types.ts`) côté processus
   principal ; le rendu n'y accède que par deux canaux du pont
   (`reseau.fetch`, `reseau.annuler`, voir `canaux.ts`).

   POURQUOI LE PRINCIPAL ET PAS LA FENÊTRE. Deux raisons, et la seconde est
   celle qui compte :
   1. un `fetch` du rendu vers `http://localhost:11434` (Ollama) est refusé par
      la politique d'origine de Chromium — sous Tauri il passait, sous Electron
      il ne passe plus ;
   2. la fenêtre rend du HTML qui n'est pas toujours celui de l'utilisateur
      (un quiz PARTAGÉ porte les `explainHtml` de son auteur). Un canal
      « fais cette requête » sans liste d'hôtes ferait de l'application un
      RELAIS vers n'importe où : exfiltrer une note vers un serveur tiers
      tiendrait en un `reseau.fetch({ url: "https://…", body })`. La liste
      ci-dessous est la règle ; aucun canal du pont ne l'étend DIRECTEMENT
      (voir `autoriserHote`, et le résiduel qu'il nomme).

   CE QUE LA LISTE NE GARANTIT PAS, écrit pour qu'on ne le découvre pas :
   - `net.fetch` SUIT les redirections. Un hôte de la liste peut répondre 3xx
     vers n'importe quel hôte, et un 307/308 renvoie le corps du POST là-bas.
     Admis : qui contrôle la réponse d'un hôte de la liste tient déjà ce
     corps, et `redirect: "manual"` casserait le catalogue d'`ollama.com`,
     qui redirige ;
   - `localhost` est admis sur TOUS les ports (le plan l'exige : Ollama en
     change d'une installation à l'autre), donc tout service local en HTTP
     est joignable depuis le rendu.

   POURQUOI CE MODULE N'IMPORTE PAS `electron`. Le vrai transport est
   `net.fetch` d'Electron (la pile réseau de Chromium : proxy du système,
   certificats), que `canaux.ts` lui passe. Mais `net.fetch` n'existe pas
   sous Node nu, et c'est là que `scripts/check-electron-reseau.mjs` charge ce
   module pour éprouver la liste, le corps d'un statut d'erreur et
   l'annulation contre un petit serveur `http` local. D'où un transport
   INJECTABLE, qui retombe sur le `fetch` global de Node : la règle d'hôtes
   est éprouvée sur le code RÉEL, pas sur une réplique.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../src/branding";
import type { HostNetRequest, HostNetResponse } from "../../../src/host/types";

/** Le transport : la signature de `fetch`, que `net.fetch` d'Electron
    partage. Réduite à ce qui est consommé ici. */
export type Transport = (url: string, init: {
	method: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Les hôtes que le principal accepte de joindre, et RIEN d'autre.
 *
 * `localhost`/`127.0.0.1` : Ollama en local. `ollama.com` : son catalogue de
 * modèles (lu dynamiquement, jamais codé en dur — mémoire projet
 * `ollama-latest-version-only`). `api.anthropic.com` : l'usage de
 * l'abonnement. Les quatre suivants : les vidéos YouTube (spec du
 * 2026-09-22, §3.2) — `i.ytimg.com` pour la miniature d'une vidéo lue ;
 * `github.com`, `objects.githubusercontent.com` et
 * `release-assets.githubusercontent.com` pour le téléchargement de
 * yt-dlp par la tâche 3 (la release et ses assets). Une entrée de plus
 * ici est une décision, pas une commodité.
 */
export const HOTES_AUTORISES = new Set([
	"localhost",
	"127.0.0.1",
	"ollama.com",
	"api.anthropic.com",
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
	"i.ytimg.com",
	/* The latest version of Claude Code and Codex (`dashboard/cli-updates.ts`,
	   2026-10-03): `/<package>/latest`, read-only, no account. */
	"registry.npmjs.org",
	/* Python packages on demand (`paquets-python.ts`, 2026-10-07): the Pyodide
	   CDN for the packages the pack does not carry, PyPI for pure wheels. Only
	   the main process reaches them; the sandbox never does. */
	"cdn.jsdelivr.net",
	"pypi.org",
	"files.pythonhosted.org",
	/* The school's own Moodle (`moodle/garde.ts` SITE_DEFAUT, 2026-10-07):
	   allowed by code, so it needs no field and no dialog. Another site goes
	   through the guarded `moodle` setting. */
	"moodle.myefrei.fr",
]);

/** L'hôte d'`aiOllamaUrl` s'ajoute ici par DEUX chemins, et aucun des deux
    n'est un canal du pont : `main.ts` (`admettreHoteOllama`) le relit des
    réglages au démarrage, et `canaux.ts` (`garderReglagesIa`) l'admet au
    moment où le rendu l'ÉCRIT — après la garde, jamais avant. Un Ollama sur un
    NAS (« mon-nas:11434 ») est un usage légitime, déclaré par l'utilisateur.

    LA GARDE (tâche 6, `garde-ia.ts`) est ce qui fait que « piloté par les
    réglages » n'est pas une porte : l'URL doit être en http(s) ; un hôte de la
    liste ou du réseau local (boucle locale, RFC 1918, `.local`) passe ; tout
    autre hôte est DEMANDÉ à l'utilisateur par un dialogue natif du principal,
    et refusé = rien d'écrit, rien d'admis. Un rendu compromis ne peut donc
    plus écrire `{ aiOllamaUrl: "https://attaquant.example" }` et obtenir cet
    hôte au prochain lancement : il obtient une question posée à l'utilisateur,
    dans une boîte qu'il n'a pas rédigée. */
export function autoriserHote(hote: string): void {
	const h = hote.trim().toLowerCase();
	if (h) HOTES_AUTORISES.add(h);
}

/**
 * PURE, et c'est ce qui la rend éprouvable : vrai si l'URL est du `http(s)`
 * vers un hôte de la liste.
 *
 * Le PROTOCOLE est vérifié, pas seulement l'hôte : `net.fetch` d'Electron sert
 * aussi `file:` (c'est exactement ce que `main.ts` en fait pour les images
 * d'un quiz), et `new URL("file://127.0.0.1/C:/x").hostname` vaut bien
 * « 127.0.0.1 » (mesuré, Node 26) — un hôte DE LA LISTE. Sans cette moitié,
 * la porte réseau serait une porte disque de plus, hors du périmètre.
 * `hostname` et non `host` : le port n'entre pas dans la règle, Ollama en
 * change d'une installation à l'autre. Une URL illisible est refusée, pas
 * une exception : la réponse à « puis-je ? » est toujours oui ou non.
 */
export function hoteAutorise(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") return false;
	return HOTES_AUTORISES.has(u.hostname.toLowerCase());
}

/**
 * La requête, BORNÉE par la liste d'hôtes.
 *
 * Trois sorties, et elles ne se confondent pas :
 * - hôte hors liste → `null`, ET le refus est NOMMÉ dans la console — un
 *   `null` muet ressemblerait à une panne réseau et ferait chercher ailleurs ;
 * - un statut non-2xx est RENDU avec son corps : Ollama y met son diagnostic
 *   (« model not found »), et c'est ce que l'utilisateur doit lire. Traiter
 *   l'erreur HTTP comme un échec réseau, c'est exactement ce que `requestUrl`
 *   faisait par défaut et que `HostNet` existe pour corriger ;
 * - une exception du transport (injoignable, DNS, annulé par `signal`) →
 *   `null`. L'annulation N'EST PAS une erreur pour l'appelant : il vient de la
 *   demander.
 *
 * `transport` : `net.fetch` d'Electron dans l'application (passé par
 * `canaux.ts`), le `fetch` global de Node sous le contrôle — voir l'en-tête.
 */
export async function fetchBorne(
	req: HostNetRequest,
	transport: Transport = globalThis.fetch,
): Promise<HostNetResponse | null> {
	if (!hoteAutorise(req.url)) {
		console.warn(LOG_PREFIX, "requête refusée, hôte hors liste:", req.url);
		return null;
	}
	try {
		const resp = await transport(req.url, {
			method: req.method ?? "GET",
			headers: req.headers,
			body: req.body,
			signal: req.signal,
		});
		return { status: resp.status, body: await resp.text() };
	} catch (e) {
		/* L'annulation est demandée par l'appelant : la journaliser comme une
		   panne enverrait chercher un défaut réseau qui n'existe pas. */
		if (!req.signal?.aborted) console.warn(LOG_PREFIX, "requête échouée:", req.url, e);
		return null;
	}
}
