// ============================================================================
// ANDROS — MOTOR HÍBRIDO DEL ORÁCULO IA (BLOQUE 1: IA semántica real)
//
// Prioridad: GEMINI_API_KEY (gemini-2.5-flash) > OPENAI_API_KEY > intérprete local.
// El modelo recibe el lienzo COMPLETO (nodos, archivos, dimensiones 3D,
// extractos de texto y cables) y responde SIEMPRE en JSON estructurado:
//   { "reply": "...", "actions": [ ... ] }
// Cada acción se valida aquí antes de llegar al cliente (ids existentes, textos
// recortados). Si no hay clave o la llamada falla, cae al intérprete local:
// el asistente nunca deja de responder.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { runLocalOracle } from "@/lib/oracle/localInterpreter";
import type {
  OracleAction,
  OracleCanvasContext,
  OracleEngine,
  OracleHistoryTurn,
  OracleLayoutZone,
  OracleRequestBody,
  OracleResponseBody,
} from "@/types/oracle";
import type { NodeArchetype } from "@/types/workspace";

/**
 * Modelos de Gemini en orden de preferencia. Se pide gemini-2.5-flash, pero
 * Google ya no lo habilita para claves nuevas (responde 404); en ese caso, o si
 * un modelo está saturado (503) o tarda demasiado, se pasa solo al siguiente.
 * `GEMINI_MODEL` en .env.local tiene prioridad sobre todos.
 */
const GEMINI_MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      "gemini-2.5-flash",
      "gemini-3.8-flash",
      // Respaldo rápido cuando los modelos "flash" están saturados.
      "gemini-3.5-flash-lite",
      "gemini-flash-lite-latest",
    ].filter((m): m is string => typeof m === "string" && m.trim() !== "")
  ),
];
/** Tiempo máximo por intento y tiempo total que el Oráculo espera a Gemini. */
const ATTEMPT_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 100_000;


const SYSTEM_INSTRUCTIONS = `Eres el Oráculo IA de Andros: un asistente de investigación e ingeniería que vive dentro de un lienzo espacial de nodos. Tienes permiso para LEER, ANALIZAR, CREAR y ORGANIZAR el lienzo.

TIPOS DE NODO
- "file-node": archivo (modelos 3D .stl/.obj/.3mf/.step, PDF, CSV, imágenes…). Trae fileName, fileExtension, fileSizeBytes y, si el visor 3D ya lo midió, dimensionsMm (caja envolvente real en milímetros: ancho × profundidad × alto).
- "sketch-note-node": cuaderno de texto (títulos, párrafos, viñetas, checklist y bocetos). Su texto llega en textExcerpt.
- "calc-latex-node": hoja de cálculo con ecuaciones LaTeX. Su justificación, ecuaciones y celdas llegan en textExcerpt.
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

const ARCHETYPES: NodeArchetype[] = ["file-node", "sketch-note-node", "calc-latex-node"];

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

/** Quita ```json … ``` si el modelo envolvió la respuesta en un bloque de código. */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(trimmed);
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

/** Error de Gemini con el código HTTP, para decidir si probar otro modelo. */
class GeminiHttpError extends Error {
  constructor(
    public status: number,
    detail: string
  ) {
    super(`Gemini respondió ${status}: ${detail.slice(0, 300)}`);
  }
}

async function callGemini(
  apiKey: string,
  prompt: string,
  context: OracleCanvasContext,
  history: OracleHistoryTurn[]
): Promise<unknown> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastError: unknown = null;

  for (const model of GEMINI_MODELS) {
    // Un reintento corto si el modelo está saturado; si sigue, se cambia de modelo.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) throw lastError ?? new Error("Gemini sin tiempo disponible");
      try {
        return await callGeminiModel(
          model,
          apiKey,
          prompt,
          context,
          history,
          Math.min(ATTEMPT_TIMEOUT_MS, remaining)
        );
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof GeminiHttpError && [429, 500, 503].includes(error.status);
        if (retryable && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        // 404/403/400 (modelo no habilitado), saturación persistente o
        // demora excesiva: se prueba el siguiente modelo de la lista.
        break;
      }
    }
  }
  throw lastError ?? new Error("Sin modelos de Gemini configurados");
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  prompt: string,
  context: OracleCanvasContext,
  history: OracleHistoryTurn[],
  timeoutMs: number
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTIONS }] },
      contents: [
        ...history.map((turn) => ({
          role: turn.role === "oracle" ? "model" : "user",
          parts: [{ text: turn.text }],
        })),
        { role: "user", parts: [{ text: buildUserContent(prompt, context) }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 8192,
        // Razonamiento acotado: sin esto los modelos Gemini 3 pueden tardar
        // más de un minuto en responder. 2.5 usa presupuesto en tokens.
        thinkingConfig: model.startsWith("gemini-2.")
          ? { thinkingBudget: 1024 }
          : { thinkingLevel: "low" },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiHttpError(res.status, detail);
  }
  const data = await res.json();
  const parts: unknown[] = data?.candidates?.[0]?.content?.parts ?? [];
  // Se ignoran las partes de "pensamiento" del modelo; solo cuenta la respuesta.
  const text = parts
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      const part = p as { text?: unknown; thought?: unknown };
      return part.thought === true || typeof part.text !== "string" ? "" : part.text;
    })
    .join("");
  if (!text) throw new Error("Respuesta de Gemini sin texto utilizable");
  return parseJsonText(text);
}

async function callOpenAI(
  apiKey: string,
  prompt: string,
  context: OracleCanvasContext,
  history: OracleHistoryTurn[]
): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        ...history.map((turn) => ({
          role: turn.role === "oracle" ? "assistant" : "user",
          content: turn.text,
        })),
        { role: "user", content: buildUserContent(prompt, context) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI respondió ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Respuesta de OpenAI sin texto utilizable");
  return parseJsonText(text);
}

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
  const rawContext = body?.context;
  const context: OracleCanvasContext = {
    nodes: Array.isArray(rawContext?.nodes) ? rawContext.nodes.slice(0, 200) : [],
    connections: Array.isArray(rawContext?.connections) ? rawContext.connections.slice(0, 500) : [],
    selectedNodeId: rawContext?.selectedNodeId ?? null,
    linkedNodeId: rawContext?.linkedNodeId ?? null,
  };
  const history = sanitizeHistory(body?.history);

  if (!prompt.trim()) {
    return NextResponse.json({
      reply: "Escribe una instrucción o usa uno de los botones de acción rápida.",
      actions: [],
      engine: "local",
    });
  }

  const providers: { engine: OracleEngine; key: string | undefined; call: typeof callGemini }[] = [
    { engine: "gemini", key: process.env.GEMINI_API_KEY, call: callGemini },
    { engine: "openai", key: process.env.OPENAI_API_KEY, call: callOpenAI },
  ];

  for (const provider of providers) {
    if (!provider.key) continue;
    try {
      const parsed = parseModelOutput(
        await provider.call(provider.key, prompt, context, history),
        context
      );
      if (parsed) return NextResponse.json({ ...parsed, engine: provider.engine });
    } catch (error) {
      // Clave presente pero la llamada falló (red, cuota, formato): se prueba
      // el siguiente motor y, al final, el intérprete local.
      console.error(`[oracle] ${provider.engine} falló:`, error);
    }
  }

  const local = runLocalOracle(prompt, context);
  const hadExternalKey = providers.some((p) => p.key);
  return NextResponse.json(
    hadExternalKey
      ? {
          ...local,
          reply: `Gemini no respondió a tiempo (servicio saturado o sin conexión), así que respondí en modo local. ${local.reply}`,
        }
      : local
  );
}
