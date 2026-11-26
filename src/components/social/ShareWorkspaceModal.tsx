"use client";

import { track } from "@/lib/analytics/telemetry";
import React, { useCallback, useEffect, useState } from "react";
import { Copy, FileText, Globe, Loader2, LogOut, RefreshCw, Share2, UserMinus, UserPlus, Users } from "lucide-react";
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
import { usePlanExportStore } from "@/store/usePlanExportStore";
import { copyText } from "@/lib/collab/room";
import {
  PUBLIC_SHARE_SETUP_HINT,
  PublicShareSetupError,
  buildGuestLink,
  readPublicShare,
  updatePublicShare,
  type PublicShareState,
} from "@/lib/share/publicShare";
import {
  SOCIAL_SETUP_HINT,
  SocialSetupError,
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/lib/social/repository";
import type { WorkspaceMember } from "@/types/social";
import { ROLE_LABELS, isMemberRole, type MemberRole } from "@/lib/access/permissions";
import { useWorkspaceRole } from "@/lib/access/workspaceRole";
import { setKnownMemberRole } from "@/lib/access/memberRoles";
import { broadcastCollabEvent, collabEventBase } from "@/lib/collab/useCollabRoom";
import { requestShareNotification, shareNotifyNote } from "@/lib/share/shareNotifyClient";
import type { AccessChangedPayload } from "@/types/collab";
import { RolePicker, RoleSelect } from "./RoleSelect";
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
//   · Enlace público «Vista Invitado» (`/ver/<token>`): solo lectura y sin
//     cuenta, para voluntarios, clientes o directivos. Solo el dueño lo activa,
//     lo desactiva o genera uno nuevo (el anterior deja de funcionar).
//   · Atajo a «Exportar Plan del Día» (PDF + resumen para chats de grupo).
//   · (Sprint 16) Permisos estilo Google Docs: Editor, Comentarista o Solo
//     lectura al añadir y en 1 clic por miembro. Cada alta o cambio avisa por
//     correo (si el servidor tiene Resend) y en vivo a la sala.
// ============================================================================

/** Avisa a la sala que cambió el permiso de alguien (`role: null` = quitado). */
function announceAccess(workspaceId: string, userId: string, role: MemberRole | null): void {
  setKnownMemberRole(workspaceId, userId, role);
  const base = collabEventBase();
  if (!base || base.workspaceId !== workspaceId) return;
  const payload: AccessChangedPayload = { ...base, userId, role };
  broadcastCollabEvent("access:changed", payload);
}

/** Botón de la barra superior (escritorio). */
/** `showOnMobile` (Modo Simple): también en la barra del teléfono, con 44 px táctiles. */
export const ShareWorkspaceButton: React.FC<{ showOnMobile?: boolean }> = ({ showOnMobile = false }) => (
  <button
    type="button"
    onClick={() => useSocialStore.getState().setShareOpen(true)}
    aria-label="Compartir espacio"
    title="Compartir espacio"
    className={`${showOnMobile ? "flex w-11 h-11" : "hidden md:flex"} md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro items-center justify-center`}
  >
    <Share2 className="w-4 h-4" aria-hidden="true" />
  </button>
);

/** Interruptor accesible (role="switch") con área táctil de 44 px en el teléfono. */
const Switch: React.FC<{ checked: boolean; disabled?: boolean; onChange: () => void; labelledBy: string }> = ({
  checked,
  disabled,
  onChange,
  labelledBy,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={labelledBy}
    disabled={disabled}
    onClick={onChange}
    className="shrink-0 w-14 h-11 md:w-11 md:h-9 -mr-1.5 flex items-center justify-center rounded-lg disabled:opacity-50 active:scale-[0.96] spring-micro"
  >
    <span
      aria-hidden="true"
      className={`relative w-9 h-5 rounded-full border spring-micro ${
        checked ? "bg-andros-accent-fill border-transparent" : "bg-andros-border/60 border-andros-border-active"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full shadow-sm spring-micro ${
          checked ? "translate-x-4 bg-white" : "bg-andros-card"
        }`}
      />
    </span>
  </button>
);

/** Sección «Enlace público (Vista Invitado)» — solo para el dueño. */
const GuestLinkSection: React.FC<{ workspaceId: string; workspaceName: string }> = ({ workspaceId, workspaceName }) => {
  const [state, setState] = useState<PublicShareState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupMissing, setSetupMissing] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const guard = useSubmitGuard();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    readPublicShare(supabase, workspaceId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof PublicShareSetupError) setSetupMissing(true);
        else setError(describe(err, "No se pudo leer el enlace público"));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const apply = (next: { enabled: boolean; rotate?: boolean }) =>
    guard.run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !state) return;
      try {
        const updated = await updatePublicShare(supabase, workspaceId, state, next);
        if (updated.enabled && (next.rotate || !state.enabled)) track("guest_link_enabled", { rotated: Boolean(next.rotate) });
        setState(updated);
        setError(null);
        setConfirmRotate(false);
        toast({
          message: next.rotate
            ? "Enlace de invitado nuevo listo. El anterior ya no funciona."
            : updated.enabled
              ? `Vista Invitado activada para «${workspaceName}».`
              : "Enlace público desactivado: ya nadie puede abrirlo.",
          tone: "success",
        });
      } catch (err) {
        if (err instanceof PublicShareSetupError) setSetupMissing(true);
        else setError(describe(err, "No se pudo cambiar el enlace público"));
      }
    });

  const guestLink = state?.enabled && state.token ? buildGuestLink(state.token) : "";

  const copyGuestLink = async () => {
    const ok = await copyText(guestLink);
    toast({
      message: ok
        ? "Enlace de invitado copiado. Quien lo abra verá el tablero en solo lectura."
        : "No se pudo copiar el enlace.",
      tone: ok ? "success" : "error",
    });
  };

  return (
    <section aria-labelledby="andros-share-public" className="space-y-2 pt-4 border-t border-andros-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="andros-share-public" className="text-xs font-semibold text-andros-primary flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
            Enlace público (Vista Invitado)
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-andros-muted">
            Cualquiera con el enlace ve el tablero en solo lectura, sin cuenta: ideal para
            voluntarios, clientes o directivos. Incluido en todos los planes.
          </p>
        </div>
        {!setupMissing && (
          <Switch
            checked={Boolean(state?.enabled)}
            disabled={!state || guard.pending}
            onChange={() => void apply({ enabled: !state?.enabled })}
            labelledBy="andros-share-public"
          />
        )}
      </div>

      {setupMissing && <SetupNotice text={PUBLIC_SHARE_SETUP_HINT} />}
      {error && (
        <p className="text-xs text-andros-danger" role="alert">
          {error}
        </p>
      )}
      {!state && !error && !setupMissing && (
        <p className="flex items-center gap-2 text-xs text-andros-muted">
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Cargando…
        </p>
      )}

      {guestLink && (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={guestLink}
              aria-label="Enlace de invitado"
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 h-11 md:h-9 px-2.5 rounded-lg bg-andros-canvas border border-andros-border font-mono text-[11px] text-andros-muted focus:outline-none focus:border-andros-border-active"
            />
            <button type="button" onClick={() => void copyGuestLink()} className={`${BUTTON_PRIMARY} shrink-0`}>
              <Copy className="w-4 h-4" aria-hidden="true" />
              Copiar enlace de invitado
            </button>
          </div>
          {confirmRotate ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-[11px] text-andros-warning">
              <span className="flex-1 min-w-[12rem]">El enlace actual dejará de funcionar para quien ya lo tenga.</span>
              <button type="button" onClick={() => setConfirmRotate(false)} className={BUTTON_SECONDARY}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={guard.pending}
                onClick={() => void apply({ enabled: true, rotate: true })}
                className={BUTTON_DANGER}
              >
                Generar enlace nuevo
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRotate(true)}
              className="min-h-[44px] md:min-h-0 inline-flex items-center gap-1.5 text-[11px] text-andros-muted hover:text-andros-primary underline-offset-4 hover:underline"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Generar enlace nuevo (invalida el actual)
            </button>
          )}
        </>
      )}
    </section>
  );
};

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
  const [addRole, setAddRole] = useState<MemberRole>("editor");
  const [mailNote, setMailNote] = useState<string | null>(null);
  const ownRole = useWorkspaceRole();
  const guard = useSubmitGuard();

  /** Aviso por correo sin bloquear: compartir ya quedó guardado. */
  const notifyByMail = (wsId: string, userId: string, name: string, reason: "added" | "role_changed") => {
    void requestShareNotification(wsId, userId, reason).then((outcome) => {
      const note = shareNotifyNote(outcome, name);
      if (note) setMailNote(note);
    });
  };

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
        const role = addRole;
        await addWorkspaceMember(supabase, workspaceId, user.id, userId, role);
        await load();
        announceAccess(workspaceId, userId, role);
        toast({
          message: `${name} ya puede abrir «${workspaceName}» como ${ROLE_LABELS[role]}.`,
          tone: "success",
        });
        notifyByMail(workspaceId, userId, name, "added");
      } catch (error) {
        if (error instanceof SocialSetupError) useSocialStore.getState().setSetupMissing(true);
        else toast({ message: describe(error, "No se pudo añadir"), tone: "error" });
      } finally {
        setBusyId(null);
      }
    });

  /** Cambia el permiso de un miembro en 1 clic (optimista; se revierte si falla). */
  const changeRole = (member: WorkspaceMember, role: MemberRole) => {
    if (!workspaceId || member.role === role || member.role === "owner") return;
    const wsId = workspaceId;
    const previous = member.role;
    setMembers((list) => (list ?? []).map((m) => (m.userId === member.userId ? { ...m, role } : m)));
    void guard.run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      setBusyId(member.userId);
      try {
        await updateWorkspaceMemberRole(supabase, wsId, member.userId, role);
        announceAccess(wsId, member.userId, role);
        toast({ message: `${member.profile.fullName} ahora es ${ROLE_LABELS[role]}.`, tone: "success" });
        notifyByMail(wsId, member.userId, member.profile.fullName, "role_changed");
      } catch (error) {
        setMembers((list) =>
          (list ?? []).map((m) => (m.userId === member.userId ? { ...m, role: previous } : m))
        );
        if (error instanceof SocialSetupError) useSocialStore.getState().setSetupMissing(true);
        else toast({ message: describe(error, "No se pudo cambiar el permiso"), tone: "error" });
      } finally {
        setBusyId(null);
      }
    });
  };

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
          .then(() => announceAccess(wsId, member.userId, null))
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
          ? `Espacio de ${sharedWorkspace.ownerName}. Tu permiso: ${ROLE_LABELS[ownRole]}. Solo su dueño añade miembros o cambia permisos.`
          : "Elige qué puede hacer cada persona: editar, comentar o solo ver. Todos pueden entrar a su canal de voz."
      }
    >
      {!user || !workspaceId ? (
        <p className="text-sm text-andros-muted">
          Inicia sesión y abre un espacio en la nube para compartirlo.
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

          {/* Vista Invitado: solo el dueño la activa */}
          {isOwner && <GuestLinkSection workspaceId={workspaceId} workspaceName={workspaceName} />}

          {/* Estudio de exportación: PDF, .docx, .pptx y resumen para mensajería */}
          <section aria-labelledby="andros-share-export" className="space-y-1.5 pt-4 border-t border-andros-border">
            <h3 id="andros-share-export" className="text-xs font-semibold text-andros-primary">
              Exportar como documento
            </h3>
            <p className="text-[11px] leading-relaxed text-andros-muted">
              PDF imprimible, documento .docx, presentación .pptx o un resumen listo para pegar en
              el grupo de mensajería de tu equipo, con o sin síntesis de IA.
            </p>
            <button
              type="button"
              onClick={() => {
                close();
                usePlanExportStore.getState().setOpen(true);
              }}
              className={BUTTON_SECONDARY}
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              Abrir Estudio de exportación
            </button>
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
                        detail={
                          m.role === "owner"
                            ? "dueño"
                            : isOwner
                              ? undefined
                              : m.userId === user.id
                                ? `tú · ${ROLE_LABELS[m.role]}`
                                : ROLE_LABELS[m.role]
                        }
                      >
                        {isOwner && isMemberRole(m.role) && (
                          <RoleSelect
                            value={m.role}
                            disabled={busyId === m.userId}
                            label={`Permiso de ${m.profile.fullName}`}
                            onChange={(role) => changeRole(m, role)}
                          />
                        )}
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

              {mailNote && (
                <p role="status" className="text-[11px] leading-relaxed text-andros-muted">
                  {mailNote}
                </p>
              )}

              {/* Añadir amistades en 1 clic */}
              {isOwner && (
                <section aria-labelledby="andros-share-add" className="space-y-1">
                  <h3 id="andros-share-add" className="text-xs font-semibold text-andros-primary">
                    Añadir amigos
                  </h3>
                  {friendsToAdd.length > 0 && (
                    <div className="pb-1">
                      <p id="andros-share-add-role" className="mb-1 text-[11px] text-andros-muted">
                        Permiso al añadir
                      </p>
                      <RolePicker value={addRole} onChange={setAddRole} labelledBy="andros-share-add-role" />
                    </div>
                  )}
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
