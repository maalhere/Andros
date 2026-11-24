"use client";

import React, { useMemo, useState } from "react";
import { Check, ClipboardCopy, FileText, Printer } from "lucide-react";
import { usePlanExportStore } from "@/store/usePlanExportStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useCollabStore } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { copyText } from "@/lib/collab/room";
import { PLAN_CATEGORY_LABELS, buildPlanDocument, planToWhatsApp } from "@/lib/plan/planDocument";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "@/components/social/SocialDialog";
import { PlanPrintSheet } from "./PlanPrintSheet";

// ============================================================================
// ANDROS — EXPORTAR «PLAN DEL DÍA» (función Pro, abierta en acceso anticipado)
//   · Resumen ejecutivo para WhatsApp en 1 clic (portapapeles).
//   · Documento imprimible / PDF con `window.print()` y una hoja de estilos
//     `@media print` dedicada (sin librerías pesadas).
//   Todo se genera en el navegador: no se envía nada a ningún servidor.
// ============================================================================

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

export const ExportPlanModal: React.FC = () => {
  const open = usePlanExportStore((s) => s.open);
  const setOpen = usePlanExportStore((s) => s.setOpen);
  const close = () => setOpen(false);

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Exportar Plan del Día"
      titleId="andros-export-plan-title"
      icon={<FileText className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Tus tarjetas ordenadas como un documento ejecutivo: resumen, cronograma, presupuesto, logística y roles. Se genera en tu navegador."
    >
      {open && <ExportPlanBody />}
    </SocialDialog>
  );
};

const ExportPlanBody: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const workspaceTitle = useWorkspaceTitle();
  const [generatedAt] = useState(() => new Date());
  const [copied, setCopied] = useState(false);

  const doc = useMemo(() => {
    // Con los cables: las Fichas de Fórmula salen recalculadas con sus fichas conectadas.
    const built = buildPlanDocument(workspaceTitle, nodes, generatedAt, connections);
    // El título del plan (primer «# …» del resumen) suele ser más claro que el del espacio.
    const heading = built.sections
      .find((s) => s.category === "summary")
      ?.blocks.find((b) => b.type === "heading")?.text;
    return heading ? { ...built, title: heading } : built;
  }, [nodes, connections, workspaceTitle, generatedAt]);

  const whatsapp = useMemo(() => planToWhatsApp(doc), [doc]);
  const empty = doc.sections.length === 0;

  const copyWhatsApp = async () => {
    const ok = await copyText(whatsapp);
    setCopied(ok);
    toast({
      message: ok
        ? "Resumen copiado. Pégalo en tu grupo de WhatsApp."
        : "No se pudo copiar. Selecciona el texto de la vista previa y cópialo a mano.",
      tone: ok ? "success" : "error",
    });
  };

  return (
    <div className="space-y-4">
      {/* Índice del documento */}
      {empty ? (
        <p className="text-xs text-andros-muted">
          Este espacio todavía no tiene tarjetas con contenido. Crea un plan con el Oráculo IA o
          escribe en una nota y vuelve aquí.
        </p>
      ) : (
        <div className="rounded-xl border border-andros-border">
          <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-andros-border">
            <p className="min-w-0 truncate text-sm font-semibold text-andros-primary">{doc.title}</p>
            {doc.budgetTotal && (
              <p className="shrink-0 text-xs text-andros-muted">
                Total <span className="font-semibold text-andros-primary">{doc.budgetTotal}</span>
              </p>
            )}
          </div>
          <ol className="max-h-40 overflow-y-auto p-1">
            {doc.sections.map((section, i) => (
              <li key={section.id} className="flex items-baseline gap-2.5 px-2 py-1.5 text-xs">
                <span className="w-5 shrink-0 text-right font-mono tabular-nums text-andros-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-andros-primary">{section.title}</span>
                <span className="shrink-0 text-[11px] text-andros-muted">{PLAN_CATEGORY_LABELS[section.category]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => void copyWhatsApp()} disabled={empty} className={BUTTON_PRIMARY}>
          {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <ClipboardCopy className="w-4 h-4" aria-hidden="true" />}
          {copied ? "Resumen copiado" : "Copiar para WhatsApp"}
        </button>
        <button type="button" onClick={() => window.print()} disabled={empty} className={BUTTON_SECONDARY}>
          <Printer className="w-4 h-4" aria-hidden="true" />
          Imprimir o guardar PDF
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-andros-muted">
        Para el PDF, elige «Guardar como PDF» en el diálogo de impresión de tu navegador.
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
      <PlanPrintSheet doc={doc} />
    </div>
  );
};
