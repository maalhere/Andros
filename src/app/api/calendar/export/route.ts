// ============================================================================
// ANDROS — ENVIAR HITOS DEL TABLERO A GOOGLE CALENDAR (Sprint 16)
// POST { events: ExportEventInput[], timeZone, boardLink? }
// Cabeceras: Authorization (sesión de Andros) + X-Google-Token (permiso
// `calendar.events` que el usuario concedió al pulsar «Conectar»).
//
// Crea cada evento en el calendario `primary` de quien llama y devuelve el
// enlace de cada uno. No guarda nada: ni el token ni los eventos se escriben
// en ninguna base de datos de Andros.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import {
  GOOGLE_EVENTS_ENDPOINT,
  MAX_EXPORT_EVENTS,
  classifyGoogleError,
  isSafeHttpUrl,
  isValidTimeZone,
  sanitizeExportEvent,
  toGoogleEventBody,
  type ExportEventInput,
  type GoogleCalendarIssue,
} from "@/lib/calendar/googleEvents";

const TIMEOUT_MS = 10_000;

interface ExportResult {
  id: string;
  ok: boolean;
  htmlLink?: string;
  issue?: GoogleCalendarIssue;
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function googleToken(request: NextRequest): string | null {
  const token = request.headers.get("x-google-token")?.trim() ?? "";
  return /^[\w.~+/=-]{20,4096}$/.test(token) ? token : null;
}

async function insertEvent(
  token: string,
  event: ExportEventInput,
  timeZone: string,
  boardLink?: string
): Promise<ExportResult> {
  try {
    const response = await fetch(GOOGLE_EVENTS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(toGoogleEventBody(event, timeZone, boardLink)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { htmlLink?: unknown } | null;
    if (!response.ok) return { id: event.id, ok: false, issue: classifyGoogleError(response.status, body) };
    const link = typeof body?.htmlLink === "string" && body.htmlLink.startsWith("https://") ? body.htmlLink : undefined;
    return { id: event.id, ok: true, htmlLink: link };
  } catch {
    return { id: event.id, ok: false, issue: "failed" };
  }
}

export async function POST(request: NextRequest) {
  const caller = await getRequestUser(request);
  if (!caller) return json({ error: "Inicia sesión para usar Google Calendar." }, 401);
  const token = googleToken(request);
  if (!token) return json({ issue: "token_expired" satisfies GoogleCalendarIssue }, 200);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Petición inválida." }, 400);
  }
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "UTC";
  const boardLink = isSafeHttpUrl(body.boardLink) ? body.boardLink : undefined;
  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, MAX_EXPORT_EVENTS)
    .map(sanitizeExportEvent)
    .filter((e): e is ExportEventInput => e !== null);
  if (events.length === 0) return json({ error: "No hay eventos válidos para enviar." }, 400);

  // En serie: si el primero revela un problema de permiso o de API, no se insiste.
  const results: ExportResult[] = [];
  for (const event of events) {
    const result = await insertEvent(token, event, timeZone, boardLink);
    results.push(result);
    if (result.issue === "token_expired" || result.issue === "api_disabled" || result.issue === "scope_missing") {
      return json({ issue: result.issue, results });
    }
  }
  return json({ results });
}
