/**
 * LES DOSSIERS DE QUIZ — conversion du réglage et unicité des identifiants.
 *
 * Trois défauts que ce script empêche, et qu'une relecture ne voit pas :
 * un utilisateur qui met à jour l'application et retombe sur l'écran
 * « Choisissez un dossier » alors que son dossier est toujours là ; et deux
 * dossiers homonymes dont les chemins du contrat se confondent, ce qui
 * ferait compter l'historique de l'un pour l'autre ; et un dossier RETIRÉ des
 * réglages parce qu'une question posée au disque n'a pas pu aboutir.
 *
 *     npm run check:folders
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/host/folder.ts", async ({ lireDossiers, idUnique, segmentValide, MAX_DOSSIERS, appliquerExamDate, saveFolders, savedFolders, addFolder, removeFolder, ouvrirVaultsDetectes, lienAvecRacines, lireExamens, enregistrerExamenDans, retirerExamenDe, examenProchain, aujourdhuiIso }) => {
	const r = makeReporter("Dossiers — réglage et identifiants");

	r.check("aucun réglage : aucune racine", lireDossiers({}), []);

	/* La CONVERSION de la clé au singulier. Sans elle, la mise à jour perd le
	   dossier de l'utilisateur — il est là, l'application ne le sait plus. */
	r.check("la clé au singulier devient une liste d'un dossier",
		lireDossiers({ folder: "C:/obsidian-vaults/Efrei" }),
		[{ id: "Efrei", path: "C:/obsidian-vaults/Efrei", name: "Efrei" }]);
	/* LA CONVERSION DES SÉPARATEURS (tâche 4 de la migration Electron, Ruling
	   14). Un réglage écrit par la version Tauri porte les `\` que le sélecteur
	   natif rendait ; le pont, lui, pose partout l'invariant des `/`, et
	   `obsidian.json` donne lui aussi des `\`. Sans cette conversion à la
	   LECTURE, le même dossier ouvert depuis la liste Obsidian et par le
	   sélecteur aurait DEUX `path` pour un seul disque : `depuisAbsolu`
	   (`roots.ts`) compare des préfixes, donc les événements du surveillant
	   tomberaient dans le vide pour l'une des deux formes — un catalogue qui ne
	   se met plus à jour, sans message. Le `\` FINAL part aussi : un préfixe qui
	   se termine par un séparateur ne correspond à rien. */
	r.check("un chemin persisté avec des antislashs est converti",
		lireDossiers({ folders: [{ path: "C:\\obsidian-vaults\\Efrei\\" }] })[0].path,
		"C:/obsidian-vaults/Efrei");
	r.check("… y compris sous l'ancienne clé au singulier",
		lireDossiers({ folder: "C:\\obsidian-vaults\\Efrei" })[0].path,
		"C:/obsidian-vaults/Efrei");

	/* `folders` GAGNE sur `folder` : une fois converti, l'ancien réglage ne
	   doit plus jamais reprendre la main. */
	r.check("folders l'emporte sur folder",
		lireDossiers({ folders: [{ id: "A", path: "D:/A", name: "A" }], folder: "C:/vieux" }).map(d => d.path),
		["D:/A"]);

	/* Deux dossiers HOMONYMES. Le second doit recevoir un identifiant
	   distinct : deux préfixes identiques feraient de « Cours/ch1.md » deux
	   notes indiscernables, et le journal de l'une compterait pour l'autre. */
	r.check("deux dossiers homonymes reçoivent des identifiants distincts",
		lireDossiers({ folders: [
			{ path: "C:/a/Cours", name: "Cours" },
			{ path: "D:/b/Cours", name: "Cours" },
		] }).map(d => d.id), ["Cours", "Cours-2"]);

	/* Un identifiant PERSISTÉ est reconduit tel quel : le recalculer ferait
	   changer tous les chemins affichés au moindre renommage. */
	r.check("un identifiant persisté est reconduit",
		lireDossiers({ folders: [{ id: "Ancien", path: "C:/x", name: "Nouveau nom" }] })[0].id, "Ancien");

	/* SAUF « Neo Quiz » (fix round 1, tranche 9) : c'est l'id RÉSERVÉ du
	   dossier par défaut, posé par `savedFolders` et jamais par ce qui vient
	   de `folders`. Un utilisateur qui avait déjà un dossier persisté sous cet
	   id (rare, mais un fichier de réglages édité à la main le permet) le
	   verrait sinon confondu avec le défaut — même id, deux dossiers, et
	   `removeFolder("Neo Quiz")` retirerait le mauvais des deux. Il est donc
	   renuméroté comme n'importe quelle collision : « Neo Quiz-2 ». Il PERD
	   son historique sous l'ancien id (les chemins du contrat qui en
	   dépendaient changent de préfixe) — c'est le prix d'un id qui doit rester
	   univoque. */
	r.check("l'identifiant réservé du défaut, s'il était déjà persisté, est renuméroté",
		lireDossiers({ folders: [{ id: "Neo Quiz", path: "D:/x", name: "x" }] }).map(d => d.id),
		["Neo Quiz-2"]);

	/* Un `/` dans un identifiant en ferait DEUX segments, et le premier ne
	   désignerait plus aucune racine. */
	r.check("un séparateur est neutralisé", segmentValide("a/b"), "a-b");
	r.check("un nom vide donne un identifiant utilisable", segmentValide("   "), "dossier");
	r.check("idUnique suffixe à partir de 2", idUnique("Cours", new Set(["Cours", "Cours-2"])), "Cours-3");

	/* La limite de la spec §6 est appliquée à la LECTURE aussi : un fichier
	   de réglages édité à la main ne doit pas ouvrir cinquante dossiers. */
	const onze = Array.from({ length: 11 }, (_, i) => ({ path: `C:/d${i}`, name: `d${i}` }));
	r.check("au plus dix dossiers", lireDossiers({ folders: onze }).length, MAX_DOSSIERS);

	/* Une entrée sans chemin est ignorée, pas conservée avec un chemin vide —
	   qui ouvrirait la racine du disque. */
	r.check("une entrée sans chemin est ignorée",
		lireDossiers({ folders: [{ name: "vide" }, { path: "C:/ok", name: "ok" }] }).map(d => d.path), ["C:/ok"]);

	/* LES DATES D'EXAMEN (tâche 10, mineur reporté de la tâche 8). Régler une
	   date ajoute la clé, l'effacer la RETIRE — elle n'est pas gardée vide.
	   Sans cette règle, le réglage accumulerait des entrées mortes qu'on
	   n'oserait plus nettoyer (`setExamDate` impure n'a que ce filet-ci,
	   `appliquerExamDate` étant la partie pure qu'il appelle). */
	r.check("régler une date ajoute la clé",
		appliquerExamDate({}, "Efrei/Reseaux", "2027-06-01"),
		{ "Efrei/Reseaux": "2027-06-01" });
	r.check("effacer une date RETIRE la clé, elle n'est pas gardée vide",
		appliquerExamDate({ "Efrei/Reseaux": "2027-06-01" }, "Efrei/Reseaux", ""),
		{});
	r.check("effacer la date d'un module laisse les autres matières intactes",
		appliquerExamDate(
			{ "Efrei/Reseaux": "2027-06-01", "Efrei/BDD": "2027-05-01" },
			"Efrei/Reseaux", ""),
		{ "Efrei/BDD": "2027-05-01" });

	/* ── `saveFolders` : DISPARU n'est pas INACCESSIBLE (tâche 4, ronde 1) ──

	   `saveFolders` écarte les dossiers disparus du disque avant d'écrire, et
	   il le faut : la garde du canal `reglages.ecrire` exige que chaque chemin
	   de la clé `folders` soit déjà au périmètre, or un dossier absent n'y est
	   jamais entré — sa seule présence ferait rejeter l'écriture ENTIÈRE, et
	   l'utilisateur ne pourrait plus retirer un AUTRE dossier tant que sa clé
	   USB n'est pas rebranchée (Ruling 15).

	   Mais `exists` a DEUX façons de ne pas dire oui, et les confondre coûte
	   cher : `false` est une réponse du disque (« il n'y a rien là »), un REJET
	   n'en est pas une (partage réseau muet, droits, chemin hors périmètre).
	   Retirer l'entrée sur un rejet ferait disparaître en silence un dossier
	   parfaitement vivant — et priverait au passage l'utilisateur du refus que
	   la garde du principal devait lui montrer sur un chemin fabriqué.

	   Le pont est DOUBLÉ ici, au plus juste : trois dossiers, un présent, un
	   absent, un dont la question rejette. Les trois moitiés comptent — un
	   double qui rendrait `true` partout ferait passer un code qui n'écarte
	   rien. */
	const precedent = globalThis.window;
	const ecrits = [];
	globalThis.window = {
		neo: {
			fichiers: {
				async exists(chemin) {
					if (chemin === "C:/injoignable") throw new Error("EBUSY: le partage ne répond pas");
					return chemin !== "C:/disparu";
				},
			},
			reglages: {
				async ecrire(cle, valeur) { ecrits.push([cle, valeur.map(d => d.path)]); },
			},
		},
	};
	/* `saveFolders` NOMME en console chaque dossier écarté ou gardé de force —
	   c'est voulu dans l'application, mais ici la pile d'appels du faux rejet
	   noierait le rapport. */
	const avertir = console.warn;
	console.warn = () => {};
	try {
		await saveFolders([
			{ id: "Present", path: "C:/present", name: "Present" },
			{ id: "Disparu", path: "C:/disparu", name: "Disparu" },
			{ id: "Injoignable", path: "C:/injoignable", name: "Injoignable" },
		]);
		r.check("saveFolders retire le dossier DISPARU et garde celui qu'on n'a pas pu joindre",
			ecrits, [["folders", ["C:/present", "C:/injoignable"]]]);
	} finally {
		console.warn = avertir;
		if (precedent === undefined) delete globalThis.window;
		else globalThis.window = precedent;
	}

	/* ── Le dossier PAR DÉFAUT (tranche 9) : devant, jamais retiré ──

	   `savedFolders` le pose devant à CHAQUE lecture, à partir de ce que le
	   principal sert (`systeme.dossierDefaut`) — jamais lu ni écrit dans
	   `folders`. `removeFolder` doit le refuser, et ne doit JAMAIS l'écrire
	   dans `folders` en tentant de le retirer d'une liste qui le contient. */
	{
		const precedent = globalThis.window;
		const reglagesEcrits = [];
		globalThis.window = {
			neo: {
				fichiers: { async exists() { return true; } },
				reglages: {
					async lire(cle) { return cle === "folders" ? [{ id: "Perso", path: "D:/Perso", name: "Perso" }] : undefined; },
					async ecrire(cle, valeur) { reglagesEcrits.push([cle, valeur]); },
					async supprimer() {},
				},
				systeme: { async dossierDefaut() { return "C:/Neo Quiz"; } },
			},
		};
		try {
			const dossiers = await savedFolders();
			r.check("le défaut est devant, marqué parDefaut, et n'écrase pas les dossiers déjà ouverts",
				dossiers.map(d => ({ id: d.id, parDefaut: !!d.parDefaut })),
				[{ id: "Neo Quiz", parDefaut: true }, { id: "Perso", parDefaut: false }]);

			await removeFolder("Neo Quiz");
			r.check("removeFolder refuse le défaut : aucune écriture ne le mentionne",
				reglagesEcrits.every(([cle, valeur]) => cle !== "folders" || !valeur.some(d => d.id === "Neo Quiz")),
				true);

			reglagesEcrits.length = 0;
			await removeFolder("Perso");
			r.check("removeFolder retire un dossier ordinaire sans jamais écrire le défaut",
				reglagesEcrits.filter(([cle]) => cle === "folders"), [["folders", []]]);
			/* ÉCARTÉ EN MÊME TEMPS, et c'est ce qui rend la croix durable : les
			   vaults Obsidian de la machine sont rouverts à chaque démarrage
			   (`ouvrirVaultsDetectes`), donc un retrait qui ne laisse aucune
			   trace est un retrait qui ne tient pas jusqu'au lancement suivant. */
			r.check("removeFolder écarte le chemin retiré",
				reglagesEcrits.filter(([cle]) => cle === "dismissedFolders"),
				[["dismissedFolders", ["D:/Perso"]]]);
		} finally {
			if (precedent === undefined) delete globalThis.window;
			else globalThis.window = precedent;
		}
	}

	/* ── L'OUVERTURE AUTOMATIQUE DES VAULTS OBSIDIAN (2026-09-17) ──

	   Tout vault déclaré par Obsidian est ouvert au démarrage, sans un clic.
	   Ce qui s'éprouve ici est la seule chose qui empêche cette commodité de
	   devenir un piège : un vault RETIRÉ à la croix ne doit pas revenir au
	   lancement suivant. Sans la liste des écartés, la croix serait un bouton
	   qui ne retire rien au-delà de la session — et personne ne s'en
	   apercevrait avant le troisième essai.

	   Le second cas est l'envers du premier : rouvrir à la main un vault
	   écarté doit le faire SORTIR de la liste, sinon il resterait le seul
	   vault de la machine que l'ouverture automatique saute, sans rien pour
	   l'expliquer. */
	{
		const precedent = globalThis.window;
		const vaults = [{ chemin: "C:/obsidian-vaults/Personal", nom: "Personal" }, { chemin: "C:/obsidian-vaults/Efrei", nom: "Efrei" }];
		const faireFenetre = (reglages, ecrits) => ({
			neo: {
				fichiers: { async exists() { return true; } },
				reglages: {
					async lire(cle) { return reglages[cle]; },
					async ecrire(cle, valeur) { ecrits.push([cle, valeur]); reglages[cle] = valeur; },
					async supprimer() {},
				},
				systeme: { async dossierDefaut() { return "C:/Neo Quiz"; }, async vaultsObsidian() { return vaults; } },
			},
		});
		try {
			const ecrits = [];
			const reglages = {};
			globalThis.window = faireFenetre(reglages, ecrits);
			r.check("les vaults détectés sont ouverts au démarrage", await ouvrirVaultsDetectes(), 2);
			r.check("une seule écriture, quel que soit le nombre de vaults",
				ecrits.filter(([cle]) => cle === "folders").length, 1);
			r.check("ils ne sont pas rouverts une seconde fois", await ouvrirVaultsDetectes(), 0);

			const ecrits2 = [];
			const reglages2 = { folders: [{ id: "Personal", path: "C:/obsidian-vaults/Personal", name: "Personal" }], dismissedFolders: [] };
			globalThis.window = faireFenetre(reglages2, ecrits2);
			await removeFolder("Personal");
			r.check("un vault retiré ne revient PAS au démarrage suivant", await ouvrirVaultsDetectes(), 1);
			r.check("et c'est bien l'autre vault qui a été ouvert",
				(reglages2.folders ?? []).map(d => d.path), ["C:/obsidian-vaults/Efrei"]);

			await addFolder("C:/obsidian-vaults/Personal");
			r.check("le rouvrir à la main le fait sortir des écartés",
				reglages2.dismissedFolders, []);
		} finally {
			if (precedent === undefined) delete globalThis.window;
			else globalThis.window = precedent;
		}
	}

	/* ── La collision avec un dossier DÉJÀ persisté sous l'id réservé (fix
	   round 1) ── Un `folders` qui porte déjà `{ id: "Neo Quiz", … }` (un
	   utilisateur qui avait ouvert un dossier nommé ainsi avant cette
	   version) ne doit produire qu'UNE seule entrée `id: "Neo Quiz"` — le
	   défaut — l'autre étant renumérotée par `lireDossiers`. */
	{
		const precedent = globalThis.window;
		const reglagesEcrits = [];
		globalThis.window = {
			neo: {
				fichiers: { async exists() { return true; } },
				reglages: {
					async lire(cle) { return cle === "folders" ? [{ id: "Neo Quiz", path: "D:/x", name: "x" }] : undefined; },
					async ecrire(cle, valeur) { reglagesEcrits.push([cle, valeur]); },
					async supprimer() {},
				},
				systeme: { async dossierDefaut() { return "C:/Neo Quiz"; } },
			},
		};
		try {
			const dossiers = await savedFolders();
			r.check("un dossier persisté sous l'id réservé est renuméroté, le défaut garde le sien",
				dossiers.map(d => ({ id: d.id, parDefaut: !!d.parDefaut })),
				[{ id: "Neo Quiz", parDefaut: true }, { id: "Neo Quiz-2", parDefaut: false }]);

			await removeFolder("Neo Quiz-2");
			r.check("removeFolder retire le dossier renuméroté, pas le défaut",
				reglagesEcrits.filter(([cle]) => cle === "folders"), [["folders", []]]);
		} finally {
			if (precedent === undefined) delete globalThis.window;
			else globalThis.window = precedent;
		}
	}

	/* ── Deux racines ne se recouvrent JAMAIS (2026-09-17) ──
	   `addFolder` ne refusait que le doublon EXACT. Un dossier ouvert DANS
	   une racine déjà ouverte (le dossier d'un cours dans un vault) passait :
	   deux racines gigognes, donc deux chemins du contrat pour le même
	   fichier — « la plus longue racine gagne » dans `depuisAbsolu` —, donc
	   deux historiques de révision pour la même question. Le prédicat est
	   pur ; `addFolder` s'en sert, et le refus se voit sur la liste rendue. */
	{
		const racines = [{ path: "C:/obsidian-vaults/Efrei" }, { path: "C:/Neo Quiz" }];
		r.check("un chemin sans lien avec les racines est libre",
			lienAvecRacines("D:/Cours", racines), "libre");
		r.check("la même racine est un doublon",
			lienAvecRacines("C:/obsidian-vaults/Efrei", racines), "doublon");
		r.check("un dossier SOUS une racine ouverte est dedans",
			lienAvecRacines("C:/obsidian-vaults/Efrei/B2 (2026-2027)/XTI301", racines), "dedans");
		r.check("un dossier AU-DESSUS d'une racine ouverte la contient",
			lienAvecRacines("C:/obsidian-vaults", racines), "contient");
		r.check("la casse est ignorée, comme sur le disque et dans depuisAbsolu",
			lienAvecRacines("c:/OBSIDIAN-VAULTS/efrei/Cours", racines), "dedans");
		r.check("les séparateurs Windows et la barre finale ne changent rien",
			lienAvecRacines("C:\\obsidian-vaults\\Efrei\\", racines), "doublon");
		r.check("un préfixe de NOM n'est pas un préfixe de CHEMIN",
			lienAvecRacines("C:/obsidian-vaults/Efrei2", racines), "libre");

		const precedent = globalThis.window;
		const reglages = { folders: [{ id: "Efrei", path: "C:/obsidian-vaults/Efrei", name: "Efrei" }], dismissedFolders: [] };
		const ecrits = [];
		globalThis.window = {
			neo: {
				fichiers: { async exists() { return true; } },
				reglages: {
					async lire(cle) { return reglages[cle]; },
					async ecrire(cle, valeur) { ecrits.push([cle, valeur]); reglages[cle] = valeur; },
					async supprimer() {},
				},
				systeme: { async dossierDefaut() { return "C:/Neo Quiz"; } },
			},
		};
		try {
			const apres = await addFolder("C:/obsidian-vaults/Efrei/B2 (2026-2027)/XTI301");
			r.check("addFolder refuse un dossier sous une racine ouverte",
				apres.filter(d => !d.parDefaut).map(d => d.path), ["C:/obsidian-vaults/Efrei"]);
			r.check("et n'écrit rien",
				ecrits.filter(([cle]) => cle === "folders").length, 0);
			const dessus = await addFolder("C:/obsidian-vaults");
			r.check("addFolder refuse un dossier qui contient une racine ouverte",
				dessus.filter(d => !d.parDefaut).map(d => d.path), ["C:/obsidian-vaults/Efrei"]);
			const libre = await addFolder("D:/Cours");
			r.check("et accepte toujours un dossier sans lien",
				libre.filter(d => !d.parDefaut).map(d => d.path), ["C:/obsidian-vaults/Efrei", "D:/Cours"]);
		} finally {
			if (precedent === undefined) delete globalThis.window;
			else globalThis.window = precedent;
		}
	}

	{
		const m = "Efrei/Reseaux";
		const migre = lireExamens(undefined, { [m]: "2027-06-01" });
		r.check("migration : l'ancienne date devient un examen", migre[m], [{ id: "migre-" + m, nom: "", date: "2027-06-01" }]);
		r.check("migration : n'écrase pas un module déjà migré", lireExamens({ [m]: [{ id: "x", nom: "Partiel", date: "2027-01-10" }] }, { [m]: "2027-06-01" })[m].map(e => e.id), ["x"]);
		r.check("réglage corrompu (tableau) : vide", lireExamens([], undefined), {});
		r.check("réglage corrompu (chaîne) : vide", lireExamens("x", undefined), {});
		r.check("entrée sans date ignorée", lireExamens({ [m]: [{ id: "a", nom: "", date: "" }, { id: "b", nom: "", date: "2027-02-02" }] }, undefined)[m].map(e => e.id), ["b"]);
		const t1 = enregistrerExamenDans({}, m, { id: "a", nom: "Final", date: "2027-06-01" });
		const t2 = enregistrerExamenDans(t1, m, { id: "b", nom: "Partiel", date: "2027-03-01" });
		r.check("deux examens, triés par date", t2[m].map(e => e.id), ["b", "a"]);
		r.check("modifier = même id remplacé", enregistrerExamenDans(t2, m, { id: "a", nom: "Final", date: "2027-02-01" })[m].map(e => e.date), ["2027-02-01", "2027-03-01"]);
		r.check("retirer", retirerExamenDe(t2, m, "b")[m].map(e => e.id), ["a"]);
		r.check("module vidé : clé retirée", Object.keys(retirerExamenDe(t1, m, "a")), []);
		r.check("prochain : aujourd'hui compris", examenProchain(t2[m], "2027-03-01")?.id, "b");
		r.check("prochain : le passé exclu, le suivant pris", examenProchain(t2[m], "2027-03-02")?.id, "a");
		r.check("prochain : tout passé", examenProchain(t2[m], "2027-07-01"), null);
		r.check("date locale ISO", aujourdhuiIso(new Date(2027, 0, 5, 23, 30).getTime()), "2027-01-05");
	}

	r.done();
});

await withSrcModule("apps/windows/src/review/garde-examen.ts", ({ garderSiExamen }) => {
	const r = makeReporter("Pas d'examen, pas de révision");
	const avec = (chemin) => chemin.startsWith("Efrei/Reseaux/");
	r.check("garde les clés des modules avec examen", garderSiExamen(["Efrei/Reseaux/CM1.md::q1", "Perso/Maths/A.md::q2"], avec), ["Efrei/Reseaux/CM1.md::q1"]);
	r.check("clé sans séparateur écartée", garderSiExamen(["sansSeparateur"], () => true), []);
	r.check("aucun examen : rien de dû", garderSiExamen(["Efrei/Reseaux/CM1.md::q1"], () => false), []);
	r.done();
});
