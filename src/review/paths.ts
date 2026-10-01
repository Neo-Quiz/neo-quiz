/* ══════════════════════════════════════════════════════════
   OÙ VIT LE JOURNAL DE RÉVISION

   Une seule règle, INCONDITIONNELLE : `<racine>/.neo-quiz/review-log.jsonl`,
   sous les deux hôtes, que la racine soit un vault Obsidian ou un dossier nu.

   Elle diffère volontairement de celle des fichiers de RÉSULTATS
   (`paths.resultsDirFor`), qui dépend, elle, de la présence d'un `.obsidian/`.
   La raison n'est pas cosmétique : `estVaultObsidian()` est une DÉTECTION, et
   une détection peut changer d'avis (un `.obsidian` retiré, un dossier parent
   ouvert à la place du vault). Un fichier de résultats mal placé se retrouve ;
   un journal qui change d'emplacement fait repartir toutes les questions à
   zéro, sans un message, pendant que les révisions déjà écrites restent dans
   un fichier que plus rien ne lit.

   Le point de tête n'est pas un détail : les deux hôtes ignorent déjà les
   dossiers cachés (`dossierIgnore` côté app, l'explorateur d'Obsidian de
   l'autre), donc le journal ne pollue aucun catalogue tout en restant
   lisible par chemin.
══════════════════════════════════════════════════════════ */

export const REVIEW_DIR = ".neo-quiz";
export const REVIEW_LOG_NAME = "review-log.jsonl";

/** One file per device lives here: `<root>/.neo-quiz/journal/<deviceId>.jsonl`.
    The single legacy `review-log.jsonl` stays where it is, read only. */
export const REVIEW_JOURNAL_DIR = "journal";
export const deviceLogName = (deviceId: string): string => `${deviceId}.jsonl`;
/** A Syncthing conflict copy (`A.sync-conflict-20261001-120000-XYZ.jsonl`). */
export const isConflictCopy = (name: string): boolean => name.includes(".sync-conflict-");
