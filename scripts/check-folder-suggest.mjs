/**
 * THE ORDER OF THE DESTINATION FOLDERS AND THEIR SUGGESTIONS
 * (`src/dashboard/folder-suggest.ts`), on the real code.
 *
 * What it prevents: the picker listing folders in an arbitrary order instead
 * of most recently changed first; a request word matching across an accent
 * ("ecosysteme"), or only as a whole-string match; a folder whose NAME matches
 * ranking below one that only holds a matching file; stop words ("les",
 * "quiz") suggesting every folder; the folder already chosen being suggested
 * again; and an unstable order among equals.
 *
 *     npm run check:folder-suggest
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/folder-suggest.ts", (S) => {
	const r = makeReporter("Folder suggestions");
	const F = (path, name = path.split("/").pop()) => ({ path, name });
	const f = (path, mtime, title = path.split("/").pop()) => ({ path, mtime, title });
	const folders = [F("Neo Quiz/XTI301 - Écosystème Python"), F("Neo Quiz/XTI303 - Architecture"), F("Neo Quiz/XTI305 - Ethical Hacking"), F("Neo Quiz/Generated")];
	const files = [
		f("Neo Quiz/XTI301 - Écosystème Python/CM1.md", 100, "CM1 Variables"),
		f("Neo Quiz/XTI301 - Écosystème Python/TP.md", 500, "TP NumPy et Pandas"),
		f("Neo Quiz/XTI303 - Architecture/CM2.md", 300, "Modélisation UML et Python"),
		f("Neo Quiz/XTI305 - Ethical Hacking/CM.md", 900, "OSINT"),
	];

	r.check("order: latest change of any file first, an empty folder last",
		S.rankFolders(folders, files).map(x => x.name), ["XTI305 - Ethical Hacking", "XTI301 - Écosystème Python", "XTI303 - Architecture", "Generated"]);
	r.check("order: a file in a sibling folder with a shared name prefix does not count", S.recency([F("a/b"), F("a/b2")], [f("a/b2/x.md", 50)]).get("a/b"), 0);
	r.check("order: ties fall back on the name, accents ignored", S.rankFolders([F("x/zeta"), F("x/Éclair"), F("x/alpha")], []).map(x => x.name), ["alpha", "Éclair", "zeta"]);
	r.check("order: the input list is not mutated", (() => { const l = [F("a/z"), F("a/b")]; S.rankFolders(l, []); return l.map(x => x.name); })(), ["z", "b"]);

	const sug = (text, opts) => S.suggestFolders(text, folders, files, opts).map(x => x.name);
	r.check("name word: \"python\" finds the folder named after it first, then the folder with a Python title",
		sug("fais-moi un quiz sur python"), ["XTI301 - Écosystème Python", "XTI303 - Architecture"]);
	r.check("accents and case: \"ECOSYSTEME\" matches \"Écosystème\"", sug("L'ECOSYSTEME"), ["XTI301 - Écosystème Python"]);
	r.check("word start: \"archi\" matches \"Architecture\"", sug("archi logicielle"), ["XTI303 - Architecture"]);
	r.check("substring inside a name ranks under a word match", S.suggestFolders("thical", [F("a/Ethical Hacking"), F("a/thical sense")], []).map(x => x.name), ["thical sense", "Ethical Hacking"]);
	r.check("a title match ranks under a name match even when more recent", S.suggestFolders("uml", [F("a/UML"), F("a/Other")], [f("a/Other/x.md", 999, "UML intro"), f("a/UML/y.md", 1, "y")]).map(x => x.name), ["UML", "Other"]);
	r.check("among equal matches the most recent comes first", S.suggestFolders("python", [F("a/Python 1"), F("a/Python 2")], [f("a/Python 1/x.md", 10), f("a/Python 2/x.md", 20)]).map(x => x.name), ["Python 2", "Python 1"]);
	r.check("stop words and quiz words match nothing", [sug("les des pour quiz qcm test cours"), sug("")], [[], []]);
	r.check("words under 3 letters match nothing", sug("py"), []);
	r.check("at most 3 suggestions by default, `limit` respected", [S.suggestFolders("python", [F("a/p1 python"), F("a/p2 python"), F("a/p3 python"), F("a/p4 python")], []).length, S.suggestFolders("python", [F("a/p1 python"), F("a/p2 python")], [], { limit: 1 }).length], [3, 1]);
	r.check("the folder already chosen is not suggested", sug("python", { except: "Neo Quiz/XTI301 - Écosystème Python" }), ["XTI303 - Architecture"]);
	r.check("nothing matching gives nothing", sug("kubernetes"), []);
	r.check("request words: folded, 3+ letters, no duplicates, no stop words", S.requestWords("Python, PYTHON et les Décorateurs de quiz"), ["python", "decorateurs"]);
	r.done();
});
