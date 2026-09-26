import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import { t } from "../i18n";
import { badgeDeFichier } from "./file-icons";
import type { AttachmentSource, NoteAttachment } from "./generation-demande";

/* ══════════════════════════════════════════════════════════
   LES CARTES DE PIÈCES JOINTES DU COMPOSER DE « GÉNÉRER », et la lecture
   IMMÉDIATE d'un PDF (référence claude.ai, 2026-09-26) : la carte paraît
   au choix du fichier, avec son nom et une roue ; la première page la
   remplace dès qu'elle est dessinée ; le texte se lit derrière. Tant qu'un
   document est en lecture ou en échec, rien ne part (`canGenerate`, ai.ts) :
   une demande ne doit jamais partir en ignorant un document en silence.
══════════════════════════════════════════════════════════ */

/** Clé d'identité d'une pièce jointe : origine + chemin quand il existe, nom
    sinon. Calculée en UN SEUL endroit et réutilisée à tous les points
    d'ajout — la régression corrigée ici venait précisément d'un
    dédoublonnage recopié à la main à chaque appelant, divergent entre
    `path` et `name`. */
export function attachmentKey(a: { source: AttachmentSource; path?: string; name: string }): string {
	return a.source + ":" + (a.path || a.name);
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
	/** Toute la carte d'une pièce : son contenu et sa croix. */
	peindreCarte(chip: HTMLElement, note: NoteAttachment): void;
	/** Joint un PDF : la carte d'abord, les octets (`lire`) ensuite. La
	    promesse se résout à la fin de la lecture du texte — le préréglage
	    d'un dossier l'attend avant d'envoyer. */
	joindrePdf(nom: string, lire: () => Promise<Uint8Array>, source: AttachmentSource, path?: string): Promise<void>;
}

/** Le contenu d'une carte : la première page en image pour un PDF dessiné,
    sinon le nom sur deux lignes ; le badge d'extension ; le tooltip porte
    le chemin entier. */
function poserCarte(chip: HTMLElement, note: NoteAttachment): void {
	chip.title = note.path || note.name;
	/* En LECTURE : la roue discrète de claude.ai, par-dessus le nom (ou la
	   page, dès qu'elle est dessinée). En ÉCHEC : le message sur la carte
	   même, et ce qu'il faut faire pour envoyer ; la croix le retire. */
	if (note.lecture === "cours") {
		chip.classList.add("qbd-ai-note-chip--lecture");
		ajouter(chip, "span", "qbd-install-spinner qbd-ai-note-chip-spinner").setAttribute("aria-label", t("ai.attach.reading"));
	} else if (note.lecture === "erreur") {
		chip.classList.add("qbd-ai-note-chip--erreur");
		chip.title = `${note.name} — ${note.erreurLecture ?? ""} ${t("ai.attach.removeToSend")}`;
	}
	if (note.thumb && note.lecture !== "erreur") {
		/* La page SEULE, posée dans la carte : ni badge ni nom par-dessus
		   (retour Ahmed 2026-09-17, référence claude.ai). Sa forme — paysage
		   ou portrait — est ce qu'on lit d'un coup d'œil, et le nom vit dans
		   l'infobulle et dans l'aperçu. */
		chip.classList.add("qbd-ai-note-chip--thumb");
		const img = ajouter(chip, "img", "qbd-ai-note-chip-thumb");
		img.src = note.thumb;
		img.alt = note.name;
		img.draggable = false;
		return;
	}
	/* LA FIN DU NOM RESTE VISIBLE, quelle que soit sa longueur (retour Ahmed
	   2026-09-17, référence claude.ai). Un nom court s'affiche tel quel ; un
	   nom long est coupé AU MILIEU : la tête sur une ligne avec ses points de
	   suspension, la queue — les douze derniers caractères, l'extension
	   comprise — sur la ligne du dessous, jamais tronquée. */
	const nom = ajouter(chip, "span", "qbd-ai-note-chip-name");
	const QUEUE = 12;
	if (note.name.length <= QUEUE + 4) {
		nom.textContent = note.name;
	} else {
		nom.classList.add("qbd-ai-note-chip-name--split");
		ajouter(nom, "span", "qbd-ai-note-chip-name-head", note.name.slice(0, -QUEUE));
		ajouter(nom, "span", "qbd-ai-note-chip-name-tail", note.name.slice(-QUEUE));
	}
	if (note.lecture === "erreur") {
		const erreur = ajouter(chip, "span", "qbd-ai-note-chip-erreur", note.erreurLecture ?? t("ai.attach.readFailed"));
		ajouter(erreur, "span", "qbd-ai-note-chip-erreur-aide", t("ai.attach.removeToSend"));
	}
	ajouter(chip, "span", "qbd-ai-note-chip-badge", badgeDeFichier(note.name));
}

export function creerPiecesJointes(deps: PiecesJointesDeps): PiecesJointes {
	const host = currentHost();
	/* La carte de chaque pièce, pour la repeindre EN PLACE quand sa vignette
	   ou sa lecture arrive : un re-rendu de la page couperait la frappe. */
	const cartes = new WeakMap<NoteAttachment, HTMLElement>();
	/* Les lectures de PDF, UNE à la fois et dans l'ordre des cartes : deux
	   documents lus de front doublent la mémoire pour rien. */
	let lectures: Promise<void> = Promise.resolve();

	function peindreCarte(chip: HTMLElement, note: NoteAttachment): void {
		chip.replaceChildren();
		chip.className = "qbd-ai-note-chip";
		cartes.set(note, chip);
		poserCarte(chip, note);
		// Le clic ouvre l'aperçu (ai.ts) — pas tant que le document n'est pas lu.
		chip.classList.toggle("qbd-ai-note-chip--toggle", !note.lecture);
		const retirer = ajouter(chip, "button", "qbd-ai-note-chip-remove");
		host.ui.setIcon(retirer, "x");
		retirer.addEventListener("click", (e) => {
			e.stopPropagation(); // n'ouvre pas l'aperçu
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
				   (La vignette à la largeur de la carte, 2×, le CSS ramène.) */
				void pdf.renderPages?.(bytes, { width: 124, max: 1 }).then(r => {
					note.thumb = r.pages[0];
					repeindre(note);
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
