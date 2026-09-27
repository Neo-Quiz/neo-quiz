/**
 * Vérification du catalogue léger produit par le scanner.
 *
 * Le scheduler dépend de clés strictement identiques à celles de l'éditeur :
 * un test d'intégration du vrai scanner protège le câblage, là où tester
 * assignQuestionIds une seconde fois ne prouverait pas que le scanner l'appelle.
 *
 *     node scripts/check-scanner.mjs
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/scanner.ts", async ({ createScanner }) => {
	const r = makeReporter("Scanner — références des questions");
	const fichierHote = {
		path: "Cours/reseau.md",
		name: "reseau.md",
		basename: "reseau",
		extension: "md",
		mtime: 1,
	};
	let content = [
		"Avant le quiz",
		"```quiz-blocks fold",
		"[",
		"  { mode: 'lesson', source: '[[Cours]]' },",
		"  'parasite',",
		"  { prompt: 'Sans titre', role: 'test', slice: 4 },",
		"  { id: 'dup', title: 'Premiere', prompt: 'Q1', role: 'pre', slice: 1 },",
		"  { id: 'dup', title: 'Deuxieme', prompt: 'Q2', role: 23, slice: '2' },",
		"  { id: 'dup-2', title: 'Troisieme', prompt: 'Q3', role: 'read', slice: 2 },",
		"  { id: '   ', title: 'Fallback Title', prompt: 'Q4', role: 'custom', slice: 0 },",
		"  { id: 42, title: 'Numeric Id', prompt: 'Q5', role: null, slice: -1 },",
		"  { title: 42, prompt: 'Q6', role: 'test', slice: 5 },",
		"]",
		"  ```",
		"Apres le quiz",
	].join("\r\n");
	let abonne = null;
	const host = {
		fs: {
			listMarkdown: () => [fichierHote],
			readCached: async () => content,
			read: async () => content,
			getFile: (p) => (p === fichierHote.path ? fichierHote : null),
		},
		watcher: {
			/* Le scanner doit RENDRE son désabonnement et l'appeler au
			   destroy : sans ça, un rechargement du greffon laisse un écouteur
			   sur un scanner mort, qui rescanne dans le vide à chaque frappe. */
			onChange: (cb) => { abonne = cb; return () => { abonne = null; }; },
		},
	};
	const scanner = createScanner(host);

	await scanner.init();
	const entry = scanner.getQuiz(fichierHote.path);

	/* La configuration et le parasite ne sont pas des questions indexées : les
	   sept références correspondent uniquement aux objets du bloc. Le COMPTE
	   affiché en retire la lecture (`dup-2`, rôle `read`) : le bloc est joué en
	   leçon, et depuis le 2026-09-26 aucune lecture d'un Learn n'est une
	   question (src/lecture-etape.ts `nombreDeQuestions`). */
	r.check("une fence CRLF indentée est indexée sans compter la configuration ni la lecture",
		[entry?.questions, entry?.items.length], [6, 7]);
	/* Calcul manuel : le parasite consomme q1, donc la question sans titre reçoit
	   q2. Puis dup prend sa clé ; le second dup évite dup déjà attribué
	   ET dup-2 réservé plus bas, donc devient dup-3 ; dup-2 garde ensuite sa
	   propre réservation. Les deux identifiants malformés retombent sur les
	   slugs ASCII de leurs titres. */
	r.check("identités, rôles et tranches sont retenus dans l'ordre",
		entry?.items, [
			{ id: "q2", role: "test", slice: 4 },
			{ id: "dup", role: "pre", slice: 1 },
			{ id: "dup-3" },
			{ id: "dup-2", role: "read", slice: 2 },
			{ id: "fallback-title", slice: 0 },
			{ id: "numeric-id", slice: -1 },
			{ id: "q8", role: "test", slice: 5 },
		]);
	r.check("un élément non objet conserve l'alignement des identifiants",
		entry?.items?.[0]?.id, "q2");
	r.check("un titre non textuel retombe sur l'indice brut sans perdre le quiz",
		entry?.items?.[6]?.id, "q8");
	r.check("un rôle non textuel n'est pas matérialisé par une propriété vide",
		Object.prototype.hasOwnProperty.call(entry?.items?.[2], "role"), false);
	r.check("une tranche non numérique n'est pas matérialisée par une propriété vide",
		Object.prototype.hasOwnProperty.call(entry?.items?.[2], "slice"), false);
	r.check("un rôle textuel inconnu est omis plutôt qu'inventé comme rôle valide",
		Object.prototype.hasOwnProperty.call(entry?.items?.[4], "role"), false);

	const notifications = [];
	scanner.onChange(quizzes => notifications.push(quizzes));
	// Seules les données du catalogue changent : le nombre et le type restent identiques.
	content = content.replace("role: 'pre', slice: 1", "role: 'recall', slice: 9");
	await scanner.scanFile(fichierHote);

	r.check("un changement de référence déclenche onChange", notifications.length, 1);
	r.check("onChange expose immédiatement les nouvelles données",
		notifications[0]?.[0]?.items?.[1], { id: "dup", role: "recall", slice: 9 });

	const validContent = content;
	content = "Cette note ne contient plus de quiz.";
	await scanner.scanFile(fichierHote);
	r.check("une note sans bloc retire son ancienne entrée du cache",
		scanner.getQuiz(fichierHote.path), null);

	content = validContent;
	await scanner.scanFile(fichierHote);
	r.check("le cache est repeuplé avant d'éprouver le JSON5 invalide",
		scanner.getQuiz(fichierHote.path) !== null, true);
	const consoleErrors = [];
	const originalConsoleError = console.error;
	try {
		console.error = (...args) => consoleErrors.push(args);
		content = "```quiz-blocks\n[{ prompt: ]\n```";
		await scanner.scanFile(fichierHote);
	} finally {
		console.error = originalConsoleError;
	}
	r.check("un bloc JSON5 invalide retire son ancienne entrée du cache",
		scanner.getQuiz(fichierHote.path), null);
	r.check("un bloc transitoirement invalide ne pollue pas la console",
		consoleErrors.length, 0);

	content = validContent;
	await scanner.scanFile(fichierHote);
	r.check("le cache est repeuplé avant d'éprouver le bloc vide",
		scanner.getQuiz(fichierHote.path) !== null, true);
	content = "```quiz-blocks\n[]\n```";
	await scanner.scanFile(fichierHote);
	r.check("un bloc vide retire son ancienne entrée du cache",
		scanner.getQuiz(fichierHote.path), null);

	/* RENOMMAGE d'une note INDEXÉE : l'ancienne clé disparaît, la nouvelle
	   entre. Une clé qui survivrait laisserait un quiz fantôme au catalogue. */
	const neuf = { ...fichierHote, path: "Cours/reseau2.md", basename: "reseau2", name: "reseau2.md" };
	content = validContent;
	await scanner.scanFile(fichierHote);
	abonne({ kind: "rename", file: neuf, oldPath: fichierHote.path });
	await new Promise(r2 => setTimeout(r2, 0));
	r.check("un renommage retire l'ancienne clé", scanner.getQuiz("Cours/reseau.md"), null);

	/* RENOMMAGE vers un .md JAMAIS indexé : le fichier doit quand même être
	   scanné. Le comportement d'origine le faisait ; le perdre rendrait
	   invisible tout quiz créé par un renommage. */
	const neuf3 = { ...fichierHote, path: "Cours/reseau3.md", basename: "reseau3", name: "reseau3.md" };
	abonne({ kind: "rename", file: neuf3, oldPath: "Autre/pas-indexe.md" });
	await new Promise(r2 => setTimeout(r2, 0));
	r.check("un renommage depuis un chemin inconnu scanne quand même",
		!!scanner.getQuiz("Cours/reseau3.md"), true);

	/* L'OBJECTIF du bloc, affiché en badge (2026-09-23) : l'ancien mode
	   `lesson` du bloc ci-dessus est un Practice ; un bloc `{ mode: 'learn' }`
	   est un Learn. */
	r.check("un bloc en mode hérité est un Practice", entry?.mode, "practice");
	content = "```quiz-blocks\n[\n  { title: 'Lire', prompt: 'Passage', role: 'read', slice: 1 },\n  { mode: 'learn', objectives: ['Lire'] },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	r.check("un bloc { mode: 'learn' } est un Learn", scanner.getQuiz(fichierHote.path)?.mode, "learn");
	/* Décision du 2026-09-26 (soir) : une lecture de Learn, même restée un
	   écran à part, n'est jamais une question comptée. */
	r.check("une lecture seule dans son étape n'est pas une question comptée", scanner.getQuiz(fichierHote.path)?.questions, 0);

	/* LECTURES ABSORBÉES (2026-09-26, src/lecture-etape.ts) : le cours d'une
	   étape qui a d'autres questions n'est pas compté ; le catalogue de
	   l'ordonnanceur (`items`) le garde, par identifiant. */
	content = "```quiz-blocks\n[\n  { title: 'Avant', prompt: '?', role: 'pre', slice: 1 },\n  { title: 'Lire', prompt: 'Passage', role: 'read', slice: 1 },\n  { title: 'Avec vos mots', prompt: '?', role: 'explain', type: 'text', slice: 1 },\n  { mode: 'learn' },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	r.check("une lecture absorbée n'est pas comptée, mais reste au catalogue",
		[scanner.getQuiz(fichierHote.path)?.questions, scanner.getQuiz(fichierHote.path)?.items?.length], [2, 3]);
	// Hors Learn, le moteur joue la lecture comme un écran : elle est comptée.
	content = content.replace("{ mode: 'learn' }", "{ mode: 'quiz' }");
	await scanner.scanFile(fichierHote);
	r.check("hors Learn, une lecture à étape reste une question comptée", scanner.getQuiz(fichierHote.path)?.questions, 3);

	/* NON-RÉGRESSION — GLOSSAIRE (lot D, revue du 2026-09-27) : ajouter un
	   glossaire à la configuration finale ne doit CHANGER ni le compte de
	   questions ni les IDENTIFIANTS des questions déjà là. Une clé qui
	   bougerait perdrait l'historique de révision (src/quiz-ids.ts,
	   assignQuestionIds) — le même quiz, rescanné après une génération qui
	   lui a ajouté un glossaire, doit rester le même quiz pour l'ordonnanceur. */
	content = "```quiz-blocks\n[\n  { title: 'Q1', prompt: 'Une pile ?', options: ['a', 'b'], correctIndex: 0 },\n  { title: 'Q2', prompt: 'Une file ?', options: ['a', 'b'], correctIndex: 1 },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	const practiceSansGlossaire = scanner.getQuiz(fichierHote.path);
	content = "```quiz-blocks\n[\n  { title: 'Q1', prompt: 'Une pile ?', options: ['a', 'b'], correctIndex: 0 },\n  { title: 'Q2', prompt: 'Une file ?', options: ['a', 'b'], correctIndex: 1 },\n  { mode: 'quiz', glossary: [{ term: 'pile', definition: 'Structure LIFO.' }] },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	const practiceAvecGlossaire = scanner.getQuiz(fichierHote.path);
	r.check("Practice : un glossaire en fin de tableau ne change ni le compte ni les identifiants des questions",
		[practiceAvecGlossaire?.questions, practiceAvecGlossaire?.items.map(it => it.id)],
		[practiceSansGlossaire?.questions, practiceSansGlossaire?.items.map(it => it.id)]);

	content = "```quiz-blocks\n[\n  { title: 'Lire', prompt: 'Passage', role: 'read', slice: 1 },\n  { title: 'Avec vos mots', prompt: '?', role: 'explain', type: 'text', slice: 1 },\n  { mode: 'learn', objectives: ['Définir une pile'] },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	const learnSansGlossaire = scanner.getQuiz(fichierHote.path);
	content = "```quiz-blocks\n[\n  { title: 'Lire', prompt: 'Passage', role: 'read', slice: 1 },\n  { title: 'Avec vos mots', prompt: '?', role: 'explain', type: 'text', slice: 1 },\n  { mode: 'learn', objectives: ['Définir une pile'], glossary: [{ term: 'pile', definition: 'Structure LIFO.' }] },\n]\n```\n";
	await scanner.scanFile(fichierHote);
	const learnAvecGlossaire = scanner.getQuiz(fichierHote.path);
	r.check("Learn : un glossaire dans la configuration ne change ni le compte ni les identifiants des questions",
		[learnAvecGlossaire?.questions, learnAvecGlossaire?.items.map(it => it.id)],
		[learnSansGlossaire?.questions, learnSansGlossaire?.items.map(it => it.id)]);

	/* DÉSABONNEMENT : un scanner détruit ne doit plus rien écouter. Seule
	   protection contre le rechargement du greffon, où deux scanners
	   coexistent une fraction de seconde. */
	/* CARTES MÉMOIRE (2026-09-25) : une note de cartes seules est étiquetée
	   flashcard ; mêlée à un autre type, mixed comme n'importe quel mélange. */
	async function typeDe(bloc) {
		const fichier = { path: "Cours/carte.md", name: "carte.md", basename: "carte", extension: "md", mtime: 1 };
		const hote = {
			fs: {
				listMarkdown: () => [fichier],
				readCached: async () => texte,
				read: async () => texte,
				getFile: (p) => (p === fichier.path ? fichier : null),
			},
			watcher: { onChange: () => () => {} },
		};
		const texte = "```quiz-blocks\n" + bloc + "\n```";
		const s = createScanner(hote);
		await s.init();
		const e = s.getQuiz(fichier.path);
		s.destroy();
		return e?.quizType;
	}

	r.check("une note de cartes seules est étiquetée flashcard ; mêlée, mixed",
		[await typeDe("[{ prompt: 'A', flashcard: true, answer: 'a' }, { prompt: 'B', flashcard: true, answer: 'b' }]"),
		 await typeDe("[{ prompt: 'A', flashcard: true, answer: 'a' }, { prompt: 'Q', options: ['x', 'y'], correctIndex: 0 }]")],
		["flashcard", "mixed"]);

	scanner.destroy();
	r.check("destroy retire l'abonnement au watcher", abonne, null);

	r.done();
});

/* ── Frontmatter `neo-quiz:` (src/quiz-frontmatter.ts) ──
   Module pur : qui a généré le quiz (fournisseur, modèle, effort,
   horodatage), lu par le scanner depuis la tête de la note. */
await withSrcModule("src/quiz-frontmatter.ts", async ({ lireFrontmatterNeoQuiz, ecrireFrontmatterNeoQuiz, neContientQueLeFrontmatterNeoQuiz }) => {
	const r = makeReporter("Frontmatter neo-quiz");

	/* La note générée dont on retire le bloc : il ne reste que le
	   frontmatter de l'application — elle est VIDE (à la corbeille avec le
	   quiz). Pas si l'utilisateur y a mis du texte ou d'autres clés. */
	const seulement = ecrireFrontmatterNeoQuiz({ provider: "claude-web", model: "claude.ai", generatedAt: "2026-09-19T20:51:15Z" }) + "\n";
	r.check("une note qui n'a plus que le frontmatter neo-quiz est vide", neContientQueLeFrontmatterNeoQuiz(seulement), true);
	r.check("… mais pas avec du texte dessous", neContientQueLeFrontmatterNeoQuiz(seulement + "Mes notes\n"), false);
	r.check("… ni avec une autre clé de frontmatter (tags de l'utilisateur)", neContientQueLeFrontmatterNeoQuiz(seulement.replace("neo-quiz:", "tags: [cours]\nneo-quiz:")), false);
	r.check("… ni sans frontmatter neo-quiz du tout", neContientQueLeFrontmatterNeoQuiz("---\ntags: [a]\n---\n"), false);
	r.check("vide aussi quand model est vide (claude.ai) : la clé suffit",
		neContientQueLeFrontmatterNeoQuiz("---\nneo-quiz:\n  provider: claude-web\n  model: \n  effort: high\n  generatedAt: 2026-09-19T20:50:55.373Z\n---\n\n"), true);
	/* `learn: "[[...]]"` (Practice lié à son Learn) est écrit par
	   l'application au même titre que `neo-quiz:` : une note Practice qui n'a
	   plus que ces deux clés est vide elle aussi, pas orpheline. */
	const avecLearn = ecrireFrontmatterNeoQuiz({ provider: "claude-web", model: "claude.ai", generatedAt: "2026-09-19T20:51:15Z", learn: "CM1 — Learn" }) + "\n";
	r.check("… vide aussi avec le lien learn: de l'application", neContientQueLeFrontmatterNeoQuiz(avecLearn), true);
	r.check("… mais pas si une clé de l'utilisateur s'y ajoute", neContientQueLeFrontmatterNeoQuiz(avecLearn.replace("neo-quiz:", "tags: x\nneo-quiz:")), false);

	r.check("une note sans frontmatter rend null",
		lireFrontmatterNeoQuiz("```quiz-blocks\n[]\n```"), null);

	r.check("un `---` au milieu du texte n'est pas un frontmatter",
		lireFrontmatterNeoQuiz("Avant\n---\nApres\n```quiz-blocks\n[]\n```"), null);

	const complet = [
		"---",
		"neo-quiz:",
		"  provider: claude-code",
		"  model: claude-opus-5",
		"  effort: high",
		"  generatedAt: 2026-09-13T09:40:12Z",
		"---",
		"",
		"```quiz-blocks",
		"[]",
		"```",
	].join("\n");
	r.check("un frontmatter complet rend les quatre champs",
		lireFrontmatterNeoQuiz(complet),
		{ provider: "claude-code", model: "claude-opus-5", effort: "high", generatedAt: "2026-09-13T09:40:12Z" });

	const sansEffort = [
		"---",
		"neo-quiz:",
		"  provider: ollama",
		"  model: glm-5.3:cloud",
		"  generatedAt: 2026-09-13T09:40:12Z",
		"---",
		"",
	].join("\n");
	r.check("effort absent (Ollama) rend undefined plutot qu'une chaine vide",
		lireFrontmatterNeoQuiz(sansEffort),
		{ provider: "ollama", model: "glm-5.3:cloud", generatedAt: "2026-09-13T09:40:12Z" });

	r.check("un frontmatter sans cle neo-quiz: rend null",
		lireFrontmatterNeoQuiz(["---", "autre: valeur", "---", ""].join("\n")), null);

	r.check("aller-retour avec effort",
		lireFrontmatterNeoQuiz(ecrireFrontmatterNeoQuiz({ provider: "codex", model: "gpt-5.6-terra", effort: "medium", generatedAt: "2026-09-13T00:00:00Z" })),
		{ provider: "codex", model: "gpt-5.6-terra", effort: "medium", generatedAt: "2026-09-13T00:00:00Z" });

	r.check("aller-retour sans effort",
		lireFrontmatterNeoQuiz(ecrireFrontmatterNeoQuiz({ provider: "ollama", model: "glm-5.3:cloud", generatedAt: "2026-09-13T00:00:00Z" })),
		{ provider: "ollama", model: "glm-5.3:cloud", generatedAt: "2026-09-13T00:00:00Z" });

	/* La SOURCE (2026-09-23) : c'est par elle qu'un Practice retrouve son
	   Learn. Un deux-points dans le nom ne doit pas casser la valeur. */
	r.check("aller-retour de la source",
		lireFrontmatterNeoQuiz(ecrireFrontmatterNeoQuiz({ provider: "claude-code", model: "claude-sonnet-5", generatedAt: "2026-09-23T00:00:00Z", source: "CM1 - Python : les bases" }))?.source,
		"CM1 - Python : les bases");
	r.check("une note avec source et lien learn reste « rien que le frontmatter » de l'app",
		neContientQueLeFrontmatterNeoQuiz(ecrireFrontmatterNeoQuiz({ provider: "claude-code", model: "m", generatedAt: "2026-09-23T00:00:00Z", source: "CM1", learn: "Parcours CM1" }) + "\n"),
		true);

	r.done();
});
