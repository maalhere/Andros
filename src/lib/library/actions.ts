// ============================================================================
// ANDROS — ACCIONES DE 1 CLIC DE LA BIBLIOTECA (solo cliente)
//   · Añadir al lienzo   → nodo de Enlace con metadatos de cita completos.
//   · Citar en Oráculo   → adjunta la fuente al Estudio y lo abre en modo documento.
//   · Copiar cita        → APA o IEEE en texto plano.
// ============================================================================

import type { LibrarySource } from "@/types/library";
import type { OracleReference } from "@/types/oracle";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useOracleStudioStore } from "@/store/useOracleStudioStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { visibleSpawnPoint } from "@/lib/canvas/quickAdd";
import { formatApa, formatIeee, plainCitation, toResourceLinkPayload } from "./citation";

const CODE_TAGS: Record<LibrarySource["kind"], string> = {
  paper: "DOI",
  preprint: "ARXIV",
  regulation: "CFR",
  standard: "STD",
  video: "VIDEO",
  linkedin: "LINKEDIN",
};

/** Crea un nodo de Enlace con la fuente. Devuelve el id del nodo. */
export function addSourceToCanvas(source: LibrarySource): string {
  const ws = useWorkspaceStore.getState();
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const id = ws.aiCreateNode({
    type: "resource-link-node",
    title: source.title.slice(0, 120),
    codeTag: source.designation?.slice(0, 24) || CODE_TAGS[source.kind],
    ...(isMobile ? {} : { position: visibleSpawnPoint() }),
    resourceLinkData: toResourceLinkPayload(source),
  });
  ws.setActiveTool("pointer");
  return id;
}

/** Adjunta la fuente al Estudio del Oráculo y lo abre en modo documento. */
export function citeInOracle(source: LibrarySource): number {
  const studio = useOracleStudioStore.getState();
  const n = studio.addReference(source);
  studio.setChatMode("document");
  useLibraryStore.getState().closeLibrary();
  useWorkspaceStore.getState().setOracleModalOpen(true);
  return n;
}

export function citationText(source: LibrarySource, style: "apa" | "ieee"): string {
  return plainCitation(style === "apa" ? formatApa(source) : formatIeee(source));
}

export async function copyCitation(source: LibrarySource, style: "apa" | "ieee"): Promise<boolean> {
  const text = citationText(source, style);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Respaldo para contextos sin permiso de portapapeles (iframes, http).
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Forma compacta que viaja a `/api/oracle`. */
export function toOracleReference(source: LibrarySource): OracleReference {
  return {
    title: source.title,
    citation: citationText(source, "ieee"),
    url: source.url,
    doi: source.doi,
    abstract: source.abstract?.slice(0, 700),
  };
}

/** Sección "## Referencias" en Markdown (IEEE numerado). */
export function referencesMarkdown(sources: LibrarySource[]): string {
  return `## Referencias\n\n${sources.map((s, i) => `[${i + 1}] ${citationText(s, "ieee")}`).join("\n\n")}`;
}

/** Fuente de LinkedIn creada a mano (sin raspar el sitio). */
export function linkedinSource(input: { url: string; title: string; summary: string; author: string }): LibrarySource {
  const url = input.url.trim();
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Se valida antes de llamar; aquí solo se usa como id.
  }
  return {
    id: `linkedin:${path.replace(/\/+$/, "").toLowerCase()}`,
    kind: "linkedin",
    provider: "linkedin",
    title: input.title.trim() || "Referencia de LinkedIn",
    authors: input.author.trim() ? [input.author.trim()] : [],
    year: new Date().getFullYear(),
    venue: input.author.trim() || undefined,
    abstract: input.summary.trim() || undefined,
    url,
  };
}

/** `true` si la URL es de LinkedIn (perfil, publicación, empleo o empresa). */
export function isLinkedinUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    return (u.protocol === "https:" || u.protocol === "http:") && (host === "linkedin.com" || host.endsWith(".linkedin.com"));
  } catch {
    return false;
  }
}
