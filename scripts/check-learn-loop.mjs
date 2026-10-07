/**
 * THE LEARN RETRY LOOP (`src/engine/learn-loop.ts`), pure.
 * What it prevents: a missed question asked again at once (it would test the
 * memory of the option's position, not of the answer), a retry that never
 * comes back before the step ends, a learner stuck forever on a question
 * (three retries at most), a verdict given twice for one attempt, and a
 * right-after-a-miss answer counted as right the first time.
 *     npm run check:learn-loop
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/learn-loop.ts", (m) => {
	const r = makeReporter("Learn retry loop");
	const { emptyLearnState, applyCheck, applyNeutralCheck, revealForSelfRating, nextLearnMove, beginRetry, resumeNormalOrder, learnSummary, RETRY_LAG, MAX_RETRIES } = m;

	/* Two steps: questions 0-4 in step 1, 5-7 in step 2. */
	const N = 8;
	const stepOf = (qi) => (qi <= 4 ? 1 : 2);
	const next = (qi) => (qi + 1 < N ? qi + 1 : null);

	r.check("the lag is two questions, three retries at most", [RETRY_LAG, MAX_RETRIES], [2, 3]);

	{
		const s = emptyLearnState(N);
		const o = applyCheck(s, 0, true);
		r.check("right on the first check: first, not queued", [o.verdict, o.firstCheck, o.queued, s.learnQueue.length], ["first", true, false, 0]);
		r.check("a second check of the same attempt gives no verdict", applyCheck(s, 0, false), null);
		r.check("…and leaves the verdict alone", s.learnVerdicts[0], "first");
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 0, false);
		r.check("a miss is queued with nothing checked since", s.learnQueue, [{ qi: 0, since: 0 }]);
		r.check("next from the missed question: never the same one at once", nextLearnMove(s, 0, stepOf, next), { kind: "go", qi: 1 });
		applyCheck(s, 1, true);
		r.check("one other check: not due yet", nextLearnMove(s, 1, stepOf, next), { kind: "go", qi: 2 });
		applyCheck(s, 2, true);
		const move = nextLearnMove(s, 2, stepOf, next);
		r.check("two other checks: it comes back, the normal order resumes after", move, { kind: "retry", qi: 0, resume: 3 });
		beginRetry(s, 0, move.resume);
		r.check("on its retry it is open again and out of the queue", [s.learnRetrying[0], s.learnChecked[0], s.learnQueue.length], [true, false, 0]);
		const o = applyCheck(s, 0, true);
		r.check("right on a retry: retried, and not a first check", [o.verdict, o.firstCheck], ["retried", false]);
		r.check("after the retry, back where the learner was", nextLearnMove(s, 0, stepOf, next), { kind: "go", qi: 3 });
		resumeNormalOrder(s);
		r.check("the resume point is cleared", s.learnResume, null);
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 3, false);
		r.check("a miss near the end of its step comes back before the step is left",
			nextLearnMove(s, 4, stepOf, next), { kind: "retry", qi: 3, resume: 5 });
		r.check("…but not while still inside the step with too few checks",
			nextLearnMove(s, 3, stepOf, next), { kind: "go", qi: 4 });
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 1, false);
		applyCheck(s, 2, false);
		applyCheck(s, 3, true);
		r.check("the lag counts every other check, a miss included", s.learnQueue, [{ qi: 1, since: 2 }, { qi: 2, since: 1 }]);
		const move = nextLearnMove(s, 3, stepOf, next);
		r.check("the due one comes back first", move, { kind: "retry", qi: 1, resume: 4 });
		beginRetry(s, 1, move.resume);
		applyCheck(s, 1, true);
		r.check("a retry's own check counts for the others: the second miss is due in turn, the resume point kept",
			nextLearnMove(s, 1, stepOf, next), { kind: "retry", qi: 2, resume: 4 });
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 3, false);
		applyCheck(s, 4, false);
		const move = nextLearnMove(s, 4, stepOf, next);
		r.check("leaving the step, the one missed earlier comes back first", move, { kind: "retry", qi: 3, resume: 5 });
		beginRetry(s, 3, move.resume);
		applyCheck(s, 3, true);
		r.check("then the one just missed, the step still being left", nextLearnMove(s, 3, stepOf, next), { kind: "retry", qi: 4, resume: 5 });
	}

	{
		const s = emptyLearnState(N);
		for (let k = 0; k < MAX_RETRIES; k++) {
			const o = applyCheck(s, 0, false);
			r.check(`miss ${k + 1}: queued again`, [o.queued, o.gaveUp], [true, false]);
			beginRetry(s, 0, 1);
		}
		const o = applyCheck(s, 0, false);
		r.check("the miss after three retries gives up: red, out of the queue", [o.verdict, o.queued, o.gaveUp, s.learnQueue.length], ["missed", false, true, 0]);
		r.check("a given-up question is never checked again this session", applyCheck(s, 0, true), null);
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 7, false);
		r.check("the very last question missed: past the end, it comes back as the last thing left",
			nextLearnMove(s, 7, stepOf, next), { kind: "retry", qi: 7, resume: "end" });
		beginRetry(s, 7, "end");
		applyCheck(s, 7, true);
		r.check("then past the end", nextLearnMove(s, 7, stepOf, next), { kind: "go", qi: null });
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 5, false);
		applyCheck(s, 6, true);
		r.check("past the end every queued one comes back, even with too few checks",
			nextLearnMove(s, 7, stepOf, next), { kind: "retry", qi: 5, resume: "end" });
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 0, false);
		applyCheck(s, 1, true);
		applyCheck(s, 2, true);
		const move = nextLearnMove(s, 2, stepOf, next);
		beginRetry(s, 0, move.resume);
		// The learner leaves the retry by a bead, to question 6, and moves on from there.
		r.check("a retry left unchecked by a jump goes back in the queue, due",
			(nextLearnMove(s, 6, stepOf, next), s.learnQueue), [{ qi: 0, since: RETRY_LAG }]);
		r.check("…and the resume point of that retry no longer holds", s.learnResume, null);
		const s2 = emptyLearnState(N);
		applyCheck(s2, 0, false); applyCheck(s2, 1, true); applyCheck(s2, 2, true);
		beginRetry(s2, 0, 3);
		applyCheck(s2, 0, true);
		r.check("from another question than the retried one, next follows the normal order",
			nextLearnMove(s2, 5, stepOf, next), { kind: "go", qi: 6 });
	}

	{
		const s = emptyLearnState(N);
		revealForSelfRating(s, 0);
		r.check("a written answer checked: revealed, waiting for its own verdict", [s.learnChecked[0], s.learnPending[0], s.learnVerdicts[0]], [true, true, "none"]);
		const o = applyCheck(s, 0, false);
		r.check("its self-verdict is accepted once, as a first check", [o?.verdict, o?.firstCheck, s.learnPending[0]], ["missed", true, false]);
		r.check("a second self-verdict for the same attempt is refused", applyCheck(s, 0, true), null);
	}

	{
		const s = emptyLearnState(N);
		applyNeutralCheck(s, 0);
		r.check("a pre question is checked without a verdict nor a queue", [s.learnChecked[0], s.learnVerdicts[0], s.learnQueue.length], [true, "none", 0]);
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 0, true);
		applyCheck(s, 1, false);
		beginRetry(s, 1, 2);
		applyCheck(s, 1, true);
		applyCheck(s, 2, false);
		r.check("the summary: first time, after a retry, still to review",
			learnSummary(s, [0, 1, 2, 3]), { first: 1, retried: 1, missed: 1 });
	}
	r.done();
});

/* A step page (spec 2026-10-07-learn-scroll §3): the miss comes back at the
   bottom of the SAME page once due, or when the learner presses "Next step". */
await withSrcModule("src/engine/learn-loop.ts", (m) => {
	const r = makeReporter("Learn retry loop - step page");
	const { emptyLearnState, applyCheck, nextLearnMove, beginRetry, dueRetryOnPage, MAX_RETRIES } = m;
	const N = 6;
	const page = (qi) => (qi <= 3 ? 1 : 2);
	const next = (qi) => (qi + 1 < N ? qi + 1 : null);
	const onPage1 = (qi) => qi <= 3;
	const s = emptyLearnState(N);
	applyCheck(s, 0, false);
	r.check("a miss is not due at once", dueRetryOnPage(s, onPage1, 0), null);
	applyCheck(s, 1, true);
	r.check("not due after one other check", dueRetryOnPage(s, onPage1, 1), null);
	applyCheck(s, 2, true);
	r.check("due after two other checks, on its own page", dueRetryOnPage(s, onPage1, 2), 0);
	r.check("never picked as the card just checked", dueRetryOnPage(s, onPage1, 0), null);
	r.check("a page that is not its own never gets it", dueRetryOnPage(s, qi => qi >= 4, 4), null);

	const t = emptyLearnState(N);
	applyCheck(t, 0, false);
	const move = nextLearnMove(t, 3, page, next);
	r.check('"Next step" with a miss pending shows it first, then goes on', [move.kind, move.qi, move.resume], ["retry", 0, 4]);
	beginRetry(t, 0, 4);
	applyCheck(t, 0, true);
	r.check("right on the retry: retried, journal-neutral (first verdict kept in learnMisses)", [t.learnVerdicts[0], t.learnMisses[0]], ["retried", 1]);

	const u = emptyLearnState(N);
	let gave = false;
	for (let i = 0; i < MAX_RETRIES + 1; i++) {
		const o = applyCheck(u, 0, false);
		gave = o.gaveUp;
		if (o.queued) beginRetry(u, 0, 4);
	}
	r.check("three retries at most on a page", [gave, u.learnQueue.length, u.learnVerdicts[0]], [true, 0, "missed"]);
	r.done();
});
