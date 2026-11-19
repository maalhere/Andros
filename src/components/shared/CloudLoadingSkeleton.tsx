"use client";

import { useTabsBarVisible } from "@/store/useTabsStore";
import React from "react";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { SkeletonCard } from "./Skeleton";

// ============================================================================
// ANDROS — ESQUELETO MIENTRAS SE DESCARGA EL ESPACIO DE LA NUBE
// Solo aparece si el lienzo aún está vacío: nunca tapa trabajo real.
// ============================================================================

export const CloudLoadingSkeleton: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const loading = useCloudStore((s) => s.status === "loading");
  const empty = useWorkspaceStore((s) => s.nodes.length === 0);
  const hasTabs = useTabsBarVisible();
  if (!loading || !empty) return null;

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando tu espacio de trabajo"
      className={
        isMobile
          ? `fixed inset-x-3 ${hasTabs ? "top-[6.75rem]" : "top-16"} z-30 space-y-3 pointer-events-none`
          : "fixed inset-0 z-30 flex items-center justify-center gap-6 pointer-events-none"
      }
    >
      {Array.from({ length: 3 }, (_, i) => (
        <SkeletonCard
          key={i}
          withActions={false}
          className={isMobile ? "bg-andros-card" : `w-[280px] bg-andros-card ${i === 1 ? "-translate-y-10" : ""}`}
        />
      ))}
      <span className="sr-only">Cargando tu espacio de trabajo…</span>
    </div>
  );
};
