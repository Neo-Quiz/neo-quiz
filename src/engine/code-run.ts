import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";
import { nettoyerTraceback } from "../code-exercise/traceback";
import type { CodeRun } from "../host/types";
import { executionVisible, runInLastHintProbleme, type CodeLanguage } from "../code-languages";

/* ══════════════════════════════════════════════════════════
   THE « RUN » BUTTON of a code block shown in a quiz (Learn, statements,
   explanations, hints… any text that goes through `engine/sanitizer.ts` →
   `grammaire-blocs.ts`, THE single rendering point for code blocks). Which
   block languages run is the pure table `langageDeBloc` (`code-languages.ts`):
   the block's `data-lang` (python/c/cpp) is compared here against what the
   host's `HostCode.languages()` actually offers — a language of the table
   the current host does not implement yet stays a bare block, same as one
   outside the table entirely.

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
			const job = { language, code: source, stdin: "", timeoutMs: TIMEOUT_MS };
			let resultat = await code.run(job);
			/* THE LANGUAGE IS DOWNLOADED ON FIRST USE (task 10): C and C++
			   answer `not-installed` until their pack is there. With a host
			   that can install it, the progress replaces "Running…", then
			   the program runs ONCE more — never in a loop. */
			if (resultat.status === "not-installed" && code.installer) {
				sortie.classList.add("quiz-code-output-panne");
				sortie.textContent = t("engine.code.installing", { percent: 0 });
				const installe = await code.installer(language, percent => { sortie.textContent = t("engine.code.installing", { percent }); });
				if (installe !== "ok") {
					sortie.textContent = t(installe === "refused" ? "engine.code.installRefused" : "engine.code.installOffline");
					return;
				}
				sortie.classList.remove("quiz-code-output-panne");
				sortie.textContent = t("engine.code.running");
				resultat = await code.run(job);
			}
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

	/** Does ▶ show on this block (src/code-languages.ts `executionVisible`)? A
	    block in the STATEMENT of a question not yet corrected stays masked
	    (2026-09-27): running the program of a "what does this print?" question
	    would give the answer away. The sign of correction is the same as the
	    glossary's (engine/termes.ts): the quiz's global lock, `.quiz-is-locked`.
	    A READING (`data-lecture`), a hint or an explanation keep theirs: they
	    teach, they ask nothing. `runInLastHint` (task 6, 2026-09-28) lifts the
	    mask early once every hint level of THIS question has been revealed —
	    the field is ignored when `runInLastHintProbleme` rejects it, so a
	    hand-written bad quiz never unlocks ▶ this way. */
	function executionVisibleSur(bloc: HTMLElement): boolean {
		const slide = bloc.closest<HTMLElement>('.quiz-track-item[data-slide-kind="question"]');
		const qi = Number(slide?.dataset.qi);
		const q = Number.isInteger(qi) ? ctx.quiz[qi] : undefined;
		return executionVisible({
			inStatement: !!bloc.closest(".quiz-question"),
			reading: !!bloc.closest(".quiz-card[data-lecture]"),
			corrected: !!bloc.closest(".quiz-is-locked"),
			runInLastHint: q?.runInLastHint === true && runInLastHintProbleme(q) === null,
			allHintLevelsSeen: Number.isInteger(qi) && ctx.hint.tousNiveauxVus(qi),
		});
	}

	function bindCodeRunButtons(rootEl: Element | null = ctx.container): void {
		if (!rootEl) return;
		const code = ctx.host.code;

		rootEl.querySelectorAll<HTMLElement>(".quiz-code-block-executable").forEach(bloc => {
			const btn = bloc.querySelector<HTMLButtonElement>(".quiz-code-run-btn[data-quiz-code-run]");
			if (!btn) return;

			// `data-lang` (grammaire-blocs.ts) names the block's language
			// (python/c/cpp) — no button when the host has none (Obsidian
			// plugin) or when it does not implement THIS block's language yet
			// (a language of the table the current host has not wired up, same
			// treatment as a language outside the table entirely).
			const language = (bloc.dataset.lang ?? "") as CodeLanguage;
			if (!code || !code.languages().includes(language)) {
				bloc.querySelector(".quiz-code-toolbar")?.remove();
				bloc.classList.remove("quiz-code-block-executable");
				return;
			}

			// Masked as emitted (grammaire-blocs.ts); re-evaluated on the card's
			// next render, once the quiz is corrected (or, for a `runInLastHint`
			// question, once its last hint level is revealed).
			if (!executionVisibleSur(bloc)) return;

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
