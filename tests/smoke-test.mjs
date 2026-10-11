import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/resabp.js';
import { onRequest as healthHandler } from '../functions/api/health.js';
import { readFileSync, existsSync } from 'node:fs';

const healthResponse = await healthHandler({ request: new Request('https://plan.test/api/health'), env: {} });
assert.equal(healthResponse.status, 503, 'health route must run and report missing environment variables');
assert.deepEqual((await healthResponse.json()).missingEnvironmentVariables, ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY historique)']);

const healthOriginalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  assert.match(String(url), /\/rest\/v1\/reservations\?select=\*&limit=0/);
  assert.equal(options.headers.apikey, 'server-only-test');
  assert.equal(new Headers(options.headers).get('accept-profile'), 'public', 'health route must explicitly query the public schema');
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};
let healthyResponse;
try {
  healthyResponse = await healthHandler({
    request: new Request('https://plan.test/api/health'),
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable-test', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test' },
  });
} finally { globalThis.fetch = healthOriginalFetch; }
assert.equal(healthyResponse.status, 200, 'health route must return success when variables and source table are accessible');
assert.equal((await healthyResponse.json()).ok, true);

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /credentials:\s*["']include["']/i, 'browser code must not call private ResaBP API using cross-origin credentials');
assert.doesNotMatch(html, /resabp\.com\/api\/apps/i, 'direct ResaBP API calls must be removed from the browser');
assert.match(html, /V104 — Pont explicite entre le moteur privé et les scripts d’extension/i, 'external add-ons need a bridge to private app bindings');
assert.match(html, /get selectedServiceDate\(\)\{ return selectedServiceDate; \}/, 'selectedServiceDate must be available to later inline extensions');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
assert.match(wrangler, /pages_build_output_dir\s*=\s*["']\.\/public["']/);
assert.ok(existsSync(new URL('../functions/api/health.js', import.meta.url)), 'health function must remain outside static output');
assert.ok(existsSync(new URL('../public/sw.js', import.meta.url)), 'service worker must be in the static output');
assert.ok(!html.includes('PUBLIC_BUILD_PLACEHOLDER'), 'placeholder guard');

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  RESABP_WEBHOOK_SECRET: 'long-test-secret',
};

let r = await onRequest({ request: new Request('https://plan.test/api/resabp'), env: {} });
assert.equal(r.status, 503, 'missing server configuration must be visible');

r = await onRequest({ request: new Request('https://plan.test/api/resabp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-resabp-webhook-secret': 'wrong' }, body: JSON.stringify({ id: 'r1' }) }), env });
assert.equal(r.status, 401, 'invalid webhook secret must be rejected');

const originalFetch = globalThis.fetch;
let sourceRequestHeaders = null;
let writeRequestHeaders = null;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'staff-user' }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/resabp_reservations?on_conflict=external_id')) { writeRequestHeaders = new Headers(options.headers || {}); return new Response('', { status: 201 }); }
  if (u.includes('/rest/v1/reservations?select=*')) { sourceRequestHeaders = new Headers(options.headers || {}); return new Response(JSON.stringify([{ id: 'r-42', date: '2026-10-09', first_name: 'Camille', last_name: 'Martin', guest_count: 4, time_slot: '19:30', area_name: 'RDC', status: 'confirmed' }]), { status: 200, headers: { 'content-type': 'application/json' } }); }
  throw new Error('Unexpected mocked fetch URL: ' + u);
};
try {
  r = await onRequest({ request: new Request('https://plan.test/api/resabp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-resabp-webhook-secret': env.RESABP_WEBHOOK_SECRET }, body: JSON.stringify({ type: 'UPSERT_RESERVATION', reservation: { id: 'r-42', date: '2026-10-09', first_name: 'Camille', last_name: 'Martin', guest_count: 4, time_slot: '19:30', area_name: 'RDC' } }) }), env });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).received, 1, 'valid webhook must acknowledge one reservation');
  assert.equal(writeRequestHeaders?.get('content-profile'), 'public', 'POST writes must explicitly target public schema');

  r = await onRequest({ request: new Request('https://plan.test/api/resabp?date=2026-10-09', { headers: { authorization: 'Bearer valid-session-token' } }), env });
  assert.equal(r.status, 200);
  const rows = await r.json();
  assert.equal(rows[0].id, 'r-42', 'database external id must be mapped to ResaBP id');
  assert.equal(rows[0].guest_count, 4);

  // New Supabase secret API keys are not JWTs; send them via apikey only.
  sourceRequestHeaders = null;
  const secretEnv = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
  r = await onRequest({ request: new Request('https://plan.test/api/resabp?date=2026-10-09', { headers: { authorization: 'Bearer valid-session-token' } }), env: secretEnv });
  assert.equal(r.status, 200, 'GET must accept SUPABASE_SECRET_KEY');
  assert.equal(sourceRequestHeaders?.get('apikey'), 'sb_secret_test');
  assert.equal(sourceRequestHeaders?.get('accept-profile'), 'public', 'GET must explicitly target public schema');
  assert.equal(sourceRequestHeaders?.get('authorization'), null, 'sb_secret_* must not be sent as Bearer JWT');
  console.log('OK — health route with explicit public schema, relay schema headers, private-scope bridge, CORS fallback guard, config, legacy and new Supabase admin keys, webhook secret, and authenticated GET mapping');
} finally {
  globalThis.fetch = originalFetch;
}
