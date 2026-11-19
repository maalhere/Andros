// ============================================================================
// ANDROS — MOTOR DE CONTEXTO DIRIGIDO DEL LIENZO
//
// Los cables transmiten datos reales: dado un nodo destino, se recorren los
// nodos conectados AGUAS ARRIBA (cables que entran: from → to) con detección
// de ciclos (`visited`), y se serializa el contenido vivo de cada uno según
// su tipo. La huella (`fingerprint`) de ese contexto permite a un Nodo IA
// saber si algo cambió desde su última respuesta sin llamar a ninguna API.
// Funciones puras: sirven en el cliente y en el servidor.
// ============================================================================

import type {
  AiChatEngineeringNode,
  CodeLabValue,
  EngineeringNodeData,
  NodeArchetype,
  NodeConnection,
} from "@/types/workspace";

/** Límite de texto por nodo y total, para no saturar el contexto del modelo. */
const MAX_NODE_CHARS = 6000;
const MAX_TOTAL_CHARS = 30_000;
const MAX_DEPTH = 6;

export const MODEL_3D_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

export const AI_PROVIDER_NAMES = { gemini: "Gemini", openai: "ChatGPT", anthropic: "Claude" } as const;

function clip(text: string, max: number): string {
  const clean = text.replace(/[ \t]+\n/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatValue(value: CodeLabValue): string {
  if (Array.isArray(value)) {
    const head = value.slice(0, 8).map((n) => Number(n.toPrecision(6)));
    return `[${head.join(", ")}${value.length > 8 ? `, … (${value.length} valores)` : ""}]`;
  }
  return String(Number(value.toPrecision(8)));
}

/** Resumen de otro Nodo IA (IA → IA): proveedor, resumen y últimos mensajes. */
export function serializeAiChat(node: AiChatEngineeringNode, maxMessages = 4): string {
  const data = node.aiChatData;
  const lines = [
    `Proveedor: ${AI_PROVIDER_NAMES[data.provider]}${data.model && data.model !== "auto" ? ` (${data.model})` : ""}`,
  ];
  if (data.source) {
    lines.push(
      `Conversación importada de ${data.source.platform}${data.source.title ? `: "${data.source.title}"` : ""}`
    );
  }
  if (data.summary) lines.push(`Resumen: ${data.summary}`);
  const recent = data.messages.filter((m) => !m.resync).slice(-maxMessages);
  if (recent.length > 0) {
    lines.push("Últimos mensajes:");
    for (const m of recent) {
      lines.push(`${m.role === "user" ? "Usuario" : "Asistente"}: ${clip(m.text, 1200)}`);
    }
  }
  return lines.join("\n");
}

/** Contenido vivo de un nodo, como texto legible para un modelo de IA. */
export function serializeNodeForContext(node: EngineeringNodeData): string {
  const lines: string[] = [];
  if (node.summary) lines.push(`Notas: ${node.summary}`);

  switch (node.type) {
    case "file-node": {
      const f = node.fileData;
      if (!f.fileName) {
        lines.push("Archivo: (todavía sin archivo adjunto)");
        break;
      }
      const ext = f.extension.toLowerCase();
      lines.push(`Archivo: ${f.fileName} (.${ext || "?"}, ${formatBytes(f.fileSizeBytes)})`);
      if (f.modelDimensionsMm) {
        const { widthMm: w, depthMm: d, heightMm: h } = f.modelDimensionsMm;
        lines.push(
          `Caja envolvente: ancho ${w.toFixed(2)} mm × profundidad ${d.toFixed(2)} mm × alto ${h.toFixed(2)} mm`,
          `Volumen de la caja envolvente: ${((w * d * h) / 1000).toFixed(2)} cm³ (el volumen real de la pieza es menor)`
        );
      } else if (MODEL_3D_EXTENSIONS.has(ext)) {
        lines.push("Dimensiones: aún no medidas (se miden al abrir el visor 3D del nodo).");
      }
      break;
    }
    case "sketch-note-node": {
      const data = node.sketchNoteData;
      for (const b of data.textBlocks) {
        lines.push(b.type === "heading" ? `# ${b.text}` : b.type === "bullet" ? `- ${b.text}` : b.text);
      }
      for (const c of data.checklistItems) lines.push(`- [${c.checked ? "x" : " "}] ${c.text}`);
      if (data.strokes.length > 0) lines.push(`(Boceto a mano con ${data.strokes.length} trazos)`);
      break;
    }
    case "calc-latex-node": {
      const data = node.calcLatexData;
      if (data.justificationText) lines.push(data.justificationText);
      for (const eq of data.latexEquations) {
        lines.push(`Ecuación "${eq.label}": ${eq.latex}${eq.linkedCell ? ` (celda ${eq.linkedCell})` : ""}`);
      }
      const cells = Object.entries(data.gridCells)
        .filter(([, cell]) => cell.computed || cell.raw)
        .map(([address, cell]) => `${address}=${cell.computed || cell.raw}${cell.error ? ` (${cell.error})` : ""}`);
      if (cells.length > 0) lines.push(`Celdas: ${cells.join(" | ")}`);
      break;
    }
    case "resource-link-node": {
      const data = node.resourceLinkData;
      const kind =
        data.platform === "youtube"
          ? "YouTube"
          : data.platform === "github"
            ? "GitHub"
            : data.platform === "paper"
              ? "Paper científico (arXiv/DOI)"
              : data.platform === "linkedin"
                ? "Perfil"
                : "Página web";
      lines.push(`Enlace (${kind}): ${data.url || "(sin URL)"}`);
      if (data.title) lines.push(`Título: ${data.title}`);
      if (data.siteName) lines.push(`Sitio: ${data.siteName}`);
      if (data.description) lines.push(`Resumen: ${data.description}`);
      if (data.github) {
        lines.push(
          `Repositorio: ${data.github.owner}/${data.github.repo} · ${data.github.stars} estrellas · ${data.github.language || "lenguaje no detectado"}`
        );
        if (data.github.description) lines.push(`Descripción: ${data.github.description}`);
      }
      if (data.paper) {
        lines.push(`Paper: "${data.paper.title}" — ${data.paper.authors} (${data.paper.source})`);
        if (data.paper.summary) lines.push(`Abstract: ${data.paper.summary}`);
      }
      if (data.youtube) lines.push(`Video de YouTube: ${data.youtube.videoId}`);
      if (data.citation) {
        if (data.citation.doi) lines.push(`DOI: ${data.citation.doi}`);
        if (data.citation.designation) lines.push(`Designación oficial: ${data.citation.designation}`);
        if (data.citation.pdfUrl) lines.push(`PDF de acceso abierto: ${data.citation.pdfUrl}`);
        lines.push(`Cita IEEE: ${data.citation.ieee}`);
        lines.push(`Cita APA: ${data.citation.apa}`);
      }
      break;
    }
    case "code-lab-node": {
      const data = node.codeLabData;
      lines.push(`Código:\n${data.code || "(vacío)"}`);
      const vars = Object.entries(data.result?.variables ?? {});
      if (vars.length > 0) {
        lines.push(`Variables calculadas: ${vars.map(([k, v]) => `${k} = ${formatValue(v)}`).join("; ")}`);
      }
      const logs = data.result?.logs ?? [];
      if (logs.length > 0) lines.push(`Resultados: ${logs.slice(-10).join(" | ")}`);
      if (data.result?.plot) lines.push(`Gráfica plot(x, y) con ${data.result.plot.x.length} puntos.`);
      if (data.result?.errorMessage) lines.push(`Error en la última ejecución: ${data.result.errorMessage}`);
      if (!data.result) lines.push("(Aún no se ha ejecutado)");
      break;
    }
    case "ai-chat-node":
      lines.push(serializeAiChat(node));
      break;
  }
  return clip(lines.join("\n"), MAX_NODE_CHARS);
}

export interface UpstreamEntry {
  nodeId: string;
  title: string;
  type: NodeArchetype;
  /** 1 = conectado directamente al nodo destino. */
  depth: number;
  /** Etiqueta del cable por el que llega (si la tiene). */
  via?: string;
  text: string;
}

export interface UpstreamContext {
  entries: UpstreamEntry[];
  /** Todo el contexto, listo para enviarlo a un modelo. */
  text: string;
  /** Huella del contenido (cambia solo si cambia el contenido, no la posición). */
  fingerprint: string;
  /** Cables que alimentan el contexto (para resaltarlos en el lienzo). */
  edgeIds: string[];
  /** Nodos conectados directamente al destino. */
  directCount: number;
}

/** Hash FNV-1a de 32 bits en hexadecimal (rápido y estable; no criptográfico). */
export function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Recorre los nodos aguas arriba de `targetId` (BFS por cables entrantes) con
 * detección de ciclos: A → B → A no entra en bucle porque cada nodo se visita
 * una sola vez y el propio destino se marca como visitado desde el inicio.
 */
export function collectUpstreamContext(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  targetId: string
): UpstreamContext {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, NodeConnection[]>();
  for (const c of connections) {
    if (!byId.has(c.fromNodeId) || !byId.has(c.toNodeId)) continue;
    const list = incoming.get(c.toNodeId);
    if (list) list.push(c);
    else incoming.set(c.toNodeId, [c]);
  }

  const visited = new Set<string>([targetId]);
  const entries: UpstreamEntry[] = [];
  const edgeIds: string[] = [];
  let frontier: string[] = [targetId];

  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const edge of incoming.get(current) ?? []) {
        // El cable que sale del propio destino (A → … → destino → A) no lo alimenta.
        if (edge.fromNodeId !== targetId) edgeIds.push(edge.id);
        if (visited.has(edge.fromNodeId)) continue; // Ciclo o nodo ya incluido.
        visited.add(edge.fromNodeId);
        const node = byId.get(edge.fromNodeId)!;
        entries.push({
          nodeId: node.id,
          title: node.title,
          type: node.type,
          depth,
          ...(edge.label ? { via: edge.label } : {}),
          text: serializeNodeForContext(node),
        });
        next.push(node.id);
      }
    }
    frontier = next;
  }

  let total = 0;
  const blocks: string[] = [];
  for (const e of entries) {
    const block = `### ${e.title} [${e.type}${e.depth > 1 ? `, a ${e.depth} saltos` : ", conexión directa"}${
      e.via ? `, cable "${e.via}"` : ""
    }]\n${e.text}`;
    if (total + block.length > MAX_TOTAL_CHARS) {
      blocks.push(`(… ${entries.length - blocks.length} nodo(s) más omitidos por tamaño)`);
      break;
    }
    blocks.push(block);
    total += block.length;
  }
  const text = blocks.join("\n\n");

  return {
    entries,
    text,
    fingerprint: entries.length > 0 ? hashString(text) : "",
    edgeIds: [...new Set(edgeIds)],
    directCount: entries.filter((e) => e.depth === 1).length,
  };
}

/** Pieza 3D (.stl/.obj/.3mf) conectada directamente a un nodo, en cualquier sentido. */
export function findLinked3DModel(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  nodeId: string
): { nodeId: string; name: string; dimensionsMm?: { widthMm: number; depthMm: number; heightMm: number } } | null {
  const neighborIds = connections
    .filter((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId)
    .map((c) => (c.fromNodeId === nodeId ? c.toNodeId : c.fromNodeId));
  let fallback: ReturnType<typeof findLinked3DModel> = null;
  for (const id of neighborIds) {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.type !== "file-node" || !MODEL_3D_EXTENSIONS.has(n.fileData.extension.toLowerCase())) continue;
    const name = n.fileData.fileName || n.title;
    // Se prefiere una pieza ya medida por el visor 3D.
    if (n.fileData.modelDimensionsMm) return { nodeId: n.id, name, dimensionsMm: n.fileData.modelDimensionsMm };
    fallback ??= { nodeId: n.id, name };
  }
  return fallback;
}
