import { t } from "../i18n";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { reserveFreePath, releaseReservedPath } from "../unique-path";
import type { EditorCtx } from "../types/editor-ctx";
import type { DraftQuestion } from "./utils";
import { basculerBonne, ajouterOption, retirerOption, placerOrdre, associer, ajouterVariante, retirerVariante } from "./gestes";
import { insererTexte, poserBarreFormat } from "./format-toolbar";
import { createSelect } from "../dashboard/ui-select";

/** Handlers du formulaire d'édition d'une question (champs, ressource, éditeurs par type, éditeur de tableau). */
export interface EditorFormHandlers {
	renderEditor(): void;
	_field(parent: HTMLElement, label: string, value: string | undefined, placeholder: string, multiline: boolean, onChange: (value: string) => void, opts?: { html?: boolean }): HTMLElement;
	_resourceSection(parent: HTMLElement, q: DraftQuestion): void;
	_renderTypeFields(box: HTMLElement, q: DraftQuestion): void;
	_arrayEditor(parent: HTMLElement, label: string, items: string[], onChange: () => void, placeholder: string, addLabel: string): void;
}

/**
 * Chemin où écrire une image collée, décidé par L'HÔTE.
 *
 * `paths.attachmentPathFor` (`src/host/types.ts`) résout ce que l'hôte est
 * seul à savoir : sous Obsidian le réglage « dossier des pièces jointes » — y
 * compris ses modes relatifs `./` (le dossier de la note) et `./sous-dossier`
 * —, dans la fenêtre le dossier de la note elle-même. Le calculer à la main
 * donnait `.//Pasted image….png`, et écrivait à la RACINE du vault ce qui
 * devait aller à côté de la note (revue codex 2026-07-31).
 *
 * `sourcePath` est la note à laquelle l'image appartient. Les deux hôtes n'en
 * font PAS la même chose quand elle manque, et le contrat le dit plutôt que de
 * l'uniformiser : Obsidian retombe sur son fichier ACTIF ; la fenêtre REJETTE
 * avec une cause nommée, n'ayant pas de fichier actif et ne pouvant pas
 * choisir une racine sans risquer de poser l'image hors de celle où la note
 * finira. Le `catch` de l'appelant transforme ce rejet en message.
 */
async function cheminImageCollee(ext: string, sourcePath?: string): Promise<{ fileName: string; filePath: string }> {
	const now = new Date();
	const ts = now.getFullYear().toString() +
		String(now.getMonth() + 1).padStart(2, "0") +
		String(now.getDate()).padStart(2, "0") +
		String(now.getHours()).padStart(2, "0") +
		String(now.getMinutes()).padStart(2, "0") +
		String(now.getSeconds()).padStart(2, "0");
	/* L'HÔTE décide du DOSSIER (et déduplique contre ce qui EXISTE déjà), la
	   réservation décide du NOM quand deux collages se suivent : mesuré, deux
	   appels rapprochés rendent le MÊME chemin tant que le fichier n'existe pas
	   encore, et la seconde image écrasait la première.
	   Elle reste ici et NON dans l'hôte, parce que le contrat le dit
	   (`HostPaths.attachmentPathFor`) : un hôte qui réserverait à notre place
	   ferait tomber CETTE réservation sur un nom déjà pris par lui, chaque
	   collage sortirait en « ….-2.png » et le nom de base resterait brûlé sans
	   jamais être écrit. */
	const propose = await currentHost().paths.attachmentPathFor(
		`Pasted image ${ts}.${ext}`, sourcePath);
	const point = propose.lastIndexOf(".");
	const filePath = await reserveFreePath(
		point > 0 ? propose.slice(0, point) : propose,
		point > 0 ? propose.slice(point) : "",
		(c) => currentHost().fs.exists(c));
	/* Le lien `![[…]]` porte le NOM, pas le chemin : c'est la forme qu'Obsidian
	   résout lui-même, et celle que le moteur attend (engine/sanitizer.ts
	   resolveObsidianEmbedFile). */
	return { fileName: filePath.split("/").pop() || filePath, filePath };
}

export function createEditorFormHandlers(ctx: EditorCtx): EditorFormHandlers {
	const { Q_TYPES, _setIcon, _iconSpan, md2html } = ctx;
	const view = ctx.view;

	// Helper pour marquer comme modifié et planifier la sauvegarde
	function onEdit(): void {
		view.renderCode();
		view.schedulePreview();
		view.scheduleSave?.();
	}

	function renderEditor(): void {
		const q = ctx.questions[ctx.activeIdx];
		if (!q) return;
		const ti = Q_TYPES.find(t => t.key === q._type) || Q_TYPES[0];
		const wrap = view.editorInnerEl;
		wrap.replaceChildren();

		const badge = ajouter(wrap, "div", "qb-type-badge");
		const badgeIcon = ajouter(badge, "div", "qb-type-icon"); _setIcon(badgeIcon, ti.lucide);
		const badgeText = ajouter(badge, "div");
		ajouter(badgeText, "div", "qb-type-label", ti.label);
		ajouter(badgeText, "div", "qb-type-desc", ti.desc);

		// Section Énoncé (toujours déployée par défaut)
		const promptSection = ajouter(wrap, "details", "qb-section-collapsible");
		promptSection.open = true;
		const promptSummary = ajouter(promptSection, "summary", "qb-section-header");
		ctx._setIcon(promptSummary, "file-question");
		ajouter(promptSummary, "span", undefined, t("editor.form.promptSection"));
		const promptContent = ajouter(promptSection, "div", "qb-section-content");

		_field(promptContent, "", (q._promptHtml || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.form.promptPlaceholder"), true, v => {
			q._promptHtml = v; // Garde les \n tels quels
			onEdit();
		});

		_passageSection(wrap, q);

		_resourceSection(wrap, q);

		const box = ajouter(wrap, "div", "qb-section-box");
		_renderTypeFields(box, q);

		// Section Indice (optionnelle)
		const hintSection = ajouter(wrap, "details", "qb-section-collapsible");
		const hintSummary = ajouter(hintSection, "summary", "qb-section-header");
		ctx._setIcon(hintSummary, "lightbulb");
		ajouter(hintSummary, "span", undefined, t("editor.hint.label"));
		const hintContent = ajouter(hintSection, "div", "qb-section-content");

		_field(hintContent, "", (q.hint || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.hint.placeholder"), true, v => {
			q.hint = v; // Garde les \n tels quels
			onEdit();
		});

		// Section Explication (optionnelle)
		const explainSection = ajouter(wrap, "details", "qb-section-collapsible");
		const explainSummary = ajouter(explainSection, "summary", "qb-section-header");
		ctx._setIcon(explainSummary, "book-open");
		ajouter(explainSummary, "span", undefined, t("editor.form.explainSection"));
		const explainContent = ajouter(explainSection, "div", "qb-section-content");

		_field(explainContent, "", (q.explain || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.form.explainPlaceholder"), true, v => {
			q.explain = v; // Garde les \n tels quels
			delete q._explainHtml;
			onEdit();
		});
	}

	/* ── Section « Document » (support de compréhension) ──
	   Les trois champs vivent dans `_extraFields` : c'est le canal que l'éditeur
	   utilise déjà pour tout champ hors de son formulaire fixe, et l'export les
	   réémet tels quels (editor/export.ts). Une chaîne vide SUPPRIME la clé
	   plutôt que d'écrire `passage: ''` dans la note — un champ vide n'est pas
	   une donnée. */
	function _passageSection(parent: HTMLElement, q: DraftQuestion): void {
		const extras = (q._extraFields ||= {});
		const read = (key: string): string => {
			const v = extras[key];
			return typeof v === "string" ? v : "";
		};
		const write = (key: string, value: string): void => {
			const v = value.trim();
			if (v) extras[key] = value; else delete extras[key];
			onEdit();
		};

		// Ouverte d'emblée si la question porte déjà un document : on ne cache pas
		// à l'auteur le texte sur lequel porte sa question.
		const hasPassage = !!(read("passage") || read("passageId"));
		const section = ajouter(parent, "details", "qb-section-collapsible");
		section.open = hasPassage;
		const summary = ajouter(section, "summary", "qb-section-header");
		ctx._setIcon(summary, "book-open-text");
		ajouter(summary, "span", undefined, t("editor.passage.section"));
		const content = ajouter(section, "div", "qb-section-content");

		ajouter(content, "div", "qb-field-help", t("editor.passage.help"));

		_field(content, t("editor.passage.textLabel"), read("passage"), t("editor.passage.textPlaceholder"), true,
			v => write("passage", v));
		_field(content, t("editor.passage.titleLabel"), read("passageTitle"), t("editor.passage.titlePlaceholder"), false,
			v => write("passageTitle", v));
		_field(content, t("editor.passage.idLabel"), read("passageId"), t("editor.passage.idPlaceholder"), false,
			v => write("passageId", v));
	}

	// La barre de mise en forme (et ses entités) vit dans format-toolbar.ts.
	const _insertAt = insererTexte;

	function _autoResize(ta: HTMLTextAreaElement): void {
		ta.style.height = 'auto';
		const minHeight = 100; // Hauteur minimale plus grande pour être plus propre
		const newHeight = Math.max(minHeight, ta.scrollHeight);
		ta.style.height = newHeight + 'px';
	}

	function _field(parent: HTMLElement, label: string, value: string | undefined, placeholder: string, multiline: boolean, onChange: (value: string) => void, opts: { html?: boolean } = {}): HTMLElement {
		const wrap = ajouter(parent, "div", "qb-field");
		ajouter(wrap, "label", "qb-field-label", label);
		if (multiline) {
			/* Un seul CADRE pour la barre et la zone : la barre est collée au
			   haut du champ, le liseré et le focus sont ceux du cadre. */
			const cadre = ajouter(wrap, "div", "qb-rich");
			/* Le texte passe par le CONTENU du `<textarea>`, comme le faisait
			   `createEl({ text })` : c'est sa valeur initiale, et l'affecter par
			   `value` la rendrait « sale » avant la moindre frappe. */
			const ta = document.createElement("textarea");
			ta.className = "qb-field-textarea qb-prompt-editor";
			ta.textContent = value ?? "";
			poserBarreFormat(cadre, ta, !!opts.html, onChange, () => _autoResize(ta));
			cadre.appendChild(ta);
			ta.placeholder = placeholder;

			// Input + auto-resize
			ta.addEventListener("input", () => { onChange(ta.value); _autoResize(ta); });
			requestAnimationFrame(() => _autoResize(ta));

			// Raccourci ``` + Enter
			ta.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					const pos = ta.selectionStart ?? 0;
					const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
					if (ta.value.substring(lineStart, pos).trim() === '```') {
						e.preventDefault();
						const before = ta.value.substring(0, lineStart);
						const after = ta.value.substring(pos);
						ta.value = before + '<pre><code>\n</code></pre>' + after;
						ta.selectionStart = ta.selectionEnd = before.length + '<pre><code>\n'.length;
						onChange(ta.value);
						_autoResize(ta);
					}
				}
			});

			// Coller des images - activé pour tous les champs textarea
			ta.addEventListener("paste", async (e) => {
				const items = e.clipboardData?.items;
				if (!items) return;
				for (const item of Array.from(items)) {
					if (item.type.startsWith("image/")) {
						e.preventDefault();
						const file = item.getAsFile();
						if (!file) continue;
						/* Un rejet dans un gestionnaire d'événement `async` ne
						   remonte NULLE PART : sans ce `try`, une image qui ne
						   pouvait pas s'écrire disparaissait en silence — le
						   coller ne faisait simplement rien. */
						try {
							const ext = item.type.split("/")[1] || "png";
							const { fileName, filePath } = await cheminImageCollee(ext, view.sourcePath);
							const buffer = await file.arrayBuffer();
							try {
								await currentHost().fs.writeBinary(filePath, new Uint8Array(buffer));
							} catch (err) { releaseReservedPath(filePath); throw err; }
							_insertAt(ta, `![[${fileName}]]`, onChange);
							_autoResize(ta);
							view.schedulePreview();
						} catch (err) {
							console.error("[quiz-blocks] collage d'image impossible :", err);
							currentHost().ui.notice(t("editor.paste.imageFailed"));
						}
						break;
					}
				}
			});
		} else {
			const inp = ajouter(wrap, "input", "qb-field-input");
			inp.placeholder = placeholder;
			inp.value = value ?? "";
			inp.addEventListener("input", () => onChange(inp.value));
		}
		return wrap;
	}

	function _resourceSection(parent: HTMLElement, q: DraftQuestion): void {
		const rb0 = q.resourceButton;
		const has = !!rb0;
		const fileName = rb0 && rb0.fileName ? rb0.fileName : "";
		const summaryText = has && fileName ? t("editor.form.resourceSectionWithFile", { file: fileName }) : t("editor.form.resourceSection");

		const details = ajouter(parent, "details", "qb-section-collapsible" + (has ? "" : " qb-section-locked"));
		details.open = has;
		const summary = ajouter(details, "summary", "qb-section-header");
		ctx._setIcon(summary, "paperclip");
		const summaryLabel = ajouter(summary, "span", "qb-resource-summary-text", summaryText);

		// Toggle dans le header pour activer/désactiver
		const toggle = ajouter(summary, "button", "qb-resource-toggle-btn");
		toggle.type = "button";
		toggle.title = t(has ? "editor.toggle.disable" : "editor.toggle.enable");
		ajouter(toggle, "span", "qb-resource-toggle-dot" + (has ? " is-on" : ""));
		toggle.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			// Libellé de DÉPART du bouton ressource : contenu (modifiable puis
			// écrit dans le .md), pas un jeton de format — traduit à la création.
			q.resourceButton = has ? null : { label: t("editor.form.resourceDefaultLabel"), fileName: "" };
			onEdit();
			renderEditor();
		});

		if (!rb0) return;
		const contentDiv = ajouter(details, "div", "qb-section-content");
const group = ajouter(contentDiv, "div", "qb-resource-group");
const updateSummary = () => {
    const fn = q.resourceButton?.fileName || "";
    summaryLabel.textContent = fn ? t("editor.form.resourceSectionWithFile", { file: fn }) : t("editor.form.resourceSection");
};
_field(group, t("editor.form.resourceLabel"), rb0.label, t("editor.form.resourceLabelPlaceholder"), false, v => { rb0.label = v; onEdit(); updateSummary(); });
_field(group, t("editor.form.resourceFileName"), rb0.fileName, t("editor.form.resourceFilePlaceholder"), false, v => { rb0.fileName = v; onEdit(); updateSummary(); });


		const helpNote = ajouter(contentDiv, "p", "qb-resource-help-note");
		ajouter(helpNote, "span", undefined, t("editor.form.resourceHelp"));
	}

	function _renderTypeFields(box: HTMLElement, q: DraftQuestion): void {
		// Renommé `t` → `qType` : le type de question masquait la fonction de
		// traduction t() importée en tête de module.
		const qType = q._type;
		const rerender = () => { onEdit(); };

		if (qType === "single" || qType === "multi") {
			const isMulti = qType === "multi";
			/* Une question à choix MULTIPLES sans aucune bonne réponse ne peut
			   être réussie par personne, et rien ne le disait : elle
			   s'enregistrait comme les autres (revue codex 2026-07-31). Même
			   avertissement que le texte à trous sans trou. */
			const alerteMulti = isMulti ? ajouter(box, "div", "qb-field-help") : null;
			const majAlerte = (): void => {
				if (!alerteMulti) return;
				const aucune = (q.correctIndices || []).length === 0;
				alerteMulti.classList.toggle("qb-field-help--warn", aucune);
				alerteMulti.textContent = aucune ? t("editor.answer.noneCorrect") : "";
			};
			const cardsContainer = ajouter(box, "div", "qb-answers");

			const renderCards = () => {
				majAlerte();
				cardsContainer.replaceChildren();

				q.options!.forEach((o, i) => {
					const isCorrect = isMulti ? (q.correctIndices || []).includes(i) : i === q.correctIndex;
					/* Refonte de l'éditeur (2026-09-26) : une LIGNE sobre par
					   réponse — le champ, l'interrupteur « Bonne réponse » vert,
					   supprimer. La bonne réponse se lit au liseré vert fin du
					   champ et à l'interrupteur, plus à une grande boîte pleine
					   rouge ou verte. */
					const card = ajouter(cardsContainer, "div", "qb-answer-row" + (isCorrect ? " is-correct" : ""));

					const input = ajouter(card, "input", "qb-answer-input");
					input.type = "text";
					input.value = o || "";
					input.placeholder = t("editor.answer.placeholder");

					input.addEventListener("input", () => {
						q.options![i] = input.value;
						rerender();
					});

					input.addEventListener("paste", async (e) => {
						const items = e.clipboardData?.items;
						if (!items) return;

						for (const item of Array.from(items)) {
							if (item.type.startsWith("image/")) {
								e.preventDefault();
								const file = item.getAsFile();
								if (!file) continue;

								try {
									const ext = file.type?.split("/")[1] || "png";
									const { fileName, filePath: path } = await cheminImageCollee(ext, view.sourcePath);

									const buf = await file.arrayBuffer();
									try {
										await currentHost().fs.writeBinary(path, new Uint8Array(buf));
									} catch (err) { releaseReservedPath(path); throw err; }

									const before = input.value.slice(0, input.selectionStart ?? 0);
									const after = input.value.slice(input.selectionEnd ?? 0);
									const wikiLink = `![[${fileName}]]`;
									input.value = before + wikiLink + after;
									input.selectionStart = input.selectionEnd = before.length + wikiLink.length;

									q.options![i] = input.value;
									view.schedulePreview();
									view.renderCode();
								} catch (err) {
									console.error("[quiz-blocks] collage d'image impossible :", err);
									currentHost().ui.notice(t("editor.paste.imageFailed"));
								}
								break;
							}
						}
					});

					/* L'interrupteur « Bonne réponse » : un vrai bouton (clavier,
					   lecteur d'écran), même règle qu'avant — en choix unique,
					   cliquer la bonne ne fait rien ; en choix multiple, la
					   dernière bonne ne se retire pas. */
					const toggle = ajouter(card, "button", "qb-answer-switch");
					toggle.type = "button";
					toggle.setAttribute("role", "switch");
					toggle.setAttribute("aria-checked", String(isCorrect));
					ajouter(toggle, "span", "qb-answer-switch-track");
					ajouter(toggle, "span", "qb-answer-switch-label", t("editor.answer.correct"));
					toggle.addEventListener("click", () => {
						if (basculerBonne(q, i)) { view.render(); view.scheduleSave?.(); }
					});

					/* Supprimer : jamais une bonne réponse, jamais sous deux
					   réponses (mêmes règles qu'avant). Quand c'est interdit, la
					   place reste réservée, invisible : les interrupteurs restent
					   alignés d'une ligne à l'autre. */
					const delBtn = ajouter(card, "button", "qb-answer-delete");
					delBtn.type = "button";
					delBtn.title = t("editor.action.delete");
					delBtn.setAttribute("aria-label", t("editor.action.delete"));
					_setIcon(delBtn, "trash-2");
					if (isCorrect || q.options!.length <= 2) {
						delBtn.disabled = true;
						delBtn.classList.add("is-hidden");
					} else {
						delBtn.addEventListener("click", () => {
							if (retirerOption(q, i)) { view.render(); view.scheduleSave?.(); }
						});
					}
				});

				const addBtn = ajouter(box, "button", "qb-answer-add");
				addBtn.type = "button";
				_iconSpan(addBtn, "plus", "qb-add-icon");
				addBtn.appendChild(document.createTextNode(t("editor.answer.add")));
				addBtn.addEventListener("click", () => {
					if (ajouterOption(q, q.options!.length - 1)) { view.render(); view.scheduleSave?.(); }
				});
			};

			renderCards();
		}

		if (qType === "ordering") {
			_arrayEditor(box, t("editor.ordering.possibilities"), q.possibilities!, () => {
				while (q.correctOrder!.length < q.possibilities!.length) q.correctOrder!.push(q.correctOrder!.length);
				q.correctOrder = q.correctOrder!.slice(0, q.possibilities!.length);
				while (q.slots!.length < q.possibilities!.length) q.slots!.push(t("editor.ordering.slotDefault", { n: q.slots!.length + 1 }));
				q.slots = q.slots!.slice(0, q.possibilities!.length);
				rerender();
			}, t("editor.ordering.itemPlaceholder"), t("editor.action.add"));
			_arrayEditor(box, t("editor.ordering.slotLabels"), q.slots!, rerender, t("editor.ordering.slotPlaceholder"), t("editor.action.add"));

			ajouter(box, "label", "qb-field-label", t("editor.ordering.correctOrder"));
			(q.correctOrder || []).forEach((val, i) => {
				const row = ajouter(box, "div", "qb-arr-row");
				ajouter(row, "span", "qb-arr-idx", (q.slots?.[i] || `S${i}`) + " →");
				const inp = ajouter(row, "input", "qb-field-input qb-field-sm");
				inp.type = "number";
				inp.value = String(val);
				inp.min = "0"; inp.max = String(q.possibilities!.length - 1); inp.style.width = "55px";
				inp.addEventListener("input", () => { placerOrdre(q, i, parseInt(inp.value) || 0); rerender(); });
			});
		}

		if (qType === "matching") {
			_arrayEditor(box, t("editor.matching.rows"), q.rows!, () => {
				while (q.correctMap!.length < q.rows!.length) q.correctMap!.push(0);
				q.correctMap = q.correctMap!.slice(0, q.rows!.length);
				rerender();
			}, t("editor.matching.rowPlaceholder"), t("editor.action.add"));
			_arrayEditor(box, t("editor.matching.choices"), q.choices!, () => {
				q.correctMap = q.correctMap!.map(v => Math.min(v, q.choices!.length - 1));
				rerender();
			}, t("editor.matching.choicePlaceholder"), t("editor.action.add"));

			/* « situation → choix » en DEUX COLONNES alignées (refonte
			   2026-09-26) : chaque ligne a la même grille, le menu prend toute
			   la largeur de sa colonne. `ui-select` et non un `<select>` natif,
			   dont le menu n'est pas thémable. */
			ajouter(box, "label", "qb-field-label", t("editor.matching.mapping"));
			const grille = ajouter(box, "div", "qb-match-grid");
			(q.rows || []).forEach((row, i) => {
				const r = ajouter(grille, "div", "qb-match-row");
				ajouter(r, "span", "qb-match-label", row || t("editor.matching.rowFallback", { n: i }));
				_iconSpan(r, "arrow-right", "qb-match-arrow");
				createSelect(r, {
					value: String(q.correctMap?.[i] ?? 0),
					options: (q.choices || []).map((c, ci) => ({ value: String(ci), label: c || "..." })),
					onChange: (v) => { associer(q, i, parseInt(v) || 0); rerender(); },
				});
			});
		}

		if (qType === "cloze") {
			// Le gabarit EST la question : un seul champ, multiligne, avec la
			// syntaxe rappelée au-dessus — personne ne devine les doubles accolades.
			ajouter(box, "div", "qb-field-help", t("editor.cloze.help"));
			_field(box, t("editor.cloze.templateLabel"), q.cloze, t("editor.cloze.templatePlaceholder"), true,
				v => { q.cloze = v; rerender(); });

			// Compte des trous : la seule vérification qui compte, et elle dit
			// aussi si la syntaxe a été comprise (0 trou = accolades ratées).
			const blanks = (String(q.cloze || "").match(/\{\{[^{}]*\}\}/g) || []).length;
			ajouter(box, "div",
				"qb-field-help" + (blanks === 0 ? " qb-field-help--warn" : ""),
				t(blanks === 0 ? "editor.cloze.noBlank" : "editor.cloze.blankCount", { n: blanks }));

			const czWrap = ajouter(box, "div", "qb-toggle-wrap");
			const czTrack = ajouter(czWrap, "div", `qb-toggle-track ${q.caseSensitive ? "on" : ""}`);
			ajouter(czTrack, "div", "qb-toggle-thumb");
			czWrap.appendChild(document.createTextNode(t("editor.text.caseSensitive")));
			czWrap.addEventListener("click", () => { q.caseSensitive = !q.caseSensitive; view.render(); view.scheduleSave?.(); });
		}

		if (qType === "flashcard") {
			// Le recto est l'énoncé du formulaire, déjà affiché plus haut : ici,
			// seul le verso — un champ, comme pour le gabarit d'un texte à trous.
			ajouter(box, "label", "qb-field-label", t("editor.flashcard.section"));
			ajouter(box, "div", "qb-field-help", t("editor.flashcard.help"));
			_field(box, t("editor.flashcard.back"), q.answer, t("editor.flashcard.backPlaceholder"), true,
				v => { q.answer = v; rerender(); });
		}

		if (qType === "numeric") {
			ajouter(box, "div", "qb-field-help", t("editor.numeric.help"));
			_variantEditor(box, t("editor.numeric.answers"), q, rerender, t("editor.numeric.answerPlaceholder"), t("editor.action.add"));
			_field(box, t("editor.numeric.unit"), q.unit, t("editor.numeric.unitPlaceholder"), false,
				v => { q.unit = v; rerender(); });
			/* Les deux marges s'EXCLUENT : renseigner l'une efface l'autre.
			   Les cumuler n'aurait pas de sens (numeric.ts applique l'absolue en
			   priorité), et laisser l'ancienne valeur en place ferait mentir
			   l'écran sur ce qui est réellement toléré. */
			_field(box, t("editor.numeric.tolerance"), q.tolerance != null ? String(q.tolerance) : "", "0.05", false, v => {
				const n = Number(v.replace(",", "."));
				q.tolerance = v.trim() && Number.isFinite(n) ? n : undefined;
				if (q.tolerance != null) q.tolerancePercent = undefined;
				rerender();
			});
			_field(box, t("editor.numeric.tolerancePercent"), q.tolerancePercent != null ? String(q.tolerancePercent) : "", "2", false, v => {
				const n = Number(v.replace(",", "."));
				q.tolerancePercent = v.trim() && Number.isFinite(n) ? n : undefined;
				if (q.tolerancePercent != null) q.tolerance = undefined;
				rerender();
			});
			_field(box, t("editor.text.placeholderLabel"), q.placeholder, t("editor.text.placeholderHint"), false,
				v => { q.placeholder = v; rerender(); });
		}

		if (["text", "cmd", "powershell", "bash"].includes(qType)) {
			/* "C:\>" / "PS>" / "user@hostname:~$ " : invites de commandes réelles,
			   pas de l'UI. BASH aussi : le moteur lit son invite
			   (engine/terminal.ts getTerminalPromptPrefix) et l'export l'écrit,
			   mais le formulaire ne la proposait pas — une question bash avait
			   donc une invite qu'on ne pouvait plus changer. */
			if (qType === "cmd" || qType === "powershell" || qType === "bash") {
				const invite = qType === "cmd" ? "C:\\>" : qType === "powershell" ? "PS>" : "user@hostname:~$ ";
				_field(box, t("editor.text.commandPrefix"), q.commandPrefix, invite, false,
					v => { q.commandPrefix = v; rerender(); });
			}
			_field(box, t("editor.text.placeholderLabel"), q.placeholder, t("editor.text.placeholderHint"), false, v => { q.placeholder = v; rerender(); });
			_variantEditor(box, t("editor.text.acceptedAnswers"), q, rerender, t("editor.text.answerPlaceholder"), t("editor.action.add"));
			const toggleWrap = ajouter(box, "div", "qb-toggle-wrap");
			const track = ajouter(toggleWrap, "div", `qb-toggle-track ${q.caseSensitive ? "on" : ""}`);
			ajouter(track, "div", "qb-toggle-thumb");
			toggleWrap.appendChild(document.createTextNode(t("editor.text.caseSensitive")));
			toggleWrap.addEventListener("click", () => { q.caseSensitive = !q.caseSensitive; view.render(); view.scheduleSave?.(); });
		}
	}

	function _arrayEditor(parent: HTMLElement, label: string, items: string[], onChange: () => void, placeholder: string, addLabel: string): void {
		ajouter(parent, "label", "qb-field-label", label);
		const container = ajouter(parent, "div", "qb-arr-list");
		const renderItems = () => {
			container.replaceChildren();
			items.forEach((item, i) => {
				const row = ajouter(container, "div", "qb-arr-row");
				const inp = ajouter(row, "input", "qb-field-input");
				inp.placeholder = `${placeholder} ${i + 1}`;
				inp.value = item ?? "";
				inp.addEventListener("input", () => { items[i] = inp.value; onChange(); });
				const del = ajouter(row, "button", "qb-arr-del");
				del.type = "button";
				del.title = t("editor.action.delete");
				del.setAttribute("aria-label", t("editor.action.delete"));
				_setIcon(del, "trash-2");
				if (items.length <= 1) del.disabled = true;
				del.addEventListener("click", () => { if (items.length <= 1) return; items.splice(i, 1); onChange(); renderItems(); });
			});
			const addBtn = ajouter(container, "button", "qb-arr-add");
			addBtn.type = "button";
			_iconSpan(addBtn, "plus", "qb-add-icon");
			addBtn.appendChild(document.createTextNode(addLabel));
			addBtn.addEventListener("click", () => { items.push(""); onChange(); renderItems(); });
		};
		renderItems();
	}

	/* Même rendu que `_arrayEditor`, mais pour `q.acceptedAnswers` : ajouter et
	   retirer passent par les GESTES partagés (`ajouterVariante` /
	   `retirerVariante`), qui refusent de retirer la dernière variante — plutôt
	   que de recopier ici la règle que `_arrayEditor` applique en générique. */
	function _variantEditor(parent: HTMLElement, label: string, q: DraftQuestion, onChange: () => void, placeholder: string, addLabel: string): void {
		ajouter(parent, "label", "qb-field-label", label);
		const container = ajouter(parent, "div", "qb-arr-list");
		const renderItems = () => {
			const items = q.acceptedAnswers || [];
			container.replaceChildren();
			items.forEach((item, i) => {
				const row = ajouter(container, "div", "qb-arr-row");
				const inp = ajouter(row, "input", "qb-field-input");
				inp.placeholder = `${placeholder} ${i + 1}`;
				inp.value = item ?? "";
				inp.addEventListener("input", () => { items[i] = inp.value; onChange(); });
				const del = ajouter(row, "button", "qb-arr-del");
				del.type = "button";
				del.title = t("editor.action.delete");
				del.setAttribute("aria-label", t("editor.action.delete"));
				_setIcon(del, "trash-2");
				if (items.length <= 1) del.disabled = true;
				del.addEventListener("click", () => { if (retirerVariante(q, i)) { onChange(); renderItems(); } });
			});
			const addBtn = ajouter(container, "button", "qb-arr-add");
			addBtn.type = "button";
			_iconSpan(addBtn, "plus", "qb-add-icon");
			addBtn.appendChild(document.createTextNode(addLabel));
			addBtn.addEventListener("click", () => { if (ajouterVariante(q)) { onChange(); renderItems(); } });
		};
		renderItems();
	}

	return {
		renderEditor,
		_field,
		_resourceSection,
		_renderTypeFields,
		_arrayEditor
	};
}
