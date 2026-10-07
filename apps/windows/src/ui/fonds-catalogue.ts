/* ══════════════════════════════════════════════════════════
   LES FONDS D'ÉCRAN EMBARQUÉS

   TRENTE-CINQ PHOTOS, CINQ PAR SUJET. Le fonds de départ est celui de Neo
   Calendar (son `themes/wallpapers.ts`), dans sa seule version PAYSAGE :
   l'autre moitié du catalogue là-bas est recadrée pour un téléphone, et une
   photo verticale sur une fenêtre de bureau donne deux bandes de part et
   d'autre. Les rayons incomplets ont été remplis depuis Unsplash, en écartant
   ce qui ne fait pas un bon fond : un sujet humain au premier plan, et surtout
   les DOUBLONS de lieu — deux vues de Monument Valley candidates ont été
   retirées parce que le catalogue en avait déjà une.

   ELLES SONT DANS L'APPLICATION, pas téléchargées : un fond qui n'arrive
   qu'avec le réseau laisse l'écran nu au premier lancement, précisément là où
   l'application doit ressembler à quelque chose. Les fichiers vivent dans
   `public/fonds/` (servis à `/fonds/<id>.jpg`, comme le `/wallpaper.jpg` qui
   était jusqu'ici le seul fond de l'application), et chacun a une VIGNETTE de
   quelques dizaines de kilo-octets dans `public/fonds/vignettes/` : la grille
   des Réglages en montre vingt à la fois, et vingt pleines résolutions
   feraient seize mégaoctets décodés pour des images larges de 96 pixels.

   CE QUE ÇA COÛTE, ET C'EST ASSUMÉ : environ 25 Mo dans l'installeur et dans
   chaque mise à jour complète — 2560 × 1440, la définition d'un écran, pas
   celle de l'original. C'est le prix d'une application qui a l'air finie à la
   première ouverture, sans dossier à choisir ni réseau à attendre. C'est aussi
   ce que `MAX_PAR_CATEGORIE` borne : sans plafond, le catalogue grossit d'une
   photo à la fois et personne ne voit passer le seuil.

   LE CRÉDIT N'EST PAS DÉCORATIF. Ces photos viennent d'Unsplash, dont la
   licence demande de citer l'auteur là où c'est raisonnable. Le nom voyage
   donc avec l'image, jusqu'à l'infobulle de sa vignette.
══════════════════════════════════════════════════════════ */

/** Ce qui range vingt photos en groupes qu'on parcourt des yeux. L'ordre de
    cette liste est celui des groupes à l'écran : les montagnes d'abord, parce
    qu'elles sont les plus nombreuses et que la première rangée est celle qu'on
    regarde. */
export const CATEGORIES_FOND = ["mountains", "forest", "ocean", "autumn", "night", "desert", "city"] as const;

/**
 * Le plafond par catégorie, TENU PAR UN CONTRÔLE (`npm run check:fond`).
 *
 * Ce n'est pas une limite d'affichage — la liste ne coupe rien, elle montre ce
 * qui est livré. C'est une limite de CATALOGUE : chaque photo pèse environ
 * 800 ko dans l'installeur et dans chaque mise à jour, et un rayon de dix
 * montagnes ne se choisit pas mieux qu'un de cinq. Dépasser doit donc faire
 * rougir un contrôle, pas se découvrir à la lecture d'une liste trop longue.
 */
export const MAX_PAR_CATEGORIE = 5;

export type CategorieFond = (typeof CATEGORIES_FOND)[number];

export interface FondEmbarque {
	/** Le nom du fichier, sans extension : `/fonds/<id>.jpg`. */
	id: string;
	auteur: string;
	/** La page Unsplash de l'original. */
	page: string;
	categorie: CategorieFond;
}

export const FONDS_EMBARQUES: readonly FondEmbarque[] = [
	{ id: "cloudlaced-ranges", auteur: "Nicolas Prieto", page: "https://unsplash.com/photos/chaines-de-montagnes-couvertes-de-nuages-sMJaf08ugD0", categorie: "mountains" },
	{ id: "panorama-valley", auteur: "Daniel Seßler", page: "https://unsplash.com/photos/une-vue-panoramique-dune-vallee-avec-des-montagnes-en-arriere-plan-yVkwJVCAnXs", categorie: "mountains" },
	{ id: "golden-snow-range", auteur: "Marek Piwnicki", page: "https://unsplash.com/photos/majestueuses-montagnes-enneigees-baignees-dun-soleil-dore-VksMwErxR9c", categorie: "mountains" },
	{ id: "cloudveil-fjord", auteur: "Marek Piwnicki", page: "https://unsplash.com/photos/fjord-entoure-de-montagnes-spectaculaires-couvertes-de-nuages-jMPwiaqRXzI", categorie: "mountains" },
	{ id: "golden-summit", auteur: "Marek Piwnicki", page: "https://unsplash.com/photos/un-sommet-enneige-baigne-dun-soleil-dore-E909Oe4N3pM", categorie: "mountains" },
	{ id: "violet-forest-bloom", auteur: "Uran Wang", page: "https://unsplash.com/photos/la-lumiere-du-soleil-traverse-les-arbres-jusqua-un-champ-de-fleurs-violettes-TVORvlpH2ZY", categorie: "forest" },
	{ id: "white-forest-flowers", auteur: "Kasia Gajek", page: "https://unsplash.com/photos/fleurs-blanches-dans-la-foret-pendant-la-journee-Dpf1iwtX2Yo", categorie: "forest" },
	{ id: "fog-treeline", auteur: "Paul Pastourmatzis", page: "https://unsplash.com/photos/silhouette-of-trees-covered-by-fog-KT3WlrL_bsg", categorie: "forest" },
	{ id: "pines-in-mist", auteur: "Dan Otis", page: "https://unsplash.com/photos/aerial-view-of-pine-trees-in-mist-OYFHT4X5isg", categorie: "forest" },
	{ id: "sunrays-forest", auteur: "Sebastian Unrau", page: "https://unsplash.com/photos/trees-on-forest-with-sun-rays-sp-p7uuT0tw", categorie: "forest" },
	{ id: "whale-tail-cliffs", auteur: "Marek Piwnicki", page: "https://unsplash.com/photos/queue-de-baleine-emergeant-de-leau-sombre-pres-des-falaises-rocheuses-tv8swoH1aOY", categorie: "ocean" },
	{ id: "island-sunset", auteur: "Daniel Seßler", page: "https://unsplash.com/photos/un-magnifique-coucher-de-soleil-sur-une-petite-ile-au-milieu-de-locean-xHxfXRbTG1Y", categorie: "ocean" },
	{ id: "tropical-palm-coast", auteur: "Marcreation", page: "https://unsplash.com/photos/cote-tropicale-diles-avec-des-palmiers-et-une-eau-turquoise-claire-fV_qtB_sTV8", categorie: "ocean" },
	{ id: "coastal-hills-dusk", auteur: "Antonin Fontaine", page: "https://unsplash.com/photos/collines-et-ocean-au-coucher-du-soleil-avec-une-lumiere-chaude-YiRaXIR5Etk", categorie: "ocean" },
	{ id: "turquoise-shallows", auteur: "Rod Long", page: "https://unsplash.com/photos/vue-aerienne-dune-cote-sablonneuse-avec-une-eau-turquoise-peu-profonde-iqBc91jdqoQ", categorie: "ocean" },
	{ id: "gapstow-autumn", auteur: "Juan Di Nella", page: "https://unsplash.com/photos/pont-de-gapstow-a-lautomne-a-new-york-ne1X1c9M0Hg", categorie: "autumn" },
	{ id: "autumn-forest-path", auteur: "Daniel Seßler", page: "https://unsplash.com/photos/chemin-de-terre-a-travers-la-foret-dautomne-_3DI_vx2ygg", categorie: "autumn" },
	{ id: "golden-hour-ridge", auteur: "Artem Sapegin", page: "https://unsplash.com/photos/mountains-and-tree-range-during-golden-hour-8c6eS43iq1o", categorie: "autumn" },
	{ id: "golden-larches", auteur: "Federica Galli", page: "https://unsplash.com/photos/golden-larch-forest-below-mountain-peaks-pF1ug8ysTtY", categorie: "autumn" },
	{ id: "aspen-valley", auteur: "Thomas Morse", page: "https://unsplash.com/photos/mountains-and-golden-aspen-trees-cuKKa0vWZSY", categorie: "autumn" },
	{ id: "milky-way-trail", auteur: "Sebastian Knoll", page: "https://unsplash.com/photos/voie-lactee-sarquant-au-dessus-dun-sentier-rocheux-IPCh5x1whiQ", categorie: "night" },
	{ id: "starlit-snow-peak", auteur: "Benjamin Voros", page: "https://unsplash.com/photos/montagne-enneigee-sous-les-etoiles-phIFdC6lA4E", categorie: "night" },
	{ id: "monument-valley-stars", auteur: "Joseph Corl", page: "https://unsplash.com/photos/voie-lactee-au-dessus-des-buttes-de-la-vallee-du-monument-BMhglVdk3lA", categorie: "night" },
	{ id: "aurora-over-water", auteur: "v2osk", page: "https://unsplash.com/photos/aurora-borealis-Ovn1hyBge38", categorie: "night" },
	{ id: "half-dome-stars", auteur: "Casey Horner", page: "https://unsplash.com/photos/half-dome-under-stars-in-yosemite-O0R5XZfKUGQ", categorie: "night" },
	{ id: "sunlit-canyon", auteur: "NIR HIMI", page: "https://unsplash.com/photos/canyon-desertique-baigne-de-soleil-avec-des-formations-rocheuses-et-une-vegetation-clairsemee-Rv2yB04plX8", categorie: "desert" },
	{ id: "amber-dunes", auteur: "Fabian Struwe", page: "https://unsplash.com/photos/sand-dunes-during-sunset-4cloovdyuvw", categorie: "desert" },
	{ id: "ochre-desert", auteur: "Joe Mania", page: "https://unsplash.com/photos/photo-of-brown-desert-tyAAl6r_c2U", categorie: "desert" },
	{ id: "dune-sunrise", auteur: "Daniel Olah", page: "https://unsplash.com/photos/the-sun-is-setting-over-a-sand-dune-qsuiCIY64Ig", categorie: "desert" },
	{ id: "canyon-dusk", auteur: "Maria Lysenko", page: "https://unsplash.com/photos/the-sun-is-setting-at-the-grand-canyon-b68AjEoB_Dk", categorie: "desert" },
	{ id: "golden-gate-night", auteur: "Justin Wolff", page: "https://unsplash.com/photos/le-golden-gate-bridge-est-illumine-la-nuit-Macs-aqy6Ek", categorie: "city" },
	{ id: "city-from-above", auteur: "Jonathan Roger", page: "https://unsplash.com/photos/aerial-photography-of-city-fPaCAQKkRqY", categorie: "city" },
	{ id: "night-grid", auteur: "Venti Views", page: "https://unsplash.com/photos/aerial-view-of-city-buildings-during-night-time-vahwUn0Uh0E", categorie: "city" },
	{ id: "brooklyn-bridge-night", auteur: "Kai Pilger", page: "https://unsplash.com/photos/landscape-photograph-of-brooklyn-bridge-at-nighttime-LGtJ44QWo_c", categorie: "city" },
	{ id: "harbour-lights", auteur: "Raf Winterpacht", page: "https://unsplash.com/photos/a-view-of-a-city-at-night-from-across-the-water-zpS-yPj1qjU", categorie: "city" },
];

/**
 * Une ressource de l'application, résolue contre la PAGE et non contre la
 * racine du disque.
 *
 * `new URL(relatif, document.baseURI)`, jamais une chaîne qui commence par
 * « / » : l'application packagée charge son rendu en `file://`, où « /fonds/…»
 * désigne `C:/fonds/…` — la racine du DISQUE, où il n'y a rien. Le CSS écrit à
 * la main peut se le permettre (Vite réécrit `url("/wallpaper.jpg")` en
 * `url(../wallpaper.jpg)` à la construction) ; une URL composée en JavaScript à
 * l'exécution, non : rien ne la relit. En développement, la même expression
 * donne `http://localhost:1421/fonds/…`, qui est exactement ce qu'on veut.
 */
function ressourceApp(relatif: string): string {
	return new URL(relatif, document.baseURI).href;
}

/** L'image pleine résolution d'un fond embarqué. */
export function urlFondEmbarque(id: string): string {
	return ressourceApp("fonds/" + id + ".jpg");
}

/** Sa vignette — voir l'en-tête : la grille en montre vingt à la fois. */
export function urlVignetteEmbarquee(id: string): string {
	return ressourceApp("fonds/vignettes/" + id + ".jpg");
}

/** Le fond embarqué de cet identifiant, ou `undefined` : un réglage écrit par
    une version qui en proposait d'autres ne doit pas faire échouer le
    démarrage, il retombe sur le fond par défaut. */
export function fondEmbarque(id: string): FondEmbarque | undefined {
	return FONDS_EMBARQUES.find(f => f.id === id);
}

/**
 * Les fonds GROUPÉS, dans l'ordre de `CATEGORIES_FOND`, catégories vides
 * écartées. PURE : c'est ce que la grille des Réglages parcourt.
 *
 * Vingt vignettes à la suite, c'est un mur : l'œil n'y cherche pas une photo,
 * il la balaie. Groupées, on va au rayon avant de choisir.
 */
export function fondsParCategorie(): Array<{ categorie: CategorieFond; fonds: FondEmbarque[] }> {
	return CATEGORIES_FOND
		.map(categorie => ({ categorie, fonds: FONDS_EMBARQUES.filter(f => f.categorie === categorie) }))
		.filter(groupe => groupe.fonds.length > 0);
}
