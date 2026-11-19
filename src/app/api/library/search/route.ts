// ============================================================================
// ANDROS — BIBLIOTECA DE FUENTES CITABLES (Sprint 3 · Módulo A)
//
//   GET /api/library/search?q=…&scope=papers|codes|youtube[&agency=osha|epa|faa|dot]
//
// Consulta en vivo APIs públicas y gratuitas (sin clave):
//   · papers  → OpenAlex (250M+ obras) + arXiv
//   · codes   → eCFR (regulaciones federales de EE. UU.) + Crossref (metadatos
//               de normas técnicas; solo se enlaza a la fuente oficial, nunca
//               se descargan PDFs con derechos de autor)
//   · youtube → oEmbed público de YouTube para enlaces pegados (y la API de
//               datos v3 solo si existe YOUTUBE_API_KEY)
// Cada fuente tiene su propio tiempo límite: si una falla, las demás siguen.
// Si TODAS fallan, se responde con el catálogo local verificado (`offline`).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import type {
  LibraryProvider,
  LibraryProviderIssue,
  LibraryScope,
  LibrarySearchResponse,
  LibrarySource,
} from "@/types/library";
import { searchOfflineCatalog } from "@/lib/library/offlineCatalog";

const PROVIDER_TIMEOUT_MS = 9000;
const PER_PROVIDER = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = "AndrosLibrary/1.0 (research client)";

/** Caché en memoria: las demos repiten búsquedas y así se respetan los límites. */
const cache = new Map<string, { at: number; body: LibrarySearchResponse }>();

/** Agencia → título del CFR. */
const AGENCY_TITLES: Record<string, number> = { osha: 29, epa: 40, faa: 14, dot: 49 };

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

const cleanDoi = (doi: unknown): string | undefined =>
  typeof doi === "string" && doi.trim()
    ? doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim()
    : undefined;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "no respondió a tiempo";
    if (/HTTP 429/.test(error.message)) return "límite de consultas alcanzado, reintenta en un minuto";
    return error.message.slice(0, 120);
  }
  return "error desconocido";
}

// ----------------------------------------------------------------------------
// OpenAlex
// ----------------------------------------------------------------------------

function rebuildAbstract(index: unknown): string | undefined {
  if (!index || typeof index !== "object") return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (typeof p === "number" && p < 600) words[p] = word;
  }
  const text = words.filter(Boolean).join(" ").trim();
  return text ? text.slice(0, 1500) : undefined;
}

async function searchOpenAlex(q: string): Promise<LibrarySource[]> {
  const params = new URLSearchParams({
    search: q,
    "per-page": String(PER_PROVIDER),
    select:
      "id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,type",
  });
  const data = (await getJson(`https://api.openalex.org/works?${params}`)) as { results?: unknown[] };
  return (data.results ?? []).flatMap((raw): LibrarySource[] => {
    const w = raw as Record<string, unknown>;
    const title = stripTags(str(w.display_name));
    if (!title) return [];
    const doi = cleanDoi(w.doi);
    const authorships = Array.isArray(w.authorships) ? w.authorships : [];
    const authors = authorships
      .map((a) => str((a as { author?: { display_name?: unknown } }).author?.display_name))
      .filter(Boolean);
    const primary = (w.primary_location ?? {}) as { source?: { display_name?: unknown }; landing_page_url?: unknown };
    const bestOa = (w.best_oa_location ?? {}) as { pdf_url?: unknown };
    const oa = (w.open_access ?? {}) as { oa_url?: unknown };
    const pdf = str(bestOa.pdf_url) || undefined;
    const id = str(w.id).replace("https://openalex.org/", "");
    const type = str(w.type);
    return [
      {
        id: doi ? `doi:${doi.toLowerCase()}` : `openalex:${id}`,
        kind: type === "preprint" ? "preprint" : "paper",
        provider: "openalex",
        title,
        authors,
        year: typeof w.publication_year === "number" ? w.publication_year : undefined,
        venue: str(primary.source?.display_name) || undefined,
        abstract: rebuildAbstract(w.abstract_inverted_index),
        doi,
        url: doi ? `https://doi.org/${doi}` : str(primary.landing_page_url) || str(oa.oa_url) || str(w.id),
        pdfUrl: pdf,
        citedByCount: typeof w.cited_by_count === "number" ? w.cited_by_count : undefined,
      },
    ];
  });
}

// ----------------------------------------------------------------------------
// arXiv (Atom XML)
// ----------------------------------------------------------------------------

function xmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

async function searchArxiv(q: string): Promise<LibrarySource[]> {
  const terms = q
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0) return [];
  const searchQuery = terms.map((t) => `all:${encodeURIComponent(t)}`).join("+AND+");
  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${PER_PROVIDER}&sortBy=relevance`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const entries = xml.split(/<entry>/).slice(1);
  return entries.flatMap((entry): LibrarySource[] => {
    const absUrl = xmlTag(entry, "id");
    const title = xmlTag(entry, "title");
    if (!absUrl || !title) return [];
    const arxivId = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => decodeEntities(m[1]).trim());
    const published = xmlTag(entry, "published");
    const doi = cleanDoi(xmlTag(entry, "arxiv:doi"));
    const journal = xmlTag(entry, "arxiv:journal_ref");
    return [
      {
        id: doi ? `doi:${doi.toLowerCase()}` : `arxiv:${arxivId}`,
        kind: doi ? "paper" : "preprint",
        provider: "arxiv",
        title,
        authors,
        year: published ? Number(published.slice(0, 4)) : undefined,
        venue: journal || "arXiv",
        abstract: xmlTag(entry, "summary").slice(0, 1500) || undefined,
        doi,
        url: `https://arxiv.org/abs/${arxivId}`,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      },
    ];
  });
}

// ----------------------------------------------------------------------------
// eCFR — Código de Regulaciones Federales (OSHA, EPA, FAA, DOT…)
// ----------------------------------------------------------------------------

async function searchEcfr(q: string, agency?: string): Promise<LibrarySource[]> {
  const params = new URLSearchParams({ query: q, per_page: String(PER_PROVIDER) });
  const title = agency ? AGENCY_TITLES[agency] : undefined;
  if (title) params.set("hierarchy[title]", String(title));
  let data: { results?: unknown[] };
  try {
    data = (await getJson(`https://www.ecfr.gov/api/search/v1/results?${params}`)) as { results?: unknown[] };
  } catch (error) {
    // Si el filtro por título no se acepta, se reintenta sin él.
    if (!title) throw error;
    params.delete("hierarchy[title]");
    data = (await getJson(`https://www.ecfr.gov/api/search/v1/results?${params}`)) as { results?: unknown[] };
  }
  const seen = new Set<string>();
  return (data.results ?? []).flatMap((raw): LibrarySource[] => {
    const r = raw as {
      hierarchy?: Record<string, unknown>;
      headings?: Record<string, unknown>;
      full_text_excerpt?: unknown;
      starts_on?: unknown;
      removed?: unknown;
    };
    if (r.removed === true) return [];
    const h = r.hierarchy ?? {};
    const titleNum = str(h.title) || String(h.title ?? "");
    const section = str(h.section);
    const part = str(h.part);
    if (!titleNum || (!section && !part)) return [];
    const key = `${titleNum}-${section || part}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const headings = r.headings ?? {};
    const heading = stripTags(str(headings.section) || str(headings.part) || str(headings.subpart) || "Regulación federal").replace(/[.\s ]+$/u, "");
    const agencyName = stripTags(str(headings.chapter) || str(headings.subtitle) || str(headings.title));
    const designation = section ? `${titleNum} CFR ${section}` : `${titleNum} CFR Part ${part}`;
    const startsOn = str(r.starts_on);
    return [
      {
        id: `ecfr:${key}`,
        kind: "regulation",
        provider: "ecfr",
        title: heading,
        authors: [],
        year: startsOn ? Number(startsOn.slice(0, 4)) : undefined,
        venue: agencyName || undefined,
        designation,
        abstract: stripTags(str(r.full_text_excerpt)).slice(0, 800) || undefined,
        url: section
          ? `https://www.ecfr.gov/current/title-${titleNum}/section-${section}`
          : `https://www.ecfr.gov/current/title-${titleNum}/part-${part}`,
      },
    ];
  });
}

// ----------------------------------------------------------------------------
// Crossref — metadatos citables (normas técnicas y DOIs)
// ----------------------------------------------------------------------------

/** Los DOIs de ASTM llevan la designación oficial: 10.1520/F3322-18 → "ASTM F3322-18". */
function standardDesignation(doi: string): string | undefined {
  const astm = doi.match(/^10\.1520\/([A-Z]\d{2,5}[A-Z]?(?:_[A-Z]\d+)?-\d{2}[A-Z0-9]*)$/i);
  return astm ? `ASTM ${astm[1].toUpperCase()}` : undefined;
}

function crossrefToSource(raw: unknown): LibrarySource | null {
  const w = raw as Record<string, unknown>;
  const titleArr = Array.isArray(w.title) ? w.title : [];
  const title = stripTags(str(titleArr[0]));
  const doi = cleanDoi(w.DOI);
  if (!title || !doi) return null;
  const authors = (Array.isArray(w.author) ? w.author : [])
    .map((a) => {
      const au = a as { given?: unknown; family?: unknown; name?: unknown };
      return [str(au.given), str(au.family)].filter(Boolean).join(" ") || str(au.name);
    })
    .filter(Boolean);
  const dateParts = ((w.published ?? w.issued) as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0];
  const year = Array.isArray(dateParts) && typeof dateParts[0] === "number" ? dateParts[0] : undefined;
  const container = Array.isArray(w["container-title"]) ? str(w["container-title"][0]) : "";
  const type = str(w.type);
  const isStandard = type === "standard";
  const publisher = str(w.publisher);
  return {
    id: `doi:${doi.toLowerCase()}`,
    kind: isStandard ? "standard" : "paper",
    provider: "crossref",
    title,
    authors: isStandard ? [] : authors,
    year,
    venue: isStandard ? publisher || container || undefined : container || publisher || undefined,
    designation: isStandard ? standardDesignation(doi) : undefined,
    abstract: w.abstract ? stripTags(str(w.abstract)).slice(0, 1200) : isStandard ? "Metadatos citables de la norma. El texto completo se consulta en la página oficial del organismo emisor." : undefined,
    doi,
    url: `https://doi.org/${doi}`,
  };
}

async function searchCrossref(q: string, standardsOnly: boolean): Promise<LibrarySource[]> {
  const params = new URLSearchParams({
    "query.bibliographic": q,
    rows: String(PER_PROVIDER),
    select: "DOI,title,subtitle,author,published,issued,container-title,publisher,type,abstract",
  });
  if (standardsOnly) params.set("filter", "type:standard");
  const data = (await getJson(`https://api.crossref.org/works?${params}`)) as { message?: { items?: unknown[] } };
  // Crossref repite la misma norma en cada edición: se queda la primera de cada título.
  const seen = new Set<string>();
  return (data.message?.items ?? [])
    .map(crossrefToSource)
    .filter((s): s is LibrarySource => {
      if (!s) return false;
      const key = `${s.title.toLowerCase()}|${s.venue ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function resolveDoi(doi: string): Promise<LibrarySource[]> {
  const data = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as { message?: unknown };
  const source = crossrefToSource(data.message);
  return source ? [source] : [];
}

// ----------------------------------------------------------------------------
// YouTube
// ----------------------------------------------------------------------------

function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = url.searchParams.get("v");
      if (v) return v;
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch {
    // No es una URL.
  }
  return null;
}

async function youtubeOEmbed(url: string, videoId: string): Promise<LibrarySource[]> {
  const params = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: "json" });
  const data = (await getJson(`https://www.youtube.com/oembed?${params}`)) as Record<string, unknown>;
  const title = str(data.title);
  if (!title) return [];
  return [
    {
      id: `youtube:${videoId}`,
      kind: "video",
      provider: "youtube",
      title,
      authors: [],
      venue: str(data.author_name) || undefined,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: str(data.thumbnail_url) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoId,
      abstract: str(data.author_url) ? `Canal: ${str(data.author_name)} (${str(data.author_url)})` : undefined,
    },
  ];
}

async function youtubeDataSearch(q: string, apiKey: string): Promise<LibrarySource[]> {
  const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(PER_PROVIDER), q, key: apiKey, safeSearch: "strict" });
  const data = (await getJson(`https://www.googleapis.com/youtube/v3/search?${params}`)) as { items?: unknown[] };
  return (data.items ?? []).flatMap((raw): LibrarySource[] => {
    const item = raw as { id?: { videoId?: unknown }; snippet?: Record<string, unknown> };
    const videoId = str(item.id?.videoId);
    const sn = item.snippet ?? {};
    if (!videoId) return [];
    const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: unknown }>;
    const published = str(sn.publishedAt);
    return [
      {
        id: `youtube:${videoId}`,
        kind: "video",
        provider: "youtube",
        title: decodeEntities(str(sn.title)),
        authors: [],
        year: published ? Number(published.slice(0, 4)) : undefined,
        venue: decodeEntities(str(sn.channelTitle)) || undefined,
        abstract: decodeEntities(str(sn.description)) || undefined,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: str(thumbs.high?.url) || str(thumbs.medium?.url) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        videoId,
      },
    ];
  });
}

// ----------------------------------------------------------------------------
// Orquestación
// ----------------------------------------------------------------------------

type Job = { provider: LibraryProvider; run: () => Promise<LibrarySource[]> };

async function runJobs(jobs: Job[]) {
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const results: LibrarySource[] = [];
  const providers: LibraryProvider[] = [];
  const issues: LibraryProviderIssue[] = [];
  settled.forEach((r, i) => {
    const provider = jobs[i].provider;
    if (r.status === "fulfilled") {
      providers.push(provider);
      results.push(...r.value);
    } else {
      console.warn(`[library] ${provider} falló:`, r.reason instanceof Error ? r.reason.message : r.reason);
      issues.push({ provider, message: describeError(r.reason) });
    }
  });
  return { results, providers, issues };
}

/** Intercala los resultados de cada proveedor y quita duplicados (mismo DOI). */
function interleave(results: LibrarySource[]): LibrarySource[] {
  const byProvider = new Map<LibraryProvider, LibrarySource[]>();
  for (const r of results) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  const queues = [...byProvider.values()];
  const out: LibrarySource[] = [];
  const seen = new Set<string>();
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) {
      const item = q[i];
      if (!item) continue;
      const key = item.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export async function GET(request: NextRequest): Promise<NextResponse<LibrarySearchResponse | { error: string }>> {
  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 300);
  const scopeParam = sp.get("scope");
  const scope: LibraryScope =
    scopeParam === "codes" || scopeParam === "youtube" || scopeParam === "linkedin" ? scopeParam : "papers";
  const agency = (sp.get("agency") ?? "").toLowerCase();

  if (q.length < 2) {
    return NextResponse.json({ error: "Escribe al menos 2 caracteres para buscar." }, { status: 400 });
  }
  if (scope === "linkedin") {
    return NextResponse.json({
      query: q,
      scope,
      results: [],
      providers: [],
      issues: [],
      notice: "Las tarjetas de LinkedIn se crean en tu navegador con el título y resumen que tú escribas (LinkedIn no permite leer su contenido automáticamente).",
    });
  }

  const cacheKey = `${scope}|${agency}|${q.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.body);

  let body: LibrarySearchResponse;

  if (scope === "youtube") {
    const id = youtubeId(q);
    const ytKey = process.env.YOUTUBE_API_KEY?.trim();
    if (id) {
      const { results, providers, issues } = await runJobs([{ provider: "youtube", run: () => youtubeOEmbed(q, id) }]);
      body = {
        query: q,
        scope,
        results,
        providers,
        issues,
        notice:
          results.length === 0
            ? "YouTube no devolvió datos de este video (puede ser privado o tener la inserción desactivada). Puedes guardarlo igualmente como enlace."
            : undefined,
      };
    } else if (ytKey) {
      const { results, providers, issues } = await runJobs([{ provider: "youtube", run: () => youtubeDataSearch(q, ytKey) }]);
      body = { query: q, scope, results, providers, issues };
    } else {
      body = {
        query: q,
        scope,
        results: [],
        providers: [],
        issues: [],
        notice:
          "Pega el enlace de un video de YouTube para traer título, canal y miniatura al instante. La búsqueda por texto abre YouTube en otra pestaña (requiere YOUTUBE_API_KEY para buscar aquí dentro).",
      };
    }
  } else {
    const doiMatch = q.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
    const jobs: Job[] = doiMatch
      ? [{ provider: "crossref", run: () => resolveDoi(doiMatch[1].replace(/[.,;)]+$/, "")) }]
      : scope === "papers"
        ? [
            { provider: "openalex", run: () => searchOpenAlex(q) },
            { provider: "arxiv", run: () => searchArxiv(q) },
          ]
        : [
            { provider: "ecfr", run: () => searchEcfr(q, agency || undefined) },
            { provider: "crossref", run: () => searchCrossref(q, true) },
          ];
    const { results, providers, issues } = await runJobs(jobs);
    if (providers.length === 0) {
      body = {
        query: q,
        scope,
        results: searchOfflineCatalog(q, scope),
        providers: ["offline"],
        issues,
        offline: true,
        notice:
          "Las bases de datos públicas no respondieron ahora mismo. Te muestro el catálogo verificado de Andros (fuentes reales con DOI o enlace oficial). Reintenta en unos segundos para resultados en vivo.",
      };
    } else {
      body = {
        query: q,
        scope,
        results: interleave(results).slice(0, 16),
        providers,
        issues,
        notice: results.length === 0 ? "Sin coincidencias. Prueba con términos en inglés o más generales." : undefined,
      };
    }
  }

  // Solo se guardan en caché las respuestas en vivo y sin fallos.
  if (!body.offline && body.issues.length === 0) {
    cache.set(cacheKey, { at: Date.now(), body });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  }
  return NextResponse.json(body);
}
