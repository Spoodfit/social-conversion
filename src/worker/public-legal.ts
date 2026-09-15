const updatedLabel = '15 septembre 2026';
const contactEmail = 'contact@neptunebusiness.com';

function shell(title: string, description: string, body: string) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="index,follow">
  <meta name="description" content="${description}">
  <title>${title} · Social Conversion</title>
  <style>
    :root{color-scheme:light;--ink:#14163A;--muted:#6f7285;--line:#e8e9ef;--soft:#f7f8fb;--blue:#1E61FE;--violet:#8A36F5;--pink:#E82BDE;--orange:#FF7B12}
    *{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:var(--ink);font:16px/1.65 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    a{color:#4d38ca;text-decoration:none}a:hover{text-decoration:underline}.wrap{width:min(900px,calc(100% - 32px));margin:42px auto 72px}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:900;font-size:20px;background:linear-gradient(135deg,var(--blue),var(--violet),var(--pink),var(--orange));box-shadow:0 10px 30px rgba(95,59,220,.18)}
    .brand strong{display:block;font-size:17px}.brand span{display:block;color:var(--muted);font-size:13px}.card{background:#fff;border:1px solid var(--line);border-radius:26px;padding:clamp(24px,5vw,52px);box-shadow:0 20px 55px rgba(20,22,58,.06)}
    h1{font-size:clamp(30px,5vw,48px);line-height:1.08;letter-spacing:-.04em;margin:0 0 12px}h2{font-size:22px;line-height:1.25;margin:34px 0 12px}h3{font-size:17px;margin:22px 0 8px}
    p{margin:0 0 14px}.lead{font-size:18px;color:#4f5268;max-width:720px}.date{display:inline-block;margin:16px 0 26px;padding:7px 11px;border-radius:999px;background:#f1efff;color:#5d3bc6;font-size:12px;font-weight:800}
    ul{padding-left:22px;margin:10px 0 16px}li+li{margin-top:8px}.note{margin:24px 0;padding:16px 18px;background:var(--soft);border:1px solid var(--line);border-radius:16px}.contact{margin-top:32px;padding:20px;border-radius:18px;background:linear-gradient(135deg,rgba(30,97,254,.06),rgba(138,54,245,.06),rgba(232,43,222,.05))}
    footer{display:flex;flex-wrap:wrap;gap:14px 22px;margin-top:24px;color:var(--muted);font-size:13px}.small{font-size:13px;color:var(--muted)}
    @media(max-width:640px){.wrap{margin-top:22px}.card{border-radius:20px;padding:24px 20px}h2{margin-top:28px}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brand"><div class="mark">N</div><div><strong>Social Conversion by Neptune</strong><span>Neptune Business</span></div></div>
    <article class="card">${body}</article>
    <footer><span>© 2026 Neptune Business</span><a href="/terms">Conditions d’utilisation</a><a href="/privacy">Politique de confidentialité</a><a href="/data-deletion">Suppression des données</a></footer>
  </main>
</body>
</html>`;
}

const termsHtml = shell(
  'Conditions d’utilisation',
  'Conditions d’utilisation du service Social Conversion by Neptune.',
  `<h1>Conditions d’utilisation</h1>
   <p class="lead">Les présentes conditions encadrent l’accès et l’utilisation de Social Conversion by Neptune, un outil professionnel de gestion de contenus et de comptes de réseaux sociaux.</p>
   <span class="date">Dernière mise à jour : ${updatedLabel}</span>

   <h2>1. Éditeur et objet du service</h2>
   <p>Social Conversion est un service exploité par <strong>Neptune Business</strong>. Il permet notamment de connecter des comptes de réseaux sociaux autorisés, préparer et programmer des contenus, gérer une bibliothèque de médias et, lorsque les fournisseurs concernés l’autorisent, centraliser certaines interactions.</p>
   <p>Pour toute question relative au service, vous pouvez écrire à <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>

   <h2>2. Acceptation des conditions</h2>
   <p>En accédant à Social Conversion ou en connectant un compte social, vous reconnaissez avoir pris connaissance des présentes conditions et les accepter. Si vous utilisez le service pour le compte d’une entreprise ou d’une organisation, vous déclarez disposer de l’autorité nécessaire pour engager cette entité.</p>

   <h2>3. Accès au service et sécurité</h2>
   <p>Vous êtes responsable de la confidentialité de vos moyens d’accès à Social Conversion et des actions réalisées depuis votre espace. Vous devez utiliser des informations exactes et maintenir un niveau de sécurité adapté à votre compte.</p>
   <div class="note"><strong>Social Conversion ne vous demande jamais le mot de passe de vos comptes sociaux.</strong> Les connexions sont réalisées au moyen des mécanismes d’autorisation proposés par les plateformes concernées, notamment OAuth.</div>

   <h2>4. Connexion de comptes sociaux</h2>
   <p>Vous ne pouvez connecter que des comptes, Pages, profils ou chaînes que vous êtes autorisé à administrer. En autorisant une plateforme telle que TikTok, Instagram, Facebook ou YouTube, vous acceptez que Social Conversion utilise les autorisations que vous avez expressément accordées afin de fournir les fonctionnalités demandées.</p>
   <p>Les autorisations peuvent être retirées depuis Social Conversion lorsqu’une fonction de déconnexion est disponible ou directement depuis les paramètres du fournisseur social concerné.</p>

   <h2>5. Publications et contenus</h2>
   <p>Vous restez entièrement responsable des contenus que vous importez, préparez, programmez ou publiez au moyen de Social Conversion. Vous devez notamment vous assurer que vous disposez de tous les droits nécessaires sur les textes, images, vidéos, musiques, marques et autres éléments utilisés.</p>
   <p>Vous vous engagez à ne pas utiliser le service pour publier ou diffuser des contenus illicites, trompeurs, frauduleux, portant atteinte aux droits de tiers ou contraires aux règles des plateformes sociales utilisées.</p>

   <h2>6. Règles des plateformes tierces</h2>
   <p>Social Conversion dépend de services et API fournis par des tiers. L’utilisation de fonctionnalités liées à TikTok, Meta, Google, YouTube ou à toute autre plateforme reste également soumise aux conditions, politiques et limitations techniques de ces fournisseurs.</p>
   <p>Une fonctionnalité peut être limitée, suspendue ou modifiée si un fournisseur change son API, ses autorisations, ses règles d’usage ou l’accès accordé à Social Conversion.</p>

   <h2>7. Disponibilité et évolution</h2>
   <p>Neptune Business met en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, sans garantir un fonctionnement ininterrompu ou exempt d’erreurs. Des opérations de maintenance, incidents techniques ou changements imposés par des fournisseurs tiers peuvent entraîner une interruption temporaire.</p>
   <p>Les fonctionnalités de Social Conversion peuvent évoluer afin d’améliorer le service, de respecter des exigences de sécurité ou de tenir compte des règles des plateformes connectées.</p>

   <h2>8. Utilisations interdites</h2>
   <p>Il est notamment interdit de tenter de contourner les restrictions de sécurité, d’accéder aux données d’un autre espace sans autorisation, d’automatiser des usages interdits par les plateformes sociales, d’utiliser le service pour du spam ou une activité frauduleuse, ou de perturber volontairement son fonctionnement.</p>

   <h2>9. Propriété intellectuelle</h2>
   <p>Social Conversion, son interface, son code, son identité visuelle et les éléments fournis par Neptune Business restent protégés par les droits de propriété intellectuelle applicables. Les présentes conditions ne vous transfèrent aucun droit de propriété sur le service.</p>
   <p>Vous conservez les droits que vous détenez sur vos propres contenus.</p>

   <h2>10. Données personnelles</h2>
   <p>Le traitement des données personnelles associé au service est décrit dans notre <a href="/privacy">Politique de confidentialité</a>. Les modalités pour demander la suppression de données sont disponibles sur la page <a href="/data-deletion">Suppression des données</a>.</p>

   <h2>11. Suspension ou fin d’accès</h2>
   <p>Neptune Business peut suspendre ou restreindre un accès lorsqu’une mesure est nécessaire pour protéger la sécurité du service, prévenir un usage abusif, respecter une obligation légale ou faire cesser une violation manifeste des présentes conditions.</p>
   <p>La déconnexion d’un réseau social peut rendre indisponibles les fonctionnalités qui nécessitent son autorisation.</p>

   <h2>12. Responsabilité</h2>
   <p>Social Conversion est un outil d’assistance à la gestion des réseaux sociaux. Neptune Business ne garantit ni la performance commerciale d’une publication, ni sa portée, ni son classement algorithmique, ni le maintien d’une fonctionnalité dépendant d’un fournisseur tiers.</p>
   <p>Dans les limites autorisées par la loi, Neptune Business ne peut être tenu responsable des conséquences résultant d’un contenu publié par l’utilisateur, d’une utilisation non conforme du service ou d’une indisponibilité imputable à une plateforme ou infrastructure tierce.</p>

   <h2>13. Modification des conditions</h2>
   <p>Ces conditions peuvent être mises à jour pour tenir compte de l’évolution de Social Conversion, des exigences des fournisseurs connectés ou du cadre réglementaire. La date de dernière mise à jour figure en haut de cette page.</p>

   <h2>14. Droit applicable</h2>
   <p>Les présentes conditions sont régies par le droit français. Tout différend est traité conformément aux règles de compétence juridictionnelle applicables.</p>

   <div class="contact"><h3>Contact</h3><p>Une question concernant ces conditions ? <a href="mailto:${contactEmail}">${contactEmail}</a></p></div>`
);

const privacyHtml = shell(
  'Politique de confidentialité',
  'Politique de confidentialité du service Social Conversion by Neptune.',
  `<h1>Politique de confidentialité</h1>
   <p class="lead">Cette politique explique comment Social Conversion by Neptune traite les données nécessaires à la connexion, à la gestion et à la publication sur des comptes de réseaux sociaux.</p>
   <span class="date">Dernière mise à jour : ${updatedLabel}</span>

   <h2>1. Responsable du traitement</h2>
   <p>Social Conversion est un service exploité par <strong>Neptune Business</strong>. Pour toute question relative à vos données personnelles, vous pouvez écrire à <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>

   <h2>2. Données que nous pouvons traiter</h2>
   <p>Selon les fonctionnalités utilisées et les autorisations accordées auprès des fournisseurs sociaux, Social Conversion peut traiter :</p>
   <ul>
     <li>les identifiants techniques des comptes, Pages, profils ou chaînes connectés ;</li>
     <li>les noms d’affichage, pseudonymes et informations publiques nécessaires pour distinguer les comptes connectés ;</li>
     <li>les autorisations OAuth, leurs périmètres et les jetons techniques nécessaires à la connexion, stockés de manière chiffrée ;</li>
     <li>les contenus préparés dans Social Conversion : textes, médias, titres, descriptions, paramètres et dates de programmation ;</li>
     <li>lorsque la fonctionnalité est activée et autorisée par le réseau concerné, les messages, commentaires ou interactions utiles à l’Inbox ;</li>
     <li>des journaux techniques, de sécurité et d’audit nécessaires au fonctionnement, à la prévention des abus et au diagnostic des erreurs.</li>
   </ul>
   <div class="note"><strong>Social Conversion ne collecte pas votre mot de passe Facebook, Instagram, Google, YouTube, TikTok ou LinkedIn.</strong> L’authentification reste effectuée directement chez le fournisseur concerné.</div>

   <h2>3. Finalités</h2>
   <p>Ces données sont utilisées pour fournir le service demandé, notamment pour connecter les comptes autorisés, permettre la sélection de plusieurs comptes, préparer et programmer du contenu, synchroniser les publications, centraliser certaines interactions, sécuriser les accès et assurer le support technique.</p>

   <h2>4. Bases juridiques</h2>
   <p>Selon le traitement concerné, Neptune Business s’appuie sur l’exécution du service demandé, votre autorisation explicite auprès du fournisseur social, le respect d’obligations légales et, lorsque cela est applicable, son intérêt légitime à sécuriser et améliorer le service.</p>

   <h2>5. Fournisseurs et destinataires</h2>
   <p>Les données sont accessibles uniquement aux personnes et prestataires qui en ont besoin pour fournir Social Conversion. Cela peut inclure les réseaux sociaux que vous choisissez de connecter, ainsi que les prestataires techniques nécessaires à l’hébergement, à la sécurité et au stockage.</p>
   <p>Les fournisseurs sociaux restent responsables de leurs propres traitements. Leur utilisation est également régie par leurs politiques respectives.</p>

   <h2>6. Transferts hors de l’Espace économique européen</h2>
   <p>Certains fournisseurs sociaux ou techniques peuvent traiter des données en dehors de l’Espace économique européen. Dans ce cas, les transferts sont encadrés conformément aux mécanismes juridiques applicables et aux garanties proposées par les fournisseurs concernés.</p>

   <h2>7. Durée de conservation</h2>
   <ul>
     <li>les autorisations et jetons de connexion sont conservés tant que le compte social reste connecté ou jusqu’à leur révocation ;</li>
     <li>les données temporaires d’autorisation OAuth ne sont conservées que le temps nécessaire à finaliser la connexion ;</li>
     <li>les contenus, médias et réglages sont conservés tant qu’ils sont nécessaires à votre espace de travail ou jusqu’à leur suppression ;</li>
     <li>les journaux techniques et d’audit sont conservés pendant une durée proportionnée aux besoins de sécurité, de preuve et de maintenance.</li>
   </ul>

   <h2>8. Sécurité</h2>
   <p>Social Conversion met en œuvre des mesures techniques et organisationnelles adaptées, notamment le chiffrement des jetons OAuth, l’isolation des espaces de travail, des contrôles d’accès et des mécanismes de journalisation de sécurité.</p>

   <h2>9. Vos droits</h2>
   <p>Selon la réglementation applicable, vous pouvez demander l’accès, la rectification, l’effacement, la limitation ou la portabilité de vos données, ainsi que vous opposer à certains traitements. Vous pouvez aussi retirer une autorisation donnée à un réseau social directement depuis les paramètres de ce réseau.</p>
   <p>Pour exercer vos droits, écrivez à <a href="mailto:${contactEmail}">${contactEmail}</a>. Nous pouvons demander des informations raisonnables permettant de vérifier votre identité et le compte concerné.</p>

   <h2>10. Suppression des données</h2>
   <p>Les instructions détaillées sont disponibles sur notre page dédiée : <a href="/data-deletion">Demander la suppression de vos données</a>.</p>

   <h2>11. Mineurs</h2>
   <p>Social Conversion est un outil professionnel et n’est pas destiné aux personnes de moins de 18 ans.</p>

   <h2>12. Évolution de cette politique</h2>
   <p>Cette politique peut être mise à jour pour refléter une évolution du service, des fournisseurs connectés ou des obligations réglementaires. La date de dernière mise à jour figure en haut de cette page.</p>

   <div class="contact"><h3>Contact</h3><p>Pour toute question : <a href="mailto:${contactEmail}">${contactEmail}</a></p></div>`
);

const deletionHtml = shell(
  'Suppression des données utilisateur',
  'Instructions pour demander la suppression des données traitées par Social Conversion by Neptune.',
  `<h1>Suppression des données utilisateur</h1>
   <p class="lead">Vous pouvez demander la suppression des données associées à votre utilisation de Social Conversion, y compris celles liées à un compte social connecté.</p>
   <span class="date">Dernière mise à jour : ${updatedLabel}</span>

   <h2>1. Comment faire la demande</h2>
   <p>Envoyez un e-mail à <a href="mailto:${contactEmail}?subject=Suppression%20de%20données%20-%20Social%20Conversion">${contactEmail}</a> avec l’objet <strong>« Suppression de données – Social Conversion »</strong>.</p>
   <p>Indiquez uniquement les informations nécessaires pour identifier votre espace et le compte social concerné, par exemple :</p>
   <ul>
     <li>le nom de votre espace Social Conversion ou de votre entreprise ;</li>
     <li>le réseau concerné : Facebook, Instagram, YouTube, TikTok ou autre réseau connecté ;</li>
     <li>le nom de la Page, du profil ou de la chaîne concernée ;</li>
     <li>l’adresse e-mail utilisée pour votre accès Social Conversion, si nécessaire pour retrouver votre espace.</li>
   </ul>
   <div class="note"><strong>Ne transmettez jamais votre mot de passe ni un jeton OAuth dans votre demande.</strong></div>

   <h2>2. Ce que nous supprimons</h2>
   <p>Après vérification de la demande, nous supprimons ou anonymisons, selon ce qui est applicable :</p>
   <ul>
     <li>les jetons OAuth et autorisations stockés pour le compte concerné ;</li>
     <li>les métadonnées de connexion du compte social dans Social Conversion ;</li>
     <li>les données liées à ce compte qui ne sont plus nécessaires au fonctionnement de votre espace ;</li>
     <li>les contenus, réglages, interactions ou historiques associés lorsque leur suppression est demandée et qu’aucune obligation légale n’impose leur conservation.</li>
   </ul>

   <h2>3. Révocation auprès d’un fournisseur social</h2>
   <p>Vous pouvez également retirer l’accès de Social Conversion directement dans les paramètres de votre compte Facebook, Instagram, Google, YouTube, TikTok ou du fournisseur concerné. Cette révocation empêche les nouveaux accès via l’autorisation révoquée.</p>
   <p>La révocation chez le fournisseur ne constitue pas nécessairement une demande de suppression de toutes les données déjà enregistrées dans Social Conversion. Pour demander leur effacement, utilisez la procédure ci-dessus.</p>

   <h2>4. Contenus déjà publiés sur un réseau social</h2>
   <p>La suppression de données dans Social Conversion n’efface pas automatiquement un contenu déjà publié sur un réseau social si celui-ci est désormais hébergé par le fournisseur concerné. Vous pouvez supprimer ce contenu directement sur le réseau social ou utiliser les fonctions disponibles dans Social Conversion lorsqu’elles le permettent.</p>

   <h2>5. Délais et exceptions</h2>
   <p>Les demandes sont traitées sans délai injustifié et conformément aux délais légaux applicables. Certaines informations peuvent être conservées lorsque la loi l’exige ou lorsqu’elles sont strictement nécessaires à la sécurité, à la prévention de la fraude, à l’exercice de droits en justice ou à la résolution d’un litige.</p>

   <h2>6. Confirmation</h2>
   <p>Une confirmation est envoyée lorsque la demande a été traitée ou si des informations complémentaires sont nécessaires pour identifier les données concernées.</p>

   <div class="contact"><h3>Demander une suppression</h3><p><a href="mailto:${contactEmail}?subject=Suppression%20de%20données%20-%20Social%20Conversion">${contactEmail}</a></p><p class="small">Consultez également notre <a href="/privacy">politique de confidentialité</a>.</p></div>`
);

function htmlResponse(html: string, method: string): Response {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'content-language': 'fr',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  return new Response(method === 'HEAD' ? null : html, { status: 200, headers });
}

export function publicLegalResponse(pathname: string, method: string): Response | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalized === '/terms') return htmlResponse(termsHtml, method);
  if (normalized === '/privacy') return htmlResponse(privacyHtml, method);
  if (normalized === '/data-deletion') return htmlResponse(deletionHtml, method);
  return undefined;
}
