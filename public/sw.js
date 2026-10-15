/* V133 — mise à jour automatique de l'application installée. */
const CACHE = 'plan-salle-v133-auto-update';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (path) => {
      const url = new URL(path, self.registration.scope).href;
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`Préchargement impossible : ${path}`);
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('plan-salle-') && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Les données et authentifications doivent toujours aller directement au serveur.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Pour la page et les ressources locales : réseau d'abord pour prendre la version
  // déployée, cache uniquement en secours si l'appareil est hors ligne.
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response && response.ok && response.type !== 'opaque') {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return new Response(
          '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan de Salle</title><body style="font:16px system-ui;padding:24px;background:#14161b;color:#fff"><h1>Plan de Salle</h1><p>Impossible de charger la version hors ligne. Reconnecte-toi puis rouvre l’application.</p></body></html>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      throw error;
    }
  })());
});
