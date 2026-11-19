// ============================================================================
// ANDROS ARENA — INSTANTÁNEA DE PORTAFOLIO (espacio de trabajo verificable)
// Resume un lienzo (nodos, cables, insignias 3D/CodeLab/IA/citas) y guarda una
// mini-maquetación para la "Vista previa del portafolio". Solo cliente.
// ============================================================================

import type { EngineeringNodeData, NodeArchetype, NodeConnection } from "@/types/workspace";
import type { PortfolioSnapshot, PortfolioSnapshotNode } from "@/types/arena";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_NODES = 40;
const MODEL_EXTENSIONS = new Set(["stl", "obj", "3mf", "step", "stp", "gx", "gcode", "ply", "glb", "gltf"]);

interface MinimalNode {
  id: string;
  type: NodeArchetype;
  title: string;
  x: number;
  y: number;
  ext?: string;
  cited?: boolean;
}

function fromMinimal(
  workspaceName: string,
  nodes: MinimalNode[],
  connections: { from: string; to: string }[]
): PortfolioSnapshot {
  const countsByType: Partial<Record<NodeArchetype, number>> = {};
  for (const n of nodes) countsByType[n.type] = (countsByType[n.type] ?? 0) + 1;
  const kept = nodes.slice(0, MAX_NODES);
  const index = new Map(kept.map((n, i) => [n.id, i]));
  const snapNodes: PortfolioSnapshotNode[] = kept.map((n) => ({
    t: n.title.slice(0, 48) || "Sin título",
    type: n.type,
    x: Math.round(n.x),
    y: Math.round(n.y),
    ...(n.ext ? { ext: n.ext } : {}),
  }));
  const links = connections
    .map((c) => [index.get(c.from), index.get(c.to)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined)
    .map(([a, b]) => [a, b] as [number, number]);
  return {
    workspaceName: workspaceName.slice(0, 80) || "Espacio sin nombre",
    nodeCount: nodes.length,
    connectionCount: connections.length,
    countsByType,
    has3D: nodes.some((n) => n.type === "file-node" && n.ext !== undefined && MODEL_EXTENSIONS.has(n.ext)),
    hasCodeLab: nodes.some((n) => n.type === "code-lab-node"),
    hasAi: nodes.some((n) => n.type === "ai-chat-node"),
    hasCitations: nodes.some((n) => n.cited),
    nodes: snapNodes,
    links,
    capturedAt: new Date().toISOString(),
  };
}

/** Instantánea del lienzo abierto ahora mismo. */
export function snapshotFromCanvas(
  workspaceName: string,
  nodes: EngineeringNodeData[],
  connections: NodeConnection[]
): PortfolioSnapshot {
  return fromMinimal(
    workspaceName,
    nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      x: n.position.x,
      y: n.position.y,
      ext: n.type === "file-node" ? n.fileData.extension?.toLowerCase() || undefined : undefined,
      cited: n.type === "resource-link-node" && (Boolean(n.resourceLinkData.citation) || n.resourceLinkData.platform === "paper"),
    })),
    connections.map((c) => ({ from: c.fromNodeId, to: c.toNodeId }))
  );
}

const VALID_TYPES: NodeArchetype[] = [
  "file-node",
  "sketch-note-node",
  "calc-latex-node",
  "resource-link-node",
  "code-lab-node",
  "ai-chat-node",
];

/** Instantánea de otro espacio guardado en Supabase (lectura con RLS del dueño). */
export async function snapshotFromCloudWorkspace(workspaceId: string, workspaceName: string): Promise<PortfolioSnapshot | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const [nodesRes, connRes] = await Promise.all([
    supabase.from("workspace_nodes").select("id, type, title, position_x, position_y, payload").eq("workspace_id", workspaceId).limit(400),
    supabase.from("workspace_connections").select("from_node_id, to_node_id").eq("workspace_id", workspaceId).limit(800),
  ]);
  if (nodesRes.error) return null;
  type Row = { id: string; type: string; title: string | null; position_x: number; position_y: number; payload: Record<string, unknown> | null };
  const nodes: MinimalNode[] = ((nodesRes.data ?? []) as Row[])
    .filter((r) => VALID_TYPES.includes(r.type as NodeArchetype))
    .map((r) => {
      const payload = r.payload ?? {};
      const ext = typeof payload.extension === "string" ? payload.extension.toLowerCase() : undefined;
      return {
        id: r.id,
        type: r.type as NodeArchetype,
        title: r.title ?? "",
        x: Number(r.position_x) || 0,
        y: Number(r.position_y) || 0,
        ext: r.type === "file-node" && ext ? ext : undefined,
        cited: r.type === "resource-link-node" && (Boolean(payload.citation) || payload.platform === "paper"),
      };
    });
  type ConnRow = { from_node_id: string; to_node_id: string };
  const connections = ((connRes.data ?? []) as ConnRow[]).map((c) => ({ from: c.from_node_id, to: c.to_node_id }));
  return fromMinimal(workspaceName, nodes, connections);
}

/** Construye una instantánea de ejemplo a partir de una lista breve (datos semilla). */
export function exampleSnapshot(
  workspaceName: string,
  items: { t: string; type: NodeArchetype; ext?: string; cited?: boolean }[],
  links: [number, number][]
): PortfolioSnapshot {
  const cols = 3;
  const nodes: MinimalNode[] = items.map((item, i) => ({
    id: `n${i}`,
    type: item.type,
    title: item.t,
    x: (i % cols) * 380 + (Math.floor(i / cols) % 2) * 60,
    y: Math.floor(i / cols) * 300,
    ext: item.ext,
    cited: item.cited,
  }));
  return {
    ...fromMinimal(
      workspaceName,
      nodes,
      links.map(([a, b]) => ({ from: `n${a}`, to: `n${b}` }))
    ),
    capturedAt: "2026-11-01T12:00:00.000Z",
  };
}
