# MediaOS Hero Ad — mise en service production

Date : 2026-08-29  
Verdict : `MEDIAOS_HERO_AD_PRODUCTION_READY_FOR_REVIEW`  
Publication sociale : aucune

## Version déployée

- dépôt : `cherryriver/cherry-river-content-ai-generator`;
- branche : `codex/mediaos-hero-ad-generator-rc1-20260829`;
- commit worker sécurisé : `26251a73e1be13e241ba0ea01d9f7298c07a8f9b`;
- projet Vercel : `prj_7rlxFEHA3hFvCVgWaWigMk9d9Lxz`;
- déploiement production initial : `dpl_Bisve6U4qTqNtTkDarS1djFgz6JG`;
- déploiement production après raccord PiAPI : `dpl_8AYQ6CdwwWvdQe2yVsUEhVi6vmci`;
- domaine : `https://cherry-river-content-ai-generator.vercel.app`;
- `/api/health` : HTTP 200;
- endpoint sans authentification : HTTP 401;
- worker avec faux jeton : HTTP 401;
- erreurs runtime Vercel après canari : 0.

## Raccord PiAPI

- variable sensible `PIAPI_API_KEY` ajoutée à l'environnement Vercel `Production` seulement;
- valeur absente de Git, des journaux et du présent rapport;
- authentification directe auprès de l'API PiAPI : PASS;
- redéploiement Vercel : READY;
- domaine canonique après propagation : HTTP 200 sur `/api/health`;
- génération payante pendant le contrôle de raccord : aucune.

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

## Canari PiAPI avec arrière-plan Seedance

- tâche fournisseur : `525b28bc-8f85-4741-9ed4-a4c6c54a3915`;
- job Hero Ad : `8753b83f-9983-4471-9f3b-220a6817447a`;
- produit réel : `1776357908660`, CR Gin Pamplemousse Rose 750mL;
- format : vertical 9:16;
- prompt fournisseur : arrière-plan abstrait uniquement, avec interdiction explicite de bouteille, canette, emballage, étiquette, logo, texte, personne et mains;
- parcours : `QUEUED → RENDERING → READY_FOR_REVIEW`;
- worker : `DESKTOP-429OCP0-hero-ad-worker`;
- tentatives : 1;
- début rendu : `2026-08-29T14:54:05.670257Z`;
- fin rendu : `2026-08-29T14:57:13.256826Z`;
- handoff de revue : `87c64549-1ed4-442c-81d9-316f8af511e3`;
- publication effectuée : false;
- sortie verticale : 1080 × 1920, H.264, 6,059 secondes, 9 045 365 octets, HTTP 200 :
  `https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/videos/hero-ads/8753b83f-9983-4471-9f3b-220a6817447a/vertical.mp4`

La comparaison SHA-256 de trois images extraites à 1, 3 et 5 secondes confirme que la vidéo évolue dans le temps. L'inspection visuelle confirme l'utilisation de la vraie bouteille et une étiquette nette. Le fond noir rectangulaire déjà présent autour de l'actif produit demeure visible dans la composition et exige une décision créative humaine avant approbation.

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
- canari PiAPI → worker local → Storage : PASS en une tentative;
- runtime Vercel : zéro erreur observée après canari.

## Changements externes

- Supabase production : table, fonctions, trigger, policy et un job canari;
- Supabase Storage : deux MP4 canaris;
- Vercel production : déploiements contrôlés et variables sensibles `HERO_AD_WORKER_TOKEN` et `PIAPI_API_KEY`;
- Windows Dell : worktree service, lanceur, jeton DPAPI et tâche planifiée;
- Git : branche Generator poussée; branche de migration poussée.

## Risques résiduels

1. La tâche utilise le profil Windows courant : elle tourne pendant une session utilisateur et redémarre à la prochaine ouverture de session. Le Dell doit demeurer allumé et connecté.
2. Le parcours PiAPI payant est prouvé jusqu'à `READY_FOR_REVIEW`. La source produit d'inventaire comporte toutefois un fond noir rectangulaire visible; une version détourée fournie ou approuvée par Francis améliorerait la composition sans générer ni réimaginer le produit.
3. Les tables préexistantes `public.products` et `public.generations` ont RLS désactivé. Ce risque n'a pas été élargi par Hero Ad et exige un chantier séparé avec policies compatibles.
4. Le bucket `videos` est public par conception actuelle; les brouillons possédant leur URL sont donc accessibles. Une politique de brouillons privés/signés constitue un durcissement futur.

## Rollback

1. Arrêter et désactiver `DELAGE-MEDIAOS-HERO-AD-WORKER`.
2. Restaurer Vercel vers `dpl_Bisve6U4qTqNtTkDarS1djFgz6JG` pour revenir avant le raccord PiAPI, vers `dpl_8ZZhnMrYjvQANRcChJ7JCo3X8hdN` pour retirer le pont worker, ou vers `dpl_3r7kqRsWDBpwfNdbWCb7kJjfrmup` pour revenir avant Hero Ad.
3. Appliquer `supabase/migrations/20260829131028_media_os_hero_ad_jobs_rc1.down.sql` si la fonction Hero Ad doit être entièrement retirée.
4. Supprimer explicitement les deux objets `videos/hero-ads/ff01fc74-6c3c-4ea8-a2fd-904fc2a72223/` seulement si Francis demande d'effacer la preuve canari.
5. Supprimer les variables Vercel `HERO_AD_WORKER_TOKEN` et `PIAPI_API_KEY`, puis la valeur DPAPI locale.

## Décision

Le système est en service et le parcours optionnel PiAPI est prouvé. Les sorties attendent une révision humaine. Aucun GO de publication n'est implicite.
