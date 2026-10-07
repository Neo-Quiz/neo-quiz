import type { HostRoot } from "../../../../src/host/types";
import { REVIEW_DIR, REVIEW_JOURNAL_DIR, REVIEW_LOG_NAME } from "../../../../src/review/paths";
import { PLUGIN_ID } from "../../../../src/branding";

/* ══════════════════════════════════════════════════════════
   LES RACINES DE L'APPLICATION

   Le contrat ne connaît qu'un espace de chemins. L'application peut ouvrir
   jusqu'à dix dossiers : ses chemins du contrat portent donc un PREMIER
   SEGMENT qui nomme la racine — « Efrei/Cours/reseau.md ».

   Ce que ce préfixe ne doit JAMAIS toucher, c'est la clé du journal de
   révision : elle vaut « Cours/reseau.md::adressage-ip » des deux côtés,
   sans quoi le greffon et l'application cesseraient de partager
   l'historique du même dossier — et rien ne le signalerait avant qu'un
   semestre de révisions ait disparu de l'écran. `local()` retire le
   préfixe, `contrat()` le remet, et ces deux fonctions sont le SEUL endroit
   du dépôt où la conversion existe.

   PURE : aucun appel Tauri, aucun accès disque. C'est ce qui la rend
   éprouvable (`npm run check:windows-host`).
══════════════════════════════════════════════════════════ */

/** Un dossier ouvert. `vault` décide seulement où vont les RÉSULTATS. */
export interface RacineOuverte {
	id: string;
	name: string;
	/** Chemin absolu sur le disque. */
	path: string;
	vault: boolean;
}

export interface CarteRacines {
	toutes(): RacineOuverte[];
	hostRoots(): HostRoot[];
	/** La racine d'un chemin du contrat, ou null. */
	pour(cheminContrat: string): RacineOuverte | null;
	/** Chemin du contrat → chemin relatif à sa racine (la clé du journal). */
	local(cheminContrat: string): string;
	/** Identifiant + chemin local → chemin du contrat. */
	contrat(rootId: string, local: string): string;
	/** Chemin du contrat → chemin ABSOLU disque, ou null hors racines. */
	absolu(cheminContrat: string): string | null;
	/** Chemin absolu disque → chemin du contrat, ou null hors racines. */
	depuisAbsolu(absolu: string): string | null;
}

const nettoyer = (chemin: string): string =>
	String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

/** `deviceId` is an INPUT, resolved once at startup before the map is built
    (the map itself stays synchronous and pure): it names this device's own
    review log file, see `src/review/journal-set.ts`. */
export function creerCarteRacines(racines: RacineOuverte[], deviceId: string): CarteRacines {
	const parId = new Map(racines.map(r => [r.id, r]));

	const decouper = (cheminContrat: string): { racine: RacineOuverte; reste: string } | null => {
		const p = nettoyer(cheminContrat).replace(/^\/+/, "");
		const coupe = p.indexOf("/");
		const tete = coupe < 0 ? p : p.slice(0, coupe);
		const racine = parId.get(tete);
		if (!racine) return null;
		return { racine, reste: coupe < 0 ? "" : p.slice(coupe + 1) };
	};

	return {
		toutes() { return [...racines]; },
		hostRoots() {
			return racines.map(r => ({
				id: r.id,
				name: r.name,
				vault: r.vault,
				diskPath: nettoyer(r.path),
				/* Le journal, TOUJOURS au même endroit sous la racine — jamais
				   selon qu'elle est un vault ou non. La raison est écrite dans
				   `src/review/paths.ts` : une détection peut changer d'avis, un
				   historique perdu ne revient pas. */
				reviewLog: `${r.id}/${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
				/* One log file per device in this directory; `reviewLog` above is
				   the legacy single log, now read only. */
				reviewJournalDir: `${r.id}/${REVIEW_DIR}/${REVIEW_JOURNAL_DIR}`,
				deviceId,
				/* L'ancien journal du GREFFON, à son emplacement conventionnel.
				   L'application le lit pour la même raison que le greffon : si
				   elle est installée d'abord, elle démarrerait sinon sur un
				   journal vide avec un semestre d'historique juste à côté. */
				legacyReviewLog: `${r.id}/.obsidian/plugins/${PLUGIN_ID}/${REVIEW_LOG_NAME}`,
			}));
		},
		pour(cheminContrat) { return decouper(cheminContrat)?.racine ?? null; },
		local(cheminContrat) {
			const d = decouper(cheminContrat);
			/* Un chemin hors racines est rendu TEL QUEL plutôt que vidé : une
			   chaîne vide deviendrait une clé de journal « ::id », qui
			   ressemblerait à une vraie clé et polluerait l'historique. */
			return d ? d.reste : nettoyer(cheminContrat);
		},
		contrat(rootId, local) {
			const l = nettoyer(local).replace(/^\/+/, "");
			if (!rootId) return l;
			return l ? `${rootId}/${l}` : rootId;
		},
		absolu(cheminContrat) {
			const d = decouper(cheminContrat);
			if (!d) return null;
			return d.reste ? `${nettoyer(d.racine.path)}/${d.reste}` : nettoyer(d.racine.path);
		},
		depuisAbsolu(absolu) {
			const abs = nettoyer(absolu);
			const bas = abs.toLowerCase();
			/* La plus LONGUE racine gagne : un dossier ouvert à l'intérieur d'un
			   autre (« C:/Vault » et « C:/Vault/Cours ») donnerait sinon deux
			   chemins du contrat pour le même fichier, selon l'ordre de la
			   liste — et deux entrées au catalogue pour un seul quiz.
			   La comparaison ignore la casse : Windows l'ignore aussi, et un
			   surveillant qui rendrait « C:/Users… » là où la racine dit
			   « c:/users… » ferait tomber tous les évènements dans le vide. */
			let meilleure: RacineOuverte | null = null;
			for (const r of racines) {
				const base = nettoyer(r.path).toLowerCase();
				if (bas !== base && !bas.startsWith(base + "/")) continue;
				if (!meilleure || nettoyer(r.path).length > nettoyer(meilleure.path).length) meilleure = r;
			}
			if (!meilleure) return null;
			const reste = abs.slice(nettoyer(meilleure.path).length).replace(/^\/+/, "");
			return reste ? `${meilleure.id}/${reste}` : meilleure.id;
		},
	};
}

/**
 * Où vont les résultats d'un quiz de CE chemin : dans un vault, à
 * l'emplacement où le greffon écrit déjà (`.obsidian/quiz-blocks-results`) ;
 * hors d'un vault, sous `.neo-quiz/results` — jamais un `.obsidian/` fantôme
 * dans un dossier que l'utilisateur n'a jamais ouvert avec Obsidian.
 *
 * Fonction LIBRE et non méthode de `CarteRacines` : elle ne fait que LIRE la
 * carte (`pour`, `contrat`), elle n'a rien à ajouter à son contrat public.
 * Le préfixe passe par `carte.contrat`, jamais par une concaténation à la
 * main — c'est ce qui a dû être corrigé au premier tour de revue (`index.ts`
 * composait `${r.id}/${sous}` lui-même).
 *
 * PURE, comme le reste de ce fichier : `createWindowsHost` (`./index.ts`)
 * importe MathLive et Tauri, qu'esbuild ne sait pas charger hors de la
 * fenêtre (build-testé : « No matching export ... MathfieldElement » dans
 * la variante SSR) — cette fonction, extraite ici, reste éprouvable par
 * `npm run check:windows-host` alors que le reste de l'hôte ne l'est pas.
 */
export function resultsDirFor(carte: CarteRacines, sourcePath: string): string {
	const r = carte.pour(sourcePath);
	const sous = r?.vault ? ".obsidian/quiz-blocks-results" : `${REVIEW_DIR}/results`;
	return r ? carte.contrat(r.id, sous) : sous;
}

/**
 * Coupe un chemin en base + EXTENSION, le point cherché dans le DERNIER
 * SEGMENT seulement.
 *
 * `lastIndexOf(".")` sur le chemin ENTIER se trompe dès qu'un DOSSIER porte un
 * point et que le fichier n'en a pas : « Quiz/.trash/notes » couperait au point
 * de « .trash », et l'homonyme suivant mis à la corbeille deviendrait
 * « Quiz/-2.trash/notes » — un chemin qui n'a plus rien à voir avec le premier,
 * donc deux fichiers rangés dans deux dossiers différents au lieu d'être
 * numérotés côte à côte. Un point de TÊTE de nom n'est pas une extension non
 * plus (« .gitignore »), même règle que `toHostFile` (`./fs.ts`).
 */
export function couperExtension(chemin: string): { base: string; ext: string } {
	const barre = chemin.lastIndexOf("/");
	const point = chemin.lastIndexOf(".");
	return point > barre + 1
		? { base: chemin.slice(0, point), ext: chemin.slice(point) }
		: { base: chemin, ext: "" };
}

/**
 * Le premier chemin LIBRE de la forme `base`, `base-2`, `base-3`… + `ext`.
 *
 * Et surtout : il NE RÉSERVE RIEN, là où `reserveFreePath`
 * (`src/unique-path.ts`) tient un registre en mémoire. Ce n'est pas un oubli,
 * c'est le contrat : `HostPaths.attachmentPathFor` promet un chemin libre et
 * laisse la RÉSERVATION à l'appelant. Réserver ici la ferait compter DEUX fois
 * — l'appelant (`editor/editor-form.ts`) réserve à son tour le chemin rendu,
 * le trouverait déjà pris par nous, et sauterait au suivant : chaque image
 * collée sortirait en « Pasted image ….-2.png », puis « -3-2 », et le nom de
 * base resterait brûlé pour la session sans jamais être écrit.
 * C'est aussi la sémantique d'Obsidian, dont `getAvailablePathForAttachment`
 * déduplique contre ce qui EXISTE sans rien réserver : les deux hôtes doivent
 * se comporter pareil, et c'est le contrat écrit qui dit lequel a raison.
 *
 * Bornée, et l'échec est BRUYANT, comme `reserveFreePath` : rendre un chemin
 * qu'on sait pris ferait écraser un fichier.
 */
export async function cheminLibre(
	existe: (chemin: string) => Promise<boolean>,
	base: string,
	ext: string,
): Promise<string> {
	for (let n = 1; n <= 50; n++) {
		const candidat = n === 1 ? base + ext : `${base}-${n}${ext}`;
		if (!(await existe(candidat))) return candidat;
	}
	throw new Error("Aucun nom de fichier libre après 50 essais : " + base + ext);
}

/**
 * Chemin LIBRE d'une pièce jointe : MÊME DOSSIER QUE LA NOTE.
 *
 * L'application n'a pas de réglage « dossier des pièces jointes » et n'en
 * invente pas un : à côté de la note est le seul endroit qui survive au
 * déplacement du dossier de quiz, et c'est aussi l'un des modes qu'Obsidian
 * propose. Le lien écrit dans le bloc porte le NOM seul, donc la résolution le
 * retrouvera là.
 *
 * SANS note d'accueil, elle REJETTE, et le contrat le dit (`HostPaths`). La
 * fenêtre n'a pas de fichier ACTIF sur quoi retomber comme Obsidian, et
 * choisir une racine parmi les dix qu'elle peut ouvrir poserait l'image hors
 * de la racine où la note finira — où la résolution de liens, BORNÉE à cette
 * racine (`links.ts`), ne la retrouverait plus. Une image perdue en silence
 * coûte plus cher qu'un refus nommé.
 *
 * Le test d'existence est un PARAMÈTRE, et non `HostFs.exists` pris sur place :
 * c'est ce qui garde cette fonction PURE, pour la raison écrite au-dessus de
 * `resultsDirFor` — `./index.ts`, qui construit `paths`, importe MathLive et
 * Tauri qu'esbuild ne charge pas hors de la fenêtre. Écrite là-bas, elle
 * n'aurait AUCUN cas dans `npm run check:windows-host` ; ici, elle en a.
 */
export async function attachmentPathFor(
	existe: (chemin: string) => Promise<boolean>,
	name: string,
	sourcePath?: string,
): Promise<string> {
	const note = nettoyer(sourcePath ?? "");
	const barre = note.lastIndexOf("/");
	const dossier = barre > 0 ? note.slice(0, barre) : "";
	/* Un chemin du contrat porte TOUJOURS son identifiant de racine en premier
	   segment : sans « / », la note ne désigne aucun dossier ouvert, et le
	   chemin rendu sortirait des racines — `abs()` le rejetterait plus loin
	   avec un message qui ne dirait pas pourquoi. */
	if (!dossier) throw new Error(`pièce jointe sans note d'accueil : ${sourcePath || "aucune note"}`);
	const { base, ext } = couperExtension(`${dossier}/${name}`);
	return await cheminLibre(existe, base, ext);
}
