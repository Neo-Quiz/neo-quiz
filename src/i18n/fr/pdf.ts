import type { EN_PDF } from "../en/pdf";

export const FR_PDF: Record<keyof typeof EN_PDF, string> = {
	"pdf.chip.open": "Ouvrir {name}",
	"pdf.chip.missing": "Introuvable : {name}",
	"pdf.chip.list": "Sources",
	"pdf.cite.open": "Ouvrir la source",
	"pdf.viewer.page": "Page {page} / {total}",
	"pdf.viewer.zoomIn": "Agrandir",
	"pdf.viewer.zoomOut": "Réduire",
	"pdf.viewer.loading": "Ouverture du document...",
	"pdf.viewer.error": "Ce PDF n'a pas pu être ouvert.",
	"pdf.viewer.unsupported": "Cet appareil ne peut pas afficher de PDF.",
	"pdf.viewer.notFound": "Le fichier {name} est introuvable.",
};
