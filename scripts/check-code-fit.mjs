/**
 * Non-regression of the phone code-block size (src/code-fit.ts).
 *
 * On a phone a code block shrinks so its longest line fits, down to 11 px, and
 * a two-finger pinch sets one size between 11 and 22 px. These functions decide
 * the size; the DOM glue (apps/windows/src/ui/code-fit.ts) only applies it.
 *
 * The REAL module is loaded (scripts/lib/load-src.mjs), not a copy.
 *
 *     npm run check:code-fit
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/code-fit.ts", ({ fitCodeSize, pinchCodeSize, parseStoredCodeSize, CODE_SIZE_MIN, CODE_SIZE_MAX }) => {
	const r = makeReporter("Taille du code (téléphone)");

	// The bounds the rest of the app relies on.
	r.check("bornes", [CODE_SIZE_MIN, CODE_SIZE_MAX], [11, 22]);

	// Automatic fit: a line that already fits keeps the normal size.
	r.check("ligne qui tient : taille normale", fitCodeSize({ available: 255, measured: 200, reference: 13.5 }), 13.5);
	r.check("ligne juste à la largeur : taille normale", fitCodeSize({ available: 255, measured: 255, reference: 13.5 }), 13.5);
	// Never above the normal size, even when the line is much shorter.
	r.check("jamais au-dessus de la taille normale", fitCodeSize({ available: 1000, measured: 100, reference: 13.5 }), 13.5);

	// A line a little too long shrinks, rounded DOWN to a half pixel so it really fits:
	// 13.5 * 255 / 267 = 12.89 -> 12.5 (13 would overflow).
	r.check("ligne un peu trop longue : arrondie vers le bas", fitCodeSize({ available: 255, measured: 267, reference: 13.5 }), 12.5);
	// A line of 301 px at the normal size, in a 255 px block: the size fits it, and stays in [11, 13.5].
	const fitted = fitCodeSize({ available: 255, measured: 301, reference: 13.5 });
	r.check("ligne de 301 px : taille entre 11 et 13,5", fitted >= 11 && fitted <= 13.5, true);
	r.check("ligne de 301 px : elle tient à la taille trouvée", 301 * fitted / 13.5 <= 255 + 1e-9, true);

	// Below the minimum the block keeps scrolling sideways: the size stops at 11 px.
	r.check("ligne très longue : plancher à 11 px", fitCodeSize({ available: 255, measured: 600, reference: 13.5 }), 11);

	// Degenerate measures never produce NaN or a size out of bounds.
	r.check("largeur disponible nulle : taille normale", fitCodeSize({ available: 0, measured: 300, reference: 13.5 }), 13.5);
	r.check("largeur mesurée nulle : taille normale", fitCodeSize({ available: 255, measured: 0, reference: 13.5 }), 13.5);

	// Every fitted size keeps its line inside the width, over a spread of cases.
	let overflow = 0;
	for (let measured = 120; measured <= 900; measured += 7) {
		const size = fitCodeSize({ available: 255, measured, reference: 13.5 });
		if (size > 11 && measured * size / 13.5 > 255 + 1e-9) overflow++;
	}
	r.check("aucune ligne ne déborde au-dessus du plancher", overflow, 0);

	// Pinch: the start size times the spread of the fingers, kept in [11, 22].
	r.check("pincement : même écartement, taille inchangée", pinchCodeSize(13.5, 1), 13.5);
	r.check("pincement : écarter agrandit", pinchCodeSize(13.5, 1.1), 14.5);
	r.check("pincement : rapprocher réduit (13,5 x 0,9 = 12,15 -> 12,0)", pinchCodeSize(13.5, 0.9), 12);
	r.check("pincement : plafond à 22 px", pinchCodeSize(13.5, 2), 22);
	r.check("pincement : plancher à 11 px", pinchCodeSize(13.5, 0.5), 11);
	r.check("pincement : écartement nul ou absurde", pinchCodeSize(13.5, Number.NaN), 13.5);

	// The remembered size: a damaged stored value is no choice at all.
	r.check("mémoire absente", parseStoredCodeSize(null), null);
	r.check("mémoire vide", parseStoredCodeSize(""), null);
	r.check("mémoire abîmée", parseStoredCodeSize("grand"), null);
	r.check("mémoire hors bornes (trop petit)", parseStoredCodeSize("10"), null);
	r.check("mémoire hors bornes (trop grand)", parseStoredCodeSize("23"), null);
	r.check("mémoire valide", parseStoredCodeSize("15"), 15);
	r.check("mémoire valide, demi-pixel", parseStoredCodeSize("12.7"), 12.5);

	r.done();
});
