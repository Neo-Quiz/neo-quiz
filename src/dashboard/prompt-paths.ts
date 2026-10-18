import { currentHost } from "../host/current";
import { ATTACHABLE_EXT, isAttachable, resolveExternalPath } from "./file-sources";

/* ══════════════════════════════════════════════════════════
   CHEMINS CITÉS DANS LE PROMPT → PIÈCES JOINTES

   Le générateur est lancé SANS aucun outil : le modèle ne peut ouvrir
   aucun fichier. Écrire « d'après Cours/TD3.md » produisait donc une
   erreur (ai.err.noFileAccess) invitant à rejoindre le fichier à la main
   — alors que le plugin, lui, sait parfaitement lire ce chemin.

   Ce module fait le pont : il repère les chemins dans le texte du
   composer et les résout en fichiers réels (vault ou racines externes
   configurées). L'appelant les attache ensuite par les MÊMES fonctions
   que le picker « @ » — donc mêmes formats, même dédoublonnage, mêmes
   chips visibles. Le prompt garde son texte : le chemin cité est aussi
   du contexte pour le modèle.

   Ce qui n'est PAS fait ici : ouvrir un fichier hors du vault et hors
   des racines configurées, SAUF s'il est désigné par un chemin absolu
   complet — auquel cas l'utilisateur l'a explicitement écrit lui-même.
══════════════════════════════════════════════════════════ */

/** Un chemin du prompt, résolu en fichier réel. */
export interface ResolvedRef {
	/** « vault » → chemin relatif au vault ; « external » → chemin ABSOLU.
	    Distinction reprise telle quelle par les fonctions d'attachement. */
	kind: "vault" | "external";
	path: string;
	name: string;
	/** Le texte tel qu'écrit dans le prompt (pour les messages). */
	raw: string;
}

export interface PromptPathScan {
	refs: ResolvedRef[];
	/** Ce qui ressemblait à un fichier et n'existe pas. Jamais avalé en
	    silence : c'est ce qui explique un quiz écrit sans sa source. */
	unresolved: string[];
	/** Plusieurs fichiers du vault portent ce nom (copie de sauvegarde,
	    dossier de synchro…). On ne devine PAS lequel : l'utilisateur
	    précise un chemin plus long. Séparé des introuvables — le geste de
	    correction n'est pas le même. */
	ambiguous: { text: string; count: number }[];
	/** Vrai si la garde MAX_REFS a coupé la liste. */
	truncated: boolean;
}

/* Garde : un prompt raisonnable cite quelques fichiers. Au-delà, c'est
   probablement une liste collée, et joindre 100 documents ferait exploser
   la fenêtre de contexte du modèle. La coupe est SIGNALÉE, jamais muette. */
export const MAX_PROMPT_PATHS = 20;

/** Fin de chemin plausible : une extension attachable suivie d'un vrai
    délimiteur (fin, espace, guillemet, ponctuation fermante). Le lookahead
    évite de couper « note.markdown » ou « v1.2.3 » en plein milieu. */
function extensionRegex(): RegExp {
	const exts = [...ATTACHABLE_EXT].join("|");
	return new RegExp("\\.(?:" + exts + ")(?=$|[\\s\"'«»`,;)\\]}])", "gi");
}

/* Délimiteurs qui ne peuvent PAS apparaître au milieu d'un chemin : ils
   bornent le début du candidat. Deux absences volontaires :
   — le « : » (« C:\\dev\\… ») ;
   — l'apostrophe droite, qui en français est une LETTRE de plus (« n'existe »,
     « j'ai ») et vit aussi dans les noms de fichiers de ce vault
     (« 1.10.1 Qu'est-ce que j'ai appris dans ce module.md ») : la traiter en
     guillemet coupait ces chemins en deux et les rendait introuvables.
   Les mots de prose que ces absences laissent passer sont retirés par
   l'élagage progressif de `candidatesFrom`. */
const HARD_DELIMS = /[\n\r"«»`]/;

/** Toutes les lectures possibles d'un même chemin cité, de la plus longue
    à la plus courte : on ne sait pas où il COMMENCE (un chemin peut
    contenir des espaces — « Efrei - B1/x.pdf » — et de la prose le
    précède). Le disque tranche : la première lecture qui désigne un
    fichier réel gagne, la plus longue étant la plus spécifique. */
function candidatesFrom(text: string, endIndex: number): { cands: string[]; quoted: boolean } {
	let start = 0;
	let quoted = false;
	for (let i = endIndex - 1; i >= 0; i--) {
		if (HARD_DELIMS.test(text[i])) {
			start = i + 1;
			/* Chemin ENTRE guillemets : la lecture la plus longue est alors
			   exactement ce que l'utilisateur a écrit, aucun mot de prose à
			   élaguer (utile pour l'affichage d'un échec). Il faut les DEUX
			   guillemets : sans la vérification de fermeture, le guillemet
			   FERMANT du chemin précédent passait pour un ouvrant et le
			   libellé traînait la prose intermédiaire (« et de Cours/x.md »,
			   vu en test in-app le 2026-07-31). */
			quoted = /["«»`]/.test(text[i]) && /["»`]/.test(text[endIndex] || "");
			break;
		}
	}
	const full = text.slice(start, endIndex).trim();
	const words = full.split(/\s+/);
	const out: string[] = [];
	for (let i = 0; i < words.length; i++) {
		const cand = words.slice(i).join(" ").replace(/^[\s\-*(\[{]+/, "");
		if (cand) out.push(cand);
	}
	return { cands: out, quoted };
}

function baseName(p: string): string {
	const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	return i < 0 ? p : p.slice(i + 1);
}

/* Par `host.fs.externe.stat` : sous Obsidian c'est `fs` de Node, dans
   l'application un canal BORNÉ du pont — un chemin hors des dossiers ouverts
   y rend `null`, donc « pas un fichier », jamais une lecture. Sur mobile,
   l'hôte n'a pas de disque : `false`. */
async function isFileOnDisk(absPath: string): Promise<boolean> {
	const host = currentHost();
	if (!host.platform.isDesktopApp) return false;
	const info = await host.fs.externe.stat(absPath);
	return info?.isFile === true;
}

type Outcome =
	| { kind: "hit"; ref: ResolvedRef }
	| { kind: "ambiguous"; count: number }
	| { kind: "miss" };

/** Une lecture candidate → fichier réel. Ordre : chemin absolu, chemin exact
    du vault, suffixe de chemin / nom de fichier UNIQUE dans le vault, puis
    racine externe configurée (forme du picker « @ »). */
async function resolveCandidate(roots: string[], cand: string): Promise<Outcome> {
	const fs = currentHost().fs;
	const norm = cand.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
	if (!isAttachable(baseName(norm))) return { kind: "miss" };

	if (/^[A-Za-z]:\//.test(norm) || norm.startsWith("/")) {
		return (await isFileOnDisk(norm))
			? { kind: "hit", ref: { kind: "external", path: norm, name: baseName(norm), raw: cand } }
			: { kind: "miss" };
	}

	const exact = fs.getFile(norm);
	if (exact && isAttachable(exact.name)) {
		return { kind: "hit", ref: { kind: "vault", path: exact.path, name: exact.name, raw: cand } };
	}

	/* Chemin partiel (« CCNA 1/TOBEADMIN.md ») ou nom seul. Comparaison
	   insensible à la casse — Windows l'est, et un chemin recopié à la main
	   l'est souvent aussi. Par `findByName` (casse ignorée, tous les
	   homonymes) : un chemin qui FINIT par « …/nom.md » porte forcément ce
	   nom, donc les candidats sont exactement les homonymes du nom de base —
	   pas besoin de balayer tout le vault. */
	const low = norm.toLowerCase();
	const hits = fs.findByName(baseName(norm)).filter(f =>
		isAttachable(f.name) &&
		(f.path.toLowerCase() === low || f.path.toLowerCase().endsWith("/" + low))
	);
	if (hits.length === 1) {
		return { kind: "hit", ref: { kind: "vault", path: hits[0].path, name: hits[0].name, raw: cand } };
	}
	/* Cas réel (vault Efrei, 2026-07-31) : la même note présente deux fois,
	   dont une copie sous « syncthing/ ». Joindre la mauvaise passerait
	   inaperçu — mieux vaut le dire et laisser choisir. */
	if (hits.length > 1) return { kind: "ambiguous", count: hits.length };

	const ext = resolveExternalPath(roots, norm);
	if (ext && (await isFileOnDisk(ext.absPath))) {
		return { kind: "hit", ref: { kind: "external", path: ext.absPath, name: baseName(ext.absPath), raw: cand } };
	}
	return { kind: "miss" };
}

/** Sous quel nom montrer un chemin qui n'a rien donné. On affiche la lecture
    la plus LONGUE qui commence par un vrai début de chemin (séparateur ou
    nom de fichier) : une lecture plus courte trahirait ce que l'utilisateur
    a écrit (« B1/Sujet.pdf » pour « Documents/Efrei - B1/Sujet.pdf »).
    Renvoie null pour ce qui n'est pas une référence de fichier mais de la
    prose (« node.js », « version 2.5 ») : signaler ça serait du bruit. */
function missLabel(cands: string[], quoted: boolean): string | null {
	if (quoted) return cands[0] || null;
	const startsPath = (c: string) => {
		const first = c.split(/\s+/)[0];
		return /[\\/]/.test(first) || isAttachable(first);
	};
	const pick = cands.find(startsPath) ?? cands[cands.length - 1];
	if (!pick) return null;
	const hasSep = /[\\/]/.test(pick);
	const ext = pick.slice(pick.lastIndexOf(".") + 1).toLowerCase();
	const DOC_EXT = new Set(["md", "pdf", "txt", "csv", "html", "htm"]);
	if (!hasSep && !DOC_EXT.has(ext) && !/\s/.test(pick)) return null;
	return pick;
}

/** Scanne le texte du composer et résout tout ce qui désigne un fichier.
    Asynchrone parce que le disque l'est derrière le contrat (`externe.stat`) ;
    l'unique appelant (`ai.ts`, `attachPromptPaths`) l'était déjà. */
export async function scanPromptPaths(roots: string[], text: string): Promise<PromptPathScan> {
	const refs: ResolvedRef[] = [];
	const unresolved: string[] = [];
	const ambiguous: { text: string; count: number }[] = [];
	const seen = new Set<string>();
	let truncated = false;

	const re = extensionRegex();
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const { cands, quoted } = candidatesFrom(text, m.index + m[0].length);
		let hit: ResolvedRef | null = null;
		let amb: { text: string; count: number } | null = null;
		for (const c of cands) {
			const r = await resolveCandidate(roots, c);
			if (r.kind === "hit") { hit = r.ref; break; }
			// La lecture la plus longue qui touche plusieurs fichiers est la
			// plus proche de ce que l'utilisateur a écrit : c'est elle qu'on
			// lui remontre pour qu'il la précise.
			if (r.kind === "ambiguous" && !amb) amb = { text: c, count: r.count };
		}
		if (!hit) {
			if (amb) {
				if (!ambiguous.some(a => a.text === amb.text)) ambiguous.push(amb);
			} else {
				const label = missLabel(cands, quoted);
				if (label && !unresolved.includes(label)) unresolved.push(label);
			}
			continue;
		}
		const key = hit.kind + ":" + hit.path;
		if (seen.has(key)) continue;
		if (refs.length >= MAX_PROMPT_PATHS) { truncated = true; continue; }
		seen.add(key);
		refs.push(hit);
	}

	return { refs, unresolved, ambiguous, truncated };
}
