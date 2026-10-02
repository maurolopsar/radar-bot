// Service worker: la app funciona sin conexión (interfaz, última base de datos
// de radares guardada en IndexedDB y teselas de mapa ya vistas).
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const TILE_HOSTS = ['basemaps.cartocdn.com', 'tiles.openfreemap.org', 'server.arcgisonline.com', 'tiles.basemaps.cartocdn.com'];

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API propia y datos en vivo: siempre red.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Teselas, estilos y fuentes del mapa: caché primero, red en segundo plano.
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              cache.put(req, res.clone());
              if (Math.random() < 0.02) trimTiles();
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navegación: red primero, caché si no hay conexión.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Recursos estáticos (con hash): caché primero.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
