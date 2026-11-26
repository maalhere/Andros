# Andros v1.0

**Andros** es un lienzo espacial colaborativo que funciona como **Entorno de Datos Común (CDE) centrado en equipos**: cada espacio reúne tarjetas, cables, chat con `@menciones`, fichas de resolución Rojo / Verde, alertas unificadas y calendarios externos, con edición en vivo, voz, cámara y pantalla compartida. Sobre esa base, el **Modo Experto de Ingeniería** añade visor 3D, fórmulas LaTeX reactivas, CodeLab e impresión 3D en red.

Se distribuye como web (PWA) y como app de escritorio para Windows (Electron).

| Plan | Precio | Límites aplicados en código |
| --- | --- | --- |
| **Plan Básico** | $0 | 2 espacios · 3 participantes en vivo por espacio · 1 plantilla propia · 15 consultas IA/día (ilimitadas con clave propia) |
| **Andros Pro** | $5.99 USD/mes o $49.99 USD/año | Espacios y plantillas ilimitados · 6 participantes en vivo · 150 consultas IA/día · Modo Experto completo |

La fuente única de precios y límites es [`src/lib/billing/planLimits.ts`](src/lib/billing/planLimits.ts); `npm run verify:billing` comprueba que la interfaz, el servidor, el SQL y los textos legales coinciden con ella.

---

## Stack técnico

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 16 (App Router, Route Handlers, `cacheComponents`) |
| UI | React 19, TypeScript estricto, Tailwind CSS 4, framer-motion, Lucide |
| Estado | Zustand (un store por dominio en `src/store/`) |
| Backend | Supabase: Auth (Google OAuth), Postgres con RLS, Storage, Realtime (Presence + Broadcast) |
| Tiempo real | Supabase Realtime + WebRTC en malla (voz, cámara, pantalla) con STUN/TURN |
| IA | Gemini en el servidor (cuota por plan) o clave propia del usuario (BYOK) |
| Pagos | Lemon Squeezy como Merchant of Record (checkout + webhooks firmados) |
| Correo | Resend (avisos al compartir espacios) |
| Escritorio | Electron 45 + electron-builder (instalador NSIS de Windows) |
| Exportación | docx, pptxgenjs, jszip, KaTeX |

## Estructura de carpetas

```
.
├── src/
│   ├── app/                 Rutas de Next.js: página principal, legales (/privacidad,
│   │   │                    /terminos, /cookies, /reembolsos), Vista Invitado (/ver/[token])
│   │   └── api/             Route Handlers (solo servidor)
│   │       ├── ai/          Nodos IA e importación de chats
│   │       ├── oracle/      Oráculo, generador de tableros, fórmulas, impacto, CDE, exportación
│   │       ├── billing/     checkout · webhook · portal (Sprint 21)
│   │       ├── calendar/    Exportar/importar hitos a calendarios externos
│   │       ├── printer/     Puente HTTP a impresoras en red (solo en local)
│   │       ├── link-preview/ library/ arena/ workspaces/
│   ├── components/          UI por dominio (desktop/, mobile/, nodes/, cde/, collab/, legal/…)
│   ├── hooks/               useCloudSync (motor de nube), atajos, sincronizaciones
│   ├── lib/                 Lógica pura y clientes por dominio
│   │   ├── billing/         Planes, límites, pasarela, plan del servidor, puertas de acceso
│   │   ├── ai/              Proveedores, cuota diaria (cliente y servidor)
│   │   ├── collab/          Sala en vivo: presencia, sincronía del lienzo, WebRTC
│   │   ├── cde/             Áreas, menciones, alertas, fichas de resolución
│   │   ├── net/             Anti-SSRF (safeFetch, publicAddress) y rate limiting
│   │   ├── printer(s)/      Adaptadores de impresoras, guardián del puente, validación RFC 1918
│   │   └── supabase/        Clientes de navegador y servidor (getRequestUser, getServiceClient)
│   ├── store/               Stores de Zustand
│   └── types/               Contratos compartidos (workspace, collab, forms…)
├── supabase/
│   ├── schema.sql           Esquema completo e idempotente (tablas, RLS, funciones, triggers)
│   └── arena.sql            Datos y políticas de Andros Arena
├── electron/                Proceso principal, preload (puente IPC), barra de título, build de impresoras
└── scripts/                 Verificadores sin red ni navegador (npm run verify:*)
```

## Arquitectura de seguridad

- **RLS en todas las tablas.** Cada consulta del navegador pasa por las políticas de Postgres. Los permisos de espacios compartidos (dueño / Editor / Comentarista / Solo lectura) se resuelven con funciones `SECURITY DEFINER` (`is_workspace_member`, `can_edit_workspace`, `can_comment_workspace`) sin acceso anónimo. Autor, nombre y área de comentarios y mensajes del chat los rellena un trigger desde la sesión, nunca el navegador.
- **Salas privadas de Realtime.** Los canales son siempre `private`: solo entran miembros del espacio que pasan las políticas de `realtime.messages` (§8b del esquema). Lo recibido en vivo solo provoca una relectura con la RLS propia; nada se guarda «por otro».
- **Suscripciones a prueba de manipulación.** `user_subscriptions` solo admite `SELECT` de la fila propia; `INSERT/UPDATE/DELETE` están revocados para `anon` y `authenticated`. Únicamente el webhook firmado escribe con `service_role`. Los topes se aplican también en la base: trigger `workspaces_enforce_plan_limit` (máx. 2 espacios en Plan Básico) y `workspace_live_cap()` (3 / 6 personas en vivo según el plan del dueño).
- **Webhooks firmados.** `/api/billing/webhook` valida `X-Signature` (HMAC-SHA256 con `LEMONSQUEEZY_WEBHOOK_SECRET`) sobre el cuerpo crudo, con comparación en tiempo constante (`timingSafeEqual`), antes de parsear el JSON.
- **Anti-SSRF.** `/api/link-preview` usa `safeFetch`: resuelve el DNS antes de conectar, valida la IP real en el `lookup` (frena el DNS rebinding), solo http/https en 80/443, redirecciones manuales revalidadas y límites de tiempo y tamaño.
- **Puente de impresoras.** Las rutas HTTP de impresora están apagadas por defecto (`ANDROS_LOCAL_PRINTER_BRIDGE=1` solo en local, nunca en el alojamiento de producción), exigen la cabecera `X-Andros-Bridge`, `Origin` igual a `Host` y destino RFC 1918. La app de Windows usa un puente IPC nativo (`preload.cjs`).
- **Cuota IA en el servidor.** La clave del servidor cuenta por persona (`user:<id>`) con el tope de su plan leído de Supabase; sin sesión cae a la IP con margen. Las claves propias (BYOK) solo viven en `localStorage` y viajan en la petición que las usa.
- **Cabeceras** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `X-Frame-Options: SAMEORIGIN` en todas las rutas (`next.config.ts`).
- **Privacidad por defecto.** Analítica opcional solo tras «Aceptar todas»; Andros nunca recibe datos de tarjeta.

## Variables de entorno

Crea `.env.local` en la raíz para desarrollo y configura las mismas variables en tu proveedor de alojamiento para producción. Nunca subas valores reales al repositorio (`.env*` está en `.gitignore`). Las variables `NEXT_PUBLIC_*` llegan al navegador; el resto son **solo de servidor**.

| Variable | Ámbito | Obligatoria | Uso |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador + servidor | Sí (para nube) | URL del proyecto de Supabase. Sin ella la app funciona en modo local. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Navegador + servidor | Sí (para nube) | Clave pública (o `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Servidor | Para pagos y correos | Escribe `user_subscriptions` desde el webhook y lee el correo del destinatario al compartir. |
| `GEMINI_API_KEY` | Servidor | Para la IA incluida | Clave de la IA del servidor (cuota 15/150 al día por plan). |
| `GEMINI_MODEL` | Servidor | No | Modelo de Gemini alternativo. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Servidor | No | Respaldo opcional del Oráculo. |
| `LEMONSQUEEZY_API_KEY` | Servidor | Para cobrar | API de la pasarela (checkout y portal). |
| `LEMONSQUEEZY_STORE_ID` | Servidor | Para cobrar | Id numérico de la tienda. |
| `LEMONSQUEEZY_VARIANT_MONTHLY` | Servidor | Para cobrar | Id de la variante $5.99/mes. |
| `LEMONSQUEEZY_VARIANT_ANNUAL` | Servidor | Para cobrar | Id de la variante $49.99/año. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Servidor | Para cobrar | Secreto de firma del webhook (≥ 16 caracteres). |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Servidor | No | Correos «te compartieron un espacio». |
| `YOUTUBE_API_KEY` | Servidor | No | Metadatos de videos en la Biblioteca. |
| `NEXT_PUBLIC_TURN_URL` / `_USERNAME` / `_CREDENTIAL` | Navegador | No | Servidor TURN para voz y pantalla en redes móviles. |
| `NEXT_PUBLIC_SITE_URL` | Navegador + servidor | En producción | Origen público (enlaces de correo y retorno del pago). |
| `NEXT_PUBLIC_CLARITY_ID`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` | Navegador | No | Analítica opcional (solo con consentimiento). |
| `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` | Navegador | No | Enlace de descarga del instalador de Windows. |
| `ANDROS_LOCAL_PRINTER_BRIDGE` | Servidor (local) | No | `1` habilita las rutas HTTP de impresora en `npm run dev`. |
| `ANDROS_URL` | Electron | No | URL que carga la app de escritorio (por defecto, producción). |

Sin las variables `LEMONSQUEEZY_*`, `/api/billing/checkout` responde `503` y la interfaz muestra «Los pagos se activarán muy pronto»: la app sigue funcionando con el Plan Básico.

### Activar los pagos

1. Ejecuta `supabase/schema.sql` completo en el SQL Editor de Supabase (es idempotente).
2. En Lemon Squeezy crea un producto con dos variantes de suscripción: $5.99/mes y $49.99/año.
3. Crea un webhook hacia `https://<tu-dominio>/api/billing/webhook` con los eventos `subscription_created`, `subscription_updated`, `subscription_cancelled` y `subscription_expired`.
4. Configura las cinco variables `LEMONSQUEEZY_*` y `SUPABASE_SERVICE_ROLE_KEY` en producción y vuelve a desplegar.

## Desarrollo

```bash
npm install
npm run dev            # http://localhost:3000
npm run lint
npm run build          # compilación de producción (incluye verificación de tipos)
```

### Verificaciones (sin red, sin navegador, sin Supabase)

| Comando | Qué comprueba |
| --- | --- |
| `npm run verify:billing` | Precios, límites Básico/Pro y su aplicación, cuota IA por plan, HMAC del webhook, respuesta 503 sin pasarela y esquema §21 |
| `npm run verify:brand` | Higiene de marcas de terceros en los textos visibles |
| `npm run verify:cde` | Menciones, alertas unificadas, fichas Rojo / Verde y arranque en 3 pasos |
| `npm run verify:collab` | Sala en vivo, calendarios externos (incluye `verify:microsoft`) |
| `npm run verify:export` | Exportación PDF / .docx / .pptx y resumen |
| `npm run verify:formulas` | Fórmulas LaTeX reactivas |
| `npm run verify:printers` | Adaptadores de impresoras, guardián del puente, anti-SSRF y telemetría |

### App de escritorio (Windows)

```bash
npm run desktop:dev    # Electron contra http://localhost:3000
npm run desktop:build  # Compila el puente de impresoras y genera el instalador en dist-desktop/
```

La app instalada carga la web de producción y añade el puente nativo de impresoras; no empaqueta Next.js.

## Licencia y marcas

Código privado. Las marcas de terceros mencionadas en la documentación pertenecen a sus titulares y se citan solo por interoperabilidad técnica.
