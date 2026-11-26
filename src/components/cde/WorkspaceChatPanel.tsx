"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, ClipboardCheck, Inbox, Link2, Loader2, MessagesSquare, Send, Trash2, TriangleAlert, X } from "lucide-react";
import { useCdeStore } from "@/store/useCdeStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useCommentsStore } from "@/store/useCommentsStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceRole } from "@/lib/access/workspaceRole";
import { ROLE_LABELS, canCreateComment, canEditCanvas } from "@/lib/access/permissions";
import { relativeTimeEs } from "@/lib/comments/commentModel";
import { CHAT_MAX_CHARS, type ChatMessage } from "@/lib/cde/chatModel";
import { CDE_SETUP_HINT } from "@/lib/cde/repository";
import { deleteChatMessageWithUndo, sendChatMessage } from "@/lib/cde/chatActions";
import { activeMentionQuery, applyMentionCompletion, suggestMentions, type MentionSuggestion } from "@/lib/cde/mentions";
import { useInbox, useMentionDirectory, useMyArea, useMyUserId, useUnreadChatCount } from "@/lib/cde/hooks";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { springOrInstant } from "@/lib/motion";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { ProfileAvatar, SetupNotice } from "@/components/social/SocialDialog";
import { Kbd, useModKey } from "@/components/shared/Kbd";
import { AreaBadge, MentionText } from "./CdeBits";

// ============================================================================
// ANDROS — CHAT INTEGRADO EN EL LIENZO (Sprint 18)
//   · Escritorio: panel lateral deslizable (el lienzo sigue usable).
//   · Teléfono: hoja inferior con fondo atenuado.
//   · Pestañas «Chat» y «Bandeja» (menciones a ti o a tu área, fichas en Rojo).
//   · «@» sugiere áreas (con su número de personas), personas y @IA.
//   · Dueño, Editor y Comentarista escriben; Solo lectura solo lee.
//   · En vivo: `chat:new` solo pide releer de Supabase (regla 17B).
// ============================================================================

const ICON_BUTTON =
  "w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro";

/** Las sugerencias de «@» están abiertas: Escape las cierra a ellas, no al panel. */
let suggestionsOpen = false;

export function openWorkspaceChat(tab?: "chat" | "inbox"): void {
  useCommentsStore.getState().closeDrawer();
  useCdeStore.getState().openPanel(tab);
}

/** Botón de la barra superior (escritorio y teléfono) con los mensajes sin leer. */
export const ChatButton: React.FC = () => {
  const unread = useUnreadChatCount();
  const inbox = useInbox().filter((i) => i.unread).length;
  const badge = Math.max(unread, inbox);
  return (
    <button
      type="button"
      onClick={() => openWorkspaceChat(inbox > 0 ? "inbox" : "chat")}
      aria-label={badge > 0 ? `Chat del lienzo (${badge} sin leer)` : "Chat del lienzo"}
      title="Chat del lienzo"
      className="relative w-11 h-11 md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center"
    >
      <MessagesSquare className="w-4 h-4" aria-hidden="true" />
      {badge > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-andros-accent-fill text-white text-[10px] font-mono tabular-nums flex items-center justify-center"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
};

export const WorkspaceChatPanel: React.FC = () => {
  const open = useCdeStore((s) => s.panelOpen);
  const systemReduced = useReducedMotion();
  const reduced = useSettingsStore((s) => s.animations) === "reduced" || Boolean(systemReduced);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>{open && <ChatPanel key="cde-chat" reduced={reduced} />}</AnimatePresence>,
    document.body
  );
};

const ChatPanel: React.FC<{ reduced: boolean }> = ({ reduced }) => {
  const titleId = useId();
  const tab = useCdeStore((s) => s.tab);
  const status = useCdeStore((s) => s.chatStatus);
  const chatError = useCdeStore((s) => s.chatError);
  const areas = useCdeStore((s) => s.areas);
  const evaluating = useCdeStore((s) => s.evaluating);
  const user = useCloudStore((s) => s.user);
  const role = useWorkspaceRole();
  const dir = useMentionDirectory();
  const inbox = useInbox();
  const unreadInbox = inbox.filter((i) => i.unread).length;
  const close = () => useCdeStore.getState().closePanel();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || suggestionsOpen) return;
      e.stopPropagation();
      useCdeStore.getState().closePanel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const canWrite = canCreateComment(role) && status === "ready";

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.15 }}
        onPointerDown={close}
        aria-hidden="true"
        className="md:hidden fixed inset-0 z-[80] bg-black/50"
      />
      <motion.aside
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        data-clarity-mask="true"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24, y: 0 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        transition={springOrInstant(reduced)}
        className="fixed z-[81] inset-x-0 bottom-0 max-h-[88vh] h-[88vh] rounded-t-3xl md:h-auto md:inset-x-auto md:right-4 md:top-24 md:bottom-24 md:max-h-none md:w-[400px] md:rounded-2xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark flex flex-col pb-[env(safe-area-inset-bottom)]"
      >
        {/* Cabecera */}
        <div className="px-4 pt-4 pb-3 border-b border-andros-border space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-semibold text-andros-primary flex items-center gap-2">
                <MessagesSquare className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
                Chat del lienzo
              </h2>
              <p className="mt-0.5 text-[11px] text-andros-muted">
                Tu permiso: {ROLE_LABELS[role]}
                {role === "viewer" ? " · puedes leer el chat" : ""}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Cerrar el chat" className={ICON_BUTTON}>
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          {areas.length > 0 && (
            <ul aria-label="Áreas del espacio" className="flex flex-wrap gap-1">
              {areas.map((a) => (
                <li key={a}>
                  <AreaBadge area={a} count={dir.areaCounts[a] ?? 0} />
                </li>
              ))}
            </ul>
          )}
          <div role="tablist" aria-label="Secciones del chat" className="flex gap-1 p-1 rounded-xl bg-andros-canvas border border-andros-border">
            {(["chat", "inbox"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => useCdeStore.getState().setTab(t)}
                className={`flex-1 min-h-11 md:min-h-8 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro ${
                  tab === t ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted hover:text-andros-primary"
                }`}
              >
                {t === "chat" ? <MessagesSquare className="w-3.5 h-3.5" aria-hidden="true" /> : <Inbox className="w-3.5 h-3.5" aria-hidden="true" />}
                {t === "chat" ? "Chat" : "Bandeja"}
                {t === "inbox" && unreadInbox > 0 && (
                  <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-andros-accent-fill text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                    {unreadInbox}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {!user ? (
          <p className="px-4 py-4 text-xs text-andros-muted">Inicia sesión y abre un espacio en la nube para conversar con tu equipo.</p>
        ) : status === "idle" ? (
          <p className="px-4 py-4 text-xs text-andros-muted">Abre un espacio en la nube para ver su chat.</p>
        ) : status === "setup-missing" ? (
          <div className="px-4 py-4">
            <SetupNotice text={CDE_SETUP_HINT} />
          </div>
        ) : status === "error" ? (
          <p role="alert" className="px-4 py-4 text-xs text-andros-danger">
            {chatError ?? "No se pudo leer el chat."}
          </p>
        ) : tab === "inbox" ? (
          <InboxList />
        ) : (
          <>
            <MessageList />
            {evaluating && (
              <p role="status" className="px-4 py-2 border-t border-andros-border flex items-center gap-2 text-[11px] text-andros-muted">
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                La IA está evaluando el reporte…
              </p>
            )}
            {canWrite ? (
              <Composer canIncident={canEditCanvas(role)} />
            ) : (
              status === "ready" && (
                <p className="px-4 py-3 border-t border-andros-border text-[11px] text-andros-muted">
                  Con permiso de Solo lectura puedes leer el chat, pero no escribir.
                </p>
              )
            )}
          </>
        )}
      </motion.aside>
    </>
  );
};

const MessageList: React.FC = () => {
  const messages = useCdeStore((s) => s.messages);
  const hidden = useCdeStore((s) => s.hiddenIds);
  const status = useCdeStore((s) => s.chatStatus);
  const listRef = useRef<HTMLOListElement>(null);
  const visible = useMemo(() => messages.filter((m) => !hidden.includes(m.id)), [messages, hidden]);

  // Al abrir y con cada mensaje nuevo: al final de la lista y marcado como leído.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    useCdeStore.getState().markRead();
  }, [visible.length]);

  if (status === "loading" && visible.length === 0) {
    return (
      <p className="flex-1 px-4 py-4 flex items-start gap-2 text-xs text-andros-muted">
        <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
        Cargando el chat…
      </p>
    );
  }
  return (
    <ol ref={listRef} aria-label="Mensajes" aria-live="polite" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
      {visible.length === 0 && (
        <li className="text-xs leading-relaxed text-andros-muted">
          Aún no hay mensajes. Escribe @ para avisar a un área o a una persona, o @IA para reportar un cambio o problema.
        </li>
      )}
      {visible.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
    </ol>
  );
};

const MessageItem: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const uid = useMyUserId();
  const myArea = useMyArea();
  const role = useWorkspaceRole();
  const dir = useMentionDirectory();
  const linkedTitle = useWorkspaceStore((s) => (message.linkedNodeId ? s.nodes.find((n) => n.id === message.linkedNodeId)?.title ?? null : null));
  const canDelete = message.authorId === uid || role === "owner";
  const isAlert = message.kind === "ai-alert";

  return (
    <li className={`rounded-xl border p-2.5 ${isAlert ? "border-andros-warning/50 bg-andros-warning/5" : "border-andros-border bg-andros-card"}`}>
      <div className="flex items-start gap-2.5">
        {isAlert ? (
          <span aria-hidden="true" className="w-7 h-7 shrink-0 rounded-full border border-andros-warning/50 flex items-center justify-center text-andros-warning">
            <Bot className="w-4 h-4" />
          </span>
        ) : (
          <ProfileAvatar size="sm" profile={{ id: message.authorId, username: null, fullName: message.authorName, avatarUrl: null }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-andros-muted">
            <span className="font-medium text-andros-primary">{isAlert ? "IA · Alerta unificada" : message.authorName}</span>
            {message.authorArea && !isAlert && <AreaBadge area={message.authorArea} />}
            <time dateTime={message.createdAt}>{relativeTimeEs(message.createdAt)}</time>
          </p>
          {isAlert && <p className="text-[11px] text-andros-muted">Reportado por {message.authorName}{message.alert?.engine === "local" ? " · evaluado sin IA" : ""}</p>}
          <p className="mt-1 text-sm leading-relaxed text-andros-primary whitespace-pre-wrap break-words">
            {isAlert && <TriangleAlert className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-andros-warning" aria-hidden="true" />}
            <MentionText text={message.body} dir={dir} myUserId={uid} myArea={myArea} />
          </p>
          {message.linkedNodeId && (
            <button
              type="button"
              onClick={() => linkedTitle && focusNodeOnScreen(message.linkedNodeId as string)}
              disabled={!linkedTitle}
              className="mt-1 max-w-full min-h-11 md:min-h-0 flex items-center gap-1 text-[11px] text-andros-accent-ink hover:underline underline-offset-2 disabled:text-andros-muted disabled:no-underline"
            >
              <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{linkedTitle ? `En «${linkedTitle}»` : "Tarjeta eliminada"}</span>
            </button>
          )}
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={() => deleteChatMessageWithUndo(message)}
            aria-label="Borrar mensaje"
            title="Borrar mensaje"
            className="w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-danger hover:bg-andros-danger/10 active:scale-[0.96] spring-micro"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
};

const InboxList: React.FC = () => {
  const items = useInbox();
  const myArea = useMyArea();
  useEffect(() => {
    useCdeStore.getState().markRead();
  }, []);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
      <p className="text-[11px] text-andros-muted">
        Menciones a ti{myArea ? ` y a @${myArea}` : ""}, en el chat y en las fichas, y Fichas de Resolución en Rojo que te tocan.
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-andros-muted">Tu bandeja está al día.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  if (item.nodeId) focusNodeOnScreen(item.nodeId);
                  else useCdeStore.getState().setTab("chat");
                }}
                className={`w-full text-left rounded-xl border p-2.5 hover:border-andros-border-active active:scale-[0.98] spring-micro ${
                  item.unread ? "border-andros-accent/50 bg-andros-accent/5" : "border-andros-border bg-andros-card"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-andros-primary">
                  {item.kind === "resolution" ? (
                    <ClipboardCheck className="w-3.5 h-3.5 text-andros-danger" aria-hidden="true" />
                  ) : (
                    <Inbox className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
                  )}
                  <span className="truncate">{item.title}</span>
                  {item.unread && <span className="ml-auto shrink-0 text-[10px] text-andros-accent-ink">Nuevo</span>}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-andros-primary line-clamp-3">{item.body}</span>
                {item.at > 0 && <span className="mt-1 block text-[11px] text-andros-muted">{relativeTimeEs(new Date(item.at).toISOString())}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Composer: React.FC<{ canIncident: boolean }> = ({ canIncident }) => {
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [anchor, setAnchor] = useState(true);
  const [incident, setIncident] = useState(false);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);
  const selectedTitle = useWorkspaceStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId)?.title ?? null);
  const dir = useMentionDirectory();
  const guard = useSubmitGuard();
  const modKey = useModKey();
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const query = activeMentionQuery(body, caret);
  const suggestions: MentionSuggestion[] = query && query.start !== dismissedAt ? suggestMentions(query.query, dir) : [];
  const showSuggestions = suggestions.length > 0;
  const tooLong = body.length > CHAT_MAX_CHARS;
  const trimmed = body.trim();

  useEffect(() => {
    suggestionsOpen = showSuggestions;
    return () => {
      suggestionsOpen = false;
    };
  }, [showSuggestions]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const pick = (s: MentionSuggestion) => {
    if (!query) return;
    const next = applyMentionCompletion(body, query.start, caret, s.insert);
    setBody(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = () =>
    guard.run(async () => {
      if (!trimmed || tooLong) return;
      const ok = await sendChatMessage(trimmed, {
        linkedNodeId: anchor && selectedNodeId ? selectedNodeId : null,
        incident: canIncident && incident,
      });
      if (ok) {
        setBody("");
        setCaret(0);
        setIncident(false);
      }
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative px-4 pt-3 pb-4 border-t border-andros-border space-y-2"
    >
      {showSuggestions && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Sugerencias de mención"
          className="absolute left-4 right-4 bottom-full mb-1 max-h-60 overflow-y-auto p-1 rounded-xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.kind}-${s.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`min-h-11 md:min-h-9 px-2.5 rounded-lg flex items-center gap-2 cursor-pointer text-xs ${
                i === active ? "bg-andros-border/50" : "hover:bg-andros-border/30"
              }`}
            >
              {s.kind === "area" ? (
                <AreaBadge area={s.label.slice(1)} />
              ) : s.kind === "ai" ? (
                <span className="flex items-center gap-1 font-medium text-andros-accent-ink">
                  <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                  {s.label}
                </span>
              ) : (
                <span className="font-medium text-andros-primary">{s.label}</span>
              )}
              <span className={`ml-auto truncate text-andros-muted ${s.kind === "area" ? "font-mono tabular-nums" : ""}`}>{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={inputId} className="sr-only">
        Escribe un mensaje para el equipo
      </label>
      <textarea
        id={inputId}
        ref={textareaRef}
        value={body}
        rows={3}
        maxLength={CHAT_MAX_CHARS + 200}
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls={showSuggestions ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showSuggestions ? `${listId}-${Math.min(active, suggestions.length - 1)}` : undefined}
        aria-describedby={hintId}
        aria-invalid={tooLong || undefined}
        placeholder="Escribe… usa @Área, @usuario o @IA"
        onChange={(e) => {
          setBody(e.currentTarget.value);
          setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          setActive(0);
          setDismissedAt(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (showSuggestions) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (i + delta + suggestions.length) % suggestions.length);
              return;
            }
            if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
              e.preventDefault();
              pick(suggestions[Math.min(active, suggestions.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDismissedAt(query?.start ?? null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="w-full resize-none px-3 py-2 rounded-lg bg-andros-canvas border border-andros-border text-sm text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-border-active"
      />
      <p id={hintId} className="sr-only">
        Escribe arroba para mencionar un área, una persona o a la IA. Flechas para elegir y Enter para insertar.
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {selectedNodeId && selectedTitle && (
          <label className="min-w-0 flex items-center gap-2 min-h-11 md:min-h-0 text-[11px] text-andros-muted cursor-pointer">
            <input
              type="checkbox"
              checked={anchor}
              onChange={(e) => setAnchor(e.currentTarget.checked)}
              className="w-4 h-4 accent-[var(--accent-primary)]"
            />
            <span className="truncate max-w-[12rem]">
              Enlazar «<span className="text-andros-primary">{selectedTitle}</span>»
            </span>
          </label>
        )}
        {canIncident && (
          <label className="flex items-center gap-2 min-h-11 md:min-h-0 text-[11px] text-andros-muted cursor-pointer">
            <input
              type="checkbox"
              checked={incident}
              onChange={(e) => setIncident(e.currentTarget.checked)}
              className="w-4 h-4 accent-[var(--accent-primary)]"
            />
            Marcar como incidencia (crea Ficha de Resolución)
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-mono tabular-nums text-[11px] ${tooLong ? "text-andros-danger" : "text-andros-muted"}`} aria-live="polite">
          {body.length}/{CHAT_MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={!trimmed || tooLong || guard.pending}
          className="ml-auto h-11 md:h-9 px-3 rounded-lg bg-andros-accent-fill text-white text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none"
        >
          {guard.pending ? (
            <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4" aria-hidden="true" />
          )}
          Enviar
          <span className="hidden md:inline-flex">
            <Kbd>{modKey} ↵</Kbd>
          </span>
        </button>
      </div>
      {tooLong && (
        <p role="alert" className="text-[11px] text-andros-danger">
          El mensaje supera los {CHAT_MAX_CHARS} caracteres.
        </p>
      )}
    </form>
  );
};
