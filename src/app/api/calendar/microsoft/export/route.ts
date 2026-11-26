// ============================================================================
// ANDROS — ENVIAR HITOS DEL TABLERO A MICROSOFT 365 / OUTLOOK (Sprint 19)
// POST { events: ExportEventInput[], timeZone, boardLink? }
// Cabeceras: Authorization (sesión de Andros) + X-Microsoft-Token (permiso
// `Calendars.ReadWrite` que el usuario concedió al pulsar «Conectar cuenta de
// Microsoft»).
//
// Crea cada evento en el calendario predeterminado (`/me/events`) de quien
// llama y devuelve el enlace de Outlook de cada uno. No guarda nada: ni el
// token ni los eventos se escriben en ninguna base de datos de Andros.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import { isPlausibleProviderToken } from "@/lib/calendar/calendarPending";
import {
  MAX_EXPORT_EVENTS,
  isSafeHttpUrl,
  isValidTimeZone,
  sanitizeExportEvent,
  type ExportEventInput,
} from "@/lib/calendar/googleEvents";
import {
  GRAPH_EVENTS_ENDPOINT,
  classifyGraphError,
  isOutlookWebLink,
  toGraphEventBody,
  type MicrosoftCalendarIssue,
} from "@/lib/calendar/microsoftEvents";

const TIMEOUT_MS = 10_000;

interface ExportResult {
  id: string;
  ok: boolean;
  htmlLink?: string;
  issue?: MicrosoftCalendarIssue;
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function createEvent(
  token: string,
  event: ExportEventInput,
  timeZone: string,
  boardLink?: string
): Promise<ExportResult> {
  try {
    const response = await fetch(GRAPH_EVENTS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(toGraphEventBody(event, timeZone, boardLink)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { webLink?: unknown } | null;
    if (!response.ok) return { id: event.id, ok: false, issue: classifyGraphError(response.status, body) };
    return { id: event.id, ok: true, htmlLink: isOutlookWebLink(body?.webLink) ? body.webLink : undefined };
  } catch {
    return { id: event.id, ok: false, issue: "failed" };
  }
}

export async function POST(request: NextRequest) {
  const caller = await getRequestUser(request);
  if (!caller) return json({ error: "Inicia sesión para usar el calendario de Microsoft." }, 401);
  const token = request.headers.get("x-microsoft-token")?.trim() ?? "";
  if (!isPlausibleProviderToken(token)) return json({ issue: "token_expired" satisfies MicrosoftCalendarIssue });

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

  // En serie: si el primero revela un problema de permiso o de buzón, no se insiste.
  const results: ExportResult[] = [];
  for (const event of events) {
    const result = await createEvent(token, event, timeZone, boardLink);
    results.push(result);
    if (
      result.issue === "token_expired" ||
      result.issue === "scope_missing" ||
      result.issue === "mailbox_unavailable"
    ) {
      return json({ issue: result.issue, results });
    }
  }
  return json({ results });
}
