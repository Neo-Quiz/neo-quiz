/* ══════════════════════════════════════════════════════════
   THE DAILY REVIEW NOTIFICATION (Android), renderer side

   No JavaScript ever runs in the background: when the page goes to the
   background it computes, with the scheduler's own plan, how many questions
   each of the next seven days will have due, and hands that table to the
   native side (`android.calendrier`) with the notification strings of the app
   language. The 07:00 alarm only READS that table; it never computes a
   schedule. The count is `plan.today.length`, the very number the Home page
   shows as today's review.

   A future day is planned as of 07:00 of that day (the hour the alarm fires),
   today as of now. The projection assumes nothing is reviewed in between,
   which is also what the app would show at that hour.
══════════════════════════════════════════════════════════ */

import { t } from "../../../../src/i18n";
import { isoLocal } from "../../../../src/dashboard/home-tasks";
import type { ReviewStore } from "../../../../src/review/review-store";
import { LOG_PREFIX } from "../../../../src/branding";
import { pont } from "../host/pont";

export const JOURS_CALENDRIER = 7;
export const HEURE_NOTIFICATION = 7;

/** The next `jours` local days, today first: `{ date: "YYYY-MM-DD" (local), due }`. Pure given `now`. */
export function calendrierDesJours(store: Pick<ReviewStore, "plan">, now: number, jours = JOURS_CALENDRIER): Array<{ date: string; due: number }> {
	const d = new Date(now);
	return Array.from({ length: jours }, (_, i) => {
		// Built from the calendar, never `+ 24 h`: a daylight saving change makes a day 23 or 25 hours.
		const at = i === 0 ? now : new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, HEURE_NOTIFICATION).getTime();
		return { date: isoLocal(at), due: store.plan(at).today.length };
	});
}

/** Sends the table when the page becomes hidden. Android only; a failure is logged, never thrown. */
export function armerCalendrier(store: ReviewStore): void {
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "hidden") return;
		const android = pont().android;
		if (!android) return;
		try {
			void android.calendrier(calendrierDesJours(store, Date.now()), {
				title: t("app.notification.reviewTitle"),
				bodyOne: t("app.notification.reviewBodyOne"),
				bodyOther: t("app.notification.reviewBodyOther"),
			}).catch(e => console.warn(LOG_PREFIX, "daily review table not saved:", e));
		} catch (e) {
			console.warn(LOG_PREFIX, "daily review table failed:", e);
		}
	});
}
