/**
 * Cloudflare Pages Function — diagnostic de déploiement.
 * GET /api/health
 * Ne renvoie jamais les valeurs des secrets, uniquement les variables manquantes.
 */
export async function onRequest({ env, request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ ok: false, error: 'Méthode non autorisée.' }, { status: 405 });
  }

  const required = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missingEnvironmentVariables = required.filter((key) => !env?.[key]);

  return Response.json(
    {
      ok: missingEnvironmentVariables.length === 0,
      function: 'api/health',
      app: 'plan-resa-bp',
      missingEnvironmentVariables,
    },
    {
      status: missingEnvironmentVariables.length === 0 ? 200 : 503,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  );
}
