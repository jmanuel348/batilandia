/* =========================================================
   BATILANDIA — trabajador de servicio
   Sirve para dos cosas:
     1. Que el teléfono deje guardar el sitio como app.
     2. Que si se cae la señal, el menú siga abriendo.

   Nunca guarda los pedidos: esos van derecho a la red.
   ========================================================= */

/* Subir el número limpia el caché viejo en todos los teléfonos */
const CACHE = "batilandia-v2";

/* Lo mínimo para que el sitio abra sin señal */
const BASICOS = [
  "./",
  "./index.html",
  "./datos.json",
  "./icono-192.png",
  "./icono-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      /* si alguno falla, que no se caiga la instalación entera */
      .then(c => Promise.allSettled(BASICOS.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  /* Los pedidos y el ranking de populares nunca se guardan:
     tienen que hablar con el servidor de verdad, siempre. */
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  /* Primero la red, y si no hay, lo guardado. Así los cambios que
     publicás desde el panel se ven enseguida, pero sin señal el
     cliente igual puede mirar el menú. */
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r && r.status === 200 && r.type === "basic"){
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return r;
      })
      /* ignoreSearch: «datos.json?v=123» y «datos.json» son lo mismo */
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html")))
  );
});
