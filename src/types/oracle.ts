// ============================================================================
// ANDROS — CONTRATO DEL ORÁCULO IA (BLOQUE 1: IA semántica real)
// Lo comparten `/api/oracle/route.ts` (servidor), `localInterpreter.ts`
// (respaldo sin clave) y `OracleModal.tsx` (cliente que ejecuta las acciones).
// ============================================================================

import { NodeArchetype } from "./workspace";

/** Todo lo que el Oráculo "ve" de un nodo para poder razonar sobre él. */
export interface OracleCanvasNodeSummary {
  id: string;
  type: NodeArchetype;
  title: string;
  codeTag: string;
  summary?: string;
  /** Solo archivos: nombre, extensión y peso. */
  fileName?: string;
  fileExtension?: string;
  fileSizeBytes?: number;
  fileStatus?: string;
  /** Solo modelos 3D ya abiertos en el visor: caja envolvente real en mm. */
  dimensionsMm?: { widthMm: number; depthMm: number; heightMm: number };
  /** Extracto de texto de cuadernos (bloques + checklist) y hojas de cálculo. */
  textExcerpt?: string;
  /** Ids de nodos conectados con este (en cualquier dirección). */
  connectedNodeIds: string[];
  position: { x: number; y: number };
}

export interface OracleCanvasConnectionSummary {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
}

/** "Lo que el Oráculo puede ver" del lienzo en el momento de la consulta. */
export interface OracleCanvasContext {
  nodes: OracleCanvasNodeSummary[];
  connections: OracleCanvasConnectionSummary[];
  selectedNodeId: string | null;
  /** Nodo elegido en el selector "Vincular a archivo / nodo" del Oráculo. */
  linkedNodeId?: string | null;
}

/** Zonas del ordenamiento humano del lienzo. */
export type OracleLayoutZone = 1 | 2 | 3;

/**
 * Acciones que el Oráculo puede pedirle al lienzo. Se ejecutan en vivo en
 * `OracleModal.tsx` contra las acciones `ai*` de `useWorkspaceStore.ts`.
 */
export type OracleAction =
  | {
      /** Crea un bloque de texto (cuaderno) y lo cablea al archivo/nodo referido. */
      type: "create_text_block";
      title: string;
      /**
       * Contenido en texto plano con marcas ligeras, una idea por línea:
       * "# Título", "- viñeta", "- [ ] tarea", "- [x] tarea hecha", o párrafo.
       */
      content: string;
      linkedNodeId?: string;
      connectionLabel?: string;
    }
  | {
      type: "connect_nodes";
      fromNodeId: string;
      toNodeId: string;
      label?: string;
    }
  | {
      /** Ordena el lienzo en 3 zonas de flujo de trabajo humano. */
      type: "apply_human_layout";
      /** Reclasificación opcional que propone la IA para nodos ambiguos. */
      assignments?: { nodeId: string; zone: OracleLayoutZone }[];
    }
  | {
      /** Añade o reemplaza el texto de un nodo existente. */
      type: "update_node_note";
      nodeId: string;
      content: string;
      mode?: "append" | "replace";
    }
  // --- Acciones heredadas (siguen funcionando por compatibilidad) ----------
  | {
      type: "create_node";
      nodeType?: NodeArchetype;
      title?: string;
      summary?: string;
    }
  | { type: "auto_layout" }
  | { type: "annotate_selected" };

/** Turno previo de la conversación con el Oráculo (memoria corta). */
export interface OracleHistoryTurn {
  role: "user" | "oracle";
  text: string;
}

/**
 * Modo de respuesta:
 *   · "canvas"   → el Oráculo actúa sobre el lienzo (acciones en vivo).
 *   · "document" → el Oráculo redacta/edita el documento del Estudio
 *                  (Markdown con títulos, listas, tablas y LaTeX) SIN tocar
 *                  el lienzo hasta que el usuario pulse "Añadir al lienzo".
 */
export type OracleMode = "canvas" | "document";

/** Documento en edición del Estudio del Oráculo. */
export interface OracleDocument {
  title: string;
  /** Markdown (GFM + LaTeX con $…$ y $$…$$). */
  markdown: string;
}

/** Fuente citable adjunta desde la Biblioteca (se numera en orden: [1], [2]…). */
export interface OracleReference {
  title: string;
  /** Cita IEEE completa (sin el número). */
  citation: string;
  url: string;
  doi?: string;
  abstract?: string;
}

export interface OracleRequestBody {
  prompt: string;
  /** Fuentes adjuntas que la IA debe citar como [n]. */
  references?: OracleReference[];
  context: OracleCanvasContext;
  history?: OracleHistoryTurn[];
  /** Por defecto "canvas" (compatibilidad). */
  mode?: OracleMode;
  /** Solo modo "document": borrador actual, para que la IA lo edite. */
  document?: OracleDocument | null;
}

/** Qué motor respondió: útil solo para mostrar un estado discreto en la UI. */
export type OracleEngine = "gemini" | "openai" | "local";

/** Problemas de configuración/servicio con un mensaje accionable para el usuario. */
export type OracleIssueCode =
  | "missing_key"
  | "invalid_key"
  | "rate_limited"
  | "overloaded"
  | "network"
  | "unavailable";

export interface OracleIssue {
  code: OracleIssueCode;
  message: string;
}

export interface OracleResponseBody {
  reply: string;
  actions: OracleAction[];
  engine: OracleEngine;
  /** Modelo exacto que respondió (p. ej. "gemini-3-flash-preview"). */
  model?: string;
  /** Solo modo "document": documento completo actualizado (o null si no cambió). */
  document?: OracleDocument | null;
  /** Presente si la IA externa no pudo responder (clave, cuota, saturación…). */
  issue?: OracleIssue;
}
