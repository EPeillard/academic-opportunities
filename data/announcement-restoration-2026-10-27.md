# Restauration du texte des annonces — 27 octobre 2026

Les 647 messages de l’archive initiale ont été rapprochés du catalogue existant. Les 231 messages exclus du premier import (sans offre retenue, candidatures ou échanges personnels) restent exclus.

Sur les 416 messages rattachés aux offres, 415 possèdent un corps exploitable. Le dernier ne contient pas de description dans le corps : ses informations issues de la pièce jointe restent présentées dans le résumé existant. Les textes utiles couvrent 422 des 423 fiches du catalogue.

Les relances identiques et les annonces collectives partagent leurs documents : 396 textes distincts sont conservés dans `announcements/`. Les identifiants des offres, leurs liens et leurs champs structurés sont préservés. Les versions distinctes restent accessibles dans la fiche, derrière la version la plus récente.

Le nettoyage retire les en-têtes, signatures, listes de diffusion, avis de confidentialité et liens de désabonnement, tout en conservant les paragraphes de recrutement, modalités, références et contacts utiles. Les versions HTML sont converties en texte avec liens explicites. Les liens de protection sont déballés lorsque leur cible est disponible. Les fichiers de courriel originaux ne sont pas ajoutés au dépôt.

L’annonce du 15 octobre 2026 du Max Planck Institute for Demographic Research conserve les trois paragraphes de présentation du Population and Social Data Science Summer Incubator Program, la période du 1er juin au 20 août 2027 et le lien détaillé du programme.

Les documents de poste joints aux messages sont aussi disponibles : **75 PDF distincts, un document Word et trois illustrations**, rattachés à **76 fiches**, pour environ 23,7 Mo. Les 91 occurrences utiles sont dédupliquées en 79 fichiers dont les octets sont identiques aux sources. Les logos, signatures cryptographiques, cartes de visite et artefacts de transport sont exclus. Les annonces collectives sont rapprochées de chaque sujet ; un PDF de poste de maître de conférences transféré avec une annonce d’ingénieur est rattaché à la fiche de maître de conférences correspondante, qui le recevait également explicitement.

L’affichage reste entièrement statique : le catalogue sert les résumés et les filtres ; les textes détaillés se chargent à l’ouverture de la fiche. Aucune collecte automatique ni dépendance Cloudflare supplémentaire n’est introduite.
