# HERO AD — contrat d'intégration MediaOS RC1

## Objectif

Transformer un produit réel de l'inventaire MediaOS en publicité vidéo Remotion verticale, horizontale ou les deux. L'image produit reste statique afin de préserver exactement la bouteille, la canette et l'étiquette.

## Flux canonique

1. Un utilisateur MediaOS authentifié appelle `POST /api/generate-ad` avec un `productId`.
2. Le serveur relit le produit dans `public.products` et refuse tout produit non `ready`, sans image ou dont l'image ne provient pas du stockage Supabase autorisé.
3. Le serveur inscrit un job `QUEUED` dans `public.mkt_ad_jobs`. Il ne charge pas Remotion et ne rend aucune vidéo.
4. Le worker local réclame atomiquement un job via `public.mkt_claim_ad_job(text)` et le passe à `RENDERING`.
5. Le worker rend localement avec `remotion/render-hero.mjs`, téléverse le ou les MP4 dans le bucket `videos`, puis passe le job à `READY_FOR_REVIEW`.
6. Le worker crée un handoff de révision à Francis. Aucune publication n'est effectuée.

## API

```json
{
  "productId": "1776357908660",
  "format": "vertical|horizontal|both",
  "brand": "CHERRY RIVER",
  "kicker": "LE GOÛT DU QUÉBEC",
  "tagline": "Pamplemousse rose",
  "accent": "#FF1B8D",
  "bg": "#0D0D10",
  "withBackground": false
}
```

Réponse acceptée :

```json
{ "jobId": "<uuid>", "status": "QUEUED" }
```

`withBackground=true` peut démarrer une vidéo Seedance abstraite. Le prompt interdit bouteille, canette, emballage, étiquette, logo, texte, personne et mains. Le produit demeure toujours l'image statique de l'inventaire.

## Worker local

Variables serveur requises, jamais committées :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIAOS_AI_BASE_URL` seulement si l'URL par défaut doit être remplacée

Exécution ponctuelle :

```text
npm run worker:hero -- --once --worker-id=<identité-locale>
```

Exécution continue :

```text
npm run worker:hero -- --worker-id=<identité-locale> --poll-ms=5000
```

## Invariants

- Remotion s'exécute exclusivement sur le worker local, jamais dans Vercel.
- L'unique image produit est `products.image`; aucun produit, emballage ou texte d'étiquette n'est généré par IA.
- Une sortie s'arrête à `READY_FOR_REVIEW`; `APPROVED` exige une action humaine distincte.
- Le navigateur ne peut ni écrire dans `mkt_ad_jobs`, ni réclamer un job.
- Le secret `service_role` reste uniquement dans l'environnement du worker et du serveur.
- Chaque migration est additive et possède un rollback versionné.

## Canari local de référence

Produit : `1776357908660` — CR Gin Pamplemousse Rose 750mL.

- vertical : 1080 × 1920, 6 secondes;
- horizontal : 1920 × 1080, 6 secondes;
- source produit : image publique réelle de l'inventaire;
- publication : aucune.
