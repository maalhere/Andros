// ============================================================================
// ANDROS — INTÉRPRETE LOCAL DE COMANDOS DEL LIENZO (respaldo sin IA externa)
//
// Entiende instrucciones en español escritas a mano, SIN depender de ninguna
// API externa. Es lo que responde `/api/oracle/route.ts` cuando no hay
// `GEMINI_API_KEY` ni `OPENAI_API_KEY`, o cuando la llamada externa falla.
// Produce las mismas acciones que Gemini (ordenamiento humano, bloques de
// texto vinculados a archivos, cables), con contenido técnico calculado a
// partir de los datos reales del nodo (extensión, peso, dimensiones en mm).
// ============================================================================

import type {
  OracleAction,
  OracleCanvasContext,
  OracleCanvasNodeSummary,
  OracleResponseBody,
} from "@/types/oracle";
import type { NodeArchetype } from "@/types/workspace";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Nodos cuyo título o nombre de archivo aparece mencionado en el texto del usuario. */
function findMentionedNodes(normalizedPrompt: string, context: OracleCanvasContext) {
  const found = new Map<string, { node: OracleCanvasNodeSummary; key: string }>();
  for (const node of context.nodes) {
    const keys = [node.title, node.fileName ?? "", (node.fileName ?? "").replace(/\.[^.]+$/, "")]
      .map(normalize)
      .filter((k) => k.length > 2);
    for (const key of keys) {
      if (normalizedPrompt.includes(key)) {
        const prev = found.get(node.id);
        if (!prev || key.length > prev.key.length) found.set(node.id, { node, key });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.key.length - a.key.length);
}

function detectNodeType(normalizedPrompt: string): NodeArchetype | undefined {
  if (/(archivo|pieza|modelo 3d|\.stl|\.obj|\.3mf|\.step|cad)/.test(normalizedPrompt)) {
    return "file-node";
  }
  if (/(nota|cuaderno|bitacora|boceto)/.test(normalizedPrompt)) return "sketch-note-node";
  if (/(calculo|ecuacion|formula|hoja de calculo|latex)/.test(normalizedPrompt)) {
    return "calc-latex-node";
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Redacción de bloques de texto a partir de los datos reales del nodo
// ----------------------------------------------------------------------------

const PRINTABLE = new Set(["stl", "obj", "3mf"]);
const CAD = new Set(["step", "stp", "iges", "igs"]);

function formatBytes(bytes?: number): string {
  if (!bytes) return "peso desconocido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmt(mm: number): string {
  return mm >= 100 ? mm.toFixed(0) : mm.toFixed(1);
}

function describeNode(node: OracleCanvasNodeSummary): string[] {
  const lines: string[] = [];
  if (node.fileName) {
    lines.push(`- Archivo: ${node.fileName} (.${node.fileExtension ?? "?"}, ${formatBytes(node.fileSizeBytes)})`);
  } else {
    lines.push(`- Nodo: ${node.title} (${node.codeTag})`);
  }
  if (node.dimensionsMm) {
    const d = node.dimensionsMm;
    lines.push(`- Caja envolvente: ${fmt(d.widthMm)} × ${fmt(d.depthMm)} × ${fmt(d.heightMm)} mm (ancho × profundidad × alto)`);
  }
  return lines;
}

/** Recomendaciones que dependen del tamaño real de la pieza. */
function sizeAdvice(node: OracleCanvasNodeSummary): string[] {
  const d = node.dimensionsMm;
  if (!d) {
    return [
      "- Supuesto: unidades en milímetros. Abre la vista 3D del nodo para que Andros mida la pieza y afine estas recomendaciones.",
    ];
  }
  const longest = Math.max(d.widthMm, d.depthMm, d.heightMm);
  const shortest = Math.min(d.widthMm, d.depthMm, d.heightMm);
  const lines: string[] = [];
  if (longest > 250) {
    lines.push(`- La pieza mide ${fmt(longest)} mm en su eje mayor: supera camas típicas de 220–256 mm. Divídela o usa una impresora de formato grande.`);
  } else if (longest < 5) {
    lines.push(`- Eje mayor de solo ${fmt(longest)} mm: es probable que el archivo esté en metros o pulgadas. Revisa la escala antes de laminar.`);
  } else {
    lines.push(`- Cabe en una cama estándar de 220 × 220 mm (eje mayor ${fmt(longest)} mm).`);
  }
  if (d.heightMm > 2.5 * Math.min(d.widthMm, d.depthMm)) {
    lines.push("- Pieza esbelta (alto > 2.5 × base): considera acostarla o añadir brim de 5–8 mm para evitar que se vuelque.");
  }
  if (shortest < 1.2) {
    lines.push(`- Tiene un espesor mínimo cercano a ${fmt(shortest)} mm: usa boquilla de 0.4 mm y verifica que las paredes sean ≥ 2 perímetros.`);
  }
  return lines;
}

function buildTestPlan(node: OracleCanvasNodeSummary): string {
  const ext = (node.fileExtension ?? "").toLowerCase();
  const isPrint = PRINTABLE.has(ext) || CAD.has(ext);
  return [
    `# Plan de pruebas • ${node.title}`,
    ...describeNode(node),
    "# Objetivo",
    isPrint
      ? "Validar que la pieza impresa cumple dimensiones, ajuste y resistencia antes de producir la serie."
      : "Validar que el contenido del archivo es correcto, completo y utilizable por el resto del proyecto.",
    "# Pruebas",
    ...(isPrint
      ? [
          "1. Prueba dimensional: medir con calibrador las 3 cotas principales; tolerancia de aceptación ±0.2 mm.",
          "2. Prueba de ajuste: ensamblar con la pieza contraparte; holgura objetivo 0.2–0.3 mm en encajes.",
          "3. Prueba de adherencia entre capas: flexionar una probeta impresa con la misma orientación; no debe delaminar.",
          "4. Prueba de carga: aplicar 1.5 × la carga de servicio durante 60 s; deformación permanente < 1%.",
          "5. Inspección visual: sin warping > 0.5 mm en esquinas ni marcas de soporte en caras funcionales.",
        ]
      : [
          "1. Abrir el archivo en su programa nativo y confirmar que no está corrupto.",
          "2. Verificar unidades y que los valores clave coinciden con el resto de nodos conectados.",
          "3. Documentar versión y fecha de la fuente.",
        ]),
    "# Criterios de aceptación",
    "- [ ] Todas las pruebas dentro de tolerancia",
    "- [ ] Resultados registrados en este bloque",
    "- [ ] Responsable firma la liberación",
  ].join("\n");
}

function buildDatasheet(node: OracleCanvasNodeSummary): string {
  const ext = (node.fileExtension ?? "").toLowerCase();
  return [
    `# Ficha técnica • ${node.title}`,
    ...describeNode(node),
    `- Estado del archivo: ${node.fileStatus ?? "—"}`,
    `- Conexiones en el lienzo: ${node.connectedNodeIds.length}`,
    "# Fabricación",
    ...(PRINTABLE.has(ext)
      ? [
          "- Proceso: impresión 3D FDM",
          "- Material sugerido: PETG (uso mecánico) o PLA (prototipo)",
          "- Altura de capa: 0.20 mm · Perímetros: 3 · Relleno: 25% giroide",
          ...sizeAdvice(node),
        ]
      : CAD.has(ext)
        ? [
            "- Formato CAD paramétrico: exportar a .3mf o .stl para imprimir, o enviar a mecanizado CNC.",
            "- Supuesto: unidades en milímetros (estándar de STEP).",
          ]
        : ["- Archivo de soporte del proyecto (no es una pieza fabricable)."]),
    "# Control",
    "- [ ] Revisión de cotas críticas",
    "- [ ] Versión aprobada por diseño",
  ].join("\n");
}

function buildPrintReadiness(node: OracleCanvasNodeSummary): string {
  const ext = (node.fileExtension ?? "").toLowerCase();
  const pending: string[] = [];
  if (!node.fileName) pending.push("- [ ] Adjuntar el archivo de la pieza (.stl, .obj o .3mf)");
  else if (!PRINTABLE.has(ext)) pending.push(`- [ ] Exportar "${node.fileName}" a .stl o .3mf (el .${ext} no se imprime directo)`);
  if (node.fileStatus && node.fileStatus !== "ready") pending.push("- [ ] Esperar a que el archivo termine de cargarse");
  if (!node.dimensionsMm) pending.push("- [ ] Abrir la vista 3D para medir la pieza y confirmar la escala");
  return [
    `# Pendientes para imprimir • ${node.title}`,
    ...describeNode(node),
    ...sizeAdvice(node),
    "# Pendientes",
    ...pending,
    "- [ ] Elegir material (PLA prototipo / PETG funcional)",
    "- [ ] Definir orientación: cara plana más grande sobre la cama",
    "- [ ] Activar soportes solo en voladizos > 45°",
    "- [ ] Laminar y revisar tiempo y gramos estimados",
  ].join("\n");
}

function buildGenericSummary(node: OracleCanvasNodeSummary): string {
  return [
    `# Resumen • ${node.title}`,
    ...describeNode(node),
    node.textExcerpt ? `Contenido actual: ${node.textExcerpt.slice(0, 400)}` : "Sin texto adicional en el nodo.",
    `- Conectado con ${node.connectedNodeIds.length} nodo(s) del lienzo.`,
    "- [ ] Revisar y completar con datos del proyecto",
  ].join("\n");
}

type TextKind = "test-plan" | "datasheet" | "print-readiness" | "summary";

function detectTextKind(p: string): TextKind | null {
  if (/plan de prueba|pruebas|ensayo/.test(p)) return "test-plan";
  if (/ficha tecnica|especificacion|ficha/.test(p)) return "datasheet";
  if (/que falta|pendiente|imprimir|impresion|guia de impresion/.test(p)) return "print-readiness";
  if (/(resume|resumen|redacta|escribe|bloque de texto|nota sobre|describe)/.test(p)) return "summary";
  return null;
}

const KIND_META: Record<TextKind, { title: string; label: string; build: (n: OracleCanvasNodeSummary) => string }> = {
  "test-plan": { title: "Plan de pruebas", label: "Plan de pruebas", build: buildTestPlan },
  datasheet: { title: "Ficha técnica", label: "Ficha técnica", build: buildDatasheet },
  "print-readiness": { title: "Pendientes de impresión", label: "Pendientes de impresión", build: buildPrintReadiness },
  summary: { title: "Resumen", label: "Resumen de", build: buildGenericSummary },
};

// ----------------------------------------------------------------------------
// Intérprete
// ----------------------------------------------------------------------------

export function runLocalOracle(prompt: string, context: OracleCanvasContext): OracleResponseBody {
  const p = normalize(prompt);
  const actions: OracleAction[] = [];
  const replies: string[] = [];

  const mentioned = findMentionedNodes(p, context);
  const byId = (id: string | null | undefined) =>
    id ? context.nodes.find((n) => n.id === id) : undefined;
  const target = byId(context.linkedNodeId) ?? mentioned[0]?.node ?? byId(context.selectedNodeId);

  const wantsLayout = /(ordena|organiza|acomoda|alinea|limpia el lienzo|auto.?layout)/.test(p);
  const connectMatch = p.match(/conecta(?:r)?\s+(.+?)\s+(?:con|y|a)\s+(.+)/);
  const wantsConnectLoose = !connectMatch && /conecta/.test(p) && /(suelt|aislad|todo)/.test(p);
  const textKind = /(crea|genera|redacta|escribe|haz|resume|dame|arma|prepara|que falta)/.test(p)
    ? detectTextKind(p)
    : null;
  const wantsCreateNode =
    !textKind &&
    /(crea|crear|anade|anadir|agrega|agregar|nuevo|nueva)/.test(p) &&
    /(nodo|archivo|nota|cuaderno|calculo|hoja)/.test(p);

  if (textKind) {
    if (target) {
      const meta = KIND_META[textKind];
      actions.push({
        type: "create_text_block",
        title: `${meta.title} • ${target.title}`,
        content: meta.build(target),
        linkedNodeId: target.id,
        connectionLabel: meta.label,
      });
      replies.push(`Creé "${meta.title}" conectado a "${target.title}" con los datos reales del archivo.`);
    } else {
      replies.push(
        'Elige el archivo en "Vincular a archivo / nodo" (o selecciónalo en el lienzo) para redactar el bloque de texto sobre él.'
      );
    }
  }

  if (connectMatch) {
    if (mentioned.length >= 2) {
      actions.push({
        type: "connect_nodes",
        fromNodeId: mentioned[0].node.id,
        toNodeId: mentioned[1].node.id,
        label: "Conectado por el Oráculo",
      });
      replies.push(`Conecté "${mentioned[0].node.title}" con "${mentioned[1].node.title}".`);
    } else {
      replies.push("No encontré ambos nodos por nombre. Usa el título exacto del nodo al pedir la conexión.");
    }
  } else if (wantsConnectLoose) {
    const connected = new Set(context.connections.flatMap((c) => [c.fromNodeId, c.toNodeId]));
    const loose = context.nodes.filter((n) => !connected.has(n.id));
    for (let i = 0; i + 1 < loose.length; i += 2) {
      actions.push({
        type: "connect_nodes",
        fromNodeId: loose[i].id,
        toNodeId: loose[i + 1].id,
        label: "Conexión sugerida",
      });
    }
    replies.push(
      loose.length >= 2
        ? `Conecté ${Math.floor(loose.length / 2)} par(es) de nodos sueltos.`
        : "No encontré nodos sueltos por conectar."
    );
  }

  if (wantsCreateNode) {
    actions.push({ type: "create_node", nodeType: detectNodeType(p) });
    replies.push("Creé un nuevo nodo en un hueco libre del lienzo.");
  }

  if (wantsLayout) {
    actions.push({ type: "apply_human_layout" });
    replies.push(
      "Ordené el lienzo en zonas: archivos y modelos 3D a la izquierda, sus textos y análisis al centro, y fuentes y cálculos a la derecha."
    );
  }

  if (replies.length === 0) {
    replies.push(
      'Modo local (sin IA externa). Puedo ordenar el lienzo por zonas, conectar nodos por nombre y redactar bloques vinculados a un archivo: "plan de pruebas", "ficha técnica" o "qué falta para imprimir". Configura GEMINI_API_KEY para análisis libre.'
    );
  }

  return { reply: replies.join(" "), actions, engine: "local" };
}

/**
 * Reflejos locales (0 ms, sin gasto de API): órdenes cortas y sin ambigüedad
 * que el intérprete local resuelve igual de bien que un modelo. Devuelve `null`
 * si la petición necesita IA de verdad (análisis, redacción, preguntas…).
 */
export function localReflex(prompt: string, context: OracleCanvasContext): OracleResponseBody | null {
  const p = normalize(prompt).replace(/[.!¡¿?]+/g, "").replace(/^(por favor|oraculo)[, ]+/, "").trim();
  if (p.length === 0 || p.length > 48) return null;
  if (/^(ordena|organiza|acomoda|alinea|limpia)( el| mi| todo el)? ?(lienzo|tablero|espacio|todo|nodos|tarjetas)?( por favor)?$/.test(p)) {
    return runLocalOracle("ordena el lienzo", context);
  }
  if (/^conecta( los| todos los)? (nodos|tarjetas|bloques) (sueltos|aislados)$/.test(p)) {
    return runLocalOracle("conecta los nodos sueltos", context);
  }
  return null;
}
