/** Vérifie les frontières où review-store pourrait perdre ou fabriquer
 * silencieusement des événements. Ce script a donc le droit de toucher
 * Date et setTimeout, contrairement au noyau pur.
 *
 * DEUX MODULES, DEUX NIVEAUX DE FAUX :
 * - `src/review/log-file.ts` (« un journal = un fichier ») : mécanique d'UN
 *   fichier — chargement, écriture différée, absorption des conflits
 *   Syncthing. Éprouvé avec un faux `LogFileFs` minimal (6 méthodes), sans
 *   racine ni routage : ce niveau n'en a pas à connaître.
 * - `src/review/review-store.ts` (l'adaptateur) : le ROUTAGE entre
 *   plusieurs journaux, la conversion clé locale ⇄ clé du contrat, les
 *   renommages. Éprouvé avec un faux HÔTE à deux racines (`fauxHote`).
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;
const DEBOUNCE_MS = 500;

const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** Pilote uniquement le délai de 500 ms du journal. Les autres timers Node
    restent réels, afin que les promesses puissent continuer à se vider. */
async function withManualDebounce(run) {
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	let nextId = 1;
	const timers = new Map();
	globalThis.setTimeout = (callback, delay = 0, ...args) => {
		if (delay !== DEBOUNCE_MS) return realSetTimeout(callback, delay, ...args);
		const id = nextId++;
		timers.set(id, () => callback(...args));
		return id;
	};
	globalThis.clearTimeout = (id) => {
		if (timers.delete(id)) return;
		realClearTimeout(id);
	};
	try {
		await run({
			count: () => timers.size,
			runNext: () => {
				const first = timers.entries().next();
				if (first.done) return false;
				const [id, callback] = first.value;
				timers.delete(id);
				callback();
				return true;
			},
		});
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
}

/* ══════════════════════════════════════════════════════════
   PARTIE 1 — `src/review/log-file.ts` : UN fichier de journal.
══════════════════════════════════════════════════════════ */

/** Faux `LogFileFs` (6 méthodes, la forme exacte que consomme `createLogFile`).
    Chaque méthode est overridable via `options` pour simuler une lecture en
    attente, un échec d'écriture ou un dossier de conflits — même idiome que
    `scripts/check-review-log.mjs` pour `MigrationFs`. */
function fauxFsJournal(initial = {}, options = {}) {
	const fichiers = new Map(Object.entries(initial));
	const trace = [];
	return {
		fichiers,
		trace,
		exists: options.exists ?? (async (p) => { trace.push(["exists", p]); return fichiers.has(p); }),
		read: options.read ?? (async (p) => {
			trace.push(["read", p]);
			if (!fichiers.has(p)) throw new Error("ENOENT " + p);
			return fichiers.get(p);
		}),
		append: options.append ?? (async (p, d) => {
			trace.push(["append", p, d]);
			fichiers.set(p, (fichiers.get(p) ?? "") + d);
		}),
		list: options.list ?? (async (dir) => { trace.push(["list", dir]); return []; }),
		remove: async (p) => { trace.push(["remove", p]); fichiers.delete(p); },
		mkdirs: async (p) => { trace.push(["mkdirs", p]); },
	};
}

await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	const r = makeReporter("Journal (fichier) — écritures différées et ordre des lots après échec");
	await withManualDebounce(async clock => {
		const appels = [];
		let libererPremier;
		const premier = new Promise(resolve => { libererPremier = resolve; });
		const fs = fauxFsJournal({}, {
			append: async (_p, texte) => {
				appels.push(texte);
				if (appels.length === 1) await premier;
			},
		});
		const fichier = createLogFile({ fs, path: "Cours/.neo-quiz/review-log.jsonl" });
		fichier.append([{ t: "answer", q: "Cours/a.md::q1", at: 1, grade: "correct" }]);
		clock.runNext();
		await settle();
		fichier.append([{ t: "answer", q: "Cours/b.md::q1", at: 2, grade: "wrong" }]);
		clock.runNext();
		await settle();
		r.check("un seul append est en vol", appels.length, 1);
		libererPremier();
		await settle();
		await settle();
		r.check("le lot suivant est reprogrammé après le premier", clock.count(), 1);
		clock.runNext();
		await settle();
		const questions = appels.map(texte => JSON.parse(texte.trim()).q);
		r.check("les lots atteignent append dans l'ordre d'arrivée", questions, ["Cours/a.md::q1", "Cours/b.md::q1"]);
		fichier.destroy();
	});
	r.done();
});

await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	// Un échec d'écriture ne doit pas se réarmer tout seul : le lot échoué
	// reste en file et repart avec la prochaine vraie activité (append()),
	// jamais sur une boucle de 500 ms autonome. La console ne doit signaler
	// qu'UNE fois un échec persistant, pas à chaque tentative.
	const r = makeReporter("Journal (fichier) — échec d'écriture ne boucle pas");
	await withManualDebounce(async clock => {
		const appels = [];
		const fs = fauxFsJournal({}, {
			append: async (_p, texte) => {
				appels.push(texte);
				if (appels.length < 3) throw new Error("disque verrouillé");
			},
		});
		const erreurs = [];
		const originalError = console.error;
		console.error = (...args) => { erreurs.push(args); };
		try {
			const fichier = createLogFile({ fs, path: "Cours/.neo-quiz/review-log.jsonl" });
			fichier.append([{ t: "answer", q: "Cours/a.md::q1", at: 1, grade: "correct" }]);
			clock.runNext();
			await settle();
			await settle();
			r.check("un échec n'arme plus de nouvelle tentative tout seul", clock.count(), 0);
			r.check("l'échec est signalé une fois", erreurs.length, 1);

			fichier.append([{ t: "answer", q: "Cours/b.md::q1", at: 2, grade: "wrong" }]);
			clock.runNext();
			await settle();
			await settle();
			r.check("un deuxième échec consécutif n'arme rien non plus", clock.count(), 0);
			r.check("un échec persistant ne re-signale pas à chaque tentative", erreurs.length, 1);

			fichier.append([{ t: "answer", q: "Cours/c.md::q1", at: 3, grade: "correct" }]);
			clock.runNext();
			await settle();
			r.check("le troisième essai (qui réussit) porte les trois lots en attente", appels.length, 3);
			const questions = appels[2].trim().split("\n").map(l => JSON.parse(l).q);
			r.check("le lot en échec repart avec chaque nouvelle activité, dans l'ordre", questions,
				["Cours/a.md::q1", "Cours/b.md::q1", "Cours/c.md::q1"]);
			fichier.destroy();
		} finally {
			console.error = originalError;
		}
	});
	r.done();
});

/* ── Fichiers de conflit Syncthing ──
   Syncthing ne fusionne pas : deux appareils qui écrivent le journal entre
   deux synchronisations produisent un `.sync-conflict-…jsonl` à côté. Le
   fichier doit ABSORBER ses lignes manquantes puis le supprimer — et ne
   jamais supprimer ce qu'il n'a pas entièrement compris. */
await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	const r = makeReporter("Journal (fichier) — absorption des conflits Syncthing");
	const DIR = "Cours/.neo-quiz";
	const CHEMIN = `${DIR}/review-log.jsonl`;
	const T0 = 1750000000000;
	const ligne = (q, at) => JSON.stringify({ t: "answer", q, at, grade: "correct" }) + "\n";

	// Le principal porte a et b ; le conflit porte b (recouvrement, cas NORMAL)
	// et c (la révision que l'autre appareil est seul à connaître).
	const principal = [ligne("n.md::a", T0), ligne("n.md::b", T0 + 1)].join("");
	const conflit = [ligne("n.md::b", T0 + 1), ligne("n.md::c", T0 + 2)].join("");

	const monter = async (opts = {}) => {
		const fichiers = { [CHEMIN]: opts.principal ?? principal, ...(opts.conflits ?? {}) };
		const fs = fauxFsJournal(fichiers, {
			list: async () => [CHEMIN, ...Object.keys(opts.conflits ?? {})],
		});
		const fichier = createLogFile({ fs, path: CHEMIN });
		await fichier.load();
		return { fichier, fs };
	};

	const cheminC = `${DIR}/review-log.sync-conflict-20260904-071500-ABCDEFG.jsonl`;
	const m = await monter({ conflits: { [cheminC]: conflit } });
	const ecrit = m.fs.fichiers.get(CHEMIN).trim().split("\n");
	// 3 lignes et non 4 : `b` est présent des deux côtés et ne doit être écrit
	// qu'une fois, sinon `spentToday` compterait deux fois la même révision.
	r.check("la révision connue du seul autre appareil est absorbée", ecrit.length, 3);
	r.check("le recouvrement n'est PAS dupliqué", ecrit.filter(l => l.includes("n.md::b")).length, 1);
	r.check("le fichier de conflit est supprimé après absorption", m.fs.fichiers.has(cheminC), false);

	// Une ligne illisible : on absorbe le reste, on garde le fichier.
	const cheminD = `${DIR}/review-log.sync-conflict-20260904-081500-HIJKLMN.jsonl`;
	const abime = ligne("n.md::d", T0 + 3) + "{ pas du json\n";
	const m2 = await monter({ conflits: { [cheminD]: abime } });
	r.check("la ligne lisible d'un fichier abîmé est quand même absorbée",
		m2.fs.fichiers.get(CHEMIN).includes("n.md::d"), true);
	r.check("un fichier dont une ligne échappe n'est JAMAIS supprimé", m2.fs.fichiers.has(cheminD), true);

	/* Journal sans saut final (édité à la main, tronqué par une fermeture
	   brutale) : sans la recolle, la dernière ligne du principal et la
	   première absorbée fusionneraient et deviendraient TOUTES DEUX
	   illisibles. */
	const m3 = await monter({ principal: principal.trimEnd(), conflits: { [cheminC]: conflit } });
	const lu3 = m3.fs.fichiers.get(CHEMIN).trim().split("\n");
	r.check("un journal sans saut final n'est pas corrompu par l'absorption", lu3.length, 3);
	r.check("la ligne qui précédait la recolle reste lisible",
		lu3.filter(l => l.includes("n.md::b")).length, 1);
	r.done();
});

await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	const r = makeReporter("Journal (fichier) — chargement concurrent");
	let resolveRead;
	const lecture = new Promise(resolve => { resolveRead = resolve; });
	const CHEMIN = "Cours/.neo-quiz/review-log.jsonl";
	const fs = fauxFsJournal({}, { exists: async () => true, read: async () => lecture });
	const fichier = createLogFile({ fs, path: CHEMIN });
	const loading = fichier.load();
	// `load()` n'a pas encore rendu la main : une ligne qui arrive maintenant
	// ne doit pas être effacée par le fichier (vide) qui va être chargé.
	fichier.append([{ t: "answer", q: "Cours/ch1.md::q1", at: 1, grade: "correct" }]);
	resolveRead("");
	await loading;
	r.check("une ligne arrivée pendant load() n'est pas effacée",
		fichier.lines().map(l => l.q), ["Cours/ch1.md::q1"]);
	fichier.destroy();
	await tick();
	r.done();
});

/* ── Dédoublonnage (exigence ajoutée à la tâche 4, absente du brief) ──
   Deux lignes identiques au caractère près SONT la même révision : le
   moteur interdit d'enregistrer deux fois la même question dans une
   session (son tableau `recorded[]`), et deux sessions ne se croisent
   jamais à la milliseconde. Un doublon ne peut donc venir que d'ailleurs :
   deux migrations entrelacées (`src/review/migration.ts`, qui l'annonce
   explicitement comme NON garanti) ou une absorption de conflit Syncthing
   qui recouvre partiellement le principal. Sans ce filtre, `spentToday`
   compterait deux fois les mêmes réponses et mangerait le budget du jour. */
await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	const r = makeReporter("Journal (fichier) — dédoublonnage au chargement");
	const CHEMIN = "Cours/.neo-quiz/review-log.jsonl";
	const doublon = JSON.stringify({ t: "answer", q: "Cours/ch1.md::q1", at: 1_700_000_000_000, grade: "correct" }) + "\n";
	const fs = fauxFsJournal({ [CHEMIN]: doublon + doublon });
	const fichier = createLogFile({ fs, path: CHEMIN });
	await fichier.load();
	r.check("deux lignes identiques au caractère près ne comptent que pour une seule",
		fichier.lines().length, 1);
	fichier.destroy();
	r.done();
});

await withSrcModule("src/review/log-file.ts", async ({ createLogFile }) => {
	const r = makeReporter("Journal (fichier) — erreurs de lecture");
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		{
			const fs = fauxFsJournal({}, { exists: async () => false });
			const fichier = createLogFile({ fs, path: "Cours/.neo-quiz/review-log.jsonl" });
			await fichier.load();
			fichier.destroy();
			r.check("l'absence normale du journal n'avertit pas", warnings.length, 0);
		}
		{
			const fs = fauxFsJournal({}, { exists: async () => true, read: async () => { throw new Error("EACCES"); } });
			const fichier = createLogFile({ fs, path: "Cours/.neo-quiz/review-log.jsonl" });
			await fichier.load();
			fichier.destroy();
			r.check("une lecture refusée est signalée", warnings.length, 1);
		}
	} finally {
		console.warn = originalWarn;
	}
	r.done();
});

/* ══════════════════════════════════════════════════════════
   PARTIE 2 — `src/review/review-store.ts` : l'adaptateur (routage).
══════════════════════════════════════════════════════════ */

/** Un faux hôte à DEUX racines : c'est le multi-racines qui est éprouvé ici,
    et un hôte à une seule racine laisserait passer un routage qui écrit
    toujours dans le premier journal. `withManualDebounce` (ci-dessus) reste
    inchangé : il pilote le délai de 500 ms.

    EXTENSION par rapport au brief : `options.read` et `options.exists` sont
    overridables, même idiome que `options.append`/`options.list` déjà
    présents. Sans eux, le cas « renommage pendant load() » (garde `loaded()`,
    l'un des cas explicitement à conserver) ne peut pas simuler une lecture
    en attente — la garde qu'il éprouve deviendrait increvable. */
function fauxHote(options = {}) {
	const ecritures = [];
	const fichiers = new Map(Object.entries(options.fichiers ?? {}));
	const abonnesFichier = new Set();
	const abonnesDossier = new Set();
	const racines = [
		{ id: "A", name: "A", reviewLog: "A/.neo-quiz/review-log.jsonl", reviewJournalDir: "A/.neo-quiz/journal", deviceId: "dev", legacyReviewLog: null, vault: false },
		{ id: "B", name: "B", reviewLog: "B/.neo-quiz/review-log.jsonl", reviewJournalDir: "B/.neo-quiz/journal", deviceId: "dev", legacyReviewLog: null, vault: false },
	];
	const teteDe = (p) => String(p ?? "").split("/")[0];
	const host = {
		fs: {
			exists: options.exists ?? (async (p) => fichiers.has(p)),
			read: options.read ?? (async (p) => {
				if (!fichiers.has(p)) throw new Error("ENOENT " + p);
				return fichiers.get(p);
			}),
			append: options.append ?? (async (p, d) => {
				ecritures.push([p, d]);
				fichiers.set(p, (fichiers.get(p) ?? "") + d);
			}),
			list: options.list ?? (async () => []),
			remove: async (p) => { fichiers.delete(p); },
			mkdirs: async () => {},
			write: async (p, d) => { fichiers.set(p, d); },
			rename: async () => {},
			listMarkdown: () => [],
			findByName: () => [],
			getFile: () => null,
			readCached: async (p) => fichiers.get(p) ?? "",
		},
		watcher: {
			onChange: (cb) => { abonnesFichier.add(cb); return () => abonnesFichier.delete(cb); },
			onRenameDir: (cb) => { abonnesDossier.add(cb); return () => abonnesDossier.delete(cb); },
		},
		paths: {
			roots: () => racines,
			rootOf: (p) => racines.find(r => r.id === teteDe(p)) ?? null,
			localPath: (p) => String(p ?? "").split("/").slice(1).join("/"),
			contractPath: (id, l) => (id ? `${id}/${l}` : l),
			resultsDirFor: () => "",
		},
	};
	return {
		host,
		ecritures,
		fichiers,
		/** La DERNIÈRE ligne JSONL réellement écrite, déjà parsée. On lit la
		    dernière LIGNE et non le dernier bloc parce qu'un lot différé peut en
		    porter plusieurs : `JSON.parse` sur le bloc entier ferait MOURIR le
		    script sur une SyntaxError là où on attend une assertion rouge et
		    lisible — et une mort en route masque tous les groupes suivants. */
		derniereLigne: () => {
			const lignes = (ecritures[ecritures.length - 1]?.[1] ?? "").trim().split("\n").filter(Boolean);
			return lignes.length ? JSON.parse(lignes[lignes.length - 1]) : null;
		},
		emettreRenameFichier: (oldPath, path) => {
			for (const cb of [...abonnesFichier]) cb({ kind: "rename", oldPath, file: { path, name: "", basename: "", extension: "md", mtime: 0 } });
		},
		emettreRenameDossier: (from, to) => {
			for (const cb of [...abonnesDossier]) cb({ from, to });
		},
	};
}

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — clé opaque");
	const { host } = fauxHote();
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [], horizons: () => ({}), now: () => Date.now(),
	});
	r.check("keyOf assemble chemin et id par ::", store.keyOf("Cours/ch1.md", "q1"), "Cours/ch1.md::q1");
	store.destroy();
	r.done();
});

await withSrcModule("src/review/review-store.ts", async ({ buildReviewCatalogue }) => {
	const r = makeReporter("Adaptateur — catalogue depuis le scanner");
	const quizzes = [
		{
			path: "B1 (2025-2026)/Reseaux/ch1.md",
			items: [
				{ id: "q1", role: "test", slice: 2 },
				{ id: "q2" },
			],
		},
		{ path: "notes-racine.md", items: [{ id: "q1", role: "recall" }] },
	];
	const attendu = [
		{ q: "B1 (2025-2026)/Reseaux/ch1.md::q1", module: "Reseaux", source: "B1 (2025-2026)/Reseaux/ch1.md#2", role: "test" },
		{ q: "B1 (2025-2026)/Reseaux/ch1.md::q2", module: "Reseaux", source: "B1 (2025-2026)/Reseaux/ch1.md" },
		{ q: "notes-racine.md::q1", module: "", source: "notes-racine.md", role: "recall" },
	];
	r.check("le constructeur de catalogue est exporté", typeof buildReviewCatalogue, "function");
	if (typeof buildReviewCatalogue === "function") {
		const obtenu = buildReviewCatalogue(quizzes, { Reseaux: { examDate: "2027-06-01" } });
		r.check("q, module et source restent les valeurs opaques attendues", obtenu, attendu);
	}
	r.done();
});

await withSrcModule(["src/review/review-store.ts", "src/dashboard/home-tasks.ts"], async ({ parseExamDate, formatExamDate, parseExamWeight, readExamWeight }, { isoLocal }) => {
	const r = makeReporter("Adaptateur — parseExamDate (garde NaN)");
	r.check("une date valide donne un timestamp fini", typeof parseExamDate("2027-06-01"), "number");
	// 275761 dépasse la plage représentable par `Date`, mais ses trois
	// composants non nuls passent le premier filtre (`!a || !m || !j`) : sans
	// la garde `Number.isFinite`, ce cas produirait un timestamp NaN qui
	// empoisonnerait silencieusement toutes les échéances du module.
	r.check("une année hors du domaine Date retombe sur null, pas NaN", parseExamDate("275761-01-01"), null);
	r.check("une entrée non-string rend null", parseExamDate(undefined), null);
	// The picker stores `isoLocal` of a local date: 00:30 local on the 30th must
	// stay the 30th in any timezone (`toISOString` gives the 29th east of UTC).
	r.check("local ISO date keeps the local day just after midnight", isoLocal(new Date(2026, 8, 30, 0, 30).getTime()), "2026-09-30");
	r.check("local ISO date keeps the local day just before midnight", isoLocal(new Date(2026, 8, 30, 23, 59).getTime()), "2026-09-30");
	r.check("an exam date round-trips through parse and local ISO", isoLocal(parseExamDate("2026-01-01")), "2026-01-01");
	r.check("English date is written in full, capitalised", formatExamDate("2026-09-30", "en"), "Wednesday, September 30, 2026");
	r.check("French date is written in full, capitalised", formatExamDate("2026-09-30", "fr"), "Mercredi 30 septembre 2026");
	r.check("an unreadable date is returned as is", formatExamDate("nope", "en"), "nope");
	// An exam's weight: a coefficient or a percentage, both in (0, 100].
	r.check("weight: empty is none", parseExamWeight(""), undefined);
	r.check("weight: blank is none", parseExamWeight("  "), undefined);
	r.check("weight: 20% is a percentage", parseExamWeight("20%"), { value: 20, unit: "percent" });
	r.check("weight: 20 % is a percentage", parseExamWeight("20 %"), { value: 20, unit: "percent" });
	r.check("weight: a bare number takes the toggle's unit (coef)", parseExamWeight("2"), { value: 2, unit: "coef" });
	r.check("weight: a bare number takes the toggle's unit (percent)", parseExamWeight("2", "percent"), { value: 2, unit: "percent" });
	r.check("weight: a typed % wins over the toggle", parseExamWeight("2%", "coef"), { value: 2, unit: "percent" });
	r.check("weight: decimal comma", parseExamWeight("1,5"), { value: 1.5, unit: "coef" });
	r.check("weight: decimal point", parseExamWeight("1.5"), { value: 1.5, unit: "coef" });
	r.check("weight: 100 is the top", parseExamWeight("100%"), { value: 100, unit: "percent" });
	for (const bad of ["0", "-1", "abc", "150%", "101", "0%", "%", ",", "2%%", "2 3", "1e2"])
		r.check(`weight: ${JSON.stringify(bad)} is invalid`, parseExamWeight(bad), null);
	r.check("stored weight: a coefficient without a unit is kept as is", readExamWeight(2.5, undefined), { coefficient: 2.5 });
	r.check("stored weight: an explicit coef unit is not written back", readExamWeight(2, "coef"), { coefficient: 2 });
	r.check("stored weight: a percentage keeps its unit", readExamWeight(20, "percent"), { coefficient: 20, weightUnit: "percent" });
	for (const [n, u] of [[0, undefined], [101, "percent"], ["2", undefined], [null, "percent"], [undefined, "percent"], [2, "pct"], [2, null]])
		r.check(`stored weight: ${JSON.stringify([n, u])} is dropped`, readExamWeight(n, u), null);
	r.done();
});

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	// Régression : le listener de renommage est armé de façon SYNCHRONE, à la
	// construction du store — avant que `load()` (asynchrone) n'ait fini de
	// lire le disque. Pendant cette fenêtre, `journal.fichier.lines()` est
	// encore vide, donc le filtre de pertinence (`correspondAuChemin`) ne
	// peut reconnaître AUCUN chemin — sans la garde `loaded()`, l'événement
	// serait perdu et la clé resterait orpheline pour toujours.
	const r = makeReporter("Adaptateur — renommage pendant load() (garde loaded())");
	let resolveRead;
	const lecture = new Promise(resolve => { resolveRead = resolve; });
	const { host, ecritures, emettreRenameDossier } = fauxHote({
		read: async (p) => {
			if (p === "B/.neo-quiz/review-log.jsonl") return lecture;
			throw new Error("ENOENT " + p);
		},
		exists: async (p) => p === "B/.neo-quiz/review-log.jsonl",
	});
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [], horizons: () => ({}), now: () => 1_700_000_000_000,
	});
	const loading = store.load();
	// `journal.fichier.lines()` est encore vide ici : `load()` n'a pas rendu la main.
	emettreRenameDossier("B/Cours", "B/Reseaux");
	resolveRead("");
	await loading;
	// `destroy()` force le flush immédiatement (il ne dépend pas du minuteur
	// de 500 ms) ; `tick()` APRÈS laisse ses propres `await` (mkdirs, append)
	// se dérouler avant qu'on inspecte `ecritures`.
	store.destroy();
	await tick();
	r.check("un renommage survenu pendant le chargement est quand même écrit", ecritures.length, 1);
	const ligne = ecritures[0] ? JSON.parse(ecritures[0][1].trim()) : null;
	r.check("c'est bien une ligne de renommage, pas un événement perdu", ligne?.t, "rename");
	r.check("ses deux chemins sont LOCAUX malgré la racine B", [ligne?.from, ligne?.to], ["Cours", "Reseaux"]);
	r.done();
});

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	// Une fois `load()` terminé, le filtre de pertinence reprend la main :
	// un renommage sans rapport avec une question suivie ne doit RIEN écrire,
	// sous peine de gonfler le journal indéfiniment.
	const r = makeReporter("Adaptateur — renommage non pertinent (après chargement)");
	const MAINTENANT = 1_700_000_000_000;
	const historique = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: MAINTENANT, grade: "correct" }) + "\n";
	const { host, ecritures } = fauxHote({ fichiers: { "B/.neo-quiz/review-log.jsonl": historique } });
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [], horizons: () => ({}), now: () => MAINTENANT,
	});
	await store.load();
	store.renamed("B/Images/logo.png", "B/Images/logo-2.png");
	await tick();
	r.check("un fichier sans rapport avec une question suivie ne gonfle pas le journal", ecritures.length, 0);
	store.destroy();
	r.done();
});

/* ── LES RENOMMAGES PERTINENTS : normalisation des chemins, et suivi de la clé
   COURANTE. Groupe repris de l'ancien `check-review-store.mjs` et rétabli ici
   parce que, sans lui, `sansSlashFinal` et la relecture `applyRenames` du
   filtre de pertinence n'avaient plus AUCUNE assertion — on pouvait les
   supprimer toutes les deux et voir le contrôle rester vert. Ce sont pourtant
   les deux fonctions qui empêchent de fabriquer « Cours// » et d'orpheliner
   l'historique d'un dossier entier.

   Adapté au faux hôte à deux racines plutôt que recopié : les événements
   arrivent en chemins du CONTRAT (« B/… »), les lignes écrites sont LOCALES. */
await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — renommages pertinents");
	const MAINTENANT = 1_700_000_000_000;
	const historique = JSON.stringify({ t: "answer", q: "Cours/Reseaux/ch1.md::q1", at: MAINTENANT, grade: "correct" }) + "\n";
	const nouveauStore = () => {
		const faux = fauxHote({ fichiers: { "B/.neo-quiz/review-log.jsonl": historique } });
		return {
			faux,
			store: createReviewStore({
				fs: faux.host.fs, watcher: faux.host.watcher, paths: faux.host.paths,
				catalogue: () => [], horizons: () => ({}), now: () => MAINTENANT,
			}),
		};
	};

	/* SLASH FINAL. Un hôte nomme un dossier tantôt « Cours/Reseaux », tantôt
	   « Cours/Reseaux/ ». Sans `sansSlashFinal`, le préfixe cherché serait
	   « Cours/Reseaux/ » — aucune clé du journal n'y correspond, le renommage
	   est jugé non pertinent, et le déplacement du dossier n'est PAS journalisé
	   du tout. L'historique du module devient orphelin en silence. */
	await withManualDebounce(async () => {
		const { faux, store } = nouveauStore();
		await store.load();
		store.renamed("B/Cours/Reseaux/", "B/Cours/Réseaux/");
		store.destroy(); // force le flush sans attendre les 500 ms
		await settle();
		r.check("un renommage de dossier à slash final est bien journalisé", faux.ecritures.length, 1);
		const ligne = faux.derniereLigne();
		r.check("c'est une ligne de renommage", ligne?.t, "rename");
		r.check("son 'from' est normalisé, sans slash de fin", ligne?.from, "Cours/Reseaux");
		r.check("son 'to' est normalisé, sans slash de fin", ligne?.to, "Cours/Réseaux");
	});

	/* DEUX RENOMMAGES SUCCESSIFS. Le second porte sur un chemin que le journal
	   ne connaît QUE par la ligne écrite au premier. Sans la relecture
	   `applyRenames` dans le filtre de pertinence, il serait comparé aux clés
	   HISTORIQUES, jugé non pertinent, et l'historique du dossier s'arrêterait
	   définitivement au premier déplacement. */
	await withManualDebounce(async () => {
		const { faux, store } = nouveauStore();
		await store.load();
		store.renamed("B/Cours/Reseaux", "B/Cours/Réseaux");
		store.renamed("B/Cours/Réseaux", "B/Cours/Networks");
		store.destroy();
		await settle();
		const lignes = faux.ecritures.flatMap(([, texte]) =>
			texte.trim().split("\n").filter(Boolean).map(l => JSON.parse(l)));
		r.check("deux renommages successifs suivent la clé COURANTE, pas l'historique",
			lignes.map(l => [l.from, l.to]),
			[["Cours/Reseaux", "Cours/Réseaux"], ["Cours/Réseaux", "Cours/Networks"]]);
	});

	/* NO-OP APRÈS NORMALISATION. « Cours/ » → « Cours » n'est pas un
	   renommage : c'est le même dossier écrit de deux façons. Une ligne
	   `Cours → Cours` serait fausse, et chaque relecture du journal la
	   rejouerait pour rien. */
	await withManualDebounce(async clock => {
		const { faux, store } = nouveauStore();
		await store.load();
		store.renamed("B/Cours/", "B/Cours");
		r.check("un renommage devenu no-op après normalisation n'arme aucune écriture", clock.count(), 0);
		store.destroy();
		await settle();
		r.check("et n'écrit rien", faux.ecritures.length, 0);
	});
	r.done();
});

/* ── LE CANAL `onChange` : renommer une NOTE. C'est le chemin le plus fréquent
   sous Obsidian, et il n'avait aucune assertion POSITIVE :
   `emettreRenameFichier` n'était appelé qu'APRÈS `destroy()`, là où l'attendu
   est justement que rien ne se passe. Inverser `ev.oldPath` et `ev.file.path`
   dans l'abonnement — ou retirer l'abonnement entier — laissait donc le
   contrôle vert, alors que l'historique de chaque note renommée était perdu. */
await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — renommage d'une note (canal onChange)");
	const MAINTENANT = 1_700_000_000_000;
	const historique = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: MAINTENANT, grade: "correct" }) + "\n";
	await withManualDebounce(async () => {
		const { host, ecritures, derniereLigne, emettreRenameFichier } = fauxHote({
			fichiers: { "B/.neo-quiz/review-log.jsonl": historique },
		});
		const store = createReviewStore({
			fs: host.fs, watcher: host.watcher, paths: host.paths,
			catalogue: () => [], horizons: () => ({}), now: () => MAINTENANT,
		});
		await store.load();
		emettreRenameFichier("B/Cours/reseau.md", "B/Cours/reseaux.md");
		store.destroy();
		await settle();
		r.check("renommer une note journalise une ligne de renommage", ecritures.length, 1);
		const ligne = derniereLigne();
		r.check("c'est bien une ligne 'rename'", ligne?.t, "rename");
		/* LE SENS COMPTE : `from` est l'ANCIEN chemin. Champs inversés, le
		   filtre de pertinence cherche le chemin NEUF — que le journal ne
		   connaît pas encore — juge le renommage non pertinent, et n'écrit
		   rien du tout. */
		r.check("de l'ANCIEN vers le NOUVEAU chemin, et en clés locales",
			[ligne?.from, ligne?.to], ["Cours/reseau.md", "Cours/reseaux.md"]);
	});
	r.done();
});

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — destruction");
	const MAINTENANT = 1_700_000_000_000;
	const historique = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: MAINTENANT, grade: "correct" }) + "\n";
	const { host, ecritures, emettreRenameDossier, emettreRenameFichier } = fauxHote({
		fichiers: { "B/.neo-quiz/review-log.jsonl": historique },
	});
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [{ q: "B/Cours/reseau.md::q1", module: "B/Cours", source: "B/Cours/reseau.md" }],
		horizons: () => ({}), now: () => MAINTENANT,
	});
	await store.load();
	store.destroy();
	await tick();
	const avant = ecritures.length;

	/* PREMIÈRE garde : le DÉSABONNEMENT. Les callbacks ont quitté le faux hôte,
	   donc plus aucune émission ne parvient jusqu'au store. */
	emettreRenameDossier("B/Cours", "B/Reseaux");
	emettreRenameFichier("B/Cours/reseau.md", "B/Cours/b.md");
	await tick();
	r.check("après destroy(), plus aucun renommage (dossier ou fichier) ne s'écrit", ecritures.length, avant);

	/* SECONDE garde, et c'est une AUTRE : le `if (detruit) return` en tête de
	   `record()` et de `renamed()`. DEUX GARDES VALENT MIEUX QU'UNE parce
	   qu'elles arrêtent des choses différentes — le désabonnement arrête
	   l'HÔTE, la garde interne arrête les appelants DIRECTS : le moteur qui
	   enregistre une réponse pendant que la vue se ferme n'emprunte aucun
	   callback, et le désabonnement ne peut rien contre lui. Les deux cas
	   ci-dessous appellent donc les méthodes SANS passer par le faux hôte ;
	   sinon la première garde masque la seconde et celle-ci n'est éprouvée par
	   rien. */
	store.record([{ q: "B/Cours/reseau.md::q2", grade: "correct" }]);
	store.renamed("B/Cours", "B/Reseaux");
	await tick();
	const apres = store.plan(MAINTENANT);
	/* Observé sur le PLAN et non sur `ecritures` : le journal étant lui aussi
	   détruit, son minuteur ne repart pas et rien n'atteindrait le disque —
	   une réponse acceptée à tort resterait donc invisible côté écritures,
	   tout en polluant l'état en mémoire. `spentToday` compte la réponse
	   chargée, et elle seule ; une seconde s'y ajouterait. */
	r.check("record() après destroy() n'enregistre plus rien", apres.stats.spentToday, 1);
	/* `new: 0` dit que la question a toujours son historique. Un renommage
	   accepté après `destroy()` aurait déplacé sa clé hors du catalogue, et
	   elle serait repassée pour neuve. */
	r.check("renamed() après destroy() ne déplace plus aucune clé", apres.stats.new, 0);
	r.done();
});

/* ── Dédoublonnage, vu depuis l'adaptateur : le plan ne doit pas compter la
   révision deux fois (`spentToday`, src/scheduler/plan.ts). Le test au
   niveau `log-file.ts` prouve le chargement ; celui-ci prouve l'EFFET sur
   le budget du jour, ce que `spentToday` (spec §6) exige explicitement. */
await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — dédoublonnage : le plan ne compte pas deux fois");
	const MAINTENANT = 1_700_000_000_000;
	const doublon = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: MAINTENANT, grade: "correct" }) + "\n";
	const { host } = fauxHote({ fichiers: { "B/.neo-quiz/review-log.jsonl": doublon + doublon } });
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [{ q: "B/Cours/reseau.md::q1", module: "B/Cours", source: "B/Cours/reseau.md" }],
		horizons: () => ({}),
		now: () => MAINTENANT,
	});
	await store.load();
	const plan = store.plan(MAINTENANT);
	r.check("une ligne dupliquée dans le journal ne compte qu'une fois dans le budget du jour",
		plan.stats.spentToday, 1);
	store.destroy();
	r.done();
});

/* ── Les quatre cas neufs du brief (routage multi-racines) ──
   Enveloppé dans `withManualDebounce` : sans lui, `record()` arme un VRAI
   minuteur de 500 ms, et rien dans ce test ne le déclenche autrement (à la
   différence du cas « renommage pendant load() », qui force le flush via
   `destroy()`) — un simple `tick()` de quelques dizaines de ms le laisserait
   filer et ferait rougir le cas pour une raison qui n'a rien à voir avec le
   routage. */
await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — routage multi-racines");
	await withManualDebounce(async clock => {
		const { host, ecritures, derniereLigne, emettreRenameDossier } = fauxHote();
		const MAINTENANT = 1_700_000_000_000;
		const store = createReviewStore({
			fs: host.fs, watcher: host.watcher, paths: host.paths,
			catalogue: () => [{ q: "B/Cours/reseau.md::q1", module: "B/Cours", source: "B/Cours/reseau.md" }],
			horizons: () => ({}),
			now: () => MAINTENANT,
		});
		await store.load();
		store.record([{ q: store.keyOf("B/Cours/reseau.md", "q1"), grade: "wrong" }]);
		clock.runNext(); // déclenche le lot différé (au lieu d'attendre les 500 ms réels)
		await settle();
		/* DEUX JOURS PLUS TARD : une réponse fausse replace la question à un jour
		   (`intervalleEchec`), donc au moment même de la réponse elle n'est PAS
		   due — un plan calculé à `MAINTENANT` serait vide, et le cas ci-dessous
		   passerait au vert pour une raison qui n'a rien à voir avec les clés.
		   Cette vacuité-là n'est pas perdue pour autant : elle prouve AUTRE
		   chose, et le plan du jour juste en dessous s'en sert. */
		const plan = store.plan(MAINTENANT + 2 * JOUR);
		/* ET LE PLAN DU JOUR MÊME, sans lequel le cas des clés ne garde rien.
		   Éprouvé : neutraliser `paths.contractPath` dans `versContrat` laisse
		   « le plan voit la clé préfixée » au VERT. La raison est que l'échec
		   se déguise en son contraire — l'événement ne rejoint plus sa
		   question, celle-ci passe pour NEUVE, et une question neuve est due à
		   deux jours exactement comme une question dont l'échec est à revoir.
		   Les deux plans distinguent ce qu'un seul confond. */
		const planDuJour = store.plan(MAINTENANT);

		/* Le ROUTAGE. Une réponse va dans le journal du dossier auquel appartient
		   sa question — jamais dans le premier venu. Sans ce cas, un store
		   multi-racines qui écrirait tout dans le premier journal passerait pour
		   sain : les réponses seraient bien là, dans le mauvais fichier, et le
		   greffon ne les retrouverait jamais. */
		r.check("une réponse est écrite dans le journal de SA racine",
			ecritures.map(([p]) => p), ["B/.neo-quiz/journal/dev.jsonl"]);
		/* La clé écrite est LOCALE : c'est elle que le greffon lira sur le même
		   dossier. Une clé préfixée serait invisible depuis Obsidian. */
		/* `?.` et non `ecritures[0][1]` : si rien n'était écrit du tout, l'accès
		   direct lèverait une TypeError et TUERAIT le script au lieu de le faire
		   rougir — on perdrait le diagnostic au moment où on en a le plus besoin. */
		r.check("et la clé écrite n'a pas le préfixe de la racine",
			JSON.parse(ecritures[0]?.[1] ?? "{}").q, "Cours/reseau.md::q1");
		/* La lecture fait le chemin inverse : le plan travaille sur des clés
		   préfixées, sinon deux dossiers portant « Cours/ch1.md » se
		   confondraient — et l'historique de l'un compterait pour l'autre. */
		r.check("le plan voit la clé préfixée", plan.today, ["B/Cours/reseau.md::q1"]);
		/* `new: 0` dit que la réponse a bien REJOINT sa question. Sans la
		   conversion inverse elle resterait orpheline, la question compterait
		   pour neuve (`new: 1`) et tout son historique serait perdu en
		   silence. Ce 0 ne peut pas venir d'un catalogue vide : le cas
		   ci-dessus vient de prouver que la question y est. */
		r.check("et l'historique rejoint sa question au lieu de la laisser neuve",
			planDuJour.stats.new, 0);
		/* Un déplacement d'une racine à une autre n'écrit RIEN : deux journaux
		   distincts, et une ligne dans l'un ne déplacerait rien dans l'autre.
		   Inventer un renommage inter-racines transporterait une clé vers un
		   journal qui ne la contient pas — un mensonge, silencieux. */
		store.renamed("B/Cours/reseau.md", "A/Cours/reseau.md");
		/* VIDER LE DIFFÉRÉ AVANT DE COMPTER. Éprouvé : sans ce `runNext()`, le
		   cas reste VERT quand on retire la garde inter-racines — la ligne
		   fabriquée à tort dort encore dans la file des 500 ms, `ecritures`
		   vaut 1 quand même, et l'assertion couvre exactement le défaut
		   qu'elle prétend attraper. Quand la garde tient, `append` n'est jamais
		   appelé, aucun minuteur n'est armé, et `runNext()` ne fait rien. */
		clock.runNext();
		await settle();
		r.check("un déplacement entre racines n'écrit pas de renommage", ecritures.length, 1);

		/* Un DOSSIER renommé déplace toutes ses notes en UNE ligne, par préfixe.
		   Sans le canal `onRenameDir`, tout un module perdrait son historique d'un
		   coup — et le contrat n'a ce second canal que pour ça. */
		emettreRenameDossier("B/Cours", "B/Reseaux");
		clock.runNext();
		await settle();
		r.check("un dossier renommé produit une ligne de renommage",
			derniereLigne()?.t, "rename");
		/* La ligne écrite est LOCALE des deux côtés : « Cours » → « Reseaux »,
		   jamais « B/Cours » → « B/Reseaux ». */
		r.check("et ses deux chemins sont locaux",
			[derniereLigne()?.from, derniereLigne()?.to],
			["Cours", "Reseaux"]);
		store.destroy();
	});
	r.done();
});

/* ══════════════════════════════════════════════════════════
   PARTIE 3 — `src/review/transpose.ts` : le pur (Tâche 3).
══════════════════════════════════════════════════════════ */

await withSrcModule("src/review/transpose.ts", async ({ transposerLignes }) => {
	const r = makeReporter("Transposition — le pur");

	r.check("une réponse au préfixe exact est réécrite",
		transposerLignes([{ t: "answer", q: "Cours/ch1.md::q1", at: 1, grade: "wrong" }], "Cours", "Reseaux"),
		[{ t: "answer", q: "Reseaux/ch1.md::q1", at: 1, grade: "wrong" }]);

	/* « Cours2 » ne doit JAMAIS être confondu avec « Cours » : sans le « / »
	   final dans la comparaison, ce cas resterait vert par accident. */
	r.check("un dossier homonyme sans le séparateur n'est pas confondu",
		transposerLignes([{ t: "answer", q: "Cours2/ch1.md::q1", at: 1, grade: "wrong" }], "Cours", "Reseaux"),
		[]);

	r.check("une ligne de renommage dont from ET to sont sous le dossier est transposée des deux côtés",
		transposerLignes([{ t: "rename", from: "Cours/ancien.md", to: "Cours/nouveau.md", at: 1 }], "Cours", "Reseaux"),
		[{ t: "rename", from: "Reseaux/ancien.md", to: "Reseaux/nouveau.md", at: 1 }]);

	r.check("une ligne hors du dossier déplacé est ignorée",
		transposerLignes([{ t: "answer", q: "Autre/ch1.md::q1", at: 1, grade: "wrong" }], "Cours", "Reseaux"),
		[]);

	r.done();
});

/* ══════════════════════════════════════════════════════════
   PARTIE 4 — `review-store.moved` : le déplacement entre racines.
══════════════════════════════════════════════════════════ */

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — moved() entre deux racines");
	await withManualDebounce(async clock => {
		const historique = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: 1, grade: "wrong" }) + "\n"
			+ JSON.stringify({ t: "answer", q: "Autre/ch1.md::q1", at: 2, grade: "correct" }) + "\n";
		const { host, ecritures, fichiers } = fauxHote({ fichiers: { "B/.neo-quiz/review-log.jsonl": historique } });
		const store = createReviewStore({
			fs: host.fs, watcher: host.watcher, paths: host.paths,
			catalogue: () => [], horizons: () => ({}), now: () => 1_700_000_000_000,
		});
		await store.load();

		await store.moved("B/Cours", "A/Cours");
		clock.runNext();
		await settle();

		/* Seule la ligne du dossier déplacé rejoint le journal cible : celle
		   de « Autre » ne doit jamais traverser. */
		r.check("le journal cible reçoit la ligne transposée du dossier déplacé",
			ecritures.map(([p]) => p), ["A/.neo-quiz/journal/dev.jsonl"]);
		r.check("la clé écrite dans le journal cible est locale à SA racine",
			JSON.parse(ecritures[0]?.[1] ?? "{}").q, "Cours/reseau.md::q1");
		/* Le journal SOURCE n'est jamais réécrit : ajout seul, la ligne
		   d'origine reste où elle était. */
		r.check("le journal source garde ses lignes telles quelles",
			fichiers.get("B/.neo-quiz/review-log.jsonl"), historique);

		/* L'ALLER-RETOUR (revue finale de la tranche 9) : ramener le module
		   dans B ne doit RIEN ajouter au journal de B, qui a gardé la ligne
		   d'origine — sinon chaque réponse compterait deux fois. Le faux hôte
		   n'applique pas `append` au fichier lu par `load()` : on rejoue la
		   ligne transposée dans le journal de A à la main, comme le disque
		   l'aurait. */
		fichiers.set("A/.neo-quiz/journal/dev.jsonl", ecritures[0][1]);
		const avant = ecritures.length;
		await store.moved("A/Cours", "B/Cours");
		clock.runNext();
		await settle();
		r.check("ramener le module n'ajoute aucune ligne déjà présente dans le journal cible",
			ecritures.length, avant);

		store.destroy();
	});
	r.done();
});

await withSrcModule("src/review/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — moved() dans la même racine délègue à renamed()");
	await withManualDebounce(async clock => {
		const historique = JSON.stringify({ t: "answer", q: "Cours/reseau.md::q1", at: 1, grade: "wrong" }) + "\n";
		const { host, ecritures, derniereLigne } = fauxHote({ fichiers: { "B/.neo-quiz/review-log.jsonl": historique } });
		const store = createReviewStore({
			fs: host.fs, watcher: host.watcher, paths: host.paths,
			catalogue: () => [], horizons: () => ({}), now: () => 1_700_000_000_000,
		});
		await store.load();
		await store.moved("B/Cours", "B/Reseaux");
		clock.runNext();
		await settle();
		r.check("un déplacement dans la même racine écrit un renommage, pas une transposition",
			derniereLigne()?.t, "rename");
		r.check("dans le seul journal de cette racine",
			ecritures.map(([p]) => p), ["B/.neo-quiz/journal/dev.jsonl"]);
		store.destroy();
	});
	r.done();
});

/* ══════════════════════════════════════════════════════════
   PARTIE 3 — le CÂBLAGE de l'application (`apps/windows/src/review/store.ts`)
   : pas d'examen, pas de révision. La porte est posée sur le CATALOGUE, avant
   le budget du jour : un module sans examen chargé de questions neuves ne
   doit pas manger la place d'un module qui a un partiel. `store.ts` et
   `host/folder.ts` sont chargés dans UN build (le module des examens est
   partagé), avec un faux `window.neo` qui ne sert que les réglages.
══════════════════════════════════════════════════════════ */

await withSrcModule(["apps/windows/src/review/store.ts", "apps/windows/src/host/folder.ts"], async ({ creerJournalApp }, { chargerExamens, enregistrerExamen }) => {
	const r = makeReporter("Application — pas d'examen, pas de révision (catalogue)");
	const reglages = new Map();
	const fenetreAvant = globalThis.window;
	globalThis.window = { neo: { reglages: {
		lire: async (k) => reglages.get(k),
		ecrire: async (k, v) => { reglages.set(k, structuredClone(v)); },
	} } };
	try {
		await withManualDebounce(async () => {
			const { host } = fauxHote();
			const items = (n) => Array.from({ length: n }, (_, i) => ({ id: "q" + i }));
			// 300 questions neuves dans un module SANS examen, 30 dans celui qui
			// en a un : plus que la part de neuf du budget, pour que le budget
			// soit l'enjeu. Le module sans examen est sous la racine « A » : le
			// noyau trie les neuves par clé, il passerait donc EN PREMIER.
			const quizzes = [
				{ path: "A/Loisirs/Tout.md", items: items(300) },
				{ path: "B/Reseaux/CM1.md", items: items(30) },
			];
			await chargerExamens();
			const store = await creerJournalApp(host, { getQuizzes: () => quizzes });
			r.check("sans examen : rien à réviser aujourd'hui", store.plan(Date.now()).today, []);
			await enregistrerExamen("B/Reseaux", { id: "e1", nom: "", date: "2099-06-01" });
			const today = store.plan(Date.now()).today;
			r.check("avec examen : les questions du module reviennent",
				today.some(q => q.startsWith("B/Reseaux/CM1.md::")), true);
			r.check("et rien du module sans examen",
				today.filter(q => q.startsWith("A/")).length, 0);
			// La référence : le même plan SANS le module sans examen. Si la porte
			// filtrait après coup, ce module aurait mangé une part du budget.
			quizzes.splice(0, 1);
			r.check("le module sans examen ne prend rien au budget du jour",
				today, store.plan(Date.now()).today);
			store.destroy();
		});
	} finally {
		if (fenetreAvant === undefined) delete globalThis.window; else globalThis.window = fenetreAvant;
	}
	r.done();
});
