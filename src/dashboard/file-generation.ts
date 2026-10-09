/* ══════════════════════════════════════════════════════════
   LA FILE DE GÉNÉRATION — LE NOYAU PUR

   Spec 2026-09-26 « File de génération » : envoyer une demande ne bloque
   plus la page. Chaque envoi devient une LIGNE. Les demandes partent dans
   l'ordre d'envoi : chaque chat tourne côte à côte, une génération à la fois
   dans un même chat (`demarrerPrets`, 2026-10-09). Le verrou par outil du
   processus principal (`process.ts`) n'en admet de toute façon qu'une par CLI.

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
   - `echouee` : l'erreur est gardée pour être lue. `echec` dit si c'est la
     GÉNÉRATION qui a échoué (« Réessayer » relance le CLI) ou seulement
     l'ENREGISTREMENT de la note : le quiz produit est alors gardé dans la
     demande, et il ne doit jamais être perdu — une génération coûte des
     minutes et du quota ;
   - `enregistrement` : nouvel essai d'écriture de la note, SANS relancer le
     CLI. Il n'occupe pas la file : aucun processus ne tourne.
   - `pause`   : the CLI refused on a USAGE LIMIT (2026-10-09). No process
     runs, so it does not occupy the queue; it holds its chat, and blocks
     every waiting line of the SAME PROVIDER (the limit is the account's)
     until the window resets: `reprise` + `MARGE_REPRISE_MS`, or never when
     the reset time is unknown (the user resumes). It goes back to `attente`
     IN PLACE (so it keeps its rank), by the clock (`reprendreEchues`) or by
     hand (`reprendre`); `annulerReprise` turns it into a failed line.
══════════════════════════════════════════════════════════ */

export type EtatLigne = "attente" | "cours" | "arret" | "enregistrement" | "prete" | "echouee" | "pause";

/** What a paused line waits for. */
export interface PauseLimite {
	/** The provider whose limit was hit (`aiProvider`): its other lines wait too. */
	readonly fournisseur: string;
	/** Epoch ms when the window resets, null when unknown (manual resume). */
	readonly reprise: number | null;
}

/** Providers can still refuse right at the reset: the line restarts this long after. */
export const MARGE_REPRISE_MS = 30000;

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
	/** Ce qui a échoué sur une ligne `echouee`. */
	readonly echec?: "generation" | "enregistrement";
	/** The usage limit a `pause` line waits for. */
	readonly pause?: PauseLimite;
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

/** What may run at once (2026-10-09, concurrent chats). */
export interface ReglesDemarrage<D> {
	/** At most this many lines running (`cours` or `arret`) at once. */
	max: number;
	/** The chat a request belongs to: one running line per chat. */
	chat(demande: D): string;
	/** A group whose lines run one at a time across chats (Antigravity,
	    remote requests), or null. */
	groupe(demande: D): string | null;
	/** The provider a request runs on: while one of its lines is paused on a
	    usage limit, none of the provider's waiting lines starts. Optional. */
	fournisseur?(demande: D): string;
}

/**
 * Starts, in send order, EVERY waiting line allowed to run (2026-10-09, as
 * MonoCode runs sessions side by side): its chat has no line running or
 * stopping (a chat stays a conversation), its group (if any) has none
 * either, and fewer than `max` lines run. A stopped line (`arret`) holds its
 * chat, its group and its slot until `solder`: its process is still dying.
 * `lignes` are the lines just started; the same `file` when none.
 */
export function demarrerPrets<D, R>(file: FileGeneration<D, R>, maintenant: number, regles: ReglesDemarrage<D>): { file: FileGeneration<D, R>; lignes: LigneFile<D, R>[] } {
	const actives = file.lignes.filter(l => l.etat === "cours" || l.etat === "arret");
	// A paused line holds its chat (a chat stays a conversation) and blocks its provider.
	const pauses = file.lignes.filter(l => l.etat === "pause");
	const chats = new Set([...actives, ...pauses].map(l => regles.chat(l.demande)));
	const bloques = new Set(pauses.map(l => l.pause?.fournisseur).filter((f): f is string => typeof f === "string"));
	const groupes = new Set(actives.map(l => regles.groupe(l.demande)).filter((g): g is string => g !== null));
	let nombre = actives.length;
	const parties: LigneFile<D, R>[] = [];
	for (const l of file.lignes) {
		if (nombre >= regles.max) break;
		if (l.etat !== "attente") continue;
		const chat = regles.chat(l.demande);
		const groupe = regles.groupe(l.demande);
		if (chats.has(chat) || (groupe !== null && groupes.has(groupe))) continue;
		if (regles.fournisseur && bloques.has(regles.fournisseur(l.demande))) continue;
		chats.add(chat);
		if (groupe !== null) groupes.add(groupe);
		nombre++;
		parties.push({ ...l, etat: "cours", debut: maintenant });
	}
	if (!parties.length) return { file, lignes: [] };
	const parId = new Map(parties.map(p => [p.id, p]));
	return { file: { ...file, lignes: file.lignes.map(l => parId.get(l.id) ?? l) }, lignes: parties };
}

/** La génération en cours (ou le nouvel essai d'enregistrement) a produit
    sa note. Sans effet sur une ligne qui ne travaille plus (annulée
    entre-temps). */
export function terminer<D, R>(file: FileGeneration<D, R>, id: number, resultat: R): FileGeneration<D, R> {
	const etat = ligne(file, id)?.etat;
	if (etat !== "cours" && etat !== "enregistrement") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "prete", demande: l.demande, resultat }));
}

/** La génération en cours a échoué. Même garde que `terminer`. */
export function echouer<D, R>(file: FileGeneration<D, R>, id: number, erreur: string): FileGeneration<D, R> {
	if (ligne(file, id)?.etat !== "cours") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "echouee", demande: l.demande, erreur, echec: "generation" }));
}

/** Le modèle a répondu mais la note n'a pas pu être écrite. `demande` est la
    demande COMPLÉTÉE du quiz produit, qui la suit désormais : un nouvel essai
    d'enregistrement n'a plus besoin du CLI. */
export function echouerEnregistrement<D, R>(file: FileGeneration<D, R>, id: number, erreur: string, demande: D): FileGeneration<D, R> {
	const etat = ligne(file, id)?.etat;
	if (etat !== "cours" && etat !== "enregistrement") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "echouee", demande, erreur, echec: "enregistrement" }));
}

/** « Réessayer l'enregistrement » : seulement après un échec d'écriture. La
    ligne ne repasse pas par la file — aucun CLI n'est relancé. */
export function reessayerEnregistrement<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const l = ligne(file, id);
	if (l?.etat !== "echouee" || l.echec !== "enregistrement") return file;
	return remplacer(file, id, x => ({ id: x.id, etat: "enregistrement", demande: x.demande }));
}

/** Le bouton ■ : une ligne en attente QUITTE la file ; une ligne en cours
    passe en `arret` (l'appelant tue le processus). `arreter` dit s'il y a un
    processus à tuer. Sans effet sur une ligne terminée : c'est la croix. */
export function annuler<D, R>(file: FileGeneration<D, R>, id: number): { file: FileGeneration<D, R>; arreter: boolean } {
	const l = ligne(file, id);
	if (l?.etat === "attente" || l?.etat === "pause") return { file: retirer(file, id), arreter: false };
	if (l?.etat === "cours") return { file: remplacer(file, id, x => ({ id: x.id, etat: "arret", demande: x.demande })), arreter: true };
	return { file, arreter: false };
}

/** La génération annulée a rendu la main : sa ligne disparaît, la place se
    libère pour la suivante. Sans effet sur une ligne qui n'est pas en `arret`. */
export function solder<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	return ligne(file, id)?.etat === "arret" ? retirer(file, id) : file;
}

/** The running line hit a usage limit: it pauses, with no process left. Same
    guard as `echouer`. A paused line keeps its request (`demande`). */
export function mettreEnPause<D, R>(file: FileGeneration<D, R>, id: number, pause: PauseLimite): FileGeneration<D, R> {
	if (ligne(file, id)?.etat !== "cours") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "pause", demande: l.demande, pause }));
}

/** "Resume now": the limit is the ACCOUNT's, so every line paused on the same
    provider as `id` waits its turn again, each IN PLACE (a sibling still
    paused would keep blocking the one the user chose). Without effect on a
    line that is not paused. */
export function reprendre<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const cible = ligne(file, id);
	if (cible?.etat !== "pause") return file;
	const f = cible.pause?.fournisseur;
	return { ...file, lignes: file.lignes.map(l => (l.etat === "pause" && l.pause?.fournisseur === f ? { id: l.id, etat: "attente" as const, demande: l.demande } : l)) };
}

/** "Cancel the resume": the paused line becomes a failed one, which "Try
    again" (`reessayer`) can still send back to the queue. */
export function annulerReprise<D, R>(file: FileGeneration<D, R>, id: number, erreur: string): FileGeneration<D, R> {
	if (ligne(file, id)?.etat !== "pause") return file;
	return remplacer(file, id, l => ({ id: l.id, etat: "echouee", demande: l.demande, erreur, echec: "generation" }));
}

/** When a paused line becomes due: reset time plus the margin; null for a
    line that is not paused or whose reset time is unknown or not a finite
    number (a stored "abc" would otherwise give NaN, a timer of 0 ms, and a
    loop). */
export function echeance<D, R>(l: LigneFile<D, R>): number | null {
	const reprise = l.etat === "pause" ? l.pause?.reprise : null;
	return typeof reprise === "number" && Number.isFinite(reprise) ? reprise + MARGE_REPRISE_MS : null;
}

/** A pause read back from storage: a provider that is not text becomes "",
    a reset time that is not a finite number becomes null (manual resume). */
function pauseRelue(p: unknown): PauseLimite {
	const o = typeof p === "object" && p !== null ? (p as { fournisseur?: unknown; reprise?: unknown }) : {};
	return {
		fournisseur: typeof o.fournisseur === "string" ? o.fournisseur : "",
		reprise: typeof o.reprise === "number" && Number.isFinite(o.reprise) ? o.reprise : null,
	};
}

/** Every paused line whose time has come goes back to `attente`. `ids` are
    the lines resumed. */
export function reprendreEchues<D, R>(file: FileGeneration<D, R>, maintenant: number): { file: FileGeneration<D, R>; ids: number[] } {
	const ids = file.lignes.filter(l => { const e = echeance(l); return e !== null && maintenant >= e; }).map(l => l.id);
	if (!ids.length) return { file, ids };
	return { file: { ...file, lignes: file.lignes.map(l => (ids.includes(l.id) ? { id: l.id, etat: "attente" as const, demande: l.demande } : l)) }, ids };
}

/** The next moment a paused line comes due, null when none will. */
export function prochaineEcheance<D, R>(file: FileGeneration<D, R>): number | null {
	const dues = file.lignes.map(echeance).filter((e): e is number => e !== null);
	return dues.length ? Math.min(...dues) : null;
}

/** « Réessayer » : la MÊME demande repart en fin de file, derrière celles
    qui attendaient déjà — pas devant elles. */
export function reessayer<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const l = ligne(file, id);
	// Un échec d'ENREGISTREMENT garde son quiz : il ne relance jamais le CLI.
	if (l?.etat !== "echouee" || l.echec !== "generation") return file;
	return { ...file, lignes: [...file.lignes.filter(x => x.id !== id), { id: l.id, etat: "attente", demande: l.demande }] };
}

/** The model's answer arrived: the line's request now carries it
    (`demande`), BEFORE the note is written — a reload between the two must
    write that note, never ask the model again. Only on a working line. */
export function completer<D, R>(file: FileGeneration<D, R>, id: number, demande: D): FileGeneration<D, R> {
	const etat = ligne(file, id)?.etat;
	if (etat !== "cours" && etat !== "enregistrement") return file;
	return remplacer(file, id, l => ({ ...l, demande }));
}

/** THE QUEUE OF A RELOADED PAGE (2026-09-30), from the one saved before
    the reload. A line being stopped (`arret`) is gone: its process was
    already told to die. A line running whose answer had already arrived
    (`aProduit`) only has its note left to write: `enregistrement`. Every
    other line keeps its state — the caller runs the `cours` line again,
    which attaches to its CLI still running (`HostProcess.run`, `reprise`).
    A paused line's `pause` is validated (`pauseRelue`). */
export function restaurer<D, R>(file: FileGeneration<D, R>, aProduit: (demande: D) => boolean): FileGeneration<D, R> {
	const lignes = file.lignes
		.filter(l => l.etat !== "arret")
		.map(l => (l.etat === "cours" && aProduit(l.demande) ? { id: l.id, etat: "enregistrement" as const, demande: l.demande }
			: l.etat === "pause" ? { id: l.id, etat: "pause" as const, demande: l.demande, pause: pauseRelue(l.pause) }
			: l));
	const plusGrand = lignes.reduce((m, l) => Math.max(m, l.id), 0);
	return { lignes, prochainId: Math.max(file.prochainId, plusGrand + 1) };
}

/** La croix : ferme une ligne prête ou échouée. Une ligne qui attend ou qui
    tourne ne se ferme pas, elle s'annule. */
export function fermer<D, R>(file: FileGeneration<D, R>, id: number): FileGeneration<D, R> {
	const etat = ligne(file, id)?.etat;
	return etat === "prete" || etat === "echouee" ? retirer(file, id) : file;
}
