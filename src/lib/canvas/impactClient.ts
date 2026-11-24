// ============================================================================
// ANDROS — CLIENTE DEL DETECTOR "ANTI-MALENTENDIDOS" (solo cliente)
//
// Disparador inteligente que protege la cuota de IA:
//   1. Nunca por tecla: solo cuando un editor CONFIRMA la edición
//      (`commitWithImpact`: guardar la nota o salir de una celda).
//   2. Solo si la tarjeta tiene al menos 1 tarjeta conectada.
//   3. Filtro local de 0 ms (`detectSignificantChange`): números, fechas/horas
//      o más de ~15 caracteres.
//   4. Con «Alertas automáticas» se espera 2,5 s (varias celdas seguidas = 1
//      sola consulta); sin ellas, la tarjeta solo marca «Revisar impacto».
// ============================================================================

import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useImpactStore } from "@/store/useImpactStore";
import { autoImpactAlertsEnabled } from "@/store/useSettingsStore";
import { useCloudStore } from "@/store/useCloudStore";
import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { toast } from "@/store/useToastStore";
import {
  alertShareText,
  buildImpactRequest,
  detectSignificantChange,
  hasDirectNeighbors,
  impactSnapshot,
  type ImpactAlertEntry,
  type ImpactResponse,
} from "@/lib/canvas/impact";

const AUTO_DEBOUNCE_MS = 2500;
const REQUEST_TIMEOUT_MS = 45_000;

const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** El aviso de «sin consultas gratis» de las revisiones automáticas sale una vez por sesión. */
let quotaWarned = false;

/** Texto comparable de una tarjeta (para `commitWithImpact` con edición en vivo). */
export function snapshotOf(nodeId: string): string | null {
  const { nodes, connections } = useWorkspaceStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  return node ? impactSnapshot(node, { nodes, connections }) : null;
}

function newAlertId(): string {
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Aplica una edición confirmada (`apply`) y decide, sin red, si merece
 * revisión de impacto. Úsalo SOLO al guardar/salir del editor, nunca por tecla.
 * `beforeSnapshot`: estado al EMPEZAR a editar (el texto ya viajó en vivo
 * mientras se escribía, así que el store ya no guarda el «antes»).
 */
export function commitWithImpact(nodeId: string, apply: () => void, beforeSnapshot?: string | null): void {
  const before = beforeSnapshot !== undefined ? beforeSnapshot : snapshotOf(nodeId);
  apply();
  const after = snapshotOf(nodeId);
  if (before === null || after === null || before === after) return;

  const { nodes, connections } = useWorkspaceStore.getState();
  if (!hasDirectNeighbors(nodes, connections, nodeId)) return;
  // Se compara con el texto de ANTES del primer cambio aún sin revisar.
  const origin = useImpactStore.getState().pending[nodeId]?.before ?? before;
  if (!detectSignificantChange(origin, after)) {
    // Un retoque menor que deshace el cambio pendiente lo limpia.
    if (origin === after) useImpactStore.getState().clearPending(nodeId);
    return;
  }
  useImpactStore.getState().markPending(nodeId, before, after);
  if (autoImpactAlertsEnabled()) scheduleAutoCheck(nodeId);
}

function scheduleAutoCheck(nodeId: string): void {
  const previous = autoTimers.get(nodeId);
  if (previous) clearTimeout(previous);
  autoTimers.set(
    nodeId,
    setTimeout(() => {
      autoTimers.delete(nodeId);
      // El cambio pudo deshacerse o revisarse a mano mientras tanto.
      if (!useImpactStore.getState().pending[nodeId]) return;
      void runImpactCheck(nodeId, { auto: true });
    }, AUTO_DEBOUNCE_MS)
  );
}

/**
 * Revisa con IA el impacto del último cambio de `nodeId` sobre sus tarjetas
 * conectadas. Manual («Revisar impacto»): informa siempre del resultado.
 * Automática: solo aparece algo si hay un descuadre real (o un fallo).
 */
export async function runImpactCheck(nodeId: string, { auto = false }: { auto?: boolean } = {}): Promise<void> {
  const impact = useImpactStore.getState();
  if (impact.checking[nodeId]) return;
  const timer = autoTimers.get(nodeId);
  if (timer) {
    clearTimeout(timer);
    autoTimers.delete(nodeId);
  }

  const { nodes, connections } = useWorkspaceStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const pending = impact.pending[nodeId];
  const current = impactSnapshot(node);
  const body = buildImpactRequest(nodes, connections, nodeId, pending?.before ?? current, current);
  if (!body) {
    if (!auto) toast({ message: "Conecta esta tarjeta con otra para revisar el impacto de sus cambios." });
    return;
  }

  const quota = checkFreeQuota();
  if (!quota.ok) {
    if (!auto || !quotaWarned) toast({ message: quota.message, tone: "error", durationMs: 9000 });
    quotaWarned = true;
    return;
  }

  impact.setChecking(nodeId, true);
  try {
    const apiKey = getUserAiKey("gemini");
    let data: ImpactResponse | null = null;
    try {
      const res = await fetch("/api/oracle/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(apiKey ? { apiKey } : {}) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      data = (await res.json().catch(() => null)) as ImpactResponse | null;
      if (!data) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast({
        message: "No pude revisar el impacto del cambio (sin conexión con Andros). Inténtalo de nuevo con «Revisar impacto».",
        tone: "error",
      });
      return;
    }

    if (!data.ok) {
      toast({ message: data.issue.message, tone: "error", durationMs: 9000 });
      return;
    }

    // Solo cuenta si de verdad se usó la clave gratuita del servidor.
    recordFreeQuery();
    // Si la tarjeta cambió otra vez durante la revisión, ese cambio sigue pendiente.
    if (pending) useImpactStore.getState().clearPending(nodeId, pending.at);
    else useImpactStore.getState().clearPending(nodeId);

    const latest = useWorkspaceStore.getState();
    const titleOf = (id: string) => latest.nodes.find((n) => n.id === id)?.title ?? "Tarjeta";
    const authorName = useCloudStore.getState().user?.name ?? undefined;
    const createdAt = Date.now();
    const entries: ImpactAlertEntry[] = data.alerts
      .filter((a) => latest.nodes.some((n) => n.id === a.targetNodeId))
      .map((a) => ({
        ...a,
        id: newAlertId(),
        sourceNodeId: nodeId,
        sourceTitle: titleOf(nodeId).slice(0, 140),
        targetTitle: titleOf(a.targetNodeId).slice(0, 140),
        createdAt,
        ...(authorName ? { authorName: authorName.slice(0, 80) } : {}),
      }));
    useImpactStore.getState().replaceForSource(nodeId, entries);

    if (entries.length === 0) {
      if (!auto) {
        toast({ message: "Todo cuadra: ninguna tarjeta conectada quedó descuadrada con este cambio.", tone: "success" });
      }
      return;
    }
    if (!auto) useImpactStore.getState().setPanelOpen(true, entries[0].id);
  } finally {
    useImpactStore.getState().setChecking(nodeId, false);
  }
}

/** Copia el aviso corto al portapapeles (listo para WhatsApp o la sala de voz). */
export async function copyAlertNotice(alert: ImpactAlertEntry): Promise<void> {
  const text = alertShareText(alert);
  try {
    await navigator.clipboard.writeText(text);
    toast({ message: "Aviso copiado: pégalo en WhatsApp o léelo en la sala de voz.", tone: "success" });
  } catch {
    // Portapapeles bloqueado (HTTP, permisos): se muestra para copiarlo a mano.
    toast({ message: text, durationMs: 12_000 });
  }
}

/** «Marcar resuelto» con «Deshacer» (la alerta vuelve también para el equipo). */
export function resolveAlertWithUndo(alert: ImpactAlertEntry): void {
  useImpactStore.getState().resolveAlert(alert.id);
  toast({
    message: `Aviso sobre «${alert.targetTitle.slice(0, 40)}» marcado como resuelto.`,
    action: { label: "Deshacer", onAction: () => useImpactStore.getState().upsertAlert(alert) },
  });
}
