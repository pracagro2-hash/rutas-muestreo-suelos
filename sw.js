/*
 * Service worker — funcionamiento sin internet.
 * - Aplicación y datos del plan: se guardan en caché al instalar y se actualizan en segundo plano.
 * - Mosaicos del mapa (satélite / calles): se guardan los que se visualizan, con un límite de cantidad.
 * - Base de datos (Supabase): nunca se guarda en caché.
 * Al publicar cambios en el código, incremente VERSION para que los celulares descarguen la versión nueva.
 */
const VERSION = "rutas-muestreo-v4-2026-10-07";
const CACHE_APP = `app-${VERSION}`;
const CACHE_TESELAS = "teselas-mapa";
const MAX_TESELAS = 4000;
const INGENIOS = ["incauca", "manuelita", "providencia", "castilla"];
const NUCLEO = [
  "./", "index.html", "manifest.webmanifest",
  "app/app.css", "app/app.js", "app/config.js", "app/logica.js", "app/almacen.js", "app/sync.js",
  "app/iconos/icono-192.png", "app/iconos/icono-512.png",
  ...INGENIOS.flatMap((i) => [`${i}.html`, `data/${i}.js`, `rutas_${i}.kml`]),
];
const EXTERNOS = ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE_APP);
    await c.addAll(NUCLEO);
    for (const u of EXTERNOS) {
      try { const r = await fetch(u, { mode: "cors" }); if (r.ok) await c.put(u, r); } catch (e) { /* se intentará al usarse */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("app-") && k !== CACHE_APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

const esTesela = (u) => /arcgisonline\.com\/.*\/tile\/|tile\.openstreetmap\.org\//.test(u);

async function recortarTeselas() {
  const c = await caches.open(CACHE_TESELAS);
  const claves = await c.keys();
  for (let i = 0; i < claves.length - MAX_TESELAS; i++) await c.delete(claves[i]);
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (/supabase\.(co|in)/.test(url)) return;                 // datos en vivo: siempre a la red

  if (esTesela(url)) {                                      // mosaicos: primero caché
    ev.respondWith((async () => {
      const c = await caches.open(CACHE_TESELAS);
      const enCache = await c.match(req);
      if (enCache) return enCache;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === "opaque") { await c.put(req, r.clone()); recortarTeselas(); }
        return r;
      } catch (e) { return new Response("", { status: 504 }); }
    })());
    return;
  }

  const propio = url.startsWith(self.location.origin) || EXTERNOS.includes(url) || url.startsWith("https://cdn.jsdelivr.net/npm/@supabase/");
  if (!propio) return;
  ev.respondWith((async () => {                             // aplicación: caché + actualización en segundo plano
    const c = await caches.open(CACHE_APP);
    const enCache = await c.match(req, { ignoreSearch: req.mode === "navigate" });
    const red = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    if (enCache) { ev.waitUntil(red); return enCache; }
    const r = await red;
    if (r) return r;
    if (req.mode === "navigate") return (await c.match("index.html")) || new Response("Sin conexión", { status: 503 });
    return new Response("", { status: 504 });
  })());
});
