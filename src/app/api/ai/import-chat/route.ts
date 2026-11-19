// ============================================================================
// ANDROS — IMPORTADOR DE CONVERSACIONES EXTERNAS
//
// POST { url }  → lee un enlace PÚBLICO compartido (chatgpt.com/share/…,
//                 claude.ai/share/…, gemini.google.com/share/…). Nunca usa
//                 sesiones ni cookies: solo lo que cualquiera ve sin iniciar
//                 sesión. Si la plataforma no deja leerlo de forma automática,
//                 responde { ok: false, code: "blocked" } para pegar el texto.
// POST { text, fileName?, conversationIndex? } → texto, Markdown o JSON
//                 exportado de ChatGPT, Claude o Gemini.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  parseChatImport,
  PLATFORM_LABELS,
  sharePlatformOf,
  type ImportedConversation,
  type ParsedImport,
} from "@/lib/ai/chatImport";
import type { AiChatSourcePlatform } from "@/types/workspace";

export const maxDuration = 30;

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 8_000_000;
const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "g.co"]);
const USER_AGENT = "Mozilla/5.0 (compatible; AndrosImporter/1.0)";

export interface ImportChatSuccess {
  ok: true;
  platform: AiChatSourcePlatform;
  title: string;
  messages: { role: "user" | "assistant"; text: string; at?: number }[];
  sourceUrl?: string;
  /** Si el archivo traía varias conversaciones: lista para elegir. */
  conversations?: { index: number; title: string; count: number }[];
  conversationIndex?: number;
}

export interface ImportChatFailure {
  ok: false;
  code: "unsupported_url" | "blocked" | "not_found" | "empty" | "too_large" | "bad_request";
  message: string;
  platform?: AiChatSourcePlatform;
  title?: string;
}

export type ImportChatResponse = ImportChatSuccess | ImportChatFailure;

const fail = (body: Omit<ImportChatFailure, "ok">, status = 200) =>
  NextResponse.json<ImportChatResponse>({ ok: false, ...body }, { status });

function pasteHint(platform: AiChatSourcePlatform): string {
  const name = PLATFORM_LABELS[platform];
  return `${name} no permite leer este enlace de forma automática. Abre la conversación, copia todo el texto (o exporta tus datos de ${name}) y pégalo en «Pegar / archivo»: el enlace quedará guardado en el nodo.`;
}

/** fetch con redirecciones manuales: cada salto debe quedarse en un host permitido. */
async function safeFetch(url: string, accept: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const u = new URL(current);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname.replace(/^www\./, ""))) return null;
    const res = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "es,en;q=0.8" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function metaTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = og ?? html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  return title.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

/** Busca, dentro de cualquier JSON incrustado, un objeto con forma de conversación. */
function findConversationObject(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || depth > 12) return null;
  const o = value as Record<string, unknown>;
  if ((o.mapping && typeof o.mapping === "object") || Array.isArray(o.chat_messages)) return o;
  for (const child of Array.isArray(value) ? value : Object.values(o)) {
    const found = findConversationObject(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseEmbeddedJson(html: string): ParsedImport | null {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());
  for (const body of scripts) {
    if (!body.startsWith("{") && !body.startsWith("[")) continue;
    if (!/"mapping"|"chat_messages"/.test(body)) continue;
    try {
      const found = findConversationObject(JSON.parse(body));
      if (found) {
        const parsed = parseChatImport(JSON.stringify([found]));
        if (parsed) return parsed;
      }
    } catch {
      // JSON incrustado con otro formato: se ignora.
    }
  }
  return null;
}

async function importFromClaude(url: URL): Promise<ImportedConversation | "not_found" | null> {
  const id = url.pathname.split("/").filter(Boolean)[1];
  if (!id || !/^[\w-]{8,64}$/.test(id)) return null;
  const res = await safeFetch(
    `https://claude.ai/api/chat_snapshots/${id}?rendering_mode=messages&render_all_tools=true`,
    "application/json"
  );
  if (res && (res.status === 404 || res.status === 410) && res.headers.get("content-type")?.includes("json")) {
    return "not_found";
  }
  if (!res || !res.ok || !res.headers.get("content-type")?.includes("json")) return null;
  const data = JSON.parse(await readLimited(res)) as Record<string, unknown>;
  const parsed = parseChatImport(JSON.stringify([data]));
  const conv = parsed?.conversations[0];
  if (!conv) return null;
  const name = typeof data.snapshot_name === "string" ? data.snapshot_name : "";
  return name ? { ...conv, title: name } : conv;
}

async function importFromUrl(rawUrl: string): Promise<NextResponse<ImportChatResponse>> {
  const platform = sharePlatformOf(rawUrl);
  if (!platform) {
    return fail(
      {
        code: "unsupported_url",
        message:
          "Solo se pueden importar enlaces públicos compartidos: chatgpt.com/share/…, claude.ai/share/… o gemini.google.com/share/…",
      },
      400
    );
  }
  const url = new URL(rawUrl.trim());
  const sourceUrl = url.toString();

  try {
    if (platform === "claude") {
      const conv = await importFromClaude(url);
      if (conv === "not_found") {
        return fail({
          code: "not_found",
          platform,
          message: "El enlace no existe o ya no es público. Revisa que la conversación siga compartida.",
        });
      }
      if (conv) {
        return NextResponse.json<ImportChatResponse>({
          ok: true,
          platform,
          title: conv.title,
          messages: conv.messages,
          sourceUrl,
        });
      }
    }

    const res = await safeFetch(sourceUrl, "text/html,application/xhtml+xml");
    if (!res) return fail({ code: "blocked", platform, message: pasteHint(platform) });
    if (res.status === 404 || res.status === 410) {
      return fail({
        code: "not_found",
        platform,
        message: "El enlace no existe o ya no es público. Revisa que la conversación siga compartida.",
      });
    }
    if (!res.ok) return fail({ code: "blocked", platform, message: pasteHint(platform) });

    const html = await readLimited(res);
    const title = metaTitle(html);
    const parsed = parseEmbeddedJson(html);
    const conv = parsed?.conversations[0];
    if (conv) {
      return NextResponse.json<ImportChatResponse>({
        ok: true,
        platform,
        title: conv.title || title,
        messages: conv.messages,
        sourceUrl,
      });
    }
    // La página se carga con JavaScript en el navegador: no hay mensajes legibles.
    return fail({ code: "blocked", platform, title: title || undefined, message: pasteHint(platform) });
  } catch {
    return fail({ code: "blocked", platform, message: pasteHint(platform) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ImportChatResponse>> {
  let body: { url?: unknown; text?: unknown; fileName?: unknown; conversationIndex?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail({ code: "bad_request", message: "Petición inválida." }, 400);
  }

  if (typeof body.url === "string" && body.url.trim()) return importFromUrl(body.url);

  if (typeof body.text !== "string" || !body.text.trim()) {
    return fail({ code: "empty", message: "Pega el texto de la conversación o elige un archivo." }, 400);
  }
  if (body.text.length > MAX_TEXT_CHARS) {
    return fail({ code: "too_large", message: "El archivo es demasiado grande para importarlo de una vez." }, 413);
  }
  const parsed = parseChatImport(body.text, typeof body.fileName === "string" ? body.fileName : "");
  if (!parsed) {
    return fail({ code: "empty", message: "No encontré mensajes en lo que pegaste. Revisa el texto o el archivo." });
  }
  const index = Math.min(
    Math.max(0, Number.isInteger(body.conversationIndex) ? Number(body.conversationIndex) : 0),
    parsed.conversations.length - 1
  );
  const conv = parsed.conversations[index];
  return NextResponse.json<ImportChatResponse>({
    ok: true,
    platform: parsed.platform,
    title: conv.title,
    messages: conv.messages,
    conversationIndex: index,
    ...(parsed.conversations.length > 1
      ? {
          conversations: parsed.conversations.slice(0, 200).map((c, i) => ({
            index: i,
            title: c.title,
            count: c.messages.length,
          })),
        }
      : {}),
  });
}
