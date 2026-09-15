# Runbook sécurité production

Le Worker est volontairement inutilisable en production tant que les barrières de configuration et de readiness ne sont pas validées. Ce verrou empêche qu’un oubli transforme la démonstration en application anonyme ou qu’une fonction simulée soit présentée comme live.

## 1. Configurer Cloudflare Access

1. Dans Cloudflare Zero Trust, créer une application **Self-hosted** pour `social-conversion.neptunebusiness.com/*`.
2. Limiter la politique Access aux utilisateurs Neptune autorisés.
3. Copier le domaine d’équipe sous la forme `https://<equipe>.cloudflareaccess.com` dans `TEAM_DOMAIN` de `wrangler.jsonc`.
4. Copier l’Application Audience (AUD) Tag dans `POLICY_AUD`.
5. Conserver `workers_dev=false` et `preview_urls=false`.

Access filtre l’accès au niveau edge, mais ce n’est pas la seule barrière : le Worker vérifie également `Cf-Access-Jwt-Assertion` avec les clés distantes Cloudflare, puis contrôle l’issuer, l’audience, le `sub`, le workspace et le rôle.

## 2. Appliquer les migrations avant le Worker

```bash
npx wrangler d1 migrations apply DB --remote
```

- `0002_access_rbac.sql` ajoute les membres workspace, l’index d’identité des comptes sociaux, le rattachement tenant des webhooks et les index d’audit.
- `0003_live_operations.sql` ajoute le coffre de credentials OAuth chiffrés, l’outbox idempotente et le registre des demandes de confidentialité.

Le workflow de déploiement applique les migrations avant le Worker compatible.

## 3. Inviter le premier administrateur

Utiliser l’adresse e-mail telle qu’elle sera fournie par l’identité Access (la comparaison D1 est insensible à la casse) :

```bash
npx wrangler d1 execute DB --remote --command "INSERT INTO workspace_members (id, workspace_id, access_subject, email, role, status) VALUES ('member-initial-admin', 'default', NULL, 'ADMIN_EMAIL_A_REMPLACER', 'admin', 'invited')"
```

Au premier login, le Worker associe l’invitation e-mail au `sub` cryptographique du JWT Access et passe le membre à `active`. Les connexions suivantes utilisent le `sub`, pas une adresse e-mail déclarative.

Rôles disponibles :

| Rôle | Lecture | Messages / IA / mutations |
| --- | --- | --- |
| `viewer` | Oui | Non |
| `agent` | Oui | Oui |
| `manager` | Oui | Oui |
| `admin` | Oui | Oui |

Un utilisateur membre de plusieurs workspaces doit d’abord appeler `/api/workspaces`, puis envoyer le workspace choisi via `X-Workspace-Id`. Le client live centralise déjà ce header.

## 4. Configurer les secrets Meta

```bash
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
```

Le webhook public reste limité à `/webhooks/meta`. Les POST doivent porter une signature HMAC Meta valide. L’identité de connexion provient de `entry.id` dans le payload signé, puis d’une correspondance `social_connections.external_account_id` en D1. Un paramètre `?connection=` est ignoré.

Les scopes et endpoints OAuth Meta ne doivent pas être codés depuis une documentation non vérifiée. Tant que la configuration officielle n’a pas été confirmée, aucun callback OAuth ni connecteur outbound n’est exposé comme prêt.

## 5. Configurer le coffre OAuth chiffré

Les access/refresh tokens ne doivent jamais être stockés en clair dans D1, GitHub, les logs ou `wrangler.jsonc`.

Générer une clé AES-256 aléatoire :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Construire ensuite un keyring JSON, par exemple :

```json
{"active":"v1","keys":{"v1":"BASE64_32_OCTETS"}}
```

Puis l’enregistrer exclusivement comme secret Cloudflare :

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEYRING
```

Le coffre `src/worker/token-vault.ts` utilise AES-GCM avec IV aléatoire de 12 octets et Additional Authenticated Data liée à :

- la version de clé ;
- `workspaceId` ;
- `connectionId` ;
- le provider ;
- le type de token (`access` ou `refresh`).

Un ciphertext copié vers un autre tenant, une autre connexion ou un autre type de token ne peut donc pas être déchiffré avec succès.

### Rotation

Pour passer de `v1` à `v2`, conserver temporairement l’ancienne clé dans le keyring :

```json
{
  "active":"v2",
  "keys":{
    "v1":"ANCIENNE_CLE_BASE64",
    "v2":"NOUVELLE_CLE_BASE64"
  }
}
```

Les nouveaux tokens sont chiffrés avec `v2`; les tokens existants portant `key_version=v1` restent déchiffrables. Ne supprimer `v1` du secret qu’après rechiffrement/renouvellement de tous les credentials qui l’utilisent.

## 6. Outbox outbound

La table `outbound_messages` prépare l’envoi social réel sans prétendre qu’un connecteur existe déjà.

Propriétés imposées :

- clé d’idempotence unique par workspace ;
- hash SHA-256 de `conversationId + body` pour détecter la réutilisation abusive d’une clé ;
- conversation et connexion obligatoirement rattachées au même tenant ;
- états `pending -> sending -> sent/failed` ;
- claim atomique avant livraison ;
- compteur de tentatives et prochaine date de retry ;
- ID provider et dernier code d’erreur conservés sans journaliser le token OAuth.

**Important :** `/api/messages` continue de répondre `OUTBOUND_NOT_READY` en live tant que le transport Instagram réel n’est pas implémenté et validé. La présence de l’outbox ne constitue pas un GO d’envoi.

## 7. Confidentialité / RGPD

La migration `0003_live_operations.sql` introduit `privacy_requests` pour tracer les demandes `export` et `delete`. Cela ne suffit pas à déclarer le produit conforme : il reste à implémenter la politique de rétention, l’export effectif, la suppression tenant-scopée des données concernées et les exceptions légales/audit nécessaires.

Les données brutes Meta ne sont pas dupliquées dans `webhook_events`; seuls les champs normalisés nécessaires sont persistés.

## 8. Vérifications avant déploiement

```bash
npm run verify
npm run validate:production-config
```

Après déploiement :

- `GET /health` doit répondre sans donnée métier ;
- `GET /api/runtime` sans Access doit être bloqué ;
- `GET /api/session` sans Access doit être bloqué ;
- un utilisateur Access sans membership doit être refusé ;
- un utilisateur multi-workspace doit sélectionner explicitement son workspace ;
- `DEMO_MODE=true` doit afficher uniquement la démo ;
- le chemin live ne doit jamais importer ou afficher `demoData` ;
- aucun passage à `LIVE_READY=true` avant la chaîne Instagram réelle complète ;
- `TOKEN_ENCRYPTION_KEYRING` doit exister avant toute persistance OAuth ;
- aucun secret ou token ne doit apparaître dans GitHub ou les logs.

## Prémortem de mise en production

| Échec probable | Signal | Prévention intégrée |
| --- | --- | --- |
| Domaine publié sans Access | Shell/API accessible anonymement | JWT côté Worker + politique Access edge |
| Mauvais AUD ou domaine d’équipe | Toutes les API répondent 401/503 | Gate config + issuer/audience |
| Aucun administrateur provisionné | Login réussi mais accès workspace refusé | Invitation D1 avant ouverture |
| Mauvais tenant sélectionné | Données d’une autre agence visibles | `X-Workspace-Id` validé contre membership D1 |
| Faux live après panne API | Dashboard fictif malgré erreur backend | `LiveApp` séparé de `demoData`, erreurs bloquantes |
| Usurpation de tenant webhook | Tentative `?connection=...` | Mapping exclusif `entry.id` signé -> D1 |
| Rejeu webhook | Doublons de messages | IDs tenant-scopés + persistance idempotente |
| Token OAuth copié/fuité depuis D1 | Ciphertext exfiltré | AES-GCM + AAD tenant/connexion/type + keyring Cloudflare Secret |
| Double envoi après retry navigateur | Deux réponses identiques chez le prospect | idempotency key + request hash + outbox unique |
| Deux workers envoient le même message | doublon outbound | transition atomique `pending/failed -> sending` |
| Clé de chiffrement supprimée trop tôt | anciens tokens indéchiffrables | keyring multi-version jusqu’au rechiffrement complet |
| Fuite de payload Meta brut | PII dupliquée dans les journaux | payload webhook minimisé, texte utile uniquement dans le stockage métier |
| Demande RGPD oubliée | données conservées sans suivi | registre `privacy_requests` + procédure à implémenter avant GO |

## Bloquants restants

Restent hors de ce lot : OAuth Meta vérifié contre la documentation officielle, échange/refresh réel des tokens, transport Instagram réel, inbox paginée, mutations CRM/automatisations, fournisseur IA réel, exécution des automatisations, DLQ/alerting, politique RGPD complète et tests E2E navigateur.
