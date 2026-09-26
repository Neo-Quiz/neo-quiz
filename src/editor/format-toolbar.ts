import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import type { EditorView } from "@codemirror/view";

/* ══════════════════════════════════════════════════════════
   BARRE DE MISE EN FORME d'un champ multiligne de l'éditeur

   Refonte de l'éditeur (2026-09-26) : la rangée de symboles bruts
   `> < & _ ' " ```` devient une barre d'ICÔNES Lucide, compacte, collée au
   haut du champ. Chaque action d'avant est gardée :
   - le bloc de code (`<pre><code>`) a son bouton ;
   - PAS de caractères spéciaux (`>`, `<`, `&`, espace insécable,
     apostrophe, guillemet) : tous les claviers les ont (retirés le
     2026-09-26).
   S'y ajoutent gras, italique, code et formule, qui ENTOURENT la sélection
   (ou posent la paire et le curseur entre les deux). Dans un champ HTML, les
   balises remplacent le markdown : `**x**` n'y serait pas rendu.
══════════════════════════════════════════════════════════ */

/** Le champ que la barre sert : une `<textarea>` (champs HTML) ou le champ
    à aperçu en direct (sa vue CodeMirror). */
export type CibleFormat = HTMLTextAreaElement | EditorView;

function estTextarea(c: CibleFormat): c is HTMLTextAreaElement {
	return c instanceof HTMLTextAreaElement;
}

/** Insère `text` à la place de la sélection, curseur après — ou à la
    première ligne vide de `text` quand il en contient une (bloc de code).
    Sur le champ direct, `cb` n'est pas appelé ici : son écouteur de
    modifications le fait déjà, une fois. */
export function insererTexte(cible: CibleFormat, text: string, cb: (value: string) => void): void {
	const nl = text.indexOf("\n");
	const decalage = nl !== -1 ? nl + 1 : text.length;
	if (!estTextarea(cible)) {
		const { from, to } = cible.state.selection.main;
		cible.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + decalage },
			userEvent: "input",
			scrollIntoView: true,
		});
		cible.focus();
		return;
	}
	const ta = cible;
	const s = ta.selectionStart ?? 0;
	const before = ta.value.substring(0, s);
	const after = ta.value.substring(ta.selectionEnd ?? 0);
	ta.value = before + text + after;
	ta.selectionStart = ta.selectionEnd = before.length + decalage;
	ta.focus();
	cb(ta.value);
}

/** Entoure la sélection de `ouvre`…`ferme` et la garde sélectionnée ; sans
    sélection, pose la paire et le curseur entre les deux. */
function entourer(cible: CibleFormat, ouvre: string, ferme: string, cb: (value: string) => void): void {
	if (!estTextarea(cible)) {
		const { from, to } = cible.state.selection.main;
		const sel = cible.state.sliceDoc(from, to);
		cible.dispatch({
			changes: { from, to, insert: ouvre + sel + ferme },
			selection: { anchor: from + ouvre.length, head: from + ouvre.length + sel.length },
			userEvent: "input",
			scrollIntoView: true,
		});
		cible.focus();
		return;
	}
	const ta = cible;
	const s = ta.selectionStart ?? 0;
	const e = ta.selectionEnd ?? s;
	const sel = ta.value.substring(s, e);
	ta.value = ta.value.substring(0, s) + ouvre + sel + ferme + ta.value.substring(e);
	ta.selectionStart = s + ouvre.length;
	ta.selectionEnd = s + ouvre.length + sel.length;
	ta.focus();
	cb(ta.value);
}

/** Pose la barre dans `parent`, au-dessus du champ `cible`. `apres` suit
    chaque insertion (l'ajustement de la hauteur d'une zone de texte). */
export function poserBarreFormat(parent: HTMLElement, cible: CibleFormat, html: boolean, onChange: (value: string) => void, apres: () => void): HTMLElement {
	const barre = ajouter(parent, "div", "qb-format-bar");
	barre.setAttribute("role", "toolbar");

	const bouton = (icon: string, titre: TransKey, action: (btn: HTMLButtonElement) => void): HTMLButtonElement => {
		const btn = ajouter(barre, "button", "qb-format-btn");
		btn.type = "button";
		btn.title = t(titre);
		btn.setAttribute("aria-label", t(titre));
		currentHost().ui.setIcon(btn, icon);
		// `mousedown` sans défaut : le champ garde le focus ET sa sélection,
		// que l'action va entourer.
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", (e) => { e.preventDefault(); action(btn); apres(); });
		return btn;
	};
	const paire = (icon: string, titre: TransKey, md: [string, string], balise: [string, string]): void => {
		bouton(icon, titre, () => {
			const [o, f] = html ? balise : md;
			entourer(cible, o, f, onChange);
		});
	};

	paire("bold", "editor.format.bold", ["**", "**"], ["<strong>", "</strong>"]);
	paire("italic", "editor.format.italic", ["*", "*"], ["<em>", "</em>"]);
	paire("code", "editor.format.code", ["`", "`"], ["<code>", "</code>"]);
	bouton("square-code", "editor.entity.codeBlock", () => insererTexte(cible, "<pre><code>\n</code></pre>", onChange));
	paire("sigma", "editor.format.formula", ["$", "$"], ["$", "$"]);

	return barre;
}
