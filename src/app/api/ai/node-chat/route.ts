// ============================================================================
// ANDROS — CONECTOR MULTI-MODELO DE LOS NODOS IA
//
// POST { provider, model, apiKey?, messages, upstreamContext } →
//      { reply, summary, modelUsed }  |  { error: { code, message } }
//
//   · gemini    → clave del usuario o, si no hay, GEMINI_API_KEY del servidor
//                 (con la misma cadena de respaldo que el Oráculo).
//   · anthropic → SDK oficial de Anthropic con la clave del usuario.
//   · openai    → API de OpenAI con la clave del usuario.
// La clave del usuario solo vive durante esta petición: no se guarda ni se
// registra en los logs.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { callGemini, ProviderFailure } from "@/lib/ai/gemini";
import { parseJsonText } from "@/lib/ai/jsonText";
import type {
  NodeChatErrorCode,
  NodeChatRequest,
  NodeChatResponse,
  NodeChatTurn,
} from "@/lib/ai/providers";
import type { AiProvider } from "@/types/workspace";

export const maxDuration = 120;

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 40_000;
const PROVIDER_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `Eres un asistente de IA que vive dentro de un nodo del lienzo espacial Andros (ingeniería, diseño 3D, fabricación e investigación).
- Responde en el idioma del usuario, claro, técnico y accionable. Puedes usar Markdown ligero (listas, negritas, tablas pequeñas, LaTeX con $...$).
- Si hay CONTEXTO DE NODOS CONECTADOS, es la fuente de verdad del lienzo: úsalo y cita datos concretos (nombres de archivo, dimensiones en mm, variables calculadas, URLs). Si falta un dato, dilo y propone un supuesto razonable.
- Si el usuario pide resincronizar, revisa tu respuesta anterior con el contexto nuevo y explica qué cambió.

FORMATO DE RESPUESTA (obligatorio): devuelve SOLO un objeto JSON {"reply": string, "summary": string}
- "reply": tu respuesta completa al último mensaje.
- "summary": resumen de 1 o 2 frases (máximo 220 caracteres) de TODA la conversación hasta ahora, para mostrarlo en la tarjeta del lienzo.`;

const TEST_PROMPT = 'Responde SOLO con el JSON {"reply": "ok", "summary": "Prueba de conexión"}.';

class ChatError extends Error {
  constructor(
    public code: NodeChatErrorCode,
    message: string,
    public status = 502
  ) {
    super(message);
  }
}

const PROVIDER_NAMES: Record<AiProvider, string> = { gemini: "Gemini", anthropic: "Claude", openai: "ChatGPT" };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeMessages(raw: unknown): NodeChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .map((m) => {
      const t = (m ?? {}) as Record<string, unknown>;
      const role = t.role === "assistant" ? "assistant" : t.role === "user" ? "user" : null;
      const text = typeof t.text === "string" ? t.text.trim() : "";
      return role && text ? { role, text: clip(text, MAX_MESSAGE_CHARS) } : null;
    })
    .filter((t): t is NodeChatTurn => t !== null)
    .slice(-MAX_MESSAGES);
  // Las APIs exigen que la conversación empiece por el usuario (p. ej. un chat importado).
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", text: "(Conversación importada; continúa a partir de aquí.)" });
  return turns;
}

function buildSystem(context: string, nodeTitle: string): string {
  const title = nodeTitle ? `\n\nEl nodo se llama "${nodeTitle}".` : "";
  const ctx = context.trim()
    ? `\n\nCONTEXTO DE NODOS CONECTADOS (aguas arriba, contenido vivo del lienzo):\n${clip(context, MAX_CONTEXT_CHARS)}`
    : "\n\n(No hay nodos conectados aguas arriba: responde solo con la conversación.)";
  return `${SYSTEM_PROMPT}${title}${ctx}`;
}

/** Lee {reply, summary} del JSON del modelo; si no es JSON, usa el texto tal cual. */
function readReply(raw: unknown, fallbackText?: string): { reply: string; summary: string } {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const reply = typeof o.reply === "string" ? o.reply.trim() : "";
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (reply) return { reply, summary: clip(summary || reply.replace(/\s+/g, " "), 240) };
  }
  const text = (fallbackText ?? "").trim();
  if (!text) throw new ChatError("bad_request", "La IA respondió vacío. Vuelve a intentarlo.");
  return { reply: text, summary: clip(text.replace(/\s+/g, " "), 240) };
}

// ----------------------------------------------------------------------------
// Gemini
// ----------------------------------------------------------------------------

async function chatGemini(req: NodeChatRequest, system: string, turns: NodeChatTurn[]) {
  const userKey = req.apiKey?.trim();
  const apiKey = userKey || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ChatError(
      "missing_key",
      "No hay clave de Gemini: añade la tuya en Claves IA o define GEMINI_API_KEY en el servidor.",
      400
    );
  }
  const last = turns[turns.length - 1];
  try {
    const { raw, model } = await callGemini(
      apiKey,
      {
        system,
        userContent: last.text,
        history: turns.slice(0, -1).map((t) => ({ role: t.role === "assistant" ? "oracle" : "user", text: t.text })),
        maxOutputTokens: req.test ? 256 : 8192,
      },
      { preferredModel: req.model && req.model !== "auto" ? req.model : undefined, userKey: Boolean(userKey) }
    );
    return { ...readReply(raw), modelUsed: model };
  } catch (error) {
    if (error instanceof ProviderFailure) {
      const code: NodeChatErrorCode =
        error.issue.code === "invalid_key"
          ? "invalid_key"
          : error.issue.code === "rate_limited"
            ? "rate_limited"
            : error.issue.code === "overloaded"
              ? "overloaded"
              : "network";
      throw new ChatError(code, error.issue.message);
    }
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Claude (SDK oficial de Anthropic)
// ----------------------------------------------------------------------------

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    summary: { type: "string" },
  },
  required: ["reply", "summary"],
  additionalProperties: false,
} as const;

/** Modelos con respaldo automático en el servidor si el filtro de seguridad rechaza. */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-2|fable-5-1)$/;

async function chatClaude(req: NodeChatRequest, system: string, turns: NodeChatTurn[]) {
  const apiKey = req.apiKey?.trim();
  if (!apiKey) {
    throw new ChatError("missing_key", "Para usar Claude añade tu clave de Anthropic en Claves IA.", 400);
  }
  const model = req.model?.trim() || "claude-opus-5-5";
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: PROVIDER_TIMEOUT_MS });
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  const outputConfig = { effort: "medium" as const, format: { type: "json_schema" as const, schema: REPLY_SCHEMA } };
  const maxTokens = req.test ? 512 : 16_000;

  try {
    let stopReason: string | null;
    let content: { type: string; text?: string }[];
    let modelUsed: string;
    if (FALLBACK_MODELS.test(model)) {
      // Si el filtro de seguridad rechaza, el servidor reintenta con otro modelo.
      const res = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: outputConfig,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      stopReason = res.stop_reason;
      content = res.content;
      modelUsed = res.model;
    } else {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: outputConfig,
      });
      stopReason = res.stop_reason;
      content = res.content;
      modelUsed = res.model;
    }
    if (stopReason === "refusal") {
      throw new ChatError("refusal", "Claude no quiso responder a esta petición. Reformúlala o prueba otro modelo.", 422);
    }
    const text = content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    let raw: unknown = null;
    try {
      raw = parseJsonText(text);
    } catch {
      raw = null;
    }
    return { ...readReply(raw, text), modelUsed };
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ChatError("invalid_key", "Anthropic rechazó tu clave (no es válida o no tiene permisos). Revísala en Claves IA.", 401);
    }
    if (error instanceof Anthropic.NotFoundError) {
      throw new ChatError("model_not_found", `Tu clave no tiene acceso al modelo "${model}". Elige otro modelo de Claude.`, 404);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new ChatError("rate_limited", "Superaste el límite de uso de tu cuenta de Anthropic. Espera un minuto e inténtalo de nuevo.", 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      const credit = /credit balance/i.test(error.message);
      throw new ChatError(
        credit ? "rate_limited" : "bad_request",
        credit
          ? "Tu cuenta de Anthropic no tiene saldo. Recarga créditos en platform.claude.com."
          : `Claude rechazó la petición: ${clip(error.message, 200)}`,
        400
      );
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ChatError("network", "No se pudo conectar con Anthropic. Revisa tu conexión e inténtalo de nuevo.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new ChatError(
        "overloaded",
        `Claude no está disponible ahora mismo (${error.status ?? "sin código"}). Vuelve a intentarlo en unos segundos.`
      );
    }
    throw error;
  }
}

// ----------------------------------------------------------------------------
// ChatGPT (OpenAI)
// ----------------------------------------------------------------------------

async function chatOpenAI(req: NodeChatRequest, system: string, turns: NodeChatTurn[]) {
  const apiKey = req.apiKey?.trim();
  if (!apiKey) {
    throw new ChatError("missing_key", "Para usar ChatGPT añade tu clave de OpenAI en Claves IA.", 400);
  }
  const model = req.model?.trim() || "gpt-5-mini";
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        max_completion_tokens: req.test ? 512 : 8000,
        messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
      }),
    });
  } catch {
    throw new ChatError("network", "No se pudo conectar con OpenAI. Revisa tu conexión e inténtalo de nuevo.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new ChatError("invalid_key", "OpenAI rechazó tu clave (no es válida o fue revocada). Revísala en Claves IA.", 401);
    }
    if (res.status === 429) {
      const quota = /insufficient_quota/i.test(detail);
      throw new ChatError(
        "rate_limited",
        quota
          ? "Tu cuenta de OpenAI no tiene saldo o superó su cuota. Revisa la facturación en platform.openai.com."
          : "Superaste el límite de uso de OpenAI. Espera un minuto e inténtalo de nuevo.",
        429
      );
    }
    if (res.status === 404 || /model_not_found|does not exist/i.test(detail)) {
      throw new ChatError("model_not_found", `Tu clave no tiene acceso al modelo "${model}". Elige otro modelo de ChatGPT.`, 404);
    }
    if (res.status >= 500) {
      throw new ChatError("overloaded", `OpenAI no está disponible ahora mismo (${res.status}). Vuelve a intentarlo.`);
    }
    throw new ChatError("bad_request", `OpenAI rechazó la petición (${res.status}).`, 400);
  }
  const data = await res.json();
  const text: unknown = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new ChatError("bad_request", "OpenAI respondió vacío. Vuelve a intentarlo.");
  let raw: unknown = null;
  try {
    raw = parseJsonText(text);
  } catch {
    raw = null;
  }
  return { ...readReply(raw, text), modelUsed: typeof data?.model === "string" ? data.model : model };
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse<NodeChatResponse>> {
  let body: Partial<NodeChatRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Petición inválida." } }, { status: 400 });
  }

  const provider: AiProvider | null =
    body.provider === "gemini" || body.provider === "anthropic" || body.provider === "openai" ? body.provider : null;
  if (!provider) {
    return NextResponse.json({ error: { code: "bad_request", message: "Proveedor de IA desconocido." } }, { status: 400 });
  }

  const req: NodeChatRequest = {
    provider,
    model: typeof body.model === "string" ? body.model.slice(0, 100) : "",
    apiKey: typeof body.apiKey === "string" ? body.apiKey.slice(0, 500) : undefined,
    messages: [],
    upstreamContext: typeof body.upstreamContext === "string" ? body.upstreamContext : "",
    nodeTitle: typeof body.nodeTitle === "string" ? body.nodeTitle.slice(0, 160) : "",
    test: body.test === true,
  };

  const turns = req.test ? [{ role: "user" as const, text: TEST_PROMPT }] : sanitizeMessages(body.messages);
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Escribe un mensaje para la IA." } },
      { status: 400 }
    );
  }
  const system = req.test ? SYSTEM_PROMPT : buildSystem(req.upstreamContext ?? "", req.nodeTitle ?? "");

  try {
    const result =
      provider === "gemini"
        ? await chatGemini(req, system, turns)
        : provider === "anthropic"
          ? await chatClaude(req, system, turns)
          : await chatOpenAI(req, system, turns);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ChatError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    // Nunca se registra la petición (contiene la clave): solo el tipo de fallo.
    console.error(`[node-chat] ${PROVIDER_NAMES[provider]} falló:`, error instanceof Error ? error.name : "desconocido");
    return NextResponse.json(
      {
        error: {
          code: "network",
          message: `No se pudo obtener respuesta de ${PROVIDER_NAMES[provider]}. Inténtalo de nuevo.`,
        },
      },
      { status: 502 }
    );
  }
}
