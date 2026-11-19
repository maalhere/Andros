// ============================================================================
// ANDROS — CONTRATO DE LA BIBLIOTECA DE FUENTES CITABLES (Sprint 3 · Módulo A)
// Lo comparten `/api/library/search` (servidor), `LibraryDrawer.tsx` (cliente),
// el nodo de Enlace (`resourceLinkData.citation`) y el Estudio del Oráculo.
// ============================================================================

/** Pestañas de búsqueda de la Biblioteca. */
export type LibraryScope = "papers" | "codes" | "youtube" | "linkedin";

/** Servicio público del que viene cada resultado. */
export type LibraryProvider =
  | "openalex"
  | "arxiv"
  | "ecfr"
  | "crossref"
  | "youtube"
  | "linkedin"
  | "offline";

/** Qué tipo de fuente es (cambia el formato de la cita). */
export type LibrarySourceKind = "paper" | "preprint" | "regulation" | "standard" | "video" | "linkedin";

/** Una fuente lista para citar, añadir al lienzo o adjuntar al Oráculo. */
export interface LibrarySource {
  /** Id estable (DOI, id de arXiv, sección del CFR, id de video…). */
  id: string;
  kind: LibrarySourceKind;
  provider: LibraryProvider;
  title: string;
  /** Autores en orden ("Apellido, N." o el nombre tal como lo da la API). */
  authors: string[];
  year?: number;
  /** Revista, congreso, agencia u organismo emisor, canal de YouTube… */
  venue?: string;
  /** Resumen / abstract / extracto de la norma (texto plano). */
  abstract?: string;
  doi?: string;
  /** Enlace oficial (página del DOI, eCFR, arXiv, YouTube, LinkedIn). */
  url: string;
  /** PDF de acceso abierto, si existe. */
  pdfUrl?: string;
  /** Miniatura (YouTube). */
  thumbnailUrl?: string;
  /** Solo YouTube: id del video para el reproductor incrustado. */
  videoId?: string;
  /** Citas recibidas (OpenAlex), útil para ordenar por relevancia. */
  citedByCount?: number;
  /** Solo normas: identificador oficial ("29 CFR 1910.212", "ASTM D638-14"). */
  designation?: string;
}

/** Fallo de una fuente concreta: la búsqueda sigue con las demás. */
export interface LibraryProviderIssue {
  provider: LibraryProvider;
  message: string;
}

export interface LibrarySearchResponse {
  query: string;
  scope: LibraryScope;
  results: LibrarySource[];
  /** Fuentes que respondieron con éxito. */
  providers: LibraryProvider[];
  /** Fuentes que fallaron o se saltaron (cuota, red, tiempo de espera…). */
  issues: LibraryProviderIssue[];
  /** `true` si se respondió con el catálogo local verificado (APIs caídas). */
  offline?: boolean;
  /** Aviso para mostrar al usuario (p. ej. cómo buscar en YouTube sin clave). */
  notice?: string;
}

/** Datos de cita guardados dentro de un nodo de Enlace. */
export interface ResourceCitationData {
  kind: LibrarySourceKind;
  provider: LibraryProvider;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  pdfUrl?: string;
  designation?: string;
  apa: string;
  ieee: string;
}
