// ============================================================================
// ANDROS — LLEVAR UNA TARJETA A LA VISTA (solo cliente)
// Escritorio: centra la cámara del lienzo en el nodo. Teléfono: cierra los
// cajones, quita el filtro de categoría y desplaza la pila hasta la tarjeta.
// ============================================================================

import { useWorkspaceStore } from "@/store/useWorkspaceStore";

const NODE_W = 320;
const NODE_H = 220;

export function focusNodeOnScreen(id: string): void {
  const ws = useWorkspaceStore.getState();
  const node = ws.nodes.find((n) => n.id === id);
  if (!node) return;
  ws.selectNode(id);
  if (window.innerWidth >= 768) {
    const scale = Math.max(ws.canvasTransform.scale, 0.8);
    ws.setCanvasTransform({
      scale,
      x: window.innerWidth / 2 - (node.position.x + NODE_W / 2) * scale,
      y: window.innerHeight / 2 - (node.position.y + NODE_H / 2) * scale,
    });
    return;
  }
  ws.setActiveMobileSheet("none");
  if (ws.mobileCategoryFilter !== "all" && ws.mobileCategoryFilter !== node.type) {
    ws.setMobileCategoryFilter("all");
  }
  const reduced = document.documentElement.dataset.motion === "reduced";
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-node-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
  );
}
