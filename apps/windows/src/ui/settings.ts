/* ══════════════════════════════════════════════════════════
   LA PAGE « RÉGLAGES » — les dossiers de quiz

   Ajouter et retirer des dossiers : c'est le SEUL endroit de l'application où
   `folder.ts` (tâche 5) est piloté depuis un écran, plutôt que consommé au
   démarrage. La tâche 10 y ajoute une seconde section (« Dates d'examen »),
   la tâche 11 une carte « À réviser » ailleurs sur cette page — d'où une
   fonction `dessiner()` qui ne redessine que SA section, et non toute la page.

   Les CLASSES de structure sont celles du tableau de bord (`qbd-content`,
   `qbd-quizzes-header`…) : `src/assets/css/` est déjà chargé par `main.ts`.
   Seules les classes neuves (`nq-reglages-*`) vivent dans `shell.css`. Ce
   module n'importe AUCUN CSS — même contrainte que les modules d'hôte : un
   import de CSS y tire les fontes MathLive, pour lesquelles le harnais des
   scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../../../../src/host/current";
import { t, currentLang, currentHourCycle, hourOptions, setHourCycle } from "../../../../src/i18n";
import type { HourCycle } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { MAX_DOSSIERS, addFolder, estVaultObsidian, lienAvecRacines, pickFolder, removeFolder, savedFolders, setDefaultFolder } from "../host/folder";
import { poserLogoObsidian } from "./marques";
import { chargerLangue, lireLangue, reglerLangue } from "./langue";
import { lireFormatHeure, reglerFormatHeure } from "./format-heure";
import { pont } from "../host/pont";
import { createSelect } from "../../../../src/dashboard/ui-select";
import { getProvider, MARQUES, resoudreApresMasquage } from "../../../../src/dashboard/ai-providers";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import type { AiSettings } from "../../../../src/types/dashboard-ctx";
import { monterReglagesFond } from "./fond";
import { monterReglagesComptes } from "./comptes";

export function renderSettings(
	root: HTMLElement,
	deps: {
		onFoldersChanged(): void;
		/** Le format de l'heure a changé : l'écran SOUS la modale garde les
		    heures qu'il a déjà écrites (une modale ne redessine rien en se
		    fermant), c'est à l'appelant de le redessiner. */
		onTimeFormatChanged(): void;
		/** Les réglages IA : la section « Canaux payants » lit et écrit le
		    masquage par le MÊME hôte que la page « Générer » — une écriture
		    directe au principal (comptes.ts) laisserait le cache du client
		    derrière, et le menu masqué reviendrait au prochain rendu. */
		aiSettings: AiSettingsHost;
	},
): () => void {
	/* NI en-tête, NI bouton retour : depuis que les réglages sont une MODALE
	   (et non plus un écran qui remplaçait le tableau de bord), le titre et la
	   croix de fermeture sont posés par l'hôte (`src/host/modal.ts`). En
	   remettre ici donnerait deux titres et deux façons de fermer. */
	const contenu = ajouter(root, "div", "qbd-content");

	/* ── Le dossier de quiz PAR DÉFAUT (tranche 9) ──
	   Sans croix — il ne se RETIRE pas, il n'y aurait plus d'endroit où créer
	   un quiz —, mais il se CHANGE : le chemin calculé (`C:\Neo Quiz`) est un
	   point de départ, pas une contrainte. Le bouton passe par le dialogue
	   NATIF, seul chemin par lequel un dossier entre au périmètre. */
	const sectionDefaut = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(sectionDefaut, "h3", "nq-reglages-titre", t("app.settings.defaultFolder"));
	ajouter(sectionDefaut, "p", "nq-reglages-aide", t("app.settings.defaultFolderHint"));
	const ligneDefaut = ajouter(sectionDefaut, "div", "nq-reglages-dossier");
	currentHost().ui.setIcon(ajouter(ligneDefaut, "span", "nq-reglages-icone"), "folder");
	const texteDefaut = ajouter(ligneDefaut, "div", "nq-reglages-texte");
	ajouter(texteDefaut, "span", "nq-reglages-nom", t("app.settings.defaultFolder"));
	const cheminDefaut = ajouter(texteDefaut, "span", "nq-reglages-chemin");
	// `textContent` (via `ajouter`) : ce chemin vient du disque.
	void savedFolders().then(dossiers => {
		const defaut = dossiers.find(d => d.parDefaut);
		if (defaut) ajouter(cheminDefaut, "span", undefined, defaut.path);
	});
	const changer = ajouter(ligneDefaut, "button", "nq-reglages-changer", t("app.settings.changeDefaultFolder"));
	changer.type = "button";
	changer.addEventListener("click", () => {
		void (async () => {
			/* DÉSARMÉ PENDANT LE DIALOGUE : il est modal à la fenêtre, mais le
			   clavier peut le déclencher deux fois avant qu'il s'affiche, et
			   deux dialogues empilés laisseraient le second écrire par-dessus
			   le choix du premier. */
			changer.disabled = true;
			try {
				const choisi = await setDefaultFolder();
				// Annulation : la réponse « non », rien à faire ni à dire.
				if (!choisi) return;
				/* Même rechargement que pour un emplacement supplémentaire, et
				   pour la même raison : les racines de l'hôte changent, et
				   l'hôte n'est installé qu'une fois. */
				deps.onFoldersChanged();
			} catch (e) {
				/* Le principal a refusé (dossier incréable, disque protégé) :
				   l'ancien dossier reste en place — le dire, plutôt que de
				   laisser un bouton sans effet apparent. */
				currentHost().ui.notice(t("app.error.startup", {
					error: e instanceof Error ? e.message : String(e),
				}));
			} finally {
				changer.disabled = false;
			}
		})();
	});

	/* ── Les emplacements SUPPLÉMENTAIRES ──
	   Tous les dossiers ouverts, avec leur croix : ceux qu'on a choisis à la
	   main, et les vaults Obsidian que le démarrage a ouverts tout seuls
	   (`ouvrirVaultsDetectes`). Plus de rangée « proposée » avec un « + »
	   depuis le 2026-09-17 — il n'y a plus rien à proposer, tout vault de la
	   machine est déjà là. La croix, elle, l'écarte DURABLEMENT : c'est ce qui
	   empêche le prochain démarrage de le rouvrir. */
	const section = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(section, "h3", "nq-reglages-titre", t("app.settings.extraFolders"));
	ajouter(section, "p", "nq-reglages-aide", t("app.settings.extraFoldersHint"));
	const liste = ajouter(section, "div", "nq-reglages-liste");
	const actions = ajouter(section, "div", "nq-reglages-actions");

	async function dessiner(): Promise<void> {
		// Le défaut ne figure jamais dans cette liste — il a sa propre section.
		const dossiers = (await savedFolders()).filter(d => !d.parDefaut);
		liste.replaceChildren();
		for (const d of dossiers) {
			const ligne = ajouter(liste, "div", "nq-reglages-dossier");
			/* Le LOGO d'Obsidian quand c'en est un : ce que cette image
			   transporte, c'est « ceci est un vault », qu'une icône de dossier
			   ne dirait pas. La détection est asynchrone — d'où l'icône
			   générique posée d'abord, remplacée si besoin. */
			const icone = ajouter(ligne, "span", "nq-reglages-icone");
			currentHost().ui.setIcon(icone, "folder");
			void estVaultObsidian(d.path).then(v => { if (v) { icone.replaceChildren(); poserLogoObsidian(icone); } });
			const texte = ajouter(ligne, "div", "nq-reglages-texte");
			// `textContent` (via `ajouter`) : ces chaînes viennent du disque.
			ajouter(texte, "span", "nq-reglages-nom", d.name);
			ajouter(texte, "span", "nq-reglages-chemin", d.path);
			const retirer = ajouter(ligne, "button", "nq-reglages-retirer");
			retirer.type = "button";
			retirer.title = t("review.settings.removeFolder");
			retirer.setAttribute("aria-label", t("review.settings.removeFolder"));
			currentHost().ui.setIcon(retirer, "x");
			retirer.addEventListener("click", () => {
				void (async () => {
					await removeFolder(d.id);
					deps.onFoldersChanged();
				})();
			});
		}

		actions.replaceChildren();
		const ajout = ajouter(actions, "button", "qbd-btn--create");
		ajout.type = "button";
		currentHost().ui.setIcon(ajouter(ajout, "span", "qbd-btn-icon"), "folder-plus");
		ajouter(ajout, "span", undefined, t("review.settings.addFolder"));
		/* La limite de la spec §6 est DITE, pas subie : un bouton qui ne fait
		   rien serait pris pour une panne. Elle compte les emplacements
		   SUPPLÉMENTAIRES : le défaut est en plus (spec §2.1). */
		if (dossiers.length >= MAX_DOSSIERS) {
			ajout.disabled = true;
			ajouter(actions, "p", "nq-reglages-aide", t("review.settings.full", { count: MAX_DOSSIERS }));
		}
		ajout.addEventListener("click", () => {
			void (async () => {
				const choix = await pickFolder();
				// Annulation : ce n'est pas une erreur, c'est la réponse « non ».
				if (!choix) return;
				/* Le refus est DIT (2026-09-17). `addFolder` rendait la liste
				   inchangée sans un mot quand le dossier recouvrait une racine
				   déjà ouverte : le dialogue se fermait, rien n'apparaissait, et
				   rien n'expliquait. Un dossier SOUS une racine ouverte n'est pas
				   une erreur de l'utilisateur — c'est juste qu'il se déclare
				   ailleurs (« Mes quiz » → Nouveau dossier → Ouvrir un dossier
				   existant), et le message le dit. */
				const lien = lienAvecRacines(choix, await savedFolders());
				if (lien !== "libre") {
					currentHost().ui.notice(t(lien === "doublon" ? "app.settings.folderAlreadyOpen"
						: lien === "dedans" ? "app.settings.folderInsideOpen"
							: "app.settings.folderContainsOpen"));
					return;
				}
				await addFolder(choix);
				deps.onFoldersChanged();
			})();
		});
	}

	void dessiner();

	/* ── Général ──
	   PLUS D'INTERRUPTEUR « Rouvrir là où on s'était arrêté » (2026-09-17) :
	   l'application rouvre toujours le dernier quiz et la dernière question.
	   Le réglage a été retiré avec sa case — le garder en lecture aurait figé
	   sur l'accueil les installations où un `false` traînait déjà. */
	const general = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(general, "h3", "nq-reglages-titre", t("app.settings.general"));

	/* La langue : le SEUL dropdown autorisé (`ui-select.ts`), avec les libellés
	   du greffon (`settings.language.*`) — mêmes trois valeurs. Au changement,
	   le réglage est écrit puis l'application RELANCÉE.

	   PAS un `location.reload()`, et c'est la correction d'un défaut : tout est
	   rendu par `t()`, mais le format des champs `<input type="date">` de la
	   section « Dates d'examen » vient de la LOCALE DE CHROMIUM, posée une fois
	   avant `app.ready` (`electron/main.ts`, `poserLocaleChromium`). Un
	   rechargement retraduisait donc tous les libellés en laissant les champs
	   de date dans l'ancienne locale. La relance coûte une seconde de plus
	   qu'un rechargement — qui, lui, perdait déjà l'état de la fenêtre. */
	const langueLigne = ajouter(general, "div", "nq-reglages-langue");
	ajouter(langueLigne, "span", "nq-reglages-nom", t("settings.language.name"));
	const langueSelect = createSelect(langueLigne, {
		value: "auto",
		options: [
			{ value: "auto", label: t("app.settings.languageAuto") },
			{ value: "en", label: t("settings.language.en") },
			{ value: "fr", label: t("settings.language.fr") },
		],
		onChange: valeur => {
			// La relance ne rend jamais la main : rien à enchaîner derrière.
			void reglerLangue(lireLangue(valeur)).then(() => pont().systeme.relancer());
		},
	});
	void chargerLangue().then(l => langueSelect.setValue(l));
	ajouter(general, "p", "nq-reglages-aide", t("app.settings.languageHint"));

	/* Le FORMAT DE L'HEURE : 24 h par défaut, 12 h sur demande, quelle que
	   soit la langue. Les heures sont mises en forme au rendu (`hourOptions`) ;
	   l'écran sous la modale, déjà rendu, est redessiné par l'appelant
	   (`onTimeFormatChanged`) une fois le réglage ÉCRIT — sans quoi la fiche
	   ouverte derrière gardait « 18:35 » après le passage en 12 h. Chaque
	   option montre son exemple, mis en forme par Intl dans la langue de
	   l'interface. */
	const heureLigne = ajouter(general, "div", "nq-reglages-langue");
	ajouter(heureLigne, "span", "nq-reglages-nom", t("app.settings.timeFormat"));
	const exemple = (cycle: HourCycle): string =>
		new Intl.DateTimeFormat(currentLang() === "fr" ? "fr-FR" : "en-US", { minute: "2-digit", ...hourOptions(cycle) })
			.format(new Date(2026, 0, 1, 18, 35));
	createSelect(heureLigne, {
		value: currentHourCycle(),
		options: [
			{ value: "24h", label: t("app.settings.timeFormat24", { example: exemple("24h") }) },
			{ value: "12h", label: t("app.settings.timeFormat12", { example: exemple("12h") }) },
		],
		onChange: valeur => {
			const format = lireFormatHeure(valeur);
			if (format === currentHourCycle()) return;
			setHourCycle(format);
			void reglerFormatHeure(format).then(() => deps.onTimeFormatChanged());
		},
	});

	/* ── Comptes IA ── */
	const comptes = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(comptes, "h3", "nq-reglages-titre", t("app.settings.accounts"));
	const demonterComptes = monterReglagesComptes(comptes);

	/* ── Canaux payants ──
	   Une case par canal qui exige un abonnement (aujourd'hui Claude Code et
	   Codex CLI, les seuls de `Canal.gratuit === false`). Décocher masque le
	   canal du menu « Générer » ; recocher le remet. Si le canal masqué était
	   le fournisseur retenu, le repli (premier canal gratuit) part DANS LA
	   MÊME écriture — le laisser retenu ferait échouer la génération sans un
	   mot à l'écran. */
	const payants = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(payants, "h3", "nq-reglages-titre", t("app.settings.paidChannels"));
	ajouter(payants, "p", "nq-reglages-aide", t("app.settings.paidChannelsHint"));
	const masques = deps.aiSettings.get().aiCanauxPayantsMasques;
	let unPayant = false;
	for (const marque of MARQUES) {
		for (const canal of marque.canaux) {
			if (canal.gratuit) continue;
			unPayant = true;
			const ligne = ajouter(payants, "label", "nq-reglages-case");
			const case_ = ajouter(ligne, "input");
			case_.type = "checkbox";
			case_.checked = true;
			ajouter(ligne, "span", "nq-reglages-nom", t("app.settings.paidChannelRow", { name: marque.name + " · " + canal.label }));
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
					// Le modèle suit le fournisseur : même règle que le choix
					// d'un fournisseur dans le menu (défaut du nouveau canal).
					if (resolu) patch.aiModel = getProvider(resolu).defaultModel;
				}
				void deps.aiSettings.save(patch);
			});
		}
	}
	if (!unPayant) {
		// Aucun canal payant dans la table : pas de section vide au milieu des
		// autres — elle se retirerait d'elle-même dès qu'un canal devient
		// payant, jamais l'inverse.
		payants.remove();
	}

	/* ── Fond d'écran ── */
	const fond = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(fond, "h3", "nq-reglages-titre", t("app.settings.wallpaper"));
	const demonterFond = monterReglagesFond(fond);

	/* Le démontage ne désabonne plus la mise à jour : sa section est partie
	   (2026-09-17) et le seul abonnement restant est celui du rail, qui vit
	   aussi longtemps que la coquille. Il est rendu quand même parce que TOUT
	   écran en rend un. */
	return () => { demonterComptes(); demonterFond(); root.replaceChildren(); };
}
