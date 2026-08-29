# MediaOS Hero Ad — mise en service production

Date : 2026-08-29  
Verdict : `MEDIAOS_HERO_AD_PRODUCTION_READY_FOR_REVIEW`  
Publication sociale : aucune

## Version déployée

- dépôt : `cherryriver/cherry-river-content-ai-generator`;
- branche : `codex/mediaos-hero-ad-generator-rc1-20260829`;
- commit worker sécurisé : `26251a73e1be13e241ba0ea01d9f7298c07a8f9b`;
- projet Vercel : `prj_7rlxFEHA3hFvCVgWaWigMk9d9Lxz`;
- déploiement production : `dpl_Bisve6U4qTqNtTkDarS1djFgz6JG`;
- domaine : `https://cherry-river-content-ai-generator.vercel.app`;
- `/api/health` : HTTP 200;
- endpoint sans authentification : HTTP 401;
- worker avec faux jeton : HTTP 401;
- erreurs runtime Vercel après canari : 0.

## Migration production

Migration `media_os_hero_ad_jobs_rc1` appliquée au projet Supabase `bypedtyxtnmmdsyrgwpj`.

Contrôles :

- `mkt_ad_jobs` existe;
- RLS activé et forcé;
- `anon` sans lecture ni écriture;
- `authenticated` peut seulement lire selon la policy propriétaire/admin;
- `authenticated` ne peut pas insérer;
- `mkt_claim_ad_job(text)` exécutable seulement par `service_role`;
- zéro job avant le canari.

## Worker Dell permanent

- worktree service : `C:\AI_Workspaces\services\mediaos-hero-ad-worker`;
- HEAD détaché : `26251a73e1be13e241ba0ea01d9f7298c07a8f9b`;
- lanceur : `C:\AI_Workspaces\services\mediaos-hero-ad-worker-run.ps1`;
- tâche Windows : `DELAGE-MEDIAOS-HERO-AD-WORKER`;
- état après activation : `Running`;
- identité : `DESKTOP-429OCP0-hero-ad-worker`;
- redémarrage : ouverture de session Windows, reprise automatique sur échec;
- secret local : jeton worker chiffré DPAPI sous le profil Windows courant;
- aucune clé Supabase `service_role` présente sur le Dell.

Le worker reçoit uniquement des URL Supabase signées. Les MP4 transitent directement du Dell vers Supabase Storage et ne traversent pas la fonction Vercel.

## Canari réel

- job : `ff01fc74-6c3c-4ea8-a2fd-904fc2a72223`;
- produit réel : `1776357908660`, CR Gin Pamplemousse Rose 750mL;
- parcours : `QUEUED → RENDERING → READY_FOR_REVIEW`;
- worker : `DESKTOP-429OCP0-hero-ad-worker`;
- tentatives : 1;
- début rendu : `2026-08-29T13:47:12.313340Z`;
- fin rendu : `2026-08-29T13:47:59.653956Z`;
- durée opérationnelle : environ 47 secondes;
- objets Storage : 2;
- octets enregistrés : 9 953 281;
- handoffs de revue créés : 1;
- publication liée : 0;
- nouvelles publications `SCHEDULED` ou `PUBLISHED` pendant le canari : 0.

### Sorties

- vertical 1080 × 1920, 6 secondes, HTTP 200 :  
  `https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/videos/hero-ads/ff01fc74-6c3c-4ea8-a2fd-904fc2a72223/vertical.mp4`
- horizontal 1920 × 1080, 6 secondes, HTTP 200 :  
  `https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/videos/hero-ads/ff01fc74-6c3c-4ea8-a2fd-904fc2a72223/horizontal.mp4`

## Tests

- Node : 24/24 PASS;
- Vite : PASS, 1 789 modules;
- npm audit : 0 vulnérabilité;
- syntaxe Node : PASS;
- diff-check : PASS;
- migration staging et rollback transactionnel : PASS;
- migration production et ACL/RLS : PASS;
- rendu et upload production : PASS;
- vérification ffprobe distante : PASS;
- runtime Vercel : zéro erreur observée après canari.

## Changements externes

- Supabase production : table, fonctions, trigger, policy et un job canari;
- Supabase Storage : deux MP4 canaris;
- Vercel production : nouveau déploiement et variable sensible `HERO_AD_WORKER_TOKEN`;
- Windows Dell : worktree service, lanceur, jeton DPAPI et tâche planifiée;
- Git : branche Generator poussée; branche de migration poussée.

## Risques résiduels

1. La tâche utilise le profil Windows courant : elle tourne pendant une session utilisateur et redémarre à la prochaine ouverture de session. Le Dell doit demeurer allumé et connecté.
2. `PIAPI_API_KEY` n'est pas configurée dans le projet Vercel actuel. Les Hero Ads statiques fonctionnent; l'option `withBackground=true` échoue fermée jusqu'au raccord PiAPI.
3. Les tables préexistantes `public.products` et `public.generations` ont RLS désactivé. Ce risque n'a pas été élargi par Hero Ad et exige un chantier séparé avec policies compatibles.
4. Le bucket `videos` est public par conception actuelle; les brouillons possédant leur URL sont donc accessibles. Une politique de brouillons privés/signés constitue un durcissement futur.

## Rollback

1. Arrêter et désactiver `DELAGE-MEDIAOS-HERO-AD-WORKER`.
2. Restaurer Vercel vers `dpl_8ZZhnMrYjvQANRcChJ7JCo3X8hdN` pour retirer le pont worker, ou vers `dpl_3r7kqRsWDBpwfNdbWCb7kJjfrmup` pour revenir avant Hero Ad.
3. Appliquer `supabase/migrations/20260829131028_media_os_hero_ad_jobs_rc1.down.sql` si la fonction Hero Ad doit être entièrement retirée.
4. Supprimer explicitement les deux objets `videos/hero-ads/ff01fc74-6c3c-4ea8-a2fd-904fc2a72223/` seulement si Francis demande d'effacer la preuve canari.
5. Supprimer la variable Vercel `HERO_AD_WORKER_TOKEN` et la valeur DPAPI locale.

## Décision

Le système est en service et attend la révision humaine des deux brouillons. Aucun GO de publication n'est implicite.
