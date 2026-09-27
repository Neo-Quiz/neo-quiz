/* ══════════════════════════════════════════════════════════
   LE FOND D'ÉCRAN — LE NOYAU PUR

   Deux fonctions sans `pont()` ni DOM, éprouvées par
   `scripts/check-fond.mjs` sur le module réel — même patron que
   `reprise.ts` (`lireDerniereVue`) et `mise-a-jour.ts` : ce qui peut être
   pur DOIT l'être, pour être éprouvé sans fenêtre ni Electron.
══════════════════════════════════════════════════════════ */

/** Les extensions qu'une image de fond peut porter, casse ignorée — les
    mêmes formats que `chromium` affiche nativement en `background-image`.
    Pas `.svg` : un SVG hostile posé dans le dossier choisi pourrait embarquer
    du script, alors qu'un fond d'écran n'a besoin d'aucune interactivité. */
export const EXTENSIONS_FOND: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

/** Vrai si `nom` porte une extension de fond reconnue. Sur le DERNIER point
    du nom, casse ignorée ; un nom vide ou sans extension n'est jamais une
    image de fond. */
export function estImageDeFond(nom: string): boolean {
	const s = String(nom ?? "");
	const point = s.lastIndexOf(".");
	if (point <= 0) return false;
	return EXTENSIONS_FOND.has(s.slice(point + 1).toLowerCase());
}

/**
 * LA LUMINOSITÉ ET LE FLOU DU FOND (2026-09-26), réglables comme dans Neo
 * Calendar (`themes/wallpaperEffects.ts`, mêmes bornes) et dans Obsidian.
 * Ils agissent sur l'IMAGE seule (`shell.css`, `body::before`) : la lueur et
 * le panneau se posent par-dessus, inchangés.
 *
 * Défauts plus clairs que ceux de Neo Calendar (0,7 et 5 px) : la première
 * version du panneau central a été jugée « trop sombre ».
 */
export interface EffetsFond {
	/** Facteur de `brightness()`, de 0 (noir) à 1 (l'image telle quelle). */
	luminosite: number;
	/** Rayon de `blur()`, en pixels, de 0 à 20. */
	flou: number;
}

export const EFFETS_FOND_DEFAUT: Readonly<EffetsFond> = { luminosite: 0.85, flou: 4 };

export const BORNES_EFFETS_FOND: Readonly<Record<keyof EffetsFond, { min: number; max: number }>> = {
	luminosite: { min: 0, max: 1 },
	flou: { min: 0, max: 20 },
};

/** Une valeur : un NOMBRE fini, ramené dans ses bornes ; autre chose (absent,
    chaîne, `NaN`, `Infinity`) retombe sur le défaut — une valeur écrite par
    une version antérieure ou trafiquée à la main ne doit rien casser. */
function borner(cle: keyof EffetsFond, v: unknown): number {
	if (typeof v !== "number" || !Number.isFinite(v)) return EFFETS_FOND_DEFAUT[cle];
	const { min, max } = BORNES_EFFETS_FOND[cle];
	return Math.min(max, Math.max(min, v));
}

/** Relit le réglage BRUT sans lui faire confiance : toujours un objet complet
    et borné, jamais une exception. */
export function normaliserEffetsFond(brut: unknown): EffetsFond {
	const o = brut && typeof brut === "object" ? brut as Record<string, unknown> : {};
	return { luminosite: borner("luminosite", o.luminosite), flou: borner("flou", o.flou) };
}

/**
 * La prochaine image dans l'ordre trié de `noms`, CYCLIQUE : après la
 * dernière revient la première. Si `courante` est absente de `noms` (l'image
 * a disparu du disque), la PREMIÈRE de la liste triée est rendue — c'est
 * aussi la règle que `fond.ts` emploie pour retomber sur une image qui
 * existe encore. `undefined` si `noms` est vide : rien à montrer.
 */
export function suivante(noms: string[], courante: string | undefined): string | undefined {
	const tries = [...noms].sort((a, b) => a.localeCompare(b));
	if (!tries.length) return undefined;
	const i = courante === undefined ? -1 : tries.indexOf(courante);
	if (i === -1) return tries[0];
	return tries[(i + 1) % tries.length];
}
