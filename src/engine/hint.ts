import type { EngineCtx } from "../types/engine-ctx";
import { mathifyElement } from "./mathjax";
import { reinitialiserBudgetRendu } from "./code-highlight";
import { t } from "../i18n";

export interface HintHandlers {
	getHintThemeMode(): "light" | "dark";
	applyHintModalTheme(): void;
	ensureHintModal(): HTMLElement;
	openHintModal(text: string | undefined): void;
	closeHintModal(): void;
}

export function createHintHandlers(ctx: EngineCtx): HintHandlers {
	// Variables locales
	let __quizHintCloseTimer = 0;
	let __quizHintOpenRaf1 = 0;
	let __quizHintOpenRaf2 = 0;
	let __quizHintFocusTimer = 0;

	function getHintThemeMode(): "light" | "dark" {
		const body = document.body;
		const root = document.documentElement;
		if (body?.classList.contains("theme-light") || root?.classList.contains("theme-light")) return "light";
		if (body?.classList.contains("theme-dark") || root?.classList.contains("theme-dark")) return "dark";
		const cs = getComputedStyle(body || root);
		const bg = (cs.getPropertyValue("--background-primary") || "").trim().toLowerCase();
		return bg && (bg.includes("#fff") || bg.includes("255")) ? "light" : "dark";
	}

	function applyHintModalTheme(): void {
		const overlay = document.getElementById(ctx.HINT_OVERLAY_ID);
		if (!overlay) return;
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		const header = overlay.querySelector<HTMLElement>(".quiz-hint-modal-header");
		const title = overlay.querySelector<HTMLElement>(".quiz-hint-modal-title");
		const bodyEl = overlay.querySelector<HTMLElement>(".quiz-hint-modal-body");
		const closeBtn = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
		const mode = getHintThemeMode();
		overlay.dataset.theme = mode;
		const base = getComputedStyle(document.body);
		const bgPrimary = (base.getPropertyValue("--background-primary") || "").trim() || (mode === "dark" ? "#111827" : "#ffffff");
		const bgSecondary = (base.getPropertyValue("--background-secondary") || "").trim() || (mode === "dark" ? "#1f2937" : "#f5f6fa");
		const textNormal = (base.getPropertyValue("--text-normal") || "").trim() || (mode === "dark" ? "#e5e7eb" : "#1f2937");
		const border = (base.getPropertyValue("--background-modifier-border") || "").trim() || (mode === "dark" ? "rgba(148,163,184,.25)" : "rgba(31,41,55,.14)");
		const shadow = mode === "dark" ? "0 18px 48px rgba(2,6,23,.45)" : "0 18px 48px rgba(15,23,42,.14)";
		const overlayBg = mode === "dark" ? "rgba(2,6,23,.42)" : "rgba(15,23,42,.16)";
		overlay.style.background = overlayBg;
		if (modal) {
			modal.style.background = bgPrimary;
			modal.style.color = textNormal;
			modal.style.border = `1px solid ${border}`;
			modal.style.boxShadow = shadow;
		}
		if (header) {
			header.style.background = bgSecondary;
			header.style.borderBottom = `1px solid ${border}`;
		}
		if (title) title.style.color = textNormal;
		if (bodyEl) bodyEl.style.color = textNormal;
		if (closeBtn) {
			closeBtn.style.color = textNormal;
			closeBtn.style.border = `1px solid ${border}`;
			closeBtn.style.background = mode === "dark" ? "rgba(255,255,255,.06)" : "rgba(15,23,42,.04)";
		}
	}

	function ensureHintModal(): HTMLElement {
		let overlay = document.getElementById(ctx.HINT_OVERLAY_ID);
		if (overlay) {
			applyHintModalTheme();
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = ctx.HINT_OVERLAY_ID;
		overlay.className = "quiz-hint-modal-overlay";
		overlay.innerHTML = `
			<div class="quiz-hint-modal" role="dialog" aria-modal="true" aria-labelledby="${ctx.HINT_TITLE_ID}">
				<div class="quiz-hint-modal-header">
					<div class="quiz-hint-modal-title" id="${ctx.HINT_TITLE_ID}">${t("engine.hint.title")}</div>
					<button class="quiz-hint-modal-close" type="button" aria-label="${ctx.escapeHtmlAttr(t("engine.hint.close"))}">×</button>
				</div>
				<div class="quiz-hint-modal-body"></div>
			</div>`;
		overlay.addEventListener("click", e => { if (e.target === overlay) closeHintModal(); });
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		if (modal) modal.addEventListener("click", e => e.stopPropagation());
		const closeBtn = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
		if (closeBtn) closeBtn.addEventListener("click", e => { e.preventDefault(); closeHintModal(); });
		document.body.appendChild(overlay);
		applyHintModalTheme();

		const escHandler = (e: KeyboardEvent): void => {
			const o = document.getElementById(ctx.HINT_OVERLAY_ID);
			if (!o || !o.classList.contains("is-open")) return;
			if (e.key === "Escape") return closeHintModal();
			if (e.key !== "Tab") return;
			const focusable = o.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
			if (focusable.length === 0) return;
			const first = focusable[0], last = focusable[focusable.length - 1];
			if (e.shiftKey) {
				if (document.activeElement === first) { e.preventDefault(); last.focus(); }
			} else if (document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", escHandler);
		ctx.__quizGlobalCleanups.push(() => document.removeEventListener("keydown", escHandler));

		if (typeof MutationObserver !== "undefined") {
			const themeObserver = new MutationObserver(() => {
				if (document.getElementById(ctx.HINT_OVERLAY_ID)) applyHintModalTheme();
			});
			themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
			if (document.documentElement) themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
			ctx.__quizGlobalCleanups.push(() => themeObserver.disconnect());
		}
		return overlay;
	}

	function openHintModal(text: string | undefined): void {
		const overlay = ensureHintModal();
		const body = overlay.querySelector<HTMLElement>(".quiz-hint-modal-body");
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		if (body) {
			// Budget de coloration remis à zéro : l'indice s'ouvre AU CLIC, hors
			// de tout rendu de carte — c'est son propre « rendu complet ». Sans
			// ce reset, il héritait du budget qu'un quiz lourd venait d'épuiser
			// et s'affichait sans couleurs (revue du 2026-09-26, tour 4).
			reinitialiserBudgetRendu();
			body.innerHTML = ctx.sanitize.renderHintWithCodeAndEmbeds(text);
			// LaTeX $...$ des indices : même rendu MathJax que les slides.
			void mathifyElement(body);
		}
		applyHintModalTheme();
		if (__quizHintCloseTimer) { clearTimeout(__quizHintCloseTimer); __quizHintCloseTimer = 0; }
		if (__quizHintOpenRaf1) cancelAnimationFrame(__quizHintOpenRaf1);
		if (__quizHintOpenRaf2) cancelAnimationFrame(__quizHintOpenRaf2);
		overlay.classList.add("is-open");
		overlay.style.transition = "none";
		overlay.style.opacity = "0";
		if (modal) {
			modal.style.transition = "none";
			modal.style.opacity = "0";
			modal.style.transform = "translateY(10px) scale(0.84)";
			modal.style.willChange = "transform, opacity";
			modal.style.transformOrigin = "center center";
		}
		void overlay.offsetWidth;
		__quizHintOpenRaf1 = requestAnimationFrame(() => {
			__quizHintOpenRaf2 = requestAnimationFrame(() => {
				overlay.style.transition = "opacity 320ms cubic-bezier(0.22, 1, 0.36, 1)";
				overlay.style.opacity = "1";
				if (modal) {
					modal.style.transition = "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.22, 1, 0.36, 1)";
					modal.style.opacity = "1";
					modal.style.transform = "translateY(0) scale(1)";
				}
				const focusTarget = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
				if (focusTarget) {
					if (__quizHintFocusTimer) clearTimeout(__quizHintFocusTimer);
					const epoch = ctx.currentAsyncEpoch();
					__quizHintFocusTimer = window.setTimeout(() => {
						__quizHintFocusTimer = 0;
						if (!ctx.isQuizInstanceAlive(epoch) || !overlay.classList.contains("is-open")) return;
						try { focusTarget.focus(); } catch (_) {}
					}, 340);
				}
			});
		});
	}

	function closeHintModal(): void {
		const overlay = document.getElementById(ctx.HINT_OVERLAY_ID);
		if (!overlay || !overlay.classList.contains("is-open")) return;
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		if (__quizHintOpenRaf1) cancelAnimationFrame(__quizHintOpenRaf1);
		if (__quizHintOpenRaf2) cancelAnimationFrame(__quizHintOpenRaf2);
		overlay.style.transition = "opacity 240ms cubic-bezier(0.4, 0, 0.2, 1)";
		overlay.style.opacity = "0";
		if (modal) {
			modal.style.transition = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms cubic-bezier(0.4, 0, 0.2, 1)";
			modal.style.opacity = "0";
			modal.style.transform = "translateY(8px) scale(0.94)";
		}
		if (__quizHintCloseTimer) clearTimeout(__quizHintCloseTimer);
		__quizHintCloseTimer = window.setTimeout(() => {
			overlay.classList.remove("is-open");
			overlay.style.transition = "";
			overlay.style.opacity = "";
			if (modal) {
				modal.style.transition = "";
				modal.style.opacity = "";
				modal.style.transform = "";
				modal.style.willChange = "";
				modal.style.transformOrigin = "";
			}
			__quizHintCloseTimer = 0;
		}, 300);
	}

	return {
		getHintThemeMode,
		applyHintModalTheme,
		ensureHintModal,
		openHintModal,
		closeHintModal
	};
}
