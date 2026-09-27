/* Les canaux entre le principal et le bac à sable Python, écrits une fois. */
export const CANAUX_BAC = {
	travail: "neo-python:travail",
	chauffe: "neo-python:chauffe",
	resultat: "neo-python:resultat",
} as const;
