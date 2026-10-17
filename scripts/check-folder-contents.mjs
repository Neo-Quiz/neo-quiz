/**
 * LE CONTENU D'UN DOSSIER — documents, notes, liens (`src/dashboard/
 * folder-contents.ts`), la partie PURE : le tri des entrées, la grammaire de
 * `Liens.md`, et ce que « Créer avec l'IA » joint depuis un dossier.
 *
 * Trois défauts que ce script empêche :
 * - un QUIZ compté comme une note (il serait joint DEUX fois à la génération :
 *   une fois par la grille, une fois par « Notes »), ou `Liens.md` joint comme
 *   une source de texte ;
 * - un lien écrit sous une forme que la lecture ne reconnaît plus — la note
 *   est relue à chaque rendu, une puce illisible est un lien perdu sans
 *   message ;
 * - une URL qui n'en est pas une écrite dans un fichier de l'utilisateur.
 *
 *     npm run check:folder-contents
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/folder-contents.ts", async ({ trierContenu, parseLiens, ligneDeLien, urlValide, titreDepuisUrl, cheminsAJoindre, sansLien, LIENS_NOTE, LIENS_MOODLE_NOTE, noteLiensMoodle }) => {
	const r = makeReporter("Contenu d'un dossier — tri, liens, sources");

	const e = (name, isFolder = false) => ({ name, path: `Efrei/XTI301/${name}`, isFolder });
	const entrees = [
		e("TP2.pdf"), e("cm1 - Introduction.pdf"), e("Quiz Python.md"), e("TP1.md"), e("TP1", true),
		e(".neo-quiz", true), e(".DS_Store"), e(LIENS_NOTE), e("schema.PNG"), e(LIENS_MOODLE_NOTE),
	];
	const tri = trierContenu(entrees, (path) => path.endsWith("Quiz Python.md"));

	r.check("les documents sont tout ce qui n'est ni note ni dossier, triés sans égard à la casse",
		tri.documents.map(d => d.name), ["cm1 - Introduction.pdf", "schema.PNG", "TP2.pdf"]);
	r.check("les notes sont les .md qui ne sont PAS des quiz", tri.notes.map(n => n.name), ["TP1.md"]);
	r.check("Liens.md est mise à part, jamais listée comme une note", tri.liensNote?.name, LIENS_NOTE);
	r.check("Liens Moodle.md (written by the app) is set apart too, never a note nor a source", [tri.liensMoodleNote?.name, tri.notes.some(n => n.name === LIENS_MOODLE_NOTE)], [LIENS_MOODLE_NOTE, false]);
	{
		const liens = [{ title: "Cours / TPs [S3]", url: "https://drive.example.com/d/a(b)?x=1" }, { title: "Annonces", url: "https://moodle.example.fr/mod/url/view.php?id=4" }];
		const relu = parseLiens(noteLiensMoodle(liens));
		r.check("Liens Moodle.md reads back: a ] in a title or a ) in an address never breaks a link", relu.map(l => [l.title, l.url]),
			[["Cours / TPs (S3)", "https://drive.example.com/d/a(b%29?x=1"], ["Annonces", "https://moodle.example.fr/mod/url/view.php?id=4"]]);
	}
	r.check("les dossiers et les fichiers cachés n'apparaissent nulle part",
		[...tri.documents, ...tri.notes].some(x => x.isFolder || x.name.startsWith(".")), false);

	r.check("« Créer avec l'IA » joint les documents PUIS les notes, jamais Liens.md ni un quiz",
		cheminsAJoindre(tri),
		["Efrei/XTI301/cm1 - Introduction.pdf", "Efrei/XTI301/schema.PNG", "Efrei/XTI301/TP2.pdf", "Efrei/XTI301/TP1.md"]);

	/* La grammaire de Liens.md : ce qu'on écrit se relit, et ce qu'Ahmed
	   écrit à la main aussi. */
	const note = [
		"# Mes liens",
		"- [Cours Python](https://docs.python.org/3/tutorial/)",
		"- https://www.youtube.com/watch?v=abc",
		"<https://example.org/page?x=1&y=2>",
		"* [](https://sans-titre.fr)",
		"- [pas un lien](ftp://ailleurs)",
		"juste une phrase",
		"",
	].join("\n");
	r.check("une puce titrée, une puce nue, une URL entre chevrons, une étoile : quatre liens",
		parseLiens(note).map(l => l.url),
		["https://docs.python.org/3/tutorial/", "https://www.youtube.com/watch?v=abc", "https://example.org/page?x=1&y=2", "https://sans-titre.fr"]);
	r.check("le titre vient du crochet, sinon c'est l'URL",
		parseLiens(note).map(l => l.title),
		["Cours Python", "https://www.youtube.com/watch?v=abc", "https://example.org/page?x=1&y=2", "https://sans-titre.fr"]);
	r.check("un titre ni ftp ni une phrase ne font un lien", parseLiens(note).length, 4);

	r.check("ce qu'on écrit se relit à l'identique",
		parseLiens(ligneDeLien({ url: "https://a.b/c", title: "Un [titre] à crochets" })),
		[{ url: "https://a.b/c", title: "Un titre à crochets" }]);

	r.check("une URL http(s) propre passe", urlValide("  https://Example.org/x  "), "https://Example.org/x");
	r.check("sans schéma, ou avec un blanc, ou en ftp : refusée",
		[urlValide("example.org"), urlValide("https://a b"), urlValide("ftp://x.y")], [null, null, null]);
	r.check("le titre de repli est l'hôte sans www.", titreDepuisUrl("https://www.youtube.com/watch?v=1"), "youtube.com");

	/* Retirer un lien est la SEULE réécriture de Liens.md : elle ne doit
	   toucher que les lignes de ce lien. Un titre, une phrase, une ligne vide,
	   les autres liens restent à leur place et dans leur forme. */
	r.check("retirer un lien ne retire que ses lignes, et rien d'autre ne bouge",
		sansLien(note, "https://www.youtube.com/watch?v=abc"),
		["# Mes liens", "- [Cours Python](https://docs.python.org/3/tutorial/)", "<https://example.org/page?x=1&y=2>", "* [](https://sans-titre.fr)", "- [pas un lien](ftp://ailleurs)", "juste une phrase", ""].join("\n"));
	r.check("un lien absent rend null : la note n'est pas réécrite pour rien",
		sansLien(note, "https://nulle-part.fr"), null);

	r.done();
});
