"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, MessageSquare, RotateCcw, Send, Trash2, X } from "lucide-react";
import { useCommentsStore, useOpenCommentTotal } from "@/store/useCommentsStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceRole } from "@/lib/access/workspaceRole";
import {
  ROLE_LABELS,
  canCreateComment,
  canModerateComment,
  canReadComments,
} from "@/lib/access/permissions";
import { COMMENT_MAX_CHARS, relativeTimeEs, type WorkspaceComment } from "@/lib/comments/commentModel";
import { COMMENTS_SETUP_HINT } from "@/lib/comments/repository";
import { addComment, deleteCommentWithUndo, setCommentResolved } from "@/lib/comments/actions";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { springOrInstant } from "@/lib/motion";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { ProfileAvatar, SetupNotice } from "@/components/social/SocialDialog";
import { Kbd, useModKey } from "@/components/shared/Kbd";

// ============================================================================
// ANDROS — CAJÓN DE COMENTARIOS DEL TABLERO (Sprint 16)
//   · Escritorio: panel lateral derecho (no bloquea el lienzo).
//   · Teléfono: hoja inferior con fondo atenuado.
//   · Dueño, Editor y Comentarista escriben; Solo lectura solo lee.
//   · Dueño, Editor y el autor resuelven o borran (borrar con «Deshacer»).
//   · Se sincroniza en vivo con la sala (comment:upsert / comment:resolve).
// ============================================================================

const ICON_BUTTON =
  "w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro";

/** Botón de la barra superior (escritorio) con el número de comentarios abiertos. */
export const CommentsButton: React.FC = () => {
  const workspaceId = useCloudStore((s) => s.workspaceId);
  const user = useCloudStore((s) => s.user);
  const open = useOpenCommentTotal();
  if (!user || !workspaceId) return null;
  return (
    <button
      type="button"
      onClick={() => useCommentsStore.getState().openDrawer(null)}
      aria-label={open > 0 ? `Comentarios (${open} abiertos)` : "Comentarios"}
      title="Comentarios del tablero"
      className="relative hidden md:flex w-9 h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro items-center justify-center"
    >
      <MessageSquare className="w-4 h-4" aria-hidden="true" />
      {open > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-andros-accent-fill text-white text-[10px] font-mono tabular-nums flex items-center justify-center"
        >
          {open > 99 ? "99+" : open}
        </span>
      )}
    </button>
  );
};

export const CommentsDrawer: React.FC = () => {
  const open = useCommentsStore((s) => s.drawerOpen);
  const systemReduced = useReducedMotion();
  const reduced = useSettingsStore((s) => s.animations) === "reduced" || Boolean(systemReduced);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>{open && <DrawerPanel key="comments-drawer" reduced={reduced} />}</AnimatePresence>,
    document.body
  );
};

const DrawerPanel: React.FC<{ reduced: boolean }> = ({ reduced }) => {
  const titleId = useId();
  const comments = useCommentsStore((s) => s.comments);
  const hiddenIds = useCommentsStore((s) => s.hiddenIds);
  const status = useCommentsStore((s) => s.status);
  const errorMessage = useCommentsStore((s) => s.errorMessage);
  const focusNodeId = useCommentsStore((s) => s.focusNodeId);
  const user = useCloudStore((s) => s.user);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const role = useWorkspaceRole();
  const [showResolved, setShowResolved] = useState(false);

  const close = () => useCommentsStore.getState().closeDrawer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      useCommentsStore.getState().closeDrawer();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title || "Sin título"])), [nodes]);
  const focusTitle = focusNodeId ? titles.get(focusNodeId) ?? "Tarjeta eliminada" : null;

  const visible = comments.filter(
    (c) => !hiddenIds.includes(c.id) && (!focusNodeId || c.nodeId === focusNodeId)
  );
  const openList = visible.filter((c) => !c.resolved);
  const resolvedList = visible.filter((c) => c.resolved);
  const canWrite = canCreateComment(role) && status === "ready";

  return (
    <>
      {/* Fondo atenuado solo en el teléfono (en escritorio el lienzo sigue usable) */}
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
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={springOrInstant(reduced)}
        className="fixed z-[81] inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl md:inset-x-auto md:right-4 md:top-24 md:bottom-24 md:max-h-none md:w-[380px] md:rounded-2xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark flex flex-col pb-[env(safe-area-inset-bottom)]"
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b border-andros-border">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-andros-primary flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
              Comentarios
              {status === "ready" && (
                <span className="font-mono tabular-nums text-xs font-normal text-andros-muted">{openList.length}</span>
              )}
            </h2>
            <p className="mt-0.5 text-[11px] text-andros-muted">
              Tu permiso: {ROLE_LABELS[role]}
              {role === "viewer" ? " · puedes leer los comentarios" : ""}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar comentarios" className={ICON_BUTTON}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Filtro por tarjeta */}
        {focusNodeId && (
          <div className="px-4 pt-3 flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate text-andros-muted">
              Tarjeta: <span className="font-medium text-andros-primary">{focusTitle}</span>
            </span>
            <button
              type="button"
              onClick={() => useCommentsStore.getState().setFocusNode(null)}
              className="ml-auto shrink-0 min-h-[44px] md:min-h-0 text-andros-accent-ink hover:underline underline-offset-2"
            >
              Ver todos
            </button>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {!user ? (
            <p className="text-xs text-andros-muted">Inicia sesión con Google y abre un espacio en la nube para comentar.</p>
          ) : status === "idle" ? (
            <p className="text-xs text-andros-muted">Abre un espacio en la nube para ver sus comentarios.</p>
          ) : status === "setup-missing" ? (
            <SetupNotice text={COMMENTS_SETUP_HINT} />
          ) : status === "error" ? (
            <p role="alert" className="text-xs text-andros-danger">
              {errorMessage ?? "No se pudieron leer los comentarios."}
            </p>
          ) : status === "loading" && comments.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-andros-muted">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Cargando comentarios…
            </p>
          ) : !canReadComments(role) ? null : (
            <>
              {openList.length === 0 && (
                <p className="text-xs text-andros-muted">
                  {focusNodeId ? "Esta tarjeta no tiene comentarios abiertos." : "No hay comentarios abiertos en este tablero."}
                </p>
              )}
              <ul className="space-y-2.5">
                {openList.map((c) => (
                  <CommentItem key={c.id} comment={c} nodeTitle={c.nodeId ? titles.get(c.nodeId) ?? null : null} />
                ))}
              </ul>
              {resolvedList.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    aria-expanded={showResolved}
                    onClick={() => setShowResolved((v) => !v)}
                    className="min-h-[44px] md:min-h-[32px] text-xs text-andros-muted hover:text-andros-primary"
                  >
                    {showResolved ? "Ocultar resueltos" : "Mostrar resueltos"}{" "}
                    <span className="font-mono tabular-nums">({resolvedList.length})</span>
                  </button>
                  {showResolved && (
                    <ul className="mt-2 space-y-2.5">
                      {resolvedList.map((c) => (
                        <CommentItem key={c.id} comment={c} nodeTitle={c.nodeId ? titles.get(c.nodeId) ?? null : null} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Redactar */}
        {canWrite ? (
          <Composer focusNodeId={focusNodeId} focusTitle={focusTitle} />
        ) : (
          user &&
          status === "ready" && (
            <p className="px-4 py-3 border-t border-andros-border text-[11px] text-andros-muted">
              Con permiso de Solo lectura puedes leer los comentarios, pero no escribir.
            </p>
          )
        )}
      </motion.aside>
    </>
  );
};

const CommentItem: React.FC<{ comment: WorkspaceComment; nodeTitle: string | null }> = ({ comment, nodeTitle }) => {
  const userId = useCloudStore((s) => s.user?.id ?? null);
  const role = useWorkspaceRole();
  const canModerate = canModerateComment(role, comment.authorId === userId);

  return (
    <li
      className={`rounded-xl border p-3 ${
        comment.resolved ? "border-andros-border bg-andros-surface/60" : "border-andros-border bg-andros-card"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <ProfileAvatar
          size="sm"
          profile={{ id: comment.authorId, username: null, fullName: comment.authorName, avatarUrl: null }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-andros-muted">
            <span className="font-medium text-andros-primary">{comment.authorName}</span>
            {" · "}
            <time dateTime={comment.createdAt}>{relativeTimeEs(comment.createdAt)}</time>
            {comment.resolved && " · resuelto"}
          </p>
          {comment.nodeId && (
            <button
              type="button"
              onClick={() => {
                if (nodeTitle) focusNodeOnScreen(comment.nodeId as string);
              }}
              disabled={!nodeTitle}
              className="mt-0.5 max-w-full truncate text-[11px] text-andros-accent-ink hover:underline underline-offset-2 disabled:text-andros-muted disabled:no-underline"
            >
              {nodeTitle ? `En «${nodeTitle}»` : "Tarjeta eliminada"}
            </button>
          )}
          <p className="mt-1 text-sm leading-relaxed text-andros-primary whitespace-pre-wrap break-words">
            {comment.body}
          </p>
        </div>
      </div>
      {canModerate && (
        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => void setCommentResolved(comment, !comment.resolved)}
            className="h-11 md:h-8 px-2.5 rounded-lg text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
          >
            {comment.resolved ? (
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {comment.resolved ? "Reabrir" : "Resolver"}
          </button>
          <button
            type="button"
            onClick={() => deleteCommentWithUndo(comment)}
            aria-label={`Borrar comentario de ${comment.authorName}`}
            title="Borrar comentario"
            className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-danger hover:bg-andros-danger/10 active:scale-[0.96] spring-micro"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
};

const Composer: React.FC<{ focusNodeId: string | null; focusTitle: string | null }> = ({ focusNodeId, focusTitle }) => {
  const [body, setBody] = useState("");
  const [anchorToCard, setAnchorToCard] = useState(true);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);
  const selectedTitle = useWorkspaceStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId)?.title ?? null);
  const guard = useSubmitGuard();
  const modKey = useModKey();
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tarjeta a la que se ancla: la enfocada en el cajón o, si no, la seleccionada.
  const cardId = focusNodeId ?? selectedNodeId;
  const cardTitle = focusNodeId ? focusTitle : selectedTitle;
  const nodeId = anchorToCard && cardId ? cardId : null;
  const trimmed = body.trim();
  const tooLong = body.length > COMMENT_MAX_CHARS;

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [focusNodeId]);

  const submit = () =>
    guard.run(async () => {
      if (!trimmed || tooLong) return;
      const ok = await addComment(trimmed, nodeId);
      if (ok) setBody("");
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="px-4 pt-3 pb-4 border-t border-andros-border space-y-2"
    >
      <label htmlFor={inputId} className="sr-only">
        Escribe un comentario
      </label>
      <textarea
        id={inputId}
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        maxLength={COMMENT_MAX_CHARS + 200}
        placeholder={nodeId ? "Comenta esta tarjeta…" : "Escribe un comentario para el tablero…"}
        aria-invalid={tooLong || undefined}
        className="w-full resize-none px-3 py-2 rounded-lg bg-andros-canvas border border-andros-border text-sm text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-border-active"
      />
      <div className="flex flex-wrap items-center gap-2">
        {cardId && cardTitle ? (
          <label className="min-w-0 flex-1 flex items-center gap-2 min-h-[44px] md:min-h-0 text-[11px] text-andros-muted cursor-pointer">
            <input
              type="checkbox"
              checked={anchorToCard}
              onChange={(e) => setAnchorToCard(e.currentTarget.checked)}
              className="w-4 h-4 accent-[var(--accent-primary)]"
            />
            <span className="truncate">
              Anclar a «<span className="text-andros-primary">{cardTitle}</span>»
            </span>
          </label>
        ) : (
          <span className="flex-1 text-[11px] text-andros-muted">Comentario general del tablero</span>
        )}
        <span
          className={`font-mono tabular-nums text-[11px] ${tooLong ? "text-andros-danger" : "text-andros-muted"}`}
          aria-live="polite"
        >
          {body.length}/{COMMENT_MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={!trimmed || tooLong || guard.pending}
          className="h-11 md:h-9 px-3 rounded-lg bg-andros-accent-fill text-white text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none"
        >
          {guard.pending ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4" aria-hidden="true" />
          )}
          Comentar
          <span className="hidden md:inline-flex">
            <Kbd>{modKey} ↵</Kbd>
          </span>
        </button>
      </div>
      {tooLong && (
        <p role="alert" className="text-[11px] text-andros-danger">
          El comentario supera los {COMMENT_MAX_CHARS} caracteres.
        </p>
      )}
    </form>
  );
};
