import { LOG_PREFIX } from "../branding";
import { currentHost } from "../host/current";
import {
	FileEntry, isVaultFolder, listExternalFolder, listExternalRoots, listVaultFolder,
	primeExternalIndex, resolveExternalPath, revalidateExternalIndex, searchAll,
} from "./file-sources";
import { MentionMenuHandle, MentionMenuItem, openMentionMenu } from "./ui-select";
import { orderListing, rankMentions } from "./mention-rank";
import { couperNomAuMilieu } from "./file-icons";
import { fileIconSvg, folderIconSvg } from "./file-icon-svg";
import { t } from "../i18n";

export interface MentionToken {
	/** Index du « @ » dans le texte. */
	start: number;
	/** Ce qui suit le « @ » jusqu'au caret. */
	query: string;
}

/* Token « @… » actif juste avant le caret, ou null.
   Le « @ » doit être en DÉBUT DE MOT (début du champ, ou précédé d'un
   espace / tabulation / saut de ligne) : « ahmed@gmail.com » n'ouvre donc
   rien. Les espaces sont autorisés DANS le token (410 des 443 notes du
   vault Personal ont un espace dans leur chemin) ; c'est l'absence de
   résultat qui ferme le menu, pas l'espace. Remontée bornée à 200
   caractères pour ne pas scanner un prompt entier à chaque frappe. */
export function findMentionToken(text: string, caret: number): MentionToken | null {
	for (let i = caret - 1; i >= 0 && caret - i <= 200; i--) {
		const ch = text[i];
		if (ch === "\n") return null;
		if (ch !== "@") continue;
		const before = i > 0 ? text[i - 1] : "";
		if (i === 0 || before === " " || before === "\t" || before === "\n") {
			return { start: i, query: text.slice(i + 1, caret) };
		}
		return null; // « @ » collé à un mot : ce n'est pas une mention
	}
	return null;
}

export interface MentionPickerOptions {
	/** Attache un fichier du vault (→ attachNoteVaultFile dans ai.ts). */
	onPickVaultFile(path: string): void;
	/** Attache un fichier hors vault par chemin absolu. */
	onPickExternalFile(path: string): void;
	/** Le texte du textarea a été réécrit (token retiré / complété). */
	onTextReplaced(value: string): void;
	/** Racines configurées, lues au rendu (le réglage peut changer). */
	getExtraRoots(): string[];
	/** Dossier de destination du composer, relatif au vault ("" = racine).
	    `@` seul liste son contenu ; le classement le privilégie. Absent =
	    la racine (le chat « Expliquer » n'a pas de destination). */
	getCurrentFolder?(): string;
}

export interface MentionPickerHandle {
	/** Le handler Entrée d'ai.ts s'en sert pour ne pas envoyer le prompt. */
	isOpen(): boolean;
	detach(): void;
}

/* A quiz name ends with " — Learn.md", " — Practice.md" or " — Exam.md"
   (optionally followed by " (2)"): that whole suffix is the tail, because it
   says what the file is. Otherwise the repo-wide rule applies (cut in the
   middle, extension kept). A folder has no extension: its tail is "/". */
const SUFFIXE_QUIZ = /( — (?:Learn|Practice|Exam)(?: \(\d+\))?\.md)$/u;

function coupeLibelle(entry: FileEntry): { tete: string; queue: string } {
	if (entry.isFolder) return { tete: entry.name, queue: "/" };
	const quiz = SUFFIXE_QUIZ.exec(entry.name);
	if (quiz) return { tete: entry.name.slice(0, quiz.index), queue: quiz[1] };
	return couperNomAuMilieu(entry.name);
}

function iconFor(entry: FileEntry): string {
	if (entry.isFolder) return "folder";
	const ext = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
	if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image";
	if (ext === "pdf") return "file-type-2";
	return "file-text";
}

/* Branche le picker « @ » sur le textarea du composer.
   anchorEl = le composer (la liste s'affiche au-dessus, comme dans la
   référence), surtout PAS le caret. */
export function attachMentionPicker(
	textarea: HTMLTextAreaElement,
	anchorEl: HTMLElement,
	opts: MentionPickerOptions
): MentionPickerHandle {
	let menu: MentionMenuHandle | null = null;

	/** La frappe la plus récente : une liste calculée pour une frappe plus
	    ancienne est jetée à l'arrivée, sans quoi une réponse lente (un parcours
	    de racine externe en vol) reposerait des entrées périmées PAR-DESSUS
	    celles de la frappe suivante — ou rouvrirait un menu fermé. */
	let generation = 0;

	function close(): void {
		/* Un menu fermé REND CADUQUE toute liste encore en vol : sans ce
		   bump, une réponse tardive (parcours d'une racine externe) trouvait
		   `cette === generation` et `!menu`, et ROUVRAIT le menu qu'Échap ou
		   l'effacement du « @ » venait de fermer, avec des entrées périmées. */
		generation++;
		if (menu) { const m = menu; menu = null; m.close(); }
	}

	/* Remplace le token « @… » par `replacement` et repositionne le caret
	   juste après. Mute le textarea SANS re-render (le render d'ai.ts
	   reconstruit le DOM et perdrait le caret).
	   Borne la fin du remplacement sur la fin RÉELLE du token
	   (`token.start + 1 + token.query.length`), jamais sur le caret vivant :
	   si le caret a bougé pendant que le menu était ouvert (ex. ai.ts
	   replace le caret en fin de texte au clic sur une carte, sans fermer
	   le menu), lire `textarea.selectionStart` ici effacerait tout le texte
	   entre le token et le caret, sans undo (`.value` est une affectation
	   directe). Avec la fin bornée au token, ce cas devient impossible. */
	function replaceToken(token: MentionToken, replacement: string): void {
		const v = textarea.value;
		const tokenEnd = token.start + 1 + token.query.length;
		const next = v.slice(0, token.start) + replacement + v.slice(tokenEnd);
		textarea.value = next;
		const pos = token.start + replacement.length;
		textarea.setSelectionRange(pos, pos);
		opts.onTextReplaced(next);
	}

	/* ASYNCHRONE depuis que le disque est derrière le contrat : `listDir` et
	   `externe.list` traversent un pont dans l'application. `refresh` garde
	   une génération pour qu'une réponse en retard n'écrase pas la liste d'une
	   frappe plus récente. */
	/* Contenu d'un dossier du vault, avec les dates de modification (le
	   contrat `listDir` ne les porte pas ; `listFiles` oui). */
	async function vaultChildren(dir: string): Promise<FileEntry[]> {
		const dates = new Map(currentHost().fs.listFiles().map(f => [f.path, f.mtime]));
		return (await listVaultFolder(dir)).map(e => e.isFolder ? e : { ...e, mtime: dates.get(e.path) });
	}

	async function entriesFor(query: string): Promise<{ entries: FileEntry[]; footer?: string }> {
		const roots = opts.getExtraRoots();
		const courant = opts.getCurrentFolder?.() ?? "";
		// « @ » seul → contenu du dossier de destination (la racine sans
		// dossier), puis les racines externes, à la racine seulement.
		if (!query) {
			const enfants = await vaultChildren(courant);
			const externes = courant ? [] : listExternalRoots(roots);
			return { entries: rankMentions([...enfants, ...externes], "", courant) };
		}
		// Token finissant par « / » → on liste ce dossier. `dir` est un
		// chemin RELATIF (vault, ou racine externe préfixée de son nom —
		// cf. FileEntry.path) : jamais de chemin absolu dans le texte tapé.
		if (query.endsWith("/")) {
			const dir = query.slice(0, -1);
			// RÈGLE ASSUMÉE — « le vault gagne » : si un dossier RÉEL du
			// vault existe à ce chemin, il l'emporte TOUJOURS sur une racine
			// externe de même nom de base (ex. un vault avec un dossier
			// top-level « Documents » face à une racine externe
			// « C:/Users/…/Documents » ajoutée dans les réglages — cas réel
			// d'Ahmed). La racine externe devient alors innavigable par CE
			// chemin (mais reste trouvable par recherche : searchAll
			// couvre les deux, cf. plus bas). Choix délibéré plutôt qu'un
			// token cryptique pour lever l'ambiguïté (le token doit rester
			// lisible) : la collision est signalée à la SOURCE — au moment
			// où l'utilisateur AJOUTE la racine dans les réglages, une
			// Notice l'avertit si le nom percute un dossier du vault (cf.
			// plugin.ts, section « Dossiers hors vault »). Ici, silencieux
			// par design, pas par oubli.
			if (await isVaultFolder(dir)) return { entries: orderListing(await vaultChildren(dir), query) };
			const resolved = resolveExternalPath(roots, dir);
			if (resolved) return { entries: await listExternalFolder(resolved.absPath, resolved.root) };
			return { entries: [] }; // ni l'un ni l'autre → liste vide
		}
		// Sinon : recherche TOUJOURS globale, vault + toutes les racines,
		// fusionnées et triées par score commun (searchAll) — jamais une
		// simple concaténation qui évincerait les résultats externes.
		// La revalidation d'abord : `searchAll` ne lit que l'instantané des
		// racines externes, et c'est ici que le contrôle de mtime tourne
		// pendant la frappe (voir `primeExternalIndex`).
		await revalidateExternalIndex(roots);
		const result = searchAll(roots, query);
		const footer = result.truncated.length
			? t("ai.mention.truncated", { roots: result.truncated.join(", ") })
			: undefined;
		return { entries: rankMentions(result.entries, query, courant), footer };
	}

	function itemsFor(token: MentionToken, entries: FileEntry[]): MentionMenuItem[] {
		const shown = entries.slice(0, 30);
		// Trait de séparation devant la PREMIÈRE entrée hors vault (la liste
		// initiale place les racines externes en fin).
		const firstExternal = shown.findIndex(e => e.source === "external");
		return shown.map((entry, i) => ({
			label: entry.isFolder ? entry.name + "/" : entry.name,
			// Dossier parent en chemin relatif, pour vault ET externe (même
			// champ `path`, même calcul) : deux fichiers homonymes à des
			// profondeurs différentes (ex. « Downloads/x.pdf » vs
			// « Downloads/pdf/x.pdf ») restent distinguables. Avant : les
			// externes affichaient toujours le nom de la racine, quelle que
			// soit leur profondeur — deux homonymes rendaient un sous-titre
			// identique.
			sub: entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : undefined,
			icon: entry.source === "external" && entry.isFolder ? "corner-up-right" : iconFor(entry),
			// Racine externe : son Lucide « sortie du vault » reste (le trait de
			// séparation le dit déjà) ; le reste prend l'icône de fichier.
			iconSrc: entry.source === "external" && entry.isFolder
				? undefined
				: entry.isFolder ? folderIconSvg() : fileIconSvg(entry.name),
			labelParts: coupeLibelle(entry),
			separatorBefore: i > 0 && i === firstExternal,
			onChoose: () => {
				if (entry.isFolder) {
					// Dossier → on descend dedans, on n'attache jamais.
					// entry.path est RELATIF (vault, ou racine externe
					// préfixée de son nom) : le token reste lisible, jamais
					// de chemin absolu écrit dans le texte.
					replaceToken(token, "@" + entry.path + "/");
					void refresh();
					return;
				}
				replaceToken(token, "");
				if (entry.source === "external") {
					// Callback contractuel : chemin ABSOLU (ai.ts le lit par
					// `host.fs.externe.read`, qui attend de l'absolu). Résolution
					// relatif→absolu ICI, juste avant l'appel, jamais plus tôt.
					const resolved = resolveExternalPath(opts.getExtraRoots(), entry.path);
					if (resolved) {
						opts.onPickExternalFile(resolved.absPath);
					} else {
						// Racine retirée des réglages PENDANT que le menu était
						// ouvert (cas réel) : replaceToken a déjà effacé le
						// « @… », rien n'est attaché — sans Notice, échec
						// totalement muet.
						currentHost().ui.notice(t("ai.mention.externalRootGone", { name: entry.name }));
					}
				} else {
					opts.onPickVaultFile(entry.path);
				}
			},
		}));
	}

	async function refresh(): Promise<void> {
		/* Bumpé AVANT le test du token, pas après : un caret qui quitte le
		   « @ » (plus de token) doit lui aussi rendre caduque la liste en vol,
		   sinon elle rouvrirait le menu sur un texte qui n'a plus de mention. */
		const cette = ++generation;
		const token = findMentionToken(textarea.value, textarea.selectionStart ?? 0);
		if (!token) { close(); return; }
		if (!menu) {
			/* L'ENTRÉE D'AFFICHAGE : l'instantané des racines externes est
			   préchauffé ici, sans attendre — le vault s'affiche tout de suite,
			   et la première frappe qui cherche l'attend par
			   `revalidateExternalIndex` (parcours partagé, jamais lancé deux
			   fois). */
			void primeExternalIndex(opts.getExtraRoots()).catch(e => {
				console.warn(LOG_PREFIX, "index des racines externes:", e);
			});
		}
		let entries: FileEntry[];
		let footer: string | undefined;
		try {
			({ entries, footer } = await entriesFor(token.query));
		} catch (e) {
			/* `refresh` est appelé en `void` depuis quatre écouteurs : un rejet
			   d'`entriesFor` (un hôte qui refuse un chemin, un pont qui tombe)
			   serait une promesse non gérée, et le menu resterait figé sur la
			   liste d'avant. Fermer proprement, nommer, ne rien rouvrir. */
			console.warn(LOG_PREFIX, "sélecteur « @ » :", e);
			if (cette === generation) close();
			return;
		}
		if (cette !== generation) return;
		// Un espace qui ne mène nulle part termine le token.
		if (!entries.length && token.query.includes(" ")) { close(); return; }
		if (!menu) {
			menu = openMentionMenu(anchorEl, () => { menu = null; });
		}
		menu.setItems(itemsFor(token, entries), footer);
	}

	function onInput(): void { void refresh(); }

	/* Touches qui déplacent le caret SANS produire d'« input » : le token
	   sous le curseur change alors qu'aucun texte n'a bougé. */
	const CARET_KEYS = new Set([
		"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
	]);

	function onKeyUp(e: KeyboardEvent): void {
		// Menu ouvert : Haut/Bas lui appartiennent (navigation). Un refresh
		// ici rerendrait la liste et remettrait la sélection à zéro — les
		// flèches paraîtraient bloquées sur la première entrée.
		if (menu && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
		if (!CARET_KEYS.has(e.key)) return;
		void refresh();
	}

	/* Un clic déplace le caret sans déclencher « input ». Sans ça, cliquer
	   juste à droite d'un « @ » déjà tapé ne rouvrait pas le menu : il
	   fallait effacer le « @ » et le retaper. */
	function onClick(): void { void refresh(); }

	function onKeyDown(e: KeyboardEvent): void {
		if (!menu) return;
		if (e.key === "ArrowDown") { e.preventDefault(); menu.moveSelection(1); return; }
		if (e.key === "ArrowUp") { e.preventDefault(); menu.moveSelection(-1); return; }
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
		if (e.key === "Enter" || e.key === "Tab") {
			if (e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			menu.confirm();
		}
	}

	function onBlur(): void { close(); }

	textarea.addEventListener("input", onInput);
	// keyup/click : rouvrent le menu quand le caret revient dans un « @ »
	// existant (aucun « input » n'est émis dans ces cas-là).
	textarea.addEventListener("keyup", onKeyUp);
	textarea.addEventListener("click", onClick);
	// NB : sur l'élément CIBLE, capture ne passe pas avant bubble (les deux
	// s'exécutent à AT_TARGET dans l'ordre d'attachement). Ce qui protège
	// réellement Entrée, c'est sa garde explicite (« mentions.isOpen() »
	// dans ai.ts), pas cette phase.
	textarea.addEventListener("keydown", onKeyDown, true);
	textarea.addEventListener("blur", onBlur);

	return {
		isOpen: () => menu !== null,
		detach() {
			textarea.removeEventListener("input", onInput);
			textarea.removeEventListener("keyup", onKeyUp);
			textarea.removeEventListener("click", onClick);
			textarea.removeEventListener("keydown", onKeyDown, true);
			textarea.removeEventListener("blur", onBlur);
			close();
		},
	};
}
