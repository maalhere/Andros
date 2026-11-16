// Andros — service worker mínimo. Hace la app instalable; no cachea datos
// (el lienzo vive en Supabase y en memoria), así nunca sirve contenido viejo.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Sin respuesta propia: el navegador resuelve la petición con la red.
});
