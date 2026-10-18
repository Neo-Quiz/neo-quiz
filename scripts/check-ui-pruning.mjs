import { readFileSync } from "node:fs";
import { makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Composer pruning and question beads");
const ui = readFileSync("src/dashboard/ui-select.ts", "utf8");
const ai = readFileSync("src/dashboard/ai.ts", "utf8");
const affichage = readFileSync("src/dashboard/categorie-affichage.ts", "utf8");
const css = readFileSync("src/assets/css/components/ui-select.css", "utf8");
const cssAi = readFileSync("src/assets/css/dashboard/dashboard-ai.css", "utf8");
const tabs = readFileSync("src/assets/css/components/nav-tabs.css", "utf8");
const cards = readFileSync("src/engine/cards.ts", "utf8");

// The composer's subject chip, picker and local detection are gone for good (2026-10-18): the AI names the subject in the clarify call.
r.check("the composer has no options button", /qbd-ai-composer-opts|optsBtn/.test(ai), false);
r.check("the composer has no subject chip, picker or manual choice", /qbd-ai-categorie|qbd-ai-composer-dest|openCategoriePicker|categorieChoix|peindreAvisCategorie|detecterCategorie/.test(ai), false);
r.check("no subject picker left in ui-select or the display module", /openCategoriePicker|openOptionsMenu|OptionCategorie|choixCategories|libelleDetecte|peindreAvisCategorie/.test(ui + affichage), false);
r.check("no dead styles of the chip or the options menu", /qbd-ai-categorie|qbd-ai-composer-dest|qbd-opts-/.test(css + cssAi), false);
r.check("success and failure colors remain without their corner glyphs", [
	tabs.includes(".quiz-tab.correct{"), tabs.includes(".quiz-tab.wrong{"),
	/\.quiz-tab\.correct::before\s*\{\s*content:\s*["']\2713/.test(tabs),
	/\.quiz-tab\.wrong::before\s*\{\s*content:\s*["']\2715/.test(tabs),
], [true, true, false, false]);
r.check("numbered beads and current styling remain", [cards.includes("${n}</a>"), tabs.includes(".quiz-tab.active{")], [true, true]);
r.done();
