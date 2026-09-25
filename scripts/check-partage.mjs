/**
 * LE PARTAGE, côté principal (`apps/windows/electron/partage.ts`), ses
 * fonctions PURES. Ce qu'il empêche : un nom venu de la fenêtre qui serait un
 * CHEMIN (`..\..\Startup\x.zip`) et écrirait hors du dossier temporaire ;
 * une extension hors de la liste (`.bat`) ; un contenu vide ou démesuré ; et
 * une apostrophe dans le nom qui fermerait la chaîne du script PowerShell et
 * y ferait exécuter la suite.
 *     npm run check:partage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/partage.ts", ({ nomPartage, octetsPartage, citerPs, scriptDiscord, TAILLE_MAX_PARTAGE }) => {
	const r = makeReporter("Partage — noms, contenus, script");
	r.check("un nom de zip ordinaire passe tel quel", nomPartage("XTI301 - Écosystème Python.zip"), "XTI301 - Écosystème Python.zip");
	r.check("un .md passe", nomPartage("CM1.md"), "CM1.md");
	r.check("les séparateurs deviennent des tirets : un nom, jamais un chemin",
		nomPartage(String.raw`..\..\Startup\x.zip`), "-..-Startup-x.zip");
	r.check("un séparateur « / » aussi", nomPartage("a/b.zip"), "a-b.zip");
	r.check("une extension hors liste est refusée", nomPartage("x.bat"), null);
	r.check("l'extension compte même en majuscules", nomPartage("x.ZIP"), "x.ZIP");
	r.check("sans extension, refusé", nomPartage("zip"), null);
	r.check("un point final ne cache pas une autre extension", nomPartage("x.bat."), null);
	r.check("pas une chaîne, refusé", nomPartage(42), null);
	r.check("vide, refusé", nomPartage(""), null);
	r.check("trop long, refusé", nomPartage("a".repeat(200) + ".zip"), null);
	r.check("des octets ordinaires passent", octetsPartage(new Uint8Array([1, 2]))?.length, 2);
	r.check("vide, refusé", octetsPartage(new Uint8Array(0)), null);
	r.check("au-delà de la borne, refusé", octetsPartage(new Uint8Array(TAILLE_MAX_PARTAGE + 1)), null);
	r.check("un tableau ordinaire n'est pas un contenu", octetsPartage([1, 2]), null);
	r.check("l'apostrophe est doublée", citerPs(String.raw`C:\T\l'an.zip`), String.raw`'C:\T\l''an.zip'`);
	const s = scriptDiscord(String.raw`C:\T\a'; Remove-Item x; '.zip`);
	r.check("le chemin du script reste UNE chaîne",
		s.includes(String.raw`Set-Clipboard -LiteralPath 'C:\T\a''; Remove-Item x; ''.zip'`), true);
	r.done();
});
