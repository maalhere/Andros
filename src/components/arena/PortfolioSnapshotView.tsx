"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Box, Cable, Calculator, ClipboardList, FileText, Link2, Quote, SquareFunction, StickyNote, Terminal, X } from "lucide-react";
import type { NodeArchetype } from "@/types/workspace";
import type { PortfolioSnapshot } from "@/types/arena";

// ============================================================================
// ANDROS ARENA — VISTA DEL PORTAFOLIO (instantánea de un espacio de trabajo)
//   · <PortfolioBadges>   insignias: nodos, cables, 3D, CodeLab, IA, citas
//   · <PortfolioMiniMap>  mini-lienzo SVG con nodos y cables reales
//   · <PortfolioPreview>  vista ampliada (botón «Vista previa del portafolio»)
// ============================================================================

const TYPE_META: Record<NodeArchetype, { label: string; color: string; icon: React.ReactNode }> = {
  "file-node": { label: "Archivos", color: "#C95A3B", icon: <Box className="w-3 h-3" /> },
  "sketch-note-node": { label: "Notas", color: "#8B8B85", icon: <StickyNote className="w-3 h-3" /> },
  "calc-latex-node": { label: "Cálculos", color: "#4F6B58", icon: <Calculator className="w-3 h-3" /> },
  "resource-link-node": { label: "Fuentes", color: "#3B82F6", icon: <Link2 className="w-3 h-3" /> },
  "code-lab-node": { label: "CodeLab", color: "#10B981", icon: <Terminal className="w-3 h-3" /> },
  "ai-chat-node": { label: "Nodos IA", color: "#A855F7", icon: <Bot className="w-3 h-3" /> },
  "form-sheet-node": { label: "Fichas", color: "#C95A3B", icon: <ClipboardList className="w-3 h-3" /> },
  "formula-sheet-node": { label: "Fórmulas", color: "#4F6B58", icon: <SquareFunction className="w-3 h-3" /> },
};

const NODE_W = 300;
const NODE_H = 150;

export const PortfolioBadges: React.FC<{ snapshot: PortfolioSnapshot; compact?: boolean }> = ({ snapshot: s, compact }) => {
  const badge = "inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono border";
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${badge} border-andros-border text-andros-primary`}>
        <FileText className="w-3 h-3" />
        {s.nodeCount} nodos
      </span>
      {!compact && (
        <span className={`${badge} border-andros-border text-andros-muted`}>
          <Cable className="w-3 h-3" />
          {s.connectionCount} cables
        </span>
      )}
      {s.has3D && (
        <span className={`${badge} border-[#C95A3B]/40 text-[#C95A3B] bg-[#C95A3B]/10`}>
          <Box className="w-3 h-3" />
          3D
        </span>
      )}
      {s.hasCodeLab && (
        <span className={`${badge} border-[#10B981]/40 text-[#10B981] bg-[#10B981]/10`}>
          <Terminal className="w-3 h-3" />
          CodeLab
        </span>
      )}
      {s.hasAi && (
        <span className={`${badge} border-[#A855F7]/40 text-[#A855F7] bg-[#A855F7]/10`}>
          <Bot className="w-3 h-3" />
          IA
        </span>
      )}
      {s.hasCitations && (
        <span className={`${badge} border-[#3B82F6]/40 text-[#3B82F6] bg-[#3B82F6]/10`}>
          <Quote className="w-3 h-3" />
          Citas
        </span>
      )}
    </div>
  );
};

export const PortfolioMiniMap: React.FC<{ snapshot: PortfolioSnapshot; height?: number; showLabels?: boolean }> = ({
  snapshot,
  height = 120,
  showLabels = false,
}) => {
  const view = useMemo(() => {
    const nodes = snapshot.nodes;
    if (nodes.length === 0) return null;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    const pad = 60;
    return { x: minX - pad, y: minY - pad, w: Math.max(400, maxX - minX + pad * 2), h: Math.max(240, maxY - minY + pad * 2) };
  }, [snapshot.nodes]);

  if (!view) {
    return (
      <div style={{ height }} className="rounded-xl border border-dashed border-andros-border flex items-center justify-center text-[11px] text-andros-muted">
        Lienzo vacío
      </div>
    );
  }

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ height }}
      className="w-full rounded-xl border border-andros-border bg-andros-canvas canvas-grid"
      role="img"
      aria-label={`Mini-mapa de ${snapshot.workspaceName}: ${snapshot.nodeCount} nodos y ${snapshot.connectionCount} cables`}
    >
      {snapshot.links.map(([a, b], i) => {
        const from = snapshot.nodes[a];
        const to = snapshot.nodes[b];
        if (!from || !to) return null;
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x + NODE_W / 2;
        const y2 = to.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke="var(--accent-primary)"
            strokeOpacity={0.55}
            strokeWidth={6}
          />
        );
      })}
      {snapshot.nodes.map((n, i) => {
        const meta = TYPE_META[n.type];
        return (
          <g key={i}>
            <title>{`${meta.label}: ${n.t}${n.ext ? ` (.${n.ext})` : ""}`}</title>
            <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={22} fill="var(--surface-card)" stroke={meta.color} strokeWidth={6} />
            <rect x={n.x} y={n.y} width={NODE_W} height={34} rx={16} fill={meta.color} fillOpacity={0.18} />
            {showLabels && (
              <text x={n.x + 20} y={n.y + 82} fontSize={30} fontFamily="ui-sans-serif, system-ui" fill="var(--text-primary)">
                {n.t.length > 16 ? `${n.t.slice(0, 15)}…` : n.t}
              </text>
            )}
            {showLabels && n.ext && (
              <text x={n.x + 20} y={n.y + 124} fontSize={24} fontFamily="ui-monospace, monospace" fill={meta.color}>
                .{n.ext}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export const PortfolioPreview: React.FC<{
  snapshot: PortfolioSnapshot | null;
  applicant?: string;
  note?: string;
  onClose: () => void;
}> = ({ snapshot, applicant, note, onClose }) => (
  <AnimatePresence>
    {snapshot && (
      <motion.div
        className="absolute inset-0 z-20 flex items-center justify-center p-3 bg-black/40 backdrop-blur-[2px] rounded-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={onClose}
      >
        <motion.div
          role="dialog"
          aria-label={`Vista previa del portafolio ${snapshot.workspaceName}`}
          onPointerDown={(e) => e.stopPropagation()}
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 6 }}
          className="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-3.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-andros-muted">Vista previa del portafolio</p>
              <h3 className="text-sm font-semibold text-andros-primary truncate">{snapshot.workspaceName}</h3>
              {applicant && <p className="text-[11px] text-andros-muted">{applicant}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar vista previa" className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40">
              <X className="w-4 h-4" />
            </button>
          </div>
          <PortfolioBadges snapshot={snapshot} />
          <PortfolioMiniMap snapshot={snapshot} height={300} showLabels />
          {note && <p className="text-xs leading-relaxed text-andros-primary rounded-xl bg-andros-canvas border border-andros-border px-3 py-2.5">{note}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.keys(TYPE_META) as NodeArchetype[])
              .filter((t) => (snapshot.countsByType[t] ?? 0) > 0)
              .map((t) => (
                <div key={t} className="flex items-center gap-2 rounded-lg border border-andros-border px-2.5 py-2">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: TYPE_META[t].color, backgroundColor: `${TYPE_META[t].color}1F` }}>
                    {TYPE_META[t].icon}
                  </span>
                  <span className="text-[11px] text-andros-primary">{TYPE_META[t].label}</span>
                  <span className="ml-auto text-[11px] font-mono text-andros-muted">{snapshot.countsByType[t]}</span>
                </div>
              ))}
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {snapshot.nodes.map((n, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px] text-andros-muted">
                <span style={{ color: TYPE_META[n.type].color }}>{TYPE_META[n.type].icon}</span>
                <span className="text-andros-primary truncate">{n.t}</span>
                {n.ext && <span className="font-mono">.{n.ext}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[10px] font-mono text-andros-muted">
            Instantánea tomada el {new Date(snapshot.capturedAt).toLocaleString("es")} · {snapshot.nodeCount} nodos · {snapshot.connectionCount} cables
          </p>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
