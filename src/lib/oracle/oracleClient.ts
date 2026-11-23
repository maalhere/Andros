// ============================================================================
// ANDROS — CLIENTE DEL ORÁCULO (streaming NDJSON de /api/oracle)
//
// Lee la respuesta línea a línea: el texto de "reply" aparece mientras el modelo
// escribe y las acciones del lienzo llegan en el evento final (ya validadas por
// el servidor). Traduce los fallos de red/HTTP a mensajes claros y accionables.
// ============================================================================

import type { OracleRequestBody, OracleResponseBody, OracleStreamEvent } from "@/types/oracle";

export interface OracleStreamHandlers {
  /** Texto nuevo de la respuesta (se añade al final del texto mostrado). */
  onDelta?: (text: string) => void;
  /** El modelo se cortó a mitad y se reintenta con otro: descartar lo mostrado. */
  onReset?: () => void;
  /** Modelo que empezó a responder. */
  onModel?: (model: string) => void;
}

/** Error de comunicación con el Oráculo, con un mensaje listo para mostrar. */
export class OracleClientError extends Error {
  constructor(
    message: string,
    public code: "network" | "invalid_key" | "rate_limited" | "overloaded" | "unavailable"
  ) {
    super(message);
  }
}

/** Mensaje accionable según el código HTTP de una respuesta que no es el stream. */
function httpError(status: number): OracleClientError {
  if (status === 401 || status === 403) {
    return new OracleClientError(
      "El servidor rechazó la petición (clave de IA inválida o sin permisos). Revisa tu clave de Gemini en Claves IA o la GEMINI_API_KEY del servidor.",
      "invalid_key"
    );
  }
  if (status === 429) {
    return new OracleClientError(
      "Se superó la cuota de IA (demasiadas consultas seguidas). Espera un minuto e inténtalo de nuevo.",
      "rate_limited"
    );
  }
  if (status === 408 || status === 504) {
    return new OracleClientError(
      "El servidor tardó demasiado en responder. Prueba con una petición más corta o inténtalo de nuevo.",
      "overloaded"
    );
  }
  if (status >= 500) {
    return new OracleClientError(`El servidor de Andros tuvo un problema (${status}). Inténtalo de nuevo en unos segundos.`, "unavailable");
  }
  return new OracleClientError(`El servidor respondió ${status}. Inténtalo de nuevo.`, "unavailable");
}

export async function queryOracle(
  body: OracleRequestBody,
  handlers: OracleStreamHandlers = {},
  signal?: AbortSignal
): Promise<OracleResponseBody> {
  let res: Response;
  try {
    res = await fetch("/api/oracle", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OracleClientError(
      "No hay conexión con Andros. Comprueba tu conexión a Internet (o que el servidor esté en marcha) e inténtalo de nuevo.",
      "network"
    );
  }
  if (!res.ok) throw httpError(res.status);

  const type = res.headers.get("content-type") ?? "";
  // Respuesta normal (sin streaming): un único JSON.
  if (type.includes("application/json")) return (await res.json()) as OracleResponseBody;
  if (!res.body) throw new OracleClientError("La respuesta del Oráculo llegó vacía. Inténtalo de nuevo.", "unavailable");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: OracleResponseBody | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: OracleStreamEvent;
    try {
      event = JSON.parse(line) as OracleStreamEvent;
    } catch {
      return; // Línea cortada o ruido: se ignora.
    }
    if (event.t === "delta") handlers.onDelta?.(event.text);
    else if (event.t === "reset") handlers.onReset?.();
    else if (event.t === "meta") handlers.onModel?.(event.model);
    else if (event.t === "final") final = event.data;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    handleLine(buffer);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OracleClientError("Se cortó la conexión mientras el Oráculo respondía. Inténtalo de nuevo.", "network");
  }

  if (!final) {
    throw new OracleClientError(
      "La respuesta del Oráculo se interrumpió antes de terminar (el servidor cortó la conexión). Inténtalo de nuevo.",
      "overloaded"
    );
  }
  return final;
}
