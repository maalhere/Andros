"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, LogOut, Share2, UserMinus, UserPlus, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useSocialStore } from "@/store/useSocialStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { refreshSocial } from "@/lib/social/useSocialSync";
import { buildWorkspaceLink } from "@/lib/collab/room";
import { copyWorkspaceLink } from "@/lib/collab/useCollabRoom";
import { openCloudWorkspace, refreshCloudWorkspaceList } from "@/hooks/useCloudSync";
import {
  SOCIAL_SETUP_HINT,
  SocialSetupError,
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
} from "@/lib/social/repository";
import type { WorkspaceMember } from "@/types/social";
import {
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  ProfileRow,
  SetupNotice,
  SocialDialog,
} from "./SocialDialog";

// ============================================================================
// ANDROS — COMPARTIR ESPACIO
//   · Un ÚNICO enlace del espacio (`?espacio=<id>`): abre el lienzo y su canal
//     de voz a quien sea miembro. No hay enlace de llamada aparte.
//   · El dueño añade amistades en 1 clic (`workspace_members`) y puede
//     quitarlas (con «Deshacer»). Cada miembro puede salir por su cuenta.
// ============================================================================

/** Botón de la barra superior (escritorio). */
export const ShareWorkspaceButton: React.FC = () => (
  <button
    type="button"
    onClick={() => useSocialStore.getState().setShareOpen(true)}
    aria-label="Compartir espacio"
    title="Compartir espacio"
    className="hidden md:flex w-9 h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro items-center justify-center"
  >
    <Share2 className="w-4 h-4" aria-hidden="true" />
  </button>
);

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
}

export const ShareWorkspaceModal: React.FC = () => {
  const open = useSocialStore((s) => s.shareOpen);
  const setupMissing = useSocialStore((s) => s.setupMissing);
  const friendships = useSocialStore((s) => s.friendships);
  const hiddenFriendships = useSocialStore((s) => s.hiddenFriendshipIds);
  const user = useCloudStore((s) => s.user);
  const workspaceId = useCloudStore((s) => s.workspaceId);
  const ownWorkspace = useWorkspaceManagerStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const sharedWorkspace = useWorkspaceManagerStore((s) =>
    s.sharedWorkspaces.find((w) => w.id === workspaceId)
  );

  const isOwner = Boolean(ownWorkspace);
  const ownerId = sharedWorkspace?.ownerId ?? user?.id ?? null;
  const workspaceName = ownWorkspace?.name ?? sharedWorkspace?.name ?? "este espacio";

  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hiddenMembers, setHiddenMembers] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const guard = useSubmitGuard();

  const close = () => useSocialStore.getState().setShareOpen(false);

  /** Lee los miembros sin tocar el estado (lo aplica quien la llama). */
  const fetchMembers = useCallback(async (): Promise<{ members?: WorkspaceMember[]; error?: string }> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !workspaceId || !ownerId) return {};
    try {
      return { members: await listWorkspaceMembers(supabase, workspaceId, ownerId) };
    } catch (error) {
      if (error instanceof SocialSetupError) {
        useSocialStore.getState().setSetupMissing(true);
        return {};
      }
      return { error: describe(error, "No se pudieron leer los miembros") };
    }
  }, [workspaceId, ownerId]);

  const applyMembers = (result: { members?: WorkspaceMember[]; error?: string }) => {
    if (result.members) {
      setMembers(result.members);
      setLoadError(null);
    } else if (result.error) {
      setLoadError(result.error);
    }
  };

  const load = () => fetchMembers().then(applyMembers);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchMembers().then((result) => {
      if (cancelled) return;
      if (result.members) {
        setMembers(result.members);
        setLoadError(null);
      } else if (result.error) {
        setLoadError(result.error);
      }
    });
    void refreshSocial();
    return () => {
      cancelled = true;
    };
  }, [open, fetchMembers]);

  const visibleMembers = (members ?? []).filter((m) => !hiddenMembers.includes(m.userId));
  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const friendsToAdd = friendships.filter(
    (f) => f.status === "accepted" && !hiddenFriendships.includes(f.id) && !memberIds.has(f.other.id)
  );

  const addMember = (userId: string, name: string) =>
    guard.run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !workspaceId || !user) return;
      setBusyId(userId);
      try {
        await addWorkspaceMember(supabase, workspaceId, user.id, userId);
        await load();
        toast({ message: `${name} ya puede abrir «${workspaceName}» y entrar a su voz.`, tone: "success" });
      } catch (error) {
        if (error instanceof SocialSetupError) useSocialStore.getState().setSetupMissing(true);
        else toast({ message: describe(error, "No se pudo añadir"), tone: "error" });
      } finally {
        setBusyId(null);
      }
    });

  /** Quita a un miembro con «Deshacer» (se borra al expirar el aviso). */
  const removeMember = (member: WorkspaceMember) => {
    if (!workspaceId) return;
    const wsId = workspaceId;
    setHiddenMembers((ids) => [...ids, member.userId]);
    toast({
      message: `${member.profile.fullName} ya no tiene acceso a «${workspaceName}».`,
      action: {
        label: "Deshacer",
        onAction: () => setHiddenMembers((ids) => ids.filter((id) => id !== member.userId)),
      },
      onExpire: () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        void removeWorkspaceMember(supabase, wsId, member.userId)
          .catch((error: unknown) => toast({ message: describe(error, "No se pudo quitar"), tone: "error" }))
          .finally(() => {
            void load().finally(() =>
              setHiddenMembers((ids) => ids.filter((id) => id !== member.userId))
            );
          });
      },
    });
  };

  /** Miembro: salir del espacio compartido (con «Deshacer»). */
  const leaveWorkspace = () => {
    if (!workspaceId || !user) return;
    const wsId = workspaceId;
    const uid = user.id;
    close();
    toast({
      message: `Saldrás de «${workspaceName}».`,
      action: { label: "Deshacer", onAction: () => undefined },
      onExpire: () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        void (async () => {
          try {
            await removeWorkspaceMember(supabase, wsId, uid);
            await refreshCloudWorkspaceList();
            const first = useWorkspaceManagerStore.getState().workspaces[0];
            if (useCloudStore.getState().workspaceId === wsId && first) await openCloudWorkspace(first.id);
          } catch (error) {
            toast({ message: describe(error, "No se pudo salir del espacio"), tone: "error" });
          }
        })();
      },
    });
  };

  const link = open && workspaceId && typeof window !== "undefined" ? buildWorkspaceLink(workspaceId) : "";

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title={workspaceId ? `Compartir «${workspaceName}»` : "Compartir espacio"}
      titleId="andros-share-title"
      icon={<Share2 className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description={
        sharedWorkspace
          ? `Espacio de ${sharedWorkspace.ownerName}. Solo su dueño puede añadir o quitar miembros.`
          : "Los miembros pueden ver y editar el lienzo y entrar a su canal de voz."
      }
    >
      {!user || !workspaceId ? (
        <p className="text-sm text-andros-muted">
          Inicia sesión con Google y abre un espacio en la nube para compartirlo.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Enlace único del espacio */}
          <section aria-labelledby="andros-share-link" className="space-y-1.5">
            <h3 id="andros-share-link" className="text-xs font-semibold text-andros-primary">
              Enlace del espacio
            </h3>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                aria-label="Enlace del espacio"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 h-11 md:h-9 px-2.5 rounded-lg bg-andros-canvas border border-andros-border font-mono text-[11px] text-andros-muted focus:outline-none focus:border-andros-border-active"
              />
              <button type="button" onClick={() => void copyWorkspaceLink(workspaceId)} className={`${BUTTON_PRIMARY} shrink-0`}>
                <Copy className="w-4 h-4" aria-hidden="true" />
                Copiar
              </button>
            </div>
            <p className="text-[11px] text-andros-muted">
              Un solo enlace abre el lienzo y su canal de voz. Solo funciona para las personas que
              estén en la lista de miembros.
            </p>
          </section>

          {setupMissing ? (
            <SetupNotice text={SOCIAL_SETUP_HINT} />
          ) : (
            <>
              {/* Miembros */}
              <section aria-labelledby="andros-share-members" className="space-y-1">
                <h3 id="andros-share-members" className="text-xs font-semibold text-andros-primary flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
                  Miembros
                  {members && (
                    <span className="font-mono tabular-nums text-andros-muted">{visibleMembers.length}</span>
                  )}
                </h3>
                {loadError && (
                  <p className="text-xs text-andros-danger" role="alert">
                    {loadError}
                  </p>
                )}
                {!members && !loadError && (
                  <p className="flex items-center gap-2 text-xs text-andros-muted">
                    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Cargando…
                  </p>
                )}
                {members && (
                  <ul className="divide-y divide-andros-border">
                    {visibleMembers.map((m) => (
                      <ProfileRow
                        key={m.userId}
                        profile={m.profile}
                        detail={m.role === "owner" ? "dueño" : m.userId === user.id ? "tú" : "puede editar"}
                      >
                        {isOwner && m.role !== "owner" && (
                          <button
                            type="button"
                            onClick={() => removeMember(m)}
                            aria-label={`Quitar a ${m.profile.fullName} del espacio`}
                            title="Quitar del espacio"
                            className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-danger hover:bg-andros-danger/10 active:scale-[0.96] spring-micro"
                          >
                            <UserMinus className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </ProfileRow>
                    ))}
                  </ul>
                )}
                {!isOwner && (
                  <button type="button" onClick={leaveWorkspace} className={`${BUTTON_DANGER} mt-2`}>
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    Salir de este espacio
                  </button>
                )}
              </section>

              {/* Añadir amistades en 1 clic */}
              {isOwner && (
                <section aria-labelledby="andros-share-add" className="space-y-1">
                  <h3 id="andros-share-add" className="text-xs font-semibold text-andros-primary">
                    Añadir amigos
                  </h3>
                  {friendsToAdd.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-andros-muted">
                        {friendships.some((f) => f.status === "accepted")
                          ? "Todas tus amistades ya están en este espacio."
                          : "Aún no tienes amigos en Andros. Añádelos por @usuario o correo."}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          useSocialStore.getState().setFriendsOpen(true);
                        }}
                        className={BUTTON_SECONDARY}
                      >
                        <Users className="w-4 h-4" aria-hidden="true" />
                        Abrir Amigos
                      </button>
                    </div>
                  ) : (
                    <ul className="divide-y divide-andros-border">
                      {friendsToAdd.map((f) => (
                        <ProfileRow key={f.id} profile={f.other}>
                          <button
                            type="button"
                            disabled={busyId === f.other.id}
                            onClick={() => void addMember(f.other.id, f.other.fullName)}
                            className={BUTTON_PRIMARY}
                          >
                            {busyId === f.other.id ? (
                              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            ) : (
                              <UserPlus className="w-4 h-4" aria-hidden="true" />
                            )}
                            Añadir
                          </button>
                        </ProfileRow>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </SocialDialog>
  );
};
