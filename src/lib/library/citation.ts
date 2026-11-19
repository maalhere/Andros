// ============================================================================
// ANDROS — CITAS APA / IEEE Y CONVERSIÓN DE FUENTES (cliente y servidor)
// Funciones puras: no hacen peticiones ni tocan el estado.
// ============================================================================

import type { ResourceLinkPayload, ResourceLinkPlatform } from "@/types/workspace";
import type { LibrarySource, ResourceCitationData } from "@/types/library";

/** Separa "Ada M. Lovelace" en { given: "Ada M.", family: "Lovelace" }. */
function splitName(name: string): { given: string; family: string } {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.includes(",")) {
    const [family, given] = clean.split(",", 2).map((s) => s.trim());
    return { given: given ?? "", family };
  }
  const parts = clean.split(" ");
  if (parts.length === 1) return { given: "", family: parts[0] };
  return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
}

/** "Ada Marie" → "A. M." */
function initials(given: string): string {
  return given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(" ");
}

function apaAuthor(name: string): string {
  const { given, family } = splitName(name);
  return given ? `${family}, ${initials(given)}` : family;
}

function ieeeAuthor(name: string): string {
  const { given, family } = splitName(name);
  return given ? `${initials(given)} ${family}` : family;
}

function apaAuthors(authors: string[]): string {
  const list = authors.filter(Boolean).map(apaAuthor);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(", ")}, … ${list[list.length - 1]}`;
}

function ieeeAuthors(authors: string[]): string {
  const list = authors.filter(Boolean).map(ieeeAuthor);
  if (list.length === 0) return "";
  if (list.length > 6) return `${list[0]} et al.`;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

const endWithPeriod = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
}

/** Cita en formato APA 7. */
export function formatApa(s: LibrarySource): string {
  const year = s.year ? `(${s.year})` : "(s. f.)";
  const link = s.doi ? doiUrl(s.doi) : s.url;
  switch (s.kind) {
    case "regulation":
      return `${endWithPeriod(s.designation ? `${s.title}, ${s.designation} ${year}` : `${s.title} ${year}`)} ${s.venue ? `${endWithPeriod(s.venue)} ` : ""}${link}`;
    case "standard": {
      const org = s.venue || apaAuthors(s.authors) || "Organismo emisor";
      return `${endWithPeriod(org)} ${year}. *${endWithPeriod(s.designation ? `${s.title} (${s.designation})` : s.title)}* ${link}`;
    }
    case "video":
      return `${endWithPeriod(s.venue || "Autor desconocido")} ${year}. *${s.title}* [Video]. YouTube. ${link}`;
    case "linkedin":
      return `${endWithPeriod(s.authors[0] || s.venue || "LinkedIn")} ${year}. *${s.title}* [Publicación de LinkedIn]. LinkedIn. ${link}`;
    default: {
      const who = apaAuthors(s.authors);
      const venue = s.kind === "preprint" ? s.venue || "arXiv" : s.venue;
      return `${who ? `${who} ` : ""}${year}. ${endWithPeriod(s.title)}${venue ? ` *${venue}*.` : ""} ${link}`;
    }
  }
}

/** Cita en formato IEEE (sin el número entre corchetes). */
export function formatIeee(s: LibrarySource): string {
  const link = s.doi ? `doi: ${s.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : `[Online]. Available: ${s.url}`;
  const who = ieeeAuthors(s.authors);
  switch (s.kind) {
    case "regulation":
      return `${s.venue ? `${s.venue}, ` : ""}"${s.title}," ${s.designation ? `${s.designation}, ` : ""}${s.year ?? "n.d."}. [Online]. Available: ${s.url}`;
    case "standard":
      return `${s.venue ? `${s.venue}, ` : ""}${s.designation ? `${s.designation}, ` : ""}"${s.title}," ${s.year ?? "n.d."}. ${link}`;
    case "video":
      return `${s.venue || "YouTube"}, "${s.title}," YouTube. [Online Video]. Available: ${s.url}`;
    case "linkedin":
      return `${s.authors[0] || "LinkedIn"}, "${s.title}," LinkedIn${s.year ? `, ${s.year}` : ""}. [Online]. Available: ${s.url}`;
    default:
      return `${who ? `${who}, ` : ""}"${s.title}," ${s.venue ? `*${s.venue}*, ` : s.kind === "preprint" ? "arXiv preprint, " : ""}${s.year ?? "n.d."}, ${link}.`;
  }
}

/** Quita los asteriscos de cursiva (para copiar al portapapeles en texto plano). */
export const plainCitation = (citation: string) => citation.replace(/\*/g, "");

export function toCitationData(s: LibrarySource): ResourceCitationData {
  return {
    kind: s.kind,
    provider: s.provider,
    authors: s.authors.slice(0, 30),
    year: s.year,
    venue: s.venue,
    doi: s.doi,
    pdfUrl: s.pdfUrl,
    designation: s.designation,
    apa: plainCitation(formatApa(s)),
    ieee: plainCitation(formatIeee(s)),
  };
}

const PLATFORM_BY_KIND: Record<LibrarySource["kind"], ResourceLinkPlatform> = {
  paper: "paper",
  preprint: "paper",
  regulation: "generic",
  standard: "generic",
  video: "youtube",
  linkedin: "linkedin",
};

const SITE_BY_PROVIDER: Record<LibrarySource["provider"], string> = {
  openalex: "OpenAlex",
  arxiv: "arXiv",
  ecfr: "eCFR · Código de Regulaciones Federales",
  crossref: "Crossref",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  offline: "Catálogo verificado de Andros",
};

export const PROVIDER_LABELS = SITE_BY_PROVIDER;

/** Payload completo de un nodo de Enlace a partir de una fuente de la Biblioteca. */
export function toResourceLinkPayload(s: LibrarySource): ResourceLinkPayload {
  const authors = s.authors.slice(0, 8).join(", ") + (s.authors.length > 8 ? " et al." : "");
  const isPaper = s.kind === "paper" || s.kind === "preprint";
  return {
    url: s.doi ? doiUrl(s.doi) : s.url,
    platform: PLATFORM_BY_KIND[s.kind],
    status: "ready",
    title: s.title,
    description: s.abstract?.slice(0, 1200),
    siteName: SITE_BY_PROVIDER[s.provider],
    imageUrl: s.thumbnailUrl,
    youtube: s.videoId ? { videoId: s.videoId } : undefined,
    paper: isPaper
      ? {
          title: s.title,
          authors: authors || "Autores no indicados",
          source: [s.venue, s.year].filter(Boolean).join(" · ") || SITE_BY_PROVIDER[s.provider],
          summary: s.abstract?.slice(0, 1200) ?? "",
        }
      : undefined,
    citation: toCitationData(s),
  };
}

/** Bloque Markdown para la sección "Referencias" del Estudio del Oráculo. */
export function toReferenceLine(s: LibrarySource, index: number, style: "ieee" | "apa" = "ieee"): string {
  return style === "ieee" ? `[${index}] ${formatIeee(s)}` : formatApa(s);
}
