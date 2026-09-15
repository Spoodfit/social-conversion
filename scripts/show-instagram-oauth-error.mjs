import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SC_INSTAGRAM_OAUTH_ERROR_FEEDBACK_V2')) {
  console.log('Instagram OAuth error feedback already applied.');
  process.exit(0);
}

const anchor = `  useEffect(() => {\n    window.localStorage.setItem('social-conversion.active-account', activeAccountId);\n  }, [activeAccountId]);`;

if (!source.includes(anchor)) {
  throw new Error('Instagram OAuth error feedback patch failed: localStorage effect anchor not found.');
}

const effect = `  useEffect(() => {\n    const current = new URL(window.location.href);\n    const oauthError = current.searchParams.get('oauth_error');\n    // The normal OAuth feedback effect removes ?oauth first. Keep this second effect\n    // so a safe provider/internal error code from the callback is still surfaced.\n    if (!oauthError || current.searchParams.get('oauth')) return;\n    const messages: Record<string, string> = {\n      OAUTH_PROVIDER_FAILED: 'Instagram a refusé l’échange du code ou du jeton.',\n      OAUTH_PROFILE_INVALID: 'Instagram a autorisé l’app, mais le profil professionnel n’a pas pu être validé.',\n      OAUTH_WEBHOOK_SUBSCRIPTION_FAILED: 'Le compte est autorisé mais l’activation des webhooks a échoué.',\n      INVALID_OAUTH_STATE: 'La tentative de connexion Instagram n’est plus valide.',\n      OAUTH_STATE_EXPIRED: 'La tentative de connexion Instagram a expiré.',\n      CONNECTION_NOT_FOUND: 'La connexion Instagram temporaire n’a pas pu être enregistrée.',\n      OAUTH_NOT_CONFIGURED: 'La configuration Instagram côté serveur est incomplète.',\n      UNKNOWN: 'Une erreur interne est survenue pendant la connexion Instagram.',\n    };\n    setToast((messages[oauthError] || 'La connexion Instagram a échoué.') + ' [' + oauthError + ']');\n    current.searchParams.delete('oauth_error');\n    const next = current.pathname + (current.searchParams.toString() ? '?' + current.searchParams.toString() : '') + current.hash;\n    window.history.replaceState({}, '', next);\n  }, []);\n\n`;

source = source.replace(anchor, effect + anchor);
source += '\n/* SC_INSTAGRAM_OAUTH_ERROR_FEEDBACK_V2 */\n';
fs.writeFileSync(path, source);
console.log('Instagram OAuth safe failure code is now visible in the UI.');
