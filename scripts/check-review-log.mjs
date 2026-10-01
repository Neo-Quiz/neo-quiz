/**
 * LE JOURNAL DE RÉVISION — emplacement et MIGRATION.
 *
 * Ce que ce script empêche : perdre un semestre de révisions. L'ordre des
 * opérations est la seule chose qui protège l'historique — écrire, RELIRE
 * pour confirmer, et seulement alors renommer l'ancien. Une relecture
 * sautée ne se verrait pas : tout aurait l'air d'avoir marché.
 *
 *     npm run check:review-log
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Un disque en mémoire. `appendCasse` simule une écriture qui prétend
    réussir sans rien écrire : c'est exactement ce contre quoi la relecture
    existe, et rien d'autre ne sait le produire. */
function fauxFs(initial = {}, options = {}) {
	const fichiers = new Map(Object.entries(initial));
	const trace = [];
	return {
		fichiers,
		trace,
		async exists(p) { trace.push(["exists", p]); return fichiers.has(p); },
		async read(p) {
			trace.push(["read", p]);
			if (!fichiers.has(p)) throw new Error("ENOENT " + p);
			return fichiers.get(p);
		},
		async append(p, d) {
			trace.push(["append", p, d]);
			if (options.appendCasse) return;
			fichiers.set(p, (fichiers.get(p) ?? "") + d);
		},
		async mkdirs(p) { trace.push(["mkdirs", p]); },
		async rename(a, b) {
			trace.push(["rename", a, b]);
			if (options.renameCasse) throw new Error("EPERM");
			if (fichiers.has(b)) throw new Error("EEXIST " + b);
			fichiers.set(b, fichiers.get(a));
			fichiers.delete(a);
		},
	};
}

const ligne = (q, at, grade = "correct") => JSON.stringify({ t: "answer", q, at, grade }) + "\n";

const ANCIEN = ".obsidian/plugins/quiz-blocks/review-log.jsonl";
const NOUVEAU = ".neo-quiz/review-log.jsonl";

await withSrcModule("src/review/migration.ts", async ({ migrateReviewLog, SUFFIXE_MIGRE }) => {
	const r = makeReporter("Journal — migration");

	/* Un cas est une petite fonction, jamais un bloc nu : une RÉGRESSION du
	   module qui LÈVE (au lieu de simplement produire une valeur inattendue)
	   ne doit pas arrêter la course avant `r.done()` — sinon les cas suivants
	   disparaissent EN SILENCE. C'est la même faute que documente CLAUDE.md
	   pour `check:lesson` (« il MEURT sur une exception au lieu d'échouer
	   proprement, et une mort en route masque tous les groupes suivants —
	   onze cachés, une fois »). `essayer` transforme l'exception en une
	   assertion ROUGE nommée, puis laisse la course continuer. */
	async function essayer(nom, fn) {
		try {
			await fn();
		} catch (e) {
			r.check(nom, "exception : " + e.message, "aucune exception");
		}
	}

	/* 1. Aucun ancien journal : le cas de l'immense majorité des démarrages.
	      Il ne doit RIEN écrire — surtout pas créer un `.neo-quiz/` vide. */
	await essayer("cas 1 (sans ancien journal) : pas d'exception", async () => {
		const fs = fauxFs({});
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("sans ancien journal, rien à faire", res.skipped, true);
		r.check("sans ancien journal, aucune écriture",
			fs.trace.filter(([op]) => op !== "exists"), []);
	});

	/* 2. Le cas nominal : tout part, et l'ancien est RENOMMÉ, jamais supprimé.
	      Un semestre de révisions ne se rattrape pas ; quelques kilo-octets
	      conservés ne coûtent rien. */
	await essayer("cas 2 (nominal) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2) });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("les deux lignes sont absorbées", res.absorbed, 2);
		r.check("le nouveau journal les porte",
			fs.fichiers.get(NOUVEAU), ligne("a.md::q1", 1) + ligne("a.md::q2", 2));
		r.check("l'ancien est renommé", res.renamed, true);
		r.check("l'ancien EXISTE toujours, sous son nouveau nom",
			fs.fichiers.has(ANCIEN + SUFFIXE_MIGRE), true);
		r.check("l'ancien n'est plus à sa place", fs.fichiers.has(ANCIEN), false);
		/* Le dossier AVANT l'ajout : `.neo-quiz/` n'existe pas au premier
		   démarrage, et un append dans un dossier absent échoue. */
		const ordre = fs.trace.filter(([op]) => op === "mkdirs" || op === "append").map(([op]) => op);
		r.check("le dossier est créé avant l'ajout", ordre, ["mkdirs", "append"]);
	});

	/* 3. Recouvrement : les deux journaux partagent des lignes. C'est le cas
	      NORMAL quand les deux hôtes migrent (spec §5, décision D2), pas
	      l'exception. Sans dédoublonnage, `spentToday` compterait deux fois
	      les mêmes réponses et mangerait le budget du jour. */
	await essayer("cas 3 (recouvrement) : pas d'exception", async () => {
		const fs = fauxFs({
			[ANCIEN]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2),
			[NOUVEAU]: ligne("a.md::q1", 1) + ligne("b.md::q9", 9),
		});
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("seule la ligne manquante est ajoutée", res.absorbed, 1);
		r.check("le doublon est compté, pas écrit", res.duplicates, 1);
		r.check("le nouveau journal a trois lignes",
			fs.fichiers.get(NOUVEAU).trim().split("\n").length, 3);
	});

	/* 4. Un journal qui ne finit PAS par un saut de ligne (édité à la main,
	      tronqué par une fermeture brutale). Sans le raccord, la dernière
	      ligne existante et la première absorbée se collent, et les DEUX
	      deviennent illisibles — on perdrait une révision qu'on prétendait
	      sauver. */
	await essayer("cas 4 (raccord de saut de ligne) : pas d'exception", async () => {
		const sansSaut = ligne("b.md::q9", 9).trimEnd();
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1), [NOUVEAU]: sansSaut });
		await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		const relu = fs.fichiers.get(NOUVEAU).split("\n").filter(Boolean).map(l => JSON.parse(l).q);
		r.check("aucune ligne n'est collée à une autre", relu, ["b.md::q9", "a.md::q1"]);
	});

	/* 5. Une ligne illisible : on absorbe ce qu'on a compris, et on ne
	      DÉPLACE PAS un fichier qu'on n'a pas entièrement lu. La migration se
	      rejouera au prochain démarrage — elle est idempotente, ça ne coûte
	      qu'une lecture. */
	await essayer("cas 5 (ligne illisible) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) + "{ceci n'est pas du JSON\n" });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la ligne lisible est absorbée", res.absorbed, 1);
		r.check("l'illisible est comptée", res.ignored, 1);
		r.check("l'ancien N'EST PAS renommé", res.renamed, false);
		r.check("l'ancien est toujours là", fs.fichiers.has(ANCIEN), true);
	});

	/* 6. L'écriture prétend réussir sans rien écrire. C'est LE cas pour lequel
	      la relecture existe : sans elle, l'ancien serait renommé et les
	      révisions n'existeraient plus nulle part. */
	await essayer("cas 6 (écriture menteuse) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) }, { appendCasse: true });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la relecture ne confirme pas", res.confirmed, false);
		r.check("rien n'est compté comme absorbé", res.absorbed, 0);
		r.check("l'ancien N'EST PAS renommé", res.renamed, false);
		r.check("l'ancien est intact", fs.fichiers.get(ANCIEN), ligne("a.md::q1", 1));
	});

	/* 7. Idempotence : deux exécutions de suite (les deux hôtes, ou deux
	      démarrages). La seconde ne trouve plus rien à faire. */
	await essayer("cas 7 (idempotence séquentielle) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) });
		await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		const deux = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la seconde exécution n'a rien à faire", deux.skipped, true);
		r.check("le journal n'a pas doublé",
			fs.fichiers.get(NOUVEAU), ligne("a.md::q1", 1));
	});

	/* 8. Le renommage échoue (support en lecture seule, verrou de synchro).
	      Les données sont DÉJÀ dans le nouveau journal : l'échec du renommage
	      ne doit pas remonter comme une panne de migration, ni faire échouer
	      le démarrage. */
	await essayer("cas 8 (renommage refusé) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) }, { renameCasse: true });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("les données sont passées", res.absorbed, 1);
		r.check("le renommage a échoué sans lever", res.renamed, false);
	});

	/* 9. Un ancien journal VIDE (créé puis jamais écrit) : rien à absorber,
	      mais il n'y a rien à comprendre non plus — on le range, sinon la
	      passe se rejoue à chaque démarrage pour rien. */
	await essayer("cas 9 (ancien vide) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: "" });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("un ancien vide est rangé", res.renamed, true);
		r.check("et rien n'est créé", fs.fichiers.has(NOUVEAU), false);
	});

	/* 10. Pas d'ancien chemin du tout (Obsidian sans `manifest.dir`) : la
	       fonction ne doit pas fabriquer un chemin, elle doit ne rien faire. */
	await essayer("cas 10 (pas de chemin ancien) : pas d'exception", async () => {
		const fs = fauxFs({});
		const res = await migrateReviewLog(fs, null, NOUVEAU);
		r.check("sans ancien chemin, rien à faire", res.skipped, true);
		r.check("et aucun appel disque", fs.trace, []);
	});

	/* 11. CONCURRENCE : deux migrations ENTRELACÉES du même ancien journal —
	       les deux hôtes démarrent en même temps, avant qu'aucun n'ait eu le
	       temps d'écrire. Les deux appels partagent le même faux disque SANS
	       être attendus l'un après l'autre : ni `fauxFs` ni le module n'ont de
	       délai artificiel, donc les deux exécutions avancent en lockstep sur
	       la file de microtâches, chacune lisant `nouveau` (pour `dejaLa` et
	       `finSaine`) avant qu'aucune des deux n'ait écrit — exactement la
	       fenêtre que le commentaire d'en-tête décrit comme non protégée.
	       Ce cas ne fige PAS le nombre de doublons obtenus (le module ne
	       promet pas leur absence) : il prouve seulement l'absence de PERTE —
	       aucune ligne de l'ancien ne manque à l'arrivée, et l'ancien reste
	       lisible quelque part (renommé par celle des deux qui gagne la
	       course, ou encore en place si aucune n'a fini). */
	await essayer("cas 11 (migrations entrelacées) : pas d'exception", async () => {
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2) });
		const p1 = migrateReviewLog(fs, ANCIEN, NOUVEAU);
		const p2 = migrateReviewLog(fs, ANCIEN, NOUVEAU);
		await Promise.all([p1, p2]);

		const texteFinal = fs.fichiers.get(NOUVEAU) ?? "";
		const lignesFinales = new Set(texteFinal.split("\n").filter(Boolean));
		const attendues = [ligne("a.md::q1", 1).trim(), ligne("a.md::q2", 2).trim()];
		r.check("aucune ligne de l'ancien ne manque après l'entrelacement",
			attendues.every(l => lignesFinales.has(l)), true);

		// L'ancien reste LISIBLE quelque part : à sa place, ou rangé sous son
		// nouveau nom — jamais disparu, jamais tronqué par la course. On ne
		// sait PAS laquelle des deux exécutions a gagné la course du
		// renommage (EEXIST protège l'autre), donc on accepte les deux issues.
		const ancienContenu = fs.fichiers.get(ANCIEN) ?? fs.fichiers.get(ANCIEN + SUFFIXE_MIGRE);
		r.check("l'ancien reste lisible quelque part (en place ou rangé)",
			ancienContenu, ligne("a.md::q1", 1) + ligne("a.md::q2", 2));
	});

	r.done();
});

/* ══════════════════════════════════════════════════════════
   UN JOURNAL PAR APPAREIL (src/review/journal-set.ts)

   Two devices appending to the same file make Syncthing park one version
   as a `.sync-conflict-*` copy, and half the history disappears from view.
   So each device writes its own `journal/<deviceId>.jsonl` and every device
   reads all of them. What this protects: nothing is ever written to a file
   another device writes, nothing is read twice, and a rename written on one
   device still catches the answers written on another.
══════════════════════════════════════════════════════════ */
await withSrcModule(["src/review/journal-set.ts", "src/scheduler/index.ts"], async ({ createJournalSet }, { applyRenames }) => {
	const r = makeReporter("Journal — un fichier par appareil");

	/** In-memory disk with `list` (full paths of the direct children) and `remove`. */
	function fsMemoire(initial = {}) {
		const fs = fauxFs(initial);
		fs.list = async (dir) => {
			const prefixe = dir + "/";
			const sorties = [...fs.fichiers.keys()].filter(p => p.startsWith(prefixe) && !p.slice(prefixe.length).includes("/"));
			if (!sorties.length) throw new Error("ENOENT " + dir);
			return sorties;
		};
		fs.remove = async (p) => { fs.fichiers.delete(p); };
		return fs;
	}
	const attendreEcritures = () => new Promise(res => setTimeout(res, 20));
	const ancien = ".neo-quiz/review-log.jsonl";
	const DIR = ".neo-quiz/journal";
	const creer = (fs, deviceId = "A") => createJournalSet({ fs, legacyPath: ancien, dir: DIR, deviceId });

	async function essayer(nom, fn) {
		try { await fn(); } catch (e) { r.check(nom, "exception : " + e.message, "aucune exception"); }
	}

	await essayer("cas 1 (fusion triée par date)", async () => {
		const fs = fsMemoire({
			[ancien]: ligne("a.md::q1", 4) + ligne("a.md::q2", 1),
			[`${DIR}/A.jsonl`]: ligne("a.md::q3", 3),
			[`${DIR}/B.jsonl`]: ligne("a.md::q4", 2),
		});
		const set = creer(fs);
		r.check("pas chargé avant load()", set.loaded(), false);
		await set.load();
		r.check("chargé après load()", set.loaded(), true);
		r.check("quatre lignes triées par `at`", set.lines().map(l => l.at), [1, 2, 3, 4]);
		set.destroy();
	});

	await essayer("cas 1b (dossier absent = vide ; égalité d'`at` = ordre des fichiers)", async () => {
		const set = creer(fsMemoire({ [ancien]: ligne("a.md::q1", 5) + ligne("a.md::q2", 5) }));
		await set.load();
		r.check("dossier manquant : seul l'ancien est lu", set.lines().map(l => l.q), ["a.md::q1", "a.md::q2"]);
		set.destroy();
	});

	await essayer("cas 2 (copie de conflit ignorée)", async () => {
		const fs = fsMemoire({
			[`${DIR}/A.jsonl`]: ligne("a.md::q1", 1),
			[`${DIR}/A.sync-conflict-20261001-120000-XYZ.jsonl`]: ligne("a.md::fantome", 2),
		});
		const set = creer(fs);
		await set.load();
		r.check("la copie de conflit n'est pas lue", set.lines().map(l => l.q), ["a.md::q1"]);
		r.check("la copie de conflit n'est pas supprimée", fs.fichiers.has(`${DIR}/A.sync-conflict-20261001-120000-XYZ.jsonl`), true);
		set.destroy();
	});

	await essayer("cas 3 (on n'écrit que dans son fichier)", async () => {
		const fs = fsMemoire({
			[ancien]: ligne("a.md::q1", 1),
			[`${DIR}/B.jsonl`]: ligne("a.md::q2", 2),
		});
		const set = creer(fs, "A");
		await set.load();
		set.append([{ t: "answer", q: "a.md::q9", at: 9, grade: "correct" }]);
		r.check("visible tout de suite en mémoire", set.lines().map(l => l.at), [1, 2, 9]);
		set.destroy();
		await attendreEcritures();
		r.check("journal/A.jsonl a grandi", fs.fichiers.get(`${DIR}/A.jsonl`), ligne("a.md::q9", 9));
		r.check("l'ancien est intact", fs.fichiers.get(ancien), ligne("a.md::q1", 1));
		r.check("B est intact", fs.fichiers.get(`${DIR}/B.jsonl`), ligne("a.md::q2", 2));
		r.check("le dossier est créé avant l'ajout",
			fs.trace.filter(([op]) => op === "mkdirs" || op === "append").map(([op]) => op), ["mkdirs", "append"]);
	});

	await essayer("cas 4 (un renommage d'un appareil rattrape l'historique d'un autre)", async () => {
		const fs = fsMemoire({
			[`${DIR}/A.jsonl`]: ligne("old.md::q1", 5) + ligne("new.md::q1", 15) + ligne("old.md::q2", 15),
			[`${DIR}/B.jsonl`]: JSON.stringify({ t: "rename", from: "old.md", to: "new.md", at: 10 }) + "\n",
		});
		const set = creer(fs, "B");
		await set.load();
		r.check("avant le renommage : nouvelle clé ; après, sous l'ancienne : ancienne clé",
			applyRenames(set.lines()).map(e => e.q), ["new.md::q1", "new.md::q1", "old.md::q2"]);
		set.destroy();
	});

	await essayer("cas 5 (jamais de copie de l'ancien vers un fichier d'appareil)", async () => {
		const fs = fsMemoire({ [ancien]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2) });
		const set = creer(fs);
		await set.load();
		set.append([{ t: "answer", q: "a.md::q3", at: 3, grade: "correct" }]);
		set.destroy();
		await attendreEcritures();
		r.check("le fichier d'appareil ne porte que la nouvelle ligne", fs.fichiers.get(`${DIR}/A.jsonl`), ligne("a.md::q3", 3));
		r.check("l'ancien n'a pas bougé", fs.fichiers.get(ancien), ligne("a.md::q1", 1) + ligne("a.md::q2", 2));
	});

	r.done();
});
