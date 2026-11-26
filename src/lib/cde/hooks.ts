"use client";

// ============================================================================
// ANDROS — LECTURAS DERIVADAS DEL CDE PARA LA INTERFAZ (sin estado propio)
//   · `useUnifiedAlerts`: descuadres + reportes a @IA, sin duplicados.
//   · `useInbox`: bandeja interna (menciones a ti o a tu área en el chat y en
//     fichas, y Fichas de Resolución en Rojo de tu área o asignadas a ti).
//   · `useResolutionCounts`: semáforo Rojo / Verde del lienzo.
// ============================================================================

import { useMemo } from "react";
import { useCdeStore } from "@/store/useCdeStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useImpactStore } from "@/store/useImpactStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import type { EngineeringNodeData } from "@/types/workspace";
import { areaKey, countPeopleByArea } from "./areas";
import { unifyAlerts, type UnifiedAlert } from "./alerts";
import { reportAlertsOf } from "./chatModel";
import { mentionsTarget, parseMentions, type MentionDirectory } from "./mentions";
import { countResolutions, listResolutions, trackedAlertIds } from "./resolution";

export function useMyUserId(): string {
  return useCloudStore((s) => s.user?.id ?? "local");
}

/** Tu área nominal en el espacio abierto (o `null`). */
export function useMyArea(): string | null {
  const uid = useMyUserId();
  return useCdeStore((s) => s.people.find((p) => p.userId === uid)?.area || null);
}

export function useMentionDirectory(): MentionDirectory & { areaCounts: Record<string, number> } {
  const areas = useCdeStore((s) => s.areas);
  const people = useCdeStore((s) => s.people);
  return useMemo(
    () => ({
      areas,
      users: people.map((p) => ({ id: p.userId, username: p.username, name: p.name, area: p.area })),
      areaCounts: countPeopleByArea(people, areas),
    }),
    [areas, people]
  );
}

export function useUnifiedAlerts(): UnifiedAlert[] {
  const impact = useImpactStore((s) => s.alerts);
  const messages = useCdeStore((s) => s.messages);
  const hidden = useCdeStore((s) => s.hiddenIds);
  const dismissed = useCdeStore((s) => s.dismissedAlertIds);
  const nodes = useWorkspaceStore((s) => s.nodes);
  return useMemo(() => {
    const reports = reportAlertsOf(messages.filter((m) => !hidden.includes(m.id)));
    return unifyAlerts({
      impact,
      reports,
      tracked: trackedAlertIds(nodes),
      dismissed: new Set(dismissed),
      validNodeIds: new Set(nodes.map((n) => n.id)),
    });
  }, [impact, messages, hidden, dismissed, nodes]);
}

export function useResolutionCounts(): { pending: number; done: number } {
  const nodes = useWorkspaceStore((s) => s.nodes);
  return useMemo(() => countResolutions(nodes), [nodes]);
}

// ----------------------------------------------------------------------------
// Bandeja interna
// ----------------------------------------------------------------------------

export interface InboxItem {
  id: string;
  kind: "chat" | "card" | "resolution";
  title: string;
  body: string;
  /** ms */
  at: number;
  nodeId: string | null;
  unread: boolean;
}

/** Texto libre de una tarjeta donde alguien pudo escribir @Área o @usuario. */
export function nodeMentionText(node: EngineeringNodeData): string {
  if (node.type === "sketch-note-node") {
    const d = node.sketchNoteData;
    return [...d.textBlocks.map((b) => b.text), ...d.checklistItems.map((c) => c.text)].join("\n");
  }
  if (node.type === "form-sheet-node" && !node.formSheetData.resolution) {
    return node.formSheetData.fields.map((f) => (typeof f.value === "string" ? f.value : "")).join("\n");
  }
  return "";
}

export function useInbox(): InboxItem[] {
  const uid = useMyUserId();
  const myArea = useMyArea();
  const messages = useCdeStore((s) => s.messages);
  const hidden = useCdeStore((s) => s.hiddenIds);
  const lastReadAt = useCdeStore((s) => s.lastReadAt);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const dir = useMentionDirectory();
  return useMemo(() => {
    const me = { userId: uid, area: myArea };
    const items: InboxItem[] = [];
    for (const m of messages) {
      if (hidden.includes(m.id) || !mentionsTarget(m.mentions, me, m.authorId)) continue;
      const at = Date.parse(m.createdAt) || 0;
      items.push({
        id: `chat-${m.id}`,
        kind: "chat",
        title: m.kind === "ai-alert" ? `Alerta de la IA (pedida por ${m.authorName})` : `${m.authorName}${m.authorArea ? ` · @${m.authorArea}` : ""}`,
        body: m.body,
        at,
        nodeId: m.linkedNodeId,
        unread: at > lastReadAt,
      });
    }
    for (const node of nodes) {
      const text = nodeMentionText(node);
      if (!text.includes("@")) continue;
      const { mentions } = parseMentions(text, dir);
      if (!mentionsTarget(mentions, me)) continue;
      items.push({ id: `card-${node.id}`, kind: "card", title: `Mención en «${node.title}»`, body: text.split("\n").find((l) => l.includes("@")) ?? "", at: 0, nodeId: node.id, unread: false });
    }
    for (const r of listResolutions(nodes)) {
      if (r.meta.status !== "pending") continue;
      const mine = r.meta.assigneeId === uid || (myArea && r.meta.area && areaKey(r.meta.area) === areaKey(myArea));
      if (!mine) continue;
      items.push({
        id: `res-${r.nodeId}`,
        kind: "resolution",
        title: `${r.meta.code} · Rojo (Pendiente)${r.meta.area ? ` · @${r.meta.area}` : ""}`,
        body: r.meta.description,
        at: Date.parse(r.meta.createdAt) || 0,
        nodeId: r.nodeId,
        unread: false,
      });
    }
    return items.sort((a, b) => Number(b.unread) - Number(a.unread) || b.at - a.at);
  }, [uid, myArea, messages, hidden, lastReadAt, nodes, dir]);
}

/** Mensajes nuevos del chat (de otras personas) desde la última lectura. */
export function useUnreadChatCount(): number {
  const uid = useMyUserId();
  return useCdeStore((s) =>
    s.messages.filter((m) => m.authorId !== uid && !s.hiddenIds.includes(m.id) && (Date.parse(m.createdAt) || 0) > s.lastReadAt).length
  );
}
