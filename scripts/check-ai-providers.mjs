/**
 * LES FOURNISSEURS IA — le catalogue, les statuts, l'instantané des CLI.
 *
 * `src/dashboard/ai-providers.ts` décide de ce que la page « Générer » propose
 * et de ce qu'elle affiche comme statut, et AUCUN script ne le chargeait : la
 * tranche 5 l'a fait passer tout entier par le contrat d'hôte (`net.fetchJson`
 * pour Ollama et le catalogue, `process.lireCache` pour les fichiers des CLI)
 * sans qu'une seule ligne de ce module soit éprouvée. Ce qui échouerait EN
 * SILENCE, et que ce script empêche :
 *
 * — le CATALOGUE CLOUD est lu de `ollama.com` par le contrat, jamais codé en
 *   dur (mémoire projet `ollama-latest-version-only`) : un module qui
 *   retomberait sur son repli embarqué sans jamais consulter l'hôte afficherait
 *   une liste périmée, indistinguable d'une liste à jour ;
 * — un « 200 qui n'est pas du JSON » (portail captif, proxy, n'importe quel
 *   service qui occupe le port 11434) doit valoir HORS LIGNE. L'ancien
 *   `resp.json()` levait et tombait dans le `catch` ; depuis que le contrat rend
 *   le corps BRUT, un `JSON.parse` oublié donnerait « Ollama joignable, 0
 *   modèle » — et l'utilisateur chercherait où sont passés ses modèles ;
 * — les deux lecteurs SYNCHRONES des fichiers de CLI (`getCodexModels`,
 *   `isFableOffered`) lisent un INSTANTANÉ que seul `refreshCliCaches` remplit.
 *   S'il ne le remplissait plus, ils rendraient le repli embarqué pour toujours,
 *   sans erreur : le menu de modèles n'afficherait jamais un modèle neuf du
 *   compte.
 *
 * Le module RÉEL, avec un faux hôte : c'est le seul moyen de voir ce qu'il
 * DEMANDE à son hôte (l'URL, la méthode) et non seulement ce qu'il en fait.
 *
 *     npm run check:ai-providers
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Le faux hôte : il JOURNALISE chaque requête et chaque lecture de cache, et
    rend ce que le cas lui a préparé. Tout le reste du contrat est là sous sa
    forme minimale — un faux hôte PARTIEL meurt sur un TypeError le jour où un
    appelant y touche, et une mort en route masque les groupes suivants. */
function fauxHote({ reponses = {}, caches = {}, runs = {}, comptes = [], comptesErreur = false, surveillant = null } = {}) {
	const journal = [];
	// `corps` : le CORPS de chaque requête `fetchJson`, dans l'ordre — `journal`
	// reste un tuple à 3 (type, url, méthode) pour ne rien casser des cas
	// existants qui le comparent tel quel ; un cas qui a besoin du corps posté
	// (sonderPlanOllama : num_predict, stream) le relit ici séparément.
	const corps = [];
	return {
		journal,
		corps,
		hote: {
			fs: {
				read: async () => "", readCached: async () => "", write: async () => {}, process: async () => {},
				writeBinary: async () => {}, readBinary: async () => new Uint8Array(), trash: async () => {},
				exists: async () => false, mkdirs: async () => {}, append: async () => {}, list: async () => [],
				remove: async () => {}, rename: async () => {}, listMarkdown: () => [], findByName: () => [],
				getFile: () => null, listFiles: () => [], listDir: async () => [],
				externe: { list: async () => [], stat: async () => null, read: async () => "", readBinary: async () => new Uint8Array() },
			},
			links: { resolve: () => null, resourceUrl: () => null },
			watcher: { onChange: () => () => {}, onRenameDir: () => () => {} },
			ui: { notice: () => {}, setIcon: () => {}, iconNames: () => [] },
			math: { ready: async () => {}, render: () => null, flush: () => {} },
			shell: { openExternal: async () => false, revealInHost: async () => false, openUrl: async () => false },
			platform: { isMobile: false, isMacOS: false, isWindows: true, isDesktopApp: true, uiLanguage: "en" },
			paths: { resultsDirFor: () => ".results", attachmentPathFor: async (n) => n, roots: () => [], defaultRoot: () => ({ id: "", name: "", reviewLog: "", reviewJournalDir: "", deviceId: "test-device", legacyReviewLog: null, vault: false }), rootOf: () => null, localPath: (p) => p, contractPath: (_r, p) => p },
			modals: { open: () => ({ panelEl: null, contentEl: null, close: () => {} }) },
			net: {
				async fetchJson(req) {
					journal.push(["fetchJson", req.url, req.method ?? "GET"]);
					corps.push({ url: req.url, method: req.method ?? "GET", body: req.body });
					/* La clé la plus SPÉCIFIQUE qui préfixe l'URL : un cas pose
					   « /api/tags » et « /api/version » séparément. */
					const cle = Object.keys(reponses).filter(k => req.url.includes(k)).sort((a, b) => b.length - a.length)[0];
					return cle === undefined ? null : reponses[cle];
				},
			},
			process: {
				/* `runs` : ce que le CLI RÉPOND, par « outil + arguments ». Sans
				   entrée, le rejet `indisponible` d'origine — l'hôte qui ne sait
				   pas lancer de CLI reste le défaut de ce faux. */
				async run(spec) {
					const cle = [spec.tool, ...(spec.args || [])].join(" ");
					journal.push(["run", cle]);
					const rep = runs[cle];
					if (rep === undefined) { const e = new Error("pas de CLI ici"); e.name = "indisponible"; throw e; }
					if (rep instanceof Error) throw rep;
					return { stdout: rep.stdout ?? "", stderr: rep.stderr ?? "", code: rep.code ?? 0 };
				},
				async lireCache(outil) {
					journal.push(["lireCache", outil]);
					return caches[outil] ?? null;
				},
				/* `surveillant` : un objet où le faux dépose le rappel de
				   `surCachesCli`, pour que le cas joue la réécriture d'un
				   fichier. Absent : l'hôte n'a pas de surveillant (le greffon). */
				...(surveillant ? { surCachesCli(rappel) { surveillant.abonnes++; surveillant.rappel = rappel; return () => { surveillant.abonnes--; }; } } : {}),
				ollamaInstalle: async () => false,
				demarrerOllama: async () => false,
				/* `etatComptes()` : la lecture SANS VERROU dont Claude et Codex se
				   servent depuis le 2026-09-21 (voir l'en-tête de
				   `ai-providers.ts`, section « LE COMPTE EST-IL CONNECTÉ ? »).
				   `comptes` est la liste rendue telle quelle ; `comptesErreur`
				   simule un pont qui rejette (outil hors liste blanche, panne
				   d'IPC). */
				async etatComptes() {
					journal.push(["etatComptes"]);
					if (comptesErreur) throw new Error("pont indisponible");
					return comptes;
				},
			},
		},
	};
}

await withSrcModule(
	["src/host/current.ts", "src/dashboard/ai-providers.ts"],
	async ({ installHost }, providers) => {
		const r = makeReporter("Fournisseurs IA");

		/* ── LE CATALOGUE CLOUD VIENT DE `ollama.com/api/tags`, en JSON ──
		   Jusqu'au 2026-09-19 le module cherchait un marqueur dans le HTML de la
		   page de recherche (`x-test-search-response-title`). Ce marqueur a
		   disparu du site : la fonction n'extrayait plus AUCUNE famille et rendait
		   le repli embarqué, sans erreur, depuis une date inconnue — le défaut
		   exact que ce script existe pour voir. `/api/tags` est le catalogue
		   lui-même, structuré ; un corps qui n'est pas du JSON lève. */
		{
			const json = JSON.stringify({ models: [
				{ name: "gpt-oss:120b", modified_at: "2025-08-05T00:00:00Z", size: 1 },
				{ name: "zzz-nouveau", modified_at: "2026-09-01T00:00:00Z", size: 1 },
				{ name: "deepseek-v4-pro:0813", modified_at: "2026-08-13T00:00:00Z", size: 1 },
			] });
			const { journal, hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: json } } });
			installHost(hote);
			const catalogue = await providers.fetchOllamaCloudCatalog().catch(() => []);
			r.check("le catalogue cloud est demandé à l'hôte, à /api/tags d'ollama.com",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "https://ollama.com/api/tags", "GET"]]);
			r.check("une famille inconnue découverte en ligne entre au catalogue, en « <famille>:cloud »",
				catalogue.some(m => m.value === "zzz-nouveau:cloud"), true);
			r.check("une famille DÉJÀ couverte garde le tag exact du repli, jamais un tag deviné",
				{ devine: catalogue.some(m => m.value === "gpt-oss:cloud"), exact: catalogue.some(m => /^gpt-oss:\d+b-cloud$/.test(m.value)) },
				{ devine: false, exact: true });
			r.check("le suffixe de tag d'ollama.com (« :0813 ») ne devient pas une famille à part",
				catalogue.filter(m => m.value.startsWith("deepseek-v4-pro")).length, 1);
		}

		/* ── UNE VARIANTE N'EST PAS UNE VERSION ──
		   Le 2026-09-10, ollama.com a publié `deepseek-v4.1-flash`. Regroupés par
		   « préfixe avant le premier chiffre », `deepseek-v4.1-flash`,
		   `deepseek-v4-pro` et `deepseek-v4-flash` étaient UN modèle de base
		   `deepseek-v`, et 4.1 > 4 évinçait le V4 Pro — le plus gros du
		   catalogue, dans la sélection par défaut, sans successeur. Mesuré sur le
		   catalogue réel le 2026-09-20 : 13 entrées au lieu de 15. La règle
		   « dernière version par modèle » vaut entre versions d'UNE variante
		   (glm-5.2 → glm-5.3), jamais d'une variante à l'autre (pro / flash /
		   code). */
		{
			const json = JSON.stringify({ models: [
				{ name: "deepseek-v4.1-flash", modified_at: "2026-09-10T00:00:00Z", size: 1 },
				{ name: "deepseek-v4-pro:0813", modified_at: "2026-08-13T00:00:00Z", size: 1 },
				{ name: "deepseek-v4-flash:0731", modified_at: "2026-07-31T00:00:00Z", size: 1 },
				{ name: "glm-5.2", modified_at: "2026-06-16T00:00:00Z", size: 1 },
				{ name: "kimi-k2.7-code", modified_at: "2026-06-12T00:00:00Z", size: 1 },
			] });
			const { hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: json } } });
			installHost(hote);
			const catalogue = await providers.fetchOllamaCloudCatalog().catch(() => []);
			const tags = catalogue.map(m => m.value);
			r.check("une variante sans successeur (V4 Pro) survit à la version supérieure d'une AUTRE variante (V4.1 Flash)",
				{ pro: tags.includes("deepseek-v4-pro:cloud"), flash41: tags.includes("deepseek-v4.1-flash:cloud") },
				{ pro: true, flash41: true });
			r.check("… et la version périmée de la MÊME variante est bien évincée (V4 Flash par V4.1 Flash, GLM-5.2 par 5.3)",
				{ flash4: tags.includes("deepseek-v4-flash:cloud"), glm52: tags.includes("glm-5.2:cloud"), glm53: tags.includes("glm-5.3:cloud") },
				{ flash4: false, glm52: false, glm53: true });
			r.check("un modèle de code (kimi-k2.7-code) n'est pas une version périmée de kimi-k3",
				tags.includes("kimi-k2.7-code:cloud"), true);
			r.check("le libellé d'une famille découverte suit la forme curée du repli (« DeepSeek V4.1 Flash », pas « Deepseek-V4.1-Flash »)",
				catalogue.find(m => m.value === "deepseek-v4.1-flash:cloud")?.label, "DeepSeek V4.1 Flash");
		}

		/* ── ET QUELQU'UN L'APPELLE ──
		   Le rafraîchissement vivait dans l'onglet de réglages du GREFFON, retiré
		   au chantier lecteur (d123caa) et jamais reporté dans l'application :
		   pendant une semaine `fetchOllamaCloudCatalog` n'a eu AUCUN appelant, le
		   cache est resté nul et le menu sur son repli figé — tous les cas
		   ci-dessus étaient verts. Un contrôle du module ne voit pas un
		   câblage absent ; celui-ci lit la page. */
		{
			const page = readFileSync(new URL("../src/dashboard/ai.ts", import.meta.url), "utf8");
			r.check("la page « Générer » appelle fetchOllamaCloudCatalog (le catalogue se rafraîchit)",
				/fetchOllamaCloudCatalog\(/.test(page), true);
		}
		{
			const { hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: "<!doctype html><title>Cloud models</title>" } } });
			installHost(hote);
			const verdict = await providers.fetchOllamaCloudCatalog().then(() => "valeur", () => "leve");
			r.check("un 200 qui n'est pas du JSON LÈVE (l'appelant garde son cache) au lieu de rendre un catalogue vide", verdict, "leve");
		}

		/* ── `/api/tags` ILLISIBLE (200 HTML) = HORS LIGNE ── */
		{
			const { hote } = fauxHote({
				reponses: { "/api/tags": { status: 200, body: "<html>Portail captif</html>" } },
			});
			installHost(hote);
			r.check("un 200 qui n'est pas du JSON n'est pas un serveur Ollama : hors ligne",
				await providers.checkOllama("http://localhost:11434", true), { ok: false, reason: "offline" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/tags": { status: 500, body: "boom" } } });
			installHost(hote);
			r.check("un statut d'erreur vaut hors ligne",
				await providers.checkOllama("http://localhost:11434", true), { ok: false, reason: "offline" });
		}

		/* ── `/api/tags` VALIDE = modèles (avec leurs capabilities) + version ──
		   `capabilities` décide si la ligne « Effort » s'affiche pour un modèle
		   LOCAL ; la version vient de `/api/version`, best-effort. */
		{
			const { journal, hote } = fauxHote({
				reponses: {
					"/api/tags": { status: 200, body: JSON.stringify({ models: [{ name: "qwen3:8b", size: 12, capabilities: ["thinking"] }] }) },
					"/api/version": { status: 200, body: JSON.stringify({ version: "0.31.2" }) },
				},
			});
			installHost(hote);
			r.check("un /api/tags valide rend les modèles, leurs capabilities et la version du serveur",
				await providers.checkOllama("http://localhost:11434/", true),
				{ ok: true, models: [{ name: "qwen3:8b", size: 12, capabilities: ["thinking"] }], version: "0.31.2" });
			/* L'URL est NORMALISÉE (barre finale retirée) avant composition : sans
			   ça, « …:11434//api/tags » part sur le réseau. */
			r.check("l'URL du réglage est normalisée avant composition",
				journal.map(l => l[1]),
				["http://localhost:11434/api/tags", "http://localhost:11434/api/version"]);
		}
		{
			/* `/api/version` est BEST-EFFORT : son échec ne coûte qu'un numéro,
			   jamais le statut « joignable » ni la liste de modèles. */
			const { hote } = fauxHote({
				reponses: { "/api/tags": { status: 200, body: JSON.stringify({ models: [] }) } },
			});
			installHost(hote);
			r.check("un /api/version muet ne coûte que la version",
				await providers.checkOllama("http://localhost:11434", true), { ok: true, models: [], version: undefined });
		}

		/* ── LE COMPTE OLLAMA PAR `/api/me` ──
		   Mesuré le 2026-09-19 (Ollama 0.34.2) : 200 `{ plan, name, email… }`
		   connecté, 401 `{ error: "unauthorized", signin_url }` sinon. Seul
		   `plan` est lu ; l'adresse e-mail ne sort jamais de cette fonction. */
		{
			const { journal, hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: JSON.stringify({ id: "x", email: "a@b.c", name: "A", plan: "free" }) } } });
			installHost(hote);
			const compte = await providers.checkOllamaCompte("http://localhost:11434/");
			r.check("/api/me est demandé en POST, sur l'URL réglée sans barre finale",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/me", "POST"]]);
			/* `email` sort depuis la section « Comptes » des réglages (2026-09-21) ;
			   `name`, `id` et `avatarurl` restent ignorés. */
			r.check("200 avec plan → connecté, le plan, l'adresse, et RIEN d'autre", compte, { connecte: true, plan: "free", email: "a@b.c" });
		}
		{
			/* Le 200 PROUVE la connexion, indépendamment du plan : un plan vide
			   ne change rien à l'affichage (aucun badge de forfait n'est rendu). */
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: JSON.stringify({ plan: "" }) } } });
			installHost(hote);
			r.check("200 avec plan VIDE → connecté quand même, plan vide", await providers.checkOllamaCompte(), { connecte: true, plan: "", email: null });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://ollama.com/connect?name=x&key=y" }) } } });
			installHost(hote);
			r.check("401 avec signin_url sur ollama.com → pas connecté, l'adresse à ouvrir",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: "https://ollama.com/connect?name=x&key=y" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://attaquant.example/connect" }) } } });
			installHost(hote);
			r.check("401 avec une signin_url HORS d'ollama.com → l'adresse est refusée (on n'ouvre pas n'importe quoi)",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: "<html>portail</html>" } } });
			installHost(hote);
			r.check("200 sans JSON → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			r.check("démon injoignable (null) → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}

		/* ── LE PLAN REQUIS D'UN MODÈLE : LA SONDE À ZÉRO TOKEN ──
		   Plus de `required_plan` des recommandations (5 modèles sur toute la
		   sélection, presque rien) : chaque modèle cloud est sondé un par un par
		   un `POST /api/chat` à `num_predict: 0`, qui tranche AVANT de générer un
		   seul token (mesuré 2026-09-19). Aucune liste de modèles gratuits n'est
		   écrite dans le code : elle pourrirait sans erreur (décision d'Ahmed). */
		{
			r.check("classerSondePlan : 402 (le message mesuré) → payant",
				providers.classerSondePlan(402, JSON.stringify({ error: "this model is not included in your free usage, add usage credits to pay as you go: https://ollama.com/settings or upgrade for included usage: https://ollama.com/upgrade (ref: x)" })),
				"payant");
			r.check("classerSondePlan : 400 « max_tokens must be positive » → inclus (le plan a déjà été validé, seul num_predict:0 est rejeté)",
				providers.classerSondePlan(400, JSON.stringify({ error: "max_tokens must be positive, got: 0" })), "inclus");
			r.check("classerSondePlan : 200 → inclus (une version future qui accepterait 0 token)",
				providers.classerSondePlan(200, "{}"), "inclus");
			r.check("classerSondePlan : 404 modèle inconnu → inconnu, jamais tranché sur une réponse qu'on ne comprend pas",
				providers.classerSondePlan(404, JSON.stringify({ error: "model 'x' not found" })), "inconnu");
			r.check("classerSondePlan : 400 avec un AUTRE message → inconnu",
				providers.classerSondePlan(400, JSON.stringify({ error: "invalid request" })), "inconnu");
			r.check("classerSondePlan : 500 → inconnu", providers.classerSondePlan(500, "boom"), "inconnu");
		}
		{
			const { journal, corps, hote } = fauxHote({
				reponses: { "/api/chat": { status: 402, body: JSON.stringify({ error: "this model is not included in your free usage … upgrade for included usage" }) } },
			});
			installHost(hote);
			const verdict = await providers.sonderPlanOllama("http://localhost:11434", "glm-5.3:cloud");
			r.check("sonderPlanOllama : POST sur <url>/api/chat",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/chat", "POST"]]);
			const requete = corps.find(c => c.url.includes("/api/chat"));
			const corpsEnvoye = requete ? JSON.parse(requete.body) : null;
			r.check("… zéro token demandé (num_predict), sans streaming, pour LE modèle sondé",
				corpsEnvoye && { model: corpsEnvoye.model, stream: corpsEnvoye.stream, num_predict: corpsEnvoye.options?.num_predict },
				{ model: "glm-5.3:cloud", stream: false, num_predict: 0 });
			r.check("… et le verdict suit classerSondePlan (402 → payant)", verdict, "payant");
		}
		{
			const { hote } = fauxHote({});
			installHost(hote);
			r.check("sonderPlanOllama : démon injoignable (null) → inconnu, jamais une exception",
				await providers.sonderPlanOllama("http://localhost:11434", "glm-5.3:cloud"), "inconnu");
		}
		{
			const glm = { value: "glm-5.3:cloud", cloud: true };
			const kimi = { value: "kimi-k3:cloud", cloud: true };
			const local = { value: "qwen3:8b", cloud: false };
			const verdicts = { "glm-5.3:cloud": "payant", "kimi-k3:cloud": "inclus", "qwen3:8b": "payant" };
			r.check("repartirParPlan : compte « pro » (payant, ou plan pas encore connu) → tout dans principal, rien dans « plus »",
				providers.repartirParPlan([glm, kimi, local], "pro", verdicts),
				{ principal: [glm, kimi, local], plus: [] });
			r.check("repartirParPlan : compte « free » → les payants CLOUD dans « plus », le reste (inclus, un LOCAL même marqué payant) dans principal, ordre conservé",
				providers.repartirParPlan([glm, kimi, local], "free", verdicts),
				{ principal: [kimi, local], plus: [glm] });
		}
		{
			r.check("erreurOllamaHorsPlan : le 402 nu, ou le message mesuré, jamais un 403 « sign in »",
				[
					providers.erreurOllamaHorsPlan(402, ""),
					providers.erreurOllamaHorsPlan(400, "this model is not included in your free usage, add usage credits to pay as you go: https://ollama.com/settings or upgrade for included usage: https://ollama.com/upgrade"),
					providers.erreurOllamaHorsPlan(403, "please sign in"),
					providers.erreurOllamaHorsPlan(500, "boom"),
				],
				[true, true, false, false]);
		}

		/* ── `refreshCliCaches` REMPLIT L'INSTANTANÉ QUE LES LECTEURS LISENT ──
		   `getCodexModels` et `isFableOffered` sont SYNCHRONES (appelés en plein
		   rendu) : ils ne peuvent pas lire le disque eux-mêmes. Sans le
		   rafraîchissement, ils rendent le repli embarqué — et c'est exactement
		   ce que le premier cas vérifie, pour que le second ne soit pas vert par
		   construction. */
		{
			const cacheCodex = {
				mtimeMs: 111,
				json: { models: [{ slug: "gpt-5.6-terra", visibility: "list", priority: 1, display_name: "GPT-5.6 Terra" }] },
			};
			const cacheClaude = { mtimeMs: 222, json: { additionalModelOptionsCache: [{ value: "claude-fable" }] } };
			const { journal, hote } = fauxHote({ caches: { codex: cacheCodex, claude: cacheClaude } });
			installHost(hote);
			r.check("avant tout rafraîchissement, les lecteurs synchrones rendent le repli embarqué",
				{ codex: providers.getCodexModels().map(m => m.value), fable: providers.isFableOffered() },
				{ codex: providers.CODEX_FALLBACK_MODELS.map(m => m.value), fable: false });
			const change = await providers.refreshCliCaches();
			r.check("refreshCliCaches lit LES DEUX fichiers par l'hôte et signale le changement",
				{ lus: journal.filter(l => l[0] === "lireCache").map(l => l[1]).sort(), change },
				{ lus: ["claude", "codex"], change: true });
			r.check("… et c'est cet instantané que getCodexModels lit",
				providers.getCodexModels().map(m => m.value), ["gpt-5.6-terra"]);
			r.check("… et que isFableOffered lit", providers.isFableOffered(), true);
			/* Un second rafraîchissement sans changement de `mtime` rend `false` :
			   l'appelant qui a déjà dessiné sa liste ne doit pas se redessiner en
			   boucle (le rendu rappellerait `refreshCliCaches`, sans fin). */
			r.check("un instantané inchangé ne signale aucun changement", await providers.refreshCliCaches(), false);
		}

		/* Le BADGE de Fable vient du forfait PASSÉ (tranche 5, tâche 6) : le
		   module ne lit plus le trousseau lui-même — c'est ce qui l'a détaché
		   d'`ai-usage.ts`, donc d'Obsidian. Sans forfait connu (l'application),
		   Fable s'affiche SANS badge, jamais avec un badge deviné. */
		{
			const fableDe = (plan) => providers.getClaudeModels(plan).find(m => m.value === "fable");
			r.check("le badge de Fable suit le forfait PASSÉ, et reste absent quand l'appelant ne le connaît pas",
				{ max: !!fableDe({ name: "Max" })?.badge, pro: !!fableDe({ name: "Pro" })?.badge, inconnu: fableDe(undefined)?.badge, equipe: fableDe({ name: "Team" })?.badge },
				{ max: true, pro: true, inconnu: undefined, equipe: undefined });
			/* Sur Pro, Fable passe par des crédits d'utilisation : visible mais
			   pas sélectionnable, et un réglage qui le désigne retombe ailleurs. */
			r.check("sur Pro, Fable est visible mais pas sélectionnable ; sur Max, il se choisit",
				{ pro: !!fableDe({ name: "Pro" })?.disabled, max: !!fableDe({ name: "Max" })?.disabled,
				  resoluPro: providers.resolveClaudeModel("fable", { name: "Pro" }), resoluMax: providers.resolveClaudeModel("fable", { name: "Max" }) },
				{ pro: true, max: false, resoluPro: "opus", resoluMax: "fable" });
		}

		/* LE CATALOGUE DE CLAUDE CODE est la source des modèles (bug du
		   2026-09-23 : menu figé sur « Opus 5 » et « Fable 5 » alors que le CLI
		   servait Opus 5.5 et proposait Fable 5.1). `projects[*].lastModelUsage`
		   ne garde que la DERNIÈRE session de chaque projet, écrite à sa
		   fermeture : un modèle servi depuis des heures peut n'y être nulle
		   part. Le CLI télécharge lui-même son catalogue
		   (`~/.claude/cache/model-catalog/…-cc.json`), relu par l'hôte : c'est
		   lui qui fait foi, `~/.claude.json` ne sert plus qu'en repli. */
		{
			const catalogue = (fetchedAt, modeles) => ({ version: 2, fetchedAt, catalog: { surface: "cc", config: { id: "cc", models: modeles } } });
			const modeles = [
				{ id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable for ambitious work", section: "main" },
				{ id: "claude-sonnet-5", name: "Sonnet 5", description: "Most efficient for everyday tasks", section: "main" },
				{ id: "claude-fable-5-1", name: "Fable 5.1", section: "main", badge: { message: "Requires usage credits" } },
				{ id: "claude-opus-5", name: "Opus 5", section: "overflow" },
				{ id: "un id; rm -rf", name: "Refusé", section: "main" },
			];
			const json = { projects: { "C:/x": { lastModelUsage: { "claude-opus-5": {}, "claude-fable-5": {} } } } };
			installHost(fauxHote({ caches: { claude: { mtimeMs: 444, json, catalogue: catalogue(1000, modeles) } } }).hote);
			await providers.refreshCliCaches();
			r.check("avec un catalogue, la liste est sa section main, le modèle à crédits en tête, sans identifiant suspect",
				providers.getClaudeModels().map(m => `${m.value}=${m.label}${m.disabled ? " (grisé)" : ""}`),
				["claude-fable-5-1=Fable 5.1 (grisé)", "claude-opus-5-5=Opus 5.5", "claude-sonnet-5=Sonnet 5"]);
			r.check("… et sa section overflow part sous « Plus de modèles »",
				providers.getClaudeMoreModels().map(m => m.label), ["Opus 5"]);
			r.check("sur Max, le modèle à crédits est inclus : sélectionnable, à sa place du catalogue",
				providers.getClaudeModels({ name: "Max" }).map(m => `${m.label}${m.disabled ? " (grisé)" : ""}`),
				["Opus 5.5", "Sonnet 5", "Fable 5.1"]);
			/* Un réglage enregistré avant le catalogue est un ALIAS : il désigne le
			   modèle principal de sa famille. Un identifiant du catalogue reste
			   tel quel, même rangé en overflow. */
			r.check("un alias enregistré se résout sur le modèle principal de sa famille",
				{ opus: providers.resolveClaudeModel("opus"), fable: providers.resolveClaudeModel("fable"), vide: providers.resolveClaudeModel(""), ancien: providers.resolveClaudeModel("claude-opus-5"), retire: providers.resolveClaudeModel("claude-opus-4-1") },
				{ opus: "claude-opus-5-5", fable: "claude-opus-5-5", vide: "claude-opus-5-5", ancien: "claude-opus-5", retire: "claude-opus-5-5" });
			r.check("un modèle à crédits enregistré retombe sur le défaut, sauf sur Max",
				{ inconnu: providers.resolveClaudeModel("claude-fable-5-1"), max: providers.resolveClaudeModel("claude-fable-5-1", { name: "Max" }) },
				{ inconnu: "claude-opus-5-5", max: "claude-fable-5-1" });
			/* Le catalogue d'un compte peut RETARDER (2026-09-22 : « Opus 5 »
			   encore en `main` à côté d'« Opus 5.5 ») : un seul modèle par
			   famille en tête, le plus ancien descend sous « Plus de modèles ». */
			const enRetard = [
				{ id: "claude-opus-5-5", name: "Opus 5.5", section: "main" },
				{ id: "claude-sonnet-5", name: "Sonnet 5", section: "main" },
				{ id: "claude-opus-5", name: "Opus 5", section: "main" },
				{ id: "claude-opus-4-8", name: "Opus 4.8", section: "overflow" },
			];
			installHost(fauxHote({ caches: { claude: { mtimeMs: 446, json, catalogue: catalogue(1500, enRetard) } } }).hote);
			await providers.refreshCliCaches();
			r.check("un catalogue en retard : un seul modèle par famille en tête, l'ancien sous « Plus de modèles »",
				{ main: providers.getClaudeModels().map(m => m.label), plus: providers.getClaudeMoreModels().map(m => m.label), ancien: providers.resolveClaudeModel("claude-opus-5") },
				{ main: ["Opus 5.5", "Sonnet 5"], plus: ["Opus 5", "Opus 4.8"], ancien: "claude-opus-5" });
			/* Le catalogue se télécharge sans que `~/.claude.json` change : le
			   même `mtime` avec un catalogue plus récent doit quand même
			   rafraîchir. */
			const neuf = [{ id: "claude-opus-5-6", name: "Opus 5.6", section: "main" }];
			installHost(fauxHote({ caches: { claude: { mtimeMs: 444, json, catalogue: catalogue(2000, neuf) } } }).hote);
			r.check("un catalogue plus récent, à mtime égal, signale un changement", await providers.refreshCliCaches(), true);
			r.check("… et la liste suit", providers.getClaudeModels().map(m => m.label), ["Opus 5.6"]);
			/* SANS catalogue (CLI ancien, jamais lancé), le repli : les alias
			   embarqués, libellés par la version la plus HAUTE vue dans
			   `lastModelUsage` et dans l'offre du CLI. */
			const repli = { mtimeMs: 555, json: { ...json, additionalModelOptionsCache: [{ value: "claude-fable-5-1[1m]" }] } };
			installHost(fauxHote({ caches: { claude: repli } }).hote);
			await providers.refreshCliCaches();
			const libelle = (v) => providers.getClaudeModels().find(m => m.value === v)?.label;
			r.check("sans catalogue, repli sur les alias, libellés par la version la plus haute connue",
				{ opus: libelle("opus"), fable: libelle("fable"), plus: providers.getClaudeMoreModels().length },
				{ opus: "Opus 5", fable: "Fable 5.1", plus: 0 });

			/* LA LISTE EN DIRECT : l'hôte prévient qu'un fichier a été réécrit,
			   `suivreModelesCli` relit l'instantané et rappelle SEULEMENT s'il a
			   changé ; un second abonné remplace le premier (sinon chaque rendu
			   du composer empilerait un écouteur). */
			const surveillant = { abonnes: 0, rappel: null };
			const caches = { claude: { mtimeMs: 777, json, catalogue: catalogue(3000, modeles) } };
			installHost(fauxHote({ caches, surveillant }).hote);
			await providers.refreshCliCaches();
			let redessins = 0;
			providers.suivreModelesCli(() => { redessins++; });
			providers.suivreModelesCli(() => { redessins++; });
			const attendreRelecture = () => new Promise(res => setTimeout(res, 20));
			surveillant.rappel("claude");
			await attendreRelecture();
			const sansChangement = redessins;
			caches.claude = { mtimeMs: 777, json, catalogue: catalogue(4000, enRetard) };
			surveillant.rappel("claude");
			await attendreRelecture();
			r.check("en direct : un fichier réécrit relit la liste, un seul abonné, aucun redessin sans changement",
				{ abonnes: surveillant.abonnes, sansChangement, apres: redessins, liste: providers.getClaudeModels().map(m => m.label) },
				{ abonnes: 1, sansChangement: 0, apres: 1, liste: ["Opus 5.5", "Sonnet 5"] });
		}

		/* ── LES SONDES DE CONNEXION (tranche « se connecter depuis l'échec ») ──

		   CE QU'ELLES EMPÊCHENT. La page « Générer » ouvre un terminal sur
		   `codex login` / `claude auth login` puis ATTEND, en boucle, que le
		   compte apparaisse. Depuis le 2026-09-21, Claude et Codex ne lancent
		   plus ce CLI eux-mêmes : ils lisent `etatComptes()`, la même lecture
		   SANS VERROU que la section « Comptes » des réglages (voir l'en-tête
		   du module). Ce que ce groupe tient désormais :

		   — le verdict suit `.connecte` de l'entrée qui porte le bon `outil`,
		     jamais un autre champ ni une autre entrée du tableau ;
		   — un CACHE ferait attendre jusqu'à une minute devant « En attente de la
		     connexion » alors que c'est fait. Les sondes d'INSTALLATION en ont un
		     (60 s) ; celles-ci ne doivent pas ;
		   — tout rejet du pont (outil hors liste blanche, panne d'IPC) vaut
		     « pas connecté », jamais une exception qui remonterait jusqu'à la
		     page.

		   La lecture du JSON `claude auth status` (`loggedIn` seul, une sortie
		   non-JSON qui ne prouve rien) a DÉMÉNAGÉ avec la lecture elle-même,
		   dans le processus principal (`comptClaude`,
		   `apps/windows/electron/comptes-pur.ts`) : ces cas sont couverts par
		   `check:electron-comptes`, pas ici. */
		{
			const { journal, hote } = fauxHote({
				comptes: [
					{ outil: "codex", installe: true, connecte: true, email: null, plan: null },
					{ outil: "claude", installe: true, connecte: true, email: "x@y.z", plan: null },
				],
			});
			installHost(hote);
			r.check("codex : `.connecte` de l'entrée `etatComptes()` vaut connecté",
				{ ok: await providers.checkCodexLogin(), appel: journal.filter(l => l[0] === "etatComptes").length },
				{ ok: true, appel: 1 });
			r.check("claude : `.connecte` de l'entrée `etatComptes()` vaut connecté",
				await providers.checkClaudeLogin(), true);
			/* Deux appels de suite doivent RELIRE `etatComptes()` : c'est toute la
			   différence avec les sondes d'installation, qui cachent 60 s. */
			await providers.checkCodexLogin();
			r.check("aucun cache : chaque sonde relit `etatComptes()`",
				journal.filter(l => l[0] === "etatComptes").length, 3);
		}
		{
			const { hote } = fauxHote({
				comptes: [
					{ outil: "codex", installe: true, connecte: false, email: null, plan: null },
					{ outil: "claude", installe: true, connecte: false, email: null, plan: null },
				],
			});
			installHost(hote);
			r.check("un compte absent n'est pas connecté, des deux côtés",
				{ codex: await providers.checkCodexLogin(), claude: await providers.checkClaudeLogin() },
				{ codex: false, claude: false });
		}
		{
			/* Un outil disparu entre-temps, un hôte sans CLI : ni l'un ni l'autre
			   n'est « connecté ». Le rejet ne doit pas remonter jusqu'à la page,
			   qui repeindrait une erreur par-dessus la carte d'attente. */
			const { hote } = fauxHote({ comptesErreur: true });
			installHost(hote);
			r.check("tout rejet de l'hôte vaut « pas connecté », jamais une exception",
				{ codex: await providers.checkCodexLogin(), claude: await providers.checkClaudeLogin() },
				{ codex: false, claude: false });
		}
		{
			const { journal, hote } = fauxHote({
				comptes: [{ outil: "claude", installe: true, connecte: true, email: null, plan: null }],
			});
			installHost(hote);
			r.check("sondeConnexion(outil) rend bien la sonde de CET outil",
				{ ok: await providers.sondeConnexion("claude")(), appel: journal.filter(l => l[0] === "etatComptes").length },
				{ ok: true, appel: 1 });
		}

		/* ── ANTIGRAVITY : les modèles viennent d'`agy models`, jamais d'une liste
		   écrite dans le code (règle « jamais de modèle codé en dur »). Le CLI
		   rend « id<TAB>libellé » par ligne, précédé d'une ligne d'attente
		   (mesuré le 2026-09-20, `agy` 1.2.7), et le NIVEAU dans le nom : les
		   variantes d'une famille deviennent un modèle à `efforts`. ── */
		{
			const sortie = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n\nun id avec espace\tRefusé\ngemini-3.8-flash-high\tDoublon\n";
			r.check("parseAntigravityModels : une famille par modèle, ses niveaux dans `efforts` (ordre low→high), la variante citée en premier par défaut, `variantes` = l'identifiant du CLI par niveau ; une famille à UNE variante reste nue ; l'attente, les vides, les identifiants impossibles et les doublons sont ignorés",
				providers.parseAntigravityModels(sortie),
				[
					{ value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", efforts: ["low", "medium", "high"], defaultEffort: "high", variantes: { high: "gemini-3.8-flash-high", medium: "gemini-3.8-flash-medium", low: "gemini-3.8-flash-low" } },
					{ value: "gemini-3.1-pro", label: "Gemini 3.1 Pro", efforts: ["low", "high"], defaultEffort: "high", variantes: { high: "gemini-3.1-pro-high", low: "gemini-3.1-pro-low" } },
					{ value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
					{ value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" }
				]);
			/* Le niveau n'est reconnu que s'il est DANS LES DEUX (identifiant ET
			   libellé) : un `-high` d'identifiant sans « (High) » de libellé n'est
			   pas une variante. */
			r.check("parseAntigravityModels : un suffixe d'identifiant sans le niveau dans le libellé n'est pas une variante",
				providers.parseAntigravityModels("x-high\tX Rapide\nx-low\tX Lent\n"),
				[{ value: "x-high", label: "X Rapide" }, { value: "x-low", label: "X Lent" }]);
			r.check("parseAntigravityModels : rien ne rend rien", providers.parseAntigravityModels(""), []);
			/* Sans lecture : liste vide, et le modèle résolu est la chaîne vide —
			   `--model` sera OMIS, le CLI prend le sien. */
			r.check("sans lecture : liste vide, modèle résolu vide, identifiant tel quel",
				[providers.getAntigravityModels(), providers.resolveAntigravityModel("gemini-3.1-pro"), providers.antigravityModelId("gemini-3.1-pro", "low")], [[], "", "gemini-3.1-pro"]);
			const { journal, hote } = fauxHote({ runs: { "agy models": { code: 0, stdout: sortie } } });
			installHost(hote);
			const change = await providers.refreshAntigravityModels(true);
			r.check("refreshAntigravityModels lance `agy models`, remplit l'instantané et dit que la liste a changé",
				{ change, appel: journal.filter(l => l[0] === "run").map(l => l[1]), n: providers.getAntigravityModels().length },
				{ change: true, appel: ["agy models"], n: 4 });
			r.check("resolveAntigravityModel : la famille persistée si connue, un identifiant de variante persisté AVANT le regroupement ramené à sa famille, sinon le PREMIER de la liste (le plus récent)",
				[providers.resolveAntigravityModel("gemini-3.1-pro"), providers.resolveAntigravityModel("gemini-3.1-pro-low"), providers.resolveAntigravityModel("un-modele-retire"), providers.resolveAntigravityModel("")],
				["gemini-3.1-pro", "gemini-3.1-pro", "gemini-3.8-flash", "gemini-3.8-flash"]);
			/* L'effort d'une famille : ses niveaux seulement (3.1 Pro n'a pas de
			   medium → clampé en dessous), le défaut = la variante citée en
			   premier, et un modèle nu n'en a AUCUN (le bouton disparaît). */
			r.check("getEfforts / getDefaultEffort / resolveEffort sur une famille Antigravity",
				{
					flash: providers.getEfforts("antigravity-cli", "gemini-3.8-flash").map(e => e.value),
					pro: providers.getEfforts("antigravity-cli", "gemini-3.1-pro").map(e => e.value),
					opus: providers.getEfforts("antigravity-cli", "claude-opus-4-6-thinking").map(e => e.value),
					defaut: providers.getDefaultEffort("antigravity-cli", "gemini-3.1-pro"),
					clamp: providers.resolveEffort("antigravity-cli", "medium", "gemini-3.1-pro"),
					inconnu: providers.resolveEffort("antigravity-cli", "ultracode", "gemini-3.8-flash")
				},
				{ flash: ["low", "medium", "high"], pro: ["low", "high"], opus: [], defaut: "high", clamp: "low", inconnu: "high" });
			r.check("antigravityModelId : la variante au niveau demandé, le défaut si le niveau n'existe pas, le modèle nu tel quel",
				[providers.antigravityModelId("gemini-3.8-flash", "low"), providers.antigravityModelId("gemini-3.1-pro", "medium"), providers.antigravityModelId("claude-opus-4-6-thinking", "high")],
				["gemini-3.8-flash-low", "gemini-3.1-pro-high", "claude-opus-4-6-thinking"]);
			r.check("niveauAntigravity : le niveau retenu pour LA famille, clampé à ses niveaux, sinon son défaut ; une famille nue n'en a pas",
				[providers.niveauAntigravity({ "gemini-3.1-pro": "low" }, "gemini-3.1-pro"), providers.niveauAntigravity({ "gemini-3.1-pro": "medium" }, "gemini-3.1-pro"), providers.niveauAntigravity(undefined, "gemini-3.8-flash"), providers.niveauAntigravity({}, "claude-opus-4-6-thinking")],
				["low", "low", "high", ""]);
			/* La sonde de COMPTE est `agy models` : connecté si la liste vient,
			   et elle est gardée au passage. */
			r.check("sondeConnexion(agy) = checkAntigravityLogin : vrai quand `agy models` rend une liste",
				{ ok: await providers.sondeConnexion("agy")(), n: providers.getAntigravityModels().length }, { ok: true, n: 4 });
			installHost(fauxHote({ runs: { "agy models": { code: 1, stdout: "Fetching available models...\nError: Please sign in to view available models." } } }).hote);
			r.check("checkAntigravityLogin : faux sur « Please sign in » (code 1)", await providers.checkAntigravityLogin(), false);
			installHost(hote);
			/* Un échec (compte non connecté : « Please sign in… », code 1) garde
			   l'instantané d'avant et ne dit AUCUN changement. */
			installHost(fauxHote({ runs: { "agy models": { code: 1, stdout: "Fetching available models...\nError: Please sign in to view available models." } } }).hote);
			r.check("un `agy models` en échec garde la liste d'avant et ne dit aucun changement",
				{ change: await providers.refreshAntigravityModels(true), n: providers.getAntigravityModels().length }, { change: false, n: 4 });
		}

		/* ── LE MASQUAGE DES CANAUX PAYANTS (2026-09-22) ──
		   Le réglage `aiCanauxPayantsMasques` vient du disque, d'une version
		   future ou d'un fichier trafiqué : les quatre fonctions pures ne
		   doivent NI lever NI masquer un canal qu'elles ne comprennent pas. Un
		   canal gratuit n'est jamais masqué ; un canal payant se lit à
		   l'ABSENCE de pastille (décision du 2026-09-22, cf. `Canal.gratuit`). */
		{
			installHost(fauxHote().hote);
			r.check("la table des canaux : chaque canal porte un `gratuit` booléen, et les payants sont exactement Claude Code et Codex",
				{
					tous: providers.MARQUES.flatMap(m => m.canaux).every(c => typeof c.gratuit === "boolean"),
					payants: providers.MARQUES.flatMap(m => m.canaux).filter(c => !c.gratuit).map(c => c.id)
				},
				{ tous: true, payants: ["claude-code", "codex"] });
			r.check("canauxMasquesValides : une valeur non-tableau vaut liste vide, une entrée inconnue ou non-chaîne est ignorée",
				{
					non: providers.canauxMasquesValides("codex"),
					inconnu: providers.canauxMasquesValides(["codex", "canal-futur", 42, null]),
					ok: providers.canauxMasquesValides(["claude-code", "codex"])
				},
				{ non: [], inconnu: ["codex"], ok: ["claude-code", "codex"] });
			r.check("canalVisible : un canal GRATUIT jamais masqué, un payant selon le réglage, un canal inconnu visible",
				{
					gratuit: providers.canalVisible("claude-web", ["claude-web"]),
					paye: providers.canalVisible("codex", []),
					payeMasque: providers.canalVisible("codex", ["codex"]),
					inconnu: providers.canalVisible("canal-futur", ["canal-futur"])
				},
				{ gratuit: true, paye: true, payeMasque: false, inconnu: true });
			r.check("premierCanalGratuitVisible : le PREMIER canal gratuit du menu, quoi que porte le réglage",
				[providers.premierCanalGratuitVisible([]), providers.premierCanalGratuitVisible(["claude-code", "codex"]), providers.premierCanalGratuitVisible("codex")],
				["claude-web", "claude-web", "claude-web"]);
			r.check("resoudreApresMasquage : inchangé si visible ou vide, repli sur le premier canal gratuit sinon",
				{
					rien: providers.resoudreApresMasquage("", ["codex"]),
					visible: providers.resoudreApresMasquage("claude-web", ["codex"]),
					repli: providers.resoudreApresMasquage("codex", ["codex"]),
					reste: providers.resoudreApresMasquage("codex", [])
				},
				{ rien: "", visible: "claude-web", repli: "claude-web", reste: "codex" });
		}

		r.done();
	},
);
