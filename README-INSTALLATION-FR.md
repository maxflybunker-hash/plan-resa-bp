# Plan de Salle BP — V106 — correction des zones et du tactile

## Structure à publier

Le dépôt GitHub doit avoir cette disposition, sans dossier parent supplémentaire :

- `functions/api/health.js` — contrôle du déploiement et de l’accès à la base
- `functions/api/resabp.js` — relais ResaBP côté serveur
- `public/index.html` — application complète
- `public/manifest.json`, `public/sw.js`, `public/icons/` — ressources PWA
- `tests/`, `package.json`, `wrangler.toml`, documentation et fichiers SQL à la racine

**Ne remets pas `index.html`, `manifest.json`, `sw.js` ou `icons/` à côté de `functions/` : ces ressources statiques se trouvent dans `public/`.** À l’inverse, `functions/` et `wrangler.toml` restent à la racine du dépôt, hors du dossier statique `public/`.

## Configuration Cloudflare Pages (GitHub)

Dans Workers & Pages → `plan-resa-bp` → Settings → Builds & deployments :

- Root directory (advanced) : vide
- Build command : `exit 0` (ou vide si Cloudflare laisse le déploiement statique sans commande)
- Build output directory : `public`
- Utiliser une intégration Git (GitHub) ou Wrangler pour déployer les Pages Functions. Un simple téléversement direct des assets statiques dans Cloudflare ne déploie pas le dossier `functions/`.

Le `wrangler.toml` de ce paquet précise également `pages_build_output_dir = "./public"`. Le paramètre Cloudflare du tableau de bord doit correspondre à `public`.

## Variables serveur (Cloudflare → Variables and Secrets)

Conserver les noms suivants côté serveur :

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (recommandé, clé serveur `sb_secret_...`) ou `SUPABASE_SERVICE_ROLE_KEY` (ancienne clé JWT, compatible)
- `RESABP_WEBHOOK_SECRET` uniquement si l’ingestion par webhook est utilisée

Ne partage jamais les valeurs des clés. La clé serveur ne doit jamais apparaître dans le HTML ou le dépôt GitHub.

## Déploiement sans effacer les données

1. Sauvegarder le dépôt avant modification.
2. Créer `public/` puis y déplacer `index.html`, `manifest.json`, `sw.js` et `icons/` (ou envoyer ces éléments depuis le dossier `public/` du ZIP).
3. Laisser `functions/` et `wrangler.toml` à la racine.
4. Régler Build output directory sur `public`, enregistrer et déclencher un nouveau déploiement de production.
5. Tester d’abord `https://plan-resa-bp.pages.dev/api/health`. Un JSON avec `ok: true`, `missingEnvironmentVariables: []` et `database.reachable: true` confirme que la route est publiée, les variables sont trouvées et `public.reservations` est interrogeable.
6. Tester ensuite `https://plan-resa-bp.pages.dev/` dans le navigateur du PC, puis dans Safari sur l’iPad et l’iPhone.

Ne supprime ni tables Supabase ni données du navigateur pendant le diagnostic. Le service worker V106 conserve localStorage/IndexedDB et change de nom de cache pour renouveler les fichiers statiques.

## Correctifs V106 (plan de salle)

- Suppression du libellé flottant indépendant « Zone de réservation » ; un seul repère reste ancré à la séparation.
- Glissement au doigt/souris de la séparation en continu, sans incrément de 10 cm.
- Correction des anciennes coordonnées `y: null` de la piste de danse et du conflit entre verrouillage du zoom et déplacement de cette structure.
- Retrait des marges d’affichage autour de la salle ; sur ordinateur, le plan remplit le viewport et peut se parcourir, sur mobile il reste à l’échelle native avec défilement.

## Tests locaux

Depuis la racine, avec Node.js :

```bash
npm run test:relay
```

Les tests locaux contrôlent la syntaxe et le comportement simulé des fonctions serveur; ils ne remplacent pas un test de bout en bout sur l’instance Cloudflare réelle.
