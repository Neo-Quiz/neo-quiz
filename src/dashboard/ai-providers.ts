import { currentHost, requireHost } from "../host/current";
import { cleanModels } from "../shared-state/devices";
import { t, currentLang } from "../i18n";
import type { Lang } from "../i18n";
import type { OuvertureWeb } from "./ai-web";
/* PLUS D'IMPORT d'`ai-usage.ts` (tâche 6 de la tranche 5) : ce module lisait
   le forfait Claude par `readClaudePlan`, qui ouvre le trousseau du CLI avec
   `fs` derrière `Platform` d'Obsidian — un import qui faisait entrer Obsidian
   dans le paquet Vite de l'application par ricochet. Le forfait est devenu
   une ENTRÉE de `getClaudeModels` : le greffon le lit et le passe ; l'app,
   qui ne porte pas l'écran d'usage, ne le connaît pas et n'affiche donc pas
   le badge de Fable — un badge absent, jamais un badge deviné. */

/* ══════════════════════════════════════════════════════════
   AI PROVIDERS — Registry central
   Providers, logos de marque (Simple Icons, CC0), modèles
   par défaut et détections de statut. Source unique partagée
   par ai.js (dashboard), ai-client.js et plugin.js (settings).

   I18N — pourquoi des GETTERS dans les tables ci-dessous
   (PROVIDERS.sub, hint/desc/badge des modèles, sub des efforts) :
   ces constantes sont évaluées au CHARGEMENT du module. Un `t()` posé
   directement dedans figerait le libellé dans la langue du démarrage, et
   changer de langue n'aurait plus aucun effet. Un getter traduit à
   l'ACCÈS, donc au rendu — et, contrairement à une fonction, il ne
   change AUCUN appelant (`p.sub` / `m.hint` continuent de marcher tels
   quels, y compris dans plugin.ts et les spreads `{ ...m }`).
══════════════════════════════════════════════════════════ */

/* ── Types partagés ── */

export interface Provider {
	id: string;
	name: string;
	sub: string;
	logo: string;
	/**
	 * La couleur du logo de marque, là où il est montré SEUL et en grand assez
	 * pour la porter — le titre du modal d'installation, aujourd'hui.
	 *
	 * Elle ne vaut pas partout : dans le menu des fournisseurs et dans le pied
	 * du composer, les logos suivent la couleur du texte, parce qu'ils y
	 * voisinent des libellés et des états. Un appelant qui n'en veut pas ne la
	 * lit pas.
	 *
	 * Seul l'orange de Claude est une couleur de MARQUE au sens strict
	 * (Anthropic la publie). ChatGPT et Ollama ont des logos monochromes : le
	 * vert est la couleur historique d'OpenAI, et Ollama garde un blanc cassé
	 * faute de couleur propre. C'est écrit ici pour qu'on ne les prenne pas
	 * un jour pour des valeurs officielles.
	 */
	couleur: string;
	desktopOnly: boolean;
	defaultModel: string;
	defaultEffort: string;
}

/** Niveau d'effort (compatible avec EffortOption d'ui-select). */
export interface EffortDef {
	value: string;
	label: string;
	isDefault?: boolean;
	sub?: string;
	accent?: boolean;
}

/** Modèle Claude/Codex (compatible avec ModelOption d'ui-select). */
export interface ModelDef {
	value: string;
	label: string;
	hint?: string;
	desc?: string;
	badge?: string;
	efforts?: string[];
	defaultEffort?: string;
	fast?: boolean;
	/** Antigravity : l'identifiant que le CLI attend pour CHAQUE niveau
	    (`{ high: "gemini-3.8-flash-high", … }`), la famille seule étant
	    `value`. Absent quand le modèle n'a qu'un niveau. */
	variantes?: Record<string, string>;
	/** Visible mais pas sélectionnable (un modèle à crédits d'utilisation). */
	disabled?: boolean;
	/** Infobulle de l'icône d'info du badge. */
	tooltip?: string;
}

/** Entrée de catalogue Ollama (tag + libellé). */
export interface OllamaCatalogEntry {
	value: string;
	label: string;
}

/** Métadonnées résolues d'un modèle Ollama. */
export interface OllamaModelMeta {
	value: string;
	label: string;
	cloud: boolean;
	thinking: boolean;
}

/** Modèle local détecté par /api/tags. */
export interface OllamaDetectedModel {
	name: string;
	size?: number;
	capabilities?: string[];
}

export type ClaudeCodeStatus = { ok: true; version: string } | { ok: false; reason: string };
export type CodexStatus = ClaudeCodeStatus;
export type OllamaStatus =
	| { ok: true; models: OllamaDetectedModel[]; version?: string }
	| { ok: false; reason: string };
export interface OllamaInstalledStatus {
	installed: boolean;
}

/* ── Logos de marque (Simple Icons, viewBox 24×24, fill) ── */
/* LE LOGO DE GEMINI EST LE SEUL EN COULEURS, et c'est une demande d'Ahmed
   (2026-09-20) : les cinq autres sont des aplats qui prennent la couleur du
   texte, celui-ci porte les siennes. C'est la forme OFFICIELLE de l'étincelle
   Google — un bleu de fond et trois dégradés (vert, rouge, jaune) posés
   par-dessus le MÊME tracé, quatre fois. Le tracé est donc sorti dans une
   constante plutôt que recopié : quatre copies auraient divergé à la première
   retouche.

   LES IDENTIFIANTS DE DÉGRADÉ SONT RÉÉCRITS À CHAQUE POSE (`setBrandLogo`).
   Un `id` est global au document : le même logo posé dans le menu, dans le
   composer et dans la tuile d'un quiz en poserait trois fois les mêmes, et le
   jour où le premier des trois disparaît de l'arbre, les deux autres perdent
   leurs dégradés et ne gardent que le bleu — un logo à moitié peint, sans une
   erreur nulle part. */
const TRACE_GEMINI = "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z";

const BRAND_LOGOS: Record<string, string> = {
	/* Claude Code, le « M » pixelisé de l'invite, EN COULEURS (Anthropic,
	   #D97757) — à la demande d'Ahmed (2026-09-21), comme Gemini, Mistral et
	   Antigravity les seuls de la table à porter les leurs. SVG passé par
	   Ahmed lui-même ; aucun `id`, rien à réécrire à la pose. */
	claudecode: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path clip-rule="evenodd" fill="#D97757" fill-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"/></svg>',
	/* Codex, la fleur en dégradé violet → bleu avec le prompt blanc `>_` DEDANS — image passée par Ahmed (2026-09-21, génération d'image, fond transparent natif), qui remplace le SVG de @lobehub : sur ce SVG, le `>_` était un TROU dans le glyph, qui ne se voyait blanc que par-dessus sa tuile blanche — retirée, il montrait le fond sombre de l'interface. Redimensionnée en 96 px et inline en data URI (~8 Ko) : les logos de la table sont des chaînes posées par `setBrandLogo`, qui ne connaît que du markup. */
	codex: '<img src="data:image/png;base64,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" alt="" draggable="false">',
	/* La baleine de DeepSeek, telle que Simple Icons 16.31 la publie (CC0,
	   source deepseek.com), récupérée le 2026-09-20. */
	deepseek: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="' + "M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" + '"/></svg>',
	/* Le logo officiel de Mistral EN COULEURS — demande d'Ahmed (2026-09-21),
	   comme Gemini le seul de la table à porter les siennes : le pixel-art
	   « M » de mistral.ai, dix rectangles dans la rampe jaune → rouge de la
	   marque (#ffd800, #ffaf00, #ff8205, #fa500f, #e10500). C'est le fichier
	   « Mistral AI logo (2025–).svg » de Wikimedia Commons, tel quel —
	   rectanges pleins sans `id`, rien à réécrire à la pose. */
	mistral: '<svg viewBox="0 0 129 91" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="18.292" y="0" width="18.293" height="18.123" fill="#ffd800"/><rect x="91.473" y="0" width="18.293" height="18.123" fill="#ffd800"/><rect x="18.292" y="18.121" width="36.586" height="18.123" fill="#ffaf00"/><rect x="73.181" y="18.121" width="36.586" height="18.123" fill="#ffaf00"/><rect x="18.292" y="36.243" width="91.476" height="18.122" fill="#ff8205"/><rect x="18.292" y="54.37" width="18.293" height="18.123" fill="#fa500f"/><rect x="54.883" y="54.37" width="18.293" height="18.123" fill="#fa500f"/><rect x="91.473" y="54.37" width="18.293" height="18.123" fill="#fa500f"/><rect x="0" y="72.504" width="54.89" height="18.123" fill="#e10500"/><rect x="73.181" y="72.504" width="54.89" height="18.123" fill="#e10500"/></svg>',
	claude: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>',
	ollama: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z"/></svg>',
	perplexity: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"/></svg>',
	openai: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5962 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
	/* Antigravity CLI, le canal CLI de la marque Gemini : son propre logo, à la
	   demande d'Ahmed (2026-09-20) — « le logo officiel, trouvable sur
	   Wikipedia ». C'est l'icône découpée du fichier `Google Antigravity
	   Logo.svg` de Wikimedia Commons (le mot-symbole en moins) : le tracé du
	   « A » sert de MASQUE à des taches floutées jaune, rouge, verte et bleue,
	   d'où onze filtres et un masque dans un logo. Rendu vérifié à 15, 24, 64
	   et 160 px, sur fond sombre et clair. Ses identifiants sont préfixés
	   `nq-` et réécrits à chaque pose, comme ceux de Gemini : un masque partagé
	   entre trois copies disparaîtrait avec la première. */
	antigravity: '<svg viewBox="9.5 11 92 92" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g><path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="#3186FF"></path><mask id="nq-antigravity-m" maskUnits="userSpaceOnUse" x="13" y="18" width="85" height="78" mask-type="alpha"><path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="black"></path></mask><g mask="url(#nq-antigravity-m)"><g filter="url(#nq-antigravity-f0)"><ellipse cx="22.7873" cy="26.8098" rx="22.7873" ry="26.8098" transform="matrix(-0.112784 0.99362 -0.99362 -0.112781 66.2473 -15.5344)" fill="#FFE432"></ellipse></g><g filter="url(#nq-antigravity-f1)"><ellipse cx="96.491" cy="35.1231" rx="29.5007" ry="30.1492" transform="rotate(76.9243 96.491 35.1231)" fill="#FC413D"></ellipse></g><g filter="url(#nq-antigravity-f2)"><ellipse cx="9.02988" cy="41.6647" rx="30.832" ry="39.9417" transform="rotate(74.1257 9.02988 41.6647)" fill="#00B95C"></ellipse></g><g filter="url(#nq-antigravity-f3)"><ellipse cx="9.02988" cy="41.6647" rx="30.832" ry="39.9417" transform="rotate(74.1257 9.02988 41.6647)" fill="#00B95C"></ellipse></g><g filter="url(#nq-antigravity-f4)"><ellipse cx="11.2212" cy="42.8915" rx="30.22" ry="33.2695" transform="rotate(45.6065 11.2212 42.8915)" fill="#00B95C"></ellipse></g><g filter="url(#nq-antigravity-f5)"><ellipse cx="75.7546" cy="104.822" rx="29.0177" ry="27.943" transform="rotate(76.9243 75.7546 104.822)" fill="#3186FF"></ellipse></g><g filter="url(#nq-antigravity-f6)"><ellipse cx="33.5661" cy="35.4043" rx="33.5661" ry="35.4043" transform="matrix(-0.409539 0.912293 -0.912294 -0.409537 101.25 -15.1674)" fill="#FBBC04"></ellipse></g><g filter="url(#nq-antigravity-f7)"><path d="M2.56802 149.695C-15.8116 142.48 15.5987 83.1163 23.4093 63.2203C31.22 43.3244 52.4514 33.0447 70.831 40.26C89.2107 47.4753 110.996 87.2162 103.185 107.112C95.3742 127.008 20.9477 156.91 2.56802 149.695Z" fill="#3186FF"></path></g><g filter="url(#nq-antigravity-f8)"><path d="M113.934 75.8079C109.013 81.5509 96.1724 78.6224 85.253 69.2667C74.3335 59.911 69.4704 47.6711 74.391 41.928C79.3116 36.185 92.1525 39.1136 103.072 48.4692C113.991 57.8249 118.855 70.0648 113.934 75.8079Z" fill="#749BFF"></path></g><g filter="url(#nq-antigravity-f9)"><ellipse cx="92.611" cy="23.7962" rx="44.2411" ry="27.5016" transform="rotate(34.0763 92.611 23.7962)" fill="#FC413D"></ellipse></g><g filter="url(#nq-antigravity-f10)"><ellipse cx="23.4949" cy="29.5887" rx="23.7071" ry="13.7869" transform="rotate(112.516 23.4949 29.5887)" fill="#FFEE48"></ellipse></g></g></g><defs><filter id="nq-antigravity-f0" x="2.49348" y="-26.5423" width="69.0899" height="61.2525" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="3.89034" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f1" x="28.7524" y="-32.0333" width="135.477" height="134.313" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="18.8078" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f2" x="-62.2884" y="-21.9253" width="142.637" height="127.18" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="15.9884" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f3" x="-62.2884" y="-21.9253" width="142.637" height="127.18" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="15.9884" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f4" x="-52.5697" y="-20.8346" width="127.582" height="127.452" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="15.9884" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f5" x="17.3619" y="45.4646" width="116.786" height="118.715" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="15.1937" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f6" x="-7.44765" y="-60.4737" width="125.303" height="122.858" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="13.7698" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f7" x="-27.7086" y="13.3597" width="157.119" height="162.029" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="12.297" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f8" x="50.4638" y="16.981" width="87.3973" height="83.7738" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="11.0036" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f9" x="34.2604" y="-28.457" width="116.701" height="104.506" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="9.29385" result="flou"></feGaussianBlur></filter><filter id="nq-antigravity-f10" x="-15.1522" y="-15.9493" width="77.2941" height="91.076" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur stdDeviation="11.5027" result="flou"></feGaussianBlur></filter></defs></svg>',
	gemini: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
		+ '<path fill="#3186FF" d="' + TRACE_GEMINI + '"/>'
		+ '<path fill="url(#nq-gemini-0)" d="' + TRACE_GEMINI + '"/>'
		+ '<path fill="url(#nq-gemini-1)" d="' + TRACE_GEMINI + '"/>'
		+ '<path fill="url(#nq-gemini-2)" d="' + TRACE_GEMINI + '"/>'
		+ '<defs>'
		+ '<linearGradient gradientUnits="userSpaceOnUse" id="nq-gemini-0" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient>'
		+ '<linearGradient gradientUnits="userSpaceOnUse" id="nq-gemini-1" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient>'
		+ '<linearGradient gradientUnits="userSpaceOnUse" id="nq-gemini-2" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient>'
		+ '</defs></svg>',
};

/* Injecte le logo de marque inline dans un élément. */
let poseLogo = 0;

export function setBrandLogo(el: HTMLElement, logoKey: string): void {
	const svg = BRAND_LOGOS[logoKey];
	if (!svg) return;
	/* `nq-` est le préfixe des identifiants internes d'un logo (les dégradés de
	   Gemini). Chaque pose reçoit les siens : voir le commentaire de
	   `TRACE_GEMINI` pour ce que coûtait le partage. Les logos sans `id` ne
	   sont pas touchés — le remplacement ne trouve rien. */
	el.innerHTML = svg.includes("nq-") ? svg.replace(/nq-/g, "nq" + (++poseLogo) + "-") : svg;
}

/* ── Registry des providers ── */
export const PROVIDERS: Provider[] = [
	{
		id: "claude-code",
		name: "Claude",
		get sub() { return t("ai.provider.claudeSub"); },
		logo: "claude",
		couleur: "#D97757",
		desktopOnly: true,
		defaultModel: "opus",
		defaultEffort: "high"
	},
	{
		id: "codex",
		name: "ChatGPT",
		// « Codex CLI » explicite : l'application de bureau Codex ne
		// fournit PAS la commande « codex » — la confusion fait installer
		// le mauvais outil (vécu Ahmed 2026-07-12).
		get sub() { return t("ai.provider.codexSub"); },
		logo: "openai",
		couleur: "#10A37F",
		desktopOnly: true,
		defaultModel: "gpt-5.6-terra",
		defaultEffort: "medium"
	},
	{
		id: "ollama",
		name: "Ollama",
		get sub() { return t("ai.provider.ollamaSub"); },
		logo: "ollama",
		couleur: "#E7E9EE",
		desktopOnly: false,
		/* VIDE, comme les CLI : un modèle codé ici posait « glm-5.3:cloud »,
		   hors plan sur un compte gratuit, dès qu'on choisissait Ollama (vu le
		   2026-09-20). Le composer choisit et PERSISTE le premier modèle
		   utilisable (`choisirOllamaParDefaut`) : un local installé, sinon le
		   premier qui n'est pas hors plan. */
		defaultModel: "",
		defaultEffort: "high"
	},
	/* ── Les canaux WEB ──
	   Un site n'a ni CLI à installer ni serveur à joindre : il n'a donc ni
	   version à détecter ni modèle à choisir (c'est le site qui décide, avec
	   le compte de l'utilisateur). `defaultModel` reste VIDE pour cette
	   raison — un modèle codé ici serait un mensonge que l'écran répéterait.
	   Ils sont dans PROVIDERS parce que `aiProvider` porte le CANAL, pas la
	   marque : c'est `MARQUES` plus bas qui les regroupe pour le menu. */
	{
		id: "claude-web",
		name: "claude.ai",
		get sub() { return t("ai.channel.webSub"); },
		logo: "claude",
		couleur: "#D97757",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	},
	{
		id: "chatgpt-web",
		name: "chatgpt.com",
		get sub() { return t("ai.channel.webSub"); },
		logo: "openai",
		couleur: "#10A37F",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	},
	{
		id: "antigravity-cli",
		name: "Gemini",
		get sub() { return t("ai.provider.antigravitySub"); },
		/* Le logo du CANAL, pas de la marque : l'entrée d'un fournisseur porte
		   son propre logo, et c'est lui que le composer et la tuile « généré
		   par » montrent. La ligne « Gemini » du menu, elle, garde l'étincelle. */
		logo: "antigravity",
		couleur: "#8E75B2",
		desktopOnly: true,
		/* VIDE : le modèle vient de `agy models` (`getAntigravityModels`), et
		   tant que la liste n'a pas été lue, `--model` est omis — le CLI prend
		   le sien. Jamais un nom codé ici. */
		defaultModel: "",
		/* L'effort par modèle vient d'`agy models` aussi (`efforts` de chaque
		   famille, cf. `parseAntigravityModels`) : rien à écrire ici. */
		defaultEffort: ""
	},
	{
		id: "gemini-web",
		name: "gemini.google.com",
		get sub() { return t("ai.channel.webSub"); },
		logo: "gemini",
		couleur: "#8E75B2",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	},
	{
		id: "deepseek-web",
		name: "chat.deepseek.com",
		get sub() { return t("ai.channel.webSub"); },
		logo: "deepseek",
		// Le bleu publié par DeepSeek (Simple Icons 16.31, CC0).
		couleur: "#5786FE",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	},
	{
		id: "mistral-web",
		name: "chat.mistral.ai",
		get sub() { return t("ai.channel.webSub"); },
		logo: "mistral",
		// L'orange publié par Mistral (Simple Icons, CC0).
		couleur: "#FA520F",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	},
	{
		id: "perplexity-web",
		name: "perplexity.ai",
		get sub() { return t("ai.channel.webSub"); },
		logo: "perplexity",
		// Le turquoise publié par Perplexity (Simple Icons, CC0).
		couleur: "#1FB8CD",
		desktopOnly: false,
		defaultModel: "",
		defaultEffort: ""
	}
];

export function getProvider(id: string): Provider {
	return PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
}

/* ── Marques et canaux ──────────────────────────────────────
   Une MARQUE (Claude, ChatGPT, Perplexity, Ollama) est ce que l'utilisateur
   nomme ; un CANAL est la voie par laquelle on lui parle. Claude en a deux
   (le CLI sur la machine, le site dans le navigateur), Perplexity et Ollama
   un seul. Le réglage `aiProvider` porte l'identifiant du CANAL, jamais
   celui de la marque : c'est lui qui décide ce que fait le bouton d'envoi,
   et deux canaux de la même marque ne se comportent pas pareil.
   Les libellés sont des GETTERS pour la même raison que `Provider.sub` :
   traduits à l'accès, donc au rendu. ── */

export type TypeCanal = "cli" | "web" | "serveur";

export interface Canal {
	/** L'identifiant porté par `aiProvider` (et donc par `PROVIDERS`). */
	id: string;
	label: string;
	sub: string;
	type: TypeCanal;
	/** Comment ouvrir le site avec la question déjà écrite. ABSENT : le canal
	    n'est pas câblé, le bouton le dit (« aperçu du design »). Posé quand le
	    site a été MESURÉ : claude.ai le 2026-09-18 (`/new?q=` préremplit sans
	    envoyer), chatgpt.com le 2026-09-19 (`/?prompt=` préremplit sans
	    envoyer ; `?q=`, lui, envoie tout de suite — d'où le paramètre `prompt`
	    et non `q`), perplexity.ai le 2026-09-20 (`?qfill=` remplit le composer,
	    nettoie l'adresse et n'envoie rien, là où `?q=` et `search?q=` partent
	    IMMÉDIATEMENT, sans laisser joindre un fichier). */
	web?: OuvertureWeb;
	/** Le site affiche un bandeau d'avertissement au-dessus d'une question
	    arrivée par l'adresse (claude.ai, mesuré le 2026-09-18). La page ouvre
	    alors un modal qui le montre et l'explique au CHOIX du canal, une fois,
	    tant que l'utilisateur ne l'a pas masqué. ABSENT sur chatgpt.com :
	    mesuré le 2026-09-19, aucun bandeau n'y apparaît — annoncer un
	    avertissement qui n'existe pas apprendrait à l'ignorer. */
	avertissement?: true;
	/** Le logo PROPRE au canal, quand l'outil a sa marque à lui (Claude Code,
	    Codex, Antigravity) : la ligne du flyout le montre à la place de celui
	    de la marque, à la demande d'Ahmed (2026-09-21) — la ligne web, elle,
	    garde le logo de marque déjà présent. ABSENT : la marque suffit. */
	logo?: string;
	/** Vrai quand un compte GRATUIT suffit pour générer un quiz par CE canal ;
	    faux quand il exige un abonnement payant (Claude Code → abonnement
	    Claude, Codex CLI → abonnement ChatGPT). AUCUN montant, AUCUN quota,
	    AUCUNE mention de tarif étudiant : ces valeurs vieilliraient en
	    silence dans le code, c'est précisément ce que ce booléen évite.
	    Établi le 2026-09-22 ; ce qui le rendrait FAUX : une marque qui ouvre
	    ou ferme l'accès gratuit à l'un de ses canaux.
	    OBLIGATOIRE, sans défaut implicite : le menu ne montre une pastille
	    QUE sur les canaux gratuits (§ « une pastille, sur les gratuits »),
	    donc un statut payant se lit par l'ABSENCE de pastille — un champ
	    oublié passerait pour payant sans qu'un mot ne le dise si TypeScript
	    ne forçait pas chaque canal à le déclarer explicitement. */
	gratuit: boolean;
}

export interface Marque {
	id: string;
	name: string;
	logo: string;
	/** Au moins un. Deux ou plus → le menu ouvre un second niveau. */
	canaux: Canal[];
	/** SECONDAIRE : rangée sous « Plus de fournisseurs » et non dans le menu,
	    qui ne montre que les trois assistants que tout le monde a — cinq
	    lignes le faisaient trop grand (2026-09-20). Ollama, Perplexity et
	    DeepSeek sont derrière la ligne. */
	secondaire?: true;
}

/* L'ORDRE DES CANAUX D'UNE MARQUE : LE SITE D'ABORD, LE CLI ENSUITE (demande
   d'Ahmed, 2026-09-20). Le site marche tout de suite, pour tout le monde, sans
   rien installer ; le CLI demande une installation, un compte connecté, et
   parfois Node. Le sous-menu propose donc d'abord ce qui est à portée. */
export const MARQUES: Marque[] = [
	{
		id: "claude",
		name: "Claude",
		logo: "claude",
		canaux: [
			{ id: "claude-web", label: "claude.ai", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://claude.ai/new", parametre: "q", urlMax: 63000 }, avertissement: true, gratuit: true },
			{ id: "claude-code", label: "Claude Code", sub: "Claude Code", type: "cli", logo: "claudecode", gratuit: false }
		]
	},
	{
		id: "chatgpt",
		name: "ChatGPT",
		logo: "openai",
		canaux: [
			{ id: "chatgpt-web", label: "chatgpt.com", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://chatgpt.com/", parametre: "prompt", urlMax: 59000 }, gratuit: true },
			{ id: "codex", label: "Codex CLI", sub: "Codex", type: "cli", logo: "codex", gratuit: false }
		]
	},
	{
		id: "gemini",
		name: "Gemini",
		logo: "gemini",
		canaux: [
			/* SANS `parametre` : aucun ne préremplit son composer (mesuré le
			   2026-09-20 — `?q=` et `?text=` sont ignorés, et le code de la page,
			   compilé par Google, ne livre rien de lisible, là où perplexity.ai
			   donnait `qfill`). Le texte part donc toujours par le presse-papier,
			   et la modale d'attente le dit ; `urlMax` ne sert alors à rien, mais
			   le contrat le veut. */
			{ id: "gemini-web", label: "gemini.google.com", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://gemini.google.com/app", urlMax: 0 }, gratuit: true },
			/* Antigravity CLI est GRATUIT (un simple compte Google) : établi
			   2026-09-22, ce qui le rendrait faux est le même que pour tout
			   autre canal — Google fermant son accès gratuit à Antigravity. */
			{ id: "antigravity-cli", label: "Antigravity CLI", sub: "Antigravity", type: "cli", logo: "antigravity", gratuit: true }
		]
	},
	{
		id: "perplexity",
		name: "Perplexity",
		logo: "perplexity",
		secondaire: true,
		canaux: [
			{ id: "perplexity-web", label: "perplexity.ai", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://www.perplexity.ai/", parametre: "qfill", urlMax: 63000 }, gratuit: true }
		]
	},
	{
		id: "ollama",
		name: "Ollama",
		logo: "ollama",
		secondaire: true,
		canaux: [
			/* Le SERVEUR est gratuit (local) ; le mode CLOUD est un modèle payant
			   choisi DANS ce même canal (voir `resolveOllamaSelection` /
			   `aiOllamaCloudKey`), pas une ligne distincte du menu — il n'y a donc
			   rien d'autre à marquer ici tant que le menu n'a pas de ligne à lui. */
			{ id: "ollama", label: "Ollama", get sub() { return t("ai.provider.ollamaSub"); }, type: "serveur", gratuit: true }
		]
	},
	/* DEEPSEEK, retenu le 2026-09-20 : parmi les assistants candidats, c'est
	   celui dont l'usage a été constaté chez les étudiants visés ; d'autres
	   ont été écartés faute d'usage constaté. SANS `parametre` : rien n'a été
	   mesuré sur chat.deepseek.com — le presse-papier d'office, comme
	   gemini.google.com, jusqu'à ce qu'un préremplissage soit trouvé. */
	{
		id: "deepseek",
		name: "DeepSeek",
		logo: "deepseek",
		secondaire: true,
		canaux: [
			{ id: "deepseek-web", label: "chat.deepseek.com", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://chat.deepseek.com/", urlMax: 0 }, gratuit: true }
		]
	},
	/* MISTRAL, retenu le 2026-09-21. Le motif n'est PAS un usage constaté
	   comme pour DeepSeek, et c'est à dire tel quel : c'est le seul assistant
	   à proposer un tarif étudiant vérifié en France (forfait « Education »,
	   7,19 € par mois contre environ 15 € pour Pro, sur adresse
	   d'établissement, douze mois au maximum et réservé à qui n'a jamais
	   utilisé Le Chat), et son niveau gratuit suffit pour générer un quiz.
	   Qwen, Kimi et Z.ai ont été écartés le même jour, faute d'usage constaté
	   — même règle que celle qui avait écarté les candidats de DeepSeek.
	   SANS `parametre`, et c'est un choix : aucun préremplissage n'a été
	   mesuré sur chat.mistral.ai (le site exige une session, la mesure n'a
	   pas pu être faite ce jour-là) — le presse-papier d'office, comme
	   deepseek-web et gemini-web, jusqu'à ce qu'un paramètre soit MESURÉ. */
	{
		id: "mistral",
		name: "Mistral",
		logo: "mistral",
		secondaire: true,
		canaux: [
			{ id: "mistral-web", label: "chat.mistral.ai", get sub() { return t("ai.channel.webSub"); }, type: "web", web: { nouvelle: "https://chat.mistral.ai/chat", urlMax: 0 }, gratuit: true }
		]
	}
];

/** La marque qui porte ce canal, ou `undefined` si l'identifiant est inconnu
    (un réglage écrit par une version future, ou vidé). */
export function getMarque(canalId: string): Marque | undefined {
	return MARQUES.find(m => m.canaux.some(c => c.id === canalId));
}

/** Le canal lui-même, pour son libellé et son type. */
export function getCanal(canalId: string): Canal | undefined {
	for (const m of MARQUES) {
		const c = m.canaux.find(x => x.id === canalId);
		if (c) return c;
	}
	return undefined;
}

/** Vrai quand la génération passe par un SITE, donc par le navigateur de
    l'utilisateur et non par un processus que l'application lance. */
export function estCanalWeb(canalId: string): boolean {
	return getCanal(canalId)?.type === "web";
}

/** Vrai quand le site sait s'ouvrir avec la question : `web` est posé. */
export function estCanalCable(canalId: string): boolean {
	return !!getCanal(canalId)?.web;
}

/* ── Masquage des canaux payants (réglage `aiCanauxPayantsMasques`, à la
   carte : un canal payant à la fois, jamais une case unique) ──

   Le réglage porte les identifiants des canaux PAYANTS que l'utilisateur a
   choisi de masquer du menu. DÉFAUT : liste vide, rien de masqué — personne
   ne doit voir un fournisseur disparaître sans l'avoir demandé. Ces trois
   fonctions sont PURES et prennent le réglage BRUT (`unknown`) : il vient du
   disque, d'une version future du format, ou d'un fichier trafiqué à la
   main, et rien ici ne doit lever ni faire échouer le rendu du menu pour
   une valeur douteuse. ── */

/** Normalise un réglage `aiCanauxPayantsMasques` venu du disque en liste
    d'identifiants de canaux CONNUS : une valeur qui n'est pas un tableau
    devient une liste vide, une entrée qui n'est pas une chaîne ou qui ne
    nomme aucun canal de `MARQUES` est ignorée — jamais une exception. */
export function canauxMasquesValides(brut: unknown): string[] {
	if (!Array.isArray(brut)) return [];
	return brut.filter((v): v is string => typeof v === "string" && !!getCanal(v));
}

/** Vrai quand CE canal reste utilisable compte tenu du masquage : un canal
    GRATUIT n'est jamais masqué quoi que porte le réglage (seuls des canaux
    payants s'y ajoutent, depuis l'interface) ; un canal inconnu n'est pas
    davantage masqué, il n'y a rien à bloquer sur un identifiant qu'on ne
    comprend pas. */
export function canalVisible(canalId: string, masquesBruts: unknown): boolean {
	const canal = getCanal(canalId);
	if (!canal || canal.gratuit) return true;
	return !canauxMasquesValides(masquesBruts).includes(canalId);
}

/** Le premier canal GRATUIT et visible, dans l'ordre du menu (les marques de
    `MARQUES`, puis leurs canaux, dans cet ordre). C'est celui sur lequel un
    fournisseur démasqué retombe. `undefined` seulement si plus aucun canal
    gratuit n'existe — n'arrive pas avec la table actuelle (chaque marque
    garde un canal gratuit), mais reste un cas normal, pas une exception. */
export function premierCanalGratuitVisible(masquesBruts: unknown): string | undefined {
	for (const m of MARQUES) {
		for (const c of m.canaux) {
			if (c.gratuit && canalVisible(c.id, masquesBruts)) return c.id;
		}
	}
	return undefined;
}

/** Le fournisseur à retenir APRÈS un changement de masquage : inchangé s'il
    reste visible (ou si rien n'était sélectionné), sinon le premier canal
    gratuit disponible — jamais laissé sur un canal devenu invisible, ce qui
    ferait échouer la génération sans qu'aucun message ne l'explique. */
export function resoudreApresMasquage(providerActuel: string, masquesBruts: unknown): string {
	if (!providerActuel || canalVisible(providerActuel, masquesBruts)) return providerActuel;
	return premierCanalGratuitVisible(masquesBruts) ?? providerActuel;
}

/* ── Modèles par provider ── */
/* Mêmes noms que le sélecteur /model de Claude Code ; les values sont les
   alias CLI, qui désignent « le DERNIER modèle » de leur famille (`claude
   --help` : « Provide an alias for the latest model (e.g. 'fable', 'opus',
   or 'sonnet') »). Un alias ne change donc jamais, mais le modèle derrière
   lui — et son numéro de version — change à chaque sortie : ces libellés ne
   sont qu'un DERNIER RECOURS, périmé par construction (relevé le 2026-07-30).
   Le libellé réellement affiché est appris de ce que le CLI a servi, cf.
   learnedClaudeLabels() plus bas. */
export const CLAUDE_CODE_MODELS: ModelDef[] = [
	// Pas de `badge` ici : l'accès à Fable dépend du FORFAIT (inclus sur Max,
	// crédits d'usage sur Pro) — getClaudeModels() le pose au rendu.
	{ value: "fable", label: "Fable 5", get hint() { return t("ai.modelHint.mostPowerful"); }, get desc() { return t("ai.modelDesc.fable"); } },
	{ value: "opus", label: "Opus 5", get hint() { return t("ai.modelHint.recommended"); }, get desc() { return t("ai.modelDesc.opus"); } },
	{ value: "sonnet", label: "Sonnet 5", get hint() { return t("ai.modelHint.everyday"); }, get desc() { return t("ai.modelDesc.sonnet"); } },
	{ value: "haiku", label: "Haiku 4.5", get hint() { return t("ai.modelHint.fastest"); }, get desc() { return t("ai.modelDesc.haiku"); } }
];

/* Niveaux d'effort (façon sélecteur claude.ai). Décoratif/persisté
   pour l'instant : le CLI `claude -p` n'expose pas de flag d'effort
   vérifié — voir ai-client.js. Défaut : max. */
// Niveaux d'effort de Claude Code (picker /effort), du plus faible au plus
// élevé — l'ordre du tableau = ordre d'affichage haut→bas, donc le plus
// élevé (ultracode) tout en bas. ultracode a une couleur dédiée (violet).
/* ── LES MODÈLES D'ANTIGRAVITY : `agy models`, jamais une liste écrite ici ──
   Le CLI rend une ligne par modèle, « id<TAB>libellé » (mesuré le 2026-09-20,
   `agy` 1.2.7 : « gemini-3.8-flash-high<TAB>Gemini 3.8 Flash (High) », quatorze
   entrées, Gemini, Claude et GPT-OSS selon le forfait du compte). La liste
   suit donc le COMPTE et le jour, sans mise à jour de l'application — c'est
   la règle « jamais de modèle codé en dur », tenue ici par construction.
   Le niveau de raisonnement est DANS le nom (`…-high`, `…-low`) : le CLI
   rend « Gemini 3.8 Flash (High) », « (Medium) », « (Low) » comme trois
   modèles. Une liste de quatorze lignes pour cinq familles était illisible
   (Ahmed, 2026-09-20) : les variantes d'une même famille sont REGROUPÉES en
   un modèle dont `efforts` porte les niveaux, réglés par le bouton d'effort
   comme pour Claude Code — et `variantes` retient l'identifiant à passer au
   CLI pour chacun. Instantané en mémoire, relu au plus toutes les six heures
   (le CLI interroge le réseau pour répondre), ou à la demande. */
const ANTIGRAVITY_MODELS_TTL = 6 * 60 * 60 * 1000;
let antigravityModelsSnapshot: { at: number; models: ModelDef[] } | null = null;
let antigravityRefreshEnCours: Promise<boolean> | null = null;

/* Les niveaux qu'Antigravity met dans ses noms de modèles, du plus faible au
   plus élevé (ordre d'affichage du slider). Un modèle n'expose que les siens
   (`efforts`) : Gemini 3.1 Pro n'a pas de « medium ». */
export const ANTIGRAVITY_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high", isDefault: true }
];

/** PURE : le texte d'`agy models` en liste, une entrée par FAMILLE. Une ligne
    sans tabulation (le « Fetching available models... » de tête, une ligne
    vide) est ignorée ; un identifiant qui ne ressemble pas à un nom de modèle
    aussi — c'est ce qui part ensuite en argument `--model`. Une ligne dont
    l'identifiant finit par `-low|-medium|-high` ET dont le libellé finit par
    « (Low|Medium|High) » est une variante de sa famille ; dès que la famille
    en a deux, elles deviennent un seul modèle à `efforts`, l'effort par
    défaut étant la variante que le CLI cite en premier. Une famille à une
    seule variante reste un modèle nu, son niveau dans le nom : un bouton
    d'effort à un cran n'aurait rien à régler. */
export function parseAntigravityModels(stdout: string): ModelDef[] {
	interface Ligne { value: string; label: string; famille: string; familleLabel: string; niveau: string | null }
	const lignes: Ligne[] = [];
	for (const ligne of String(stdout || "").split(/\r?\n/)) {
		const i = ligne.indexOf("\t");
		if (i <= 0) continue;
		const value = ligne.slice(0, i).trim();
		const label = ligne.slice(i + 1).trim() || value;
		if (!/^[a-zA-Z0-9._:-]+$/.test(value)) continue;
		if (lignes.some(l => l.value === value)) continue;
		const mId = /^(.+)-(low|medium|high)$/.exec(value);
		const mLabel = /^(.+?)\s*\((low|medium|high)\)$/i.exec(label);
		const niveau = (mId && mLabel && mId[2] === mLabel[2].toLowerCase()) ? mId[2] : null;
		lignes.push({
			value, label, niveau,
			famille: niveau && mId ? mId[1] : value,
			familleLabel: niveau && mLabel ? mLabel[1] : label
		});
	}
	const modeles: ModelDef[] = [];
	for (const l of lignes) {
		if (modeles.some(m => m.value === l.famille)) continue;
		const variantes = l.niveau ? lignes.filter(x => x.niveau && x.famille === l.famille) : [];
		if (variantes.length < 2) {
			modeles.push({ value: l.value, label: l.label });
			continue;
		}
		const parNiveau: Record<string, string> = {};
		for (const v of variantes) parNiveau[v.niveau as string] = v.value;
		modeles.push({
			value: l.famille,
			label: l.familleLabel,
			efforts: ANTIGRAVITY_EFFORTS.map(e => e.value).filter(e => e in parNiveau),
			defaultEffort: variantes[0].niveau as string,
			variantes: parNiveau
		});
	}
	return modeles;
}

/** La liste connue, SYNCHRONE : celle du dernier `refreshAntigravityModels`,
    vide tant qu'aucun n'a abouti. Le composer la redessine quand le
    rafraîchissement dit qu'elle a changé. */
export function getAntigravityModels(): ModelDef[] {
	return antigravityModelsSnapshot ? antigravityModelsSnapshot.models : [];
}

/** SÈME l'instantané avec la liste gardée dans les réglages au lancement
    précédent : le composer affiche un modèle tout de suite au lieu de
    « modèle du CLI » pendant la seconde que prend `agy models`. Datée de
    zéro, elle est PÉRIMÉE d'office : le prochain rafraîchissement relit le
    CLI. Sans effet si une lecture a déjà eu lieu. */
export function seedAntigravityModels(models: ModelDef[]): void {
	if (antigravityModelsSnapshot || !models.length) return;
	antigravityModelsSnapshot = { at: 0, models };
}

/** Relit `agy models` si l'instantané est absent ou périmé (ou `force`), et dit
    si la liste a CHANGÉ. Tout échec (CLI absent, compte non connecté — il
    répond « Please sign in to view available models ») garde l'instantané
    d'avant et rend `false` : la page n'a rien à redessiner. */
export function refreshAntigravityModels(force?: boolean): Promise<boolean> {
	if (antigravityRefreshEnCours) return antigravityRefreshEnCours;
	if (!force && antigravityModelsSnapshot && Date.now() - antigravityModelsSnapshot.at < ANTIGRAVITY_MODELS_TTL) return Promise.resolve(false);
	if (!currentHost().platform.isDesktopApp) return Promise.resolve(false);
	antigravityRefreshEnCours = requireHost("process")
		.run({ tool: "agy", args: ["models"], stdin: "", timeoutMs: 20000 })
		.then(res => {
			if (res.code !== 0) return false;
			const modeles = parseAntigravityModels(res.stdout);
			if (modeles.length === 0) return false;
			const avant = getAntigravityModels().map(m => m.value).join("\n");
			antigravityModelsSnapshot = { at: Date.now(), models: modeles };
			return avant !== modeles.map(m => m.value).join("\n");
		})
		.catch(() => false)
		.finally(() => { antigravityRefreshEnCours = null; });
	return antigravityRefreshEnCours;
}

/** Le modèle (la FAMILLE) retenu : la valeur persistée si la liste la
    connaît — y compris un identifiant de variante persisté avant le
    regroupement (`gemini-3.8-flash-high` → `gemini-3.8-flash`) —, sinon le
    PREMIER de la liste (le CLI la rend du plus récent au plus ancien), sinon
    la chaîne vide — `--model` est alors omis. */
export function resolveAntigravityModel(value?: string): string {
	const modeles = getAntigravityModels();
	if (value) {
		if (modeles.some(m => m.value === value)) return value;
		const famille = modeles.find(m => m.variantes && Object.values(m.variantes).includes(value));
		if (famille) return famille.value;
	}
	return modeles.length ? modeles[0].value : "";
}

/** Le niveau EN USAGE d'une famille : celui retenu pour ELLE (réglage
    `aiAntigravityLevels`), clampé à ses niveaux, sinon son défaut. C'est ce
    que sa ligne affiche en gris, et ce qui part avec elle. */
export function niveauAntigravity(memoire: Record<string, string> | undefined, famille: string): string {
	return resolveEffort("antigravity-cli", memoire ? memoire[famille] : undefined, famille);
}

/** L'identifiant à passer à `agy --model` : la variante de la famille au
    niveau demandé (sinon au niveau par défaut), ou le modèle tel quel s'il
    n'a pas de variantes. */
export function antigravityModelId(famille: string, effort: string): string {
	const m = getAntigravityModels().find(x => x.value === famille);
	if (!m || !m.variantes) return famille;
	return m.variantes[effort] || (m.defaultEffort && m.variantes[m.defaultEffort]) || famille;
}

export const CLAUDE_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high", isDefault: true },
	{ value: "xhigh", label: "xhigh" },
	{ value: "max", label: "max" },
	{ value: "ultracode", label: "ultracode", get sub() { return t("ai.effort.ultracodeSub"); }, accent: true }
];

/* ── Modèles Codex (ChatGPT) ──
   Liste DYNAMIQUE : lue depuis ~/.codex/models_cache.json, que le CLI Codex
   rafraîchit lui-même depuis le compte OpenAI (visibility "list" = picker
   /model, priority = ordre du picker, "hide" exclut codex-auto-review).
   Le tableau ci-dessous n'est qu'un repli embarqué (cache absent/illisible,
   mobile) et la source des labels/hints/descriptions FR curés. */
/* `efforts`/`defaultEffort` = supported_reasoning_levels/default_reasoning_level
   du cache Codex (répliqués ici pour que le repli hors-ligne ait le même
   comportement de clamp que la liste dynamique). `fast` = le modèle expose le
   service tier « priority » (Fast, 1.5x speed) — tous sauf gpt-5.4-mini. */
export const CODEX_FALLBACK_MODELS: ModelDef[] = [
	{ value: "gpt-5.6-sol", label: "GPT-5.6 Sol", get hint() { return t("ai.modelHint.mostPowerful"); }, get desc() { return t("ai.modelDesc.codexSol"); }, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low", fast: true },
	{ value: "gpt-5.6-terra", label: "GPT-5.6 Terra", get hint() { return t("ai.modelHint.recommended"); }, get desc() { return t("ai.modelDesc.codexTerra"); }, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.6-luna", label: "GPT-5.6 Luna", get hint() { return t("ai.modelHint.fast"); }, get desc() { return t("ai.modelDesc.codexLuna"); }, efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.5", label: "GPT-5.5", get hint() { return t("ai.modelHint.frontier"); }, get desc() { return t("ai.modelDesc.codex55"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.4", label: "GPT-5.4", get hint() { return t("ai.modelHint.solid"); }, get desc() { return t("ai.modelDesc.codex54"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.4-mini", label: "GPT-5.4 Mini", get hint() { return t("ai.modelHint.light"); }, get desc() { return t("ai.modelDesc.codex54mini"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: false }
];

/* Traductions FR des descriptions du cache Codex. Le cache est ANGLAIS : en
   anglais on affiche donc la description d'origine telle quelle (aucune table
   à consulter), et cette table ne sert qu'à la langue française. Un nouveau
   modèle dont la description est inconnue garde sa description d'origine. */
const CODEX_DESC_FR: Record<string, string> = {
	"Latest frontier agentic coding model.": "Dernier modèle frontière pour le code agentique",
	"Balanced agentic coding model for everyday work.": "Équilibré pour le travail quotidien",
	"Fast and affordable agentic coding model.": "Rapide et économique",
	"Frontier model for complex coding, research, and real-world work.": "Pour le code complexe et la recherche",
	"Strong model for everyday coding.": "Solide pour le code au quotidien",
	"Small, fast, and cost-efficient model for simpler coding tasks.": "Léger et rapide pour les tâches simples"
};

/* Forme (partielle) d'une entrée de ~/.codex/models_cache.json. */
interface CodexCacheModel {
	slug?: string;
	visibility?: string;
	priority?: number;
	display_name?: string;
	description?: string;
	supported_reasoning_levels?: Array<{ effort?: string } | null>;
	default_reasoning_level?: string;
	additional_speed_tiers?: string[];
	service_tiers?: Array<{ id?: string } | null>;
}
interface CodexCacheFile {
	models?: CodexCacheModel[];
}

/* ── Les fichiers des CLI : un INSTANTANÉ, rempli par `refreshCliCaches` ──
   `getCodexModels` et `readClaudeCliInfo` sont SYNCHRONES et appelés en plein
   rendu (menu de modèles, onglet de réglages, juste avant un appel du CLI).
   Or la lecture d'un fichier hors de toute racine (`~/.codex/models_cache.json`,
   `~/.claude.json`) passe désormais par `host.process.lireCache`, qui est
   ASYNCHRONE — dans l'application, elle traverse l'IPC jusqu'au processus
   principal, seul à toucher le disque. Les deux lecteurs lisent donc un
   instantané de module, et c'est `refreshCliCaches()` qui le remplit : à
   attendre à chaque ENTRÉE d'affichage ou d'appel (l'onglet de réglages, le
   rendu du composer, la génération), pas partout. Avant le premier
   rafraîchissement, ou sans fichier, ils rendent le repli embarqué — exactement
   ce que l'ancien `try/catch` rendait sur un `fs` absent. */
let codexCacheSnapshot: { mtimeMs: number; json: unknown } | null = null;
let claudeCacheSnapshot: { mtimeMs: number; json: unknown; catalogue?: unknown } | null = null;
/* Un rafraîchissement EN VOL est partagé : le composer et le menu fournisseur
   se rendent souvent dans le même tick, et deux lectures de `~/.claude.json`
   (plusieurs centaines de Ko) pour un même instantané seraient du gaspillage. */
let refreshEnCours: Promise<boolean> | null = null;

/** Relit les deux fichiers de CLI par l'hôte. Ne rejette jamais : un cache
    illisible vaut « pas de cache », et les lecteurs synchrones retombent sur
    le repli embarqué.

    REND `true` QUAND L'INSTANTANÉ A CHANGÉ, et ce booléen n'est pas une
    commodité : un appelant qui a DÉJÀ dessiné sa liste (l'onglet de réglages,
    l'étiquette du bouton modèle) doit se redessiner une fois le premier
    instantané arrivé, et il ne peut le faire qu'à cette condition — se
    redessiner inconditionnellement rappellerait `refreshCliCaches`, qui
    rappellerait le rendu, sans fin. */
export function refreshCliCaches(): Promise<boolean> {
	if (refreshEnCours) return refreshEnCours;
	refreshEnCours = (async () => {
		const host = requireHost("process");
		const [codex, claude] = await Promise.all([
			host.lireCache("codex").catch(() => null),
			host.lireCache("claude").catch(() => null),
		]);
		/* Le `mtime` SUFFIT à dire le changement : c'est déjà la clé sur
		   laquelle `getCodexModels` et `readClaudeCliInfo` décident de
		   re-parser. `null` (pas de fichier) est comparé comme tel. */
		const cle = (s: { mtimeMs: number } | null): number => (s ? s.mtimeMs : -1);
		const change = cle(codex) !== cle(codexCacheSnapshot) || signatureClaude(claude) !== signatureClaude(claudeCacheSnapshot);
		codexCacheSnapshot = codex;
		claudeCacheSnapshot = claude;
		return change;
	})().finally(() => { refreshEnCours = null; });
	return refreshEnCours;
}

/* LA LISTE EN DIRECT (2026-09-23) : quand l'hôte surveille les fichiers de
   modèles des CLI (`HostProcess.surCachesCli`), chaque réécriture relit
   l'instantané, et `rappel` part s'il a changé — le bouton du modèle se
   redessine sans attendre un clic. UN SEUL abonné à la fois : le contrôle de
   modèle affiché ; le suivant remplace le précédent, sans quoi chaque
   rendu du composer empilerait un écouteur. Un rafraîchissement EN VOL a pu
   lire l'ancien fichier : on l'attend, puis on relit. */
let desabonnerCaches: (() => void) | null = null;
export function suivreModelesCli(rappel: () => void): void {
	desabonnerCaches?.();
	desabonnerCaches = null;
	const sur = requireHost("process").surCachesCli;
	if (!sur) return;
	desabonnerCaches = sur(() => {
		void (async () => {
			if (refreshEnCours) await refreshEnCours;
			if (await refreshCliCaches()) rappel();
		})();
	});
}

/* Modèles Codex réels : ~/.codex/models_cache.json (ou $CODEX_HOME), reparsé
   uniquement quand le fichier change (mtime) — donc toujours à jour après un
   « codex update » ou l'arrivée d'un nouveau modèle, sans re-parse inutile.
   Les slugs connus gardent leur entrée FR curée ; les inconnus reçoivent un
   label dérivé du display_name (« GPT-5.7-Nova » → « GPT-5.7 Nova ») et la
   description du cache (traduite si connue). Ordre = priority du cache. */
/* Le cache porte la LANGUE en plus du mtime : les libellés sont recopiés en
   dur dans `models` (Object.assign fige la valeur des getters), donc un
   changement de langue doit invalider le cache — sans ça, la liste Codex
   resterait dans la langue du dernier parse. */
let codexModelsCache: { mtimeMs: number; lang: Lang; models: ModelDef[] } | null = null;

export function getCodexModels(): ModelDef[] {
	const lang = currentLang();
	const snapshot = codexCacheSnapshot;
	if (!snapshot) return CODEX_FALLBACK_MODELS;
	try {
		const { mtimeMs } = snapshot;
		if (codexModelsCache && codexModelsCache.mtimeMs === mtimeMs && codexModelsCache.lang === lang) {
			return codexModelsCache.models;
		}
		// Un JSON qui n'est pas un objet (`null`, un tableau) n'a pas de
		// `models` : même issue qu'un fichier illisible, le repli.
		const data = (snapshot.json && typeof snapshot.json === "object" ? snapshot.json : {}) as CodexCacheFile;
		const models: ModelDef[] = (data.models || [])
			.filter(m => m && m.slug && m.visibility === "list")
			.sort((a, b) => (a.priority || 0) - (b.priority || 0))
			.map((m): ModelDef => {
				const curated = CODEX_FALLBACK_MODELS.find(f => f.value === m.slug);
				const base: ModelDef = curated || {
					value: m.slug as string,
					label: String(m.display_name || m.slug).replace(/(\d)-(?=[A-Za-z])/g, "$1 "),
					// Le cache Codex est en anglais : en anglais, la description
					// d'origine est déjà la bonne — la table FR ne sert qu'au français.
					desc: (lang === "fr" ? CODEX_DESC_FR[m.description || ""] : "") || m.description || ""
				};
				// Efforts supportés + effort par défaut + tier Fast : toujours ceux
				// du cache (source de vérité, prime sur le repli curé — un modèle
				// peut gagner/perdre un niveau côté OpenAI sans mise à jour du plugin).
				const efforts = (m.supported_reasoning_levels || [])
					.map(l => l && l.effort)
					.filter((e): e is string => !!e);
				const fast = (m.additional_speed_tiers || []).includes("fast")
					|| (m.service_tiers || []).some(t => t !== null && t !== undefined && t.id === "priority");
				return Object.assign({}, base,
					efforts.length ? { efforts } : {},
					m.default_reasoning_level ? { defaultEffort: m.default_reasoning_level } : {},
					{ fast }) as ModelDef;
			});
		if (!models.length) return CODEX_FALLBACK_MODELS;
		codexModelsCache = { mtimeMs, lang, models };
		return models;
	} catch (e) {
		// forme inattendue du cache → repli embarqué
		return CODEX_FALLBACK_MODELS;
	}
}

/* Modèle Codex effectif : si le modèle persisté n'existe plus dans le cache
   (slug retiré, bascule de provider), retombe sur le défaut du provider,
   sinon sur le premier modèle du picker (priority 1). */
export function resolveCodexModel(value?: string): string {
	const models = getCodexModels();
	if (models.some(m => m.value === value)) return value as string;
	const def = getProvider("codex").defaultModel;
	return models.some(m => m.value === def) ? def : models[0].value;
}

/* Niveaux de reasoning effort de Codex (`model_reasoning_effort`), du plus
   faible au plus élevé — xhigh tout en bas. Contrairement à Claude Code, cet
   effort est RÉEL : passé au CLI via `-c model_reasoning_effort=…`. Défaut
   Codex : medium. */
export const CODEX_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium", isDefault: true },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
	{ value: "max", label: "max" },
	{ value: "ultra", label: "ultra", get sub() { return t("ai.effort.ultraSub"); }, accent: true }
];

/* Niveaux d'effort d'Ollama. Effort RÉEL : passé à l'API /api/chat via le
   champ `think`, qui accepte exactement ces 4 niveaux (doc API Ollama : « Can
   be a boolean or a thinking level "low"/"medium"/"high"/"max" »). Ne
   s'applique qu'aux modèles à capability « thinking » (sinon la ligne Effort
   est masquée). Défaut : medium. */
export const OLLAMA_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high", isDefault: true },
	{ value: "max", label: "max" }
];

/* Tableau d'efforts d'un provider (Claude Code, Codex ou Ollama).
   Codex : si `modelValue` est fourni, filtré aux niveaux réellement supportés
   par CE modèle (supported_reasoning_levels du cache — gpt-5.5 s'arrête à
   xhigh, luna à max, sol/terra vont jusqu'à ultra). */
export function getEfforts(providerId: string, modelValue?: string): EffortDef[] {
	if (providerId === "codex") {
		if (modelValue) {
			const m = getCodexModels().find(x => x.value === modelValue);
			if (m && Array.isArray(m.efforts) && m.efforts.length) {
				const allowed = m.efforts;
				const filtered = CODEX_EFFORTS.filter(e => allowed.includes(e.value));
				if (filtered.length) return filtered;
			}
		}
		return CODEX_EFFORTS;
	}
	if (providerId === "ollama") return OLLAMA_EFFORTS;
	/* Antigravity : les niveaux de CETTE famille (lus sur `agy models`) ; un
	   modèle sans variantes n'en a AUCUN — le bouton d'effort disparaît. */
	if (providerId === "antigravity-cli") {
		if (!modelValue) return ANTIGRAVITY_EFFORTS;
		const m = getAntigravityModels().find(x => x.value === modelValue);
		const allowed = (m && m.efforts) || [];
		return ANTIGRAVITY_EFFORTS.filter(e => allowed.includes(e.value));
	}
	return CLAUDE_EFFORTS;
}

/* Effort par défaut d'un provider (celui marqué isDefault, sinon le premier).
   Codex + modèle : le default_reasoning_level du cache prime (sol → low) ;
   Antigravity + famille : la variante que le CLI cite en premier. */
export function getDefaultEffort(providerId: string, modelValue?: string): string {
	const efforts = getEfforts(providerId, modelValue);
	if ((providerId === "codex" || providerId === "antigravity-cli") && modelValue) {
		const liste = providerId === "codex" ? getCodexModels() : getAntigravityModels();
		const m = liste.find(x => x.value === modelValue);
		if (m && m.defaultEffort && efforts.some(e => e.value === m.defaultEffort)) return m.defaultEffort;
	}
	const def = efforts.find(e => e.isDefault);
	return (def || efforts[0])?.value ?? "";
}

/* Renvoie value si c'est un effort valide pour le provider (et le modèle le
   cas échéant). Sinon : niveau connu du provider mais pas de CE modèle
   (ex. ultra sur gpt-5.5) → clamp au niveau supporté le plus proche EN
   DESSOUS — le réglage persisté n'est pas réécrit, revenir à un modèle qui
   le supporte le restaure. Valeur inconnue → défaut. */
export function resolveEffort(providerId: string, value?: string, modelValue?: string): string {
	const efforts = getEfforts(providerId, modelValue);
	if (efforts.some(e => e.value === value)) return value as string;
	const all = getEfforts(providerId);
	const idx = all.findIndex(e => e.value === value);
	for (let i = idx - 1; i >= 0; i--) {
		if (efforts.some(e => e.value === all[i].value)) return all[i].value;
	}
	return getDefaultEffort(providerId, modelValue);
}

export function getEffortLabel(value: string | undefined, providerId: string): string {
	const efforts = getEfforts(providerId);
	const e = efforts.find(x => x.value === value);
	if (e) return e.label;
	const def = efforts.find(x => x.isDefault) || efforts[0];
	return def ? def.label : "";
}

/* ── Fable 5 : disponibilité et MODE D'ACCÈS, lus des sources qui les tiennent ──
   Fable 5 n'est PLUS une promo datée. Vérifié le 2026-08-29 sur
   support.claude.com/en/articles/15424964 (« Claude Fable 5 on your plan »,
   modifié le 2026-07-20) : depuis le 2026-07-20, Fable 5 fait partie STANDARD
   des forfaits Max et des sièges premium Team/Enterprise (il puise dans les
   limites hebdomadaires, plus vite que les autres modèles) ; sur Pro et les
   sièges standard, il tourne aux CRÉDITS D'USAGE dès le premier message.
   Le plugin ne date donc plus rien : il lit (1) si le CLI propose Fable
   (`additionalModelOptionsCache`, ex. { value: "claude-fable-5[1m]", … }),
   (2) le forfait local (cf. fableAccessBadge), et en déduit le libellé.

   CE QUI A ÉTÉ RETIRÉ, ET POURQUOI : la date de fin de promo était extraite de
   `cachedGrowthBookFeatures.tengu_startup_announcements` (« Extended through
   July 19 »). Le CLI ne publie plus cette annonce — la promo est devenue
   permanente — donc le badge retombait en silence sur un « Inclus » nu, faux
   pour un forfait Pro. Les promos VIVANTES du CLI vivent maintenant dans
   `tengu_rate_limit_promo_notices` ([{ bar, text, variant }], ex. « +50% weekly
   limits promo through Aug 31 ») : elles ne parlent pas de Fable mais des
   limites hebdomadaires, et sont affichées TELLES QUELLES sur la jauge qu'elles
   désignent (cf. usage-modal) — datées par leur émetteur, jamais par nous.

   Lecture par l'HÔTE (`host.process.lireCache`, le seul à toucher le disque),
   puis un instantané de module que `refreshCliCaches` remplit — le parse n'est
   refait que quand le `mtime` change. Fallback prudent si illisible, absent ou
   pas encore lu : Fable masqué, aucune note promo. */

/** Note promo publiée par le CLI Claude Code, rattachée à UNE jauge d'usage.
    `bar` est la clé d'API de la fenêtre (« five_hour », « seven_day »…), pas
    un libellé. Le texte est affiché tel quel, jamais traduit ni reformulé :
    c'est une annonce commerciale qui porte sa propre date de péremption. */
export interface ClaudePromoNotice { bar: string; text: string }

/** Ce que ~/.claude.json apprend en UNE lecture : Fable proposé ?, le nom des
    modèles réellement servis, et les notes promo en cours. Même fichier, même
    instantané — une seule lecture pour les trois usages. */
type ClaudeCliInfo = {
	fableOffered: boolean;
	labels: Record<string, string>;
	promos: ClaudePromoNotice[];
};
/* Clé = le `mtime` de l'instantané, et PLUS DE TTL : l'ancien TTL de 60 s
   protégeait de RELIRE le fichier à chaque rendu ; la lecture vit désormais
   dans `refreshCliCaches`, et seul le PARSE reste ici — à ne refaire que quand
   le fichier a changé, ce que le `mtime` dit exactement. */
let claudeCliCache: { signature: string; info: ClaudeCliInfo } | null = null;

/* Ce qui fait changer l'instantané Claude : le `mtime` de `~/.claude.json`,
   MAIS AUSSI la date de téléchargement du catalogue de modèles, qui change
   sans que ce fichier bouge. Une clé sur le seul `mtime` garderait une liste
   périmée. */
function signatureClaude(s: { mtimeMs: number; catalogue?: unknown } | null): string {
	if (!s) return "";
	const fetchedAt = (s.catalogue as { fetchedAt?: unknown } | null | undefined)?.fetchedAt;
	return s.mtimeMs + "|" + (typeof fetchedAt === "number" ? fetchedAt : "");
}

/* Repli neuf à chaque appel : l'objet est stocké dans le cache et rendu aux
   appelants, une constante partagée serait modifiable de l'extérieur. */
function emptyCliInfo(): ClaudeCliInfo {
	return { fableOffered: false, labels: {}, promos: [] };
}

/* Une entrée `additionalModelOptionsCache` désigne-t-elle Fable ? */
function cacheEntryIsFable(entry: unknown): boolean {
	if (!entry || typeof entry !== "object") return false;
	const value = (entry as { value?: unknown }).value;
	return typeof value === "string" && value.toLowerCase().includes("fable");
}

/* Notes promo du CLI → on ne garde que ce qu'on affiche (la jauge visée et le
   texte), et seulement si les deux sont des chaînes utiles. Forme inattendue :
   aucune note, jamais d'exception. */
function promoNoticesFrom(raw: unknown): ClaudePromoNotice[] {
	if (!Array.isArray(raw)) return [];
	const out: ClaudePromoNotice[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const { bar, text } = entry as { bar?: unknown; text?: unknown };
		if (typeof bar === "string" && bar && typeof text === "string" && text.trim()) {
			out.push({ bar, text: text.trim() });
		}
	}
	return out;
}

/** Le forfait Claude tel que l'appelant le connaît — `readClaudePlan()`
    d'`ai-usage.ts` sous le greffon, rien dans l'application. Seul `name`
    (« Max », « Pro ») décide du badge. */
export type ClaudePlanHint = { name: string } | null | undefined;

/* Badge d'accès à Fable, déduit du FORFAIT local (~/.claude/.credentials.json,
   lu par ai-usage et PASSÉ ici — on ne rouvre pas une seconde source). Max →
   inclus ; Pro → crédits d'usage. Team/Enterprise dépendent du SIÈGE (premium
   ou standard), que le trousseau ne dit pas : aucun badge plutôt qu'un badge
   faux. */
function fableAccessBadge(plan: ClaudePlanHint): string | undefined {
	const nom = plan?.name.toLowerCase();
	if (nom === "max") return t("ai.badge.included");
	if (nom === "pro") return t("ai.badge.usageCredits");
	return undefined;
}

/* ── Libellés de modèles APPRIS (« Opus 5 », pas « Opus 4.8 ») ──
   Un alias (`opus`) pointe toujours vers le dernier modèle de sa famille : le
   NUMÉRO affiché à côté périme donc tout seul, sans que rien ne change dans le
   plugin (vécu le 2026-07-30 : Opus 5 sorti, menu bloqué sur « Opus 4.8 »).
   Le CLI, lui, enregistre dans ~/.claude.json ce qu'il a RÉELLEMENT consommé
   (`projects[*].lastModelUsage`, clés « claude-opus-5 », « claude-haiku-4-5-
   20251001 »…). On en déduit, par famille, la version la plus haute déjà vue —
   une donnée mesurée, jamais devinée. Un modèle jamais utilisé garde le
   libellé de repli, qui reste le seul endroit à corriger à la main. */

/** Version d'un identifiant de modèle, en segments comparables :
    « claude-opus-4-7 » → [4, 7] ; « claude-haiku-4-5-20251001 » → [4, 5]
    (le suffixe de date, 8 chiffres, n'est pas un numéro de version). */
function modelVersionParts(segments: string[]): number[] {
	return segments
		.filter(s => /^\d+$/.test(s) && s.length < 8)
		.map(s => parseInt(s, 10));
}

/** a est-il une version STRICTEMENT plus récente que b ? ([5] > [4, 7]). */
function isNewerVersion(a: number[], b: number[]): boolean {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0, y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

/** « claude-opus-5[1m] » → { family: "opus", version: [5] }. null pour tout ce
    qui n'est pas un modèle Claude first-party (Ollama, alias inconnus). */
function parseClaudeModelId(id: string): { family: string; version: number[] } | null {
	// Le suffixe de contexte étendu ([1m]) qualifie la fenêtre, pas le modèle.
	const bare = id.replace(/\[[^\]]*\]\s*$/, "").trim().toLowerCase();
	const segments = bare.split("-");
	if (segments.shift() !== "claude") return null;
	const family = segments.shift();
	if (!family || !/^[a-z]+$/.test(family)) return null;
	const version = modelVersionParts(segments);
	return version.length ? { family, version } : null;
}

/** Les identifiants de `projects[*].lastModelUsage` — la DERNIÈRE session de
    chaque projet seulement, écrite à sa fermeture : une source qui RETARDE. */
function idsFromModelUsage(projects: unknown): string[] {
	if (!projects || typeof projects !== "object") return [];
	const ids: string[] = [];
	for (const project of Object.values(projects as Record<string, unknown>)) {
		const usage = (project as { lastModelUsage?: unknown } | null)?.lastModelUsage;
		if (usage && typeof usage === "object") ids.push(...Object.keys(usage as Record<string, unknown>));
	}
	return ids;
}

/** Les identifiants que le CLI PROPOSE (`additionalModelOptionsCache`,
    « claude-fable-5-1[1m] ») : la version de Fable y est à jour avant même
    qu'on l'ait utilisé. */
function idsFromOptionsCache(cache: unknown): string[] {
	const entries = Array.isArray(cache) ? cache : [cache];
	return entries
		.map(e => (e && typeof e === "object" ? (e as { value?: unknown }).value : undefined))
		.filter((v): v is string => typeof v === "string");
}

/** Libellés par famille, à partir des identifiants de DEUX sources de repli
    (dernière session par projet, offre du CLI) quand le catalogue manque :
    la version la plus HAUTE gagne (« opus » → « Opus 5.5 »). Table vide si
    rien n'est connu : on n'invente aucun numéro. */
function labelsFromIds(ids: string[]): Record<string, string> {
	const best = new Map<string, number[]>();
	for (const id of ids) {
		const parsed = parseClaudeModelId(id);
		if (!parsed) continue;
		const known = best.get(parsed.family);
		if (!known || isNewerVersion(parsed.version, known)) best.set(parsed.family, parsed.version);
	}
	const labels: Record<string, string> = {};
	for (const [family, version] of best) labels[family] = libelleFamille(family, version);
	return labels;
}

/** « opus », [5, 5] → « Opus 5.5 » : la forme des noms du catalogue. */
function libelleFamille(family: string, version: number[]): string {
	return family.charAt(0).toUpperCase() + family.slice(1) + " " + version.join(".");
}

/* Lit l'instantané de ~/.claude.json : Fable proposé ? + libellés de modèles
   appris + notes promo en cours. UNE lecture pour les trois usages.
   Pas de garde `isDesktopApp` ici : c'est l'HÔTE qui sait s'il a un CLI
   (`lireCache` rend `null` sous Obsidian mobile), et la redemander ici
   ferait deux endroits pour une seule question. */
function readClaudeCliInfo(): ClaudeCliInfo {
	const snapshot = claudeCacheSnapshot;
	if (!snapshot) return emptyCliInfo();
	if (claudeCliCache && claudeCliCache.signature === signatureClaude(snapshot)) {
		return claudeCliCache.info;
	}
	let info = emptyCliInfo();
	try {
		// Un JSON qui n'est pas un objet (`null`, un tableau) n'a aucune de ces
		// clés : même issue qu'un fichier illisible, le repli.
		const cfg = (snapshot.json && typeof snapshot.json === "object" ? snapshot.json : {}) as {
			additionalModelOptionsCache?: unknown;
			cachedGrowthBookFeatures?: { tengu_rate_limit_promo_notices?: unknown };
			projects?: unknown;
		};
		const cache = cfg.additionalModelOptionsCache;
		info = {
			fableOffered: Array.isArray(cache) ? cache.some(cacheEntryIsFable) : cacheEntryIsFable(cache),
			labels: labelsFromIds([
				...idsFromModelUsage(cfg.projects),
				...idsFromOptionsCache(cache),
			]),
			promos: promoNoticesFrom(cfg.cachedGrowthBookFeatures?.tengu_rate_limit_promo_notices)
		};
	} catch {
		info = emptyCliInfo(); // forme inattendue → repli
	}
	claudeCliCache = { signature: signatureClaude(snapshot), info };
	return info;
}

/* Fable est-il actuellement proposé par le CLI Claude Code ? */
export function isFableOffered(): boolean {
	return readClaudeCliInfo().fableOffered;
}

/** Notes promo que le CLI rattache à la jauge d'usage `bar` (clé d'API de la
    fenêtre : « five_hour », « seven_day »…). Vide si le CLI n'en publie pas. */
export function claudePromoNoticesFor(bar: string): ClaudePromoNotice[] {
	return readClaudeCliInfo().promos.filter(n => n.bar === bar);
}

/* ── LE CATALOGUE DE CLAUDE CODE : la source de vérité ──
   `~/.claude/cache/model-catalog/<organisation>-…-cc.json`, téléchargé par le
   CLI lui-même depuis Anthropic et relu par l'hôte (`lireCache`). C'est
   l'équivalent du `models_cache.json` de Codex : nom affiché (« Opus 5.5 »),
   description, badge, section. Les deux autres sources (`lastModelUsage`,
   `additionalModelOptionsCache`) ne servent plus qu'en REPLI, quand aucun
   catalogue n'est lisible (CLI ancien, jamais lancé) — `lastModelUsage` a
   figé le menu sur « Opus 5 » pendant des heures le 2026-09-23. */

/** Un modèle du catalogue, réduit à ce que le menu affiche. `credits` : le
    catalogue le marque « Requires usage credits » (badge serveur, en anglais,
    lu avant toute traduction). */
interface CatalogueModele {
	def: ModelDef;
	section: "main" | "overflow";
	famille: string | null;
	version: number[] | null;
	credits: boolean;
}

/** Les modèles du catalogue, dans son ordre. `null` si le catalogue est
    absent ou n'a pas la forme attendue — jamais d'exception. L'identifiant
    part tel quel en `--model` : il est donc filtré (lettres, chiffres, point,
    tiret, deux-points), la même règle que l'appel du CLI (`ai-client.ts`). */
function modelesDuCatalogue(catalogue: unknown): CatalogueModele[] | null {
	const modeles = (catalogue as { catalog?: { config?: { models?: unknown } } } | null | undefined)?.catalog?.config?.models;
	if (!Array.isArray(modeles)) return null;
	const out: CatalogueModele[] = [];
	for (const m of modeles) {
		if (!m || typeof m !== "object") continue;
		const e = m as { id?: unknown; name?: unknown; description?: unknown; section?: unknown; badge?: { message?: unknown }; tooltip?: { content?: unknown } };
		if (typeof e.id !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(e.id)) continue;
		if (typeof e.name !== "string" || !e.name.trim()) continue;
		const parse = parseClaudeModelId(e.id);
		const famille = parse?.family ?? null;
		/* La description et le badge du serveur sont en anglais : gardés en
		   anglais, remplacés par la traduction de la FAMILLE (et du badge de
		   crédits) dans une autre langue. */
		const descFamille = famille ? CLAUDE_CODE_MODELS.find(x => x.value === famille)?.desc : undefined;
		const descServeur = typeof e.description === "string" && e.description.trim() ? e.description : undefined;
		const badgeServeur = typeof e.badge?.message === "string" && e.badge.message.trim() ? e.badge.message : undefined;
		const bulleServeur = typeof e.tooltip?.content === "string" && e.tooltip.content.trim() ? e.tooltip.content : undefined;
		const anglais = currentLang() === "en";
		out.push({
			def: {
				value: e.id,
				label: e.name,
				desc: anglais ? (descServeur ?? descFamille) : (descFamille ?? descServeur),
				badge: anglais ? badgeServeur : (badgeServeur ? t("ai.badge.usageCredits") : undefined),
				tooltip: anglais ? bulleServeur : (bulleServeur ? t("ai.badge.usageCreditsTip", { model: e.name }) : undefined),
			},
			section: e.section === "overflow" ? "overflow" : "main",
			famille,
			version: parse?.version ?? null,
			credits: !!badgeServeur && /credit/i.test(badgeServeur),
		});
	}
	return out.length ? out : null;
}

function catalogueCourant(): CatalogueModele[] | null {
	return modelesDuCatalogue(claudeCacheSnapshot?.catalogue);
}

/** Le nom LISIBLE d'un modèle, celui du menu des modèles (« Sonnet 5 », pas
    « claude-sonnet-5 ») : lu dans le catalogue du fournisseur, jamais écrit
    ici. Pour un modèle Claude que le catalogue ne nomme pas (catalogue pas
    encore lu dans cette session, modèle retiré depuis), le nom se DÉDUIT de
    l'identifiant, comme les libellés appris. Un fournisseur ou un modèle
    inconnus rendent l'identifiant tel quel. */
export function libelleModele(providerId: string, model: string): string {
	if (providerId === "claude-code") {
		const connu = catalogueCourant()?.find(m => m.def.value === model);
		if (connu) return connu.def.label;
		const parse = parseClaudeModelId(model);
		if (parse) return libelleFamille(parse.family, parse.version);
		// Un ALIAS (« sonnet ») : la famille seule, sans numéro inventé.
		return CLAUDE_CODE_MODELS.some(m => m.value === model) ? model.charAt(0).toUpperCase() + model.slice(1) : model;
	}
	if (providerId === "codex") return getCodexModels().find(m => m.value === model)?.label ?? model;
	if (providerId === "antigravity-cli") {
		// L'identifiant d'une VARIANTE (« …-high ») nomme sa famille regroupée.
		return getAntigravityModels().find(m => m.value === model || Object.values(m.variantes ?? {}).includes(model))?.label ?? model;
	}
	if (providerId === "ollama") return getOllamaModelMeta(model).label;
	return model;
}

/* Liste des modèles Claude visibles maintenant. Avec un catalogue : sa section
   `main`, rangée par `menuDuCatalogue` (un modèle par famille, les modèles à
   crédits grisés en tête). Sans catalogue (repli) : les alias embarqués, libellés à jour de ce
   que le CLI a servi, et Fable inclus seulement s'il est proposé, avec le
   badge qui correspond au forfait détecté (« Inclus » sur Max, « Crédits
   d'usage » sur Pro, aucun quand le forfait ne tranche pas). `plan` : voir
   `ClaudePlanHint` ; un appelant qui ne connaît pas le forfait (résolution
   d'un modèle, l'app) l'omet. */
export function getClaudeModels(plan?: ClaudePlanHint): ModelDef[] {
	const catalogue = catalogueCourant();
	if (catalogue) return menuDuCatalogue(catalogue, plan).main;
	const { fableOffered, labels } = readClaudeCliInfo();
	/* Sur Pro, Fable passe par des crédits d'utilisation : visible, pas
	   sélectionnable (personne ne paie des crédits pour générer un quiz). */
	const surCredits = plan?.name.toLowerCase() === "pro";
	const models = fableOffered
		? CLAUDE_CODE_MODELS.map(m => m.value === "fable" ? { ...m, badge: fableAccessBadge(plan), disabled: surCredits || undefined } : m)
		: CLAUDE_CODE_MODELS.filter(m => m.value !== "fable");
	// L'alias EST le nom de famille (« opus ») : un libellé appris le remplace.
	return rangerCreditsEnTete(models.map(m => labels[m.value] ? { ...m, label: labels[m.value] } : m));
}

/** The Claude Code models THIS machine's own CLI cache offers right now (cache re-read first, never a hard-coded list): selectable ones only, ids the request charset allows. This is both what a PC publishes in its device file and the list a remote request's `model` is checked against. */
export async function claudeModelsOffered(): Promise<Array<{ id: string; label: string }>> {
	await refreshCliCaches();
	return cleanModels(getClaudeModels().filter(m => !m.disabled).map(m => ({ id: m.value, label: m.label })));
}

/** Les modèles plus anciens : la section `overflow` du catalogue, précédée
    des modèles de `main` qu'une version plus récente de leur famille
    remplace. Le menu les propose sous « Plus de modèles ». Vide sans
    catalogue. */
export function getClaudeMoreModels(plan?: ClaudePlanHint): ModelDef[] {
	const catalogue = catalogueCourant();
	return catalogue ? menuDuCatalogue(catalogue, plan).more : [];
}

/* LE MENU RANGÉ COMME CELUI DE CLAUDE.AI (2026-09-23).
   — Un seul modèle par famille dans la liste principale, le plus récent : le
     catalogue d'un compte peut RETARDER (celui du 2026-09-22 rangeait encore
     « Opus 5 » dans `main`, à côté d'« Opus 5.5 », alors qu'un catalogue
     téléchargé le lendemain l'avait déjà passé en `overflow`). Le plus ancien
     descend sous « Plus de modèles », jamais supprimé.
   — Un modèle à crédits d'utilisation est VISIBLE, GRISÉ, NON SÉLECTIONNABLE,
     et en tête de liste comme sur claude.ai. Sur un forfait Max, qui l'inclut,
     il redevient un modèle comme les autres, badge « Inclus ». */
function menuDuCatalogue(catalogue: CatalogueModele[], plan: ClaudePlanHint): { main: ModelDef[]; more: ModelDef[] } {
	const inclus = plan?.name.toLowerCase() === "max";
	const habiller = (m: CatalogueModele): ModelDef =>
		!m.credits ? m.def
			: inclus ? { ...m.def, badge: t("ai.badge.included"), tooltip: undefined }
			: { ...m.def, disabled: true };

	const plusRecent = new Map<string, number[]>();
	for (const m of catalogue) {
		if (m.section !== "main" || !m.famille || !m.version) continue;
		const connu = plusRecent.get(m.famille);
		if (!connu || isNewerVersion(m.version, connu)) plusRecent.set(m.famille, m.version);
	}
	const main: ModelDef[] = [];
	const relegues: ModelDef[] = [];
	for (const m of catalogue) {
		if (m.section !== "main") continue;
		const tete = m.famille ? plusRecent.get(m.famille) : undefined;
		(tete && m.version && isNewerVersion(tete, m.version) ? relegues : main).push(habiller(m));
	}
	return {
		main: rangerCreditsEnTete(main),
		more: [...relegues, ...catalogue.filter(m => m.section === "overflow").map(habiller)],
	};
}

/** Les modèles non sélectionnables d'abord, l'ordre du catalogue gardé à
    l'intérieur de chaque groupe (`sort` est stable). */
function rangerCreditsEnTete(models: ModelDef[]): ModelDef[] {
	return [...models].sort((a, b) => Number(!!b.disabled) - Number(!!a.disabled));
}

/* Modèle Claude effectif : si le modèle choisi n'est plus visible (ex. Fable
   une fois la promo terminée) ou plus sélectionnable (crédits d'utilisation),
   retombe sur sa famille, puis sur le modèle par défaut. */
export function resolveClaudeModel(value?: string, plan?: ClaudePlanHint): string {
	const catalogue = catalogueCourant();
	if (catalogue) {
		/* Un réglage enregistré avant le catalogue est un ALIAS (« opus ») : il
		   désigne le modèle principal de sa famille, que le catalogue nomme. Un
		   identifiant retiré du catalogue retombe sur sa famille, puis sur la
		   famille par défaut. */
		const { main, more } = menuDuCatalogue(catalogue, plan);
		if (value && [...main, ...more].some(m => m.value === value && !m.disabled)) return value;
		const principaux = main.filter(m => !m.disabled);
		const deFamille = (f: string) => principaux.find(m => parseClaudeModelId(m.value)?.family === f);
		const defaut = getProvider("claude-code").defaultModel;
		const famille = (value && parseClaudeModelId(value)?.family) || value || defaut;
		const principal = deFamille(famille) ?? deFamille(defaut) ?? principaux[0];
		if (principal) return principal.value;
	}
	const models = getClaudeModels(plan);
	if (models.some(m => m.value === value && !m.disabled)) return value as string;
	return getProvider("claude-code").defaultModel;
}

/* ── Modèles Ollama (un seul endpoint local, cloud + local) ──
   Ollama sert local ET cloud sur localhost:11434. Les tags cloud portent le
   suffixe « :cloud » OU « …-cloud » : LES DEUX FORMES existent (ex.
   gpt-oss:120b-cloud vs glm-5.3:cloud) et le suffixe NE dit RIEN du prix.
   Gratuit vs payant est décidé par Ollama PAR MODÈLE, évolue dans le temps, et
   n'est fiable qu'à la génération (403 « requires a subscription »). On ne fige
   donc AUCUN statut de prix. Le catalogue ne garde que les modèles récents
   (dernière version par famille) et est rafraîchi dynamiquement depuis
   ollama.com (cf. fetchOllamaCloudCatalog) ; le tableau ci-dessous n'est qu'un
   repli embarqué (si hors-ligne) et la source des tags exacts connus. */
/* Tags relevés un par un sur ollama.com/library/<modèle>/tags le 2026-08-29,
   complétés le 2026-09-20 (deepseek-v4.1-flash, kimi-k2.7-code, vérifiés de
   la même façon ; deepseek-v4-flash sort, remplacé par le 4.1).
   Les relever plutôt que les deviner N'EST PAS DU ZÈLE : « <famille>:cloud »
   n'existe pas pour tout le monde (mistral-large-3 n'a que « :675b-cloud »,
   nemotron-3-nano que « :30b-cloud »), et un tag inventé donne un 404 à la
   génération. gemini-3-flash-preview a perdu son tag cloud et sort d'ici. */
export const OLLAMA_FALLBACK_CATALOG: OllamaCatalogEntry[] = [
	{ value: "gpt-oss:120b-cloud", label: "GPT-OSS 120B" },
	{ value: "gpt-oss:20b-cloud", label: "GPT-OSS 20B" },
	{ value: "minimax-m3:cloud", label: "MiniMax M3" },
	{ value: "nemotron-3-ultra:cloud", label: "Nemotron 3 Ultra" },
	{ value: "nemotron-3-super:cloud", label: "Nemotron 3 Super" },
	{ value: "nemotron-3-nano:30b-cloud", label: "Nemotron 3 Nano" },
	{ value: "glm-5.3:cloud", label: "GLM-5.3" },
	{ value: "glm-5.3-flash:cloud", label: "GLM-5.3 Flash" },
	{ value: "kimi-k3:cloud", label: "Kimi K3" },
	{ value: "qwen3.5:cloud", label: "Qwen 3.5" },
	{ value: "deepseek-v4-pro:cloud", label: "DeepSeek V4 Pro" },
	{ value: "deepseek-v4.1-flash:cloud", label: "DeepSeek V4.1 Flash" },
	{ value: "kimi-k2.7-code:cloud", label: "Kimi K2.7 Code" },
	{ value: "mistral-large-3:675b-cloud", label: "Mistral Large 3" },
	{ value: "gemma4:cloud", label: "Gemma 4" }
];

// Le menu affiche UNE liste scrollable (façon app Ollama) : jusqu'à 20 modèles,
// hauteur calée sur ~7 lignes visibles (OLLAMA_VISIBLE_COUNT), scroll interne +
// recherche « Find model… ». Les réglages ne servent qu'à ordonner/compléter.
export const OLLAMA_MAX_MODELS = 20;
export const OLLAMA_VISIBLE_COUNT = 7;

// Sélection par défaut : les 7 MEILLEURS modèles cloud, le meilleur en tête.
// L'ordre = qualité, indépendamment du prix (un modèle payant → 403 explicite à
// la génération, jamais figé ici). L'utilisateur réordonne à volonté.
export const DEFAULT_OLLAMA_SELECTION: string[] = [
	"glm-5.3:cloud", "kimi-k3:cloud", "deepseek-v4-pro:cloud", "qwen3.5:cloud",
	"minimax-m3:cloud", "gpt-oss:120b-cloud", "nemotron-3-ultra:cloud"
];

/* Un modèle Ollama est-il cloud ? (suffixe :cloud ou …-cloud — les deux formes) */
export function isOllamaCloudModel(value?: string): boolean {
	return /(?::cloud|-cloud)$/.test(value || "");
}

/* Libellé lisible depuis un tag (« gpt-oss:120b-cloud » → « GPT-OSS 120B »).
   Cosmétique ; sert aux modèles hors repli (fetch dynamique / ajout manuel). */
export function prettyOllamaLabel(value?: string): string {
	const core = String(value || "").replace(/(?::|-)cloud$/, "").replace(/:latest$/, "").replace(/:/g, " ");
	const ACR: Record<string, string> = { gpt: "GPT", oss: "OSS", glm: "GLM", ai: "AI", llm: "LLM", deepseek: "DeepSeek", minimax: "MiniMax" };
	/* Les tirets deviennent des espaces : c'est la forme des libellés curés du
	   repli (« Nemotron 3 Ultra », « Mistral Large 3 »), et un modèle
	   découvert en ligne s'affiche dans la même liste qu'eux — « DeepSeek V4.1
	   Flash » à côté de « DeepSeek V4 Pro », pas « Deepseek-V4.1-Flash ». Seul
	   « GPT-OSS » garde son tiret, par son libellé curé, qui prime. */
	return core.split(/[\s-]+/).map(w => ACR[w.toLowerCase()] || (w && /[a-z]/i.test(w[0]) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/* Catalogue effectif : cache dynamique (settings.aiOllamaCatalog) sinon repli.
   TOUJOURS filtré par dedupeOllamaLatest → garantit qu'une seule version par
   modèle survit, quelle que soit la source (règle absolue, cf. dedupeOllamaLatest). */
export function getOllamaCatalog(cached?: OllamaCatalogEntry[] | null): OllamaCatalogEntry[] {
	const base = Array.isArray(cached) && cached.length ? cached : OLLAMA_FALLBACK_CATALOG;
	return dedupeOllamaLatest(base);
}

/* Métadonnées d'un modèle : label depuis le catalogue fourni (ou repli, ou
   prettify), cloud d'après le suffixe. On ne fige NI le prix NI thinking : un
   modèle cloud propose l'effort (le param `think` est ignoré sans erreur s'il
   n'est pas supporté — vérifié). Le local raffine thinking via ses capabilities. */
export function getOllamaModelMeta(value: string, catalog?: OllamaCatalogEntry[] | null): OllamaModelMeta {
	// Le label curé du repli prime (ex. « Mistral Large 3 » plutôt que le
	// « Mistral-Large-3:675b » dérivé par prettyOllamaLabel dans un cache) ; sinon le
	// cache dynamique, sinon prettify.
	const cat = getOllamaCatalog(catalog);
	const m = OLLAMA_FALLBACK_CATALOG.find(x => x.value === value) || cat.find(x => x.value === value);
	const cloud = isOllamaCloudModel(value);
	return {
		value,
		label: m ? m.label : (cloud ? prettyOllamaLabel(value) : String(value || "").replace(/:latest$/, "")),
		cloud,
		thinking: true
	};
}

/* Résout une sélection (liste ordonnée, ex. settings.aiOllamaModels) en options
   complètes, dédupliquée et plafonnée à OLLAMA_MAX_MODELS. Retombe sur la
   sélection par défaut si vide. `catalog` = cache dynamique optionnel. */
export function resolveOllamaSelection(values?: string[] | null, catalog?: OllamaCatalogEntry[] | null): OllamaModelMeta[] {
	let list = Array.isArray(values) ? values.filter(v => typeof v === "string" && v) : [];
	if (!list.length) list = DEFAULT_OLLAMA_SELECTION.slice();
	const seen = new Set<string>();
	const decorated: OllamaModelMeta[] = [];
	for (const v of list) {
		if (seen.has(v)) continue;
		seen.add(v);
		decorated.push(getOllamaModelMeta(v, catalog));
	}
	// Règle absolue : une seule version par modèle dans la liste, puis plafond.
	return dedupeOllamaLatest(decorated).slice(0, OLLAMA_MAX_MODELS);
}

/* ── Regroupement par MODÈLE et « dernière version seulement » ──
   Règle produit ABSOLUE (mémoire projet : ollama-latest-version-only) : la liste
   ne contient QUE la version la plus récente de chaque modèle. « kimi-k2.6 »
   disparaît dès que « kimi-k3 » est là ; « glm-5.2 » dès qu'il y a « glm-5.3 ».

   Base = le nom SANS ses nombres, sur le nom sans le tag (« :cloud ») :
   « deepseek-v4.1-flash » → « deepseek-v-flash », « deepseek-v4-pro » →
   « deepseek-v-pro », « glm-5.3 » → « glm ». Une VARIANTE (pro / flash /
   code / super / ultra) est donc un modèle à part, qui n'a que ses propres
   versions à perdre : « glm-5.2 » tombe devant « glm-5.3 », « deepseek-v4-flash »
   devant « deepseek-v4.1-flash », mais « deepseek-v4-pro » reste — il n'a pas
   de successeur. Jusqu'au 2026-09-20 la base était le PRÉFIXE AVANT LE PREMIER
   CHIFFRE (« deepseek-v » pour les trois), et la sortie de V4.1 Flash le
   2026-09-10 a fait disparaître V4 Pro — le plus gros du catalogue, dans la
   sélection par défaut — ainsi que « kimi-k2.7-code », le modèle de code, lu
   comme une version périmée de « kimi-k3 » (13 entrées au lieu de 15, mesuré
   sur le catalogue réel). Les tiers de même version (« nemotron-3-super » /
   « -ultra ») restent, comme avant : deux bases, chacune avec sa version. */
function ollamaFamilyBase(name: string): string {
	const fam = String(name).split(":")[0];
	return fam.replace(/[0-9]+(?:\.[0-9]+)*/g, "").replace(/[-.\s]{2,}/g, "-").replace(/^[-.\s]+|[-.\s]+$/g, "") || fam;
}
/* Version = suite de nombres du nom, tag ignoré (pour ne pas lire une taille
   « 120b » comme une version). [0] si aucun chiffre. */
function ollamaFamilyVersion(name: string): number[] {
	const fam = String(name).split(":")[0];
	const nums = (fam.match(/\d+/g) || []).map(Number);
	return nums.length ? nums : [0];
}
function cmpOllamaVersion(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] || 0, y = b[i] || 0;
		if (x !== y) return x - y;
	}
	return 0;
}

/* Ne garde qu'une entrée par modèle = sa version max. Les variantes de MÊME
   version (tiers super/ultra, tailles 120b/20b) sont toutes conservées ; seules
   les versions périmées d'un même modèle sont retirées. Préserve l'ordre. */
export function dedupeOllamaLatest<T extends { value: string }>(list: T[]): T[] {
	const maxByFam = new Map<string, number[]>();
	for (const m of list) {
		const base = ollamaFamilyBase(m.value), v = ollamaFamilyVersion(m.value);
		if (!maxByFam.has(base) || cmpOllamaVersion(v, maxByFam.get(base)!) > 0) maxByFam.set(base, v);
	}
	const seen = new Set<string>();
	const out: T[] = [];
	for (const m of list) {
		if (seen.has(m.value)) continue;
		if (cmpOllamaVersion(ollamaFamilyVersion(m.value), maxByFam.get(ollamaFamilyBase(m.value))!) !== 0) continue;
		seen.add(m.value);
		out.push(m);
	}
	return out;
}

/* Récupère les modèles cloud récents depuis ollama.com (best-effort, par
   `host.net.fetchJson` → pas de CORS sous Obsidian, et la requête part du
   processus principal dans l'application). Repli embarqué (tags exacts, dont
   les tailles gpt-oss) + familles découvertes STRICTEMENT plus récentes (tag
   deviné « <famille>:cloud »), dernière version par famille. Le prix n'est PAS
   récupéré (détecté au 403). Lève en cas d'échec réseau. Renvoie [{value,label}]. */
export async function fetchOllamaCloudCatalog(): Promise<OllamaCatalogEntry[]> {
	/* `https://ollama.com/api/tags` : le catalogue des modèles cloud, en JSON
	   (`{ models: [{ name, modified_at, size }] }`, vingt entrées le
	   2026-09-19). Jusqu'à cette date le module lisait le HTML de la page de
	   recherche et y cherchait `x-test-search-response-title` ; ce marqueur a
	   disparu du site, et la fonction rendait le repli embarqué sans un mot.
	   Un corps qui n'est pas du JSON, ou sans `models`, LÈVE : l'appelant garde
	   son cache ou son repli, mais ne prend pas un catalogue vide pour vrai. */
	const resp = await requireHost("net").fetchJson({ url: "https://ollama.com/api/tags" });
	if (!resp || resp.status !== 200 || !resp.body) throw new Error("catalog fetch " + (resp && resp.status));
	const data = corpsJson(resp.body) as { models?: Array<{ name?: unknown }> } | null;
	if (!data || !Array.isArray(data.models)) throw new Error("catalog body is not the Ollama tags JSON");
	/* La FAMILLE seule (« deepseek-v4-pro:0813 » → « deepseek-v4-pro ») : le
	   tag exact d'ollama.com n'est pas celui du cloud (« :cloud » / « -cloud »),
	   et la suite de la fonction compose « <famille>:cloud » pour les familles
	   neuves — comme avant, à partir du nom de la fiche. */
	const families = [...new Set(data.models
		.map(m => typeof m.name === "string" ? m.name.split(":")[0].toLowerCase() : "")
		.filter(f => /^[a-z0-9.\-]+$/.test(f)))];
	// Version max du repli par modèle → les familles déjà couvertes gardent leur
	// TAG EXACT embarqué (dont les tailles gpt-oss 120b/20b, non devinables) ; on
	// n'ajoute une famille découverte que si elle est STRICTEMENT plus récente
	// (ou inconnue). Le tag deviné « <famille>:cloud » reprend le nom exact de la
	// fiche ollama.com (donc « kimi-k2.7-code:cloud » et pas « kimi:cloud »).
	const bundledMax = new Map<string, number[]>();
	for (const m of OLLAMA_FALLBACK_CATALOG) {
		const base = ollamaFamilyBase(m.value), v = ollamaFamilyVersion(m.value);
		if (!bundledMax.has(base) || cmpOllamaVersion(v, bundledMax.get(base)!) > 0) bundledMax.set(base, v);
	}
	const out = OLLAMA_FALLBACK_CATALOG.slice();
	for (const fam of families) {
		const base = ollamaFamilyBase(fam), v = ollamaFamilyVersion(fam);
		if (bundledMax.has(base) && cmpOllamaVersion(v, bundledMax.get(base)!) <= 0) continue;
		out.push({ value: fam + ":cloud", label: prettyOllamaLabel(fam + ":cloud") });
	}
	// Règle absolue : une seule version par modèle (retire un repli périmé dès
	// qu'une version plus récente est découverte en ligne).
	return dedupeOllamaLatest(out);
}

export function getDefaultModels(providerId: string): ModelDef[] {
	if (providerId === "claude-code") return CLAUDE_CODE_MODELS;
	if (providerId === "codex") return getCodexModels();
	if (providerId === "antigravity-cli") return getAntigravityModels();
	// OllamaCatalogEntry[] est structurellement assignable à ModelDef[].
	return dedupeOllamaLatest(OLLAMA_FALLBACK_CATALOG);
}

/* ── Détections de statut ──
   Elles ne lancent plus rien elles-mêmes : `host.process` (`src/host/types.ts`)
   est la seule porte vers un CLI. Le PATH étendu, les emplacements
   d'installation d'Ollama et le démarrage détaché vivent maintenant dans les
   hôtes (`apps/windows/electron/process.ts`), parce
   que `require` n'existe pas dans le rendu de l'application : chaque sonde y
   aurait répondu « non installé » en silence. */

let claudeCodeCache: { at: number; result: ClaudeCodeStatus } | null = null;
const CLAUDE_CODE_TTL = 60000;

/* Claude Code CLI installé ? → { ok, version?, reason? }
   `force` ignore le TTL (relance le CLI) — sert à re-vérifier la version
   à l'ouverture du menu fournisseur, après un éventuel update. */
/* A probe refused because a `run` of the SAME tool is under way — a
   generation: the host launches one at a time and answers `occupe` (after
   waiting up to 15 s). The tool is plainly installed, it is running. Counted
   as "not installed" like any other rejection (until 2026-09-29), it made
   the Generate page forget the chosen provider — `setStatus` clears a
   provider in error, and writes it — as soon as the page was painted again
   during a generation (leaving Generate and coming back was enough). A busy
   probe keeps the last known answer and is not cached. */
function estOccupe(e: unknown): boolean {
	return e instanceof Error && e.name === "occupe";
}

export async function checkClaudeCode(force?: boolean): Promise<ClaudeCodeStatus> {
	if (!currentHost().platform.isDesktopApp) {
		return { ok: false, reason: "mobile" };
	}
	if (!force && claudeCodeCache && Date.now() - claudeCodeCache.at < CLAUDE_CODE_TTL) {
		return claudeCodeCache.result;
	}
	/* TOUT rejet vaut « pas installé », exactement comme l'ancien `err` de
	   `cp.exec` : l'exécutable manque (`introuvable`), le CLI n'a pas répondu
	   en 10 s (`timeout`), ou l'hôte ne sait pas encore lancer de CLI
	   (`indisponible`, l'application jusqu'à la tâche 7). Un code de sortie
	   non nul aussi — l'ancien `exec` le rendait dans `err`. */
	let occupe = false;
	const result = await requireHost("process")
		.run({ tool: "claude", args: ["--version"], stdin: "", timeoutMs: 10000 })
		.then((res): ClaudeCodeStatus => res.code === 0
			? { ok: true, version: (res.stdout || "").trim().split(/\s+/)[0] || "" }
			: { ok: false, reason: "not-installed" })
		.catch((e: unknown): ClaudeCodeStatus => {
			if (!estOccupe(e)) return { ok: false, reason: "not-installed" };
			occupe = true;
			return claudeCodeCache?.result.ok ? claudeCodeCache.result : { ok: true, version: "" };
		});
	if (!occupe) claudeCodeCache = { at: Date.now(), result };
	return result;
}

let codexCache: { at: number; result: CodexStatus } | null = null;

/* Codex CLI (ChatGPT) installé ? → { ok, version?, reason? }
   `codex --version` sort « codex-cli 0.139.0 » → on garde le dernier token.
   `force` ignore le TTL (même logique que checkClaudeCode). */
export async function checkCodex(force?: boolean): Promise<CodexStatus> {
	if (!currentHost().platform.isDesktopApp) {
		return { ok: false, reason: "mobile" };
	}
	if (!force && codexCache && Date.now() - codexCache.at < CLAUDE_CODE_TTL) {
		return codexCache.result;
	}
	// Même règle que `checkClaudeCode` : tout rejet vaut « pas installé ».
	let occupe = false;
	const result = await requireHost("process")
		.run({ tool: "codex", args: ["--version"], stdin: "", timeoutMs: 10000 })
		.then((res): CodexStatus => {
			if (res.code !== 0) return { ok: false, reason: "not-installed" };
			const parts = (res.stdout || "").trim().split(/\s+/);
			return { ok: true, version: parts[parts.length - 1] || "" };
		})
		// A busy tool is an installed one (see `estOccupe`).
		.catch((e: unknown): CodexStatus => {
			if (!estOccupe(e)) return { ok: false, reason: "not-installed" };
			occupe = true;
			return codexCache?.result.ok ? codexCache.result : { ok: true, version: "" };
		});
	if (!occupe) codexCache = { at: Date.now(), result };
	return result;
}

let antigravityCache: { at: number; result: CodexStatus } | null = null;

/** Antigravity CLI installé ? `agy --version` rend le seul numéro (« 1.2.7 »),
    sur une ligne. Même règle que les deux autres sondes : TOUT REJET VAUT
    « PAS INSTALLÉ » (l'hôte peut ne pas savoir lancer de CLI, l'outil peut
    avoir disparu), et c'est la seule chose que l'appelant demande. */
export async function checkAntigravity(force?: boolean): Promise<CodexStatus> {
	if (!currentHost().platform.isDesktopApp) {
		return { ok: false, reason: "mobile" };
	}
	if (!force && antigravityCache && Date.now() - antigravityCache.at < CLAUDE_CODE_TTL) {
		return antigravityCache.result;
	}
	let occupe = false;
	const result = await requireHost("process")
		.run({ tool: "agy", args: ["--version"], stdin: "", timeoutMs: 10000 })
		.then((res): CodexStatus => {
			if (res.code !== 0) return { ok: false, reason: "not-installed" };
			const parts = (res.stdout || "").trim().split(/\s+/);
			return { ok: true, version: parts[parts.length - 1] || "" };
		})
		// A busy tool is an installed one (see `estOccupe`).
		.catch((e: unknown): CodexStatus => {
			if (!estOccupe(e)) return { ok: false, reason: "not-installed" };
			occupe = true;
			return antigravityCache?.result.ok ? antigravityCache.result : { ok: true, version: "" };
		});
	if (!occupe) antigravityCache = { at: Date.now(), result };
	return result;
}

/* ─────────── LE COMPTE EST-IL CONNECTÉ ? ───────────

   Jumelles des sondes ci-dessus, et volontairement SANS CACHE : elles ne
   servent qu'à une chose, surveiller toutes les trois secondes une connexion
   que l'utilisateur est en train de faire dans un terminal. Un TTL de 60 s y
   ferait attendre une minute devant un « En attente… » alors que c'est fait.

   Claude et Codex passent désormais par `etatComptes()` (Ahmed, 2026-09-21) :
   c'est la MÊME lecture que la section « Comptes » des réglages, faite SANS
   VERROU dans le processus principal (`apps/windows/electron/comptes.ts`) —
   contrairement à `HostProcess.run`, qui prend un verrou par outil et
   attendrait jusqu'à 15 s derrière une génération en cours, rendant cette
   sonde muette pendant toute génération. Deux chemins qui répondaient à la
   même question («suis-je connecté ?») auraient divergé au premier
   changement ; il n'y en a plus qu'un.

   Antigravity reste sur `agy models` par `HostProcess.run` : la sonde lit
   aussi la LISTE des modèles dans la même sortie (`parseAntigravityModels`),
   que `etatComptes()` ne rend pas — la faire passer par lui aurait vidé
   `antigravityModelsSnapshot` en silence et fait retomber le menu des
   modèles sur son repli embarqué.

   TOUT REJET VAUT « PAS CONNECTÉ », comme pour les sondes d'installation :
   l'outil peut avoir disparu entre-temps, l'hôte peut ne pas savoir lancer de
   CLI. Ni l'un ni l'autre n'est « connecté », et c'est la seule chose que
   l'appelant demande. */

const SONDE_CONNEXION_MS = 10000;

/** Le verdict d'un outil, lu par `etatComptes()` — la lecture SANS VERROU du
    processus principal (voir son en-tête, `apps/windows/electron/comptes.ts`) :
    contrairement à `run()`, elle n'attend jamais derrière une génération en
    cours. Un rejet du pont vaut « pas connecté », comme pour les anciennes
    sondes : l'appelant ne demande que ça. */
async function connecteSelonEtatComptes(outil: "claude" | "codex" | "agy"): Promise<boolean> {
	if (!currentHost().platform.isDesktopApp) return false;
	// FILTRÉ à ce seul outil (Ahmed, 2026-09-21) : cette sonde tourne toutes
	// les trois secondes pendant un flux de connexion qui peut durer deux
	// minutes ; lire les trois comptes à chaque tick lancerait `agy models`
	// (~1 s, réseau) en boucle sans rapport avec ce que l'utilisateur fait.
	return requireHost("process")
		.etatComptes([outil])
		.then(etats => etats.find(e => e.outil === outil)?.connecte === true)
		.catch(() => false);
}

/** Codex : la même question qu'avant (`codex login status`), désormais lue
    par `etatComptes()` — une seule vérité sur « qui est connecté », partagée
    avec la section « Comptes » des réglages. */
export async function checkCodexLogin(): Promise<boolean> {
	return connecteSelonEtatComptes("codex");
}

/** Claude : la même question qu'avant (`claude auth status`, dont on ne
    lisait QUE `loggedIn`), désormais lue par `etatComptes()`. */
export async function checkClaudeLogin(): Promise<boolean> {
	return connecteSelonEtatComptes("claude");
}

/** La sonde de connexion d'un outil, ou `null` pour ceux qui n'ont pas de
    compte (Ollama). Un seul point d'appel pour la page « Générer ». */
/** Antigravity : pas de sous-commande de statut ; `agy models` ne répond la
    liste QUE connecté (sinon « Please sign in to view available models »,
    code 1 — mesuré le 2026-09-20, `agy` 1.2.7). La liste lue est gardée au
    passage : c'est la même que celle du composer. */
export async function checkAntigravityLogin(): Promise<boolean> {
	if (!currentHost().platform.isDesktopApp) return false;
	return requireHost("process")
		.run({ tool: "agy", args: ["models"], stdin: "", timeoutMs: SONDE_CONNEXION_MS })
		.then(res => {
			if (res.code !== 0) return false;
			const modeles = parseAntigravityModels(res.stdout);
			if (modeles.length === 0) return false;
			antigravityModelsSnapshot = { at: Date.now(), models: modeles };
			return true;
		})
		.catch(() => false);
}

export function sondeConnexion(tool: "claude" | "codex" | "agy"): () => Promise<boolean> {
	return tool === "claude" ? checkClaudeLogin : tool === "codex" ? checkCodexLogin : checkAntigravityLogin;
}

let ollamaCache: { at: number; url: string; result: OllamaStatus } | null = null;

/* Serveur Ollama joignable ? → { ok, models?, reason? }
   Un serveur joignable suffit (ok), même sans modèle local installé : les
   modèles cloud (:cloud) tournent à la demande sans figurer dans /api/tags.
   Caché comme Claude/Codex (même TTL) : sans ça, chaque re-render du composer
   refaisait la détection, et le hint du fournisseur n'apparaissait qu'après
   ce round-trip — alors que son statut était déjà affiché dans le menu. */
export async function checkOllama(url?: string, force?: boolean): Promise<OllamaStatus> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	if (!force && ollamaCache && ollamaCache.url === base && Date.now() - ollamaCache.at < CLAUDE_CODE_TTL) {
		return ollamaCache.result;
	}
	const result = await checkOllamaLive(base);
	ollamaCache = { at: Date.now(), url: base, result };
	return result;
}

/* ── LE COMPTE OLLAMA, PAR LE DÉMON ──
   Mesuré le 2026-09-19 (Ollama 0.34.2, `WhoamiHandler` de server/routes.go) :
   `POST /api/me` répond 200 `{ plan, name, email, … }` quand le démon est
   connecté à un compte ollama.com, et 401 `{ error: "unauthorized",
   signin_url }` sinon. L'adresse porte la clé publique du démon : l'ouvrir
   dans le navigateur et approuver connecte le démon — c'est ce que fait
   `ollama signin`, sans le terminal. Les modèles cloud (toute la sélection par
   défaut) en ont besoin ; jusqu'ici l'utilisateur ne l'apprenait qu'au premier
   envoi, par une erreur qui lui disait de taper une commande.

   SEUL `plan` ÉTAIT LU à l'origine (la sonde ne servait que la page
   « Générer », qui n'affiche pas de compte). La section « Comptes » des
   réglages a changé l'intention : l'adresse s'affiche comme pour les trois
   autres outils, donc `email` est extrait et rendu — il ne reste jamais
   journalisé. `name` et `avatarurl` restent ignorés.

   `signin_url` N'EST ADMISE QUE SUR `https://ollama.com` : c'est une adresse
   que la page va OUVRIR dans le navigateur, et un démon usurpé (un service
   qui occupe le port 11434) ne doit pas pouvoir y mettre n'importe quoi. */
export type CompteOllama =
	| { connecte: true; plan: string; email: string | null }
	| { connecte: false; signinUrl: string | null };

export async function checkOllamaCompte(url?: string): Promise<CompteOllama> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	const resp = await requireHost("net").fetchJson({ url: base + "/api/me", method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
	const absent: CompteOllama = { connecte: false, signinUrl: null };
	if (!resp) return absent;
	const data = corpsJson(resp.body) as { plan?: unknown; email?: unknown; signin_url?: unknown } | null;
	// Un `plan` VIDE reste connecté : le 200 prouve la connexion, un plan
	// inconnu n'empêche que le badge (qui exige un plan lu) de s'afficher.
	if (resp.status === 200 && data && typeof data.plan === "string") {
		const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
		// `plan` reste TEL QUEL (« pro », « free ») : `ai.ts` le compare à
		// `"free"` et `repartirParPlan` s'en sert comme clé — le capitaliser
		// « pour l'affichage » a cassé ces deux comparaisons le 2026-09-21.
		return { connecte: true, plan: data.plan, email };
	}
	if (resp.status === 401 && data && typeof data.signin_url === "string") {
		try {
			const u = new URL(data.signin_url);
			if (u.protocol === "https:" && u.hostname === "ollama.com") return { connecte: false, signinUrl: data.signin_url };
		} catch (e) { /* illisible : sans adresse */ }
	}
	return absent;
}

/* ── LE PLAN REQUIS D'UN MODÈLE CLOUD : LA SONDE À ZÉRO TOKEN ──
   Ollama ne publie pas la liste des modèles compris dans le plan gratuit (la
   page de prix dit « starter models » sans les nommer ; la page des réglages
   les liste, derrière la connexion), et `required_plan` des recommandations
   ne couvre presque rien (5 modèles sur toute la sélection). Ce qui existe et
   répond pour CHAQUE modèle : mesuré le 2026-09-19 (Ollama 0.34.2, compte
   `free`), `POST /api/chat` avec `num_predict: 0` répond, en ~2 s et SANS
   générer un seul token (le plan est vérifié AVANT la validation de
   `max_tokens`) — 402 « this model is not included in your free usage… » sur
   un modèle payant, 400 « max_tokens must be positive » sur un modèle compris
   dans le plan gratuit. On SONDE donc chaque modèle plutôt que d'écrire une
   liste : une liste embarquée pourrirait sans qu'une erreur le dise (décision
   d'Ahmed, 2026-09-19). */

/** Où mène « Mettre à niveau » : la page des PRIX, qui compare les plans,
    plutôt que `/upgrade`, qui pousse directement vers un paiement (Ahmed,
    2026-09-19). */
export const OLLAMA_UPGRADE_URL = "https://ollama.com/pricing";

export type VerdictPlan = "inclus" | "payant" | "inconnu";

/** PURE. Le verdict d'une réponse de la sonde `/api/chat` à zéro token :
    402 (ou son message si le statut a changé) → `"payant"` ; 400 « max_tokens
    must be positive » → `"inclus"` (le 400 est passé la vérification du plan
    puisqu'Ollama a rejeté `num_predict: 0` ensuite) ; 2xx → `"inclus"` (une
    version future qui accepterait 0 tokens) ; tout le reste (404 modèle
    inconnu, 401, 5xx, corps illisible) → `"inconnu"`, jamais un statut tranché
    sur une réponse qu'on ne comprend pas. */
export function classerSondePlan(status: number, corps: string): VerdictPlan {
	const data = corpsJson(corps) as { error?: unknown } | null;
	const message = (data && typeof data.error === "string") ? data.error : corps;
	if (erreurOllamaHorsPlan(status, message)) return "payant";
	if (status === 400 && message.toLowerCase().includes("max_tokens must be positive")) return "inclus";
	if (status >= 200 && status < 300) return "inclus";
	return "inconnu";
}

/** La sonde d'un modèle cloud : zéro token demandé (voir l'en-tête) — le
    verdict arrive avant qu'un seul token ne soit généré, donc sans coûter
    d'usage inclus. `null` (réseau injoignable) → `"inconnu"`, jamais une
    exception remontée à l'appelant. */
export async function sonderPlanOllama(url: string | undefined, tag: string): Promise<VerdictPlan> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	const resp = await requireHost("net").fetchJson({
		url: base + "/api/chat",
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: tag,
			messages: [{ role: "user", content: "." }],
			stream: false,
			think: false,
			options: { num_predict: 0 }
		})
	});
	if (!resp) return "inconnu";
	return classerSondePlan(resp.status, resp.body);
}

/** PURE. Répartit des modèles entre le menu principal et « Plus de modèles ».
    Un compte payant (ou dont le plan n'est pas encore connu) ne trie rien :
    aucun modèle n'y est jamais hors plan de façon sûre. Sur un compte
    gratuit, seul un modèle CLOUD dont la sonde a répondu `"payant"` part dans
    `plus` — un local marqué `"payant"` par erreur resterait dans `principal`.
    L'ordre d'entrée est conservé dans chacune des deux listes. */
export function repartirParPlan<T extends { value: string; cloud: boolean }>(
	modeles: T[], planCompte: string, verdicts: Record<string, VerdictPlan>
): { principal: T[]; plus: T[] } {
	if (planCompte !== "free") return { principal: modeles.slice(), plus: [] };
	const principal: T[] = [];
	const plus: T[] = [];
	for (const m of modeles) {
		if (m.cloud && verdicts[m.value] === "payant") plus.push(m);
		else principal.push(m);
	}
	return { principal, plus };
}

/** Un modèle hors plan : le 402 (mesuré le 2026-09-19 : « this model is not
    included in your free usage, add usage credits … or upgrade for included
    usage »), ou son message si le statut a changé. Distinct d'un défaut de
    connexion (401/403 « sign in »). */
export function erreurOllamaHorsPlan(status: number, message: string): boolean {
	if (status === 402) return true;
	const m = message.toLowerCase();
	return m.includes("not included in your") || m.includes("upgrade for included usage");
}

/** Le corps d'une réponse, décodé SANS jamais lever : un serveur qui répond
    200 avec autre chose que du JSON (un portail captif, un proxy) ne doit pas
    faire remonter une exception là où le contrat attend « injoignable ». */
function corpsJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch (e) {
		return null;
	}
}

async function checkOllamaLive(base: string): Promise<OllamaStatus> {
	/* `host.net.fetchJson` et non `fetch` : dans le rendu de l'application, un
	   `fetch` vers `http://localhost:11434` est refusé par la politique
	   d'origine de Chromium — la requête part du processus principal, derrière
	   la liste d'hôtes (`apps/windows/electron/reseau.ts`). `null` (échec
	   réseau) et un statut non-2xx valent tous deux « hors ligne », comme
	   l'ancien `catch` et l'ancien `!resp.ok`. */
	const host = requireHost("net");
	const resp = await host.fetchJson({ url: base + "/api/tags", method: "GET" });
	if (!resp || resp.status < 200 || resp.status >= 300) return { ok: false, reason: "offline" };
	const data = corpsJson(resp.body) as { models?: Array<{ name: string; size?: number; capabilities?: string[] }> } | null;
	/* UN 200 QUI N'EST PAS DU JSON N'EST PAS UN SERVEUR OLLAMA : un portail
	   captif, un proxy d'entreprise ou n'importe quel service qui occupe le
	   port répond 200 avec du HTML. L'ancien `await resp.json()` levait et
	   tombait dans le `catch` — donc « hors ligne ». Sans cette ligne, le
	   diagnostic devient « Ollama joignable, 0 modèle », et l'utilisateur
	   cherche pourquoi ses modèles ont disparu au lieu de voir qu'il parle à
	   autre chose. `/api/version` reste best-effort : son échec ne coûte qu'un
	   numéro de version. */
	if (data === null) return { ok: false, reason: "offline" };
	// capabilities (dont « thinking ») exposées par /api/tags depuis Ollama
	// 0.31 → sert à savoir si un modèle local montre la ligne Effort.
	const models: OllamaDetectedModel[] = (data?.models || []).map(m => ({
		name: m.name, size: m.size, capabilities: m.capabilities || []
	}));
	// Version du serveur = version d'Ollama installée (GET /api/version →
	// { "version": "0.31.2" }). Best-effort : undefined si l'endpoint échoue.
	const vr = await host.fetchJson({ url: base + "/api/version", method: "GET" });
	const version = vr && vr.status >= 200 && vr.status < 300
		? (corpsJson(vr.body) as { version?: string } | null)?.version
		: undefined;
	return { ok: true, models, version };
}

let ollamaInstalledCache: { at: number; result: OllamaInstalledStatus } | null = null;

/* Ollama est-il INSTALLÉ, même serveur arrêté ? Le plugin diagnostique
   lui-même (demande Ahmed : jamais un « si Ollama n'est pas installé »
   laissé à l'utilisateur) : binaire qui répond à --version (PATH
   étendu, couvre npm/brew/PATH custom), sinon emplacements
   d'installation officiels. Caché (même TTL) : un `ollama --version` qui
   échoue coûte un spawn de shell, à ne pas repayer à chaque re-render. */
export async function checkOllamaInstalled(force?: boolean): Promise<OllamaInstalledStatus> {
	if (!currentHost().platform.isDesktopApp) return { installed: false };
	if (!force && ollamaInstalledCache && Date.now() - ollamaInstalledCache.at < CLAUDE_CODE_TTL) {
		return ollamaInstalledCache.result;
	}
	/* La SONDE elle-même vit dans l'hôte (`ollama --version`, puis les
	   emplacements d'installation officiels) : elle demande le système de
	   fichiers et le nom de l'OS, que le code partagé n'a pas. Un rejet vaut
	   « pas installé » — jamais une exception remontée dans la page. */
	const installed = await requireHost("process").ollamaInstalle().catch(() => false);
	const result: OllamaInstalledStatus = { installed };
	ollamaInstalledCache = { at: Date.now(), result };
	return result;
}

/* Démarre Ollama (le serveur démarre avec l'application) — détaché,
   best effort, dans l'hôte : l'app de bureau sur Windows/macOS, « ollama
   serve » sur Linux (pas d'app). Les erreurs asynchrones (exe absent) sont
   avalées : le poll de l'appelant constatera simplement l'échec.
   ASYNCHRONE depuis la tranche 5 (dans l'application, le démarrage traverse
   l'IPC) : le booléen dit seulement que quelque chose a été lancé, pas que le
   serveur répond — c'est le poll de l'appelant qui le constate. */
export async function startOllamaApp(): Promise<boolean> {
	return requireHost("process").demarrerOllama().catch(() => false);
}
