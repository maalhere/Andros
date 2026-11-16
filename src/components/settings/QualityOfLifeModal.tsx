"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Moon, Settings, Sun, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import {
  useSettingsStore,
  type AnimationLevel,
  type AutosaveMode,
  type CableStyle,
  type CanvasBackground,
} from "@/store/useSettingsStore";
import { collectPreferences } from "@/hooks/useSettingsSync";

// ----------------------------------------------------------------------------
// Piezas reutilizables
// ----------------------------------------------------------------------------

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <section className="space-y-2">
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">{title}</h3>
      {hint && <p className="text-[11px] text-andros-muted mt-0.5">{hint}</p>}
    </div>
    {children}
  </section>
);

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 p-1 rounded-xl bg-andros-border/30"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[36px] px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 text-center leading-tight active:scale-95 spring-micro ${
              active
                ? "bg-andros-card text-andros-primary shadow-sm border border-andros-border-active"
                : "text-andros-muted hover:text-andros-primary border border-transparent"
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full shrink-0 spring-micro ${
      checked ? "bg-andros-accent" : "bg-andros-border-active"
    }`}
  >
    <span
      className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow"
      style={{
        transform: checked ? "translateX(20px)" : "translateX(0)",
        transition: "transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    />
  </button>
);

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------

export const QualityOfLifeModal: React.FC = () => {
  const open = useSettingsStore((s) => s.modalOpen);
  const setModalOpen = useSettingsStore((s) => s.setModalOpen);
  const snapToGrid = useSettingsStore((s) => s.snapToGrid);
  const cableStyle = useSettingsStore((s) => s.cableStyle);
  const canvasBackground = useSettingsStore((s) => s.canvasBackground);
  const animations = useSettingsStore((s) => s.animations);
  const autosave = useSettingsStore((s) => s.autosave);
  const applyPreferences = useSettingsStore((s) => s.applyPreferences);
  const theme = useWorkspaceStore((s) => s.theme);
  const setTheme = useWorkspaceStore((s) => s.setTheme);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setModalOpen]);

  const exportBackup = () => {
    const ws = useWorkspaceStore.getState();
    const backup = {
      app: "andros",
      exportedAt: new Date().toISOString(),
      preferences: collectPreferences(),
      nodes: ws.nodes,
      connections: ws.connections,
      canvasStrokes: ws.canvasStrokes,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `andros-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end md:items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: animations === "reduced" ? 0 : 0.18 }}
          onPointerDown={() => setModalOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Ajustes de comodidad"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={
              animations === "reduced"
                ? { duration: 0 }
                : { type: "spring", stiffness: 450, damping: 32, mass: 0.8 }
            }
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-andros-primary">
                <Settings className="w-4 h-4 text-andros-accent" />
                <h2 className="text-sm font-semibold">Ajustes de comodidad</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar ajustes"
                className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-95 spring-micro"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <Section title="Apariencia">
              <Segmented
                label="Apariencia"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: "Día · Paper", icon: <Sun className="w-3.5 h-3.5" /> },
                  { value: "dark", label: "Noche · Obsidian", icon: <Moon className="w-3.5 h-3.5" /> },
                ]}
              />
            </Section>

            <Section title="Ajuste a cuadrícula" hint="Los nodos se alinean solos a una retícula de 28 px al moverlos.">
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-andros-border/30">
                <span className="text-xs text-andros-primary">Imán de alineación</span>
                <Switch
                  label="Ajuste a cuadrícula"
                  checked={snapToGrid}
                  onChange={(v) => applyPreferences({ snapToGrid: v })}
                />
              </div>
            </Section>

            <Section title="Estilo de cables">
              <Segmented<CableStyle>
                label="Estilo de cables"
                value={cableStyle}
                onChange={(v) => applyPreferences({ cableStyle: v })}
                options={[
                  { value: "bezier", label: "Curvas Bézier" },
                  { value: "orthogonal", label: "Circuito" },
                  { value: "straight", label: "Rectas" },
                ]}
              />
            </Section>

            <Section title="Fondo del lienzo">
              <Segmented<CanvasBackground>
                label="Fondo del lienzo"
                value={canvasBackground}
                onChange={(v) => applyPreferences({ canvasBackground: v })}
                options={[
                  { value: "dots", label: "Puntos" },
                  { value: "grid", label: "Milimetrada" },
                  { value: "plain", label: "Liso" },
                ]}
              />
            </Section>

            <Section title="Nivel de animaciones">
              <Segmented<AnimationLevel>
                label="Nivel de animaciones"
                value={animations}
                onChange={(v) => applyPreferences({ animations: v })}
                options={[
                  { value: "full", label: "Completas" },
                  { value: "reduced", label: "Reducidas" },
                ]}
              />
            </Section>

            <Section title="Autoguardado en la nube" hint="Solo aplica con sesión de Google iniciada.">
              <Segmented<AutosaveMode>
                label="Frecuencia de autoguardado"
                value={autosave}
                onChange={(v) => applyPreferences({ autosave: v })}
                options={[
                  { value: "instant", label: "Inmediato (1.2 s)" },
                  { value: "moderate", label: "Moderado (5 s)" },
                ]}
              />
              <button
                type="button"
                onClick={exportBackup}
                className="w-full min-h-[40px] px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary flex items-center justify-center gap-2 hover:bg-andros-border/40 active:scale-[0.98] spring-micro"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar respaldo JSON
              </button>
            </Section>

            <p className="text-[10px] text-andros-muted text-center">
              Tus ajustes se guardan en este navegador y, con sesión, en tu perfil.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
