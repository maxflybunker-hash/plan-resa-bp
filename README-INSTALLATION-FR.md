# Plan de Salle BP — version V104 — correction JavaScript, Supabase et multi-supports

Ce paquet repart de la vraie application complète (plan, mobilier, salles, stockage local et synchronisation Supabase), et non de la page de diagnostic minimale.

## Arborescence obligatoire

Les fichiers doivent être déposés directement à la racine du dépôt GitHub, sans dossier parent supplémentaire :

- `index.html`
- `manifest.json`
- `sw.js`
- `wrangler.toml`
- `functions/api/health.js`
- `functions/api/resabp.js`
- `icons/`
- `tests/`

Le dossier `public/` de la base de diagnostic précédente n'est pas nécessaire pour cette version : l'interface réelle est dans `index.html` et ses fichiers PWA sont à la racine. Ne place pas `wrangler.toml` dans `public/`.

## Déploiement Cloudflare Pages

1. Fais une sauvegarde du dépôt GitHub avant toute modification.
2. Décompresse ce ZIP sur ton ordinateur et téléverse le **contenu** à la racine du dépôt, pas le dossier parent `V103-plan-salle`.
3. Conserve le projet Pages connecté à GitHub afin que Cloudflare compile les Pages Functions.
4. Dans les paramètres de build, laisse `Root directory` vide, définis `Build output directory` sur `.` et laisse `Build command` vide (ou `exit 0` pour un site sans étape de compilation si Cloudflare le demande).
5. Attends la fin du déploiement de production.
6. Teste `https://plan-resa-bp.pages.dev/api/health`. Résultat attendu : JSON avec `ok: true`, `missingEnvironmentVariables: []` et `database.reachable: true` si les variables sont correctes et que `public.reservations` est accessible. En cas d'échec, `database.status` et `database.error` indiquent la cause retournée par Supabase, sans afficher de données de réservation ni de secrets.
7. Ouvre ensuite `https://plan-resa-bp.pages.dev/` sur ordinateur, iPhone et iPad.

**Important :** l'upload direct des fichiers statiques depuis le tableau de bord Cloudflare Pages ne déploie pas les Pages Functions. Le projet doit être déployé via l'intégration Git (GitHub) ou via Wrangler.

## Variables Cloudflare requises

Dans `Settings → Variables and Secrets`, configurer côté serveur :

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (recommandé, clé serveur `sb_secret_...`) **ou** `SUPABASE_SERVICE_ROLE_KEY` (ancienne clé JWT `service_role`, pour compatibilité ; secret, jamais dans le HTML)
- `RESABP_WEBHOOK_SECRET` seulement si l'ingestion webhook POST est utilisée

Ne partage jamais la valeur de la clé `SUPABASE_SERVICE_ROLE_KEY`.

## Corrections apportées

- `wrangler.toml` placé à la racine du projet.
- Endpoint `functions/api/health.js` ajouté pour vérifier la prise en compte des Pages Functions.
- Service worker mis à jour avec un nom de cache neuf pour forcer l'abandon du cache applicatif précédent, tout en conservant localStorage/IndexedDB et la base Supabase.
- Les requêtes `/api/` ne sont jamais mises en cache.
- En cas d'échec d'une ressource, le service worker ne renvoie plus arbitrairement `index.html` à la place d'un script ou d'une icône.
- Suppression du chemin de secours qui appelait directement `resabp.com` depuis le navigateur et provoquait l'erreur CORS visible dans la console. La synchronisation des réservations doit passer par `/api/resabp` après authentification Supabase.

## Tests

Avec Node.js installé, à la racine du projet :

```bash
npm run test:relay
```

Les données métier sauvegardées dans Supabase ne sont pas supprimées par le remplacement des fichiers. Pour les données uniquement présentes dans le stockage du navigateur, ne vide pas manuellement les données du site pendant le diagnostic.


## V104 — correctifs issus de la capture console

- Un pont contrôlé expose les liaisons nécessaires aux scripts d'extension ajoutés après le moteur principal, notamment `selectedServiceDate`; la variable ne provoque plus `ReferenceError` hors de sa portée privée. Les setters permettent aux extensions de sauvegarder la bonne fonction de rendu au lieu de contourner le moteur.
- Les appels REST serveur gèrent les nouvelles clés Supabase `sb_secret_*` en n'envoyant que l'en-tête `apikey`, tandis que les anciennes clés `service_role` de format JWT continuent d'utiliser `Authorization: Bearer`.
- `/api/health` teste maintenant l'accès à `public.reservations` sans renvoyer aucune ligne, afin d'isoler les erreurs de clé/table.
- Le cache PWA est renouvelé sous `plan-salle-v104`.
