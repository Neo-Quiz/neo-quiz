import { currentLang, setLanguage, t } from "../../../src/i18n";
/* Les MÊMES icônes que l'application : ses glyphes de fenêtre et Lucide via
   `poserIcone`, pour que l'installeur ne dessine rien que l'app ne dessine. */
import { poserIcone } from "../src/host/ui";
import { poserGlyphe } from "../src/ui/glyphes-fenetre";
import type { PageLegale } from "./noyau";
import { formatOctets, formatPourcent, libellesProgression as libellesPartages, type LibellesProgression } from "./presentation";
import type {
	CodeErreurInstallateur,
	EtatInstallateur,
	InfosDisqueInstallateur,
	InfosInitialesInstallateur,
} from "./protocole";

/* La page PRÊTE reste celle déjà validée à l'écran. Les autres phases ont leur
   propre composition : on ne déplace donc aucun élément de l'étape 2 pour
   obtenir les étapes 1, 3, 4 et 5. */
let infos: InfosInitialesInstallateur | null = null;
let disque: InfosDisqueInstallateur | null = null;
let etat: EtatInstallateur = { phase: "pret" };
let chargement = true;
let echantillonTelechargement: { recus: number; instant: number } | null = null;
let debitTelechargement: number | null = null;
let confirmationAnnulation = false;
let annulationDemandee = false;
let affichage100Jusqua = 0;
let minuterieDemarrage: ReturnType<typeof setTimeout> | null = null;

function ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	classe?: string,
	texte?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (classe) element.className = classe;
	if (texte !== undefined) element.textContent = texte;
	parent.appendChild(element);
	return element;
}

function libelleErreur(code: CodeErreurInstallateur): string {
	switch (code) {
		case "release": return t("installer.error.release");
		case "network": return t("installer.error.network");
		case "elevation": return t("installer.error.elevation");
		case "integrity": return t("installer.error.integrity");
		case "installation": return t("installer.error.installation");
		case "launch": return t("installer.error.launch");
		default: return t("installer.error.generic");
	}
}

function phaseInstallationActive(): boolean {
	return etat.phase === "elevation" || etat.phase === "telechargement" ||
		etat.phase === "verification" || etat.phase === "installation";
}

function rendreBarreTitre(parent: HTMLElement): void {
	const barre = ajouter(parent, "div", "nqi-titlebar");
	const marque = ajouter(barre, "div", "nqi-titlebar-brand");
	const icone = ajouter(marque, "img", "nqi-titlebar-icon");
	icone.src = "./icon.png";
	icone.alt = t("installer.logoAlt");
	ajouter(marque, "span", "nqi-titlebar-text", t("installer.windowTitle"));

	const controles = ajouter(barre, "div", "nqi-window-controls");
	const reduire = ajouter(controles, "button", "nqi-window-button nqi-minimize");
	reduire.type = "button";
	reduire.title = t("installer.minimize");
	reduire.setAttribute("aria-label", t("installer.minimize"));
	reduire.addEventListener("click", () => window.neoInstaller.reduire());
	poserGlyphe(reduire, "minimize");

	const fermer = ajouter(controles, "button", "nqi-window-button nqi-close");
	fermer.type = "button";
	fermer.title = t("installer.close");
	fermer.setAttribute("aria-label", t("installer.close"));
	/* Une fois installé, l'app est déjà en train de démarrer : fermer à cet
	   instant créerait un faux bouton d'annulation alors qu'il n'y a plus rien
	   à annuler. La réduction reste disponible. */
	fermer.disabled = etat.phase === "demarrage";
	fermer.addEventListener("click", () => {
		if (phaseInstallationActive()) ouvrirConfirmationAnnulation();
		else window.neoInstaller.fermer();
	});
	poserGlyphe(fermer, "close");
}

/* Le décor est une IMAGE (`fond.png`, posée par le CSS de `.nqi-hero`), plus
   les anneaux dessinés en CSS : ils restent dans `style.css` pour comparaison,
   mais ne sont plus montés. */
function rendreHero(parent: HTMLElement): void {
	ajouter(parent, "section", "nqi-hero").setAttribute("aria-hidden", "true");
}

function rendreProgression(parent: HTMLElement, pourcent: number | null, classe = ""): void {
	const piste = ajouter(parent, "div", `nqi-progress${pourcent === null ? " is-indeterminate" : ""}${classe ? ` ${classe}` : ""}`);
	const barre = ajouter(piste, "div", "nqi-progress-bar");
	if (pourcent !== null) barre.style.width = `${Math.max(0, Math.min(100, pourcent))}%`;
}

function rendreBoutonInstallation(parent: HTMLElement): void {
	const bouton = ajouter(parent, "button", "nqi-primary");
	bouton.type = "button";
	/* Le bouclier annonce l'UAC : seulement quand le dossier l'exige. */
	if (infos?.elevationRequise) {
		const bouclier = ajouter(bouton, "img", "nqi-primary-shield");
		bouclier.src = "./uac-shield.png";
		bouclier.alt = "";
		bouclier.setAttribute("aria-hidden", "true");
	}
	ajouter(bouton, "span", undefined, t("installer.install"));
	bouton.addEventListener("click", lancerInstallation);
}

function rendreAction(parent: HTMLElement): void {
	if (etat.phase === "erreur") {
		/* Le refus UAC a son propre dialogue bloquant : afficher en plus le
		   bouton de nouvelle tentative derrière lui créerait deux actions
		   concurrentes pour le même état. */
		if (etat.code === "elevation") return;
		ajouter(parent, "p", "nqi-error", libelleErreur(etat.code));
		const bouton = ajouter(parent, "button", "nqi-primary", t("installer.retry"));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			if (infos) lancerInstallation();
			else void initialiser();
		});
		return;
	}
	if (!infos) return;
	if (etat.phase === "pret" || etat.phase === "annule") {
		rendreBoutonInstallation(parent);
		return;
	}
	if (etat.phase === "elevation") {
		ajouter(parent, "p", "nqi-status", t("installer.status.elevation"));
		rendreProgression(parent, null);
	}
}

/** Un vrai lien (focusable, curseur main) qui ouvre la page du site dans le
    navigateur par le principal ; `href="#"` garde la sémantique sans jamais
    naviguer dans la fenêtre. */
function lienLegal(parent: HTMLElement, page: PageLegale, texte: string): void {
	const lien = ajouter(parent, "a", "nqi-legal-link", texte);
	lien.href = "#";
	lien.addEventListener("click", evenement => {
		evenement.preventDefault();
		window.neoInstaller.ouvrirLien(page);
	});
}

function rendreLegal(parent: HTMLElement, classe = ""): void {
	const legal = ajouter(parent, "div", `nqi-legal${classe ? ` ${classe}` : ""}`);
	const ligne = ajouter(legal, "p", "nqi-legal-copy");
	ligne.appendChild(document.createTextNode(t("installer.legal.beforeTerms")));
	lienLegal(ligne, "terms", t("installer.legal.terms"));
	ligne.appendChild(document.createTextNode(t("installer.legal.between")));
	lienLegal(ligne, "privacy", t("installer.legal.privacy"));
	ligne.appendChild(document.createTextNode(t("installer.legal.afterPrivacy")));
	ligne.appendChild(document.createTextNode(t("installer.legal.components")));
}

function rendreCommentaires(parent: HTMLElement, classe = ""): void {
	const commentaires = ajouter(parent, "button", `nqi-feedback${classe ? ` ${classe}` : ""}`);
	commentaires.type = "button";
	const iconeCommentaires = ajouter(commentaires, "span", "nqi-feedback-icon");
	poserIcone(iconeCommentaires, "message-square-warning");
	ajouter(commentaires, "span", undefined, t("installer.feedback"));
	commentaires.addEventListener("click", () => window.neoInstaller.commentaires());
}

function rendreEmplacement(parent: HTMLElement): void {
	if (!infos) return;
	const emplacement = ajouter(parent, "section", "nqi-location");
	const entete = ajouter(emplacement, "div", "nqi-location-head");
	ajouter(entete, "div", "nqi-location-label", t("installer.location.label"));
	const detail = disque
		? t("installer.location.space", {
			available: formatOctets(disque.espaceDisponible),
			total: formatOctets(disque.espaceTotal),
			download: formatOctets(infos.tailleTelechargement),
		})
		: t("installer.location.spaceFallback", {
			available: formatOctets(infos.espaceDisponible),
			download: formatOctets(infos.tailleTelechargement),
		});
	ajouter(entete, "div", "nqi-location-space", detail);
	const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
	chemin.title = infos.dossier;
}

function rendreErreurElevation(parent: HTMLElement): void {
	if (etat.phase !== "erreur" || etat.code !== "elevation") return;
	const voile = ajouter(parent, "div", "nqi-elevation-overlay");
	const dialogue = ajouter(voile, "section", "nqi-elevation-dialog");
	dialogue.setAttribute("role", "alertdialog");
	dialogue.setAttribute("aria-modal", "true");
	const titre = ajouter(dialogue, "h2", "nqi-elevation-title", t("installer.elevationDialog.title"));
	titre.id = "nqi-elevation-title";
	dialogue.setAttribute("aria-labelledby", titre.id);
	const message = ajouter(dialogue, "p", "nqi-elevation-copy", t("installer.elevationDialog.body"));
	message.id = "nqi-elevation-copy";
	dialogue.setAttribute("aria-describedby", message.id);
	const annuler = ajouter(dialogue, "button", "nqi-elevation-cancel", t("installer.cancel"));
	annuler.type = "button";
	annuler.autofocus = true;
	annuler.addEventListener("click", () => window.neoInstaller.fermer());
}

/** L'installation existe déjà : le bootstrapper ne sert qu'à la PREMIÈRE
    installation (voir `installationPresente` dans `main.ts`). Plutôt que de
    laisser NSIS échouer après l'UAC et 113 Mo téléchargés, on le dit tout de
    suite, et on propose la seule action utile : ouvrir l'application, d'où les
    mises à jour arrivent. */
function rendreDejaInstalle(parent: HTMLElement): void {
	if (!infos) return;
	const panneau = ajouter(parent, "section", "nqi-panel");
	ajouter(panneau, "h1", "nqi-title", t("installer.alreadyInstalled.title"));
	ajouter(panneau, "p", "nqi-already-copy", t("installer.alreadyInstalled.body"));
	const emplacement = ajouter(panneau, "section", "nqi-location");
	ajouter(emplacement, "div", "nqi-location-label", t("installer.location.label"));
	const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
	chemin.title = infos.dossier;
	rendreCommentaires(panneau);
	/* UN SEUL bouton : il n'y a qu'une action utile ici. « Fermer » ferait
	   doublon avec la croix de la barre de titre, et mettrait à égalité un
	   geste utile et un geste vide. */
	const actions = ajouter(panneau, "div", "nqi-actions");
	const ouvrir = ajouter(actions, "button", "nqi-primary", t("installer.alreadyInstalled.open"));
	ouvrir.type = "button";
	ouvrir.autofocus = true;
	ouvrir.addEventListener("click", () => window.neoInstaller.ouvrirApplication());
}

function rendreChargement(parent: HTMLElement): void {
	const etape = ajouter(parent, "section", "nqi-loading-stage");
	etape.setAttribute("role", "status");
	etape.setAttribute("aria-label", t("installer.preparing"));
	const anneau = ajouter(etape, "div", "nqi-loading-spinner");
	anneau.setAttribute("aria-hidden", "true");
}

function ouvrirConfirmationAnnulation(): void {
	if (!phaseInstallationActive() || annulationDemandee) return;
	confirmationAnnulation = true;
	rendre();
}

function confirmerAnnulation(): void {
	if (!phaseInstallationActive() || annulationDemandee) return;
	confirmationAnnulation = false;
	annulationDemandee = true;
	rendre();
	void window.neoInstaller.annuler().catch(() => {
		annulationDemandee = false;
		etat = { phase: "erreur", code: "generic" };
		rendre();
	});
}

function rendreConfirmationAnnulation(parent: HTMLElement): void {
	const voile = ajouter(parent, "div", "nqi-cancel-overlay");
	const dialogue = ajouter(voile, "section", "nqi-cancel-dialog");
	dialogue.setAttribute("role", "alertdialog");
	dialogue.setAttribute("aria-modal", "true");
	const titre = ajouter(dialogue, "h2", "nqi-cancel-title", t("installer.cancelDialog.title"));
	titre.id = "nqi-cancel-title";
	dialogue.setAttribute("aria-labelledby", titre.id);
	const message = ajouter(dialogue, "p", "nqi-cancel-copy", t("installer.cancelDialog.body"));
	message.id = "nqi-cancel-copy";
	dialogue.setAttribute("aria-describedby", message.id);
	const actions = ajouter(dialogue, "div", "nqi-cancel-actions");
	const non = ajouter(actions, "button", "nqi-cancel-no", t("installer.cancelDialog.no"));
	non.type = "button";
	non.autofocus = true;
	non.addEventListener("click", () => {
		confirmationAnnulation = false;
		rendre();
	});
	const oui = ajouter(actions, "button", "nqi-cancel-yes", t("installer.cancelDialog.yes"));
	oui.type = "button";
	oui.addEventListener("click", confirmerAnnulation);
}

/** Ce que l'étape de progression AFFICHE, séparé de la façon dont elle le
    construit : le premier rendu bâtit le DOM avec, les messages suivants ne
    font que remplacer ces trois valeurs. */
function libellesProgression(): LibellesProgression {
	if (annulationDemandee) {
		return { pourcent: null, statut: t("installer.status.cancelling"), detail: null };
	}
	return libellesPartages(etat, debitTelechargement);
}

/** LES SEULS NŒUDS QUI CHANGENT d'un message du travailleur au suivant.

    Sans eux, chaque message — toutes les 100 ms au téléchargement, 150 ms à
    l'installation — passait par `rendre()`, donc par `root.replaceChildren()` :
    la page ENTIÈRE était détruite et rebâtie dix fois par seconde. Trois
    conséquences, dont deux visibles et une grave :
    - la modale de confirmation était recréée à chaque fois, donc son animation
      d'entrée rejouait sans fin — le clignotement vu à l'écran le 2026-09-16 ;
    - le bouton Annuler était recréé sous le curseur, donc son `:hover` et sa
      transition repartaient de zéro, d'où un survol qui clignote ;
    - le FOCUS clavier était détruit dix fois par seconde : la modale était
      inatteignable au clavier, et personne ne l'avait remarqué.
    Une barre qui avance ne justifie pas de rebâtir une page. */
let progressionVive: {
	piste: HTMLElement;
	barre: HTMLElement;
	statut: HTMLElement;
	detail: HTMLElement;
} | null = null;

/** L'étape affichée au dernier rendu, pour n'animer que les VRAIS changements
    d'étape — voir `rendre()`. */
let derniereEtapeRendue = "";

/** Remplace les trois valeurs sans toucher au reste du DOM. Rend `false` quand
    l'étape affichée n'est pas celle-là — l'appelant fait alors un vrai rendu. */
function rafraichirProgression(): boolean {
	if (!progressionVive || chargement || !phaseInstallationActive()) return false;
	const { pourcent, statut, detail } = libellesProgression();
	progressionVive.piste.classList.toggle("is-indeterminate", pourcent === null);
	progressionVive.barre.style.width = pourcent === null
		? ""
		: `${Math.max(0, Math.min(100, pourcent))}%`;
	progressionVive.statut.textContent = statut;
	const texteDetail = detail && !annulationDemandee ? detail : "";
	progressionVive.detail.textContent = texteDetail;
	progressionVive.detail.hidden = texteDetail === "";
	return true;
}

function rendreEtapeProgression(parent: HTMLElement): void {
	const etape = ajouter(parent, "section", "nqi-progress-stage");
	ajouter(etape, "h1", "nqi-progress-title", t("installer.title"));
	const { pourcent, statut, detail } = libellesProgression();

	const bloc = ajouter(etape, "div", "nqi-progress-block");
	rendreProgression(bloc, pourcent, "nqi-progress-wide");
	const statutEl = ajouter(bloc, "p", "nqi-progress-status", statut);
	/* Le détail existe TOUJOURS, masqué quand il est vide : le rafraîchissement
	   n'a ainsi aucun nœud à créer ni à retirer, et la hauteur du bloc ne saute
	   pas d'un message à l'autre. */
	const detailEl = ajouter(bloc, "p", "nqi-progress-detail", detail && !annulationDemandee ? detail : "");
	detailEl.hidden = !(detail && !annulationDemandee);
	const piste = bloc.querySelector<HTMLElement>(".nqi-progress");
	const barre = bloc.querySelector<HTMLElement>(".nqi-progress-bar");
	progressionVive = piste && barre ? { piste, barre, statut: statutEl, detail: detailEl } : null;

	rendreCommentaires(etape, "nqi-progress-feedback");
	/* Les mentions légales sont acceptées avant le clic sur Installer (étape 2).
	   Comme Google Play Games, elles ne sont plus répétées pendant le
	   téléchargement et l’installation : la progression reste visuellement nette. */

	rendreActionsProgression(etape, true);
}

/** La rangée d'actions des étapes de progression, rendue aussi pendant
    « démarrage » — avec Annuler GRISÉ plutôt qu'absent.

    Un bouton qui disparaît laisse croire qu'on a perdu le contrôle ; un bouton
    grisé dit qu'il n'y a plus rien à annuler, et son infobulle dit pourquoi.
    C'est le seul moment où l'annulation ne peut rien faire : Neo Quiz est
    installé et s'ouvre déjà. Partout ailleurs elle marche — immédiatement
    pendant le téléchargement et l'élévation, et de façon DIFFÉRÉE pendant
    l'installation, où NSIS termine sa transaction avant qu'une installation
    fraîche soit désinstallée proprement (le tuer en pleine écriture laisserait
    registre et raccourcis incohérents). */
function rendreActionsProgression(parent: HTMLElement, annulable: boolean): void {
	const actions = ajouter(parent, "div", "nqi-progress-actions");
	const annuler = ajouter(actions, "button", "nqi-progress-cancel", t("installer.cancel"));
	annuler.type = "button";
	annuler.disabled = !annulable || annulationDemandee;
	if (annuler.disabled) {
		annuler.title = annulationDemandee
			? t("installer.status.cancelling")
			: t("installer.cancelUnavailable");
	} else {
		annuler.addEventListener("click", ouvrirConfirmationAnnulation);
	}
	const installer = ajouter(actions, "button", "nqi-progress-install", t("installer.install"));
	installer.type = "button";
	installer.disabled = true;
}

function rendreDemarrage(parent: HTMLElement): void {
	const etape = ajouter(parent, "section", "nqi-launching-stage");
	etape.setAttribute("role", "status");
	etape.setAttribute("aria-live", "polite");
	etape.setAttribute("aria-label", t("installer.status.launching"));
	const anneau = ajouter(etape, "div", "nqi-loading-spinner");
	anneau.setAttribute("aria-hidden", "true");
	ajouter(etape, "p", "nqi-launching-status", t("installer.status.launching"));
	/* La rangée reste, Annuler grisé : voir la note de `rendreActionsProgression`. */
	rendreActionsProgression(etape, false);
}

function rendre(): void {
	document.documentElement.lang = currentLang();
	document.title = t("installer.windowTitle");
	const root = document.getElementById("app");
	if (!root) return;
	/* Le DOM part : les nœuds retenus pour le rafraîchissement ne valent plus
	   rien, et les garder ferait écrire dans des éléments détachés. */
	progressionVive = null;
	root.replaceChildren();

	rendreBarreTitre(root);
	const contenu = ajouter(root, "main", "nqi-shell");
	rendreHero(contenu);

	/* AUCUNE ÉTAPE NE REMPLACE L'AUTRE D'UN COUP. `replaceChildren()` fait
	   sauter l'écran, et le saut le plus dur à regarder est le dernier : la
	   barre à 100 % remplacée sans transition par « Ouverture de Neo Quiz… ».
	   La classe d'entrée n'est posée QUE lorsque l'étape change ; un rendu
	   déclenché par autre chose — la modale de confirmation qui s'ouvre, une
	   erreur d'élévation — ne rejoue rien derrière elle. */
	const etape = chargement ? "chargement"
		: etat.phase === "demarrage" ? "demarrage"
		: phaseInstallationActive() ? "progression"
		: infos?.dejaInstalle ? "dejaInstalle"
		: "panneau";
	const changeEtape = etape !== derniereEtapeRendue;
	derniereEtapeRendue = etape;
	const marquerEntree = (): void => {
		if (changeEtape) contenu.lastElementChild?.classList.add("nqi-entre");
	};

	if (chargement) {
		rendreChargement(contenu);
		marquerEntree();
		return;
	}

	if (etat.phase === "demarrage") {
		rendreDemarrage(contenu);
		marquerEntree();
		return;
	}

	if (etat.phase === "elevation" || etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {
		rendreEtapeProgression(contenu);
		marquerEntree();
		if (confirmationAnnulation) rendreConfirmationAnnulation(root);
		return;
	}

	if (infos?.dejaInstalle) {
		rendreDejaInstalle(contenu);
		marquerEntree();
		return;
	}

	/* Étape 2 : DOM volontairement inchangé par rapport à la version validée. */
	const panneau = ajouter(contenu, "section", "nqi-panel");
	ajouter(panneau, "h1", "nqi-title", t("installer.title"));
	rendreEmplacement(panneau);
	rendreLegal(panneau);
	rendreCommentaires(panneau);
	const actions = ajouter(panneau, "div", "nqi-actions");
	rendreAction(actions);
	marquerEntree();
	rendreErreurElevation(root);
}

function lancerInstallation(): void {
	if (!infos) return;
	confirmationAnnulation = false;
	annulationDemandee = false;
	affichage100Jusqua = 0;
	if (minuterieDemarrage !== null) {
		clearTimeout(minuterieDemarrage);
		minuterieDemarrage = null;
	}
	etat = infos.elevationRequise
		? { phase: "elevation" }
		: { phase: "telechargement", recus: 0, total: infos.tailleTelechargement };
	rendre();
	void window.neoInstaller.installer(infos.dossier).catch(() => {
		etat = { phase: "erreur", code: "generic" };
		rendre();
	});
}

async function initialiser(): Promise<void> {
	chargement = true;
	etat = { phase: "pret" };
	infos = null;
	disque = null;
	echantillonTelechargement = null;
	debitTelechargement = null;
	confirmationAnnulation = false;
	annulationDemandee = false;
	affichage100Jusqua = 0;
	if (minuterieDemarrage !== null) {
		clearTimeout(minuterieDemarrage);
		minuterieDemarrage = null;
	}
	rendre();
	try {
		infos = await window.neoInstaller.initialiser();
		try {
			disque = await window.neoInstaller.espaceDisque(infos.dossier);
		} catch {
			disque = null;
		}
		etat = { phase: "pret" };
	} catch {
		infos = null;
		disque = null;
		etat = { phase: "erreur", code: "release" };
	} finally {
		chargement = false;
		rendre();
	}
}

function mesurerDebit(nouvelEtat: EtatInstallateur): void {
	if (nouvelEtat.phase !== "telechargement") {
		echantillonTelechargement = null;
		debitTelechargement = null;
		return;
	}
	const maintenant = performance.now();
	const precedent = echantillonTelechargement;
	if (precedent && nouvelEtat.recus >= precedent.recus) {
		const duree = maintenant - precedent.instant;
		const octets = nouvelEtat.recus - precedent.recus;
		if (duree > 0 && octets > 0) {
			const instantane = (octets * 1000) / duree;
			debitTelechargement = debitTelechargement === null
				? instantane
				: debitTelechargement * 0.72 + instantane * 0.28;
		}
	}
	echantillonTelechargement = { recus: nouvelEtat.recus, instant: maintenant };
}

/* La langue vient du PRINCIPAL par l'URL (`main.ts`, `loadFile` avec
   `query.lang`) : nom du fichier téléchargé, référent du navigateur, ou
   locale système — jamais `navigator.language` seul, qui ignorerait la page
   du site d'où l'exe vient. « auto » seulement si l'URL n'en dit rien. */
const langueUrl = new URLSearchParams(window.location.search).get("lang");
setLanguage(langueUrl === "fr" || langueUrl === "en" ? langueUrl : "auto");
window.neoInstaller.surEtat(nouvelEtat => {
	mesurerDebit(nouvelEtat);
	if (nouvelEtat.phase === "installation" && nouvelEtat.pourcent !== null && nouvelEtat.pourcent >= 100) {
		/* Le worker n'envoie 100 qu'après un vrai code de sortie 0. Le garder
		   visible quelques centaines de millisecondes évite que « demarrage »
		   remplace le DOM avant même que Chromium ait peint la frame à 100 %. */
		affichage100Jusqua = performance.now() + 450;
	}
	if (nouvelEtat.phase === "demarrage" && affichage100Jusqua > performance.now()) {
		const attente = Math.max(0, affichage100Jusqua - performance.now());
		if (minuterieDemarrage !== null) clearTimeout(minuterieDemarrage);
		minuterieDemarrage = setTimeout(() => {
			minuterieDemarrage = null;
			etat = nouvelEtat;
			rendre();
		}, attente);
		return;
	}
	if (nouvelEtat.phase !== "demarrage" && minuterieDemarrage !== null) {
		clearTimeout(minuterieDemarrage);
		minuterieDemarrage = null;
	}
	if (nouvelEtat.phase === "annule") {
		confirmationAnnulation = false;
		annulationDemandee = false;
		etat = { phase: "pret" };
		rendre();
		window.neoInstaller.fermer();
		return;
	}
	if (nouvelEtat.phase === "erreur") {
		confirmationAnnulation = false;
		annulationDemandee = false;
	}
	const phasePrecedente = etat.phase;
	etat = nouvelEtat;
	/* Un message qui ne fait qu'avancer la barre se contente des trois nœuds
	   vivants ; la page n'est rebâtie que lorsqu'on CHANGE d'étape. C'est ce
	   qui empêche la modale de confirmation, le survol du bouton et le focus
	   clavier d'être détruits dix fois par seconde. */
	if (phasePrecedente === nouvelEtat.phase && rafraichirProgression()) return;
	rendre();
});
void initialiser();
