/* ══════════════════════════════════════════════════════════
   LA FILE DE GÉNÉRATION — LE NOYAU PUR

   Spec 2026-09-26 « File de génération » : envoyer une demande ne bloque
   plus la page. Chaque envoi devient une LIGNE, et les générations partent
   une par une, dans l'ordre d'envoi — le verrou par outil du processus
   principal (`process.ts`) n'en admet de toute façon qu'une par CLI.

   Ce module ne connaît ni DOM, ni hôte, ni horloge : l'heure de départ est
   une ENTRÉE (`maintenant`). Chaque fonction rend une NOUVELLE file ; aucune
   ne mute celle qu'on lui passe. C'est ce qui permet à
   `scripts/check-file-generation.mjs` de l'éprouver sans rien simuler.

   Les états d'une ligne :
   - `attente` : dans la file, pas encore partie ;
   - `cours`   : la génération tourne ;
   - `arret`   : annulée PENDANT qu'elle tournait. Invisible à l'écran, elle
     occupe encore la place tant que le processus n'a pas rendu la main :
     démarrer la suivante avant se heurterait au verrou du même CLI. C'est
     `solder` qui la retire, quand la génération s'est réellement terminée ;
   - `prete`   : le quiz est enregistré ;
   - `echouee` : l'erreur est gardée pour être lue.
══════════════════════════════════════════════════════════ */

export type EtatLigne = "attente" | "cours" | "arret" | "prete" | "echouee";

export interface LigneFile<D, R> {
	readonly id: number;
	readonly etat: EtatLigne;
	/** Tout ce que la demande avait au moment de l'envoi — figé, jamais relu
	    dans les réglages ni dans le composer. */
	readonly demande: D;
	/** Le départ de la génération en cours (`cours`), pour le temps écoulé. */
	readonly debut?: number;
	/** Ce qu'une ligne `prete` a produit. */
	readonly resultat?: R;
	/** Le message d'une ligne `echouee`. */
	readonly erreur?: string;
}

export interface FileGeneration<D, R> {
	/** Dans l'ordre d'affichage, qui est l'ordre d'envoi (un réessai remet
	    la ligne en fin de file). */
	readonly lignes: readonly LigneFile<D, R>[];
	readonly prochainId: number;
}

export function fileVide<D, R>(): FileGeneration<D, R> {
	return { lignes: [], prochainId: 1 };
}

/** Remplace une ligne par sa nouvelle version, à sa place. */
function remplacer<D, R>(file: FileGeneration<D, R>, id: number, maj: (l: LigneFile<D, R>) => LigneFile<D, R>): FileGeneration<D, R> {
	return { ...file, lignes: file.lignes.map(l => (l.id === id ? maj(l) : l)) };
}

function retirer<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	return { ...file, lignes: file.lignes.filter(l => l.id !== id) };
}

export function ligne<D, R>(file: FileGeneration<D, R>, id: number): LigneFile<D, R> | null {
	return file.lignes.find(l => l.id === id) ?? null;
}

/** Une demande de plus, en fin de file. */
export function ajouter<D, R>(file: FileGeneration<D, R>, demande: D): { file: FileGeneration<D, R>; id: number } {
	const id = file.prochainId;
	return {
		file: { lignes: [...file.lignes, { id, etat: "attente", demande }], prochainId: id + 1 },
		id,
	};
}

/** Une génération occupe-t-elle la file ? Une ligne en `arret` compte : son
    processus n'a pas encore rendu le verrou. */
export function occupee<D, R>(file: FileGeneration<D, R>): boolean {
	return file.lignes.some(l => l.etat === "cours" || l.etat === "arret");
}

/** Démarre la PREMIÈRE ligne en attente, et seulement si rien ne tourne.
    `ligne` est celle qui vient de partir, `null` sinon. */
export function demarrerSuivant<D, R>(file: FileGeneration<D, R>, maintenant: number): { file: FileGeneration<D, R>; ligne: LigneFile<D, R> | null } {
	if (occupee(file)) return { file, ligne: null };
	const suivante = file.lignes.find(l => l.etat === "attente");
	if (!suivante) return { file, ligne: null };
	const partie: LigneFile<D, R> = { ...suivante, etat: "cours", debut: maintenant };
	return { file: remplacer(file, suivante.id, () => partie), ligne: partie };
}

/** La génération en cours a produit son quiz. Sans effet sur une ligne qui
    ne tourne plus (annulée entre-temps). */
export function terminer<D, R>(file: FileGeneration<D, R>, id: number, resultat: R): FileGeneration<D, R> {
	if (ligne(file, id)?.etat !== "cours") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "prete", demande: l.demande, resultat }));
}

/** La génération en cours a échoué. Même garde que `terminer`. */
export function echouer<D, R>(file: FileGeneration<D, R>, id: number, erreur: string): FileGeneration<D, R> {
	if (ligne(file, id)?.etat !== "cours") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "echouee", demande: l.demande, erreur }));
}

/** Le bouton ■ : une ligne en attente QUITTE la file ; une ligne en cours
    passe en `arret` (l'appelant tue le processus). `arreter` dit s'il y a un
    processus à tuer. Sans effet sur une ligne terminée : c'est la croix. */
export function annuler<D, R>(file: FileGeneration<D, R>, id: number): { file: FileGeneration<D, R>; arreter: boolean } {
	const l = ligne(file, id);
	if (l?.etat === "attente") return { file: retirer(file, id), arreter: false };
	if (l?.etat === "cours") return { file: remplacer(file, id, x => ({ id: x.id, etat: "arret", demande: x.demande })), arreter: true };
	return { file, arreter: false };
}

/** La génération annulée a rendu la main : sa ligne disparaît, la place se
    libère pour la suivante. Sans effet sur une ligne qui n'est pas en `arret`. */
export function solder<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	return ligne(file, id)?.etat === "arret" ? retirer(file, id) : file;
}

/** « Réessayer » : la MÊME demande repart en fin de file, derrière celles
    qui attendaient déjà — pas devant elles. */
export function reessayer<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const l = ligne(file, id);
	if (l?.etat !== "echouee") return file;
	return { ...file, lignes: [...file.lignes.filter(x => x.id !== id), { id: l.id, etat: "attente", demande: l.demande }] };
}

/** La croix : ferme une ligne prête ou échouée. Une ligne qui attend ou qui
    tourne ne se ferme pas, elle s'annule. */
export function fermer<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const etat = ligne(file, id)?.etat;
	return etat === "prete" || etat === "echouee" ? retirer(file, id) : file;
}
