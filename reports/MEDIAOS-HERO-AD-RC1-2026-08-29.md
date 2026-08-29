# MediaOS Hero Ad RC1 — rapport d'intégration

Date : 2026-08-29  
État : `PASS_RELEASE_CANDIDATE_LOCAL_RENDER_STAGING_SCHEMA`  
Production : non modifiée  
Publication sociale : aucune

## Périmètre

Intégration de la brique Hero Ad au Content Generator existant, sur le commit contractuel `48fec8932eee0ac86c0ae4980c8f547a624a1589` :

- compositions Remotion verticales et horizontales;
- endpoint authentifié `POST /api/generate-ad`;
- file PostgreSQL `public.mkt_ad_jobs`;
- claim atomique d'un job par worker;
- worker local de rendu et téléversement;
- arrêt obligatoire à `READY_FOR_REVIEW`;
- handoff de révision à Francis;
- aucune publication et aucun rendu Remotion dans Vercel.

## Références Git immuables

### Content Generator

- dépôt : `cherryriver/cherry-river-content-ai-generator`;
- branche : `codex/mediaos-hero-ad-generator-rc1-20260829`;
- base imposée : `48fec8932eee0ac86c0ae4980c8f547a624a1589`;
- commit fonctionnel : `d63154dbc89ea09ee7620a7ac4ededc2d42a411b`;
- tree : `4db241a58fa4785d38ebd83405405804468c6ee6`.

### Schéma MediaOS

- dépôt : `cherryriver/cherry-river-media-os`;
- branche : `codex/mediaos-hero-ad-schema-rc1-20260829`;
- base : `f7ff62c241cca2aa682cd2f185d9184fa000f595`;
- commit migration : `c3b7baa97ab977f171ce24cd98c0df9bc9c5fbc9`;
- tree : `16225bfd3b6c0cecfd7831302679ed88746a8591`.

## Fichiers fonctionnels

Content Generator :

- `SPEC-HERO-AD-INTEGRATION.md`;
- `hero-ad.js`;
- `hero-ad.test.js`;
- `server.js`;
- `remotion/src/HeroProductAd.jsx`;
- `remotion/src/Root.jsx`;
- `remotion/render-hero.mjs`;
- `worker/hero-ad-worker.mjs`;
- `worker/hero-ad-worker.test.mjs`;
- `package.json` et `package-lock.json`.

Schéma :

- `supabase/migrations/20260829131028_media_os_hero_ad_jobs_rc1.sql`;
- `supabase/migrations/20260829131028_media_os_hero_ad_jobs_rc1.down.sql`;
- `supabase/tests/20260829131028_media_os_hero_ad_jobs_rc1.test.sql`.

## Comportement livré

L'endpoint relit toujours le produit dans `public.products`, exige `status=ready` et exige une image HTTPS provenant du stockage Supabase MediaOS autorisé. Il inscrit uniquement un job `QUEUED`; aucun module Remotion n'est importé par `server.js`.

Le worker local utilise un secret `service_role` fourni seulement par son environnement. Il réclame au maximum un job grâce à `FOR UPDATE SKIP LOCKED`, rend dans un répertoire temporaire isolé, téléverse dans le bucket `videos`, puis inscrit `READY_FOR_REVIEW`. Un échec produit `FAILED`; le worker ne publie jamais.

Le fond Seedance optionnel est abstrait et interdit explicitement bouteille, canette, emballage, étiquette, logo, texte, personne et mains. L'image produit demeure l'image statique réelle de l'inventaire.

## Preuve du canari réel local

Produit inventorié : `1776357908660`, `CR Gin Pamplemousse Rose 750mL`.

| Sortie | Dimension | Durée vidéo | Taille | SHA-256 |
|---|---:|---:|---:|---|
| verticale | 1080 × 1920 | 6,000 s | 6 725 211 octets | `24F6F784852C0DBE7DB958E56C99F904149D7065C01137A96ABED432F8A43AD6` |
| horizontale | 1920 × 1080 | 6,000 s | 3 211 527 octets | `8C167B8DD234598786ED10FEF4217285278B6A1AE83EB466D74A26A9F39E172F` |

Répertoire de preuve local, non committé : `C:\AI_Workspaces\_hero-ad-canary-20260829`.

Inspection visuelle : la bouteille réelle et son étiquette sont visibles et nettes dans les deux formats; aucun produit de remplacement ni placeholder n'est présent.

## Tests

- tests Node Content Generator : `21/21 PASS`;
- build Vite : `PASS`, 1 789 modules;
- audit npm : `0 vulnérabilité`;
- syntaxe Node du endpoint et du worker : `PASS`;
- `git diff --check` : `PASS`;
- migration appliquée sur la branche Supabase staging `mediaos-marketing-os-rc1-staging-20260828` (`evgrugljqzoiholcpcug`) : `PASS`;
- test SQL transactionnel : `PASS`, `residual_jobs=0`;
- rollback transactionnel : table et fonction supprimées dans la transaction, puis restaurées par `ROLLBACK`; zéro job résiduel;
- Supabase Security Advisor : aucune alerte visant `mkt_ad_jobs` ou `mkt_claim_ad_job`.

## Contrôles de sécurité et de données

- RLS activé et forcé sur `mkt_ad_jobs`;
- `anon` : aucun droit;
- `authenticated` : lecture de ses propres jobs ou lecture admin seulement;
- aucune écriture navigateur;
- claim du worker exécutable uniquement par `service_role`;
- aucune valeur secrète dans Git, les tests ou ce rapport;
- migration additive et rollback versionné;
- la branche staging n'a pas de table `products`, donc aucun faux canari API complet n'est revendiqué.

## Risques résiduels

1. La migration n'est pas appliquée en production et le Content Generator n'est pas redéployé; le flux réel queue → worker → Storage n'est donc pas encore actif.
2. Le worker local n'est pas encore installé comme service permanent; le présent RC1 fournit le processus et son mode `--once`.
3. Les tables production préexistantes `public.products` et `public.generations` ont été observées avec RLS désactivé. Ce risque n'est pas créé par RC1 et ne doit pas être corrigé sans politiques compatibles.
4. La branche staging possède des alertes préexistantes sans lien avec Hero Ad, notamment une vue `mkt_product_signals_public` en `SECURITY DEFINER` et des fonctions existantes trop largement exécutables.
5. Le warning Vite de chunk supérieur à 500 kB est préexistant et non bloquant.

## Rollback

Code :

```text
git revert d63154dbc89ea09ee7620a7ac4ededc2d42a411b
```

Base : appliquer le contenu de `20260829131028_media_os_hero_ad_jobs_rc1.down.sql`. Le rollback supprime uniquement la policy, le trigger, les deux fonctions et la table Hero Ad.

## Décision encore requise

Un GO distinct est requis pour :

1. appliquer la migration en production;
2. déployer le Content Generator corrigé;
3. installer/démarrer le worker local avec son secret serveur;
4. exécuter un unique canari production en brouillon et vérifier son `output_url`.

Le handoff canonique `8b7b7342-6ebe-499b-81fe-ae34b5c2c25a` est transitionné `pending → ack → done` après publication de ce rapport et des branches.
