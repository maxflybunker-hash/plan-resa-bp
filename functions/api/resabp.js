/**
 * Cloudflare Pages Function: ResaBP -> Plan de Salle relay.
 * GET  /api/resabp?date=YYYY-MM-DD  requires a signed-in Plan user (Supabase JWT).
 * POST /api/resabp                requires x-resabp-webhook-secret from Base44.
 * Secrets are Cloudflare environment variables; never place them in index.html.
 */
// Source of truth: the real reservations table already populated by ResaBP/Base44.
const SOURCE_TABLE = 'reservations';
// Kept only for backwards-compatible POST ingestion; GET never reads this legacy table.
const LEGACY_INGEST_TABLE = 'resabp_reservations';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function envReadyForRead(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY));
}
function envReadyForWrite(env) {
  return envReadyForRead(env) && !!env.RESABP_WEBHOOK_SECRET;
}

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function supabaseUserIsValid(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;
  try {
    const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: 'Bearer ' + token },
    });
    return r.ok;
  } catch (_) { return false; }
}

function supabaseAdminKey(env) {
  return String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function supabaseHeaders(env, extra = {}) {
  const key = supabaseAdminKey(env);
  const headers = {
    apikey: key,
    'content-type': 'application/json',
    ...extra,
  };
  // The new Supabase sb_secret_* keys are API keys, not JWTs. Supabase rejects
  // them as Authorization: Bearer with "Invalid JWT". The legacy service_role
  // key is a JWT and still needs the Bearer header for backwards compatibility.
  if (key && !key.startsWith('sb_secret_')) headers.authorization = 'Bearer ' + key;
  return headers;
}

function cleanText(v, max = 2000) {
  if (v == null) return null;
  return String(v).trim().slice(0, max) || null;
}

// Base44 peut fournir une date simple (YYYY-MM-DD) ou un horodatage ISO.
// On conserve la date de service, sans la tronquer avant validation.
function normalizeDate(v) {
  if (v == null) return null;
  const match = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[Tt\s])/);
  return match ? match[1] : null;
}

function normalizeReservation(input) {
  const r = input?.reservation || input?.data?.reservation || input?.data || input?.record || input;
  if (!r || typeof r !== 'object') return null;
  const id = r.external_id ?? r.externalId ?? r.reservation_id ?? r.reservationId ?? r.id ?? r._id;
  if (id == null || String(id).trim() === '') return null;
  const rawStatus = cleanText(r.status ?? r.state ?? input?.status ?? input?.event, 80);
  const eventName = String(input?.type ?? input?.event_type ?? input?.event ?? '').toLowerCase();
  let status = rawStatus || 'confirmed';
  if (/cancel|annul|delete|supprim/.test(eventName)) status = 'cancelled';
  if (r.cancelled === true || r.canceled === true || r.deleted === true) status = 'cancelled';
  const name = cleanText(r.name ?? r.customer_name ?? r.guest_name, 200) || '';
  const firstName = cleanText(r.first_name ?? r.firstname ?? r.guest_first_name, 100) || (name ? name.split(/\s+/)[0] : null);
  const lastName = cleanText(r.last_name ?? r.lastname ?? r.guest_last_name, 100) || (name ? name.split(/\s+/).slice(1).join(' ') : null);
  const date = normalizeDate(r.date ?? r.reservation_date ?? r.service_date ?? r.start_at ?? r.datetime);
  const time = cleanText(r.time_slot ?? r.time ?? r.reservation_time ?? r.start_time, 30);
  const count = Number(r.guest_count ?? r.people ?? r.party_size ?? r.number_of_guests ?? r.guests);
  return {
    external_id: String(id).slice(0, 200),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    first_name: firstName,
    last_name: lastName,
    guest_count: Number.isFinite(count) && count > 0 ? Math.min(1000, Math.round(count)) : null,
    time_slot: time,
    phone: cleanText(r.phone ?? r.phone_number, 80),
    notes: cleanText(r.notes ?? r.note ?? r.comment ?? r.comments, 4000),
    area_name: cleanText(r.area_name ?? r.zone ?? r.area ?? r.requested_area, 120),
    area_id: cleanText(r.area_id ?? r.areaId, 200),
    status: status.toLowerCase(),
    payload: r,
    updated_at: new Date().toISOString(),
  };
}

function firstValue(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = obj[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return null;
}

function sourceObjects(row) {
  const objects = [row];
  for (const key of ['payload', 'data', 'details', 'reservation', 'booking', 'customer']) {
    const v = row && row[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) objects.push(v);
  }
  return objects;
}

function mapSourceReservation(row) {
  const objects = sourceObjects(row);
  const rawDate = firstValue(objects, [
    'date', 'reservation_date', 'reservationDate', 'date_reservation', 'booking_date',
    'bookingDate', 'service_date', 'serviceDate', 'start_at', 'startAt', 'datetime',
    'scheduled_at', 'event_date', 'dateReservation'
  ]);
  const date = normalizeDate(rawDate);
  const id = firstValue(objects, [
    'id', 'reservation_id', 'reservationId', 'external_id', 'externalId', 'uuid', '_id', 'base44_id'
  ]);
  const fullName = cleanText(firstValue(objects, [
    'name', 'full_name', 'fullName', 'customer_name', 'guest_name', 'client_name', 'nom_complet', 'nom'
  ]), 200) || '';
  const firstName = cleanText(firstValue(objects, [
    'first_name', 'firstName', 'firstname', 'guest_first_name', 'customer_first_name', 'prenom', 'prénom'
  ]), 100) || (fullName ? fullName.split(/\s+/)[0] : null);
  const lastName = cleanText(firstValue(objects, [
    'last_name', 'lastName', 'lastname', 'guest_last_name', 'customer_last_name', 'surname'
  ]), 100) || (fullName ? fullName.split(/\s+/).slice(1).join(' ') : null);
  const countValue = firstValue(objects, [
    'guest_count', 'guestCount', 'people', 'persons', 'party_size', 'partySize',
    'number_of_guests', 'numberOfGuests', 'number_of_people', 'numberOfPeople', 'guests', 'pax', 'couverts'
  ]);
  const count = Number(countValue);
  const rawStatus = cleanText(firstValue(objects, ['status', 'state', 'reservation_status', 'reservationStatus']), 80) || 'confirmed';
  const status = /cancel|annul|deleted|supprim/i.test(rawStatus) ? 'cancelled' : rawStatus.toLowerCase();
  return {
    id: id == null ? null : String(id),
    date,
    first_name: firstName,
    last_name: lastName,
    guest_count: Number.isFinite(count) && count > 0 ? Math.min(1000, Math.round(count)) : null,
    time_slot: cleanText(firstValue(objects, ['time_slot', 'timeSlot', 'time', 'reservation_time', 'reservationTime', 'start_time', 'startTime', 'heure']), 30),
    phone: cleanText(firstValue(objects, ['phone', 'phone_number', 'phoneNumber', 'telephone', 'téléphone']), 80),
    notes: cleanText(firstValue(objects, ['notes', 'note', 'comment', 'comments', 'message', 'special_requests', 'specialRequests', 'demande']), 4000),
    area_name: cleanText(firstValue(objects, ['area_name', 'areaName', 'zone', 'area', 'requested_area', 'requestedArea', 'room', 'room_name', 'roomName', 'salle']), 120),
    area_id: cleanText(firstValue(objects, ['area_id', 'areaId', 'zone_id', 'room_id', 'roomId']), 200),
    status,
    _hasDate: !!date,
  };
}

async function handleGet(request, env) {
  if (!await supabaseUserIsValid(request, env)) return json({ error: 'Authentification Plan de Salle requise.' }, 401);
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Paramètre date requis au format YYYY-MM-DD.' }, 400);

  // Read the existing source-of-truth table `public.reservations`, not the
  // legacy `resabp_reservations` table that the app never populates itself.
  const endpoint = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + SOURCE_TABLE + '?select=*&limit=5000';
  const response = await fetch(endpoint, { headers: supabaseHeaders(env) });
  if (!response.ok) {
    const raw = (await response.text()).slice(0, 1200);
    let upstream = null;
    try {
      const parsed = JSON.parse(raw);
      upstream = {
        code: cleanText(parsed.code, 80),
        message: cleanText(parsed.message || parsed.error_description || parsed.error, 350),
        hint: cleanText(parsed.hint, 250),
        details: cleanText(parsed.details, 350),
      };
    } catch (_) {
      upstream = { message: cleanText(raw, 500) };
    }
    return json({
      error: 'Lecture de public.reservations impossible.',
      upstream_status: response.status,
      upstream,
      detail: upstream?.message || 'Supabase REST a refusé la requête; vérifier les clés et les autorisations de table.'
    }, 502);
  }
  const storedRows = await response.json();
  if (!Array.isArray(storedRows)) return json({ error: 'La table public.reservations n’a pas renvoyé une liste de lignes.' }, 502);
  const mapped = storedRows.map(mapSourceReservation);
  const withDates = mapped.filter(r => r._hasDate);
  if (storedRows.length > 0 && withDates.length === 0) {
    const sampleKeys = Object.keys(storedRows[0] || {}).slice(0, 40);
    return json({
      error: 'Les réservations existent, mais aucune colonne de date reconnue n’a été trouvée dans public.reservations.',
      source_table: SOURCE_TABLE,
      row_count: storedRows.length,
      sample_columns: sampleKeys
    }, 422);
  }
  const rows = withDates.filter(r => r.date === date && r.id !== null);
  return json(rows.map(({_hasDate, ...r}) => r));
}

async function upsertOne(env, row) {
  const endpoint = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + LEGACY_INGEST_TABLE + '?on_conflict=external_id';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: supabaseHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error('Écriture Supabase refusée: ' + (await response.text()).slice(0, 300));
}

async function cancelById(env, externalId) {
  const endpoint = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + LEGACY_INGEST_TABLE +
    '?external_id=eq.' + encodeURIComponent(externalId);
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('Mise à jour annulation refusée: ' + (await response.text()).slice(0, 300));
}

async function handlePost(request, env) {
  const supplied = request.headers.get('x-resabp-webhook-secret') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(supplied, env.RESABP_WEBHOOK_SECRET)) return json({ error: 'Webhook non autorisé.' }, 401);
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Corps JSON invalide.' }, 400); }
  const list = Array.isArray(body?.reservations) ? body.reservations : Array.isArray(body?.data?.reservations) ? body.data.reservations : null;
  const inputs = list || [body];
  const rows = inputs.map(x => normalizeReservation(x)).filter(Boolean);
  if (!rows.length) return json({ error: 'Aucune réservation reconnue. Chaque élément doit avoir un identifiant (id ou reservation_id).' }, 400);
  try {
    for (const row of rows) {
      const isCancel = row.status === 'cancelled' || row.status === 'canceled' || row.status === 'annulée' || row.status === 'annulee';
      if (isCancel && !row.date && !row.first_name && !row.last_name && !row.guest_count && !row.time_slot) {
        await cancelById(env, row.external_id);
      } else {
        await upsertOne(env, row);
      }
    }
    return json({ ok: true, received: rows.length, ids: rows.map(r => r.external_id) });
  } catch (e) {
    return json({ error: 'Échec de stockage des réservations.', detail: String(e?.message || e).slice(0, 500) }, 502);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-resabp-webhook-secret' } });
  if (request.method === 'GET' && !envReadyForRead(env)) return json({ error: 'Relais de lecture non configuré : vérifier SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY historique) dans Cloudflare.' }, 503);
  if (request.method === 'POST' && !envReadyForWrite(env)) return json({ error: 'Relais de réception non configuré : vérifier aussi RESABP_WEBHOOK_SECRET dans Cloudflare.' }, 503);
  try {
    if (request.method === 'GET') return await handleGet(request, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json({ error: 'Méthode non autorisée.' }, 405);
  } catch (e) {
    return json({ error: 'Erreur interne du relais.', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
}
