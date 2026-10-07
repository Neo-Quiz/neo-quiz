import type { AiSettings } from "../types/dashboard-ctx";
import type { Hotkey } from "../hotkey-format";

/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES IA, VUS DU CLIENT DE GÉNÉRATION

   Même patron que `StatsStoreHost` (`stats-store.ts`), et pour la même
   raison : `createAiClient` prenait un `obsidian.Plugin` entier alors qu'il
   n'en lisait QUE `settings`. C'est ce `Plugin` — un `import type` de trois
   mots — qui gardait `ai-client.ts` dans la liste des fichiers liés à Obsidian
   (`scripts/check-host.mjs`), et il obligeait l'application à fabriquer un
   faux greffon pour obtenir un client.

   `save` n'est appelée par personne AUJOURD'HUI : le client ne fait que LIRE.
   Elle est ici parce que l'hôte est la seule chose que la page « Générer » de
   l'application recevra à la tâche 6, et qu'un composant qui doit demander
   l'écriture à un second objet n'a plus d'hôte, il a deux moitiés d'hôte.
══════════════════════════════════════════════════════════ */

export interface AiSettingsHost {
	/** Les réglages IA courants. Lue À CHAQUE usage, jamais copiée : une
	    génération lit le fournisseur, le modèle et l'effort au moment où elle
	    part, pas à la construction du client. */
	get(): AiSettings;
	/** Fusionne un correctif dans les réglages et les persiste. */
	save(patch: Partial<AiSettings>): Promise<void>;
}

/**
 * LES DÉFAUTS DES RÉGLAGES IA — UNE SEULE LISTE POUR TOUS LES HÔTES.
 *
 * L'application hydrate son cache (`apps/windows/src/main.ts`, clé
 * `CLE_REGLAGES_IA` de `neo.reglages`) avec cette liste, et tout futur hôte
 * (Android) fera de même. Deux listes recopiées
 * divergeraient sans une erreur : un `aiEffort` à « high » d'un côté et à
 * « medium » de l'autre changerait le coût d'une génération selon l'hôte, pour
 * le même réglage affiché.
 *
 * Une FONCTION, pas une constante : `aiUsageLog` et `aiMentionExtraFolders`
 * sont des tableaux, et un tableau partagé par tous les appelants finirait
 * muté par l'un d'eux.
 */
export function aiSettingsDefaults(): Required<Pick<AiSettings,
	"aiProvider" | "aiModel" | "aiEffort" | "aiCodexFast" | "aiAntigravityLevels" | "aiAntigravityModels" | "aiOllamaUrl" | "aiOllamaCloudKey"
	| "aiOllamaModels" | "aiOllamaCatalog" | "aiOllamaPlansAppris" | "aiOllamaPlanCompte"
	| "aiCanauxPayantsMasques" | "aiWebAvertissementMasque" | "aiUsageLog"
	| "aiMentionExtraFolders" | "aiOutputFolder" | "aiComposerDestination">> & { hotkeyAddFiles: Hotkey } {
	return {
		// Aucun fournisseur par défaut : le choix reste la première étape.
		aiProvider: "",
		aiModel: "",
		aiEffort: "high",
		// Mode Fast de Codex (service tier « priority », 1.5x speed) — l'éclair
		// du popover effort ChatGPT. Ignoré si le modèle ne l'expose pas.
		aiCodexFast: false,
		// Rien de retenu par famille Antigravity : chacune part à son niveau par
		// défaut (la variante que `agy models` cite en premier).
		aiAntigravityLevels: {},
		// Aucune liste tant qu'`agy models` n'a pas répondu une première fois.
		aiAntigravityModels: null,
		aiOllamaUrl: "http://localhost:11434",
		aiOllamaCloudKey: "",
		// Modèles Ollama affichés dans le menu (ordre réglable, max 7). null →
		// sélection par défaut (cf. aiProviders.resolveOllamaSelection).
		aiOllamaModels: null,
		// Cache du catalogue cloud récupéré de ollama.com. null → repli embarqué.
		aiOllamaCatalog: null,
		// Rien d'appris tant qu'aucun 402 n'est arrivé ; plan inconnu.
		aiOllamaPlansAppris: {},
		aiOllamaPlanCompte: "",
		// Aucun canal payant masqué d'office : le menu montre tout ce que la
		// table des canaux propose (Réglages de l'application, section
		// « Canaux payants »).
		aiCanauxPayantsMasques: [],
		// Le modal d'avertissement d'un site s'affiche tant qu'on ne l'a pas masqué.
		aiWebAvertissementMasque: [],
		// Journal d'usage : purement informatif, borné à 300 entrées (ai-usage.ts).
		aiUsageLog: [],
		// Ctrl+U, le raccourci de claude.ai, affiché dans le menu « + » (demande
		// du 2026-09-26 ; Ctrl+E depuis le 2026-09-17 jusque-là).
		hotkeyAddFiles: { modifiers: ["Mod"], key: "u" },
		// Vide par défaut : le « @ » se limite au vault tant qu'on n'ajoute rien.
		aiMentionExtraFolders: [],
		// Donnée persistée, donc jamais traduite : les deux hôtes écrivent au même endroit.
		aiOutputFolder: "Generated",
		// The composer's output folder: "" = the default one (aiOutputFolder).
		aiComposerDestination: "",
	};
}

/**
 * The composer's output folder to show and send on arrival: the one the user
 * last chose, if that folder still exists among the offered ones; otherwise
 * "" (the default folder). A folder deleted since, or a value written by hand,
 * falls back to the default instead of writing a quiz into a folder the
 * composer no longer shows.
 *
 * `dossiers` are the contract paths the composer offers as non-default
 * choices (`destinationOptions`, without the default row).
 */
export function destinationMemorisee(persistee: string | undefined, dossiers: readonly string[]): string {
	if (!persistee) return "";
	return dossiers.includes(persistee) ? persistee : "";
}
