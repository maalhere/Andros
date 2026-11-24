"use client";

import { track } from "@/lib/analytics/telemetry";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ClipboardCopy,
  FileDown,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Presentation,
  Printer,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { usePlanExportStore } from "@/store/usePlanExportStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useCollabStore } from "@/store/useCollabStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { useAiQuotaStore } from "@/store/useAiQuotaStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { copyText } from "@/lib/collab/room";
import { requestFileDownload } from "@/lib/downloadWithPermission";
import { FREE_DAILY_LIMIT, todayKey } from "@/lib/ai/freeQuota";
import { PLAN_CATEGORY_LABELS, buildPlanDocument, planToWhatsApp } from "@/lib/plan/planDocument";
import {
  INSTRUCTION_MAX_CHARS,
  exportCardsFromPlan,
  exportFileBase,
  photoAssetsFromPlan,
  type DocumentOutline,
  type ExportMode,
  type SlidesOutline,
} from "@/lib/export/exportOutline";
import { outlinePhotoIds, prepareEmbeddedImages, requestExportOutline, type OutlineResult } from "@/lib/export/exportClient";
import { BUTTON_PRIMARY, INPUT, SocialDialog } from "@/components/social/SocialDialog";
import { PlanPrintSheet } from "./PlanPrintSheet";
import { OutlinePrintSheet } from "./OutlinePrintSheet";

// ============================================================================
// ANDROS — ESTUDIO DE EXPORTACIÓN (antes «Exportar Plan del Día»)
// Se abre desde ⋯ Más opciones, la paleta ⌘K y «Compartir espacio»; funciona
// también en solo lectura. Cuatro salidas en 1 clic:
//   1. PDF imprimible enriquecido (`window.print()`, sin librerías).
//   2. Word / Google Docs (.docx)     ─┐ generadores diferidos: `docx` y
//   3. PowerPoint / Google Slides (.pptx) ┘ `pptxgenjs` se descargan al pulsar.
//   4. Resumen para WhatsApp (portapapeles).
// «Sintetizar con IA» gasta 1 consulta (se reutiliza para el PDF y el Word);
// «Directo del tablero» no usa la red. Las fotos nunca salen del dispositivo.
// ============================================================================

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type Output = "pdf" | "docx" | "pptx";

/** Nombre del espacio abierto (propio, compartido o de la sala en vivo). */
function useWorkspaceTitle(): string {
  const guestName = useCollabStore((s) => s.guest?.workspaceName ?? null);
  const workspaceId = useCloudStore((s) => s.workspaceId);
  const own = useWorkspaceManagerStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name ?? null);
  const shared = useWorkspaceManagerStore(
    (s) => s.sharedWorkspaces.find((w) => w.id === workspaceId)?.name ?? null
  );
  return guestName ?? own ?? shared ?? "Mi espacio";
}

/** Consultas gratis que quedan hoy (o `null` con clave propia), reactivo. */
function useFreeQueriesLeft(): number | null {
  const ownKey = useAiProvidersStore((s) => Boolean(s.keys.gemini?.trim()));
  const day = useAiQuotaStore((s) => s.day);
  const used = useAiQuotaStore((s) => s.used);
  if (ownKey) return null;
  return day === todayKey() ? Math.max(0, FREE_DAILY_LIMIT - used) : FREE_DAILY_LIMIT;
}

/** Huella barata del contenido (FNV-1a) para reutilizar la síntesis mientras no cambie. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export const ExportDeliverableModal: React.FC = () => {
  const open = usePlanExportStore((s) => s.open);
  const setOpen = usePlanExportStore((s) => s.setOpen);
  const close = () => setOpen(false);

  return (
    <SocialDialog
      open={open}
      onClose={close}
      wide
      title="Estudio de exportación"
      titleId="andros-export-studio-title"
      icon={<FileDown className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Tu tablero como PDF, Word, PowerPoint o resumen para WhatsApp. Elige si la IA redacta y ordena el contenido o si sale tal cual, al instante."
    >
      {open && <ExportStudioBody />}
    </SocialDialog>
  );
};

const ExportStudioBody: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const theme = useWorkspaceStore((s) => s.theme);
  const workspaceTitle = useWorkspaceTitle();
  const freeLeft = useFreeQueriesLeft();
  const [generatedAt] = useState(() => new Date());
  const [useAi, setUseAi] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<Output | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  /** Síntesis para imprimir, atada al contenido con el que se generó. */
  const [printState, setPrintState] = useState<{ key: string; outline: DocumentOutline } | null>(null);
  const [printRequest, setPrintRequest] = useState(0);
  const cache = useRef(new Map<string, OutlineResult>());
  const guard = useSubmitGuard();

  const doc = useMemo(() => {
    // Con los cables: las Fichas de Fórmula salen recalculadas con sus fichas conectadas.
    const built = buildPlanDocument(workspaceTitle, nodes, generatedAt, connections);
    // El título del plan (primer «# …» del resumen) suele ser más claro que el del espacio.
    const heading = built.sections
      .find((s) => s.category === "summary")
      ?.blocks.find((b) => b.type === "heading")?.text;
    return heading ? { ...built, title: heading } : built;
  }, [nodes, connections, workspaceTitle, generatedAt]);

  const cards = useMemo(() => exportCardsFromPlan(doc), [doc]);
  const photoAssets = useMemo(() => photoAssetsFromPlan(doc), [doc]);
  const contentKey = useMemo(() => fingerprint(JSON.stringify(cards)), [cards]);
  const whatsapp = useMemo(() => planToWhatsApp(doc), [doc]);
  const empty = doc.sections.length === 0;
  const photoCount = photoAssets.size;

  // Si el tablero cambia, la síntesis impresa anterior ya no vale.
  const printOutline = printState?.key === contentKey ? printState.outline : null;

  // Imprime cuando la hoja enriquecida ya está montada (KaTeX y fotos incluidos).
  useEffect(() => {
    if (printRequest === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) window.print();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [printRequest]);

  const outlineFor = async (mode: ExportMode): Promise<OutlineResult> => {
    const key = `${mode}|${useAi ? "ai" : "local"}|${instruction.trim()}|${contentKey}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    const result = await requestExportOutline({
      mode,
      title: doc.title,
      cards,
      instruction: instruction.trim(),
      useAi,
      generatedAt,
    });
    // Solo se guarda lo que salió bien (un respaldo por falta de red se reintenta).
    if (!result.notice) cache.current.set(key, result);
    if (useAi) {
      setStatus(
        result.usedAi
          ? { tone: "success", text: `Redactado con IA${result.model ? ` (${result.model})` : ""}. Revisa el archivo antes de compartirlo.` }
          : { tone: "warning", text: result.notice ?? "Se usó el contenido directo del tablero." }
      );
    }
    return result;
  };

  const run = (output: Output, task: () => Promise<void>) =>
    void guard.run(async () => {
      setBusy(output);
      try {
        await task();
        track("deliverable_exported", { type: output, ai: useAi });
      } catch (error) {
        console.error("[export] fallo al generar:", error instanceof Error ? error.message : error);
        toast({ message: "No se pudo generar el archivo. Inténtalo de nuevo.", tone: "error" });
      } finally {
        setBusy(null);
      }
    });

  const exportPdf = () =>
    run("pdf", async () => {
      if (!useAi) {
        // Directo: la hoja del Plan del Día ya está montada (salvo que antes se imprimiera la síntesis).
        if (printOutline) {
          setPrintState(null);
          setPrintRequest((n) => n + 1);
        } else {
          window.print();
        }
        return;
      }
      const { outline } = await outlineFor("document");
      setPrintState({ key: contentKey, outline: outline as DocumentOutline });
      setPrintRequest((n) => n + 1);
    });

  const exportDocx = () =>
    run("docx", async () => {
      // La librería se descarga en paralelo mientras se arma la estructura.
      const builder = import("@/lib/export/docxBuilder");
      const { outline } = await outlineFor("document");
      const images = await prepareEmbeddedImages(outlinePhotoIds(outline), photoAssets);
      const { buildDocx } = await builder;
      const bytes = await buildDocx(outline as DocumentOutline, images, { generatedAt });
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOCX_MIME });
      await requestFileDownload({
        filename: `${exportFileBase(outline.title)}.docx`,
        blobOrUrl: blob,
        mimeType: DOCX_MIME,
        description: "Documento de Word: se abre y edita en Microsoft Word y en Google Docs (súbelo a Drive).",
      });
    });

  const exportPptx = () =>
    run("pptx", async () => {
      const builder = import("@/lib/export/pptxBuilder");
      const { outline } = await outlineFor("slides");
      const images = await prepareEmbeddedImages(outlinePhotoIds(outline), photoAssets);
      const { buildPptx } = await builder;
      const bytes = await buildPptx(outline as SlidesOutline, images, { theme: theme === "dark" ? "dark" : "light" });
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: PPTX_MIME });
      await requestFileDownload({
        filename: `${exportFileBase(outline.title)}.pptx`,
        blobOrUrl: blob,
        mimeType: PPTX_MIME,
        description: "Presentación 16:9: se abre y edita en Microsoft PowerPoint y en Google Slides (súbela a Drive).",
      });
    });

  const copyWhatsApp = async () => {
    const ok = await copyText(whatsapp);
    setCopied(ok);
    if (ok) track("deliverable_exported", { type: "whatsapp" });
    toast({
      message: ok
        ? "Resumen copiado. Pégalo en tu grupo de WhatsApp."
        : "No se pudo copiar. Selecciona el texto de la vista previa y cópialo a mano.",
      tone: ok ? "success" : "error",
    });
  };

  const aiCost =
    freeLeft === null ? "Con tu clave de Gemini · sin límite diario" : `1 consulta por formato · quedan ${freeLeft} de ${FREE_DAILY_LIMIT} hoy`;
  const aiOutOfQuota = useAi && freeLeft === 0;

  return (
    <div className="space-y-4">
      {/* Índice del documento */}
      {empty ? (
        <p className="text-xs text-andros-muted">
          Este espacio todavía no tiene tarjetas con contenido. Crea un plan con el Oráculo IA o escribe en una nota y
          vuelve aquí.
        </p>
      ) : (
        <div className="rounded-xl border border-andros-border">
          <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-andros-border">
            <p className="min-w-0 truncate text-sm font-semibold text-andros-primary">{doc.title}</p>
            <p className="shrink-0 text-xs text-andros-muted">
              <span className="font-mono tabular-nums">{doc.sections.length}</span> tarjetas
              {photoCount > 0 && (
                <>
                  {" · "}
                  <span className="font-mono tabular-nums">{photoCount}</span> {photoCount === 1 ? "foto" : "fotos"}
                </>
              )}
              {doc.budgetTotal && (
                <>
                  {" · Total "}
                  <span className="font-semibold text-andros-primary">{doc.budgetTotal}</span>
                </>
              )}
            </p>
          </div>
          <ol className="max-h-28 overflow-y-auto p-1">
            {doc.sections.map((section, i) => (
              <li key={section.id} className="flex items-baseline gap-2.5 px-2 py-1 text-xs">
                <span className="w-5 shrink-0 text-right font-mono tabular-nums text-andros-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-andros-primary">{section.title}</span>
                <span className="shrink-0 text-[11px] text-andros-muted">{PLAN_CATEGORY_LABELS[section.category]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* IA o directo */}
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-xs font-semibold text-andros-primary">Contenido</legend>
        <div role="radiogroup" aria-label="Cómo se arma el contenido" className="grid grid-cols-2 gap-1 rounded-xl border border-andros-border bg-andros-surface p-1">
          {[
            { value: true, label: "Sintetizar con IA", hint: aiCost, icon: Sparkles },
            { value: false, label: "Directo del tablero", hint: "Sin IA · al instante · $0", icon: LayoutDashboard },
          ].map((option) => {
            const selected = useAi === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setUseAi(option.value)}
                className={`min-h-[52px] rounded-lg px-2.5 py-1.5 text-left active:scale-[0.96] spring-micro ${
                  selected
                    ? "bg-andros-card border border-andros-border-active shadow-sm"
                    : "border border-transparent hover:bg-andros-border/30"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-andros-primary">
                  <Icon className={`w-3.5 h-3.5 ${selected ? "text-andros-accent-ink" : "text-andros-muted"}`} aria-hidden="true" />
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-andros-muted">{option.hint}</span>
              </button>
            );
          })}
        </div>

        {useAi && (
          <div className="space-y-1">
            <label htmlFor="andros-export-instruction" className="block text-[11px] font-medium text-andros-muted">
              Instrucción rápida (opcional)
            </label>
            <input
              id="andros-export-instruction"
              type="text"
              value={instruction}
              maxLength={INSTRUCTION_MAX_CHARS}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ej.: Tono formal para presentar a directivos"
              className={INPUT}
            />
            {aiOutOfQuota && (
              <p className="text-[11px] leading-relaxed text-andros-warning">
                Ya no quedan consultas gratis hoy: se exportará el contenido directo del tablero. Añade tu clave de Gemini en
                Claves IA para usarla sin límite.
              </p>
            )}
          </div>
        )}
      </fieldset>

      {/* Salidas */}
      <div className="grid gap-2 sm:grid-cols-2">
        <OutputCard
          icon={Printer}
          title="PDF imprimible"
          note="Tablas con totales, fórmulas y fotos con saltos de página limpios."
          action="Imprimir o guardar PDF"
          busy={busy === "pdf"}
          disabled={empty || guard.pending}
          onClick={exportPdf}
        />
        <OutputCard
          icon={FileText}
          title="Documento .docx"
          note="Compatible con Word / Google Docs"
          action="Descargar .docx"
          busy={busy === "docx"}
          disabled={empty || guard.pending}
          onClick={exportDocx}
        />
        <OutputCard
          icon={Presentation}
          title="Presentación .pptx"
          note="Compatible con PowerPoint / Google Slides"
          action="Descargar .pptx"
          busy={busy === "pptx"}
          disabled={empty || guard.pending}
          onClick={exportPptx}
        />
        <OutputCard
          icon={copied ? Check : ClipboardCopy}
          title="Resumen para WhatsApp"
          note="Texto listo para pegar en un grupo."
          action={copied ? "Resumen copiado" : "Copiar resumen"}
          busy={false}
          disabled={empty}
          onClick={() => void copyWhatsApp()}
        />
      </div>

      <div aria-live="polite" className="min-h-0">
        {status && (
          <p className={`text-[11px] leading-relaxed ${status.tone === "warning" ? "text-andros-warning" : "text-andros-muted"}`}>
            {status.text}
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-andros-muted">
        {useAi
          ? "Con IA se envía a Google Gemini el texto y los datos de las tarjetas (nunca las fotos: se incrustan en tu dispositivo). "
          : "Todo se genera en tu navegador, sin enviar nada. "}
        Para el PDF, elige «Guardar como PDF» en el diálogo de impresión. Los .docx y .pptx se abren directo al subirlos a
        Google Drive.
      </p>

      {!empty && (
        <details className="group rounded-xl border border-andros-border">
          <summary className="cursor-pointer select-none px-3 min-h-[44px] md:min-h-[36px] flex items-center text-xs font-medium text-andros-primary">
            Vista previa del resumen para WhatsApp
          </summary>
          <pre className="max-h-56 overflow-y-auto px-3 pb-3 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-andros-muted">
            {whatsapp}
          </pre>
        </details>
      )}

      {/* Hoja que sale al imprimir (invisible en pantalla) */}
      {printOutline ? (
        <OutlinePrintSheet outline={printOutline} photos={photoAssets} generatedAt={generatedAt} />
      ) : (
        <PlanPrintSheet doc={doc} />
      )}
    </div>
  );
};

const OutputCard: React.FC<{
  icon: LucideIcon;
  title: string;
  note: string;
  action: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}> = ({ icon: Icon, title, note, action, busy, disabled, onClick }) => (
  <div className="flex flex-col gap-1.5 rounded-xl border border-andros-border bg-andros-surface p-1">
    <div className="flex items-start gap-2 px-2 pt-2">
      <span className="w-8 h-8 shrink-0 rounded-lg border border-andros-border bg-andros-card flex items-center justify-center">
        <Icon className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-andros-primary">{title}</p>
        <p className="text-[11px] leading-snug text-andros-muted">{note}</p>
      </div>
    </div>
    <button type="button" onClick={onClick} disabled={disabled} aria-busy={busy} className={BUTTON_PRIMARY}>
      {busy && <LoaderCircle className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
      {busy ? "Generando…" : action}
    </button>
  </div>
);
