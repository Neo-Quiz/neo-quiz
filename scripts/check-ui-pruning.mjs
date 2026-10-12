import { readFileSync } from "node:fs";
import { makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Composer subject picker and question beads");
const ui = readFileSync("src/dashboard/ui-select.ts", "utf8");
const start = ui.indexOf("export function openOptionsMenu");
const end = ui.indexOf("export interface OpenNotePickerOptions", start);
const menu = ui.slice(start, end < 0 ? undefined : end);
const ai = readFileSync("src/dashboard/ai.ts", "utf8");
const affichage = readFileSync("src/dashboard/categorie-affichage.ts", "utf8");
const css = readFileSync("src/assets/css/components/ui-select.css", "utf8");
const tabs = readFileSync("src/assets/css/components/nav-tabs.css", "utf8");
const cards = readFileSync("src/engine/cards.ts", "utf8");

r.check("the subject list keeps its Subject row", menu.includes('t("dashboard.select.optionsCategory")'), true);
r.check("the subject list has no Questions or Type rows", /optionsQuestions|optionsType|PRESETS|champPerso/.test(menu), false);
r.check("the removed custom count input has no dead renderer or styles", /qbd-opts-custom/.test(ui + css), false);
// The composer's options button is gone for good: the subject notice replaces it.
r.check("the composer has no options button", /qbd-ai-composer-opts|optsBtn/.test(ai), false);
r.check("the subject notice is a button", /ajouter\(destRow, "button", "qbd-ai-categorie"\)/.test(ai), true);
r.check("clicking the notice opens the subject chooser beside it", /avis\.addEventListener\("click",[\s\S]*?openCategoriePicker\(avis,/.test(ai), true);
r.check("openCategoriePicker opens the subject list directly", /export function openCategoriePicker[\s\S]*?directSujet: true/.test(ui), true);
const peindre = affichage.slice(affichage.indexOf("export function peindreAvisCategorie"));
r.check("the subject notice never hides (nothing detected reads Automatic)", [peindre.includes("el.hidden"), peindre.includes('t("ai.categorie.auto")')], [false, true]);
r.check("success and failure colors remain without their corner glyphs", [
	tabs.includes(".quiz-tab.correct{"), tabs.includes(".quiz-tab.wrong{"),
	/\.quiz-tab\.correct::before\s*\{\s*content:\s*["']\2713/.test(tabs),
	/\.quiz-tab\.wrong::before\s*\{\s*content:\s*["']\2715/.test(tabs),
], [true, true, false, false]);
r.check("numbered beads and current styling remain", [cards.includes("${n}</a>"), tabs.includes(".quiz-tab.active{")], [true, true]);
r.done();
