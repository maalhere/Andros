import { create } from "zustand";
import type { ChatMessage } from "@/lib/cde/chatModel";
import type { CdePerson } from "@/lib/cde/repository";
import { sortChat } from "@/lib/cde/chatModel";

// ============================================================================
// ANDROS — ENTORNO DE DATOS COMÚN DEL ESPACIO ABIERTO (Sprint 18)
// Áreas nominales, personas con su área y chat del lienzo. Lo escribe
// `useCdeSync` (lectura de Supabase con tu RLS; cada aviso `chat:new` de la
// sala solo provoca otra lectura) y lo leen el chat, la bandeja interna, la
// alerta unificada y las Fichas de Resolución.
// Preferencias de este dispositivo (último leído, alertas descartadas) van en
// localStorage, envueltas en try/catch.
// ============================================================================

export type CdeStatus = "idle" | "loading" | "ready" | "setup-missing" | "error";
export type ChatTab = "chat" | "inbox";

interface CdeState {
  workspaceId: string | null;
  ownerId: string | null;
  areas: string[];
  people: CdePerson[];
  spaceStatus: CdeStatus;

  messages: ChatMessage[];
  chatStatus: CdeStatus;
  chatError: string | null;
  /** Mensajes ocultos mientras dura su «Deshacer». */
  hiddenIds: string[];

  panelOpen: boolean;
  tab: ChatTab;
  /** Marca (ms) del último mensaje leído en este espacio (este dispositivo). */
  lastReadAt: number;
  /** Alertas descartadas en este dispositivo (ids de origen). */
  dismissedAlertIds: string[];
  /** Hay una evaluación de @IA en curso. */
  evaluating: boolean;

  hydrateSpace: (workspaceId: string | null, data: { ownerId: string | null; areas: string[]; people: CdePerson[] }) => void;
  setSpaceStatus: (status: CdeStatus) => void;
  setAreasLocal: (areas: string[], people?: CdePerson[]) => void;
  hydrateChat: (workspaceId: string | null, messages: ChatMessage[]) => void;
  setChatStatus: (status: CdeStatus, error?: string | null) => void;
  upsertMessage: (message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  hideMessage: (id: string, hidden: boolean) => void;
  openPanel: (tab?: ChatTab) => void;
  closePanel: () => void;
  setTab: (tab: ChatTab) => void;
  markRead: () => void;
  dismissAlerts: (ids: string[], dismissed: boolean) => void;
  setEvaluating: (value: boolean) => void;
}

const READ_KEY = "andros:cde-read:";
const DISMISS_KEY = "andros:cde-dismissed:";

function readNumber(key: string): number {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function readList(key: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: dura solo esta visita.
  }
}

const scope = (workspaceId: string | null) => workspaceId ?? "local";

export const useCdeStore = create<CdeState>((set, get) => ({
  workspaceId: null,
  ownerId: null,
  areas: [],
  people: [],
  spaceStatus: "idle",
  messages: [],
  chatStatus: "idle",
  chatError: null,
  hiddenIds: [],
  panelOpen: false,
  tab: "chat",
  lastReadAt: 0,
  dismissedAlertIds: [],
  evaluating: false,

  hydrateSpace: (workspaceId, data) =>
    set((state) => ({
      workspaceId,
      ownerId: data.ownerId,
      areas: data.areas,
      people: data.people,
      ...(state.workspaceId !== workspaceId
        ? {
            messages: [],
            hiddenIds: [],
            lastReadAt: typeof window === "undefined" ? 0 : readNumber(READ_KEY + scope(workspaceId)),
            dismissedAlertIds: typeof window === "undefined" ? [] : readList(DISMISS_KEY + scope(workspaceId)),
          }
        : {}),
    })),
  setSpaceStatus: (spaceStatus) => set({ spaceStatus }),
  setAreasLocal: (areas, people) => set((state) => ({ areas, people: people ?? state.people })),
  hydrateChat: (workspaceId, messages) =>
    set((state) => (state.workspaceId === workspaceId ? { messages: sortChat(messages.filter((m) => m.workspaceId === workspaceId)) } : {})),
  setChatStatus: (chatStatus, error) =>
    set((state) => ({ chatStatus, chatError: error === undefined ? state.chatError : error })),
  upsertMessage: (message) =>
    set((state) => {
      if (message.workspaceId !== state.workspaceId) return {};
      return { messages: sortChat([...state.messages.filter((m) => m.id !== message.id), message]) };
    }),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id), hiddenIds: state.hiddenIds.filter((x) => x !== id) })),
  hideMessage: (id, hidden) =>
    set((state) => ({ hiddenIds: hidden ? [...new Set([...state.hiddenIds, id])] : state.hiddenIds.filter((x) => x !== id) })),
  openPanel: (tab) => set((state) => ({ panelOpen: true, tab: tab ?? state.tab })),
  closePanel: () => set({ panelOpen: false }),
  setTab: (tab) => set({ tab }),
  markRead: () => {
    const { messages, workspaceId, lastReadAt } = get();
    const latest = messages.reduce((max, m) => Math.max(max, Date.parse(m.createdAt) || 0), 0);
    if (latest <= lastReadAt) return;
    set({ lastReadAt: latest });
    write(READ_KEY + scope(workspaceId), String(latest));
  },
  dismissAlerts: (ids, dismissed) => {
    const { workspaceId, dismissedAlertIds } = get();
    const next = dismissed
      ? [...new Set([...dismissedAlertIds, ...ids])].slice(-200)
      : dismissedAlertIds.filter((x) => !ids.includes(x));
    set({ dismissedAlertIds: next });
    write(DISMISS_KEY + scope(workspaceId), JSON.stringify(next));
  },
  setEvaluating: (evaluating) => set({ evaluating }),
}));
