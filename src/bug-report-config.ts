/**
 * Deployment constants of the in-app bug report. Both stay empty until the
 * owner deploys the relay and registers the GitHub App; while either is empty
 * the app keeps the prefilled GitHub issue URL.
 */
export const BUG_RELAY_URL = "";
export const GITHUB_APP_CLIENT_ID = "";

export function bugReportConfigured(): boolean {
	return BUG_RELAY_URL !== "" && GITHUB_APP_CLIENT_ID !== "";
}
