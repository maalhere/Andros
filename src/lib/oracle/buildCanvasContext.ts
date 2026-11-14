// ============================================================================
// ANDROS — CONTEXTO COMPLETO DEL LIENZO PARA EL ORÁCULO IA
//
// Convierte los nodos y cables del store en un resumen legible para el modelo:
// tipo, título, archivo (nombre, extensión, peso), dimensiones 3D reales en mm,
// extractos de texto de cuadernos y hojas de cálculo, y conexiones.
// Función pura: se usa en el cliente (`OracleModal.tsx`) antes de llamar a la API.
// ============================================================================

import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";
import type { OracleCanvasContext, OracleCanvasNodeSummary } from "@/types/oracle";

/** Límite de texto por nodo para no saturar el contexto del modelo. */
const MAX_EXCERPT_CHARS = 1500;

function clip(text: string, max = MAX_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function excerptOf(node: EngineeringNodeData): string | undefined {
  if (node.type === "sketch-note-node") {
    const data = node.sketchNoteData;
    const lines = [
      ...data.textBlocks.map((b) =>
        b.type === "heading" ? `# ${b.text}` : b.type === "bullet" ? `- ${b.text}` : b.text
      ),
      ...data.checklistItems.map((c) => `- [${c.checked ? "x" : " "}] ${c.text}`),
    ];
    if (data.strokes.length > 0) lines.push(`(Boceto a mano con ${data.strokes.length} trazos)`);
    return lines.length > 0 ? clip(lines.join("\n")) : undefined;
  }

  if (node.type === "calc-latex-node") {
    const data = node.calcLatexData;
    const lines: string[] = [];
    if (data.justificationText) lines.push(data.justificationText);
    for (const eq of data.latexEquations) lines.push(`Ecuación "${eq.label}": ${eq.latex}`);
    // Tabla compacta: una fila por renglón con sus valores calculados.
    const rows = new Map<number, string[]>();
    for (const [address, cell] of Object.entries(data.gridCells)) {
      const match = address.match(/^([A-Z]+)(\d+)$/);
      if (!match || !cell.computed) continue;
      const row = Number(match[2]);
      rows.set(row, [...(rows.get(row) ?? []), `${address}=${cell.computed}`]);
    }
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      lines.push(rows.get(row)!.join(" | "));
    }
    return lines.length > 0 ? clip(lines.join("\n")) : undefined;
  }

  return undefined;
}

export function buildOracleCanvasContext(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  selectedNodeId: string | null,
  linkedNodeId: string | null
): OracleCanvasContext {
  const neighbors = new Map<string, Set<string>>();
  for (const c of connections) {
    if (!neighbors.has(c.fromNodeId)) neighbors.set(c.fromNodeId, new Set());
    if (!neighbors.has(c.toNodeId)) neighbors.set(c.toNodeId, new Set());
    neighbors.get(c.fromNodeId)!.add(c.toNodeId);
    neighbors.get(c.toNodeId)!.add(c.fromNodeId);
  }

  const summaries: OracleCanvasNodeSummary[] = nodes.map((node) => {
    const summary: OracleCanvasNodeSummary = {
      id: node.id,
      type: node.type,
      title: node.title,
      codeTag: node.codeTag,
      connectedNodeIds: [...(neighbors.get(node.id) ?? [])],
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    };
    if (node.summary) summary.summary = clip(node.summary, 600);

    if (node.type === "file-node") {
      const file = node.fileData;
      if (file.fileName) summary.fileName = file.fileName;
      if (file.extension) summary.fileExtension = file.extension;
      if (file.fileSizeBytes) summary.fileSizeBytes = file.fileSizeBytes;
      summary.fileStatus = file.status;
      if (file.modelDimensionsMm) summary.dimensionsMm = file.modelDimensionsMm;
    }

    const excerpt = excerptOf(node);
    if (excerpt) summary.textExcerpt = excerpt;
    return summary;
  });

  return {
    nodes: summaries,
    connections: connections.map((c) => ({
      id: c.id,
      fromNodeId: c.fromNodeId,
      toNodeId: c.toNodeId,
      ...(c.label ? { label: c.label } : {}),
    })),
    selectedNodeId,
    linkedNodeId,
  };
}
