/* ══════════════════════════════════════════════════════════
   RESUMABLE CLI RUNS — a generation survives a reload of its page

   The bug (seen 2026-09-29, still open 2026-09-30): reloading the window
   (Ctrl+R, a setting that reloads, a renderer crash, Vite in `app:dev`)
   lost the generation in progress. First the CLI kept running, answering
   nobody and holding its tool's lock; since cb0ce9b4 it is killed instead —
   either way minutes of work and the account's quota were spent for
   nothing.

   The fix: a run started WITH a resume key (`reprise`, chosen by the
   renderer, stable across the reload) is NOT killed when its page goes
   away. It is DETACHED: it keeps running, its streamed output is buffered,
   and its result is held. The reloaded page restores its generation queue
   and asks again with the same key: it is ATTACHED to the same process —
   the buffered output is replayed, then the live output and the result
   follow. Nobody asks within `delaiMs` of the page leaving: the run is
   stopped (its process tree killed) and forgotten, as before.

   A run is only ever attached by the SAME page (the same `WebContents`,
   which outlives a reload): a key names nothing for another window. A page
   that is destroyed (window closed) takes all its runs with it.

   PURE of Electron: the page is an opaque value and the timers are
   injectable, so `check:cli-resume` drives every path deterministically.
══════════════════════════════════════════════════════════ */

import type { ResultatCli } from "./pont";

/** A resume key: what the renderer may send. Anything else is ignored and
    the run is launched as an ordinary, non-resumable one. */
export function estCleReprise(v: unknown): v is string {
	return typeof v === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(v);
}

interface Minuteries {
	poser(fn: () => void, ms: number): unknown;
	annuler(jeton: unknown): void;
}

interface Entree<P> {
	page: P;
	controleur: AbortController;
	resultat: Promise<ResultatCli>;
	/** The streamed output so far, replayed to whoever attaches. */
	morceaux: string[];
	taille: number;
	/** Where the live output goes now; `null` while detached. */
	relais: ((texte: string) => void) | null;
	/** What the run was asked (tool, arguments, input): an attach must ask
	    the same, or it would get another generation's answer. */
	empreinte: string;
	/** The buffer reached `tailleMax`: nothing more is kept, so a replay
	    is a clean beginning, never one with holes. */
	plein: boolean;
	detache: boolean;
	fini: boolean;
	minuteur: unknown;
}

export interface Reprises<P> {
	/** Launches `demarrer` under `cle`. `emettre` (given to `demarrer`) must
	    receive every chunk of output: it is buffered and relayed. The
	    promise is the run's result for the CALLER; once detached, the result
	    is held for the next attach instead. */
	lancer(page: P, cle: string, empreinte: string, controleur: AbortController,
		demarrer: (emettre: (texte: string) => void) => Promise<ResultatCli>,
		relais: ((texte: string) => void) | null): Promise<ResultatCli>;
	/** The detached run of `page` under `cle`, now attached: its buffered
	    output is replayed into `relais` first. `null` when there is none (a
	    fresh run must be launched). */
	rattacher(page: P, cle: string, empreinte: string, relais: ((texte: string) => void) | null): { resultat: Promise<ResultatCli>; controleur: AbortController } | null;
	/** Is `cle` free? A key already held, by this page or ANOTHER one, is
	    never overwritten: that run would leave the registry without being
	    stopped, and nothing would detach or stop it any more (security
	    review of 2026-09-30). The caller then launches a plain run. */
	libre(cle: string): boolean;
	/** The page navigated or its renderer died: its runs are detached and
	    will be stopped unless attached again within the delay. */
	detacher(page: P): void;
	/** The page is gone for good: its runs are stopped now. */
	detruire(page: P): void;
	/** How many runs are held (for the check). */
	taille(): number;
}

export function creerReprises<P>(options: { delaiMs: number; tailleMax: number; minuteries?: Minuteries }): Reprises<P> {
	const minuteries: Minuteries = options.minuteries ?? {
		poser: (fn, ms) => setTimeout(fn, ms),
		annuler: (j) => clearTimeout(j as ReturnType<typeof setTimeout>),
	};
	const entrees = new Map<string, Entree<P>>();

	function oublier(cle: string, e: Entree<P>): void {
		if (entrees.get(cle) !== e) return;
		if (e.minuteur !== null) minuteries.annuler(e.minuteur);
		entrees.delete(cle);
	}

	return {
		lancer(page, cle, empreinte, controleur, demarrer, relais) {
			// Never overwrite a held key (see `libre`): a plain run, unregistered.
			if (entrees.has(cle)) return demarrer(t => { if (relais) relais(t); });
			const e: Entree<P> = {
				page, controleur, resultat: Promise.resolve({ ok: false, nom: "erreur", message: "" }),
				morceaux: [], taille: 0, relais, empreinte, plein: false, detache: false, fini: false, minuteur: null,
			};
			const emettre = (texte: string): void => {
				/* Buffered up to `tailleMax` characters: past it, a reattached
				   transcript misses its end until the live output resumes —
				   never the result, and never a hole in the middle. */
				if (!e.plein && e.taille + texte.length <= options.tailleMax) {
					e.morceaux.push(texte);
					e.taille += texte.length;
				} else {
					e.plein = true;
				}
				if (e.relais) {
					try { e.relais(texte); } catch { /* a dead listener never stops a run */ }
				}
			};
			/* `demarrer` answers with an envelope; a rejection still becomes
			   one, so a held result can always be delivered. */
			e.resultat = demarrer(emettre).catch((err: unknown): ResultatCli => ({
				ok: false,
				nom: err instanceof Error && err.name ? err.name : "erreur",
				message: err instanceof Error ? err.message : String(err),
			})).then(res => {
				e.fini = true;
				// Delivered to a live caller: nothing left to hold.
				if (!e.detache) oublier(cle, e);
				return res;
			});
			entrees.set(cle, e);
			return e.resultat;
		},
		rattacher(page, cle, empreinte, relais) {
			const e = entrees.get(cle);
			if (!e || e.page !== page || !e.detache || e.empreinte !== empreinte) return null;
			if (e.minuteur !== null) { minuteries.annuler(e.minuteur); e.minuteur = null; }
			e.detache = false;
			if (relais) {
				for (const m of e.morceaux) {
					try { relais(m); } catch { /* idem */ }
				}
			}
			e.relais = relais;
			/* Already finished while detached: this attach delivers it, the
			   entry goes. Otherwise `lancer`'s own `then` removes it at the
			   end, the run being attached again. */
			if (e.fini) oublier(cle, e);
			return { resultat: e.resultat, controleur: e.controleur };
		},
		libre: (cle) => !entrees.has(cle),
		detacher(page) {
			for (const [cle, e] of entrees) {
				if (e.page !== page || e.detache) continue;
				e.detache = true;
				e.relais = null;
				e.minuteur = minuteries.poser(() => {
					e.minuteur = null;
					if (!e.fini) e.controleur.abort();
					oublier(cle, e);
				}, options.delaiMs);
			}
		},
		detruire(page) {
			for (const [cle, e] of entrees) {
				if (e.page !== page) continue;
				if (!e.fini) e.controleur.abort();
				oublier(cle, e);
			}
		},
		taille: () => entrees.size,
	};
}
