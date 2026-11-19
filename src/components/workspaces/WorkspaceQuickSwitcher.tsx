"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Folder, FolderOpen, Settings2 } from "lucide-react";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { openCloudWorkspace } from "@/hooks/useCloudSync";

// ============================================================================
// ANDROS — SELECTOR RÁPIDO DE CARPETA / PROYECTO (barra superior)
// ============================================================================

export const WorkspaceQuickSwitcher: React.FC = () => {
  const workspaces = useWorkspaceManagerStore((s) => s.workspaces);
  const setDrawerOpen = useWorkspaceManagerStore((s) => s.setDrawerOpen);
  const activeId = useCloudStore((s) => s.workspaceId);
  const signedIn = useCloudStore((s) => s.user !== null);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const active = workspaces.find((w) => w.id === activeId);
  const label = signedIn ? (active?.name ?? "Cargando…") : "Espacio local";

  const groups = useMemo(() => {
    const names = [...new Set(workspaces.map((w) => w.folder))];
    names.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "es")));
    return names.map((folder) => ({ folder, items: workspaces.filter((w) => w.folder === folder) }));
  }, [workspaces]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Cambiar de carpeta o proyecto"
        className="flex items-center gap-1 min-w-0 font-mono text-[11px] text-andros-muted hover:text-andros-primary spring-micro"
      >
        {active?.folder ? <Folder className="w-3 h-3 shrink-0" /> : null}
        {active?.folder ? (
          <span className="truncate max-w-[60px] sm:max-w-[110px]">{active.folder}</span>
        ) : null}
        {active?.folder ? <span>/</span> : null}
        <span className="truncate max-w-[90px] sm:max-w-[160px]">{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-64 max-h-[60vh] overflow-y-auto rounded-xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-1.5 z-50"
        >
          {!signedIn && (
            <p className="px-2 py-1.5 text-[11px] text-andros-muted">
              Inicia sesión con Google para tener varios espacios y carpetas.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.folder || "__root"} className="mb-1">
              <div className="px-2 pt-1 pb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono text-andros-muted">
                {group.folder ? <Folder className="w-3 h-3" /> : <FolderOpen className="w-3 h-3" />}
                {group.folder || "Sin carpeta"}
              </div>
              {group.items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    void openCloudWorkspace(w.id);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs truncate hover:bg-andros-border/40 spring-micro ${
                    w.id === activeId ? "text-andros-accent-ink font-semibold" : "text-andros-primary"
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDrawerOpen(true);
            }}
            className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs flex items-center gap-1.5 text-andros-primary border-t border-andros-border hover:bg-andros-border/40 spring-micro"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Administrar espacios y proyectos…
          </button>
        </div>
      )}
    </div>
  );
};
