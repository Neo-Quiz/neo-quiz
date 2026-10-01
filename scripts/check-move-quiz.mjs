/**
 * Non-régression de `moveQuizTo` (le sous-menu « Déplacer vers » du menu ⋯
 * d'une carte de quiz, `src/dashboard/quiz-menu.ts`) — trois cas nés de la
 * revue du 2026-09-27 :
 *
 *   1. un dossier CONNU du catalogue mais disparu du DISQUE affiche un
 *      message NOMMÉ (« Le dossier … n'existe plus »), sans jamais tenter
 *      d'écrire ;
 *   2. la collision de nom affiche toujours le message dédié ;
 *   3. toute AUTRE panne (permission refusée, disque plein…) n'affiche plus
 *      « existe déjà » — un message générique, la cause réelle en console.
 *
 * Hôte MINIMAL, comme `check-quiz-io.mjs` : seuls `fs.exists`, `fs.rename` et
 * `ui.notice` sont fournis — tout autre membre atteint jetterait bruyamment,
 * ce qui vaut mieux qu'un double muet.
 *
 *     npm run check:move-quiz
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Appelle `moveQuizTo` avec un hôte jetable, en interceptant `console.error`
    LE TEMPS DE L'APPEL seulement — jamais pendant les assertions qui suivent,
    sinon un échec de `r.check` lui-même se perdrait dans `erreursConsole`
    au lieu de s'afficher. */
async function appeler(qm, hote, ctx, quiz, targetFolder, targetName, { existants, renameImpl }) {
	const notices = [];
	hote.installHost({
		fs: {
			exists: async (p) => existants.has(p),
			rename: renameImpl ?? (async () => { throw new Error("rename non attendu dans ce cas"); }),
		},
		ui: { notice: (msg) => { notices.push(msg); } },
	});
	const original = console.error;
	const erreursConsole = [];
	console.error = (...args) => { erreursConsole.push(args); };
	let resultat;
	try {
		resultat = await qm.moveQuizTo(ctx, quiz, targetFolder, targetName);
	} finally {
		console.error = original;
		hote.uninstallHost();
	}
	return { resultat, notices, erreursConsole };
}

await withSrcModule(
	["src/dashboard/quiz-menu.ts", "src/host/current.ts", "apps/windows/src/review/folder-move.ts", "apps/windows/src/host/folder.ts", "src/dashboard/stats-store.ts", "apps/windows/src/host/shared-state.ts"],
	async (qm, hote, fm, fo, ss, sh) => {
	const r = makeReporter("« Déplacer vers » d'un quiz");

	const quiz = { path: "DossierA/Quiz de test.md", basename: "Quiz de test" };
	const ctx = { statsStore: { renamed() {} }, reviewStore: undefined };

	/* ── 1. Dossier connu mais absent du disque : message nommé, aucune
	   tentative d'écriture ── */
	{
		const { resultat, notices } = await appeler(qm, hote, ctx, quiz, "DossierB", "DossierB", {
			existants: new Set(), // « DossierB » n'y est PAS : disparu du disque.
			renameImpl: async () => { throw new Error("ne doit jamais être appelé"); },
		});
		r.check("1. dossier absent : rend null", resultat, null);
		r.check("1. dossier absent : un seul message, qui NOMME le dossier",
			[notices.length, notices[0] && notices[0].includes("DossierB")],
			[1, true]);
		r.check("1. dossier absent : jamais le message de collision",
			notices[0] === "A quiz with this name already exists there.", false);
	}

	/* ── 2. Collision de nom (message reconnaissable des deux hôtes) ── */
	{
		const { resultat, notices } = await appeler(qm, hote, ctx, quiz, "DossierB", "DossierB", {
			existants: new Set(["DossierB"]),
			renameImpl: async (_de, vers) => { throw new Error(`${vers} existe déjà`); },
		});
		r.check("2. collision : rend null et affiche le message dédié",
			[resultat, notices], [null, ["A quiz with this name already exists there."]]);
	}

	/* ── 3. Une autre panne (permission refusée) : plus de « existe déjà »,
	   message générique, cause réelle en console ── */
	{
		const { resultat, notices, erreursConsole } = await appeler(qm, hote, ctx, quiz, "DossierB", "DossierB", {
			existants: new Set(["DossierB"]),
			renameImpl: async () => { throw new Error("EPERM: operation not permitted"); },
		});
		r.check("3. autre panne : rend null, message générique (jamais « existe déjà »)",
			[resultat, notices], [null, ["Could not move the quiz — see the console for details."]]);
		r.check("3. autre panne : la cause réelle atteint la console", erreursConsole.length > 0, true);
	}

	/* ── 4. Un dossier déplacé emporte ses examens, ses tentatives, ses
	   sessions, ses réglages mémorisés et ses chemins de réglages (2026-10-01) ── */
	{
		const A = "Efrei/S3/Reseaux", B = "Efrei/S3/Reseaux2";
		const exam = { id: "ex1", nom: "Final", date: "2026-12-10", coefficient: 3 };
		const examVoisin = { id: "ex2", nom: "Partiel", date: "2026-11-01" };
		let examens = { "Efrei/Reseaux": [exam], "Efrei/Reseaux2": [examVoisin] };
		const tentatives = [{ date: 2000, pct: 90 }, { date: 1000, pct: 40 }];
		const stats = {
			[A + "/cm1.md"]: { bestScore: 90, questionsDone: 4, totalQuestions: 4, lastPlayed: 2000, attempts: 2, tentatives },
			[B + "/cm1.md"]: { bestScore: 10, questionsDone: 1, totalQuestions: 4, lastPlayed: 500, attempts: 1 },
		};
		const store = ss.createStatsStore({ getStats: () => structuredClone(stats), saveStats: async () => {} });
		store.load();
		const session = { v: 1, courante: "q1", questions: {}, ecrite: 5 };
		const sessions = { [A + "/cm2.md"]: session, [B + "/cm2.md"]: { ...session, ecrite: 6 } };
		const setups = { [A + "/cm2.md"]: { hints: false }, [B + "/cm2.md"]: { hints: true } };
		const reglages = {
			quizzesModuleOverrides: { Reseaux: { name: "Reseaux", path: A }, Reseaux2: { name: "R2", path: B } },
			quizzesArchivedFolders: ["Reseaux"],
		};
		let sessionsVidees = 0, ecrituresReglages = 0;
		const roots = [{ id: "Efrei", name: "Efrei" }, { id: "NeoQuiz", name: "Neo Quiz" }];
		const paths = {
			roots: () => roots,
			rootOf: (p) => roots.find(x => p === x.id || p.startsWith(x.id + "/")),
			localPath: (p) => p.split("/").slice(1).join("/"),
			contractPath: (id, local) => id + "/" + local,
		};
		const renomme = [];
		const ctx = {
			statsStore: store,
			movedPrefix: fm.createMovedPrefix({
				paths: () => paths,
				quizPaths: () => [A + "/cm1.md", A + "/cm2.md", B + "/cm1.md", B + "/cm2.md"],
				renameExams: async (paires) => { examens = fo.deplacerCleExamens(examens, paires); },
				sessions: {
					renommer: (de, vers) => { fm.renommerCles(sessions, de, vers); },
					vider: async () => { sessionsVidees++; },
				},
				testSetups: async () => ({ renamed: (de, vers) => { fm.renommerCles(setups, de, vers); } }),
				pageSettings: () => reglages,
				savePageSettings: async () => { ecrituresReglages++; },
			}),
		};
		hote.installHost({
			fs: { rename: async (de, vers) => { renomme.push([de, vers]); } },
			ui: { notice() {} },
			paths,
		});
		let ok;
		try {
			ok = await qm.moveModuleTo(ctx, { path: A, folder: "Reseaux", name: "Reseaux", quizzes: [] }, "NeoQuiz");
		} finally {
			hote.uninstallHost();
		}
		const N = "NeoQuiz/Reseaux";
		r.check("4. déplacement de dossier : rend true, un seul renommage", [ok, renomme], [true, [[A, N]]]);
		r.check("4. l'examen suit (même id, nom, date) et plus rien sous l'ancienne clé",
			[examens["NeoQuiz/Reseaux"], "Efrei/Reseaux" in examens], [[exam], false]);
		r.check("4. l'examen du dossier voisin au nom commençant pareil est intact",
			examens["Efrei/Reseaux2"], [examVoisin]);
		r.check("4. les deux tentatives suivent le quiz",
			[store.getRecord(N + "/cm1.md")?.tentatives, store.getRecord(A + "/cm1.md")], [tentatives, null]);
		r.check("4. le voisin garde ses stats", store.getRecord(B + "/cm1.md")?.attempts, 1);
		r.check("4. la session suit, et le voisin garde la sienne",
			[Object.keys(sessions).sort(), sessions[N + "/cm2.md"]], [[B + "/cm2.md", N + "/cm2.md"].sort(), session]);
		r.check("4. la session est écrite tout de suite", sessionsVidees, 1);
		r.check("4. le réglage de test mémorisé suit",
			[Object.keys(setups).sort(), setups[N + "/cm2.md"]], [[B + "/cm2.md", N + "/cm2.md"].sort(), { hints: false }]);
		r.check("4. le chemin de l'override suit, celui du voisin non",
			[reglages.quizzesModuleOverrides.Reseaux.path, reglages.quizzesModuleOverrides.Reseaux2.path], [N, B]);
		r.check("4. les clés par NOM de dossier ne bougent pas, les réglages sont écrits",
			[reglages.quizzesArchivedFolders, Object.keys(reglages.quizzesModuleOverrides), ecrituresReglages],
			[["Reseaux"], ["Reseaux", "Reseaux2"], 1]);
	}

	/* ── 5. La fusion des examens quand la clé cible existe déjà ── */
	{
		const e = (id, date) => ({ id, nom: id, date });
		const table = { "A/X": [e("a", "2026-01-02"), e("dup", "2026-02-01")], "B/X": [e("b", "2026-01-01"), { ...e("dup", "2026-03-01"), nom: "déjà là" }] };
		const suivant = fo.deplacerCleExamens(table, [["A/X", "B/X"]]);
		r.check("5. fusion : triée par date, l'id déjà présent gagne, l'ancienne clé disparaît",
			[suivant["B/X"].map(x => x.id + ":" + x.nom), "A/X" in suivant], [["b:b", "a:a", "dup:déjà là"], false]);
		r.check("5. rien à déplacer : la MÊME table (pas d'écriture)", fo.deplacerCleExamens(table, [["Z/Z", "B/X"]]) === table, true);
	}

	/* ── 6. Exam keys under a move: sub-folders, the watcher winning the race,
	   and a same-named folder that stays behind ── */
	{
		const e = (id, date) => ({ id, nom: id, date });
		const roots = [{ id: "Efrei", name: "Efrei" }, { id: "NeoQuiz", name: "Neo Quiz" }];
		const paths = {
			roots: () => roots,
			rootOf: (p) => roots.find(x => p === x.id || p.startsWith(x.id + "/")),
			localPath: (p) => p.split("/").slice(1).join("/"),
			contractPath: (id, local) => id + "/" + local,
		};
		/** Runs moveModuleTo on `Efrei/S3/Reseaux`; `before` is what the scanner
		    holds when the move starts, `live` what the stores' live reader sees
		    once it runs (the watcher may have refreshed it by then). */
		const deplacer = async (examens0, before, live) => {
			let examens = examens0;
			const ctx = {
				statsStore: { renamed() {} },
				scanner: { getQuizzes: () => before.map(path => ({ path })) },
				movedPrefix: fm.createMovedPrefix({
					paths: () => paths,
					quizPaths: () => live,
					renameExams: async (paires) => { examens = fo.deplacerCleExamens(examens, paires); },
					testSetups: async () => ({ renamed() {} }),
					pageSettings: () => ({}),
					savePageSettings: async () => {},
				}),
			};
			hote.installHost({ fs: { rename: async () => {} }, ui: { notice() {} }, paths });
			try {
				await qm.moveModuleTo(ctx, { path: "Efrei/S3/Reseaux", folder: "Reseaux", name: "Reseaux", quizzes: [] }, "NeoQuiz");
			} finally { hote.uninstallHost(); }
			return examens;
		};
		const avant = ["Efrei/S3/Reseaux/cm.md", "Efrei/S3/Reseaux/TD/q.md"];
		const apres = ["NeoQuiz/Reseaux/cm.md", "NeoQuiz/Reseaux/TD/q.md"];
		const base = () => ({ "Efrei/Reseaux": [e("f", "2026-12-01")], "Efrei/TD": [e("td", "2026-11-01")] });

		const a = await deplacer(base(), avant, avant);
		r.check("6a. sub-folder: its exam follows under NeoQuiz/TD, the old key is gone",
			[a["NeoQuiz/TD"], "Efrei/TD" in a, a["NeoQuiz/Reseaux"]], [[e("td", "2026-11-01")], false, [e("f", "2026-12-01")]]);

		const b = await deplacer(base(), avant, apres);
		r.check("6b. the watcher already swapped the paths: same result",
			[b["NeoQuiz/TD"], "Efrei/TD" in b, b["NeoQuiz/Reseaux"], "Efrei/Reseaux" in b], [[e("td", "2026-11-01")], false, [e("f", "2026-12-01")], false]);

		const c = await deplacer(base(), [...avant, "Efrei/S4/Reseaux/cm.md"], avant);
		r.check("6c. a same-named folder stays behind: the old key keeps its exams AND the new key gets a copy",
			[c["Efrei/Reseaux"], c["NeoQuiz/Reseaux"], "Efrei/TD" in c], [[e("f", "2026-12-01")], [e("f", "2026-12-01")], false]);
	}

	/* ── 7. A failing step never skips the others, nor throws ── */
	{
		let setups = 0;
		const roots = [{ id: "Efrei", name: "Efrei" }];
		const paths = { rootOf: () => roots[0], localPath: (p) => p.split("/").slice(1).join("/") };
		const warn = console.warn; console.warn = () => {};
		let leve = null;
		try {
			await fm.createMovedPrefix({
				paths: () => paths, quizPaths: () => [],
				renameExams: async () => { throw new Error("disk full"); },
				sessions: { renommer() { throw new Error("boom"); }, vider: async () => {} },
				testSetups: async () => ({ renamed() { setups++; } }),
				pageSettings: () => ({}), savePageSettings: async () => {},
			})("Efrei/A", "Efrei/B");
		} catch (e) { leve = e; } finally { console.warn = warn; }
		r.check("7. exams and sessions fail: nothing thrown, setups still carried", [leve, setups], [null, 1]);
	}

	/* ── 8. After the move to the synced folder: a move BETWEEN ROOTS carries the
	   exams from the source root's files to the target root's (as this
	   device's entries), through the real `renommerExamens` ── */
	{
		const files = new Map();
		const fs = {
			exists: async (p) => files.has(p), read: async (p) => files.get(p), write: async (p, d) => { files.set(p, d); },
			append: async (p, d) => { files.set(p, (files.get(p) ?? "") + d); },
			list: async (d) => [...files.keys()].filter(k => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
			remove: async (p) => { files.delete(p); }, mkdirs: async () => {},
			rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); },
		};
		const roots = [{ id: "Efrei", name: "Efrei" }, { id: "NeoQuiz", name: "Neo Quiz" }];
		const paths = { roots: () => roots, rootOf: (p) => roots.find(x => p === x.id || p.startsWith(x.id + "/")), localPath: (p) => p.split("/").slice(1).join("/"), contractPath: (id, l) => id + "/" + l };
		const etat = sh.createSharedState({ fs, roots: () => ["Efrei", "NeoQuiz"], deviceId: "dev" });
		await etat.load();
		sh.installSharedState(etat);
		await fo.enregistrerExamen("Efrei/Reseaux", { id: "f", nom: "Final", date: "2026-12-01" });
		await fo.enregistrerExamen("Efrei/TD", { id: "td", nom: "TD", date: "2026-11-01" });
		await fm.createMovedPrefix({
			paths: () => paths,
			quizPaths: () => ["Efrei/S3/Reseaux/cm.md", "Efrei/S3/Reseaux/TD/q.md"],
			renameExams: fo.renommerExamens,
			testSetups: async () => ({ renamed() {} }),
			pageSettings: () => ({}), savePageSettings: async () => {},
		})("Efrei/S3/Reseaux", "NeoQuiz/Reseaux");
		const after = JSON.parse(files.get("NeoQuiz/.neo-quiz/exams/dev.json"));
		const gone = JSON.parse(files.get("Efrei/.neo-quiz/exams/dev.json"));
		r.check("8. cross-root move: the target root's file holds both exams, as live entries",
			[Object.keys(after).sort(), after["NeoQuiz/Reseaux"][0].id, after["NeoQuiz/TD"][0].id, typeof after["NeoQuiz/TD"][0].modifiedAt], [["NeoQuiz/Reseaux", "NeoQuiz/TD"], "f", "td", "number"]);
		r.check("8. the source root's file keeps tombstones, and the merged view has only the new keys",
			[gone["Efrei/Reseaux"][0].deleted, gone["Efrei/TD"][0].deleted, Object.keys(fo.examens()).sort()], [true, true, ["NeoQuiz/Reseaux", "NeoQuiz/TD"]]);
		const restart = sh.createSharedState({ fs, roots: () => ["Efrei", "NeoQuiz"], deviceId: "dev" });
		await restart.load();
		r.check("8. and after a restart", Object.keys(restart.exams()).sort(), ["NeoQuiz/Reseaux", "NeoQuiz/TD"]);
	}

	r.done();
});
