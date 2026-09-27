/* ══════════════════════════════════════════════════════════
   LE COMPLÉMENT DE PROMPT DE CHAQUE CATÉGORIE (retour #7, 2026-09-26)

   Ajouté au prompt système commun par `composerPrompts` (ai-client.ts)
   quand la demande porte une catégorie autre que `general`. ANGLAIS, comme
   le reste du prompt : la langue du quiz suit toujours la demande (règle
   LANGUAGE). Bref : une consigne de plus, pas un second prompt.
   `npm run check:prompt` vérifie que chaque complément part bien.
══════════════════════════════════════════════════════════ */

import type { CategorieQuiz } from "./categorie-quiz";

const COMPLEMENTS: Readonly<Record<Exclude<CategorieQuiz, "general">, string>> = {
	python: `SUBJECT: PYTHON. Every code block is fenced as \`\`\`python and is a complete, RUNNABLE example (imports and definitions included, no "..." placeholders). Include questions on the OUTPUT of a short program: the prompt shows the code, the learner writes exactly what \`print\` displays. Whenever an idiom appears (list comprehension, slicing, unpacking, f-string, \`enumerate\`, \`zip\`, a lambda), detail it: the compact form, its result, then its equivalent with a plain loop — e.g. \`[2 * i for i in range(4)]\` gives \`[0, 2, 4, 6]\`, the same as \`res = []\`, \`for i in range(4):\`, \`res.append(2 * i)\`. Name the exact built-in functions and methods (\`len\`, \`append\`, \`range\`).`,
	c: `SUBJECT: C PROGRAMMING. Every code block is fenced as \`\`\`c and compiles as is (includes and \`main\` when it runs). Include questions on the OUTPUT of a short program (\`printf\` with its format), on pointers and memory (\`&\`, \`*\`, \`malloc\`/\`free\`), and "find the bug" questions (off-by-one, missing \`free\`, uninitialized variable). Show the types of every variable.`,
	bash: `SUBJECT: SHELL AND LINUX. Every code block is fenced as \`\`\`bash. Include questions where the learner types the COMMAND that does a task (terminalVariant "bash"), and questions on the output of a command. Detail every option used (\`ls -la\`: \`-l\` long listing, \`-a\` hidden files) and every pipe step.`,
	sql: `SUBJECT: SQL AND DATABASES. Every code block is fenced as \`\`\`sql. Give the table schema (columns and a few rows) before any query question. Include questions where the learner writes a query, and questions on the RESULT of a query (the rows it returns). Detail each clause of a compact query (SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY) in execution order.`,
	web: `SUBJECT: WEB DEVELOPMENT. Fence each block with its language (\`\`\`html, \`\`\`css, \`\`\`javascript). Include questions on what a snippet DISPLAYS or does in the browser, and on the value a JavaScript expression returns. Detail compact syntax (arrow functions, destructuring, template literals, CSS selectors) with its long equivalent.`,
	maths: `SUBJECT: MATHEMATICS. Every formula is in LaTeX between dollars. Prefer numeric questions ("numeric": true) and mathInput questions for results, and ordering questions for the steps of a method. Every explanation shows the computation step by step, one line per step, with the intermediate results.`,
	reseau: `SUBJECT: NETWORKING. Use exact protocol names, layers and port numbers. Include calculation questions (subnet masks, number of hosts, network and broadcast addresses) answered as numbers or addresses, ordering questions for the steps of an exchange (DHCP, TCP handshake, DNS resolution), and matching questions between protocols and layers. Show every calculation in binary where it helps.`,
};

/** Le complément de la catégorie, `""` pour `general`. */
export function complementCategorie(categorie: CategorieQuiz | undefined): string {
	if (!categorie || categorie === "general") return "";
	return COMPLEMENTS[categorie] ?? "";
}
