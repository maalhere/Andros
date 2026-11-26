"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, ScanSearch, ShieldAlert, Sparkles, X } from "lucide-react";
import {
  ARENA_DISCIPLINES,
  ARENA_LEVELS,
  ARENA_TYPE_LABELS,
  ARENA_TYPES,
  type ArenaAnalyzeResponse,
  type ArenaDiscipline,
  type ArenaLevel,
  type ArenaPost,
  type ArenaPostDraft,
  type ArenaPostType,
} from "@/types/arena";
import { keywordAnalyze } from "@/lib/arena/keywordTagger";
import { publishArenaPost } from "@/lib/arena/repository";
import { useCloudStore } from "@/store/useCloudStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { ConsentCheckbox } from "@/components/legal/ConsentCheckbox";
import { sessionAuthHeader } from "@/lib/supabase/authHeader";

// ============================================================================
// ANDROS ARENA — FORMULARIO DE PUBLICACIÓN
// 1) Datos  →  2) «Escanear y generar etiquetas IA» (vista previa editable)
// →  3) Publicar. Si los datos cambian tras escanear, se pide re-escanear.
// ============================================================================

const fieldBase =
  "w-full rounded-xl border bg-andros-canvas px-3 py-2 max-md:min-h-[44px] text-xs text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-accent";
const field = `${fieldBase} border-andros-border`;

type FieldKey = "title" | "organization" | "description";
type FieldErrors = Partial<Record<FieldKey | "consent", string>>;

const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? (
    <p id={id} className="mt-1 text-[11px] text-andros-danger">
      {message}
    </p>
  ) : null;

const PLACEHOLDERS: Record<ArenaPostType, { title: string; description: string; stipend: string }> = {
  challenge: {
    title: "Ej: Reto — reduce 30 % la masa de un soporte impreso en 3D",
    description: "Objetivo, contexto técnico, entregables (modelo, cálculo, informe), criterios de evaluación y fecha límite.",
    stipend: "Premio (opcional)",
  },
  activity: {
    title: "Ej: Actividad — simulación térmica de un disipador",
    description: "Qué deben hacer los participantes, herramientas sugeridas, entregables y cómo se evaluará.",
    stipend: "Reconocimiento o puntos (opcional)",
  },
  internship: {
    title: "Ej: Prácticas en diseño CAD estructural",
    description: "Responsabilidades, requisitos, duración, horario y qué aprenderá la persona.",
    stipend: "Apoyo económico (opcional)",
  },
  job: {
    title: "Ej: Ingeniero/a Mecánico Junior — manufactura aditiva",
    description: "Responsabilidades, requisitos, experiencia, modalidad y beneficios.",
    stipend: "Rango salarial (opcional)",
  },
};

export const ArenaPublishForm: React.FC<{
  cloudReady: boolean;
  onCancel: () => void;
  onPublished: (post: ArenaPost, notice: string) => void;
}> = ({ cloudReady, onCancel, onPublished }) => {
  const user = useCloudStore((s) => s.user);
  const [type, setType] = useState<ArenaPostType>("challenge");
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [description, setDescription] = useState("");
  const [stipend, setStipend] = useState("");
  const [location, setLocation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const scanGuard = useSubmitGuard();
  const publishGuard = useSubmitGuard();
  const scanning = scanGuard.pending;
  const publishing = publishGuard.pending;
  const [analysis, setAnalysis] = useState<ArenaAnalyzeResponse | null>(null);
  const [scannedKey, setScannedKey] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState("");

  const draft: ArenaPostDraft = useMemo(
    () => ({
      type,
      title: title.trim(),
      organization: organization.trim(),
      description: description.trim(),
      stipend: stipend.trim() || undefined,
      location: location.trim() || undefined,
    }),
    [type, title, organization, description, stipend, location]
  );
  const draftKey = JSON.stringify(draft);
  const stale = analysis !== null && scannedKey !== draftKey;

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (draft.title.length < 4 || draft.title.length > 140) next.title = "El título debe tener entre 4 y 140 caracteres.";
    if (draft.organization.length < 2 || draft.organization.length > 100) next.organization = "Escribe la organización, laboratorio o profesor/a (2–100 caracteres).";
    if (draft.description.length < 20 || draft.description.length > 4000) next.description = `La descripción necesita al menos 20 caracteres (llevas ${draft.description.length}).`;
    return next;
  };

  /** Lleva el foco al primer campo con error (accesible por teclado y lector). */
  const focusFirstError = (errs: FieldErrors) => {
    const first = (["title", "organization", "description", "consent"] as const).find((k) => errs[k]);
    if (first) document.getElementById(`arena-${first}`)?.focus();
  };

  const scan = () =>
    scanGuard.run(async () => {
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length > 0) return focusFirstError(problems);
    const key = draftKey;
    try {
      const res = await fetch("/api/arena/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sessionAuthHeader()) },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as ArenaAnalyzeResponse | { error: string };
      if ("error" in data) throw new Error(data.error);
      setAnalysis(data);
    } catch {
      // Sin servidor o sin red: el mismo analizador corre en el navegador.
      setAnalysis({ ...keywordAnalyze(draft), notice: "Sin conexión con el escáner IA: etiquetas generadas con el analizador local de tu navegador." });
    } finally {
      setScannedKey(key);
    }
    });

  // Doble clic o Enter repetido: el candado de useSubmitGuard evita duplicados.
  const publish = () =>
    publishGuard.run(async () => {
      if (!analysis || stale) return;
      if (analysis.moderation.status === "rejected") return;
      if (!consent) {
        const next = { ...errors, consent: "Marca la casilla para poder publicar." };
        setErrors(next);
        return focusFirstError(next);
      }
      setPublishError(null);
      try {
        const result = await publishArenaPost(draft, analysis, user ? { id: user.id, name: user.name } : null, cloudReady);
        onPublished(result.post, result.notice);
      } catch {
        setPublishError("No se pudo publicar. Revisa tu conexión e inténtalo de nuevo; no se ha publicado nada.");
      }
    });

  // Edición de etiquetas en la vista previa.
  const toggleDiscipline = (d: ArenaDiscipline) =>
    analysis &&
    setAnalysis({
      ...analysis,
      tags: {
        ...analysis.tags,
        discipline: analysis.tags.discipline.includes(d) ? analysis.tags.discipline.filter((x) => x !== d) : [...analysis.tags.discipline, d].slice(0, 3),
      },
    });
  const toggleLevel = (l: ArenaLevel) =>
    analysis &&
    setAnalysis({
      ...analysis,
      tags: { ...analysis.tags, level: analysis.tags.level.includes(l) ? analysis.tags.level.filter((x) => x !== l) : [...analysis.tags.level, l].slice(0, 2) },
    });
  const removeSkill = (s: string) => analysis && setAnalysis({ ...analysis, tags: { ...analysis.tags, skills: analysis.tags.skills.filter((x) => x !== s) } });
  const addSkill = () => {
    const s = skillDraft.trim().slice(0, 28);
    if (!analysis || !s || analysis.tags.skills.includes(s)) return setSkillDraft("");
    setAnalysis({ ...analysis, tags: { ...analysis.tags, skills: [...analysis.tags.skills, s].slice(0, 10) } });
    setSkillDraft("");
  };

  const ph = PLACEHOLDERS[type];
  const mod = analysis?.moderation;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="Volver a la lista" className="w-11 h-11 md:w-8 md:h-8 -ml-2 md:-ml-1.5 flex items-center justify-center rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-andros-primary">Publicar en la Arena</h3>
      </div>

      <div role="radiogroup" aria-label="Tipo de publicación" className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-andros-border/30">
        {ARENA_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={`min-h-[44px] md:min-h-[34px] rounded-lg text-xs font-medium active:scale-[0.96] spring-micro ${type === t ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted"}`}
          >
            {ARENA_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        <div className="md:col-span-2">
          <input
            id="arena-title"
            className={`${fieldBase} ${errors.title ? "border-andros-danger" : "border-andros-border"}`}
            placeholder={ph.title}
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Título"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "arena-title-error" : undefined}
          />
          <FieldError id="arena-title-error" message={errors.title} />
        </div>
        <div>
          <input
            id="arena-organization"
            className={`${fieldBase} ${errors.organization ? "border-andros-danger" : "border-andros-border"}`}
            placeholder="Organización, laboratorio o profesor/a"
            value={organization}
            maxLength={100}
            onChange={(e) => setOrganization(e.target.value)}
            aria-label="Organización"
            aria-invalid={Boolean(errors.organization)}
            aria-describedby={errors.organization ? "arena-organization-error" : undefined}
          />
          <FieldError id="arena-organization-error" message={errors.organization} />
        </div>
        <input className={field} placeholder="Ubicación o «Remoto» (opcional)" value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} aria-label="Ubicación" />
        <div className="md:col-span-2">
          <div className="relative">
          <textarea
            id="arena-description"
            className={`${fieldBase} ${errors.description ? "border-andros-danger" : "border-andros-border"} min-h-[130px] resize-y pb-6`}
            placeholder={ph.description}
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Descripción"
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "arena-description-error" : undefined}
          />
          <span className="absolute right-3 bottom-2.5 text-[10px] font-mono tabular-nums text-andros-muted pointer-events-none" aria-hidden="true">
            {description.length}/4000
          </span>
          </div>
          <FieldError id="arena-description-error" message={errors.description} />
        </div>
        <input className={`${field} md:col-span-2`} placeholder={ph.stipend} value={stipend} maxLength={80} onChange={(e) => setStipend(e.target.value)} aria-label="Premio, apoyo o salario" />
      </div>

      {Object.keys(errors).some((k) => k !== "consent") && (
        <p role="alert" className="text-[11px] text-andros-danger">
          Revisa los campos marcados antes de escanear.
        </p>
      )}

      <button
        type="button"
        onClick={() => void scan()}
        disabled={scanning}
        aria-busy={scanning}
        className="w-full min-h-[44px] rounded-xl border border-andros-accent/60 bg-andros-accent/10 text-andros-accent-ink text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-70 spring-micro active:scale-[0.99]"
      >
        {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
        {scanning ? "Escaneando seguridad y calidad…" : analysis ? (stale ? "Cambiaste datos: volver a escanear" : "Volver a escanear") : "Escanear y generar etiquetas IA"}
      </button>

      {/* Vista previa del análisis */}
      {analysis && mod && (
        <section className={`rounded-xl border p-3.5 space-y-3 ${stale ? "opacity-60" : ""} border-andros-border bg-andros-canvas`} aria-label="Resultado del escáner">
          <div className="flex flex-wrap items-center gap-2">
            {mod.status === "approved" && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-andros-success">
                <CheckCircle2 className="w-4 h-4" /> Aprobada
              </span>
            )}
            {mod.status === "needs_review" && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-andros-warning">
                <AlertTriangle className="w-4 h-4" /> Publicable, pero conviene mejorarla
              </span>
            )}
            {mod.status === "rejected" && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-andros-danger">
                <ShieldAlert className="w-4 h-4" /> Bloqueada por el filtro de seguridad
              </span>
            )}
            <span className="ml-auto text-[10px] font-mono text-andros-muted flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-andros-accent-ink" />
              {analysis.engine === "gemini" ? "Escáner IA" : "Analizador local"}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-andros-muted mb-1">
              <span>Calidad de la publicación</span>
              <span className="tabular-nums">{mod.qualityScore}/100</span>
            </div>
            <div className="h-1.5 rounded-full bg-andros-border/60 overflow-hidden">
              <div
                className={`h-full rounded-full ${mod.qualityScore >= 75 ? "bg-andros-success" : mod.qualityScore >= 55 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${mod.qualityScore}%` }}
              />
            </div>
          </div>

          {analysis.notice && <p className="text-[11px] text-andros-muted rounded-lg bg-andros-border/30 px-2.5 py-1.5">{analysis.notice}</p>}

          {mod.issues.length > 0 && (
            <ul className="space-y-1">
              {mod.issues.map((i) => (
                <li key={i} className="text-[11px] text-andros-danger flex gap-1.5">
                  <span aria-hidden>•</span>
                  {i}
                </li>
              ))}
            </ul>
          )}
          {mod.suggestions.length > 0 && (
            <ul className="space-y-1">
              {mod.suggestions.map((s) => (
                <li key={s} className="text-[11px] text-andros-muted flex gap-1.5">
                  <span aria-hidden>→</span>
                  {s}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-andros-muted">Etiquetas (toca para ajustar)</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-andros-primary text-andros-canvas">{ARENA_TYPE_LABELS[analysis.tags.type]}</span>
              {ARENA_DISCIPLINES.map((d) => {
                const on = analysis.tags.discipline.includes(d);
                if (!on && analysis.tags.discipline.length >= 3) return null;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDiscipline(d)}
                    className={`px-2 py-0.5 rounded-full text-[11px] border ${on ? "border-andros-accent bg-andros-accent/10 text-andros-accent-ink" : "border-dashed border-andros-border text-andros-muted hover:text-andros-primary"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ARENA_LEVELS.map((l) => {
                const on = analysis.tags.level.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLevel(l)}
                    className={`px-2 py-0.5 rounded-full text-[11px] border ${on ? "border-andros-success bg-andros-success/10 text-andros-success" : "border-dashed border-andros-border text-andros-muted hover:text-andros-primary"}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {analysis.tags.skills.map((s) => (
                <span key={s} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] border border-andros-border text-andros-primary">
                  {s}
                  <button type="button" onClick={() => removeSkill(s)} aria-label={`Quitar ${s}`} className="text-andros-muted hover:text-andros-primary">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addSkill();
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  placeholder="+ habilidad"
                  aria-label="Añadir habilidad"
                  className="w-24 px-2 py-0.5 rounded-full text-[11px] border border-dashed border-andros-border bg-transparent text-andros-primary placeholder:text-andros-muted outline-none focus:border-andros-accent"
                />
                {skillDraft.trim() && (
                  <button type="submit" aria-label="Añadir" className="text-andros-accent-ink">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>
            </div>
          </div>
        </section>
      )}

      <ConsentCheckbox
        id="arena-consent"
        checked={consent}
        onChange={(v) => {
          setConsent(v);
          if (v) setErrors((prev) => ({ ...prev, consent: undefined }));
        }}
        error={errors.consent}
      />

      {publishError && (
        <p role="alert" className="text-[11px] text-andros-danger">
          {publishError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] md:min-h-[40px] rounded-xl border border-andros-border text-xs text-andros-muted hover:text-andros-primary active:scale-[0.96] spring-micro">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!analysis || stale || publishing || mod?.status === "rejected"}
          aria-busy={publishing}
          title={!analysis ? "Primero escanea la publicación" : stale ? "Vuelve a escanear: cambiaste datos" : undefined}
          className="min-h-[44px] md:min-h-[40px] rounded-xl bg-andros-accent-fill text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          {publishing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {publishing ? "Publicando…" : "Publicar"}
        </button>
      </div>
      {!analysis && (
        <p className="text-[10px] text-andros-muted text-center">Primero pulsa «Escanear»: el botón Publicar se activa con el resultado.</p>
      )}
      {!user && (
        <p className="text-[10px] text-andros-muted text-center">Sin sesión, tu publicación se guarda en este navegador (modo demostración).</p>
      )}
    </div>
  );
};
