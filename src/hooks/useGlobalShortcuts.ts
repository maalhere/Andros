"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";

// ============================================================================
// ANDROS — ATAJOS DE TECLADO GLOBALES
//   ⌘K / Ctrl+K → Paleta de comandos (en cualquier tamaño de pantalla).
//   Solo escritorio: V seleccionar · N nodo · C conectar · D dibujar ·
//   B biblioteca · L enlace · M CodeLab · O Oráculo IA.
// La lista visible vive en CommandPalette (SHORTCUTS) para no desincronizarse.
// ============================================================================

export const SHORTCUT_KEYS = {
  pointer: "V",
  newNode: "N",
  connect: "C",
  draw: "D",
  library: "B",
  link: "L",
  codeLab: "M",
  oracle: "O",
} as const;

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
};

export function useGlobalShortcuts(isDesktop: boolean) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const palette = useCommandPaletteStore.getState();

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.toggle();
        return;
      }

      if (!isDesktop || palette.open) return;
      // La Biblioteca y la Arena se cierran solas con Escape y bloquean los atajos.
      if (useLibraryStore.getState().open || useMarketStore.getState().arenaOpen) return;

      const ws = useWorkspaceStore.getState();
      if (e.key === "Escape" && ws.isOracleModalOpen) {
        ws.setOracleModalOpen(false);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (ws.isOracleModalOpen) return;

      switch (e.key.toLowerCase()) {
        case "v":
          ws.setActiveTool("pointer");
          break;
        case "n":
          ws.spawnNode();
          break;
        case "c":
          ws.setActiveTool("connect");
          break;
        case "d":
          ws.setActiveTool("draw");
          break;
        case "b":
          useLibraryStore.getState().openLibrary({ origin: "canvas" });
          break;
        case "l":
          ws.spawnNode({ type: "resource-link-node" });
          break;
        case "m":
          ws.spawnNode({ type: "code-lab-node" });
          break;
        case "o":
          e.preventDefault();
          ws.setOracleModalOpen(true);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktop]);
}
