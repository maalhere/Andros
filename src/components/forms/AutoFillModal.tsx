"use client";

import { track } from "@/lib/analytics/telemetry";
import React, { useMemo, useRef, useState } from "react";
import { ClipboardList, KeyRound, Loader2, ShieldAlert, Sparkles, X } from "lucide-react";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { freeQueriesLeft, hasOwnGeminiKey, useAiQuotaStore } from "@/store/useAiQuotaStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { AutofillError, autofillContextFor, runAutofill, type AutofillSource } from "@/lib/forms/autofillClient";
import { AUTOFILL_MAX_RAW_CHARS, AUTOFILL_MAX_REQUEST_SHEETS } from "@/lib/forms/autofill";
import { isFieldFilled } from "@/lib/forms/formSchema";
import { findCatalogTemplate } from "@/lib/forms/templateCatalog";
import type { FormTemplate } from "@/types/forms";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "@/components/social/SocialDialog";
import type { FormSheetEngineeringNode } from "@/types/workspace";

// ============================================================================
// ANDROS — «LLENAR FICHAS CON IA» (desde la Librería de fichas y el Oráculo)
// El usuario elige 1 o más formatos (o fichas ya en el lienzo), pega la
// información tal como la recibe y la IA la reparte en los campos SIN
// inventar: lo que no esté en el texto queda vacío o marcado «Revisar».
// ============================================================================

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const IGNORED_WORDS = new Set(["ficha", "nota", "datos", "registro", "tecnicos", "medicion", "logistica"]);

/** Palabras distintivas del título de un formato («historial», «receta»…). */
function titleWords(title: string): string[] {
  return normalize(title)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !IGNORED_WORDS.has(w));
}

const EXAMPLE_TEXT =
  "Paciente María López, 34 años, viene por migraña hace 3 días, PA 120/80, sin alergias, recetar ibuprofeno 400mg cada 8h por 3 días y citar en 1 semana; llenar historial clínico y receta";

export const AutoFillPanel: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const ownTemplates = useFormsLibraryStore((s) => s.templates);
  const preselect = useFormsLibraryStore((s) => s.preselectTemplateIds);
  const preselectSheets = useFormsLibraryStore((s) => s.preselectSheetIds);
  // (Sprint 23) Una plantilla del catálogo elegida con «Llenar con IA» se suma
  // a la lista sin guardarse en la librería personal.
  const templates = useMemo<FormTemplate[]>(() => {
    const fromCatalog = preselect
      .map(findCatalogTemplate)
      .filter((t): t is NonNullable<typeof t> => Boolean(t) && !ownTemplates.some((o) => o.id === t?.id));
    return [...fromCatalog, ...ownTemplates];
  }, [preselect, ownTemplates]);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const readOnly = useCanvasReadOnly();
  // Se suscribe al contador para refrescar «quedan N consultas».
  useAiQuotaStore((s) => s.used);
  useAiProvidersStore((s) => s.keys);

  const [rawText, setRawText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set([...preselect.map((id) => `tpl:${id}`), ...preselectSheets.map((id) => `can:${id}`)])
  );
  const [touched, setTouched] = useState(preselect.length + preselectSheets.length > 0);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useSubmitGuard();
  const abortRef = useRef<AbortController | null>(null);

  const canvasSheets = useMemo(
    () =>
      nodes.filter(
        (n): n is FormSheetEngineeringNode =>
          n.type === "form-sheet-node" &&
          n.formSheetData.fields.some((f) => f.type !== "photo" && !isFieldFilled(f))
      ),
    [nodes]
  );

  // Sugerencia local (0 ms, sin IA): formatos que el texto menciona por su nombre.
  const suggested = useMemo(() => {
    const text = normalize(rawText);
    if (text.length < 8) return new Set<string>();
    return new Set(
      templates.filter((t) => titleWords(t.title).some((w) => text.includes(w.slice(0, 6)))).map((t) => `tpl:${t.id}`)
    );
  }, [rawText, templates]);

  const selection = touched ? picked : suggested;
  const ownKey = hasOwnGeminiKey();
  const left = freeQueriesLeft();

  const toggle = (key: string) => {
    setTouched(true);
    setPicked(() => {
      const next = new Set(selection);
      if (next.has(key)) next.delete(key);
      else if (next.size < AUTOFILL_MAX_REQUEST_SHEETS) next.add(key);
      else toast({ message: `Puedes llenar hasta ${AUTOFILL_MAX_REQUEST_SHEETS} fichas a la vez.`, tone: "error" });
      return next;
    });
  };

  const submit = () =>
    run(async () => {
      setError(null);
      const text = rawText.trim();
      const sources: AutofillSource[] = [];
      for (const key of selection) {
        const [kind, id] = [key.slice(0, 3), key.slice(4)];
        if (kind === "tpl") {
          const template = templates.find((t) => t.id === id);
          if (template) sources.push({ kind: "template", template });
        } else {
          const node = canvasSheets.find((n) => n.id === id);
          if (node) sources.push({ kind: "canvas", node });
        }
      }
      if (sources.length === 0) {
        setError("Elige al menos un formato o una ficha del lienzo.");
        return;
      }
      // (Sprint 24) Una ficha conectada a otros nodos puede llenarse solo con ese contexto.
      if (!text && !autofillContextFor(sources)) {
        setError("Escribe o pega la información que quieres pasar a las fichas.");
        return;
      }
      abortRef.current = new AbortController();
      try {
        const outcome = await runAutofill(text, sources, abortRef.current.signal);
        track("form_autofilled", { created: outcome.created, updated: outcome.updated, fields: outcome.filledFields });
        const parts = [
          outcome.created > 0 ? `${outcome.created} ficha${outcome.created === 1 ? "" : "s"} nueva${outcome.created === 1 ? "" : "s"}` : "",
          outcome.updated > 0 ? `${outcome.updated} actualizada${outcome.updated === 1 ? "" : "s"}` : "",
          `${outcome.filledFields} campo${outcome.filledFields === 1 ? "" : "s"} con dato`,
          outcome.reviewFields > 0 ? `${outcome.reviewFields} por revisar` : "",
        ].filter(Boolean);
        toast({
          message: `Listo: ${parts.join(" · ")}.${outcome.notes ? ` ${outcome.notes}` : ""}`,
          tone: "success",
          durationMs: 7000,
        });
        setRawText("");
        onDone?.();
      } catch (err) {
        if (err instanceof AutofillError && err.code === "aborted") return;
        setError(err instanceof Error ? err.message : "No se pudieron llenar las fichas.");
      } finally {
        abortRef.current = null;
      }
    });

  if (readOnly) {
    return (
      <p className="text-xs text-andros-muted">
        La sala está llena: este espacio está en solo lectura y no se pueden crear ni llenar fichas.
      </p>
    );
  }

  const chip = (key: string, label: string, hint?: string) => {
    const active = selection.has(key);
    return (
      <li key={key}>
        <button
          type="button"
          role="checkbox"
          aria-checked={active}
          onClick={() => toggle(key)}
          className={`min-h-11 md:min-h-8 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 active:scale-[0.96] spring-micro ${
            active
              ? "bg-andros-accent/10 border-andros-accent text-andros-primary"
              : "border-andros-border text-andros-muted hover:text-andros-primary hover:border-andros-border-active"
          }`}
        >
          <ClipboardList className={`w-3.5 h-3.5 ${active ? "text-andros-accent-ink" : ""}`} aria-hidden="true" />
          {label}
          {hint && <span className="text-[10px] text-andros-muted">· {hint}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="autofill-raw" className="block text-xs font-medium text-andros-primary">
          Información en bruto
        </label>
        <textarea
          id="autofill-raw"
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value.slice(0, AUTOFILL_MAX_RAW_CHARS));
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={6}
          placeholder={`Ejemplo: ${EXAMPLE_TEXT}`}
          aria-describedby="autofill-raw-help"
          aria-invalid={Boolean(error) && !rawText.trim()}
          className="w-full resize-y rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none p-3 text-sm leading-relaxed text-andros-primary placeholder:text-andros-muted"
        />
        <div id="autofill-raw-help" className="flex items-center justify-between gap-2 text-[11px] text-andros-muted">
          <span>Notas rápidas, dictado o transcripción, tal como te llegan. Puedes decir qué fichas llenar.</span>
          <span className="shrink-0 font-mono tabular-nums">
            {rawText.length}/{AUTOFILL_MAX_RAW_CHARS}
          </span>
        </div>
        {!rawText && (
          <button
            type="button"
            onClick={() => setRawText(EXAMPLE_TEXT)}
            className="min-h-11 md:min-h-0 text-[11px] text-andros-accent-ink underline underline-offset-2"
          >
            Usar el texto de ejemplo
          </button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-andros-primary">
          Fichas a llenar{" "}
          {!touched && suggested.size > 0 && <span className="font-normal text-andros-muted">(sugeridas por tu texto)</span>}
        </p>
        {templates.length === 0 ? (
          <p className="text-xs text-andros-muted">Tu librería está vacía. Crea un formato en «Mis formatos».</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Formatos de tu librería">
            {templates.map((t) => chip(`tpl:${t.id}`, t.title))}
          </ul>
        )}
        {canvasSheets.length > 0 && (
          <>
            <p className="pt-1 text-[11px] text-andros-muted">O completa fichas que ya están en el lienzo (solo sus campos vacíos):</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Fichas del lienzo con campos vacíos">
              {canvasSheets.slice(0, 12).map((n) => chip(`can:${n.id}`, n.title.slice(0, 40), "en el lienzo"))}
            </ul>
            <p className="text-[11px] leading-relaxed text-andros-muted">
              Si una ficha está conectada a otros nodos, la IA recibe también su resumen (áreas, responsables, fechas y
              pendientes) y puedes llenarla aunque no pegues texto.
            </p>
          </>
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
            Se usará la clave compartida del servidor (te quedan{" "}
            <span className="font-mono tabular-nums text-andros-primary">{left}</span> consultas hoy). Evita datos clínicos
            o personales identificables, o{" "}
            <button
              type="button"
              onClick={() => useAiProvidersStore.getState().setKeysModalOpen(true)}
              className="text-andros-accent-ink underline underline-offset-2"
            >
              añade tu propia clave
            </button>
            . Para uso médico regulado, revisa antes la normativa aplicable.
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
          {pending ? "Llenando fichas…" : "Llenar fichas con IA"}
        </button>
        {pending && (
          <button type="button" onClick={() => abortRef.current?.abort()} className={BUTTON_SECONDARY}>
            <X className="w-4 h-4" aria-hidden="true" />
            Cancelar
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-andros-muted">
        La IA solo copia lo que dice tu texto: lo que falte queda vacío y lo dudoso o calculado se marca «Revisar». Revisa
        siempre las fichas antes de usarlas.
      </p>
    </div>
  );
};

/** Diálogo independiente (se abre desde el Estudio del Oráculo y la paleta ⌘K). */
export const AutoFillModal: React.FC = () => {
  const open = useFormsLibraryStore((s) => s.autofillOpen);
  const close = () => useFormsLibraryStore.getState().setAutofillOpen(false);
  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Llenar fichas con IA"
      titleId="andros-autofill-title"
      icon={<Sparkles className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Pega la información tal como la recibes y elige qué fichas llenar. Se insertan ordenadas en el lienzo, listas para revisar."
      wide
      layer="top"
    >
      {open && (
        <AutoFillPanel
          onDone={() => {
            close();
            // Se vuelve al lienzo para ver las fichas recién llenadas.
            useWorkspaceStore.getState().setOracleModalOpen(false);
          }}
        />
      )}
    </SocialDialog>
  );
};
