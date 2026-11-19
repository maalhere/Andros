import { create } from "zustand";
import type { OracleDocument, OracleEngine, OracleIssueCode, OracleMode } from "@/types/oracle";

// ============================================================================
// ANDROS — ESTADO DEL ESTUDIO DEL ORÁCULO (chat + documento en vivo)
//
// Vive en memoria (no en el lienzo ni en la nube): cerrar el Estudio y volver
// a abrirlo conserva la conversación y el borrador. El documento solo pasa al
// lienzo cuando el usuario pulsa "Añadir al lienzo".
// ============================================================================

export interface StudioMessage {
  id: string;
  role: "user" | "oracle";
  text: string;
  mode: OracleMode;
  engine?: OracleEngine;
  model?: string;
  /** Problema de la IA externa (clave, cuota, saturación…). */
  issue?: OracleIssueCode;
  /** Modo lienzo: lo que se aplicó en vivo. */
  log?: string[];
  /** Modo documento: la respuesta actualizó el documento. */
  updatedDocument?: boolean;
}

export type StudioEditorView = "edit" | "preview";
export type StudioMobilePane = "chat" | "document";

/** Valores especiales del selector "Referencia". */
export const STUDIO_LINK_AUTO = "__auto__";
export const STUDIO_LINK_NONE = "__none__";

const EMPTY_DOCUMENT: OracleDocument = { title: "Documento sin título", markdown: "" };

interface OracleStudioState {
  messages: StudioMessage[];
  document: OracleDocument;
  /** Versión anterior a la última edición de la IA (para "Deshacer"). */
  previousDocument: OracleDocument | null;
  chatMode: OracleMode;
  editorView: StudioEditorView;
  mobilePane: StudioMobilePane;
  linkChoice: string;
  isThinking: boolean;

  addMessage: (message: Omit<StudioMessage, "id">) => void;
  /** La IA reescribió el documento: se guarda la versión anterior. */
  applyAiDocument: (doc: OracleDocument) => void;
  undoAiDocument: () => void;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  newDocument: () => void;
  clearConversation: () => void;
  setChatMode: (mode: OracleMode) => void;
  setEditorView: (view: StudioEditorView) => void;
  setMobilePane: (pane: StudioMobilePane) => void;
  setLinkChoice: (choice: string) => void;
  setThinking: (thinking: boolean) => void;
}

let messageCounter = 0;

export const useOracleStudioStore = create<OracleStudioState>((set) => ({
  messages: [],
  document: EMPTY_DOCUMENT,
  previousDocument: null,
  chatMode: "document",
  editorView: "preview",
  mobilePane: "chat",
  linkChoice: STUDIO_LINK_AUTO,
  isThinking: false,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, { ...message, id: `msg-${Date.now()}-${(messageCounter += 1)}` }].slice(-80),
    })),

  applyAiDocument: (doc) =>
    set((state) => ({
      previousDocument: state.document.markdown.trim() ? state.document : null,
      document: doc,
      editorView: "preview",
    })),

  undoAiDocument: () =>
    set((state) =>
      state.previousDocument ? { document: state.previousDocument, previousDocument: null } : {}
    ),

  setTitle: (title) => set((state) => ({ document: { ...state.document, title } })),

  setMarkdown: (markdown) => set((state) => ({ document: { ...state.document, markdown } })),

  newDocument: () =>
    set((state) => ({
      previousDocument: state.document.markdown.trim() ? state.document : null,
      document: EMPTY_DOCUMENT,
      editorView: "edit",
    })),

  clearConversation: () => set({ messages: [] }),

  setChatMode: (chatMode) => set({ chatMode }),

  setEditorView: (editorView) => set({ editorView }),

  setMobilePane: (mobilePane) => set({ mobilePane }),

  setLinkChoice: (linkChoice) => set({ linkChoice }),

  setThinking: (isThinking) => set({ isThinking }),
}));
