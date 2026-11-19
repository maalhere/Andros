"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Box, Folder, Plus, X } from "lucide-react";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabsBarVisible, useTabsStore } from "@/store/useTabsStore";
import { createCloudWorkspace, openCloudWorkspace } from "@/hooks/useCloudSync";
import { SPRING_SNAPPY } from "@/lib/motion";
import { Kbd } from "@/components/shared/Kbd";

// ============================================================================
// ANDROS — PESTAÑAS DE ESPACIOS (estilo Chrome / Opera GX)
//   · Una pestaña por espacio abierto; la activa lleva un indicador de acento.
//   · × o clic con botón central cierran; «+» crea un espacio nuevo.
//   · Punto sutil si la pestaña activa está guardando o falló el guardado.
//   · Alt+1…9 saltan de pestaña y Alt+W cierra la activa (useGlobalShortcuts).
// Abre una pestaña nueva automáticamente cuando el espacio activo (elegido en
// el selector o en el gestor) aún no tiene una; si ya la tiene, solo la enfoca.
// ============================================================================

/** Cierra una pestaña; si era la activa, abre la vecina. No cierra la última. */
export function closeWorkspaceTab(id: string): void {
  const { openTabIds, closeTab } = useTabsStore.getState();
  if (openTabIds.length <= 1) return;
  const neighbor = closeTab(id);
  if (neighbor) void openCloudWorkspace(neighbor);
}

/** Salta a la pestaña N (1…9). */
export function focusWorkspaceTab(position: number): void {
  const id = useTabsStore.getState().openTabIds[position - 1];
  if (id && id !== useCloudStore.getState().workspaceId) void openCloudWorkspace(id);
}

/** Cierra la pestaña activa (Alt+W). */
export function closeActiveWorkspaceTab(): void {
  const id = useCloudStore.getState().workspaceId;
  if (id) closeWorkspaceTab(id);
}

export const WorkspaceTabsBar: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const visible = useTabsBarVisible();
  const openTabIds = useTabsStore((s) => s.openTabIds);
  const hydrate = useTabsStore((s) => s.hydrate);
  const workspaces = useWorkspaceManagerStore((s) => s.workspaces);
  const activeId = useCloudStore((s) => s.workspaceId);
  const status = useCloudStore((s) => s.status);
  const pendingUploads = useCloudStore((s) => s.pendingUploads);
  const reduced = useSettingsStore((s) => s.animations === "reduced");
  const activeTabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // El espacio cargado siempre tiene pestaña; los borrados la pierden.
  useEffect(() => {
    if (!visible) return;
    const { openTab, prune } = useTabsStore.getState();
    if (activeId) openTab(activeId);
    if (workspaces.length > 0) {
      prune(
        workspaces.map((w) => w.id),
        activeId,
      );
    }
  }, [visible, activeId, workspaces]);

  // Mantiene visible la pestaña activa en la tira desplazable.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, openTabIds.length]);

  const addTab = useCallback(() => {
    void createCloudWorkspace("Nuevo espacio", "");
  }, []);

  if (!visible) return null;

  const dirty = status === "saving" || status === "error" || pendingUploads > 0;
  const dirtyLabel = status === "error" ? "No se pudo guardar" : "Guardando cambios…";
  const canClose = openTabIds.length > 1;

  return (
    <nav
      aria-label="Espacios de trabajo abiertos"
      className="fixed top-0 inset-x-0 z-40 h-11 md:h-9 flex items-end gap-1 px-2 md:px-4 bg-andros-surface backdrop-blur-md border-b border-andros-border"
    >
      <div
        role="tablist"
        aria-label="Pestañas de espacios"
        className="min-w-0 flex items-end gap-1 overflow-x-auto no-scrollbar snap-x h-full pt-1"
      >
        {openTabIds.map((id, index) => {
          const ws = workspaces.find((w) => w.id === id);
          const name = ws?.name ?? "Espacio";
          const selected = id === activeId;
          return (
            <div
              key={id}
              ref={selected ? activeTabRef : undefined}
              role="presentation"
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // sin auto-scroll del navegador
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && canClose) {
                  e.preventDefault();
                  closeWorkspaceTab(id);
                }
              }}
              className={`group relative snap-start shrink-0 flex items-center h-full rounded-t-lg border border-b-0 spring-micro ${
                selected
                  ? "bg-andros-canvas border-andros-border text-andros-primary"
                  : "bg-transparent border-transparent text-andros-muted hover:bg-andros-border/40 hover:text-andros-primary"
              }`}
            >
              {selected && (
                <motion.span
                  layoutId={reduced ? undefined : "workspace-tab-indicator"}
                  transition={SPRING_SNAPPY}
                  aria-hidden="true"
                  className="absolute top-0 inset-x-1.5 h-0.5 rounded-full bg-andros-accent"
                />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                title={index < 9 ? `${name} (Alt+${index + 1})` : name}
                onClick={() => {
                  if (!selected) void openCloudWorkspace(id);
                }}
                className="h-full min-w-0 max-w-[10rem] md:max-w-[12rem] pl-2.5 pr-1 flex items-center gap-1.5 text-xs active:scale-[0.98] spring-micro"
              >
                {ws?.folder ? (
                  <Folder className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Box className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className={`truncate ${selected ? "font-semibold" : ""}`}>{name}</span>
                {selected && dirty && (
                  <span
                    role="img"
                    aria-label={dirtyLabel}
                    title={dirtyLabel}
                    className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                      status === "error" ? "bg-andros-danger" : "bg-andros-accent"
                    }`}
                  />
                )}
              </button>
              {canClose ? (
                <button
                  type="button"
                  onClick={() => closeWorkspaceTab(id)}
                  aria-label={`Cerrar pestaña «${name}»`}
                  className="hit-slop mr-1 w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/60 active:scale-[0.96] spring-micro"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              ) : (
                <span className="w-1.5" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addTab}
        aria-label="Abrir un espacio nuevo en una pestaña"
        title="Nuevo espacio"
        className="hit-slop mb-1 w-8 h-8 md:w-7 md:h-7 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/50 active:scale-[0.96] spring-micro"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>

      {!isMobile && (
        <span className="hidden lg:flex ml-auto mb-2 items-center gap-1 text-[10px] text-andros-muted shrink-0">
          <Kbd>Alt 1…9</Kbd> cambiar · <Kbd>Alt W</Kbd> cerrar
        </span>
      )}
    </nav>
  );
};
