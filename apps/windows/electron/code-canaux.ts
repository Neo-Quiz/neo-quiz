/* The channels between the main process and the code sandbox, written once. */
export const CANAUX_BAC = {
	travail: "neo-code:travail",
	chauffe: "neo-code:chauffe",
	resultat: "neo-code:resultat",
	/* Language runtime loading finished for this job (relays the worker's
	   `pret` message, review N1 bis): the main process only arms its
	   fallback at `timeoutMs + SECOURS_MS` from this signal, never before. */
	pret: "neo-code:pret",
} as const;
