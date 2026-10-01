/* ══════════════════════════════════════════════════════════
   IDENTITÉ DU PRODUIT — une seule source.

   Le nom était écrit en dur à quatre endroits (`plugin.ts`,
   `dashboard/home.ts`, `dashboard.ts` ×2) et le préfixe de log à trois
   autres : un renommage en oubliait forcément un. Ce module n'a AUCUNE
   dépendance, ce qui le rend importable depuis n'importe où sans risque
   de cycle — `plugin.ts` importe le tableau de bord, donc la constante
   ne pouvait pas vivre là.

   Ce n'est PAS de l'i18n : un nom de produit ne se traduit pas. Les
   phrases qui le CITENT, elles, restent dans les dictionnaires.

   Ne pas confondre avec deux valeurs qui, elles, ne doivent JAMAIS
   suivre le nom du produit :
   - `PLUGIN_ID` = le dossier de `.obsidian/plugins/` de l'ancien greffon,
     où vivait le journal de révision de l'utilisateur (l'application le
     lit encore pour le migrer) ;
   - `QUIZ_BLOCK_LANGUAGE` = le mot écrit dans chaque note du vault.
   Le format s'appelle `quiz-blocks`, le produit s'appelle autrement —
   exactement le rapport entre Obsidian et `.md`.
══════════════════════════════════════════════════════════ */

/** Nom affiché : onglet, titre de l'accueil, en-tête des réglages. */
export const PRODUCT_NAME = "Neo Quiz";

/** Préfixe des messages de console. Dérivé du nom, jamais recopié. */
export const LOG_PREFIX = `[${PRODUCT_NAME}]`;

/** Le dossier de `.obsidian/plugins/`, où vivent les réglages ET le journal
    de révision de l'utilisateur (ancien emplacement, avant migration vers
    `<racine>/.neo-quiz/`) — l'application le lit pour retrouver cet ancien
    journal. NE CHANGE JAMAIS, et ne suit PAS `PRODUCT_NAME` : c'était une
    constante du greffon Obsidian (supprimé), gardée ici pour que
    l'application compose le même chemin sans le recopier en dur. */
export const PLUGIN_ID = "quiz-blocks";
