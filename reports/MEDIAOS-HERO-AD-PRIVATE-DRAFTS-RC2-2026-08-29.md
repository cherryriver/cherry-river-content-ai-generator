# MediaOS Hero Ad — brouillons privés RC2

Date : 2026-08-29  
État : `IN_SERVICE`  
Production : `cherry-river-content-ai-generator.vercel.app`

## Résultat

- Déploiement actif : `dpl_7YwAcXKcSWr2YsfY2PAfRPYfWt5K`.
- Commit Generator : `010132a` sur `codex/mediaos-hero-ad-private-rc2-20260829`.
- Commit schéma : `7e8d83ba577ba77961f5bc22356575c6cafca41f` sur
  `codex/mediaos-hero-ad-private-schema-rc2-20260829`.
- Migration production : `media_os_hero_ad_private_drafts_rc2`.
- Bucket `hero-ad-drafts` : privé, MP4 seulement, limite 50 Mo.
- Worker Dell : `DESKTOP-429OCP0-hero-ad-worker`, tâche
  `DELAGE-MEDIAOS-HERO-AD-WORKER`, service au commit `010132a`.

## Preuves de bascule

| Objet | Octets | SHA-256 |
|---|---:|---|
| `ff01fc74…/vertical.mp4` | 6 737 438 | `e0af4ff6fef7172ba711f128a37045ac0c7b04ac21aeca182e8383d7fae50fb2` |
| `ff01fc74…/horizontal.mp4` | 3 215 843 | `bedb8e88fb0d661ef5b4ca1f7c25845d80aea9a5b9165d391233d9562e7e68ec` |
| `8753b83f…/vertical.mp4` | 9 045 365 | `550984bb44bfa0c7a33c5d023c47fb93214b21a188589cb4301b7f515fec59bc` |

Les trois téléchargements signés ont été reproduits et comparés aux empreintes.
Les trois anciennes URL publiques répondent HTTP 400. Les deux jobs restent
`READY_FOR_REVIEW`; aucune publication n'a été effectuée. Les deux handoffs de
révision contiennent maintenant des références `storage://` et une route de
révision authentifiée, jamais une URL publique ou signée persistée.

## Tests exécutés

- Generator : 27/27 tests Node PASS.
- Vite : build PASS, 1 789 modules.
- `npm audit` : 0 vulnérabilité.
- migration et rollback staging : PASS, zéro résidu.
- candidat Linux Vercel : `/api/health` HTTP 200; révision anonyme HTTP 401.
- production : `/api/health` HTTP 200.
- worker : un seul processus actif; réclamations vides HTTP 204; zéro job actif.
- Storage : 3 objets privés, 0 objet Hero Ad dans le bucket public `videos`.

## Incident de préparation corrigé

Un premier déploiement précompilé sous Windows a échoué sur Vercel Linux à
cause du module natif `sharp`. Il n'a jamais été promu. Le candidat a été
reconstruit sur le builder Linux Vercel et validé avant promotion. Un projet
Vercel accidentel isolé a été supprimé; son dossier local de preuve a été
déplacé dans `C:\AI_Workspaces\_quarantine`.

## Rollback

- Déploiement précédent : `dpl_8AYQ6CdwwWvdQe2yVsUEhVi6vmci`.
- Migration `.down.sql` versionnée et fail-closed.
- Le rollback des données exige une recopie explicite des trois objets privés
  vers `videos` avant la migration descendante; aucune suppression automatique.
- Ancien service local conservé dans
  `C:\AI_Workspaces\services\mediaos-hero-ad-worker`.

## Risques résiduels

- Validation indépendante Lift-3 Mac déposée dans `mkt_agent_handoffs`, id
  `2b0a3969-c68d-44a4-bfdc-ebdee0e6e14b`, en attente.
- Alertes Supabase préexistantes hors WO : `products` et `generations` sans RLS,
  vues `SECURITY DEFINER`, fonctions historiques à `search_path` mutable.
- Aucun canari social réel n'a été publié. Metricool possède sept bindings
  actifs et un canari technique réussi; la publication demeure pilotée par le
  contenu approuvé et planifié.

