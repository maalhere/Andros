// ============================================================================
// ANDROS — LEER LOS PRÓXIMOS 14 DÍAS DE MICROSOFT 365 / OUTLOOK (Sprint 19)
// POST { timeZone }
// Cabeceras: Authorization (sesión de Andros) + X-Microsoft-Token.
//
// Lee `/me/calendarview` en UTC y devuelve los eventos en hora local para que
// el navegador los convierta en una tarjeta. El calendario NO se guarda en
// ningún servidor de Andros: solo pasa por esta respuesta.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import { isPlausibleProviderToken } from "@/lib/calendar/calendarPending";
import { IMPORT_WINDOW_DAYS, isValidTimeZone, type ImportedCalendarEvent } from "@/lib/calendar/googleEvents";
import {
  GRAPH_CALENDAR_VIEW_ENDPOINT,
  classifyGraphError,
  normalizeGraphItem,
  type MicrosoftCalendarIssue,
} from "@/lib/calendar/microsoftEvents";

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 50;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const caller = await getRequestUser(request);
  if (!caller) return json({ error: "Inicia sesión para usar el calendario de Microsoft." }, 401);
  const token = request.headers.get("x-microsoft-token")?.trim() ?? "";
  if (!isPlausibleProviderToken(token)) return json({ issue: "token_expired" satisfies MicrosoftCalendarIssue });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "UTC";

  const now = new Date();
  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: new Date(now.getTime() + IMPORT_WINDOW_DAYS * 86_400_000).toISOString(),
    $select: "id,subject,start,end,isAllDay,isCancelled,location,webLink",
    $orderby: "start/dateTime",
    $top: String(MAX_RESULTS),
  });

  try {
    const response = await fetch(`${GRAPH_CALENDAR_VIEW_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as { value?: unknown[] } | null;
    if (!response.ok) return json({ issue: classifyGraphError(response.status, data) });
    const events = (Array.isArray(data?.value) ? data.value : [])
      .map((item) => normalizeGraphItem(item, timeZone))
      .filter((e): e is ImportedCalendarEvent => e !== null);
    return json({ events });
  } catch {
    return json({ issue: "failed" satisfies MicrosoftCalendarIssue });
  }
}
