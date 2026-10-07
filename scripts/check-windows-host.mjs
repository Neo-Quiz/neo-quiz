/**
 * Vérification de l'INDEX et de la RÉSOLUTION DE LIENS de l'hôte Windows.
 *
 * L'index est la seule pièce de l'hôte Windows qui soit du code pur : c'est
 * lui qui rend `listMarkdown`, `findByName` et `getFile` synchrones, donc lui
 * qui doit rester juste après un renommage ou une suppression. Un index qui
 * dérive ne produit pas d'erreur : il fait disparaître des quiz du catalogue.
 *
 * Depuis la tâche 6, l'hôte est COMPOSITE : les chemins du contrat portent un
 * premier segment qui nomme la racine (`apps/windows/src/host/roots.ts`,
 * `CarteRacines`). Un groupe dédié éprouve cette carte, PURE, indépendamment
 * de tout le reste ; les groupes « liens » qui suivent la consomment comme un
 * appelant réel le ferait.
 *
 * Le reste de l'hôte (sélecteur, toasts, MathLive) n'existe que dans la
 * fenêtre : il se vérifie à la main, et la tâche dit comment.
 *
 * DEPUIS LA TÂCHE 4 (migration Tauri → Electron), CE QUE CES GROUPES DOUBLENT
 * A CHANGÉ DE NATURE. L'hôte ne parle plus à `@tauri-apps/plugin-fs` par
 * `window.__TAURI_INTERNALS__.invoke` : il appelle `window.neo`, le pont typé
 * du préchargement (`apps/windows/electron/pont.ts`). Le double n'imite donc
 * plus une frontière IPC bavarde — c'est un `window.neo` de quinze méthodes
 * (`installerPont` plus bas), et ce qu'il laisse sous test est exactement ce
 * qui est à nous : la traduction chemin du contrat ↔ chemin absolu, le rejeu
 * de `process`, le recalage du miroir sur le `mtime` RENDU par chaque
 * écriture. Ce qui est parti de l'autre côté de la frontière (la mécanique de
 * `.trash`, la numérotation d'un homonyme) est éprouvé là où il vit désormais,
 * `npm run check:electron-fs` — pas doublé deux fois.
 *
 * `resourceUrl` n'a plus AUCUN double : l'URL du protocole des ressources est
 * une pure fonction du chemin (`apps/windows/electron/ressources.ts`), et le
 * groupe qui suit son SCHÉMA prouve que le sanitizer l'accepte.
 *
 *     npm run check:windows-host
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Event, parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const f = (path, extension, mtime = 1) => ({
	path,
	name: path.split("/").pop(),
	basename: path.split("/").pop().replace(/\.[^.]+$/, ""),
	extension,
	mtime,
});

/* `evenementDeRenommage` est prise DANS LE MODULE OÙ ELLE VIT
   (`apps/windows/electron/catalogue.ts`) et non plus réexportée par l'hôte :
   depuis la tâche 4, plus aucun code du rendu ne l'appelle — le pont n'émet pas
   de renommage. La faire transiter par `fs.ts` laisserait croire qu'un câblage
   existe là-bas. Elle reste une règle du CATALOGUE, partagée par les deux
   processus, et ces quatre cas la gardent. */
let evenementDeRenommage;
await withSrcModule("apps/windows/electron/catalogue.ts", async (mod) => {
	evenementDeRenommage = mod.evenementDeRenommage;
});

await withSrcModule("apps/windows/src/host/fs.ts", async ({ buildIndex, horsCatalogue }) => {
	const r = makeReporter("Hôte Windows — index");
	const idx = buildIndex([
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
		f("Autre/schema.png", "png"),
		f("notes.txt", "txt"),
	]);

	r.check("listMarkdown ne rend que les .md",
		idx.all().filter(x => x.extension === "md").map(x => x.path), ["Cours/reseau.md"]);
	r.check("get par chemin", idx.get("Autre/schema.png")?.name, "schema.png");
	r.check("get d'un chemin inconnu rend null", idx.get("absent.md"), null);

	/* Un renommage doit RETIRER l'ancien chemin. Le garder laisserait un quiz
	   fantôme au catalogue, que plus aucun fichier ne peut mettre à jour. */
	idx.apply({ kind: "rename", file: f("Cours/reseau2.md", "md"), oldPath: "Cours/reseau.md" });
	r.check("un renommage retire l'ancien chemin", idx.get("Cours/reseau.md"), null);
	r.check("un renommage ajoute le nouveau", idx.get("Cours/reseau2.md")?.basename, "reseau2");

	idx.apply({ kind: "delete", path: "notes.txt" });
	r.check("une suppression retire l'entrée", idx.get("notes.txt"), null);

	idx.apply({ kind: "create", file: f("Cours/ch2.md", "md") });
	idx.apply({ kind: "modify", file: f("Cours/ch2.md", "md", 99) });
	r.check("une modification met la date à jour sans dupliquer",
		idx.all().filter(x => x.path === "Cours/ch2.md").map(x => x.mtime), [99]);

	/* ── ce que le catalogue doit IGNORER, et ce qu'il doit entendre d'un
	   renommage ──

	   Le surveillant lui-même n'est pas éprouvable ici (il tient un abonnement
	   Tauri vivant) ; ces deux fonctions PURES portent la règle qu'il applique,
	   et c'est pour ça qu'elles sont sorties de lui. Le défaut mesuré :
	   `HostFs.trash` met à la corbeille par un `rename` vers
	   `<racine>/.trash/…`, et la branche des renommages ne filtrait rien — le
	   quiz supprimé RENTRAIT au catalogue sous son chemin de corbeille et
	   restait dans « Mes quiz » jusqu'au redémarrage. Le parcours du démarrage
	   filtrait, lui : deux copies d'une même règle avaient divergé. */
	r.check("un chemin ordinaire est au catalogue", horsCatalogue("Quiz/Cours/ch1.md"), false);
	r.check("un chemin qui traverse la corbeille en est dehors",
		horsCatalogue("Quiz/.trash/Cours/ch1.md"), true);
	r.check("… et node_modules aussi", horsCatalogue("Quiz/node_modules/x.md"), true);
	r.check("un chemin réduit à la racine n'est pas un fichier", horsCatalogue("Quiz"), true);
	/* Les DEUX bornes du `slice(1, -1)`, chacune tenue par un cas : le premier
	   segment est l'identifiant de RACINE, le dernier le NOM du fichier. Sans
	   elles, un dossier ouvert nommé « .archives » exclurait tout son contenu,
	   et un fichier nommé « .gitignore » s'exclurait lui-même — la même règle
	   que `toHostFile` applique déjà au point de tête. */
	r.check("un NOM qui commence par un point reste au catalogue",
		horsCatalogue("Quiz/Cours/.gitignore"), false);
	r.check("une RACINE qui commence par un point n'exclut pas ses fichiers",
		horsCatalogue(".archives/Cours/ch1.md"), false);

	const ch1 = f("Cours/ch1.md", "md");
	const jete = f("Quiz/.trash/Cours/ch1.md", "md");
	const ailleurs = f("Quiz/Autre/ch1.md", "md");
	/* Vers un dossier ignoré : une DISPARITION, pas un renommage. Les deux
	   moitiés sont nécessaires — diffuser un `rename` insérerait le chemin de
	   corbeille à l'index (`apply` ne filtre rien), et ne rien diffuser du tout
	   y laisserait l'ANCIEN chemin, donc un quiz fantôme que plus aucun fichier
	   ne peut mettre à jour. */
	r.check("un renommage vers la corbeille est une suppression de l'ancien chemin",
		evenementDeRenommage("Quiz/Cours/ch1.md", "Quiz/.trash/Cours/ch1.md", jete),
		{ kind: "delete", path: "Quiz/Cours/ch1.md" });
	/* Et le retour est une APPARITION : le catalogue n'a jamais connu le chemin
	   de corbeille, un `rename` porterait un `oldPath` qu'il ne peut pas
	   retirer. */
	r.check("un retour de la corbeille est une création",
		evenementDeRenommage("Quiz/.trash/Cours/ch1.md", "Quiz/Cours/ch1.md", ch1),
		{ kind: "create", file: ch1 });
	r.check("entre deux dossiers indexés, c'est bien un renommage",
		evenementDeRenommage("Quiz/Cours/ch1.md", "Quiz/Autre/ch1.md", ailleurs),
		{ kind: "rename", file: ailleurs, oldPath: "Quiz/Cours/ch1.md" });
	/* D'un dossier ignoré à un autre : RIEN. Le catalogue ne connaît ni la
	   source ni la destination ; une suppression y porterait un chemin qu'il
	   n'a jamais eu. */
	r.check("un renommage interne à la corbeille ne dit rien au catalogue",
		evenementDeRenommage("Quiz/.trash/a.md", "Quiz/.trash/b.md", f("Quiz/.trash/b.md", "md")),
		null);

	r.done();
});

/**
 * L'APPARIEMENT D'UN RENOMMAGE DE DOSSIER — tâche 5. Chokidar remonte
 * `unlinkDir`/`addDir` séparément ; `evenementDeRenommageDossier` (pure, dans
 * `catalogue.ts`) décide si une paire est CERTAINE. Elle ne devine jamais :
 * ces cas éprouvent chacune des trois gardes séparément, plus la réduction
 * des sous-dossiers d'un même mouvement.
 */
await withSrcModule("apps/windows/electron/catalogue.ts", async ({ evenementDeRenommageDossier }) => {
	const r = makeReporter("Hôte Windows — l'appariement d'un renommage de dossier");

	r.check("un renommage simple émet une paire, dans les deux sens du contrat",
		evenementDeRenommageDossier(["Quiz/Cours"], ["Quiz/Cours B2"]),
		{ from: "Quiz/Cours", to: "Quiz/Cours B2" });

	r.check("une suppression seule (aucun dossier créé) n'apparie rien",
		evenementDeRenommageDossier(["Quiz/Cours"], []), null);

	r.check("une création seule (aucun dossier supprimé) n'apparie rien",
		evenementDeRenommageDossier([], ["Quiz/Cours B2"]), null);

	r.check("deux renommages simultanés n'apparient rien",
		evenementDeRenommageDossier(["Quiz/Cours", "Quiz/Autre"], ["Quiz/Cours B2", "Quiz/Autre B2"]),
		null);

	r.check("un renommage qui change de PARENT n'apparie rien (déplacement, pas renommage)",
		evenementDeRenommageDossier(["Quiz/Cours"], ["Quiz/Ailleurs/Cours"]), null);

	r.check("un renommage VERS un dossier ignoré n'apparie rien, comme pour un fichier",
		evenementDeRenommageDossier(["Quiz/Cours"], ["Quiz/.trash"]), null);

	r.check("un renommage DEPUIS un dossier ignoré n'apparie rien, comme pour un fichier",
		evenementDeRenommageDossier(["Quiz/.trash"], ["Quiz/Cours"]), null);

	/* Renommer « Cours » qui contient « Cours/TD » fait remonter, dans la même
	   fenêtre, un `unlinkDir` pour LES DEUX chemins et un `addDir` pour leurs
	   deux nouveaux noms : sans la réduction aux racines du mouvement, ce
	   cas rougirait comme s'il y avait deux candidats de chaque bord. */
	r.check("le sous-dossier d'un dossier renommé n'est pas un second candidat",
		evenementDeRenommageDossier(
			["Quiz/Cours", "Quiz/Cours/TD"],
			["Quiz/Cours B2", "Quiz/Cours B2/TD"]),
		{ from: "Quiz/Cours", to: "Quiz/Cours B2" });

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ resolveDansIndex }) => {
	const r = makeReporter("Hôte Windows — liens");
	/* L'ORDRE de cette liste est porteur : l'homonyme LOINTAIN est en tête.
	   Rangé dans l'autre sens, un code qui prendrait bêtement le premier
	   homonyme tomberait juste par accident, et le cas « le plus proche de la
	   note citante » resterait VERT alors que la règle a disparu — mesuré. */
	const fichiers = [
		f("Autre/schema.png", "png"),
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
	];

	/* Un wikilink se résout d'abord comme un CHEMIN exact, puis par NOM.
	   Obsidian fait la même chose via son index de liens ; l'inverser ferait
	   gagner un homonyme lointain contre le fichier explicitement désigné. */
	r.check("un chemin exact gagne",
		resolveDansIndex(fichiers, "Autre/schema.png", "Cours/reseau.md")?.path, "Autre/schema.png");
	r.check("un chemin sans extension se complète",
		resolveDansIndex(fichiers, "Cours/reseau", "x.md")?.path, "Cours/reseau.md");
	/* À défaut de chemin, le nom seul — et le PLUS PROCHE de la note qui cite
	   le lien gagne, parce que c'est l'image du chapitre, pas son homonyme
	   d'un autre cours. */
	r.check("un nom seul prend le plus proche de la note citante",
		resolveDansIndex(fichiers, "schema.png", "Cours/reseau.md")?.path, "Cours/Images/schema.png");
	r.check("un lien introuvable rend null",
		resolveDansIndex(fichiers, "rien.png", "Cours/reseau.md"), null);
	r.check("un lien vide rend null", resolveDansIndex(fichiers, "  ", "x.md"), null);

	r.done();
});

/* Capturées hors du module chargé : la SEULE utilité de charger `roots.ts` à
   nouveau, plus bas, serait de reconstruire le même bundle pour rien — les
   fonctions déjà importées restent valides même une fois le dossier
   temporaire de `withSrcModule` effacé (le code est déjà en mémoire, Node ne
   relit rien). */
let creerCarteRacines;
let resultsDirFor;

await withSrcModule("apps/windows/src/host/roots.ts", async (mod) => {
	creerCarteRacines = (racines) => mod.creerCarteRacines(racines, "test-device");
	resultsDirFor = mod.resultsDirFor;
	const { attachmentPathFor, couperExtension } = mod;
	const r = makeReporter("Hôte Windows — racines");
	const carte = creerCarteRacines([
		{ id: "Efrei", name: "Efrei", path: "C:/obsidian-vaults/Efrei", vault: true },
		{ id: "Perso", name: "Perso", path: "D:/Notes", vault: false },
	]);

	/* LA CLÉ DU JOURNAL. C'est le cas le plus important du fichier : elle doit
	   valoir exactement ce que le greffon écrit pour la même note. */
	r.check("local() retire le préfixe de racine",
		carte.local("Efrei/Cours/reseau.md"), "Cours/reseau.md");
	r.check("contrat() le remet", carte.contrat("Efrei", "Cours/reseau.md"), "Efrei/Cours/reseau.md");
	r.check("les deux se composent en identité",
		carte.local(carte.contrat("Perso", "a/b.md")), "a/b.md");
	/* Un identifiant VIDE (l'hôte Obsidian) laisse les chemins intacts. */
	r.check("un identifiant vide ne préfixe rien", carte.contrat("", "a/b.md"), "a/b.md");

	r.check("pour() trouve la racine", carte.pour("Perso/x.md")?.name, "Perso");
	r.check("pour() d'un chemin hors racines rend null", carte.pour("Inconnu/x.md"), null);
	/* Rendu TEL QUEL, pas vidé : une chaîne vide donnerait la clé « ::id »,
	   qui ressemble à une vraie clé et polluerait l'historique. */
	r.check("local() d'un chemin hors racines le rend tel quel",
		carte.local("Inconnu/x.md"), "Inconnu/x.md");
	/* Un chemin NU réduit au seul identifiant de racine (« Efrei », sans
	   sous-chemin) désigne la racine ELLE-MÊME : `local()` en rend la chaîne
	   VIDE, symétrique de `contrat(id, "")` qui rend `id` seul. Ce n'est PAS
	   le même vide que « hors racines » ci-dessus — ici la racine EST connue,
	   simplement sans sous-chemin à en retirer. */
	r.check("local() d'un chemin nu réduit à l'identifiant de racine rend une chaîne vide",
		carte.local("Efrei"), "");

	r.check("absolu() compose le chemin disque",
		carte.absolu("Efrei/Cours/reseau.md"), "C:/obsidian-vaults/Efrei/Cours/reseau.md");
	r.check("depuisAbsolu() fait l'inverse",
		carte.depuisAbsolu("D:/Notes/a/b.md"), "Perso/a/b.md");
	/* Windows ignore la casse : un surveillant qui rendrait « D:/NOTES/… »
	   ferait sinon tomber tous ses évènements dans le vide. */
	r.check("depuisAbsolu() ignore la casse", carte.depuisAbsolu("d:/notes/a/b.md"), "Perso/a/b.md");
	r.check("depuisAbsolu() hors racines rend null", carte.depuisAbsolu("E:/ailleurs/x.md"), null);

	/* Un dossier ouvert DANS un autre : la plus longue racine gagne, sinon le
	   même fichier aurait deux chemins du contrat selon l'ordre de la liste —
	   donc deux entrées au catalogue pour un seul quiz. */
	const imbrique = creerCarteRacines([
		{ id: "Vault", name: "Vault", path: "C:/V", vault: true },
		{ id: "Cours", name: "Cours", path: "C:/V/Cours", vault: false },
	]);
	r.check("la racine la plus longue gagne",
		imbrique.depuisAbsolu("C:/V/Cours/ch1.md"), "Cours/ch1.md");

	/* Le journal est sous la racine, au même endroit qu'elle soit un vault ou
	   non — contrairement aux résultats. */
	const hr = carte.hostRoots();
	r.check("le journal de chaque racine", hr.map(h => h.reviewLog),
		["Efrei/.neo-quiz/review-log.jsonl", "Perso/.neo-quiz/review-log.jsonl"]);
	r.check("l'ancien journal est celui du greffon", hr[0].legacyReviewLog,
		"Efrei/.obsidian/plugins/quiz-blocks/review-log.jsonl");
	/* `index.ts` ne fait que `defaultRoot() { return carte.hostRoots()[0]; }` —
	   non chargeable ici (il tire MathLive), donc éprouvé par équivalence sur
	   `carte`, la seule logique derrière ce membre. */
	r.check("defaultRoot() est roots()[0]", hr[0], carte.hostRoots()[0]);

	/* RÈGLE SANS FILET (revue 1) : aucun cas n'éprouvait `resultsDirFor` —
	   une erreur y écrirait les résultats d'un quiz du dossier B dans le
	   dossier A, ou dans un `.obsidian/` fantôme hors d'un vault. Réutilise
	   `carte` (Efrei = vault, Perso = pas un vault). */
	r.check("resultsDirFor dans un vault écrit où le greffon écrit déjà",
		resultsDirFor(carte, "Efrei/Cours/x.md"), "Efrei/.obsidian/quiz-blocks-results");
	r.check("resultsDirFor hors vault écrit sous .neo-quiz",
		resultsDirFor(carte, "Perso/Cours/x.md"), "Perso/.neo-quiz/results");
	/* Une racine INCONNUE (chemin hors de toute racine ouverte) ne doit pas
	   fabriquer un dossier préfixé n'importe comment : elle retombe sur le
	   sous-chemin nu, sans préfixe — jamais `undefined/…`. */
	r.check("resultsDirFor d'une racine inconnue retombe sur le sous-chemin nu",
		resultsDirFor(carte, "Inconnu/x.md"), ".neo-quiz/results");

	/* ── le chemin d'une pièce jointe ──
	   PURE comme `resultsDirFor`, et extraite ici pour la même raison : le
	   module qui construit `paths` (`./index.ts`) importe MathLive et Tauri,
	   qu'esbuild ne charge pas hors de la fenêtre. Écrite là-bas, cette logique
	   n'aurait AUCUN cas ; le test d'existence est donc un PARAMÈTRE, et ces
	   cas décrivent un disque sans toucher au vrai. */
	const presents = new Set(["Efrei/Cours/schema.png"]);
	const existe = async (c) => presents.has(c);

	/* MÊME DOSSIER QUE LA NOTE : l'application n'a pas de réglage « dossier des
	   pièces jointes » et n'en invente pas un. Ranger à la racine du dossier
	   ouvert casserait le lien au premier déplacement du dossier de quiz. */
	r.check("une pièce jointe se range à côté de la note",
		await attachmentPathFor(existe, "Pasted image 1.png", "Efrei/Cours/reseau.md"),
		"Efrei/Cours/Pasted image 1.png");
	r.check("un nom déjà pris est numéroté, jamais écrasé",
		await attachmentPathFor(existe, "schema.png", "Efrei/Cours/reseau.md"),
		"Efrei/Cours/schema-2.png");

	/* LE cas de la course, et le contrat le tranche dans l'autre sens : l'hôte
	   NE RÉSERVE PAS. Deux demandes coup sur coup rendent le MÊME chemin tant
	   que rien n'est écrit, et c'est à l'appelant de réserver
	   (`src/unique-path.ts`) — exactement ce que fait Obsidian, dont
	   `getAvailablePathForAttachment` déduplique contre ce qui EXISTE sans rien
	   retenir. Le contraire coûterait cher et le défaut serait invisible ici :
	   `reserveFreePath` réserve AVANT son premier `await`, donc l'appelant qui
	   réserve à son tour le chemin rendu le trouverait déjà pris — par NOUS —
	   et sauterait au suivant. Chaque image collée sortirait en
	   « Pasted image ….-2.png », puis « -3-2 », et le nom de base resterait
	   brûlé pour la session sans jamais être écrit. */
	const premier = await attachmentPathFor(existe, "capture.png", "Efrei/Cours/reseau.md");
	const second = await attachmentPathFor(existe, "capture.png", "Efrei/Cours/reseau.md");
	r.check("deux demandes coup sur coup rendent le MÊME chemin : l'hôte ne réserve pas",
		[premier, second], ["Efrei/Cours/capture.png", "Efrei/Cours/capture.png"]);
	/* Le corollaire, et il est nécessaire : la déduplication existe TOUJOURS,
	   elle se fait seulement contre le DISQUE. Sans ce cas, un
	   `attachmentPathFor` qui rendrait `name` sans jamais tester l'existence
	   passerait le cas ci-dessus. */
	presents.add("Efrei/Cours/capture.png");
	r.check("… mais une fois le fichier écrit, le suivant est numéroté",
		await attachmentPathFor(existe, "capture.png", "Efrei/Cours/reseau.md"),
		"Efrei/Cours/capture-2.png");

	/* Une note posée à la racine de son dossier : la pièce jointe reste DANS la
	   racine. Un chemin sans son premier segment sortirait des dossiers ouverts
	   et `abs()` le rejetterait — sans que rien n'explique pourquoi. */
	r.check("une note à la racine garde sa pièce jointe dans la racine",
		await attachmentPathFor(existe, "img.png", "Efrei/reseau.md"), "Efrei/img.png");

	/* Un nom SANS extension, dans un dossier qui porte un point : couper au
	   dernier point du CHEMIN ENTIER rendrait « Efrei/Cours-2.B2/notes », c'est-
	   à-dire un AUTRE dossier — le fichier partirait à côté au lieu d'être
	   numéroté. */
	presents.add("Efrei/Cours.B2/notes");
	r.check("un nom sans extension ne coupe pas au point d'un dossier",
		await attachmentPathFor(existe, "notes", "Efrei/Cours.B2/reseau.md"),
		"Efrei/Cours.B2/notes-2");
	/* Même règle que `toHostFile` : un point de TÊTE de nom n'est pas une
	   extension, sinon « .gitignore » se numéroterait en « -2.gitignore ». */
	r.check("un point de tête de nom n'est pas une extension",
		couperExtension("Efrei/Cours/.gitignore"), { base: "Efrei/Cours/.gitignore", ext: "" });

	/* SANS note d'accueil — la DIVERGENCE que le contrat nomme, (l'ancien hôte Obsidian retombait sur son fichier ACTIF) : ici la
	   fenêtre n'en a pas et REJETTE.
	   Ce que ce cas empêche : choisir une racine par défaut parmi les dix
	   ouvertes. L'image partirait dans une racine, la note dans une autre, et la
	   résolution de liens — BORNÉE à sa racine — ne la retrouverait jamais. Une
	   image perdue en silence coûte plus cher qu'un refus nommé.
	   La CAUSE est éprouvée, pas seulement le rejet : `attachmentPathFor` peut
	   lever pour dix raisons, et un cas qui accepte n'importe quelle exception
	   resterait vert le jour où elle lèverait sur une faute de frappe. */
	let sansNote = null;
	try {
		await attachmentPathFor(existe, "capture.png", "reseau.md");
	} catch (e) {
		sansNote = String(e.message);
	}
	r.check("sans note d'accueil, la fenêtre rejette en nommant la cause",
		sansNote && sansNote.includes("pièce jointe sans note d'accueil"), true);
	/* Et `sourcePath` absent tout court, pas seulement sans dossier : c'est la
	   forme que prend l'appel de la page « Générer » (`QuizDraft.file === null`),
	   celle qu'un appelant atteindra pour de vrai. */
	let aucuneNote = null;
	try {
		await attachmentPathFor(existe, "capture.png");
	} catch (e) {
		aucuneNote = String(e.message);
	}
	r.check("… et un sourcePath absent rejette de la même façon",
		aucuneNote && aucuneNote.includes("aucune note"), true);

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ createWindowsLinks }) => {
	const r = makeReporter("Hôte Windows — resourceUrl");

	/* PLUS AUCUN DOUBLE ICI depuis la tâche 4. `convertFileSrc` de Tauri lisait
	   `window.__TAURI_INTERNALS__` et il fallait le doubler, sans quoi chaque
	   appel jetait et `resourceUrl` rendait `null` partout — un vert qui ne
	   prouvait rien. `urlDeRessource` (`apps/windows/electron/ressources.ts`)
	   est une pure fonction du chemin : rien à installer, et l'URL attendue est
	   celle que le protocole de `electron/main.ts` sert pour de bon. Ce qui est
	   ÉPROUVÉ ici reste la RÉSOLUTION qui précède la conversion. */
	{
		/* Une seule racine, « Quiz » : les chemins du contrat portent quand
		   même son préfixe (l'hôte Windows préfixe TOUJOURS, même à un seul
		   dossier — seul le greffon a un identifiant vide). L'INDEX contient
		   toujours des chemins PRÉFIXÉS (c'est ce que produit réellement
		   `createWindowsIndex`) ; les LIENS passés à `resourceUrl`/`resolve`,
		   eux, imitent ce qu'une note écrit — jamais préfixés. Confondre les
		   deux dans un même test masquerait la régression ci-dessous. */
		const fichiers = [
			f("Quiz/Autre/schema.png", "png"),
			f("Quiz/Cours/reseau.md", "md"),
			f("Quiz/Cours/Images/schema.png", "png"),
			f("Quiz/Autre/ch1.md", "md"),
			f("Quiz/Cours/ch1.md", "md"),
		];
		const index = {
			all: () => fichiers,
			get: (p) => fichiers.find(x => x.path === p) ?? null,
			apply: () => undefined,
		};
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		const links = createWindowsLinks(carte, index);

		/* « RÉSOUT puis convertit » (src/host/types.ts) : un chemin DÉJÀ connu
		   de l'index — le `.path` d'un `HostFile` déjà résolu, JAMAIS ce qu'une
		   note écrit elle-même — donne une URL d'asset sur son chemin ABSOLU,
		   par le chemin RAPIDE (`index.get`), sans passer par la résolution. */
		r.check("resourceUrl d'un HostFile (déjà un chemin du contrat) donne l'URL de ressource absolue",
			links.resourceUrl(f("Quiz/Cours/reseau.md", "md")), "app://neo-res/D:/Quiz/Cours/reseau.md");

		/* RÉGRESSION DU PREMIER TOUR DE REVUE, ici rétablie : le tour précédent
		   avait remplacé ce cas par un lien DÉJÀ PRÉFIXÉ (« Quiz/Autre/
		   schema.png »), qui ne passe JAMAIS par la résolution (il matche
		   `index.get` directement) — masquant que l'étape 1 de
		   `resolveDansIndex` (chemin exact) ne matche plus JAMAIS un lien
		   ÉCRIT COMME DANS UNE NOTE (sans préfixe), une fois l'index préfixé.
		   Sans la conversion vers l'espace du contrat (`versContrat`, dans
		   `links.ts`), ce cas retombait sur la recherche par NOM et rendait
		   l'homonyme « Cours/Images/schema.png » — plus proche par PROXIMITÉ
		   de dossier de la note citante que le fichier réellement désigné,
		   perdant la règle n°1 : « le fichier explicitement désigné gagne
		   toujours ». */
		r.check("un chemin exact écrit SANS préfixe (comme dans une note) gagne sur un homonyme plus proche",
			links.resourceUrl("Autre/schema.png", "Quiz/Cours/reseau.md"), "app://neo-res/D:/Quiz/Autre/schema.png");
		/* Même régression, à l'étape 2 (extension implicite) : sans la
		   conversion, « Autre/ch1 » complète son extension en espace NU
		   (« Autre/ch1.md », absent d'un index préfixé), échoue, et retombe
		   sur l'homonyme « Cours/ch1.md », plus proche par proximité. */
		r.check("une extension implicite se complète dans l'espace du contrat (lien sans préfixe)",
			links.resourceUrl("Autre/ch1", "Quiz/Cours/reseau.md"), "app://neo-res/D:/Quiz/Autre/ch1.md");

		/* Un NOM NU passe par la résolution par nom, comme `resolve` : c'est ce
		   qui distingue « résout puis convertit » d'un simple changement de
		   préfixe, et c'est la moitié que l'hôte Obsidian a dû rejoindre. */
		r.check("resourceUrl d'un nom nu passe par la résolution par nom",
			links.resourceUrl("reseau.md"), "app://neo-res/D:/Quiz/Cours/reseau.md");
		/* `null`, JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image. L'index fait AUTORITÉ — une URL vers un fichier
		   qu'il ne connaît pas pointerait hors du dossier autorisé. */
		r.check("resourceUrl d'un chemin inconnu rend null",
			links.resourceUrl("Nulle/part/inexistant.png"), null);
		r.check("resourceUrl d'un chemin vide rend null, pas \"\"",
			links.resourceUrl("   "), null);
		/* `fromPath` BORNE la résolution : sans lui, un nom nu tombe sur
		   l'homonyme le plus proche de la RACINE, pas de la note citante. */
		r.check("resourceUrl passe la note citante à la résolution par nom",
			links.resourceUrl("schema.png", "Quiz/Cours/reseau.md"), "app://neo-res/D:/Quiz/Cours/Images/schema.png");
	}

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ createWindowsLinks }) => {
	const r = makeReporter("Hôte Windows — liens bornés aux racines");

	/* DEUX racines, chacune avec un fichier NOMMÉ PAREIL. La borne
	   (`dansLaRacineDe`, dans links.ts) doit empêcher un homonyme de l'une de
	   répondre pour une note de l'autre — exactement comme un wikilink
	   Obsidian ne sort pas du vault. */
	const fichiers = [
		f("Quiz/schema.png", "png"),
		f("Quiz/ailleurs.png", "png"),
		f("Perso/notes.md", "md"),
		f("Perso/img/schema.png", "png"),
	];
	const index = {
		all: () => fichiers,
		get: (p) => fichiers.find(x => x.path === p) ?? null,
		apply: () => undefined,
	};
	const carte = creerCarteRacines([
		{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false },
		{ id: "Perso", name: "Perso", path: "D:/Notes", vault: false },
	]);
	const links = createWindowsLinks(carte, index);

	/* Un homonyme d'une AUTRE racine ne doit jamais gagner : sous Obsidian un
	   lien ne sort pas du vault, et ici il ne sort pas de son dossier. */
	r.check("la résolution par nom ne franchit pas les racines",
		links.resolve("schema.png", "Perso/notes.md")?.path, "Perso/img/schema.png");

	/* LE CAS RÉELLEMENT DISCRIMINANT pour la borne : « schema.png » existe
	   dans les DEUX racines, et le tri par proximité de `resolveDansIndex`
	   fait déjà gagner le fichier de la bonne racine tout seul (son premier
	   segment de chemin, l'identifiant de racine, est commun avec celui de la
	   note citante — un homonyme d'ailleurs ne partage jamais ce segment).
	   Le cas ci-dessus resterait donc VERT même sans `dansLaRacineDe`. Ici,
	   « ailleurs.png » n'existe QUE dans « Quiz » : sans la borne,
	   `resolveDansIndex` chercherait dans TOUT l'index, le trouverait, et le
	   rendrait pour une note de « Perso » qui n'a rien de ce nom — exactement
	   la fuite que la borne existe pour empêcher. */
	r.check("un homonyme d'une autre racine ne comble pas une absence dans la racine de la note",
		links.resolve("ailleurs.png", "Perso/notes.md"), null);

	r.done();
});

/**
 * LE DOUBLE DU PONT — `window.neo`, et rien d'autre.
 *
 * Ce que le rendu peut toucher tient désormais en un seul objet : le pont posé
 * par le préchargement (`apps/windows/electron/pont.ts`). Doubler CE point-là,
 * et pas les primitives qui vivent derrière, laisse sous test tout ce qui est à
 * nous — la traduction chemin du contrat ↔ chemin absolu, le rejeu de
 * `process`, le recalage du miroir sur le `mtime` que chaque écriture REND.
 * C'est le même patron que le double de `window.__TAURI_INTERNALS__` qu'il
 * remplace, en beaucoup plus simple : quinze méthodes nommées au lieu d'un
 * `invoke` qui décodait des en-têtes.
 *
 * LES CHEMINS VUS ICI SONT ABSOLUS. C'est l'invariant du pont, et c'est
 * précisément ce qu'un cas doit pouvoir surprendre : un hôte qui passerait le
 * chemin du CONTRAT (« Quiz/Cours/ch1.md ») au lieu de l'absolu
 * (« D:/Quiz/Cours/ch1.md ») écrirait dans un fichier qui n'existe pas, et le
 * principal le refuserait à l'exécution seulement.
 *
 * Le disque est un `Map` d'octets : `writeBinary` doit pouvoir être surpris à
 * écrire tout un tampon là où on ne lui a donné qu'une vue. Les DATES avancent
 * à chaque écriture, comme un vrai disque — une date figée rendrait le groupe
 * « miroir recalé » vert quoi qu'on casse.
 *
 * `writeBinary` RECOPIE la vue (`new Uint8Array(donnees)`), exactement comme le
 * préchargement réel le fait avant l'IPC : c'est ce qui rend le cas « les
 * octets de la vue, pas ceux du tampon » discriminant ici aussi.
 *
 * LE PÉRIMÈTRE, pour les trois canaux nés à la tranche 5 (`listerDossier`,
 * `statEntree`, `readBinary`, qui servent `HostFs.listDir` et
 * `HostFs.externe`) : le vrai principal les BORNE comme tout canal
 * `fichiers.*` (`canaux.ts`, `perimetre.borner`), et c'est ce rejet, avec son
 * message, que l'hôte du rendu doit traduire en `[]`/`null` pour `list` et
 * `stat`, et laisser remonter pour `read`/`readBinary`. Le double le reproduit
 * sur ces trois canaux et sur `read`, les quatre qu'`externe` emploie : les
 * autres ne sont exercés qu'avec des chemins que la carte des racines a déjà
 * bornés côté rendu. `perimetre` est
 * la liste des dossiers ouverts, absolus ; `null` ne borne rien (les groupes
 * antérieurs à la tranche 5).
 *
 * @param fichiers état initial du disque, `{ "<chemin absolu>": "<texte>" }`
 * @param perimetre les dossiers ouverts, absolus — ou `null`
 */
function installerPont(fichiers = {}, perimetre = null) {
	const precedent = globalThis.window;
	const encodeur = new TextEncoder();
	const decodeur = new TextDecoder();
	const disque = new Map(Object.entries(fichiers).map(([p, t]) => [p, encodeur.encode(t)]));
	const dossiers = new Set();
	const journal = [];
	/* Le rappel qu'un `surTerminalPose` a déposé : le test le déclenche pour
	   jouer « la fenêtre du terminal est posée ». */
	let poseDuTerminal = null;
	/* Le rappel qu'un `surCachesCli` a déposé : joue « Claude Code vient de
	   réécrire son catalogue ». */
	let cachesCli = null;
	const dates = new Map([...disque.keys()].map(p => [p, 1000]));
	const toucher = (p) => {
		dates.set(p, (dates.get(p) ?? 1000) + 5000);
		return { mtime: dates.get(p) };
	};
	/* Le vrai principal REJETTE sur un chemin absent (`fichiers.read`) : sans ce
	   jet, un `process` qui inventerait une chaîne vide passerait inaperçu. */
	const lire = (p) => {
		const octets = disque.get(p);
		if (!octets) throw new Error("ENOENT: " + p);
		return decodeur.decode(octets);
	};
	/* Le rejet du vrai `borner` (`perimetre.ts`), même message : un chemin qui
	   n'est sous aucun dossier ouvert ne passe pas. Insensible à la casse,
	   comme la carte des racines et comme Windows. */
	const borner = (p) => {
		if (perimetre === null) return;
		const bas = String(p).toLowerCase();
		if (!perimetre.some(r => bas === r.toLowerCase() || bas.startsWith(r.toLowerCase() + "/"))) {
			throw new Error("chemin hors des dossiers ouverts : " + p);
		}
	};
	const ecrireTexte = (nom, p, contenu) => {
		journal.push([nom, p, contenu]);
		disque.set(p, encodeur.encode(contenu));
		return toucher(p);
	};

	/** Les rappels que `surveiller` a posés — de quoi POUSSER un événement
	    depuis le « principal », comme le fait `webContents.send`. */
	const abonnes = [];

	const neo = {
		async demarrer(racines) {
			journal.push(["demarrer", ...racines]);
		},
		fichiers: {
			async read(p) { borner(p); return lire(p); },
			async readCached(p) { return lire(p); },
			async write(p, contenu) { return ecrireTexte("write", p, String(contenu)); },
			async lirePourEcriture(p) {
				return { contenu: lire(p), mtime: dates.get(p) ?? 1000 };
			},
			/* La comparaison porte sur le CONTENU, comme le vrai gestionnaire
			   (`canaux.ts`) : `null` n'est pas une erreur, c'est « le fichier a
			   changé, rejoue ton rappel ». */
			async ecrireSiInchange(p, lu, contenu) {
				if (lire(p) !== lu) return null;
				return ecrireTexte("write", p, String(contenu));
			},
			async writeBinary(p, donnees) {
				journal.push(["writeBinary", p, donnees.byteLength]);
				disque.set(p, new Uint8Array(donnees));
				return toucher(p);
			},
			async append(p, contenu) {
				const avant = disque.get(p) ?? new Uint8Array();
				const ajout = encodeur.encode(String(contenu));
				const total = new Uint8Array(avant.length + ajout.length);
				total.set(avant);
				total.set(ajout, avant.length);
				journal.push(["append", p, String(contenu)]);
				disque.set(p, total);
				return toucher(p);
			},
			async exists(p) { return disque.has(p) || dossiers.has(p); },
			async mkdirs(p) { journal.push(["mkdirs", p]); dossiers.add(p); },
			/* Le principal compose `<racine>/.trash/…`, numérote l'homonyme et
			   déplace : RIEN de tout cela n'est plus dans le rendu, et c'est
			   `npm run check:electron-fs` qui l'éprouve (cas 7 et 8). Ici, on ne
			   retient QUE ce que le rendu a décidé : le chemin absolu, et la
			   racine dont il relève. */
			async trash(p, racine) { journal.push(["trash", p, racine]); disque.delete(p); },
			async list(dossier) {
				const prefixe = dossier + "/";
				return [...disque.keys()].filter(p => p.startsWith(prefixe) && !p.slice(prefixe.length).includes("/"));
			},
			async remove(p) { journal.push(["remove", p]); disque.delete(p); },
			/* Moves the file, or every file under a folder (a staged import moves
			   a hidden folder to its visible name). */
			async rename(de, vers) {
				journal.push(["rename", de, vers]);
				for (const k of [...disque.keys()]) {
					if (k === de) { disque.set(vers, disque.get(k)); disque.delete(k); }
					else if (k.startsWith(de + "/")) { disque.set(vers + k.slice(de.length), disque.get(k)); disque.delete(k); }
				}
			},
			async stat(p) { return disque.has(p) ? { mtime: dates.get(p) ?? 1000 } : null; },
			/* Les trois canaux de la tranche 5, BORNÉS comme `read` (voir l'en-tête). Un
			   dossier est ce qui a au moins un descendant sur le disque, ou ce que
			   `mkdirs` a créé. `listerDossier` rend des NOMS avec leur type,
			   jamais des chemins : c'est la règle du vrai canal, et c'est ce qui
			   oblige le rendu à recomposer — contrat ou absolu — lui-même. */
			async listerDossier(dossier) {
				journal.push(["listerDossier", dossier]);
				borner(dossier);
				const prefixe = dossier + "/";
				const noms = new Map();
				for (const p of [...disque.keys(), ...dossiers]) {
					if (!p.startsWith(prefixe)) continue;
					const reste = p.slice(prefixe.length);
					const nom = reste.split("/")[0];
					if (!nom) continue;
					noms.set(nom, noms.get(nom) || reste.includes("/") || dossiers.has(p));
				}
				return [...noms].map(([name, isFolder]) => ({ name, isFolder }));
			},
			async statEntree(p) {
				journal.push(["statEntree", p]);
				borner(p);
				if (disque.has(p)) return { isFile: true, mtimeMs: dates.get(p) ?? 1000 };
				const estDossier = dossiers.has(p) || [...disque.keys()].some(k => k.startsWith(p + "/"));
				return estDossier ? { isFile: false, mtimeMs: 1000 } : null;
			},
			async readBinary(p) {
				journal.push(["readBinary", p]);
				borner(p);
				const octets = disque.get(p);
				if (!octets) throw new Error("ENOENT: " + p);
				return new Uint8Array(octets);
			},
			async liste(racine) {
				/* JOURNALISÉE, comme `surveiller` : c'est la COMPARAISON des deux
				   places dans le journal qui prouve l'ordre, et rien d'autre ne
				   peut le faire — un abonnement pris après le parcours existe
				   tout autant quand le cas l'observe. */
				journal.push(["liste", racine]);
				const prefixe = racine + "/";
				return [...disque.keys()]
					.filter(p => p.startsWith(prefixe))
					.map(p => ({ chemin: p, mtime: dates.get(p) ?? 1000 }));
			},
		},
		async surveiller(onEvenement) {
			/* JOURNALISÉ, et c'est le seul moyen de prouver l'ORDRE : un
			   abonnement pris APRÈS le parcours existerait tout autant au moment
			   où le cas l'observe. */
			journal.push(["surveiller"]);
			abonnes.push(onEvenement);
			return () => {
				const i = abonnes.indexOf(onEvenement);
				if (i >= 0) abonnes.splice(i, 1);
			};
		},
		dialogue: { async choisirDossier() { return null; } },
		reglages: {
			async lire() { return undefined; },
			async ecrire() {},
			async supprimer() {},
		},
		systeme: {
			async ouvrir(p) { journal.push(["ouvrir", p]); return true; },
			async vaultsObsidian() { return []; },
			async dossierDefaut() { return "C:/Neo Quiz"; },
			async choisirFichiers(kind) { journal.push(["systeme.choisirFichiers", kind]); return ["C:/tmp/choisi.pdf"]; },
		},
		/* Le RÉSEAU du pont, journalisé : ce que le rendu a décidé d'envoyer (la
		   requête SANS `signal`, l'identifiant) et ce qu'il annule. La réponse
		   est celle du principal : le rendu n'a rien à en traduire. `fetch`
		   ATTEND `terminer` quand un cas le pose, pour observer l'annulation
		   PENDANT la requête — c'est le seul moment où `annuler` a un sens. */
		reseau: {
			async fetch(req, requeteId) {
				journal.push(["reseau.fetch", req, requeteId]);
				if (reponseReseau.attente) await reponseReseau.attente;
				return reponseReseau.valeur;
			},
			async annuler(requeteId) { journal.push(["reseau.annuler", requeteId]); },
		},
		/* Les CLI du pont, journalisés : ce que le rendu a décidé d'envoyer. Le
		   NOM de l'outil, et rien d'autre — un chemin passé ici serait une
		   lecture disque hors périmètre, et c'est exactement ce que le cas doit
		   pouvoir surprendre. Les réponses sont celles du principal ; le rendu
		   n'a rien à en traduire. */
		processus: {
			/* `run` ATTEND `terminer` quand un cas le pose, pour observer
			   l'annulation PENDANT le lancement — c'est le seul moment où
			   `annuler` a un sens. Et il rend une ENVELOPPE, jamais un rejet :
			   l'IPC perd le `name` d'une erreur jetée, or tout le contrat de
			   `HostProcess.run` tient dans ce nom. */
			async run(spec, requeteId) {
				journal.push(["processus.run", spec, requeteId]);
				if (reponseCli.attente) await reponseCli.attente;
				return reponseCli.valeur;
			},
			async annuler(requeteId) { journal.push(["processus.annuler", requeteId]); },
			async lireCache(tool) {
				journal.push(["processus.lireCache", tool]);
				return { mtimeMs: 1234, json: { models: [] } };
			},
			async ollamaInstalle() { journal.push(["processus.ollamaInstalle"]); return true; },
			async demarrerOllama() { journal.push(["processus.demarrerOllama"]); return true; },
			async openTerminal(...args) { journal.push(["processus.openTerminal", ...args]); return "lance"; },
			surTerminalPose(rappel) { journal.push(["processus.surTerminalPose"]); poseDuTerminal = rappel; return () => journal.push(["processus.surTerminalPose:off"]); },
			surCachesCli(rappel) { journal.push(["processus.surCachesCli"]); cachesCli = rappel; return () => journal.push(["processus.surCachesCli:off"]); },
		},
		fenetre: {
			async surFermeture() {},
			async reduire() {},
			async agrandirOuRestaurer() {},
			async fermer() {},
			async pleinEcran() {},
			async etat() { return { agrandie: false, focus: true, pleinEcran: false }; },
			surEtat: () => () => {},
		},
		affichage: {
			async zoom() {},
			async recharger() {},
			async outilsDev() {},
		},
		/* La mise à jour automatique : le rendu ne fait que s'y abonner ; le
		   contrôle n'a rien à éprouver ici, mais un membre absent ferait
		   mourir le montage de la coquille avant les cas qui comptent. */
		miseAJour: {
			etat: async () => ({ phase: "inactif", auto: true }),
			surEtat: () => () => {},
			verifier: async () => false,
			installer: async () => {},
			reglerAuto: async () => {},
		},
	};
	const reponseReseau = { valeur: { status: 200, body: "ok" }, attente: null };
	const reponseCli = { valeur: { ok: true, stdout: "OUT", stderr: "", code: 0 }, attente: null };

	globalThis.window = { neo };

	return {
		journal,
		date: (p) => dates.get(p) ?? null,
		texte: (p) => (disque.has(p) ? decodeur.decode(disque.get(p)) : null),
		octets: (p) => (disque.has(p) ? [...disque.get(p)] : null),
		ecrire: (p, t) => { disque.set(p, encodeur.encode(t)); toucher(p); },
		/** Pousse un événement du « principal » vers tous les abonnés. */
		emettre: (ev) => { for (const cb of abonnes) cb(ev); },
		/** Joue « la fenêtre du terminal vient d'être posée » : le rappel que
		    le rendu a déposé par `surTerminalPose`. */
		poserTerminal: () => { poseDuTerminal?.(); },
		reecrireCache: (tool) => { cachesCli?.(tool); },
		/** Ce que le prochain `reseau.fetch` rend, et ce qu'il attend avant. */
		reseau: reponseReseau,
		/** Idem pour le prochain `processus.run`. */
		cli: reponseCli,
		retirer() {
			if (precedent === undefined) delete globalThis.window;
			else globalThis.window = precedent;
		},
	};
}

/* LE MOTEUR PDF, statiquement — et par le VRAI module qui le porte.
   `HostPdf` est un membre OPTIONNEL du contrat. La fenêtre ne le portait PAS
   jusqu'au 2026-09-17 (divergence écrite, tranche 5), et ce bloc exigeait
   son ABSENCE : un `pdf:` posé « en attendant » avec un moteur qui ne lit
   rien aurait rendu la page « Générer » acquiesçante et muette. Depuis
   qu'Ahmed a tranché « B pour les PDF », c'est l'inverse qu'il faut tenir :
   le membre EST déclaré, et il vient de `./pdf.ts` — pas d'un objet posé à
   la main dans `index.ts`, où un `extractText` vide repasserait inaperçu.
   L'extraction elle-même s'éprouve avec le vrai moteur dans `check:pdf`.
   STATIQUE parce que `index.ts` importe MathLive, qu'esbuild ne charge pas
   hors de la fenêtre — c'est justement pourquoi `platform.ts`, `roots.ts`
   et `pdf-texte.ts` en ont été extraits. */
{
	const r = makeReporter("Hôte Windows — le moteur PDF (statique)");
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8");
	const nu = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("l'hôte assemblé déclare le membre pdf par createWindowsPdf()", /\bpdf\s*:\s*createWindowsPdf\(\)/.test(nu), true);
	r.check("… importé de ./pdf.ts, le seul module qui charge pdfjs-dist", /import \{ createWindowsPdf \} from "\.\/pdf"/.test(nu), true);
	/* Sans ce troisième cas, renommer la fonction assembleuse viderait les
	   deux premiers de tout sens : ils resteraient verts sur un fichier
	   qu'ils ne reconnaissent plus. */
	r.check("… et c'est bien l'hôte assemblé qui a été lu", nu.includes("export function createWindowsHost("), true);
	r.done();
}

/* LE MEMBRE `video` DE L'HÔTE, statiquement — même raison que le bloc PDF
   ci-dessus (tâche 4 des vidéos YouTube, spec 2026-09-22, § 3.3) : le
   contrat gagne un membre OPTIONNEL, et l'hôte Windows L'IMPLORE du pont
   (`./video.ts`), jamais d'un objet posé à la main dans `index.ts`. */
{
	const r = makeReporter("Hôte Windows — la lecture d'une vidéo (statique)");
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8");
	const nu = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("l'hôte assemblé déclare le membre video par createWindowsVideo(pont)", /\bvideo\s*:\s*createWindowsVideo\(pont\)/.test(nu), true);
	r.check("… importé de ./video", /import \{ createWindowsVideo \} from "\.\/video"/.test(nu), true);
	r.done();
}

/* THE HOST's `code` MEMBER, statically — same reason as the `video` block
   above (task 4 of 2026-09-28-c-cpp-execution, generalising the Python
   exercise, spec 2026-09-23-exercice-python-design.md §3): the contract
   gains an OPTIONAL member, and the Windows host begs it off the bridge
   (`./code.ts`), never an object placed by hand in `index.ts`. */
{
	const r = makeReporter("Windows host — code execution (static)");
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8");
	const nu = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("the assembled host declares the code member via createWindowsCode(pont)", /\bcode\s*:\s*createWindowsCode\(pont\)/.test(nu), true);
	r.check("… imported from ./code", /import \{ createWindowsCode \} from "\.\/code"/.test(nu), true);
	r.done();
}

/* `shell.openExternal` D'UNE CHAÎNE, statiquement — même raison que le bloc
   PDF ci-dessus (`index.ts` importe MathLive par `createWindowsModals`/
   `createWindowsUi`, qu'esbuild ne charge pas hors de la fenêtre : ce module
   ne peut pas être chargé dynamiquement dans ce script, contrairement à
   `fs.ts`, qui porte le cas COMPORTEMENTAL d'`externe.pickFiles` un peu plus
   bas). Une CHAÎNE (un fichier admis par le dialogue natif) doit devenir
   `a` TELLE QUELLE, sans passer par `index.get`/`carte.absolu`, qui ne
   connaissent que les chemins du CONTRAT — leur faire lire un chemin ABSOLU
   le rejetterait comme « pas dans l'index ». */
{
	const r = makeReporter("Hôte Windows — openExternal d'une chaîne (statique)");
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8");
	const nu = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("openExternal traite une CHAÎNE comme un chemin ABSOLU, sans consulter l'index",
		/const a = typeof file === "string" \? file : \(file && index\.get\(file\.path\) \? carte\.absolu\(file\.path\) : null\);/.test(nu),
		true);
	r.done();
}

/* `openUrl` : la garde est PARTAGÉE (`src/host/url.ts`, chargeable) et
   l'appel à `window.open` est STATIQUE (index.ts ne se charge pas hors de
   la fenêtre, voir le bloc précédent). */
await withSrcModule("src/host/url.ts", ({ estUrlHttps }) => {
	const r = makeReporter("Hôte Windows — openUrl");
	r.check("https admis", estUrlHttps("https://claude.ai/new?q=a%20b"), true);
	r.check("http, file, javascript, obsidian, vide, illisible refusés",
		["http://claude.ai/", "file:///C:/x", "javascript:alert(1)", "obsidian://open", "", "pas une url"].map(estUrlHttps),
		[false, false, false, false, false, false]);
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("index.ts garde par estUrlHttps puis ouvre par window.open en _blank noopener",
		/if \(!estUrlHttps\(url\)\) return false;\s*window\.open\(url, "_blank", "noopener"\);\s*return true;/.test(source), true);
	r.done();
});

await withSrcModule("apps/windows/src/host/fs.ts", async ({ createWindowsFs }) => {
	const r = makeReporter("Hôte Windows — process, octets et corbeille");
	const pont = installerPont({
		"D:/Quiz/Cours/ch1.md": "avant",
		"D:/Quiz/Cours/notes.txt": "autre",
		// Une pièce jointe du vault, pour `readBinary` (chemin du contrat).
		"D:/Quiz/Cours/schema.png": "png",
	});

	try {
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		/* L'index ne sert qu'à `listMarkdown`/`getFile`, qu'aucun cas de ce
		   groupe n'exerce : tout ce qui suit passe par le pont, jamais par le
		   catalogue. */
		const index = { all: () => [], get: () => null, apply: () => undefined };
		const fs = createWindowsFs(carte, index);

		/* ── le chemin ABSOLU, et lui seul, franchit le pont ── */

		/* L'INVARIANT du pont (`pont.ts`) : le rendu tient `CarteRacines`, le
		   principal ne connaît que l'absolu. Un hôte qui passerait le chemin du
		   contrat écrirait dans un fichier inexistant, et rien ici ne le dirait
		   sans ce cas — les autres cas du groupe liraient alors ce qu'ils
		   viennent d'écrire, sous le mauvais nom, et resteraient verts. */
		await fs.write("Quiz/Cours/ch1.md", "par le pont");
		r.check("une écriture passe au pont le chemin ABSOLU, jamais celui du contrat",
			pont.journal.at(-1), ["write", "D:/Quiz/Cours/ch1.md", "par le pont"]);
		/* La CAUSE, pas le seul rejet : `abs()` garde CHAQUE appel de ce fichier,
		   et un cas qui accepterait n'importe quelle exception resterait vert le
		   jour où la fonction mourrait d'une faute de frappe. */
		let horsRacineLecture = null;
		try {
			await fs.read("Inconnu/x.md");
		} catch (e) {
			horsRacineLecture = String(e.message);
		}
		r.check("une lecture hors des dossiers ouverts rejette en nommant la cause, sans toucher au pont",
			[horsRacineLecture && horsRacineLecture.includes("chemin hors des dossiers ouverts"),
				pont.journal.at(-1)[0]],
			[true, "write"]);

		/* ── process, EN DEUX TEMPS ── */

		/* Le rappel voit le contenu ACTUEL, et c'est ce qu'il REND qui part sur
		   le disque — un hôte qui ignorerait son retour réécrirait « avant ». */
		await fs.process("Quiz/Cours/ch1.md", (c) => c + " + ajout");
		r.check("process écrit ce que le rappel rend, à partir de ce qui était là",
			pont.journal.at(-1), ["write", "D:/Quiz/Cours/ch1.md", "par le pont + ajout"]);

		/* LE REJEU, et c'est la moitié que l'ancien hôte ne tenait PAS : il
		   lisait puis écrivait sans rien comparer, donc une modification arrivée
		   entre les deux était écrasée en silence. Ici le principal REFUSE
		   l'écriture quand le contenu a changé (`null`), et le rendu doit
		   relire et rejouer — le contrat l'autorise en toutes lettres (« Le
		   rappel peut être REJOUÉ… C'est la DERNIÈRE invocation qui fait foi »)
		   et `detail-io.ts` en dépend.
		   Le rappel écrit lui-même sous le pied du premier essai : c'est la
		   seule façon de provoquer le refus à coup sûr, sans course. */
		const vus = [];
		let premier = true;
		await fs.process("Quiz/Cours/ch1.md", (c) => {
			vus.push(c);
			if (premier) {
				premier = false;
				// Quelqu'un d'autre écrit entre la lecture et l'écriture.
				pont.ecrire("D:/Quiz/Cours/ch1.md", "modifié dehors");
			}
			return c + " !";
		});
		r.check("process REJOUE son rappel quand le fichier a changé entre la lecture et l'écriture",
			vus, ["par le pont + ajout", "modifié dehors"]);
		r.check("… et c'est la DERNIÈRE invocation qui fait foi",
			pont.texte("D:/Quiz/Cours/ch1.md"), "modifié dehors !");

		/* BORNÉ. Un fichier qu'un autre programme réécrit en continu ferait
		   boucler `process` sans fin, et la fenêtre se figerait sans un mot :
		   l'abandon est bruyant, et il nomme le fichier. */
		let sansFin = null;
		try {
			await fs.process("Quiz/Cours/notes.txt", (c) => {
				pont.ecrire("D:/Quiz/Cours/notes.txt", c + ".");
				return "jamais écrit";
			});
		} catch (e) {
			sansFin = String(e.message);
		}
		r.check("process abandonne en nommant le fichier plutôt que de boucler sans fin",
			sansFin && sansFin.includes("Quiz/Cours/notes.txt"), true);

		/* ── readBinary (chemin du CONTRAT) : le MÊME canal borné qu'`externe
		      .readBinary`, sur un chemin converti ici — le rendu est le seul
		      endroit qui sait convertir contrat → absolu. ── */
		/* Le rejet devient une VALEUR : sans ça, un hôte qui passerait le chemin
		   du CONTRAT au pont ferait MOURIR le groupe (le faux principal rejette
		   sur un chemin absent) au lieu de le faire rougir — et la mort
		   masquerait tous les cas suivants. */
		const lu = await fs.readBinary("Quiz/Cours/schema.png").then(o => [...o], e => "REJET : " + e.message);
		r.check("readBinary traverse le pont avec le chemin ABSOLU, et rend les octets",
			{ octets: lu, appel: pont.journal.at(-1) },
			{ octets: [...new TextEncoder().encode("png")], appel: ["readBinary", "D:/Quiz/Cours/schema.png"] });

		/* ── writeBinary ── */

		/* La VUE est PARTIELLE, sur un tampon plus grand qu'elle : un cas qui
		   vérifierait seulement l'appel resterait VERT avec `data.buffer` nu,
		   puisque pour une vue construite sur un tampon exact les deux formes
		   coïncident. C'est la LONGUEUR et le CONTENU qui les séparent. */
		const tampon = new ArrayBuffer(12);
		new Uint8Array(tampon).set([9, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8]);
		await fs.writeBinary("Quiz/Cours/vue.png", new Uint8Array(tampon, 4, 4));
		r.check("writeBinary passe au pont la vue, et n'en donne que la longueur qui est la sienne",
			pont.journal.at(-1), ["writeBinary", "D:/Quiz/Cours/vue.png", 4]);
		r.check("… et ce sont ses octets, pas ceux du tampon",
			pont.octets("D:/Quiz/Cours/vue.png"), [1, 2, 3, 4]);

		/* ── trash ── */

		/* Le rendu ne compose plus `<racine>/.trash/…` : c'est le principal qui
		   le fait (`electron/fichiers.ts`, éprouvé par `npm run
		   check:electron-fs`). Ce qui reste à sa charge, et que ce cas garde :
		   passer le chemin ABSOLU et LA RACINE DONT IL RELÈVE. Une autre racine
		   ferait fabriquer au principal un `../../…` — un déplacement vers
		   n'importe où, que sa garde refuse justement parce que le rendu peut se
		   tromper ici. */
		await fs.trash("Quiz/Cours/ch1.md");
		r.check("trash passe au principal le chemin absolu ET la racine dont il relève",
			pont.journal.at(-1), ["trash", "D:/Quiz/Cours/ch1.md", "D:/Quiz"]);

		/* Hors des dossiers ouverts : nommer la cause plutôt que de fabriquer un
		   chemin absolu plausible, qui échouerait plus loin avec un message
		   incompréhensible. La CAUSE, pas le seul fait de lever. */
		let horsRacine = null;
		try {
			await fs.trash("Inconnu/x.md");
		} catch (e) {
			horsRacine = String(e.message);
		}
		r.check("trash d'un chemin hors des dossiers ouverts rejette en nommant la cause",
			horsRacine && horsRacine.includes("chemin hors des dossiers ouverts"), true);

		/* ── list : le pont rend de l'ABSOLU, le contrat veut du CONTRAT ── */

		/* Le contrat promet des chemins du CONTRAT (`HostFs.list`), et le pont
		   ne rend que de l'absolu : sans la traduction, l'appelant (le journal,
		   qui cherche ses fichiers de conflit) recevrait des chemins qu'aucune
		   de ses lectures ne saurait rouvrir. */
		pont.ecrire("D:/Quiz/Cours/a.md", "a");
		pont.ecrire("D:/Quiz/Cours/b.md", "b");
		const liste = await fs.list("Quiz/Cours");
		r.check("list rend des chemins du CONTRAT, pas l'absolu que le pont a donné",
			liste.includes("Quiz/Cours/a.md") && liste.includes("Quiz/Cours/b.md"), true);
		r.check("… et aucun chemin absolu ne fuit dans le résultat",
			liste.filter(p => /^[A-Za-z]:/.test(p)), []);
	} finally {
		/* `try/finally` comme les groupes des modales : un groupe qui MEURT sur
		   une exception laisserait `globalThis.window` remplacé pour tous ceux
		   qui suivent. */
		pont.retirer();
	}

	r.done();
});

/**
 * LE SÉLECTEUR « @ » SUR LE CONTRAT (tranche 5, tâche 5) : `listDir`,
 * `listFiles` et les RACINES EXTERNES (`HostFs.externe`), moitié FENÊTRE.
 *
 * Deux natures de chemin traversent le même pont, et c'est ce que chaque cas
 * doit pouvoir surprendre : `listDir` reçoit un chemin du CONTRAT et doit
 * passer l'ABSOLU au pont puis rendre du CONTRAT ; `externe.*` reçoit de
 * l'absolu et le passe TEL QUEL, sans conversion — un hôte qui convertirait
 * une racine externe par la carte des racines la trouverait « hors des
 * dossiers ouverts » à tous les coups, et le sélecteur ne verrait jamais
 * Downloads. Le PÉRIMÈTRE du principal est doublé ici (voir `installerPont`)
 * pour éprouver la seconde promesse du contrat : hors périmètre, `list` et
 * `stat` rendent `[]`/`null`, `read` et `readBinary` rejettent.
 */
await withSrcModule("apps/windows/src/host/fs.ts", async ({ createWindowsFs, buildIndex }) => {
	const r = makeReporter("Hôte Windows — listDir, listFiles et racines externes");
	const pont = installerPont({
		"D:/Quiz/Cours/ch1.md": "avant",
		"D:/Quiz/Cours/schema.png": "png",
		"D:/Quiz/Cours/Sous/td.md": "td",
		"C:/Users/x/Downloads/poly.pdf": "pdf",
		"C:/Users/x/Downloads/Cours/notes.txt": "notes",
	}, ["D:/Quiz", "C:/Users/x/Downloads"]);
	const avertis = [];
	const warnAvant = console.warn;
	console.warn = (...args) => { avertis.push(args.map(String).join(" ")); };

	try {
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		const index = buildIndex([
			{ path: "Quiz/Cours/ch1.md", mtime: 1 },
			{ path: "Quiz/Cours/schema.png", mtime: 0 },
			{ path: "Quiz/Cours/Sous/td.md", mtime: 1 },
		]);
		const fs = createWindowsFs(carte, index);
		/* Un rejet devient une VALEUR : un cas qui mourrait sur `await`
		   masquerait tous les groupes suivants, et la promesse « rend `[]` »
		   se juge précisément sur l'absence de rejet. */
		const tenter = (promesse) => promesse.then(v => v, e => "REJET : " + e.message);

		/* ── listFiles ── */

		r.check("listFiles rend tous les fichiers du miroir, .md ou non",
			fs.listFiles().map(f => f.path).sort(),
			["Quiz/Cours/Sous/td.md", "Quiz/Cours/ch1.md", "Quiz/Cours/schema.png"]);

		/* ── listDir : contrat → absolu → contrat ── */

		const cours = await tenter(fs.listDir("Quiz/Cours"));
		r.check("listDir traverse le pont avec le chemin absolu de la racine",
			[pont.journal.at(-1), Array.isArray(cours)], [["listerDossier", "D:/Quiz/Cours"], true]);
		/* Le pont rend des NOMS ; c'est l'hôte qui recompose le chemin du
		   CONTRAT. Un hôte qui rendrait l'absolu donnerait au sélecteur des
		   chemins qu'aucun `getFile` ne saurait rouvrir. */
		r.check("listDir rend des chemins du CONTRAT avec leur type",
			Array.isArray(cours) ? cours.sort((a, b) => a.name.localeCompare(b.name)) : cours,
			[
				{ name: "ch1.md", path: "Quiz/Cours/ch1.md", isFolder: false },
				{ name: "schema.png", path: "Quiz/Cours/schema.png", isFolder: false },
				{ name: "Sous", path: "Quiz/Cours/Sous", isFolder: true },
			]);
		/* `""` est « la racine » : dans l'application, les dossiers ouverts
		   eux-mêmes. Le pont n'est pas consulté — il n'y a pas de dossier
		   absolu qui les contienne tous. */
		const avant = pont.journal.length;
		r.check("listDir de « » rend les dossiers ouverts, sans toucher au pont",
			[await tenter(fs.listDir("")), pont.journal.length - avant],
			[[{ name: "Quiz", path: "Quiz", isFolder: true }], 0]);
		/* `[]` et NON un rejet (ruling 13) : le sélecteur demande « @Foo/ » à
		   `listDir` avant de savoir si Foo est du vault ou une racine externe —
		   un rejet tuait « @Downloads/ » dans l'application, et toute faute de
		   frappe avec. Le refus est NOMMÉ dans la console, comme pour
		   `externe.list` hors périmètre, sans quoi « Foo est vide » mentirait. */
		avertis.length = 0;
		r.check("listDir hors des dossiers ouverts rend [], nommé dans la console",
			[await tenter(fs.listDir("Inconnu/x")), avertis.some(a => a.includes("Inconnu/x") && a.includes("chemin hors des dossiers ouverts"))],
			[[], true]);

		/* ── externe : l'absolu TEL QUEL, dans le périmètre ── */

		const dl = await tenter(fs.externe.list("C:\\Users\\x\\Downloads\\"));
		r.check("externe.list passe au pont le chemin absolu tel quel, normalisé",
			pont.journal.at(-1), ["listerDossier", "C:/Users/x/Downloads"]);
		r.check("externe.list rend des chemins ABSOLUS avec leur type",
			Array.isArray(dl) ? dl.sort((a, b) => a.name.localeCompare(b.name)) : dl,
			[
				{ name: "Cours", path: "C:/Users/x/Downloads/Cours", isFolder: true },
				{ name: "poly.pdf", path: "C:/Users/x/Downloads/poly.pdf", isFolder: false },
			]);
		r.check("externe.stat distingue fichier et dossier",
			[(await fs.externe.stat("C:/Users/x/Downloads/poly.pdf"))?.isFile,
				(await fs.externe.stat("C:/Users/x/Downloads/Cours"))?.isFile,
				await fs.externe.stat("C:/Users/x/Downloads/rien")],
			[true, false, null]);
		r.check("externe.read lit par le pont", await fs.externe.read("C:/Users/x/Downloads/Cours/notes.txt"), "notes");
		r.check("externe.readBinary rend les octets",
			[...await fs.externe.readBinary("C:/Users/x/Downloads/poly.pdf")], [...new TextEncoder().encode("pdf")]);

		/* Le dialogue natif de fichiers (« Add files ») : une pure DÉLÉGATION au
		   pont, sans rien borner ici — c'est le PRINCIPAL qui admet chaque
		   chemin choisi au périmètre (`autoriserFichier`), voir `canaux.ts`. */
		const avantPick = pont.journal.length;
		r.check("externe.pickFiles rend les chemins admis par le principal",
			await fs.externe.pickFiles("documents"), ["C:/tmp/choisi.pdf"]);
		r.check("… et journalise le kind demandé, tel quel",
			pont.journal.slice(avantPick), [["systeme.choisirFichiers", "documents"]]);

		/* ── externe : HORS périmètre ── */

		/* C'est la promesse qui rend cette porte admissible côté application
		   (`HostFs.externe`, src/host/types.ts) : une racine configurée qui
		   n'est pas un dossier ouvert n'est JAMAIS lue. Le principal rejette ;
		   le rendu en fait une racine vide (`[]`, `null`) pour que le sélecteur
		   s'affiche au lieu de mourir — et le NOMME dans la console, sans quoi
		   « Downloads est vide » serait un mensonge silencieux. */
		avertis.length = 0;
		r.check("externe.list hors périmètre rend []", await tenter(fs.externe.list("E:/Ailleurs")), []);
		r.check("… et nomme la racine refusée dans la console",
			avertis.some(a => a.includes("E:/Ailleurs") && a.includes("chemin hors des dossiers ouverts")), true);
		r.check("externe.stat hors périmètre rend null", await tenter(fs.externe.stat("E:/Ailleurs/x.pdf")), null);
		/* `read` et `readBinary` LAISSENT REMONTER : un appelant qui lit veut
		   savoir, et une chaîne vide attachée au prompt passerait pour un
		   fichier lu. */
		let lectureRejetee = null;
		try { await fs.externe.read("E:/Ailleurs/x.txt"); } catch (e) { lectureRejetee = String(e.message); }
		let octetsRejetes = null;
		try { await fs.externe.readBinary("E:/Ailleurs/x.pdf"); } catch (e) { octetsRejetes = String(e.message); }
		r.check("externe.read et readBinary hors périmètre rejettent en nommant la cause",
			[lectureRejetee?.includes("chemin hors des dossiers ouverts"), octetsRejetes?.includes("chemin hors des dossiers ouverts")],
			[true, true]);
	} finally {
		console.warn = warnAvant;
		pont.retirer();
	}

	r.done();
});

/**
 * LA FRAÎCHEUR APRÈS UNE ÉCRITURE, moitié FENÊTRE.
 *
 * Le contrat (`src/host/types.ts`) promet que `getFile(path)` rend le `mtime`
 * NEUF dès que `write`, `process`, `writeBinary` ou `append` ont rendu la main.
 * C'est la moitié la plus fragile des deux : le greffon refabrique son
 * `HostFile` depuis un `TFile` VIVANT à chaque appel, donc il était frais sans
 * le savoir ; ici, `getFile` lit le MIROIR, une `Map` que seuls le surveillant
 * — DÉBOUNCÉ de 300 ms côté principal — et le recalage mettent à jour. Sans le
 * recalage, un appelant qui relit le `mtime` de sa propre écriture obtenait
 * celui d'AVANT, et `detail-io.ts` en tirait une Notice « modifié dehors »
 * MENSONGÈRE après chaque sauvegarde.
 *
 * CE QUI A CHANGÉ À LA TÂCHE 4 : le `mtime` ne vient plus d'un `stat` que
 * l'hôte ferait lui-même, mais de la valeur que CHAQUE ÉCRITURE DU PONT REND
 * (`Promise<{ mtime }>`, voir `pont.ts`). C'est la même promesse, tenue par un
 * aller-retour de moins — et le double le vérifie de la même façon, en
 * comparant au `mtime` que son disque porte.
 *
 * Un vrai `buildIndex` ici, et non le bouchon inerte du groupe précédent : ce
 * qu'on éprouve est justement ce que le miroir retient.
 */
await withSrcModule("apps/windows/src/host/fs.ts", async ({ createWindowsFs, buildIndex, toHostFile }) => {
	const r = makeReporter("Hôte Windows — l'index recalé après écriture");
	const pont = installerPont({
		"D:/Quiz/Cours/ch1.md": "avant",
		"D:/Quiz/.neo-quiz/review-log.jsonl": "{}",
	});

	try {
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		const index = buildIndex([toHostFile("Quiz/Cours/ch1.md", 1000)]);
		const fs = createWindowsFs(carte, index);
		const mtime = (p) => fs.getFile(p)?.mtime ?? null;

		r.check("avant toute écriture, getFile rend la date de l'index",
			mtime("Quiz/Cours/ch1.md"), 1000);

		/* `process` — celui dont dépend `detail-io.ts`. */
		await fs.process("Quiz/Cours/ch1.md", (c) => c + " + ajout");
		r.check("après process, getFile rend le mtime du DISQUE",
			mtime("Quiz/Cours/ch1.md"), pont.date("D:/Quiz/Cours/ch1.md"));
		r.check("… et ce n'est plus celui d'avant",
			mtime("Quiz/Cours/ch1.md") === 1000, false);

		/* `write` sur un fichier DÉJÀ au catalogue. */
		const avantWrite = mtime("Quiz/Cours/ch1.md");
		await fs.write("Quiz/Cours/ch1.md", "remplacé");
		r.check("après write, getFile rend le mtime du DISQUE",
			mtime("Quiz/Cours/ch1.md"), pont.date("D:/Quiz/Cours/ch1.md"));
		r.check("… et il a avancé", mtime("Quiz/Cours/ch1.md") > avantWrite, true);

		/* `write` sur un fichier NEUF : il doit ENTRER au catalogue. Sans ça,
		   `getFile` d'une note qu'on vient de créer rendrait `null` pendant
		   300 ms — c'est le défaut que la tranche 2.6 avait corrigé côté
		   greffon en passant par `vault.create`. */
		r.check("un fichier neuf est inconnu avant son écriture",
			fs.getFile("Quiz/Cours/neuf.md"), null);
		await fs.write("Quiz/Cours/neuf.md", "contenu");
		r.check("après write, un fichier neuf est AU catalogue",
			fs.getFile("Quiz/Cours/neuf.md")?.basename, "neuf");
		r.check("… avec le mtime du disque",
			mtime("Quiz/Cours/neuf.md"), pont.date("D:/Quiz/Cours/neuf.md"));

		/* `writeBinary` — l'aperçu d'une question relit l'image collée. */
		await fs.writeBinary("Quiz/Cours/img.png", new Uint8Array([1, 2, 3]));
		r.check("après writeBinary, l'image est au catalogue avec sa date",
			mtime("Quiz/Cours/img.png"), pont.date("D:/Quiz/Cours/img.png"));

		/* `append` — la quatrième voie. Une promesse qui saute une des quatre
		   écritures est un piège pire que pas de promesse : un appelant ne peut
		   pas se souvenir de l'exception. */
		const avantAppend = mtime("Quiz/Cours/ch1.md");
		await fs.append("Quiz/Cours/ch1.md", " et encore");
		r.check("après append, getFile rend le mtime du DISQUE",
			mtime("Quiz/Cours/ch1.md"), pont.date("D:/Quiz/Cours/ch1.md"));
		r.check("… et il a avancé", mtime("Quiz/Cours/ch1.md") > avantAppend, true);
		r.check("… l'ajout n'a pas remplacé le contenu",
			pont.texte("D:/Quiz/Cours/ch1.md"), "remplacé et encore");

		/* CE QUE LE RECALAGE NE DOIT PAS FAIRE : faire entrer au catalogue un
		   chemin que le surveillant en écarte. Le journal de révision s'écrit à
		   chaque réponse ; l'inscrire au catalogue par cette porte rouvrirait
		   exactement la divergence que `horsCatalogue` a été extraite pour
		   fermer — deux copies d'un même prédicat avaient déjà divergé ici. */
		await fs.append("Quiz/.neo-quiz/review-log.jsonl", "{}\n");
		/* A STAGED IMPORT: written under a hidden folder (outside the catalogue),
		   then moved by ONE `rename`. The notes must be in the catalogue when
		   `rename` returns (the import's rescan runs at once), and a hidden
		   target must still keep them out. */
		await fs.write("Quiz/.import-abc/Neuf/q.md", "x");
		await fs.writeBinary("Quiz/.import-abc/Neuf/img/a.png", new Uint8Array([1]));
		r.check("under a hidden staging folder, a note is NOT in the catalogue",
			fs.getFile("Quiz/.import-abc/Neuf/q.md"), null);
		await fs.rename("Quiz/.import-abc", "Quiz/Importe");
		r.check("a moved folder: its notes and files are in the catalogue as soon as rename returns",
			[fs.getFile("Quiz/Importe/Neuf/q.md")?.basename, fs.getFile("Quiz/Importe/Neuf/img/a.png") !== null], ["q", true]);
		await fs.rename("Quiz/Importe/Neuf/q.md", "Quiz/Importe/q2.md");
		r.check("a moved single note is in the catalogue under its new path",
			fs.getFile("Quiz/Importe/q2.md")?.basename, "q2");
		await fs.rename("Quiz/Importe/q2.md", "Quiz/.cache/q2.md");
		r.check("a note moved INTO a hidden folder does not enter the catalogue there",
			fs.getFile("Quiz/.cache/q2.md"), null);

		r.check("le journal de révision reste HORS du catalogue",
			fs.getFile("Quiz/.neo-quiz/review-log.jsonl"), null);
		r.check("… et le journal n'a pas fait le voyage jusqu'au catalogue",
			index.all().some(x => x.path.includes(".neo-quiz")), false);
	} finally {
		pont.retirer();
	}

	r.done();
});

/**
 * LE MIROIR — l'hydratation d'abord, la surveillance PLUS TARD sur demande
 * explicite, et la traduction des événements que le principal POUSSE.
 *
 * Groupe NEUF de la tâche 4, retouché par perf-demarrage-surveillant : sous
 * Tauri, l'index se construisait par un parcours que l'hôte faisait
 * LUI-MÊME, et le surveillant lui parlait directement. Ici les deux passent
 * par l'IPC, et deux règles que rien d'autre ne garde en dépendent :
 *
 * — l'ORDRE. `createWindowsIndex` ne fait plus qu'HYDRATER : elle ne
 *   s'abonne plus elle-même au surveillant du principal — c'est
 *   `demarrerSurveillance()`, exposée sur le miroir qu'elle rend, qui le
 *   fait, à l'appel de `main.ts`, une fois la fenêtre montrée (voir l'en-tête
 *   d'`host/fs.ts` : le crawl initial de chokidar tourne dans le même
 *   processus, mono-thread, que l'hydratation, et démarré avant elle il la
 *   retardait). Ce cas prouve les DEUX moitiés : que `createWindowsIndex`,
 *   seule, ne surveille rien, et que `demarrerSurveillance()` le fait — une
 *   seule fois, même appelée deux fois.
 * — la TRADUCTION. Le pont ne parle que d'absolu ; le catalogue ne connaît que
 *   les chemins du contrat, et il n'admet pas les dossiers cachés.
 */
await withSrcModule("apps/windows/src/host/fs.ts", async ({ createWindowsIndex, createWindowsFs }) => {
	const r = makeReporter("Hôte Windows — le miroir de l'index");
	const pont = installerPont({
		"D:/Quiz/Cours/ch1.md": "un",
		"D:/Quiz/Cours/schema.png": "image",
		"D:/Quiz/.neo-quiz/review-log.jsonl": "{}",
	});

	try {
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		const miroir = await createWindowsIndex(carte);

		/* Les racines sont DÉCLARÉES au principal, en absolu, avant tout le
		   reste : sans `demarrer`, `surveiller` et `liste` rejettent tous les
		   deux (« aucune racine déclarée ») et la fenêtre s'ouvrirait sur un
		   catalogue vide sans que rien ne l'explique. */
		r.check("les racines sont déclarées au principal, en chemins absolus",
			pont.journal[0], ["demarrer", "D:/Quiz"]);

		/* L'HYDRATATION : le parcours du principal peuple le miroir, traduit en
		   chemins du contrat. */
		r.check("le parcours hydrate le miroir en chemins du CONTRAT",
			miroir.all().map(x => x.path).sort(), ["Quiz/Cours/ch1.md", "Quiz/Cours/schema.png"]);
		/* Le journal de révision vit sous un dossier caché : il ne doit pas
		   entrer au catalogue, même si le principal le listait — la garde est
		   des DEUX côtés, et deux copies de cette règle avaient déjà divergé. */
		r.check("un chemin hors catalogue n'entre pas au miroir, même listé par le principal",
			miroir.get("Quiz/.neo-quiz/review-log.jsonl"), null);
		r.check("le mtime du parcours est repris tel quel",
			miroir.get("Quiz/Cours/ch1.md")?.mtime, pont.date("D:/Quiz/Cours/ch1.md"));

		/* CRÉER LE MIROIR N'A PAS SURVEILLÉ. `createWindowsIndex`, seule, ne
		   fait que déclarer les racines puis hydrater : le journal du
		   principal ne porte encore aucun `surveiller`, même une fois
		   l'hydratation terminée et le miroir plein — la preuve que la
		   surveillance ne part plus d'ici. */
		r.check("createWindowsIndex hydrate mais ne surveille pas encore",
			pont.journal.map(l => l[0]), ["demarrer", "liste"]);

		/* `demarrerSurveillance()` EST CE QUI DÉCLENCHE `surveiller` — appelée
		   ici comme `main.ts` le fait, APRÈS que tout le reste (l'hydratation
		   y compris) soit terminé. */
		await miroir.demarrerSurveillance();
		r.check("demarrerSurveillance() déclenche surveiller(), et seulement après demarrer/liste",
			pont.journal.map(l => l[0]), ["demarrer", "liste", "surveiller"]);

		/* IDEMPOTENTE : un second appel (un double montage, une relance
		   malheureuse) ne doit pas poser un second abonné IPC — sans quoi
		   chaque événement du principal serait diffusé deux fois au miroir. */
		await miroir.demarrerSurveillance();
		r.check("un second appel ne surveille pas une seconde fois",
			pont.journal.filter(l => l[0] === "surveiller").length, 1);

		/* UN ÉVÉNEMENT POUSSÉ met le miroir à jour, et les abonnés avec. */
		const vus = [];
		miroir.onChange(ev => vus.push(ev.kind + " " + (ev.kind === "delete" ? ev.path : ev.file.path)));
		pont.emettre({ kind: "modify", abs: "D:/Quiz/Cours/ch1.md", mtime: 7777 });
		r.check("un modify poussé met le mtime du miroir à jour",
			miroir.get("Quiz/Cours/ch1.md")?.mtime, 7777);
		pont.emettre({ kind: "create", abs: "D:/Quiz/Cours/neuf.md", mtime: 42 });
		r.check("un create poussé fait entrer le fichier au miroir",
			miroir.get("Quiz/Cours/neuf.md")?.basename, "neuf");
		pont.emettre({ kind: "delete", abs: "D:/Quiz/Cours/neuf.md" });
		r.check("un delete poussé le retire", miroir.get("Quiz/Cours/neuf.md"), null);
		/* L'INDEX D'ABORD, les abonnés ensuite — mais surtout : les abonnés sont
		   prévenus. Un miroir qui se mettrait à jour sans le dire laisserait la
		   liste des quiz telle qu'elle était jusqu'au prochain montage. */
		r.check("les abonnés reçoivent les trois genres, traduits en chemins du contrat",
			vus, ["modify Quiz/Cours/ch1.md", "create Quiz/Cours/neuf.md", "delete Quiz/Cours/neuf.md"]);

		/* LE CRAWL INITIAL DE CHOKIDAR, REJOUÉ SUR UN MIROIR DÉJÀ PLEIN (revue
		   finale de la migration, I3 ; portée mise à jour par
		   perf-demarrage-surveillant). Le principal pousse un `create` par
		   fichier de la racine dès que `demarrerSurveillance()` part
		   (1676 sur `Personal`) — et depuis cette tâche, ce n'est plus une
		   hypothèse : le miroir est TOUJOURS déjà hydraté à cet instant (voir
		   les deux cas ci-dessus). Sans la déduplication sur le `mtime`, chaque
		   `create` de cette rafale deviendrait un `modify` vers un scanner déjà
		   abonné, donc une relecture (`readCached` par IPC + parse) de CHAQUE
		   fichier pour rien. C'est ce que `versContrat` garde : voir son
		   commentaire dans `fs.ts`. Le `mtime` courant du miroir est 7777 (posé
		   par le `modify` ci-dessus) : le rejouer ne doit RIEN émettre — ni aux
		   abonnés, ni au miroir. Puis un `mtime` DIFFÉRENT doit passer, sinon
		   la déduplication avalerait aussi les vrais changements survenus entre
		   l'hydratation et l'appel de `demarrerSurveillance`, et l'inversion de
		   cette tâche ne protégerait plus rien. */
		pont.emettre({ kind: "create", abs: "D:/Quiz/Cours/ch1.md", mtime: 7777 });
		pont.emettre({ kind: "modify", abs: "D:/Quiz/Cours/ch1.md", mtime: 7777 });
		r.check("un événement dont le mtime est déjà celui du miroir n'émet rien",
			vus.length, 3);
		pont.emettre({ kind: "modify", abs: "D:/Quiz/Cours/ch1.md", mtime: 7778 });
		r.check("un événement dont le mtime diffère de celui du miroir passe, lui",
			[vus.length, miroir.get("Quiz/Cours/ch1.md")?.mtime], [4, 7778]);

		/* A NEW note written through HostFs (the shared-folder import) must
		   reach the subscribers. `write` records the new mtime in the index, so
		   the watcher's own `create` (same mtime) is swallowed: unless the
		   write itself announces the create, the scanner never indexes the note
		   and the imported folder stays an empty card until a restart. A
		   `modify` of a known file stays silent (no rescan per autosave). */
		const vusEcriture = [];
		const desabonnerEcriture = miroir.onChange(ev => vusEcriture.push(ev.kind + " " + (ev.kind === "delete" ? ev.path : ev.file.path)));
		await createWindowsFs(carte, miroir).write("Quiz/Cours (2)/importe.md", "x");
		r.check("une note NEUVE écrite par HostFs est annoncée aux abonnés",
			vusEcriture, ["create Quiz/Cours (2)/importe.md"]);
		await createWindowsFs(carte, miroir).write("Quiz/Cours (2)/importe.md", "y");
		r.check("réécrire une note déjà connue n'annonce rien",
			vusEcriture.length, 1);
		/* A staged import's folder move is ANNOUNCED too (the scanner learns the
		   notes from `onChange`, not from the mirror alone). */
		await createWindowsFs(carte, miroir).write("Quiz/.import-xyz/Sem/n.md", "x");
		await createWindowsFs(carte, miroir).rename("Quiz/.import-xyz", "Quiz/Recu");
		r.check("un dossier déplacé (import en staging) annonce ses notes aux abonnés",
			vusEcriture.includes("create Quiz/Recu/Sem/n.md"), true);
		desabonnerEcriture();
		vus.splice(4); // the later cases count the events of the pushed ones only

		/* TÂCHE 5 : un `renameDir` poussé par le principal (paire déjà
		   appariée, chemins ABSOLUS) doit atteindre les abonnés `onRenameDir`,
		   traduit en chemins du CONTRAT — et EUX SEULS : les abonnés `onChange`
		   ne doivent rien en voir, ce n'est pas un `HostFileEvent`. */
		const renommages = [];
		const desabonnerRenameDir = miroir.onRenameDir(ev => renommages.push(ev));
		pont.emettre({ kind: "renameDir", fromAbs: "D:/Quiz/Cours", toAbs: "D:/Quiz/Cours B2" });
		r.check("un renameDir poussé atteint les abonnés, en chemins du CONTRAT",
			renommages, [{ from: "Quiz/Cours", to: "Quiz/Cours B2" }]);
		r.check("un renameDir ne fait rien au miroir de fichiers ni aux abonnés onChange",
			vus.length, 4);

		/* LE DÉSABONNEMENT REND ARRÊTE VRAIMENT L'ÉCOUTE. */
		desabonnerRenameDir();
		pont.emettre({ kind: "renameDir", fromAbs: "D:/Quiz/Autre", toAbs: "D:/Quiz/Autre B2" });
		r.check("le désabonnement d'onRenameDir arrête vraiment l'écoute",
			renommages.length, 1);

		/* CE QUE LE MIROIR DOIT IGNORER. Un chemin hors des racines (le
		   principal surveille ce qu'on lui donne, mais la garde est ici aussi),
		   un chemin hors catalogue, et la suppression d'un fichier que le
		   catalogue n'a JAMAIS connu — un `.tmp` d'éditeur, dont l'annonce
		   ferait redessiner la liste pour rien. */
		const avant = miroir.all().length;
		pont.emettre({ kind: "create", abs: "E:/Ailleurs/x.md", mtime: 1 });
		pont.emettre({ kind: "create", abs: "D:/Quiz/.neo-quiz/results/x.md", mtime: 1 });
		pont.emettre({ kind: "delete", abs: "D:/Quiz/Cours/jamais-vu.tmp" });
		r.check("un chemin hors racine, un chemin hors catalogue et la suppression d'un inconnu ne changent rien",
			[miroir.all().length, vus.length], [avant, 4]);
	} finally {
		pont.retirer();
	}

	r.done();
});

/**
 * LE SCHÉMA DU PROTOCOLE DES RESSOURCES — et pourquoi il n'est pas libre.
 *
 * Groupe NEUF de la tâche 4. `resourceUrl` fabrique l'URL d'une image, et cette
 * URL traverse ensuite le SANITIZER : `src/engine/cards.ts` résout les images
 * d'options PUIS assainit (`sanitizeQuizHtml`), et la liste blanche
 * d'`isSafeQuizUrl` (`src/engine/sanitizer.ts`) n'admet pour un `src` que
 * `https?:`, `app:`, `file:`, `blob:` et `data:image/`.
 *
 * UN SCHÉMA INVENTÉ (« neo-res: ») AURAIT DONC FAIT RETIRER CHAQUE IMAGE
 * D'OPTION, sans la moindre erreur : des quiz qui s'affichent, sans images, et
 * rien dans la console. C'est le genre de défaut qu'une relecture ne voit pas,
 * et `src/` ne bouge pas à cette tranche — c'est donc au protocole de rentrer
 * dans la liste, pas l'inverse. Ce groupe est ce qui l'empêche de ressortir :
 * renommer le schéma dans `electron/ressources.ts` fait rougir le cas du
 * sanitizer.
 */
await withSrcModule("apps/windows/electron/ressources.ts", async ({ urlDeRessource, cheminDeRessource }) => {
	const r = makeReporter("Hôte Windows — le schéma des ressources");

	r.check("l'URL porte le chemin absolu, lisible",
		urlDeRessource("D:/Quiz/Cours/schema.png"), "app://neo-res/D:/Quiz/Cours/schema.png");
	/* Un espace ou un `#` dans un nom de fichier casserait l'URL : `#` couperait
	   le chemin à cet endroit, et le protocole servirait un autre fichier. Le
	   `:` du lecteur, lui, reste lisible — c'est une URL qu'on relit dans
	   l'inspecteur quand une image ne s'affiche pas. */
	r.check("un nom qui porte un espace ou un dièse est encodé, le lecteur reste lisible",
		urlDeRessource("D:/Quiz/Cours/mon schéma #1.png"),
		"app://neo-res/D:/Quiz/Cours/mon%20sch%C3%A9ma%20%231.png");
	/* L'aller-retour, sans quoi le protocole servirait un chemin qui n'est pas
	   celui que le rendu a demandé. */
	r.check("le chemin se relit tel quel",
		cheminDeRessource(urlDeRessource("D:/Quiz/Cours/mon schéma #1.png")),
		"D:/Quiz/Cours/mon schéma #1.png");
	/* Une URL d'un AUTRE protocole n'est pas à nous : le gestionnaire répond
	   404 plutôt que de servir un fichier sur la foi d'un chemin qui traîne. */
	r.check("une URL étrangère au protocole n'est pas un chemin",
		[cheminDeRessource("https://exemple.test/x.png"), cheminDeRessource("app://autre/D:/x.png"),
			cheminDeRessource("pas une url")],
		[null, null, null]);

	/* LA CONTRAINTE, ÉPROUVÉE SUR LES DEUX LISTES QUI LA PORTENT — et par le
	   TEXTE de leur source, comme le faisait l'ancien contrôle de l'hôte Obsidian pour la
	   liste des préfixes de `cards.ts`. Ce n'est pas un raccourci : passer par
	   le VRAI `sanitizeQuizHtml` ne prouverait RIEN ici, parce que linkedom ne
	   tient pas la sémantique d'un `<template>` — son `.content` est une
	   fragment SÉPARÉE du `innerHTML` qu'il resérialise, donc toutes les
	   retouches du sanitizer s'y perdent et il rend son entrée TELLE QUELLE
	   (mesuré : `<script>`, `onerror=` et `javascript:` y survivent tous les
	   trois). Un cas écrit là-dessus serait vert quel que soit le schéma — le
	   défaut exact qu'il est censé attraper.
	   Ce que ces deux cas gardent : le schéma que `urlDeRessource` produit doit
	   être NOMMÉ dans les deux listes de `src/`, qui ne bougent pas à cette
	   tranche. Le renommer dans `electron/ressources.ts` les fait rougir. */
	const schema = new URL(urlDeRessource("D:/Quiz/Cours/schema.png")).protocol;

	/* `isSafeQuizUrl` (`src/engine/sanitizer.ts`) : la liste blanche des URL
	   qu'un `src` d'image a le droit de porter. Un schéma absent d'ici est
	   RETIRÉ de l'attribut, sans la moindre erreur : le quiz s'affiche, sans
	   ses images, et rien dans la console ne le dit. */
	const listeSanitizer = readFileSync("src/engine/sanitizer.ts", "utf8")
		.split("\n").find(ligne => ligne.includes("mailto:") && ligne.includes("blob:"));
	r.check("le schéma des ressources est dans la liste blanche du sanitizer",
		!!listeSanitizer && listeSanitizer.includes(schema), true);

	/* `cards.ts` : les préfixes DÉJÀ résolus, qu'une seconde passe ne doit pas
	   réécrire. Un schéma absent d'ici ferait repasser l'URL par `resourceUrl`,
	   qui ne sait pas la relire et rendrait `null` — le `src` d'origine
	   survivrait, puis le sanitizer le retirerait. Même résultat, autre cause :
	   la règle est gardée des deux côtés. */
	const listeCards = readFileSync("src/engine/cards.ts", "utf8")
		.split("\n").find(ligne => ligne.includes("data:") && ligne.includes("asset:"));
	r.check("… et dans les préfixes que cards.ts tient pour déjà résolus",
		!!listeCards && listeCards.includes(schema), true);

	r.done();
});

await withSrcModule("apps/windows/src/review/catalogue.ts", async ({ construireCatalogue, cleModule, libelleModule }) => {
	const r = makeReporter("App — catalogue de révision");
	/* Un faux `paths` : deux racines, préfixe = premier segment. C'est le
	   contrat, pas l'implémentation Windows, qui est éprouvé ici. */
	const paths = {
		rootOf: (p) => ({ id: p.split("/")[0], name: p.split("/")[0], reviewLog: "", reviewJournalDir: "", deviceId: "test-device", legacyReviewLog: null, vault: false }),
		localPath: (p) => p.split("/").slice(1).join("/"),
		contractPath: (id, l) => (id ? `${id}/${l}` : l),
		resultsDirFor: () => "",
		roots: () => [],
		defaultRoot: () => ({ id: "", name: "", reviewLog: "", reviewJournalDir: "", deviceId: "test-device", legacyReviewLog: null, vault: false }),
	};

	/* La clé de module porte la RACINE : sans elle, « Réseaux » de deux
	   dossiers différents partageraient une date d'examen, et l'ordonnanceur
	   resserrerait les révisions d'une matière dont l'examen n'a pas lieu. */
	r.check("le module porte la racine", cleModule("Efrei/Reseaux/ch1.md", paths), "Efrei/Reseaux");
	r.check("deux racines ne partagent pas un module homonyme",
		cleModule("Perso/Reseaux/ch1.md", paths) === cleModule("Efrei/Reseaux/ch1.md", paths), false);
	/* Un quiz posé à la racine du dossier : le module est la racine, pas une
	   clé qui se termine par un séparateur. */
	r.check("un quiz sans sous-dossier", cleModule("Efrei/ch1.md", paths), "Efrei");
	r.check("le libellé est le dernier segment", libelleModule("Efrei/Reseaux"), "Reseaux");

	const items = construireCatalogue([
		{ path: "Efrei/Reseaux/ch1.md", items: [{ id: "ip" }, { id: "masque", slice: 2 }] },
	], paths);
	/* La clé de question est le chemin du CONTRAT + « ::id ». C'est
	   l'adaptateur qui la localise avant écriture — ici, elle est globale. */
	r.check("les clés de question", items.map(i => i.q),
		["Efrei/Reseaux/ch1.md::ip", "Efrei/Reseaux/ch1.md::masque"]);
	/* La TRANCHE devient la source : sans elle, deux tranches d'un même
	   chapitre ne s'entrelaceraient pas. */
	r.check("la tranche sépare les familles", items.map(i => i.source),
		["Efrei/Reseaux/ch1.md", "Efrei/Reseaux/ch1.md#2"]);

	/* SANS FILET dans le brief : le `role` (pre/read/recall/test) décide de
	   l'entrelacement des rôles pédagogiques (spec de l'ordonnanceur). Un
	   item sans rôle ne doit pas en fabriquer un (`undefined`, pas une chaîne
	   vide) — sinon le noyau daterait une question comme si son rôle était
	   connu. */
	const avecRole = construireCatalogue([
		{ path: "Efrei/Reseaux/ch1.md", items: [{ id: "ip", role: "recall" }, { id: "masque" }] },
	], paths);
	r.check("le rôle est reporté quand présent, absent sinon",
		avecRole.map(i => i.role ?? null), ["recall", null]);

	r.done();
});

/**
 * Installe le DOM que la modale de la fenêtre construit, et rend de quoi le
 * retirer.
 *
 * `window.setTimeout` est CAPTURÉ au lieu d'être exécuté : c'est le filet de
 * sécurité de la disparition, et le retenir permet d'observer l'état PENDANT
 * l'animation de sortie — seul moment où l'on peut prouver que `onClose` n'a
 * pas encore été appelé. `matchMedia` rend `matches: false` pour éprouver le
 * chemin ANIMÉ ; le chemin `prefers-reduced-motion` détache immédiatement et
 * ne dirait rien de cet ordre-là.

 */
function installerDom() {
	const precedentDocument = globalThis.document;
	const precedentWindow = globalThis.window;
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	const minuteurs = [];
	globalThis.document = document;
	globalThis.window = {
		matchMedia: () => ({ matches: false }),
		setTimeout: (fn) => minuteurs.push(fn),
	};
	return {
		document,
		minuteurs,
		retirer() {
			if (precedentDocument === undefined) delete globalThis.document;
			else globalThis.document = precedentDocument;
			if (precedentWindow === undefined) delete globalThis.window;
			else globalThis.window = precedentWindow;
		},
	};
}

await withSrcModule("apps/windows/src/host/modal.ts", async ({ createWindowsModals }) => {
	const r = makeReporter("Hôte Windows — modales");
	const dom = installerDom();

	try {
		const modals = createWindowsModals();

		/* Le journal des moments, dans l'ORDRE : c'est lui qui distingue
		   « appelé » de « appelé au bon moment ». */
		const journal = [];
		let panneau = null;
		let attacheQuandOnCloseArrive = null;

		const poignee = modals.open({
			className: "qbd-medit-modal",
			title: "Modifier dossier",
			onOpen: (h) => {
				journal.push("onOpen");
				panneau = h.panelEl;
				h.contentEl.appendChild(document.createElement("p"));
			},
			onClose: () => {
				journal.push("onClose");
				attacheQuandOnCloseArrive = document.body.contains(panneau);
			},
		});

		/* LA STRUCTURE D'OBSIDIAN, nom de classe par nom de classe. Le CSS
		   PARTAGÉ la cible : `modal-anim.css` anime `.modal.qbd-anim-modal` et
		   `.modal-container:has(> .modal.qbd-anim-modal) .modal-bg` — le fond
		   doit donc être un FRÈRE du panneau, tous deux enfants DIRECTS du
		   conteneur. Une structure qui dérive ne produit aucune erreur : une
		   boîte illisible au milieu de l'écran, que rien d'autre ne dirait. */
		const conteneur = dom.document.querySelector(".modal-container");
		r.check("le conteneur est posé sur le body", !!conteneur, true);
		r.check("le fond et le panneau sont enfants directs du conteneur",
			[...(conteneur?.children ?? [])].map(e => e.className),
			["modal-bg", "modal qbd-anim-modal qbd-medit-modal"]);
		r.check("le panneau porte la croix, le titre et le corps",
			[...poignee.panelEl.children].map(e => e.className),
			["modal-close-button", "modal-title", "modal-content"]);

		/* La classe va sur le PANNEAU : c'est elle que cible le CSS partagé
		   (`.qbd-medit-modal { width: 475px }`). Posée ailleurs, la modale
		   s'ouvrirait à une largeur quelconque sans qu'aucune erreur ne le dise. */
		r.check("open pose la classe du spec sur le panneau",
			poignee.panelEl.classList.contains("qbd-medit-modal"), true);
		/* Rend le cas « onClose après le détachement » NON TRIVIAL : sans cette
		   ligne, un panneau jamais attaché le ferait passer par accident. */
		r.check("le panneau est attaché quand onOpen construit le contenu",
			document.body.contains(poignee.panelEl), true);
		r.check("onOpen n'est appelé qu'une fois, et à l'ouverture", journal, ["onOpen"]);

		/* Échap et le clic sur le fond peuvent tomber quasi ensemble : deux
		   fermetures ne doivent produire qu'une disparition. */
		let aLeve = false;
		try {
			poignee.close();
			poignee.close();
		} catch (e) {
			aLeve = true;
		}
		r.check("fermer deux fois ne lève pas", aLeve, false);
		r.check("une seule disparition est programmée", dom.minuteurs.length, 1);
		/* PENDANT l'animation de sortie : le panneau est encore là, et l'écriture
		   différée de `module-edit.ts` ne doit pas avoir eu lieu. */
		r.check("onClose n'est pas appelé pendant l'animation de sortie", journal, ["onOpen"]);
		r.check("le panneau porte le marqueur de sortie pendant l'animation",
			poignee.panelEl.classList.contains("qbd-closing"), true);
		/* Le fond suit le panneau, sinon il resterait opaque le temps que le
		   panneau disparaisse (`.modal-container.qbd-closing .modal-bg`). */
		r.check("le conteneur aussi, pour que le fond se fonde",
			conteneur.classList.contains("qbd-closing"), true);

		/* LA DOUBLE DÉTENTE, jouée dans l'ordre réel : `animationend` arrive
		   vers 160 ms et détache, puis le filet de sécurité de 240 ms arrive
		   QUAND MÊME. Les deux se produisent à chaque fermeture normale — sans
		   garde d'idempotence sur le détachement, `onClose` serait appelé deux
		   fois, donc « Modifier dossier » écrirait deux fois sur le disque. */
		poignee.panelEl.dispatchEvent(new Event("animationend"));
		/* Un BOOLÉEN, pas l'élément lui-même : le rapporteur compare en
		   `JSON.stringify`, et sur le chemin d'ÉCHEC c'est tout le panneau qui
		   passe dedans. MESURÉ, en cassant le détachement : linkedom donne à
		   ses nœuds un `toJSON`, donc rien ne lève et le groupe survit — mais
		   la ligne « obtenu » devient une trentaine de valeurs illisibles qui
		   ne disent pas ce qui a raté. Le booléen dit « détaché : non », et il
		   ne dépend pas de ce que linkedom sérialise. */
		r.check("animationend détache le conteneur",
			!dom.document.querySelector(".modal-container"), true);
		r.check("deux fermetures et une animation n'appellent onClose qu'une fois",
			journal, ["onOpen", "onClose"]);
		r.check("onClose est appelé APRÈS le détachement du panneau",
			attacheQuandOnCloseArrive, false);
		/* Un corps non vidé empilerait deux contenus à la réouverture. */
		r.check("le corps est vidé à la fermeture", poignee.contentEl.childNodes.length, 0);

		for (const fn of dom.minuteurs.splice(0)) fn();
		r.check("le filet de sécurité qui suit ne rappelle pas onClose",
			journal, ["onOpen", "onClose"]);

		/* PLUSIEURS CLASSES dans `className`, comme un attribut `class`.
		   `classList.add("a b")` lève une DOMException dans un vrai navigateur
		   (un jeton ne contient pas d'espace), et elle partait AVANT la croix,
		   le titre et le contenu : un panneau vide, impossible à fermer —
		   l'aperçu d'un PDF, vu à l'écran le 2026-09-17. */
		let ouvert = false;
		const deux = modals.open({
			className: "qbd-ai-preview-modal qbd-ai-preview-modal--pdf",
			title: "CM1.pdf",
			onOpen: () => { ouvert = true; },
		});
		r.check("deux classes séparées par une espace sont posées toutes les deux",
			["qbd-ai-preview-modal", "qbd-ai-preview-modal--pdf"].every(c => deux.panelEl.classList.contains(c)), true);
		r.check("… et le panneau a bien sa croix, son titre et son contenu",
			[...deux.panelEl.children].map(e => e.className),
			["modal-close-button", "modal-title", "modal-content"]);
		r.check("… et onOpen a été appelé", ouvert, true);
		deux.close();
		for (const fn of dom.minuteurs.splice(0)) fn();
	} finally {
		dom.retirer();
	}

	r.done();
});

await withSrcModule("apps/windows/src/host/ui.ts", async ({ createWindowsUi }) => {
	const r = makeReporter("Hôte Windows — catalogue d'icônes");
	/* `try/finally` comme le groupe des modales, et pour la raison que
	   `CLAUDE.md` note à propos de `check:lesson` : un groupe qui MEURT sur une
	   exception au lieu d'échouer proprement emporte en silence tous ceux qui
	   le suivent — et laisserait ici `globalThis.document` et `window`
	   remplacés pour eux. */
	const dom = installerDom();
	try {
		const ui = createWindowsUi();
		const noms = ui.iconNames();

		/* Le contrat parle KEBAB-CASE, comme Obsidian ; le paquet `lucide` expose
		   ses clés en PascalCase. Une liste non vide ne prouve donc rien —
		   `Object.keys(icons)` en rendrait une, pleine de noms qu'aucun `setIcon`
		   ne sait rendre. D'où une VALEUR NOMMÉE. */
		r.check("iconNames contient chevron-down", noms.includes("chevron-down"), true);
		/* Le préfixe « lucide- » est une affaire d'Obsidian : la fenêtre n'a
		   aucune raison d'en fabriquer un. */
		r.check("iconNames ne laisse aucun préfixe lucide-",
			noms.filter(n => n.startsWith("lucide-")), []);
		/* Aucune majuscule ne survit : une seule suffirait à faire échouer la
		   recherche du sélecteur, qui compare en minuscules. */
		r.check("aucun nom ne garde de majuscule", noms.filter(n => /[A-Z]/.test(n)), []);

		/* LA règle que les trois cas ci-dessus ne gardent pas : un nom listé doit
		   être un nom que `setIcon` sait RENDRE. La conversion inverse et celle de
		   `setIcon` doivent donc se composer en identité — ce que le `toKebabCase`
		   de Lucide (`/([a-z0-9])([A-Z])/`) ne fait PAS : il rendrait « xcircle »
		   pour `XCircle`, un nom que `versCleLucide` ne retrouve plus. Vérifié sur
		   TOUT le catalogue plutôt que sur un nom cité, qui disparaîtrait le jour
		   où Lucide retire son alias. Un nom irrésolu VIDE l'élément (ui.ts). */
		const irresolus = [];
		/* `poserIcone` avertit en console sur un nom inconnu — c'est voulu dans
		   l'application, mais ici cela noierait le rapport sous 2000 lignes. Le
		   résultat, lui, se lit sur l'élément resté vide. */
		const avertir = console.warn;
		console.warn = () => {};
		try {
			for (const nom of noms) {
				const el = dom.document.createElement("span");
				ui.setIcon(el, nom);
				if (!el.firstChild) irresolus.push(nom);
			}
		} finally {
			console.warn = avertir;
		}
		r.check("chaque nom listé est un nom que setIcon sait rendre", irresolus, []);
	} finally {
		dom.retirer();
	}

	r.done();
});

/**
 * LA PLATEFORME de l'application, extraite dans `platform.ts` pour être
 * éprouvable ici — `index.ts` importe MathLive, qu'esbuild ne charge pas hors
 * de la fenêtre. `isDesktopApp` est LA valeur que la génération IA lit pour
 * décider si la page « Générer » a un sens : un `false` glissé là la rendrait
 * morte dans l'app sans qu'aucun contrôle ne le dise.
 */
await withSrcModule("apps/windows/src/host/platform.ts", async ({ createWindowsPlatform }) => {
	const r = makeReporter("Hôte Windows — plateforme");
	const platform = createWindowsPlatform();
	r.check("platform est renseigné",
		["isMobile", "isMacOS", "isWindows", "isDesktopApp", "uiLanguage"].filter(k => !(k in platform)), []);
	/* `isMacOS` et `isWindows` sont lus SÉPARÉMENT de Chromium, jamais déduits
	   l'un de l'autre : la page « Générer » affiche une commande d'installation
	   par système, et « pas un Mac » aurait donné du PowerShell à un Linux.
	   `navigator` est posé ici le temps du cas — le module le lit à l'appel. */
	{
	/* `navigator` est une propriété ACCESSEUR de `globalThis` sous Node (lecture
	   seule) : on la REDÉFINIT le temps des cas, et on restaure le descripteur
	   d'origine — une simple réaffectation lève un TypeError, et ce jet tuerait
	   tous les groupes suivants. */
	const descripteurNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	const poser = (p) => Object.defineProperty(globalThis, "navigator", {
		value: { platform: p, language: "fr-FR" }, configurable: true, writable: true,
	});
	try {
		poser("Win32");
		r.check("sous Windows : isWindows vrai, isMacOS faux",
			[platform.isWindows, platform.isMacOS], [true, false]);
		poser("MacIntel");
		r.check("sous macOS : isMacOS vrai, isWindows faux",
			[platform.isMacOS, platform.isWindows], [true, false]);
		poser("Linux x86_64");
		r.check("sous Linux : ni l'un ni l'autre (la commande d'installation y est celle d'Unix)",
			[platform.isWindows, platform.isMacOS], [false, false]);
	} finally {
		if (descripteurNav) Object.defineProperty(globalThis, "navigator", descripteurNav);
		else delete globalThis.navigator;
	}
	}
	r.check("isDesktopApp est vrai dans l'application", platform.isDesktopApp, true);
	r.check("isMobile est faux dans l'application", platform.isMobile, false);
	// Hors de toute fenêtre, `navigator` n'existe pas : l'anglais, pas une mort.
	r.check("uiLanguage rend une étiquette même sans navigator", typeof platform.uiLanguage, "string");
	r.done();
});

/**
 * LE RÉSEAU du rendu : un passe-plat vers `reseau.fetch` du pont, et rien
 * d'autre — le principal juge l'hôte (`npm run check:electron-reseau`). Ce
 * qui est à nous ici tient en trois règles : la requête traverse INTACTE et
 * SANS `signal` (un `AbortSignal` ne se clone pas, `invoke` rejetterait) ;
 * chaque requête porte un identifiant DISTINCT ; l'abandon du signal est
 * relayé par `reseau.annuler` sous CE MÊME identifiant, pendant que la
 * requête vit — après, il n'y a plus rien à annuler.
 */
await withSrcModule("apps/windows/src/host/net.ts", async ({ createWindowsNet }) => {
	const r = makeReporter("Hôte Windows — réseau");
	const pont = installerPont();
	try {
		const net = createWindowsNet();
		const controleur = new AbortController();
		const reponse = await net.fetchJson({
			url: "http://localhost:11434/api/generate",
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"model":"llama3"}',
			signal: controleur.signal,
		});
		const appel = pont.journal.find(e => e[0] === "reseau.fetch");
		r.check("un fetchJson traverse le pont avec l'URL, la méthode, les en-têtes et le corps intacts, sans signal",
			appel ? appel[1] : null,
			{
				url: "http://localhost:11434/api/generate",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"model":"llama3"}',
			});
		r.check("la réponse du principal est rendue telle quelle", reponse, { status: 200, body: "ok" });
		r.check("un signal non abandonné ne fait rien annuler",
			pont.journal.filter(e => e[0] === "reseau.annuler"), []);

		/* Deux requêtes, deux identifiants : un identifiant partagé ferait
		   annuler l'AUTRE requête en vol côté principal. */
		await net.fetchJson({ url: "http://localhost:11434/api/tags" });
		const ids = pont.journal.filter(e => e[0] === "reseau.fetch").map(e => e[2]);
		r.check("chaque requête porte un identifiant numérique distinct",
			{ nombres: ids.every(i => typeof i === "number"), distincts: new Set(ids).size },
			{ nombres: true, distincts: 2 });

		/* L'annulation PENDANT la requête : le double retient `fetch` tant que
		   `terminer` n'est pas appelé, le cas abandonne le signal entre-temps, et
		   `annuler` doit porter l'identifiant de CETTE requête. */
		let terminer;
		pont.reseau.attente = new Promise(res => { terminer = res; });
		const c2 = new AbortController();
		const enVol = net.fetchJson({ url: "http://localhost:11434/lent", signal: c2.signal });
		await Promise.resolve();
		c2.abort();
		await Promise.resolve();
		const idLent = pont.journal.filter(e => e[0] === "reseau.fetch").pop()[2];
		const annulations = pont.journal.filter(e => e[0] === "reseau.annuler").map(e => e[1]);
		terminer();
		await enVol;
		r.check("l'abandon du signal est relayé par reseau.annuler sous le même identifiant",
			annulations, [idLent]);

		/* Déjà annulé AVANT l'envoi : `null` sans que rien ne traverse — le
		   contrat rend `null` pour une annulation, et le principal n'a pas à voir
		   passer une requête que personne n'attend plus. */
		pont.reseau.attente = null;
		const avant = pont.journal.length;
		const c3 = new AbortController();
		c3.abort();
		const deja = await net.fetchJson({ url: "http://localhost:11434/api/tags", signal: c3.signal });
		r.check("un signal déjà abandonné rend null sans traverser le pont",
			{ deja, traverse: pont.journal.length - avant }, { deja: null, traverse: 0 });

		/* Après la fin d'une requête, abandonner son signal n'annule plus rien :
		   l'écouteur est retiré dans un `finally`, sinon chaque requête finie
		   laisserait un écouteur sur un signal que l'appelant peut réutiliser. */
		const c4 = new AbortController();
		await net.fetchJson({ url: "http://localhost:11434/api/tags", signal: c4.signal });
		const avantAbandon = pont.journal.filter(e => e[0] === "reseau.annuler").length;
		c4.abort();
		await Promise.resolve();
		r.check("abandonner le signal d'une requête finie n'annule rien",
			pont.journal.filter(e => e[0] === "reseau.annuler").length - avantAbandon, 0);
	} finally {
		pont.retirer();
	}
	r.done();
});

/**
 * LES CLI du rendu : un passe-plat vers les canaux `process.*` du pont, et un
 * `run` qui REJETTE.
 *
 * Deux règles, et elles ne se confondent pas :
 * — ce qui traverse le pont est un NOM D'OUTIL, jamais un chemin. Les chemins
 *   des fichiers de CLI (`$CODEX_HOME/models_cache.json`, `~/.claude.json`)
 *   sont fixes et connus du seul principal ; un chemin composé ici ferait de
 *   ce canal une lecture disque hors périmètre, et `canaux.ts` refuserait de
 *   toute façon tout nom hors de sa liste ;
 * — `run` TRAVERSE depuis la tâche 7, et ce qui traverse est encore un NOM : le
 *   chemin de l'exécutable est résolu par le PRINCIPAL, dans son propre magasin.
 *   Un chemin qui partirait d'ici annulerait la liste blanche de noms d'un
 *   trait — le rendu choisirait le programme lancé.
 *
 * ET DEUX CHOSES QUI SONT À NOUS. Le `signal` ne se clone pas : il ne traverse
 * pas, et l'abandon est relayé par `annuler(id)` — le même patron qu'au réseau.
 * Et le NOM de l'erreur : le canal rend une ENVELOPPE parce que l'IPC
 * d'Electron perd le `name` d'une erreur jetée ; ce module le RECONSTRUIT, et
 * c'est le seul endroit du rendu qui le fasse. Sans lui, « Claude Code n'est
 * pas installé » arriverait dans la page sous le nom « Error », donc traduit en
 * « réponse illisible du modèle ».
 */
await withSrcModule("apps/windows/src/host/process.ts", async ({ createWindowsProcess }) => {
	const r = makeReporter("Hôte Windows — les CLI");
	const pont = installerPont();
	try {
		const processus = createWindowsProcess();

		const cache = await processus.lireCache("codex");
		r.check("lireCache traverse le pont avec le NOM de l'outil, jamais un chemin",
			pont.journal.filter(e => e[0] === "processus.lireCache"), [["processus.lireCache", "codex"]]);
		r.check("la réponse du principal est rendue telle quelle", cache, { mtimeMs: 1234, json: { models: [] } });

		r.check("ollamaInstalle et demarrerOllama traversent sans argument",
			{
				installe: await processus.ollamaInstalle(),
				demarre: await processus.demarrerOllama(),
				appels: pont.journal.filter(e => e[0].startsWith("processus.")).map(e => e.join(":")),
			},
			{
				installe: true,
				demarre: true,
				appels: ["processus.lireCache:codex", "processus.ollamaInstalle", "processus.demarrerOllama"],
			});

		/* "Open a terminal" (2026-09-30): the call reaches the bridge with NO
		   argument at all, whatever the caller passes, and returns its verdict. */
		r.check("openTerminal : no argument crosses the bridge, the verdict comes back",
			{ verdict: await processus.openTerminal("claude", { x: 1 }), appel: pont.journal.find(l => l[0] === "processus.openTerminal") },
			{ verdict: "lance", appel: ["processus.openTerminal"] });
		/* `surTerminalPose` : l'abonnement descend au pont, et le rappel du
		   principal remonte tel quel — c'est lui qui fait remonter la modale. */
		{
			let vu = 0;
			const off = processus.surTerminalPose(() => { vu++; });
			pont.poserTerminal();
			off();
			r.check("surTerminalPose : l'abonnement passe par le pont, le rappel remonte, le désabonnement redescend",
				{ vu, abonne: pont.journal.includes("processus.surTerminalPose") || !!pont.journal.find(l => l[0] === "processus.surTerminalPose"), desabonne: !!pont.journal.find(l => l[0] === "processus.surTerminalPose:off") },
				{ vu: 1, abonne: true, desabonne: true });
		}
		/* `surCachesCli` : même chemin, et le NOM de l'outil remonte tel quel —
		   c'est lui qui fait redessiner le bouton du modèle. */
		{
			const vus = [];
			const off = processus.surCachesCli(tool => { vus.push(tool); });
			pont.reecrireCache("claude");
			off();
			r.check("surCachesCli : l'abonnement passe par le pont, le nom de l'outil remonte, le désabonnement redescend",
				{ vus, abonne: !!pont.journal.find(l => l[0] === "processus.surCachesCli"), desabonne: !!pont.journal.find(l => l[0] === "processus.surCachesCli:off") },
				{ vus: ["claude"], abonne: true, desabonne: true });
		}

		/* ── `run` ── */

		/* CE QUI TRAVERSE : le NOM, les arguments, le stdin, les jetons — et
		   JAMAIS le `signal` (il ne se clone pas : `invoke` rejetterait avant
		   même que le principal ne voie l'appel), ni un chemin d'exécutable. */
		const c1 = new AbortController();
		const res = await processus.run({
			tool: "claude", args: ["-p"], stdin: "PROMPT", timeoutMs: 1000,
			marqueur: "0123456789abcdef0123456789abcdef",
			fichiers: [{ nom: "i.png", base64: "AA==" }],
			sortieFichier: "last-message.txt",
			signal: c1.signal,
		});
		const envoye = pont.journal.filter(e => e[0] === "processus.run").at(-1);
		r.check("run traverse le pont avec le NOM de l'outil, sans le signal ni aucun chemin",
			{
				spec: envoye && envoye[1],
				id: typeof (envoye && envoye[2]),
				signal: !!(envoye && envoye[1] && "signal" in envoye[1]),
			},
			{
				spec: {
					tool: "claude", args: ["-p"], stdin: "PROMPT", timeoutMs: 1000,
					marqueur: "0123456789abcdef0123456789abcdef",
					fichiers: [{ nom: "i.png", base64: "AA==" }],
					sortieFichier: "last-message.txt",
				},
				id: "number",
				signal: false,
			});
		r.check("une enveloppe ok est rendue telle quelle", res, { stdout: "OUT", stderr: "", code: 0, sortie: undefined });

		/* LE NOM DE L'ERREUR EST RECONSTRUIT. Sans cette moitié, chaque échec
		   d'un CLI arriverait dans la page sous le nom « Error » — donc traité
		   par `ai-client.ts` comme une réponse illisible du modèle, au lieu de
		   « Claude Code n'est pas installé ». */
		pont.cli.valeur = { ok: false, nom: "introuvable", message: "CLI introuvable : claude" };
		let nom = "(aucun rejet)";
		let message = "";
		try {
			await processus.run({ tool: "claude", args: [], stdin: "" });
		} catch (e) {
			nom = e.name;
			message = e.message;
		}
		r.check("une enveloppe en échec redevient un rejet NOMMÉ, avec son message",
			{ nom, message }, { nom: "introuvable", message: "CLI introuvable : claude" });
		pont.cli.valeur = { ok: true, stdout: "OUT", stderr: "", code: 0 };

		/* L'ANNULATION EST RELAYÉE PAR L'IDENTIFIANT, pendant que le CLI tourne :
		   c'est le seul moment où elle a un sens, et c'est ce qui fait tuer
		   l'ARBRE côté principal. */
		let terminer = null;
		pont.cli.attente = new Promise(resolve => { terminer = resolve; });
		const c2 = new AbortController();
		const enCours = processus.run({ tool: "codex", args: [], stdin: "", signal: c2.signal });
		await Promise.resolve();
		const idEnvoye = pont.journal.filter(e => e[0] === "processus.run").at(-1)[2];
		c2.abort();
		await Promise.resolve();
		const annule = pont.journal.filter(e => e[0] === "processus.annuler").at(-1);
		terminer();
		await enCours;
		pont.cli.attente = null;
		r.check("l'abandon du signal relaie annuler(id) avec l'identifiant de CET appel",
			annule, ["processus.annuler", idEnvoye]);

		/* Déjà abandonné AVANT l'appel : rien ne traverse. Le principal n'a pas à
		   voir partir un CLI que personne n'attend plus — et le contrat nomme
		   cette issue `annule`. */
		const avant = pont.journal.length;
		const c3 = new AbortController();
		c3.abort();
		let nomDeja = "(aucun rejet)";
		try {
			await processus.run({ tool: "codex", args: [], stdin: "", signal: c3.signal });
		} catch (e) {
			nomDeja = e.name;
		}
		r.check("un signal déjà abandonné rejette « annule » sans traverser le pont",
			{ nomDeja, traverse: pont.journal.length - avant }, { nomDeja: "annule", traverse: 0 });

		/* Après la fin d'un appel, abandonner son signal n'annule plus rien :
		   l'écouteur est retiré dans un `finally`, sinon chaque appel fini
		   laisserait un écouteur sur un signal que l'appelant peut réutiliser. */
		const c4 = new AbortController();
		await processus.run({ tool: "codex", args: [], stdin: "", signal: c4.signal });
		const avantAbandon = pont.journal.filter(e => e[0] === "processus.annuler").length;
		c4.abort();
		await Promise.resolve();
		r.check("abandonner le signal d'un appel fini n'annule rien",
			pont.journal.filter(e => e[0] === "processus.annuler").length - avantAbandon, 0);
	} finally {
		pont.retirer();
	}
	r.done();
});

await withSrcModule("apps/windows/src/host/collage.ts", async ({ createWindowsCollage }) => {
	const r = makeReporter("Hôte Windows — collage (l'attente vue du rendu)");
	const journal = [];
	let rappelPont = null;
	const pont = () => ({
		collage: {
			attendre: async j => { journal.push(["attendre", j]); return true; },
			arreter: async () => { journal.push(["arreter"]); },
			surTexte: rappel => { rappelPont = rappel; return () => { rappelPont = null; journal.push(["off"]); }; },
		},
	});
	const collage = createWindowsCollage(pont);
	const recus = [];
	const arreter = collage.attendre("k7f2q9abcd", t => recus.push(t));
	r.check("attendre : s'abonne au texte PUIS demande l'attente au principal, avec le jeton",
		journal, [["attendre", "k7f2q9abcd"]]);
	rappelPont?.("// neo-quiz k7f2q9abcd");
	rappelPont?.("// neo-quiz k7f2q9abcd encore");
	r.check("le rappel du rendu n'est appelé qu'une fois, et l'abonnement est retiré", [recus, journal.some(l => l[0] === "off")], [["// neo-quiz k7f2q9abcd"], true]);
	arreter();
	r.check("la fonction rendue arrête l'attente côté principal", journal.some(l => l[0] === "arreter"), true);
	r.done();
});

/* ── LA LECTURE D'UNE VIDÉO, VUE DU RENDU (tâche 4) ──
   Un passe-plat vers les canaux `video.*` du pont, et DEUX choses qui
   sont à nous : l'abonnement à la progression AVANT l'appel
   d'installation (les octets du premier paquet peuvent arriver pendant
   que le principal démarre), et le RECONSTRUISEMENT de l'erreur typée
   depuis l'enveloppe du canal (`ok: false, code`) — l'IPC d'Electron
   perd le `name` d'une erreur jetée, et tout le jugement de la tuile
   (tâche 6) tient dans ce code. */
await withSrcModule("apps/windows/src/host/video.ts", async ({ createWindowsVideo }) => {
	const r = makeReporter("Hôte Windows — la lecture d'une vidéo (vue du rendu)");
	const journal = [];
	let progressionPont = null;
	/* Ce que le PROCHAIN transcrire rend — l'enveloppe du principal. */
	let reponseTranscrire = {
		valeur: { ok: true, valeur: { document: "DOC", nom: "n.md", titre: "T", dureeS: 366, langue: "fr", type: "auto", miniature: null } },
	};
	const pont = () => ({
		video: {
			etat: async () => { journal.push(["video.etat"]); return { present: true, source: "app" }; },
			infosInstallation: async () => { journal.push(["video.infosInstallation"]); return { version: "2026.08.19", datePublication: "2026-08-19", taille: 42, url: "https://github.com/yt-dlp/yt-dlp/releases/latest" }; },
			/* L'installation retient le rappel de progression QUE LE RENDU
			   lui a passé : c'est ce rappel que le cas ci-dessous joue,
			   pendant qu'elle court — l'octets du premier paquet ne
			   doivent pas être perdus. */
			async installer(surProgressionPont) {
				journal.push(["video.installer"]);
				progressionPont = surProgressionPont;
				return reponseInstaller.valeur;
			},
			async transcrire(id) {
				journal.push(["video.transcrire", id]);
				return reponseTranscrire.valeur;
			},
			async annuler(id) { journal.push(["video.annuler", id]); },
		},
	});
	/* Ce que le prochain video.installer REND : une enveloppe, jamais
	   un rejet — le canal ne peut pas faire voyager le name d'une
	   erreur jetée (voir EnveloppeVideo, pont.ts). */
	const reponseInstaller = { valeur: { ok: true, valeur: null } };
	const video = createWindowsVideo(pont);

	/* etat et infosInstallation : des passe-plat, rien à traduire. */
	const etat = await video.etat();
	const infos = await video.infosInstallation();
	r.check("les deux appels traversent, sans rien traduire",
		{ etat, infos, appels: journal.filter(e => e[0].startsWith("video.")).map(e => e[0]) },
		{
			etat: { present: true, source: "app" },
			infos: { version: "2026.08.19", datePublication: "2026-08-19", taille: 42, url: "https://github.com/yt-dlp/yt-dlp/releases/latest" },
			appels: ["video.etat", "video.infosInstallation"],
		});

	/* installer : le rappel de progression est posé AVANT l'appel et
	   sert les octets pendant que l'installation court. */
	const vues = [];
	const promesse = video.installer((recus, total) => vues.push([recus, total]));
	r.check("l'appel est parti, le rappel est déjà au pont", journal.some(e => e[0] === "video.installer"), true);
	progressionPont?.(100, 200);
	progressionPont?.(200, 200);
	await promesse;
	r.check("les octets portés par le pont arrivent au rappel DU RENDU",
		vues, [[100, 200], [200, 200]]);

	/* Une enveloppe d'échec redevient une erreur typée : le code
	   d'installation (empreinte, réseau) est reconstruit, avec son
	   détail de journal — l'IPC ne le conserve pas, et la tuile
	   (tâche 6) juge sur lui. */
	reponseInstaller.valeur = { ok: false, code: "empreinte", detail: "SHA2-256SUMS" };
	let rejet = "(aucun rejet)";
	try {
		await video.installer(() => {});
	} catch (e) {
		rejet = { name: e.name, code: e.code, detail: e.detail, message: e.message };
	}
	r.check("le code d'installation est reconstruit, avec son détail de journal",
		rejet,
		{ name: "empreinte", code: "empreinte", detail: "SHA2-256SUMS", message: "video : empreinte" });
	reponseInstaller.valeur = { ok: true, valeur: null };

	/* transcrire : l'enveloppe ok est débarrassée de son ok ; un
	   échec porte le code, re-typé côté rendu. */
	const res = await video.transcrire("nh9e18bXpzc");
	r.check("le résultat passe tel quel",
		res, { document: "DOC", nom: "n.md", titre: "T", dureeS: 366, langue: "fr", type: "auto", miniature: null });
	reponseTranscrire.valeur = { ok: false, code: "annule", detail: "journal" };
	rejet = "(aucun rejet)";
	try {
		await video.transcrire("nh9e18bXpzc");
	} catch (e) {
		rejet = { name: e.name, code: e.code, detail: e.detail };
	}
	r.check("l'échec de transcription est re-typé sur le code du principal",
		rejet, { name: "annule", code: "annule", detail: "journal" });

	/* annuler relaie l'identifiant — le principal abandonne les
	   transcriptions vivantes de CETTE vidéo, l'arbre est tué
	   là-bas ; ici il n'y a ni process ni arbre. */
	video.annuler("nh9e18bXpzc");
	r.check("le canal annuler est appelé avec CET identifiant",
		journal.filter(e => e[0] === "video.annuler").at(-1), ["video.annuler", "nh9e18bXpzc"]);

	r.done();
});

/* ── LES MATHS RENDUES PAR MATHLIVE (2026-09-23) ──
   Test d'un quiz de suites dans l'application : les exposants sortaient en
   indice (« 100₂ » pour $100^2$) et `\dots` en erreur. Deux causes, deux
   cas : la feuille `mathlive/static.css` — celle qui met en page le HTML de
   `convertLatexToMarkup` (226 règles `ML__`) — n'était chargée nulle part,
   seules les polices l'étaient ; et MathLive ne connaît pas `\dots` ni ses
   variantes amsmath, que MathJax (le greffon) rend sans broncher. */
await withSrcModule("apps/windows/src/host/latex-mathlive.ts", async ({ latexPourMathLive }) => {
	const r = makeReporter("Hôte Windows — le LaTeX donné à MathLive");
	r.check("les points de suspension d'amsmath deviennent des commandes que MathLive connaît",
		[String.raw`1 + \dots + n`, String.raw`a_1 \dotsc a_n`, String.raw`x_1 + \dotsb`, String.raw`\dotsm`, String.raw`\dotsi`, String.raw`\dotso`].map(latexPourMathLive),
		[String.raw`1 + \ldots + n`, String.raw`a_1 \ldots a_n`, String.raw`x_1 + \cdots`, String.raw`\cdots`, String.raw`\cdots`, String.raw`\ldots`]);
	r.check("le reste est intact (ldots, cdots, dot, ddot, indices et exposants)",
		[String.raw`\ldots`, String.raw`\cdots`, String.raw`\dot{x}`, String.raw`\ddot{x}`, "u_{n+1}^2"].map(latexPourMathLive),
		[String.raw`\ldots`, String.raw`\cdots`, String.raw`\dot{x}`, String.raw`\ddot{x}`, "u_{n+1}^2"]);
	const css = readFileSync(join(process.cwd(), "src/assets/css/index.css"), "utf8");
	r.check("l'entrée CSS de l'application charge la mise en page de MathLive, pas ses seules polices",
		[/@import\s+["']mathlive\/static\.css["']/.test(css), /@import\s+["']mathlive\/fonts\.css["']/.test(css)], [true, false]);
	r.done();
});

/* THE PER-LANGUAGE SWITCH (task 6 of 2026-10-04-python-pack): a disabled
   language is neither offered nor run; `cpp` follows the `c` switch. */
await withSrcModule("apps/windows/src/host/code.ts", async ({ createWindowsCode, langageActif, reglerLangageActif }) => {
	const r = makeReporter("Windows host — per-language switch");
	let appels = 0;
	const magasin = new Map([["languagesDisabled", ["c"]]]);
	const pont = { code: { run: async () => { appels++; return { status: "ok", stdout: "x" }; }, warm: async () => { appels++; } },
		reglages: { lire: async (k) => magasin.get(k), ecrire: async (k, v) => { magasin.set(k, v); } } };
	const host = createWindowsCode(() => pont);
	await new Promise(res => setTimeout(res, 10));
	r.check("languages() drops c and cpp when c is disabled", [...host.languages()], ["python"]);
	r.check("run of a disabled language is unavailable", await host.run({ language: "c" }), { status: "unavailable", stdout: "" });
	r.check("… and cpp too", (await host.run({ language: "cpp" })).status, "unavailable");
	r.check("… without calling the bridge", appels, 0);
	r.check("python still runs", (await host.run({ language: "python" })).status, "ok");
	await reglerLangageActif("python", false);
	r.check("disabling python persists the key", magasin.get("languagesDisabled"), ["c", "python"]);
	r.check("langageActif reflects it", langageActif("python"), false);
	await reglerLangageActif("cpp", true);
	r.check("enabling cpp re-enables c", magasin.get("languagesDisabled"), ["python"]);
	r.done();
});
