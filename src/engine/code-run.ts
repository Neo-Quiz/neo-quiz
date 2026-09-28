import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";
import { nettoyerTraceback } from "../code-exercise/traceback";
import type { PythonRun } from "../host/types";

/* ══════════════════════════════════════════════════════════
   BOUTON « EXÉCUTER » d'un bloc de code Python affiché dans un quiz
   (Learn, énoncés, explications, indices… tout texte qui passe par
   `engine/sanitizer.ts` → `grammaire-blocs.ts`, LE point de rendu unique
   des blocs de code).

   `grammaire-blocs.ts` (pur) émet le markup à l'avance, masqué
   (`hidden`) : c'est ce module, avec `ctx` (donc l'hôte), qui décide de le
   montrer — `HostPython` est un membre OPTIONNEL du contrat, absent sous le
   greffon Obsidian, qui n'exécute pas de code. Sans lui, le bouton et la
   toolbar sont RETIRÉS du DOM, jamais laissés inertes.

   Sécurité (constat M4 de la revue du bac à sable, 2026-09-27) : `stdout` et
   une erreur sont du texte dont l'AUTEUR DU QUIZ est maître — un quiz partagé
   est hostile. Toujours posés en `textContent`, jamais par une des quatre
   portes HTML du sanitizer (qui interpréterait du markdown ou du HTML dans
   une sortie de programme). Le code exécuté est relu depuis `<code>` par
   `textContent` (jamais un attribut recopié à la main, jamais désynchronisé
   du bloc affiché — `textContent` restitue le texte source, entités HTML
   comprises, exactement comme `colorerCode`/`echapper` l'ont écrit).
══════════════════════════════════════════════════════════ */

/** Le délai le plus long qu'un clic manuel mérite d'attendre : le contrat
    (`canaux.ts`) borne `timeoutMs` à 10 s au maximum, on prend ce plafond. */
const TIMEOUT_MS = 10_000;

export interface CodeRunHandlers {
	/** Démasque (et branche) tout bouton « Exécuter » sous `rootEl` si l'hôte
	    fournit `HostPython`, ou le retire sinon. À appeler juste après
	    `mathifyElement`, comme `bindQuizResourceButtons`. */
	bindCodeRunButtons(rootEl?: Element | null): void;
}

export function createCodeRunHandlers(ctx: EngineCtx): CodeRunHandlers {
	/** Le worker Pyodide est préchauffé une seule fois pour toute la session
	    du moteur, à la première apparition d'un bloc exécutable — `warm()` est
	    sans effet si Python est déjà chargé (contrat `HostPython`). */
	let prechauffe = false;

	function sortieDe(bloc: HTMLElement): HTMLElement {
		let sortie = bloc.querySelector<HTMLElement>(":scope > .quiz-code-output");
		if (!sortie) {
			sortie = document.createElement("div");
			sortie.className = "quiz-code-output";
			// Nommé pour un lecteur d'écran, comme celui qu'émet grammaire-blocs.ts.
			sortie.setAttribute("aria-label", t("engine.code.output"));
			sortie.hidden = true;
			bloc.appendChild(sortie);
		}
		return sortie;
	}

	/** Le texte à afficher pour un résultat, jamais posé qu'en `textContent`.
	    `erreur` : le PROGRAMME a levé une exception (traceback en rouge, même
	    police de code que la sortie normale). `panne` : le bac à sable lui-même
	    a failli (indisponible, délai, file pleine) — ce n'est pas une sortie du
	    programme, donc un message DISCRET, en police d'interface, jamais
	    présenté comme un résultat du code (demande du 2026-09-27). */
	function texteResultat(resultat: PythonRun): { texte: string; erreur: boolean; panne: boolean } {
		switch (resultat.status) {
			case "ok": {
				const sortie = resultat.stdout ?? "";
				return { texte: sortie.length > 0 ? sortie : t("engine.code.empty"), erreur: false, panne: false };
			}
			case "error": {
				const brute = nettoyerTraceback(resultat.error ?? "");
				const sortie = resultat.stdout ?? "";
				return { texte: sortie.length > 0 ? `${sortie}\n${brute}` : brute, erreur: true, panne: false };
			}
			case "timeout":
				return { texte: t("engine.code.timeout"), erreur: false, panne: true };
			case "too-long":
				return { texte: t("engine.code.tooLong"), erreur: false, panne: true };
			case "unavailable":
			default:
				return { texte: t("engine.code.unavailable"), erreur: false, panne: true };
		}
	}

	async function executer(btn: HTMLButtonElement, code: string): Promise<void> {
		const python = ctx.host.python;
		if (!python) return; // ne peut pas arriver (bouton retiré sans HostPython), garde honnête
		const bloc = btn.closest<HTMLElement>(".quiz-code-block");
		if (!bloc) return;
		const sortie = sortieDe(bloc);

		btn.disabled = true;
		btn.classList.add("quiz-code-run-running");
		sortie.hidden = false;
		sortie.classList.remove("quiz-code-output-error", "quiz-code-output-panne");
		sortie.textContent = t("engine.code.running");

		try {
			const resultat = await python.run({ code, stdin: "", timeoutMs: TIMEOUT_MS });
			const { texte, erreur, panne } = texteResultat(resultat);
			sortie.textContent = texte;
			sortie.classList.toggle("quiz-code-output-error", erreur);
			sortie.classList.toggle("quiz-code-output-panne", panne);
		} catch {
			sortie.textContent = t("engine.code.unavailable");
			sortie.classList.add("quiz-code-output-panne");
		} finally {
			btn.disabled = false;
			btn.classList.remove("quiz-code-run-running");
		}
	}

	/** Un bloc de code de l'ÉNONCÉ d'une question pas encore corrigée : son
	    bouton reste masqué (2026-09-27). Exécuter le programme d'un « que va
	    afficher ce programme ? » donnait la réponse. Le signe de correction est
	    celui du glossaire (engine/termes.ts) : le verrou global du quiz,
	    `.quiz-is-locked`. Une LECTURE (`data-lecture`), un indice, une
	    explication gardent le leur : ils enseignent, ils ne demandent rien. */
	function enonceNonCorrige(bloc: HTMLElement): boolean {
		return !!bloc.closest(".quiz-question")
			&& !bloc.closest(".quiz-card[data-lecture]")
			&& !bloc.closest(".quiz-is-locked");
	}

	function bindCodeRunButtons(rootEl: Element | null = ctx.container): void {
		if (!rootEl) return;
		const python = ctx.host.python;

		rootEl.querySelectorAll<HTMLElement>(".quiz-code-block-executable").forEach(bloc => {
			const btn = bloc.querySelector<HTMLButtonElement>(".quiz-code-run-btn[data-quiz-code-run]");
			if (!btn) return;

			if (!python) {
				// Greffon Obsidian (ou tout hôte sans bac à sable) : aucun bouton.
				bloc.querySelector(".quiz-code-toolbar")?.remove();
				bloc.classList.remove("quiz-code-block-executable");
				return;
			}

			// Masqué tel qu'émis (grammaire-blocs.ts) ; réévalué au prochain
			// rendu de la carte, une fois le quiz corrigé.
			if (enonceNonCorrige(bloc)) return;

			btn.hidden = false;
			btn.setAttribute("aria-label", t("engine.code.run"));

			if (!prechauffe) {
				prechauffe = true;
				try { python.warm(); } catch (_) { /* meilleur effort */ }
			}

			if (btn.dataset.quizCodeBound === "1") return;
			btn.dataset.quizCodeBound = "1";
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (btn.disabled) return;
				const codeEl = bloc.querySelector("code");
				void executer(btn, codeEl?.textContent ?? "");
			});
		});
	}

	return { bindCodeRunButtons };
}
