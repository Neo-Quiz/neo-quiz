import { currentHost } from "../host/current";
import { t } from "../i18n";

/**
 * Saves the page settings (folder names, colours, icons, declared folders)
 * without waiting for the write. A failure is logged and SHOWN: a bare
 * `.catch(() => {})` let a refused write (a full disk, a revoked permission)
 * pass for a success, and the folder came back as it was at the next start with
 * no word said.
 */
export function saveSettingsReporting(save: () => Promise<void>): void {
	save().catch((e) => {
		console.error("[quiz-blocks] saving the settings failed:", e);
		currentHost().ui.notice(t("dashboard.quizzes.settingsSaveError"));
	});
}
