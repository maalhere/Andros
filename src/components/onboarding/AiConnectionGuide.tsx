"use client";

import React from "react";
import { ArrowRight, BookOpen, Box, Code2, FileText, KeyRound, RefreshCw, Sparkles } from "lucide-react";

// ============================================================================
// ANDROS — CÓMO CONECTAR MODELOS DE IA (contenido compartido)
// Lo usan el tutorial (paso 4) y la guía de atajos (pestaña «Cómo conectar
// modelos de IA»). Todo lo que se afirma aquí existe en la app:
//   · ⋯ → «Claves IA propias»  → AiKeysModal
//   · + Agregar → «Nuevo Nodo IA» / «Importar chat»  → quickAdd
//   · Cables de entrada (from → to) → contextGraph (aguas arriba, con ciclos
//     controlados) y pastilla «Contexto actualizado · Resincronizar».
// ============================================================================

export const AI_CONNECTION_STEPS: { title: string; body: string }[] = [
  {
    title: "Claves IA (opcional)",
    body: "En ⋯ → Claves IA propias añade la clave del proveedor de IA que uses. La IA incluida en Andros funciona sin clave propia si esta instalación la trae; los demás proveedores piden la tuya. Las claves se quedan en tu navegador.",
  },
  {
    title: "Crea un Nodo IA o importa un chat",
    body: "En + Agregar elige «Nuevo Nodo IA» y escoge el modelo, o «Importar chat» para traer una conversación de un chat de IA externo.",
  },
  {
    title: "Cablea en dirección de entrada",
    body: "Une Archivo 3D, Nota, CodeLab o una fuente de la Biblioteca hacia el Nodo IA. También puedes unir un Nodo IA A con un Nodo IA B: B recibe el resumen y los últimos mensajes de A, aunque sean modelos distintos.",
  },
  {
    title: "Contexto vivo",
    body: "Si cambia un nodo conectado, el Nodo IA muestra «Contexto actualizado · Resincronizar». Púlsalo para que vuelva a evaluar con lo nuevo (usa una llamada a la IA).",
  },
];

const Chip: React.FC<{ icon: React.ReactNode; children: React.ReactNode; tone?: "plain" | "ai" }> = ({
  icon,
  children,
  tone = "plain",
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-medium ${
      tone === "ai"
        ? "border-andros-accent bg-andros-accent/10 text-andros-accent-ink"
        : "border-andros-border bg-andros-card text-andros-primary"
    }`}
  >
    <span aria-hidden="true">{icon}</span>
    {children}
  </span>
);

const Arrow: React.FC = () => (
  <ArrowRight className="w-3.5 h-3.5 shrink-0 text-andros-muted" aria-hidden="true" />
);

/** Mini-diagrama: fuentes → Nodo IA (modelo A) → Nodo IA (modelo B). */
export const AiConnectionDiagram: React.FC = () => (
  <figure
    className="rounded-2xl border border-andros-border bg-andros-canvas p-3"
    aria-label="Diagrama: Archivo 3D, Nota, CodeLab y Biblioteca se conectan a un Nodo IA, que a su vez se conecta a otro Nodo IA"
  >
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      <div className="flex flex-col gap-1">
        <Chip icon={<Box className="w-3 h-3" />}>Archivo 3D</Chip>
        <Chip icon={<FileText className="w-3 h-3" />}>Nota</Chip>
        <Chip icon={<Code2 className="w-3 h-3" />}>CodeLab</Chip>
        <Chip icon={<BookOpen className="w-3 h-3" />}>Biblioteca</Chip>
      </div>
      <Arrow />
      <Chip tone="ai" icon={<Sparkles className="w-3 h-3" />}>
        Nodo IA · modelo A
      </Chip>
      <Arrow />
      <Chip tone="ai" icon={<Sparkles className="w-3 h-3" />}>
        Nodo IA · modelo B
      </Chip>
    </div>
    <figcaption className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-andros-muted">
      <span className="inline-flex items-center gap-1 rounded-md bg-andros-accent-fill px-1.5 py-0.5 font-semibold text-white">
        <RefreshCw className="w-3 h-3" aria-hidden="true" />
        Contexto actualizado · Resincronizar
      </span>
      aparece cuando algo conectado cambia.
    </figcaption>
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-andros-muted">
      <KeyRound className="w-3 h-3 shrink-0" aria-hidden="true" />
      Claves opcionales en ⋯ → Claves IA.
    </p>
  </figure>
);
