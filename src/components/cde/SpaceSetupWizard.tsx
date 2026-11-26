"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Search, Sparkles, UserPlus, Users, X } from "lucide-react";
import { useCloudStore } from "@/store/useCloudStore";
import { useSocialStore } from "@/store/useSocialStore";
import { useCdeStore } from "@/store/useCdeStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { toast } from "@/store/useToastStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { searchProfiles, sendFriendRequest } from "@/lib/social/repository";
import { MEMBER_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from "@/lib/access/permissions";
import { AREA_MAX_COUNT, AREA_PRESETS, areaKey, canonicalArea, normalizeAreaName } from "@/lib/cde/areas";
import { applySpaceSetup, type SetupMemberChoice } from "@/lib/cde/setupActions";
import { SETUP_DESCRIPTION_MAX } from "@/lib/cde/setup";
import { springOrInstant } from "@/lib/motion";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { ProfileAvatar } from "@/components/social/SocialDialog";
import type { BasicProfile } from "@/types/social";
import { AreaBadge } from "./CdeBits";

// ============================================================================
// ANDROS — ARRANQUE GUIADO EN 3 PASOS (Sprint 18)
//   1. Equipo: amistades o @usuario con su permiso (o proyecto personal).
//   2. Áreas de trabajo nominales para cada persona (y el dueño).
//   3. Qué fichas necesita el proyecto → la IA (o el respaldo local) crea los
//      formatos y el tablero inicial organizado por áreas.
// Saltable en todo momento con «Entrar a un lienzo vacío».
// ============================================================================

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, string> = { 1: "Equipo", 2: "Áreas de trabajo", 3: "Fichas con IA" };

const DESCRIPTION_EXAMPLES = [
  "Fichas de control de compras, actas de entrega y seguimiento de incidencias",
  "Revisión de diseño, inspección de calidad y minutas de reunión",
  "Inventario de materiales, control de gastos y registro de asistencia",
];

const BUTTON_PRIMARY =
  "min-h-11 md:min-h-10 px-4 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none";
const BUTTON_SECONDARY =
  "min-h-11 md:min-h-10 px-3 rounded-xl border border-andros-border text-sm font-medium text-andros-primary hover:bg-andros-border/40 flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50";
const INPUT =
  "w-full min-w-0 h-11 md:h-10 px-3 rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none text-sm text-andros-primary placeholder:text-andros-muted";
const SELECT =
  "h-11 md:h-8 px-2 rounded-lg bg-andros-canvas border border-andros-border text-xs text-andros-primary focus:border-andros-accent outline-none";

interface Picked {
  profile: BasicProfile;
  role: MemberRole;
  existing: boolean;
}

interface Props {
  variant: "canvas" | "stack";
  onSkip: () => void;
  onShowTemplates: () => void;
}

export const SpaceSetupWizard: React.FC<Props> = ({ variant, onSkip, onShowTemplates }) => {
  const titleId = useId();
  const reduced = useSettingsStore((s) => s.animations) === "reduced";
  const user = useCloudStore((s) => s.user);
  const workspaceId = useCloudStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceManagerStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name ?? "");
  const people = useCdeStore((s) => s.people);
  const savedAreas = useCdeStore((s) => s.areas);

  const [step, setStep] = useState<Step>(1);
  const [newPicks, setPicked] = useState<Map<string, Picked>>(new Map());
  // `null` = aún sin tocar: se usan las áreas ya guardadas del espacio.
  const [areasDraft, setAreasDraft] = useState<string[] | null>(null);
  const [assignDraft, setAssign] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const guard = useSubmitGuard();

  useEffect(() => () => abortRef.current?.abort(), []);

  // Miembros que ya estaban en el espacio y áreas ya guardadas: se respetan.
  const picked = useMemo(() => {
    const map = new Map<string, Picked>();
    for (const p of people) {
      if (p.role === "owner") continue;
      map.set(p.userId, {
        profile: { id: p.userId, username: p.username, fullName: p.name, avatarUrl: null },
        role: p.role,
        existing: true,
      });
    }
    for (const [id, pick] of newPicks) if (!map.has(id)) map.set(id, pick);
    return map;
  }, [people, newPicks]);
  const areas = areasDraft ?? savedAreas;
  const setAreas = (update: (list: string[]) => string[]) => setAreasDraft((prev) => update(prev ?? savedAreas));
  const assign = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const p of people) if (p.area) merged[p.userId] = p.area;
    return { ...merged, ...assignDraft };
  }, [people, assignDraft]);

  const ownerKey = user?.id ?? "local";
  const team = [...picked.values()];

  const finish = () =>
    guard.run(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const members: SetupMemberChoice[] = team.map((p) => ({
          userId: p.profile.id,
          name: p.profile.fullName,
          username: p.profile.username,
          role: p.role,
          area: canonicalArea(assign[p.profile.id] ?? "", areas) ?? "",
          existing: p.existing,
        }));
        await applySpaceSetup({
          projectName: projectName.trim() || workspaceName,
          members,
          areas,
          ownerArea: canonicalArea(assign[ownerKey] ?? "", areas) ?? "",
          description,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast({ message: error instanceof Error ? error.message : "No se pudo preparar el espacio.", tone: "error" });
      } finally {
        abortRef.current = null;
      }
    });

  // Escape = entrar al lienzo vacío (solo en escritorio, donde es un diálogo).
  useEffect(() => {
    if (variant !== "canvas") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || guard.pending) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-wizard-keep-escape]")) return;
      e.stopPropagation();
      onSkip();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [variant, onSkip, guard.pending]);

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
          <Users className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-andros-muted">
            Paso <span className="font-mono tabular-nums">{step}</span> de <span className="font-mono tabular-nums">3</span>
          </p>
          <h2 id={titleId} className="text-base font-semibold text-andros-primary">
            {STEP_TITLES[step]}
          </h2>
        </div>
        <ol aria-hidden="true" className="flex gap-1 pt-1.5">
          {([1, 2, 3] as Step[]).map((s) => (
            <li key={s} className={`w-6 h-1.5 rounded-full ${s <= step ? "bg-andros-accent" : "bg-andros-border-active"}`} />
          ))}
        </ol>
      </div>

      <div className="mt-4">
        {step === 1 && <TeamStep signedIn={Boolean(user && workspaceId)} picked={picked} setPicked={setPicked} />}
        {step === 2 && (
          <AreasStep
            areas={areas}
            setAreas={setAreas}
            assign={assign}
            setAssign={setAssign}
            ownerKey={ownerKey}
            ownerName={user?.name?.trim() || "Tú"}
            team={team}
          />
        )}
        {step === 3 && (
          <FormsStep
            description={description}
            setDescription={setDescription}
            projectName={projectName}
            setProjectName={setProjectName}
            workspaceName={workspaceName}
            showName={Boolean(user && workspaceId)}
            pending={guard.pending}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {step > 1 && (
          <button type="button" disabled={guard.pending} onClick={() => setStep((s) => (s - 1) as Step)} className={BUTTON_SECONDARY}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Atrás
          </button>
        )}
        <span className="flex-1" />
        {step < 3 ? (
          <button type="button" onClick={() => setStep((s) => (s + 1) as Step)} className={BUTTON_PRIMARY}>
            {step === 1 && team.length === 0 ? "Continuar como proyecto personal" : "Continuar"}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" disabled={guard.pending} onClick={() => void finish()} className={BUTTON_PRIMARY}>
            {guard.pending ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
            {guard.pending ? "Preparando…" : "Crear fichas y tablero"}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onSkip}
          disabled={guard.pending}
          className="min-h-11 md:min-h-9 px-2 text-xs text-andros-muted underline underline-offset-2 hover:text-andros-primary disabled:opacity-50"
        >
          Entrar a un lienzo vacío
        </button>
        <button
          type="button"
          onClick={onShowTemplates}
          disabled={guard.pending}
          className="min-h-11 md:min-h-9 px-2 text-xs text-andros-muted underline underline-offset-2 hover:text-andros-primary disabled:opacity-50"
        >
          Ver plantillas rápidas
        </button>
      </div>
    </>
  );

  if (variant === "stack") {
    return (
      <section aria-labelledby={titleId} className="rounded-2xl bg-andros-card border border-andros-border shadow-card-light dark:shadow-card-dark p-4">
        {body}
      </section>
    );
  }

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[35] bg-andros-canvas/70 backdrop-blur-[2px]" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springOrInstant(reduced)}
        className="fixed z-[36] left-1/2 top-[50%] -translate-x-1/2 -translate-y-1/2 w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100vh-9rem)] overflow-y-auto p-5 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
      >
        {body}
      </motion.section>
    </>
  );
};

// ----------------------------------------------------------------------------
// Paso 1 — Equipo
// ----------------------------------------------------------------------------

const TeamStep: React.FC<{
  signedIn: boolean;
  picked: Map<string, Picked>;
  setPicked: React.Dispatch<React.SetStateAction<Map<string, Picked>>>;
}> = ({ signedIn, picked, setPicked }) => {
  const user = useCloudStore((s) => s.user);
  const friendships = useSocialStore((s) => s.friendships);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; list: BasicProfile[] }>({ q: "", list: [] });
  const [requested, setRequested] = useState<string[]>([]);
  const searchId = useId();

  const friends = useMemo(() => friendships.filter((f) => f.status === "accepted").map((f) => f.other), [friendships]);
  const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);

  const term = query.trim().replace(/^@/, "");
  const searchActive = signedIn && term.length >= 2;
  const selfId = user?.id;
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!searchActive || !supabase) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchProfiles(supabase, term)
        .then((list) => alive && setFound({ q: term, list: list.filter((p) => p.id !== selfId).slice(0, 8) }))
        .catch(() => alive && setFound({ q: term, list: [] }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, searchActive, selfId]);
  const results = searchActive && found.q === term ? found.list : [];
  const searching = searchActive && found.q !== term;

  if (!signedIn) {
    return (
      <p className="rounded-xl border border-andros-border bg-andros-canvas p-3 text-xs leading-relaxed text-andros-muted">
        Inicia sesión y abre un espacio en la nube para invitar a tu equipo. Mientras tanto, puedes continuar como proyecto personal: las áreas y
        las fichas funcionan igual en este dispositivo.
      </p>
    );
  }

  const toggle = (profile: BasicProfile) =>
    setPicked((prev) => {
      const next = new Map(prev);
      const current = next.get(profile.id);
      if (current?.existing) return prev;
      if (current) next.delete(profile.id);
      else next.set(profile.id, { profile, role: "editor", existing: false });
      return next;
    });

  const setRole = (id: string, role: MemberRole) =>
    setPicked((prev) => {
      const current = prev.get(id);
      if (!current || current.existing) return prev;
      return new Map(prev).set(id, { ...current, role });
    });

  const request = async (profile: BasicProfile) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !user) return;
    try {
      const result = await sendFriendRequest(supabase, user.id, profile.id, friendships);
      setRequested((r) => [...r, profile.id]);
      toast({
        message:
          result === "accepted" || result === "already-friends"
            ? `${profile.fullName} ya es tu amistad: puedes incluirle.`
            : `Solicitud enviada a ${profile.fullName}. Podrás incluirle cuando la acepte.`,
        tone: "success",
      });
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : "No se pudo enviar la solicitud.", tone: "error" });
    }
  };

  const existing = [...picked.values()].filter((p) => p.existing);
  const shownFriends = friends.filter((f) => !picked.get(f.id)?.existing);
  const extraResults = results.filter((r) => !friendIds.has(r.id));
  const q = areaKey(query.trim().replace(/^@/, ""));
  const visibleFriends =
    q.length >= 2
      ? shownFriends.filter(
          (f) => results.some((r) => r.id === f.id) || areaKey(f.fullName).includes(q) || areaKey(f.username ?? "").includes(q)
        )
      : shownFriends;

  const row = (profile: BasicProfile) => {
    const choice = picked.get(profile.id);
    return (
      <li key={profile.id} className="flex flex-wrap items-center gap-2 p-2 rounded-xl border border-andros-border bg-andros-canvas">
        <ProfileAvatar size="sm" profile={profile} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-andros-primary truncate">{profile.fullName}</span>
          {profile.username && <span className="block text-[11px] text-andros-muted">@{profile.username}</span>}
        </span>
        {choice && !choice.existing && (
          <select
            aria-label={`Permiso de ${profile.fullName}`}
            value={choice.role}
            onChange={(e) => setRole(profile.id, e.currentTarget.value as MemberRole)}
            className={SELECT}
          >
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          aria-pressed={Boolean(choice)}
          onClick={() => toggle(profile)}
          className={`min-h-11 md:min-h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 active:scale-[0.96] spring-micro ${
            choice ? "bg-andros-accent-fill text-white" : "border border-andros-border text-andros-primary hover:bg-andros-border/40"
          }`}
        >
          {choice ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
          {choice ? "Incluida" : "Incluir"}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-andros-muted">
        Elige quién trabaja en este espacio y con qué permiso. Solo se pueden incluir amistades aceptadas.
      </p>
      {existing.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-andros-muted">Ya en el espacio</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {existing.map((p) => (
              <li key={p.profile.id} className="px-2 py-1 rounded-lg border border-andros-border text-xs text-andros-primary">
                {p.profile.fullName} · {ROLE_LABELS[p.role]}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Buscar por @usuario o nombre
        </label>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-andros-muted" aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Buscar @usuario o nombre"
          autoComplete="off"
          data-wizard-keep-escape
          className={`${INPUT} pl-9`}
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-andros-muted motion-safe:animate-spin" aria-hidden="true" />
        )}
      </div>
      {extraResults.length > 0 && (
        <ul aria-label="Resultados de la búsqueda" className="space-y-1.5">
          {extraResults.map((p) => (
            <li key={p.id} className="flex items-center gap-2 p-2 rounded-xl border border-andros-border bg-andros-canvas">
              <ProfileAvatar size="sm" profile={p} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-andros-primary truncate">{p.fullName}</span>
                {p.username && <span className="block text-[11px] text-andros-muted">@{p.username}</span>}
              </span>
              <button
                type="button"
                disabled={requested.includes(p.id)}
                onClick={() => void request(p)}
                className="min-h-11 md:min-h-8 px-2.5 rounded-lg border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                {requested.includes(p.id) ? "Solicitud enviada" : "Solicitar amistad"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {visibleFriends.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-andros-muted">Tus amistades</p>
          <ul className="mt-1.5 space-y-1.5 max-h-64 overflow-y-auto">{visibleFriends.map(row)}</ul>
        </div>
      ) : (
        friends.length === 0 && (
          <p className="text-xs text-andros-muted">Aún no tienes amistades en Andros: busca su @usuario y envía una solicitud.</p>
        )
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Paso 2 — Áreas nominales
// ----------------------------------------------------------------------------

const AreasStep: React.FC<{
  areas: string[];
  setAreas: (update: (list: string[]) => string[]) => void;
  assign: Record<string, string>;
  setAssign: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  ownerKey: string;
  ownerName: string;
  team: Picked[];
}> = ({ areas, setAreas, assign, setAssign, ownerKey, ownerName, team }) => {
  const [custom, setCustom] = useState("");
  const customId = useId();
  const full = areas.length >= AREA_MAX_COUNT;

  const add = (raw: string) => {
    const name = normalizeAreaName(raw);
    if (!name) return;
    setAreas((list) => (list.some((a) => areaKey(a) === areaKey(name)) || list.length >= AREA_MAX_COUNT ? list : [...list, name]));
  };
  const remove = (name: string) => {
    setAreas((list) => list.filter((a) => a !== name));
    setAssign((prev) => Object.fromEntries(Object.entries(prev).filter(([, v]) => areaKey(v) !== areaKey(name))));
  };

  const people = [{ id: ownerKey, name: `${ownerName} (tú)` }, ...team.map((p) => ({ id: p.profile.id, name: p.profile.fullName }))];

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-andros-muted">
        Las áreas ordenan el tablero y se mencionan en el chat con @Área para avisar a todo ese equipo a la vez.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {AREA_PRESETS.map((preset) => {
          const on = areas.some((a) => areaKey(a) === areaKey(preset));
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => (on ? remove(areas.find((a) => areaKey(a) === areaKey(preset)) ?? preset) : add(preset))}
              className={`min-h-11 md:min-h-8 px-3 rounded-xl text-xs font-medium flex items-center gap-1 active:scale-[0.96] spring-micro disabled:opacity-50 ${
                on ? "bg-andros-accent-fill text-white" : "border border-andros-border text-andros-primary hover:bg-andros-border/40"
              }`}
            >
              {on ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
              {preset}
            </button>
          );
        })}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(custom);
          setCustom("");
        }}
      >
        <label htmlFor={customId} className="sr-only">
          Nueva área personalizada
        </label>
        <input
          id={customId}
          value={custom}
          onChange={(e) => setCustom(e.currentTarget.value)}
          maxLength={40}
          placeholder="Otra área (p. ej. Compras, Calidad)"
          className={INPUT}
        />
        <button type="submit" disabled={!normalizeAreaName(custom) || full} className={BUTTON_SECONDARY}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Añadir
        </button>
      </form>
      {areas.length > 0 && (
        <ul aria-label="Áreas activas" className="flex flex-wrap gap-1.5">
          {areas.map((a) => (
            <li key={a} className="flex items-center gap-0.5">
              <AreaBadge area={a} />
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Quitar el área ${a}`}
                className="w-11 h-11 md:w-6 md:h-6 rounded-md flex items-center justify-center text-andros-muted hover:text-andros-danger active:scale-[0.96] spring-micro"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-andros-muted">Área de cada persona</p>
        <ul className="mt-1.5 space-y-1.5">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 p-2 rounded-xl border border-andros-border bg-andros-canvas">
              <span className="min-w-0 flex-1 text-sm text-andros-primary truncate">{p.name}</span>
              <select
                aria-label={`Área de ${p.name}`}
                value={canonicalArea(assign[p.id] ?? "", areas) ?? ""}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setAssign((prev) => ({ ...prev, [p.id]: value }));
                }}
                disabled={areas.length === 0}
                className={SELECT}
              >
                <option value="">Sin área</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {areas.length === 0 && <p className="mt-1.5 text-[11px] text-andros-muted">Elige o crea al menos un área para asignarla.</p>}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Paso 3 — Diseño de fichas con IA
// ----------------------------------------------------------------------------

const FormsStep: React.FC<{
  description: string;
  setDescription: (v: string) => void;
  projectName: string;
  setProjectName: (v: string) => void;
  workspaceName: string;
  showName: boolean;
  pending: boolean;
  onCancel: () => void;
}> = ({ description, setDescription, projectName, setProjectName, workspaceName, showName, pending, onCancel }) => {
  const descId = useId();
  const nameId = useId();
  return (
    <div className="space-y-3">
      {showName && (
        <div>
          <label htmlFor={nameId} className="text-xs font-medium text-andros-primary">
            Nombre del proyecto
          </label>
          <input
            id={nameId}
            value={projectName}
            onChange={(e) => setProjectName(e.currentTarget.value)}
            maxLength={80}
            placeholder={workspaceName || "Nuevo espacio"}
            className={`${INPUT} mt-1`}
          />
        </div>
      )}
      <div>
        <label htmlFor={descId} className="text-xs font-medium text-andros-primary">
          ¿Qué tipos de fichas necesita este proyecto?
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value.slice(0, SETUP_DESCRIPTION_MAX))}
          rows={3}
          disabled={pending}
          placeholder="Ej.: Fichas de control de compras, actas de entrega y seguimiento de incidencias"
          className="mt-1 w-full resize-none px-3 py-2 rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none text-sm text-andros-primary placeholder:text-andros-muted disabled:opacity-60"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-andros-muted">
          La IA diseña los campos de cada ficha y arma el tablero por áreas. Sin sesión o sin cuota, se crean fichas base sin IA.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DESCRIPTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={pending}
            onClick={() => setDescription(ex)}
            className="min-h-11 md:min-h-8 px-3 py-1.5 rounded-xl border border-andros-border bg-andros-canvas text-left text-xs leading-snug text-andros-primary hover:border-andros-border-active active:scale-[0.96] spring-micro disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
      {pending && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-andros-border bg-andros-canvas p-3">
          <Loader2 className="w-4 h-4 shrink-0 text-andros-accent-ink motion-safe:animate-spin" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-andros-primary">Diseñando fichas y organizando el tablero por áreas…</span>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 md:min-h-9 px-3 rounded-lg text-xs font-medium text-andros-muted hover:text-andros-primary active:scale-[0.96] spring-micro"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
};
