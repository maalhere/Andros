"use client";

import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, Scissors } from "lucide-react";
import { useCardMenuStore, type CardMenuRequest } from "@/store/useCardMenuStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { copyCards, cutCards, pasteClipboard } from "@/lib/canvas/clipboardActions";
import { Kbd, useModKey } from "./Kbd";

// ============================================================================
// ANDROS — MENÚ CONTEXTUAL DE FICHAS Y LIENZO (Copiar · Cortar · Pegar)
// ↑↓ para moverse, Esc o un clic fuera para cerrar. En solo lectura solo queda
// «Copiar»; «Pegar» aparece cuando hay algo en el portapapeles.
// ============================================================================

const EDGE = 8;

export const CardActionsMenu: React.FC = () => {
  const menu = useCardMenuStore((s) => s.menu);
  if (!menu || typeof document === "undefined") return null;
  return createPortal(<Menu key={`${menu.nodeId}-${menu.x}-${menu.y}`} menu={menu} />, document.body);
};

const Menu: React.FC<{ menu: CardMenuRequest }> = ({ menu }) => {
  const close = useCardMenuStore((s) => s.closeMenu);
  const readOnly = useCanvasReadOnly();
  const hasClipboard = useWorkspaceStore((s) => s.clipboard !== null);
  const nodeExists = useWorkspaceStore((s) => s.nodes.some((n) => n.id === menu.nodeId));
  const mod = useModKey();
  const ref = useRef<HTMLDivElement>(null);

  const { nodeId, pasteAt } = menu;
  const items = [
    ...(nodeId && nodeExists
      ? [
          { id: "copy", label: "Copiar", key: "C", Icon: Copy, run: () => copyCards([nodeId]) },
          ...(readOnly
            ? []
            : [{ id: "cut", label: "Cortar", key: "X", Icon: Scissors, run: () => cutCards([nodeId]) }]),
        ]
      : []),
    ...(!readOnly && hasClipboard
      ? [{ id: "paste", label: "Pegar", key: "V", Icon: ClipboardPaste, run: () => pasteClipboard(pasteAt) }]
      : []),
  ];

  // Se mantiene dentro de la ventana.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(EDGE, Math.min(menu.x, window.innerWidth - el.offsetWidth - EDGE))}px`;
    el.style.top = `${Math.max(EDGE, Math.min(menu.y, window.innerHeight - el.offsetHeight - EDGE))}px`;
  }, [menu]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (e: Event) => {
      if (!el?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      // Cambió la ficha bajo el menú (borrada o se abrió otro espacio).
      if (state.nodes !== prev.nodes && nodeId && !state.nodes.some((n) => n.id === nodeId)) close();
    });
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      unsubscribe();
      const active = document.activeElement;
      if (active === document.body || el?.contains(active)) previous?.focus?.({ preventScroll: true });
    };
  }, [close, nodeId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  };

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={nodeId ? "Acciones de la ficha" : "Acciones del lienzo"}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[95] min-w-44 p-1 rounded-xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
      style={{ left: menu.x, top: menu.y }}
    >
      {items.map(({ id, label, key, Icon, run }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            run();
          }}
          className="w-full min-h-11 md:min-h-9 px-2.5 flex items-center gap-2.5 rounded-lg text-[13px] text-andros-primary hover:bg-andros-border/60 focus-visible:bg-andros-border/60 active:scale-[0.96] spring-micro"
        >
          <Icon className="w-4 h-4 text-andros-muted" aria-hidden="true" />
          <span className="flex-1 text-left">{label}</span>
          <span className="hidden md:flex items-center gap-1">
            <Kbd>{mod}</Kbd>
            <Kbd>{key}</Kbd>
          </span>
        </button>
      ))}
    </div>
  );
};
