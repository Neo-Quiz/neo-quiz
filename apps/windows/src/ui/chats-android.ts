/* The "quiz ready" notification (Android), renderer side. No JavaScript runs
   in the background: the page hands the native notifier which device this
   phone is and the notification texts of the app language, now and each time
   it goes to the background (which also covers a language change). */

import { t } from "../../../../src/i18n";
import { LOG_PREFIX } from "../../../../src/branding";
import { pont } from "../host/pont";

function pousser(idAppareil: string): void {
	const android = pont().android;
	if (!android) return;
	void android.suivreChats(idAppareil, {
		quizReady: t("ai.notify.quizReady"),
		quizReadyMore: t("ai.notify.quizReadyMore"),
		textReady: t("ai.notify.textReady"),
		failed: t("ai.notify.failed"),
		channel: t("ai.notify.channel"),
	}).catch(e => console.warn(LOG_PREFIX, "chat notification texts not saved:", e));
}

export function armerNotificationsChats(idAppareil: string): void {
	pousser(idAppareil);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") pousser(idAppareil);
	});
}
