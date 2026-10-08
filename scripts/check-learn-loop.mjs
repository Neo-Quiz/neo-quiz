/**
 * THE LEARN RETRY LOOP (`src/engine/learn-loop.ts`), pure.
 * What it prevents: a missed question asked again in the MIDDLE of the quiz
 * (the learner was sent back between two swipes with no idea why, 2026-10-08),
 * a retry dropped at the end, a learner stuck forever on a question (three
 * retries at most), a verdict given twice for one attempt, and a
 * right-after-a-miss answer counted as right the first time.
 *     npm run check:learn-loop
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/learn-loop.ts", (m) => {
	const r = makeReporter("Learn retry loop");
	const { emptyLearnState, applyCheck, applyNeutralCheck, revealForSelfRating, nextLearnMove, beginRetry, resumeNormalOrder, learnSummary, MAX_RETRIES } = m;

	const N = 8;
	const next = (qi) => (qi + 1 < N ? qi + 1 : null);

	r.check("three retries at most", MAX_RETRIES, 3);

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
		r.check("a miss is queued", s.learnQueue.map(e => e.qi), [0]);
		for (let qi = 0; qi < N - 1; qi++) {
			applyCheck(s, qi + 1, true);
			r.check(`mid-quiz (from ${qi}) the normal order goes on, never back to the miss`, nextLearnMove(s, qi, next), { kind: "go", qi: qi + 1 });
		}
		const move = nextLearnMove(s, N - 1, next);
		r.check("past the last question the miss comes back", move, { kind: "retry", qi: 0, resume: "end" });
		beginRetry(s, 0, move.resume);
		r.check("on its retry it is open again and out of the queue", [s.learnRetrying[0], s.learnChecked[0], s.learnQueue.length], [true, false, 0]);
		const o = applyCheck(s, 0, true);
		r.check("right on a retry: retried, and not a first check", [o.verdict, o.firstCheck], ["retried", false]);
		r.check("after the retry, the end", nextLearnMove(s, 0, next), { kind: "go", qi: null });
		resumeNormalOrder(s);
		r.check("the resume point is cleared", s.learnResume, null);
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 2, false);
		applyCheck(s, 5, false);
		r.check("two misses: the first missed comes back first at the end", nextLearnMove(s, 7, next), { kind: "retry", qi: 2, resume: "end" });
		beginRetry(s, 2, "end");
		applyCheck(s, 2, true);
		r.check("then the second", nextLearnMove(s, 2, next), { kind: "retry", qi: 5, resume: "end" });
	}

	{
		const s = emptyLearnState(N);
		for (let k = 0; k < MAX_RETRIES; k++) {
			const o = applyCheck(s, 0, false);
			r.check(`miss ${k + 1}: queued again`, [o.queued, o.gaveUp], [true, false]);
			beginRetry(s, 0, "end");
		}
		const o = applyCheck(s, 0, false);
		r.check("the miss after three retries gives up: red, out of the queue", [o.verdict, o.queued, o.gaveUp, s.learnQueue.length], ["missed", false, true, 0]);
		r.check("a given-up question is never checked again this session", applyCheck(s, 0, true), null);
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 7, false);
		r.check("the very last question missed: it comes back as the last thing left",
			nextLearnMove(s, 7, next), { kind: "retry", qi: 7, resume: "end" });
		beginRetry(s, 7, "end");
		applyCheck(s, 7, true);
		r.check("then past the end", nextLearnMove(s, 7, next), { kind: "go", qi: null });
	}

	{
		const s = emptyLearnState(N);
		applyCheck(s, 0, false);
		beginRetry(s, 0, "end");
		// The learner leaves the retry by a bead, to question 6, and moves on from there.
		r.check("a retry left unchecked by a jump goes back in the queue",
			(nextLearnMove(s, 6, next), s.learnQueue.map(e => e.qi)), [0]);
		r.check("…and the resume point of that retry no longer holds", s.learnResume, null);
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
		beginRetry(s, 1, "end");
		applyCheck(s, 1, true);
		applyCheck(s, 2, false);
		r.check("the summary: first time, after a retry, still to review",
			learnSummary(s, [0, 1, 2, 3]), { first: 1, retried: 1, missed: 1 });
	}
	r.done();
});
