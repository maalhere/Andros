// ============================================================================
// ANDROS — CLIENTE DE GEMINI CON CADENA DE RESPALDO (solo servidor)
//
// Lo comparten el Oráculo (/api/oracle) y los Nodos IA (/api/ai/node-chat).
// Prueba los modelos en orden, recuerda los retirados (404) y deja descansar
// los saturados (503/429), y traduce los fallos a mensajes accionables.
// ============================================================================

import { createHash } from "node:crypto";
import dns from "node:dns";
import type { OracleHistoryTurn, OracleIssue } from "@/types/oracle";
import { parseJsonText } from "@/lib/ai/jsonText";

// Muchas redes domésticas y de Windows anuncian IPv6 sin ruta real: Node prueba
// primero la dirección AAAA y `fetch` se queda colgado hasta el timeout. Con
// IPv4 primero se evitan esperas de 25 s por intento.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Entorno sin `dns` configurable: se ignora.
}

/**
 * Modelos de Gemini en orden de preferencia (`GEMINI_MODEL` manda sobre todos).
 *
 * Lista verificada contra `GET /v1beta/models` con la clave del proyecto
 * (noviembre 2026): gemini-2.5-flash, gemini-2.5-flash-lite y gemini-2.0-flash
 * responden 404 y se eliminaron. Primero van los más rápidos (los "lite"
 * entregan el primer fragmento en ~0,5 s) y después los grandes, que a veces
 * devuelven 503 por demanda. `gemini-4-hydrogen` y `gemini-4-neon` existen en
 * el listado pero tienen cuota limitada: van casi al final como respaldo.
 * Un modelo con 404 se marca como retirado y no se reintenta durante horas; uno
 * saturado (503), sin cuota (429) o lento pasa AL INSTANTE al siguiente.
 */
export const GEMINI_MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL?.trim(),
      "gemini-3.5-flash-lite",
      "gemini-3-flash-preview",
      "gemini-flash-lite-latest",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-4-hydrogen",
      "gemini-4-neon",
      "gemini-3.1-flash-lite",
    ].filter((m): m is string => typeof m === "string" && m !== "")
  ),
];
/** Tiempo máximo por intento y tiempo total que el Oráculo espera a Gemini. */
export const ATTEMPT_TIMEOUT_MS = 25_000;
const TOTAL_BUDGET_MS = 95_000;
/** Un modelo con 404 (retirado / no habilitado) no se reintenta en 6 h. */
const RETIRED_TTL_MS = 6 * 60 * 60 * 1000;
/** Un modelo saturado o sin cuota va al final de la cola durante 60 s. */
const COOLDOWN_MS = 60_000;

/**
 * Estado compartido entre peticiones (vive mientras viva la instancia del
 * servidor). Va por clave: un modelo retirado para una clave puede servir con otra.
 */
const retiredModels = new Map<string, number>();
const coolingModels = new Map<string, number>();

/** Opciones de una llamada a Gemini. */
export interface GeminiCallOptions {
  /** Modelo pedido por el usuario: se intenta primero (luego la cadena normal). */
  preferredModel?: string;
  /** `true` si la clave es del usuario (BYOK): cambia el texto de los errores. */
  userKey?: boolean;
  /** Tiempo total máximo (ms). Por defecto 95 s; tareas rápidas usan menos. */
  budgetMs?: number;
  /** Temperatura (por defecto 0.4). */
  temperature?: number;
}

const keyScope = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 12);

/** Lo que se le pide al modelo en una llamada (independiente del proveedor). */
export interface ModelRequest {
  system: string;
  userContent: string;
  history: OracleHistoryTurn[];
  maxOutputTokens: number;
}

/** Error de Gemini con el código HTTP, para decidir si probar otro modelo. */
export class GeminiHttpError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(`Gemini respondió ${status}: ${detail.slice(0, 300)}`);
  }
}

/** Fallo de todos los modelos de un proveedor, ya traducido para el usuario. */
export class ProviderFailure extends Error {
  constructor(public issue: OracleIssue) {
    super(issue.message);
  }
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** Códigos de red de Node/undici: sin conexión, DNS caído o socket cortado. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * `fetch failed` (TypeError de undici) o un código de red en `cause`: el fallo
 * es de la conexión del servidor, no del modelo. Probar los demás modelos solo
 * haría esperar al usuario, así que la cadena se corta al instante.
 */
export const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code: unknown }).code)
      : "";
  return NETWORK_CODES.has(code) || (error.name === "TypeError" && /fetch failed/i.test(error.message));
};

const isInvalidKeyError = (error: unknown) =>
  error instanceof GeminiHttpError &&
  (error.status === 401 ||
    (error.status === 403 && /api key|leaked|API_KEY/i.test(error.detail)) ||
    /API_KEY_INVALID|API key not valid|API key expired|invalid api key/i.test(error.detail));

/** Orden de intento: sin los retirados, y los que descansan al final. */
function geminiCandidates(scope: string, preferred?: string): string[] {
  const now = Date.now();
  const all = [...new Set([preferred, ...GEMINI_MODELS].filter((m): m is string => Boolean(m)))];
  const alive = all.filter((m) => (retiredModels.get(`${scope}:${m}`) ?? 0) < now);
  const ready = alive.filter((m) => (coolingModels.get(`${scope}:${m}`) ?? 0) < now);
  const cooling = alive.filter((m) => (coolingModels.get(`${scope}:${m}`) ?? 0) >= now);
  const list = [...ready, ...cooling];
  // Si todos quedaron retirados (p. ej. cambió la clave), se vuelve a empezar.
  return list.length > 0 ? list : all;
}

/** Traduce los errores acumulados a un mensaje que el usuario pueda resolver. */
function describeGeminiFailure(
  errors: { model: string; error: unknown }[],
  userKey = false
): OracleIssue {
  const http = errors
    .map((e) => e.error)
    .filter((e): e is GeminiHttpError => e instanceof GeminiHttpError);

  if (errors.some((e) => isNetworkError(e.error))) {
    return {
      code: "network",
      message:
        "El servidor de Andros no pudo conectar con Google (sin red o DNS caído). Comprueba la conexión a Internet y vuelve a intentarlo.",
    };
  }
  if (errors.some((e) => isInvalidKeyError(e.error))) {
    if (userKey) {
      return {
        code: "invalid_key",
        message:
          "Google rechazó tu clave de Gemini (no es válida, caducó o fue revocada). Genera una nueva en https://aistudio.google.com/apikey y actualízala en Claves IA.",
      };
    }
    return {
      code: "invalid_key",
      message:
        "Google rechazó tu GEMINI_API_KEY (no es válida, caducó o fue revocada). Genera una nueva en https://aistudio.google.com/apikey, reemplázala en .env.local (o en Vercel → Settings → Environment Variables) y reinicia el servidor.",
    };
  }
  if (http.length > 0 && http.length === errors.length && http.every((e) => e.status === 429)) {
    return {
      code: "rate_limited",
      message:
        "Superaste la cuota de Gemini de tu clave (límite por minuto o por día). Espera un minuto y vuelve a intentarlo, o activa la facturación en Google AI Studio para subir el límite.",
    };
  }
  const busy = errors.filter(
    (e) =>
      isTimeout(e.error) ||
      (e.error instanceof GeminiHttpError && [429, 500, 503, 504].includes(e.error.status))
  );
  if (busy.length > 0) {
    return {
      code: "overloaded",
      message: `Los modelos de Gemini están saturados ahora mismo (probé ${errors.length}: ${errors
        .map((e) => e.model)
        .join(", ")}). Es temporal: vuelve a intentarlo en unos segundos.`,
    };
  }
  if (http.length > 0 && http.every((e) => e.status === 404 || e.status === 403)) {
    return {
      code: "unavailable",
      message:
        "Tu clave de Gemini no tiene acceso a ninguno de los modelos configurados. Define GEMINI_MODEL en .env.local con un modelo que aparezca en https://aistudio.google.com y reinicia el servidor.",
    };
  }
  const last = errors[errors.length - 1]?.error;
  return {
    code: "unavailable",
    message: `No pude obtener respuesta de Gemini (${
      last instanceof Error ? last.message.slice(0, 160) : "error desconocido"
    }). Revisa tu conexión e inténtalo de nuevo.`,
  };
}

export async function callGemini(
  apiKey: string,
  req: ModelRequest,
  options: GeminiCallOptions = {}
): Promise<{ raw: unknown; model: string }> {
  const deadline = Date.now() + (options.budgetMs ?? TOTAL_BUDGET_MS);
  const errors: { model: string; error: unknown }[] = [];
  const scope = keyScope(apiKey);

  for (const model of geminiCandidates(scope, options.preferredModel)) {
    const remaining = deadline - Date.now();
    if (remaining < 4_000) break;
    try {
      const raw = await callGeminiModel(model, apiKey, req, Math.min(ATTEMPT_TIMEOUT_MS, remaining), true, options.temperature);
      coolingModels.delete(`${scope}:${model}`);
      return { raw, model };
    } catch (error) {
      errors.push({ model, error });
      console.warn(`[gemini] ${model} falló:`, error instanceof Error ? error.message : error);
      if (isInvalidKeyError(error)) break; // Con una clave inválida ningún modelo servirá.
      if (isNetworkError(error)) break; // Sin red ningún modelo responderá: fallo inmediato.
      if (error instanceof GeminiHttpError && error.status === 404) {
        retiredModels.set(`${scope}:${model}`, Date.now() + RETIRED_TTL_MS);
      } else {
        coolingModels.set(`${scope}:${model}`, Date.now() + COOLDOWN_MS);
      }
      // Cualquier otro fallo (404, 429, 503, demora, JSON inválido): siguiente modelo.
    }
  }
  throw new ProviderFailure(
    errors.length > 0
      ? describeGeminiFailure(errors, options.userKey)
      : { code: "overloaded", message: "Gemini no respondió a tiempo. Vuelve a intentarlo en unos segundos." }
  );
}

/** Razonamiento acotado: sin esto los modelos Gemini 3 pueden tardar más de un minuto. */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (model.startsWith("gemini-2.5")) return { thinkingBudget: 1024 };
  if (/^gemini-[3-9]/.test(model)) return { thinkingLevel: "low" };
  // Alias "-latest" y modelos antiguos: se deja el valor por defecto del modelo.
  return undefined;
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  req: ModelRequest,
  timeoutMs: number,
  withThinking = true,
  temperature = 0.4
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const thinkingConfig = withThinking ? thinkingConfigFor(model) : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        ...req.history.map((turn) => ({
          role: turn.role === "oracle" ? "model" : "user",
          parts: [{ text: turn.text }],
        })),
        { role: "user", parts: [{ text: req.userContent }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature,
        maxOutputTokens: req.maxOutputTokens,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Modelo que no acepta la configuración de razonamiento: un reintento sin ella.
    if (res.status === 400 && thinkingConfig && /thinking/i.test(detail)) {
      return callGeminiModel(model, apiKey, req, timeoutMs, false, temperature);
    }
    throw new GeminiHttpError(res.status, detail);
  }
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts: unknown[] = candidate?.content?.parts ?? [];
  // Se ignoran las partes de "pensamiento" del modelo; solo cuenta la respuesta.
  const text = parts
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      const part = p as { text?: unknown; thought?: unknown };
      return part.thought === true || typeof part.text !== "string" ? "" : part.text;
    })
    .join("");
  if (!text) {
    const reason = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? "sin texto";
    throw new Error(`Respuesta de ${model} sin texto utilizable (${reason})`);
  }
  return parseJsonText(text);
}

// ============================================================================
// STREAMING (streamGenerateContent + SSE)
//
// Abre el stream del primer modelo que entregue TEXTO a tiempo; el failover
// (404, 429, 503, demora) solo ocurre ANTES del primer fragmento. Una vez que
// el texto empieza a llegar, el modelo queda comprometido y los errores se
// propagan. Con esto el primer fragmento llega en ~1 s y la función serverless
// nunca espera a que termine el modelo para empezar a responder (Vercel Hobby).
// ============================================================================

/** Espera máxima al primer fragmento de texto de un modelo antes de pasar al siguiente. */
const FIRST_TEXT_TIMEOUT_MS = 8_000;
/** Silencio máximo entre fragmentos una vez comprometido el modelo. */
const IDLE_TIMEOUT_MS = 20_000;

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

/** Texto visible (sin partes de "pensamiento") de un evento SSE de Gemini. */
function textOfEvent(event: unknown): {
  text: string;
  finishReason?: string;
  blockReason?: string;
  error?: { code: number; message: string };
} {
  const data = (event ?? {}) as {
    error?: { code?: number; message?: string };
    candidates?: { content?: { parts?: unknown[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      const part = p as { text?: unknown; thought?: unknown };
      return part.thought === true || typeof part.text !== "string" ? "" : part.text;
    })
    .join("");
  return {
    text,
    finishReason: candidate?.finishReason,
    blockReason: data.promptFeedback?.blockReason,
    // Gemini a veces envía un error DENTRO del stream (p. ej. 503 por demanda).
    ...(data.error ? { error: { code: Number(data.error.code) || 503, message: String(data.error.message ?? "") } } : {}),
  };
}

export interface GeminiStream {
  /** Modelo que abrió el stream. */
  model: string;
  /** Fragmentos de texto en orden. Al terminar devuelve el motivo de cierre (`MAX_TOKENS`, `STOP`…). */
  chunks: AsyncGenerator<string, { finishReason?: string }, void>;
}

/** Extrae del búfer los eventos SSE completos (`data: {...}`). */
function drainEvents(buffer: { value: string }, flush = false): unknown[] {
  const events: unknown[] = [];
  const parts = buffer.value.split(/\r?\n\r?\n/);
  buffer.value = flush ? "" : (parts.pop() ?? "");
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Evento cortado a medias: se ignora.
    }
  }
  return events;
}

async function* sseTextChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
  first: string[],
  buffer: { value: string },
  state: { finishReason?: string }
): AsyncGenerator<string, { finishReason?: string }, void> {
  const decoder = new TextDecoder();
  try {
    for (const text of first) yield text;
    while (true) {
      const idle = setTimeout(() => controller.abort(timeoutError("Gemini dejó de responder")), IDLE_TIMEOUT_MS);
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } finally {
        clearTimeout(idle);
      }
      if (step.done) break;
      buffer.value += decoder.decode(step.value, { stream: true });
      for (const event of drainEvents(buffer)) {
        const { text, finishReason, error } = textOfEvent(event);
        if (error) throw new GeminiHttpError(error.code, error.message);
        if (finishReason) state.finishReason = finishReason;
        if (text) yield text;
      }
    }
    buffer.value += decoder.decode();
    buffer.value += "\n\n";
    for (const event of drainEvents(buffer, true)) {
      const { text, finishReason, error } = textOfEvent(event);
      if (error) throw new GeminiHttpError(error.code, error.message);
      if (finishReason) state.finishReason = finishReason;
      if (text) yield text;
    }
    // Un stream sano siempre cierra con finishReason; sin él, el modelo se cortó a medias.
    if (!state.finishReason) throw new Error("El stream de Gemini se cortó antes de terminar");
  } finally {
    controller.abort();
  }
  return state;
}

async function openModelStream(
  model: string,
  apiKey: string,
  req: ModelRequest,
  withThinking: boolean,
  temperature: number,
  json: boolean
): Promise<GeminiStream> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(timeoutError(`${model} tardó demasiado`)),
    FIRST_TEXT_TIMEOUT_MS
  );
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const thinkingConfig = withThinking ? thinkingConfigFor(model) : undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          ...req.history.map((turn) => ({
            role: turn.role === "oracle" ? "model" : "user",
            parts: [{ text: turn.text }],
          })),
          { role: "user", parts: [{ text: req.userContent }] },
        ],
        generationConfig: {
          ...(json ? { responseMimeType: "application/json" } : {}),
          temperature,
          maxOutputTokens: req.maxOutputTokens,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      if (res.status === 400 && thinkingConfig && /thinking/i.test(detail)) {
        clearTimeout(timer);
        return openModelStream(model, apiKey, req, false, temperature, json);
      }
      throw new GeminiHttpError(res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const buffer = { value: "" };
    const state: { finishReason?: string } = {};
    // Se lee hasta el primer fragmento con texto (o hasta que el stream cierre).
    const first: string[] = [];
    while (first.length === 0) {
      const step = await reader.read();
      if (step.done) break;
      buffer.value += decoder.decode(step.value, { stream: true });
      for (const event of drainEvents(buffer)) {
        const { text, finishReason, blockReason, error } = textOfEvent(event);
        if (error) throw new GeminiHttpError(error.code, error.message);
        if (finishReason) state.finishReason = finishReason;
        if (blockReason) throw new Error(`${model} bloqueó la petición (${blockReason})`);
        if (text) first.push(text);
      }
    }
    if (first.length === 0) {
      throw new Error(`Respuesta de ${model} sin texto utilizable (${state.finishReason ?? "sin texto"})`);
    }
    clearTimeout(timer);
    return { model, chunks: sseTextChunks(reader, controller, first, buffer, state) };
  } catch (error) {
    clearTimeout(timer);
    // Si abortó el temporizador, `fetch`/`read` lanzan la razón del abort.
    const reason: unknown = controller.signal.reason;
    controller.abort();
    throw reason instanceof Error && reason.name === "TimeoutError" ? reason : error;
  }
}

/** Marca un modelo que falló a mitad de stream: descansa (o se retira si dio 404). */
export function markGeminiModelFailed(apiKey: string, model: string, error?: unknown): void {
  const scope = keyScope(apiKey);
  if (error instanceof GeminiHttpError && error.status === 404) {
    retiredModels.set(`${scope}:${model}`, Date.now() + RETIRED_TTL_MS);
  } else {
    coolingModels.set(`${scope}:${model}`, Date.now() + COOLDOWN_MS);
  }
}

/**
 * Abre un stream de texto con failover entre modelos hasta el primer fragmento.
 * Lanza `ProviderFailure` (mensaje accionable) si ningún modelo responde.
 */
export async function openGeminiStream(
  apiKey: string,
  req: ModelRequest,
  options: GeminiCallOptions & { json?: boolean; skipModels?: string[] } = {}
): Promise<GeminiStream> {
  const deadline = Date.now() + (options.budgetMs ?? 40_000);
  const errors: { model: string; error: unknown }[] = [];
  const scope = keyScope(apiKey);

  const skip = new Set(options.skipModels ?? []);
  for (const model of geminiCandidates(scope, options.preferredModel)) {
    if (skip.has(model)) continue;
    if (deadline - Date.now() < 3_000) break;
    try {
      const stream = await openModelStream(model, apiKey, req, true, options.temperature ?? 0.4, options.json ?? true);
      coolingModels.delete(`${scope}:${model}`);
      return stream;
    } catch (error) {
      errors.push({ model, error });
      console.warn(`[gemini] ${model} (stream) falló:`, error instanceof Error ? error.message.slice(0, 160) : error);
      if (isInvalidKeyError(error)) break;
      if (isNetworkError(error)) break;
      if (error instanceof GeminiHttpError && error.status === 404) {
        retiredModels.set(`${scope}:${model}`, Date.now() + RETIRED_TTL_MS);
      } else {
        coolingModels.set(`${scope}:${model}`, Date.now() + COOLDOWN_MS);
      }
    }
  }
  throw new ProviderFailure(
    errors.length > 0
      ? describeGeminiFailure(errors, options.userKey)
      : { code: "overloaded", message: "Gemini no respondió a tiempo. Vuelve a intentarlo en unos segundos." }
  );
}
