# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Application Windows (Electron, `apps/windows/`) qui joue, révise, édite et
génère par IA des quiz écrits en blocs de code ` ```quiz-blocks ` (tableau
JSON5) dans des notes Markdown : rendu avec transitions, Test chronométré,
LaTeX, journal de révision. Le greffon Obsidian a été SUPPRIMÉ du dépôt
(décision d'Ahmed, 2026-10-01) ; le format de note `quiz-blocks` n'a pas
bougé, et les anciennes releases du greffon restent publiées sur GitHub (une
version publiée ne se supprime jamais). Le code partagé (`src/`) ne connaît
aucun hôte : une application Android viendra, et n'aura à écrire qu'un hôte.
100 % TypeScript strict (ESM). **Commentaires de code en ANGLAIS** (voir
« Langue du code » ci-dessous) ; **UI traduite** (anglais par défaut, cf.
« Langue » ci-dessous).

## Langue du code (depuis le 2026-09-27)

Le dépôt est public et doit pouvoir accueillir d'autres contributeurs en même
temps qu'Ahmed : un code en français n'est lisible que par des francophones.

- **Plus RIEN de nouveau en français dans le code** : commentaires (ligne,
  bloc, JSDoc), noms de fonctions, variables, types, constantes, fichiers et
  dossiers, messages de log et d'erreur, sorties des scripts `check:*`,
  workflows, pages de `docs/`. Tout ce qui s'écrit à partir d'aujourd'hui
  s'écrit en anglais.
- **Le français existant passe en anglais au fur et à mesure**, jamais en un
  seul grand chantier : un fichier qu'on modifie voit son français traduit
  dans le même commit — au moins la zone touchée, le fichier entier s'il est
  petit.
  - **Commentaires** : une traduction garde le SENS entier — le pourquoi, le
    bug évité, la date —, jamais un résumé qui perd l'information. Pas de
    citation d'Ahmed ni de son prénom dans la version anglaise (dépôt public).
  - **Identifiants et noms de fichiers** (`urlLegale`, `perimetre`,
    `ajouter`, `fichiers.ts`…) : un renommage touche CHAQUE appelant, et les
    contrôles qui cherchent un nom EN TEXTE (`check-installer`, `check:host`,
    `SANS_NODE`…) ne rougissent pas toujours à la compilation. Renommer
    partout où il sert, puis relancer `npm run check`, `check:app` et les
    `check:*` qui citent le nom — jamais un renommage à moitié.
- **Ce qui RESTE en français** : ce fichier (`CLAUDE.md`), la note du vault,
  les échanges avec Ahmed, et évidemment le dictionnaire français de l'UI
  (`src/i18n/fr/`). Les clés persistées du format quiz ne bougent jamais
  (voir « Langue »).

## La mémoire du projet est la note du vault, pas un fichier de mémoire

`C:\obsidian-vaults\Personal\Projets\Neo Quiz\Neo Quiz.md` est
**la** mémoire du chantier en cours : ce qui est fait, en cours, à faire, et
combien il en reste — plus les idées, l'objectif Android, la stack et les
décisions. Elle a absorbé `Objectifs & Idées.md` et `Décisions.md` le
2026-09-30 (« tout ce qu'il me faut dans cette note-là ») ; seul
l'historique reste à part, dans `Versions publiées.md`. Décidé le 2026-09-17 (« c'est ce dossier qui doit te
servir de mémoire du projet, au moins pour les plans ; à chaque fois je dois
dire de mettre à jour les tâches, c'est épuisant »). Règles, **sans jamais
attendre qu'Ahmed le demande** :

- **La forme de la note** (réorganisée le 2026-09-29, à la demande d'Ahmed ;
  titre fixe depuis le 2026-10-01) : sous `# Version en cours`, UN SEUL titre
  fixe, `## <span class="plan-en-cours">Plan en cours</span>` (ambre, la
  couleur de `plan-active`, règle `.plan-en-cours` de `callouts.css`) — plus
  de titre `N. Version suivante desktop-vX.Y.Z` par version : un correctif
  sort parfois plusieurs fois par jour et le titre était périmé en quelques
  heures, alors que `CHANGELOG.md` dit déjà ce que contient chaque version.
  Plus de callout `[!goal]` non plus. Sous ce titre,
  chaque plan est un callout de premier niveau : `> [!plan-active]+` (en
  cours), `> [!plan-paused]-` (commencé puis mis en pause — ajouté le
  2026-09-29), `> [!plan]-` (pas commencé), `> [!plan-done]-` (terminé).
  **Seul le plan EN COURS est ouvert** (`+`, donc ouvert et repliable) ;
  tous les autres sont repliés (`-`) — règle d'Ahmed du 2026-09-29. Leur
  style vit dans le snippet `callouts.css` du vault.
  Les lignes isolées (à faire, bugs, idées, fait hors plan) forment une liste
  sous le titre, rangée par intertitres en gras.
- **Au début d'une session** sur un chantier : lire « Plan en
  cours » et le callout `[!plan-active]` du chantier avant tout — c'est là, pas
  dans `memory/`, que vit l'état du plan.
- **Dès qu'un plan est commité** : ses N tâches y sont écrites en entier, une
  ligne `- [ ] <span class="num">TN.</span> **titre** : une phrase` par tâche,
  dans une tranche `**Le plan, tâche par tâche** :` de son callout — la
  dernière ligne dit « Le plan compte N tâches. ».
- **Plus de `[/]` au dispatch** : le callout `plan-active` dit déjà que le
  plan est en cours. **À chaque revue close** : `- [x]` + SHA court entre
  parenthèses. Le plan fini, son callout passe `> [!plan-done]-`, et part dans
  `Versions publiées.md` (entrée `[!goal-done]` de la version) une fois
  publié : la note ne garde que ce qui reste à faire. Un bug ou
  une idée vus à l'écran pendant le chantier : une ligne de plus dans la liste
  de la version, le jour même.
- **Toujours par un agent** (jamais la session principale), avec le texte
  exact des lignes à changer : Sonnet 5.5 (décision du 2026-09-29). C'est le rôle que la mémoire
  `feedback_note-vault-task-in-progress` ne fait que pointer.

## Langue (i18n)

- **Jamais de chaîne visible en dur** dans le code : tout passe par `t("<domaine>.<clé>")`
  de `src/i18n.ts`. L'**anglais** (`src/i18n/en/*.ts`) est le dictionnaire de
  RÉFÉRENCE ; le français (`src/i18n/fr/*.ts`) est typé `Record<keyof typeof EN_X, string>`
  → une traduction oubliée est une **erreur de compilation**, pas un texte anglais
  qui fuit dans l'UI française.
- Un dictionnaire **par domaine** (`settings`, `ai`, `dashboard`, `editor`, `engine`,
  `app`, `review`, `installer`), agrégé dans `src/i18n/{en,fr}.ts`. Nouveau domaine = un import de plus.
- Réglage `language` : `auto` (défaut) | `en` | `fr`. `auto` lit la langue de l'HÔTE
  (`host.platform.uiLanguage`, repli `navigator.language` puis `<html lang>` puis
  l'anglais).
- **PIÈGE** : `t()` doit être appelé **AU RENDU**. Une chaîne traduite dans une
  constante top-level est figée à la langue du démarrage et ignore le changement de
  langue → transformer la constante en fonction (c'est pourquoi `TUTORIALS` est une
  fonction, pas un objet).
- **Ne JAMAIS traduire** : les clés du format quiz (`title`, `prompt`, `options`,
  `correctIndex`, `answer`, `learn`…), les types (`single`/`multiple`/`text`/
  `ordering`/`matching`), `mode: "exam"` — ce sont des **données persistées** dans les
  notes ; les traduire casserait tous les quiz du vault. Ni les `id:` de commandes
  (les hotkeys de l'utilisateur y sont attachées), ni les logs, ni les classes CSS.
- **Langue des quiz générés ≠ langue de l'UI** : le prompt système impose au modèle de
  répondre dans la langue de la DEMANDE de l'utilisateur.

## Commandes

Le DÉTAIL — le défaut réel que chaque contrôle empêche — vit dans
`docs/superpowers/notes/controles.md`. Le lire avant d'en contourner un.

- `npm run check` — typecheck. Toujours après une modif TS.
- `npm run check:host` — **le cliquet de la frontière d'hôte**, SIX assertions :
  aucun fichier de `src/` n'importe `obsidian` (garde-fou pour le futur hôte Android
  et contre un retour du greffon) hors de la liste `RESTANTS`, laquelle
  ne peut que RÉTRÉCIR ; rien sous `apps/windows/` ; aucun fichier déjà libéré
  n'emploie les **extensions DOM** d'Obsidian (`createEl`, `empty`, `setText`…),
  qu'aucun `import` ne trahit — passer par `ajouter` de `src/dom.ts` ; **aucun
  fichier de `src/` n'importe depuis `apps/`** (le code partagé ne connaît pas ses
  hôtes), sauf les fichiers nommés dans `EXCEPTIONS_APPS` ; la liste est un CLIQUET
  comme `RESTANTS` : une entrée qui n'importe plus rien d'`apps/` (ou de
  `RESTANTS` qui n'importe plus Obsidian) fait échouer le contrôle au lieu de
  couvrir la violation suivante ; et **le rendu de l'app (`apps/windows/src/`) n'importe
  jamais un module qui tire Node** — `node:*`, `chokidar`, `electron`, ni un
  module de `apps/windows/electron/` hors de `SANS_NODE` (`catalogue`,
  `ressources`, `pont`, eux-mêmes vérifiés purs). Vite EXTERNALISE `node:fs` avec un
  simple avertissement et `check:app` reste vert : sans cette assertion, un
  `import { readFile } from "node:fs"` dans le rendu ne rougissait nulle part, et
  `perimetre.ts` importé du rendu recréait côté Chromium l'accès disque total que
  le pont existe pour retirer. `RESTANTS` et `EXCEPTIONS_APPS` sont VIDES depuis
  le 2026-09-13 : plus aucun fichier de `src/` n'importe Obsidian ni `apps/` (le
  greffon, qui en était le dernier consommateur, a été supprimé le 2026-10-01) —
  les deux listes restent en place, vides, comme cliquets, pas comme couverture
  d'un reste.
  Dans la CI : lancé à la main, ce serait la discipline et non le contrôle qui
  tiendrait la frontière.
- `npm run check:dashboard-dom` — **le cliquet ne suffit pas seul** : `check:host`
  ne protège un fichier de ses extensions DOM que TANT QU'il reste hors de
  `RESTANTS`. Rien n'empêche qu'une tranche future y remette
  `import { setIcon } from "obsidian"` « pour aller vite » et le fasse RENTRER
  dans `RESTANTS` — ses extensions DOM redeviendraient alors invisibles, sans
  qu'aucun contrôle ne le dise. Ce script nomme, en dehors de `RESTANTS`, les
  pages du tableau de bord portées en tranche 2.5 : sa liste ne peut que
  GRANDIR, jamais rétrécir.
- `npm run check:view-enter` — l'entrée d'une vue se TERMINE (`src/dashboard/
  view-enter.ts`) : `markViewEnter` ignore les animations INFINIES en
  attendant la fin de l'entrée, et aucune animation posée sous `.qbd-*-enter`
  n'est en `both` ni `forwards`. Une animation d'entrée finie qui garde la
  main sur `transform` rend les transitions de survol muettes : la carte SAUTE
  de 0 à -3 px en une image. Le chemin qui défile en boucle l'a provoqué
  (2026-09-17) en empêchant la classe d'entrée de tomber ; ça ne se voit qu'à
  la souris, jamais dans un typecheck. Tient aussi, depuis l'audit téléphone du
  2026-10-07 : `markViewEnter` ne relève pas `getAnimations({ subtree })` à
  CHAQUE `animationend` (un relevé vide le style du sous-arbre : 20 cartes
  décalées = 20 tâches de 50 à 100 ms PENDANT l'entrée), et chaque règle
  d'entrée `.qbd-quizzes-enter` / `.qbd-qz-enter` a son pendant neutralisé sous
  `.is-mobile` dans `mobile.css` (sinon la page est vide à sa première image :
  les blocs démarrent à opacité 0 et la page quittée a disparu). Dans la CI.
- `npm run check:theme` — le thème de l'app définit toutes les variables CSS
  qu'Obsidian fournissait. Une oubliée ne produit AUCUNE erreur : un texte
  invisible sur un fond de la même couleur. Symétrique et dans la CI.
- `npm run check:windows-host` — l'implémentation du contrat `src/host/types.ts`
  côté application. `rename` apprend au miroir ce que le déplacement apporte (fichier ou dossier) AVANT de rendre la main : un import en staging écrit dans un `.import-<id>` caché puis renomme, et le rescan immédiat du catalogue doit déjà voir ces notes (cas du bug « notes importées absentes jusqu'au redémarrage »). Tout cas neuf s'éprouve par DISCRIMINANCE : casser
  la règle, voir rougir, restaurer. Un cas vert quoi qu'on fasse ne prouve rien.
- `npm run check:app` — typecheck + build de l'app, RENDU ET PROCESSUS PRINCIPAL
  Electron (deux `tsconfig` séparés, deux sorties : `dist/` et `dist-electron/`).
  Il attrape une rupture du code PARTAGÉ vue depuis l'hôte, là où
  `npm run check` ne voit que `src/` — et depuis la tranche Electron, c'est
  le SEUL contrôle qui type `apps/windows/electron/` (`tsconfig.electron.json`).
  Aucun fichier qu'il atteint ne doit tirer `obsidian.d.ts` : un `import type`
  suffisait à neutraliser ce filet.
- `npm run check:electron-fs` — les primitives de fichiers du processus principal
  Electron (`apps/windows/electron/fichiers.ts`), sur un vrai dossier temporaire.
  Empêche entre autres qu'un `append` non atomique perde un ajout concurrent au
  journal de révision, ou qu'un `trash` supprime au lieu de déplacer.
- `npm run check:electron-index` — le surveillant chokidar débouncé et l'index du
  processus principal (`apps/windows/electron/index-fichiers.ts`). Empêche qu'un
  renommage rapide, hors des événements que chokidar sait nommer lui-même, fasse
  perdre l'historique d'une note.
- `npm run check:electron-reglages` — les réglages, les vaults Obsidian déclarés et
  le PÉRIMÈTRE de sécurité du pont Electron (`reglages.ts`, `vaults.ts`,
  `perimetre.ts`, plus les prédicats purs de `ressources.ts`). Le périmètre est la
  règle la plus importante du pont : sans lui, chaque canal `fichiers.*` est un
  accès disque total depuis la fenêtre. Et il ne borne que l'écriture et la
  lecture, pas l'EXÉCUTION : `systeme.ouvrir` refuse en plus les extensions
  exécutables (`EXTENSIONS_EXECUTABLES`, lues comme Windows les lit : `x.bat.`,
  `x.bat ` et `x.bat::$DATA` ouvrent `x.bat`), sans quoi `write` puis `ouvrir` d'un
  `.bat` — deux appels bornés — le contournaient. La clé `ai` des réglages est
  GARDÉE de la même façon (`garde-ia.ts`) : l'hôte d'`aiOllamaUrl` entre dans la
  liste du réseau, et `cheminClaude`/`cheminCodex` désignent un exécutable que le
  principal LANCERA — absolu, existant, extension lançable (un `.js` qui existe
  pour de bon est refusé : ce serait « écris-le puis lance-le »). L'ancien
  réglage `aiExamDurationMinutes` (la durée d'un Examen générable, retiré le
  2026-09-29) n'est plus gardé : une valeur restée dans un fichier de
  réglages est acceptée et ignorée, et n'affaiblit aucune autre règle de la clé.
- `npm run check:electron-process` — les fichiers de cache des CLI ET le
  LANCEMENT d'un CLI (`apps/windows/electron/process.ts`), sur de vrais process.
  C'est la capacité la plus dangereuse du pont : la liste blanche de NOMS
  (jamais un chemin venu du rendu), l'ordre réglage-puis-`PATH`, la citation des
  arguments sur le repli `cmd.exe`, l'ARBRE tué à l'annulation (un `kill` sur le
  seul parent laisse la génération tourner après le clic sur Stop), et le verrou
  par outil relâché sur TOUTES les issues.
- `npm run check:electron-langages` — l'installeur du PACK C/C++
  (`apps/windows/electron/langages.ts`), sur un transport injecté, jamais le
  réseau. Un pack qui ne colle pas à son empreinte (un pack VALIDE mais autre
  — gzip rejette déjà seul un octet changé ou un corps tronqué, seul le pin
  arrête celui-là —, un octet changé, un téléchargement coupé) n'est jamais
  installé et ne laisse RIEN sur le disque ; un corps plus long que le pin est
  coupé ; une redirection hors de la liste d'hôtes, ou en `http:`, n'est jamais
  suivie ; une entrée d'archive `../x`, `C:x`, `/x`,
  `a\..\x` est refusée même dans un pack à la bonne empreinte. Si
  `dist-pack/` contient le pack construit (`npm run build:language-pack`), sa
  taille et son SHA-256 doivent être EXACTEMENT ceux de `PACK_C`, écrits à la
  main dans le code : c'est l'application, pas le réseau, qui décide à quoi
  elle fait confiance. Dans la CI.
- `npm run check:package` — la configuration RÉSOLUE d'electron-builder (version
  = manifeste, `appId` et `executableName` immuables, `files` sans
  `node_modules` ni sourcemaps, `deleteAppDataOnUninstall` faux) et, si un
  `win-unpacked/` existe, le contenu de l'asar. `appId` est la clé par laquelle
  NSIS retrouve l'installation à remplacer ; `executableName` dérivé de
  `@neo-quiz/windows` a fait échouer chaque run CI Linux jusqu'au 2026-09-12.
  Il compare aussi le sha512 (calculé sur le fichier) et la taille de l'exe
  nommé par `latest.yml` aux valeurs qu'il y porte : c'est ce qui rougit
  quand l'exe signé n'a pas repassé par `scripts/update-info-after-signing.mjs`.
- `npm run check:partage` — le PARTAGE et sa sécurité. Côté principal
  (`apps/windows/electron/partage.ts`), la fenêtre ne donne qu'un nom et des
  octets : un nom qui serait un CHEMIN, une extension hors de `.zip`/`.md`, un
  contenu vide ou au-delà de 16 Mo sont refusés ; le script du panneau de
  partage natif de Windows (`scriptPartageNatif`, seul script du partage
  depuis le 2026-10-03, l'envoi vers Discord a été retiré) est CONSTANT :
  titre, texte, fichier et point de centrage sont lus dans l'environnement,
  jamais insérés ; un verrou
  limite à un partage à la fois, deux secondes au moins entre deux, et les
  fichiers temporaires de plus de dix minutes sont effacés. À l'autre bout,
  l'import d'une archive REÇUE (`nomNoteImportee`, `zip.ts`) n'écrit que des
  `.md` au nom aplati. Et `citerPs` (`process.ts`) double les CINQ apostrophes
  que PowerShell reconnaît (`'` et ‘ ’ ‚ ‛) : n'en doubler qu'une laissait
  « l’an » fermer la chaîne et faire exécuter la suite — rejoué sur le vrai
  `powershell.exe` sous Windows. Depuis le 2026-10-07 il tient aussi le MANIFESTE du format 1 (`src/dashboard/share-manifest.ts`) et l'écrivain `packShareV1` (`share-pack.ts`) : `neo-quiz.json` est la PREMIÈRE entrée, taille et SHA-256 de ce qui est réellement entré, réglages du dossier réduits à une liste blanche (couleur `#rrggbb`, icône de la liste, nom et UE bornés), un manifeste d'un format PLUS RÉCENT lu comme `newer` quoi qu'il contienne (jamais un refus), un illisible comme `invalid`, le budget de 16 Mo manifeste compris, octets identiques à entrée identique. Enfin `gabarits-cli.ts` : `process.run` n'accepte
  que les FORMES d'appel connues de `ai-client.ts` (modèle, effort et jetons
  seuls variables) ; `--dangerously-skip-permissions`, `--mcp-config` ou un
  bac à sable ouvert sont refusés. **Ajouter une option à un appel de CLI du
  rendu exige de l'ajouter à ce gabarit.** Les RÈGLES DE NOMS sont dans un seul module, `src/dashboard/share-names.ts`, que l'export ET l'import appellent : NFC, caractères interdits, nom réservé Windows jugé sur la partie AVANT LE PREMIER POINT (`con.txt.md` comme `CON.md`), nom coupé à 100 caractères, chemin cible borné à 240 (refusé AVANT toute écriture, en nommant le fichier), collisions insensibles à la casse (« X (2).md ») ; ce que l'export produit, l'import l'accepte. Le LECTEUR de zip (`src/dashboard/zip.ts`) est éprouvé sur des archives forgées (`scripts/lib/zip-forge.mjs`, déterministe) : noms CP437 sans drapeau UTF-8 et champ Unicode Path, zip64 lu (ou son PROPRE code d'erreur, jamais « abîmée »), entrées qui se chevauchent (archive refusée), noms local/central différents, lien symbolique, ratio de compression, et SURTOUT **aucune entrée écartée sans nom ni raison** : `readZip` rend `skipped`, `classerArchive` rend `ignored`, et l'appelant (`folder-create.ts`) les affiche ; seuls les déchets d'outil (`__MACOSX/`, `._x`, `.DS_Store`, `Thumbs.db`, `desktop.ini`) sont comptés à part (`junk`), jamais importés en note. Dans la CI.
- `npm run check:share-lock` — le VERROU du panneau de partage Windows (`electron/partage.ts`), sur une horloge et un processus enfant simulés (aucun panneau ouvert). Défaut empêché : « A share is already in progress » affiché sans panneau (1.20.42). Cause établie : `DataTransferManager` n'a PAS d'évènement d'annulation (`DataRequested`, `TargetApplicationChosen`, `ShareProvidersRequested` seulement) ; le script attendait un `add_ShareCanceled` qui lève, avalé par un `catch` vide, et le verrou ne tombait qu'à la sortie de PowerShell (jusqu'à 5 puis 6 minutes). Le contrôle fige : le verrou est relâché UNE fois sur chaque issue (erreur de lancement, sortie précoce, sortie non nulle, signal `ERROR`, `SHOWN` puis sortie, délai de 30 s sans `SHOWN`, borne dure de 90 s), la réponse au rendu n'est vraie qu'après `SHOWN`, plus d'espacement de 2 s, le verrou de l'ID de synchronisation est distinct (le partage de l'ID prenait le verrou des fichiers et rendait l'autre : corrigé), et le script reste constant. Le CONTRÔLEUR du partage de fichier (`creerPartageFichier`) est éprouvé avec de faux processus : un double clic AVANT `SHOWN` rejoint l'appel en cours (un seul processus, aucune erreur), un clic APRÈS `SHOWN` (panneau peut-être fermé sans choisir d'appli, aucun signal ne le dit) tue l'ancien arbre de processus (`kill` puis `taskkill /T /F`) et en lance un nouveau, jamais « déjà en cours » ; seul un verrou tenu par autre chose répond occupé. Dans la CI.
- `npm run check:share-roundtrip` — le PARTAGE DE BOUT EN BOUT, sur un vrai dossier temporaire (`base/vault`, `base/canary`, `base/outside`). Défaut empêché : un export que l'import ne relit pas, un import qui écarte sans le dire, une archive hostile qui écrit hors de son dossier, et tout cela qui dérive d'une version à l'autre. Il exporte un dossier réaliste (accents, emoji, CRLF, nom NFD, images, sous-dossier, deux quiz homonymes) par le VRAI `construire` (`apps/windows/src/ui/partage.ts`), le réimporte par le VRAI `importArchiveAsFolder` / `importFileIntoFolder` (`folder-create.ts`) et compare octet pour octet : dossier entier, sélection de trois, quiz seul, quiz avec image. Il importe chaque archive DORÉE de `scripts/fixtures/share/golden/` (export actuel de l'app, ancien format sans date, « Dossier compressé » Windows, Finder macOS avec `__MACOSX`, 7-Zip, dossier racine à sous-dossiers, accents NFD, CP437 sans drapeau UTF-8, champ Unicode Path, zip64) : ce sont des IMITATIONS déterministes de ces outils (`generate.mjs` + `scripts/lib/zip-forge.mjs`), pas des captures. Chaque archive HOSTILE de `hostile/` (zip slip `../`, `..\`, chemin absolu, `C:`, UNC, lien symbolique, bombes de ratio / de taille / de nombre d'entrées, CRC faux, tronquée, noms réservés, SVG à script, exécutables, entrées qui se chevauchent, archive découpée) est refusée ou lue vide, et un instantané de TOUT l'arbre prouve que RIEN n'a été écrit, nulle part, avec un message pour l'utilisateur ; un chemin cible de plus de 240 caractères est refusé avant la première écriture. Un fuzz à graine fixe retourne des octets des archives dorées : seule l'erreur typée sort, rien n'est écrit hors du dossier cible. Depuis le 2026-10-07 l'import est un PLAN pur (`share-plan.ts`, `planImport`) appliqué en STAGING (`share-import.ts`, `applyPlan`) : tout s'écrit dans `<parent>/.import-<id>` (dossier caché, même volume), puis UN renommage (dossier neuf) ou un déplacement fichier par fichier (dossier existant, jamais d'écrasement, `rename` rejette une destination existante) ; en cas d'échec les fichiers déjà déplacés sont retirés, les dossiers créés et le staging vidé sont mis de côté dans la corbeille de l'hôte (aucune suppression de dossier au contrat). Le contrôle injecte une panne à CHAQUE écriture et à chaque renommage (dossier neuf et dossier existant) et exige un arbre identique à l'avant. Règles figées : sous-dossiers conservés (`img/photo.jpg` reste cité), extension d'image gardée telle quelle (`figure.PNG`), octets des notes intacts (BOM, CRLF), un quiz identique (même SHA-256) n'est pas dupliqué, un quiz différent du même nom devient `Nom (2)` (et la réimportation de cette version le retrouve, pas de `(3)`), une image de même nom et d'octets différents n'est PAS importée (celle de l'utilisateur reste), le résumé dit ajouté / identique ignoré / renommé / écarté avec la raison ; les réglages du manifeste ne s'appliquent qu'à un dossier NEUF et jamais par-dessus ceux déjà stockés sous ce nom. Un manifeste falsifié (SHA-256 faux) refuse CE fichier avec un message, un format futur est importé au mieux avec l'invite de mettre l'app à jour. L'export (`construire`) écrit des chemins relatifs au dossier, emporte les images citées dans le CORPS de la note, et se vérifie lui-même par le planificateur avant de partir. Depuis le 2026-10-07 un quiz seul ou une SÉLECTION de quiz (`{ quizzes, name }`, kind `quizzes`) part avec sa NOTE ENTIÈRE, lue en octets (BOM, CRLF, texte avant et après le bloc), et non plus avec son seul bloc : un quiz sans image reste un `.md` nu, la note elle-même ; le golden `v1-quiz-whole-note.zip` fige cette forme. Les goldens `v1-*` et `v0-bom-subfolders-case` s'ajoutent aux anciens ; pour les anciens (`7zip-deflate`, `root-folder-subfolders`) l'ARCHIVE n'a pas changé, seul `expected.json` a été mis à jour (sous-dossiers et extension désormais conservés). La **liste des archives dorées ne peut que grandir** : le contrôle épingle le SHA-256 de chaque fichier (tableaux `PINNED_*` du script), refuse un fichier modifié, manquant ou non listé, et vérifie que le générateur le reproduit à l'octet (comparaison sautée si la version de zlib diffère de celle de `expected.json`, la sortie deflate en dépendant). Ne jamais éditer ni retirer une archive : en ajouter une au générateur ET au tableau. Dans la CI.
- `npm run check:test-setup` — le noyau PUR des réglages de la fenêtre « Prépare
  ton test » (`src/test-setup.ts`, spec 2026-09-29-test-setup-modal). Le mode
  examen se DÉDUIT : actif exactement quand les indices sont coupés ET une
  limite posée (rallumer les indices, ou retirer la limite, l'éteint ; le
  rallumer coupe les indices et pose un chrono) ; une durée bornée à [1, 300]
  ou la règle de secours ; une valeur mémorisée dans les réglages (`readTestSetup`)
  abîmée retombe sur `null`, jamais devinée ; et QUAND la note est écrite par
  « Garder le mode examen » (`keepExamChange` : jamais pour un test joué sans
  mode examen, seulement si le réglage change). Le câblage de l'écriture est
  tenu par `check:quiz-io` (section 14). Dans la CI.
- `npm run check:session` — la PHOTO DE SESSION d'un quiz (`src/engine/session.ts`),
  pour reprendre là où on s'était arrêté : aller-retour de chaque type de
  question, quiz modifié entre deux sessions (question supprimée, ajoutée,
  options ajoutées — mélange et sélection rejetés), photo corrompue → le quiz
  s'ouvre de zéro. Rangée par IDENTIFIANT de question, jamais par index. Et CE
  QUI est photographié (`canSnapshot`) : un Entraînement, avec ses réponses et
  l'usage de ses indices ; un Test CHRONOMÉTRÉ aussi, avec ses réglages et les
  millisecondes restantes (une reprise repart du temps qu'il restait, sans
  rouvrir la fenêtre « Prépare ton test », et une photo antérieure aux
  réglages ou abîmée redonne un test avec indices et sans limite) ; JAMAIS un
  test rendu. Seul un Examen ANCIEN, joué sans réglages d'hôte, reste sans
  photo. Dans la CI.
- `npm run check:learn-loop` — la BOUCLE DE REPRISE d'un Learn
  (`src/engine/learn-loop.ts`, noyau pur ; câblage `src/engine/learn.ts`) :
  une question ratée ne revient jamais aussitôt (deux autres vérifications,
  ou la fin de son étape), trois reprises au plus, un verdict par essai, et
  « juste après une reprise » n'est jamais compté juste du premier coup. Le
  câblage (journal au PREMIER essai seulement, score) est éprouvé par
  `check:engine-review`, la photo par `check:session`. Dans la CI.
- `npm run check:stats` — l'HISTORIQUE DES TENTATIVES du magasin de stats
  (`src/dashboard/stats-store.ts`) : meilleur score et nombre de tentatives
  DÉRIVÉS de la liste (supprimer la meilleure le fait redescendre), un score
  d'avant l'historique lu comme une tentative « ancienne » supprimable,
  annulation symétrique, plafond qui garde la meilleure. Dans la CI.
- `npm run check:gestes` — les GESTES d'édition d'une question (`src/editor/gestes.ts`),
  partagés par le formulaire et l'édition dans le rendu : jamais une question sans
  bonne réponse, jamais deux emplacements d'un classement sur le même élément,
  indices décalés à l'ajout et au retrait, et un changement de TYPE qui ne
  garde que ce qui se transpose (choix ⇄ choix, saisie ⇄ saisie) sans jamais
  toucher aux champs communs. Dans la CI.
- `npm run check:termes` — TROIS parties, sur le glossaire d'un quiz. Le
  NOYAU PUR de l'appariement d'un terme dans un texte (`src/glossaire.ts`) :
  jamais un terme apparié dans un mot plus long qui le contient (« empiler »
  n'est pas « pile »), jamais au travers d'un accent (« pilé » ≠ « pile ») ni
  d'une marque combinante (texte NFD), jamais au travers d'une formule LaTeX,
  jamais deux fois pour la même entrée — et la plus longue gagne sur un
  chevauchement (« pile d'appel » avant « pile »). Pluriel français/anglais
  toléré, RÉGULIER et IRRÉGULIER (« signal » → « signaux », « query » →
  « queries ») ; une espace d'un terme à plusieurs mots apparie aussi une
  espace insécable ou un saut de ligne ; une forme d'un ou deux caractères
  n'apparie jamais l'apostrophe d'une élision (« C'est »). Un `term`/alias
  entouré de backticks (écriture d'un modèle) perd ses backticks à la
  lecture. Reconnaît aussi qu'un objet sans énoncé porteur d'un `glossary`
  est la configuration du bloc, comme `source` (`isQuizModeConfig`,
  `extractExamOptions`). La passe DOM (`poserTermesDans`, `src/engine/
  termes.ts`) : les zones sont une liste BLANCHE, jamais l'énoncé/les
  options/un classement ou appariement/le recto d'une carte mémoire ; une
  exclusion (lien, code, titre, texte d'interface) est BORNÉE à sa zone, un
  ancêtre du quiz LUI-MÊME (dans la note) ne doit jamais en faire sauter une
  entière ; un `<code>` INLINE dont le texte est EXACTEMENT une forme
  s'enveloppe en entier, le code intact dedans (sinon un identifiant comme
  `yield`, toujours généré entre backticks, ne serait jamais soulignable) ;
  idempotente ; et, tant qu'une carte n'est pas CORRIGÉE (verrou global du
  quiz, ou carte mémoire retournée), ses zones à risque (indice, support,
  lecture courte, cours) ne soulignent jamais un terme qui apparaît dans le
  contenu protégé de la MÊME carte — ce serait donner la réponse avant
  l'heure. La BULLE de définition (`src/engine/termes-bulle.ts`) : un clic ou
  un tap l'OUVRE (pas la logique inverse qu'un `focus` provoqué par le
  pointeur produirait naïvement), un second clic explicite la referme, un
  clic sur une bulle ouverte par survol/focus la laisse ouverte ; Échap la
  ferme, y compris ouverte au survol ; le défilement la REPOSITIONNE tant que
  l'ancre reste visible, ne ferme que si elle en sort ; `destroy()` retire
  bien l'élément du DOM. Dans la CI.
- `npm run check:transcript` — le TRANSCRIPT EN DIRECT d'une génération
  (`src/dashboard/transcript.ts`, 2026-09-29, d'après MonoCode) : une ligne
  de Claude Code (`stream-json`) ou de Codex (`exec --json`) coupée par le
  tuyau n'est lue qu'une fois, une ligne non JSON ne casse rien, un flux sans
  fin est borné, et le `result` final d'un flux Claude est toujours trouvé
  (sans lui, toute génération Claude échouerait). Dans la CI.
- `npm run check:explain` — le prompt du bouton « Expliquer » d'une question
  (`src/explain-prompt.ts`, 2026-09-29) : les choix partent avec les lettres
  AFFICHÉES (options mélangées), la bonne réponse de chaque type (choix,
  classement, association, trous, saisie), jamais un champ `{…}` brut, et une
  ligne dont tous les champs sont vides part avec son intitulé. Dans la CI.
- `npm run check:cli-resume` — une génération SURVIT au rechargement de sa
  page (2026-09-30, `apps/windows/electron/resumable-runs.ts`) : un CLI lancé
  avec une clé de reprise (`HostProcess.run`, `reprise`) est DÉTACHÉ, pas tué,
  quand la page navigue ou plante ; la page rechargée (même `WebContents`)
  s'y RATTACHE sous la même clé — sortie rejouée, puis résultat — et jamais
  une autre fenêtre ; personne ne le réclame en une minute : il est arrêté ;
  une fenêtre détruite arrête les siens aussitôt. La file elle-même est
  gardée dans IndexedDB, limitée à la session de la fenêtre
  (`dashboard/generation-queue-store.ts`), et restaurée par
  `restaurer` (`check:file-generation`). Dans la CI.
- `npm run check:updater` — le noyau pur de la mise à jour automatique
  (`apps/windows/electron/mise-a-jour-etat.ts`) : une erreur après « prête »
  ne retire pas le paquet téléchargé, couper le réglage oublie une
  vérification en cours mais garde « prête ». Sur une connexion LIMITÉE
  (2026-10-07, sonde `connexion-limitee.ts`, `autoDownload` à faux), une
  version trouvée reste « disponible » sans un octet téléchargé, jusqu'au
  clic. Le câblage electron-updater
  (`mise-a-jour.ts`) ne s'éprouve qu'installé, sur deux releases.
- `npm run check:fenetre-maj` — le REFLET de l'installation qui porte la
  fenêtre « Updating Neo Quiz » (`apps/windows/electron/fenetre-maj-liens.ts`,
  sur de vrais dossiers temporaires) : un reflet à moitié fait est abandonné
  (un arbre Electron incomplet meurt ou affiche une erreur par-dessus la mise
  à jour) ; l'exécutable du reflet change de NOM (NSIS tue par nom de
  fichier : sinon la fenêtre meurt au moment où elle sert) ; le nettoyage ne
  vise que les reflets, et les vise tous. **Ne jamais lancer une vraie mise à
  jour sur le PC de dev pour l'éprouver** : elle désinstalle l'application.
- `npm run check:menu-app` — l'arbre pur du menu d'application (identifiants
  uniques, paliers d'échelle bornés comme le principal, coche sur le zoom
  courant).
- `npm run check:reprise` — le noyau pur de « rouvrir là où on s'était arrêté »
  (`apps/windows/src/ui/reprise.ts`, `lireDerniereVue`) : une valeur brute
  antérieure ou trafiquée (vue inconnue, quiz manquant sur `detail`, question
  négative ou non entière) retombe sur `null` plutôt que de faire planter le
  démarrage.
- `npm run check:fond` — le noyau pur du fond d'écran
  (`apps/windows/src/ui/fond-pur.ts`) : quelles extensions comptent comme une
  image de fond, et l'ordre trié cyclique de « l'image suivante » — avec son
  repli sur la première quand la courante a disparu du disque.
- `npm run check:math-render` — la segmentation LaTeX partagée (`$$…$$` avant `$…$`).
- `npm run check:ai-providers` — les FOURNISSEURS IA : le catalogue cloud vient
  de `net.fetchJson` (jamais codé en dur), un `/api/tags` qui répond 200 SANS
  JSON (portail captif, proxy) vaut hors ligne et non « Ollama joignable, 0
  modèle », et `refreshCliCaches` remplit bien l'instantané que les deux
  lecteurs SYNCHRONES (`getCodexModels`, `isFableOffered`) lisent — sans quoi le
  menu resterait à jamais sur son repli embarqué, sans une erreur.
- `npm run check:md`, `check:export` — rendu markdown des champs texte, écriture
  d'un bloc. Ils chargent le CODE RÉEL, jamais une réplique. **Pas de framework de
  test au-delà** ; ne pas en ajouter pour du code qu'une lecture suffit à juger.
- `npm run check:scheduler` — le noyau de l'ordonnanceur, dont la pureté est
  vérifiée MÉCANIQUEMENT. Le casser, c'est perdre la seule partie du code qu'on ne
  réécrira pas.
- `npm run check:review-store`, `check:engine-review`, `check:module-edit` — les
  trois câblages de l'ordonnanceur. `check:engine-review` tient aussi le
  TEST (Entraînement · Examen, spec 2026-09-29) : rien au journal avant de
  rendre, un verdict par question au moment de rendre (juste avec indice,
  faux ou sans réponse = raté), « 12/15, dont 2 avec indice » compté sans
  pénalité, « Recommencer » = une nouvelle tentative ; le LANCEMENT d'un Test
  (`engine/test-launch.ts`, noyau sans DOM) : l'hôte n'est interrogé que pour
  un Test (ni un Learn, ni le greffon), une fenêtre annulée ne lance rien, une
  photo reprise saute la fenêtre, et les réglages choisis arrivent sur le
  contexte du moteur (indices, durée, chrono déjà lancé, jamais d'écran de
  départ) ; « Recommencer » applique les réglages choisis et l'essai porte
  `exam` quand les indices sont coupés ET une limite posée ; le rendu depuis la
  dernière question (`engine/hand-in.ts` : jamais l'écran de soumission,
  la modale des questions sans réponse), l'ampoule sur la perle d'une
  question aidée, les indices qui suivent le RÉGLAGE et non l'horloge, et le
  chrono d'un test limité (h:mm:ss dès une heure, rendu à zéro qui referme la
  modale). `check:module-edit` tient aussi le REGROUPEMENT
  d'un cours (`course-pairs.ts`) : au plus un quiz par mode, Learn,
  Entraînement puis Examen sur une carte. Les deux dans la CI.
- `npm run check:quiz-io` — **le CÂBLAGE de l'écriture d'un bloc**, le seul
  chemin par lequel la page réécrit une note. Entre `check:export` (la FORME du
  bloc produit) et `audit-vaults.mjs` (l'aller-retour sur de vrais vaults), il n'y
  avait RIEN : ni le compare-and-swap sur le bloc, ni la préservation des fins de
  ligne, ni celle des clôtures, ni le remplacement par FONCTION qui protège un
  quiz contenant `$1$`. Les quatre sont des correctifs de bugs réels, et deux
  avaient régressé la nuit même où ils furent écrits. Depuis le 2026-09-29, il
  tient aussi l'EXAMEN (un Examen relu puis réécrit en `mode: 'exam'` +
  `examDurationMinutes`, jamais une clé retirée — `examMode`, `examAutoSubmit`,
  `examShowTimer`, `learnMode` — réécrite) et « GARDER LE MODE EXAMEN » de la
  fenêtre « Prépare ton test » (`saveKeepExam`, `dashboard/exam-keep.ts`) :
  une ÉDITION DE TEXTE des deux seules clés, octet pour octet, qui préserve
  commentaires, clé inconnue, fins de ligne CRLF, clôtures et attributs, ne
  touche jamais un énoncé piégé (`$1$`), et refuse (sans rien écrire) un bloc
  changé depuis l'ouverture, un Learn ou un bloc illisible ; décocher rend la
  note d'origine. L'ancien changement de mode de l'éditeur n'existe plus.
- `npm run check:review-log` — l'emplacement et la migration du journal de révision.
- `npm run check:historique-nav` — les boutons précédent/suivant de la souris
  (`historique-nav.ts`) : « précédent » ramène à la page quittée, une nouvelle
  navigation efface le « suivant », pas de doublon, pile bornée. La garde de
  sortie d'un Examen (`leave-guard.ts`) est supprimée depuis le 2026-09-29 :
  un test chronométré se quitte librement et se reprend (`check:session`).
- `npm run check:quiz-format` — le FORMAT Learn / Test (`src/quiz-format.ts`,
  `extractExamOptions`) : les modes `learn`, `exam` et l'Entraînement sans
  mode, le suffixe « — Exam » (et le compteur « (2) » de `freeNotePath`), la
  durée bornée à [1, 300] et sa règle de secours (1 min 30 par question,
  arrondie à 5), les clés retirées plus lues, et le vocabulaire de génération
  (`CHAMPS_DECRITS` ne connaît que Learn et Test, sans les clés de l'Examen).
  On ne GÉNÈRE plus d'Examen : un Test le devient à son lancement ou par
  « Garder le mode examen ».
- `npm run check:prompt` — les prompts de génération, pour les DEUX types
  générés (Learn et Test), avec leurs mots interdits PAR type : aucun prompt
  n'écrit `mode: "exam"` ni `examDurationMinutes`, quelles que soient les
  options (une durée passée quand même n'arrive jamais au prompt, et celle
  d'une réponse Ollama n'est pas reportée dans la configuration) ; `learnMode`,
  `examAutoSubmit` et `examShowTimer` interdits partout ; l'indice est
  facultatif dans un Test.
- `npm run check:file-generation` — la demande de génération sur fichiers (vraie
  `generation-demande.ts`) : le choix « N quiz ↔ 1 quiz » (un quiz par document,
  ou un seul sur tous ; une image force un seul quiz), et le nom d'un quiz
  unique sur plusieurs documents, celui du module (`<module> — Practice`, un Test
  généré ne porte aucune configuration d'examen), dans un
  hôte en mémoire pour lire le vrai chemin et le vrai frontmatter.
- `npm run check:folders` — la conversion `folder` → `folders`, et l'unicité des
  identifiants de dossier.
- `npm run check:rename-match` — l'appariement d'un renommage entre deux hôtes,
  sur preuve et non sur ressemblance.
- `npm run check:scanner` — le catalogue. Une clé décalée perdrait l'historique de
  révision.
- `npm run check:markers` — le markdown non rendu dans les vrais vaults. Il éprouve
  la GRAMMAIRE, pas le CÂBLAGE : un champ affiché sans appeler le rendu du tout y
  passe pour sain. Le seul filet contre ça est de lire le DOM RENDU.
- `npm run report:multiblock` — ne vérifie rien, MESURE deux limites connues. Sort
  toujours en 0.
- `npm run report:installation -- <setup.exe> "<dossier>" [--vider]` — ne vérifie
  rien non plus : il MESURE, sur un vrai NSIS, la part du temps que prend chaque
  étape et le pourcentage que le noyau publierait. C'est lui qui a montré que
  NSIS n'écrit dans le dossier d'installation que 6 à 12 % de la durée (d'où le
  capteur de `progressionInstallation`), et que le désinstalleur DÉPLACE
  l'ancienne version dans le dossier temporaire avant de l'effacer. N'exige
  PLUS de console élevée depuis la bascule par utilisateur (2026-09-18,
  `nsis.perMachine` à faux) : le NSIS demandait `requireAdministrator` tant
  qu'il visait `Program Files`, et c'est cette élévation — celle du manifeste,
  pas une élévation de l'application — qui rendait l'UAC visible à chaque mise
  à jour.
- `node scripts/audit-vaults.mjs "<vault>" […]` — **avant une release**, ou après
  toute retouche de `convertParsedToInternal` / `exportAll`. Aller-retour lecture →
  écriture → lecture sur de vrais vaults : le bloc réécrit se relit, et aucun champ
  ne disparaît. Aucun fichier n'est modifié.
- Ces scripts appellent `process.exitCode`, **jamais `process.exit()`** : la pile
  doit se dérouler pour que `withSrcModule` retire son dossier temporaire.
- **Juger un script sur son CODE DE SORTIE, jamais sur la fin de sa sortie** : un
  groupe vert peut suivre trois groupes rouges. C'est ainsi qu'un défaut est passé.
- `npm run app:dev` / `app:build` — l'application Windows.
- **Release** : une commande `git ship` (alias posé une fois, cf.
  `scripts/ship.mjs`) :
  - `git ship "Message"` — l'application. Le niveau se lit dans
    `## [Unreleased]` de `CHANGELOG.md` : `### Breaking` → major, toute autre
    entrée → patch (règle du 2026-09-30 ci-dessous) ; vide → refus. Une
    mineure se tape en numéro explicite `X.Y.0`, sur demande d'Ahmed. La section est figée en `## [X.Y.Z] - date` dans
    le commit « Version X.Y.Z », et `release.yml` la publie comme notes de la
    release. Chaque tâche qui change quelque chose de visible écrit sa ligne
    sous `[Unreleased]` dans son propre commit.
  `release.yml` construit l'application (tag `desktop-vX.Y.Z`) et publie.

- **UNE LIVRAISON EST UN CORRECTIF PAR DÉFAUT** (règle d'Ahmed du 2026-09-30) :
  `git ship` publie x.y.Z+1 quel que soit le contenu de `[Unreleased]`
  (« Added » et « Changed » compris) ; une MINEURE ne se déduit plus, elle se
  TAPE (`git ship 1.21.0`) et seulement sur demande d'Ahmed ; « Breaking »
  reste une majeure. Cause : la 1.21.0 sortie pour « deux ou trois trucs » la
  nuit du 2026-09-29, supprimée le lendemain — la DERNIÈRE suppression.
- **UNE VERSION PUBLIÉE NE SE SUPPRIME PLUS** (règle posée le 2026-09-16, après
  en avoir supprimé dix dans la journée). Chaque suppression coûte : une
  installation existante ne voit JAMAIS un numéro plus petit comme une mise à
  jour — elle reste bloquée et il faut désinstaller/réinstaller à la main ; et
  supprimer la release « latest » fait promouvoir automatiquement la
  précédente par GitHub, alors que `releases/latest/download/latest.yml` est
  précisément ce que lisent le bootstrapper et l'auto-updater (quelques minutes
  pendant lesquelles l'installeur ne trouve plus rien). Ce qui n'est pas prêt
  ne se publie pas ; ce qui est publié reste, et se corrige par la version
  suivante.

- `npm run check:shared-state` — l'état partagé PAR APPAREIL dans le dossier
  synchronisé (`src/shared-state/merge.ts`, hôte Windows
  `apps/windows/src/host/shared-state.ts`) : fusion pure des examens et des
  tentatives, un fichier par racine et par appareil, migration unique, copies
  de conflit Syncthing, déplacements. Dans la CI.
- `npm run check:electron-syncthing` — le Syncthing embarqué
  (`apps/windows/electron/syncthing*.ts`) : seul le dossier `neo-quiz` est
  accepté, et seulement d'un appareil appairé par le propriétaire ; l'ID saisi
  est validé avant d'atteindre une config ; arguments de lancement sans rien
  d'autre que leurs paramètres ; clé sur chaque appel REST. Avec le binaire
  épinglé (`npm run fetch:syncthing`), il éprouve aussi le vrai.
- `npm run check:android-pont` — le pont Android vu de trois côtés, sans
  appareil : chaque canal envoyé par le shim (`apps/android/web/shim.ts`) a
  une entrée Kotlin (`Channels.ALL`) et réciproquement, chaque méthode de
  `Pont` existe dans le shim, et la liste Kotlin des extensions exécutables
  égale celle de Windows. Dans la CI.
- `npm run check:android-code-pack` — la copie Android de l'empreinte du pack
  C/C++ (`apps/android/web/pins.mjs`) égale `PACK_C`, et un pack ou une entrée
  d'archive fautive est refusé sans rien écrire.
- `npm run check:installer` change depuis le 2026-10-01 : il fige aussi que
  l'entrée du bootstrapper (`installer/main.ts`) est bien BUNDLÉE (un import
  perdu l'avait laissé bloqué sur l'écran de démarrage de desktop-v1.20.0 à
  1.20.15).
- `npm run check:moodle` — la synchronisation Moodle du processus principal
  (`apps/windows/electron/moodle/*.ts`, spec 2026-10-07-moodle-sync-design),
  sur de vrais serveurs http locaux : les cas du greffon d'origine, portés, plus
  les cas de sécurité. Chaque requête et chaque redirection va EXACTEMENT à
  l'origine du site configuré, en https ; un nom qui résout vers une adresse
  privée, loopback ou réservée est refusé à la connexion (rebinding compris). Le
  jeton ne sort jamais vers la fenêtre. Discriminance : la garde de redirection
  hors hôte et celle du passeport sont rejouées sur un MUTANT du vrai code et
  doivent alors échouer ; aucun fichier de l'app ne pose le commutateur
  `allowHttpForTests`. Dans la CI.
- `npm run check:selection` — la SÉLECTION de cartes de quiz sur la page d'un
  dossier (`src/dashboard/selection.ts`, noyau pur ; l'écran est
  `selection-view.ts`) : Ctrl/Cmd+clic ajoute ou retire, Maj+clic étend la
  plage depuis l'ancre (dans les deux sens, sans perdre ce qui était pris),
  Échap et « Annuler » vident, un quiz disparu du dossier sort de la sélection
  (`prune`, la même référence si rien n'a changé), le partage suit l'ordre de
  la PAGE et non l'ordre des clics, et « Partager » est mort tant que rien
  n'est coché. Un clic simple OUVRE toujours le quiz sur ordinateur ; sur
  téléphone, une fois la sélection commencée par un appui long (450 ms, doigt
  à moins de 10 px), un tap bascule. Échap et Ctrl+A ne valent que pendant une
  sélection. Dans la CI.
- `npm run check:swipe` — la décision de balayage (`src/swipe.ts`) : un balayage
  horizontal change de page comme les flèches, jamais un défilement vertical qui
  dérive sur le côté, ni depuis les zones de bord, un champ de saisie, un
  défileur horizontal ou une modale ; verrouillage d'axe, suivi du doigt (résistance
  en bout), vitesse de relâchement. Dans la CI.
- `npm run check:overscroll` — l'étirement en bout d'une zone qui défile (`apps/windows/src/ui/overscroll-stretch.ts`) :
  la courbe de traction (0 au repos, jamais au-delà de 18 %, la moitié atteinte à 35 % de la
  zone, croissante), les deux constantes figées, quelles boîtes défilent sur un axe
  (`auto`/`scroll` et contenu plus grand), la fin de défilement qu'une traction tente,
  et qu'une barre fixe ou une animation en cours n'est jamais étirée. Sans lui, une
  zone ne s'étire plus en bout et personne ne le voit sans téléphone. Dans la CI.
- `npm run check:generation-kind` — quel type (Learn ou Test) une demande de
  génération veut et ce qu'on lui demande d'abord (`src/dashboard/generation-kind.ts`) :
  le défaut est un Learn, seule une formulation explicite d'entraînement donne un
  Test ; une réponse cassée de l'appel de clarification (0 ou 3+ questions,
  moins de 2 ou plus de 4 options, texte autour du JSON) ne bloque jamais la
  génération ; les réponses ne se perdent pas ; le prompt de clarification ne
  porte que des NOMS de documents, jamais leur contenu. Dans la CI.
- `npm run check:folder-suggest` — l'ordre des dossiers de destination et leurs
  suggestions (`src/dashboard/folder-suggest.ts`) : plus récemment modifié
  d'abord, mot de la demande apparié à travers les accents, un nom de dossier
  devant un simple titre de fichier, mots vides sans suggestion, dossier déjà
  choisi non re-suggéré, ordre stable entre égaux. Dans la CI.
- `npm run check:chat-record` — le format des conversations de la page
  « Générer » (`src/dashboard/chat-record.ts`) : une valeur stockée corrompue ou
  hostile ne casse pas la page (requête, résultat ou document invalide écarté
  seul), un résultat jamais perdu ni doublé à la réécriture, l'ancienne archive
  texte importée par question, 200 conversations au plus sans jamais élaguer une
  pierre tombale (une conversation supprimée reviendrait). Dans la CI.
- `npm run check:code-packages` — le proxy de paquets Python du principal
  (`apps/windows/electron/paquets-python.ts`), sur un transport injecté : un
  fichier que le `pyodide-lock.json` du pack ne nomme pas ne déclenche AUCUNE
  requête ; des octets dont le SHA-256 diffère ne sont ni servis ni mis en cache
  (rien dans `paquets/`, pas même un `.part`) ; corps de plus de 50 Mo, redirection
  vers `http:` ou un hôte hors liste, roue PyPI différente du condensé annoncé ou non
  pure (`manylinux`) refusés ; budget de 500 Mo respecté. Dans la CI.
- `npm run check:code-run` — le bouton « Exécuter » d'un bloc de code
  (`src/engine/code-run.ts`) : la sortie d'un programme (stdout ou erreur) est
  du texte dont l'auteur peut être un quiz PARTAGÉ hostile ; un faux `HostCode`
  rend une charge HTML et aucun ÉLÉMENT ne doit apparaître sous
  `.quiz-code-output`, seulement du texte posé par `textContent`. Dans la CI.
- `npm run check:ci-coverage` — échoue si un script `check:*` de `package.json`
  n'a pas sa ligne `run: npm run <script>` dans `.github/workflows/ci.yml` : un
  contrôle rouge ne passe plus inaperçu (`check:folders` est resté rouge trois
  jours hors CI). Seules exceptions écrites avec leur raison dans le script :
  `check:watch` (ne termine jamais) et `check:app` (build déjà fait par les
  étapes `pack:*`). Un nouveau `check:*` exige donc sa ligne dans `ci.yml`.

Vérification d'un changement = `npm run check`, plus `check:md` / `check:export` /
`check:markers` si le rendu ou l'écriture sont touchés, **`check:quiz-io` dès que
`dashboard/detail-io.ts` bouge** (c'est le seul chemin qui réécrit une note),
`check:app` si le code partagé bouge, **puis** test manuel dans l'application (`npm run app:dev`).

## Application Android (`apps/android/`)

Spec : `docs/superpowers/specs/2026-10-01-android-v1-design.md`. Ici, seulement
ce qu'il faut savoir avant de toucher.

- **Architecture** : le rendu de l'application Windows tourne dans une WebView ;
  `window.neo` y est implémenté en Kotlin (`shim.ts` côté web, `Channels.ALL`
  côté Kotlin) avec le même PÉRIMÈTRE de sécurité que le processus principal
  Electron. La barre du bas est une vue NATIVE sous la WebView (elle ne s'étire
  pas). L'exécution de code tourne dans une WebView bac à sable séparée. Syncthing
  est embarqué, dans un service. Les notifications de révision lisent une table
  PRÉCALCULÉE (alarme en lecture seule), jamais le journal.
- **Commandes** : `npm run android:web` construit le web ; l'APK de release se
  construit dans un worktree temporaire PROPRE (jamais le dépôt de travail) :
  `pwsh apps/android/scripts/with-keystore-password.ps1 ./gradlew.bat
  assembleRelease --no-daemon`, installé par `adb -s <serial> install -r`.
  **Jamais un build debug par-dessus l'application release** (signatures
  différentes : désinstallation forcée, donc perte des données).
- **Contrôles** : `check:android-pont`, `check:android-code-pack`, et les tests
  JVM de Gradle (`./gradlew testDebugUnitTest`).
- **Valeurs immuables** : `applicationId com.ahmedmili.neoquiz` ; le keystore vit
  HORS du dépôt (mot de passe chiffré DPAPI à côté) et son SHA-256 est
  enregistré dans la Google Play Console (Android Developer Console) : un autre
  certificat = une autre application. Jamais de secret commité ni affiché.
- **Appareils** : on teste sur le téléphone du propriétaire (USB, `adb -s`), pas
  sur un émulateur (ceux de la machine appartiennent à une autre session) ;
  JAMAIS de désinstallation ni de `pm clear` ; les permissions système sont à
  lui.
- **Étirement** : le défilement doit rester sur le scroller racine avec
  `overscroll` d'étirement NATIF ; la barre du bas ne bouge jamais.
- **Moodle** : tourne dans le processus principal (`apps/windows/electron/
  moodle/`, relayé par `canaux.ts`) ; lecture seule côté Moodle, jeton gardé
  dans `jeton.ts` (jamais renvoyé à la fenêtre), hôte public seulement
  (`adresse.ts`). Voir `check:moodle`.
- **Packs de code téléchargeables** (Python et C/C++) : sur PC, le pack C/C++
  vient de `langages.ts` (empreinte `PACK_C`) et les paquets Python passent par
  le proxy `paquets-python.ts`, le bac à sable restant fermé ; sur Android,
  `apps/android/.../code/LanguagePacks.kt` et `PythonPackages.kt`, avec la
  copie d'empreinte `apps/android/web/pins.mjs` (`check:android-code-pack`).
- **Mise à jour automatique Android** : l'app lit `docs/android-latest.json`
  (site Pages), vérifie taille et SHA-256 de l'APK (`update/UpdateRules.kt`).
  `npm run ship:android [-- --notes "…"]` (`scripts/ship-android.mjs`) construit
  l'APK signé dans un worktree propre, crée la release GitHub `android-vX.Y.Z`
  (`--latest=false`, sans toucher aux releases desktop), puis écrit le manifeste
  et pousse `main` : ce dernier pas publie la mise à jour aux téléphones.
- **Réglages de dossier partagés** (nom, UE, couleur, icône, chemin) : un
  fichier par appareil, `<racine>/.neo-quiz/modules/<appareil>.json`, fusionné à
  la lecture par champ, le plus récent gagne, un champ effacé reste une pierre
  tombale (`src/shared-state/merge.ts`, `check:shared-state`).
- **Données par appareil** : `.neo-quiz/journal|exams|attempts/<appareil>` dans
  le dossier synchronisé, un fichier par appareil (jamais d'écriture partagée,
  fusion à la lecture : `check:shared-state`).
- **Partage natif** (spec `2026-10-07-robust-sharing-design.md`, §2.7) : ENVOI = la page
  donne un nom et des octets (même archive v1 que le PC), `ShareChannel` écrit
  dans `cache/share/<uuid>/` (purgé après 10 min) et `AndroidShareSender`
  lance `ACTION_SEND` + `Intent.createChooser` par `ShareFileProvider` (autorité
  `<applicationId>.share`, `share_paths.xml` limité à ce dossier, non exporté) ;
  le verrou (2 s) est rendu à chaque échec. RÉCEPTION = filtres d'intent
  de `MainActivity` (VIEW `content:` et SEND : zip, x-zip-compressed,
  markdown ; octet-stream en SEND seulement ; PAS de `text/plain`, qui listerait
  l'app pour tout texte partagé) ; `IncomingIntent` copie le flux (taille
  avant et pendant, 64 Mo) dans `cache/incoming/` sous un nom à nous, seule une
  URI `content:` d'une AUTRE appli est lue, l'extension `.zip`/`.md` décide
  (jamais le type annoncé) ; la page lit une fois `android.fichierRecu` et lance
  le MÊME import que le sélecteur (`ui/fichier-recu.ts`). IMPORT = staging
  `<parent>/.import-<id>` couvert par `.stignore` (`(?d).import-*`, Android et
  PC) puis UN renommage ; `check:android-pont` fige règles de noms, bornes et
  cette ligne `.stignore` côte à côte.
- **Syncthing** : identifiant de dossier `neo-quiz` (seul accepté) ; l'instance
  Windows n'ÉCOUTE JAMAIS (sortant + découverte globale + relais : pas
  d'invite de pare-feu) ; Android écoute sur 22100/21028 ; un appairage
  par QR code n'est plus confirmé nativement (le scan est la réponse, décision
  d'Ahmed du 2026-10-07, PC et Android) ; une demande acceptée depuis sa
  notification ne l'est plus (le clic sur « Accepter » est la réponse,
  décision d'Ahmed du 2026-10-03, PC et Android, `confirmationRequise`), ni un
  ID saisi dans « Ajouter un appareil » (le clic sur « Ajouter » est la
  réponse, décision d'Ahmed du 2026-10-05, PC et Android depuis le 2026-10-07 ;
  un formulaire pré-rempli par un lien montre l'identifiant complet et ne se
  valide qu'au clic) ; un nom
  d'appareil distant est assaini avant d'atteindre la boîte de dialogue.

## Build

- **L'application** se construit avec Vite + electron-builder
  (`apps/windows/`, `npm run app:build`). Il n'y a plus de build à la racine :
  `esbuild` n'y sert qu'aux scripts `check:*` (`scripts/lib/load-src.mjs`).
- **CSS** : `src/assets/css/index.css` est l'entrée (arbre de `@import`) ;
  `apps/windows` consomme `src/assets/css/` par chemin relatif. Les fontes
  MathLive (~300 Ko) sont inlinées en data-URI → pas de CDN.

## Dépôt GitHub et site (depuis le 2026-09-27)

- **Le dépôt appartient à l'organisation `Neo-Quiz`** :
  `github.com/Neo-Quiz/neo-quiz` (remote `git@github.com:Neo-Quiz/neo-quiz.git`).
  Il a été TRANSFÉRÉ depuis `ahmed-mili/neo-quiz` : GitHub redirige l'ancien
  chemin (releases, `latest.yml`, API), donc les applis déjà installées se
  mettent toujours à jour — mais tout lien NEUF s'écrit `Neo-Quiz/neo-quiz`,
  et `publish.owner` d'electron-builder vaut `Neo-Quiz` (`check:package`).
- **Le site est à la racine de `https://neo-quiz.github.io`**, servi par un
  SECOND dépôt, `Neo-Quiz/neo-quiz.github.io` (seul nom que Pages sert sans
  `/<dépôt>/` dans l'URL — montage de neovim/neovim.github.io). On ne l'édite
  JAMAIS directement : la source reste `docs/` ICI, et `.github/workflows/
  site.yml` l'y recopie à chaque push qui touche `docs/` (sans
  `docs/superpowers` ni `docs/archive`), par la clé de déploiement du secret
  `SITE_DEPLOY_KEY`. `release.yml` le relance après avoir poussé
  `latest.json` (un push fait avec le `GITHUB_TOKEN` ne déclenche aucun
  workflow). Ce dépôt-ci n'a plus de Pages ni de « Deployments ».
- **Le site est en ANGLAIS SEUL** : plus de `docs/fr/`, plus de sélecteur ni
  de devinette de langue. Les liens légaux de l'installeur
  (`urlLegale(page)`, `installer/noyau.ts`) ouvrent la page anglaise quelle
  que soit sa langue. `docs/404.html` renvoie les anciennes adresses
  `/neo-quiz/…` et `/fr/…` vers la même page à la racine ; `check-installer`
  le fige. L'application, elle, reste bilingue (voir « Langue »).
- **Tout ce qui est public sur GitHub s'écrit en anglais** : messages de
  commit (voir « Conventions »), noms de workflows et d'étapes, messages
  `::error::`, descriptions — et les commentaires de code (voir « Langue du
  code »). Le français reste la langue de ce fichier et de la note du vault.
- Les sondes locales `.tmp-*` à la racine sont ignorées (`.gitignore`) : ne
  jamais les commiter.
- **`CONTRIBUTING.md` et `SECURITY.md` à la racine** (onglets de la page du
  dépôt), en anglais. Ils résument des règles de ce fichier (langue du code,
  commits, i18n, valeurs immuables, `git ship`) : une règle qui change ici se
  reporte là-bas. Les failles arrivent par le signalement PRIVÉ de GitHub
  (activé sur le dépôt). Pas de `CODE_OF_CONDUCT.md` tant qu'il n'y a pas
  d'autre contributeur (choix d'Ahmed, 2026-09-27).

## Boucle de dev

La boucle de dev est celle de l'application (`npm run app:dev`).

## Structure du dépôt : un code partagé, plusieurs hôtes

- `src/` — **le code partagé**, qui ne connaît AUCUN hôte. Il demande à son
  environnement ce dont il a besoin via le contrat `src/host/types.ts` (`HostFs`,
  `HostLinks`, `HostWatcher`, `HostUi`, `HostMath`, `HostShell`, `HostPlatform`,
  `HostPaths`), obtenu par `currentHost()` (`src/host/current.ts`). Même patron que
  `src/review/review-store.ts` pour l'ordonnanceur, généralisé — et **mécanique** :
  `npm run check:host` refuse toute nouvelle dépendance à Obsidian ici.
- **`src/review/`** est le journal de révision, **partagé par les deux hôtes** : ce
  n'est plus l'adaptateur jetable du tableau de bord, et le chantier 4 ne
  l'emporte pas avec lui (voir le point suivant : ce n'est plus le seul rescapé).
- **`src/dashboard/` n'est plus, lui non plus, entièrement supprimable au
  chantier 4.** La tranche 2.5 y a laissé survivre du code PARTAGÉ : ses sept
  modules d'interface portés (rail, accueil, page « Mes quiz », cartes, sections
  repliables), `stats-store.ts`, `scanner.ts`, et les trois modules purs nés du
  portage (`module-map-note.ts`, `folder-archive.ts`, `module-icons.ts`) —
  `npm run check:dashboard-dom` les protège d'un retour en arrière. Ceci
  **contredit** la spec de l'ordonnanceur (`docs/superpowers/specs/
  2026-09-02-scheduler-design.md`, §3 : « l'adaptateur vit dans `dashboard/`
  **par choix** : c'est le dossier que le chantier 4 supprime ») — cette phrase
  ne visait que l'adaptateur (déjà sorti vers `src/review/`), mais elle laissait
  entendre que le RESTE de `dashboard/` disparaîtrait avec lui lors du chantier 4.
  Ce n'est plus vrai : le chantier 4 devra CONTOURNER une partie de `dashboard/`,
  pas la prendre en bloc. Les deux affirmations ne sont pas mises à jour l'une
  dans l'autre ; celle-ci, la plus récente, l'emporte.
- `apps/windows/` — l'application Windows (Electron + Vite). Elle consomme `src/` **par
  chemin relatif**, sans jamais copier un fichier : une copie divergerait sans un mot.
  Son thème est `src/theme/host-vars.css`. **L'hôte est SCINDÉ en deux, depuis la
  tâche 4 de la migration Tauri → Electron** : `apps/windows/src/host/*.ts` implémente
  le contrat côté RENDU (Chromium, sans Node) ; `apps/windows/electron/*.ts`
  (`main.ts` la fenêtre, `canaux.ts` les gestionnaires IPC — là où `borner`
  s'applique —, `pont.ts`, `preload.ts`, `fichiers.ts`, `perimetre.ts`,
  `reglages.ts`, `vaults.ts`, `index-fichiers.ts`, `parcours.ts`, `catalogue.ts`,
  `ressources.ts`) est le processus PRINCIPAL, seul endroit du
  dépôt qui touche le disque directement et qui tient le PÉRIMÈTRE de sécurité (un
  chemin hors des dossiers ouverts, un `..`, une jonction qui pointe dehors). Le
  rendu ne parle au principal que par `window.neo`, le pont IPC typé posé par
  `preload.ts` — **le rendu ne doit JAMAIS importer un module qui tire Node**
  (`node:fs`, `chokidar`…) : ce serait recréer, côté Chromium, l'accès disque total
  que le périmètre existe pour retirer côté principal. Seuls `catalogue.ts`,
  `ressources.ts` et `pont.ts` (sans Node) sont importables du rendu ; `npm run
  check:host` le tient mécaniquement (assertion 6, liste `SANS_NODE`).
- Une application Android viendra ; elle n'aura à écrire qu'un hôte.

## Architecture (le point important)

Point d'entrée de l'application : `apps/windows/src/main.ts` (rendu) et
`apps/windows/electron/main.ts` (processus principal). Le greffon Obsidian
(`apps/obsidian/`) a été supprimé le 2026-10-01.

1. **Moteur de rendu** — `src/engine.ts` + `src/engine/*.ts` (17 modules), le
   sous-système qui joue un quiz. Suit le
   pattern `createXHandlers(ctx)` par module et un **god-object `ctx` typé**,
   assemblé en plusieurs passes puis injecté dans toutes les factories
   (référence croisée). Le param d'appel externe est nommé `context`, le
   god-object interne `ctx` — jamais confondus (ni avec un contexte propre à un hôte).
   `renderInteractiveQuiz(context)` construit le `ctx` (type `EngineCtx`, la plus
   grosse interface du projet), instancie les 17 factories, puis les greffe et
   **aplatit ~55 méthodes** sur `ctx` via `Object.assign`. Le type
   `src/types/engine-ctx.ts` est documenté par **plages de lignes** de `engine.ts`.
   - **Distinction critique SNAPSHOT vs ACCESSOR** : les flags `__quiz*` sont copiés
     **par valeur** (figés à l'assemblage) ; l'état **vivant** se lit via des accessors
     de closure (`isDestroyed()`, `currentAsyncEpoch()`, `getSlideGeneration()`).
   - Rendu = une piste transformée en `translateX` ; hauteur synchronisée par
     `ResizeObserver` + « warming » (préchauffage des slides voisines).
   - Le cycle de vie est lié au `MarkdownRenderChild` : `destroyQuiz()` en `onunload`
     retire listeners/observers/timers (sans ça, chaque re-render fuit une instance).

2. **Dashboard** — `src/dashboard/*.ts`, le second sous-système d'interface, au
   **même pattern** `createXHandlers(ctx)`, mais qui ne vit plus que dans
   `apps/windows/` : `apps/windows/src/ui/dashboard-shell.ts` en est l'hôte
   (a remplacé l'ancienne `ItemView` `src/dashboard.ts`, disparue avec le greffon). 2 colonnes (Accueil / Mes quiz / Détail / Générer). Le
   `ctx` (`DashboardCtx`) est **petit** : les 5 handlers (`nav`, `home`,
   `quizzes`, `detail`, `ai`) sont greffés sur la **vue** (`this`), pas sur
   `ctx`. `types/dashboard-ctx.ts` scinde donc `DashboardCtx` (le littéral) et
   `DashboardView` (l'hôte `this`).

**La page « quiz » est UNIQUE** (`dashboard/detail.ts`, `createQuizPage(deps)`) :
questions à gauche, question courante à droite, bouton « Editor » qui bascule
consultation ⇄ édition **sur place**. Décrite par une `QuizPageSpec` (titre,
`load()`, `save?()`, retour, bouton principal), elle sert **deux hôtes**,
tous deux dans l'application : la vue détail du dashboard et la page
« Générer » (brouillon sans note jusqu'à son enregistrement automatique,
`QuizDraft.file === null`). Un troisième hôte, l'onglet `quiz-blocks-builder` du greffon
(`src/editor.ts`), est parti avec lui.
L'**éditeur en trois colonnes a été supprimé** le 2026-07-31 (« pas assez
intuitif ») : il ne reste de `src/editor/` que ce que la page consomme —
`editor-form.ts` (les champs par type, atteints via `dashboard/detail-form-bridge.ts`),
`convert.ts`, `export.ts`, `question-preview.ts`, `utils.ts`, `modals.ts`.
`types/editor-ctx.ts` ne décrit donc plus qu'un contrat étroit (7 champs) — **ne pas
l'élargir**, c'est cette étroitesse qui rend le formulaire réutilisable.

**Données partagées** : `dashboard/scanner.ts` (index des quiz du vault, avec
`onChange`) et `dashboard/stats-store.ts` (stats + accès aux settings). Types métier
des questions : `src/types/quiz.ts` (variantes `single` / `multiple` / `text` /
`ordering` / `matching`, + `ExamOptions`). Parsing JSON5 : `src/quiz-utils.ts`
(`parseQuizSource`, `extractExamOptions`).

## Ordonnanceur de révision (`src/scheduler/`) — le code qu'on ne jettera pas

Troisième sous-système, et le seul qui ne suit PAS le patron `ctx` : c'est un **noyau
pur**. Étant donné l'historique des réponses et un horizon de rétention, il décide
quelles questions sont dues aujourd'hui et dans quel ordre les poser.

**La règle qui gouverne tout** : `src/scheduler/` ne connaît ni Obsidian, ni écran, ni
horloge, ni calendrier, ni locale. `now` et `dayStart` sont des ENTRÉES. La feuille de
route (`docs/superpowers/specs/2026-09-02-roadmap-produit.md`) fait de ce module la
seule partie réutilisée telle quelle par les futures applications PC et Android : toute
dépendance introduite ici se paiera deux fois. `npm run check:scheduler` le vérifie
mécaniquement ; la preuve complémentaire, qui couvre les imports transitifs, est
`npx esbuild src/scheduler/index.ts --bundle --platform=neutral` sans avertissement.
**L'unité portable est `src/scheduler/` PLUS `src/types/quiz.ts`** (importé pour
`QUESTION_ROLES`), pas le dossier seul.

- **L'état n'est jamais persisté, il est DÉRIVÉ** d'un journal JSONL en ajout seul
  (`<racine>/.neo-quiz/review-log.jsonl`, partagé par les deux hôtes depuis la
  tranche 2 — voir `src/review/paths.ts`). Changer un paramètre rejoue tout
  l'historique ; rien à migrer, rien à désynchroniser. Le format se paie en
  propriétés gratuites : tolérance à la troncature, deux fenêtres qui écrivent
  sans se corrompre.
- **Une seule règle d'identité** (`src/quiz-ids.ts`, `assignQuestionIds` /
  `idsForRawItems`), partagée par le scanner, l'éditeur et le moteur. Une clé qui diverge
  d'un lecteur à l'autre rend une question éternellement neuve : elle revient tous les
  jours sans jamais pouvoir sortir de « À réviser ». Ne jamais recomposer une clé depuis
  `q.id`.
- **`src/review/review-store.ts`** absorbe tout ce qui est spécifique à un hôte
  (octets, fuseau, événements de renommage, dates saisies) pour que le noyau n'en
  voie rien — voir « Structure du dépôt » ci-dessus pour son statut de fichier
  partagé, plus jetable depuis la tranche 2.
- **Limites connues et mesurées**, pas des oublis : `npm run report:multiblock`. Le
  scanner n'indexe que le PREMIER bloc d'une note, et une note quiz `source:` journalise
  sous son propre chemin, absent du catalogue. Corriger l'une ou l'autre change le format
  de clé, donc l'historique déjà écrit — décision de conception, pas correctif.

## Génération IA (`dashboard/ai*.ts`)

Via **CLIs locaux, jamais de clé API** : Claude Code CLI (abonnement), Codex CLI
(ChatGPT), Ollama (local + cloud). `ai-client.ts` passe par le CONTRAT
(`host.process.run` pour les CLI, `host.net.fetchJson` pour Ollama) ; c'est
l'hôte qui lance et qui tue l'arbre de processus. Les **modèles sont lus
dynamiquement** (cache des CLIs, catalogue `ollama.com`), **jamais codés en dur** — voir
mémoire projet `codex-models-dynamic` et `ollama-latest-version-only`.

**La page « Générer » ne connaît aucun hôte** :
`createAiHandlers(deps: AiPageDeps)` ne reçoit plus ni `plugin` ni `app` — les
réglages arrivent par un `AiSettingsHost` (`dashboard/ai-settings-host.ts`, dont
`aiSettingsDefaults()` est la SEULE liste de défauts), et trois membres sont OPTIONNELS parce que
l'application ne les a pas : `openFiles` (pas d'onglets), `usage` (l'écran
d'usage appartenait au greffon — `ai-usage.ts` lit le trousseau du CLI) et
`renderCodeBlock` (sans lui, un `<pre><code>` nu). **Le texte d'un PDF joint est
un membre OPTIONNEL du contrat** (`HostPdf`) : l'application le fournit depuis le
2026-09-17 (`apps/windows/src/host/pdf.ts`, `pdfjs-dist` chargé à la demande, texte
des pages extrait). Un hôte qui ne le fournit pas REFUSE le PDF
(`ai.error.pdfUnsupportedInApp`) plutôt que d'en joindre le vide.

**La clé `ai` des réglages de l'application est GARDÉE dans le processus
principal** (`electron/garde-ia.ts` pour le verdict pur, `canaux.ts` pour la
porte native) : `aiOllamaUrl` doit être en `http(s)`, un hôte hors de la liste
du réseau et hors réseau local demande une confirmation NATIVE, et
`aiMentionExtraFolders` doit déjà être au périmètre. Sans elle, un rendu
compromis obtenait un hôte Internet dans la liste au lancement suivant.

Le CLI est lancé **sans aucun outil** : le modèle ne peut ouvrir aucun fichier. C'est
l'APPLICATION qui lit les sources — `dashboard/prompt-paths.ts` résout les chemins écrits
dans le composer (vault, chemin absolu, racine externe configurée) et
`startGeneration` les attache via les mêmes fonctions que le picker « @ ». Un chemin
introuvable ou ambigu est signalé par une Notice, jamais ignoré en silence.

## Composants UI (règles)

- **Dropdowns** : `dashboard/ui-select.ts` est le **seul** dropdown autorisé (portalé au
  `<body>`) — jamais de `<select>` natif.
- **Icônes** : Lucide via `host.ui.setIcon()` — les données de la bibliothèque
  `lucide` dans l'app. Jamais d'emoji.
- **Maths** : LaTeX `$...$` partout, rendu MathJax natif (`engine/mathjax.ts`) + éditeur
  MathLive (`engine/math-input.ts`).
- La dictée a été retirée le 2026-09-11 ; ses réglages persistés sont ignorés,
  pas effacés.

## Texte et HTML d'un quiz : quatre portes, jamais une cinquième

Tout ce qu'un quiz affiche passe par `src/engine/sanitizer.ts`. Le choix se fait sur
la NATURE de la destination, pas sur la confiance qu'on accorde à la donnée :

| Destination | Fonction |
|---|---|
| du texte, dans du HTML (énoncés, options, libellés) | `renderInlineText` — échappe, puis rend le markdown inline |
| du texte, dans un ATTRIBUT ou un composant sans HTML (`placeholder`, `aria-label`, vignette) | `stripInlineMarkdown` — même grammaire, marqueurs RETIRÉS ; sa sortie est du texte, à ré-échapper |
| un champ `*Html` pré-rendu (`promptHtml`, `explainHtml`, `learnHtml`, `passageHtml`, `optionHtml`) | `sanitizeQuizHtml` — liste blanche de balises/attributs |
| du texte + des images `![[…]]` | `renderTextWithEmbeds` / `replaceObsidianEmbedsInHtml` (qui assainit déjà) |

**Une cinquième porte existe, et c'est la seule** : `apps/windows/src/host/math.ts`
pose en `innerHTML` la sortie de `convertLatexToMarkup` (MathLive) sans l'assainir.
Ce n'est PAS un oubli — la justification est écrite sur place : ce HTML est fabriqué
par MathLive à partir de LaTeX, qui est analysé et jamais exécuté ; l'assainir
découperait les balises que MathLive vient de composer. Aucune autre exception : tout
autre HTML de l'app repasse par les quatre portes ci-dessus.

Deux règles qui ont chacune coûté un bug :

- **Le HTML d'un quiz n'est pas forcément celui de l'utilisateur** : un quiz PARTAGÉ
  arrive avec les `explainHtml` de son auteur, et un HTML non assaini s'exécute
  avec les droits de la fenêtre de l'application (jadis, sous Obsidian, avec ceux
  d'Obsidian). C'est arrivé aux six chemins `*Html` à la fois, et au
  libellé d'emplacement d'un classement (`quiz-slot-label`).
- **Pour lire du HTML sans l'exécuter, `<template>`, jamais un `<div>` détaché** : un
  `<img src=x onerror=…>` se charge dans un `<div>` même hors de l'arbre affiché. Le
  contenu d'un `<template>` a un document propriétaire inerte.

La liste blanche vit au niveau du MODULE (hors de `createSanitizer`) parce que
l'aperçu de l'éditeur l'appelle aussi. Deux surfaces qui affichent le même
`explainHtml` ne peuvent pas en avoir chacune la sienne.

`style` n'est pas supprimé mais RÉDUIT à une liste blanche de propriétés : l'attribut
entier aurait décoloré 594 fragments des quiz d'Ahmed. Mesurer avant de trancher.

## Conventions & pièges

- **Messages de commit : le dépôt est PUBLIC.** Un message dit ce qui a
  changé dans l'app, en termes de fonctionnalité, **en ANGLAIS, à
  l'impératif, sur UNE ligne de 60 caractères au plus** (« Add course
  glossary », « Fix sheet stack jump on return ») — pas de corps, sauf s'il
  est indispensable. GitHub coupe au-delà (« … ») sur la page du dépôt. Règle
  posée le 2026-09-27 ; l'historique antérieur, en français, reste tel quel
  (le réécrire décalerait tous les tags de release). Sans expliquer le
  pourquoi en détail. **Jamais une citation d'Ahmed, jamais son prénom, jamais
  un jugement sur un produit tiers ou un nom d'école** (règle posée le
  2026-09-20 après un message qui citait un avis sur Copilot et le nom de
  l'Efrei). Le pourquoi, avec ses citations, vit dans les commentaires du
  code, la note du vault et le journal — pas dans l'historique git.

- **Le PRODUIT s'appelle « Neo Quiz », le FORMAT s'appelle `quiz-blocks`.** Le nom
  affiché vit dans `src/branding.ts` (`PRODUCT_NAME`, `LOG_PREFIX`) — seule source,
  il était en dur à sept endroits avant. Deux valeurs ne le suivent JAMAIS, et les
  renommer « par cohérence » détruirait des données :
  `PLUGIN_ID = "quiz-blocks"` est le dossier de `.obsidian/plugins/` de l'ancien
  greffon (supprimé), où vivait l'ancien emplacement du journal de révision que
  l'application lit encore pour le migrer (`apps/windows/src/host/roots.ts` ;
  le journal vit désormais dans `<racine>/.neo-quiz/`) ;
  `QUIZ_BLOCK_LANGUAGE = "quiz-blocks"` est écrit dans **chaque note du
  vault**. C'est le rapport entre Obsidian et `.md`.

- **Deux autres valeurs immuables, côté application** : `appId =
  "com.ahmed.neoquiz"` et `executableName = "neo-quiz"`
  (`apps/windows/electron-builder.config.mjs`). Le premier est la clé de
  registre de l'installation NSIS (changé, chaque mise à jour installe une
  seconde copie), le second le nom du binaire Linux. `check:package` les fige.

- **La version de l'APPLICATION** vit dans `apps/windows/package.json` (+ lockfile
  synchronisé), bumpée depuis un tag `desktop-vX.Y.Z`. Le `package.json` de la
  racine du dépôt reste statique et ignoré : il ne porte la version de rien.
- Modules visés < ~350 lignes (exceptions assumées : `ui-select`, `ai`, `engine`).
- Docs de conception (workflow superpowers) : `docs/superpowers/{specs,plans}/`.
