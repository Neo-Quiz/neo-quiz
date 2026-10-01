/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — INTERFACE (messages brefs, icônes)

   Obsidian fournissait `Notice` et `setIcon` ; la fenêtre de l'application n'a
   ni l'un ni l'autre. Les deux sont reconstruits ici, et NULLE PART ailleurs.

   Ce module n'importe AUCUN CSS : l'apparence des toasts vit dans
   `apps/windows/src/assets/toast.css`, importé par `main.ts`. Ce n'est pas une
   coquetterie — le harnais de `npm run check:windows-host` charge les modules
   d'hôte avec esbuild, et un import de CSS y tire les fontes MathLive, pour
   lesquelles aucun chargeur n'est configuré : le module deviendrait
   inchargeable, donc invérifiable.
══════════════════════════════════════════════════════════ */

import { icons } from "lucide";
import type { IconNode } from "lucide";
import type { HostUi } from "../../../../src/host/types";
import { LOG_PREFIX } from "../../../../src/branding";

/** Durée par défaut d'un toast, alignée sur `Notice` d'Obsidian. */
const DUREE_PAR_DEFAUT = 4000;

/** Le catalogue Lucide, indexable par une chaîne calculée. Le type publié
    énumère ses 2000 clés une par une : une lecture par nom variable y est une
    erreur de compilation, et un `any` serait le contraire de ce qu'on veut —
    ici la valeur reste typée `IconNode`, seule la CLÉ devient libre. */
const CATALOGUE: Record<string, IconNode | undefined> = icons;

/**
 * Le contrat nomme les icônes comme Obsidian : en kebab-case
 * (« grip-horizontal », « x »). Le paquet `lucide`, lui, expose son catalogue
 * en PascalCase (« GripHorizontal »). La conversion est ici, pour que le code
 * partagé continue d'écrire les noms qu'il écrit depuis toujours — les
 * renommer dans le moteur casserait l'hôte Obsidian, qui attend l'autre forme.
 */
function versCleLucide(name: string): string {
	return String(name ?? "")
		.trim()
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
		.join("");
}

/**
 * L'INVERSE de `versCleLucide` : la clé du catalogue (« ChevronDown ») rendue
 * dans la forme du contrat (« chevron-down »).
 *
 * Une coupure devant CHAQUE majuscule, et non le `toKebabCase` de Lucide
 * (`/([a-z0-9])([A-Z])/`), qui ne coupe pas après une majuscule isolée : il
 * rendrait « xcircle » pour `XCircle` et « aarrowdown » pour `AArrowDown` —
 * des noms que `versCleLucide` ne sait pas retrouver, donc des cases VIDES
 * dans le sélecteur. Mesuré : 15 des 2062 clés du paquet sont dans ce cas ;
 * avec cette coupure-ci, les 2062 font l'aller-retour.
 */
function versNomContrat(cle: string): string {
	return cle.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
}

function conteneurToasts(): HTMLElement {
	const existant = document.querySelector<HTMLElement>(".nq-toasts");
	if (existant) return existant;
	const conteneur = document.createElement("div");
	conteneur.className = "nq-toasts";
	// `aria-live` : un message qui n'interrompt rien doit quand même être lu.
	conteneur.setAttribute("aria-live", "polite");
	document.body.appendChild(conteneur);
	return conteneur;
}

/**
 * Pose une icône LUCIDE dans l'élément, en remplaçant son contenu.
 *
 * Exportée à part du contrat : l'écran de choix de dossier s'affiche AVANT
 * qu'un hôte soit installé, et `currentHost()` jette tant qu'il n'y en a pas.
 * Passer par le contrat y serait une exception au démarrage, pas une icône.
 */
export function poserIcone(el: HTMLElement | null, name: string): void {
			if (!el) return;
			el.replaceChildren();
			const noeud = CATALOGUE[versCleLucide(name)];
			if (!noeud) {
				console.warn(LOG_PREFIX, "icône Lucide inconnue:", name);
				return;
			}
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			// Mêmes attributs que le `createElement` de lucide, et mêmes classes
			// que le setIcon d'Obsidian : le CSS partagé dimensionne les icônes par
			// `.xxx svg { width: … }`, qui l'emporte sur ces attributs.
			svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
			svg.setAttribute("width", "24");
			svg.setAttribute("height", "24");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", "2");
			svg.setAttribute("stroke-linecap", "round");
			svg.setAttribute("stroke-linejoin", "round");
			svg.setAttribute("class", `svg-icon lucide-${String(name)}`);
			for (const [tag, attrs] of noeud) {
				const enfant = document.createElementNS("http://www.w3.org/2000/svg", tag);
				for (const [cle, valeur] of Object.entries(attrs)) {
					if (valeur !== undefined) enfant.setAttribute(cle, String(valeur));
				}
				svg.appendChild(enfant);
			}
			el.appendChild(svg);
		}

/** The toasts currently on screen, by message (see `notice`). */
const toastsVivants = new Map<string, { toast: HTMLElement; minuteur: number }>();

export function createWindowsUi(): HostUi {
	return {
		/* Le message arrive DÉJÀ TRADUIT par son appelant : l'hôte n'a aucune
		   chaîne de son cru.
		   `textContent` et JAMAIS `innerHTML` : un message peut citer le titre
		   d'un quiz PARTAGÉ, donc du texte écrit par quelqu'un d'autre. Une
		   interpolation brute y exécuterait du code avec les droits de la
		   fenêtre — la fenêtre d'une application de bureau, pas d'un onglet. */
		notice(message, timeoutMs = DUREE_PAR_DEFAUT) {
			try {
				const texte = String(message);
				/* One toast per message: repeating the same failing action (twelve
				   clicks on a button that cannot succeed) used to stack twelve
				   identical toasts. The live one is kept and its timer restarted. */
				const vivant = toastsVivants.get(texte);
				if (vivant && vivant.toast.isConnected) {
					window.clearTimeout(vivant.minuteur);
					vivant.minuteur = window.setTimeout(() => { vivant.toast.remove(); toastsVivants.delete(texte); }, Math.max(0, timeoutMs));
					return;
				}
				const toast = document.createElement("div");
				toast.className = "nq-toast";
				toast.textContent = texte;
				conteneurToasts().appendChild(toast);
				const entree = { toast, minuteur: 0 };
				entree.minuteur = window.setTimeout(() => { toast.remove(); toastsVivants.delete(texte); }, Math.max(0, timeoutMs));
				toastsVivants.set(texte, entree);
			} catch (e) {
				// Même repli que l'hôte Obsidian : une notification perdue ne doit
				// pas emporter le rendu avec elle.
				console.log(LOG_PREFIX, message);
			}
		},
		/* Icônes LUCIDE, jamais d'emoji : c'est la bibliothèque derrière le
		   `setIcon` d'Obsidian, donc la même silhouette dans les deux hôtes.
		   Un nom inconnu VIDE l'élément et écrit un avertissement : ne rien
		   faire en silence laisserait un bouton vide sans que rien ne dise
		   pourquoi, et c'est exactement le défaut qu'une relecture ne voit pas. */
		setIcon(el, name) {
			poserIcone(el, String(name));
		},
		/* Le catalogue COMPLET, dans la forme du contrat. Obsidian a
		   `getIconIds()` ; ici c'est `Object.keys(icons)`, qui rend du
		   PascalCase — d'où la conversion, sans laquelle le sélecteur listerait
		   2062 noms qu'aucun `setIcon` ne sait rendre. */
		iconNames() {
			return Object.keys(CATALOGUE).map(versNomContrat);
		},
	};
}
