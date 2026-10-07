/* ══════════════════════════════════════════════════════════
   THE MOODLE WINDOW (PC only): a modal, opened from the "Moodle" button of
   the Folders top bar and from Settings > Moodle. A port of the window of the
   Moodle plugin the owner knew: the same views (sign in, module list, one
   module, course link), the same rows, badges, banner and buttons, with
   `ms-*` classes renamed `nqm-*` (`assets/moodle-modal.css`).

   - List: favourites first, then one group per school year (year filter),
     search that filters the list and offers "search all of Moodle", a
     "to hand in" banner, a status badge and a hand-in chip per module, a star.
   - Module: sections, one row per file (open, download, update, retry),
     hand-in cards (hand in, hide), links outside Moodle counted, download all.
   - The word "sync" never appears: it means the device sync, a different thing.

   Everything goes through `pont().moodle`: the window never sees the token, a
   file URL or a path. `module()` (added for this window) gives the sections,
   activities and hand-in states the plugin read straight from Moodle.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import type {
	ActiviteMoodle, CoursMoodle, DepotMoodle, DevoirMoodle, EtatMoodle, FichierMoodle, ModuleMoodle, ResultatRechercheMoodle,
} from "../../electron/pont";
import { currentHost, requireHost } from "../../../../src/host/current";
import type { HostModalHandle } from "../../../../src/host/types";
import { currentHourCycle, currentLang, hourOptions, t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { resumeLancement, span } from "./moodle-common";

const SONDE_MS = 2000;
const HORLOGE_MS = 30_000;
const URGENT_MS = 8 * 3600 * 1000;
/** Moodle answers a module at most once a second: a rescan right after a download waits for that. */
const PLANCHER_MS = 1100;

type Vue = "connect" | "picker" | "course" | "url" | "loading";
interface Analyse { state: "busy" | "ok" | "error"; mod: ModuleMoodle | null; at: number }

const TYPE_ICON: Record<string, string> = {
	resource: "file-text", folder: "folder", url: "link", page: "file", book: "book-open",
	assign: "file-up", forum: "message-square", quiz: "list-checks", label: "tag", feedback: "clipboard-list",
};
const TYPE_LABEL: Record<string, TransKey> = {
	resource: "settings.moodle.wTypeResource", folder: "settings.moodle.wTypeFolder", url: "settings.moodle.wTypeUrl",
	page: "settings.moodle.wTypePage", book: "settings.moodle.wTypeBook", assign: "settings.moodle.wTypeAssign",
	forum: "settings.moodle.wTypeForum", quiz: "settings.moodle.wTypeQuiz", feedback: "settings.moodle.wTypeFeedback",
};

function icone(parent: HTMLElement, nom: string, classe: string): HTMLElement {
	const s = ajouter(parent, "span", classe);
	currentHost().ui.setIcon(s, nom);
	return s;
}
function poser(el: HTMLElement, nom: string): void { currentHost().ui.setIcon(el, nom); }

function taille(octets: number | null): string {
	if (octets === null) return "";
	const fr = currentLang() === "fr";
	if (octets < 1024) return `${octets} ${fr ? "o" : "B"}`;
	if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} ${fr ? "Ko" : "KB"}`;
	return `${(octets / (1024 * 1024)).toFixed(1)} ${fr ? "Mo" : "MB"}`;
}
const locale = (): string => (currentLang() === "fr" ? "fr-FR" : "en-US");
function quand(sec: number): string {
	const d = new Date(sec * 1000);
	return t("settings.moodle.wWhenAt", {
		day: d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" }),
		time: d.toLocaleTimeString(locale(), { minute: "2-digit", ...hourOptions(currentHourCycle()) }),
	});
}
function nomCourt(c: { name: string }): string { return c.name.replace(/^\S+\s*-\s*/, ""); }
/** A stable colour per module code (the plugin took it from its tiles). */
function teinte(code: string | null): string {
	let h = 0;
	for (const ch of code ?? "") h = (h * 31 + ch.charCodeAt(0)) % 360;
	return `hsl(${h} 62% 64%)`;
}
function typeFichier(nom: string): string {
	const ext = (nom.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
	if (/^\.(zip|rar|7z|tar|gz)$/.test(ext)) return "file-archive";
	if (/^\.(png|jpe?g|gif|svg|webp)$/.test(ext)) return "file-image";
	if (/^\.(py|js|c|cpp|java|sh|ps1|sql|html|css|ipynb)$/.test(ext)) return "file-code";
	if (/^\.(xlsx?|csv|ods)$/.test(ext)) return "file-spreadsheet";
	return "file-text";
}
const nomAffiche = (f: FichierMoodle): string => f.relPath.split("/").pop() || f.name;
const tousFichiers = (m: ModuleMoodle): FichierMoodle[] => m.sections.flatMap(s => s.activites.flatMap(a => a.fichiers));

/** The hand-in state, recomputed on the window's clock so a card turns red without a reload. */
function etatDepot(d: DepotMoodle): { state: DepotMoodle["state"]; due: number; remaining: number } {
	if (d.state === "submitted" || d.state === "open" || !d.due) return { state: d.state, due: d.due, remaining: 0 };
	const remaining = d.due * 1000 - Date.now();
	if (remaining > 0) return { state: remaining <= URGENT_MS ? "urgent" : "todo", due: d.due, remaining };
	if (d.cutoff && d.cutoff * 1000 <= Date.now()) return { state: "closed", due: d.due, remaining };
	return { state: "late", due: d.due, remaining };
}

let ouverte: HostModalHandle | null = null;

export function openMoodleModal(): void {
	if (!pont().moodle || ouverte || currentHost().platform.isMobile) return;
	let detruit = false;
	let nettoyer: () => void = () => undefined;
	ouverte = requireHost("modals").open({
		className: "nq-moodle-modal",
		onOpen: poignee => { nettoyer = monter(poignee.contentEl, () => detruit); },
		onClose: () => { detruit = true; ouverte = null; nettoyer(); },
	});
}

function monter(contenu: HTMLElement, estDetruit: () => boolean): () => void {
	const api = pont().moodle!;
	const c = ajouter(contenu, "div", "nqm-root");
	let vue: Vue = "loading";
	let etat: EtatMoodle | null = null;
	let cours: CoursMoodle[] = [];
	let devoirs: DevoirMoodle[] = [];
	const nouveaux = new Set<number>();
	const trouves: ResultatRechercheMoodle[] = [];
	const analyses = new Map<number, Analyse>();
	let chaine: Promise<void> = Promise.resolve();
	let filtreAnnee: string | null | undefined;
	let rechercheFaite = false;
	let actualise = false;
	let telechargeTout = false;
	/** A result line (download all) kept on the status until the next action. */
	let note: string | null = null;
	let hauteurBandeau = "";
	let courant: CoursMoodle | null = null;
	let sonde: ReturnType<typeof setInterval> | null = null;
	let horloge: ReturnType<typeof setInterval> | null = null;
	const occupes = new Set<string>();

	let statut: HTMLElement | null = null;
	let champ: HTMLInputElement | null = null;
	let resultats: HTMLElement | null = null;
	let bandeau: HTMLElement | null = null;
	let boutonFiltre: HTMLElement | null = null;
	let libelleFiltre: HTMLElement | null = null;
	let menu: HTMLElement | null = null;
	let boutonTout: HTMLButtonElement | null = null;
	let liste: HTMLElement | null = null;
	let pied: HTMLElement | null = null;
	let boutonCours: HTMLButtonElement | null = null;
	const badges = new Map<number, { badge: HTMLElement; depot: HTMLElement; cours: CoursMoodle }>();
	const cartesDepot = new Map<ActiviteMoodle, { rang: HTMLElement; icone: HTMLElement; titre: HTMLElement; meta: HTMLElement; cote: HTMLElement }>();

	c.addEventListener("click", () => { if (menu) menu.hidden = true; });
	const desabonner = api.surEtat(e => {
		const avant = etat?.connected;
		etat = e;
		if (e.connected !== avant && (vue === "connect" || !e.connected)) { void chargerTout().then(demarrer); return; }
		if (vue === "picker") peindrePied();
	});

	/* ── data ── */
	async function chargerCours(): Promise<void> {
		cours = await api.cours().catch(() => [] as CoursMoodle[]);
	}
	async function chargerDevoirs(): Promise<void> {
		devoirs = await api.devoirs().catch(() => [] as DevoirMoodle[]);
		for (const d of devoirs) if (d.nouveau) nouveaux.add(d.cmid);
	}
	async function chargerTout(): Promise<void> {
		etat = await api.etat().catch(() => null);
		if (estDetruit()) return;
		if (etat?.connected && etat.state === "connected") await Promise.all([chargerCours(), chargerDevoirs()]);
		else { cours = []; devoirs = []; }
	}
	function connecte(): boolean { return !!etat && etat.connected && etat.state === "connected"; }

	/* The analysis of a module (sections, files, hand-ins), one at a time: Moodle answers a module per second. */
	function analyser(co: CoursMoodle, force: boolean): void {
		if (!co.code || co.exclu) return;
		const cur = analyses.get(co.id);
		if (cur?.state === "busy" || (cur && !force)) return;
		analyses.set(co.id, { state: "busy", mod: cur?.mod ?? null, at: cur?.at ?? 0 });
		surAnalyse(co.id);
		chaine = chaine.then(async () => {
			if (estDetruit()) return;
			const attente = (cur?.at ?? 0) + PLANCHER_MS - Date.now();
			if (attente > 0) await new Promise(r => setTimeout(r, attente));
			try {
				const mod = await api.module(co.id);
				analyses.set(co.id, { state: "ok", mod, at: Date.now() });
			} catch {
				analyses.set(co.id, { state: "error", mod: cur?.mod ?? null, at: Date.now() });
			}
			if (!estDetruit()) surAnalyse(co.id);
		});
	}

	function demarrer(): void {
		if (estDetruit()) return;
		if (!connecte()) peindreConnexion(); else peindreListe();
	}

	/* ── shared pieces ── */
	function dire(texte: string, tourne = false, erreur = false): void {
		if (!statut) return;
		statut.hidden = false;
		statut.replaceChildren();
		statut.classList.toggle("is-error", erreur);
		if (tourne) ajouter(statut, "div", "nqm-spinner");
		ajouter(statut, "span", undefined, texte);
	}
	function entete(parent: HTMLElement, retour: boolean): HTMLElement {
		const tete = ajouter(parent, "div", "nqm-head");
		if (retour) {
			const b = ajouter(tete, "button", "nqm-back");
			b.type = "button";
			poser(b, "arrow-left");
			ajouter(b, "span", undefined, t("settings.moodle.wOtherModule"));
			b.addEventListener("click", () => peindreListe());
		}
		return tete;
	}
	function vider(): void {
		c.replaceChildren();
		badges.clear();
		cartesDepot.clear();
		arreterHorloge();
		arreterSonde();
		statut = champ = resultats = bandeau = boutonFiltre = libelleFiltre = menu = boutonTout = liste = pied = boutonCours = null;
	}
	function arreterSonde(): void { if (sonde) clearInterval(sonde); sonde = null; }
	function arreterHorloge(): void { if (horloge) clearInterval(horloge); horloge = null; }
	function bouton(parent: HTMLElement, classe: string, texte: string, icon?: string): HTMLButtonElement {
		const b = ajouter(parent, "button", classe);
		b.type = "button";
		if (icon) icone(b, icon, "nqm-btn-icon");
		ajouter(b, "span", undefined, texte);
		return b;
	}

	/* ── sign in ── */
	function peindreConnexion(): void {
		vue = "connect";
		vider();
		const tete = entete(c, false);
		ajouter(tete, "h2", "nqm-title", t("settings.moodle.title"));
		ajouter(tete, "p", "nqm-hint", t("settings.moodle.wHintSignIn"));
		const boite = ajouter(c, "div", "nqm-connect");
		const expire = etat?.state === "expired";
		const attente = !!etat?.loginPending;
		const b = bouton(boite, "nqm-primary", expire ? t("settings.moodle.signInAgain") : t("settings.moodle.signIn"), "log-in");
		b.disabled = !etat?.site || attente;
		statut = ajouter(c, "div", "nqm-status");
		statut.hidden = true;
		if (expire) dire(t("settings.moodle.expired"));
		if (etat?.error === "secure-storage-unavailable") dire(t("settings.moodle.errorStorage"), false, true);
		else if (etat?.error === "login-failed") dire(t("settings.moodle.errorLogin"), false, true);
		else if (etat?.error === "site-not-allowed") dire(t("settings.moodle.errorSite"), false, true);
		if (attente) {
			dire(t("settings.moodle.waiting"), true);
			const annuler = bouton(statut!, "nqm-link", t("settings.moodle.cancel"));
			annuler.addEventListener("click", () => { void api.deconnecter().then(() => chargerTout()).then(demarrer); });
			sonde = setInterval(() => { void chargerTout().then(() => { if (connecte()) demarrer(); }); }, SONDE_MS);
		}
		b.addEventListener("click", () => {
			b.disabled = true;
			void api.connecter().then(() => chargerTout(), () => undefined).then(demarrer);
		});
	}

	/* ── module list ── */
	function annees(): string[] {
		return [...new Set(cours.map(co => co.annee).filter((a): a is string => !!a))].sort((a, b) => b.localeCompare(a, "fr"));
	}
	function visibles(): CoursMoodle[] {
		return cours.filter(co => !filtreAnnee || co.annee === filtreAnnee);
	}
	function depotsDe(co: CoursMoodle): DevoirMoodle[] { return devoirs.filter(d => d.courseId === co.id); }

	function peindreListe(): void {
		vue = "picker";
		courant = null;
		note = null;
		vider();
		const tete = entete(c, false);
		ajouter(tete, "h2", "nqm-title", t("settings.moodle.title"));
		ajouter(tete, "p", "nqm-hint", t("settings.moodle.wHintPicker"));

		bandeau = ajouter(c, "div", "nqm-deadlines");
		bandeau.hidden = true;

		const barre = ajouter(c, "div", "nqm-searchbar");
		icone(barre, "search", "nqm-search-icon");
		champ = ajouter(barre, "input", "nqm-search");
		champ.type = "text";
		champ.placeholder = t("settings.moodle.wSearchModules");
		champ.spellcheck = false;
		champ.setAttribute("aria-label", t("settings.moodle.wSearchModules"));
		boutonFiltre = ajouter(barre, "button", "nqm-filter");
		boutonFiltre.setAttribute("type", "button");
		icone(boutonFiltre, "list-filter", "nqm-filter-icon");
		libelleFiltre = ajouter(boutonFiltre, "span", "nqm-filter-label");
		menu = ajouter(barre, "div", "nqm-filter-menu");
		menu.hidden = true;
		const m = menu;
		boutonFiltre.addEventListener("click", e => { e.stopPropagation(); m.hidden = !m.hidden; });

		resultats = ajouter(c, "div", "nqm-results");

		const pa = ajouter(c, "div", "nqm-footer nqm-footer-split");
		statut = ajouter(pa, "div", "nqm-status");
		const droite = ajouter(pa, "div", "nqm-foot-right");
		const outils = ajouter(droite, "div", "nqm-foot-tools");
		bouton(outils, "nqm-link", t("settings.moodle.wRefresh")).addEventListener("click", () => { void actualiser(true); });
		bouton(outils, "nqm-link", t("settings.moodle.wManual")).addEventListener("click", () => peindreUrl());
		boutonTout = bouton(droite, "nqm-primary nqm-sync-all", "");
		boutonTout.addEventListener("click", () => { void toutTelecharger(); });

		champ.addEventListener("input", () => { note = null; rechercheFaite = false; trouves.length = 0; peindreResultats(); });
		champ.addEventListener("keydown", e => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			resultats?.querySelector<HTMLElement>(".nqm-course")?.click();
		});

		apresCours();
		if (!actualise) { actualise = true; void actualiser(false); }
		setTimeout(() => champ?.focus(), 0);
	}

	async function actualiser(rescan: boolean): Promise<void> {
		if (rescan) dire(t("settings.moodle.checkingStart"), true);
		await Promise.all([chargerCours(), chargerDevoirs()]);
		if (estDetruit() || vue !== "picker") return;
		apresCours();
		if (rescan) prescan(true);
	}

	function apresCours(): void {
		const ans = annees();
		if (filtreAnnee === undefined) filtreAnnee = ans[0] ?? null;
		if (!menu || !boutonTout) return;
		menu.replaceChildren();
		const option = (valeur: string | null, texte: string): void => {
			const o = ajouter(menu!, "button", "nqm-filter-option", texte);
			o.type = "button";
			o.addEventListener("click", e => { e.stopPropagation(); appliquerFiltre(valeur); });
		};
		for (const a of ans) option(a, a);
		option(null, t("settings.moodle.wAllYears"));
		if (champ) champ.disabled = false;
		appliquerFiltre(filtreAnnee);
	}
	function appliquerFiltre(valeur: string | null): void {
		filtreAnnee = valeur;
		if (libelleFiltre) libelleFiltre.textContent = valeur ?? t("settings.moodle.wAllShort");
		boutonFiltre?.classList.toggle("is-active", !!valeur);
		if (menu) menu.hidden = true;
		peindreResultats();
		prescan(false);
	}
	function prescan(force: boolean): void {
		for (const co of visibles()) analyser(co, force);
	}

	function peindreResultats(): void {
		if (!resultats || !champ) return;
		const q = champ.value.trim().toLowerCase();
		resultats.replaceChildren();
		badges.clear();
		const trouvees = visibles().filter(co => !q || (co.code ?? "").toLowerCase().includes(q) || co.name.toLowerCase().includes(q));

		if (q.length >= 3 && !rechercheFaite) {
			const plus = ajouter(resultats, "button", "nqm-searchall", t("settings.moodle.wSearchAll", { q: champ.value.trim() }));
			plus.type = "button";
			plus.addEventListener("click", e => { e.stopPropagation(); void chercherTout(plus); });
		}
		if (trouves.length) {
			const g = ajouter(resultats, "div", "nqm-year");
			const h = ajouter(g, "div", "nqm-year-name");
			ajouter(h, "span", undefined, t("settings.moodle.wResultsAll"));
			ajouter(h, "span", "nqm-year-count", String(trouves.length));
			for (const r of trouves) {
				const ligne = ajouter(g, "button", "nqm-course");
				ligne.type = "button";
				icone(ligne, "graduation-cap", "nqm-course-icon").style.color = teinte(r.code);
				ajouter(ligne, "span", "nqm-course-code", r.code).style.color = teinte(r.code);
				ajouter(ligne, "span", "nqm-course-name", nomCourt(r));
				ajouter(ligne, "span", "nqm-course-badge is-new", t("settings.moodle.wAddToList"));
				ligne.addEventListener("click", () => { void ajouterEtOuvrir(r); });
			}
		}

		if (!trouvees.length) {
			if (!trouves.length) ajouter(resultats, "div", "nqm-empty", t("settings.moodle.wNoMatch"));
			peindrePied();
			peindreBandeau();
			return;
		}

		const favoris = trouvees.filter(co => co.favori);
		const groupes = new Map<string, CoursMoodle[]>();
		for (const co of trouvees) {
			if (co.favori) continue;
			const cle = co.annee ?? t("settings.moodle.wUnknownYear");
			if (!groupes.has(cle)) groupes.set(cle, []);
			groupes.get(cle)!.push(co);
		}
		const ordre: Array<[string, CoursMoodle[]]> = [...groupes.entries()].sort((a, b) => b[0].localeCompare(a[0], "fr"));
		if (favoris.length) ordre.unshift([t("settings.moodle.wFavourites"), favoris]);
		for (const [annee, groupe] of ordre) {
			const g = ajouter(resultats, "div", "nqm-year");
			const h = ajouter(g, "div", "nqm-year-name");
			if (groupe === favoris) icone(h, "star", "nqm-year-icon");
			ajouter(h, "span", undefined, annee);
			ajouter(h, "span", "nqm-year-count", String(groupe.length));
			for (const co of [...groupe].sort((a, b) => (a.code ?? "zz").localeCompare(b.code ?? "zz", "fr"))) peindreLigne(g, co, groupe);
		}
		peindrePied();
		peindreBandeau();
	}

	function peindreLigne(g: HTMLElement, co: CoursMoodle, groupe: CoursMoodle[]): void {
		const ligne = ajouter(g, "button", "nqm-course");
		ligne.type = "button";
		if (co.exclu) ligne.style.opacity = "0.55";
		icone(ligne, "graduation-cap", "nqm-course-icon").style.color = teinte(co.code);
		const code = ajouter(ligne, "span", "nqm-course-code", co.code ?? "—");
		code.style.color = teinte(co.code);
		if (!co.code) code.classList.add("is-orphan");
		ajouter(ligne, "span", "nqm-course-name", nomCourt(co));
		if (co.cohorte && groupe.filter(x => x.code === co.code).length > 1) ajouter(ligne, "span", "nqm-course-cohort", co.cohorte);
		const depot = ajouter(ligne, "span", "nqm-course-deposit");
		const badge = ajouter(ligne, "span", "nqm-course-badge");
		const etoile = ajouter(ligne, "span", "nqm-course-star" + (co.favori ? " is-on" : ""));
		etoile.setAttribute("role", "button");
		etoile.tabIndex = 0;
		etoile.setAttribute("aria-label", t(co.favori ? "settings.moodle.unfavorite" : "settings.moodle.favorite"));
		poser(etoile, "star");
		const basculer = (e: Event): void => {
			e.stopPropagation();
			e.preventDefault();
			const on = !co.favori;
			co.favori = on;
			peindreResultats();
			void api.favori(co.id, on).then(undefined, () => { co.favori = !on; peindreResultats(); });
		};
		etoile.addEventListener("click", basculer);
		etoile.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") basculer(e); });
		badges.set(co.id, { badge, depot, cours: co });
		peindreBadge(co.id);
		ligne.addEventListener("click", () => surLigne(co));
	}

	function peindrePuceDepot(id: number): void {
		const r = badges.get(id);
		if (!r) return;
		const el = r.depot;
		el.replaceChildren();
		el.className = "nqm-course-deposit";
		const liste = depotsDe(r.cours);
		if (!liste.length) return;
		const chaud = liste.some(d => d.state === "urgent" || d.state === "late");
		if (chaud) el.classList.add("is-urgent");
		if (liste.some(d => nouveaux.has(d.cmid))) el.classList.add("is-fresh");
		icone(el, chaud ? "alarm-clock" : "file-up", "nqm-badge-icon");
		ajouter(el, "span", undefined, t("settings.moodle.wRowDue", { n: liste.length }));
	}

	function peindreBadge(id: number): void {
		peindrePuceDepot(id);
		const r = badges.get(id);
		if (!r) return;
		const { badge, cours: co } = r;
		badge.replaceChildren();
		badge.className = "nqm-course-badge";
		badge.removeAttribute("title");
		if (co.exclu) { badge.classList.add("is-warn"); badge.textContent = t("settings.moodle.excludedTag"); return; }
		if (!co.code) { badge.classList.add("is-warn"); badge.textContent = t("settings.moodle.wNoFolder"); return; }
		const st = analyses.get(id);
		if (!st) return;
		if (st.state === "error") {
			badge.classList.add("is-error");
			badge.textContent = t("settings.moodle.wError");
			badge.title = t("settings.moodle.wRetryHint");
			return;
		}
		if (!st.mod) { ajouter(badge, "div", "nqm-spinner"); return; }
		const { nouveau, misAJour } = resume(st.mod);
		if (!nouveau && !misAJour) {
			badge.classList.add("is-ok");
			icone(badge, "check", "nqm-badge-icon");
			ajouter(badge, "span", undefined, t("settings.moodle.wUpToDate"));
			return;
		}
		badge.classList.add("is-new");
		const morceaux: string[] = [];
		if (nouveau) morceaux.push(t(nouveau > 1 ? "settings.moodle.wBadgeNewMany" : "settings.moodle.wBadgeNew", { n: nouveau }));
		if (misAJour) morceaux.push(t("settings.moodle.wBadgeUpdated", { n: misAJour }));
		badge.textContent = morceaux.join(" · ");
	}
	function resume(m: ModuleMoodle): { nouveau: number; misAJour: number } {
		let nouveau = 0, misAJour = 0;
		for (const f of tousFichiers(m)) {
			if (f.status === "missing" || f.status === "failed") nouveau++;
			else if (f.status === "outdated") misAJour++;
		}
		return { nouveau, misAJour };
	}

	function surLigne(co: CoursMoodle): void {
		const st = analyses.get(co.id);
		if (st?.state === "error") { analyser(co, true); return; }
		ouvrirCours(co);
	}

	function surAnalyse(id: number): void {
		if (vue === "picker") {
			peindreBadge(id);
			peindrePied();
			peindreBandeau();
			return;
		}
		if (vue !== "course" || !courant || courant.id !== id) return;
		const st = analyses.get(id);
		if (!st) return;
		if (st.state === "error" && !st.mod) { dire(t("settings.moodle.runFailed"), false, true); return; }
		if (st.state === "busy" && !st.mod) return;
		redessinerCours();
	}

	function aTelecharger(): number {
		let n = 0;
		for (const co of cours) {
			const st = analyses.get(co.id);
			if (!st?.mod || co.exclu) continue;
			const r = resume(st.mod);
			n += r.nouveau + r.misAJour;
		}
		return n;
	}

	function peindrePied(): void {
		if (vue !== "picker" || !boutonTout) return;
		const verifie = visibles().filter(co => analyses.get(co.id)?.state === "busy").length;
		if (!verifie && note) dire(note);
		else if (verifie) dire(t(verifie > 1 ? "settings.moodle.wCheckingMany" : "settings.moodle.wCheckingOne", { n: verifie }), true);
		else if (etat?.pausedMetered) dire(t("settings.moodle.pausedMetered"));
		else dire(t("settings.moodle.wCount", { n: visibles().length }));
		const b = boutonTout;
		b.replaceChildren();
		if (telechargeTout) {
			b.disabled = true;
			ajouter(b, "div", "nqm-spinner");
			const p = etat?.progress;
			ajouter(b, "span", undefined, p ? `${p.done} / ${p.total}` : t("settings.moodle.wDownloading"));
			return;
		}
		const n = aTelecharger();
		b.disabled = !n;
		if (n) {
			icone(b, "download", "nqm-btn-icon");
			ajouter(b, "span", undefined, t("settings.moodle.wDownloadAll", { n }));
		} else {
			icone(b, verifie ? "loader" : "check", "nqm-btn-icon");
			ajouter(b, "span", undefined, verifie ? t("settings.moodle.wCheckingBtn") : t("settings.moodle.wAllUpToDate"));
		}
	}

	async function toutTelecharger(): Promise<void> {
		if (telechargeTout || !aTelecharger()) return;
		telechargeTout = true;
		peindrePied();
		const r = await api.synchroniser().catch(() => null);
		telechargeTout = false;
		if (estDetruit()) return;
		if (r) note = resumeLancement(r);
		await chargerDevoirs();
		if (vue === "picker") { for (const co of visibles()) analyser(co, true); peindreResultats(); }
	}

	async function chercherTout(btn: HTMLButtonElement): Promise<void> {
		const terme = champ?.value.trim() ?? "";
		btn.disabled = true;
		btn.textContent = t("settings.moodle.wSearching");
		try {
			const r = await api.chercher(terme);
			const connus = new Set(cours.map(co => co.id));
			trouves.length = 0;
			trouves.push(...r.filter(x => !connus.has(x.id)));
			rechercheFaite = true;
			peindreResultats();
			if (!trouves.length) dire(t("settings.moodle.wNoMore"));
		} catch {
			btn.remove();
			dire(t("settings.moodle.searchFailed"), false, true);
		}
	}
	async function ajouterEtOuvrir(r: ResultatRechercheMoodle): Promise<void> {
		try {
			await api.ajouter(r.id);
			await chargerCours();
			const co = cours.find(x => x.id === r.id);
			trouves.length = 0;
			if (co) ouvrirCours(co); else peindreResultats();
		} catch { dire(t("settings.moodle.urlError"), false, true); }
	}

	/* ── "to hand in" banner ── */
	function peindreBandeau(): void {
		const boite = bandeau;
		if (!boite || vue !== "picker") return;
		const ids = new Set(visibles().map(co => co.id));
		const tous = devoirs.filter(d => ids.has(d.courseId));
		const defile = boite.querySelector<HTMLElement>(".nqm-dl-list")?.scrollTop ?? 0;
		boite.replaceChildren();
		if (!tous.length) { boite.hidden = true; return; }
		boite.hidden = false;
		const urgents = tous.filter(d => d.state === "urgent").length;
		const retards = tous.filter(d => d.state === "late").length;
		const frais = tous.filter(d => nouveaux.has(d.cmid)).length;
		boite.classList.toggle("is-urgent", urgents > 0);
		const tete = ajouter(boite, "div", "nqm-dl-head");
		icone(tete, urgents ? "alarm-clock" : "file-up", "nqm-dl-icon");
		ajouter(tete, "span", "nqm-dl-title", tous.length > 1 ? t("settings.moodle.wDueMany", { n: tous.length }) : t("settings.moodle.wDueOne"));
		if (retards) ajouter(tete, "span", "nqm-dl-late", t("settings.moodle.wDueLate", { n: retards }));
		if (frais) ajouter(tete, "span", "nqm-dl-fresh", t(frais > 1 ? "settings.moodle.wDueNewMany" : "settings.moodle.wDueNew", { n: frais }));
		const lst = ajouter(boite, "div", "nqm-dl-list is-scroll");
		if (hauteurBandeau) lst.style.height = hauteurBandeau;
		lst.addEventListener("mouseup", () => { if (lst.style.height) hauteurBandeau = lst.style.height; });
		for (const d of tous) ligneEcheance(lst, d);
		lst.scrollTop = defile;
	}
	function ligneEcheance(lst: HTMLElement, d: DevoirMoodle): void {
		const co = cours.find(x => x.id === d.courseId);
		const ligne = ajouter(lst, "div", `nqm-dl-item is-${d.state}`);
		ajouter(ligne, "span", "nqm-dl-code", co?.code ?? "—");
		ajouter(ligne, "span", "nqm-dl-module", co ? nomCourt(co) : d.course);
		const nom = ajouter(ligne, "span", "nqm-dl-name", d.name);
		if (nouveaux.has(d.cmid)) ajouter(nom, "span", "nqm-dl-new", t("settings.moodle.wNew"));
		const envoyer = ajouter(ligne, "button", "nqm-dl-send", t("settings.moodle.wHandIn"));
		envoyer.type = "button";
		envoyer.setAttribute("aria-label", t("settings.moodle.wHandInAria"));
		envoyer.addEventListener("click", e => { e.stopPropagation(); void api.deposer(d.cmid); });
		const quandTxt = d.state === "late" ? t("settings.moodle.wWhenLate")
			: d.state === "open" ? t("settings.moodle.wWhenNone")
				: t("settings.moodle.wWhenLeft", { span: span(d.remaining) });
		ajouter(ligne, "span", "nqm-dl-when", quandTxt);
		const cache = ajouter(ligne, "button", "nqm-dl-hide");
		cache.type = "button";
		cache.setAttribute("aria-label", t("settings.moodle.wHideAria"));
		poser(cache, "eye");
		cache.addEventListener("click", e => {
			e.stopPropagation();
			devoirs = devoirs.filter(x => x.cmid !== d.cmid);
			peindreBandeau();
			peindrePuceDepot(d.courseId);
			void api.ignorerDevoir(d.cmid, true).then(undefined, () => { void chargerDevoirs().then(peindreBandeau); });
		});
		ligne.addEventListener("click", () => { if (co) ouvrirCours(co); });
	}

	/* ── course link ── */
	function peindreUrl(): void {
		vue = "url";
		vider();
		const tete = entete(c, true);
		ajouter(tete, "h2", "nqm-title", t("settings.moodle.title"));
		ajouter(tete, "p", "nqm-hint", t("settings.moodle.wUrlHint"));
		const ligne = ajouter(c, "div", "nqm-urlrow");
		const champUrl = ajouter(ligne, "input", "nqm-input");
		champUrl.type = "text";
		champUrl.spellcheck = false;
		champUrl.placeholder = `${etat?.site || "https://moodle.example.edu"}/course/view.php?id=…`;
		const ouvrir = bouton(ligne, "nqm-primary", t("settings.moodle.wUrlOpen"));
		statut = ajouter(c, "div", "nqm-status");
		statut.hidden = true;
		const aller = (): void => {
			const adresse = champUrl.value.trim();
			if (!adresse) return;
			ouvrir.disabled = true;
			void api.ajouterParUrl(adresse).then(async co => {
				await chargerCours();
				ouvrirCours(cours.find(x => x.id === co.id) ?? co);
			}, () => { ouvrir.disabled = false; dire(t("settings.moodle.wUrlInvalid"), false, true); });
		};
		ouvrir.addEventListener("click", aller);
		champUrl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); aller(); } });
		setTimeout(() => { champUrl.focus(); }, 0);
	}

	/* ── one module ── */
	function ouvrirCours(co: CoursMoodle): void {
		vue = "course";
		courant = co;
		const st = analyses.get(co.id);
		if (st?.mod) { peindreCours(st.mod); return; }
		vider();
		enteteCours(co);
		statut = ajouter(c, "div", "nqm-status");
		dire(t("settings.moodle.wCourseReading"), true);
		analyser(co, st?.state === "error");
	}

	function enteteCours(co: CoursMoodle): void {
		const tete = entete(c, true);
		ajouter(tete, "h2", "nqm-title", co.name);
		const dest = ajouter(tete, "div", "nqm-dest" + (co.folder ? "" : " is-warn"));
		icone(dest, "folder-open", "nqm-dest-icon");
		ajouter(dest, "span", "nqm-dest-path", co.folder ?? t("settings.moodle.wDestNone"));
		if (co.folderExists) {
			const b = ajouter(dest, "button", "nqm-ghost", t("settings.moodle.openFolder"));
			b.type = "button";
			b.addEventListener("click", () => { void api.ouvrirDossier(co.id); });
		}
	}

	function redessinerCours(): void {
		const st = courant ? analyses.get(courant.id) : null;
		if (!st?.mod) return;
		const haut = liste?.scrollTop ?? 0;
		peindreCours(st.mod);
		if (liste) liste.scrollTop = haut;
	}

	function peindreCours(mod: ModuleMoodle): void {
		const co = courant;
		if (!co) return;
		vider();
		enteteCours(co);
		const masques = (a: ActiviteMoodle): boolean => a.masque;
		const lst = ajouter(c, "div", "nqm-sections");
		liste = lst;
		const sections = mod.sections.map(s => ({ ...s, activites: s.activites.filter(a => !masques(a)) })).filter(s => s.activites.length);
		if (!sections.length) ajouter(lst, "div", "nqm-empty", t("settings.moodle.wNoActivity"));
		for (const s of sections) {
			const el = ajouter(lst, "div", "nqm-section");
			ajouter(el, "div", "nqm-section-name", s.name);
			for (const a of s.activites) peindreActivite(el, co, a);
		}
		if (mod.externes) {
			const ext = ajouter(c, "div", "nqm-external");
			const titre = ajouter(ext, "div", "nqm-external-title");
			icone(titre, "external-link", "nqm-external-icon");
			ajouter(titre, "span", undefined, t("settings.moodle.wExternal", { n: mod.externes }));
		}
		pied = ajouter(c, "div", "nqm-footer");
		const gauche = ajouter(pied, "div", "nqm-foot-tools nqm-never");
		const excl = bouton(gauche, "nqm-ghost", t(co.exclu ? "settings.moodle.include" : "settings.moodle.exclude"));
		excl.addEventListener("click", () => {
			void api.exclure(co.id, !co.exclu).then(async () => { await chargerCours(); courant = cours.find(x => x.id === co.id) ?? co; redessinerCours(); }, () => undefined);
		});
		if (co.extra) {
			bouton(gauche, "nqm-ghost", t("settings.moodle.remove")).addEventListener("click", () => {
				void api.retirer(co.id).then(async () => { await chargerCours(); peindreListe(); }, () => undefined);
			});
		}
		statut = ajouter(pied, "div", "nqm-status");
		statut.hidden = true;
		if (etat?.pausedMetered) dire(t("settings.moodle.pausedMetered"));
		boutonCours = bouton(pied, "nqm-primary nqm-all", "");
		boutonCours.addEventListener("click", () => { void telechargerCours(co); });
		pieCours(mod);

		/* The hand-ins shown here are no longer "new". */
		for (const d of devoirs) if (d.courseId === co.id && d.nouveau) { d.nouveau = false; void api.devoirVu(d.cmid).catch(() => undefined); }
		if (cartesDepot.size) horloge = setInterval(() => { for (const a of cartesDepot.keys()) peindreDepot(a); }, HORLOGE_MS);
	}

	function pieCours(mod: ModuleMoodle): void {
		const b = boutonCours;
		if (!b) return;
		const co = courant;
		const fichiers = tousFichiers(mod);
		const faire = fichiers.filter(f => f.status !== "present").length;
		const occupe = !!co && fichiers.some(f => occupes.has(`${co.id}|${f.name}`)) || occupes.has(`c|${co?.id}`);
		b.replaceChildren();
		b.disabled = !faire || occupe || !co?.folder;
		if (occupe) {
			ajouter(b, "div", "nqm-spinner");
			ajouter(b, "span", undefined, t("settings.moodle.wDownloading"));
		} else if (!faire) {
			icone(b, "check", "nqm-btn-icon");
			ajouter(b, "span", undefined, t("settings.moodle.wAllUpToDate"));
		} else {
			icone(b, "download", "nqm-btn-icon");
			ajouter(b, "span", undefined, t("settings.moodle.wDownloadAll", { n: faire }));
		}
	}

	function peindreActivite(parent: HTMLElement, co: CoursMoodle, a: ActiviteMoodle): void {
		const el = ajouter(parent, "div", `nqm-activity is-${a.type}`);
		if (a.fichiers.length === 1 && !a.depot) { peindreFichier(el, co, a.fichiers[0]); return; }
		const ligne = ajouter(el, "div", "nqm-row nqm-act-row");
		icone(ligne, TYPE_ICON[a.type] ?? "circle-dot", `nqm-row-icon nqm-act-icon is-${a.type}`);
		const info = ajouter(ligne, "div", "nqm-row-info");
		ajouter(info, "div", "nqm-row-name", a.name);
		if (a.fichiers.length > 1) ajouter(info, "div", "nqm-row-meta", t("settings.moodle.wFilesCount", { n: a.fichiers.length }));
		const cle = TYPE_LABEL[a.type];
		ajouter(ligne, "div", "nqm-row-type", cle ? t(cle) : a.type);
		if (a.depot) peindreCarteDepot(el, a);
		if (a.fichiers.length) {
			const groupe = ajouter(el, "div", "nqm-act-files");
			for (const f of a.fichiers) peindreFichier(groupe, co, f);
		}
	}

	function peindreCarteDepot(parent: HTMLElement, a: ActiviteMoodle): void {
		const rang = ajouter(parent, "div", "nqm-deposit");
		const ic = ajouter(rang, "div", "nqm-deposit-icon");
		const info = ajouter(rang, "div", "nqm-deposit-info");
		const titre = ajouter(info, "div", "nqm-deposit-title");
		const meta = ajouter(info, "div", "nqm-deposit-meta");
		const cote = ajouter(rang, "div", "nqm-deposit-side");
		cartesDepot.set(a, { rang, icone: ic, titre, meta, cote });
		peindreDepot(a);
	}

	function peindreDepot(a: ActiviteMoodle): void {
		const el = cartesDepot.get(a);
		const dep = a.depot;
		if (!el || !dep) return;
		const st = etatDepot(dep);
		const urgent = st.state === "urgent" || st.state === "late" || st.state === "closed";
		el.rang.className = `nqm-deposit is-${st.state}${urgent ? " is-urgent" : ""}`;
		el.icone.replaceChildren();
		el.titre.replaceChildren();
		el.meta.replaceChildren();
		el.cote.replaceChildren();
		const icones: Record<string, string> = { submitted: "check", todo: "clock", urgent: "alarm-clock", late: "triangle-alert", closed: "lock", open: "clock" };
		poser(el.icone, icones[st.state] ?? "clock");
		const nonEnvoye = t(dep.brouillon ? "settings.moodle.wDraft" : "settings.moodle.wNotSent");
		if (st.state === "submitted") {
			el.titre.textContent = dep.deposeLe ? t("settings.moodle.wDepOn", { when: quand(dep.deposeLe) }) : t("settings.moodle.wDepDone");
			if (dep.fichiers.length) el.meta.textContent = dep.fichiers.join(" · ");
			ajouter(el.cote, "span", "nqm-badge is-present", t("settings.moodle.wDepBadge"));
			return;
		}
		if (st.state === "todo" || st.state === "urgent") {
			el.titre.textContent = t("settings.moodle.wDepLeft", { state: nonEnvoye, span: span(st.remaining) });
			el.meta.textContent = t("settings.moodle.wDepDueBefore", { when: quand(st.due) });
		} else if (st.state === "late") {
			el.titre.textContent = t("settings.moodle.wDepLate", { state: nonEnvoye });
			el.meta.textContent = dep.cutoff
				? t("settings.moodle.wDepLateCutoff", { when: quand(st.due), cutoff: quand(dep.cutoff) })
				: t("settings.moodle.wDepLateMeta", { when: quand(st.due) });
		} else if (st.state === "closed") {
			el.titre.textContent = t("settings.moodle.wDepClosed", { state: nonEnvoye });
			el.meta.textContent = t("settings.moodle.wDepClosedMeta", { when: quand(dep.cutoff) });
		} else {
			el.titre.textContent = nonEnvoye;
			el.meta.textContent = t("settings.moodle.wDepNoLimit");
		}
		if (st.state === "closed") return;
		const cache = ajouter(el.cote, "button", "nqm-dl-hide nqm-deposit-hide");
		cache.type = "button";
		cache.setAttribute("aria-label", t("settings.moodle.wDepHideAria"));
		poser(cache, "eye");
		cache.addEventListener("click", () => {
			a.masque = true;
			devoirs = devoirs.filter(d => d.cmid !== a.id);
			redessinerCours();
			void api.ignorerDevoir(a.id, true).then(undefined, () => undefined);
		});
		const envoi = ajouter(el.cote, "button", "nqm-ghost", t("settings.moodle.wDepSend"));
		envoi.type = "button";
		envoi.addEventListener("click", () => { void api.deposer(a.id); });
	}

	function peindreFichier(parent: HTMLElement, co: CoursMoodle, f: FichierMoodle): void {
		const occupe = occupes.has(`${co.id}|${f.name}`);
		const ligne = ajouter(parent, "div", `nqm-row nqm-file is-${occupe ? "busy" : f.status}`);
		const ic = ajouter(ligne, "div", "nqm-row-icon nqm-file-icon");
		const info = ajouter(ligne, "div", "nqm-row-info");
		const shown = nomAffiche(f);
		ajouter(info, "div", "nqm-row-name nqm-file-name", shown);
		const meta = ajouter(info, "div", "nqm-row-meta nqm-file-meta");
		const morceaux: string[] = [];
		if (shown !== f.name) morceaux.push(f.name);
		if (f.size) morceaux.push(taille(f.size));
		if (f.date) morceaux.push(new Date(f.date * 1000).toLocaleDateString(locale()));
		meta.textContent = morceaux.join(" · ");
		const action = ajouter(ligne, "div", "nqm-file-action");

		if (occupe) {
			poser(ic, "download");
			ajouter(action, "div", "nqm-spinner");
			ajouter(action, "span", "nqm-busy-label", t("settings.moodle.wDownloading"));
			return;
		}
		if (f.status === "present") { poser(ic, typeFichier(f.name)); boutonOuvrir(action, co, f); return; }
		const echec = f.status === "failed";
		poser(ic, echec ? "triangle-alert" : f.status === "outdated" ? "refresh-cw" : "download");
		if (echec) ajouter(meta, "div", "nqm-file-error", t("settings.moodle.wFileFailed"));
		if (f.status === "outdated") {
			ajouter(meta, "div", "nqm-file-note", t("settings.moodle.wNewerOnMoodle"));
			boutonOuvrir(action, co, f);
		}
		const b = ajouter(action, "button", `nqm-ghost nqm-file-get${f.status === "missing" ? " is-accent" : ""}`);
		b.type = "button";
		icone(b, echec ? "rotate-ccw" : f.status === "outdated" ? "refresh-cw" : "download", "nqm-btn-icon");
		ajouter(b, "span", undefined, t(echec ? "settings.moodle.wRetry" : f.status === "outdated" ? "settings.moodle.wUpdate" : "settings.moodle.download"));
		b.addEventListener("click", () => { void telechargerFichier(co, f); });
	}

	/** Opens the local copy with the system's default application; the spinner stays 1.5 s at least,
	    because the window of the application appears long after the system accepted the request. */
	function boutonOuvrir(parent: HTMLElement, co: CoursMoodle, f: FichierMoodle): void {
		const b = ajouter(parent, "button", "nqm-ghost nqm-file-open");
		b.type = "button";
		const repos = (): void => {
			b.replaceChildren();
			b.classList.remove("is-opening");
			b.disabled = false;
			icone(b, "external-link", "nqm-btn-icon");
			ajouter(b, "span", undefined, t("settings.moodle.openFile"));
		};
		repos();
		b.addEventListener("click", e => {
			e.stopPropagation();
			if (b.disabled) return;
			b.replaceChildren();
			b.classList.add("is-opening");
			b.disabled = true;
			ajouter(b, "div", "nqm-spinner");
			ajouter(b, "span", undefined, t("settings.moodle.wOpening"));
			void Promise.all([api.ouvrirFichier(co.id, f.name).catch(() => false), new Promise(r => setTimeout(r, 1500))]).then(([ok]) => {
				if (estDetruit()) return;
				repos();
				if (!ok) dire(t("settings.moodle.wOpenFailed"), false, true);
			});
		});
	}

	async function telechargerFichier(co: CoursMoodle, f: FichierMoodle): Promise<void> {
		const cle = `${co.id}|${f.name}`;
		occupes.add(cle);
		redessinerCours();
		const r = await api.telechargerFichier(co.id, f.name).catch(() => null);
		occupes.delete(cle);
		if (estDetruit()) return;
		analyser(co, true);
		if (r && vue === "course") dire(resumeLancement(r), false, !!r.erreur);
		redessinerCours();
	}
	async function telechargerCours(co: CoursMoodle): Promise<void> {
		occupes.add(`c|${co.id}`);
		redessinerCours();
		const r = await api.telechargerCours(co.id).catch(() => null);
		occupes.delete(`c|${co.id}`);
		if (estDetruit()) return;
		analyser(co, true);
		redessinerCours();
		if (r && vue === "course") dire(resumeLancement(r), false, !!r.erreur);
	}

	/* ── start ── */
	void chargerTout().then(() => {
		if (estDetruit()) return;
		if (etat === null) { peindreConnexion(); return; }
		demarrer();
	});
	ajouter(c, "div", "nqm-status", t("settings.moodle.wCoursesLoading"));

	return () => { arreterSonde(); arreterHorloge(); desabonner(); };
}
