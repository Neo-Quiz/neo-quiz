/**
 * THE LEARNER'S FOLDERS AND WHERE A GENERATED QUIZ GOES
 * (`src/dashboard/folder-suggest.ts`, `src/dashboard/folder-choice.ts`), on the
 * real code.
 *
 * What it prevents: the folders handed to the clarify call in an arbitrary
 * order instead of most recently changed first; and, since the "Generated"
 * folder is gone (2026-10-17), a quiz filed in the wrong place: a folder name
 * from the model or the learner that becomes a PATH (a separator, a `..`, a
 * drive, a reserved Windows name); "Python" doubled as "python (2)" instead of
 * reusing the folder; attachments spread over two courses filed in one of them
 * (or in their common parent); a new folder created at the root while the
 * current school-year folder exists, or in an old year's folder.
 *
 *     npm run check:folder-suggest
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/folder-suggest.ts", "src/dashboard/folder-choice.ts", "src/dashboard/module-icons.ts"], (S, C, MI) => {
	const r = makeReporter("Folder order and choice");
	const F = (path, name = path.split("/").pop()) => ({ path, name });
	const f = (path, mtime, title = path.split("/").pop()) => ({ path, mtime, title });
	const folders = [F("Neo Quiz/XTI301 - Écosystème Python"), F("Neo Quiz/XTI303 - Architecture"), F("Neo Quiz/XTI305 - Ethical Hacking"), F("Neo Quiz/Empty")];
	const files = [
		f("Neo Quiz/XTI301 - Écosystème Python/CM1.md", 100, "CM1 Variables"),
		f("Neo Quiz/XTI301 - Écosystème Python/TP.md", 500, "TP NumPy et Pandas"),
		f("Neo Quiz/XTI303 - Architecture/CM2.md", 300, "Modélisation UML et Python"),
		f("Neo Quiz/XTI305 - Ethical Hacking/CM.md", 900, "OSINT"),
	];

	/* ── The order the clarify call reads the folders in ── */
	r.check("order: latest change of any file first, an empty folder last",
		S.rankFolders(folders, files).map(x => x.name), ["XTI305 - Ethical Hacking", "XTI301 - Écosystème Python", "XTI303 - Architecture", "Empty"]);
	r.check("order: a file in a sibling folder with a shared name prefix does not count", S.recency([F("a/b"), F("a/b2")], [f("a/b2/x.md", 50)]).get("a/b"), 0);
	r.check("order: ties fall back on the name, accents ignored", S.rankFolders([F("x/zeta"), F("x/Éclair"), F("x/alpha")], []).map(x => x.name), ["alpha", "Éclair", "zeta"]);
	r.check("order: a folder's own date (a PDF just added) counts when later than its notes",
		S.rankFolders([F("a/pdfs"), F("a/notes")], [f("a/notes/x.md", 100)], new Map([["a/pdfs", 200], ["a/notes", 50]])).map(x => x.name), ["pdfs", "notes"]);
	r.check("order: the input list is not mutated", (() => { const l = [F("a/z"), F("a/b")]; S.rankFolders(l, []); return l.map(x => x.name); })(), ["z", "b"]);

	/* ── A folder name proposed by the model or typed by the learner ── */
	r.check("name: a plain name is kept, NFC", C.safeFolderName("Re\u0301seaux"), "Réseaux");
	r.check("name: separators of both kinds never survive",
		["a/b", "a\\b", "/abs", "C:\\Windows", "..\\..\\x", "../x"].map(C.safeFolderName).map(n => n === null || !/[\\/]/.test(n)), [true, true, true, true, true, true]);
	r.check("name: a `..` never survives, a lone `..` or `.` is nothing",
		[C.safeFolderName(".."), C.safeFolderName("."), C.safeFolderName("a..b")?.includes(".."), C.safeFolderName("../../etc")?.includes("..")], [null, null, false, false]);
	r.check("name: reserved Windows names and empty names are refused",
		["CON", "con.txt", "NUL", "   ", "", "__proto__"].map(C.safeFolderName), [null, null, null, null, null, null]);
	r.check("name: forbidden characters become dashes, a long name is cut to 100",
		[C.safeFolderName("Q: why?"), C.safeFolderName("x".repeat(150)).length], ["Q- why-", 100]);

	/* ── Matching an existing folder ── */
	const known = [F("NQ/B2 2026-2027/Python"), F("NQ/Old/Python"), F("NQ/B2 2026-2027/XTI301 - Écosystème Python", "XTI301 Python")];
	r.check("match: case and Unicode form ignored",
		[C.findFolderByName("PYTHON", known)?.path, C.findFolderByName("python ", known)?.path], ["NQ/B2 2026-2027/Python", "NQ/B2 2026-2027/Python"]);
	r.check("match: the displayed name or the folder's own segment",
		[C.findFolderByName("XTI301 Python", known)?.path, C.findFolderByName("XTI301 - Écosystème Python", known)?.path],
		["NQ/B2 2026-2027/XTI301 - Écosystème Python", "NQ/B2 2026-2027/XTI301 - Écosystème Python"]);
	r.check("match: several of that name, the one under the preferred parent",
		C.findFolderByName("python", [known[1], known[0]], "NQ/B2 2026-2027")?.path, "NQ/B2 2026-2027/Python");
	r.check("match: nothing matching, or an empty name, is null",
		[C.findFolderByName("Rust", known), C.findFolderByName("", known)], [null, null]);
	r.check("match: a name compared the way the file system does", C.sameFolderName("Re\u0301seaux", "RÉSEAUX"), true);

	/* ── The attachments' folder ── */
	const courses = [F("NQ/B2/XTI301"), F("NQ/B2/XTI301/Session 1"), F("NQ/B2/XTI303"), F("NQ/B2")];
	r.check("attachments: the deepest known folder holding all of them",
		C.folderOfAttachments(["NQ/B2/XTI301/Session 1/cm1.pdf", "NQ/B2/XTI301/Session 1/cm2.pdf"], courses)?.path, "NQ/B2/XTI301/Session 1");
	r.check("attachments: two sessions of one course give the course",
		C.folderOfAttachments(["NQ/B2/XTI301/Session 1/cm1.pdf", "NQ/B2/XTI301/cm2.pdf"], courses)?.path, "NQ/B2/XTI301");
	r.check("attachments: spread over two courses, the common year folder is NOT a course: only a known folder counts",
		C.folderOfAttachments(["NQ/B2/XTI301/a.pdf", "NQ/B2/XTI303/b.pdf"], courses.filter(x => x.path !== "NQ/B2")), null);
	r.check("attachments: none with a path, or outside every known folder, give null",
		[C.folderOfAttachments([undefined, ""], courses), C.folderOfAttachments(["C:/Users/x/Downloads/a.pdf"], courses)], [null, null]);
	r.check("attachments: a sibling folder sharing a name prefix does not hold it",
		C.folderOfAttachments(["NQ/B2/XTI3010/a.pdf"], [F("NQ/B2/XTI301")]), null);

	/* ── Where a NEW folder goes ── */
	const OCT_2026 = new Date(2026, 9, 17);
	r.check("year: the folder dated with the current school year",
		C.yearFolderForNewFolder(["Fichiers", "B1 2025-2026", "B2 2026-2027", "Dashboard"], OCT_2026), "B2 2026-2027");
	r.check("year: the parenthesised form is read too",
		C.yearFolderForNewFolder(["B1 (2025-2026)", "B2 (2026-2027)"], OCT_2026), "B2 (2026-2027)");
	r.check("year: no folder of this year, the highest level (the learner's latest year)",
		C.yearFolderForNewFolder(["B1 2024-2025", "B2 2025-2026"], OCT_2026), "B2 2025-2026");
	r.check("year: undated year folders, the highest level",
		C.yearFolderForNewFolder(["B1 Cours", "B3 Cours", "B2 Cours"], OCT_2026), "B3 Cours");
	r.check("year: no year folder, the root (null)",
		C.yearFolderForNewFolder(["Generated", "XTI301 - Python", "Bonus"], OCT_2026), null);
	r.check("year: in August the school year is still the previous one",
		C.yearFolderForNewFolder(["B1 2025-2026", "B2 2026-2027"], new Date(2026, 7, 20)), "B1 2025-2026");
	r.check("path: inside the year folder, or at the root",
		[C.newFolderLocalPath("Python", "B2 2026-2027"), C.newFolderLocalPath("Python", null)], ["B2 2026-2027/Python", "Python"]);

	/* ── The fallback folder and the prompt's list ── */
	r.check("fallback: the subject's label, the generic name for no subject or an unusable label",
		[C.fallbackFolderName("python", "Python", "Quizzes"), C.fallbackFolderName("general", "General", "Quizzes"), C.fallbackFolderName("web", "Web / HTML", "Quizzes"), C.fallbackFolderName("x", "CON", "Quiz")],
		["Python", "Quizzes", "Web HTML", "Quiz"]);
	r.check("prompt: one name per distinct folder name, in the given order, capped",
		[C.folderNamesForPrompt([F("a/Python"), F("b/python"), F("c/Rust", "Rust"), F("d/Go")], 2)], [["Python", "Rust"]]);

	/* ── The AI's icon for a NEW folder ── */
	r.check("icon: kept only for a folder just created and a known id",
		[C.iconForNewFolder(true, "flask-conical", MI.MODULE_ICONS), C.iconForNewFolder(true, "nope", MI.MODULE_ICONS), C.iconForNewFolder(true, undefined, MI.MODULE_ICONS), C.iconForNewFolder(true, "__proto__", MI.MODULE_ICONS)],
		["flask-conical", null, null, null]);
	r.check("icon: an existing folder's icon is never touched", C.iconForNewFolder(false, "flask-conical", MI.MODULE_ICONS), null);

	r.done();
});
