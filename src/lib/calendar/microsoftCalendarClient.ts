"use client";

// ============================================================================
// ANDROS — CONEXIÓN DIRECTA CON MICROSOFT 365 / OUTLOOK (navegador, Nivel 2)
// Sprint 19 — paridad con Google Calendar:
//
//   · «Conectar cuenta de Microsoft» vincula la identidad de Microsoft a la
//     sesión actual (Supabase Azure OAuth + linkIdentity) pidiendo solo
//     `email User.Read Calendars.ReadWrite`. No se piden contraseñas ni se
//     cambia de cuenta de Andros.
//   · Antes de salir se consulta `/auth/v1/settings` (público) para saber si
//     el proveedor Azure está activado: si no, se avisa sin romper nada.
//   · Al volver, el `provider_token` se copia a sessionStorage con caducidad
//     (50 min): vive solo en esta pestaña. Nunca se guarda en Supabase.
//   · Las rutas /api/calendar/microsoft/* reciben el token en
//     `X-Microsoft-Token`, hablan con Microsoft Graph y no guardan nada.
// Si algo falla, el enlace de Outlook en la web y el .ics siguen a mano.
// ============================================================================

import { getSupabaseEnv } from "@/lib/supabase/client";
import { linkMicrosoftIdentity, type MicrosoftLinkProblem } from "@/hooks/useCloudSync";
import { useCalendarStore } from "@/store/useCalendarStore";
import { useCloudStore } from "@/store/useCloudStore";
import { toast } from "@/store/useToastStore";
import { sessionAuthHeader } from "@/lib/share/shareNotifyClient";
import type { CalendarEvent } from "./extractEvents";
import { CALENDAR_RETURN_PARAM, markCalendarPending, takeCalendarPending } from "./calendarPending";
import { browserTimeZone } from "./googleCalendarClient";
import type { ImportedCalendarEvent } from "./googleEvents";
import { MICROSOFT_CALENDAR_SCOPES, type MicrosoftCalendarIssue, type OutlookAccountKind } from "./microsoftEvents";

const TOKEN_KEY = "andros.calendar.ms-token";
const ACCOUNT_KIND_KEY = "andros.calendar.outlook-account";
/** Los tokens de Microsoft Graph duran 60–90 min: se usan como mucho 50. */
const TOKEN_TTL_MS = 50 * 60_000;

export type MicrosoftClientIssue = MicrosoftCalendarIssue | MicrosoftLinkProblem | "not_connected";

export const MICROSOFT_ISSUE_MESSAGES: Record<MicrosoftClientIssue, string> = {
  not_connected: "Conecta tu cuenta de Microsoft para enviar o importar eventos.",
  token_expired:
    "El permiso de Microsoft caducó. Vuelve a conectar o usa «Abrir en Calendario de Microsoft» y el archivo .ics.",
  scope_missing:
    "Microsoft no concedió el permiso de calendario (o tu organización lo bloquea). Vuelve a conectar y acepta «Calendars.ReadWrite», o usa el enlace y el .ics.",
  mailbox_unavailable:
    "Esta cuenta de Microsoft no tiene un calendario de Outlook disponible. Prueba con otra cuenta o usa el enlace y el .ics.",
  rate_limited: "Microsoft pidió una pausa. Espera un minuto y vuelve a intentarlo.",
  provider_disabled:
    "La conexión con Microsoft aún no está configurada en este sitio. Mientras tanto usa «Abrir en Calendario de Microsoft» o «Descargar .ics».",
  link_disabled:
    "Este sitio aún no permite vincular cuentas de Microsoft a Andros. Mientras tanto usa «Abrir en Calendario de Microsoft» o «Descargar .ics».",
  failed: "No se pudo hablar con Microsoft. Usa «Abrir en Calendario de Microsoft» o «Descargar .ics».",
};

// ----------------------------------------------------------------------------
// Preferencia de Outlook en la web (trabajo/escuela o personal) — localStorage
// ----------------------------------------------------------------------------

export function readOutlookAccountKind(): OutlookAccountKind {
  try {
    return localStorage.getItem(ACCOUNT_KIND_KEY) === "personal" ? "personal" : "work";
  } catch {
    return "work";
  }
}

export function saveOutlookAccountKind(kind: OutlookAccountKind): void {
  try {
    localStorage.setItem(ACCOUNT_KIND_KEY, kind);
  } catch {
    /* sin almacenamiento: se usa solo en esta visita */
  }
}

// ----------------------------------------------------------------------------
// Token temporal (sessionStorage)
// ----------------------------------------------------------------------------

let memoryToken: { token: string; expiresAt: number } | null = null;

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

/** Guarda el token de Microsoft recibido al volver de «Conectar» (lo llama calendarReturn). */
export function saveMicrosoftToken(token: string): void {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
  } catch {
    /* almacenamiento bloqueado: el token vive solo en memoria de la pestaña */
  }
  memoryToken = { token, expiresAt };
  useCalendarStore.getState().setMicrosoftConnection(expiresAt);
}

export function restoreMicrosoftConnection(): void {
  const stored = readToken();
  if (stored) useCalendarStore.getState().setMicrosoftConnection(stored.expiresAt);
}

function getMicrosoftToken(): string | null {
  const stored = readToken() ?? (memoryToken && memoryToken.expiresAt > Date.now() ? memoryToken : null);
  if (!stored) {
    useCalendarStore.getState().setMicrosoftConnection(null);
    return null;
  }
  return stored.token;
}

/** Olvida el permiso en esta pestaña (se revoca en myaccount.microsoft.com / myapps). */
export function forgetMicrosoftToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento */
  }
  useCalendarStore.getState().setMicrosoftConnection(null);
}

// ----------------------------------------------------------------------------
// Conectar
// ----------------------------------------------------------------------------

/**
 * ¿Está activado el proveedor Azure en Supabase? `/auth/v1/settings` es
 * público (solo con la clave anónima). `null` = no se pudo saber (se intenta).
 */
async function isAzureEnabled(): Promise<boolean | null> {
  const env = getSupabaseEnv();
  if (!env) return false;
  try {
    const response = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.anonKey },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { external?: Record<string, unknown> };
    return json.external?.azure === true;
  } catch {
    return null;
  }
}

/** Sale a Microsoft para conceder el permiso de calendario, o devuelve el motivo si no se puede. */
export async function connectMicrosoftCalendar(): Promise<MicrosoftClientIssue | null> {
  if (!useCloudStore.getState().user) {
    toast({ message: "Inicia sesión en Andros para conectar tu calendario de Microsoft.", tone: "error" });
    return "not_connected";
  }
  if ((await isAzureEnabled()) === false) return "provider_disabled";
  markCalendarPending("microsoft");
  const problem = await linkMicrosoftIdentity({
    scopes: MICROSOFT_CALENDAR_SCOPES,
    next: `/?${CALENDAR_RETURN_PARAM}=1`,
  });
  if (problem) takeCalendarPending(); // No se salió: se borra el marcador.
  return problem;
}

// ----------------------------------------------------------------------------
// Llamadas a /api/calendar/microsoft/*
// ----------------------------------------------------------------------------

export interface MicrosoftExportOutcome {
  issue: MicrosoftClientIssue | null;
  results: { id: string; ok: boolean; htmlLink?: string; issue?: MicrosoftCalendarIssue }[];
}

async function graphRouteFetch(path: string, body: object): Promise<Record<string, unknown> | null> {
  const token = getMicrosoftToken();
  if (!token) return null;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Microsoft-Token": token, ...(await sessionAuthHeader()) },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function issueOf(value: unknown): MicrosoftCalendarIssue | null {
  const known: MicrosoftCalendarIssue[] = ["token_expired", "scope_missing", "mailbox_unavailable", "rate_limited", "failed"];
  return known.find((k) => k === value) ?? null;
}

export async function exportEventsToMicrosoft(
  events: CalendarEvent[],
  boardLink: string | undefined
): Promise<MicrosoftExportOutcome> {
  try {
    const json = await graphRouteFetch("/api/calendar/microsoft/export", {
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
    const results = Array.isArray(json.results) ? (json.results as MicrosoftExportOutcome["results"]) : [];
    const issue = issueOf(json.issue) ?? (typeof json.error === "string" && results.length === 0 ? "failed" : null);
    if (issue === "token_expired") forgetMicrosoftToken();
    return { issue, results };
  } catch {
    return { issue: "failed", results: [] };
  }
}

export async function importUpcomingFromMicrosoft(): Promise<{
  issue: MicrosoftClientIssue | null;
  events: ImportedCalendarEvent[];
}> {
  try {
    const json = await graphRouteFetch("/api/calendar/microsoft/import", { timeZone: browserTimeZone() });
    if (!json) return { issue: "not_connected", events: [] };
    const issue = issueOf(json.issue) ?? (typeof json.error === "string" ? "failed" : null);
    if (issue === "token_expired") forgetMicrosoftToken();
    return { issue, events: Array.isArray(json.events) ? (json.events as ImportedCalendarEvent[]) : [] };
  } catch {
    return { issue: "failed", events: [] };
  }
}
