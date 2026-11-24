"use client";

import { track } from "@/lib/analytics/telemetry";
import React, { useRef, useState } from "react";
import { KeyRound, Loader2, ShieldAlert, Sparkles, SquareFunction, X, Zap } from "lucide-react";
import { useFormulaCreatorStore } from "@/store/useFormulaCreatorStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { freeQueriesLeft, hasOwnGeminiKey, useAiQuotaStore } from "@/store/useAiQuotaStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "@/components/social/SocialDialog";
import { FORMULA_MAX_DESCRIPTION_CHARS, FORMULA_PRESETS, type FormulaPreset } from "@/lib/math/formulaSchema";
import { FormulaGenError, generateFormula } from "@/lib/math/formulaClient";
import { insertFormulaNode, type InsertedFormula } from "@/lib/math/formulaActions";

// ============================================================================
// ANDROS — «NUEVA FÓRMULA» (+ Agregar → Fórmula LaTeX, ⌘K y el Oráculo)
//   · 3 plantillas instantáneas (0 ms, sin IA): IMC, costo por persona y margen.
//   · «Generar fórmula con IA»: la descripción en español + los NOMBRES de los
//     campos numéricos del tablero (nunca sus valores) → ficha validada.
// La ficha se coloca sin solapes y se cablea sola con la ficha que aporta los
// datos cuando no hay duda de cuál es (o con la tarjeta seleccionada).
// ============================================================================

const EXAMPLES = [
  "Calcular dosis pediátrica en mg multiplicando peso en kg por dosis por kilo",
  "Calcular costo por persona dividiendo presupuesto total entre asistentes",
  "Esfuerzo axial: fuerza entre área",
];

function announce(title: string, inserted: InsertedFormula, notes?: string) {
  const wired =
    inserted.connectedTitles.length > 0
      ? ` Conectada a ${inserted.connectedTitles.map((t) => `«${t.slice(0, 30)}»`).join(", ")}: se llena sola.`
      : " Conecta una ficha con los datos hacia la fórmula para llenarla sola.";
  toast({
    message: `Fórmula «${title.slice(0, 40)}» creada.${wired}${notes ? ` ${notes}` : ""}`,
    tone: "success",
    durationMs: 7000,
  });
}

const FormulaCreatorPanel: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const readOnly = useCanvasReadOnly();
  // Se suscribe al contador y a las claves para refrescar «quedan N consultas».
  useAiQuotaStore((s) => s.used);
  useAiProvidersStore((s) => s.keys);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useSubmitGuard();
  const abortRef = useRef<AbortController | null>(null);
  const ownKey = hasOwnGeminiKey();
  const left = freeQueriesLeft();

  const applyPreset = (preset: FormulaPreset) => {
    const data = structuredClone(preset.data);
    const inserted = insertFormulaNode(preset.title, data);
    announce(preset.title, inserted);
    track("formula_created", { source: "preset" });
    onDone();
  };

  const submit = () =>
    run(async () => {
      setError(null);
      const text = description.trim();
      if (text.length < 4) {
        setError("Describe la fórmula que necesitas: qué quieres calcular y con qué datos.");
        return;
      }
      abortRef.current = new AbortController();
      try {
        const generated = await generateFormula(text, useWorkspaceStore.getState().nodes, abortRef.current.signal);
        const inserted = insertFormulaNode(generated.title, generated.data);
        announce(generated.title, inserted, generated.notes);
        track("formula_created", { source: "ai" });
        setDescription("");
        onDone();
      } catch (err) {
        if (err instanceof FormulaGenError && err.code === "aborted") return;
        setError(err instanceof Error ? err.message : "No se pudo generar la fórmula.");
      } finally {
        abortRef.current = null;
      }
    });

  if (readOnly) {
    return (
      <p className="text-xs text-andros-muted">
        La sala está llena: este espacio está en solo lectura y no se pueden crear fórmulas.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-andros-primary">Plantillas al instante (sin IA)</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Plantillas de fórmula">
          {FORMULA_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={pending}
                className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:border-andros-border-active hover:bg-andros-border/30 flex items-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
                {preset.chip}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="formula-description" className="block text-xs font-medium text-andros-primary">
          Describe la fórmula que necesitas
        </label>
        <textarea
          id="formula-description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value.slice(0, FORMULA_MAX_DESCRIPTION_CHARS));
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={3}
          placeholder={`Ejemplo: ${EXAMPLES[0]}`}
          aria-describedby="formula-description-help"
          aria-invalid={Boolean(error) && description.trim().length < 4}
          className="w-full resize-y rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none p-3 text-sm leading-relaxed text-andros-primary placeholder:text-andros-muted"
        />
        <div id="formula-description-help" className="flex items-center justify-between gap-2 text-[11px] text-andros-muted">
          <span>Di qué quieres calcular y con qué datos. Se calcula sola con tus fichas conectadas.</span>
          <span className="shrink-0 font-mono tabular-nums">
            {description.length}/{FORMULA_MAX_DESCRIPTION_CHARS}
          </span>
        </div>
        {!description && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setDescription(example)}
                className="min-h-11 md:min-h-0 text-left text-[11px] text-andros-accent-ink underline underline-offset-2"
              >
                {example.length > 48 ? `${example.slice(0, 46)}…` : example}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Privacidad y cuota */}
      {ownKey ? (
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-andros-muted">
          <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
          Se usa tu propia clave de Gemini (sin límite diario de Andros).
        </p>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-andros-border bg-andros-surface text-[11px] leading-relaxed text-andros-muted">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-warning" aria-hidden="true" />
          <p>
            Se envían tu descripción y los nombres de los campos numéricos del tablero (nunca sus valores). Te quedan{" "}
            <span className="font-mono tabular-nums text-andros-primary">{left}</span> consultas hoy, o{" "}
            <button
              type="button"
              onClick={() => useAiProvidersStore.getState().setKeysModalOpen(true)}
              className="text-andros-accent-ink underline underline-offset-2"
            >
              añade tu propia clave
            </button>
            .
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-andros-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={() => void submit()} disabled={pending} className={`${BUTTON_PRIMARY} flex-1`}>
          {pending ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Sparkles className="w-4 h-4" aria-hidden="true" />
          )}
          {pending ? "Generando fórmula…" : "Generar fórmula con IA"}
        </button>
        {pending && (
          <button type="button" onClick={() => abortRef.current?.abort()} className={BUTTON_SECONDARY}>
            <X className="w-4 h-4" aria-hidden="true" />
            Cancelar
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-andros-muted">
        Revisa siempre la fórmula antes de usarla en decisiones clínicas, financieras o de seguridad: puedes corregir el
        LaTeX, la expresión y las variables con «Editar fórmula».
      </p>
    </div>
  );
};

export const FormulaCreatorModal: React.FC = () => {
  const open = useFormulaCreatorStore((s) => s.open);
  const close = () => useFormulaCreatorStore.getState().setOpen(false);
  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Nueva fórmula"
      titleId="andros-formula-title"
      icon={<SquareFunction className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Una fórmula LaTeX que toma los datos de tus fichas conectadas y se recalcula sola, sin gastar IA."
      layer="top"
    >
      {open && (
        <FormulaCreatorPanel
          onDone={() => {
            close();
            // Se vuelve al lienzo para ver la fórmula recién creada.
            useWorkspaceStore.getState().setOracleModalOpen(false);
          }}
        />
      )}
    </SocialDialog>
  );
};
