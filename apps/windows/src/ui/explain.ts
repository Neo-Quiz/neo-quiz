/* ══════════════════════════════════════════════════════════
   "EXPLAIN" ON A PLAYED QUESTION (2026-09-29)

   A button in its own row under the question, above the arrows: it sends
   the question on screen to Claude Code or Codex — the prompt is a template
   the learner can change (Settings › AI), filled by `explain-prompt.ts` —
   and opens the answer in a window, written live, with room for follow-up
   questions. It replaces a screenshot and a typed prompt.

   Not in an Exam: the button hides as soon as the test clock shows (the
   engine adds `.quiz-exam-timer` to the host), in Learn and in a Test
   played without exam mode it stays.

   Same engine as the Generate page's chat (`AiClient.chat`): the CLI is
   launched with its fixed options and no tool, the whole conversation goes
   with each message, and the answer is rendered by `renderMarkdownPreview`
   (every text through the sanitizer's first gate).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { createAiClient } from "../../../../src/dashboard/ai-client";
import type { ChatTurn } from "../../../../src/dashboard/ai-client";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import * as aiProviders from "../../../../src/dashboard/ai-providers";
import { renderMarkdownPreview } from "../../../../src/markdown-preview";
import { remplirPromptExplication } from "../../../../src/explain-prompt";

const LETTRES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The default longest explanation, in characters: about a screen. */
export const EXPLAIN_MAX_CHARS_DEFAUT = 1500;

/** "0:07" — the time the model has worked. */
function duree(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The question slide on screen, if the current slide is one. */
function questionAffichee(hote: HTMLElement): HTMLElement | null {
	const s = hote.querySelector<HTMLElement>('.quiz-track > .quiz-track-item[aria-hidden="false"]');
	return s && s.dataset.slideKind === "question" && s.dataset.qi !== undefined ? s : null;
}

/** What the learner has answered on that slide, as they see it. */
function maReponse(slide: HTMLElement): string {
	const options = [...slide.querySelectorAll<HTMLElement>(".quiz-option[data-orig]")];
	const choisies = options
		.map((o, pos) => ({ o, pos }))
		// Chosen: "selected" before the correction, "correct"/"wrong" after it.
		.filter(({ o }) => o.getAttribute("aria-pressed") === "true" || ["selected", "correct", "wrong"].some(c => o.classList.contains(c)))
		.map(({ o, pos }) => `${LETTRES[pos] ?? pos + 1}. ${o.textContent?.trim() ?? ""}`);
	if (choisies.length) return choisies.join(" ; ");
	const saisies = [...slide.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type=text]")]
		.map(i => i.value.trim()).filter(Boolean);
	return saisies.join(" ; ");
}

export function monterBoutonExpliquer(hote: HTMLElement, deps: {
	questions: Record<string, unknown>[];
	titre: string;
	settings: AiSettingsHost;
}): () => void {
	const host = currentHost();
	/* A row of the panel, right under the question and above the bar of
	   arrows (`ui/quiz-bars.ts` keeps the slides clear of it). */
	const panneau = hote.closest<HTMLElement>(".qbd-qz");
	if (!panneau) return () => {};
	const rangee = ajouter(panneau, "div", "qz-above-bar qz-explain-row");
	const barre = panneau.querySelector(":scope > .qz-bottom-bar");
	if (barre) panneau.insertBefore(rangee, barre);
	const bouton = ajouter(rangee, "button", "qbd-qz-explain");
	bouton.type = "button";
	bouton.title = t("ai.explain.buttonTip");
	/* The LOGO of the provider chosen in Settings (Claude Code's or
	   Codex's), read at each paint: it says who will answer. Sparkles when
	   the provider cannot explain (the click then says so). */
	const icone = ajouter(bouton, "span", "qbd-qz-explain-icon");
	const id = deps.settings.get().aiProvider || "";
	if (id === "claude-code" || id === "codex") {
		const p = aiProviders.getProvider(id);
		icone.classList.add("qbd-provider-logo", "qbd-provider-logo--" + p.logo);
		aiProviders.setBrandLogo(icone, p.logo);
	} else {
		host.ui.setIcon(icone, "sparkles");
	}
	ajouter(bouton, "span", undefined, t("ai.explain.button"));

	/* Hidden in an Exam: the engine puts its clock straight into the host. */
	const majVisibilite = (): void => {
		rangee.hidden = !!hote.querySelector(":scope > .quiz-exam-timer");
	};
	/* Clickable only once the question on screen has an answer: without
	   one the prompt would carry an empty "My answer" and explain nothing
	   about the learner's own choice. */
	const majActivation = (): void => {
		const slide = questionAffichee(hote);
		const repondu = !!slide && maReponse(slide) !== "";
		bouton.disabled = !repondu;
		bouton.title = t(repondu ? "ai.explain.buttonTip" : "ai.explain.answerFirst");
	};
	const observateur = new MutationObserver(() => { majVisibilite(); majActivation(); });
	observateur.observe(hote, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "aria-hidden"] });
	hote.addEventListener("input", majActivation);
	majVisibilite();
	majActivation();

	bouton.addEventListener("click", () => {
		const provider = deps.settings.get().aiProvider || "";
		if (provider !== "claude-code" && provider !== "codex") { host.ui.notice(t("ai.chat.providerUnsupported")); return; }
		const slide = questionAffichee(hote);
		const q = slide ? deps.questions[Number(slide.dataset.qi)] : undefined;
		if (!slide || !q) { host.ui.notice(t("ai.explain.noQuestion")); return; }
		const ordre = [...slide.querySelectorAll<HTMLElement>(".quiz-option[data-orig]")].map(o => Number(o.dataset.orig));
		const modele = deps.settings.get().aiExplainPrompt?.trim() || t("ai.explain.defaultPrompt");
		const message = remplirPromptExplication(modele, q, { quiz: deps.titre, myAnswer: maReponse(slide), ordre });
		ouvrirExplication(message, deps.settings, t("ai.explain.asked", { question: String((q as { title?: unknown }).title ?? "").trim() }));
	});

	return () => { observateur.disconnect(); hote.removeEventListener("input", majActivation); rangee.remove(); };
}

/** The explanation window: the conversation, written live, and a field for
    the next question. Closing it stops a running answer. */
function ouvrirExplication(premier: string, settings: AiSettingsHost, libellePremier: string): void {
	const host = currentHost();
	const client = createAiClient(settings);
	const historique: ChatTurn[] = [];
	let enCours = false;

	requireHost("modals").open({
		className: "nq-explain-modal",
		title: t("ai.explain.title"),
		onOpen: (m) => {
			const fil = ajouter(m.contentEl, "div", "nq-explain-fil");
			const composer = ajouter(m.contentEl, "div", "nq-explain-composer");
			const champ = ajouter(composer, "textarea", "nq-explain-champ");
			champ.rows = 1;
			champ.placeholder = t("ai.explain.followUp");
			const envoi = ajouter(composer, "button", "nq-explain-envoi");
			envoi.type = "button";

			const majEnvoi = (): void => {
				envoi.replaceChildren();
				host.ui.setIcon(envoi, enCours ? "square" : "arrow-up");
				envoi.setAttribute("aria-label", t(enCours ? "ai.explain.stop" : "ai.explain.send"));
				envoi.disabled = !enCours && !champ.value.trim();
			};

			const enBas = (): boolean => fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60;

			async function envoyer(texte: string, affiche?: string): Promise<void> {
				if (enCours || !texte.trim()) return;
				enCours = true;
				historique.push({ role: "user", text: texte.trim() });
				ajouter(fil, "div", "qbd-ai-bulle nq-explain-demande", (affiche ?? texte).trim());
				const rep = ajouter(fil, "div", "qbd-ai-chat-reponse");
				const tete = ajouter(rep, "div", "qbd-ai-chat-tete");
				const p = aiProviders.getProvider(settings.get().aiProvider || "");
				const logo = ajouter(tete, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
				aiProviders.setBrandLogo(logo, p.logo);
				const id = settings.get().aiModel || p.defaultModel || "";
				const nom = id ? aiProviders.libelleModele(settings.get().aiProvider || "", id) : p.name;
				const etat = ajouter(tete, "span", undefined, t("ai.chat.working", { model: nom }));
				const temps = ajouter(tete, "span", "qbd-ai-file-temps", "0:00");
				const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
				ajouter(prose, "span", "qbd-ai-chat-attente", t("ai.chat.thinking"));
				fil.scrollTop = fil.scrollHeight;
				majEnvoi();

				const debut = Date.now();
				const horloge = window.setInterval(() => { temps.textContent = duree(Date.now() - debut); }, 1000);
				let texteVivant = "";
				let image = 0;
				const peindre = (): void => {
					image = 0;
					const bas = enBas();
					prose.innerHTML = renderMarkdownPreview(texteVivant);
					if (bas) fil.scrollTop = fil.scrollHeight;
				};
				try {
					const reponse = await client.chat(historique, {
						style: "explain",
						maxChars: settings.get().aiExplainMaxChars ?? EXPLAIN_MAX_CHARS_DEFAUT,
						onTranscript: (ev) => {
							if (ev.kind !== "text") return;
							texteVivant += ev.text;
							if (!image) image = requestAnimationFrame(peindre);
						},
					});
					if (image) cancelAnimationFrame(image);
					historique.push({ role: "assistant", text: reponse });
					texteVivant = reponse;
					peindre();
					etat.textContent = t("ai.chat.worked", { model: nom, time: duree(Date.now() - debut) });
					temps.remove();
				} catch (err) {
					if (image) cancelAnimationFrame(image);
					historique.pop();
					const e = err as Error & { aborted?: boolean };
					temps.remove();
					etat.textContent = e?.aborted ? t("ai.explain.stop") : "";
					prose.replaceChildren();
					if (!e?.aborted) ajouter(prose, "div", "qbd-ai-reponse-erreur", e?.message || t("ai.error.checkSettings"));
				} finally {
					window.clearInterval(horloge);
					enCours = false;
					majEnvoi();
				}
			}

			champ.addEventListener("input", () => {
				champ.style.height = "auto";
				champ.style.height = Math.min(champ.scrollHeight, 160) + "px";
				majEnvoi();
			});
			champ.addEventListener("keydown", (e) => {
				if (e.key !== "Enter" || e.shiftKey) return;
				e.preventDefault();
				const texte = champ.value;
				champ.value = "";
				champ.style.height = "auto";
				void envoyer(texte);
			});
			envoi.addEventListener("click", () => {
				if (enCours) { client.abort(); return; }
				const texte = champ.value;
				champ.value = "";
				champ.style.height = "auto";
				void envoyer(texte);
			});
			majEnvoi();
			void envoyer(premier, libellePremier);
		},
		// Closing stops a running answer: nobody would read it.
		onClose: () => { if (enCours) client.abort(); },
	});
}
