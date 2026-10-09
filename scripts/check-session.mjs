/**
 * LA PHOTO DE SESSION D'UN QUIZ (`src/engine/session.ts`), pure.
 * Ce qu'elle empêche : une reprise qui perd des réponses, qui plante sur un
 * quiz modifié entre deux sessions, qui rend une sélection d'options dont le
 * nombre a changé, qui renote au journal une question déjà notée, ou qu'une
 * photo corrompue empêche d'ouvrir le quiz.
 *     npm run check:session
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/session.ts", ({ photographier, restaurer, SESSION_VERSION }) => {
	const r = makeReporter("Session d'un quiz — photographier / restaurer");
	// Un quiz de six questions : choix unique, choix multiple, texte,
	// classement, appariement, carte mémoire (sélection toujours null).
	const ids = ["unique", "multiple", "texte", "classement", "appariement", "carte"];
	const base = {
		selections: [null, new Set(), "", [null, null, null], [null, null], null],
		shuffleMap: [[2, 0, 1], [1, 0, 3, 2], null, [2, 1, 0], { rows: [1, 0], choices: [0, 1] }, null],
	};
	const etat = {
		selections: [1, new Set([3, 0]), "print(1)", [2, 0, 1], [1, 0], null],
		shuffleMap: [[1, 2, 0], [3, 2, 1, 0], null, [0, 2, 1], { rows: [0, 1], choices: [1, 0] }, null],
		textOnlyAnswers: ["", "", "", "", "", "une liste"],
		textOnlyChecked: [false, false, false, false, false, true],
		textOnlyRatings: [null, null, null, null, null, "understood"],
		lessonPreSkipped: [false, false, false, false, false, false],
		hintSeen: [true, false, false, false, false, false],
		recorded: [true, true, false, false, false, true],
	};
	const photo = photographier(etat, ids, 3, 1000);
	r.check("la photo porte la version et l'heure", [photo.v, photo.ecrite], [SESSION_VERSION, 1000]);
	r.check("la question courante est un IDENTIFIANT", photo.courante, "classement");
	r.check("un Set devient un tableau trié", photo.questions.multiple.selection, [0, 3]);

	const retour = restaurer(JSON.parse(JSON.stringify(photo)), ids, base);
	r.check("aller-retour : la question courante", retour.courante, 3);
	r.check("aller-retour : choix unique", retour.selections[0], 1);
	r.check("aller-retour : le Set redevient un Set", retour.selections[1] instanceof Set && [...retour.selections[1]].sort(), [0, 3]);
	r.check("aller-retour : texte, classement, appariement", [retour.selections[2], retour.selections[3], retour.selections[4]], ["print(1)", [2, 0, 1], [1, 0]]);
	r.check("aller-retour : le mélange affiché", retour.shuffleMap[0], [1, 2, 0]);
	r.check("aller-retour : carte mémoire (réponse, vérifiée, note)", [retour.textOnlyAnswers[5], retour.textOnlyChecked[5], retour.textOnlyRatings[5]], ["une liste", true, "understood"]);
	r.check("aller-retour : indice vu, déjà journalisée", [retour.hintSeen[0], retour.recorded[0], retour.recorded[2]], [true, true, false]);

	// Le quiz a changé : « multiple » supprimée, « nouvelle » ajoutée en tête.
	const ids2 = ["nouvelle", "unique", "texte", "classement", "appariement", "carte"];
	const base2 = {
		selections: [null, null, "", [null, null, null], [null, null], null],
		shuffleMap: [[0, 1], [2, 0, 1], null, [2, 1, 0], { rows: [1, 0], choices: [0, 1] }, null],
	};
	const modif = restaurer(photo, ids2, base2);
	r.check("quiz modifié : la question courante suit son identifiant", modif.courante, 3);
	r.check("quiz modifié : une question nouvelle arrive vide", [modif.selections[0], modif.recorded[0]], [null, false]);
	r.check("quiz modifié : les autres réponses reviennent", [modif.selections[1], modif.selections[2]], [1, "print(1)"]);

	// Des options AJOUTÉES à « unique » : le mélange de 3 ne vaut plus pour 4.
	const base3 = { selections: base.selections, shuffleMap: [[3, 2, 0, 1], ...base.shuffleMap.slice(1)] };
	const opts = restaurer(photo, ids, base3);
	r.check("options ajoutées : mélange rejeté, sélection ignorée", [opts.shuffleMap[0], opts.selections[0]], [[3, 2, 0, 1], null]);

	// Seule « unique » a une réponse : la photo n'inscrit qu'elle (un mélange
	// seul n'est pas une réponse), et si la question courante a disparu, on
	// rouvre sur la première question sans réponse.
	const partielle = photographier({ ...etat,
		selections: [1, new Set(), "", [null, null, null], [null, null], null],
		textOnlyAnswers: ["", "", "", "", "", ""], textOnlyChecked: [false, false, false, false, false, false],
		textOnlyRatings: [null, null, null, null, null, null], hintSeen: [false, false, false, false, false, false],
		recorded: [false, false, false, false, false, false],
	}, ids, null, 1);
	r.check("une question sans réponse n'est pas inscrite", Object.keys(partielle.questions), ["unique"]);
	r.check("courante disparue : première question sans réponse", restaurer({ ...partielle, courante: "disparue" }, ids, base).courante, 1);

	// Texte à trous : un tableau de chaînes, de la longueur des trous.
	const trous = { selections: [["", ""]], shuffleMap: [null] };
	const photoTrous = photographier({ ...etat, selections: [["a", "b"]], shuffleMap: [null],
		textOnlyAnswers: [""], textOnlyChecked: [false], textOnlyRatings: [null], lessonPreSkipped: [false], hintSeen: [false], recorded: [false],
	}, ["trous"], 0, 1);
	r.check("aller-retour : texte à trous", restaurer(photoTrous, ["trous"], trous).selections[0], ["a", "b"]);
	r.check("texte à trous : un trou ajouté invalide la réponse", restaurer(photoTrous, ["trous"], { selections: [["", "", ""]], shuffleMap: [null] }).selections[0], ["", "", ""]);

	r.check("photo corrompue : null", restaurer("{pas du json", ids, base), null);
	r.check("version inconnue : null", restaurer({ ...photo, v: 99 }, ids, base), null);
	r.check("forme invalide : null", restaurer({ v: 1, courante: 3, questions: [] }, ids, base), null);
	r.check("sélection du mauvais type : ignorée", restaurer({ v: 1, courante: null, ecrite: 1, questions: { unique: { selection: "texte" } } }, ids, base).selections[0], null);
	r.check("indice hors bornes : ignoré", restaurer({ v: 1, courante: null, ecrite: 1, questions: { unique: { selection: 7 } } }, ids, base).selections[0], null);

	// Classement, appariement, carte mémoire : bornes additionnelles.
	r.check("classement : indice hors des items", restaurer({ v: 1, courante: null, ecrite: 1, questions: { classement: { selection: [99999, 0, 1] } } }, ids, base).selections[3], [null, null, null]);
	r.check("appariement : indice hors des choix", restaurer({ v: 1, courante: null, ecrite: 1, questions: { appariement: { selection: [5, 0] } } }, ids, base).selections[4], [null, null]);
	r.check("carte mémoire : number rejeté", restaurer({ v: 1, courante: null, ecrite: 1, questions: { carte: { selection: 42 } } }, ids, base).selections[5], null);

	/* THE LEARN RETRY LOOP (2026-09-29): verdicts, misses, the retry flag,
	   the queue and the resume point survive a closed app, by id. */
	const learn = {
		learnVerdicts: ["first", "missed", "retried", "none", "none", "missed"],
		learnMisses: [0, 2, 1, 0, 0, 1],
		learnRetrying: [false, true, false, false, false, false],
		learnChecked: [true, false, true, false, false, true],
		learnPending: [false, false, false, false, false, false],
		learnQueue: [{ qi: 5, since: 1 }],
		learnResume: 3,
		learnRetryQi: 1,
	};
	const photoLearn = photographier({ ...etat, ...learn }, ids, 1, 1);
	r.check("Learn: the queue and resume point are written by id", [photoLearn.file, photoLearn.suite], [[{ id: "carte", depuis: 1 }], "classement"]);
	const retourLearn = restaurer(JSON.parse(JSON.stringify(photoLearn)), ids, base);
	r.check("Learn round trip: verdicts, misses, retry flag, checked",
		[retourLearn.learnVerdicts, retourLearn.learnMisses, retourLearn.learnRetrying, retourLearn.learnChecked],
		[learn.learnVerdicts, learn.learnMisses, learn.learnRetrying, learn.learnChecked]);
	r.check("Learn round trip: the queue and resume point", [retourLearn.learnQueue, retourLearn.learnResume], [[{ qi: 5, since: 1 }], 3]);
	r.check("Learn: the retried question of the resume point, by id", [photoLearn.enReprise, retourLearn.learnRetryQi], ["multiple", 1]);
	r.check("Learn: a checked card whose options changed does not reopen checked",
		restaurer({ ...photoLearn, questions: { ...photoLearn.questions, unique: { ...photoLearn.questions.unique, melange: [0, 1] } } }, ids, base).learnChecked[0], false);
	r.check("Learn: past the end is kept", restaurer({ ...photoLearn, suite: "end" }, ids, base).learnResume, "end");
	r.check("Learn: a queued question removed from the quiz leaves the queue",
		restaurer({ ...photoLearn, file: [{ id: "disparue", depuis: 1 }, { id: "carte", depuis: 2 }] }, ids, base).learnQueue, [{ qi: 5, since: 2 }]);
	r.check("Learn: a malformed queue or verdict is ignored, the quiz still opens",
		(() => { const x = restaurer({ ...photoLearn, file: "x", suite: 7, questions: { unique: { verdict: "bravo", ratees: -1 } } }, ids, base); return [x.learnQueue, x.learnResume, x.learnVerdicts[0], x.learnMisses[0]]; })(),
		[[], null, "none", 0]);
	const ancienne = restaurer(photo, ids, base);
	r.check("a snapshot from before the retry loop restores with no verdict and an empty queue",
		[ancienne.learnVerdicts.every(v => v === "none"), ancienne.learnQueue, ancienne.learnResume], [true, [], null]);
	r.done();
});

/* A TEST'S SETUP AND ITS CLOCK (spec 2026-09-29-test-setup-modal-design.md
   §3): a timed test left mid-way keeps its settings and the milliseconds
   LEFT on its clock (paused while away); a snapshot restores both, and the
   engine then skips the launch modal. A snapshot from before the setup
   existed resumes as hints on, no time limit. */
await withSrcModule("src/engine/session.ts", ({ photographier, restaurer }) => {
	const r = makeReporter("Session — a Test's setup and time left");
	const ids = ["a", "b"];
	const base = { selections: [null, null], shuffleMap: [[1, 0], null] };
	const etat = {
		selections: [1, null], shuffleMap: [[1, 0], null],
		textOnlyAnswers: ["", ""], textOnlyChecked: [false, false], textOnlyRatings: [null, null],
		lessonPreSkipped: [false, false], hintSeen: [false, false], recorded: [false, false],
	};
	const rond = (photo) => restaurer(JSON.parse(JSON.stringify(photo)), ids, base);

	const timed = photographier(etat, ids, 1, 5, { setup: { hints: false, timeLimitMinutes: 30 }, msLeft: 754_321 });
	r.check("a timed snapshot keeps the setup and the time left",
		[timed.setup, timed.msLeft], [{ hints: false, timeLimitMinutes: 30 }, 754_321]);
	r.check("restoring it gives the same setup and time left, not the full duration",
		rond(timed).test, { setup: { hints: false, timeLimitMinutes: 30 }, msLeft: 754_321 });

	const untimed = photographier(etat, ids, 1, 5, { setup: { hints: false, timeLimitMinutes: null }, msLeft: null });
	r.check("a test without a time limit keeps its hints setting and has no time left",
		[rond(untimed).test, "msLeft" in untimed], [{ setup: { hints: false, timeLimitMinutes: null }, msLeft: null }, false]);
	const plainWithHints = photographier(etat, ids, 1, 5, { setup: { hints: true, timeLimitMinutes: 10 }, msLeft: 1000 });
	r.check("a timed test that kept its hints resumes with them",
		rond(plainWithHints).test, { setup: { hints: true, timeLimitMinutes: 10 }, msLeft: 1000 });

	const ancienne = photographier(etat, ids, 1, 5);
	r.check("a host without a setup writes none", ["setup" in ancienne, "msLeft" in ancienne], [false, false]);
	r.check("a snapshot written before the setup existed resumes as hints on, no time limit",
		rond(ancienne).test, { setup: { hints: true, timeLimitMinutes: null }, msLeft: null });

	const abime = (extra) => restaurer({ ...JSON.parse(JSON.stringify(timed)), ...extra }, ids, base).test;
	r.check("a malformed setup gives a plain test, the answers are kept",
		[abime({ setup: { hints: "non", timeLimitMinutes: 30 } }), restaurer({ ...timed, setup: 7 }, ids, base).selections[0]],
		[{ setup: { hints: true, timeLimitMinutes: null }, msLeft: null }, 1]);
	r.check("a timed setup without a usable time left restarts on the whole duration",
		[abime({ msLeft: undefined }).msLeft, abime({ msLeft: "vite" }).msLeft, abime({ msLeft: -5 }).msLeft, abime({ msLeft: NaN }).msLeft],
		[1_800_000, 1_800_000, 1_800_000, 1_800_000]);
	r.check("a time left above the duration is bounded by it, zero stays zero",
		[abime({ msLeft: 99_999_999 }).msLeft, abime({ msLeft: 0 }).msLeft], [1_800_000, 0]);
	r.check("the setup does not leak into the restored answers",
		Object.keys(rond(timed)).includes("selections") && !("setup" in rond(timed)), true);
	r.done();
});

/* WHAT IS SNAPSHOTTED (spec 2026-09-29-test-setup-modal-design.md §3): a
   test played with a setup closed mid-way resumes where it was left,
   answers, hint use and — when timed — its clock included (the round trips
   above); only an Exam played the legacy way, from its start screen (a host
   without a setup), is never snapshotted; a handed-in test is over. */
await withSrcModule("src/engine/session.ts", ({ canSnapshot }) => {
	const r = makeReporter("Session — what is snapshotted");
	r.check("a test on a question, not handed in: snapshotted", canSnapshot({ exam: false, locked: false, onQuestion: true }), true);
	r.check("a legacy Exam (no host setup), even mid-way: never", canSnapshot({ exam: true, locked: false, onQuestion: true }), false);
	r.check("handed in, or off a question: never",
		[canSnapshot({ exam: false, locked: true, onQuestion: true }), canSnapshot({ exam: false, locked: false, onQuestion: false })], [false, false]);
	r.done();
});

/* Resume mid-step (spec 2026-10-07-learn-scroll §3): the snapshot is by question
   id, so a page keeps its answers, its verdicts and its pending retry; a
   snapshot of the one-slide-per-question era (current = a middle card of a
   step) still names a card the engine maps onto its step page. */
await withSrcModule("src/engine/session.ts", ({ photographier, restaurer }) => {
	const r = makeReporter("Session - mid-step resume");
	const ids = ["a", "b", "c", "d", "e"];
	const n = ids.length;
	const maps = [null, [1, 0, 2], null, [2, 0, 1], null];
	const base = { selections: new Array(n).fill(null), shuffleMap: maps };
	const etat = {
		selections: [null, 1, null, 0, null],
		shuffleMap: maps,
		textOnlyAnswers: new Array(n).fill(""), textOnlyChecked: new Array(n).fill(false),
		textOnlyRatings: new Array(n).fill(null), lessonPreSkipped: new Array(n).fill(false),
		hintSeen: new Array(n).fill(false), recorded: [false, true, false, true, false],
		learnVerdicts: ["none", "missed", "none", "first", "none"], learnMisses: [0, 1, 0, 0, 0],
		learnRetrying: [false, true, false, false, false], learnChecked: [false, false, false, true, false],
		learnPending: new Array(n).fill(false), learnQueue: [{ qi: 4, since: 1 }],
		learnResume: 4, learnRetryQi: 1,
	};
	const back = restaurer(JSON.parse(JSON.stringify(photographier(etat, ids, 3, 5))), ids, base);
	r.check("step 2 (cards c,d) restores on the card named", back.courante, 3);
	r.check("answers and verdicts of the page", [back.selections[3], back.learnVerdicts[3], back.learnChecked[3]], [0, "first", true]);
	r.check("the pending retry stays open, with its resume point", [back.learnRetrying[1], back.learnVerdicts[1], back.learnResume, back.learnRetryQi], [true, "missed", 4, 1]);
	r.check("the queue keeps its lag", back.learnQueue, [{ qi: 4, since: 1 }]);
	r.done();
});

/* The right answer of a question changed under the learner (the assistant
   chat, 2026-10-09): its judgement is withdrawn, the answer kept to be judged
   again, the question marked to review in a Learn, the journal flag kept so
   that no second review line is written. */
await withSrcModule("src/engine/session.ts", ({ photographier, restaurer, marquerARevoir }) => {
	const r = makeReporter("Session - a right answer changed");
	const ids = ["a", "b", "c"];
	const n = ids.length;
	const maps = [[1, 0, 2], [0, 1], null];
	const base = { selections: [null, null, ""], shuffleMap: maps };
	const etat = {
		selections: [1, 0, ""], shuffleMap: maps,
		textOnlyAnswers: ["", "", "str"], textOnlyChecked: [false, false, true],
		textOnlyRatings: [null, null, "understood"], lessonPreSkipped: new Array(n).fill(false),
		hintSeen: [true, false, false], recorded: [true, true, true],
		learnVerdicts: ["first", "missed", "none"], learnMisses: [0, 1, 0],
		learnRetrying: new Array(n).fill(false), learnChecked: [true, true, false],
		learnPending: new Array(n).fill(false), learnQueue: [{ qi: 1, since: 2 }],
		learnResume: null, learnRetryQi: null,
	};
	const photo = photographier(etat, ids, 0, 5);
	const apres = marquerARevoir(photo, "a", 7);
	const back = restaurer(JSON.parse(JSON.stringify(apres)), ids, base);
	r.check("the answer stays, its check is withdrawn", [back.selections[0], back.learnChecked[0]], [1, false]);
	r.check("in a Learn it is marked to review: missed, back in the retry queue", [back.learnVerdicts[0], back.learnMisses[0], back.learnQueue.map(e => e.qi)], ["missed", 1, [1, 0]]);
	r.check("the journal flag and the hint use stay (no second review line)", [back.recorded[0], back.hintSeen[0]], [true, true]);
	r.check("the other questions are untouched", [back.learnVerdicts[1], back.learnChecked[1], back.learnQueue[0]], ["missed", true, { qi: 1, since: 2 }]);
	const texte = restaurer(marquerARevoir(photo, "c", 7), ids, base);
	r.check("a written answer keeps its text, its check and rating are withdrawn, no verdict invented",
		[texte.textOnlyAnswers[2], texte.textOnlyChecked[2], texte.textOnlyRatings[2], texte.learnVerdicts[2], texte.learnQueue.length], ["str", false, null, "none", 1]);
	r.check("the withdrawal is stamped on that question only", [apres.questions.a.rejugee, apres.questions.b.rejugee], [7, undefined]);
	const oubliee = marquerARevoir(photo, "a", 7, true);
	const backO = restaurer(JSON.parse(JSON.stringify(oubliee)), ids, base);
	r.check("options that moved: the answer and its shuffle are dropped, the question still marked to review",
		[oubliee.questions.a.selection, oubliee.questions.a.melange, backO.selections[0], backO.learnVerdicts[0], backO.recorded[0]], [undefined, undefined, null, "missed", true]);
	r.check("a question without state, or unknown, leaves the snapshot as it was", [marquerARevoir(photo, "zz", 7), photo.questions.a.verdict], [photo, "first"]);
	r.done();
});
