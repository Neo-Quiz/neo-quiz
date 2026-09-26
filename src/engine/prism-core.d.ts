/* `@types/prismjs` ne déclare que le module racine `prismjs` ; le sous-chemin
   `prismjs/components/prism-core` (le SEUL import de Prism sans le plugin
   `file-highlight`, voir code-highlight.ts) n'a pas sa propre déclaration.
   Le module JS exporte exactement le même objet Prism : on réexporte les
   types du module racine tel quel. */
declare module "prismjs/components/prism-core" {
	import Prism = require("prismjs");
	export = Prism;
}
