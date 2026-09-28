import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";
import { nettoyerTraceback } from "../code-exercise/traceback";
import type { CodeRun } from "../host/types";
import type { CodeLanguage } from "../code-languages";

/* ══════════════════════════════════════════════════════════
   THE « RUN » BUTTON of a code block shown in a quiz (Learn, statements,
   explanations, hints… any text that goes through `engine/sanitizer.ts` →
   `grammaire-blocs.ts`, THE single rendering point for code blocks). Until
   task 5, only Python runs — see `code-languages.ts`.

   `grammaire-blocs.ts` (pure) emits the markup ahead of time, hidden
   (`hidden`): it is this module, with `ctx` (hence the host), that decides
   whether to show it — `HostCode` is an OPTIONAL contract member, absent
   under the Obsidian plugin, which runs no code. Without it, the button and
   the toolbar are REMOVED from the DOM, never left inert.

   Security (finding M4 of the sandbox review, 2026-09-27): `stdout` and an
   error are text whose AUTHOR IS THE QUIZ'S — a shared quiz is hostile.
   Always set through `textContent`, never through one of the sanitizer's
   four HTML gates (which would interpret markdown or HTML in a program's
   output). The executed code is read back from `<code>` through
   `textContent` (never an attribute copied by hand, never desynchronised
   from the displayed block — `textContent` restores the source text, HTML
   entities included, exactly as `colorerCode`/`echapper` wrote it).
══════════════════════════════════════════════════════════ */

/** Le délai le plus long qu'un clic manuel mérite d'attendre : le contrat
    (`canaux.ts`) borne `timeoutMs` à 10 s au maximum, on prend ce plafond. */
const TIMEOUT_MS = 10_000;

export interface CodeRunHandlers {
	/** Unmasks (and wires up) every « Run » button under `rootEl` if the host
	    provides `HostCode`, or removes it otherwise. Call right after
	    `mathifyElement`, like `bindQuizResourceButtons`. */
	bindCodeRunButtons(rootEl?: Element | null): void;
}

export function createCodeRunHandlers(ctx: EngineCtx): CodeRunHandlers {
	/** A language's engine is pre-warmed once for the whole engine session,
	    at the first appearance of a runnable block — `warm()` has no effect
	    if it is already loaded (contract `HostCode`). */
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
	function texteResultat(resultat: CodeRun): { texte: string; erreur: boolean; panne: boolean } {
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
			case "compile-error":
				return { texte: resultat.error ?? "", erreur: true, panne: false };
			case "timeout":
				return { texte: t("engine.code.timeout"), erreur: false, panne: true };
			case "too-long":
				return { texte: t("engine.code.tooLong"), erreur: false, panne: true };
			case "not-installed":
				return { texte: t("engine.code.notInstalled"), erreur: false, panne: true };
			case "unavailable":
			default:
				return { texte: t("engine.code.unavailable"), erreur: false, panne: true };
		}
	}

	async function executer(btn: HTMLButtonElement, source: string, language: CodeLanguage): Promise<void> {
		const code = ctx.host.code;
		if (!code) return; // cannot happen (button removed without HostCode), honest guard
		const bloc = btn.closest<HTMLElement>(".quiz-code-block");
		if (!bloc) return;
		const sortie = sortieDe(bloc);

		btn.disabled = true;
		btn.classList.add("quiz-code-run-running");
		sortie.hidden = false;
		sortie.classList.remove("quiz-code-output-error", "quiz-code-output-panne");
		sortie.textContent = t("engine.code.running");

		try {
			const resultat = await code.run({ language, code: source, stdin: "", timeoutMs: TIMEOUT_MS });
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
		const code = ctx.host.code;

		rootEl.querySelectorAll<HTMLElement>(".quiz-code-block-executable").forEach(bloc => {
			const btn = bloc.querySelector<HTMLButtonElement>(".quiz-code-run-btn[data-quiz-code-run]");
			if (!btn) return;

			if (!code) {
				// Greffon Obsidian (ou tout hôte sans bac à sable) : aucun bouton.
				bloc.querySelector(".quiz-code-toolbar")?.remove();
				bloc.classList.remove("quiz-code-block-executable");
				return;
			}

			// Masqué tel qu'émis (grammaire-blocs.ts) ; réévalué au prochain
			// rendu de la carte, une fois le quiz corrigé.
			if (enonceNonCorrige(bloc)) return;

			// Until grammaire-blocs.ts writes `data-lang` (task 5), a runnable
			// block is necessarily Python.
			const language = (bloc.dataset.lang ?? "python") as CodeLanguage;

			btn.hidden = false;
			btn.setAttribute("aria-label", t("engine.code.run"));

			if (!prechauffe) {
				prechauffe = true;
				try { code.warm(language); } catch (_) { /* meilleur effort */ }
			}

			if (btn.dataset.quizCodeBound === "1") return;
			btn.dataset.quizCodeBound = "1";
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (btn.disabled) return;
				const codeEl = bloc.querySelector("code");
				void executer(btn, codeEl?.textContent ?? "", language);
			});
		});
	}

	return { bindCodeRunButtons };
}
