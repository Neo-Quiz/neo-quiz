/* ══════════════════════════════════════════════════════════
   "EXPLAIN" ON A PLAYED QUESTION (2026-09-29)

   A button in its own row under the question, above the arrows, once the
   question is corrected: it opens a WINDOW that can be closed and opened again
   without losing anything — the conversation about a question lives as long as
   the quiz page, a running answer goes on while the window is closed. The
   window is a chat like claude.ai's: the history above, below a composer that
   starts with a tile holding the Explain prompt (a template the learner can
   change in Settings › AI, filled by `explain-prompt.ts`), the provider,
   model and effort, and the send arrow. Sent, the tile joins the history and
   the composer goes on with follow-up questions.

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
import type { AiClient, ChatTurn } from "../../../../src/dashboard/ai-client";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import * as aiProviders from "../../../../src/dashboard/ai-providers";
import { openEffortSlider, openModelMenu, openProviderMenu } from "../../../../src/dashboard/ui-select";
import { renderMarkdownPreview } from "../../../../src/markdown-preview";
import { mathifyElement } from "../../../../src/engine/mathjax";
import { remplirPromptExplication } from "../../../../src/explain-prompt";
import { attacherUsage } from "./comptes";

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

/** One message of a conversation, as the window shows it. A user message that
    carries the prompt shows it as a tile, like a pasted text on claude.ai. */
interface Message {
	role: "user" | "assistant";
	text: string;
	tuile?: string;
	modele?: string;
	debut?: number;
	duree?: number;
	enCours?: boolean;
	erreur?: string;
	arrete?: boolean;
}

/** The conversation about ONE question: it lives as long as the quiz page, so
    that closing the window and opening it again loses nothing — a running
    answer goes on being written while the window is closed. */
interface Conversation {
	messages: Message[];
	historique: ChatTurn[];
	client: AiClient;
	enCours: boolean;
	/** The prompt tile has been sent: the composer is a plain one from now on. */
	envoye: boolean;
	/** Repaints the window; null while it is closed. */
	repeindre: (() => void) | null;
}

/** The prompt tile: the start of the text, its name, and (in the composer)
    a pencil that opens the Settings on the field where it is written. */
function creerTuile(parent: HTMLElement, texte: string, ouvrirPrompt?: () => void): HTMLElement {
	const tuile = ajouter(parent, "div", "qz-mini-tuile");
	ajouter(tuile, "div", "qz-mini-tuile-texte", texte);
	const pied = ajouter(tuile, "div", "qz-mini-tuile-pied");
	ajouter(pied, "span", "qz-mini-tuile-nom", t("ai.explain.tile"));
	if (ouvrirPrompt) {
		const crayon = ajouter(pied, "button", "qz-mini-tuile-edit");
		crayon.type = "button";
		crayon.title = t("ai.explain.tileEdit");
		crayon.setAttribute("aria-label", t("ai.explain.tileEdit"));
		currentHost().ui.setIcon(crayon, "pencil");
		crayon.addEventListener("click", ouvrirPrompt);
	}
	return tuile;
}

export function monterBoutonExpliquer(hote: HTMLElement, deps: {
	questions: Record<string, unknown>[];
	titre: string;
	settings: AiSettingsHost;
	/** Opens the Settings on the field that holds the Explain prompt. */
	ouvrirPrompt(): void;
}): () => void {
	const host = currentHost();
	/* The button sits in a row of the panel, under the question and above the
	   bar of arrows (`ui/quiz-bars.ts` keeps the slides clear of it). It only
	   shows once the question on screen has been corrected (Check in a Learn,
	   the hand-in of a Test): before that, the answer is not yet known. */
	const panneau = hote.closest<HTMLElement>(".qbd-qz");
	if (!panneau) return () => {};
	const rangee = ajouter(panneau, "div", "qz-above-bar qz-explain-row");
	const barre = panneau.querySelector(":scope > .qz-bottom-bar");
	if (barre) panneau.insertBefore(rangee, barre);
	const bouton = ajouter(rangee, "button", "qz-explain-btn");
	bouton.type = "button";
	const boutonLogo = ajouter(bouton, "span", "qz-explain-btn-logo");
	ajouter(bouton, "span", undefined, t("ai.explain.button"));

	/* The providers that can HOLD a conversation — the two CLIs the chat of
	   Generate speaks to (`AiClient.chat`). Ollama and Antigravity CLI cannot
	   yet: their calls only know how to return a quiz. */
	const LOCAUX = ["claude-code", "codex"];
	/* The provider of the window: the one of the Settings when it can chat,
	   else the first installed (Claude Code, then Codex), else none — the
	   learner is asked to pick. Written to the Settings only when it differs
	   at send time or is picked by hand, so that merely opening a quiz never
	   changes the provider of the Generate page. */
	let courant = LOCAUX.includes(deps.settings.get().aiProvider || "") ? (deps.settings.get().aiProvider as string) : "";
	const peutExpliquer = (): boolean => courant !== "";
	const modeles = (): aiProviders.ModelDef[] =>
		courant === "claude-code" ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels("codex");
	/* The model of the Settings belongs to the provider it was chosen for:
	   another provider falls back to its own default. */
	const modeleCourant = (): string => {
		const reglage = deps.settings.get().aiProvider === courant ? deps.settings.get().aiModel : "";
		return courant === "claude-code" ? aiProviders.resolveClaudeModel(reglage) : aiProviders.resolveCodexModel(reglage);
	};
	const efforts = () => aiProviders.getEfforts(courant, modeleCourant());
	const effortCourant = (): string => aiProviders.resolveEffort(courant, deps.settings.get().aiEffort, modeleCourant());
	const libelleModele = (): string => {
		const cur = modeleCourant();
		return modeles().find(m => m.value === cur)?.label ?? cur;
	};

	const peindreLogoBouton = (): void => {
		// The colours of the button follow the provider's logo (CSS on `data-nq-fournisseur`).
		bouton.dataset.nqFournisseur = courant;
		boutonLogo.replaceChildren();
		if (peutExpliquer()) {
			const p = aiProviders.getProvider(courant);
			const logo = ajouter(boutonLogo, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
			aiProviders.setBrandLogo(logo, p.logo);
		} else {
			host.ui.setIcon(boutonLogo, "sparkles");
		}
	};
	peindreLogoBouton();
	/* No usable provider in the Settings: the default is the first CLI that is
	   installed, Claude Code before Codex. */
	const detecterDefaut = async (): Promise<void> => {
		if (peutExpliquer()) return;
		if ((await aiProviders.checkClaudeCode()).ok) courant = "claude-code";
		else if ((await aiProviders.checkCodex()).ok) courant = "codex";
		if (bouton.isConnected) peindreLogoBouton();
	};
	void detecterDefaut();
	const choisirFournisseur = async (id: string): Promise<void> => {
		courant = id;
		await deps.settings.save({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
		peindreLogoBouton();
	};

	/* The prompt of a question, built from the template of the Settings. */
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
	};
	const observateur = new MutationObserver(majVisibilite);
	observateur.observe(hote, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "aria-hidden"] });
	majVisibilite();

	const conversations = new Map<number, Conversation>();
	const conversationDe = (qi: number): Conversation => {
		let c = conversations.get(qi);
		if (!c) {
			c = { messages: [], historique: [], client: createAiClient(deps.settings), enCours: false, envoye: false, repeindre: null };
			conversations.set(qi, c);
		}
		return c;
	};

	bouton.addEventListener("click", () => {
		const slide = questionAffichee(hote);
		const qi = slide ? Number(slide.dataset.qi) : NaN;
		if (!slide || !deps.questions[qi]) { host.ui.notice(t("ai.explain.noQuestion")); return; }
		ouvrirFenetre(qi, messagePour(slide) ?? "");
	});

	/** The window: the history above, the composer below. Built again at each
	    opening from the conversation, which is what survives. */
	function ouvrirFenetre(qi: number, prompt: string): void {
		const conv = conversationDe(qi);
		let horloge = 0;
		requireHost("modals").open({
			className: "nq-explain-modal",
			title: t("ai.explain.title"),
			onOpen: (m) => {
				const fil = ajouter(m.contentEl, "div", "nq-explain-fil");
				const composer = ajouter(m.contentEl, "div", "nq-explain-composer");
				if (!conv.envoye) creerTuile(composer, prompt, () => deps.ouvrirPrompt());
				const champ = ajouter(composer, "textarea", "nq-explain-champ");
				champ.rows = 1;
				// Before the first message there is nothing to type: the prompt tile IS the message.
				champ.readOnly = !conv.envoye;
				champ.placeholder = t(conv.envoye ? "ai.explain.followUp" : "ai.explain.miniPlaceholder");
				const pied = ajouter(composer, "div", "qz-mini-pied");
				/* The consumption of the provider, where the Settings already show
				   it: a gauge that opens its popover (Claude Code and Codex). */
				const usageBtn = ajouter(pied, "button", "qbd-select qz-mini-fournisseur qz-mini-usage");
				usageBtn.type = "button";
				host.ui.setIcon(usageBtn, "gauge");
				usageBtn.title = t("ai.usage.title");
				usageBtn.setAttribute("aria-label", t("ai.usage.title"));
				attacherUsage(usageBtn, () => (courant === "codex" ? "codex" : "claude"));
				const outils = ajouter(pied, "div", "qz-mini-outils");
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

				const peindreOutils = (): void => {
					fournisseurBtn.replaceChildren();
					if (peutExpliquer()) {
						const p = aiProviders.getProvider(courant);
						aiProviders.setBrandLogo(ajouter(fournisseurBtn, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo), p.logo);
						fournisseurBtn.title = p.name;
					} else {
						host.ui.setIcon(ajouter(fournisseurBtn, "span", "qbd-provider-logo"), "circle-dashed");
						fournisseurBtn.title = t("ai.provider.choose");
					}
					m.panelEl.dataset.nqFournisseur = courant;
					usageBtn.hidden = modeleBtn.hidden = effortBtn.hidden = !peutExpliquer();
					if (peutExpliquer()) {
						modeleLabel.textContent = libelleModele();
						const ev = effortCourant();
						effortLabel.textContent = efforts().find(e => e.value === ev)?.label ?? ev;
					}
					peindreLogoBouton();
				};
				const majEnvoi = (): void => {
					envoi.replaceChildren();
					host.ui.setIcon(ajouter(envoi, "span"), conv.enCours ? "square" : "arrow-up");
					envoi.setAttribute("aria-label", t(conv.enCours ? "ai.explain.stop" : "ai.explain.send"));
					// The first message may go without a word: the prompt tile is enough.
					envoi.disabled = !conv.enCours && conv.envoye && !champ.value.trim();
				};
				peindreOutils();
				majEnvoi();
				void detecterDefaut().then(() => { if (fournisseurBtn.isConnected) peindreOutils(); });
				fournisseurBtn.addEventListener("click", () => {
					openProviderMenu(fournisseurBtn, {
						brands: aiProviders.MARQUES
							.map(mq => ({
								value: mq.id,
								label: mq.name,
								logo: mq.logo,
								channels: mq.canaux.filter(c => LOCAUX.includes(c.id)).map(c => ({ value: c.id, label: c.label, sub: c.sub, logo: c.logo || mq.logo })),
							}))
							.filter(b => b.channels.length > 0),
						current: courant,
						renderLogo: (el, logo) => aiProviders.setBrandLogo(el, logo),
						onPick: (id) => { void choisirFournisseur(id).then(peindreOutils); },
					});
				});
				void aiProviders.refreshCliCaches().then(change => { if (change && modeleBtn.isConnected) peindreOutils(); });
				modeleBtn.addEventListener("click", async () => {
					await aiProviders.refreshCliCaches();
					if (!modeleBtn.isConnected) return;
					openModelMenu(modeleBtn, {
						models: modeles(),
						moreModels: courant === "claude-code" ? aiProviders.getClaudeMoreModels() : undefined,
						currentModel: modeleCourant(),
						efforts: [],
						onPickModel: async (v) => { await deps.settings.save({ aiModel: v }); peindreOutils(); },
					});
				});
				effortBtn.addEventListener("click", () => {
					openEffortSlider(effortBtn, {
						variant: courant === "claude-code" ? "claude" : "codex",
						efforts: efforts(),
						currentEffort: effortCourant(),
						onPickEffort: async (v) => { await deps.settings.save({ aiEffort: v }); peindreOutils(); },
					});
				});

				/* THE HISTORY, painted from the conversation. Only the last answer
				   changes while it is written; every message is repainted with it,
				   which is cheap at the length of these conversations. */
				const enBas = (): boolean => fil.scrollHeight - fil.scrollTop - fil.clientHeight < 80;
				const peindreFil = (): void => {
					// No message yet: the composer sits in the middle of the window, and drops to the bottom at the first one.
					m.contentEl.classList.toggle("nq-explain-vide", conv.messages.length === 0);
					const bas = enBas() || fil.childElementCount === 0;
					fil.replaceChildren();
					for (const msg of conv.messages) {
						if (msg.role === "user") {
							const bloc = ajouter(fil, "div", "nq-explain-msg-user");
							if (msg.tuile) creerTuile(bloc, msg.tuile);
							if (msg.text) ajouter(bloc, "div", "qbd-ai-bulle nq-explain-demande", msg.text);
							continue;
						}
						const rep = ajouter(fil, "div", "qbd-ai-chat-reponse");
						const tete = ajouter(rep, "div", "qbd-ai-chat-tete");
						const p = aiProviders.getProvider(courant || "claude-code");
						aiProviders.setBrandLogo(ajouter(tete, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo), p.logo);
						const nom = msg.modele ?? "";
						ajouter(tete, "span", undefined, msg.enCours ? t("ai.chat.working", { model: nom }) : msg.arrete ? t("ai.explain.stop") : t("ai.chat.worked", { model: nom, time: duree(msg.duree ?? 0) }));
						if (msg.enCours) ajouter(tete, "span", "qbd-ai-file-temps", duree(Date.now() - (msg.debut ?? Date.now())));
						const prose = ajouter(rep, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
						if (msg.erreur) ajouter(prose, "div", "qbd-ai-reponse-erreur", msg.erreur);
						else if (msg.text) {
							prose.innerHTML = renderMarkdownPreview(msg.text);
							if (msg.text.includes("$")) void mathifyElement(prose);
						}
						else if (msg.enCours) ajouter(prose, "span", "qbd-ai-chat-attente", t("ai.chat.thinking"));
					}
					if (bas) fil.scrollTop = fil.scrollHeight;
				};
				let image = 0;
				conv.repeindre = () => {
					if (image) return;
					image = requestAnimationFrame(() => { image = 0; if (fil.isConnected) { peindreFil(); majEnvoi(); } });
				};
				peindreFil();
				// The time an answer has been running ticks once a second.
				horloge = window.setInterval(() => { if (conv.enCours) conv.repeindre?.(); }, 1000);

				const envoyer = async (): Promise<void> => {
					if (conv.enCours) return;
					const perso = champ.value.trim();
					if (conv.envoye && !perso) return;
					if (!peutExpliquer()) { fournisseurBtn.click(); return; }
					const premier = !conv.envoye;
					const texte = premier ? prompt : perso;
					champ.value = "";
					champ.style.height = "auto";
					/* The provider shown here is the one that answers: the client reads the Settings. */
					if (deps.settings.get().aiProvider !== courant) await choisirFournisseur(courant);
					conv.envoye = true;
					conv.historique.push({ role: "user", text: texte });
					conv.messages.push({ role: "user", text: premier ? "" : perso, tuile: premier ? prompt : undefined });
					const rep: Message = { role: "assistant", text: "", modele: libelleModele(), debut: Date.now(), enCours: true };
					conv.messages.push(rep);
					conv.enCours = true;
					if (premier) composer.querySelector(".qz-mini-tuile")?.remove();
					champ.readOnly = false;
					champ.placeholder = t("ai.explain.followUp");
					conv.repeindre?.();
					try {
						const reponse = await conv.client.chat(conv.historique, {
							style: "explain",
							maxChars: deps.settings.get().aiExplainMaxChars ?? EXPLAIN_MAX_CHARS_DEFAUT,
							onTranscript: (ev) => {
								if (ev.kind !== "text") return;
								rep.text += ev.text;
								conv.repeindre?.();
							},
						});
						rep.text = reponse;
						conv.historique.push({ role: "assistant", text: reponse });
					} catch (err) {
						const e = err as Error & { aborted?: boolean };
						conv.historique.pop();
						if (e?.aborted) rep.arrete = true;
						else rep.erreur = e?.message || t("ai.error.checkSettings");
					} finally {
						rep.enCours = false;
						rep.duree = Date.now() - (rep.debut ?? Date.now());
						conv.enCours = false;
						conv.repeindre?.();
					}
				};
				champ.addEventListener("input", () => {
					champ.style.height = "auto";
					champ.style.height = Math.min(champ.scrollHeight, 160) + "px";
					majEnvoi();
				});
				champ.addEventListener("keydown", (e) => {
					if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
					e.preventDefault();
					void envoyer();
				});
				envoi.addEventListener("click", () => {
					if (conv.enCours) { conv.client.abort(); return; }
					void envoyer();
				});
				champ.focus();
			},
			// Closing the window keeps the conversation; only the painting stops.
			onClose: () => { window.clearInterval(horloge); conv.repeindre = null; },
		});
	}

	return () => {
		observateur.disconnect();
		for (const c of conversations.values()) { if (c.enCours) c.client.abort(); c.repeindre = null; }
		rangee.remove();
	};
}
