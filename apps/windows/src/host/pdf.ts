/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LE TEXTE D'UN PDF (`HostPdf`)

   Posé le 2026-09-17, à la demande d'Ahmed (« B pour les PDF ») : jusque-là
   l'application REFUSAIT un PDF joint (`ai.error.pdfUnsupportedInApp`), parce
   que le greffon se servait du pdf.js EMBARQUÉ d'Obsidian et que la fenêtre
   n'en avait pas. Les cours de l'Efrei sont des PDF ; sans ce membre, « Créer
   avec l'IA » depuis un dossier de cours n'aurait rien à joindre.

   `pdfjs-dist`, chargé À LA DEMANDE (`import()` dynamique) : le moteur pèse
   quelques centaines de Ko et ne sert qu'à la page « Générer », quand un PDF
   est joint. Le démarrage de la fenêtre ne le paie pas.

   LE WORKER PASSE PAR `?worker`, PAS PAR `?url` — et c'est le point fragile
   de pdf.js sous Electron. Avec `workerSrc`, pdf.js fait lui-même
   `new Worker(url, { type: "module" })` : un worker de MODULE, depuis une
   page chargée en `file://` par `loadFile`, avec une origine opaque — ce que
   Chromium refuse ou tolère selon la version, et rien ne le dit avant
   l'écran. `?worker` laisse Vite construire le worker en script CLASSIQUE
   (format `iife` du build) et résoudre son chemin par rapport au bundle ;
   on en fait UN `PDFWorker` à nous, passé à chaque `getDocument` — voir
   `charger()` pour ce que coûtait le port global.

   La LOGIQUE d'extraction vit dans `./pdf-texte.ts`, pure, éprouvée par
   `npm run check:pdf` sur le build Node du même moteur. Ici : le chargement,
   et rien d'autre.
══════════════════════════════════════════════════════════ */

import type { HostPdf } from "../../../../src/host/types";
import { ouvrirDocument, texteDesPages } from "./pdf-texte";
import { zoneDeFigure } from "./pdf-figure";
import type { Boite, CodesOps, ListeOps, TexteSurPage } from "./pdf-figure";
import type { PdfJsLib } from "./pdf-texte";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

export function createWindowsPdf(): HostPdf {
	/* UNE seule promesse de moteur, gardée : deux PDF joints coup sur coup ne
	   chargent pas deux fois le module, et un échec de chargement se rejoue
	   au prochain appel (la promesse rejetée est oubliée). */
	let moteur: Promise<PdfJsLib> | null = null;
	/** pdf.js's operator codes, kept when the engine loads (`zoneDeFigure`). */
	let ops: CodesOps | null = null;
	const charger = (): Promise<PdfJsLib> => {
		if (!moteur) {
			moteur = import("pdfjs-dist").then(pdfjs => {
				/* UN `PDFWorker` À NOUS, passé à chaque `getDocument`, et non
				   `GlobalWorkerOptions.workerPort` (vu à l'écran le 2026-09-17,
				   « This PDF could not be drawn », après un texte pourtant extrait).
				   Avec le port global, chaque `getDocument` sans `worker` CRÉE son
				   `PDFWorker` sur le port et le POSSÈDE : `doc.destroy()` — que
				   `texteDesPages` appelle dans son `finally`, à raison — le détruit
				   avec le document. Le deuxième usage du même port, la vignette,
				   repartait sur un canal mort : le texte sortait, jamais l'image.
				   Un worker fourni par l'appelant n'appartient à aucun document
				   (`task._worker` n'est posé que quand `getDocument` l'a créé
				   lui-même), et survit à tous leurs `destroy()`. */
				/* `PDFWorker.create` et non `new` : la déclaration du constructeur
				   type `port` en `null` (une erreur de la `.d.ts`), celle de
				   `create` en `Worker` — même code derrière. */
				const worker = pdfjs.PDFWorker.create({ port: new PdfWorker() });
				ops = pdfjs.OPS as unknown as CodesOps;
				const lib: PdfJsLib = {
					/* La COPIE des octets, elle, vit dans `ouvrirDocument`
					   (`./pdf-texte.ts`, pur et éprouvé par `check:pdf`) : c'est la
					   seule porte des deux entrées du moteur, et c'est là que la règle
					   se garde. Ici, rien que le worker. */
					getDocument: (src) => pdfjs.getDocument({ ...src, worker }) as unknown as ReturnType<PdfJsLib["getDocument"]>,
				};
				return lib;
			}).catch(e => { moteur = null; throw e; });
		}
		return moteur;
	};
	/** The page's figure alone, as a PNG `data:` URL, or null (no figure found,
	    or an engine without operator lists). */
	async function dessinerFigure(page: PageDessinable, largeur: number): Promise<string | null> {
		if (!ops || !page.getOperatorList || !page.view) return null;
		const zone = zoneDeFigure(await page.getOperatorList(), ops, (await page.getTextContent()).items, page.view as Boite);
		if (!zone) return null;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		// A small drawing is enlarged, up to three times its printed size.
		const echelle = Math.min(3, largeur / (zone[2] - zone[0])) * dpr;
		const plein = page.getViewport({ scale: echelle });
		const [ax, ay, bx, by] = plein.convertToViewportRectangle(zone);
		const x = Math.min(ax, bx), y = Math.min(ay, by);
		const viewport = page.getViewport({ scale: echelle, offsetX: -x, offsetY: -y });
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(Math.abs(bx - ax));
		canvas.height = Math.ceil(Math.abs(by - ay));
		await page.render({ canvas, viewport }).promise;
		const url = canvas.toDataURL("image/png");
		canvas.width = 0;
		canvas.height = 0;
		return url;
	}
	return {
		async extractText(data) {
			return texteDesPages(await charger(), data);
		},
		/* Les pages en IMAGES, pour la vignette d'une carte et l'aperçu d'une
		   modale (Ahmed, 2026-09-17, référence claude.ai). Un canvas par page,
		   à la largeur demandée — l'échelle se déduit de la première page, et
		   les suivantes la gardent : un document aux pages de tailles mixtes
		   défile à largeur constante, comme dans un lecteur. PNG et non JPEG :
		   des diapos de cours sont du texte sur fond uni, le JPEG les baverait
		   pour un gain de poids sans intérêt sur des `data:` URL en mémoire.
		   `destroy()` dans le `finally`, comme pour le texte. */
		async renderPages(data, opts) {
			const pdfjs = await charger();
			const doc = await ouvrirDocument(pdfjs, data);
			try {
				const total = doc.numPages;
				const premiere = Math.max(1, Math.floor(opts.first ?? 1));
				const derniere = Math.min(total, premiere - 1 + Math.max(0, opts.max ?? total));
				const pages: string[] = [];
				let echelle: number | null = null;
				for (let i = premiere; i <= derniere; i++) {
					const page = await doc.getPage(i);
					if (!page.getViewport || !page.render) break;
					/* A FIGURE (2026-10-08): only the drawing of the page, found by
					   `zoneDeFigure`, at the requested width; the whole page when it
					   finds none. */
					if (opts.figure) {
						const figure = await dessinerFigure(page as unknown as PageDessinable, opts.width);
						if (figure) { pages.push(figure); continue; }
					}
					if (echelle === null) echelle = opts.width / page.getViewport({ scale: 1 }).width;
					/* Le facteur d'écran entre dans l'ÉCHELLE : une vignette dessinée
					   en 1× sur un écran 2× sort floue. Le canvas est plus grand, le
					   CSS le ramène à la largeur demandée. */
					const dpr = Math.min(2, window.devicePixelRatio || 1);
					const viewport = page.getViewport({ scale: echelle * dpr });
					const canvas = document.createElement("canvas");
					canvas.width = Math.ceil(viewport.width);
					canvas.height = Math.ceil(viewport.height);
					/* `canvas`, pas `canvasContext` : pdf.js 5 exige le canvas (le
					   contexte n'est gardé que pour compatibilité, et il faut alors
					   passer `canvas: null` explicitement — sans quoi le rendu rejette,
					   et la vignette manquait en silence, avalée par le `catch` de
					   l'appelant). */
					await page.render({ canvas, viewport }).promise;
					pages.push(canvas.toDataURL("image/png"));
					canvas.width = 0;
					canvas.height = 0;
				}
				return { pages, total };
			} finally {
				await doc.destroy();
			}
		},
	};
}

/** The surface of a pdf.js page that drawing a figure needs. */
interface PageDessinable {
	view?: number[];
	getOperatorList?(): Promise<ListeOps>;
	getTextContent(): Promise<{ items: TexteSurPage[] }>;
	getViewport(opts: { scale: number; offsetX?: number; offsetY?: number }): { width: number; height: number; convertToViewportRectangle(rect: number[]): number[] };
	render(params: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void> };
}
