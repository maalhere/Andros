# REGLAS DEL PROYECTO ANDROS (OPERADOR FÍSICO)
- Stack real del proyecto: Next.js 16.4.6 (App Router), React, TypeScript estricto, Tailwind CSS 4.3.3 y Zustand.
- Sistema de Diseño Dual-Engine:
  - Modo Claro (Paper Modernist): fondo #F6F5F2, tarjetas #FFFFFF, texto #1A1A18, acento #C95A3B, éxito #4F6B58.
  - Modo Oscuro (Obsidian Monolith): fondo #0D0E11, tarjetas #16181D, texto #EDEDEF, acento #3B82F6, éxito #10B981.
- Arquitectura Dual Viewport:
  - Desktop (>= 768px): Lienzo espacial infinito 2D con cables Bézier y Floating HUD Dock.
  - Mobile (< 768px): Pila de tarjetas táctiles (TacticalCardStack), barra inferior ThumbZoneBar y cajones deslizables (MobileBottomSheet).
- Regla para el asistente: El usuario actúa como operador físico. Edita o crea los archivos directamente en `src/` de forma completa, ejecuta `npm run build` o verificación de TypeScript para asegurar que no queden errores, y no hagas preguntas técnicas abiertas.

## REGLAS PERMANENTES: LEGAL, ACCESIBILIDAD E INTERFAZ (no romper nunca)

### Legal y contenido
- Nada de imágenes sin atribución o con derechos de autor. Solo recursos propios (AndrosMark, SVG/Lucide) o con licencia explícita.
- Todo `<img>` lleva `alt` descriptivo en español (p. ej. `Miniatura de «título»`). Nunca `alt=""`.
- Prohibido en la UI: reseñas o testimonios inventados, cifras de usuarios falsas y promesas que la app no cumple. Los datos de ejemplo se marcan como «ejemplo».
- Formularios públicos (Arena publicar/postular, contacto): casilla de consentimiento SIN marcar (`ConsentCheckbox`), validación en línea por campo y confirmación visible. Pedir solo los datos imprescindibles.
- Analítica opcional solo tras «Aceptar todas» (`AnalyticsGate` + `src/lib/consent.ts`). Las claves IA (BYOK) nunca salen de localStorage salvo en la petición que las usa.
- Correo y dominio públicos solo en `src/lib/site.ts`. Si cambia un flujo de datos, actualizar `/privacidad` y `/cookies`.

### Accesibilidad (WCAG AA en ambos motores)
- Texto ≥ 4.5:1. Usar `text-andros-accent-ink` para acento como TEXTO y `bg-andros-accent-fill` para fondos sólidos con texto blanco. `text-andros-accent` / `bg-andros-accent` solo para decoración, bordes y anillos.
- Errores: `text-andros-danger`; avisos: `text-andros-warning`. Nunca `text-red-500` ni `text-amber-500` (fallan en Paper Modernist).
- Todo botón solo-icono lleva `aria-label` en español. Diálogos con `role="dialog"`/`aria-modal` y cierre con Escape.
- Objetivos táctiles ≥ 44×44 px en móvil (`w-11 h-11 md:w-9 md:h-9`); asas pequeñas del lienzo con `hit-slop`.
- Respetar `prefers-reduced-motion` y el ajuste «Animaciones reducidas» (`springOrInstant(reduced)` de `src/lib/motion.ts`).

### Interfaz
- Radio interior = radio exterior − padding (p. ej. contenedor `rounded-xl` 12px con `p-1` → hijo `rounded-lg` 8px).
- `tabular-nums` + monoespaciada SOLO en telemetría, medidas (mm), conteos, zoom y atajos (`<Kbd>`). Nunca en prosa.
- `text-wrap: balance` en titulares (global en h1–h3).
- Movimiento: resorte interrumpible `SPRING_SNAPPY` (stiffness 450, damping 32, mass 0.8); pulsación táctil `active:scale-[0.96]`. Sin animaciones bloqueantes > 400 ms.
- Borrados destructivos con «Deshacer» (`src/lib/canvas/undoable.ts` + Toaster). Envíos con `useSubmitGuard` (sin duplicados por doble clic).
- Atajos: ⌘K/Ctrl+K paleta de comandos; letras solo en escritorio (`src/hooks/useGlobalShortcuts.ts`). Pistas `<Kbd>` solo en escritorio.
- Iconos Lucide con el trazo por defecto (2); nada de cursivas decorativas, insignias de relleno ni etiquetas redundantes.