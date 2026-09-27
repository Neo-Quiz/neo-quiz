/* Les canaux entre le principal et le bac à sable Python, écrits une fois. */
export const CANAUX_BAC = {
	travail: "neo-python:travail",
	chauffe: "neo-python:chauffe",
	resultat: "neo-python:resultat",
	/* Chargement de Pyodide terminé pour ce travail (relai du message `pret`
	   du worker, revue N1 bis) : le principal n'arme son secours au format
	   `timeoutMs + SECOURS_MS` qu'à partir de ce signal, jamais avant. */
	pret: "neo-python:pret",
} as const;
