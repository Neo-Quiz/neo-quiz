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
import { openEffortSlider, openModelMenu, openProviderMenu } from "../../../../src/dashboard/ui-select";
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

/** The question on that slide has been CORRECTED (a Learn card once checked, a
    Test once handed in): its verdict or its explanation is on screen. The
    mini composer waits for it, so that nobody is told the answer early. */
function corrigee(slide: HTMLElement): boolean {
	return slide.classList.contains("quiz-learn-revealed")
		|| !!slide.querySelector(".quiz-explain, .quiz-option.correct, .quiz-option.wrong, .quiz-option.missed");
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
	/** Opens the Settings on the field that holds the Explain prompt. */
	ouvrirPrompt(): void;
}): () => void {
	const host = currentHost();
	/* A mini composer in a row of the panel, right under the question and above
	   the bar of arrows (`ui/quiz-bars.ts` keeps the slides clear of it). It
	   only shows once the question on screen has been corrected (Check in a
	   Learn, the hand-in of a Test): before that, the answer is not yet known.
	   */
	const panneau = hote.closest<HTMLElement>(".qbd-qz");
	if (!panneau) return () => {};
	const rangee = ajouter(panneau, "div", "qz-above-bar qz-explain-row");
	const barre = panneau.querySelector(":scope > .qz-bottom-bar");
	if (barre) panneau.insertBefore(rangee, barre);
	const mini = ajouter(rangee, "div", "qz-mini");
	/* THE PROMPT TILE (the "pasted" tile of claude.ai's composer): a small
	   card with the start of the prompt that will be sent and a pencil that
	   opens the Settings on the field where it is written, so that the
	   learner sees what is sent, where it comes from and where to change it. */
	const tuile = ajouter(mini, "div", "qz-mini-tuile");
	const apercu = ajouter(tuile, "div", "qz-mini-tuile-texte");
	const tuilePied = ajouter(tuile, "div", "qz-mini-tuile-pied");
	ajouter(tuilePied, "span", "qz-mini-tuile-nom", t("ai.explain.tile"));
	const crayon = ajouter(tuilePied, "button", "qz-mini-tuile-edit");
	crayon.type = "button";
	crayon.title = t("ai.explain.tileEdit");
	crayon.setAttribute("aria-label", t("ai.explain.tileEdit"));
	host.ui.setIcon(crayon, "pencil");
	crayon.addEventListener("click", () => deps.ouvrirPrompt());
	const pied = ajouter(mini, "div", "qz-mini-pied");
	const outils = ajouter(pied, "div", "qz-mini-outils");
	/* The PROVIDER, its logo right before the model's name: it says who will
	   answer and opens the list of those that can (below). */
	const fournisseurBtn = ajouter(outils, "button", "qbd-select qbd-provider-trigger-logo qz-mini-fournisseur");
	fournisseurBtn.type = "button";
	const modeleBtn = ajouter(outils, "button", "qbd-select qbd-model-trigger qbd-composer-plain");
	modeleBtn.type = "button";
	const modeleLabel = ajouter(modeleBtn, "span", "qbd-select-label");
	const effortBtn = ajouter(outils, "button", "qbd-select qbd-effort-trigger qbd-composer-plain");
	effortBtn.type = "button";
	const effortLabel = ajouter(effortBtn, "span", "qbd-select-label qbd-effort-trigger-label");
	const envoi = ajouter(outils, "button", "qz-mini-envoi");
	envoi.type = "button";
	envoi.setAttribute("aria-label", t("ai.explain.button"));
	host.ui.setIcon(ajouter(envoi, "span"), "arrow-up");

	/* The providers that can HOLD a conversation — the two CLIs the chat of
	   Generate speaks to (`AiClient.chat`). Ollama and Antigravity CLI cannot
	   yet: their calls only know how to return a quiz. */
	const LOCAUX = ["claude-code", "codex"];
	/* The provider of this composer: the one of the Settings when it can chat,
	   else the first installed (Claude Code, then Codex), else none — the
	   learner is asked to pick. Written to the Settings only when it differs
	   at send time or is picked by hand, so that merely opening a quiz never
	   changes the provider of the Generate page. */
	let courant = LOCAUX.includes(deps.settings.get().aiProvider || "") ? (deps.settings.get().aiProvider as string) : "";
	const fournisseur = (): string => courant;
	const peutExpliquer = (): boolean => courant !== "";
	const modeles = (): aiProviders.ModelDef[] =>
		fournisseur() === "claude-code" ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels("codex");
	/* The model of the Settings belongs to the provider it was chosen for:
	   another provider falls back to its own default. */
	const modeleCourant = (): string => {
		const reglage = deps.settings.get().aiProvider === courant ? deps.settings.get().aiModel : "";
		return courant === "claude-code" ? aiProviders.resolveClaudeModel(reglage) : aiProviders.resolveCodexModel(reglage);
	};
	const efforts = () => aiProviders.getEfforts(fournisseur(), modeleCourant());
	const effortCourant = (): string => aiProviders.resolveEffort(fournisseur(), deps.settings.get().aiEffort, modeleCourant());

	const peindreOutils = (): void => {
		fournisseurBtn.replaceChildren();
		if (peutExpliquer()) {
			const p = aiProviders.getProvider(fournisseur());
			const logo = ajouter(fournisseurBtn, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
			aiProviders.setBrandLogo(logo, p.logo);
			fournisseurBtn.title = p.name;
		} else {
			// No provider yet: an empty slot, the click opens the list.
			host.ui.setIcon(ajouter(fournisseurBtn, "span", "qbd-provider-logo"), "circle-dashed");
			fournisseurBtn.title = t("ai.provider.choose");
		}
		modeleBtn.hidden = effortBtn.hidden = !peutExpliquer();
		if (!peutExpliquer()) return;
		const cur = modeleCourant();
		modeleLabel.textContent = modeles().find(m => m.value === cur)?.label ?? cur;
		const ev = effortCourant();
		effortLabel.textContent = efforts().find(e => e.value === ev)?.label ?? ev;
	};
	const choisirFournisseur = async (id: string): Promise<void> => {
		courant = id;
		await deps.settings.save({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
		peindreOutils();
	};
	fournisseurBtn.addEventListener("click", () => {
		openProviderMenu(fournisseurBtn, {
			brands: aiProviders.MARQUES
				.map(m => ({
					value: m.id,
					label: m.name,
					logo: m.logo,
					channels: m.canaux.filter(c => LOCAUX.includes(c.id)).map(c => ({ value: c.id, label: c.label, sub: c.sub, logo: c.logo || m.logo })),
				}))
				.filter(b => b.channels.length > 0),
			current: courant,
			renderLogo: (el, logo) => aiProviders.setBrandLogo(el, logo),
			onPick: (id) => { void choisirFournisseur(id); },
		});
	});
	/* No usable provider in the Settings: the default is the first CLI that is
	   installed, Claude Code before Codex. */
	if (!peutExpliquer()) {
		void (async () => {
			const claude = await aiProviders.checkClaudeCode();
			if (claude.ok) courant = "claude-code";
			else if ((await aiProviders.checkCodex()).ok) courant = "codex";
			if (fournisseurBtn.isConnected) peindreOutils();
		})();
	}
	peindreOutils();
	void aiProviders.refreshCliCaches().then(change => { if (change && modeleBtn.isConnected) peindreOutils(); });
	modeleBtn.addEventListener("click", async () => {
		await aiProviders.refreshCliCaches();
		if (!modeleBtn.isConnected) return;
		openModelMenu(modeleBtn, {
			models: modeles(),
			moreModels: fournisseur() === "claude-code" ? aiProviders.getClaudeMoreModels() : undefined,
			currentModel: modeleCourant(),
			efforts: [],
			onPickModel: async (v) => { await deps.settings.save({ aiModel: v }); peindreOutils(); },
		});
	});
	effortBtn.addEventListener("click", () => {
		openEffortSlider(effortBtn, {
			variant: fournisseur() === "claude-code" ? "claude" : "codex",
			efforts: efforts(),
			currentEffort: effortCourant(),
			onPickEffort: async (v) => { await deps.settings.save({ aiEffort: v }); peindreOutils(); },
		});
	});

	/* The prompt of the question on screen, built from the template of the
	   Settings; the tile shows its start. */
	const messagePour = (slide: HTMLElement): string | null => {
		const q = deps.questions[Number(slide.dataset.qi)];
		if (!q) return null;
		const ordre = [...slide.querySelectorAll<HTMLElement>(".quiz-option[data-orig]")].map(o => Number(o.dataset.orig));
		const modele = deps.settings.get().aiExplainPrompt?.trim() || t("ai.explain.defaultPrompt");
		return remplirPromptExplication(modele, q, { quiz: deps.titre, myAnswer: maReponse(slide), ordre });
	};

	/* Hidden in an Exam (the engine puts its clock straight into the host) and
	   until the question is corrected. */
	const majVisibilite = (): void => {
		const slide = questionAffichee(hote);
		rangee.hidden = !!hote.querySelector(":scope > .quiz-exam-timer") || !slide || !corrigee(slide);
		if (rangee.hidden || !slide) return;
		const texte = messagePour(slide) ?? "";
		if (apercu.textContent !== texte) apercu.textContent = texte;
	};
	const observateur = new MutationObserver(majVisibilite);
	observateur.observe(hote, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "aria-hidden"] });
	hote.addEventListener("input", majVisibilite);
	majVisibilite();

	const lancer = async (): Promise<void> => {
		if (!peutExpliquer()) { fournisseurBtn.click(); return; }
		const slide = questionAffichee(hote);
		const q = slide ? deps.questions[Number(slide.dataset.qi)] : undefined;
		const base = slide ? messagePour(slide) : null;
		if (!slide || !q || base === null) { host.ui.notice(t("ai.explain.noQuestion")); return; }
		const etiquette = t("ai.explain.asked", { question: String((q as { title?: unknown }).title ?? "").trim() });
		/* The provider shown here is the one that answers: the client reads the Settings. */
		if (deps.settings.get().aiProvider !== courant) await choisirFournisseur(courant);
		ouvrirExplication(base, deps.settings, etiquette);
	};
	envoi.addEventListener("click", () => void lancer());

	return () => { observateur.disconnect(); hote.removeEventListener("input", majVisibilite); rangee.remove(); };
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
