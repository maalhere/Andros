// ============================================================================
// ANDROS — CLIENTE DE GEMINI CON CADENA DE RESPALDO (solo servidor)
//
// Lo comparten el Oráculo (/api/oracle) y los Nodos IA (/api/ai/node-chat).
// Prueba los modelos en orden, recuerda los retirados (404) y deja descansar
// los saturados (503/429), y traduce los fallos a mensajes accionables.
// ============================================================================

import { createHash } from "node:crypto";
import type { OracleHistoryTurn, OracleIssue } from "@/types/oracle";
import { parseJsonText } from "@/lib/ai/jsonText";

/**
 * Modelos de Gemini en orden de preferencia (`GEMINI_MODEL` manda sobre todos).
 * Se pide gemini-2.5-flash con respaldo a gemini-2.0-flash, pero Google ya los
 * retiró para claves nuevas (404): en cuanto un modelo responde 404 se marca
 * como retirado y no se vuelve a intentar durante horas. Si un modelo está
 * saturado (503), sin cuota (429) o tarda demasiado, se pasa AL INSTANTE al
 * siguiente y se le da un minuto de descanso.
 */
export const GEMINI_MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL?.trim(),
      "gemini-2.5-flash",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-2.0-flash",
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

const isInvalidKeyError = (error: unknown) =>
  error instanceof GeminiHttpError &&
  (error.status === 401 ||
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
