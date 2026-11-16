"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Check, Plus, Send, Swords, Trophy, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";

// ============================================================================
// ANDROS ARENA — Retos de ingeniería y vacantes de empleo
// Datos en Supabase (`arena_opportunities` / `arena_applications`, ver
// supabase/arena.sql). Sin Supabase o sin la tabla: modo demostración local.
// ============================================================================

type Kind = "challenge" | "job";

interface Opportunity {
  id: string;
  kind: Kind;
  title: string;
  company: string;
  category: string;
  description: string;
  reward: string;
  isLocal?: boolean;
}

const CATEGORIES = ["Diseño 3D", "Simulación", "Cálculo", "Manufactura", "General"];

const DEMO_OPPORTUNITIES: Opportunity[] = [
  {
    id: "demo-1",
    kind: "challenge",
    title: "Optimiza un soporte de dron: -30 % de masa",
    company: "AeroLab Industrial",
    category: "Diseño 3D",
    description:
      "Rediseña un soporte de motor imprimible en 3D reduciendo masa sin bajar de FS 2.0. Entrega el modelo y la memoria de cálculo.",
    reward: "Premio: 1,500 USD",
    isLocal: true,
  },
  {
    id: "demo-2",
    kind: "challenge",
    title: "Verificación de nudo reticular K bajo fatiga",
    company: "Estructuras Norte",
    category: "Cálculo",
    description:
      "Verifica un nudo HSS tipo K según AWS D1.1 y propone una mejora de soldadura. Gana la memoria más clara y correcta.",
    reward: "Premio: 800 USD + entrevista",
    isLocal: true,
  },
  {
    id: "demo-3",
    kind: "job",
    title: "Ingeniero/a de Diseño Mecánico Jr.",
    company: "Forja Digital",
    category: "Manufactura",
    description:
      "Diseño de piezas para manufactura aditiva y mecanizado. Se valora portafolio con modelos 3D y cálculos.",
    reward: "Salario: 1,800–2,400 USD/mes",
    isLocal: true,
  },
  {
    id: "demo-4",
    kind: "job",
    title: "Analista de Simulación FEA",
    company: "Simula Labs",
    category: "Simulación",
    description:
      "Modelado y análisis de elementos finitos de componentes estructurales. Remoto, jornada completa.",
    reward: "Salario: 2,500–3,200 USD/mes",
    isLocal: true,
  },
];

interface Row {
  id: string;
  kind: Kind;
  title: string;
  company: string;
  category: string;
  description: string;
  reward: string | null;
}

const toOpportunity = (r: Row): Opportunity => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  company: r.company,
  category: r.category,
  description: r.description,
  reward: r.reward ?? "",
});

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return "Error desconocido";
}

const SETUP_HINT = "Ejecuta supabase/arena.sql en el SQL Editor de Supabase para activar la Arena en la nube.";

// ----------------------------------------------------------------------------
// Formulario de publicación
// ----------------------------------------------------------------------------

const PublishForm: React.FC<{
  onCancel: () => void;
  onPublished: (o: Opportunity, notice: string) => void;
}> = ({ onCancel, onPublished }) => {
  const user = useCloudStore((s) => s.user);
  const [kind, setKind] = useState<Kind>("challenge");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const c = company.trim();
    const d = description.trim();
    if (t.length < 4 || t.length > 120) return setError("El título debe tener entre 4 y 120 caracteres.");
    if (c.length < 2 || c.length > 80) return setError("Escribe el nombre de la empresa o equipo (2–80 caracteres).");
    if (d.length < 10 || d.length > 2000) return setError("La descripción debe tener entre 10 y 2000 caracteres.");
    setError(null);
    setBusy(true);

    const draft = { kind, title: t, company: c, category, description: d, reward: reward.trim().slice(0, 80) || null };
    const supabase = getSupabaseBrowserClient();

    if (supabase && user) {
      const { data, error: dbError } = await supabase
        .from("arena_opportunities")
        .insert(draft)
        .select("id, kind, title, company, category, description, reward")
        .single();
      setBusy(false);
      if (!dbError && data) {
        onPublished(toOpportunity(data as Row), "Publicado en la Arena.");
        return;
      }
      // Falla (p. ej. tabla sin crear): queda como simulación local.
      onPublished(
        { ...toOpportunity({ ...draft, id: `local-${Date.now()}` }), isLocal: true },
        `Publicado solo en este navegador (${errorText(dbError)}). ${SETUP_HINT}`
      );
      return;
    }
    setBusy(false);
    onPublished(
      { ...toOpportunity({ ...draft, id: `local-${Date.now()}` }), isLocal: true },
      "Publicación simulada en este navegador. Inicia sesión con Google para publicarla en la nube."
    );
  };

  const field =
    "w-full rounded-xl border border-andros-border bg-andros-canvas px-3 py-2 text-xs text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-accent";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-andros-border/30">
        {(["challenge", "job"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`min-h-[36px] rounded-lg text-xs font-medium ${
              kind === k ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted"
            }`}
          >
            {k === "challenge" ? "Reto / Concurso" : "Vacante de empleo"}
          </button>
        ))}
      </div>
      <input className={field} placeholder="Título" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <input className={field} placeholder="Empresa o equipo" value={company} maxLength={80} onChange={(e) => setCompany(e.target.value)} />
      <select className={field} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <textarea className={`${field} min-h-[90px] resize-y`} placeholder="Describe el reto o el puesto" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      <input className={field} placeholder={kind === "challenge" ? "Premio (opcional)" : "Salario (opcional)"} value={reward} maxLength={80} onChange={(e) => setReward(e.target.value)} />
      {error && (
        <p role="alert" className="text-[11px] text-red-500">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-[40px] rounded-xl border border-andros-border text-xs text-andros-muted hover:text-andros-primary">
          Cancelar
        </button>
        <button type="submit" disabled={busy} className="min-h-[40px] rounded-xl bg-andros-accent text-white text-xs font-semibold disabled:opacity-60">
          {busy ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </form>
  );
};

// ----------------------------------------------------------------------------
// Postulación con el espacio de trabajo como portafolio
// ----------------------------------------------------------------------------

const ApplyForm: React.FC<{
  opportunity: Opportunity;
  onDone: (notice: string) => void;
  onCancel: () => void;
}> = ({ opportunity, onDone, onCancel }) => {
  const user = useCloudStore((s) => s.user);
  const currentWorkspaceId = useCloudStore((s) => s.workspaceId);
  const workspaces = useWorkspaceManagerStore((s) => s.workspaces);
  const [workspaceId, setWorkspaceId] = useState<string>(currentWorkspaceId ?? workspaces[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !user || opportunity.isLocal) {
      onDone("Postulación simulada. Inicia sesión y usa una oferta de la nube para enviarla de verdad.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("arena_applications").insert({
      opportunity_id: opportunity.id,
      workspace_id: workspaceId || null,
      message: message.trim().slice(0, 1000) || null,
    });
    setBusy(false);
    if (error) {
      const dup = (error as { code?: string }).code === "23505";
      onDone(dup ? "Ya te habías postulado a esta oferta." : `No se pudo enviar: ${errorText(error)}`);
      return;
    }
    onDone("¡Postulación enviada con tu espacio como portafolio!");
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-andros-border bg-andros-canvas p-3">
      <p className="text-[11px] font-semibold text-andros-primary">Adjuntar mi espacio de Andros como portafolio</p>
      {workspaces.length > 0 ? (
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          aria-label="Espacio de trabajo"
          className="w-full rounded-lg border border-andros-border bg-andros-card px-2 py-2 text-xs text-andros-primary"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[11px] text-andros-muted">
          Inicia sesión con Google para adjuntar un espacio verificable (nodos, cálculos y modelos).
        </p>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        placeholder="Mensaje breve (opcional)"
        className="w-full min-h-[60px] rounded-lg border border-andros-border bg-andros-card px-2 py-2 text-xs text-andros-primary placeholder:text-andros-muted"
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-[36px] rounded-lg border border-andros-border text-xs text-andros-muted hover:text-andros-primary">
          Cancelar
        </button>
        <button type="button" disabled={busy} onClick={send} className="min-h-[36px] rounded-lg bg-andros-accent text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Send className="w-3.5 h-3.5" />
          {busy ? "Enviando…" : "Postularme"}
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------

export const ArenaModal: React.FC = () => {
  const open = useMarketStore((s) => s.arenaOpen);
  const setOpen = useMarketStore((s) => s.setArenaOpen);
  const animations = useSettingsStore((s) => s.animations);
  const user = useCloudStore((s) => s.user);

  const [tab, setTab] = useState<Kind>("challenge");
  const [items, setItems] = useState<Opportunity[]>(DEMO_OPPORTUNITIES);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState("Todas");

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("arena_opportunities")
      .select("id, kind, title, company, category, description, reward")
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      setNotice(`Modo demostración. ${SETUP_HINT}`);
      return;
    }
    const cloud = ((data ?? []) as Row[]).map(toOpportunity);
    // Las ofertas locales (demo y simuladas) se conservan debajo de las de la nube.
    setItems((prev) => [...cloud, ...prev.filter((p) => p.isLocal)]);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load, user?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const visible = useMemo(
    () => items.filter((i) => i.kind === tab && (category === "Todas" || i.category === category)),
    [items, tab, category]
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end md:items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: animations === "reduced" ? 0 : 0.18 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Andros Arena"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={animations === "reduced" ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 32, mass: 0.8 }}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-andros-primary">
                <Swords className="w-4 h-4 text-andros-accent" />
                <h2 className="text-sm font-semibold">Andros Arena · Retos y Empleos</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar Arena" className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40">
                <X className="w-4 h-4" />
              </button>
            </div>

            {showForm ? (
              <PublishForm
                onCancel={() => setShowForm(false)}
                onPublished={(o, msg) => {
                  setItems((prev) => [o, ...prev]);
                  setTab(o.kind);
                  setCategory("Todas");
                  setShowForm(false);
                  setNotice(msg);
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-andros-border/30 flex-1 min-w-[220px]">
                    {(["challenge", "job"] as Kind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTab(k)}
                        className={`min-h-[36px] rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 ${
                          tab === k ? "bg-andros-card text-andros-primary shadow-sm border border-andros-border-active" : "text-andros-muted"
                        }`}
                      >
                        {k === "challenge" ? <Trophy className="w-3.5 h-3.5" /> : <Briefcase className="w-3.5 h-3.5" />}
                        {k === "challenge" ? "Retos / Concursos" : "Vacantes"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setShowForm(true);
                    }}
                    className="min-h-[40px] px-3 rounded-xl bg-andros-accent text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Publicar
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {["Todas", ...CATEGORIES].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`px-2.5 py-1 rounded-full text-[11px] border ${
                        category === c ? "border-andros-accent text-andros-accent bg-andros-accent/10" : "border-andros-border text-andros-muted hover:text-andros-primary"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                {notice && (
                  <p role="status" className="text-[11px] text-andros-muted rounded-lg bg-andros-border/30 px-3 py-2">
                    {notice}
                  </p>
                )}
                {loading && <p className="text-[11px] text-andros-muted">Cargando…</p>}

                <ul className="space-y-2.5">
                  {visible.length === 0 && !loading && (
                    <li className="text-xs text-andros-muted text-center py-6">No hay publicaciones en esta categoría todavía.</li>
                  )}
                  {visible.map((o) => (
                    <li key={o.id} className="rounded-xl border border-andros-border bg-andros-canvas p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-andros-primary">{o.title}</h3>
                          <p className="text-[11px] text-andros-muted mt-0.5">
                            {o.company} · {o.category}
                            {o.isLocal ? " · demo" : ""}
                          </p>
                        </div>
                        {o.reward && <span className="shrink-0 text-[11px] font-mono text-andros-success text-right">{o.reward}</span>}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-andros-muted">{o.description}</p>
                      {applyingId === o.id ? (
                        <ApplyForm
                          opportunity={o}
                          onCancel={() => setApplyingId(null)}
                          onDone={(msg) => {
                            setApplyingId(null);
                            setNotice(msg);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setApplyingId(o.id)}
                          className="mt-3 min-h-[36px] px-3 rounded-lg border border-andros-border-active text-xs font-medium text-andros-primary hover:border-andros-accent flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5 text-andros-accent" />
                          {o.kind === "challenge" ? "Participar con mi espacio" : "Postularme con mi espacio"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
