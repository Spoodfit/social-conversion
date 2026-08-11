# Runbook sécurité production

Le Worker est volontairement inutilisable en production tant que `TEAM_DOMAIN` et `POLICY_AUD` valent `CHANGE_ME`. Ce verrou empêche qu’un oubli de configuration transforme la démonstration en application anonyme.

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

La migration `0002_access_rbac.sql` ajoute les membres workspace, l’index d’identité des comptes sociaux, le rattachement tenant des webhooks et les index d’audit.

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

## 4. Configurer les secrets Meta

```bash
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
```

Le webhook public reste limité à `/webhooks/meta`. Les POST doivent porter une signature HMAC Meta valide. L’identité de connexion provient de `entry.id` dans le payload signé, puis d’une correspondance `social_connections.external_account_id` en D1. Un paramètre `?connection=` est ignoré.

## 5. Vérifications avant déploiement

```bash
npm run verify
npm run validate:production-config
```

Après déploiement :

- `GET /health` doit répondre sans donnée métier ;
- `GET /api/session` sans Access doit être bloqué ;
- un utilisateur Access sans invitation doit recevoir `WORKSPACE_FORBIDDEN` ;
- l’administrateur invité doit voir le workspace `default` et son rôle ;
- `DEMO_MODE=true` doit afficher clairement le mode démonstration ;
- aucun passage à `LIVE_READY=true` avant la chaîne Instagram réelle complète.

## Prémortem de mise en production

| Échec probable | Signal | Prévention intégrée |
| --- | --- | --- |
| Domaine publié sans Access | Shell HTML visible anonymement | API verrouillée par JWT côté Worker ; vérifier aussi la politique edge |
| Mauvais AUD ou domaine d’équipe | Toutes les API répondent 401/503 | Gate `validate:production-config` et contrôle issuer/audience |
| Aucun administrateur provisionné | Login réussi mais `WORKSPACE_FORBIDDEN` | Créer l’invitation D1 avant ouverture aux utilisateurs |
| Usurpation de tenant via URL webhook | Tentative `?connection=...` | Mapping exclusif depuis `entry.id` signé vers D1 |
| Rejeu webhook | Doublons de messages | ID interne connexion + événement et inserts idempotents dans un batch transactionnel |
| Fuite de payload Meta brut | PII dupliquée dans les journaux | Le journal webhook ne conserve que l’horodatage normalisé ; le texte utile reste dans `messages` |

Restent hors de ce lot : OAuth Meta, chiffrement/rotation des jetons sociaux, envoi Instagram réel, politique de rétention/suppression RGPD et lecture live complète du dashboard.
