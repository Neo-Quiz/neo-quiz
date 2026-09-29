/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LES CLI, UN PASSE-PLAT VERS LE PRINCIPAL

   Tâche 3 puis 7 de la génération IA dans l'application. `HostProcess`
   (`src/host/types.ts`) côté RENDU : ce module ne touche AUCUN fichier et ne
   lance AUCUN process — il n'en a ni le droit ni les moyens (`require`
   n'existe pas ici, `contextIsolation` et `sandbox` le retirent). Il traduit
   chaque appel en un canal du pont, et c'est le PRINCIPAL qui lit le disque et
   lance (`apps/windows/electron/process.ts`).

   LE NOM DE L'OUTIL TRAVERSE, JAMAIS UN CHEMIN : les chemins des fichiers de
   CLI sont fixes et connus du seul principal, celui de l'EXÉCUTABLE est résolu
   là-bas (réglage `cheminClaude`/`cheminCodex` lu dans le magasin du principal,
   sinon le `PATH` étendu), et `canaux.ts` refuse tout nom hors liste. C'est la
   même règle que le périmètre pour les chemins et la liste d'hôtes pour les
   URL — et c'est ce qui rend `process.run("x.bat")` impossible à formuler.

   LES DEUX SEULES CHOSES QUI SONT À NOUS ICI :

   1. L'ANNULATION. Un `AbortSignal` ne traverse pas l'IPC (il ne se clone pas) :
      chaque appel reçoit un identifiant, et l'abandon du signal est relayé par
      `processus.annuler(id)`. Même patron qu'au réseau (`net.ts`), et le
      principal tue alors l'ARBRE de process.
   2. LE NOM DE L'ERREUR. Le canal rend une ENVELOPPE (`ResultatCli`) plutôt
      qu'un rejet, parce que l'IPC d'Electron perd le `name` d'une erreur jetée
      — or tout le contrat de `run` tient dans ce nom (`introuvable`, `timeout`,
      `annule`, `refuse`, `occupe`). Ce module le RECONSTRUIT, et c'est le seul
      endroit du rendu qui le fasse : sans lui, « Claude Code n'est pas
      installé » arriverait dans la page sous le nom « Error », donc traduit en
      « réponse illisible du modèle ».
══════════════════════════════════════════════════════════ */

import type { HostProcess } from "../../../../src/host/types";
import { pont } from "./pont";

/** The next call id. A COUNTER, so two calls in flight never share one, and
    an id reused after a call has ended no longer names anything in the main
    process. */
/* But a RANDOM start, not 1 (2026-09-29): the counter restarts with the page,
   and a CLI of the previous page may still be running after a reload —
   its streamed chunks (`surFlux`) carry ITS id, and must never land in the
   transcript of a new run that happens to get the same number. */
let prochainId = 1 + Math.floor(Math.random() * 1_000_000_000);

/** Une erreur dont le `name` est celui que le contrat nomme — reconstruit
    depuis l'enveloppe du canal. */
function erreurCli(nom: string, message: string): Error {
	const e = new Error(message);
	e.name = nom;
	return e;
}

export function createWindowsProcess(): HostProcess {
	return {
		async run(spec) {
			const id = prochainId++;
			/* `signal` RETIRÉ de ce qui traverse : le clonage structuré de l'IPC
			   rejetterait un `AbortSignal`, et `invoke` échouerait avant même que
			   le principal ne voie l'appel. Le reste est recopié champ par champ —
			   `RequeteCli` (`pont.ts`) dit exactement ce qui passe. */
			const { signal, tool, args, stdin, timeoutMs, marqueur, fichiers, sortieFichier, onStdout } = spec;
			/* Déjà annulé avant l'envoi : rien à lancer. Le contrat nomme cette
			   issue `annule`, et le principal n'a pas à voir partir un CLI que
			   personne n'attend plus. */
			if (signal?.aborted) throw erreurCli("annule", "CLI annulé avant son lancement : " + tool);
			const relayer = (): void => {
				void pont().processus.annuler(id);
			};
			signal?.addEventListener("abort", relayer, { once: true });
			/* The live transcript: subscribed BEFORE the call, filtered on THIS
			   run's id, dropped in `finally` — a chunk of another run, or of a
			   run of the previous page, never reaches this listener. */
			const desabonner = onStdout
				? pont().processus.surFlux((requete, texte) => {
					if (requete !== id) return;
					try { onStdout(texte); } catch { /* the transcript never stops a run */ }
				})
				: null;
			try {
				const res = await pont().processus.run(
					{ tool, args, stdin, timeoutMs, marqueur, fichiers, sortieFichier },
					id,
					!!onStdout,
				);
				if (!res.ok) throw erreurCli(res.nom, res.message);
				return { stdout: res.stdout, stderr: res.stderr, code: res.code, sortie: res.sortie };
			} finally {
				signal?.removeEventListener("abort", relayer);
				desabonner?.();
			}
		},
		/* Le NOM, et rien d'autre. Un rejet du principal (outil hors liste)
		   remonte ici comme une erreur ANONYME — l'IPC ne conserve pas son
		   `name`, c'est précisément pourquoi `run` passe par une enveloppe — et
		   ça suffit à l'appelant (`ai-providers.ts`), qui ne lit pas le nom : il
		   rattrape tout rejet et retombe sur son repli embarqué. */
		lireCache(tool) {
			return pont().processus.lireCache(tool);
		},
		ollamaInstalle() {
			return pont().processus.ollamaInstalle();
		},
		demarrerOllama() {
			return pont().processus.demarrerOllama();
		},
		installerCli(tool, ancre) {
			return pont().processus.installer(tool, ancre);
		},
		connecterCli(tool, ancre) {
			return pont().processus.connecter(tool, ancre);
		},
		attendreFinTerminal() {
			return pont().processus.attendreFinTerminal();
		},
		surCachesCli(rappel) {
			return pont().processus.surCachesCli(rappel);
		},
		surTerminalPose(rappel) {
			return pont().processus.surTerminalPose(rappel);
		},
		surNavigateurOuvert(rappel) {
			return pont().processus.surNavigateurOuvert(rappel);
		},
		replacerTerminal(ancre) {
			return pont().processus.replacerTerminal(ancre);
		},
		etatComptes(outils) {
			return pont().processus.comptesEtat(outils);
		},
		usageCompte(tool) {
			return pont().processus.comptesUsage(tool);
		},
		deconnecterCli(tool) {
			return pont().processus.comptesDeconnecter(tool);
		},
		terminalUsageCli(tool) {
			return pont().processus.comptesUsageTerminal(tool);
		},
	};
}
