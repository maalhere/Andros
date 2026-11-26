"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";
import { useShortcutsGuideStore } from "@/store/useShortcutsGuideStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { isCanvasReadOnly } from "@/store/useCollabStore";
import { closeActiveWorkspaceTab, focusWorkspaceTab } from "@/components/workspaces/WorkspaceTabsBar";
import { handleClipboardShortcut } from "@/lib/canvas/clipboardActions";

// ============================================================================
// ANDROS — ATAJOS DE TECLADO GLOBALES
//   ⌘K / Ctrl+K → Paleta de comandos (en cualquier tamaño de pantalla).
//   ⌘/Ctrl + C · X · V → copiar, cortar y pegar fichas (nunca dentro de un
//   campo de texto ni con texto seleccionado; ver clipboardActions).
//   Solo escritorio: V seleccionar · N nodo · C conectar · D dibujar ·
//   B biblioteca · L enlace · M CodeLab · O Oráculo IA · ? guía de atajos.
//   Pestañas de espacios: Alt+1…9 saltar · Alt+W cerrar la activa (no se
//   usan Ctrl+W / Ctrl+T para no pelear con el navegador).
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

      if (!palette.open && handleClipboardShortcut(e)) return;

      if (!isDesktop || palette.open) return;
      // La guía de atajos y el tutorial gestionan su propio teclado.
      if (useShortcutsGuideStore.getState().open || useOnboardingStore.getState().open) return;
      // La Biblioteca y la Arena se cierran solas con Escape y bloquean los atajos.
      if (useLibraryStore.getState().open || useMarketStore.getState().arenaOpen) return;

      const ws = useWorkspaceStore.getState();
      if (e.key === "Escape" && ws.isOracleModalOpen) {
        ws.setOracleModalOpen(false);
        return;
      }

      // Pestañas de espacios: Alt + 1…9 / Alt + W (e.code: Option en Mac cambia e.key).
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (digit) {
          e.preventDefault();
          focusWorkspaceTab(Number(digit[1]));
          return;
        }
        if (e.code === "KeyW") {
          e.preventDefault();
          closeActiveWorkspaceTab();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (ws.isOracleModalOpen) return;

      // Solo lectura (sala llena 6/6): solo Seleccionar y la guía de atajos.
      const key = e.key.toLowerCase();
      if (isCanvasReadOnly() && key !== "v" && key !== "?") return;

      switch (key) {
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
          // Biblioteca y CodeLab son herramientas del Modo Experto.
          if (useSettingsStore.getState().experienceMode === "expert") {
            useLibraryStore.getState().openLibrary({ origin: "canvas" });
          }
          break;
        case "l":
          ws.spawnNode({ type: "resource-link-node" });
          break;
        case "m":
          if (useSettingsStore.getState().experienceMode === "expert") {
            ws.spawnNode({ type: "code-lab-node" });
          }
          break;
        case "o":
          e.preventDefault();
          ws.setOracleModalOpen(true);
          break;
        case "?":
          e.preventDefault();
          useShortcutsGuideStore.getState().openGuide();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktop]);
}
