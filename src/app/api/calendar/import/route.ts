// ============================================================================
// ANDROS — LEER LOS PRÓXIMOS 14 DÍAS DE GOOGLE CALENDAR (Sprint 16)
// POST { timeZone }
// Cabeceras: Authorization (sesión de Andros) + X-Google-Token.
//
// Devuelve los eventos del calendario `primary` en hora local para que el
// navegador los convierta en una tarjeta. El calendario NO se guarda en
// ningún servidor de Andros: solo pasa por esta respuesta.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import {
  GOOGLE_EVENTS_ENDPOINT,
  IMPORT_WINDOW_DAYS,
  classifyGoogleError,
  isValidTimeZone,
  normalizeGoogleItem,
  type GoogleCalendarIssue,
  type ImportedCalendarEvent,
} from "@/lib/calendar/googleEvents";

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 50;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const caller = await getRequestUser(request);
  if (!caller) return json({ error: "Inicia sesión para usar Google Calendar." }, 401);
  const token = request.headers.get("x-google-token")?.trim() ?? "";
  if (!/^[\w.~+/=-]{20,4096}$/.test(token)) return json({ issue: "token_expired" satisfies GoogleCalendarIssue });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "UTC";

  const now = new Date();
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + IMPORT_WINDOW_DAYS * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(MAX_RESULTS),
    timeZone,
    fields: "items(id,status,summary,location,htmlLink,start,end)",
  });

  try {
    const response = await fetch(`${GOOGLE_EVENTS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as { items?: unknown[] } | null;
    if (!response.ok) return json({ issue: classifyGoogleError(response.status, data) });
    const events = (Array.isArray(data?.items) ? data.items : [])
      .map((item) => normalizeGoogleItem(item, timeZone))
      .filter((e): e is ImportedCalendarEvent => e !== null);
    return json({ events });
  } catch {
    return json({ issue: "failed" satisfies GoogleCalendarIssue });
  }
}
