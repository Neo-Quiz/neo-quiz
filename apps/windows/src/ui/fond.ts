/* ══════════════════════════════════════════════════════════
   LE FOND D'ÉCRAN — VU DU RENDU

   Le réglage `{ dossier: string; image: string }` (`CLE_REGLAGES_FOND`,
   `electron/pont.ts`) est écrit par CE module côté rendu, mais GARDÉ côté
   principal (`canaux.ts`, `verifierDossierFond`) : `perimetreInitial`
   (`electron/perimetre.ts`) admet `dossier` au périmètre au démarrage
   suivant, exactement comme les dossiers de quiz — un chemin qui n'a jamais
   transité par le sélecteur natif obtiendrait donc tout un dossier au
   périmètre à la session suivante s'il n'était pas gardé à l'écriture. En
   session courante, `choisirDossierFond` a déjà fait autoriser le dossier
   par le sélecteur natif : un choix légitime passe toujours la garde.

   Le voile sombre de `shell.css` ne bouge jamais : ce module ne pose QUE
   l'image, dans la variable `--nq-fond-image`, que la règle `body` compose
   avec le dégradé. `pont()` est lu À L'APPEL, jamais capturé au chargement
   du module — même règle que `reprise.ts` et `mise-a-jour.ts`.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { CLE_REGLAGES_FOND, CLE_REGLAGES_FOND_EFFETS } from "../../electron/pont";
import { urlDeRessource } from "../../electron/ressources";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { BORNES_EFFETS_FOND, estImageDeFond, normaliserEffetsFond, suivante } from "./fond-pur";
import type { EffetsFond } from "./fond-pur";
import { FONDS_EMBARQUES, fondEmbarque, fondsParCategorie, urlFondEmbarque, urlVignetteEmbarquee } from "./fonds-catalogue";

/**
 * LE RÉGLAGE A DEUX FORMES, et elles ne se confondent pas :
 * — `{ embarque }` : l'une des vingt photos livrées avec l'application
 *   (`fonds-catalogue.ts`). Aucun chemin, donc rien à admettre au périmètre ;
 * — `{ dossier, image }` : un dossier d'images de l'utilisateur, choisi par le
 *   sélecteur natif. C'est la forme historique, et la seule que la garde du
 *   principal (`verifierDossierFond`) juge contre le périmètre.
 */
type ReglageFond =
	| { embarque: string; dossier?: undefined; image?: undefined }
	| { embarque?: undefined; dossier: string; image: string };

/** Relit le réglage BRUT (JSON de `neo.reglages`) sans jamais lui faire
    confiance : deux chaînes non vides, sinon `null` — même garde que
    `reprise.ts` sur une valeur qui peut avoir été écrite par une version
    antérieure ou trafiquée à la main. */
function validerReglage(brut: unknown): ReglageFond | null {
	if (!brut || typeof brut !== "object") return null;
	/* Un fond embarqué INCONNU (catalogue changé entre deux versions) vaut
	   `null`, pas une erreur : l'application repart sur son fond par défaut. */
	const embarque = (brut as { embarque?: unknown }).embarque;
	if (typeof embarque === "string" && embarque.trim() !== "") {
		return fondEmbarque(embarque) ? { embarque } : null;
	}
	const dossier = (brut as { dossier?: unknown }).dossier;
	const image = (brut as { image?: unknown }).image;
	if (typeof dossier !== "string" || dossier.trim() === "") return null;
	if (typeof image !== "string" || image.trim() === "") return null;
	return { dossier, image };
}

/** Les images de fond du dossier, triées par nom — la même liste que
    `suivante` attend. Un dossier disparu (clé USB retirée) rend `[]` : le
    pont rejette pour un dossier hors périmètre, jamais une exception qui
    remonterait jusqu'à l'appelant. */
async function listerImages(dossier: string): Promise<string[]> {
	let entrees: Array<{ name: string; isFolder: boolean }>;
	try {
		entrees = await pont().fichiers.listerDossier(dossier);
	} catch {
		return [];
	}
	return entrees.filter(e => !e.isFolder && estImageDeFond(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b));
}

/** Pose l'image dans la variable CSS, ou l'efface (le CSS reprend alors
    `fonds/island-sunset.jpg`, son repli). */
function poserVariable(reglage: ReglageFond | null): void {
	if (reglage) {
		document.documentElement.style.setProperty("--nq-fond-image", `url("${urlDuFond(reglage)}")`);
	} else {
		document.documentElement.style.removeProperty("--nq-fond-image");
	}
}

/** L'URL d'affichage d'un réglage, quelle que soit sa forme : une image du
    disque passe par le protocole du pont, une photo embarquée est servie par
    l'application elle-même. */
function urlDuFond(reglage: ReglageFond): string {
	return reglage.embarque !== undefined
		? urlFondEmbarque(reglage.embarque)
		: urlDeRessource(`${reglage.dossier}/${reglage.image}`);
}

/**
 * Lit le réglage, pose l'image — appelée au démarrage et après chaque
 * changement. Sans réglage : le CSS reprend son défaut. Avec : la liste du
 * dossier fait AUTORITÉ sur l'image écrite, jamais l'inverse — une image
 * disparue du disque entre deux lancements ne doit pas faire échouer le
 * démarrage, elle retombe sur la première image du dossier (`suivante`,
 * courante absente).
 */
export async function appliquerFond(): Promise<void> {
	const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
	if (!reglage) {
		poserVariable(null);
		return;
	}
	/* Un fond EMBARQUÉ n'a rien à vérifier : il est livré avec l'application,
	   il ne peut pas avoir disparu d'un disque qu'il n'occupe pas. Tout ce qui
	   suit ne concerne que le dossier de l'utilisateur. */
	if (reglage.embarque !== undefined) {
		poserVariable(reglage);
		return;
	}
	const noms = await listerImages(reglage.dossier);
	if (!noms.length) {
		await pont().reglages.supprimer(CLE_REGLAGES_FOND);
		poserVariable(null);
		currentHost().ui.notice(t("app.fond.dossierVide"));
		return;
	}
	if (!noms.includes(reglage.image)) {
		const image = suivante(noms, undefined) as string; // `noms` n'est pas vide ici.
		await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier: reglage.dossier, image });
		poserVariable({ dossier: reglage.dossier, image });
		currentHost().ui.notice(t("app.fond.disparue"));
		return;
	}
	poserVariable(reglage);
}

/** Pose la luminosité et le flou dans les variables que `shell.css` applique
    à la couche de l'IMAGE (`body::before`) — jamais à la lueur ni au
    panneau. Sur la racine, comme `--nq-fond-image`. */
function poserEffets(effets: EffetsFond): void {
	const racine = document.documentElement.style;
	racine.setProperty("--nq-fond-luminosite", String(effets.luminosite));
	racine.setProperty("--nq-fond-flou", `${effets.flou}px`);
}

/** Lit le réglage (absent ou trafiqué : les défauts) et le pose — au
    démarrage, avant le premier rendu. */
export async function appliquerEffetsFond(): Promise<void> {
	let brut: unknown;
	// Une lecture qui échoue ne doit pas bloquer le démarrage : les défauts.
	try { brut = await pont().reglages.lire(CLE_REGLAGES_FOND_EFFETS); } catch { brut = undefined; }
	poserEffets(normaliserEffetsFond(brut));
}

/** Passe à l'image suivante du dossier courant — barre, menu, `Ctrl+Shift+B`.
    Sans dossier choisi, ne fait rien : il n'y a rien à faire tourner. */
export async function fondSuivant(): Promise<void> {
	const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
	/* SANS RÉGLAGE, on tourne dans les photos EMBARQUÉES : elles sont là dès la
	   première ouverture, et « Fond suivant » qui ne ferait rien passerait pour
	   une commande cassée. */
	if (!reglage || reglage.embarque !== undefined) {
		const embarque = suivante(FONDS_EMBARQUES.map(f => f.id), reglage?.embarque);
		if (embarque === undefined) return;
		await pont().reglages.ecrire(CLE_REGLAGES_FOND, { embarque });
		await appliquerFond();
		return;
	}
	const noms = await listerImages(reglage.dossier);
	const image = suivante(noms, reglage.image);
	if (image === undefined) return; // le dossier s'est vidé entre-temps.
	await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier: reglage.dossier, image });
	await appliquerFond();
}

/** Choisit un nouveau dossier par le sélecteur natif — déjà admis au
    périmètre pour la session (`canaux.ts`). Un dossier sans aucune image
    n'écrit rien : le réglage précédent (s'il y en avait un) reste actif. */
export async function choisirDossierFond(): Promise<void> {
	const dossier = await pont().dialogue.choisirDossier();
	if (dossier === null) return;
	const noms = await listerImages(dossier);
	const image = suivante(noms, undefined);
	if (image === undefined) {
		currentHost().ui.notice(t("app.fond.dossierVide"));
		return;
	}
	await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier, image });
	await appliquerFond();
}

/** Efface le réglage : retour au fond par défaut de l'application. */
export async function retirerFond(): Promise<void> {
	await pont().reglages.supprimer(CLE_REGLAGES_FOND);
	poserVariable(null);
}

/** Choisit l'une des photos livrées avec l'application. */
export async function choisirFondEmbarque(id: string): Promise<void> {
	await pont().reglages.ecrire(CLE_REGLAGES_FOND, { embarque: id });
	await appliquerFond();
}

/**
 * LE CHOIX D'UN FOND — une modale centrée.
 *
 * Même forme que la boîte de choix de Neo Calendar : une LISTE verticale, une
 * ligne par fond, vignette à gauche et nom à droite. La grille de vignettes
 * nues qu'affichait la page des Réglages disait moins — ni le nom, ni l'auteur,
 * et vingt cases de 96 pixels poussaient tout le reste des réglages hors de
 * l'écran.
 *
 * ELLE S'OUVRE PAR-DESSUS la modale des Réglages, et c'est prévu : `modal.ts`
 * empile (« deux modales peuvent être ouvertes en même temps »), Échap ferme
 * celle du dessus. `onFini` laisse l'appelant redessiner sa rangée.
 */
function ouvrirChoixFond(reglage: ReglageFond | null, onFini: () => void): void {
	requireHost("modals").open({
		className: "nq-fond-modal",
		title: t("app.settings.wallpaper"),
		onOpen: poignee => {
			const corps = poignee.contentEl;

			/** Une ligne de la liste : vignette, libellé, crédit, coche. */
			const poserOption = (
				url: string, libelle: string, credit: string, actif: boolean,
				choisirCelle: () => Promise<void>,
			): void => {
				const option = ajouter(corps, "button", "nq-fond-option");
				option.type = "button";
				// Une liste de choix : l'état se dit, il ne se devine pas à un cadre.
				option.setAttribute("role", "option");
				option.setAttribute("aria-selected", actif ? "true" : "false");
				const vignette = ajouter(option, "span", "nq-fond-option-image");
				vignette.style.backgroundImage = `url("${url}")`;
				const texte = ajouter(option, "span", "nq-fond-option-texte");
				ajouter(texte, "span", "nq-fond-option-nom", libelle);
				if (credit) ajouter(texte, "span", "nq-fond-option-credit", credit);
				const coche = ajouter(option, "span", "nq-fond-option-coche");
				if (actif) currentHost().ui.setIcon(coche, "check");
				option.addEventListener("click", () => {
					void choisirCelle().then(() => { poignee.close(); onFini(); });
				});
			};

			/* LE DOSSIER PERSONNEL EN TÊTE : c'est une ACTION, pas un fond —
			   elle ouvre le sélecteur natif. Un filet la sépare de ce qui se
			   choisit en dessous, comme la ligne « Tout télécharger » de Neo
			   Calendar. */
			const ouvrirDossier = ajouter(corps, "button", "nq-fond-option nq-fond-option--action");
			ouvrirDossier.type = "button";
			currentHost().ui.setIcon(ajouter(ouvrirDossier, "span", "nq-fond-option-icone"), "folder-plus");
			ajouter(ouvrirDossier, "span", "nq-fond-option-nom", t("app.fond.choose"));
			ouvrirDossier.addEventListener("click", () => {
				void choisirDossierFond().then(() => { poignee.close(); onFini(); });
			});

			for (const groupe of fondsParCategorie()) {
				ajouter(corps, "p", "nq-fond-separateur", t(`app.fond.cat.${groupe.categorie}`));
				for (const fond of groupe.fonds) {
					poserOption(
						urlVignetteEmbarquee(fond.id),
						fond.libelle,
						t("app.fond.credit", { auteur: fond.auteur }),
						reglage?.embarque === fond.id,
						() => choisirFondEmbarque(fond.id),
					);
				}
			}

			/* Les images du dossier de l'utilisateur, s'il en a ouvert un. La
			   liste est lue APRÈS le premier rendu : un dossier réseau lent ne
			   doit pas retarder l'ouverture de la modale. */
			const dossier = reglage?.dossier;
			if (!dossier) return;
			void listerImages(dossier).then(noms => {
				if (!noms.length) return;
				ajouter(corps, "p", "nq-fond-separateur", t("app.fond.yours"));
				for (const nom of noms) {
					poserOption(
						urlDeRessource(`${dossier}/${nom}`),
						nom,
						"",
						reglage?.image === nom,
						async () => {
							await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier, image: nom });
							await appliquerFond();
						},
					);
				}
			});
		},
	});
}

/**
 * La section « Fond d'écran » des Réglages : UNE RANGÉE, et rien d'autre.
 *
 * À gauche l'aperçu du fond courant, au milieu son nom et son auteur (ou le
 * dossier d'où il vient), à droite la croix qui revient au fond par défaut.
 * LA RANGÉE ELLE-MÊME ouvre la boîte de choix, où qu'on clique dedans.
 * La page montrait jusqu'ici la grille entière des vingt photos, qui
 * poussait les sections suivantes hors de l'écran ; le choix vit désormais
 * dans sa propre boîte (`ouvrirChoixFond`).
 *
 * Aucun abonnement au pont (contrairement à `mise-a-jour.ts`) : rien ne pousse
 * de changement depuis le principal, chaque action redessine elle-même après
 * avoir écrit. Le démontage n'a donc qu'à empêcher un `redessiner()` en vol
 * d'écrire dans une section retirée du DOM.
 */
export function monterReglagesFond(section: HTMLElement): () => void {
	let detruit = false;

	/* LA RANGÉE EST LA COMMANDE (Ahmed, 2026-09-17) : un clic n'importe où
	   ouvre la boîte de choix, et le bouton « Changer » a disparu avec — il
	   redisait dans 60 px ce que la rangée entière fait désormais.
	   `role` et `tabindex` parce qu'un `<div>` cliquable n'est ni annoncé ni
	   atteignable au clavier ; en faire un vrai `<button>` était exclu, il
	   contient la croix et un bouton ne s'imbrique pas dans un bouton.
	   `aria-label` porte l'ACTION : sans lui, le nom accessible serait le nom
	   de la photo, qui dit ce qu'on voit et non ce que le clic fait. */
	const rangee = ajouter(section, "div", "nq-reglages-dossier nq-fond-rangee");
	rangee.setAttribute("role", "button");
	rangee.tabIndex = 0;
	rangee.setAttribute("aria-label", t("app.fond.change"));
	const apercu = ajouter(rangee, "span", "nq-fond-apercu");
	const texte = ajouter(rangee, "div", "nq-reglages-texte");
	const nomImage = ajouter(texte, "span", "nq-reglages-nom");
	const detail = ajouter(texte, "span", "nq-reglages-chemin");
	const retirer = ajouter(rangee, "button", "nq-reglages-retirer");
	retirer.type = "button";
	retirer.title = t("app.fond.remove");
	retirer.setAttribute("aria-label", t("app.fond.remove"));
	currentHost().ui.setIcon(retirer, "x");

	/** Le réglage tel que la rangée l'affiche — relu à chaque redessin, et
	    gardé pour que la modale sache ce qui est coché sans relire le disque. */
	let courant: ReglageFond | null = null;

	async function redessiner(): Promise<void> {
		const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
		if (detruit) return;
		courant = reglage;
		retirer.hidden = !reglage;

		if (!reglage) {
			apercu.style.removeProperty("background-image");
			apercu.hidden = true;
			nomImage.textContent = t("app.fond.none");
			detail.textContent = "";
			return;
		}
		apercu.hidden = false;
		apercu.style.backgroundImage = `url("${urlDuFond(reglage)}")`;
		if (reglage.embarque !== undefined) {
			const fond = fondEmbarque(reglage.embarque);
			// Le nom de la photo est traduit une fois pour toutes dans le
			// catalogue ; son AUTEUR ne l'est jamais.
			nomImage.textContent = fond ? fond.libelle : reglage.embarque;
			detail.textContent = fond ? t("app.fond.credit", { auteur: fond.auteur }) : "";
		} else {
			// Nom de fichier et chemin viennent du DISQUE : jamais traduits.
			nomImage.textContent = reglage.image;
			detail.textContent = reglage.dossier;
		}
	}

	function ouvrir(): void {
		ouvrirChoixFond(courant, () => { void redessiner(); });
	}
	rangee.addEventListener("click", ouvrir);
	/* Entrée et Espace : ce qu'un `<button>` faisait gratuitement et qu'un
	   `role="button"` ne fait pas. Espace se prévient AUSSI, sinon la page
	   défile derrière la boîte qui s'ouvre. */
	rangee.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		ouvrir();
	});
	/* La croix est DANS la rangée : sans cet arrêt, retirer le fond
	   rouvrirait aussitôt la boîte de choix par-dessus. */
	retirer.addEventListener("click", (e) => {
		e.stopPropagation();
		void retirerFond().then(redessiner);
	});

	void redessiner();

	/* ── LUMINOSITÉ ET FLOU (2026-09-26) ──
	   Deux curseurs sous la rangée, comme dans Neo Calendar. `input` applique
	   EN DIRECT pendant qu'on glisse (variables CSS seulement, rien d'écrit) ;
	   `change`, au lâcher, écrit le réglage une fois. Un `<input type=range>`
	   natif : l'application n'a pas de composant curseur réutilisable (celui
	   de l'effort est un canevas propre au menu des modèles). */
	let effets: EffetsFond = normaliserEffetsFond(undefined);
	const ecrireEffets = (): void => {
		void pont().reglages.ecrire(CLE_REGLAGES_FOND_EFFETS, effets).catch(() => {
			currentHost().ui.notice(t("app.fond.effetsNonEcrits"));
		});
	};
	const curseur = (
		cle: keyof EffetsFond, libelle: string, pas: number, afficher: (v: number) => string,
	): (v: number) => void => {
		const ligne = ajouter(section, "label", "nq-fond-curseur");
		ajouter(ligne, "span", "nq-fond-curseur-libelle", libelle);
		const entree = ajouter(ligne, "input", "nq-fond-curseur-entree");
		entree.type = "range";
		entree.min = String(BORNES_EFFETS_FOND[cle].min);
		entree.max = String(BORNES_EFFETS_FOND[cle].max);
		entree.step = String(pas);
		const valeur = ajouter(ligne, "span", "nq-fond-curseur-valeur");
		const montrer = (v: number): void => {
			entree.value = String(v);
			valeur.textContent = afficher(v);
		};
		entree.addEventListener("input", () => {
			effets = normaliserEffetsFond({ ...effets, [cle]: Number(entree.value) });
			montrer(effets[cle]);
			poserEffets(effets);
		});
		entree.addEventListener("change", ecrireEffets);
		return montrer;
	};
	const montrerLuminosite = curseur("luminosite", t("app.fond.luminosite"), 0.01, v => t("app.fond.pourcent", { n: String(Math.round(v * 100)) }));
	const montrerFlou = curseur("flou", t("app.fond.flou"), 1, v => t("app.fond.pixels", { n: String(Math.round(v)) }));
	const afficherEffets = (): void => { montrerLuminosite(effets.luminosite); montrerFlou(effets.flou); };
	afficherEffets();
	void pont().reglages.lire(CLE_REGLAGES_FOND_EFFETS).then(brut => {
		if (detruit) return;
		effets = normaliserEffetsFond(brut);
		afficherEffets();
	});

	return () => { detruit = true; };
}
