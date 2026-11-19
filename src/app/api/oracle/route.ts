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
import {
  ATTEMPT_TIMEOUT_MS,
  callGemini,
  ProviderFailure,
  type ModelRequest,
} from "@/lib/ai/gemini";
import { parseJsonText, repairLatexControlChars } from "@/lib/ai/jsonText";

/** Gemini puede tardar con documentos largos: margen para la función serverless. */
export const maxDuration = 120;



const SYSTEM_INSTRUCTIONS = `Eres el Oráculo IA de Andros: un asistente de investigación e ingeniería que vive dentro de un lienzo espacial de nodos. Tienes permiso para LEER, ANALIZAR, CREAR y ORGANIZAR el lienzo.

TIPOS DE NODO
- "file-node": archivo (modelos 3D .stl/.obj/.3mf/.step, PDF, CSV, imágenes…). Trae fileName, fileExtension, fileSizeBytes y, si el visor 3D ya lo midió, dimensionsMm (caja envolvente real en milímetros: ancho × profundidad × alto).
- "sketch-note-node": cuaderno de texto (títulos, párrafos, viñetas, checklist y bocetos). Su texto llega en textExcerpt.
- "calc-latex-node": hoja de cálculo con ecuaciones LaTeX. Su justificación, ecuaciones y celdas llegan en textExcerpt.
- "resource-link-node": enlace externo (YouTube, GitHub, paper científico, LinkedIn/perfil o genérico). Su URL, plataforma, título y resumen llegan en textExcerpt.
- "code-lab-node": laboratorio de código/cálculo rápido (variables, funciones matemáticas, linspace y plot). Su código, variables resultantes y errores llegan en textExcerpt.
- "ai-chat-node": conversación con una IA (Gemini, Claude o ChatGPT), propia o importada. Su proveedor, resumen y últimos mensajes llegan en textExcerpt.
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
  "ai-chat-node",
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

function parseDocumentOutput(raw: unknown): { reply: string; document: OracleDocument | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const reply = str(obj.reply, 3000);
  const document = sanitizeDocument(obj.document);
  if (!reply && !document) return null;
  return { reply: reply || "Listo: actualicé el documento.", document };
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
