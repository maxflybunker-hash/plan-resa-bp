import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/resabp.js';
import { onRequest as healthHandler } from '../functions/api/health.js';
import { readFileSync } from 'node:fs';

const healthResponse = await healthHandler({ request: new Request('https://plan.test/api/health'), env: {} });
assert.equal(healthResponse.status, 503, 'health route must run and report missing environment variables');
assert.deepEqual((await healthResponse.json()).missingEnvironmentVariables, ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

const healthyResponse = await healthHandler({
  request: new Request('https://plan.test/api/health'),
  env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable-test', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test' },
});
assert.equal(healthyResponse.status, 200, 'health route must return success with required environment variables');
assert.equal((await healthyResponse.json()).ok, true);

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /credentials:\s*["']include["']/i, 'browser code must not call private ResaBP API using cross-origin credentials');
assert.doesNotMatch(html, /resabp\.com\/api\/apps/i, 'direct ResaBP API calls must be removed from the browser');

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
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'staff-user' }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/resabp_reservations?on_conflict=external_id')) return new Response('', { status: 201 });
  if (u.includes('/rest/v1/reservations?select=*')) return new Response(JSON.stringify([{ id: 'r-42', date: '2026-10-09', first_name: 'Camille', last_name: 'Martin', guest_count: 4, time_slot: '19:30', area_name: 'RDC', status: 'confirmed' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error('Unexpected mocked fetch URL: ' + u);
};
try {
  r = await onRequest({ request: new Request('https://plan.test/api/resabp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-resabp-webhook-secret': env.RESABP_WEBHOOK_SECRET }, body: JSON.stringify({ type: 'UPSERT_RESERVATION', reservation: { id: 'r-42', date: '2026-10-09', first_name: 'Camille', last_name: 'Martin', guest_count: 4, time_slot: '19:30', area_name: 'RDC' } }) }), env });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).received, 1, 'valid webhook must acknowledge one reservation');

  r = await onRequest({ request: new Request('https://plan.test/api/resabp?date=2026-10-09', { headers: { authorization: 'Bearer valid-session-token' } }), env });
  assert.equal(r.status, 200);
  const rows = await r.json();
  assert.equal(rows[0].id, 'r-42', 'database external id must be mapped to ResaBP id');
  assert.equal(rows[0].guest_count, 4);
  console.log('OK — health route, CORS fallback guard, configuration guard, webhook secret, and authenticated GET mapping from public.reservations');
} finally {
  globalThis.fetch = originalFetch;
}
