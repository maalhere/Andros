// ============================================================================
// ANDROS — CATÁLOGO DE PROVEEDORES DE IA (cliente y servidor)
// Nombres visibles, modelos sugeridos y contrato de /api/ai/node-chat.
// ============================================================================

import type { AiProvider } from "@/types/workspace";

export const AI_PROVIDERS: AiProvider[] = ["gemini", "anthropic", "openai"];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "ChatGPT",
};

/** Color de la insignia de cada proveedor (punto de color en el nodo). */
export const AI_PROVIDER_DOT: Record<AiProvider, string> = {
  gemini: "#3B82F6",
  anthropic: "#C95A3B",
  openai: "#10B981",
};

export const AI_PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://platform.claude.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

export interface AiModelOption {
  id: string;
  label: string;
}

/** Modelos sugeridos (en Claves IA se puede escribir cualquier otro). */
export const AI_PROVIDER_MODELS: Record<AiProvider, AiModelOption[]> = {
  gemini: [
    { id: "auto", label: "Auto (con respaldo)" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite" },
  ],
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
  ],
  openai: [
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
};

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "auto",
  anthropic: "claude-opus-5-5",
  openai: "gpt-5-mini",
};

/** Etiqueta corta de un modelo (o el id tal cual si es personalizado). */
export function modelLabel(provider: AiProvider, model: string): string {
  return AI_PROVIDER_MODELS[provider].find((m) => m.id === model)?.label ?? model;
}

// ----------------------------------------------------------------------------
// Contrato de /api/ai/node-chat
// ----------------------------------------------------------------------------

export interface NodeChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface NodeChatRequest {
  provider: AiProvider;
  model: string;
  /** Clave propia del usuario (BYOK). Solo viaja en esta petición; nunca se guarda. */
  apiKey?: string;
  messages: NodeChatTurn[];
  /** Contenido vivo de los nodos conectados aguas arriba. */
  upstreamContext?: string;
  nodeTitle?: string;
  /** Prueba de la clave: respuesta mínima. */
  test?: boolean;
}

export type NodeChatErrorCode =
  | "missing_key"
  | "invalid_key"
  | "rate_limited"
  | "overloaded"
  | "model_not_found"
  | "refusal"
  | "network"
  | "bad_request";

export interface NodeChatSuccess {
  reply: string;
  summary: string;
  modelUsed: string;
}

export interface NodeChatFailure {
  error: { code: NodeChatErrorCode; message: string };
}

export type NodeChatResponse = NodeChatSuccess | NodeChatFailure;
