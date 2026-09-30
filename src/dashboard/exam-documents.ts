/* ══════════════════════════════════════════════════════════
   THE DOCUMENTS AN EXAM COVERS (2026-09-30)

   Once an exam is picked in the "/exam" menu, a window asks which documents
   it is marked on: every document and note of the exam's course folder,
   and a click joins it to the request, as "@CM1.pdf" would. A joined one
   shows its check; the list stays open to pick several (CM1, CM2, CM3, not
   CM4), and "Done" closes it.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { lireContenuDossier } from "./folder-contents";
import { badgeDeFichier, couperNomAuMilieu, fileIcon } from "./file-icons";

export function ouvrirDocumentsExam(opts: {
	examen: string;
	/** The course folder (contract path); absent: the window says so. */
	dossier?: string;
	estQuiz(path: string): boolean;
	/** The paths already joined to the request. */
	joints(): string[];
	joindre(path: string): Promise<void>;
}): void {
	const host = currentHost();
	const modal = requireHost("modals").open({
		className: "qbd-exam-docs-modal",
		title: t("ai.exam.docsTitle", { exam: opts.examen }),
		onOpen: (m) => {
			ajouter(m.contentEl, "p", "qbd-exam-docs-aide", t("ai.exam.docsHint"));
			const liste = ajouter(m.contentEl, "div", "qbd-exam-docs-liste");
			const actions = ajouter(m.contentEl, "div", "qbd-exam-docs-actions");
			const fini = ajouter(actions, "button", "qb-btn", t("ai.exam.docsDone"));
			fini.type = "button";
			fini.addEventListener("click", () => modal.close());

			if (!opts.dossier) {
				ajouter(liste, "div", "qbd-exam-docs-vide", t("ai.exam.docsNoFolder"));
				return;
			}
			ajouter(liste, "div", "qbd-exam-docs-vide", t("ai.attach.reading"));
			void lireContenuDossier(opts.dossier, opts.estQuiz).then(contenu => {
				liste.replaceChildren();
				const fichiers = [...contenu.documents, ...contenu.notes];
				if (fichiers.length === 0) { ajouter(liste, "div", "qbd-exam-docs-vide", t("ai.exam.docsEmpty")); return; }
				for (const f of fichiers) {
					const b = ajouter(liste, "button", "qbd-exam-docs-item");
					b.type = "button";
					const joint = (): boolean => opts.joints().includes(f.path);
					const peindre = (): void => {
						b.classList.toggle("is-joint", joint());
						b.setAttribute("aria-pressed", String(joint()));
						host.ui.setIcon(icone, joint() ? "circle-check" : fileIcon(f.name));
					};
					const icone = ajouter(b, "span", "qbd-exam-docs-icone");
					// The name cut in the MIDDLE: the extension always shows.
					const { tete, queue } = couperNomAuMilieu(f.name);
					const nom = ajouter(b, "span", "qbd-exam-docs-nom");
					ajouter(nom, "span", "qbd-exam-docs-tete", tete);
					if (queue) ajouter(nom, "span", undefined, queue);
					ajouter(b, "span", "qbd-ai-note-chip-badge", badgeDeFichier(f.name));
					peindre();
					b.addEventListener("click", () => {
						if (joint()) return;
						b.disabled = true;
						void opts.joindre(f.path).finally(() => { b.disabled = false; peindre(); });
					});
				}
			});
		},
	});
}
