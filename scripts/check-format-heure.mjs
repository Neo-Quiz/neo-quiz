/**
 * LE FORMAT DE L'HEURE — le noyau pur qui relit le réglage `timeFormat`
 * depuis une valeur BRUTE (`apps/windows/src/ui/format-heure.ts`,
 * `lireFormatHeure`), et les options d'Intl qu'il commande (`hourOptions`,
 * src/i18n.ts). 24 h par défaut : tout ce qui n'est pas « 12h » vaut 24 h,
 * jamais une erreur au démarrage.
 *
 *     npm run check:format-heure
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/format-heure.ts", ({ lireFormatHeure }) => {
	const r = makeReporter("Format de l'heure — lireFormatHeure");
	r.check("absent : 24h", lireFormatHeure(undefined), "24h");
	r.check("null : 24h", lireFormatHeure(null), "24h");
	r.check("« 12h » : 12h", lireFormatHeure("12h"), "12h");
	r.check("« 24h » : 24h", lireFormatHeure("24h"), "24h");
	r.check("une valeur inconnue : 24h", lireFormatHeure("ampm"), "24h");
	r.check("la casse compte (« 12H ») : 24h", lireFormatHeure("12H"), "24h");
	r.check("un booléen (ancien hour12) : 24h", lireFormatHeure(true), "24h");
	r.done();
});

await withSrcModule("src/i18n.ts", ({ hourOptions }) => {
	const r = makeReporter("Format de l'heure — hourOptions");
	const soir = new Date(2026, 8, 23, 18, 35);
	const nuit = new Date(2026, 8, 23, 0, 5);
	const heure = (lang, cycle, d) => new Intl.DateTimeFormat(lang, { minute: "2-digit", ...hourOptions(cycle) }).format(d);
	r.check("24 h en anglais : 18:35", heure("en-US", "24h", soir), "18:35");
	r.check("24 h en français : 18:35", heure("fr-FR", "24h", soir), "18:35");
	r.check("24 h après minuit : 00:05, jamais 24:05", heure("en-US", "24h", nuit), "00:05");
	r.check("12 h en anglais : 6:35 PM, sans zéro devant", heure("en-US", "12h", soir).replace(/ /g, " "), "6:35 PM");
	r.check("par défaut (aucun réglage lu) : 24 h", heure("en-US", undefined, soir), "18:35");
	r.done();
});
