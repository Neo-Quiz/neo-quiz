/**
 * Non-régression de la PORTE RÉSEAU du processus principal Electron
 * (`apps/windows/electron/reseau.ts`) — tâche 2 de la génération IA dans
 * l'application (docs/superpowers/plans/2026-09-11-generation-ia-app.md).
 *
 * Ce qu'il empêche : qu'un rendu compromis fasse de l'application un RELAIS
 * vers n'importe où. La fenêtre rend du HTML qui n'est pas toujours celui de
 * l'utilisateur (un quiz PARTAGÉ porte les `explainHtml` de son auteur), et
 * le canal `reseau.fetch` du pont est, par construction, « fais cette requête
 * à ma place ». Sans la liste d'hôtes, exfiltrer une note tiendrait en un
 * appel. Le contrôle éprouve donc la liste (refus nommé, `localhost` admis,
 * l'hôte d'`aiOllamaUrl` admis APRÈS `autoriserHote`, le protocole `file:`
 * refusé même sur un hôte de la liste), puis les deux conduites que
 * `HostNet` promet et que `requestUrl` ne tenait pas : un statut d'erreur
 * RENDU avec son corps, une annulation qui rend `null` sans lever.
 *
 * Sur le module RÉEL, par `withSrcModule`, contre un petit serveur `http`
 * local sur un port libre : `reseau.ts` reçoit son transport en paramètre
 * (le `fetch` global de Node ici, `net.fetch` d'Electron dans l'application)
 * précisément pour que ce script n'ait à doubler ni la liste ni le corps.
 *
 * Chaque cas est isolé dans `cas()` : une exception non prévue devient un
 * échec NOMMÉ, jamais une mort du script qui cacherait les cas suivants.
 *
 *     npm run check:electron-reseau
 */
import { createServer } from "node:http";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

/** Capture les `console.warn` le temps d'un appel, et les rend avec son
    résultat. C'est la moitié « nommé » du refus : un `null` muet ressemblerait
    à une panne réseau, et le cas doit pouvoir le distinguer. */
async function avecWarn(fn) {
	const avertir = console.warn;
	const warns = [];
	console.warn = (...args) => warns.push(args.map(String).join(" "));
	try {
		return { resultat: await fn(), warns };
	} finally {
		console.warn = avertir;
	}
}

/**
 * Le serveur local : `/ok` rend 200, `/erreur` rend 500 avec un corps (le
 * diagnostic qu'Ollama met dans les siens), `/lent` ne répond qu'après un
 * délai — c'est lui qui rend l'annulation discriminante : un signal NON relayé
 * attendrait cette réponse au lieu de rendre `null` tout de suite.
 * Écoute sur l'adresse non spécifiée (`::`, double pile sous Windows) : Node
 * résout « localhost » en IPv6 d'abord, et un serveur lié à `127.0.0.1` seul
 * refuserait la connexion — le cas « localhost est accepté » serait rouge
 * pour une raison qui n'a rien à voir avec la liste.
 */
function demarrerServeur() {
	const requetes = [];
	const serveur = createServer((req, res) => {
		requetes.push(req.url);
		if (req.url === "/erreur") {
			res.statusCode = 500;
			res.setHeader("content-type", "application/json");
			res.end('{"error":"model not found"}');
			return;
		}
		if (req.url === "/lent") {
			setTimeout(() => { res.statusCode = 200; res.end("trop tard"); }, 800);
			return;
		}
		if (req.url === "/echo" && req.method === "POST") {
			let corps = "";
			req.on("data", c => { corps += c; });
			req.on("end", () => { res.statusCode = 200; res.end(JSON.stringify({ corps, type: req.headers["content-type"] ?? null })); });
			return;
		}
		res.statusCode = 200;
		res.end("ok");
	});
	return new Promise(resolve => {
		serveur.listen(0, () => resolve({
			port: serveur.address().port,
			requetes,
			async arreter() {
				/* Les connexions encore ouvertes (la réponse « lente » d'une
				   annulation) retiendraient `close` : on les coupe. */
				serveur.closeAllConnections();
				await new Promise(res => serveur.close(res));
			},
		}));
	});
}

await withSrcModule("apps/windows/electron/reseau.ts", async ({ HOTES_AUTORISES, autoriserHote, hoteAutorise, fetchBorne }) => {
	const r = makeReporter("Électron — réseau");
	const serveur = await demarrerServeur();
	const { port } = serveur;
	try {
		/* La liste de la conception, ENTIÈRE : une entrée ajoutée « pour aller
		   vite » ou retirée « par simplification » rougirait ici, nommée. Lue
		   AVANT `autoriserHote` plus bas, qui l'étend exprès. Les quatre
		   originaux (IA : Ollama en local, son catalogue, l'usage) plus les
		   quatre des vidéos YouTube (spec
		   docs/superpowers/specs/2026-09-22-videos-youtube-design.md, §3.2) :
		   `i.ytimg.com` pour la miniature, les trois sous GitHub pour le
		   téléchargement de yt-dlp. Plus, since 2026-10-03, `registry.npmjs.org`
		   for the latest version of Claude Code and Codex (the "update
		   available" banner, `dashboard/cli-updates.ts`). */
		r.check("la liste d'hôtes est exactement celle de la conception",
			[...HOTES_AUTORISES].sort(),
			[
				"127.0.0.1",
				"api.anthropic.com",
				"cdn.jsdelivr.net",
				"files.pythonhosted.org",
				"github.com",
				"i.ytimg.com",
				"localhost",
				"moodle.myefrei.fr",
				"objects.githubusercontent.com",
				"ollama.com",
				"pypi.org",
				"registry.npmjs.org",
				"release-assets.githubusercontent.com",
			]);

		await cas(r, "un hôte hors liste rend null ET un console.warn, sans toucher le réseau", async () => {
			/* `.invalid` ne résout jamais (RFC 2606) : si la garde tombait, la
			   requête partirait, échouerait en DNS et rendrait `null` AUSSI — c'est
			   le `warn` « hôte hors liste » qui distingue les deux, et le compteur
			   de requêtes reçues par le serveur. */
			const url = `http://neo-quiz-hors-liste.invalid:${port}/ok`;
			const avant = serveur.requetes.length;
			const { resultat, warns } = await avecWarn(() => fetchBorne({ url }));
			r.check("un hôte hors liste rend null ET un console.warn, sans toucher le réseau",
				{
					resultat,
					refusNomme: warns.some(w => w.includes("hôte hors liste") && w.includes(url)),
					requetesRecues: serveur.requetes.length - avant,
				},
				{ resultat: null, refusNomme: true, requetesRecues: 0 });
		});

		await cas(r, "localhost et 127.0.0.1 sont acceptés, et la requête atteint le serveur", async () => {
			r.check("localhost et 127.0.0.1 sont acceptés, et la requête atteint le serveur",
				{
					pur: { localhost: hoteAutorise(`http://localhost:${port}/ok`), boucle: hoteAutorise(`http://127.0.0.1:${port}/ok`) },
					reel: await fetchBorne({ url: `http://localhost:${port}/ok` }),
				},
				{ pur: { localhost: true, boucle: true }, reel: { status: 200, body: "ok" } });
		});

		await cas(r, "autoriserHote(\"mon-nas\") l'accepte ensuite, et pas avant", async () => {
			const url = "http://mon-nas:11434/api/tags";
			const avant = hoteAutorise(url);
			autoriserHote("mon-nas");
			r.check("autoriserHote(\"mon-nas\") l'accepte ensuite, et pas avant",
				/* La casse et le port ne comptent pas : `MON-NAS:11434` est le même
				   NAS. Une comparaison sur `host` (avec le port) ou sensible à la
				   casse refuserait l'URL que l'utilisateur a tapée. */
				{ avant, apres: hoteAutorise(url), casseEtPort: hoteAutorise("http://MON-NAS:9999/api/tags") },
				{ avant: false, apres: true, casseEtPort: true });
		});

		await cas(r, "un protocole autre que http(s) est refusé, même sur un hôte de la liste", async () => {
			/* `net.fetch` d'Electron sert `file:` — c'est ce que `main.ts` en fait
			   pour les images. `new URL("file://127.0.0.1/C:/x").hostname` vaut
			   « 127.0.0.1 », un hôte DE LA LISTE : sans la moitié « protocole »,
			   la porte réseau serait une porte disque hors du périmètre. */
			r.check("un protocole autre que http(s) est refusé, même sur un hôte de la liste",
				{
					file: hoteAutorise("file://127.0.0.1/C:/Users/x/settings.json"),
					fileNu: hoteAutorise("file:///C:/Users/x/settings.json"),
					ftp: hoteAutorise("ftp://localhost/x"),
					illisible: hoteAutorise("pas une url"),
					https: hoteAutorise("https://ollama.com/library"),
				},
				{ file: false, fileNu: false, ftp: false, illisible: false, https: true });
		});

		await cas(r, "un statut 500 est RENDU avec son corps, jamais null", async () => {
			/* C'est la raison d'être de `HostNet` : Ollama met son diagnostic dans
			   le corps d'un statut d'erreur, et `requestUrl` le jetait. */
			r.check("un statut 500 est RENDU avec son corps, jamais null",
				await fetchBorne({ url: `http://127.0.0.1:${port}/erreur` }),
				{ status: 500, body: '{"error":"model not found"}' });
		});

		await cas(r, "method, headers et body traversent intacts", async () => {
			const reponse = await fetchBorne({
				url: `http://127.0.0.1:${port}/echo`,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"model":"llama3"}',
			});
			r.check("method, headers et body traversent intacts",
				{ status: reponse?.status ?? null, corps: reponse ? JSON.parse(reponse.body) : null },
				{ status: 200, corps: { corps: '{"model":"llama3"}', type: "application/json" } });
		});

		await cas(r, "une annulation rend null sans lever, avant la réponse du serveur", async () => {
			const controleur = new AbortController();
			const debut = Date.now();
			const enCours = fetchBorne({ url: `http://127.0.0.1:${port}/lent`, signal: controleur.signal });
			setTimeout(() => controleur.abort(), 50);
			/* Aucun `warn` pour une annulation : l'appelant vient de la demander,
			   la journaliser comme une panne enverrait chercher un défaut réseau
			   qui n'existe pas. */
			const { resultat, warns } = await avecWarn(() => enCours);
			r.check("une annulation rend null sans lever, avant la réponse du serveur",
				{ resultat, avantLaReponse: Date.now() - debut < 700, warns: warns.length },
				{ resultat: null, avantLaReponse: true, warns: 0 });
		});

		await cas(r, "un hôte injoignable rend null, et le nomme", async () => {
			/* Un port fermé sur la boucle locale : ECONNREFUSED, immédiat. */
			const url = "http://127.0.0.1:1/ok";
			const { resultat, warns } = await avecWarn(() => fetchBorne({ url }));
			r.check("un hôte injoignable rend null, et le nomme",
				{ resultat, nomme: warns.some(w => w.includes("requête échouée") && w.includes(url)) },
				{ resultat: null, nomme: true });
		});
	} finally {
		await serveur.arreter();
	}
	r.done();
});
