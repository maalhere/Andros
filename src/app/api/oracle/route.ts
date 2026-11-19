// ============================================================================
// ANDROS — MOTOR HÍBRIDO DEL ORÁCULO IA (BLOQUE 1: IA semántica real)
//
// Prioridad: GEMINI_API_KEY > OPENAI_API_KEY > intérprete local.
// El modelo recibe el lienzo COMPLETO (nodos, archivos, dimensiones 3D,
// extractos de texto y cables) y responde SIEMPRE en JSON estructurado.
//
// Dos modos:
//   · "canvas"   → { "reply": "...", "actions": [ ... ] } (acciones en vivo)
//   · "document" → { "reply": "...", "document": { title, markdown } }
//                  para el Estudio del Oráculo (no toca el lienzo).
// Cada acción se valida aquí antes de llegar al cliente (ids existentes, textos
// recortados). Si la IA externa falla, la respuesta trae `issue` con un
// mensaje accionable (falta la clave, clave inválida, cuota, saturación).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { runLocalOracle } from "@/lib/oracle/localInterpreter";
import type {
  OracleAction,
  OracleCanvasContext,
  OracleDocument,
  OracleEngine,
  OracleHistoryTurn,
  OracleIssue,
  OracleLayoutZone,
  OracleMode,
  OracleRequestBody,
  OracleResponseBody,
} from "@/types/oracle";
import type { NodeArchetype } from "@/types/workspace";

/** Gemini puede tardar con documentos largos: margen para la función serverless. */
export const maxDuration = 120;

/**
 * Modelos de Gemini en orden de preferencia (`GEMINI_MODEL` manda sobre todos).
 * Se pide gemini-2.5-flash con respaldo a gemini-2.0-flash, pero Google ya los
 * retiró para claves nuevas (404): en cuanto un modelo responde 404 se marca
 * como retirado y no se vuelve a intentar durante horas. Si un modelo está
 * saturado (503), sin cuota (429) o tarda demasiado, se pasa AL INSTANTE al
 * siguiente y se le da un minuto de descanso.
 */
const GEMINI_MODELS = [
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
const ATTEMPT_TIMEOUT_MS = 25_000;
const TOTAL_BUDGET_MS = 95_000;
/** Un modelo con 404 (retirado / no habilitado) no se reintenta en 6 h. */
const RETIRED_TTL_MS = 6 * 60 * 60 * 1000;
/** Un modelo saturado o sin cuota va al final de la cola durante 60 s. */
const COOLDOWN_MS = 60_000;

/** Estado compartido entre peticiones (vive mientras viva la instancia del servidor). */
const retiredModels = new Map<string, number>();
const coolingModels = new Map<string, number>();


const SYSTEM_INSTRUCTIONS = `Eres el Oráculo IA de Andros: un asistente de investigación e ingeniería que vive dentro de un lienzo espacial de nodos. Tienes permiso para LEER, ANALIZAR, CREAR y ORGANIZAR el lienzo.

TIPOS DE NODO
- "file-node": archivo (modelos 3D .stl/.obj/.3mf/.step, PDF, CSV, imágenes…). Trae fileName, fileExtension, fileSizeBytes y, si el visor 3D ya lo midió, dimensionsMm (caja envolvente real en milímetros: ancho × profundidad × alto).
- "sketch-note-node": cuaderno de texto (títulos, párrafos, viñetas, checklist y bocetos). Su texto llega en textExcerpt.
- "calc-latex-node": hoja de cálculo con ecuaciones LaTeX. Su justificación, ecuaciones y celdas llegan en textExcerpt.
- "resource-link-node": enlace externo (YouTube, GitHub, paper científico, LinkedIn/perfil o genérico). Su URL, plataforma, título y resumen llegan en textExcerpt.
- "code-lab-node": laboratorio de código/cálculo rápido (variables, funciones matemáticas, linspace y plot). Su código, variables resultantes y errores llegan en textExcerpt.
Cada nodo trae connectedNodeIds; la lista "connections" trae los cables con su etiqueta.

FORMATO DE RESPUESTA (obligatorio)
Responde SOLO con JSON: {"reply": string, "actions": Action[]}.
- "reply": en español, claro y accionable (2 a 5 frases). Di qué hiciste en el lienzo y cuál es el siguiente paso concreto para el usuario.
- "actions": acciones que se ejecutan en vivo. Arreglo vacío si solo respondes una pregunta.

ACCIONES DISPONIBLES
1. {"type":"create_text_block","title":string,"content":string,"linkedNodeId"?:string,"connectionLabel"?:string}
   Crea un bloque de texto en el lienzo y lo conecta con un cable etiquetado al nodo "linkedNodeId".
   - "content" usa UNA idea por línea con estas marcas: "# Título de sección", "- viñeta", "1. paso numerado", "- [ ] tarea pendiente", o una línea normal como párrafo. No uses tablas ni negritas.
   - El contenido debe ser técnico, real y aplicable al archivo concreto: usa su nombre, extensión, peso y dimensiones reales; propone valores numéricos concretos (alturas de capa, temperaturas, tolerancias, cargas, cantidades, criterios de aceptación). Entre 12 y 45 líneas.
   - PROHIBIDO dejar huecos de plantilla ("[completar]", "XX", "TBD", "por definir"). Si te falta un dato, asume un valor razonable y márcalo como "Supuesto: …" para que el usuario lo valide.
   - "connectionLabel": 1 a 4 palabras que describan la relación (ej. "Plan de pruebas", "Ficha técnica", "Pendientes de impresión").
2. {"type":"connect_nodes","fromNodeId":string,"toNodeId":string,"label"?:string}
   Úsala cuando la relación entre dos nodos sea evidente por su contenido (el cálculo usa datos del CSV, la nota describe la pieza…). Etiqueta corta con verbo ("Aporta Fy a", "Describe", "Valida").
3. {"type":"apply_human_layout","assignments"?:[{"nodeId":string,"zone":1|2|3}]}
   Ordena el lienzo por flujo de trabajo humano en columnas: Zona 1 = archivos fuente y modelos 3D; Zona 2 = bloques de texto, especificaciones y análisis, cada uno a la derecha de su archivo; Zona 3 = enlaces externos, fuentes científicas y hojas de cálculo. El ordenamiento automático ya clasifica por tipo; manda "assignments" SOLO para nodos cuyo contenido los ubique en otra zona (ej. un cuaderno que es una lista de referencias → zona 3). Úsala cuando pidan ordenar, organizar, acomodar o limpiar el lienzo. Si en la misma respuesta creas bloques o cables, la reorganización se ejecuta al final.
4. {"type":"update_node_note","nodeId":string,"content":string,"mode"?:"append"|"replace"}
   Añade (por defecto) o reemplaza texto en un nodo existente. Mismo formato de líneas que create_text_block.

REGLAS
- Usa SOLO ids que existan en el contexto. Nunca inventes ids.
- Si el contexto trae "linkedNodeId", ese es el archivo/nodo al que se refiere el usuario ("este STL", "esta pieza", "este archivo"): úsalo como linkedNodeId de los bloques que crees.
- Si el usuario menciona un archivo por su nombre o título, localízalo en el contexto y úsalo.
- Si no hay linkedNodeId pero sí "selectedNodeId" y el usuario dice "este/esta", usa el seleccionado.
- Un STL/OBJ no guarda unidades: asume milímetros salvo que las dimensiones sean absurdas, y dilo.
- Puedes combinar varias acciones en una respuesta (ej. crear dos bloques y conectarlos a su archivo).
- Si lo pedido no se puede hacer con estas acciones, explícalo en "reply" y deja "actions" vacío.`;

// ----------------------------------------------------------------------------
// Validación: solo pasan al cliente acciones bien formadas y con ids reales.
// ----------------------------------------------------------------------------

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const ARCHETYPES: NodeArchetype[] = [
  "file-node",
  "sketch-note-node",
  "calc-latex-node",
  "resource-link-node",
  "code-lab-node",
];

function sanitizeActions(raw: unknown, context: OracleCanvasContext): OracleAction[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(context.nodes.map((n) => n.id));
  const fallbackLink =
    (context.linkedNodeId && ids.has(context.linkedNodeId) ? context.linkedNodeId : null) ?? null;
  const actions: OracleAction[] = [];

  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;

    switch (a.type) {
      case "create_text_block": {
        const content = str(a.content, 12_000);
        if (!content) break;
        const requested = str(a.linkedNodeId, 200);
        const linkedNodeId = ids.has(requested) ? requested : fallbackLink;
        actions.push({
          type: "create_text_block",
          title: str(a.title, 120) || "Bloque de texto IA",
          content,
          ...(linkedNodeId ? { linkedNodeId } : {}),
          ...(str(a.connectionLabel, 60) ? { connectionLabel: str(a.connectionLabel, 60) } : {}),
        });
        break;
      }
      case "connect_nodes": {
        const fromNodeId = str(a.fromNodeId, 200);
        const toNodeId = str(a.toNodeId, 200);
        if (!ids.has(fromNodeId) || !ids.has(toNodeId) || fromNodeId === toNodeId) break;
        actions.push({
          type: "connect_nodes",
          fromNodeId,
          toNodeId,
          ...(str(a.label, 60) ? { label: str(a.label, 60) } : {}),
        });
        break;
      }
      case "apply_human_layout":
      case "auto_layout": {
        const assignments = Array.isArray(a.assignments)
          ? (a.assignments as unknown[])
              .map((entry) => {
                const e = (entry ?? {}) as Record<string, unknown>;
                const zone = Number(e.zone);
                const nodeId = str(e.nodeId, 200);
                return ids.has(nodeId) && (zone === 1 || zone === 2 || zone === 3)
                  ? { nodeId, zone: zone as OracleLayoutZone }
                  : null;
              })
              .filter((e): e is { nodeId: string; zone: OracleLayoutZone } => e !== null)
          : [];
        actions.push({
          type: "apply_human_layout",
          ...(assignments.length > 0 ? { assignments } : {}),
        });
        break;
      }
      case "update_node_note": {
        const nodeId = str(a.nodeId, 200);
        const content = str(a.content, 12_000);
        if (!ids.has(nodeId) || !content) break;
        actions.push({
          type: "update_node_note",
          nodeId,
          content,
          mode: a.mode === "replace" ? "replace" : "append",
        });
        break;
      }
      case "create_node": {
        const nodeType = ARCHETYPES.find((t) => t === a.nodeType);
        actions.push({
          type: "create_node",
          ...(nodeType ? { nodeType } : {}),
          ...(str(a.title, 120) ? { title: str(a.title, 120) } : {}),
          ...(str(a.summary, 2000) ? { summary: str(a.summary, 2000) } : {}),
        });
        break;
      }
      case "annotate_selected":
        if (context.selectedNodeId) actions.push({ type: "annotate_selected" });
        break;
    }
  }

  // Primero se crea y conecta; la reorganización siempre va al final.
  const layouts = actions.filter((x) => x.type === "apply_human_layout");
  const rest = actions.filter((x) => x.type !== "apply_human_layout");
  return layouts.length > 0 ? [...rest, layouts[layouts.length - 1]] : rest;
}

function parseModelOutput(
  raw: unknown,
  context: OracleCanvasContext
): { reply: string; actions: OracleAction[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const reply = str(obj.reply, 3000);
  const actions = sanitizeActions(obj.actions, context);
  if (!reply && actions.length === 0) return null;
  return { reply: reply || "Listo: apliqué los cambios en el lienzo.", actions };
}

// ----------------------------------------------------------------------------
// Modo documento (Estudio del Oráculo)
// ----------------------------------------------------------------------------

const DOCUMENT_INSTRUCTIONS = `Eres el Oráculo IA de Andros en modo ESTUDIO DE DOCUMENTOS: redactas y editas un documento técnico junto al usuario, como un lienzo de escritura. El documento NO se pega en el lienzo espacial hasta que el usuario pulse "Añadir al lienzo".

RECIBES: el contexto del lienzo (JSON, para usar datos reales de archivos y nodos), el DOCUMENTO ACTUAL (título + Markdown; puede estar vacío) y la instrucción del usuario.

FORMATO DE RESPUESTA (obligatorio)
Responde SOLO con JSON: {"reply": string, "document": {"title": string, "markdown": string} | null}
- "reply": en español, 1 a 3 frases conversacionales: qué escribiste o cambiaste y un siguiente paso sugerido. NO copies el documento en "reply".
- "document": el documento COMPLETO ya actualizado (nunca un fragmento ni un diff). Usa null SOLO si el usuario hace una pregunta que no requiere cambiar el documento.
- Si el documento actual tiene contenido y te piden un cambio, edítalo conservando todo lo que no se pidió cambiar.
- "title": corto (máx. 80 caracteres), sin "#".

MARKDOWN PERMITIDO
- Títulos "#", "##", "###"; párrafos; listas "-" y "1."; tareas "- [ ]" / "- [x]"; **negritas**, *cursivas*, \`código\` y bloques \`\`\` de código.
- Tablas GFM con fila de encabezado y separador (| A | B |\\n|---|---|).
- Matemáticas LaTeX: en línea con $...$ y en bloque con $$...$$ en su propia línea.
- Dentro del JSON, escapa SIEMPRE las barras invertidas de LaTeX duplicándolas (\\\\frac, \\\\sigma, \\\\times).

CALIDAD
- Contenido técnico, real y aplicable: usa nombres, extensiones, pesos y dimensiones reales del contexto; da valores numéricos concretos.
- PROHIBIDO dejar huecos de plantilla ("[completar]", "XX", "TBD"). Si falta un dato, asume un valor razonable y márcalo como "Supuesto: …".`;

const MAX_DOCUMENT_CHARS = 60_000;

function sanitizeDocument(raw: unknown): OracleDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const markdown = repairLatexControlChars(typeof d.markdown === "string" ? d.markdown : "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_DOCUMENT_CHARS);
  if (!markdown) return null;
  const title = str(d.title, 160).replace(/^#+\s*/, "") || "Documento sin título";
  return { title, markdown };
}

/**
 * Si el modelo escribió "\frac" sin duplicar la barra, JSON lo convierte en un
 * salto de página + "rac". Se recuperan los casos típicos de LaTeX.
 */
function repairLatexControlChars(text: string): string {
  return text
    .replace(/\f/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\x0b/g, "\\v")
    .replace(/\t(?=[a-zA-Z]{2})/g, "\\t")
    .replace(/\r(?=[a-zA-Z]{2})/g, "\\r");
}

function parseDocumentOutput(raw: unknown): { reply: string; document: OracleDocument | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const reply = str(obj.reply, 3000);
  const document = sanitizeDocument(obj.document);
  if (!reply && !document) return null;
  return { reply: reply || "Listo: actualicé el documento.", document };
}

/** Quita ```json … ``` si el modelo envolvió la respuesta en un bloque de código. */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // LaTeX sin escapar ("\alpha") rompe el JSON: se duplican las barras
    // que no forman un escape válido y se reintenta una vez.
    const repaired = trimmed.replace(/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m) =>
      m.length > 1 ? m : "\\\\"
    );
    if (repaired === trimmed) throw error;
    return JSON.parse(repaired);
  }
}

function buildDocumentUserContent(
  prompt: string,
  context: OracleCanvasContext,
  current: OracleDocument | null
): string {
  const linked = context.linkedNodeId
    ? context.nodes.find((n) => n.id === context.linkedNodeId)
    : undefined;
  const focus = linked
    ? `\n\nArchivo/nodo de referencia elegido por el usuario: "${linked.title}" (id ${linked.id}).`
    : "";
  const doc =
    current && current.markdown.trim()
      ? `DOCUMENTO ACTUAL\nTítulo: ${current.title}\n---\n${current.markdown.slice(0, MAX_DOCUMENT_CHARS)}\n---`
      : "DOCUMENTO ACTUAL: vacío (crea uno nuevo).";
  return `Contexto actual del lienzo (JSON):\n${JSON.stringify(context)}${focus}\n\n${doc}\n\nInstrucción del usuario:\n${prompt}`;
}

function buildUserContent(prompt: string, context: OracleCanvasContext): string {
  const linked = context.linkedNodeId
    ? context.nodes.find((n) => n.id === context.linkedNodeId)
    : undefined;
  const focus = linked
    ? `\n\nArchivo/nodo vinculado por el usuario: "${linked.title}" (id ${linked.id}).`
    : "";
  return `Contexto actual del lienzo (JSON):\n${JSON.stringify(context)}${focus}\n\nInstrucción del usuario:\n${prompt}`;
}

function sanitizeHistory(history: unknown): OracleHistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-6)
    .map((turn) => {
      const t = (turn ?? {}) as Record<string, unknown>;
      const role = t.role === "oracle" ? "oracle" : t.role === "user" ? "user" : null;
      const text = str(t.text, 1200);
      return role && text ? { role, text } : null;
    })
    .filter((t): t is OracleHistoryTurn => t !== null);
}

// ----------------------------------------------------------------------------
// Proveedores
// ----------------------------------------------------------------------------

/** Lo que se le pide al modelo en una llamada (independiente del proveedor). */
interface ModelRequest {
  system: string;
  userContent: string;
  history: OracleHistoryTurn[];
  maxOutputTokens: number;
}

/** Error de Gemini con el código HTTP, para decidir si probar otro modelo. */
class GeminiHttpError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(`Gemini respondió ${status}: ${detail.slice(0, 300)}`);
  }
}

/** Fallo de todos los modelos de un proveedor, ya traducido para el usuario. */
class ProviderFailure extends Error {
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
function geminiCandidates(): string[] {
  const now = Date.now();
  const alive = GEMINI_MODELS.filter((m) => (retiredModels.get(m) ?? 0) < now);
  const ready = alive.filter((m) => (coolingModels.get(m) ?? 0) < now);
  const cooling = alive.filter((m) => (coolingModels.get(m) ?? 0) >= now);
  const list = [...ready, ...cooling];
  // Si todos quedaron retirados (p. ej. cambió la clave), se vuelve a empezar.
  return list.length > 0 ? list : GEMINI_MODELS;
}

/** Traduce los errores acumulados a un mensaje que el usuario pueda resolver. */
function describeGeminiFailure(errors: { model: string; error: unknown }[]): OracleIssue {
  const http = errors
    .map((e) => e.error)
    .filter((e): e is GeminiHttpError => e instanceof GeminiHttpError);

  if (errors.some((e) => isInvalidKeyError(e.error))) {
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

async function callGemini(apiKey: string, req: ModelRequest): Promise<{ raw: unknown; model: string }> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const errors: { model: string; error: unknown }[] = [];

  for (const model of geminiCandidates()) {
    const remaining = deadline - Date.now();
    if (remaining < 4_000) break;
    try {
      const raw = await callGeminiModel(model, apiKey, req, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
      coolingModels.delete(model);
      return { raw, model };
    } catch (error) {
      errors.push({ model, error });
      console.warn(`[oracle] ${model} falló:`, error instanceof Error ? error.message : error);
      if (isInvalidKeyError(error)) break; // Con una clave inválida ningún modelo servirá.
      if (error instanceof GeminiHttpError && error.status === 404) {
        retiredModels.set(model, Date.now() + RETIRED_TTL_MS);
      } else {
        coolingModels.set(model, Date.now() + COOLDOWN_MS);
      }
      // Cualquier otro fallo (404, 429, 503, demora, JSON inválido): siguiente modelo.
    }
  }
  throw new ProviderFailure(
    errors.length > 0
      ? describeGeminiFailure(errors)
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
  withThinking = true
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
        temperature: 0.4,
        maxOutputTokens: req.maxOutputTokens,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Modelo que no acepta la configuración de razonamiento: un reintento sin ella.
    if (res.status === 400 && thinkingConfig && /thinking/i.test(detail)) {
      return callGeminiModel(model, apiKey, req, timeoutMs, false);
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

async function callOpenAI(apiKey: string, req: ModelRequest): Promise<{ raw: unknown; model: string }> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS * 2),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      max_tokens: req.maxOutputTokens,
      messages: [
        { role: "system", content: req.system },
        ...req.history.map((turn) => ({
          role: turn.role === "oracle" ? "assistant" : "user",
          content: turn.text,
        })),
        { role: "user", content: req.userContent },
      ],
    }),
  });
  if (!res.ok) {
    const issue: OracleIssue =
      res.status === 401
        ? { code: "invalid_key", message: "OpenAI rechazó tu OPENAI_API_KEY. Revísala en .env.local." }
        : res.status === 429
          ? { code: "rate_limited", message: "Superaste la cuota de OpenAI. Espera un minuto e inténtalo de nuevo." }
          : { code: "unavailable", message: `OpenAI respondió ${res.status}. Inténtalo de nuevo.` };
    throw new ProviderFailure(issue);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Respuesta de OpenAI sin texto utilizable");
  return { raw: parseJsonText(text), model };
}

const MISSING_KEY_ISSUE: OracleIssue = {
  code: "missing_key",
  message:
    "Falta GEMINI_API_KEY. Créala gratis en https://aistudio.google.com/apikey y pégala en .env.local (local) o en Vercel → Settings → Environment Variables (producción); después reinicia el servidor.",
};

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse<OracleResponseBody>> {
  let body: Partial<OracleRequestBody> | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, 4000) : "";
  const mode: OracleMode = body?.mode === "document" ? "document" : "canvas";
  const rawContext = body?.context;
  const context: OracleCanvasContext = {
    nodes: Array.isArray(rawContext?.nodes) ? rawContext.nodes.slice(0, 200) : [],
    connections: Array.isArray(rawContext?.connections) ? rawContext.connections.slice(0, 500) : [],
    selectedNodeId: rawContext?.selectedNodeId ?? null,
    linkedNodeId: rawContext?.linkedNodeId ?? null,
  };
  const history = sanitizeHistory(body?.history);
  const currentDocument = mode === "document" ? sanitizeDocument(body?.document) : null;

  if (!prompt.trim()) {
    return NextResponse.json({
      reply: "Escribe una instrucción o usa uno de los botones de acción rápida.",
      actions: [],
      engine: "local",
    });
  }

  const request_: ModelRequest =
    mode === "document"
      ? {
          system: DOCUMENT_INSTRUCTIONS,
          userContent: buildDocumentUserContent(prompt, context, currentDocument),
          history,
          maxOutputTokens: 16_384,
        }
      : {
          system: SYSTEM_INSTRUCTIONS,
          userContent: buildUserContent(prompt, context),
          history,
          maxOutputTokens: 8192,
        };

  const providers: {
    engine: OracleEngine;
    key: string | undefined;
    call: (key: string, req: ModelRequest) => Promise<{ raw: unknown; model: string }>;
  }[] = [
    { engine: "gemini", key: process.env.GEMINI_API_KEY?.trim(), call: callGemini },
    { engine: "openai", key: process.env.OPENAI_API_KEY?.trim(), call: callOpenAI },
  ];

  let issue: OracleIssue | null = null;
  for (const provider of providers) {
    if (!provider.key) continue;
    try {
      const { raw, model } = await provider.call(provider.key, request_);
      if (mode === "document") {
        const parsed = parseDocumentOutput(raw);
        if (parsed) {
          return NextResponse.json({ ...parsed, actions: [], engine: provider.engine, model });
        }
      } else {
        const parsed = parseModelOutput(raw, context);
        if (parsed) return NextResponse.json({ ...parsed, engine: provider.engine, model });
      }
      issue ??= {
        code: "unavailable",
        message: "La IA respondió en un formato inesperado. Vuelve a intentarlo.",
      };
    } catch (error) {
      // Clave presente pero la llamada falló: se prueba el siguiente motor.
      console.error(`[oracle] ${provider.engine} falló:`, error instanceof Error ? error.message : error);
      issue ??=
        error instanceof ProviderFailure
          ? error.issue
          : {
              code: "unavailable",
              message: `No pude obtener respuesta de ${provider.engine === "gemini" ? "Gemini" : "OpenAI"}. Inténtalo de nuevo.`,
            };
    }
  }

  const hadExternalKey = providers.some((p) => p.key);
  const finalIssue = hadExternalKey ? issue : MISSING_KEY_ISSUE;

  // Modo documento: sin IA no se puede redactar; se explica qué hacer.
  if (mode === "document") {
    return NextResponse.json({
      reply: finalIssue?.message ?? "No pude redactar el documento. Inténtalo de nuevo.",
      actions: [],
      engine: "local",
      document: null,
      ...(finalIssue ? { issue: finalIssue } : {}),
    });
  }

  // Modo lienzo: el intérprete local sigue ejecutando las órdenes básicas.
  const local = runLocalOracle(prompt, context);
  return NextResponse.json({
    ...local,
    reply: finalIssue ? `${finalIssue.message}\n\nModo local: ${local.reply}` : local.reply,
    ...(finalIssue ? { issue: finalIssue } : {}),
  });
}
