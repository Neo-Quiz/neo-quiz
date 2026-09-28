/* ══════════════════════════════════════════════════════════
   LA RÉPONSE D'UNE « SORTIE DE PROGRAMME », DANS LE BLOC DE CODE
   (2026-09-27).

   Quand l'énoncé se termine par le programme dont on demande la sortie, le
   champ de réponse n'est pas un second encadré sous le code : il PREND LA
   PLACE du panneau de sortie de ce bloc, là où « Exécuter » affiche d'habitude
   ce que le programme écrit (« fais bien attention à ne pas créer de nouveau
   champ : on doit écrire juste en dessous du bloc de code, à l'endroit
   habituel où l'on voit la sortie »). Même cadre, même filet, même fond un
   cran plus sombre que le code (`.quiz-code-reponse`, terminal-program.css).

   DOM pur, sans `ctx` : appelé par le moteur à chaque liaison d'une carte
   (terminal.ts `bindTextQuestion`, l'HTML de la carte vient d'être posé) et
   par l'aperçu de l'éditeur (question-preview.ts). Idempotent : l'enveloppe
   déplacée est retirée, un second appel ne trouve plus rien. Un énoncé qui
   ne finit pas par un bloc de code garde le champ à sa place, sous lui.

   Le champ ne porte PAS `.quiz-code-output` : code-run.ts y écrirait la
   sortie d'« Exécuter » par-dessus la réponse (`sortieDe`).
══════════════════════════════════════════════════════════ */

/** Le bloc de code qui recevra la réponse. Seul un bloc PYTHON exécutable
    arrive enveloppé (`.quiz-code-block`, grammaire-blocs.ts) ; un bloc C,
    C++, Java… — ou tout bloc sous le greffon, qui n'exécute rien — n'est
    qu'un `<pre class="quiz-md-code">` nu. Il reçoit ici l'enveloppe qui lui
    manque : sans elle, la réponse d'une sortie de programme C++ restait un
    second encadré sous le code (constaté le 2026-09-27). L'enveloppe est
    posée dans le DOM et non par la grammaire, dont `check:md` fige la
    sortie octet pour octet pour tout bloc non-Python. */
function blocDeCode(el: HTMLElement): HTMLElement | null {
	if (el.classList.contains("quiz-code-block")) return el;
	if (!el.matches("pre.quiz-md-code")) return null;
	const bloc = document.createElement("div");
	bloc.className = "quiz-code-block";
	el.replaceWith(bloc);
	bloc.appendChild(el);
	return bloc;
}

export function placerReponseDansLeCode(racine: Element): void {
	for (const enveloppe of Array.from(racine.querySelectorAll<HTMLElement>(".quiz-text-wrap-program"))) {
		const enonce = enveloppe.previousElementSibling;
		const dernier = enonce?.classList.contains("quiz-question") ? enonce.lastElementChild : null;
		const reponse = enveloppe.querySelector<HTMLElement>(".quiz-program-output");
		if (!reponse || !(dernier instanceof HTMLElement)) continue;
		const bloc = blocDeCode(dernier);
		if (!bloc) continue;
		reponse.classList.remove("quiz-md-code");
		reponse.classList.add("quiz-code-reponse");
		// Juste sous le code, avant le panneau d'« Exécuter » (masqué tant
		// qu'on n'a rien lancé) : une fois le quiz corrigé, la vraie sortie
		// s'affichera sous la réponse donnée, pour comparer.
		bloc.insertBefore(reponse, bloc.querySelector(":scope > .quiz-code-output"));
		enveloppe.remove();
	}
}
