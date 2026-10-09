/* ══════════════════════════════════════════════════════════
   "READY" NOTIFICATION AND SOUND, desktop (renderer side)

   When a generation or an "Explain" answer ends while this window is not in
   front, one native notification (the existing bridge channel: two strings,
   rate-limited by the main process) and a short soft chime. "Silent mode"
   in Settings cuts both. The decision is the pure `finish-notify.ts`.
   The chime is synthesised (two sine notes), so there is no audio file.
══════════════════════════════════════════════════════════ */

import { t } from "../../../../src/i18n";
import { LOG_PREFIX } from "../../../../src/branding";
import { decideNotify, newlyReady, readyKind, remember } from "../../../../src/dashboard/finish-notify";
import type { LigneGeneration } from "../../../../src/dashboard/file-generation-app";
import { pont } from "../host/pont";
import { notifyPc } from "../host/notify";

const CLE_SILENCE = "silence";
let silence = false;
let recent: number[] = [];

export async function chargerSilence(): Promise<void> {
	try { silence = (await pont().reglages.lire(CLE_SILENCE)) === true; } catch { silence = false; }
}

export function silenceActif(): boolean {
	return silence;
}

export async function reglerSilence(actif: boolean): Promise<void> {
	silence = actif;
	await pont().reglages.ecrire(CLE_SILENCE, actif);
}

/** In front of the user: visible and focused. A minimised or covered window is not. */
const auPremierPlan = (): boolean => document.visibilityState === "visible" && document.hasFocus();

/** Two soft sine notes; any failure (no audio device, autoplay refused) is silent. */
function jouerSon(): void {
	try {
		const ctx = new AudioContext();
		const note = (freq: number, debut: number): void => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, ctx.currentTime + debut);
			gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + debut + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + debut + 0.35);
			osc.connect(gain).connect(ctx.destination);
			osc.start(ctx.currentTime + debut);
			osc.stop(ctx.currentTime + debut + 0.4);
		};
		note(660, 0);
		note(880, 0.14);
		window.setTimeout(() => { void ctx.close().catch(() => {}); }, 900);
	} catch (e) {
		console.warn(LOG_PREFIX, "ready sound not played:", e);
	}
}

function annoncer(title: string, body: string): void {
	if (pont().android) return;
	if (!decideNotify({ silence, foreground: auPremierPlan(), recent, now: Date.now() }).notify) return;
	recent = remember(recent, Date.now());
	jouerSon();
	void notifyPc(title, body);
}

/** An "Explain" answer came back. */
export function annoncerExplication(): void {
	annoncer(t("ai.notify.explainReady"), "");
}

/** Watches the generation queue: a line that becomes ready announces itself (one notification for the lines that finish together). */
export function armerNotificationsFin(queue: { lignes(): readonly LigneGeneration[]; abonner(cb: () => void, affichee: () => boolean): unknown }): void {
	const vues = new Set<number>();
	newlyReady(vues, queue.lignes());
	queue.abonner(() => {
		const pretes = newlyReady(vues, queue.lignes());
		if (pretes.length === 0) return;
		const premier = readyKind(pretes[0]);
		const extra = pretes.length - 1;
		const titre = premier.kind === "text" ? t("ai.notify.textReady")
			: extra > 0 ? t("ai.notify.quizReadyMore", { title: premier.title, extra }) : t("ai.notify.quizReady", { title: premier.title });
		annoncer(titre, "");
	}, () => false);
}
