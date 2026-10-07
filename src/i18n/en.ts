import { EN_SETTINGS } from "./en/settings";
import { EN_AI } from "./en/ai";
import { EN_DASHBOARD } from "./en/dashboard";
import { EN_EDITOR } from "./en/editor";
import { EN_ENGINE } from "./en/engine";
import { EN_APP } from "./en/app";
import { EN_REVIEW } from "./en/review";
import { EN_INSTALLER } from "./en/installer";
import { EN_SHARE } from "./en/share";

/* ══════════════════════════════════════════════════════════
   Dictionnaire ANGLAIS = référence de l'interface.
   Découpé par domaine (un fichier par sous-système) : les dictionnaires sont
   des données, mais un seul fichier de plusieurs centaines de clés serait
   illisible et un nid à conflits. Ajouter un domaine = un import ici.
══════════════════════════════════════════════════════════ */
export const EN = {
	...EN_SETTINGS,
	...EN_AI,
	...EN_DASHBOARD,
	...EN_EDITOR,
	...EN_ENGINE,
	...EN_APP,
	...EN_REVIEW,
	...EN_INSTALLER,
	...EN_SHARE,
} as const;
