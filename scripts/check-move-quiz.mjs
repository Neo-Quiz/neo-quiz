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
	["src/dashboard/quiz-menu.ts", "src/host/current.ts"],
	async (qm, hote) => {
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

	r.done();
});
