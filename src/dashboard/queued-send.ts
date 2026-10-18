/* PURE decisions for a message sent while an answer runs (claude.ai, 2026-10-18):
   it waits as the user's bubble with a grey "Send now"; that button (and
   Ctrl+Enter) stops the running answer, after which the queue starts this
   message by itself. No DOM, no host. */

interface LigneMin {
	id: number;
	etat: string;
}

/** The lines "Send now" stops: those still running before the queued line.
    Empty when the line is not waiting or nothing runs (the button then does
    not exist: the line just starts). */
export function lignesAArreter(lignes: readonly LigneMin[], idEnAttente: number): number[] {
	const cible = lignes.find(l => l.id === idEnAttente);
	if (!cible || cible.etat !== "attente") return [];
	return lignes.filter(l => l.etat === "cours" && l.id < idEnAttente).map(l => l.id);
}

/** The queued line Ctrl+Enter sends: the OLDEST waiting one that has something
    to stop, else null. */
export function premiereEnAttente(lignes: readonly LigneMin[]): number | null {
	const attentes = lignes.filter(l => l.etat === "attente").sort((a, b) => a.id - b.id);
	for (const l of attentes) if (lignesAArreter(lignes, l.id).length > 0) return l.id;
	return null;
}
