// ============================================================================
// ANDROS — ENDPOINT LIGERO DE VISTA PREVIA DE ENLACES (BLOQUE 3)
//
// Detecta la plataforma de una URL y devuelve metadatos normalizados:
// - YouTube: oEmbed público (título, autor, miniatura) + id del video.
// - GitHub: API pública de repos (descripción, estrellas, lenguaje).
// - Papers (arXiv/DOI/OpenAlex/Semantic Scholar) y el resto: se raspan las
//   etiquetas <title> / <meta citation_*> / og:* de la página.
// Todo corre en el servidor: nunca se expone una clave ni se hace la petición
// desde el navegador del usuario (evita problemas de CORS).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import type {
  ResourceGitHubData,
  ResourceLinkPlatform,
  ResourcePaperData,
} from "@/types/workspace";

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 400_000;

interface LinkPreviewResult {
  platform: ResourceLinkPlatform;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  youtube?: { videoId: string };
  github?: ResourceGitHubData;
  paper?: ResourcePaperData;
  errorMessage?: string;
}

function detectPlatform(url: URL): ResourceLinkPlatform {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube";
  if (host === "github.com") return "github";
  if (
    host === "arxiv.org" ||
    host === "doi.org" ||
    host.endsWith(".doi.org") ||
    host === "openalex.org" ||
    host === "semanticscholar.org" ||
    host === "api.semanticscholar.org"
  ) {
    return "paper";
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  return "generic";
}

function extractYoutubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com") {
    const v = url.searchParams.get("v");
    if (v) return v;
    const match = url.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
    if (match) return match[2];
  }
  return null;
}

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
}

/** Lee como máximo `MAX_HTML_BYTES` del cuerpo (páginas de papers pueden ser enormes). */
async function readLimitedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // Ignorado: ya tenemos lo que necesitamos.
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Extrae todas las coincidencias de un <meta> por nombre/propiedad. */
function metaAll(html: string, key: string): string[] {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "gi"
  );
  const altPattern = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["'][^>]*>`,
    "gi"
  );
  const values: string[] = [];
  for (const re of [pattern, altPattern]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html))) values.push(decodeHtmlEntities(match[1]).trim());
  }
  return values;
}

function metaOne(html: string, key: string): string | undefined {
  return metaAll(html, key)[0];
}

function extractTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : undefined;
}

// ----------------------------------------------------------------------------
// YouTube — oEmbed público, sin clave.
// ----------------------------------------------------------------------------

async function previewYoutube(url: URL): Promise<LinkPreviewResult> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    return { platform: "youtube", errorMessage: "No se encontró el id del video en la URL" };
  }
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`
    );
    if (!res.ok) throw new Error(`oEmbed respondió ${res.status}`);
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      platform: "youtube",
      title: data.title,
      description: data.author_name ? `Canal: ${data.author_name}` : undefined,
      siteName: "YouTube",
      imageUrl: data.thumbnail_url,
      youtube: { videoId },
    };
  } catch {
    // El reproductor funciona igual aunque el título no se pueda consultar.
    return { platform: "youtube", youtube: { videoId }, siteName: "YouTube" };
  }
}

// ----------------------------------------------------------------------------
// GitHub — API pública de repos.
// ----------------------------------------------------------------------------

async function previewGithub(url: URL): Promise<LinkPreviewResult> {
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repoRaw] = parts;
  const repo = repoRaw?.replace(/\.git$/, "");
  if (!owner || !repo) {
    return { platform: "github", errorMessage: "Pega la URL de un repositorio: github.com/usuario/repo" };
  }
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, {
      Accept: "application/vnd.github+json",
      "User-Agent": "andros-workspace-link-preview",
    });
    if (!res.ok) {
      throw new Error(res.status === 404 ? "Repositorio no encontrado" : `GitHub respondió ${res.status}`);
    }
    const data = (await res.json()) as {
      full_name: string;
      description: string | null;
      stargazers_count: number;
      language: string | null;
      html_url: string;
    };
    const github: ResourceGitHubData = {
      owner,
      repo,
      description: data.description ?? "",
      stars: data.stargazers_count ?? 0,
      language: data.language ?? "",
      htmlUrl: data.html_url,
    };
    return {
      platform: "github",
      title: data.full_name,
      description: github.description,
      siteName: "GitHub",
      github,
    };
  } catch (error) {
    return {
      platform: "github",
      errorMessage: error instanceof Error ? error.message : "No se pudo consultar GitHub",
    };
  }
}

// ----------------------------------------------------------------------------
// Papers científicos (arXiv, DOI, OpenAlex, Semantic Scholar...) y genérico.
// ----------------------------------------------------------------------------

async function scrapeHtmlMeta(targetUrl: string): Promise<{
  html: string;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
}> {
  const res = await fetchWithTimeout(targetUrl, {
    "User-Agent": "Mozilla/5.0 (compatible; AndrosLinkPreview/1.0; +https://andros.app)",
    Accept: "text/html,application/xhtml+xml",
  });
  if (!res.ok) throw new Error(`La página respondió ${res.status}`);
  const html = await readLimitedText(res);
  return {
    html,
    title: metaOne(html, "og:title") || metaOne(html, "twitter:title") || extractTitleTag(html),
    description: metaOne(html, "og:description") || metaOne(html, "description") || metaOne(html, "twitter:description"),
    siteName: metaOne(html, "og:site_name"),
    imageUrl: metaOne(html, "og:image") || metaOne(html, "twitter:image"),
  };
}

async function previewPaper(targetUrl: string): Promise<LinkPreviewResult> {
  try {
    const { html, title, description, siteName, imageUrl } = await scrapeHtmlMeta(targetUrl);
    const citationTitle = metaOne(html, "citation_title");
    const authors = metaAll(html, "citation_author");
    const abstract = metaOne(html, "citation_abstract") || description;

    const paper: ResourcePaperData = {
      title: citationTitle || title || "Paper sin título",
      authors: authors.length > 0 ? authors.join(", ") : "Autores no disponibles",
      source: siteName || new URL(targetUrl).hostname.replace(/^www\./, ""),
      summary: (abstract || "").replace(/^Abstract[:.]?\s*/i, ""),
    };
    return {
      platform: "paper",
      title: paper.title,
      description: paper.summary,
      siteName: paper.source,
      imageUrl,
      paper,
    };
  } catch (error) {
    return {
      platform: "paper",
      errorMessage: error instanceof Error ? error.message : "No se pudo leer el paper",
    };
  }
}

async function previewGeneric(targetUrl: string, platform: ResourceLinkPlatform): Promise<LinkPreviewResult> {
  try {
    const { title, description, siteName, imageUrl } = await scrapeHtmlMeta(targetUrl);
    return {
      platform,
      title: title || new URL(targetUrl).hostname,
      description,
      siteName: siteName || new URL(targetUrl).hostname.replace(/^www\./, ""),
      imageUrl,
    };
  } catch (error) {
    return {
      platform,
      errorMessage: error instanceof Error ? error.message : "No se pudo leer esta página",
    };
  }
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse<LinkPreviewResult>> {
  const rawUrl = request.nextUrl.searchParams.get("url") ?? "";

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocolo inválido");
  } catch {
    return NextResponse.json({ platform: "generic", errorMessage: "URL inválida" }, { status: 400 });
  }

  const platform = detectPlatform(url);

  try {
    let result: LinkPreviewResult;
    switch (platform) {
      case "youtube":
        result = await previewYoutube(url);
        break;
      case "github":
        result = await previewGithub(url);
        break;
      case "paper":
        result = await previewPaper(url.toString());
        break;
      default:
        result = await previewGeneric(url.toString(), platform);
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      platform,
      errorMessage: error instanceof Error ? error.message : "No se pudo leer el enlace",
    });
  }
}
