# Academic Opportunities

Catalogue public d’offres académiques et de recherche, maintenu manuellement.

**[Consulter le site](https://academic-opportunities-demo.etienne-peillard.workers.dev/)**

Les fiches proviennent de `data/opportunities.json`. Le site est entièrement statique : recherche, filtres, pagination et détails fonctionnent dans le navigateur. Il ne dépend d’aucune API, base distante, connexion OAuth, réception de courriels, file d’attente, tâche planifiée ou service d’extraction. Aucun courriel original ni pièce jointe n’est publié.

## Mettre à jour les offres

1. Modifier [data/opportunities.json](data/opportunities.json), à la main ou avec l’aide d’un agent, en suivant le [guide des données](data/README.md).
2. Exécuter `npm run check`.
3. Enregistrer et pousser sur **main**, la branche principale réelle de ce dépôt. Le workflow de publication vérifie et déploie les fichiers statiques vers l’adresse existante. Cette publication technique ne collecte et ne modifie aucune offre.

Les exports et documents de travail restent hors du dépôt public. On y conserve seulement des fiches structurées et des résumés factuels. Les mises à jour ne demandent aucun abonnement de liste, compte de service ou clé de modèle.

## Développement

Node.js 24 et npm sont recommandés.

```sh
npm ci
npm run dev
```

Ouvrir http://127.0.0.1:5173. Pour vérifier la version construite :

```sh
npm run check
npm run preview
```

La prévisualisation est disponible sur http://127.0.0.1:4173. Les liens directs `/opportunities/<id>` fonctionnent sur l’hébergement grâce au repli vers `index.html`.

## Organisation

| Chemin                      | Rôle                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `data/opportunities.json`   | Base statique des offres                                                                  |
| `data/README.md`            | Règles de mise à jour manuelle                                                            |
| `data/import-2026-10-27.md` | Bilan du premier import                                                                   |
| `apps/web`                  | Interface React et filtres locaux                                                         |
| `packages/shared`           | Types et validation des fiches                                                            |
| `scripts/validate-data.ts`  | Contrôle de la base avant construction                                                    |
| `tests`                     | Recherche, dates, navigation, validation et absence d’appels réseau                       |
| `wrangler.jsonc`            | Hébergement des fichiers statiques, sans serveur applicatif ni liaison de base de données |

## Publication

Le workflow **Publish static catalogue** utilise l’environnement GitHub existant `demo`, avec le secret `CLOUDFLARE_API_TOKEN` et la variable `CLOUDFLARE_ACCOUNT_ID`. Il remplace le contenu du site existant `academic-opportunities-demo` et retire sa dépendance à D1. L’adresse conserve son nom historique ; les données affichées sont réelles.

Pour publier depuis un poste déjà authentifié auprès de Cloudflare : `npm run deploy`. Aucune migration, initialisation ou alimentation de base distante n’est nécessaire. Les anciennes ressources de stockage éventuelles ne sont plus utilisées par le site ; cette modification ne supprime pas de ressources Cloudflare indépendantes.

## Comportement

Les filtres se combinent : mots-clés, type, domaine, pays, date d’annonce, échéance maximale et état de l’échéance. Les paramètres figurent dans l’URL et les résultats sont triés par date d’annonce décroissante, puis identifiant stable. Toutes les annonces sont affichées par défaut, y compris celles dont l’échéance est passée. Une échéance inconnue n’est jamais présentée comme une candidature encore ouverte. Les dates de priorité ou de début d’examen ne sont pas assimilées à des dates de clôture.

Le contrôle des données refuse les champs inconnus, les identifiants en double, les dates invalides, les liens publics non conformes et les résidus de courriels. Les descriptions restent du texte échappé par React.

Licence du code : MIT. Les offres sont présentées sous forme de résumés factuels ; les documents sources ne sont pas redistribués sous la licence du dépôt.
