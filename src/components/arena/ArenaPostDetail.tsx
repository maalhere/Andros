"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { ConsentCheckbox } from "@/components/legal/ConsentCheckbox";
import { ArrowLeft, Building2, Eye, Loader2, MapPin, Send, Sparkles, Trash2, Trophy, Users } from "lucide-react";
import { ARENA_TYPE_LABELS, type ArenaPost, type ArenaSubmission, type PortfolioSnapshot } from "@/types/arena";
import { loadSubmissions, submitToArena, deleteLocalPost } from "@/lib/arena/repository";
import { snapshotFromCanvas, snapshotFromCloudWorkspace } from "@/lib/arena/portfolio";
import { celebrate } from "@/lib/effects/celebrate";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { PortfolioBadges, PortfolioMiniMap, PortfolioPreview } from "./PortfolioSnapshotView";

// ============================================================================
// ANDROS ARENA — DETALLE DE UNA PUBLICACIÓN
//   Detalles · Soluciones (galería de portafolios) · Postular / Enviar solución
// ============================================================================

type DetailTab = "details" | "solutions" | "apply";

export const isSolutionType = (p: ArenaPost) => p.type === "challenge" || p.type === "activity";

export const ArenaPostDetail: React.FC<{
  post: ArenaPost;
  cloudReady: boolean;
  initialTab?: DetailTab;
  onBack: () => void;
  onNotice: (msg: string) => void;
  onDeleted: (id: string) => void;
}> = ({ post, cloudReady, initialTab = "details", onBack, onNotice, onDeleted }) => {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [submissions, setSubmissions] = useState<ArenaSubmission[] | null>(null);
  const [preview, setPreview] = useState<ArenaSubmission | { snapshot: PortfolioSnapshot; applicantName?: string; note?: string } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    void loadSubmissions(post, cloudReady).then((list) => {
      if (alive) setSubmissions(list);
    });
    return () => {
      alive = false;
    };
  }, [post, cloudReady, reloadKey]);

  const solutionWord = isSolutionType(post) ? "Soluciones" : "Postulaciones";
  const applyLabel = isSolutionType(post) ? "Enviar solución" : "Postular";

  const tabBtn = (active: boolean) =>
    `h-8 px-3 rounded-lg text-[11px] font-medium flex items-center gap-1.5 ${
      active ? "bg-andros-card text-andros-primary shadow-sm border border-andros-border" : "text-andros-muted hover:text-andros-primary border border-transparent"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label="Volver a la lista" className="p-1.5 mt-0.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <TypeBadge post={post} />
            {post.isExample && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono uppercase tracking-wider bg-andros-border/60 text-andros-muted">Ejemplo</span>}
            {post.isLocal && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono uppercase tracking-wider bg-andros-border/60 text-andros-muted">En este navegador</span>}
          </div>
          <h3 className="text-[15px] font-semibold text-andros-primary leading-snug">{post.title}</h3>
          <p className="mt-1 text-[11px] text-andros-muted flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {post.organization}
            </span>
            {post.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {post.location}
              </span>
            )}
            {post.stipend && <span className="font-mono text-andros-success">{post.stipend}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-andros-border/40 w-fit max-w-full overflow-x-auto no-scrollbar">
        <button type="button" className={tabBtn(tab === "details")} onClick={() => setTab("details")}>
          Detalles
        </button>
        <button type="button" className={tabBtn(tab === "solutions")} onClick={() => setTab("solutions")}>
          <Users className="w-3.5 h-3.5" />
          {post.isExample ? `${solutionWord} de ejemplo` : solutionWord}
          {submissions && <span className="font-mono text-andros-accent-ink">{submissions.length}</span>}
        </button>
        <button type="button" className={tabBtn(tab === "apply")} onClick={() => setTab("apply")}>
          <Send className="w-3.5 h-3.5" />
          {applyLabel}
        </button>
      </div>

      {tab === "details" && (
        <div className="space-y-3.5">
          <p className="text-[13px] leading-relaxed text-andros-primary whitespace-pre-line">{post.description}</p>
          <TagRow post={post} />
          <p className="text-[10px] font-mono text-andros-muted flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-andros-accent-ink" />
            {post.isExample
              ? "Publicación de ejemplo incluida con Andros"
              : `Etiquetas: ${post.engine === "gemini" ? "escáner IA (Gemini)" : "analizador local"} · calidad ${post.moderation.qualityScore}/100`}
            {post.authorName ? ` · publicado por ${post.authorName}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTab("apply")} className="h-9 px-3.5 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {applyLabel} con mi espacio
            </button>
            <button type="button" onClick={() => setTab("solutions")} className="h-9 px-3.5 rounded-xl border border-andros-border text-xs font-medium text-andros-primary flex items-center gap-1.5 hover:border-andros-border-active">
              <Eye className="w-3.5 h-3.5" />
              Ver {solutionWord.toLowerCase()} de ejemplo
            </button>
            {post.isLocal && (
              <button
                type="button"
                onClick={() => {
                  deleteLocalPost(post.id);
                  onDeleted(post.id);
                }}
                className="h-9 px-3 rounded-xl text-xs text-andros-muted hover:text-andros-danger flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "solutions" && (
        <div className="space-y-2.5">
          {submissions === null && <Loader2 className="w-4 h-4 animate-spin text-andros-muted" />}
          {submissions?.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <Trophy className="w-6 h-6 mx-auto text-andros-muted" />
              <p className="text-xs text-andros-muted">Aún no hay {solutionWord.toLowerCase()} públicas. ¡Sé la primera persona!</p>
              <button type="button" onClick={() => setTab("apply")} className="h-8 px-3 rounded-lg bg-andros-accent-fill text-white text-[11px] font-semibold">
                {applyLabel}
              </button>
            </div>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {submissions?.map((s) => (
              <article key={s.id} className="rounded-xl border border-andros-border bg-andros-canvas p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-andros-primary truncate">{s.snapshot.workspaceName}</p>
                    <p className="text-[10px] text-andros-muted truncate">
                      {s.applicantName} · {new Date(s.createdAt).toLocaleDateString("es")}
                      {s.isLocal ? " · este navegador" : ""}
                    </p>
                  </div>
                  {s.isExample && <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-mono uppercase bg-andros-border/60 text-andros-muted">Ejemplo</span>}
                </div>
                <PortfolioMiniMap snapshot={s.snapshot} height={96} />
                <PortfolioBadges snapshot={s.snapshot} compact />
                {s.note && <p className="text-[11px] leading-relaxed text-andros-muted line-clamp-3">{s.note}</p>}
                <button
                  type="button"
                  onClick={() => setPreview(s)}
                  className="w-full h-8 rounded-lg border border-andros-border text-[11px] font-medium text-andros-primary hover:border-andros-accent flex items-center justify-center gap-1.5 spring-micro"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Vista previa del portafolio
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "apply" && (
        <ApplyPanel
          post={post}
          cloudReady={cloudReady}
          onPreview={(snapshot) => setPreview({ snapshot, applicantName: "Tu portafolio" })}
          onSubmitted={(msg) => {
            onNotice(msg);
            refresh();
            setTab("solutions");
          }}
        />
      )}

      <PortfolioPreview
        snapshot={preview?.snapshot ?? null}
        applicant={preview && "applicantName" in preview ? preview.applicantName : undefined}
        note={preview && "note" in preview ? preview.note : undefined}
        onClose={() => setPreview(null)}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Postular / enviar solución con un espacio de Andros
// ----------------------------------------------------------------------------

const CURRENT = "__current__";

const ApplyPanel: React.FC<{
  post: ArenaPost;
  cloudReady: boolean;
  onPreview: (snapshot: PortfolioSnapshot) => void;
  onSubmitted: (notice: string) => void;
}> = ({ post, cloudReady, onPreview, onSubmitted }) => {
  const user = useCloudStore((s) => s.user);
  const currentId = useCloudStore((s) => s.workspaceId);
  const workspaces = useWorkspaceManagerStore((s) => s.workspaces);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);

  const currentName = workspaces.find((w) => w.id === currentId)?.name ?? "Lienzo actual";
  const others = workspaces.filter((w) => w.id !== currentId);

  const [choice, setChoice] = useState<string>(CURRENT);
  const [cloudSnap, setCloudSnap] = useState<PortfolioSnapshot | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitGuard = useSubmitGuard();
  const busy = submitGuard.pending;

  const currentSnap = useMemo(() => snapshotFromCanvas(currentName, nodes, connections), [currentName, nodes, connections]);

  const pendingRef = useRef<string | null>(null);

  /** Elegir otro espacio de la nube lee su instantánea (con RLS del dueño). */
  const choose = (id: string) => {
    setChoice(id);
    setSnapError(null);
    if (id === CURRENT) {
      pendingRef.current = null;
      setLoadingSnap(false);
      return;
    }
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    pendingRef.current = id;
    setLoadingSnap(true);
    setCloudSnap(null);
    void snapshotFromCloudWorkspace(ws.id, ws.name).then((snap) => {
      if (pendingRef.current !== id) return; // El usuario ya eligió otro.
      setLoadingSnap(false);
      if (snap) setCloudSnap(snap);
      else setSnapError("No pude leer ese espacio de la nube. Ábrelo y usa «Lienzo actual».");
    });
  };

  const snapshot = choice === CURRENT ? currentSnap : cloudSnap;
  const empty = !snapshot || snapshot.nodeCount === 0;

  // Idempotente: un doble clic nunca envía dos postulaciones.
  const submit = () =>
    submitGuard.run(async () => {
      if (!snapshot || empty) return;
      if (!consent) {
        setConsentError("Marca la casilla para poder enviar.");
        document.getElementById("arena-apply-consent")?.focus();
        return;
      }
      setSubmitError(null);
      try {
        const { notice } = await submitToArena(
          {
            post,
            workspaceId: choice === CURRENT ? currentId : choice,
            note: note.trim().slice(0, 1500),
            snapshot,
            isPublic,
          },
          user ? { id: user.id, name: user.name } : null,
          cloudReady
        );
        void celebrate();
        onSubmitted(notice);
      } catch {
        setSubmitError("No se pudo enviar. Revisa tu conexión e inténtalo de nuevo; no se ha enviado nada.");
      }
    });

  const option = (active: boolean) =>
    `w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 spring-micro ${
      active ? "border-andros-accent bg-andros-accent/5" : "border-andros-border hover:border-andros-border-active"
    }`;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-andros-muted">
        Elige un espacio de Andros como <strong className="text-andros-primary">portafolio verificable</strong>: se envía una instantánea con sus nodos, cables y modelos (no se comparten tus archivos).
      </p>

      <div className="space-y-1.5" role="radiogroup" aria-label="Espacio de trabajo">
        <button type="button" role="radio" aria-checked={choice === CURRENT} onClick={() => choose(CURRENT)} className={option(choice === CURRENT)}>
          <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${choice === CURRENT ? "border-andros-accent bg-andros-accent-fill" : "border-andros-border-active"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-andros-primary truncate">Lienzo actual · {currentName}</span>
            <span className="block text-[10px] font-mono text-andros-muted">
              <span className="tabular-nums">{currentSnap.nodeCount}</span> nodos · <span className="tabular-nums">{currentSnap.connectionCount}</span> cables
            </span>
          </span>
        </button>
        {others.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={choice === w.id} onClick={() => choose(w.id)} className={option(choice === w.id)}>
            <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${choice === w.id ? "border-andros-accent bg-andros-accent-fill" : "border-andros-border-active"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-andros-primary truncate">{w.name}</span>
              <span className="block text-[10px] font-mono text-andros-muted">{w.folder ? `${w.folder} · ` : ""}en la nube</span>
            </span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <p className="text-[10px] text-andros-muted px-1">Inicia sesión con Google para elegir también entre tus otros espacios guardados en la nube.</p>
        )}
      </div>

      <div className="rounded-xl border border-andros-border p-3 space-y-2">
        {loadingSnap && (
          <p className="text-[11px] text-andros-muted flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo el espacio…
          </p>
        )}
        {snapError && <p role="alert" className="text-[11px] text-andros-danger">{snapError}</p>}
        {snapshot && (
          <>
            <PortfolioMiniMap snapshot={snapshot} height={110} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PortfolioBadges snapshot={snapshot} />
              <button type="button" onClick={() => onPreview(snapshot)} disabled={empty} className="h-7 px-2.5 rounded-lg text-[11px] text-andros-primary border border-andros-border hover:border-andros-accent flex items-center gap-1 disabled:opacity-40">
                <Eye className="w-3.5 h-3.5" /> Vista previa
              </button>
            </div>
            {empty && <p role="status" className="text-[11px] text-andros-warning">Este espacio está vacío: agrega nodos (un modelo 3D, un cálculo, una fuente…) antes de enviarlo.</p>}
          </>
        )}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1500}
        placeholder={isSolutionType(post) ? "Resume tu solución: enfoque, resultados clave y supuestos." : "Mensaje breve: por qué te interesa y qué muestra tu espacio."}
        className="w-full min-h-[76px] rounded-xl border border-andros-border bg-andros-canvas px-3 py-2 text-xs text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-accent"
        aria-label="Nota"
      />

      <label className="flex items-center gap-2.5 min-h-[44px] md:min-h-0 text-[11px] text-andros-primary cursor-pointer select-none">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="w-4 h-4 shrink-0 accent-[var(--accent-fill)]" />
        Mostrar mi {isSolutionType(post) ? "solución" : "portafolio"} en la galería pública de esta publicación
      </label>

      <ConsentCheckbox
        id="arena-apply-consent"
        checked={consent}
        onChange={(v) => {
          setConsent(v);
          if (v) setConsentError(null);
        }}
        error={consentError}
      />

      {submitError && (
        <p role="alert" className="text-[11px] text-andros-danger">
          {submitError}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || empty || loadingSnap}
        aria-busy={busy}
        className="w-full min-h-[44px] rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 active:scale-[0.96] spring-micro"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {busy ? "Enviando…" : isSolutionType(post) ? "Enviar solución con este espacio" : "Postular con este espacio"}
      </button>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Piezas compartidas con la lista
// ----------------------------------------------------------------------------

const TYPE_STYLES: Record<ArenaPost["type"], string> = {
  challenge: "bg-andros-accent/12 text-andros-accent-ink",
  activity: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  internship: "bg-andros-success/12 text-andros-success",
  job: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
};

export const TypeBadge: React.FC<{ post: ArenaPost }> = ({ post }) => (
  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${TYPE_STYLES[post.type]}`}>{ARENA_TYPE_LABELS[post.type]}</span>
);

export const TagRow: React.FC<{ post: ArenaPost; max?: number }> = ({ post, max }) => {
  const skills = max ? post.tags.skills.slice(0, max) : post.tags.skills;
  return (
    <div className="flex flex-wrap gap-1">
      {post.tags.discipline.map((d) => (
        <span key={d} className="px-1.5 py-0.5 rounded-full text-[10px] border border-andros-accent/40 text-andros-accent-ink">
          {d}
        </span>
      ))}
      {post.tags.level.map((l) => (
        <span key={l} className="px-1.5 py-0.5 rounded-full text-[10px] border border-andros-success/40 text-andros-success">
          {l}
        </span>
      ))}
      {skills.map((s) => (
        <span key={s} className="px-1.5 py-0.5 rounded-full text-[10px] border border-andros-border text-andros-muted">
          {s}
        </span>
      ))}
      {max && post.tags.skills.length > max && <span className="text-[10px] text-andros-muted">+{post.tags.skills.length - max}</span>}
    </div>
  );
};
