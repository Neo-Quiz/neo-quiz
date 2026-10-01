import { FR_SETTINGS } from "./fr/settings";
import { FR_AI } from "./fr/ai";
import { FR_DASHBOARD } from "./fr/dashboard";
import { FR_EDITOR } from "./fr/editor";
import { FR_ENGINE } from "./fr/engine";
import { FR_APP } from "./fr/app";
import { FR_REVIEW } from "./fr/review";
import { FR_INSTALLER } from "./fr/installer";
import type { EN } from "./en";

/* Dictionnaire FRANÇAIS — même découpage que l'anglais.
   `Record<keyof typeof EN, string>` garantit qu'aucune clé ne manque : une
   traduction oubliée est une erreur de compilation, pas un texte anglais qui
   apparaît en douce dans l'UI française. */
export const FR: Record<keyof typeof EN, string> = {
	...FR_SETTINGS,
	...FR_AI,
	...FR_DASHBOARD,
	...FR_EDITOR,
	...FR_ENGINE,
	...FR_APP,
	...FR_REVIEW,
	...FR_INSTALLER,
};
