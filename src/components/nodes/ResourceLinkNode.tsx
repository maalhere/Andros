"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Quote,
  GitFork,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Star,
  User,
} from "lucide-react";
import { ResourceLinkEngineeringNode, ResourceLinkPlatform } from "@/types/workspace";
import type { ResourceCitationData } from "@/types/library";
import { useWorkspaceStore, createEmptyResourceLinkPayload } from "@/store/useWorkspaceStore";

// ============================================================================
// NODO TIPO 4 — ENLACE / FUENTE EXTERNA
// Pega cualquier URL: YouTube se incrusta con un reproductor limpio, GitHub
// consulta su API pública, los papers (arXiv/DOI/OpenAlex...) extraen título +
// autores + resumen y el resto muestra una tarjeta de vista previa genérica.
// Todo el contenido (título, tipo y resumen) queda en `resourceLinkData` para
// que el Oráculo IA lo pueda leer y cruzar con el resto del lienzo.
// ============================================================================

interface ResourceLinkNodeProps {
  node: ResourceLinkEngineeringNode;
  variant: "canvas" | "stack";
}

function detectPlatformClientSide(url: string): ResourceLinkPlatform {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
    if (host === "github.com") return "github";
    if (host === "arxiv.org" || host.endsWith("doi.org") || host === "semanticscholar.org" || host === "openalex.org") {
      return "paper";
    }
    if (host.endsWith("linkedin.com")) return "linkedin";
    return "generic";
  } catch {
    return "generic";
  }
}

const PLATFORM_ICON: Record<ResourceLinkPlatform, React.ReactNode> = {
  youtube: <Play className="w-4 h-4 text-red-500" />,
  github: <GitFork className="w-4 h-4 text-andros-accent" />,
  paper: <BookOpen className="w-4 h-4 text-andros-accent" />,
  linkedin: <User className="w-4 h-4 text-andros-accent" />,
  generic: <Link2 className="w-4 h-4 text-andros-accent" />,
};

/** Datos de cita (solo nodos creados desde la Biblioteca): DOI, PDF y copiar APA/IEEE. */
const CitationStrip: React.FC<{ citation: ResourceCitationData }> = ({ citation }) => {
  const [copied, setCopied] = useState<"apa" | "ieee" | null>(null);
  const copy = async (style: "apa" | "ieee") => {
    try {
      await navigator.clipboard.writeText(style === "apa" ? citation.apa : citation.ieee);
      setCopied(style);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="rounded-xl border border-andros-border bg-andros-canvas/60 px-2.5 py-2 space-y-1.5" data-no-drag>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-mono text-andros-muted">
        <span className="flex items-center gap-1 text-andros-primary">
          <Quote className="w-3 h-3 text-andros-accent" />
          Citable
        </span>
        {citation.designation && <span className="text-andros-primary font-semibold">{citation.designation}</span>}
        {citation.doi && <span className="truncate max-w-[160px]">DOI {citation.doi}</span>}
        {citation.year && <span>{citation.year}</span>}
        {citation.pdfUrl && (
          <a href={citation.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-andros-success hover:underline">
            <FileText className="w-3 h-3" /> PDF
          </a>
        )}
      </div>
      <div className="flex items-center gap-1">
        {(["apa", "ieee"] as const).map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => void copy(style)}
            title={style === "apa" ? citation.apa : citation.ieee}
            className="h-6 px-2 rounded-md border border-andros-border text-[10px] font-mono font-semibold text-andros-primary hover:border-andros-accent flex items-center gap-1 spring-micro"
          >
            {copied === style ? <Check className="w-3 h-3 text-andros-success" /> : <Copy className="w-3 h-3" />}
            {style.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
};

export const ResourceLinkNodeView: React.FC<ResourceLinkNodeProps> = ({ node, variant }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const data = node.resourceLinkData;
  const [draftUrl, setDraftUrl] = useState(data.url);

  const fetchPreview = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;

    const platformGuess = detectPlatformClientSide(trimmed);
    updateNodePayload(node.id, {
      url: trimmed,
      platform: platformGuess,
      status: "loading",
      errorMessage: undefined,
    });

    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(trimmed)}`);
      const result = await res.json();
      if (result.errorMessage && !result.title && !result.youtube && !result.github) {
        updateNodePayload(node.id, {
          status: "error",
          errorMessage: result.errorMessage,
          platform: result.platform ?? platformGuess,
        });
        return;
      }
      updateNodePayload(node.id, {
        status: "ready",
        platform: result.platform ?? platformGuess,
        title: result.title,
        description: result.description,
        siteName: result.siteName,
        imageUrl: result.imageUrl,
        youtube: result.youtube,
        github: result.github,
        paper: result.paper,
        // Un enlace pegado a mano no trae metadatos de cita verificados.
        citation: undefined,
        errorMessage: result.errorMessage,
      });
    } catch {
      updateNodePayload(node.id, {
        status: "error",
        errorMessage: "No se pudo conectar con el servicio de vista previa",
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchPreview(draftUrl);
  };

  const handleClear = () => {
    setDraftUrl("");
    updateNodePayload(node.id, { ...createEmptyResourceLinkPayload(), citation: undefined });
  };

  // --------------------------------------------------------------------------
  // Sin URL todavía: campo para pegarla.
  // --------------------------------------------------------------------------
  if (!data.url || data.status === "idle") {
    return (
      <form onSubmit={handleSubmit} className="py-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-andros-muted shrink-0" />
          <input
            type="url"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="Pega una URL: YouTube, GitHub, arXiv, LinkedIn…"
            className="flex-1 min-h-[40px] bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-xl px-3 text-xs text-andros-primary placeholder:text-andros-muted outline-none spring-micro"
            data-no-drag
          />
        </div>
        <button
          type="submit"
          disabled={!draftUrl.trim()}
          className="w-full min-h-[36px] rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold disabled:opacity-40 spring-micro active:scale-95"
        >
          Analizar enlace
        </button>
      </form>
    );
  }

  // --------------------------------------------------------------------------
  // Cargando.
  // --------------------------------------------------------------------------
  if (data.status === "loading") {
    return (
      <div className="py-6 flex flex-col items-center gap-2 text-andros-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Analizando enlace…</span>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error.
  // --------------------------------------------------------------------------
  if (data.status === "error") {
    return (
      <div className="py-3 space-y-2.5">
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-500 leading-relaxed">{data.errorMessage || "No se pudo leer este enlace."}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchPreview(data.url)}
            className="flex-1 min-h-[36px] rounded-xl bg-andros-border/50 text-andros-primary text-xs font-medium flex items-center justify-center gap-1.5 spring-micro active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reintentar
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[36px] px-3 rounded-xl text-andros-muted text-xs spring-micro active:scale-95"
          >
            Cambiar URL
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Listo: vista rica según la plataforma.
  // --------------------------------------------------------------------------
  return (
    <div className="py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-andros-muted">
          {PLATFORM_ICON[data.platform]}
          {data.siteName || data.platform}
        </span>
        <button
          type="button"
          onClick={handleClear}
          title="Cambiar enlace"
          className="text-[10px] text-andros-muted hover:text-andros-accent spring-micro"
        >
          Cambiar
        </button>
      </div>

      {data.platform === "youtube" && data.youtube && (
        <div className="rounded-xl overflow-hidden border border-andros-border bg-black" data-no-drag>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${data.youtube.videoId}`}
            title={data.title || "Video de YouTube"}
            className="w-full aspect-video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {data.platform === "github" && data.github && (
        <div className="rounded-xl border border-andros-border bg-andros-canvas p-3 space-y-1.5">
          <p className="text-xs font-semibold text-andros-primary truncate">
            {data.github.owner}/{data.github.repo}
          </p>
          {data.github.description && (
            <p className="text-[11px] text-andros-muted leading-relaxed line-clamp-3">
              {data.github.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-[11px] font-mono text-andros-muted pt-1">
            <span className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5" />
              {data.github.stars.toLocaleString("es")}
            </span>
            {data.github.language && <span>{data.github.language}</span>}
          </div>
        </div>
      )}

      {data.platform === "paper" && data.paper && (
        <div className="rounded-xl border border-andros-border bg-andros-canvas p-3 space-y-1.5">
          <p className="text-xs font-semibold text-andros-primary leading-snug">{data.paper.title}</p>
          <p className="text-[11px] text-andros-muted">{data.paper.authors}</p>
          {data.paper.summary && (
            <p className="text-[11px] text-andros-muted leading-relaxed line-clamp-4">{data.paper.summary}</p>
          )}
        </div>
      )}

      {(data.platform === "linkedin" || data.platform === "generic") && (
        <div className="rounded-xl border border-andros-border bg-andros-canvas p-3 flex gap-3">
          {data.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageUrl}
              alt=""
              className="w-14 h-14 rounded-lg object-cover shrink-0 border border-andros-border"
            />
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-semibold text-andros-primary leading-snug truncate">
              {data.title || data.url}
            </p>
            {data.description && (
              <p className="text-[11px] text-andros-muted leading-relaxed line-clamp-3">{data.description}</p>
            )}
          </div>
        </div>
      )}

      {data.citation && <CitationStrip citation={data.citation} />}

      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        data-no-drag
        className="flex items-center gap-1.5 text-[11px] font-mono text-andros-accent hover:underline truncate"
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        {data.url}
      </a>
    </div>
  );
};
