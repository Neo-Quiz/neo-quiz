/* ══════════════════════════════════════════════════════════
   LA LIGNE DE COMMANDE D'UN CLI — la moitié PURE, partagée par les hôtes

   Tâche 7 de la génération IA dans l'application. Les hôtes qui lancent un
   CLI (`apps/windows/electron/process.ts`, puis l'hôte Android) doivent
   CITER leurs arguments de la même façon et chercher l'exécutable avec les
   mêmes extensions. Ce fichier est cette moitié-là.

   POURQUOI ICI ET PAS DANS CHAQUE HÔTE, et ce que la duplication a déjà coûté.
   `citerPourCmd` a été DURCIE à la tâche 3 après une injection prouvée (voir le
   POURQUOI de la fonction) ; la recopier dans le processus principal aurait
   donné deux règles de citation pour un même appel du code partagé, dont une
   seule éprouvée par le cas témoin `a" & echo PWN & "b`. Le dépôt a déjà payé
   exactement ça à la tâche 4 : `substituerJetons`, dupliquée, avait DIVERGÉ en
   une tranche (`src/host/jetons.ts`, en-tête).

   UN FICHIER À PART DE `jetons.ts`, et non une section de plus dedans : les
   jetons désignent des FICHIERS écrits par l'hôte, ceci parle de la LIGNE DE
   COMMANDE. Deux sujets, deux jeux de cas, deux raisons de changer.

   AUCUN IMPORT DE NODE, comme `jetons.ts` : ce module est dans `src/`, donc le
   rendu de l'application pourrait l'importer sans faire rougir `check:host`
   (assertion 6). La moitié qui touche le disque — résoudre un chemin, lancer —
   reste chez chaque hôte.
══════════════════════════════════════════════════════════ */

/** Les extensions que Windows considère exécutables, quand `PATHEXT` est
    absent de l'environnement. La valeur par défaut de Windows lui-même, réduite
    à ce qu'un CLI peut être. */
const PATHEXT_DEFAUT = ".COM;.EXE;.BAT;.CMD";

/** Une erreur dont le `name` est celui que le contrat nomme (`refuse`) :
    l'appelant décide sur ce nom, jamais sur le message, qui n'est pas traduit.
    Jumelle de celle de `jetons.ts`, et pour la même raison — un `import` entre
    ces deux modules purs les lierait sans rien partager d'autre. */
function refus(message: string): Error {
	const e = new Error(message);
	e.name = "refuse";
	return e;
}

/**
 * Les extensions à essayer quand on cherche un exécutable dans le `PATH`.
 * PURE : l'environnement et la plateforme sont des PARAMÈTRES.
 *
 * Sous Windows, `PATHEXT` est ce que le shell lui-même consulte : un CLI
 * installé par npm est un `claude.cmd`, et chercher `claude` tout court ne le
 * trouverait jamais — l'application dirait « non installé » à propos d'un CLI
 * qui répond dans n'importe quel terminal. Ailleurs, un exécutable n'a pas
 * d'extension : la liste vaut `[""]`, ce qui laisse le nom tel quel.
 */
export function extensionsExecutables(
	env: { PATHEXT?: string },
	plateforme: string,
): string[] {
	if (plateforme !== "win32") return [""];
	return (env.PATHEXT || PATHEXT_DEFAUT).split(";").filter(Boolean);
}

/**
 * Un argument porte-t-il un retour à la ligne ? PURE.
 *
 * CR comme LF sont des SÉPARATEURS DE COMMANDES pour `cmd.exe`, et aucune
 * citation ne les neutralise (voir `citerPourCmd`). Les deux hôtes REFUSENT
 * donc un tel argument sur TOUS les systèmes, et pas seulement là où il est
 * dangereux : sinon le sort d'un argument dépendrait du système et de la façon
 * dont le CLI a été installé — la même génération marcherait sous Linux et
 * échouerait sous un Windows à shim npm. Un refus net, partout, se
 * diagnostique ; une différence silencieuse, non.
 */
export function porteSautDeLigne(arg: string): boolean {
	return /[\r\n]/.test(arg);
}

/**
 * Un argument, cité pour la ligne de commande de `cmd.exe`. Ne sert QU'au repli
 * Windows des deux hôtes — le chemin direct (`spawn`) ne traverse aucun shell
 * et n'a rien à citer.
 *
 * LA RÈGLE DE `cmd.exe`, et elle n'a rien de celle d'un shell POSIX : le
 * BACKSLASH N'ÉCHAPPE RIEN. `cmd` ne fait que basculer un état « dans des
 * guillemets / dehors » à chaque `"` qu'il rencontre, et ne traite `&`, `|`,
 * `>`, `(` comme des opérateurs que HORS de cet état. Écrire `\"` — ce que
 * faisait la première version — FERME donc le guillemet : avec l'argument
 * `a" & notepad & "b`, la ligne devenait `codex "a\" & notepad & \"b"`, cmd
 * sortait de l'état cité après `a\`, voyait un `&` nu et lançait `notepad`.
 * Le NOM de l'outil restait borné par la liste blanche, mais ses ARGUMENTS
 * atteignaient un interpréteur — ce que le chemin direct ne fait jamais.
 *
 * La forme correcte est le guillemet DOUBLÉ (`"` → `""`) : ferme et rouvre
 * aussitôt, donc l'état « cité » n'est jamais quitté et aucun métacaractère
 * n'est vu comme un opérateur.
 *
 * TROIS CAS QUI NE SE CITENT PAS :
 * — la chaîne VIDE doit s'écrire `""`, sinon elle n'apparaît pas du tout dans
 *   la ligne et l'enfant reçoit un argument de MOINS (les positions décalent) ;
 * — un retour à la ligne (CR ou LF) est REFUSÉ, avec un nom, jamais retiré en
 *   silence — un argument amputé produirait un appel faux et muet ;
 * — `%VAR%` reste développé par `cmd` même entre guillemets (verrue connue,
 *   sans échappement fiable). C'est le seul résiduel de ce repli, et l'ancien
 *   `cp.exec` l'avait déjà.
 */
export function citerPourCmd(arg: string): string {
	if (porteSautDeLigne(arg)) {
		throw refus("argument refusé : un retour à la ligne est un séparateur de commandes pour cmd.exe");
	}
	if (arg === "") return '""';
	return /[\s"&|<>^()%!,;=]/.test(arg) ? '"' + arg.replace(/"/g, '""') + '"' : arg;
}

/**
 * La ligne complète passée à `cmd.exe /d /s /c`, guillemets extérieurs compris.
 *
 * Écrite ICI et non chez chaque hôte : les guillemets EXTÉRIEURS font partie de
 * la règle (`/s` demande à `cmd` de retirer le premier et le dernier caractère
 * de la ligne quand ce sont des guillemets, ce qui rend la citation intérieure
 * prévisible). Les composer d'un côté et pas de l'autre suffisait à changer le
 * sort d'un argument selon l'hôte.
 */
export function ligneCmd(executable: string, args: string[]): string {
	return '"' + [executable, ...args].map(citerPourCmd).join(" ") + '"';
}
