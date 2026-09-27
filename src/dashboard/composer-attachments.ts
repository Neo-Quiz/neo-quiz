import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import { t } from "../i18n";
import { badgeDeFichier } from "./file-icons";
import type { AttachmentSource, NoteAttachment } from "./generation-demande";

/* ══════════════════════════════════════════════════════════
   LES VIGNETTES DE PIÈCES JOINTES DU COMPOSER DE « GÉNÉRER », et la lecture
   IMMÉDIATE d'un PDF. Tant qu'un document est en lecture ou en échec, rien
   ne part (`canGenerate`, ai.ts) : une demande ne doit jamais partir en
   ignorant un document en silence.

   LA SÉQUENCE EST CELLE DE CLAUDE.AI (relevé du 2026-09-26, styles calculés
   à chaque mutation — le détail et le tableau sont dans
   `.superpowers/sdd/2026-09-26-edition-dans-le-rendu/pdf-effet-report.md`) :
   1. la vignette EN ATTENTE paraît aussitôt, 120 px, et MONTE en grandissant
      (`scale(.92) translateY(4px)` → rien, 0,18 s) ; son contenu est
      INVISIBLE, un voile blanc à 7,5 % le couvre et un reflet le balaie
      (2 s, linéaire, en boucle) ;
   2. PRÊTE, elle est remplacée sur place par la vignette finale : bord,
      ombre double, la page en image qui passe du flou au net (0,4 s), et
      l'étiquette « pdf » qui entre en fondu (0,3 s).
   Chaque effet ne se joue qu'UNE fois par pièce : la page se redessine en
   entier à chaque ajout (`render`, ai.ts), et une vignette déjà là qui
   remonterait ou se flouterait à nouveau serait un défaut. D'où la mémoire
   `dejaVu`, tenue ICI pour les documents et pour les images d'ai.ts.
══════════════════════════════════════════════════════════ */

/** Clé d'identité d'une pièce jointe : origine + chemin quand il existe, nom
    sinon. Calculée en UN SEUL endroit et réutilisée à tous les points
    d'ajout — la régression corrigée ici venait précisément d'un
    dédoublonnage recopié à la main à chaque appelant, divergent entre
    `path` et `name`. */
export function attachmentKey(a: { source: AttachmentSource; path?: string; name: string }): string {
	return a.source + ":" + (a.path || a.name);
}

/* Ce qui a déjà été MONTRÉ, par pièce (l'objet de la pièce sert de clé ; une
   pièce retirée part avec sa trace) : l'INSTANT de sa première peinture. */
const entrees = new WeakMap<object, number>();
const etiquettes = new WeakMap<object, number>();
const images = new WeakSet<object>();

/** Un effet d'entrée se (re)joue-t-il ? Oui à la première peinture, et
    encore PENDANT sa durée : un ajout redessine la page deux fois de suite
    (l'ajout, puis la lecture qui commence), et le premier élément, bâti,
    n'est jamais affiché — marquer l'effet « joué » dès lui le faisait
    perdre au second, le seul qu'on voit (vu au relevé du 2026-09-26). Passé
    sa durée, l'effet est fini : un rendu de plus ne le rejoue pas. */
export function effetEnCours(debuts: WeakMap<object, number>, cle: object, dureeMs: number): boolean {
	const maintenant = performance.now();
	const debut = debuts.get(cle);
	if (debut === undefined) { debuts.set(cle, maintenant); return true; }
	return maintenant - debut < dureeMs;
}

/** La MONTÉE d'une vignette (0,18 s), à sa première peinture : la classe
    porte le `@starting-style` (CSS), qui ne vaut qu'à la naissance de
    l'élément — une classe posée sur un élément déjà peint ne rejoue rien. */
export function entrerVignette(chip: HTMLElement, cle: object): void {
	if (effetEnCours(entrees, cle, 180)) chip.classList.add("qbd-ai-note-chip--entree");
}

/** L'image d'une vignette finale, qui passe du FLOU AU NET quand elle est
    chargée (claude.ai pose la classe au `load`, pas avant : une image pas
    encore décodée ne doit pas commencer son fondu à vide). Déjà montrée
    une fois, elle paraît nette d'emblée. */
export function poserImage(chip: HTMLElement, cle: object, src: string, alt: string): HTMLImageElement {
	const img = ajouter(chip, "img", "qbd-ai-note-chip-thumb");
	img.alt = alt;
	img.draggable = false;
	if (images.has(cle)) {
		img.classList.add("qbd-ai-note-chip-thumb--nette");
	} else {
		img.addEventListener("load", () => {
			images.add(cle);
			img.classList.add("qbd-ai-note-chip-thumb--nette");
		}, { once: true });
	}
	img.src = src;
	return img;
}

/** La croix de retrait, en haut à droite, à 8 px HORS de la vignette ; son
    nom accessible dans un texte masqué (un `aria-label` ferait doubler
    l'infobulle maison sous Obsidian — cf. `.qbd-sr-only`). */
export function poserCroix(chip: HTMLElement, nom: string, retirer: () => void): HTMLButtonElement {
	const bouton = ajouter(chip, "button", "qbd-ai-note-chip-remove");
	bouton.type = "button";
	currentHost().ui.setIcon(bouton, "x");
	ajouter(bouton, "span", "qbd-sr-only", t("ai.attach.remove", { name: nom }));
	bouton.addEventListener("click", (e) => {
		e.stopPropagation(); // n'ouvre pas l'aperçu
		retirer();
	});
	return bouton;
}

/** Le nom sur DEUX lignes, comme claude.ai : la première se coupe en fin
    de ligne ; la seconde porte la suite du nom, coupée elle aussi, puis
    l'EXTENSION dans son propre élément, jamais coupée (règle n°1 du dépôt :
    le type reste visible, la coupe se fait dans le nom). La première ligne
    s'arrête après une séparation (espace, tiret, soulignement, point)
    placée entre le 8ᵉ et le 15ᵉ caractère, sinon au 14ᵉ — ce que tient la
    ligne à 13 px dans 96 px. */
function poserNom(parent: HTMLElement, name: string): void {
	const point = name.lastIndexOf(".");
	const base = point > 0 ? name.slice(0, point) : name;
	const ext = point > 0 ? name.slice(point) : "";
	const LIGNE = 14;
	let coupe = base.length;
	if (base.length + ext.length > LIGNE + 2) {
		coupe = Math.min(base.length, LIGNE);
		for (let i = LIGNE; i >= 7; i--) {
			if (/[\s\-_.]/.test(base[i] ?? "")) { coupe = i + 1; break; }
		}
	}
	const nom = ajouter(parent, "span", "qbd-ai-note-chip-name");
	if (coupe >= base.length) {
		// Tout tient sur une ligne : le nom, puis son extension à part.
		const l = ajouter(nom, "span", "qbd-ai-note-chip-name-line");
		ajouter(l, "bdi", "qbd-ai-note-chip-name-part", base);
		if (ext) ajouter(l, "span", "qbd-ai-note-chip-name-ext", ext);
		return;
	}
	ajouter(nom, "bdi", "qbd-ai-note-chip-name-part", base.slice(0, coupe));
	const l2 = ajouter(nom, "span", "qbd-ai-note-chip-name-line");
	ajouter(l2, "bdi", "qbd-ai-note-chip-name-part", base.slice(coupe));
	if (ext) ajouter(l2, "span", "qbd-ai-note-chip-name-ext", ext);
}

/** L'étiquette de type, en MINUSCULES (règle du dépôt : jamais de texte en
    capitales ; claude.ai écrit « PDF »). */
function texteEtiquette(name: string): string {
	return badgeDeFichier(name).toLowerCase();
}

export interface PiecesJointesDeps {
	/** La liste VIVANTE des pièces du composer (la page la remplace parfois). */
	notes(): NoteAttachment[];
	/** Redessine la page (une carte ajoutée ou retirée). */
	rendre(): void;
	/** Remet à jour le bouton d'envoi (une lecture vient de finir). */
	majEnvoi(): void;
}

export interface PiecesJointes {
	/** Toute la vignette d'une pièce : son contenu et sa croix. */
	peindreCarte(chip: HTMLElement, note: NoteAttachment): void;
	/** Joint un PDF : la vignette d'abord, les octets (`lire`) ensuite. La
	    promesse se résout à la fin de la lecture du texte — le préréglage
	    d'un dossier l'attend avant d'envoyer. */
	joindrePdf(nom: string, lire: () => Promise<Uint8Array>, source: AttachmentSource, path?: string): Promise<void>;
}

/** La vignette EN ATTENTE : le contenu est là mais invisible (il donne sa
    forme à la vignette, comme chez claude.ai), le voile et son reflet par
    dessus ; `aria-busy` et un texte masqué disent la lecture. */
function poserAttente(chip: HTMLElement, note: NoteAttachment): void {
	chip.classList.add("qbd-ai-note-chip--attente");
	chip.dataset.state = "pending";
	chip.setAttribute("aria-busy", "true");
	const contenu = ajouter(chip, "div", "qbd-ai-note-chip-contenu");
	poserNom(contenu, note.name);
	ajouter(contenu, "span", "qbd-ai-note-chip-tag qbd-ai-note-chip-tag--attente", texteEtiquette(note.name));
	ajouter(chip, "div", "qbd-ai-note-chip-voile");
	ajouter(chip, "span", "qbd-sr-only", t("ai.attach.reading"));
}

/** La vignette PRÊTE : la page en image quand elle est dessinée, sinon le
    nom ; l'étiquette de type en bas, qui entre en fondu à sa première
    apparition. En ÉCHEC, le message sur la vignette même, et ce qu'il faut
    faire pour envoyer ; la croix la retire. */
function poserFinale(chip: HTMLElement, note: NoteAttachment): void {
	chip.classList.add("qbd-ai-note-chip--prete");
	if (note.lecture === "erreur") {
		chip.classList.add("qbd-ai-note-chip--erreur");
		chip.title = `${note.name} — ${note.erreurLecture ?? ""} ${t("ai.attach.removeToSend")}`;
	}
	if (note.thumb && note.lecture !== "erreur") {
		/* La page POSÉE dans la vignette, jamais recadrée (retour Ahmed
		   2026-09-17) : sa forme, paysage ou portrait, est une information. */
		chip.classList.add("qbd-ai-note-chip--thumb");
		poserImage(chip, note, note.thumb, note.name);
	} else {
		const contenu = ajouter(chip, "div", "qbd-ai-note-chip-contenu");
		poserNom(contenu, note.name);
		if (note.lecture === "erreur") {
			const erreur = ajouter(contenu, "span", "qbd-ai-note-chip-erreur", note.erreurLecture ?? t("ai.attach.readFailed"));
			ajouter(erreur, "span", "qbd-ai-note-chip-erreur-aide", t("ai.attach.removeToSend"));
		}
	}
	const bande = ajouter(chip, "div", "qbd-ai-note-chip-bande");
	const tag = ajouter(bande, "span", "qbd-ai-note-chip-tag", texteEtiquette(note.name));
	// Le fondu de l'étiquette (0,3 s), à la première apparition de la
	// vignette PRÊTE.
	if (effetEnCours(etiquettes, note, 300)) tag.classList.add("qbd-ai-note-chip-tag--entree");
}

export function creerPiecesJointes(deps: PiecesJointesDeps): PiecesJointes {
	const host = currentHost();
	/* La vignette de chaque pièce, pour la repeindre EN PLACE quand sa page
	   ou sa lecture arrive : un re-rendu de la page couperait la frappe, et
	   c'est le MÊME élément qui doit passer d'« en attente » à « prête »
	   (sa montée, commencée, se poursuit). */
	const cartes = new WeakMap<NoteAttachment, HTMLElement>();
	/* Les lectures de PDF, UNE à la fois et dans l'ordre des cartes : deux
	   documents lus de front doublent la mémoire pour rien. */
	let lectures: Promise<void> = Promise.resolve();

	function peindreCarte(chip: HTMLElement, note: NoteAttachment): void {
		chip.replaceChildren();
		chip.className = "qbd-ai-note-chip";
		delete chip.dataset.state;
		chip.removeAttribute("aria-busy");
		chip.title = note.path || note.name;
		cartes.set(note, chip);
		entrerVignette(chip, note);
		if (note.lecture === "cours") poserAttente(chip, note);
		else poserFinale(chip, note);
		// Le clic ouvre l'aperçu (ai.ts) — pas tant que le document n'est pas lu.
		chip.classList.toggle("qbd-ai-note-chip--toggle", !note.lecture);
		poserCroix(chip, note.name, () => {
			const notes = deps.notes();
			const i = notes.indexOf(note);
			if (i >= 0) notes.splice(i, 1);
			deps.rendre();
		});
	}

	function repeindre(note: NoteAttachment): void {
		const chip = cartes.get(note);
		if (chip && chip.isConnected) peindreCarte(chip, note);
	}

	function joindrePdf(nom: string, lire: () => Promise<Uint8Array>, source: AttachmentSource, path?: string): Promise<void> {
		/* Le texte d'un PDF vient de l'HÔTE (`host.pdf`, membre OPTIONNEL) :
		   sans lui, on le dit plutôt que de joindre un PDF vide en silence. */
		const pdf = host.pdf;
		if (!pdf) { host.ui.notice(t("ai.error.pdfUnsupportedInApp")); return Promise.resolve(); }
		const cle = attachmentKey({ source, path, name: nom });
		if (deps.notes().some(n => attachmentKey(n) === cle)) {
			host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: nom }));
			return Promise.resolve();
		}
		const note: NoteAttachment = { name: nom, content: "", path, source, lecture: "cours" };
		deps.notes().push(note);
		deps.rendre();
		const suite = lectures.then(async () => {
			if (!deps.notes().includes(note)) return; // retirée avant sa lecture
			try {
				const bytes = await lire();
				note.bytes = bytes;
				/* La vignette n'attend pas le texte, ni le texte la vignette :
				   pdf.js dessine image par image, et une fenêtre en arrière-plan
				   n'en dessine plus aucune — le texte, lui, ne s'arrête pas.
				   Arrivée APRÈS la fin de la lecture, la page remplace le nom
				   dans la vignette finale, avec son fondu flou → net.
				   (La page à 124 px de large pour une vignette de 118 px
				   intérieurs, 2× au plus : le CSS ramène.) */
				void pdf.renderPages?.(bytes, { width: 124, max: 1 }).then(r => {
					note.thumb = r.pages[0];
					if (note.lecture !== "cours") repeindre(note);
				}).catch(e => {
					// NOMMÉ dans la console : une vignette absente sans trace a
					// déjà coûté une matinée (paramètre `canvas` de pdf.js 5).
					console.warn(LOG_PREFIX, "vignette PDF impossible:", nom, e);
				});
				const content = await pdf.extractText(bytes);
				if (content.trim()) { note.content = content; delete note.lecture; }
				else { note.lecture = "erreur"; note.erreurLecture = t("ai.attach.noText"); }
			} catch (e) {
				console.warn(LOG_PREFIX, "lecture PDF impossible:", nom, e);
				note.lecture = "erreur";
				note.erreurLecture = t("ai.attach.readFailed");
			}
			repeindre(note);
			deps.majEnvoi();
		});
		lectures = suite.catch(() => undefined);
		return suite;
	}

	return { peindreCarte, joindrePdf };
}
