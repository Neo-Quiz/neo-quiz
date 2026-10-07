/* Moodle errors. Messages never carry a URL or a token: they end up in the
   window (state, summaries), and the token must never get there. */

export class MoodleError extends Error {
	readonly code: string;
	constructor(code: string, message?: string) {
		super(message ?? code);
		this.name = "MoodleError";
		this.code = code;
	}
}

/** The token was refused or has expired: the user must log in again. */
export class TokenError extends MoodleError {
	constructor(code: string, message?: string) {
		super(code, message);
		this.name = "TokenError";
	}
}

/** Replaces every occurrence of `secret` in `text` (error messages quoting
    a request body, for instance). */
export function masquer(text: string, secret: string | null | undefined): string {
	return secret ? text.split(secret).join("***") : text;
}
