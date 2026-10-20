import { prepareDisclosure, setDisclosureOpen } from "./disclosure-motion";
/**
 * THE AI'S WORK, as a transcript block shows it (2026-10-14): the tools a
 * one-shot CLI call used, summed up by kind and listed step by step, shared
 * by the Generate queue (`file-generation-vue.ts`) and the Explain window,
 * which now runs as an agent in the quiz's folder too.
 *
 * Text only: a path, a command or an error is written with `textContent`
 * (through `ajouter`), never as HTML.
 */
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { resumeTravail } from "./transcript";
import type { ToolStep, Transcript } from "./transcript";

/** The heading of the tools, summed up by kind, as MonoCode titles it
    ("Explored the project · Ran 6 tools", "Ran a command · Edited SKILL.md"). */
export function resumeOutils(tr: Transcript): { libelle: string; icone: string } {
	const r = resumeTravail(tr.tools, tr.toolsHidden);
	const refusees = tr.tools.filter(s => s.status === "refused").length;
	const parts: string[] = [];
	if (r.explore) parts.push(t("ai.transcript.explored"));
	if (r.commandes) parts.push(t(r.commandes === 1 ? "ai.transcript.ranCommandOne" : "ai.transcript.ranCommandOther", { count: r.commandes }));
	if (r.modifs) parts.push(r.fichier ? t("ai.transcript.editedOne", { name: r.fichier }) : t("ai.transcript.editedOther", { count: r.modifs }));
	if (r.autres || (r.explore && !r.commandes && !r.modifs)) parts.push(t(r.total === 1 ? "ai.transcript.ranToolsOne" : "ai.transcript.ranToolsOther", { count: r.total }));
	const libelle = parts.join(" · ")
		+ (refusees ? t(refusees === 1 ? "ai.transcript.workRefusedOne" : "ai.transcript.workRefusedOther", { count: refusees }) : "");
	return { libelle, icone: r.modifs ? "pencil" : r.commandes ? "terminal" : "wrench" };
}

/** The result line under a step: `└ 120 lines`, `└ Refused: …`. */
function resultatEtape(s: ToolStep): string {
	if (s.status === "running") return t("ai.transcript.stepRunning");
	if (s.status === "refused") return s.detail ? t("ai.transcript.stepRefused", { detail: s.detail }) : t("ai.transcript.stepRefusedBare");
	if (s.status === "error") return s.detail ? t("ai.transcript.stepError", { detail: s.detail }) : t("ai.transcript.stepErrorBare");
	if (s.unit === "image") return t("ai.transcript.stepImage");
	const n = s.count ?? 0;
	if (s.unit === "files") return t(n === 1 ? "ai.transcript.stepFilesOne" : "ai.transcript.stepFilesOther", { count: n });
	return t(n === 1 ? "ai.transcript.stepLinesOne" : "ai.transcript.stepLinesOther", { count: n });
}

/** Paints the steps IN PLACE: a chunk only changes the lines that moved. */
export function peindreEtapes(corps: HTMLElement, tr: Transcript): void {
	tr.tools.forEach((s, i) => {
		let el = corps.children[i] as HTMLElement | undefined;
		if (!el || !el.classList.contains("qbd-ai-transcript-etape")) {
			el = document.createElement("div");
			el.className = "qbd-ai-transcript-etape";
			const appel = ajouter(el, "div", "qbd-ai-transcript-etape-appel");
			ajouter(appel, "span", "qbd-ai-transcript-etape-nom");
			ajouter(appel, "span", "qbd-ai-transcript-etape-entree");
			ajouter(el, "div", "qbd-ai-transcript-etape-resultat");
			corps.insertBefore(el, corps.children[i] ?? null);
		}
		if (el.dataset.statut !== s.status) el.dataset.statut = s.status;
		const nom = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-nom");
		const entree = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-entree");
		const res = el.querySelector<HTMLElement>(".qbd-ai-transcript-etape-resultat");
		if (nom && nom.textContent !== s.name) nom.textContent = s.name;
		const e = "(" + s.input + ")";
		if (entree && entree.textContent !== e) entree.textContent = e;
		const r = "└ " + resultatEtape(s);
		if (res && res.textContent !== r) res.textContent = r;
	});
	// The steps past the cap: one line that says how many.
	let fin = corps.children[tr.tools.length] as HTMLElement | undefined;
	if (tr.toolsHidden > 0) {
		if (!fin) fin = ajouter(corps, "div", "qbd-ai-transcript-outil");
		const v = t("ai.transcript.stepsHidden", { count: tr.toolsHidden });
		if (fin.textContent !== v) fin.textContent = v;
	}
	while (corps.children.length > tr.tools.length + (tr.toolsHidden > 0 ? 1 : 0)) corps.lastElementChild?.remove();
}

/** A chat answer's work block: its reasoning and its tools (the answer itself
    is the prose under it). Created ONCE per answer and updated in place, so
    that a click on a line survives the chunks (a button rebuilt between
    mouse-down and mouse-up never fires `click`). */
export interface BlocTravail {
	el: HTMLElement;
	/** Brings the block up to date; it stays empty (hidden) with nothing to show. */
	maj(tr: Transcript, vivant: boolean): void;
}

interface Ligne { bouton: HTMLElement; libelle: HTMLElement; chevron: HTMLElement; icone: string; detail: HTMLElement | null; content?: HTMLElement }

export function creerBlocTravail(): BlocTravail {
	const el = document.createElement("div");
	el.className = "qbd-ai-transcript";
	el.dataset.chat = "1";
	el.setAttribute("role", "log");
	el.setAttribute("aria-label", t("ai.transcript.label"));
	const lignes = new Map<string, Ligne>();
	const ouvertes = new Set<string>();
	let dernier: { tr: Transcript; vivant: boolean } | null = null;

	function maj(tr: Transcript, vivant: boolean): void {
		dernier = { tr, vivant };
		const specs: Array<{ cle: string; icone: string; libelle: string; detail: (corps: HTMLElement) => void }> = [];
		if (tr.thinking) {
			specs.push({
				cle: "thinking", icone: "brain", libelle: t(vivant && !tr.text ? "ai.transcript.thinkingLive" : "ai.transcript.thought"),
				detail: corps => {
					const d = (corps.firstElementChild as HTMLElement | null) ?? ajouter(corps, "div", "qbd-ai-transcript-reflexion");
					const v = tr.thinking.trim();
					if (d.textContent !== v) d.textContent = v;
				},
			});
		} else if (tr.thinkingTokens > 0) {
			// PRIVATE reasoning (its size only): a click says why there is no text.
			specs.push({
				cle: "thinking", icone: "brain", libelle: t(vivant && !tr.text ? "ai.transcript.privateThinkingLive" : "ai.transcript.privateThought"),
				detail: corps => {
					const d = (corps.firstElementChild as HTMLElement | null) ?? ajouter(corps, "div", "qbd-ai-transcript-reflexion");
					const v = t("ai.transcript.privateThinkingNote");
					if (d.textContent !== v) d.textContent = v;
				},
			});
		}
		if (tr.tools.length) {
			const { libelle, icone } = resumeOutils(tr);
			specs.push({ cle: "tools", icone, libelle, detail: corps => peindreEtapes(corps, tr) });
		}
		const gardees = new Set(specs.map(s => s.cle));
		for (const [cle, l] of lignes) {
			if (gardees.has(cle)) continue;
			l.bouton.remove();
			l.detail?.remove();
			lignes.delete(cle);
		}
		let rang = 0;
		for (const s of specs) {
			let l = lignes.get(s.cle);
			if (!l) {
				const b = ajouter(el, "button", "qbd-ai-transcript-ligne");
				b.type = "button";
				const dedans = ajouter(b, "span", "qbd-ai-transcript-ligne-in");
				ajouter(dedans, "span", "qbd-ai-transcript-titre-icone");
				const libelle = ajouter(dedans, "span", "qbd-ai-transcript-ligne-texte");
				const chevron = ajouter(dedans, "span", "qbd-ai-transcript-chevron");
				l = { bouton: b, libelle, chevron, icone: "", detail: null };
				lignes.set(s.cle, l);
				const cle = s.cle;
				b.addEventListener("click", () => {
					if (ouvertes.has(cle)) ouvertes.delete(cle); else ouvertes.add(cle);
					if (dernier) maj(dernier.tr, dernier.vivant);
				});
			}
			if (l.icone !== s.icone) {
				const icone = l.bouton.querySelector<HTMLElement>(".qbd-ai-transcript-titre-icone");
				if (icone) currentHost().ui.setIcon(icone, s.icone);
				l.icone = s.icone;
			}
			if (l.libelle.textContent !== s.libelle) l.libelle.textContent = s.libelle;
			const ouvert = ouvertes.has(s.cle);
			if (l.bouton.getAttribute("aria-expanded") !== String(ouvert)) {
				l.bouton.setAttribute("aria-expanded", String(ouvert));
				currentHost().ui.setIcon(l.chevron, "chevron-right");
			}
			if (ouvert && !l.detail) {
				l.detail = document.createElement("div");
				l.detail.className = "qbd-ai-transcript-detail";
				l.content = prepareDisclosure(l.detail, false);
			}
			if (l.detail && l.content) {
				s.detail(l.content);
				setDisclosureOpen(l.detail, ouvert);
			}
			if (el.children[rang] !== l.bouton) el.insertBefore(l.bouton, el.children[rang] ?? null);
			rang++;
			if (l.detail) {
				if (el.children[rang] !== l.detail) el.insertBefore(l.detail, el.children[rang] ?? null);
				rang++;
			}
		}
		el.hidden = specs.length === 0;
	}

	return { el, maj };
}
