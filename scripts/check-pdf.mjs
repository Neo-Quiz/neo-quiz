/**
 * LE TEXTE D'UN PDF — l'extraction de l'application (`apps/windows/src/host/
 * pdf-texte.ts`), avec le VRAI moteur (`pdfjs-dist`, build Node « legacy »,
 * le même paquet que la fenêtre charge) sur des PDF fabriqués ici.
 *
 * Ce que ce script empêche : que « Créer avec l'IA » depuis un dossier de
 * cours joigne un PDF au texte VIDE ou aux pages FONDUES sans que rien ne
 * le dise. Le prompt de génération a toujours reçu « les mots d'une page
 * joints par une espace, les pages par une ligne vide » (le format de
 * l'ancien greffon jusqu'à `be9559f`) ; un moteur ou une
 * mise à jour de `pdfjs-dist` qui changerait ce format ferait produire à
 * l'application un autre quiz qu'avant pour le même cours.
 *
 * Les PDF sont ÉCRITS PAR LE SCRIPT (un fichier de deux pages, un fichier
 * sans couche texte) : aucun fichier binaire au dépôt, aucun vault requis,
 * donc ça tourne dans la CI. Le worker, lui (`?worker`, Vite), ne s'éprouve
 * qu'à l'écran — `npm run check:app` prouve seulement qu'il se construit.
 *
 *     npm run check:pdf
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
/* Le build « legacy » est celui qui tourne sous Node sans DOM ; la fenêtre
   charge `pdfjs-dist` tout court (le build navigateur). Même version, même
   `getTextContent` — c'est la surface que `pdf-texte.ts` type. */
const pdfjs = await import(pathToFileURL(join(racine, "apps/windows/node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
/* Le moteur avertit « Ensure that the `standardFontDataUrl` API parameter is
   provided » sur chaque PDF qui emploie une des quatorze polices standard
   (Helvetica ici, et la plupart des cours) : il voudrait les DESSINER. Le
   texte, lui, sort entier sans elles — c'est ce que les cas ci-dessous
   prouvent. L'avertissement est du bruit, pas un échec : juger le script
   sur son code de sortie. */

/**
 * Un PDF minimal, écrit à la main : `pages` est une liste de textes (une
 * entrée par page ; `null` = page sans contenu). Les décalages de la table
 * `xref` sont CALCULÉS, pas approximés : pdf.js sait reconstruire une table
 * fausse, mais un test qui repose sur sa tolérance ne prouve rien.
 */
function fabriquerPdf(pages) {
	const objets = [];
	const ajouter = (corps) => { objets.push(corps); return objets.length; };
	const font = ajouter("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	const idsPages = [];
	const idPagesNoeud = objets.length + 1 + pages.length * 2; // réservé plus bas
	for (const texte of pages) {
		let contenu = "";
		if (texte !== null && typeof texte === "object") {
			// A page given as its raw content stream (the figure cases below).
			contenu = texte.contenu;
		} else if (texte !== null) {
			/* UN seul opérateur Tj par page : pdf.js fusionne ou sépare les
			   opérateurs voisins selon leurs positions, et ce découpage-là est
			   le sien, pas le nôtre. Ce qu'on éprouve ici est la SÉPARATION DES
			   PAGES et le signal du scanné — pas la segmentation en mots. */
			contenu = `BT /F1 12 Tf 40 700 Td (${texte}) Tj ET`;
		}
		const flux = ajouter(`<< /Length ${Buffer.byteLength(contenu, "latin1")} >>\nstream\n${contenu}\nendstream`);
		const page = ajouter(`<< /Type /Page /Parent ${idPagesNoeud} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${flux} 0 R >>`);
		idsPages.push(page);
	}
	const noeud = ajouter(`<< /Type /Pages /Kids [${idsPages.map(id => `${id} 0 R`).join(" ")}] /Count ${idsPages.length} >>`);
	if (noeud !== idPagesNoeud) throw new Error(`numérotation des objets : attendu ${idPagesNoeud}, obtenu ${noeud}`);
	const catalogue = ajouter(`<< /Type /Catalog /Pages ${noeud} 0 R >>`);

	let sortie = "%PDF-1.4\n";
	const decalages = [];
	objets.forEach((corps, i) => {
		decalages.push(Buffer.byteLength(sortie, "latin1"));
		sortie += `${i + 1} 0 obj\n${corps}\nendobj\n`;
	});
	const xref = Buffer.byteLength(sortie, "latin1");
	sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
	for (const d of decalages) sortie += `${String(d).padStart(10, "0")} 00000 n \n`;
	sortie += `trailer\n<< /Size ${objets.length + 1} /Root ${catalogue} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(sortie, "latin1"));
}

await withSrcModule("apps/windows/src/host/pdf-texte.ts", async ({ texteDesPages, ouvrirDocument }) => {
	const r = makeReporter("PDF — le texte des pages");

	const deuxPages = await texteDesPages(pdfjs, fabriquerPdf(["Introduction a Python", "Les listes et les tuples"]));
	r.check("words joined by a space, pages by an empty line, each page opened by its number",
		deuxPages, "[p. 1]\nIntroduction a Python\n\n[p. 2]\nLes listes et les tuples");

	const scanne = await texteDesPages(pdfjs, fabriquerPdf([null, null]));
	r.check("un PDF sans couche texte rend la chaîne vide — le signal du scanné", scanne, "");

	const trou = await texteDesPages(pdfjs, fabriquerPdf(["Avant", null, "Apres"]));
	r.check("une page blanche au milieu reste une section vide, pas une page perdue",
		trou, "[p. 1]\nAvant\n\n[p. 2]\n\n\n[p. 3]\nApres");

	/* LES OCTETS DE L'APPELANT SURVIVENT — le défaut du 2026-09-17, vu à
	   l'écran (« This PDF could not be drawn », après un texte pourtant
	   extrait). `getDocument` envoie le tampon au worker dans sa LISTE DE
	   TRANSFERT : sans copie, le `Uint8Array` de l'appelant est DÉTACHÉ au
	   retour (longueur 0), et tout usage suivant échoue. La page « Générer »
	   garde les octets d'un PDF EXPRÈS pour le rouvrir (vignette, aperçu) :
	   le premier usage marchait toujours, les suivants jamais. */
	{
		const octets = fabriquerPdf(["Une page"]);
		const taille = octets.byteLength;
		await texteDesPages(pdfjs, octets);
		r.check("après une extraction, les octets de l'appelant sont intacts", octets.byteLength, taille);
		const encore = await texteDesPages(pdfjs, octets);
		r.check("… et un second usage des MÊMES octets rend le même texte", encore, "[p. 1]\nUne page");
		const doc = await ouvrirDocument(pdfjs, octets);
		r.check("… y compris par ouvrirDocument, la porte des deux entrées", doc.numPages, 1);
		await doc.destroy();
		r.check("… qui laisse lui aussi les octets intacts", octets.byteLength, taille);
	}

	/* Le document est LIBÉRÉ même quand une page échoue : un `getPage` qui
	   rejette ne doit pas laisser le document en mémoire. Éprouvé sur un
	   moteur factice, la seule façon de faire échouer une page à coup sûr. */
	let detruit = false;
	const factice = {
		getDocument: () => ({ promise: Promise.resolve({
			numPages: 1,
			getPage: () => Promise.reject(new Error("page illisible")),
			destroy: async () => { detruit = true; },
		}) }),
	};
	await texteDesPages(factice, new Uint8Array()).catch(() => {});
	r.check("le document est libéré même si une page échoue", detruit, true);

	r.done();
});

/* WHERE THE FIGURE IS (`pdf-figure.ts`, 2026-10-08), on pages drawn here and
   read by the real engine: a title, a rule under it, a paragraph, then a
   drawing of two boxes joined by a line (the second placed by a `cm`
   matrix, as a PDF often does), a short label above it, a multiplicity
   inside, and the question written just under it. The figure is the drawing
   and its labels, never the title, the rule, the paragraph or the question. */
await withSrcModule("apps/windows/src/host/pdf-figure.ts", async ({ zoneDeFigure }) => {
	const r = makeReporter("PDF — where the figure is");
	const zone = async (contenu) => {
		const doc = await pdfjs.getDocument({ data: fabriquerPdf([{ contenu }]), verbosity: 0 }).promise;
		try {
			const page = await doc.getPage(1);
			return zoneDeFigure(await page.getOperatorList(), pdfjs.OPS, (await page.getTextContent()).items, page.view);
		} finally { await doc.destroy(); }
	};
	const texte = (x, y, s) => `BT /F1 10 Tf ${x} ${y} Td (${s}) Tj ET`;
	const page = [
		texte(40, 780, "Dossier 3 Heritage composition et modele metier"),
		"40 772 m 555 772 l S",
		texte(40, 740, "Une commande contient des lignes qui lui sont exclusivement rattachees."),
		"100 500 200 100 re S",
		"q 1 0 0 1 50 0 cm 300 500 150 100 re S Q",
		"300 550 m 350 550 l S",
		texte(100, 606, "Vue A"),
		texte(305, 555, "1..*"),
		texte(40, 490, "1"),
		texte(52, 490, "Quelles conclusions sur les losanges sont defendables ?"),
	].join("\n");
	const z = await zone(page);
	const arrondi = z && z.map(v => Math.round(v));
	r.check("the drawing, placed through its cm, with a margin", arrondi && [arrondi[0], arrondi[1], arrondi[2]], [94, 494, 506]);
	r.check("… its label above included, the title, rule and paragraph not", !!z && z[3] >= 614 && z[3] < 640, true);
	r.check("… the question under it left out, its number too", !!z && z[1] > 490, true);
	r.check("a page of text only has no figure", await zone([texte(40, 780, "Titre"), texte(40, 760, "Un paragraphe de texte.")].join("\n")), null);
	r.check("a background over the whole page is no figure", await zone(["0 0 595 842 re f", texte(40, 760, "Texte")].join("\n")), null);
	r.check("a drawing too small to matter (a check box) is no figure", await zone(["500 800 8 8 re S", texte(40, 760, "Texte")].join("\n")), null);
	r.check("a long arrow is part of the drawing, not a rule",
		(await zone(["100 500 50 50 re S", "150 525 m 450 525 l S", "450 500 50 50 re S"].join("\n")))?.map(v => Math.round(v)), [94, 494, 506, 556]);
	r.done();
});