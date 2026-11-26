"use client";

// ============================================================================
// ANDROS — CONEXIÓN DIRECTA CON GOOGLE CALENDAR (navegador, Nivel 2)
//
//   · «Conectar Google Calendar» vuelve a pasar por Google OAuth (Supabase)
//     pidiendo SOLO el scope `calendar.events` de forma incremental
//     (`include_granted_scopes`), con `access_type: offline` y
//     `prompt: consent`. No se piden contraseñas.
//   · Al volver, el `provider_token` de la sesión se copia a sessionStorage
//     con caducidad (50 min): vive solo en esta pestaña y desaparece al
//     cerrarla. Nunca se guarda en Supabase ni en otro servidor.
//   · Las rutas /api/calendar/* reciben el token en `X-Google-Token`, hablan
//     con Google y devuelven el resultado; no guardan nada.
// Si algo falla (permiso caducado, API sin habilitar), la interfaz ofrece al
// momento el Nivel 1: enlace «Abrir en Google Calendar» y archivo .ics.
// ============================================================================

import { signInWithGoogle } from "@/hooks/useCloudSync";
import { useCalendarStore } from "@/store/useCalendarStore";
import { useCloudStore } from "@/store/useCloudStore";
import {
  createEmptySketchNotePayload,
  parseAiTextContent,
  textBlocksToHtml,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import { toast } from "@/store/useToastStore";
import { sessionAuthHeader } from "@/lib/share/shareNotifyClient";
import { visibleSpawnPoint } from "@/lib/canvas/quickAdd";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { FORM_MAX_FIELDS, FORM_SHEET_CODE_TAG, newFormId, toFieldKey, uniqueFieldKeys } from "@/lib/forms/formSchema";
import { formatEventDate, formatEventTime, type CalendarEvent } from "./extractEvents";
import { CALENDAR_RETURN_PARAM, markCalendarPending, type CalendarProvider } from "./calendarPending";
import {
  GOOGLE_CALENDAR_SCOPE,
  IMPORT_WINDOW_DAYS,
  type GoogleCalendarIssue,
  type ImportedCalendarEvent,
} from "./googleEvents";

const TOKEN_KEY = "andros.calendar.token";
/** Los tokens de Google duran 60 min: se usan como mucho 50 por seguridad. */
const TOKEN_TTL_MS = 50 * 60_000;
export { CALENDAR_RETURN_PARAM } from "./calendarPending";

export const ISSUE_MESSAGES: Record<GoogleCalendarIssue | "not_connected", string> = {
  not_connected: "Conecta Google Calendar para enviar o importar eventos.",
  token_expired: "El permiso de Google Calendar caducó. Vuelve a conectar o usa el enlace y el archivo .ics.",
  api_disabled:
    "Google Calendar API aún no está habilitada en el proyecto de Google de este sitio. Mientras tanto usa «Abrir en Google Calendar» o «Descargar .ics».",
  scope_missing:
    "Google no concedió el permiso de calendario. Vuelve a conectar y marca la casilla de Google Calendar, o usa el enlace y el .ics.",
  rate_limited: "Google pidió una pausa. Espera un minuto y vuelve a intentarlo.",
  failed: "No se pudo hablar con Google Calendar. Usa «Abrir en Google Calendar» o «Descargar .ics».",
};

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ----------------------------------------------------------------------------
// Token temporal (sessionStorage)
// ----------------------------------------------------------------------------

function readToken(): { token: string; expiresAt: number } | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** Guarda el token de Google recibido al volver de «Conectar» (lo llama calendarReturn). */
export function saveGoogleToken(token: string): void {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
  } catch {
    /* almacenamiento bloqueado: el token vive solo en memoria de la pestaña */
  }
  memoryToken = { token, expiresAt };
  useCalendarStore.getState().setConnection(expiresAt);
}

let memoryToken: { token: string; expiresAt: number } | null = null;

/** Al montar la página: refleja en el estado un permiso que siga vigente en esta pestaña. */
export function restoreGoogleConnection(): void {
  const stored = readToken();
  if (stored) useCalendarStore.getState().setConnection(stored.expiresAt);
}

export function getCalendarToken(): string | null {
  const stored = readToken() ?? (memoryToken && memoryToken.expiresAt > Date.now() ? memoryToken : null);
  if (!stored) {
    useCalendarStore.getState().setConnection(null);
    return null;
  }
  return stored.token;
}

/** Olvida el permiso en esta pestaña (Google lo revoca en myaccount.google.com). */
export function forgetCalendarToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento */
  }
  useCalendarStore.getState().setConnection(null);
}

/** Pide el permiso incremental de Google Calendar (sale a Google y vuelve). */
export async function connectGoogleCalendar(): Promise<void> {
  if (!useCloudStore.getState().user) {
    toast({ message: "Inicia sesión con Google para conectar tu calendario.", tone: "error" });
    return;
  }
  markCalendarPending("google");
  await signInWithGoogle({ scopes: GOOGLE_CALENDAR_SCOPE, next: `/?${CALENDAR_RETURN_PARAM}=1` });
}

// ----------------------------------------------------------------------------
// Llamadas a /api/calendar/*
// ----------------------------------------------------------------------------

export interface ExportOutcome {
  issue: GoogleCalendarIssue | "not_connected" | null;
  results: { id: string; ok: boolean; htmlLink?: string; issue?: GoogleCalendarIssue }[];
}

async function calendarFetch(path: string, body: object): Promise<Record<string, unknown> | null> {
  const token = getCalendarToken();
  if (!token) return null;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Google-Token": token, ...(await sessionAuthHeader()) },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function issueOf(value: unknown): GoogleCalendarIssue | null {
  const known: GoogleCalendarIssue[] = ["token_expired", "api_disabled", "scope_missing", "rate_limited", "failed"];
  return known.find((k) => k === value) ?? null;
}

export async function exportEventsToGoogle(events: CalendarEvent[], boardLink: string | undefined): Promise<ExportOutcome> {
  try {
    const json = await calendarFetch("/api/calendar/export", {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        allDay: e.allDay,
      })),
      timeZone: browserTimeZone(),
      boardLink,
    });
    if (!json) return { issue: "not_connected", results: [] };
    const results = Array.isArray(json.results) ? (json.results as ExportOutcome["results"]) : [];
    const issue = issueOf(json.issue) ?? (typeof json.error === "string" && results.length === 0 ? "failed" : null);
    if (issue === "token_expired") forgetCalendarToken();
    return { issue, results };
  } catch {
    return { issue: "failed", results: [] };
  }
}

export async function importUpcomingFromGoogle(): Promise<{
  issue: GoogleCalendarIssue | "not_connected" | null;
  events: ImportedCalendarEvent[];
}> {
  try {
    const json = await calendarFetch("/api/calendar/import", { timeZone: browserTimeZone() });
    if (!json) return { issue: "not_connected", events: [] };
    const issue = issueOf(json.issue) ?? (typeof json.error === "string" ? "failed" : null);
    if (issue === "token_expired") forgetCalendarToken();
    return { issue, events: Array.isArray(json.events) ? (json.events as ImportedCalendarEvent[]) : [] };
  } catch {
    return { issue: "failed", events: [] };
  }
}

// ----------------------------------------------------------------------------
// Importar como tarjeta (Cronograma o Ficha) con «Deshacer»
// ----------------------------------------------------------------------------

function lineFor(event: ImportedCalendarEvent): string {
  const when = `${formatEventDate(event.date)} · ${formatEventTime(event)}`;
  return `- ${when} — ${event.title}${event.location ? ` (${event.location})` : ""}`;
}

const PROVIDER_NAMES: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  microsoft: "Microsoft Calendar",
};

export function insertImportedEvents(
  events: ImportedCalendarEvent[],
  as: "timeline" | "sheet",
  provider: CalendarProvider = "google"
): string | null {
  if (events.length === 0) return null;
  const providerName = PROVIDER_NAMES[provider];
  const ws = useWorkspaceStore.getState();
  const position = visibleSpawnPoint();
  let id: string;

  if (as === "timeline") {
    const text = [`# Próximos ${IMPORT_WINDOW_DAYS} días (${providerName})`, ...events.map(lineFor)].join("\n");
    const { textBlocks, checklistItems } = parseAiTextContent(text);
    id = ws.aiCreateNode({
      type: "sketch-note-node",
      title: `Cronograma · ${providerName}`,
      codeTag: "CRONOGRAMA",
      position,
      sketchNoteData: {
        ...createEmptySketchNotePayload(),
        canvasMode: "text",
        textBlocks,
        checklistItems,
        richTextHtml: textBlocksToHtml(textBlocks),
      },
    });
  } else {
    // Cada evento es un campo «fecha» (así el extractor lo vuelve a detectar).
    const fields = uniqueFieldKeys(
      events.slice(0, FORM_MAX_FIELDS).map((event) => {
        const label = `${event.title}${event.startTime ? ` · ${formatEventTime(event)}` : ""}`.slice(0, 80);
        return {
          id: newFormId("fld"),
          fieldKey: toFieldKey(label),
          label,
          type: "date" as const,
          value: event.date,
        };
      })
    );
    id = ws.aiCreateNode({
      type: "form-sheet-node",
      title: `Agenda · ${providerName}`,
      codeTag: FORM_SHEET_CODE_TAG,
      position,
      formSheetData: { templateId: "custom", category: "Agenda", fields, attachments: [] },
    });
  }

  ws.setActiveTool("pointer");
  ws.setActiveMobileSheet("none");
  requestAnimationFrame(() => focusNodeOnScreen(id));
  toast({
    message: `${events.length} ${events.length === 1 ? "evento importado" : "eventos importados"} de ${providerName}.`,
    tone: "success",
    action: { label: "Deshacer", onAction: () => useWorkspaceStore.getState().removeNode(id) },
  });
  return id;
}
