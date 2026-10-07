/* ══════════════════════════════════════════════════════════
   THE MOODLE PAGE (PC only), opened from the "Moodle" button of the Folders
   top bar as a sheet over Folders (`dashboard-shell.ts`, view "moodle").
   The gestures of the old Moodle plugin: courses with favourites first, search
   across all of Moodle and add by course link, exclude/include, a course that
   expands to its files with a status chip, download a course or a file, open
   the folder or a file, and the assignments with "Hand in" and "Hide".

   Everything goes through `pont().moodle`: the window never sees the token, a
   file URL or a path. Not signed in, the page shows ONE button. The word
   "sync" never appears: it means the device sync, a different thing.
   One flat look: a list of rows separated by hairlines, no tile in a tile.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import type { CoursMoodle, DevoirMoodle, EtatMoodle, FichierMoodle, ResultatRechercheMoodle } from "../../electron/pont";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { boutonPlat, echeance, erreurLancement, heure, resumeLancement } from "./moodle-common";

const SONDE_MS = 2000;

function taille(octets: number | null): string {
	if (octets === null) return "";
	if (octets < 1024) return `${octets} B`;
	if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} KB`;
	return `${(octets / (1024 * 1024)).toFixed(1)} MB`;
}

function icone(parent: HTMLElement, nom: string, classe = "nq-mdl-icone"): HTMLElement {
	const s = ajouter(parent, "span", classe);
	currentHost().ui.setIcon(s, nom);
	return s;
}

function boutonIcone(parent: HTMLElement, nom: string, libelle: string, surClic: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", "nq-mdl-bouton-icone");
	b.type = "button";
	b.title = libelle;
	b.setAttribute("aria-label", libelle);
	icone(b, nom);
	b.addEventListener("click", surClic);
	return b;
}

export function mountMoodlePage(target: HTMLElement, opts: { onBack(): void }): () => void {
	const api = pont().moodle;
	let detruit = false;
	const racine = ajouter(target, "div", "nq-mdl");
	const entete = ajouter(racine, "div", "nq-mdl-entete");
	boutonIcone(entete, "arrow-left", t("settings.moodle.back"), opts.onBack);
	ajouter(entete, "h1", "nq-mdl-titre", t("settings.moodle.title"));
	const etatLigne = ajouter(entete, "span", "nq-mdl-etat");
	const verifier = boutonPlat(entete, t("settings.moodle.checkNow"), () => {
		verifier.disabled = true;
		void api?.synchroniser().then(() => charger(), () => undefined).then(() => { verifier.disabled = false; });
	});
	verifier.hidden = true;
	const corps = ajouter(racine, "div", "nq-mdl-corps");
	if (!api) return () => { detruit = true; };

	let etat: EtatMoodle | null = null;
	let cours: CoursMoodle[] = [];
	let devoirs: DevoirMoodle[] = [];
	let resultats: ResultatRechercheMoodle[] | null = null;
	let messageRecherche = "";
	let texteRecherche = "";
	const ouverts = new Set<number>();
	const fichiers = new Map<number, FichierMoodle[] | "loading">();
	const occupes = new Set<string>();
	const messages = new Map<number, string>();
	/** Assignments shown as new: the badge stays while the page is open, they are marked seen as shown. */
	const nouveaux = new Set<number>();
	let sonde: ReturnType<typeof setInterval> | null = null;
	let derniereConnexion = false;

	/* ── data ── */
	async function charger(): Promise<void> {
		const e = await api!.etat().catch(() => null);
		if (detruit) return;
		etat = e;
		const connecte = !!e && e.connected && e.state === "connected";
		if (connecte) {
			[cours, devoirs] = await Promise.all([api!.cours().catch(() => [] as CoursMoodle[]), api!.devoirs().catch(() => [] as DevoirMoodle[])]);
			if (detruit) return;
			for (const d of devoirs) if (d.nouveau && !nouveaux.has(d.cmid)) { nouveaux.add(d.cmid); void api!.devoirVu(d.cmid).catch(() => undefined); }
		} else { cours = []; devoirs = []; }
		derniereConnexion = connecte;
		if (e?.loginPending) demarrerSonde(); else arreterSonde();
		peindre();
	}
	function demarrerSonde(): void { if (!sonde) sonde = setInterval(() => { if (!detruit) void charger(); }, SONDE_MS); }
	function arreterSonde(): void { if (sonde) clearInterval(sonde); sonde = null; }
	const desabonner = api.surEtat(e => {
		const etaitConnecte = derniereConnexion;
		etat = e;
		if (e.connected !== etaitConnecte) void charger(); else peindreEtat();
	});

	function peindreEtat(): void {
		const e = etat;
		verifier.hidden = !e || !e.connected;
		if (!e || !e.connected) { etatLigne.textContent = ""; return; }
		if (e.syncing) etatLigne.textContent = e.progress ? t("settings.moodle.checking", { done: e.progress.done, total: e.progress.total }) : t("settings.moodle.checkingStart");
		else etatLigne.textContent = e.lastCheck ? t("settings.moodle.upToDate", { time: heure(e.lastCheck) }) : t("settings.moodle.neverChecked");
	}

	/* ── painting ── */
	function peindre(): void {
		/* Keep the search field alive while the user types in it. */
		const champ = corps.querySelector<HTMLInputElement>(".nq-mdl-recherche input");
		const avaitFocus = !!champ && document.activeElement === champ;
		const defilement = racine.parentElement?.scrollTop ?? 0;
		corps.replaceChildren();
		peindreEtat();
		const e = etat;
		if (!e || !(e.connected && e.state === "connected")) { peindreDeconnecte(e); return; }
		peindreRecherche(avaitFocus);
		peindreCours();
		peindreDevoirs();
		if (racine.parentElement) racine.parentElement.scrollTop = defilement;
	}

	function peindreDeconnecte(e: EtatMoodle | null): void {
		const bloc = ajouter(corps, "div", "nq-mdl-vide");
		if (e?.loginPending) {
			ajouter(bloc, "p", "nq-mdl-texte", t("settings.moodle.waiting"));
			boutonPlat(bloc, t("settings.moodle.cancel"), () => { void api!.deconnecter().then(charger); });
			return;
		}
		if (e?.state === "expired") ajouter(bloc, "p", "nq-mdl-texte", t("settings.moodle.expired"));
		const b = boutonPlat(bloc, e?.state === "expired" ? t("settings.moodle.signInAgain") : t("settings.moodle.signIn"), () => {
			void api!.connecter().catch(() => undefined).then(charger);
		});
		b.classList.add("nq-moodle-principal");
		b.disabled = !e?.site;
	}

	function section(titre: string): HTMLElement {
		const s = ajouter(corps, "section", "nq-mdl-section");
		ajouter(s, "h2", "nq-mdl-section-titre", titre);
		return ajouter(s, "div", "nq-mdl-liste");
	}

	function peindreRecherche(garderFocus: boolean): void {
		const zone = ajouter(corps, "div", "nq-mdl-recherche");
		icone(zone, "search");
		const champ = ajouter(zone, "input", "nq-mdl-champ");
		champ.type = "text";
		champ.spellcheck = false;
		champ.placeholder = t("settings.moodle.searchPlaceholder");
		champ.value = texteRecherche;
		champ.setAttribute("aria-label", t("settings.moodle.searchPlaceholder"));
		let delai: ReturnType<typeof setTimeout> | null = null;
		champ.addEventListener("input", () => {
			texteRecherche = champ.value;
			if (delai) clearTimeout(delai);
			delai = setTimeout(() => { void chercher(); }, 350);
		});
		champ.addEventListener("keydown", e => { if (e.key === "Enter") { if (delai) clearTimeout(delai); void chercher(); } });
		if (garderFocus) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
		if (/^https?:\/\//i.test(texteRecherche.trim())) {
			boutonPlat(zone, t("settings.moodle.urlAdd"), () => { void ajouterParUrl(); });
		}
		if (messageRecherche) ajouter(corps, "p", "nq-mdl-message nq-moodle-rouge", messageRecherche);
		if (resultats) {
			const liste = ajouter(corps, "div", "nq-mdl-liste nq-mdl-resultats");
			if (!resultats.length) ajouter(liste, "div", "nq-mdl-ligne").append(t("settings.moodle.searchNone"));
			for (const r of resultats) {
				const l = ajouter(liste, "div", "nq-mdl-ligne");
				const txt = ajouter(l, "div", "nq-mdl-texte-col");
				ajouter(txt, "span", "nq-mdl-nom", r.name);
				ajouter(txt, "span", "nq-mdl-sous", r.code);
				if (r.dansListe) ajouter(l, "span", "nq-mdl-sous", t("settings.moodle.searchAdded"));
				else boutonPlat(l, t("settings.moodle.searchAdd"), () => { void api!.ajouter(r.id).then(() => { r.dansListe = true; return charger(); }, () => undefined); });
			}
		}
	}

	async function chercher(): Promise<void> {
		const texte = texteRecherche.trim();
		messageRecherche = "";
		if (!texte || /^https?:\/\//i.test(texte)) { resultats = null; peindre(); return; }
		try { resultats = await api!.chercher(texte); } catch { resultats = null; messageRecherche = t("settings.moodle.searchFailed"); }
		if (!detruit) peindre();
	}
	async function ajouterParUrl(): Promise<void> {
		messageRecherche = "";
		try { await api!.ajouterParUrl(texteRecherche.trim()); texteRecherche = ""; resultats = null; await charger(); }
		catch { messageRecherche = t("settings.moodle.urlError"); peindre(); }
	}

	function peindreCours(): void {
		const liste = section(t("settings.moodle.courses"));
		if (!cours.length) { ajouter(ajouter(liste, "div", "nq-mdl-ligne"), "span", "nq-mdl-sous", t("settings.moodle.coursesEmpty")); return; }
		for (const c of cours) peindreCoursLigne(liste, c);
	}

	function peindreCoursLigne(liste: HTMLElement, c: CoursMoodle): void {
		const bloc = ajouter(liste, "div", "nq-mdl-cours" + (c.exclu ? " is-exclu" : ""));
		const l = ajouter(bloc, "div", "nq-mdl-ligne");
		const etoile = boutonIcone(l, "star", t(c.favori ? "settings.moodle.unfavorite" : "settings.moodle.favorite"), () => {
			void api!.favori(c.id, !c.favori).then(charger, () => undefined);
		});
		if (c.favori) etoile.classList.add("is-actif");
		const ouvert = ouverts.has(c.id);
		const txt = ajouter(l, "button", "nq-mdl-texte-col nq-mdl-ouvrir");
		txt.type = "button";
		txt.setAttribute("aria-expanded", String(ouvert));
		txt.title = t(ouvert ? "settings.moodle.collapse" : "settings.moodle.expand");
		ajouter(txt, "span", "nq-mdl-nom", c.name);
		const dossier = !c.code ? t("settings.moodle.noCode")
			: c.folder ? (c.folderExists ? t("settings.moodle.toFolder", { folder: c.folder }) : t("settings.moodle.toNewFolder", { folder: c.folder }))
				: "";
		ajouter(txt, "span", "nq-mdl-sous", [c.code, dossier, c.exclu ? t("settings.moodle.excludedTag") : ""].filter(Boolean).join(" · "));
		txt.addEventListener("click", () => { void basculer(c.id); });

		const actions = ajouter(l, "div", "nq-mdl-actions");
		if (c.code && !c.exclu) {
			const b = boutonPlat(actions, t("settings.moodle.download"), () => { void telechargerCours(c.id); });
			b.disabled = occupes.has("c" + c.id);
		}
		if (c.folderExists) boutonPlat(actions, t("settings.moodle.openFolder"), () => { void api!.ouvrirDossier(c.id); });
		if (c.code) boutonPlat(actions, t(c.exclu ? "settings.moodle.include" : "settings.moodle.exclude"), () => { void api!.exclure(c.id, !c.exclu).then(charger, () => undefined); });
		if (c.extra) boutonPlat(actions, t("settings.moodle.remove"), () => { void api!.retirer(c.id).then(charger, () => undefined); });
		const msg = messages.get(c.id);
		if (msg) ajouter(bloc, "p", "nq-mdl-message", msg);

		if (ouvert) {
			const f = fichiers.get(c.id);
			const sous = ajouter(bloc, "div", "nq-mdl-fichiers");
			if (f === "loading" || f === undefined) ajouter(sous, "div", "nq-mdl-ligne nq-mdl-sous", t("settings.moodle.filesLoading"));
			else if (!f.length) ajouter(sous, "div", "nq-mdl-ligne nq-mdl-sous", t("settings.moodle.filesEmpty"));
			else for (const fic of f) peindreFichier(sous, c, fic);
		}
	}

	function peindreFichier(parent: HTMLElement, c: CoursMoodle, f: FichierMoodle): void {
		const l = ajouter(parent, "div", "nq-mdl-ligne nq-mdl-fichier");
		const txt = ajouter(l, "div", "nq-mdl-texte-col");
		ajouter(txt, "span", "nq-mdl-nom", f.name);
		ajouter(txt, "span", "nq-mdl-sous", [f.section, taille(f.size)].filter(Boolean).join(" · "));
		const cle = { present: "settings.moodle.statusPresent", missing: "settings.moodle.statusMissing", outdated: "settings.moodle.statusOutdated", failed: "settings.moodle.statusFailed" } as const;
		ajouter(l, "span", "nq-mdl-puce is-" + f.status, t(cle[f.status]));
		const actions = ajouter(l, "div", "nq-mdl-actions");
		if (f.status !== "present") {
			const b = boutonPlat(actions, t("settings.moodle.download"), () => { void telechargerFichier(c.id, f.name); });
			b.disabled = occupes.has("f" + c.id + f.name);
		}
		if (f.status === "present" || f.status === "outdated") boutonPlat(actions, t("settings.moodle.openFile"), () => { void api!.ouvrirFichier(c.id, f.name); });
	}

	async function basculer(id: number): Promise<void> {
		if (ouverts.has(id)) { ouverts.delete(id); peindre(); return; }
		ouverts.add(id);
		fichiers.set(id, "loading");
		peindre();
		await rechargerFichiers(id);
	}
	async function rechargerFichiers(id: number): Promise<void> {
		try { fichiers.set(id, await api!.fichiers(id)); } catch { fichiers.set(id, []); }
		if (!detruit) peindre();
	}
	async function telechargerCours(id: number): Promise<void> {
		occupes.add("c" + id);
		messages.delete(id);
		peindre();
		const r = await api!.telechargerCours(id).catch(() => null);
		occupes.delete("c" + id);
		if (detruit) return;
		if (r) messages.set(id, resumeLancement(r));
		if (ouverts.has(id)) await rechargerFichiers(id); else peindre();
		void charger();
	}
	async function telechargerFichier(id: number, nom: string): Promise<void> {
		occupes.add("f" + id + nom);
		peindre();
		const r = await api!.telechargerFichier(id, nom).catch(() => null);
		occupes.delete("f" + id + nom);
		if (detruit) return;
		const err = r ? erreurLancement(r) : null;
		if (err) messages.set(id, err); else messages.delete(id);
		await rechargerFichiers(id);
	}

	function peindreDevoirs(): void {
		const liste = section(t("settings.moodle.assignments"));
		if (!devoirs.length) { ajouter(ajouter(liste, "div", "nq-mdl-ligne"), "span", "nq-mdl-sous", t("settings.moodle.assignmentsEmpty")); return; }
		const groupes: Array<[DevoirMoodle["state"], string]> = [
			["late", "settings.moodle.groupLate"], ["urgent", "settings.moodle.groupUrgent"], ["todo", "settings.moodle.groupTodo"], ["open", "settings.moodle.groupOpen"],
		];
		for (const [etatDevoir, cle] of groupes) {
			const dans = devoirs.filter(d => d.state === etatDevoir);
			if (!dans.length) continue;
			ajouter(liste, "div", "nq-mdl-groupe nq-mdl-groupe-" + etatDevoir, t(cle as "settings.moodle.groupLate"));
			for (const d of dans) {
				const l = ajouter(liste, "div", "nq-mdl-ligne");
				const txt = ajouter(l, "div", "nq-mdl-texte-col");
				const nom = ajouter(txt, "span", "nq-mdl-nom", d.name);
				if (nouveaux.has(d.cmid)) ajouter(nom, "span", "nq-mdl-nouveau", t("settings.moodle.newBadge"));
				const code = cours.find(c => c.id === d.courseId)?.code ?? d.course;
				ajouter(txt, "span", "nq-mdl-sous nq-mdl-echeance-" + d.state, `${code} · ${echeance(d)}`);
				const actions = ajouter(l, "div", "nq-mdl-actions");
				boutonPlat(actions, t("settings.moodle.handIn"), () => { void api!.deposer(d.cmid); });
				boutonPlat(actions, t("settings.moodle.hide"), () => { void api!.ignorerDevoir(d.cmid, true).then(charger, () => undefined); });
			}
		}
	}

	void charger();
	return () => { detruit = true; arreterSonde(); desabonner(); };
}
