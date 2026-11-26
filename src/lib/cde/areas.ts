// ============================================================================
// ANDROS — ÁREAS DE TRABAJO NOMINALES DEL ESPACIO (funciones puras, sin store)
// (Sprint 18) Cada persona del espacio pertenece a un área («Logística»,
// «Presupuesto»…). Las áreas se mencionan con @Área en el chat y en las fichas
// y ordenan el tablero inicial. Espejo de supabase/schema.sql §18:
//   · workspaces.work_areas (≤ 12) y owner_work_area / work_area (≤ 32 car.).
// ============================================================================

export const AREA_MAX_COUNT = 12;
export const AREA_MAX_CHARS = 32;

/** Sugerencias del paso 2 del arranque (se puede crear cualquier otra). */
export const AREA_PRESETS: readonly string[] = ["Logística", "Presupuesto", "Diseño", "Ingeniería", "Operaciones"];

/**
 * Nombre limpio: sin espacios repetidos, sin «@» inicial y sin caracteres que
 * rompan una mención (solo letras, números, espacios, guiones y «&»).
 */
export function normalizeAreaName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = raw
    .replace(/^@+/, "")
    .replace(/[^\p{L}\p{N} &\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AREA_MAX_CHARS)
    .trim();
  if (!clean) return "";
  return clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
}

/** Clave de comparación: minúsculas y sin tildes («Logística» = «logistica»). */
export function areaKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function sameArea(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && areaKey(a) === areaKey(b);
}

/** Lista de áreas válida, sin duplicados (comparando sin tildes) y con tope. */
export function sanitizeAreaList(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = normalizeAreaName(item);
    const key = areaKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= AREA_MAX_COUNT) break;
  }
  return out;
}

/** El área tal como está escrita en la lista del espacio (o `null`). */
export function canonicalArea(name: string, areas: readonly string[]): string | null {
  if (!name) return null;
  const key = areaKey(name);
  return areas.find((a) => areaKey(a) === key) ?? null;
}

/**
 * Color estable de un área (índice 0–5). Los colores reales salen de tokens
 * con contraste AA en ambos motores (ver `AREA_BADGE_CLASSES` en la UI).
 */
export function areaColorIndex(name: string): number {
  let hash = 0;
  for (const ch of areaKey(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 6;
}

/** Personas por área (dueño incluido) para el autocompletado `@Área`. */
export function countPeopleByArea(people: readonly { area: string }[], areas: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(areas.map((a) => [a, 0]));
  for (const p of people) {
    const area = canonicalArea(p.area, areas);
    if (area) counts[area] = (counts[area] ?? 0) + 1;
  }
  return counts;
}
