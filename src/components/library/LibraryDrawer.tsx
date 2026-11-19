"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Library,
  Loader2,
  Play,
  Plus,
  Quote,
  Scale,
  Search,
  Sparkles,
  TriangleAlert,
  User,
  WifiOff,
  X,
} from "lucide-react";
import type { LibraryScope, LibrarySearchResponse, LibrarySource } from "@/types/library";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useOracleStudioStore } from "@/store/useOracleStudioStore";
import { PROVIDER_LABELS } from "@/lib/library/citation";
import { searchOfflineCatalog } from "@/lib/library/offlineCatalog";
import {
  addSourceToCanvas,
  citeInOracle,
  copyCitation,
  isLinkedinUrl,
  linkedinSource,
} from "@/lib/library/actions";

// ============================================================================
// ANDROS — BIBLIOTECA DE FUENTES CITABLES (cajón lateral en PC, hoja en móvil)
// Papers (OpenAlex + arXiv) · Normas y códigos (eCFR + Crossref) · YouTube ·
// LinkedIn · Guardadas. Cada resultado: Añadir al lienzo, Citar en Oráculo,
// Copiar cita (APA / IEEE) y Guardar.
// ============================================================================

type Tab = LibraryScope | "saved";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "papers", label: "Papers", icon: <BookOpen className="w-3.5 h-3.5" /> },
  { id: "codes", label: "Normas", icon: <Scale className="w-3.5 h-3.5" /> },
  { id: "youtube", label: "YouTube", icon: <Play className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <User className="w-3.5 h-3.5" /> },
  { id: "saved", label: "Guardadas", icon: <BookmarkCheck className="w-3.5 h-3.5" /> },
];

const SUGGESTIONS: Record<"papers" | "codes" | "youtube", string[]> = {
  papers: ["topology optimization 3D printing", "fatigue crack growth", "physics-informed neural networks", "PLA tensile strength"],
  codes: ["machine guarding", "lockout tagout", "small unmanned aircraft", "tensile properties of plastics"],
  youtube: ["https://www.youtube.com/watch?v=aircAruvnKk"],
};

const AGENCIES = [
  { id: "", label: "Todas" },
  { id: "osha", label: "OSHA" },
  { id: "epa", label: "EPA" },
  { id: "faa", label: "FAA" },
  { id: "dot", label: "DOT" },
];

const KIND_LABELS: Record<LibrarySource["kind"], string> = {
  paper: "Artículo",
  preprint: "Preprint",
  regulation: "Regulación",
  standard: "Norma técnica",
  video: "Video",
  linkedin: "LinkedIn",
};

// ----------------------------------------------------------------------------
// Caché local de búsquedas (las demos funcionan aunque falle la red)
// ----------------------------------------------------------------------------

const CACHE_KEY = "andros.library.cache.v1";

function readCache(): Record<string, LibrarySearchResponse> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LibrarySearchResponse>) : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, value: LibrarySearchResponse) {
  try {
    const all = readCache();
    all[key] = value;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 25))) delete all[k];
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento: no pasa nada.
  }
}

// ----------------------------------------------------------------------------
// Componente principal
// ----------------------------------------------------------------------------

export const LibraryDrawer: React.FC = () => {
  const open = useLibraryStore((s) => s.open);
  const close = useLibraryStore((s) => s.closeLibrary);
  const animations = useSettingsStore((s) => s.animations);

  useEffect(() => {
    if (!open) return;
    useLibraryStore.getState().hydrateSaved();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (typeof document === "undefined") return null;
  const reduced = animations === "reduced";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[95] flex items-end md:items-stretch md:justify-end bg-black/35 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          onPointerDown={close}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Biblioteca de fuentes"
            onPointerDown={(e) => e.stopPropagation()}
            initial={reduced ? false : { x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
            className="w-full md:w-[500px] h-[90vh] md:h-full flex flex-col rounded-t-3xl md:rounded-none md:rounded-l-2xl bg-andros-card border-t md:border-t-0 md:border-l border-andros-border shadow-hud-light dark:shadow-hud-dark"
          >
            <LibraryContent />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

const LibraryContent: React.FC = () => {
  const scope = useLibraryStore((s) => s.scope);
  const setScope = useLibraryStore((s) => s.setScope);
  const origin = useLibraryStore((s) => s.origin);
  const close = useLibraryStore((s) => s.closeLibrary);
  const saved = useLibraryStore((s) => s.saved);
  const referenceCount = useOracleStudioStore((s) => s.references.length);

  const [tab, setTab] = useState<Tab>(scope);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LibrarySearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) inputRef.current?.focus();
  }, [tab]);

  const switchTab = (next: Tab) => {
    setTab(next);
    if (next !== "saved") setScope(next);
    setResponse(null);
    setError(null);
    abortRef.current?.abort();
    setLoading(false);
  };

  const runSearch = useCallback(
    async (rawQuery: string, nextAgency = agency) => {
      if (tab === "saved" || tab === "linkedin") return;
      const q = rawQuery.trim();
      if (q.length < 2) {
        setError("Escribe al menos 2 caracteres.");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      const key = `${tab}|${tab === "codes" ? nextAgency : ""}|${q.toLowerCase()}`;
      try {
        const params = new URLSearchParams({ q, scope: tab });
        if (tab === "codes" && nextAgency) params.set("agency", nextAgency);
        const res = await fetch(`/api/library/search?${params}`, { signal: controller.signal });
        const data = (await res.json()) as LibrarySearchResponse | { error: string };
        if ("error" in data) {
          setError(data.error);
          setResponse(null);
        } else {
          setResponse(data);
          if (!data.offline && data.results.length > 0) writeCache(key, data);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Sin servidor o sin red: caché local y, si no, catálogo verificado.
        const cached = readCache()[key];
        if (cached) {
          setResponse({ ...cached, notice: "Sin conexión: resultados guardados de tu última búsqueda igual." });
        } else if (tab === "papers" || tab === "codes") {
          setResponse({
            query: q,
            scope: tab,
            results: searchOfflineCatalog(q, tab),
            providers: ["offline"],
            issues: [],
            offline: true,
            notice: "Sin conexión con el servidor. Te muestro el catálogo verificado de Andros (fuentes reales con DOI o enlace oficial).",
          });
        } else {
          setError("Sin conexión. Revisa tu red e inténtalo de nuevo.");
        }
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [tab, agency]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  const results = tab === "saved" ? saved : (response?.results ?? []);
  const isSearchTab = tab === "papers" || tab === "codes" || tab === "youtube";

  return (
    <>
      {/* Cabecera */}
      <div className="px-5 pt-4 pb-3 border-b border-andros-border shrink-0">
        <div className="md:hidden w-10 h-1 rounded-full bg-andros-border-active mx-auto mb-3" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-andros-accent/15 text-andros-accent">
              <Library className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-andros-primary leading-tight">Biblioteca de fuentes</h2>
              <p className="text-[10px] font-mono text-andros-muted truncate">
                OpenAlex · arXiv · eCFR · Crossref · YouTube — gratis y citable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar Biblioteca"
            className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {origin === "oracle" && (
          <p className="mt-2.5 text-[11px] text-andros-muted rounded-lg bg-andros-accent/10 border border-andros-accent/25 px-2.5 py-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-andros-accent shrink-0" />
            Elige fuentes con «Citar en Oráculo»: el documento las citará como [1], [2]…
            {referenceCount > 0 && <span className="ml-auto font-mono shrink-0">{referenceCount} adjunta(s)</span>}
          </p>
        )}

        {/* Pestañas */}
        <div role="tablist" className="mt-3 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className={`shrink-0 h-8 px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 border spring-micro ${
                tab === t.id
                  ? "bg-andros-canvas border-andros-border-active text-andros-primary"
                  : "border-transparent text-andros-muted hover:text-andros-primary"
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === "saved" && saved.length > 0 && <span className="font-mono text-[10px] text-andros-accent">{saved.length}</span>}
            </button>
          ))}
        </div>

        {/* Buscador */}
        {isSearchTab && (
          <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-xl bg-andros-canvas border border-andros-border focus-within:border-andros-accent spring-micro">
              <Search className="w-4 h-4 text-andros-muted shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  tab === "papers"
                    ? "Tema, título o DOI (en inglés da más resultados)"
                    : tab === "codes"
                      ? "Ej: machine guarding, lockout, drones, ASTM D638"
                      : "Pega un enlace de YouTube o escribe un tema"
                }
                aria-label="Buscar fuentes"
                className="flex-1 min-w-0 bg-transparent text-xs text-andros-primary placeholder:text-andros-muted outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || query.trim().length < 2}
              className="h-10 px-3.5 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 spring-micro active:scale-95"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Buscar
            </button>
          </form>
        )}

        {tab === "codes" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AGENCIES.map((a) => (
              <button
                key={a.id || "all"}
                type="button"
                onClick={() => {
                  setAgency(a.id);
                  if (query.trim().length >= 2) void runSearch(query, a.id);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] border spring-micro ${
                  agency === a.id
                    ? "border-andros-accent text-andros-accent bg-andros-accent/10"
                    : "border-andros-border text-andros-muted hover:text-andros-primary"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cuerpo */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        {tab === "linkedin" && <LinkedinComposer onToast={setToast} />}

        {isSearchTab && !response && !loading && !error && (
          <div className="space-y-2.5">
            <p className="text-xs text-andros-muted leading-relaxed">
              {tab === "papers"
                ? "Más de 250 millones de obras de OpenAlex y los preprints de arXiv, con DOI y PDF de acceso abierto cuando existe."
                : tab === "codes"
                  ? "Regulaciones federales vigentes de EE. UU. (eCFR: OSHA, EPA, FAA, DOT) y metadatos citables de normas técnicas (Crossref). Siempre enlazamos a la fuente oficial."
                  : "Pega un enlace: traemos título, canal y miniatura con el oEmbed público de YouTube y lo puedes incrustar en el lienzo."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS[tab].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQuery(s);
                    void runSearch(s);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-andros-canvas border border-andros-border hover:border-andros-accent/50 text-[11px] text-andros-primary truncate max-w-full spring-micro"
                >
                  {tab === "youtube" ? "Probar con un video de ejemplo" : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-red-500 flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5" />
            {error}
          </p>
        )}

        {loading && (
          <div className="space-y-2.5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl border border-andros-border bg-andros-canvas animate-pulse" />
            ))}
          </div>
        )}

        {!loading && response && isSearchTab && (
          <ResponseBanner response={response} />
        )}

        {!loading && tab === "youtube" && response && response.results.length === 0 && query.trim() && (
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-andros-border text-xs text-andros-primary hover:border-andros-accent spring-micro"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Buscar «{query.trim().slice(0, 40)}» en YouTube
          </a>
        )}

        {tab === "saved" && saved.length === 0 && (
          <p className="text-xs text-andros-muted text-center py-8">
            Aún no guardas fuentes. Pulsa el marcador de cualquier resultado para tenerlo a mano aquí (se guarda en este navegador).
          </p>
        )}

        {!loading && tab !== "linkedin" &&
          results.map((s) => <SourceCard key={s.id} source={s} onToast={setToast} />)}
      </div>

      {/* Confirmación */}
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mx-5 mb-4 px-3.5 py-2.5 rounded-xl bg-andros-primary text-andros-canvas text-xs flex items-center gap-2 shrink-0"
          >
            <Check className="w-3.5 h-3.5 text-andros-success shrink-0" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

const ResponseBanner: React.FC<{ response: LibrarySearchResponse }> = ({ response }) => {
  const live = response.providers.filter((p) => p !== "offline");
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-mono text-andros-muted flex flex-wrap items-center gap-x-2 gap-y-1">
        {response.offline ? (
          <span className="flex items-center gap-1 text-andros-accent">
            <WifiOff className="w-3 h-3" /> Catálogo sin conexión (fuentes reales verificadas)
          </span>
        ) : live.length > 0 ? (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-andros-success" />
            En vivo: {live.map((p) => PROVIDER_LABELS[p].split(" ·")[0]).join(" + ")} · {response.results.length} resultado(s)
          </span>
        ) : null}
        {response.issues.map((i) => (
          <span key={i.provider} className="text-andros-muted/80">
            {PROVIDER_LABELS[i.provider].split(" ·")[0]}: {i.message}
          </span>
        ))}
      </p>
      {response.notice && (
        <p className="text-[11px] leading-relaxed text-andros-muted rounded-lg bg-andros-border/30 px-3 py-2">{response.notice}</p>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Tarjeta de resultado con las acciones de 1 clic
// ----------------------------------------------------------------------------

const SourceCard: React.FC<{ source: LibrarySource; onToast: (msg: string) => void }> = ({ source: s, onToast }) => {
  const origin = useLibraryStore((st) => st.origin);
  const isSaved = useLibraryStore((st) => st.saved.some((x) => x.id === s.id));
  const toggleSaved = useLibraryStore((st) => st.toggleSaved);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<"apa" | "ieee" | null>(null);

  const authors = s.authors.length > 4 ? `${s.authors.slice(0, 3).join(", ")} et al.` : s.authors.join(", ");
  const meta = [authors, s.year, s.venue].filter(Boolean).join(" · ");

  const copy = async (style: "apa" | "ieee") => {
    const ok = await copyCitation(s, style);
    if (ok) {
      setCopied(style);
      setTimeout(() => setCopied(null), 1500);
      onToast(`Cita ${style.toUpperCase()} copiada al portapapeles.`);
    } else {
      onToast("Tu navegador bloqueó el portapapeles.");
    }
  };

  const addToCanvas = () => {
    addSourceToCanvas(s);
    onToast("Fuente añadida al lienzo como nodo de Enlace (lista para cablear a un Nodo IA).");
  };

  const cite = () => {
    citeInOracle(s);
  };

  const primary = "h-8 px-2.5 rounded-lg bg-andros-accent text-white text-[11px] font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro";
  const secondary = "h-8 px-2.5 rounded-lg border border-andros-border text-[11px] font-medium text-andros-primary flex items-center gap-1.5 hover:border-andros-border-active active:scale-95 spring-micro";

  return (
    <article className="rounded-xl border border-andros-border bg-andros-canvas p-3.5 space-y-2">
      <div className="flex items-start gap-3">
        {s.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.thumbnailUrl} alt="" className="w-24 aspect-video rounded-lg object-cover shrink-0 border border-andros-border" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="px-1.5 py-0.5 rounded-md bg-andros-accent/10 text-andros-accent text-[9px] font-mono uppercase tracking-wider">
              {KIND_LABELS[s.kind]}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-andros-muted">
              {PROVIDER_LABELS[s.provider].split(" ·")[0]}
            </span>
            {s.designation && <span className="text-[10px] font-mono font-semibold text-andros-primary">{s.designation}</span>}
            {typeof s.citedByCount === "number" && s.citedByCount > 0 && (
              <span className="text-[9px] font-mono text-andros-muted">{s.citedByCount.toLocaleString("es")} citas</span>
            )}
          </div>
          <h3 className="text-[13px] font-semibold text-andros-primary leading-snug">{s.title}</h3>
          {meta && <p className="mt-0.5 text-[11px] text-andros-muted line-clamp-2">{meta}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            toggleSaved(s);
            onToast(isSaved ? "Quitada de Guardadas." : "Guardada en tu Biblioteca.");
          }}
          aria-label={isSaved ? "Quitar de guardadas" : "Guardar fuente"}
          title={isSaved ? "Quitar de guardadas" : "Guardar fuente"}
          className={`p-1.5 rounded-lg shrink-0 spring-micro ${isSaved ? "text-andros-accent" : "text-andros-muted hover:text-andros-primary"}`}
        >
          {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
        </button>
      </div>

      {s.abstract && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="block text-left w-full">
          <p className={`text-[11px] leading-relaxed text-andros-muted ${expanded ? "" : "line-clamp-3"}`}>{s.abstract}</p>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
        {s.doi && (
          <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" className="text-andros-accent hover:underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> DOI {s.doi.length > 32 ? `${s.doi.slice(0, 32)}…` : s.doi}
          </a>
        )}
        {!s.doi && (
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-andros-accent hover:underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Fuente oficial
          </a>
        )}
        {s.pdfUrl && (
          <a href={s.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-andros-success hover:underline flex items-center gap-1">
            <FileText className="w-3 h-3" /> PDF acceso abierto
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button type="button" onClick={addToCanvas} className={origin === "canvas" ? primary : secondary}>
          <Plus className="w-3.5 h-3.5" />
          Añadir al lienzo
        </button>
        <button type="button" onClick={cite} className={origin === "oracle" ? primary : secondary}>
          <Quote className="w-3.5 h-3.5" />
          Citar en Oráculo
        </button>
        <div className="flex items-center rounded-lg border border-andros-border overflow-hidden" role="group" aria-label="Copiar cita">
          <span className="pl-2 pr-1 text-andros-muted">
            <Copy className="w-3.5 h-3.5" />
          </span>
          {(["apa", "ieee"] as const).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => void copy(style)}
              title={`Copiar cita ${style.toUpperCase()}`}
              className="h-8 px-2 text-[10px] font-mono font-semibold text-andros-primary hover:bg-andros-border/40 spring-micro"
            >
              {copied === style ? <Check className="w-3.5 h-3.5 text-andros-success" /> : style.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
};

// ----------------------------------------------------------------------------
// LinkedIn: tarjeta de referencia escrita por el usuario (sin raspar)
// ----------------------------------------------------------------------------

const LinkedinComposer: React.FC<{ onToast: (msg: string) => void }> = ({ onToast }) => {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [summary, setSummary] = useState("");
  const [preview, setPreview] = useState<LibrarySource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const field =
    "w-full rounded-xl border border-andros-border bg-andros-canvas px-3 py-2 text-xs text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-accent";

  const build = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLinkedinUrl(url)) {
      setError("Pega un enlace de linkedin.com (publicación, perfil, empresa o vacante).");
      return;
    }
    if (title.trim().length < 3) {
      setError("Escribe un título de al menos 3 caracteres.");
      return;
    }
    setError(null);
    setPreview(linkedinSource({ url, title, summary, author }));
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-andros-muted">
        LinkedIn no permite leer su contenido automáticamente, así que la tarjeta usa el título y el resumen que tú escribas. El enlace siempre apunta a la publicación original.
      </p>
      <form onSubmit={build} className="space-y-2">
        <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/posts/… o /jobs/view/…" aria-label="URL de LinkedIn" />
        <input className={field} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ej. Vacante: Ingeniero/a de manufactura aditiva)" aria-label="Título" />
        <input className={field} value={author} maxLength={80} onChange={(e) => setAuthor(e.target.value)} placeholder="Autor o empresa (opcional)" aria-label="Autor o empresa" />
        <textarea className={`${field} min-h-[70px] resize-y`} value={summary} maxLength={800} onChange={(e) => setSummary(e.target.value)} placeholder="Resumen en tus palabras (opcional): qué aporta esta referencia" aria-label="Resumen" />
        {error && (
          <p role="alert" className="text-[11px] text-red-500">
            {error}
          </p>
        )}
        <button type="submit" className="w-full h-9 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold spring-micro active:scale-95">
          Crear tarjeta de referencia
        </button>
      </form>
      {preview && <SourceCard source={preview} onToast={onToast} />}
    </div>
  );
};
