/* ══════════════════════════════════════════════════════════
   THE BUG REPORT FORM (PC only): a modal opened from the app menu once the
   relay is configured. Modelled on VS Code's issue reporter and Chrome's
   feedback form: what happened, steps, expected, a title, and a "details
   sent" block whose boxes can be unticked, with a preview of the log.
   Everything goes through `pont().signalement`: the window hands text and
   gets a result back, it never sees a token.
══════════════════════════════════════════════════════════ */

import { LIMITS } from "../../../../src/bug-report";
import { canSend, defaultTitle, reportFromForm } from "../../../../src/bug-report-form";
import type { FormState } from "../../../../src/bug-report-form";
import { ajouter } from "../../../../src/dom";
import { currentHost, requireHost } from "../../../../src/host/current";
import type { HostModalHandle } from "../../../../src/host/types";
import { t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { pont } from "../host/pont";

let ouverte: HostModalHandle | null = null;

/** Codes after which GitHub itself is the way forward, so that button leads. */
const CODES_REPLI = new Set(["disabled", "upstream"]);
const CODES_CONNUS = new Set(["invalid", "rate_limited", "duplicate", "upstream", "disabled"]);

export function openBugReportModal(deps: { fallbackUrl: () => string }): void {
	if (ouverte || !pont().signalement) return;
	let nettoyer: () => void = () => undefined;
	ouverte = requireHost("modals").open({
		className: "nq-bug-modal",
		title: t("bugReport.title"),
		onOpen: poignee => { nettoyer = monter(poignee.contentEl, deps, () => poignee.close()); },
		onClose: () => { ouverte = null; nettoyer(); },
	});
}

function icone(el: HTMLElement, nom: string): void { currentHost().ui.setIcon(el, nom); }

function bouton(parent: HTMLElement, classe: string, texte: string, surClic: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", `nqb-btn ${classe}`, texte);
	b.type = "button";
	b.addEventListener("click", surClic);
	return b;
}

interface Champ { el: HTMLInputElement | HTMLTextAreaElement; maj(): void }

function monter(contenu: HTMLElement, deps: { fallbackUrl: () => string }, fermer: () => void): () => void {
	const api = pont().signalement!;
	let detruit = false;
	const etat: FormState = {
		what: "", steps: "", expected: "", title: "",
		sendEnv: true, sendLog: true, env: null, log: "", sending: false,
	};
	let titreModifie = false;
	let connexion = false;

	const racine = ajouter(contenu, "div", "nqb-root");
	const formulaire = ajouter(racine, "div", "nqb-form");

	/* ─── Fields ─── */
	function champ(label: TransKey, placeholder: TransKey | null, max: number, lignes: number, valeur: (v: string) => void): Champ {
		const bloc = ajouter(formulaire, "label", "nqb-field");
		const tete = ajouter(bloc, "span", "nqb-field-head");
		ajouter(tete, "span", "nqb-label", t(label));
		const compteur = ajouter(tete, "span", "nqb-counter");
		let el: HTMLInputElement | HTMLTextAreaElement;
		if (lignes > 0) {
			el = ajouter(bloc, "textarea", "nqb-input nqb-area");
			(el as HTMLTextAreaElement).rows = lignes;
		} else {
			el = ajouter(bloc, "input", "nqb-input");
			(el as HTMLInputElement).type = "text";
		}
		if (placeholder) el.placeholder = t(placeholder);
		el.maxLength = max;
		const maj = (): void => { compteur.textContent = t("bugReport.counter", { count: el.value.length, max }); };
		el.addEventListener("input", () => { valeur(el.value); maj(); majBoutons(); });
		maj();
		return { el, maj };
	}

	const quoi = champ("bugReport.what", "bugReport.whatPlaceholder", LIMITS.what, 4, v => {
		etat.what = v;
		// The title follows the description until the user edits it.
		if (!titreModifie) { etat.title = defaultTitle(v); titre.el.value = etat.title; titre.maj(); }
	});
	champ("bugReport.steps", "bugReport.stepsPlaceholder", LIMITS.text, 3, v => { etat.steps = v; });
	champ("bugReport.expected", "bugReport.expectedPlaceholder", LIMITS.text, 2, v => { etat.expected = v; });
	const titre = champ("bugReport.reportTitle", null, LIMITS.title, 0, v => { titreModifie = true; etat.title = v; });

	/* ─── Details sent ─── */
	const details = ajouter(formulaire, "div", "nqb-details");
	ajouter(details, "div", "nqb-label", t("bugReport.details"));
	const envLigne = ajouter(details, "label", "nqb-check");
	const envCase = ajouter(envLigne, "input");
	envCase.type = "checkbox";
	envCase.checked = true;
	envCase.addEventListener("change", () => { etat.sendEnv = envCase.checked; });
	const envTexte = ajouter(envLigne, "span", "nqb-check-text");
	ajouter(envTexte, "span", "nqb-check-label", t("bugReport.envLabel"));
	const envValeur = ajouter(envTexte, "span", "nqb-check-value");

	const logLigne = ajouter(details, "div", "nqb-log");
	const logTete = ajouter(logLigne, "div", "nqb-check nqb-log-head");
	const logCase = ajouter(logTete, "input");
	logCase.type = "checkbox";
	logCase.checked = true;
	logCase.id = "nqb-log-case";
	logCase.addEventListener("change", () => { etat.sendLog = logCase.checked; });
	const logLabel = ajouter(logTete, "label", "nqb-check-label", t("bugReport.logLabel"));
	logLabel.htmlFor = logCase.id;
	const logBascule = ajouter(logTete, "button", "nqb-link");
	logBascule.type = "button";
	logBascule.setAttribute("aria-expanded", "false");
	const logBasculeTexte = ajouter(logBascule, "span", undefined, t("bugReport.logShow"));
	const logChevron = ajouter(logBascule, "span", "nqb-chevron");
	icone(logChevron, "chevron-down");
	// Grid rows 0fr to 1fr: the preview opens and closes smoothly, whatever its height.
	const logZone = ajouter(logLigne, "div", "nqb-log-zone");
	const logInterieur = ajouter(logZone, "div", "nqb-log-inner");
	const logPre = ajouter(logInterieur, "pre", "nqb-log-pre");
	logBascule.addEventListener("click", () => {
		const ouvert = logZone.classList.toggle("is-open");
		logBascule.setAttribute("aria-expanded", String(ouvert));
		logBasculeTexte.textContent = t(ouvert ? "bugReport.logHide" : "bugReport.logShow");
		logChevron.classList.toggle("is-open", ouvert);
	});
	details.hidden = true;
	logLigne.hidden = true;

	void api.apercu().then(r => {
		if (detruit || !r.ok) return;
		etat.env = r.env;
		envValeur.textContent = `${r.env.app} · ${r.env.os}`;
		etat.log = r.log;
		logPre.textContent = r.log;
		logLigne.hidden = r.log.trim() === "";
		details.hidden = false;
	}).catch(() => undefined);

	/* ─── GitHub account ─── */
	const compte = ajouter(formulaire, "div", "nqb-github");
	function dessinerCompte(connecte: string | null, code?: { userCode: string; uri: string }, erreur?: string): void {
		compte.replaceChildren();
		if (connecte) {
			const ligne = ajouter(compte, "div", "nqb-github-row");
			icone(ajouter(ligne, "span", "nqb-github-mark"), "github");
			ajouter(ligne, "span", "nqb-github-text", t("bugReport.githubAs", { login: connecte }));
			bouton(ligne, "nqb-quiet", t("bugReport.githubDisconnect"), () => {
				void api.github.deconnecter().then(() => { if (!detruit) dessinerCompte(null); });
			});
			return;
		}
		if (code) {
			ajouter(compte, "div", "nqb-github-title", t("bugReport.githubCode"));
			ajouter(compte, "div", "nqb-code", code.userCode);
			const ligne = ajouter(compte, "div", "nqb-github-row");
			bouton(ligne, "nqb-secondary", t("bugReport.githubOpen"), () => { window.open(code.uri, "_blank", "noopener"); });
			bouton(ligne, "nqb-quiet", t("bugReport.githubCancel"), () => { void api.github.annuler(); });
			ajouter(compte, "div", "nqb-hint", t("bugReport.githubWaiting"));
			return;
		}
		const ligne = ajouter(compte, "div", "nqb-github-row");
		icone(ajouter(ligne, "span", "nqb-github-mark"), "github");
		const texte = ajouter(ligne, "span", "nqb-github-text");
		ajouter(texte, "span", "nqb-check-label", t("bugReport.github"));
		ajouter(texte, "span", "nqb-hint", t("bugReport.githubHint"));
		bouton(ligne, "nqb-secondary", t("bugReport.githubConnect"), () => { void connecter(); });
		if (erreur) ajouter(compte, "div", "nqb-error-inline", erreur);
	}
	async function connecter(): Promise<void> {
		if (connexion) return;
		connexion = true;
		try {
			const d = await api.github.connecter();
			if (detruit) return;
			if (!d.ok) {
				dessinerCompte(null, undefined, t(d.code === "busy" ? "bugReport.githubError.busy" : "bugReport.githubError.failed"));
				return;
			}
			dessinerCompte(null, { userCode: d.userCode, uri: d.verificationUri });
			const fin = await api.github.attendre();
			if (detruit) return;
			if ("login" in fin) dessinerCompte(fin.login);
			else if (fin.error === "cancelled") dessinerCompte(null);
			else dessinerCompte(null, undefined, t(`bugReport.githubError.${fin.error}`));
		} catch {
			if (!detruit) dessinerCompte(null, undefined, t("bugReport.githubError.failed"));
		} finally {
			connexion = false;
		}
	}
	void api.github.etat().then(e => { if (!detruit) dessinerCompte(e?.login ?? null); }).catch(() => { if (!detruit) dessinerCompte(null); });

	/* ─── Notice, error, actions ─── */
	ajouter(formulaire, "p", "nqb-notice", t("bugReport.notice"));
	const erreurZone = ajouter(formulaire, "div", "nqb-error");
	erreurZone.hidden = true;
	erreurZone.setAttribute("role", "alert");
	const actions = ajouter(formulaire, "div", "nqb-actions");
	const repli = bouton(actions, "nqb-secondary", t("bugReport.openOnGithub"), () => { window.open(deps.fallbackUrl(), "_blank", "noopener"); });
	repli.hidden = true;
	const annuler = bouton(actions, "nqb-secondary", t("bugReport.cancel"), fermer);
	const envoyer = bouton(actions, "nqb-primary", t("bugReport.send"), () => { void soumettre(); });
	function majBoutons(): void {
		envoyer.disabled = !canSend(etat);
		annuler.disabled = etat.sending;
	}
	majBoutons();
	quoi.el.focus();

	/* ─── Sent ─── */
	const envoye = ajouter(racine, "div", "nqb-sent");
	envoye.hidden = true;

	async function soumettre(): Promise<void> {
		if (!canSend(etat)) return;
		etat.sending = true;
		erreurZone.hidden = true;
		envoyer.textContent = t("bugReport.sending");
		majBoutons();
		let code = "failed";
		try {
			const r = await api.envoyer(reportFromForm(etat));
			if (detruit) return;
			if (r.ok) { montrerEnvoye(r.url, r.number); return; }
			code = r.code;
		} catch {
			if (detruit) return;
		}
		etat.sending = false;
		envoyer.textContent = t("bugReport.retry");
		erreurZone.hidden = false;
		erreurZone.textContent = CODES_CONNUS.has(code) ? t(`bugReport.error.${code}` as TransKey) : t("bugReport.error.failed");
		// For disabled / upstream, GitHub itself is the way forward: that button leads.
		const prioritaire = CODES_REPLI.has(code);
		repli.hidden = false;
		repli.classList.toggle("nqb-primary", prioritaire);
		repli.classList.toggle("nqb-secondary", !prioritaire);
		envoyer.classList.toggle("nqb-primary", !prioritaire);
		envoyer.classList.toggle("nqb-secondary", prioritaire);
		majBoutons();
	}

	function montrerEnvoye(url: string, numero: number): void {
		formulaire.hidden = true;
		envoye.hidden = false;
		icone(ajouter(envoye, "div", "nqb-sent-mark"), "circle-check");
		ajouter(envoye, "div", "nqb-sent-title", t("bugReport.sentTitle"));
		ajouter(envoye, "p", "nqb-sent-body", t("bugReport.sentBody", { number: numero }));
		const ligne = ajouter(envoye, "div", "nqb-actions");
		bouton(ligne, "nqb-secondary", t("bugReport.viewIssue"), () => { window.open(url, "_blank", "noopener"); });
		bouton(ligne, "nqb-primary", t("bugReport.close"), fermer);
	}

	return () => {
		detruit = true;
		if (connexion) void api.github.annuler();
	};
}
