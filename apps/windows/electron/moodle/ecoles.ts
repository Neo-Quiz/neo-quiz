/* Schools with a public Moodle that Neo Quiz can sign in to (see `compat.ts`
   for the exact rule: mobile web service enabled AND a browser/embedded
   launch login). Verified on 2026-10-07 by `verifierSite` against each
   school's public configuration (one token-less read request, no login):
   173 candidate sites tried, 31 kept. Efrei first, then by name.
   A school's host is allowed BY CODE (`garde.ts`), like the default site; the
   list holds no personal data. Re-run the check before adding an entry. */

export interface Ecole { name: string; city: string; url: string }

export const ECOLES: readonly Ecole[] = [
	{ name: "Efrei", city: "Paris / Villejuif", url: "https://moodle.myefrei.fr" },
	{ name: "ENSEA", city: "Cergy", url: "https://moodle.ensea.fr" },
	{ name: "EPITA", city: "Le Kremlin-Bicêtre", url: "https://moodle.epita.fr" },
	{ name: "ESIEA", city: "Paris / Laval", url: "https://moodle.esiea.fr" },
	{ name: "Grenoble École de Management", city: "Grenoble", url: "https://moodle.grenoble-em.com" },
	{ name: "Grenoble INP", city: "Grenoble", url: "https://moodle.grenoble-inp.fr" },
	{ name: "IMT Atlantique", city: "Brest / Nantes", url: "https://moodle.imt-atlantique.fr" },
	{ name: "INSA Lyon", city: "Villeurbanne", url: "https://moodle.insa-lyon.fr" },
	{ name: "INSA Rouen Normandie", city: "Rouen", url: "https://moodle.insa-rouen.fr" },
	{ name: "INSA Strasbourg", city: "Strasbourg", url: "https://moodle.insa-strasbourg.fr" },
	{ name: "INSA Toulouse", city: "Toulouse", url: "https://moodle.insa-toulouse.fr" },
	{ name: "Nantes Université", city: "Nantes", url: "https://madoc.univ-nantes.fr" },
	{ name: "Sorbonne Université", city: "Paris", url: "https://moodle.sorbonne-universite.fr" },
	{ name: "Université Bretagne Sud", city: "Lorient", url: "https://moodle.univ-ubs.fr" },
	{ name: "Université d'Angers", city: "Angers", url: "https://moodle.univ-angers.fr" },
	{ name: "Université d'Orléans", city: "Orléans", url: "https://celene.univ-orleans.fr" },
	{ name: "Université de Bordeaux", city: "Bordeaux", url: "https://moodle.u-bordeaux.fr" },
	{ name: "Université de Franche-Comté", city: "Besançon", url: "https://moodle.univ-fcomte.fr" },
	{ name: "Université de Strasbourg", city: "Strasbourg", url: "https://moodle.unistra.fr" },
	{ name: "Université de Technologie de Belfort", city: "Belfort", url: "https://moodle.utbm.fr" },
	{ name: "Université de Technologie de Compiègne", city: "Compiègne", url: "https://moodle.utc.fr" },
	{ name: "Université de Toulon", city: "Toulon", url: "https://moodle.univ-tln.fr" },
	{ name: "Université du Littoral", city: "Dunkerque", url: "https://moodle.univ-littoral.fr" },
	{ name: "Université Lyon 2", city: "Lyon", url: "https://moodle.univ-lyon2.fr" },
	{ name: "Université Lyon 3", city: "Lyon", url: "https://moodle.univ-lyon3.fr" },
	{ name: "Université Paris 8", city: "Saint-Denis", url: "https://moodle.univ-paris8.fr" },
	{ name: "Université Paul-Valéry Montpellier 3", city: "Montpellier", url: "https://moodle.univ-montp3.fr" },
	{ name: "Université Polytechnique", city: "Valenciennes", url: "https://moodle.uphf.fr" },
	{ name: "Université Savoie Mont Blanc", city: "Chambéry", url: "https://moodle.univ-smb.fr" },
	{ name: "Université Sorbonne Paris Nord", city: "Villetaneuse", url: "https://moodle.univ-spn.fr" },
	{ name: "UTT", city: "Troyes", url: "https://moodle.utt.fr" },
];

export const ECOLES_ORIGINES: ReadonlySet<string> = new Set(ECOLES.map(e => e.url));
