// ============================================================================
// ANDROS — MENCIONES @Área, @usuario y @IA (funciones puras, sin store)
// (Sprint 18) Las usan el chat del lienzo, las fichas y la bandeja interna:
//   · `parseMentions`: texto → menciones reconocidas + segmentos para resaltar.
//     Solo cuenta como mención lo que existe en el espacio (un área activa, un
//     @usuario miembro o @IA); el resto queda como texto normal.
//   · `activeMentionQuery` / `suggestMentions` / `applyMentionCompletion`:
//     autocompletado al escribir «@».
//   · `mentionsTarget`: ¿este mensaje te notifica (a ti o a tu área)?
// ============================================================================

import { areaKey, AREA_MAX_CHARS } from "./areas";

export type Mention =
  | { kind: "area"; value: string }
  | { kind: "user"; id: string; value: string }
  | { kind: "ai"; value: "IA" };

export interface MentionUser {
  id: string;
  /** @usuario (sin «@»); sin él la persona no se puede mencionar. */
  username: string | null;
  name: string;
  area?: string;
}

export interface MentionDirectory {
  areas: readonly string[];
  users: readonly MentionUser[];
}

export type MentionSegment = { type: "text"; text: string } | { type: "mention"; text: string; mention: Mention };

export const MENTIONS_MAX = 30;

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const USERNAME_RE = /^([a-z0-9_]{3,20})/i;

const isWordChar = (ch: string | undefined): boolean => Boolean(ch) && WORD_CHAR.test(ch as string);

function mentionKey(m: Mention): string {
  return m.kind === "user" ? `user:${m.id}` : `${m.kind}:${areaKey(m.value)}`;
}

/** Intenta reconocer una mención que empieza justo después de una «@». */
function matchAt(rest: string, dir: MentionDirectory, areasByLength: readonly string[]): { length: number; mention: Mention } | null {
  // @IA (también «@ia»), seguida de algo que no sea letra o número.
  if (/^ia(?![\p{L}\p{N}_])/iu.test(rest)) return { length: 2, mention: { kind: "ai", value: "IA" } };

  // Áreas: la más larga primero («Diseño gráfico» antes que «Diseño»).
  for (const area of areasByLength) {
    const candidate = rest.slice(0, area.length);
    if (candidate.length === area.length && areaKey(candidate) === areaKey(area) && !isWordChar(rest[area.length])) {
      return { length: area.length, mention: { kind: "area", value: area } };
    }
  }

  // @usuario de un miembro del espacio.
  const user = rest.match(USERNAME_RE)?.[1];
  if (user && !isWordChar(rest[user.length])) {
    const lower = user.toLowerCase();
    const found = dir.users.find((u) => u.username?.toLowerCase() === lower);
    if (found?.username) return { length: user.length, mention: { kind: "user", id: found.id, value: found.username } };
  }
  return null;
}

/** Menciones reconocidas (sin repetir, en orden de aparición) y segmentos para pintarlas. */
export function parseMentions(text: string, dir: MentionDirectory): { mentions: Mention[]; segments: MentionSegment[] } {
  const areasByLength = [...dir.areas].sort((a, b) => b.length - a.length);
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  const segments: MentionSegment[] = [];
  let buffer = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "@" && !isWordChar(text[i - 1])) {
      const hit = matchAt(text.slice(i + 1, i + 1 + AREA_MAX_CHARS + 1), dir, areasByLength);
      if (hit) {
        if (buffer) segments.push({ type: "text", text: buffer });
        buffer = "";
        const raw = text.slice(i, i + 1 + hit.length);
        segments.push({ type: "mention", text: raw, mention: hit.mention });
        const key = mentionKey(hit.mention);
        if (!seen.has(key) && mentions.length < MENTIONS_MAX) {
          seen.add(key);
          mentions.push(hit.mention);
        }
        i += 1 + hit.length;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  if (buffer) segments.push({ type: "text", text: buffer });
  return { mentions, segments };
}

/** `true` si el texto pide algo a la IA (@IA). */
export function mentionsAi(mentions: readonly Mention[]): boolean {
  return mentions.some((m) => m.kind === "ai");
}

/** ¿Te notifica? Te menciona directamente o menciona tu área. Nunca tus propios mensajes. */
export function mentionsTarget(
  mentions: readonly Mention[],
  me: { userId: string | null; area: string | null },
  authorId?: string | null
): boolean {
  if (!me.userId || (authorId && authorId === me.userId)) return false;
  return mentions.some(
    (m) =>
      (m.kind === "user" && m.id === me.userId) ||
      (m.kind === "area" && Boolean(me.area) && areaKey(m.value) === areaKey(me.area as string))
  );
}

/** Personas que recibe cada mención de área (para «notificar a los integrantes»). */
export function recipientsOf(mentions: readonly Mention[], users: readonly MentionUser[]): string[] {
  const ids = new Set<string>();
  for (const m of mentions) {
    if (m.kind === "user") ids.add(m.id);
    if (m.kind === "area") {
      for (const u of users) if (u.area && areaKey(u.area) === areaKey(m.value)) ids.add(u.id);
    }
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Validación (filas de Supabase y mensajes de la sala)
// ----------------------------------------------------------------------------

/** jsonb `mentions` → menciones válidas (descarta cualquier forma desconocida). */
export function sanitizeMentions(raw: unknown): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const value = typeof o.value === "string" ? o.value.trim().slice(0, AREA_MAX_CHARS) : "";
    let mention: Mention | null = null;
    if (o.kind === "ai") mention = { kind: "ai", value: "IA" };
    else if (o.kind === "area" && value) mention = { kind: "area", value };
    else if (o.kind === "user" && value && typeof o.id === "string" && o.id.length <= 64 && o.id) {
      mention = { kind: "user", id: o.id, value };
    }
    if (!mention) continue;
    const key = mentionKey(mention);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mention);
    if (out.length >= MENTIONS_MAX) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Autocompletado al escribir «@»
// ----------------------------------------------------------------------------

/** Texto escrito tras la «@» que está antes del cursor (o `null` si no hay mención en curso). */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = upto.lastIndexOf("@");
  if (at === -1 || isWordChar(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > AREA_MAX_CHARS || /[\n@]/.test(query) || /\s{2}/.test(query) || /^\s/.test(query)) return null;
  // Un área puede tener espacios, pero no más de 3 palabras.
  if (query.split(" ").length > 3) return null;
  return { start: at, query };
}

export interface MentionSuggestion {
  kind: Mention["kind"];
  /** Texto que se inserta (con «@» y espacio final). */
  insert: string;
  label: string;
  /** Detalle corto: «3 personas», nombre completo o «Asistente». */
  detail: string;
  /** Personas del área (solo áreas). */
  count?: number;
  userId?: string;
}

/** Áreas primero (con su conteo de personas), luego personas y @IA. */
export function suggestMentions(
  query: string,
  dir: MentionDirectory & { areaCounts?: Record<string, number> },
  limit = 8
): MentionSuggestion[] {
  const q = areaKey(query);
  const out: MentionSuggestion[] = [];
  const rank = (key: string) => (key.startsWith(q) ? 0 : key.includes(q) ? 1 : 2);

  const areas = dir.areas
    .map((area) => ({ area, r: rank(areaKey(area)) }))
    .filter((a) => a.r < 2)
    .sort((a, b) => a.r - b.r || a.area.localeCompare(b.area, "es"));
  for (const { area } of areas) {
    const count = dir.areaCounts?.[area] ?? 0;
    out.push({
      kind: "area",
      insert: `@${area} `,
      label: `@${area}`,
      detail: count === 1 ? "1 persona" : `${count} personas`,
      count,
    });
  }

  const users = dir.users
    .filter((u): u is MentionUser & { username: string } => Boolean(u.username))
    .map((u) => ({ u, r: Math.min(rank(areaKey(u.username)), rank(areaKey(u.name))) }))
    .filter((x) => x.r < 2)
    .sort((a, b) => a.r - b.r || a.u.username.localeCompare(b.u.username));
  for (const { u } of users) {
    out.push({
      kind: "user",
      insert: `@${u.username} `,
      label: `@${u.username}`,
      detail: u.area ? `${u.name} · ${u.area}` : u.name,
      userId: u.id,
    });
  }

  if ("ia".startsWith(q)) out.push({ kind: "ai", insert: "@IA ", label: "@IA", detail: "Reportar un cambio o problema" });
  return out.slice(0, limit);
}

/** Sustituye la mención en curso por la sugerencia elegida y devuelve el cursor nuevo. */
export function applyMentionCompletion(
  text: string,
  start: number,
  caret: number,
  insert: string
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret).replace(/^\S*/, "").replace(/^ /, "");
  const next = `${before}${insert}${after}`;
  return { text: next, caret: before.length + insert.length };
}
