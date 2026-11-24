// ============================================================================
// ANDROS — ENLACE PÚBLICO «VISTA INVITADO» (solo lectura, sin cuenta)
//
//   · El dueño activa el enlace: se genera un token aleatorio de 192 bits en
//     su navegador y se guarda en `workspaces.public_share_token` (RLS + el
//     disparador `workspaces_guard_public_share` impiden que otro lo cambie).
//   · Quien abre `/ver/<token>` llama a la función `get_public_workspace`
//     (SECURITY DEFINER, solo lectura): sin login, sin Realtime, sin WebRTC.
//   · Desactivar el enlace lo apaga al instante; «Generar enlace nuevo»
//     reemplaza el token y el anterior deja de funcionar.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineeringNodeData, NodeArchetype, NodeConnection } from "@/types/workspace";
import {
  createEmptyAiChatPayload,
  createEmptyCalcLatexPayload,
  createEmptyCodeLabPayload,
  createEmptyFilePayload,
  createEmptyResourceLinkPayload,
  createEmptySketchNotePayload,
} from "@/store/useWorkspaceStore";
import { sanitizeFormSheet } from "@/lib/forms/formSchema";
import { sanitizeFormulaSheet } from "@/lib/math/formulaSchema";

export const PUBLIC_SHARE_SETUP_HINT =
  "Para usar enlaces públicos, ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase (sección 9: Vista Invitado).";

/** Formato aceptado por la base de datos (ver el check de schema.sql). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

export interface PublicShareState {
  enabled: boolean;
  token: string | null;
}

/** Falta la sección 9 de schema.sql (columna o función inexistente). */
export class PublicShareSetupError extends Error {
  constructor() {
    super(PUBLIC_SHARE_SETUP_HINT);
    this.name = "PublicShareSetupError";
  }
}

function isSetupError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42703: columna inexistente · 42883 / PGRST202: función inexistente · PGRST204: columna fuera de la caché.
  return (
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST204" ||
    /public_share|get_public_workspace/.test(error.message ?? "")
  );
}

/** Token aleatorio de 192 bits en base64url (32 caracteres). */
export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Enlace que se comparte: `<origen>/ver/<token>`. */
export function buildGuestLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ver/${encodeURIComponent(token)}`;
}

export async function readPublicShare(supabase: SupabaseClient, workspaceId: string): Promise<PublicShareState> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("public_share_token, public_share_enabled")
    .eq("id", workspaceId)
    .maybeSingle();
  if (isSetupError(error)) throw new PublicShareSetupError();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as { public_share_token?: string | null; public_share_enabled?: boolean | null };
  return { enabled: Boolean(row.public_share_enabled), token: row.public_share_token ?? null };
}

/**
 * Activa, desactiva o renueva el enlace. Al activar sin token (o con
 * `rotate`) se genera uno nuevo; al desactivar se conserva para poder
 * reactivarlo con la misma dirección.
 */
export async function updatePublicShare(
  supabase: SupabaseClient,
  workspaceId: string,
  current: PublicShareState,
  next: { enabled: boolean; rotate?: boolean }
): Promise<PublicShareState> {
  const token = next.rotate || (next.enabled && !current.token) ? generateShareToken() : current.token;
  const { data, error } = await supabase
    .from("workspaces")
    .update({ public_share_enabled: next.enabled, public_share_token: token })
    .eq("id", workspaceId)
    .select("public_share_token, public_share_enabled")
    .maybeSingle();
  if (isSetupError(error)) throw new PublicShareSetupError();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solo el dueño del espacio puede cambiar su enlace público.");
  const row = data as { public_share_token: string | null; public_share_enabled: boolean };
  return { enabled: row.public_share_enabled, token: row.public_share_token };
}

// ----------------------------------------------------------------------------
// Lectura pública (sin sesión)
// ----------------------------------------------------------------------------

export interface PublicBoard {
  name: string;
  updatedAt: string | null;
  nodes: EngineeringNodeData[];
  /** Cables (sin puertos): las Fichas de Fórmula los usan para leer sus datos. */
  connections: NodeConnection[];
}

const VALID_TYPES: NodeArchetype[] = [
  "file-node",
  "sketch-note-node",
  "calc-latex-node",
  "resource-link-node",
  "code-lab-node",
  "ai-chat-node",
  "form-sheet-node",
  "formula-sheet-node",
];

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Valida un nodo de la respuesta pública y completa lo que falte. */
function nodeFromPublic(raw: unknown): EngineeringNodeData | null {
  const n = obj(raw);
  const type = n.type as NodeArchetype;
  if (typeof n.id !== "string" || !VALID_TYPES.includes(type)) return null;
  const payload = obj(n.payload);
  const base = {
    id: n.id,
    title: str(n.title, 200),
    codeTag: str(n.codeTag, 40),
    summary: str(n.summary, 2000) || undefined,
    position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
    updatedAt: "",
  };
  switch (type) {
    case "file-node":
      return { ...base, type, fileData: { ...createEmptyFilePayload(), ...payload, downloadUrl: "" } };
    case "sketch-note-node":
      return { ...base, type, sketchNoteData: { ...createEmptySketchNotePayload(), ...payload } };
    case "calc-latex-node":
      return { ...base, type, calcLatexData: { ...createEmptyCalcLatexPayload(), ...payload } };
    case "resource-link-node":
      return { ...base, type, resourceLinkData: { ...createEmptyResourceLinkPayload(), ...payload } };
    case "code-lab-node":
      return { ...base, type, codeLabData: { ...createEmptyCodeLabPayload(), ...payload } };
    case "ai-chat-node":
      return {
        ...base,
        type,
        aiChatData: { ...createEmptyAiChatPayload(), summary: str(payload.summary, 2000) || undefined, messages: [] },
      };
    case "form-sheet-node":
      return { ...base, type, formSheetData: sanitizeFormSheet(payload) };
    case "formula-sheet-node":
      return { ...base, type, formulaSheetData: sanitizeFormulaSheet(payload) };
    default:
      return null;
  }
}

/** Cable de la respuesta pública (`{ id, from, to, label }`); los puertos no importan aquí. */
function connectionFromPublic(raw: unknown, ids: Set<string>): NodeConnection | null {
  const c = obj(raw);
  const from = str(c.from, 200);
  const to = str(c.to, 200);
  if (typeof c.id !== "string" || !ids.has(from) || !ids.has(to) || from === to) return null;
  const label = str(c.label, 120);
  return { id: c.id, fromNodeId: from, toNodeId: to, fromPort: "right", toPort: "left", ...(label ? { label } : {}) };
}

export type PublicBoardResult =
  | { status: "ok"; board: PublicBoard }
  | { status: "not-found" }
  | { status: "setup" }
  | { status: "error"; message: string };

/** Lee el tablero público (solo lectura). No requiere sesión. */
export async function fetchPublicBoard(supabase: SupabaseClient, token: string): Promise<PublicBoardResult> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return { status: "not-found" };
  const { data, error } = await supabase.rpc("get_public_workspace", { share_token: token });
  if (isSetupError(error)) return { status: "setup" };
  if (error) return { status: "error", message: error.message };
  if (!data || typeof data !== "object") return { status: "not-found" };
  const d = data as Record<string, unknown>;
  const nodes = (Array.isArray(d.nodes) ? d.nodes : [])
    .slice(0, 400)
    .map(nodeFromPublic)
    .filter((n): n is EngineeringNodeData => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  const connections = (Array.isArray(d.connections) ? d.connections : [])
    .slice(0, 1000)
    .map((c) => connectionFromPublic(c, ids))
    .filter((c): c is NodeConnection => c !== null);
  return {
    status: "ok",
    board: {
      name: str(d.name, 120) || "Tablero compartido",
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
      nodes,
      connections,
    },
  };
}
