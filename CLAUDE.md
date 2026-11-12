# REGLAS DEL PROYECTO ANDROS (OPERADOR FÍSICO)
- Stack real del proyecto: Next.js 16.4.3 (App Router), React, TypeScript estricto, Tailwind CSS 4.3.3 y Zustand.
- Sistema de Diseño Dual-Engine:
  - Modo Claro (Paper Modernist): fondo #F6F5F2, tarjetas #FFFFFF, texto #1A1A18, acento #C95A3B, éxito #4F6B58.
  - Modo Oscuro (Obsidian Monolith): fondo #0D0E11, tarjetas #16181D, texto #EDEDEF, acento #3B82F6, éxito #10B981.
- Arquitectura Dual Viewport:
  - Desktop (>= 768px): Lienzo espacial infinito 2D con cables Bézier y Floating HUD Dock.
  - Mobile (< 768px): Pila de tarjetas táctiles (TacticalCardStack), barra inferior ThumbZoneBar y cajones deslizables (MobileBottomSheet).
- Regla para el asistente: El usuario actúa como operador físico. Edita o crea los archivos directamente en `src/` de forma completa, ejecuta `npm run build` o verificación de TypeScript para asegurar que no queden errores, y no hagas preguntas técnicas abiertas.