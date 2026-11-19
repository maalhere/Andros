// ============================================================================
// ANDROS — LECTOR DE CONVERSACIONES EXTERNAS (ChatGPT, Claude, Gemini)
//
// Funciones puras (cliente y servidor). Entienden:
//   · conversations.json exportado de ChatGPT (árbol `mapping`)
//   · conversations.json exportado de Claude (`chat_messages`)
//   · Actividad de Gemini de Google Takeout (`safeHtmlItem`)
//   · JSON genérico [{ role, content }] o { messages: [...] }
//   · Texto o Markdown copiado ("You said:", "ChatGPT said:", "## User", "Claude:"…)
// ============================================================================

import type { AiChatSourcePlatform } from "@/types/workspace";

export interface ImportedTurn {
  role: "user" | "assistant";
  text: string;
  at?: number;
}

export interface ImportedConversation {
  title: string;
  messages: ImportedTurn[];
}

export interface ParsedImport {
  platform: AiChatSourcePlatform;
  conversations: ImportedConversation[];
}

const MAX_TURN_CHARS = 20_000;

export const PLATFORM_LABELS: Record<AiChatSourcePlatform, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  other: "chat externo",
};

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TURN_CHARS);
}

function titleFrom(messages: ImportedTurn[], fallback = "Conversación importada"): string {
  const first = messages.find((m) => m.role === "user")?.text ?? "";
  const line = first.split("\n")[0].trim();
  return line ? (line.length > 70 ? `${line.slice(0, 70)}…` : line) : fallback;
}

/** Normaliza el rol de cualquier exportación a user/assistant (null = descartar). */
function normalizeRole(role: unknown): "user" | "assistant" | null {
  const r = String(role ?? "").toLowerCase();
  if (["user", "human", "you", "usuario", "tú", "tu"].includes(r)) return "user";
  if (["assistant", "model", "ai", "bot", "chatgpt", "claude", "gemini", "gpt"].includes(r)) return "assistant";
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Texto de un "content" de cualquier formato (string, partes, bloques). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (Array.isArray(c.parts)) return contentText(c.parts);
    if (typeof c.text === "string") return c.text;
  }
  return "";
}

// ----------------------------------------------------------------------------
// ChatGPT: árbol `mapping` (se sigue la rama activa desde `current_node`)
// ----------------------------------------------------------------------------

interface ChatGptNode {
  parent?: string | null;
  children?: string[];
  message?: {
    author?: { role?: string };
    content?: unknown;
    create_time?: number | null;
    metadata?: { is_visually_hidden_from_conversation?: boolean };
  } | null;
}

function parseChatGptConversation(conv: Record<string, unknown>): ImportedConversation | null {
  const mapping = conv.mapping as Record<string, ChatGptNode> | undefined;
  if (!mapping || typeof mapping !== "object") return null;

  let ids: string[] = [];
  let cursor = typeof conv.current_node === "string" ? conv.current_node : null;
  const seen = new Set<string>();
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    ids.push(cursor);
    cursor = mapping[cursor].parent ?? null;
  }
  ids.reverse();
  if (ids.length === 0) {
    // Sin `current_node`: orden por fecha.
    ids = Object.keys(mapping).sort(
      (a, b) => (mapping[a].message?.create_time ?? 0) - (mapping[b].message?.create_time ?? 0)
    );
  }

  const messages: ImportedTurn[] = [];
  for (const id of ids) {
    const msg = mapping[id]?.message;
    if (!msg || msg.metadata?.is_visually_hidden_from_conversation) continue;
    const role = normalizeRole(msg.author?.role);
    const text = cleanText(contentText(msg.content));
    if (!role || !text) continue;
    messages.push({ role, text, ...(msg.create_time ? { at: Math.round(msg.create_time * 1000) } : {}) });
  }
  if (messages.length === 0) return null;
  return { title: typeof conv.title === "string" && conv.title ? conv.title : titleFrom(messages), messages };
}

// ----------------------------------------------------------------------------
// Claude: `chat_messages` con sender human/assistant
// ----------------------------------------------------------------------------

function parseClaudeConversation(conv: Record<string, unknown>): ImportedConversation | null {
  const list = conv.chat_messages;
  if (!Array.isArray(list)) return null;
  const messages: ImportedTurn[] = [];
  for (const item of list) {
    const m = (item ?? {}) as Record<string, unknown>;
    const role = normalizeRole(m.sender ?? m.role);
    const text = cleanText(typeof m.text === "string" && m.text ? m.text : contentText(m.content));
    if (!role || !text) continue;
    const at = typeof m.created_at === "string" ? Date.parse(m.created_at) : NaN;
    messages.push({ role, text, ...(Number.isFinite(at) ? { at } : {}) });
  }
  if (messages.length === 0) return null;
  const title = typeof conv.name === "string" && conv.name ? conv.name : titleFrom(messages);
  return { title, messages };
}

// ----------------------------------------------------------------------------
// Gemini (Google Takeout → "Mi actividad" de las apps de Gemini)
// ----------------------------------------------------------------------------

const GEMINI_PROMPT_PREFIX = /^(Prompted|Preguntaste|Has preguntado|Instrucción|Petición)\s*:?\s*/i;

function parseGeminiActivity(items: Record<string, unknown>[]): ImportedConversation | null {
  const sorted = [...items].sort((a, b) => Date.parse(String(a.time ?? "")) - Date.parse(String(b.time ?? "")));
  const messages: ImportedTurn[] = [];
  for (const item of sorted) {
    const at = Date.parse(String(item.time ?? ""));
    const prompt = typeof item.title === "string" ? cleanText(item.title.replace(GEMINI_PROMPT_PREFIX, "")) : "";
    if (prompt) messages.push({ role: "user", text: prompt, ...(Number.isFinite(at) ? { at } : {}) });
    const html = Array.isArray(item.safeHtmlItem)
      ? (item.safeHtmlItem as { html?: unknown }[]).map((h) => (typeof h?.html === "string" ? h.html : "")).join("\n")
      : "";
    const answer = cleanText(stripHtml(html));
    if (answer) messages.push({ role: "assistant", text: answer, ...(Number.isFinite(at) ? { at } : {}) });
  }
  if (messages.length === 0) return null;
  return { title: "Actividad de Gemini", messages };
}

// ----------------------------------------------------------------------------
// JSON genérico
// ----------------------------------------------------------------------------

function parseGenericMessages(list: unknown[], title?: string): ImportedConversation | null {
  const messages: ImportedTurn[] = [];
  for (const item of list) {
    const m = (item ?? {}) as Record<string, unknown>;
    const role = normalizeRole(m.role ?? m.author ?? m.sender);
    const text = cleanText(contentText(m.content ?? m.text ?? m.parts));
    if (role && text) messages.push({ role, text });
  }
  if (messages.length === 0) return null;
  return { title: title || titleFrom(messages), messages };
}

function parseJson(data: unknown): ParsedImport | null {
  const list = Array.isArray(data) ? data : [data];
  const objects = list.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  if (objects.length === 0) return null;

  if (objects.some((o) => o.mapping)) {
    const conversations = objects.map(parseChatGptConversation).filter((c): c is ImportedConversation => c !== null);
    return conversations.length > 0 ? { platform: "chatgpt", conversations } : null;
  }
  if (objects.some((o) => Array.isArray(o.chat_messages))) {
    const conversations = objects.map(parseClaudeConversation).filter((c): c is ImportedConversation => c !== null);
    return conversations.length > 0 ? { platform: "claude", conversations } : null;
  }
  if (objects.some((o) => typeof o.header === "string" && /gemini|bard/i.test(o.header))) {
    const conv = parseGeminiActivity(objects.filter((o) => typeof o.header === "string" && /gemini|bard/i.test(o.header)));
    return conv ? { platform: "gemini", conversations: [conv] } : null;
  }
  // { messages: [...] } o [{ role, content }]
  const single = objects.length === 1 ? objects[0] : null;
  if (single && Array.isArray(single.messages)) {
    const conv = parseGenericMessages(single.messages, typeof single.title === "string" ? single.title : undefined);
    return conv ? { platform: "other", conversations: [conv] } : null;
  }
  const conv = parseGenericMessages(objects);
  return conv ? { platform: "other", conversations: [conv] } : null;
}

// ----------------------------------------------------------------------------
// Texto / Markdown copiado
// ----------------------------------------------------------------------------

const SPEAKER_LINE =
  /^\s*(?:#{1,6}\s*|>\s*)?(?:\*\*|__)?\s*(You|User|Usuario|Tú|Human|Humano|ChatGPT|GPT[-\w.]*|Assistant|Asistente|Claude|Gemini)(?!\w)\s*(?:\(\w+\))?\s*(said|dijo)?\s*(?:\*\*|__)?\s*(:)?\s*(?:\*\*|__)?\s*(.*)$/i;

const USER_NAMES = /^(you|user|usuario|tú|human|humano)$/i;

function detectPlatform(text: string): AiChatSourcePlatform {
  if (/\bChatGPT\b|chatgpt\.com/i.test(text)) return "chatgpt";
  if (/\bClaude\b|claude\.ai/i.test(text)) return "claude";
  if (/\bGemini\b|gemini\.google\.com/i.test(text)) return "gemini";
  return "other";
}

function parseTranscript(text: string): ImportedConversation | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const messages: ImportedTurn[] = [];
  let title = "";
  let current: { role: "user" | "assistant"; lines: string[] } | null = null;
  let markers = 0;

  const flush = () => {
    if (current) {
      const body = cleanText(current.lines.join("\n"));
      if (body) messages.push({ role: current.role, text: body });
    }
  };

  for (const line of lines) {
    const match = line.match(SPEAKER_LINE);
    // Una línea es "marca de turno" solo si termina en ":" / "said" o es el nombre solo (encabezado).
    const isMarker = Boolean(match && (match[3] || match[2] || (match[4] ?? "").trim() === ""));
    if (match && isMarker) {
      markers += 1;
      flush();
      current = { role: USER_NAMES.test(match[1]) ? "user" : "assistant", lines: match[4] ? [match[4]] : [] };
      continue;
    }
    if (!current) {
      const heading = line.match(/^#\s+(.+)$/);
      if (heading && !title) {
        title = heading[1].trim();
        continue;
      }
      if (line.trim()) current = { role: "user", lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  flush();

  if (messages.length === 0) return null;
  if (markers === 0) {
    // Texto sin marcas de turno: se importa como un único bloque de contexto.
    return { title: title || "Contexto pegado", messages: [{ role: "user", text: cleanText(text) }] };
  }
  return { title: title || titleFrom(messages), messages };
}

/**
 * Lee una conversación pegada o subida (texto, Markdown o JSON exportado).
 * Devuelve null si no hay nada utilizable.
 */
export function parseChatImport(text: string, fileName = ""): ParsedImport | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = parseJson(JSON.parse(trimmed));
      if (parsed) return parsed;
    } catch {
      // No era JSON válido: se intenta como texto.
    }
  }
  const conv = parseTranscript(trimmed);
  if (!conv) return null;
  const hint = `${fileName}\n${trimmed.slice(0, 4000)}`;
  return { platform: detectPlatform(hint), conversations: [conv] };
}

/** Clave para no duplicar mensajes al "Actualizar contexto". */
export function turnKey(turn: { role: string; text: string }): string {
  return `${turn.role}|${turn.text.replace(/\s+/g, " ").trim().slice(0, 400)}`;
}

/** Plataforma de un enlace compartido público, o null si no es uno admitido. */
export function sharePlatformOf(url: string): AiChatSourcePlatform | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  if ((host === "chatgpt.com" || host === "chat.openai.com") && u.pathname.startsWith("/share/")) return "chatgpt";
  if (host === "claude.ai" && u.pathname.startsWith("/share/")) return "claude";
  if (host === "gemini.google.com" && u.pathname.startsWith("/share/")) return "gemini";
  if (host === "g.co" && u.pathname.startsWith("/gemini/share/")) return "gemini";
  return null;
}
