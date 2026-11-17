// Andros — service worker. Hace la app instalable (Windows, macOS, Android,
// iOS) SIN cachear datos: el lienzo vive en Supabase y en memoria, así que
// nunca se sirve contenido viejo. Solo si no hay conexión al abrir la app,
// muestra una pantalla amable de "Sin conexión" en vez del error del navegador.

const OFFLINE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Andros — Sin conexión</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #F6F5F2; color: #1A1A18; }
  @media (prefers-color-scheme: dark) { body { background: #0D0E11; color: #EDEDEF; } }
  main { max-width: 360px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; opacity: .75; margin: 0 0 20px; }
  button { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 10px; border: 0;
    background: #C95A3B; color: #fff; cursor: pointer; }
  @media (prefers-color-scheme: dark) { button { background: #3B82F6; } }
</style>
</head>
<body>
<main>
  <h1>Sin conexión</h1>
  <p>Andros necesita internet para abrir tu lienzo. Revisa tu conexión y vuelve a intentarlo.</p>
  <button onclick="location.reload()">Reintentar</button>
</main>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Solo las navegaciones (abrir la app / recargar). El resto va directo a la red.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ),
  );
});
