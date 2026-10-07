/**
 * L'ENTRÉE D'UNE VUE SE TERMINE — `markViewEnter` (src/dashboard/view-enter.ts)
 * et les règles CSS qu'elle gouverne.
 *
 * Ce que ce script empêche (Ahmed, 2026-09-17) : une carte de dossier qui
 * SAUTE de 0 à -3 px au survol, en une seule image, malgré son
 * `transition: transform .2s`. La chaîne était la suivante : le chemin du
 * dossier défile en boucle INFINIE dans le pied de la carte ; `markViewEnter`
 * attendait qu'aucune animation ne tourne plus dans la vue pour retirer la
 * classe d'entrée ; elle ne tombait donc plus jamais ; et une animation
 * d'entrée terminée mais en `fill: both` reste propriétaire de `transform`,
 * si bien qu'un changement de la valeur de base (le survol) s'applique sans
 * transition. Les cartes de quiz, dans un dossier ouvert sans rail qui
 * défile, glissaient normalement — d'où « seulement les dossiers ».
 *
 * Deux couches, chacune vérifiée pour elle-même :
 *   1. `markViewEnter` n'attend que les animations qui PEUVENT finir : une
 *      animation à itérations infinies n'est jamais une entrée.
 *   2. Aucune animation posée sous une classe d'entrée (`.qbd-*-enter`) ne
 *      garde ses propriétés après sa fin : `backwards`, jamais `both` ni
 *      `forwards`. Même si la classe restait, les transitions resteraient
 *      possibles.
 *
 *     npm run check:view-enter
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* ── 1. Le retrait de la classe d'entrée ─────────────────────────────── */

/* `CSSAnimation` est un global du navigateur : `markViewEnter` le teste par
   `instanceof`. Le double ne porte que ce qu'elle lit — l'état, le nom et
   la durée d'itération de l'effet. */
class CSSAnimation {
	constructor(animationName, playState, iterations = 1) {
		this.animationName = animationName;
		this.playState = playState;
		this.effect = { getTiming: () => ({ iterations }) };
	}
}
globalThis.CSSAnimation = CSSAnimation;

/* Le conteneur d'une vue, réduit à ce que `markViewEnter` touche. */
class FauxConteneur {
	constructor(animations) {
		this.classes = new Set();
		this.ecouteurs = new Map();
		this.animations = animations;
		this.appels = 0;
		this.classList = {
			toggle: (c, force) => { force ? this.classes.add(c) : this.classes.delete(c); },
			remove: (c) => { this.classes.delete(c); },
		};
	}
	addEventListener(type, fn) { this.ecouteurs.set(type, fn); }
	removeEventListener(type) { this.ecouteurs.delete(type); }
	getAnimations() { this.appels++; return this.animations; }
	/** Simule l'`animationend` d'UNE animation : elle passe à « finished ». */
	finir(nom) {
		for (const a of this.animations) if (a.animationName === nom) a.playState = "finished";
		this.ecouteurs.get("animationend")?.({ animationName: nom });
	}
	get aLaClasse() { return this.classes.has("qbd-quizzes-enter"); }
}

await withSrcModule("src/dashboard/view-enter.ts", ({ markViewEnter }) => {
	const r = makeReporter("Entrée d'une vue — markViewEnter");

	{
		const c = new FauxConteneur([new CSSAnimation("qbd-folder-card-in", "running")]);
		markViewEnter(c, true, "qbd-quizzes-enter");
		r.check("posée à l'entrée", c.aLaClasse, true);
		c.finir("qbd-folder-card-in");
		r.check("retirée quand la seule entrée finit", c.aLaClasse, false);
		r.check("l'écouteur est décroché", c.ecouteurs.has("animationend"), false);
	}
	{
		/* LE CAS DE L'INCIDENT : le rail du chemin tourne pour toujours. */
		const c = new FauxConteneur([
			new CSSAnimation("qbd-folder-card-in", "running"),
			new CSSAnimation("animation-infinie-de-test", "running", Infinity),
		]);
		markViewEnter(c, true, "qbd-quizzes-enter");
		c.finir("qbd-folder-card-in");
		r.check("retirée malgré une animation INFINIE encore en cours", c.aLaClasse, false);
	}
	{
		/* La cascade : deux cartes, la seconde finit après la première. */
		const c = new FauxConteneur([
			new CSSAnimation("qbd-folder-card-in", "running"),
			new CSSAnimation("qbd-folder-card-in", "running"),
			new CSSAnimation("animation-infinie-de-test", "running", Infinity),
		]);
		markViewEnter(c, true, "qbd-quizzes-enter");
		c.animations[0].playState = "finished";
		c.ecouteurs.get("animationend")({ animationName: "qbd-folder-card-in" });
		r.check("gardée tant qu'une entrée FINIE tourne encore", c.aLaClasse, true);
		c.finir("qbd-folder-card-in");
		r.check("retirée quand la dernière entrée finit", c.aLaClasse, false);
	}
	{
		/* LA CASCADE NE COÛTE PAS UNE PASSE DE STYLE PAR CARTE (audit téléphone,
		   2026-10-07) : `getAnimations({ subtree })` vide le style de tout le
		   sous-arbre ; appelé à chaque `animationend`, une page de 20 cartes
		   décalées l'exécutait 20 fois PENDANT l'entrée (tâches de 50 à 100 ms
		   à 6x). Premier événement = un relevé, puis seulement `playState`,
		   et un dernier relevé pour confirmer la fin. */
		const cartes = Array.from({ length: 20 }, () => new CSSAnimation("qbd-folder-card-in", "running"));
		const c = new FauxConteneur(cartes);
		markViewEnter(c, true, "qbd-quizzes-enter");
		for (const carte of cartes.slice(0, 19)) { carte.playState = "finished"; c.ecouteurs.get("animationend")({ animationName: "qbd-folder-card-in" }); }
		r.check("gardée tant que la 20e carte tourne", c.aLaClasse, true);
		r.check("19 fins de cartes : UN relevé, pas 19", c.appels, 1);
		c.finir("qbd-folder-card-in");
		r.check("retirée à la dernière carte", c.aLaClasse, false);
		r.check("… après un seul relevé de confirmation de plus", c.appels, 2);
	}
	{
		const c = new FauxConteneur([new CSSAnimation("qbd-folder-card-in", "running")]);
		markViewEnter(c, true, "qbd-quizzes-enter");
		c.ecouteurs.get("animationend")({ animationName: "spin" });
		r.check("un animationend étranger (hors qbd-) est ignoré", c.aLaClasse, true);
	}
	{
		const c = new FauxConteneur([]);
		c.classes.add("qbd-quizzes-enter");
		markViewEnter(c, false, "qbd-quizzes-enter");
		r.check("un re-render (entering=false) retire la classe résiduelle", c.aLaClasse, false);
		r.check("… sans poser d'écouteur", c.ecouteurs.size, 0);
	}

	r.done();
});

/* ── 2. Les animations d'entrée ne tiennent rien après leur fin ──────── */

const DOSSIER_CSS = "src/assets/css/dashboard";
const r2 = makeReporter("Entrée d'une vue — fill-mode des animations sous .qbd-*-enter");
const fautives = [];
for (const fichier of readdirSync(DOSSIER_CSS).filter((f) => f.endsWith(".css"))) {
	const css = readFileSync(join(DOSSIER_CSS, fichier), "utf8");
	/* Chaque bloc `sélecteur { déclarations }` ; on ne retient que ceux dont
	   le sélecteur porte une classe d'entrée et dont une déclaration
	   `animation` demande à garder l'état final. */
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selecteur = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
		if (!/\.qbd-[a-z-]*-enter\b/.test(selecteur)) continue;
		for (const decl of m[2].matchAll(/animation(?:-fill-mode)?\s*:\s*([^;]+);/g)) {
			if (/\b(both|forwards)\b/.test(decl[1])) fautives.push(`${fichier} : ${selecteur.replace(/\s+/g, " ")} → ${decl[0].trim()}`);
		}
	}
}
r2.check("aucune animation sous .qbd-*-enter en `both` ni `forwards`", fautives, []);
r2.done();
