// ============================================================================
// ANDROS — CONTRATO DE ANDROS ARENA (Sprint 3 · Módulo B)
// Publicaciones (empleos, prácticas, actividades y retos) con etiquetas
// generadas por IA, y postulaciones con un espacio de Andros como portafolio.
// Lo comparten `/api/arena/analyze-post`, `ArenaModal` y `supabase/schema.sql`.
// ============================================================================

import type { NodeArchetype } from "./workspace";

export type ArenaPostType = "job" | "internship" | "activity" | "challenge";

export const ARENA_TYPES: ArenaPostType[] = ["challenge", "activity", "internship", "job"];

export const ARENA_TYPE_LABELS: Record<ArenaPostType, string> = {
  job: "Empleo",
  internship: "Prácticas",
  activity: "Actividad",
  challenge: "Reto",
};

/** Catálogo cerrado de disciplinas (la IA solo puede elegir de aquí). */
export const ARENA_DISCIPLINES = [
  "Mecánica",
  "Software",
  "Civil",
  "Eléctrica",
  "Aeroespacial",
  "Impresión 3D",
  "IA",
  "Química",
  "Industrial",
  "Biomédica",
] as const;
export type ArenaDiscipline = (typeof ARENA_DISCIPLINES)[number];

export const ARENA_LEVELS = ["Estudiante", "Prácticas", "Junior", "Senior"] as const;
export type ArenaLevel = (typeof ARENA_LEVELS)[number];

export interface ArenaTags {
  type: ArenaPostType;
  discipline: ArenaDiscipline[];
  level: ArenaLevel[];
  /** Habilidades normalizadas ("CAD", "FEA", "Next.js", "MATLAB"…). */
  skills: string[];
}

/** Veredicto del filtro de seguridad y calidad. */
export type ArenaModerationStatus = "approved" | "needs_review" | "rejected";

export interface ArenaModeration {
  status: ArenaModerationStatus;
  /** 0–100: qué tan completa y clara es la publicación. */
  qualityScore: number;
  /** Problemas concretos (spam, faltan datos, contenido inapropiado…). */
  issues: string[];
  /** Sugerencias para mejorar la publicación. */
  suggestions: string[];
}

/** Motor que generó las etiquetas: Gemini o el etiquetador determinista. */
export type ArenaTagEngine = "gemini" | "keywords";

export interface ArenaPost {
  id: string;
  type: ArenaPostType;
  title: string;
  organization: string;
  description: string;
  stipend?: string;
  location?: string;
  tags: ArenaTags;
  moderation: ArenaModeration;
  engine: ArenaTagEngine;
  createdAt: string;
  /** Nombre visible de quien publicó. */
  authorName?: string;
  /** Publicación de ejemplo incluida con Andros (claramente marcada). */
  isExample?: boolean;
  /** Guardada solo en este navegador (sin nube o sin tablas). */
  isLocal?: boolean;
}

/** Filtros que se aplican en la base de datos (además del filtrado en el cliente). */
export interface ArenaFilterQuery {
  text?: string;
  type?: ArenaPostType;
  discipline?: ArenaDiscipline;
  level?: ArenaLevel;
}

/** Datos que se envían a `/api/arena/analyze-post`. */
export interface ArenaPostDraft {
  type: ArenaPostType;
  title: string;
  organization: string;
  description: string;
  stipend?: string;
  location?: string;
}

export interface ArenaAnalyzeResponse {
  tags: ArenaTags;
  moderation: ArenaModeration;
  engine: ArenaTagEngine;
  model?: string;
  /** Aviso si se usó el respaldo (Gemini saturado, sin clave…). */
  notice?: string;
}

// ----------------------------------------------------------------------------
// Portafolio: instantánea verificable de un espacio de trabajo
// ----------------------------------------------------------------------------

export interface PortfolioSnapshotNode {
  /** Título del nodo (recortado). */
  t: string;
  type: NodeArchetype;
  x: number;
  y: number;
  /** Extensión del archivo (solo file-node), p. ej. "stl". */
  ext?: string;
}

export interface PortfolioSnapshot {
  workspaceName: string;
  nodeCount: number;
  connectionCount: number;
  countsByType: Partial<Record<NodeArchetype, number>>;
  has3D: boolean;
  hasCodeLab: boolean;
  hasAi: boolean;
  hasCitations: boolean;
  /** Hasta 40 nodos con su posición, para dibujar el mini-lienzo. */
  nodes: PortfolioSnapshotNode[];
  /** Cables como pares de índices de `nodes`. */
  links: [number, number][];
  capturedAt: string;
}

export interface ArenaSubmission {
  id: string;
  postId: string;
  workspaceId?: string | null;
  note: string;
  applicantName: string;
  snapshot: PortfolioSnapshot;
  createdAt: string;
  /** Visible en la galería pública de soluciones de la publicación. */
  isPublic: boolean;
  isExample?: boolean;
  isLocal?: boolean;
}
