/* ══════════════════════════════════════════════════════════
   LE TEXTE D'UN PDF — la partie PURE

   Reçoit le moteur pdf.js, rend le texte. Séparée du câblage (`./pdf.ts`)
   pour la même raison que `roots.ts` ou `platform.ts` : `pdf.ts` importe le
   worker par `?url`, une syntaxe de Vite que le harnais des scripts de
   contrôle (esbuild, hors fenêtre) ne sait pas charger. Ce module-ci, lui,
   se charge partout, et `npm run check:pdf` l'éprouve avec le build Node
   (`pdfjs-dist/legacy`) sur de vrais PDF.

   LE FORMAT DE SORTIE EST CELUI QU'A TOUJOURS PRODUIT L'EXTRACTION (l'ancien greffon, jusqu'à
   `be9559f`, par le pdf.js embarqué d'Obsidian) : les mots
   d'une page joints par une espace, les pages par une ligne vide. C'est ce
   que le prompt de génération a toujours reçu ; en changer ferait produire à
   l'application un autre quiz que le greffon pour le même cours.
══════════════════════════════════════════════════════════ */

/** Surface MINIMALE de pdf.js — la même que l'hôte Obsidian typait. Un type
    structurel et non celui de `pdfjs-dist` : le build Node (`legacy`) et le
    build navigateur exposent la même surface sous deux déclarations. */
export interface PdfTextItem { str?: string }
export interface PdfViewport { width: number; height: number }
export interface PdfPage {
	getTextContent(): Promise<{ items: PdfTextItem[] }>;
	/* Le DESSIN d'une page (`./pdf.ts`, `renderPages`) : optionnels ici pour
	   que le moteur factice du script de contrôle, qui ne dessine rien, reste
	   un `PdfJsLib`. Les deux builds de pdfjs-dist les portent. */
	getViewport?(opts: { scale: number }): PdfViewport;
	render?(params: { canvas: HTMLCanvasElement; viewport: PdfViewport }): { promise: Promise<void> };
}
export interface PdfDocument {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	/** Libère le document (pdf.js en garde sinon les pages en mémoire). */
	destroy(): Promise<void>;
}
export interface PdfJsLib {
	getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

/**
 * Le texte de toutes les pages, une section par page — chaîne vide pour un
 * PDF scanné (sans couche texte), que l'appelant signale (`ai.ts`).
 *
 * `destroy()` dans un `finally` : un PDF de cours fait quarante pages, et un
 * document non libéré à chaque pièce jointe finit par peser dans la fenêtre
 * sans jamais être vu.
 */
/**
 * Ouvre un document SANS CONSOMMER les octets de l'appelant.
 *
 * `getDocument` envoie le tampon au worker dans sa LISTE DE TRANSFERT
 * (`pdf.mjs` : `sendWithPromise("GetDocRequest", docParams, [data.buffer])`) :
 * au retour, le `Uint8Array` de l'appelant est DÉTACHÉ, sa longueur tombe à
 * zéro, et tout usage suivant échoue sur « Cannot transfer object of
 * unsupported type » (mesuré le 2026-09-17 sur un cours de 3,4 Mo). Le premier
 * usage réussissait donc toujours, et les suivants jamais : le texte sortait,
 * la vignette puis l'aperçu non — sur un PDF que la page garde en mémoire
 * exprès pour le rouvrir.
 *
 * La copie est le prix du droit de relire : quelques mégaoctets le temps d'un
 * rendu. ICI et nulle part ailleurs : les deux entrées du moteur (le texte,
 * les pages) passent par cette fonction.
 */
export async function ouvrirDocument(pdfjs: PdfJsLib, data: Uint8Array): Promise<PdfDocument> {
	return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
}

export async function texteDesPages(pdfjs: PdfJsLib, data: Uint8Array): Promise<string> {
	const doc = await ouvrirDocument(pdfjs, data);
	try {
		const pages: string[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const contenu = await page.getTextContent();
			pages.push(contenu.items.map(it => it.str ?? "").join(" "));
		}
		/* Only a document ENTIRELY empty gives "" (the signal of a scan); a
		   blank page in the middle of a course stays an empty section.
		   Each page opens with its number, "[p. 3]" (2026-09-30): a Learn
		   cites the pages each reading comes from, and the model only knows
		   them from these marks. */
		if (!pages.some(p => p.trim())) return "";
		return pages.map((p, i) => `[p. ${i + 1}]\n${p}`).join("\n\n").trim();
	} finally {
		await doc.destroy();
	}
}
