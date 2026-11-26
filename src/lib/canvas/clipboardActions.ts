// ============================================================================
// ANDROS — CORTAR / COPIAR / PEGAR FICHAS (navegador)
// Punto único para el teclado, los menús y la paleta: permisos, avisos y
// «Deshacer». Copiar no modifica nada y está permitido en solo lectura;
// cortar y pegar exigen poder editar el lienzo.
// ============================================================================

import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCloudStore } from "@/store/useCloudStore";
import { isCanvasReadOnly, useCollabStore } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";

const ws = () => useWorkspaceStore.getState();

/** Espacio que se ve en pantalla (el del anfitrión si visitas una sala). */
const activeWorkspaceId = (): string | undefined =>
  useCollabStore.getState().guest?.workspaceId ?? useCloudStore.getState().workspaceId ?? undefined;

function allowEdit(): boolean {
  if (!isCanvasReadOnly()) return true;
  toast({ message: "Solo lectura: no puedes cortar ni pegar fichas en este lienzo.", tone: "error" });
  return false;
}

/** Copia las fichas indicadas (o la seleccionada). */
export function copyCards(ids?: string[]): boolean {
  const count = ws().copySelectedCards({ ids, workspaceId: activeWorkspaceId() });
  if (count === 0) return false;
  toast({ message: count === 1 ? "Ficha copiada" : `${count} fichas copiadas`, tone: "success" });
  return true;
}

/** Corta las fichas indicadas (o la seleccionada), con «Deshacer». */
export function cutCards(ids?: string[]): boolean {
  if (!allowEdit()) return false;
  const removed = ws().cutSelectedCards({ ids, workspaceId: activeWorkspaceId() });
  if (!removed) return false;
  const originWorkspace = activeWorkspaceId();
  toast({
    message: removed.nodes.length === 1 ? "Ficha cortada" : `${removed.nodes.length} fichas cortadas`,
    action: {
      label: "Deshacer",
      onAction: () => {
        // Nunca se devuelve una ficha al lienzo de otro espacio.
        if (activeWorkspaceId() !== originWorkspace) {
          toast({ message: "Vuelve al espacio original o pega la ficha aquí.", tone: "error" });
          return;
        }
        if (isCanvasReadOnly()) return;
        ws().restoreSnapshot(removed);
        ws().markClipboardAsCopy();
      },
    },
  });
  return true;
}

/** Pega el portapapeles. `at`: punto del lienzo (menú contextual). */
export function pasteClipboard(at?: { x: number; y: number }): boolean {
  if (!ws().clipboard || !allowEdit()) return false;
  const { canvasTransform: view } = ws();
  const ids = ws().pasteCards({
    workspaceId: activeWorkspaceId(),
    at,
    viewCenter: {
      x: (window.innerWidth / 2 - view.x) / view.scale,
      y: (window.innerHeight / 2 - view.y) / view.scale,
    },
  });
  if (ids.length === 0) return false;
  // En el teléfono la ficha nueva puede quedar fuera de la pila visible.
  if (window.innerWidth < 768) focusNodeOnScreen(ids[ids.length - 1]);
  toast({ message: ids.length === 1 ? "Ficha pegada" : `${ids.length} fichas pegadas`, tone: "success" });
  return true;
}

const TEXT_TARGET = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** `true` si el evento pertenece a un campo de texto o hay texto seleccionado. */
export function belongsToText(target: EventTarget | null): boolean {
  const inField = (el: unknown) => el instanceof Element && el.closest(TEXT_TARGET) !== null;
  return inField(target) || inField(document.activeElement) || Boolean(window.getSelection()?.toString());
}

/**
 * Ctrl/⌘ + C · X · V sobre el lienzo. Solo intercepta el evento cuando de
 * verdad actúa sobre fichas: el copiar y pegar de texto queda intacto.
 */
export function handleClipboardShortcut(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return false;
  const key = e.key.toLowerCase();
  if (key !== "c" && key !== "x" && key !== "v") return false;
  if (belongsToText(e.target)) return false;
  // Con un diálogo o panel abierto, el teclado es suyo.
  if (document.querySelector('[aria-modal="true"]')) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('[role="dialog"]')) return false;

  const { selectedNodeId, clipboard } = ws();
  if (key === "v") {
    // Dentro de una ficha que admite fotos, Ctrl+V pega la imagen.
    if (!clipboard || target?.closest("[data-paste-zone]")) return false;
    e.preventDefault();
    pasteClipboard();
    return true;
  }
  if (!selectedNodeId) return false;
  e.preventDefault();
  if (key === "c") copyCards();
  else cutCards();
  return true;
}
