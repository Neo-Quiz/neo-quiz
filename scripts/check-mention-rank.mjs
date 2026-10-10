/**
 * THE RANKING OF THE « @ » PICKER (`src/dashboard/mention-rank.ts`), on the
 * real code.
 *
 * What it prevents: `@` alone listing the vault root instead of the
 * composer's folder; a word matching anywhere in a path (`@C` putting other
 * subjects' folders and the app's own Generated notes ahead of the course
 * PDF of the current folder); accents or case breaking a match; several words
 * not all required; the app's own folders (`.neo-quiz`, `.trash`, `Figures/`,
 * `Generated/`) cluttering the list unless a typed word names them.
 *
 *     npm run check:mention-rank
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/mention-rank.ts", (S) => {
	const r = makeReporter("Mention ranking");
	const e = (path, { folder = false, mtime } = {}) => ({
		name: path.split("/").pop(), path, isFolder: folder, ...(mtime === undefined ? {} : { mtime }),
	});
	const DIR = "XTI303 - Conception & Architecture logicielle";
	const COURS = "CM1 Conception et architecture des systèmes informatiques.pdf";
	const corpus = [
		e(`${DIR}/${COURS}`, { mtime: 100 }),
		e(`${DIR}/TD2.md`, { mtime: 900 }),
		e(`${DIR}/TD2 — Practice.md`, { mtime: 999 }),
		e(`${DIR}/Figures`, { folder: true, mtime: 5000 }),
		e(`${DIR}/Figures/schema.png`, { mtime: 4000 }),
		e(`${DIR}/Sous-dossier`, { folder: true }),
		e(`${DIR}/Sous-dossier/Notes ecosysteme.md`, { mtime: 50 }),
		e("XTI201 - CCNA 1", { folder: true, mtime: 7000 }),
		e("XTI201 - CCNA 1/CM3 réseau.pdf", { mtime: 8000 }),
		e("XTI202 - Cybersécurité", { folder: true }),
		e("XTI202 - Cybersécurité/CM1 sécurité.pdf", { mtime: 6000 }),
		e("Generated", { folder: true, mtime: 9000 }),
		e("Generated/CM3 — Practice.md", { mtime: 9500 }),
		e(".neo-quiz", { folder: true, mtime: 9800 }),
		e(".neo-quiz/review-log.jsonl", { mtime: 9700 }),
		e(".trash", { folder: true }),
		e(".trash/old.md", { mtime: 9600 }),
		e("Écosystème Python/cours.md", { mtime: 10 }),
	];
	const names = (list) => list.map(x => x.path);

	// `@` alone: the contents of the current folder, files then folders, courses before quizzes, newest first.
	r.check("@ alone lists the current folder's direct children only",
		names(S.rankMentions(corpus, "", DIR)),
		// Courses first (TD2.md, newer, then the PDF), the quiz note after them, folders last. Figures hidden.
		[`${DIR}/TD2.md`, `${DIR}/${COURS}`, `${DIR}/TD2 — Practice.md`, `${DIR}/Sous-dossier`]);
	r.check("@ alone at the root: root children, the app's folders hidden",
		names(S.rankMentions(corpus, "", "")),
		["XTI201 - CCNA 1", "XTI202 - Cybersécurité"]);
	r.check("@ alone never lists a sub-folder's files",
		names(S.rankMentions(corpus, "", DIR)).some(p => p.includes("Notes ecosysteme")), false);

	// The user's case: "@C" puts the course PDF of the current folder first.
	const c = names(S.rankMentions(corpus, "C", DIR));
	r.check("@C: the course PDF of the current folder comes first", c[0], `${DIR}/${COURS}`);
	r.check("@C: other subjects' folders still match, after the current folder",
		c.indexOf("XTI201 - CCNA 1") > c.indexOf(`${DIR}/${COURS}`) && c.includes("XTI202 - Cybersécurité"), true);
	r.check("@C: Generated quiz notes stay hidden", c.some(p => p.startsWith("Generated/")), false);
	r.check("@C: .neo-quiz and .trash stay hidden", c.some(p => p.startsWith(".")), false);
	r.check("@C: a file inside Figures stays hidden", c.some(p => p.includes("Figures")), false);

	// Name match quality.
	const tiers = S.rankMentions([
		e("a/zz xcm1 contains.md", { mtime: 1 }),     // substring of name
		e("a/zz cm1 word.md", { mtime: 1 }),          // word of name
		e("a/cm1 starts.md", { mtime: 1 }),           // name starts
		e("cm1/only path.md", { mtime: 1 }),          // path only
	], "cm1", "").map(x => x.name);
	r.check("tiers: starts the name > a word of the name > inside the name > path only",
		tiers, ["cm1 starts.md", "zz cm1 word.md", "zz xcm1 contains.md", "only path.md"]);

	r.check("ties: the current folder before the rest, then the most recent",
		names(S.rankMentions([e("x/Alpha.md", { mtime: 1 }), e("cur/Alpha.md", { mtime: 2 }), e("y/Alpha.md", { mtime: 9 })], "alpha", "cur")),
		["cur/Alpha.md", "y/Alpha.md", "x/Alpha.md"]);
	/* 2026-10-11, the owner's "@CM": two quiz notes (one a broken one-question
	   quiz) came above every lecture PDF, and CM5, CM4, CM3 followed the dates. */
	r.check("@CM: courses before quiz notes, then CM1, CM2, CM3… in natural order",
		names(S.rankMentions([
			e("cur/CM1 Conception — Learn.md", { mtime: 99 }),
			e("cur/CM5 Conception.pdf", { mtime: 50 }),
			e("cur/CM10 Conception.pdf", { mtime: 60 }),
			e("cur/CM2 Conception.pdf", { mtime: 10 }),
			e("cur/CM1 Conception.pdf", { mtime: 5 }),
		], "CM", "cur")),
		["cur/CM1 Conception.pdf", "cur/CM2 Conception.pdf", "cur/CM5 Conception.pdf", "cur/CM10 Conception.pdf", "cur/CM1 Conception — Learn.md"]);
	r.check("ties: a sub-folder of the current folder counts as current",
		names(S.rankMentions([e("x/Alpha.md", { mtime: 9 }), e("cur/sub/Alpha.md", { mtime: 1 })], "alpha", "cur")),
		["cur/sub/Alpha.md", "x/Alpha.md"]);

	// Case and accents.
	// The word in a NAME (« Notes ecosysteme ») outranks the path-only match of « Écosystème Python/cours.md ».
	r.check("accents: \"ecosysteme\" finds \"Écosystème\" (name word first, path-only match after)",
		names(S.rankMentions(corpus, "ecosysteme", "")), [`${DIR}/Sous-dossier/Notes ecosysteme.md`, "Écosystème Python/cours.md"]);
	r.check("case: \"ÉCO\" finds the same",
		names(S.rankMentions(corpus, "ÉCO", "")).length, names(S.rankMentions(corpus, "eco", "")).length);

	// Several words: all required, the first one ranks.
	r.check("several words: \"cm1 conc\" finds the course, not the other CM1",
		names(S.rankMentions(corpus, "cm1 conc", DIR)), [`${DIR}/${COURS}`]);
	r.check("several words: a word missing from the path excludes the entry",
		names(S.rankMentions(corpus, "cm1 kubernetes", DIR)), []);

	// Noise, unless a typed word names it.
	r.check("Figures shown when typed", names(S.rankMentions(corpus, "figures", DIR)).includes(`${DIR}/Figures`), true);
	r.check("Generated shown when typed", names(S.rankMentions(corpus, "generated", "")).includes("Generated"), true);
	r.check("Generated quiz shown when its folder is typed", names(S.rankMentions(corpus, "generated/cm3", "")), ["Generated/CM3 — Practice.md"]);
	r.check(".neo-quiz shown when typed", names(S.rankMentions(corpus, "neo", "")).includes(".neo-quiz"), true);
	r.check("the input array is not mutated", (() => { const l = [e("b/z.md"), e("a/y.md")]; S.rankMentions(l, "", "a"); return names(l); })(), ["b/z.md", "a/y.md"]);

	// Listing of a typed folder: courses before quizzes, newest first.
	r.check("listing of a typed folder: courses before quizzes, then newest first",
		S.orderListing([e("d/Quiz — Practice.md", { mtime: 99 }), e("d/Cours.md", { mtime: 1 }), e("d/Plus recent.pdf", { mtime: 50 })], "d/").map(x => x.name),
		["Plus recent.pdf", "Cours.md", "Quiz — Practice.md"]);

	r.done();
});
