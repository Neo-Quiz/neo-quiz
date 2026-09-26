import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { openActionMenu } from "../dashboard/ui-select";

/* ══════════════════════════════════════════════════════════
   BARRE DE MISE EN FORME d'un champ multiligne de l'éditeur

   Refonte de l'éditeur (2026-09-26) : la rangée de symboles bruts
   `> < & _ ' " ```` devient une barre d'ICÔNES Lucide, compacte, collée au
   haut du champ. Chaque action d'avant est gardée :
   - le bloc de code (`<pre><code>`) a son bouton ;
   - les six caractères échappés (`&gt;`, `&lt;`, `&amp;`, `&nbsp;`,
     `&#39;`, `&quot;`) passent dans un menu « Caractère spécial » : ils
     servent dans un énoncé en HTML, rarement ailleurs, et six boutons pour
     eux chargeaient la barre.
   S'y ajoutent gras, italique, code et formule, qui ENTOURENT la sélection
   (ou posent la paire et le curseur entre les deux). Dans un champ HTML, les
   balises remplacent le markdown : `**x**` n'y serait pas rendu.
══════════════════════════════════════════════════════════ */

/** Insère `text` à la place de la sélection, curseur après — ou à la
    première ligne vide de `text` quand il en contient une (bloc de code). */
export function insererTexte(ta: HTMLTextAreaElement, text: string, cb: (value: string) => void): void {
	const s = ta.selectionStart ?? 0;
	const before = ta.value.substring(0, s);
	const after = ta.value.substring(ta.selectionEnd ?? 0);
	ta.value = before + text + after;
	const nl = text.indexOf("\n");
	ta.selectionStart = ta.selectionEnd = before.length + (nl !== -1 ? nl + 1 : text.length);
	ta.focus();
	cb(ta.value);
}

/** Entoure la sélection de `ouvre`…`ferme` et la garde sélectionnée ; sans
    sélection, pose la paire et le curseur entre les deux. */
function entourer(ta: HTMLTextAreaElement, ouvre: string, ferme: string, cb: (value: string) => void): void {
	const s = ta.selectionStart ?? 0;
	const e = ta.selectionEnd ?? s;
	const sel = ta.value.substring(s, e);
	ta.value = ta.value.substring(0, s) + ouvre + sel + ferme + ta.value.substring(e);
	ta.selectionStart = s + ouvre.length;
	ta.selectionEnd = s + ouvre.length + sel.length;
	ta.focus();
	cb(ta.value);
}

/* FONCTION et non constante : les infobulles sont traduites au RENDU, pas
   figées dans la langue du chargement du module. `insert` est une entité
   HTML — jamais traduite ; `glyph` est le caractère qu'elle donne. */
function entites(): { glyph: string; insert: string; title: string }[] {
	return [
		{ glyph: ">", insert: "&gt;", title: t("editor.entity.gt") },
		{ glyph: "<", insert: "&lt;", title: t("editor.entity.lt") },
		{ glyph: "&", insert: "&amp;", title: t("editor.entity.amp") },
		{ glyph: "␣", insert: "&nbsp;", title: t("editor.entity.nbsp") },
		{ glyph: "'", insert: "&#39;", title: t("editor.entity.apos") },
		{ glyph: "\"", insert: "&quot;", title: t("editor.entity.quot") },
	];
}

/** Pose la barre dans `parent`, au-dessus du champ `ta`. `apres` suit chaque
    insertion (l'ajustement de la hauteur du champ). */
export function poserBarreFormat(parent: HTMLElement, ta: HTMLTextAreaElement, html: boolean, onChange: (value: string) => void, apres: () => void): HTMLElement {
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
			entourer(ta, o, f, onChange);
		});
	};

	paire("bold", "editor.format.bold", ["**", "**"], ["<strong>", "</strong>"]);
	paire("italic", "editor.format.italic", ["*", "*"], ["<em>", "</em>"]);
	paire("code", "editor.format.code", ["`", "`"], ["<code>", "</code>"]);
	bouton("square-code", "editor.entity.codeBlock", () => insererTexte(ta, "<pre><code>\n</code></pre>", onChange));
	paire("sigma", "editor.format.formula", ["$", "$"], ["$", "$"]);

	ajouter(barre, "span", "qb-format-sep").setAttribute("aria-hidden", "true");

	bouton("ampersand", "editor.format.special", (btn) => {
		openActionMenu(btn, entites().map(ent => ({
			label: ent.title,
			hint: ent.glyph,
			onClick: () => { insererTexte(ta, ent.insert, onChange); apres(); },
		})));
	});
	return barre;
}
