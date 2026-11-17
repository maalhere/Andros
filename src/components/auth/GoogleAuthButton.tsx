"use client";

import React, { useEffect, useRef, useState } from "react";
import { HardDrive, Loader2, LogOut } from "lucide-react";
import { useCloudStore, type CloudStatus } from "@/store/useCloudStore";
import { signInWithGoogle, signOutFromCloud } from "@/hooks/useCloudSync";

// ============================================================================
// ANDROS — BOTÓN DE CUENTA DE GOOGLE (barra superior)
//   · Sin claves en .env.local → pastilla discreta "Modo local".
//   · Sin sesión              → "Continuar con Google".
//   · Con sesión              → estado de guardado + avatar + cerrar sesión.
// ============================================================================

/** Logotipo oficial "G" de Google (requerido por sus normas de marca). */
export const GoogleGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <path
      fill="#FFC107"
      d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
    />
    <path
      fill="#FF3D00"
      d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
    />
  </svg>
);

const PILL =
  "flex items-center gap-2 h-8 px-2.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm text-[11px] font-mono";

function statusLabel(status: CloudStatus, pendingUploads: number): string {
  if (status === "error") return "Error al guardar";
  if (pendingUploads > 0) return "Subiendo archivo…";
  if (status === "loading") return "Cargando lienzo…";
  if (status === "saving") return "Guardando…";
  return "Guardado en la nube";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

interface GoogleAuthButtonProps {
  isMobile: boolean;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({ isMobile }) => {
  const status = useCloudStore((s) => s.status);
  const user = useCloudStore((s) => s.user);
  const pendingUploads = useCloudStore((s) => s.pendingUploads);
  const errorMessage = useCloudStore((s) => s.errorMessage);
  const clearError = useCloudStore((s) => s.clearError);

  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cierra el menú al tocar fuera.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  // Las URLs de avatar cambian entre usuarios: se vuelve a intentar con cada uno.
  useEffect(() => setAvatarFailed(false), [user?.avatarUrl]);

  // ---- 1. Sin Supabase configurado: modo local silencioso ------------------
  if (status === "disabled") {
    return (
      <div
        className={`${PILL} text-andros-muted`}
        title="Trabajando en local. Añade las claves de Supabase en .env.local para guardar en la nube."
      >
        <HardDrive className="w-3.5 h-3.5" />
        {!isMobile && <span>Modo local</span>}
      </div>
    );
  }

  // ---- 2. Comprobando sesión ----------------------------------------------
  if (status === "connecting" && !user) {
    return (
      <div className={`${PILL} text-andros-muted`} title="Conectando con tu cuenta…">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {!isMobile && <span>Conectando…</span>}
      </div>
    );
  }

  // ---- 3. Sin sesión: botón "Continuar con Google" ------------------------
  if (!user) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            clearError();
            void signInWithGoogle();
          }}
          className={`${PILL} text-andros-primary hover:border-andros-border-active spring-micro active:scale-95 font-sans font-medium text-xs`}
          title="Inicia sesión para guardar tu lienzo en la nube"
        >
          <GoogleGlyph className="w-4 h-4" />
          <span>{isMobile ? "Entrar" : "Continuar con Google"}</span>
        </button>
        {errorMessage && (
          <p className="absolute right-0 top-10 w-64 p-2.5 rounded-xl bg-andros-card border border-andros-border text-[11px] text-andros-accent shadow-sm">
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  // ---- 4. Con sesión: estado + avatar + menú ------------------------------
  const isBusy = status === "loading" || status === "saving" || pendingUploads > 0;
  const isError = status === "error";
  const label = statusLabel(status, pendingUploads);
  const dotColor = isError ? "bg-andros-accent" : isBusy ? "bg-andros-muted" : "bg-andros-success";
  const textColor = isError ? "text-andros-accent" : isBusy ? "text-andros-muted" : "text-andros-success";

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutFromCloud();
    } finally {
      setIsSigningOut(false);
      setMenuOpen(false);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className={`${PILL} pl-2 pr-1 hover:border-andros-border-active spring-micro active:scale-95`}
        title={errorMessage ?? label}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className={`flex items-center gap-1.5 ${textColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isBusy ? "animate-pulse" : ""}`} />
          {!isMobile && <span>{label}</span>}
        </span>

        {user.avatarUrl && !avatarFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.name}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="w-6 h-6 rounded-full border border-andros-border object-cover"
          />
        ) : (
          <span className="w-6 h-6 rounded-full bg-andros-accent/15 border border-andros-accent/40 text-andros-accent text-[10px] font-bold flex items-center justify-center">
            {initialsOf(user.name)}
          </span>
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-10 w-64 p-1.5 rounded-xl bg-andros-card border border-andros-border shadow-sm"
        >
          <div className="px-2.5 py-2">
            <p className="text-xs font-semibold text-andros-primary truncate">{user.name}</p>
            <p className="text-[11px] font-mono text-andros-muted truncate">{user.email}</p>
            <p className={`mt-2 text-[11px] font-mono ${textColor}`}>● {label}</p>
            {errorMessage && (
              <p className="mt-1.5 text-[11px] leading-snug text-andros-accent">{errorMessage}</p>
            )}
          </div>
          <div className="h-px bg-andros-border my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-andros-primary hover:bg-andros-canvas spring-micro disabled:opacity-60"
          >
            {isSigningOut ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            <span>Cerrar sesión</span>
          </button>
        </div>
      )}
    </div>
  );
};
