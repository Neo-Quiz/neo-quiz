/* ══════════════════════════════════════════════════════════
   THE SETTINGS (a modal, `main.ts` → `ouvrirReglages`)

   TWO PANES since 2026-09-29: the categories on the left (General, Folders,
   AI, Appearance, Languages), one category at a time on the right. The page
   used to stack its seven sections in one column almost three screens tall,
   each control under its label. Every setting is now a ROW of a card —
   label and help on the left, control on the right, as in Windows 11's
   Settings — and a category rarely needs to scroll. Nothing was added or
   removed: the same settings, the same writes, the same reloads.

   The sections that live in their own module (`comptes.ts`, `fond.ts`,
   `language-packs.ts`) still receive a plain container; their rows take the
   card look from CSS (`shell.css`, "THE SETTINGS"), so they did not have to
   change. This module imports NO CSS — same constraint as the host modules:
   a CSS import pulls in the MathLive fonts, for which the check scripts'
   harness has no loader.
══════════════════════════════════════════════════════════ */

import { currentHost, requireHost } from "../../../../src/host/current";
import { t, currentLang, currentHourCycle, hourOptions, setHourCycle } from "../../../../src/i18n";
import type { HourCycle, TransKey } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { savedFolders } from "../host/folder";
import { chargerLangue, lireLangue, reglerLangue } from "./langue";
import { lireFormatHeure, reglerFormatHeure } from "./format-heure";
import { pont } from "../host/pont";
import { monterLigneMajAndroid } from "./mise-a-jour";
import { createSelect } from "../../../../src/dashboard/ui-select";
import { getProvider, MARQUES, resoudreApresMasquage } from "../../../../src/dashboard/ai-providers";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import type { AiSettings } from "../../../../src/types/dashboard-ctx";
import { monterReglagesFond } from "./fond";
import { monterReglagesComptes } from "./comptes";
import { mountLanguagePackSettings } from "./language-packs";
import { mountMoodleSettings } from "./moodle-settings";
import { EXPLAIN_MAX_CHARS_DEFAUT } from "./explain";
import { monterSync } from "../../../../src/dashboard/sync-page";
import { monterBandeauMaj } from "../../../../src/dashboard/cli-updates";
import { phoneLayoutNow } from "../../../../src/phone-layout";

type Category = "general" | "sync" | "ai" | "appearance" | "languages" | "moodle";

const CATEGORIES: Array<{ id: Category; icon: string; label: TransKey }> = [
	{ id: "general", icon: "sliders-horizontal", label: "app.settings.general" },
	/* Only where the bridge has the embedded Syncthing (Windows). */
	{ id: "sync", icon: "refresh-cw", label: "settings.sync.title" },
	{ id: "ai", icon: "sparkles", label: "app.settings.navAi" },
	{ id: "appearance", icon: "image", label: "app.settings.navAppearance" },
	{ id: "languages", icon: "code", label: "settings.languages.title" },
	/* PC only (the phone receives the files by sync): `pont().moodle` is absent there. */
	{ id: "moodle", icon: "graduation-cap", label: "settings.moodle.title" },
];

/* The category shown last, for the next opening in the same session: most
   visits come back to the setting just changed (a folder added, then the
   reload that `onFoldersChanged` triggers). Not persisted — a new session
   opens on General. */
let lastCategory: Category = "general";
/** The next opening lands on the "/exam" prompt of the AI page, scrolled to it. */
let viserPrompt: "exam" | null = null;
export function viserPromptExam(): void {
	lastCategory = "ai";
	viserPrompt = "exam";
}

/** A pairing link to put in "Add a device" (a `neo-quiz://pair` link clicked
    in the browser): taken once by the Sync page, which opens the dialog with
    it. The listeners are the open settings, so a link that arrives while
    they are shown switches to Sync at once. */
let ajoutEnAttente: string | null = null;
const surAjoutEnAttente = new Set<() => void>();
export function viserAjoutAppareil(lien: string): void {
	lastCategory = "sync";
	ajoutEnAttente = lien;
	for (const rappel of [...surAjoutEnAttente]) rappel();
}

/** A titled block of a category: its heading, an optional help line. */
function section(parent: HTMLElement, title: string | null, help?: string): HTMLElement {
	const s = ajouter(parent, "section", "nq-reglages-section");
	if (title) ajouter(s, "h3", "nq-reglages-titre", title);
	if (help) ajouter(s, "p", "nq-reglages-aide", help);
	return s;
}

/** A card: rows separated by a hairline, one border around them all. */
function card(parent: HTMLElement): HTMLElement {
	return ajouter(parent, "div", "nq-set-carte");
}

/** A setting row: name and help on the left, the control on the right. The
    returned element receives the control. */
function row(parent: HTMLElement, name: string, help?: string, tag: "div" | "label" = "div"): HTMLElement {
	const r = ajouter(parent, tag, "nq-set-ligne");
	const text = ajouter(r, "div", "nq-set-ligne-texte");
	ajouter(text, "span", "nq-reglages-nom", name);
	if (help) ajouter(text, "span", "nq-set-ligne-aide", help);
	return ajouter(r, "div", "nq-set-ligne-controle");
}

/** PHONE: a choice the way Neo Calendar shows one (2026-10-04): a row with
    its icon, its label, the current value and a chevron; a tap opens the
    list of choices, the current one ticked. Replaces a dropdown there. */
function ligneChoix(
	parent: HTMLElement,
	nomIcone: string,
	libelle: string,
	options: ReadonlyArray<{ value: string; label: string }>,
	valeur: string,
	surChoix: (valeur: string) => void,
): { setValue(valeur: string): void } {
	const ligne = ajouter(parent, "button", "nq-set-ligne nq-set-ligne-lien");
	ligne.type = "button";
	currentHost().ui.setIcon(ajouter(ligne, "span", "nq-set-ligne-icone"), nomIcone);
	ajouter(ligne, "span", "nq-set-ligne-libelle", libelle);
	const affichee = ajouter(ligne, "span", "nq-set-ligne-valeur");
	currentHost().ui.setIcon(ajouter(ligne, "span", "nq-set-onglet-chevron"), "chevron-right");
	let courante = valeur;
	const peindre = (): void => { affichee.textContent = options.find(o => o.value === courante)?.label ?? ""; };
	peindre();
	ligne.addEventListener("click", () => {
		requireHost("modals").open({
			className: "nq-choix-modal",
			title: libelle,
			onOpen: handle => {
				const liste = ajouter(handle.contentEl, "div", "nq-choix-liste");
				for (const o of options) {
					const choix = ajouter(liste, "button", "nq-choix-option" + (o.value === courante ? " is-active" : ""));
					choix.type = "button";
					ajouter(choix, "span", "nq-choix-libelle", o.label);
					if (o.value === courante) currentHost().ui.setIcon(ajouter(choix, "span", "nq-choix-coche"), "check");
					choix.addEventListener("click", () => {
						handle.close();
						if (o.value === courante) return;
						courante = o.value;
						peindre();
						surChoix(o.value);
					});
				}
			},
		});
	});
	return { setValue: v => { courante = v; peindre(); } };
}

/** A checkbox drawn as a switch: still a native checkbox (keyboard, form
    semantics), announced as a switch. */
function switchInput(parent: HTMLElement, checked: boolean): HTMLInputElement {
	const input = ajouter(parent, "input", "nq-set-interrupteur");
	input.type = "checkbox";
	input.setAttribute("role", "switch");
	input.checked = checked;
	return input;
}

export function renderSettings(
	root: HTMLElement,
	deps: {
		onFoldersChanged(): void;
		/** The time format changed: the screen UNDER the modal keeps the
		    times it has already written (a modal repaints nothing when it
		    closes), so the caller repaints it. */
		onTimeFormatChanged(): void;
		/** The AI settings: the "Paid assistants" section reads and writes the
		    hiding through the SAME host as the Generate page — a direct write
		    to the main process (comptes.ts) would leave the client's cache
		    behind, and the hidden menu entry would come back at the next
		    render. */
		aiSettings: AiSettingsHost;
	},
): () => void {
	/* NO header, NO back button: the title and the close cross are set by
	   the host (`src/host/modal.ts`). Adding them here would give two titles
	   and two ways to close. */
	const shell = ajouter(root, "div", "nq-set");
	const nav = ajouter(shell, "div", "nq-set-nav");
	nav.setAttribute("role", "tablist");
	nav.setAttribute("aria-orientation", "vertical");
	nav.setAttribute("aria-label", t("app.settings.nav"));
	const pane = ajouter(shell, "div", "nq-set-volet");

	const tabs = new Map<Category, HTMLButtonElement>();
	const pages = new Map<Category, HTMLElement>();
	const sync = pont().sync;
	/* The Sync page is mounted the FIRST TIME its tab is shown, not when the
	   settings open: reading its state is what starts the embedded Syncthing,
	   and opening the settings for the language must not launch a binary. */
	let demonterSync: () => void = () => undefined;
	let syncMonte = false;
	function monterSyncUneFois(): void {
		if (!sync || syncMonte) return;
		syncMonte = true;
		demonterSync = monterSync(pages.get("sync")!, {
			etat: () => sync.etat(),
			appairer: (id, nom) => sync.appairer(id, nom),
			oublier: id => sync.oublier(id),
			renommer: (id, nom) => sync.renommer(id, nom),
			renvoyer: id => sync.renvoyer(id),
			journal: () => sync.journal(),
			desactiver: () => sync.desactiver(),
			activer: () => sync.activer(),
			ignorer: id => sync.ignorer(id),
			partager: canal => sync.partagerId(canal),
			surEtat: rappel => sync.surEtat(rappel),
			scanner: sync.scanner ? () => sync.scanner!() : undefined,
			scannerAppairer: sync.scannerAppairer ? () => sync.scannerAppairer!() : undefined,
			qr: sync.qr ? { suivant: () => sync.qr!.suivant(), fermer: () => sync.qr!.fermer() } : undefined,
			/* The one quiz folder: opened in the Explorer on a PC; a phone shows its path only. */
			dossier: async () => {
				const d = (await savedFolders())[0];
				if (!d) return null;
				return { chemin: d.path, ouvrir: mobile ? undefined : () => { void pont().systeme.ouvrir(d.path).catch(() => undefined); } };
			},
			copier: async texte => { try { await pont().systeme.copierTexte(texte); return true; } catch { return false; } },
			preRemplissage: {
				prendre: () => { const lien = ajoutEnAttente; ajoutEnAttente = null; return lien; },
				surNouveau: rappel => { surAjoutEnAttente.add(rappel); return () => { surAjoutEnAttente.delete(rappel); }; },
			},
		});
	}
	/* No AI category on a phone or tablet: generation and the Explain button are
	   not offered there (`HostPlatform.isMobile`). */
	const mobile = currentHost().platform.isMobile;
	/* LAYOUT apart from capabilities: the one-page phone layout (title bar, tiles) only below 600 dp. */
	const phone = phoneLayoutNow();
	const categories = CATEGORIES.filter(c => (c.id !== "sync" || sync) && (c.id !== "ai" || !mobile) && (c.id !== "moodle" || (!mobile && !!pont().moodle)));
	for (const c of categories) {
		const tab = ajouter(nav, "button", "nq-set-onglet");
		tab.type = "button";
		tab.id = `nq-set-onglet-${c.id}`;
		tab.setAttribute("role", "tab");
		tab.setAttribute("aria-controls", `nq-set-page-${c.id}`);
		currentHost().ui.setIcon(ajouter(tab, "span", "nq-set-onglet-icone"), c.icon);
		ajouter(tab, "span", undefined, t(c.label));
		tab.addEventListener("click", () => show(c.id));
		tabs.set(c.id, tab);
		const page = ajouter(pane, "div", "nq-set-page");
		page.id = `nq-set-page-${c.id}`;
		page.setAttribute("role", "tabpanel");
		page.setAttribute("aria-labelledby", tab.id);
		ajouter(page, "h2", "nq-set-page-titre", t(c.label));
		pages.set(c.id, page);
	}

	/* ON A PHONE, Neo Calendar's Android settings (2026-10-04): ONE page,
	   "<- Settings" at the top, every category one after the other under a
	   grey section title, rows as tiles. Only Sync opens a page of its own,
	   from a "Sync >" row, with "<- Sync" at the top. The tab list is not
	   shown; the arrow (and the phone's back key, `retour-android.ts`) goes
	   back from Sync to the page, and from the page closes Settings. */
	let barreTitre: HTMLElement | null = null;
	if (phone) {
		const barre = document.createElement("div");
		barre.className = "nq-set-barre";
		shell.prepend(barre);
		const retour = ajouter(barre, "button", "nq-set-retour");
		retour.type = "button";
		retour.setAttribute("aria-label", t("app.settings.back"));
		currentHost().ui.setIcon(retour, "arrow-left");
		retour.addEventListener("click", () => {
			if (shell.classList.contains("is-categorie")) montrerPrincipal();
			else root.closest(".modal")?.querySelector<HTMLElement>(".modal-close-button")?.click();
		});
		barreTitre = ajouter(barre, "h1", "nq-set-barre-titre", t("review.settings.title"));
		const pageSync = pages.get("sync");
		if (pageSync) {
			const entree = ajouter(pane, "section", "nq-set-entree");
			pane.insertBefore(entree, pageSync);
			ajouter(entree, "h2", "nq-set-page-titre", t("settings.sync.title"));
			const carte = ajouter(entree, "div", "nq-set-carte");
			const ligne = ajouter(carte, "button", "nq-set-ligne nq-set-ligne-lien");
			ligne.type = "button";
			currentHost().ui.setIcon(ajouter(ligne, "span", "nq-set-ligne-icone"), "refresh-cw");
			ajouter(ligne, "span", "nq-set-ligne-libelle", t("settings.sync.title"));
			currentHost().ui.setIcon(ajouter(ligne, "span", "nq-set-onglet-chevron"), "chevron-right");
			ligne.addEventListener("click", () => show("sync"));
		}
	}

	/** Phone only: the one page with every category, Sync as a row. */
	function montrerPrincipal(): void {
		shell.classList.remove("is-categorie");
		shell.classList.add("is-principal");
		for (const [c] of tabs) pages.get(c)!.hidden = c === "sync";
		if (barreTitre) barreTitre.textContent = t("review.settings.title");
		window.scrollTo(0, 0);
	}

	function show(id: Category): void {
		if (phone) {
			shell.classList.remove("is-principal");
			shell.classList.add("is-categorie");
			if (barreTitre) barreTitre.textContent = t(categories.find(c => c.id === id)!.label);
			window.scrollTo(0, 0);
		}
		lastCategory = id;
		for (const [c, tab] of tabs) {
			const on = c === id;
			tab.setAttribute("aria-selected", String(on));
			// Roving tabindex: Tab enters the list on the current category.
			tab.tabIndex = on ? 0 : -1;
			pages.get(c)!.hidden = !on;
		}
		pane.scrollTop = 0;
		if (id === "sync") monterSyncUneFois();
	}

	/* Up and down arrows move between the categories, as in any vertical
	   tab list; Home and End jump to the ends. */
	nav.addEventListener("keydown", e => {
		const ids = categories.map(c => c.id);
		const i = ids.indexOf(lastCategory);
		const next = e.key === "ArrowDown" ? ids[(i + 1) % ids.length]
			: e.key === "ArrowUp" ? ids[(i - 1 + ids.length) % ids.length]
				: e.key === "Home" ? ids[0]
					: e.key === "End" ? ids[ids.length - 1] : null;
		if (!next) return;
		e.preventDefault();
		show(next);
		tabs.get(next)!.focus();
	});

	/* ═══ GENERAL ═══ */
	const general = card(pages.get("general")!);

	/* The language: the ONLY dropdown allowed (`ui-select.ts`), with the
	   plugin's labels (`settings.language.*`) — the same three values. On a
	   change, the setting is written and the application RESTARTED.

	   NOT a `location.reload()`, and that fixes a defect: everything is
	   rendered through `t()`, but the format of `<input type="date">` fields
	   comes from CHROMIUM'S LOCALE, set once before `app.ready`
	   (`electron/main.ts`, `poserLocaleChromium`). A reload retranslated every
	   label and left the date fields in the old locale. The restart costs a
	   second more than a reload — which already lost the window's state. */
	const langues = [
		{ value: "auto", label: t("app.settings.languageAuto") },
		{ value: "en", label: t("settings.language.en") },
		{ value: "fr", label: t("settings.language.fr") },
	];
	// The restart never returns: nothing to chain after it.
	const changerLangue = (valeur: string): void => { void reglerLangue(lireLangue(valeur)).then(() => pont().systeme.relancer()); };
	const langueSelect = phone
		? ligneChoix(general, "languages", t("settings.language.name"), langues, "auto", changerLangue)
		: createSelect(row(general, t("settings.language.name")), { value: "auto", options: langues, onChange: changerLangue });
	void chargerLangue().then(l => langueSelect.setValue(l));

	/* The TIME FORMAT: 24-hour by default, 12-hour on request, whatever the
	   language. Times are formatted at render (`hourOptions`); the screen
	   under the modal, already rendered, is repainted by the caller
	   (`onTimeFormatChanged`) once the setting is WRITTEN — otherwise the
	   quiz page open behind kept "18:35" after switching to 12-hour. Each
	   option shows its example, formatted by Intl in the interface language. */
	const exemple = (cycle: HourCycle): string =>
		new Intl.DateTimeFormat(currentLang() === "fr" ? "fr-FR" : "en-US", { minute: "2-digit", ...hourOptions(cycle) })
			.format(new Date(2026, 0, 1, 18, 35));
	const formats = [
		{ value: "24h", label: t("app.settings.timeFormat24", { example: exemple("24h") }) },
		{ value: "12h", label: t("app.settings.timeFormat12", { example: exemple("12h") }) },
	];
	const changerFormat = (valeur: string): void => {
		const format = lireFormatHeure(valeur);
		if (format === currentHourCycle()) return;
		setHourCycle(format);
		void reglerFormatHeure(format).then(() => deps.onTimeFormatChanged());
	};
	// PHONE: no option, the clock follows the phone's own 12/24-hour setting (`format-heure.ts`).
	if (!mobile) {
		createSelect(row(general, t("app.settings.timeFormat")), { value: currentHourCycle(), options: formats, onChange: changerFormat });
	}

	/* PHONE: the in-app updater (version, manual check). The desktop's menu has its own. */
	let demonterMajAndroid: () => void = () => {};
	if (mobile) {
		const controle = row(general, t("app.update.android.row"), " ");
		const aide = controle.parentElement!.querySelector<HTMLElement>(".nq-set-ligne-aide")!;
		demonterMajAndroid = monterLigneMajAndroid(controle, aide);
	}

	/* ═══ AI ═══ */
	/* On mobile the page is never attached (no category): it is built into a
	   detached node so that the prompt sections below keep their handles, and
	   the accounts (which talk to the CLIs) are not started. */
	const aiPage = pages.get("ai") ?? document.createElement("div");
	/* "Update available" for Claude Code and Codex, always shown here while it
	   applies (the Generate page lets it be hidden). */
	const demonterMaj = mobile ? () => {} : monterBandeauMaj(aiPage, () => undefined, {
		fermable: false,
		/* Through the bridge: `navigator.clipboard` is refused in the app window. */
		copyText: async texte => { try { await pont().systeme.copierTexte(texte); return true; } catch { return false; } },
	});
	const demonterComptes = mobile ? () => {} : monterReglagesComptes(section(aiPage, t("app.settings.accounts")));

	/* Paid assistants: one switch per channel that needs a subscription
	   (today Claude Code and Codex CLI, the only ones with `Canal.gratuit ===
	   false`). Off hides the channel from the Generate menu; on brings it
	   back. If the hidden channel was the chosen provider, the fallback (the
	   first free channel) goes IN THE SAME write — leaving it chosen would
	   make the generation fail without a word on screen. */
	const payants = section(aiPage, t("app.settings.paidChannels"), t("app.settings.paidChannelsHint"));
	const payantsCarte = card(payants);
	/* Read at opening: a hidden channel shows OFF. It always showed on
	   before 2026-09-29, whatever had been saved. */
	const masques = deps.aiSettings.get().aiCanauxPayantsMasques ?? [];
	let unPayant = false;
	for (const marque of MARQUES) {
		for (const canal of marque.canaux) {
			if (canal.gratuit) continue;
			unPayant = true;
			const case_ = switchInput(row(payantsCarte, t("app.settings.paidChannelRow", { name: marque.name + " · " + canal.label }), undefined, "label"), !masques.includes(canal.id));
			case_.addEventListener("change", () => {
				const courant = deps.aiSettings.get().aiCanauxPayantsMasques ?? [];
				const suivants = case_.checked
					? courant.filter(id => id !== canal.id)
					: [...new Set([...courant, canal.id])];
				const avant = deps.aiSettings.get().aiProvider || "";
				const resolu = resoudreApresMasquage(avant, suivants);
				const patch: Partial<AiSettings> = { aiCanauxPayantsMasques: suivants };
				if (resolu !== avant) {
					patch.aiProvider = resolu;
					// The model follows the provider: same rule as choosing a
					// provider in the menu (the new channel's default).
					if (resolu) patch.aiModel = getProvider(resolu).defaultModel;
				}
				void deps.aiSettings.save(patch);
			});
		}
	}
	/* No paid channel in the table: no empty section among the others — it
	   would come back by itself as soon as a channel becomes paid. */
	if (!unPayant) payants.remove();

	/* No "Generation layout" any more (2026-09-30): the conversation is always
	   full width, so everything Claude Code or Codex does shows. */

	/* The "Explain" window (2026-10-09): no prompt to edit any more, the learner
	   types freely and the quiz and its course go along behind the scenes. */
	const expliquer = section(aiPage, t("app.settings.explainTitle"), t("app.settings.explainHint"));
	/* The longest explanation (2026-09-29): the model is asked to stay under
	   it. Bounded to 300..6000; an empty or invalid field keeps the default. */
	const longueur = ajouter(card(expliquer), "div", "nq-set-ligne");
	const texteLong = ajouter(longueur, "div", "nq-set-ligne-texte");
	ajouter(texteLong, "span", "nq-reglages-nom", t("app.settings.explainMaxChars"));
	ajouter(texteLong, "span", "nq-set-ligne-aide", t("app.settings.explainMaxCharsHint"));
	const champLong = ajouter(ajouter(longueur, "div", "nq-set-ligne-controle"), "input", "nq-set-nombre");
	champLong.type = "number";
	champLong.min = "300";
	champLong.max = "6000";
	champLong.step = "100";
	champLong.value = String(deps.aiSettings.get().aiExplainMaxChars ?? EXPLAIN_MAX_CHARS_DEFAUT);
	champLong.setAttribute("aria-label", t("app.settings.explainMaxChars"));
	champLong.addEventListener("change", () => {
		const n = Math.round(Number(champLong.value));
		const borne = Number.isFinite(n) && n > 0 ? Math.min(6000, Math.max(300, n)) : EXPLAIN_MAX_CHARS_DEFAUT;
		champLong.value = String(borne);
		void deps.aiSettings.save({ aiExplainMaxChars: borne });
	});

	/* The request "/exam" writes for the learner once an exam is picked
	   (2026-09-30, `exam-command.ts`): editable like the Explain prompt,
	   {exam}, {module} and {date} replaced; empty means the translated
	   default, which "Reset" brings back. Saved when the field loses the focus. */
	const examen = section(aiPage, t("app.settings.examPrompt"), t("app.settings.examPromptHint"));
	const zoneExam = ajouter(examen, "textarea", "nq-set-prompt");
	zoneExam.rows = 5;
	zoneExam.value = deps.aiSettings.get().aiExamPrompt?.trim() || t("ai.exam.defaultPrompt");
	zoneExam.setAttribute("aria-label", t("app.settings.examPrompt"));
	zoneExam.addEventListener("change", () => {
		const v = zoneExam.value.trim();
		void deps.aiSettings.save({ aiExamPrompt: v === t("ai.exam.defaultPrompt").trim() ? "" : v });
	});
	const reinitExam = ajouter(ajouter(examen, "div", "nq-reglages-actions"), "button", "nq-reglages-changer", t("app.settings.explainPromptReset"));
	reinitExam.type = "button";
	reinitExam.addEventListener("click", () => {
		zoneExam.value = t("ai.exam.defaultPrompt");
		void deps.aiSettings.save({ aiExamPrompt: "" });
	});

	/* ═══ APPEARANCE ═══ */
	const demonterFond = monterReglagesFond(card(section(pages.get("appearance")!, t("app.settings.wallpaper"))));

	/* ═══ LANGUAGES (task 10 of the C/C++ plan): the downloadable packs ═══ */
	const languagesPage = pages.get("languages")!;
	const demonterLangages = mountLanguagePackSettings(section(languagesPage, null, t("settings.languages.hint")));

	/* The Moodle page is mounted when its tab exists (PC): it only reads the
	   state; nothing is contacted until the user signs in or syncs. */
	const moodlePage = pages.get("moodle");
	const demonterMoodle = moodlePage ? mountMoodleSettings(moodlePage, () => { root.closest(".modal")?.querySelector<HTMLElement>(".modal-close-button")?.click(); }) : () => undefined;

	if (phone) montrerPrincipal();
	else show(categories.some(c => c.id === lastCategory) ? lastCategory : "general");
	if (viserPrompt) {
		viserPrompt = null;
		requestAnimationFrame(() => { examen.scrollIntoView({ block: "center" }); zoneExam.focus(); });
	}

	/* The unmount no longer unsubscribes the updater: its section left on
	   2026-09-17, and the only subscription left is the rail's, which lives
	   as long as the shell. One is returned anyway because EVERY screen
	   returns one. */
	/* A pairing link that arrives while the settings are open switches to Sync
	   (whose page then opens "Add a device" with it). */
	const allerSync = (): void => { if (sync) show("sync"); };
	surAjoutEnAttente.add(allerSync);
	return () => { surAjoutEnAttente.delete(allerSync); demonterMaj(); demonterMajAndroid(); demonterComptes(); demonterFond(); demonterLangages(); demonterMoodle(); demonterSync(); root.replaceChildren(); };
}
