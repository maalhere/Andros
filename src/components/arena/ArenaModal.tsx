"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, ChevronRight, Cloud, HardDrive, Loader2, MapPin, Plus, Search, Send, Sparkles, Swords, X } from "lucide-react";
import {
  ARENA_DISCIPLINES,
  ARENA_LEVELS,
  ARENA_TYPE_LABELS,
  ARENA_TYPES,
  type ArenaDiscipline,
  type ArenaLevel,
  type ArenaPost,
  type ArenaPostType,
} from "@/types/arena";
import { loadArenaPosts } from "@/lib/arena/repository";
import { EXAMPLE_POSTS, EXAMPLE_SUBMISSIONS } from "@/lib/arena/seed";
import { normalizeText } from "@/lib/arena/keywordTagger";
import { useCloudStore } from "@/store/useCloudStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ArenaPublishForm } from "./ArenaPublishForm";
import { SkeletonList } from "@/components/shared/Skeleton";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { SPRING_SNAPPY } from "@/lib/motion";
import { ArenaPostDetail, TagRow, TypeBadge, isSolutionType } from "./ArenaPostDetail";

// ============================================================================
// ANDROS ARENA — Retos, actividades, prácticas y empleos con etiquetas IA.
// Búsqueda + píldoras de filtro (Tipo, Disciplina, Nivel, Habilidades) con
// filtrado instantáneo en el cliente y en la base de datos. Publicar pasa por
// el escáner IA; postular usa un espacio de Andros como portafolio.
// Datos: Supabase (`arena_posts` / `arena_submissions`) o localStorage.
// ============================================================================

type View = { kind: "list" } | { kind: "publish" } | { kind: "detail"; postId: string; tab?: "details" | "solutions" | "apply" };

export const ArenaModal: React.FC = () => {
  const open = useMarketStore((s) => s.arenaOpen);
  const setOpen = useMarketStore((s) => s.setArenaOpen);
  const animations = useSettingsStore((s) => s.animations);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const reduced = animations === "reduced";
  const { isMobile } = useDeviceLayout();
  const { sheetProps, handleProps } = useSwipeToDismiss(() => setOpen(false), isMobile);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Andros Arena"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
            {...sheetProps}
            className="relative w-full max-w-4xl h-[92vh] md:h-[88vh] flex flex-col rounded-t-3xl md:rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark overflow-hidden pb-[env(safe-area-inset-bottom)]"
          >
            <ArenaContent onClose={() => setOpen(false)} handleProps={handleProps} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

const ArenaContent: React.FC<{ onClose: () => void; handleProps: React.HTMLAttributes<HTMLDivElement> }> = ({ onClose, handleProps }) => {
  const userId = useCloudStore((s) => s.user?.id);
  const [posts, setPosts] = useState<ArenaPost[]>(EXAMPLE_POSTS);
  // Esqueleto solo en la primera carga; después, el filtrado mantiene la lista visible.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });

  // Filtros
  const [text, setText] = useState("");
  const [type, setType] = useState<ArenaPostType | null>(null);
  const [discipline, setDiscipline] = useState<ArenaDiscipline | null>(null);
  const [level, setLevel] = useState<ArenaLevel | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    const result = await loadArenaPosts({
      text: text.trim() || undefined,
      type: type ?? undefined,
      discipline: discipline ?? undefined,
      level: level ?? undefined,
    });
    if (id !== requestRef.current) return; // Respuesta vieja: se descarta.
    setLoading(false);
    setLoadedOnce(true);
    setPosts(result.posts);
    setCloudReady(result.cloudReady);
    setModeNotice(result.notice ?? null);
  }, [text, type, discipline, level]);

  // Recarga (con filtros en la base de datos) con un pequeño retardo al escribir.
  useEffect(() => {
    const t = setTimeout(() => void load(), text ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, text, userId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  // Filtrado instantáneo en el cliente (locales y ejemplos, y doble check de la nube).
  const visible = useMemo(() => {
    const q = normalizeText(text).trim();
    return posts.filter((p) => {
      if (p.moderation.status === "rejected") return false;
      if (type && p.type !== type) return false;
      if (discipline && !p.tags.discipline.includes(discipline)) return false;
      if (level && !p.tags.level.includes(level)) return false;
      if (skills.length > 0 && !skills.every((s) => p.tags.skills.includes(s))) return false;
      if (q) {
        const hay = normalizeText(`${p.title} ${p.organization} ${p.description} ${p.tags.skills.join(" ")} ${p.tags.discipline.join(" ")}`);
        if (!q.split(" ").every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [posts, text, type, discipline, level, skills]);

  // Conteos para las píldoras (sobre todas las publicaciones cargadas).
  const counts = useMemo(() => {
    const disc = new Map<string, number>();
    const lvl = new Map<string, number>();
    const sk = new Map<string, number>();
    const typ = new Map<string, number>();
    for (const p of posts) {
      typ.set(p.type, (typ.get(p.type) ?? 0) + 1);
      p.tags.discipline.forEach((d) => disc.set(d, (disc.get(d) ?? 0) + 1));
      p.tags.level.forEach((l) => lvl.set(l, (lvl.get(l) ?? 0) + 1));
      p.tags.skills.forEach((s) => sk.set(s, (sk.get(s) ?? 0) + 1));
    }
    const topSkills = [...sk.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14).map(([s]) => s);
    return { disc, lvl, typ, topSkills };
  }, [posts]);

  const hasFilters = Boolean(text || type || discipline || level || skills.length);
  const clearFilters = () => {
    setText("");
    setType(null);
    setDiscipline(null);
    setLevel(null);
    setSkills([]);
  };

  const solutionCount = (p: ArenaPost) => EXAMPLE_SUBMISSIONS.filter((s) => s.postId === p.id).length;
  const detailPost = view.kind === "detail" ? posts.find((p) => p.id === view.postId) : undefined;

  const pill = (active: boolean, tone: "accent" | "success" | "neutral" = "accent") =>
    `shrink-0 px-2.5 py-1 rounded-full text-[11px] border spring-micro ${
      active
        ? tone === "success"
          ? "border-andros-success text-andros-success bg-andros-success/10"
          : tone === "neutral"
            ? "border-andros-primary text-andros-primary bg-andros-border/50"
            : "border-andros-accent text-andros-accent-ink bg-andros-accent/10"
        : "border-andros-border text-andros-muted hover:text-andros-primary"
    }`;

  return (
    <>
      {/* Cabecera */}
      <div {...handleProps} className="flex items-center justify-between gap-3 px-5 h-14 border-b border-andros-border shrink-0 max-md:cursor-grab">
        <div aria-hidden="true" className="md:hidden absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-andros-border-active" />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-andros-accent/15 text-andros-accent-ink">
            <Swords className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-andros-primary leading-tight">Andros Arena</h2>
            <p className="text-[10px] font-mono text-andros-muted truncate flex items-center gap-1">
              {cloudReady ? <Cloud className="w-3 h-3 text-andros-success" /> : <HardDrive className="w-3 h-3" />}
              {cloudReady ? "Nube conectada" : "Modo local"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {view.kind === "list" && (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setView({ kind: "publish" });
              }}
              className="h-11 md:h-9 px-3 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center gap-1.5 active:scale-[0.96] spring-micro"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Publicar
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar Arena" className="w-11 h-11 md:w-8 md:h-8 -mr-2 md:-mr-1 flex items-center justify-center rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {notice && (
        <p role="status" className="mx-5 mt-3 text-[11px] text-andros-primary rounded-lg bg-andros-success/10 border border-andros-success/30 px-3 py-2 shrink-0">
          {notice}
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {view.kind === "publish" && (
          <div className="px-5 py-4">
            <ArenaPublishForm
              cloudReady={cloudReady}
              onCancel={() => setView({ kind: "list" })}
              onPublished={(post, msg) => {
                setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
                setNotice(msg);
                clearFilters();
                setView({ kind: "detail", postId: post.id });
              }}
            />
          </div>
        )}

        {view.kind === "detail" && detailPost && (
          <div className="px-5 py-4">
            <ArenaPostDetail
              key={detailPost.id}
              post={detailPost}
              cloudReady={cloudReady}
              initialTab={view.tab}
              onBack={() => setView({ kind: "list" })}
              onNotice={setNotice}
              onDeleted={(id) => {
                setPosts((prev) => prev.filter((p) => p.id !== id));
                setNotice("Publicación eliminada de este navegador.");
                setView({ kind: "list" });
              }}
            />
          </div>
        )}

        {(view.kind === "list" || (view.kind === "detail" && !detailPost)) && (
          <>
            {/* Buscador y filtros (fijos arriba) */}
            <div className="sticky top-0 z-10 bg-andros-card/95 backdrop-blur px-5 pt-4 pb-3 space-y-2.5 border-b border-andros-border">
              <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-andros-canvas border border-andros-border focus-within:border-andros-accent spring-micro">
                <Search className="w-4 h-4 text-andros-muted shrink-0" />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Busca por título, organización, habilidad… (ej. FEA, Next.js, drone)"
                  aria-label="Buscar en la Arena"
                  className="flex-1 min-w-0 bg-transparent text-xs text-andros-primary placeholder:text-andros-muted outline-none"
                />
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-andros-muted" />}
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="min-h-[32px] px-1 text-[11px] text-andros-muted hover:text-andros-primary shrink-0">
                    Limpiar
                  </button>
                )}
              </div>

              <FilterRow label="Tipo">
                <button type="button" onClick={() => setType(null)} className={pill(type === null, "neutral")}>
                  Todos
                </button>
                {ARENA_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => setType(type === t ? null : t)} className={pill(type === t, "neutral")}>
                    {ARENA_TYPE_LABELS[t]} <span className="font-mono tabular-nums">{counts.typ.get(t) ?? 0}</span>
                  </button>
                ))}
              </FilterRow>
              <FilterRow label="Disciplina" ai>
                {ARENA_DISCIPLINES.filter((d) => counts.disc.has(d) || discipline === d).map((d) => (
                  <button key={d} type="button" onClick={() => setDiscipline(discipline === d ? null : d)} className={pill(discipline === d)}>
                    {d} <span className="font-mono tabular-nums">{counts.disc.get(d) ?? 0}</span>
                  </button>
                ))}
              </FilterRow>
              <FilterRow label="Nivel" ai>
                {ARENA_LEVELS.filter((l) => counts.lvl.has(l) || level === l).map((l) => (
                  <button key={l} type="button" onClick={() => setLevel(level === l ? null : l)} className={pill(level === l, "success")}>
                    {l} <span className="font-mono tabular-nums">{counts.lvl.get(l) ?? 0}</span>
                  </button>
                ))}
              </FilterRow>
              <FilterRow label="Habilidades" ai>
                {[...new Set([...skills, ...counts.topSkills])].map((s) => {
                  const on = skills.includes(s);
                  return (
                    <button key={s} type="button" onClick={() => setSkills(on ? skills.filter((x) => x !== s) : [...skills, s])} className={pill(on, "neutral")}>
                      {s}
                    </button>
                  );
                })}
              </FilterRow>
            </div>

            <div className="px-5 py-4 space-y-3">
              {modeNotice && <p className="text-[11px] text-andros-muted rounded-lg bg-andros-border/30 px-3 py-2">{modeNotice}</p>}

              <p className="text-[10px] font-mono tabular-nums text-andros-muted" aria-live="polite">
                {visible.length} publicación(es){hasFilters ? " con estos filtros" : ""}
              </p>

              {!loadedOnce && <SkeletonList count={4} label="Cargando publicaciones de la Arena" className="grid gap-3 md:grid-cols-2" />}

              {loadedOnce && visible.length === 0 && !loading && (
                <div className="text-center py-10 space-y-2">
                  <p className="text-xs text-andros-muted">Nada coincide con estos filtros.</p>
                  <button type="button" onClick={clearFilters} className="h-8 px-3 rounded-lg border border-andros-border text-[11px] text-andros-primary">
                    Quitar filtros
                  </button>
                </div>
              )}

              <ul className={`grid gap-3 md:grid-cols-2 ${loadedOnce ? "" : "hidden"}`}>
                {visible.map((p) => {
                  const sols = solutionCount(p);
                  return (
                    <li key={p.id} className="rounded-xl border border-andros-border bg-andros-canvas p-3.5 flex flex-col gap-2 hover:border-andros-border-active spring-micro">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TypeBadge post={p} />
                        {p.isExample && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider bg-andros-border/60 text-andros-muted">Ejemplo</span>}
                        {p.isLocal && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider bg-andros-border/60 text-andros-muted">Este navegador</span>}
                        {!p.isExample && p.engine === "gemini" && (
                          <span className="flex items-center gap-0.5 text-[10px] font-mono text-andros-accent-ink" title="Etiquetas generadas por el escáner IA">
                            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" /> IA
                          </span>
                        )}
                        {p.stipend && <span className="ml-auto text-[10px] font-mono text-andros-success truncate max-w-[45%]">{p.stipend}</span>}
                      </div>
                      <button type="button" onClick={() => setView({ kind: "detail", postId: p.id })} className="text-left">
                        <h3 className="text-[13px] font-semibold text-andros-primary leading-snug hover:text-andros-accent-ink">{p.title}</h3>
                      </button>
                      <p className="text-[11px] text-andros-muted flex flex-wrap gap-x-2.5">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {p.organization}
                        </span>
                        {p.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {p.location}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] leading-relaxed text-andros-muted line-clamp-2">{p.description}</p>
                      <TagRow post={p} max={4} />
                      <div className="mt-auto pt-1 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setView({ kind: "detail", postId: p.id, tab: "apply" })}
                          className="h-10 md:h-8 px-2.5 rounded-lg bg-andros-accent-fill text-white text-[11px] font-semibold flex items-center gap-1.5 active:scale-[0.96] spring-micro"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {isSolutionType(p) ? "Enviar solución" : "Postular"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setView({ kind: "detail", postId: p.id, tab: "solutions" })}
                          className="h-10 md:h-8 px-2.5 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:border-andros-border-active flex items-center gap-1 active:scale-[0.96] spring-micro"
                        >
                          {sols > 0 ? `Ver ${sols} solución(es) de ejemplo` : "Ver soluciones"}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </>
  );
};

const FilterRow: React.FC<{ label: string; ai?: boolean; children: React.ReactNode }> = ({ label, ai, children }) => (
  <div className="flex items-center gap-2 min-w-0">
    <span
      title={ai ? "Etiquetas generadas por el escáner IA" : undefined}
      className="w-[74px] shrink-0 text-[10px] font-mono uppercase tracking-wider text-andros-muted"
    >
      {label}
    </span>
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar min-w-0">{children}</div>
  </div>
);
