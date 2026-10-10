/* ══════════════════════════════════════════════════════════
   CARD DATE — a PURE module (no host, no DOM, no clock).

   The creation date shown at the foot of a quiz card, formatted by the
   interface language: a long date ("9 octobre 2026", "October 9, 2026"), a
   short one for a phone ("9 oct. 2026"), and the time for the hover bubble.
   The sentence around them is translated by the caller (`t()` cannot be
   used here: this module stays free of the i18n host).
══════════════════════════════════════════════════════════ */

export interface CardDate {
	/** Day, month name in full, year. */
	long: string;
	/** Day, abbreviated month, year: the phone form. */
	short: string;
	/** Hour and minute, 24-hour clock ("22:30"). */
	time: string;
}

/** The card date of a timestamp in milliseconds, in `lang` (a BCP 47 tag). */
export function cardDate(ms: number, lang: string): CardDate {
	const d = new Date(ms);
	return {
		long: new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).format(d),
		short: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(d),
		time: new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
	};
}
