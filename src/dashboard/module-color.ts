/* ══════════════════════════════════════════════════════════
   MODULE COLOR — source unique de l'identité colorée d'un module
   (design handoff « folder cards 6a », Ahmed 2026-07-18). Chaque
   dossier a un accent : la couleur CHOISIE dans « Modifier dossier »
   (override) si elle existe, sinon une couleur DÉRIVÉE STABLE du nom
   (hash → palette) — « choisies par l'utilisateur ou dérivées » du
   handoff : chaque matière garde une identité même sans choix. Tout
   le reste (tile-bg, icon-bg, bordures, lueur) se dérive en CSS de
   --accent via color-mix ; ce module ne fournit QUE l'accent.
══════════════════════════════════════════════════════════ */

/** Palette partagée : les 8 pastilles du color picker (« Modifier dossier »).
    Couleur choisie ET couleur dérivée puisent dans le même jeu → un ensemble
    cohérent, qu'elle soit imposée ou automatique. */
export const MODULE_PALETTE = [
	"#4573ff", "#14b8a6", "#10b981", "#84cc16",
	"#f59e0b", "#ef4466", "#d946ef", "#8b5cf6",
];

/** Hash déterministe d'une chaîne → index de palette (djb2-like). Stable :
    le même dossier retombe toujours sur la même couleur d'un rendu à l'autre. */
export function hashAccent(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return MODULE_PALETTE[h % MODULE_PALETTE.length];
}

/** The colours of the course tiles of the owner's former Moodle plugin
    (`dashboard-tiles.css`), keyed by module-code PREFIX: every module of one
    kind of code shares one colour by default (2026-10-10). XTI is the
    plugin's development blue, XCS its professional violet, XMUT its language
    sky blue. */
const CODE_ACCENTS: Record<string, string> = {
	XTI: "#3b82f6", XCS: "#8b5cf6", XMUT: "#38bdf8", XSM: "#22c55e", LXP: "#a855f7",
};
/** The rest of that plugin's palette, for a prefix it never had. */
const CODE_PALETTE = ["#3b82f6", "#22c55e", "#8b5cf6", "#0ea5e9", "#f43f5e", "#38bdf8", "#6366f1", "#a855f7"];

/** The letters of a module code at the start of a name ("XTI303 - Cloud" gives
    "XTI"), or null when the name does not start with a code. A path is read
    by its last segment. */
export function codePrefix(name: string): string | null {
	const m = /^([A-Za-z]{2,6})\d{2,4}(?![A-Za-z0-9])/.exec((name.split("/").pop() ?? "").trim());
	return m ? m[1].toUpperCase() : null;
}

/** The default colour of a module whose name starts with a code: one per
    prefix, the same for every module of that kind; null without a code. */
export function codeAccent(name: string): string | null {
	const prefixe = codePrefix(name);
	if (!prefixe) return null;
	if (CODE_ACCENTS[prefixe]) return CODE_ACCENTS[prefixe];
	let h = 0;
	for (let i = 0; i < prefixe.length; i++) h = (h * 31 + prefixe.charCodeAt(i)) >>> 0;
	return CODE_PALETTE[h % CODE_PALETTE.length];
}

/** L'accent du SAS des quiz générés (demande Ahmed 2026-09-17) : le bleu de
    la palette, le premier — celui de la carte « Créer un dossier vide » et de
    l'accent de l'application. Une couleur choisie à la main l'emporte. */
export const GENERATED_MODULE_ACCENT = MODULE_PALETTE[0];

/** The effective accent of a module: the chosen colour (override) wins, then
    the blue of the generated-quiz folder, then the colour of its code prefix
    (`codeAccent`), and only then the colour derived from the folder name. */
export function moduleAccent(m: { folder: string; color?: string }, opts?: { generated?: boolean }): string {
	return m.color || (opts?.generated ? GENERATED_MODULE_ACCENT : codeAccent(m.folder) ?? hashAccent(m.folder));
}
