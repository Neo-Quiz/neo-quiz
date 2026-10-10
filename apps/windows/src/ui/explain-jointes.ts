/* ══════════════════════════════════════════════════════════
   WHAT THE LEARNER ATTACHES TO AN "EXPLAIN" MESSAGE (2026-10-10)

   Pictures pasted with Ctrl+V or picked, and documents (PDF, .md, .txt)
   picked with "+" or named with "@". Same cards and same PDF reading as
   the Generate page's composer (`composer-attachments.ts`). They wait in
   the composer until the message leaves; `prendre()` then hands them to
   the message and empties the composer.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { attachmentKey, creerPiecesJointes, entrerVignette, poserCroix, poserImage } from "../../../../src/dashboard/composer-attachments";
import type { NoteAttachment } from "../../../../src/dashboard/generation-demande";
import type { ImagePayload } from "../../../../src/dashboard/ai-client";
import { enBase64 } from "./explain-cours";

/** The longest text ONE attached document adds to a message: the whole
    conversation goes again with every message. */
const DOCUMENT_MAX_CHARS = 40_000;

const IMAGE_MIME: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
	webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
};

interface ImageEleve { file: File; url: string }

/** What a message takes with it when it leaves. */
export interface PiecesMessage {
	/** The pictures, for the CLI. */
	images: ImagePayload[];
	/** Their names, in the same order (`learner-picture-N.ext`). */
	nomsImages: string[];
	/** Their object URLs, for the message bubble (revoked with the conversation). */
	urls: string[];
	/** The documents' names, for the bubble. */
	nomsDocuments: string[];
	/** The documents' text, one `--- name ---` section each ("" without any). */
	texte: string;
}

export interface JointesExplain {
	/** Pasted or picked files: pictures, PDF, .md, .txt; anything else is refused with a notice. */
	ajouterFichiers(files: File[]): Promise<void>;
	/** A file named with "@" (vault path) or picked natively (absolute path). */
	joindreChemin(path: string, source: "vault" | "external"): Promise<void>;
	/** The "+" menu's "Add files": the native dialog, else an `<input type="file">`. */
	choisirFichiers(): void;
	/** Paints the cards into `zone` (the composer's `.qbd-ai-composer-pieces`). */
	peindre(zone: HTMLElement): void;
	vide(): boolean;
	/** False while a PDF is being read or failed: nothing may leave. */
	pret(): boolean;
	/** Takes everything for the message that leaves; `rang` = pictures already sent in this conversation. */
	prendre(rang: number): Promise<PiecesMessage>;
	/** Drops everything (the quiz page goes). */
	liberer(): void;
}

function nomDe(path: string): string {
	return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** The type of a file read from disk: a File without a type would not be routed. */
function typeDe(name: string): string {
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	return IMAGE_MIME[ext] ?? (ext === "md" || ext === "txt" ? "text/plain" : "application/octet-stream");
}

export function creerJointesExplain(deps: { rendre(): void }): JointesExplain {
	const host = currentHost();
	let images: ImageEleve[] = [];
	let notes: NoteAttachment[] = [];
	const pieces = creerPiecesJointes({ notes: () => notes, rendre: deps.rendre, majEnvoi: deps.rendre });

	async function ajouterFichiers(files: File[], origine?: { source: "vault" | "external"; path: string }): Promise<void> {
		const refuses: string[] = [];
		const source = origine?.source ?? "file";
		for (const file of files) {
			if (file.type.startsWith("image/")) {
				images.push({ file, url: URL.createObjectURL(file) });
			} else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
				// The card shows at once, the reading follows (`joindrePdf`).
				void pieces.joindrePdf(file.name, async () => new Uint8Array(await file.arrayBuffer()), source, origine?.path);
			} else if (/\.(md|txt)$/i.test(file.name) || file.type === "text/plain") {
				const cle = attachmentKey({ source, path: origine?.path, name: file.name });
				if (notes.some(n => attachmentKey(n) === cle)) { host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.name })); continue; }
				try { notes.push({ name: file.name, content: await file.text(), path: origine?.path, source }); }
				catch { refuses.push(file.name); }
			} else {
				refuses.push(file.name);
			}
		}
		if (refuses.length) host.ui.notice(t("ai.notice.unsupportedFormat", { files: refuses.join(", ") }));
		deps.rendre();
	}

	async function joindreChemin(path: string, source: "vault" | "external"): Promise<void> {
		const nom = nomDe(path);
		const lire = (): Promise<Uint8Array> => source === "vault" ? host.fs.readBinary(path) : host.fs.externe.readBinary(path);
		// A PDF: its card BEFORE the disk read.
		if (/\.pdf$/i.test(nom)) { await pieces.joindrePdf(nom, lire, source, path); return; }
		try {
			const octets = await lire();
			// `slice()`: a Uint8Array over a shared buffer is not a BlobPart.
			await ajouterFichiers([new File([octets.slice()], nom, { type: typeDe(nom) })], { source, path });
		} catch {
			host.ui.notice(t("ai.notice.noteReadFailed", { name: nom }));
		}
	}

	function choisirFichiers(): void {
		const natif = host.fs.externe.pickFiles;
		if (natif) {
			void natif("documents").then(chemins => Promise.all(chemins.map(c => joindreChemin(c, "external"))));
			return;
		}
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = "image/*,.pdf,.md,.txt";
		input.addEventListener("change", () => { void ajouterFichiers(Array.from(input.files ?? [])); }, { once: true });
		input.click();
	}

	function peindre(zone: HTMLElement): void {
		zone.replaceChildren();
		/* `style.display`, not `hidden`: the zone's own CSS display would win over `[hidden]`. */
		zone.style.display = images.length || notes.length ? "" : "none";
		if (!images.length && !notes.length) return;
		const contenu = ajouter(zone, "div", "qbd-ai-composer-pieces-contenu");
		const rangee = ajouter(contenu, "div", "qbd-ai-composer-chips qbd-ai-composer-chips--stacked");
		for (const image of images) {
			const chip = ajouter(rangee, "div", "qbd-ai-note-chip");
			chip.classList.add("qbd-ai-note-chip--prete", "qbd-ai-note-chip--thumb", "qbd-ai-note-chip--image");
			chip.title = image.file.name;
			entrerVignette(chip, image);
			poserImage(chip, image, image.url, image.file.name);
			poserCroix(chip, image.file.name, () => {
				images = images.filter(i => i !== image);
				URL.revokeObjectURL(image.url);
				deps.rendre();
			});
		}
		for (const note of notes) pieces.peindreCarte(ajouter(rangee, "div", "qbd-ai-note-chip"), note);
	}

	async function prendre(rang: number): Promise<PiecesMessage> {
		const prises = images;
		const docs = notes;
		images = [];
		notes = [];
		deps.rendre();
		const payloads: ImagePayload[] = [];
		const nomsImages: string[] = [];
		for (const [i, im] of prises.entries()) {
			payloads.push({ base64: enBase64(new Uint8Array(await im.file.arrayBuffer())), mediaType: im.file.type });
			nomsImages.push(`learner-picture-${rang + i + 1}.${im.file.type.split("/")[1] || "png"}`);
		}
		const texte = docs.map(n => {
			const corps = n.content.length > DOCUMENT_MAX_CHARS ? n.content.slice(0, DOCUMENT_MAX_CHARS) + "\n[cut]" : n.content;
			return `--- ${n.name} ---\n${corps}`;
		}).join("\n\n");
		return { images: payloads, nomsImages, urls: prises.map(p => p.url), nomsDocuments: docs.map(n => n.name), texte };
	}

	function liberer(): void {
		for (const im of images) URL.revokeObjectURL(im.url);
		images = [];
		notes = [];
	}

	return {
		ajouterFichiers: (files) => ajouterFichiers(files),
		joindreChemin,
		choisirFichiers,
		peindre,
		vide: () => images.length === 0 && notes.length === 0,
		pret: () => notes.every(n => !n.lecture),
		prendre,
		liberer,
	};
}
