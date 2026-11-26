// ============================================================================
// ANDROS — ACCIONES DE LOS NODOS IA (cliente)
//   · sendAiNodeTurn: envía un turno a /api/ai/node-chat con el contexto vivo
//     de los nodos conectados aguas arriba y guarda la respuesta en el nodo.
//   · importIntoAiNode: añade mensajes importados sin duplicar los que ya hay
//     (el nodo y sus cables no se tocan).
//   · aiNodeTranscript: conversación en Markdown (para el Estudio del Oráculo).
// ============================================================================

import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { collectUpstreamContext } from "@/lib/canvas/contextGraph";
import { AI_PROVIDER_LABELS, type NodeChatResponse } from "@/lib/ai/providers";
import { PLATFORM_LABELS, turnKey, type ImportedTurn } from "@/lib/ai/chatImport";
import { sessionAuthHeader } from "@/lib/supabase/authHeader";
import type {
  AiChatEngineeringNode,
  AiChatMessage,
  AiChatPayload,
  AiChatSource,
} from "@/types/workspace";

export const RESYNC_PROMPT =
  "El contexto de los nodos conectados cambió. Revisa tu respuesta anterior con los datos actualizados y dime qué cambia.";

/** Nodos recién creados con "Importar chat" que deben abrir su panel al montarse. */
const pendingImportPanels = new Set<string>();

export function markPendingImportPanel(nodeId: string): void {
  pendingImportPanels.add(nodeId);
}

export function hasPendingImportPanel(nodeId: string): boolean {
  return pendingImportPanels.has(nodeId);
}

export function clearPendingImportPanel(nodeId: string): void {
  pendingImportPanels.delete(nodeId);
}

let counter = 0;
const newMessageId = () => `msg-${Date.now()}-${(counter += 1)}`;

function getAiNode(nodeId: string): AiChatEngineeringNode | null {
  const node = useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId);
  return node && node.type === "ai-chat-node" ? node : null;
}

function patchAiNode(nodeId: string, patch: (data: AiChatPayload) => Partial<AiChatPayload>): void {
  const node = getAiNode(nodeId);
  if (!node) return;
  useWorkspaceStore.getState().updateNodePayload(nodeId, patch(node.aiChatData));
}

/** Envía un turno al proveedor del nodo. Nunca se llama sola: siempre por un clic. */
export async function sendAiNodeTurn(nodeId: string, text: string, opts: { resync?: boolean } = {}): Promise<void> {
  const node = getAiNode(nodeId);
  const clean = text.trim();
  if (!node || !clean || node.aiChatData.status === "thinking") return;

  const { provider, model } = node.aiChatData;
  const apiKey = getUserAiKey(provider);
  if (!apiKey && provider !== "gemini") {
    patchAiNode(nodeId, () => ({
      status: "error",
      errorMessage: `Para usar ${AI_PROVIDER_LABELS[provider]} añade tu clave en Claves IA.`,
    }));
    return;
  }

  // Gemini sin clave propia gasta la clave del servidor: tope diario (15/día) con aviso amable.
  const usesFreeQuota = provider === "gemini" && !apiKey;
  if (usesFreeQuota) {
    const quota = checkFreeQuota();
    if (!quota.ok) {
      patchAiNode(nodeId, () => ({ status: "error", errorMessage: quota.message }));
      return;
    }
  }

  const { nodes, connections } = useWorkspaceStore.getState();
  const context = collectUpstreamContext(nodes, connections, nodeId);
  const userMessage: AiChatMessage = {
    id: newMessageId(),
    role: "user",
    text: clean,
    at: Date.now(),
    ...(opts.resync ? { resync: true } : {}),
  };
  const history = [...node.aiChatData.messages, userMessage];
  patchAiNode(nodeId, () => ({ messages: history, status: "thinking", errorMessage: undefined }));

  try {
    const res = await fetch("/api/ai/node-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeader()) },
      body: JSON.stringify({
        provider,
        model,
        ...(apiKey ? { apiKey } : {}),
        messages: history.map((m) => ({ role: m.role, text: m.text })),
        upstreamContext: context.text,
        nodeTitle: node.title,
      }),
    });
    const data = (await res.json()) as NodeChatResponse;
    if ("error" in data) {
      patchAiNode(nodeId, () => ({ status: "error", errorMessage: data.error.message }));
      return;
    }
    if (usesFreeQuota) recordFreeQuery();
    patchAiNode(nodeId, (current) => ({
      messages: [
        ...current.messages,
        { id: newMessageId(), role: "assistant", text: data.reply, at: Date.now(), model: data.modelUsed },
      ],
      summary: data.summary,
      status: "idle",
      errorMessage: undefined,
      // Se recuerda con qué contexto se respondió (para el aviso de "Resincronizar").
      contextFingerprint: context.fingerprint,
    }));
  } catch {
    patchAiNode(nodeId, () => ({
      status: "error",
      errorMessage: "No se pudo contactar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
    }));
  }
}

/**
 * Añade a un Nodo IA los mensajes de una conversación externa. Los que ya
 * estaban (mismo rol y texto) no se repiten, así "Actualizar contexto" solo
 * agrega lo nuevo. Devuelve cuántos mensajes nuevos entraron.
 */
export function importIntoAiNode(
  nodeId: string,
  imported: ImportedTurn[],
  source: Omit<AiChatSource, "importedAt" | "importedCount">,
  title?: string
): number {
  const node = getAiNode(nodeId);
  if (!node) return 0;
  const existing = new Set(node.aiChatData.messages.map(turnKey));
  const fresh: AiChatMessage[] = [];
  for (const turn of imported) {
    const key = turnKey(turn);
    if (existing.has(key)) continue;
    existing.add(key);
    fresh.push({ id: newMessageId(), role: turn.role, text: turn.text, at: turn.at ?? Date.now(), imported: true });
  }
  const { nodes, connections } = useWorkspaceStore.getState();
  const fingerprint = collectUpstreamContext(nodes, connections, nodeId).fingerprint;
  const lastAssistant = [...imported].reverse().find((m) => m.role === "assistant");
  const previousCount = node.aiChatData.source?.importedCount ?? 0;

  patchAiNode(nodeId, (data) => ({
    messages: [...data.messages, ...fresh].slice(-400),
    source: {
      ...source,
      importedAt: new Date().toLocaleString("es", { dateStyle: "short", timeStyle: "short" }),
      importedCount: previousCount + fresh.length,
    },
    summary:
      data.summary ??
      (lastAssistant
        ? lastAssistant.text.replace(/\s+/g, " ").slice(0, 220)
        : `Conversación de ${PLATFORM_LABELS[source.platform]} importada.`),
    status: "idle",
    errorMessage: undefined,
    contextFingerprint: data.contextFingerprint ?? fingerprint,
  }));

  if (title && /^Nodo IA$/.test(node.title)) {
    useWorkspaceStore.getState().updateNodeMeta(nodeId, { title: title.slice(0, 120) });
  }
  return fresh.length;
}

/** Conversación completa en Markdown (para abrirla en el Estudio del Oráculo). */
export function aiNodeTranscript(node: AiChatEngineeringNode): string {
  const data = node.aiChatData;
  const lines: string[] = [];
  if (data.source) {
    lines.push(
      `> Importada de ${PLATFORM_LABELS[data.source.platform]}${data.source.url ? ` · ${data.source.url}` : ""}`,
      ""
    );
  }
  if (data.summary) lines.push(`**Resumen:** ${data.summary}`, "");
  for (const m of data.messages) {
    if (m.resync) {
      lines.push("---", "*Resincronizado con el contexto actualizado del lienzo.*", "");
      continue;
    }
    lines.push(`## ${m.role === "user" ? "Tú" : AI_PROVIDER_LABELS[data.provider]}`, "", m.text, "");
  }
  return lines.join("\n").trim();
}
