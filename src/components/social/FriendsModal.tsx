"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { selectIncomingCount, useSocialStore } from "@/store/useSocialStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { refreshSocial } from "@/lib/social/useSocialSync";
import {
  SOCIAL_SETUP_HINT,
  SocialSetupError,
  removeFriendship,
  respondFriendRequest,
  searchProfiles,
  sendFriendRequest,
} from "@/lib/social/repository";
import type { BasicProfile, Friendship } from "@/types/social";
import {
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT,
  ProfileRow,
  SetupNotice,
  SocialDialog,
} from "./SocialDialog";

// ============================================================================
// ANDROS — AMIGOS (pestañas Amigos · Solicitudes · Añadir amigo)
// Se añade por @usuario o correo EXACTO. Quitar una amistad o cancelar una
// solicitud ofrece «Deshacer» durante unos segundos antes de borrarla.
// ============================================================================

type Tab = "friends" | "requests" | "add";

const TABS: { id: Tab; label: string }[] = [
  { id: "friends", label: "Amigos" },
  { id: "requests", label: "Solicitudes" },
  { id: "add", label: "Añadir amigo" },
];

function handleError(error: unknown, fallback: string): void {
  if (error instanceof SocialSetupError) {
    useSocialStore.getState().setSetupMissing(true);
    return;
  }
  toast({ message: error instanceof Error ? `${fallback}: ${error.message}` : fallback, tone: "error" });
}

/** Oculta la amistad, ofrece «Deshacer» y la borra de verdad al expirar. */
function removeWithUndo(friendship: Friendship, message: string): void {
  const social = useSocialStore.getState;
  social().hideFriendship(friendship.id, true);
  toast({
    message,
    action: { label: "Deshacer", onAction: () => social().hideFriendship(friendship.id, false) },
    onExpire: () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      void removeFriendship(supabase, friendship.id)
        .catch((error: unknown) => handleError(error, "No se pudo completar"))
        .finally(() => {
          void refreshSocial().finally(() => social().hideFriendship(friendship.id, false));
        });
    },
  });
}

export const FriendsModal: React.FC = () => {
  const open = useSocialStore((s) => s.friendsOpen);
  const user = useCloudStore((s) => s.user);
  const username = useSocialStore((s) => s.username);
  const setupMissing = useSocialStore((s) => s.setupMissing);
  const friendships = useSocialStore((s) => s.friendships);
  const loaded = useSocialStore((s) => s.friendshipsLoaded);
  const hidden = useSocialStore((s) => s.hiddenFriendshipIds);
  const incomingCount = useSocialStore(selectIncomingCount);

  const [tab, setTab] = useState<Tab>("friends");
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);
  const [results, setResults] = useState<BasicProfile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const search = useSubmitGuard();
  const action = useSubmitGuard();

  // Al abrir se vuelven a leer las solicitudes (por si llegó alguna nueva).
  useEffect(() => {
    if (open) void refreshSocial();
  }, [open]);

  const close = () => useSocialStore.getState().setFriendsOpen(false);
  const visible = friendships.filter((f) => !hidden.includes(f.id));
  const friends = visible.filter((f) => f.status === "accepted");
  const incoming = visible.filter((f) => f.direction === "incoming" && f.status === "pending");
  const outgoing = visible.filter((f) => f.direction === "outgoing" && f.status === "pending");

  const runAction = (id: string, task: () => Promise<void>) =>
    action.run(async () => {
      setBusyId(id);
      try {
        await task();
        await refreshSocial();
      } finally {
        setBusyId(null);
      }
    });

  const respond = (f: Friendship, accept: boolean) =>
    runAction(f.id, async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      try {
        await respondFriendRequest(supabase, f.id, accept);
        toast({
          message: accept ? `Ahora eres amigo/a de ${f.other.fullName}.` : "Solicitud rechazada.",
          tone: accept ? "success" : "neutral",
        });
      } catch (error) {
        handleError(error, "No se pudo responder");
      }
    });

  const sendRequest = (profile: BasicProfile) =>
    runAction(profile.id, async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !user) return;
      try {
        const result = await sendFriendRequest(supabase, user.id, profile.id, friendships);
        const messages: Record<typeof result, string> = {
          sent: `Solicitud enviada a ${profile.fullName}.`,
          accepted: `${profile.fullName} ya te había escrito: ahora son amigos.`,
          "already-friends": `${profile.fullName} ya está en tus amigos.`,
          "already-sent": `Ya enviaste una solicitud a ${profile.fullName}.`,
        };
        toast({ message: messages[result], tone: result === "sent" || result === "accepted" ? "success" : "neutral" });
      } catch (error) {
        handleError(error, "No se pudo enviar la solicitud");
      }
    });

  const runSearch = () =>
    search.run(async () => {
      const clean = query.trim();
      if (clean.replace(/^@/, "").length < 3) {
        setQueryError("Escribe un @usuario (3 o más caracteres) o un correo completo.");
        return;
      }
      if (clean.includes("@") && !clean.startsWith("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        setQueryError("Ese correo no parece completo (ejemplo: nombre@dominio.com).");
        return;
      }
      setQueryError(null);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      try {
        setResults(await searchProfiles(supabase, clean));
      } catch (error) {
        handleError(error, "No se pudo buscar");
      }
    });

  const statusFor = (profile: BasicProfile): string | null => {
    const existing = friendships.find((f) => f.other.id === profile.id);
    if (!existing) return null;
    if (existing.status === "accepted") return "Ya es tu amigo/a";
    if (existing.status === "pending") return existing.direction === "incoming" ? "Te escribió" : "Solicitud enviada";
    return null;
  };

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Amigos"
      titleId="andros-friends-title"
      icon={<Users className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description={
        username ? (
          <>
            Tu @usuario es <span className="font-medium text-andros-primary">@{username}</span>.
          </>
        ) : user && !setupMissing ? (
          <button
            type="button"
            onClick={() => useSocialStore.setState({ usernamePromptDismissed: false })}
            className="underline underline-offset-2 text-andros-accent-ink"
          >
            Elige tu @usuario para que te encuentren
          </button>
        ) : null
      }
    >
      {!user ? (
        <p className="text-sm text-andros-muted">Inicia sesión con Google para añadir amigos y compartir espacios.</p>
      ) : setupMissing ? (
        <SetupNotice text={SOCIAL_SETUP_HINT} />
      ) : (
        <>
          <div role="tablist" aria-label="Secciones de amigos" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-andros-surface border border-andros-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`andros-friends-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`andros-friends-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`h-11 md:h-8 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 spring-micro active:scale-[0.96] ${
                  tab === t.id
                    ? "bg-andros-card text-andros-primary shadow-sm"
                    : "text-andros-muted hover:text-andros-primary"
                }`}
              >
                {t.label}
                {t.id === "requests" && incomingCount > 0 && (
                  <span
                    className="min-w-[1.25rem] h-5 px-1 rounded-full bg-andros-accent-fill text-white text-[11px] font-mono tabular-nums flex items-center justify-center"
                    aria-label={`${incomingCount} pendientes`}
                  >
                    {incomingCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`andros-friends-panel-${tab}`}
            aria-labelledby={`andros-friends-tab-${tab}`}
            className="mt-3 min-h-[8rem]"
          >
            {!loaded && (
              <p className="flex items-center gap-2 text-xs text-andros-muted">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Cargando…
              </p>
            )}

            {loaded && tab === "friends" && (
              friends.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-andros-muted">Aún no tienes amigos en Andros.</p>
                  <button type="button" onClick={() => setTab("add")} className={BUTTON_SECONDARY}>
                    <UserPlus className="w-4 h-4" aria-hidden="true" />
                    Añadir amigo
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-andros-border">
                  {friends.map((f) => (
                    <ProfileRow key={f.id} profile={f.other}>
                      <button
                        type="button"
                        onClick={() => removeWithUndo(f, `${f.other.fullName} ya no está en tus amigos.`)}
                        aria-label={`Quitar a ${f.other.fullName} de tus amigos`}
                        title="Quitar de amigos"
                        className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-danger hover:bg-andros-danger/10 active:scale-[0.96] spring-micro"
                      >
                        <UserMinus className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </ProfileRow>
                  ))}
                </ul>
              )
            )}

            {loaded && tab === "requests" && (
              incoming.length === 0 && outgoing.length === 0 ? (
                <p className="text-sm text-andros-muted">No tienes solicitudes pendientes.</p>
              ) : (
                <div className="space-y-3">
                  {incoming.length > 0 && (
                    <section aria-labelledby="andros-requests-incoming">
                      <h3 id="andros-requests-incoming" className="text-xs font-semibold text-andros-primary">
                        Recibidas
                      </h3>
                      <ul className="divide-y divide-andros-border">
                        {incoming.map((f) => (
                          <ProfileRow key={f.id} profile={f.other}>
                            <button
                              type="button"
                              disabled={busyId === f.id}
                              onClick={() => void respond(f, true)}
                              className={BUTTON_PRIMARY}
                            >
                              <Check className="w-4 h-4" aria-hidden="true" />
                              Aceptar
                            </button>
                            <button
                              type="button"
                              disabled={busyId === f.id}
                              onClick={() => void respond(f, false)}
                              aria-label={`Rechazar la solicitud de ${f.other.fullName}`}
                              title="Rechazar"
                              className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center border border-andros-border text-andros-muted hover:text-andros-danger active:scale-[0.96] spring-micro disabled:opacity-50"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </ProfileRow>
                        ))}
                      </ul>
                    </section>
                  )}
                  {outgoing.length > 0 && (
                    <section aria-labelledby="andros-requests-outgoing">
                      <h3 id="andros-requests-outgoing" className="text-xs font-semibold text-andros-primary">
                        Enviadas
                      </h3>
                      <ul className="divide-y divide-andros-border">
                        {outgoing.map((f) => (
                          <ProfileRow key={f.id} profile={f.other} detail="esperando respuesta">
                            <button
                              type="button"
                              onClick={() => removeWithUndo(f, "Solicitud cancelada.")}
                              className={BUTTON_DANGER}
                            >
                              Cancelar
                            </button>
                          </ProfileRow>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )
            )}

            {tab === "add" && (
              <div className="space-y-3">
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch();
                  }}
                  className="space-y-1.5"
                >
                  <label htmlFor="andros-friend-query" className="block text-xs font-medium text-andros-primary">
                    @usuario o correo exacto
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="andros-friend-query"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        if (queryError) setQueryError(null);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="@ana o ana@correo.com"
                      aria-invalid={Boolean(queryError)}
                      aria-describedby="andros-friend-query-error"
                      maxLength={254}
                      className={INPUT}
                    />
                    <button type="submit" disabled={search.pending} className={`${BUTTON_PRIMARY} shrink-0`}>
                      {search.pending ? (
                        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Search className="w-4 h-4" aria-hidden="true" />
                      )}
                      Buscar
                    </button>
                  </div>
                  <p id="andros-friend-query-error" className="min-h-[1rem] text-xs text-andros-danger" aria-live="polite">
                    {queryError ?? ""}
                  </p>
                </form>
                {results && results.length === 0 && (
                  <p className="text-sm text-andros-muted" role="status">
                    No encontramos a nadie con ese @usuario o correo.
                  </p>
                )}
                {results && results.length > 0 && (
                  <ul className="divide-y divide-andros-border" aria-label="Resultados de la búsqueda">
                    {results.map((profile) => {
                      const status = statusFor(profile);
                      return (
                        <ProfileRow key={profile.id} profile={profile}>
                          {status ? (
                            <span className="text-xs text-andros-muted">{status}</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === profile.id}
                              onClick={() => void sendRequest(profile)}
                              className={BUTTON_PRIMARY}
                            >
                              <UserPlus className="w-4 h-4" aria-hidden="true" />
                              Añadir
                            </button>
                          )}
                        </ProfileRow>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </SocialDialog>
  );
};
