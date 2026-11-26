"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AtSign, Check, Loader2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useSocialStore } from "@/store/useSocialStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { USERNAME_PATTERN } from "@/types/social";
import { SocialSetupError, isUsernameAvailable, saveUsername } from "@/lib/social/repository";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "./SocialDialog";

// ============================================================================
// ANDROS — ELIGE TU @USUARIO
// Aparece una vez con sesión iniciada si aún no tienes @usuario. Comprueba la
// disponibilidad mientras escribes. «Ahora no» lo pospone hasta la próxima
// sesión (no bloquea el lienzo).
// ============================================================================

type Availability = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

/** minúsculas, sin @ inicial ni espacios; solo a-z, 0-9 y _. */
function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s.-]+/g, "_")
    .slice(0, 20);
}

function suggestionFrom(name: string, email: string): string {
  const base = normalize(email.split("@")[0] || name).replace(/[^a-z0-9_]/g, "");
  return base.length >= 3 ? base : "";
}

export const UsernameSetupModal: React.FC = () => {
  const user = useCloudStore((s) => s.user);
  const inWorkspace = useLandingStore((s) => s.phase === "workspace");
  const username = useSocialStore((s) => s.username);
  const setupMissing = useSocialStore((s) => s.setupMissing);
  const dismissed = useSocialStore((s) => s.usernamePromptDismissed);
  const open = Boolean(user) && inWorkspace && username === null && !setupMissing && !dismissed;

  const suggestion = useMemo(() => (user ? suggestionFrom(user.name, user.email) : ""), [user]);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  /** Respuesta del servidor para un candidato concreto. */
  const [remote, setRemote] = useState<{ candidate: string; status: "available" | "taken" | "error" } | null>(
    null
  );
  const { pending, run } = useSubmitGuard();

  const candidate = touched ? value : value || suggestion;
  const formatOk = USERNAME_PATTERN.test(candidate);
  // Vacío o con formato inválido se decide aquí; lo demás lo dice el servidor.
  const availability: Availability = !candidate
    ? "idle"
    : !formatOk
      ? "invalid"
      : remote?.candidate === candidate
        ? remote.status
        : "checking";

  // Comprobación de disponibilidad en vivo (con pausa de 400 ms).
  useEffect(() => {
    if (!open || !candidate || !formatOk) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      isUsernameAvailable(supabase, candidate)
        .then((ok) => {
          if (!cancelled) setRemote({ candidate, status: ok ? "available" : "taken" });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (error instanceof SocialSetupError) useSocialStore.getState().setSetupMissing(true);
          setRemote({ candidate, status: "error" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, formatOk, open]);

  const close = () => useSocialStore.getState().dismissUsernamePrompt();

  const submit = () =>
    run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !user) return;
      // Fija la sugerencia como valor escrito (así no cambia al guardar).
      setTouched(true);
      setValue(candidate);
      if (!USERNAME_PATTERN.test(candidate)) return;
      try {
        const saved = await saveUsername(supabase, user.id, user.email, candidate);
        if (!saved) {
          setRemote({ candidate, status: "taken" });
          return;
        }
        useSocialStore.getState().setUsername(candidate);
        toast({ message: `Listo: ahora eres @${candidate}.`, tone: "success" });
      } catch (error) {
        if (error instanceof SocialSetupError) {
          useSocialStore.getState().setSetupMissing(true);
          return;
        }
        setRemote({ candidate, status: "error" });
      }
    });

  const message: Record<Availability, { text: string; className: string } | null> = {
    idle: null,
    invalid: {
      text: "Usa de 3 a 20 caracteres: letras minúsculas, números o guion bajo.",
      className: "text-andros-danger",
    },
    checking: { text: "Comprobando disponibilidad…", className: "text-andros-muted" },
    available: { text: `@${candidate} está disponible.`, className: "text-andros-success" },
    taken: { text: `@${candidate} ya está en uso. Prueba con otro.`, className: "text-andros-danger" },
    error: { text: "No se pudo comprobar ahora. Inténtalo de nuevo.", className: "text-andros-warning" },
  };
  const feedback = message[availability];

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Elige tu @usuario"
      titleId="andros-username-title"
      icon={<AtSign className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Tus amistades te encontrarán por este nombre para compartir espacios y entrar juntos a la voz."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <label htmlFor="andros-username" className="block text-xs font-medium text-andros-primary">
            @usuario
          </label>
          <div className="flex items-center h-11 md:h-10 rounded-lg bg-andros-canvas border border-andros-border focus-within:border-andros-border-active">
            <span className="pl-3 text-sm text-andros-muted" aria-hidden="true">
              @
            </span>
            <input
              id="andros-username"
              autoFocus
              autoComplete="username"
              spellCheck={false}
              inputMode="text"
              value={candidate}
              onChange={(e) => {
                setTouched(true);
                setValue(normalize(e.target.value));
              }}
              aria-invalid={availability === "invalid" || availability === "taken"}
              aria-describedby="andros-username-feedback"
              maxLength={20}
              placeholder="tu_nombre"
              className="flex-1 min-w-0 h-full pl-0.5 pr-3 bg-transparent text-sm text-andros-primary placeholder:text-andros-muted focus:outline-none"
            />
            {availability === "checking" && (
              <Loader2 className="w-4 h-4 mr-3 animate-spin text-andros-muted motion-reduce:animate-none" aria-hidden="true" />
            )}
            {availability === "available" && (
              <Check className="w-4 h-4 mr-3 text-andros-success" aria-hidden="true" />
            )}
          </div>
          <p id="andros-username-feedback" aria-live="polite" className={`min-h-[1rem] text-xs ${feedback?.className ?? ""}`}>
            {feedback?.text ?? ""}
          </p>
        </div>

        {user?.email && (
          <div className="px-3 py-2 rounded-lg border border-andros-border bg-andros-surface">
            <p className="text-[11px] text-andros-muted">Correo verificado al iniciar sesión</p>
            <p className="truncate text-sm text-andros-primary">{user.email}</p>
            <p className="mt-0.5 text-[11px] text-andros-muted">
              Solo sirve para que alguien que ya lo conoce te encuentre; nunca se muestra a otras personas.
            </p>
          </div>
        )}

        <div className="flex flex-col-reverse md:flex-row md:justify-end gap-2 pt-1">
          <button type="button" onClick={close} className={BUTTON_SECONDARY}>
            Ahora no
          </button>
          <button
            type="submit"
            disabled={pending || availability === "checking" || availability === "taken"}
            className={BUTTON_PRIMARY}
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Guardar @usuario
          </button>
        </div>
      </form>
    </SocialDialog>
  );
};
