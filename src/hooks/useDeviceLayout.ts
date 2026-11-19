"use client";

import { useState, useEffect } from "react";
import { ViewportMode } from "@/types/workspace";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useMarketStore } from "@/store/useMarketStore";

const DESKTOP_BREAKPOINT = 768;

interface DeviceLayoutResult {
  viewportMode: ViewportMode;
  isMobile: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  isMounted: boolean;
}

export function useDeviceLayout(): DeviceLayoutResult {
  const [isMounted, setIsMounted] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const isOracleModalOpen = useWorkspaceStore((s) => s.isOracleModalOpen);

  useEffect(() => {
    setIsMounted(true);

    const evaluateViewport = () => {
      const width = window.innerWidth;
      const touchCapable =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;

      setViewportMode(width < DESKTOP_BREAKPOINT ? "mobile" : "desktop");
      setIsTouchDevice(touchCapable);
    };

    evaluateViewport();
    window.addEventListener("resize", evaluateViewport);
    return () => window.removeEventListener("resize", evaluateViewport);
  }, []);

  // Atajos de teclado exclusivos para Desktop (V, N, C, B, ⌘K)
  useEffect(() => {
    if (!isMounted || viewportMode !== "desktop") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Comando global Raycast / Linear: ⌘K o Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOracleModalOpen(!isOracleModalOpen);
        return;
      }

      // La Biblioteca y la Arena se cierran solas con Escape y bloquean los atajos.
      if (useLibraryStore.getState().open || useMarketStore.getState().arenaOpen) return;

      if (e.key === "Escape" && isOracleModalOpen) {
        setOracleModalOpen(false);
        return;
      }

      if (isInputFocused) return;

      switch (e.key.toLowerCase()) {
        case "v":
          setActiveTool("pointer");
          break;
        case "n":
          spawnNode();
          break;
        case "c":
          setActiveTool("connect");
          break;
        case "d":
          setActiveTool("draw");
          break;
        case "b":
          useLibraryStore.getState().openLibrary({ origin: "canvas" });
          break;
        case "l":
          spawnNode({ type: "resource-link-node" });
          break;
        case "m":
          spawnNode({ type: "code-lab-node" });
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMounted, viewportMode, isOracleModalOpen, setActiveTool, spawnNode, setOracleModalOpen]);

  return {
    viewportMode,
    isMobile: viewportMode === "mobile",
    isDesktop: viewportMode === "desktop",
    isTouchDevice,
    isMounted,
  };
}