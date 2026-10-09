/**
 * Réservation d'un nom de fichier LIBRE, sans course.
 *
 * Trois endroits du plugin écrivent un fichier dont le nom peut déjà exister :
 * une image collée, un fichier de résultats, un quiz partagé. Tous faisaient
 * « demander au disque si le nom est pris, puis écrire » — deux opérations,
 * donc une fenêtre entre les deux. Ce n'est pas théorique : coller deux
 * captures coup sur coup lance deux chaînes `await` qui franchissent le test
 * AVANT que l'une n'ait écrit, et la seconde image effaçait la première
 * (revue codex 2026-07-31).
 *
 * Deux garde-fous, parce qu'aucun ne suffit seul :
 * 1. une RÉSERVATION en mémoire — un nom rendu ici n'est plus jamais rendu
 *    dans cette session, même si le fichier n'existe pas encore sur le
 *    disque. C'est ce qui ferme la course DANS une fenêtre, la seule qui
 *    arrive en pratique ;
 * 2. la question au disque, qui couvre ce qui existait déjà.
 *
 * Ce qui n'est PAS couvert : deux fenêtres d'Obsidian sur le même vault.
 * Obsidian n'expose aucune création atomique ; le suffixe aléatoire rend la
 * collision improbable, il ne l'interdit pas.
 */

/** Noms déjà rendus dans cette session, tous appelants confondus.
    Les clés sont repliées en minuscules : Windows et macOS ne distinguent pas
    `Quiz.zip` de `quiz.zip`, et deux appels concurrents obtenaient ces deux
    noms — donc le MÊME fichier physique, dont un seul contenu survivait
    (revue codex 2026-07-31). */
const reserves = new Set<string>();

/**
 * La clé de réservation d'un chemin : sa forme repliée.
 *
 * Le repliage est INCONDITIONNEL, y compris sous Linux où deux noms qui ne
 * diffèrent que par la casse sont bien deux fichiers. Le coût y est nul en
 * pratique — la seule conséquence est un suffixe sur un nom qui aurait pu s'en
 * passer, dans le cas improbable où deux écritures concurrentes ne diffèrent
 * que par la casse. Le bénéfice, lui, est une perte de fichier en moins sur
 * Windows et macOS. Même raisonnement pour les subtilités de `toLowerCase()`
 * (le `I` turc, le `ß` allemand) : replier deux noms distincts coûte un
 * suffixe, les séparer à tort coûterait un fichier.
 */
const cle = (chemin: string): string => chemin.toLowerCase();

/**
 * @param base      chemin sans extension (« dossier/Pasted image 2026… »)
 * @param ext       extension AVEC son point, ou vide
 * @param existe    test d'existence, tel que l'appelant sait le faire
 * @param suffixe   forme du suffixe ; `n` vaut 2, 3, … à chaque essai
 */
export async function reserveFreePath(
	base: string,
	ext: string,
	existe: (chemin: string) => Promise<boolean>,
	suffixe: (n: number) => string = (n) => `-${n}`,
): Promise<string> {
	/* Borné, et l'échec est BRUYANT : rendre un chemin qu'on sait pris ferait
	   écraser un fichier — exactement ce que cette fonction existe pour
	   empêcher. Cinquante essais ne s'atteignent pas par accident. */
	for (let n = 1; n <= 50; n++) {
		const chemin = n === 1 ? base + ext : base + suffixe(n) + ext;
		if (reserves.has(cle(chemin))) continue;
		/* RÉSERVÉ AVANT le premier `await`, et c'est tout l'intérêt : réserver
		   après le test d'existence laissait les deux chaînes concurrentes
		   franchir ce test puis choisir le MÊME nom (mesuré). Ici la seconde
		   trouve le candidat déjà pris et passe au suivant, parce que le
		   premier tour de boucle s'exécute sans interruption. */
		reserves.add(cle(chemin));
		if (!(await existe(chemin))) return chemin;
		// Pris sur le disque : il reste réservé (il existe de toute façon).
	}
	throw new Error("Aucun nom de fichier libre après 50 essais : " + base + ext);
}

/**
 * Rend un nom réservé qui n'a finalement PAS été écrit.
 *
 * Sans ça, une écriture ratée condamnait le nom pour toute la session : le
 * collage suivant sautait un nom pourtant libre, et cinquante échecs de suite
 * faisaient lever alors que rien n'existait sur le disque (revue codex
 * 2026-07-31). À appeler dans le `catch` de l'écriture, jamais après un succès.
 */
export function releaseReservedPath(chemin: string): void {
	reserves.delete(cle(chemin));
}

/**
 * Reserves `chemin` SYNCHRONOUSLY, without asking the disk: `false` when it
 * was already handed out in this session. For a name that must be known
 * before any `await` and that carries its own random suffix (the results
 * file of an attempt, engine/results-save.ts).
 */
export function reservePath(chemin: string): boolean {
	if (reserves.has(cle(chemin))) return false;
	reserves.add(cle(chemin));
	return true;
}
