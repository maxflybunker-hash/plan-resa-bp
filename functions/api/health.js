/**
 * Cloudflare Pages Function — diagnostic sans exposition des secrets ni des données.
 * GET /api/health vérifie la route, les variables et l'accès à public.reservations.
 */
function adminKey(env) {
  return String(env?.SUPABASE_SECRET_KEY || env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
function adminHeaders(env) {
  const key = adminKey(env);
  const headers = { apikey: key };
  // New sb_secret_* keys are not JWTs and must not be sent as Bearer tokens.
  if (key && !key.startsWith('sb_secret_')) headers.authorization = 'Bearer ' + key;
  return headers;
}
function safeUpstream(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      code: typeof parsed.code === 'string' ? parsed.code.slice(0, 80) : null,
      message: typeof (parsed.message || parsed.error) === 'string' ? String(parsed.message || parsed.error).slice(0, 300) : null,
      hint: typeof parsed.hint === 'string' ? parsed.hint.slice(0, 200) : null,
    };
  } catch (_) {
    return { message: String(raw || '').slice(0, 300) || 'Réponse amont non JSON.' };
  }
}
export async function onRequest({ env, request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ ok: false, error: 'Méthode non autorisée.' }, { status: 405 });
  }
  const missingEnvironmentVariables = [];
  if (!env?.SUPABASE_URL) missingEnvironmentVariables.push('SUPABASE_URL');
  if (!env?.SUPABASE_PUBLISHABLE_KEY) missingEnvironmentVariables.push('SUPABASE_PUBLISHABLE_KEY');
  if (!(env?.SUPABASE_SECRET_KEY || env?.SUPABASE_SERVICE_ROLE_KEY)) {
    missingEnvironmentVariables.push('SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY historique)');
  }

  let database = { tested: false, reachable: false, status: null, error: null };
  if (missingEnvironmentVariables.length === 0) {
    database.tested = true;
    try {
      const base = String(env.SUPABASE_URL).replace(/\/$/, '');
      const response = await fetch(base + '/rest/v1/reservations?select=*&limit=0', {
        headers: adminHeaders(env),
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      database.status = response.status;
      database.reachable = response.ok;
      if (!response.ok) database.error = safeUpstream((await response.text()).slice(0, 1000));
    } catch (error) {
      database.error = { message: String(error?.message || error).slice(0, 250) };
    }
  }
  const ok = missingEnvironmentVariables.length === 0 && database.tested && database.reachable;
  return Response.json(
    {
      ok,
      function: 'api/health',
      app: 'plan-resa-bp',
      missingEnvironmentVariables,
      database,
      keyMode: adminKey(env).startsWith('sb_secret_') ? 'supabase-secret-key' : (adminKey(env) ? 'legacy-service-role-key' : 'missing'),
    },
    {
      status: ok ? 200 : (missingEnvironmentVariables.length ? 503 : 502),
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  );
}
