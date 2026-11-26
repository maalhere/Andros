"use client";

import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { useCalendarStore } from "@/store/useCalendarStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { toast } from "@/store/useToastStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { useWorkspaceRole } from "@/lib/access/workspaceRole";
import { canEditCanvas } from "@/lib/access/permissions";
import { buildWorkspaceLink } from "@/lib/collab/room";
import { requestFileDownload } from "@/lib/downloadWithPermission";
import {
  extractCalendarEvents,
  formatEventDate,
  formatEventTime,
  type CalendarEvent,
} from "@/lib/calendar/extractEvents";
import { ICS_MIME, buildIcs, googleCalendarLink, icsFilename } from "@/lib/calendar/ics";
import { IMPORT_WINDOW_DAYS, MAX_EXPORT_EVENTS, type ImportedCalendarEvent } from "@/lib/calendar/googleEvents";
import { outlookCalendarLink, type OutlookAccountKind } from "@/lib/calendar/microsoftEvents";
import type { CalendarProvider } from "@/lib/calendar/calendarPending";
import {
  ISSUE_MESSAGES,
  browserTimeZone,
  connectGoogleCalendar,
  exportEventsToGoogle,
  forgetCalendarToken,
  importUpcomingFromGoogle,
  insertImportedEvents,
} from "@/lib/calendar/googleCalendarClient";
import {
  MICROSOFT_ISSUE_MESSAGES,
  connectMicrosoftCalendar,
  exportEventsToMicrosoft,
  forgetMicrosoftToken,
  importUpcomingFromMicrosoft,
  readOutlookAccountKind,
  saveOutlookAccountKind,
} from "@/lib/calendar/microsoftCalendarClient";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "@/components/social/SocialDialog";

// ============================================================================
// ANDROS — CALENDARIOS EXTERNOS (Sprint 16 Google · Sprint 19 Microsoft 365)
//   Nivel 1 (para todos, sin permisos extra):
//     · «Abrir en Google Calendar» y «Abrir en Calendario de Microsoft» por
//       hito (enlaces oficiales prellenados; Outlook trabajo/escuela o personal).
//     · «Descargar .ics» con todos los hitos (Google, Apple Calendar, Outlook).
//   Nivel 2 (opcional, tras «Conectar»), con paridad entre proveedores:
//     · Enviar los hitos seleccionados al calendario principal.
//     · Importar los próximos 14 días como Cronograma o Ficha.
//   Si un proveedor falla (permiso caducado, proveedor sin configurar) se
//   muestra un aviso claro y el Nivel 1 sigue a mano en la misma pantalla.
// ============================================================================

const SOURCE_LABELS: Record<CalendarEvent["source"], string> = {
  "form-field": "Ficha",
  timeline: "Cronograma",
  note: "Nota",
};

const PROVIDER_NAMES: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  microsoft: "Calendario de Microsoft",
};

/** Motivos que se arreglan volviendo a conectar (los demás no). */
const RECONNECT_ISSUES = new Set(["token_expired", "scope_missing", "not_connected"]);

const LINK_BUTTON =
  "inline-flex items-center gap-1.5 min-h-[44px] md:min-h-0 md:h-8 px-2.5 rounded-lg border border-andros-border bg-andros-surface text-andros-primary text-xs font-medium hover:border-andros-border-active active:scale-[0.96] spring-micro";

export const CalendarSyncModal: React.FC = () => {
  const open = useCalendarStore((s) => s.open);
  const close = () => useCalendarStore.getState().close();
  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Calendarios externos"
      titleId="andros-calendar-title"
      wide
      icon={<CalendarDays className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Lleva las fechas de tus fichas y cronogramas a Google Calendar o a Microsoft 365 / Outlook, o trae tu agenda al tablero."
    >
      {open && <CalendarBody />}
    </SocialDialog>
  );
};

type ProviderIssue = string | null;

const CalendarBody: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const focusNodeId = useCalendarStore((s) => s.focusNodeId);
  const googleConnected = useCalendarStore((s) => s.connected);
  const msConnected = useCalendarStore((s) => s.msConnected);
  const user = useCloudStore((s) => s.user);
  const workspaceId = useCloudStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceManagerStore(
    (s) =>
      s.workspaces.find((w) => w.id === workspaceId)?.name ??
      s.sharedWorkspaces.find((w) => w.id === workspaceId)?.name ??
      "Mi tablero"
  );
  const role = useWorkspaceRole();
  const canInsert = canEditCanvas(role);

  const allEvents = useMemo(() => extractCalendarEvents(nodes), [nodes]);
  const focusTitle = focusNodeId ? nodes.find((n) => n.id === focusNodeId)?.title ?? null : null;
  const events = focusNodeId ? allEvents.filter((e) => e.nodeId === focusNodeId) : allEvents;

  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  const selected = events.filter((e) => !deselected.has(e.id));
  /** Eventos creados por proveedor: id del hito → enlace (o `null` sin enlace). */
  const [created, setCreated] = useState<Record<CalendarProvider, Record<string, string | null>>>({
    google: {},
    microsoft: {},
  });
  const [issues, setIssues] = useState<Record<CalendarProvider, ProviderIssue>>({ google: null, microsoft: null });
  const [imported, setImported] = useState<{ provider: CalendarProvider; events: ImportedCalendarEvent[] } | null>(null);
  const [account, setAccount] = useState<OutlookAccountKind>(() => readOutlookAccountKind());

  const boardLink = workspaceId && typeof window !== "undefined" ? buildWorkspaceLink(workspaceId) : undefined;
  const timeZone = useMemo(() => browserTimeZone(), []);
  const anyConnected = googleConnected || msConnected;

  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chooseAccount = (kind: OutlookAccountKind) => {
    setAccount(kind);
    saveOutlookAccountKind(kind);
  };

  const downloadIcs = async () => {
    if (events.length === 0) return;
    const name = focusTitle ? `${workspaceName} · ${focusTitle}` : workspaceName;
    const ics = buildIcs(events, { calendarName: `Andros · ${name}`, boardLink });
    await requestFileDownload({
      filename: icsFilename(name),
      blobOrUrl: new Blob([ics], { type: ICS_MIME }),
      mimeType: ICS_MIME,
      description: `Calendario con ${events.length} ${events.length === 1 ? "hito" : "hitos"} del tablero (Google, Apple Calendar u Outlook).`,
    });
  };

  const setIssue = (provider: CalendarProvider, issue: ProviderIssue) =>
    setIssues((prev) => ({ ...prev, [provider]: issue }));

  const onExported = (
    provider: CalendarProvider,
    outcome: { issue: string | null; results: { id: string; ok: boolean; htmlLink?: string }[] }
  ) => {
    setIssue(provider, outcome.issue);
    const next: Record<string, string | null> = {};
    for (const r of outcome.results) if (r.ok) next[r.id] = r.htmlLink ?? null;
    setCreated((prev) => ({ ...prev, [provider]: { ...prev[provider], ...next } }));
    const ok = Object.keys(next).length;
    if (ok > 0) {
      toast({
        message: `${ok} ${ok === 1 ? "evento creado" : "eventos creados"} en tu ${PROVIDER_NAMES[provider]}.`,
        tone: "success",
      });
    }
  };

  const onImported = (provider: CalendarProvider, result: { issue: string | null; events: ImportedCalendarEvent[] }) => {
    setIssue(provider, result.issue);
    if (!result.issue) setImported({ provider, events: result.events });
  };

  return (
    <div className="space-y-5">
      {/* Hitos detectados */}
      <section aria-labelledby="andros-cal-events" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="andros-cal-events" className="text-xs font-semibold text-andros-primary">
            Hitos del tablero{" "}
            <span className="font-mono tabular-nums font-normal text-andros-muted">{events.length}</span>
          </h3>
          {focusNodeId && (
            <span className="text-[11px] text-andros-muted min-w-0 truncate">
              · solo «{focusTitle ?? "tarjeta"}»{" "}
              <button
                type="button"
                onClick={() => useCalendarStore.getState().setFocusNode(null)}
                className="min-h-[44px] md:min-h-0 text-andros-accent-ink hover:underline underline-offset-2"
              >
                Ver todos
              </button>
            </span>
          )}
        </div>

        {events.length === 0 ? (
          <p className="px-3 py-2.5 rounded-xl border border-andros-border bg-andros-surface text-xs leading-relaxed text-andros-muted">
            No encontré fechas en este tablero. Añade un campo de tipo <strong className="text-andros-primary">fecha</strong>{" "}
            a una ficha (p. ej. «Próxima cita») o escribe fechas en tu cronograma, como «2026-11-28 18:30 — Ensayo» o
            «Sábado 28 de noviembre, 9:00 — Montaje».
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-andros-border rounded-xl border border-andros-border">
            {events.map((event) => {
              const isOn = !deselected.has(event.id);
              return (
                <li key={event.id} className="flex items-start gap-2.5 px-3 py-2">
                  {anyConnected && (
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(event.id)}
                      aria-label={`Incluir «${event.title}» al enviar a tu calendario`}
                      className="mt-1 w-4 h-4 shrink-0 accent-[var(--accent-primary)] max-md:w-5 max-md:h-5"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-andros-primary break-words">{event.title}</p>
                    <p className="text-[11px] text-andros-muted">
                      {formatEventDate(event.date)} · {formatEventTime(event)} · {SOURCE_LABELS[event.source]} «
                      {event.sourceTitle}»
                    </p>
                    {(["google", "microsoft"] as const).map((provider) =>
                      Object.prototype.hasOwnProperty.call(created[provider], event.id) ? (
                        <p key={provider} className="mt-0.5 text-[11px] text-andros-success flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Creado en {PROVIDER_NAMES[provider]}
                          {created[provider][event.id] && (
                            <a
                              href={created[provider][event.id] ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1 underline underline-offset-2 text-andros-accent-ink"
                            >
                              Ver evento
                            </a>
                          )}
                        </p>
                      ) : null
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <a
                        href={googleCalendarLink(event, { boardLink, timeZone })}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir «${event.title}» en Google Calendar`}
                        className={LINK_BUTTON}
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        Abrir en Google Calendar
                      </a>
                      <a
                        href={outlookCalendarLink(event, { boardLink, timeZone, account })}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir «${event.title}» en Calendario de Microsoft`}
                        className={LINK_BUTTON}
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        Abrir en Calendario de Microsoft
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={events.length === 0} onClick={() => void downloadIcs()} className={BUTTON_SECONDARY}>
            <Download className="w-4 h-4" aria-hidden="true" />
            Descargar .ics
            <span className="font-mono tabular-nums">({events.length})</span>
          </button>
          <p className="text-[11px] text-andros-muted">Funciona con Google Calendar, Apple Calendar y Outlook.</p>
        </div>

        {/* Outlook en la web: cuenta de trabajo/escuela (Microsoft 365) o personal (Outlook.com) */}
        <div className="flex flex-wrap items-center gap-2">
          <span id="andros-cal-outlook-kind" className="text-[11px] text-andros-muted">
            Calendario de Microsoft:
          </span>
          {/* Radio exterior 12px (rounded-xl) − 4px (p-1) → interior 8px (rounded-lg) */}
          <div role="radiogroup" aria-labelledby="andros-cal-outlook-kind" className="flex items-center p-1 rounded-xl border border-andros-border bg-andros-surface">
            {(
              [
                ["work", "Trabajo o escuela"],
                ["personal", "Personal (Outlook.com)"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={account === kind}
                onClick={() => chooseAccount(kind)}
                className={`min-h-[44px] md:min-h-0 md:h-7 px-2.5 rounded-lg text-[11px] font-medium active:scale-[0.96] spring-micro ${
                  account === kind ? "bg-andros-border/70 text-andros-primary" : "text-andros-muted hover:text-andros-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Nivel 2: conexión directa */}
      <section aria-labelledby="andros-cal-direct" className="space-y-3 pt-4 border-t border-andros-border">
        <h3 id="andros-cal-direct" className="text-xs font-semibold text-andros-primary flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
          Conexión directa
        </h3>

        {!user ? (
          <p className="text-xs text-andros-muted">
            Inicia sesión para enviar hitos a tu calendario o importar tu agenda. Los enlaces y el .ics de arriba funcionan
            sin iniciar sesión.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <ProviderCard
              provider="google"
              connected={googleConnected}
              issue={issues.google}
              issueText={(i) => ISSUE_MESSAGES[i as keyof typeof ISSUE_MESSAGES] ?? ISSUE_MESSAGES.failed}
              selected={selected}
              connectHint="Google te pedirá permiso solo para crear y leer eventos de tu calendario."
              connectLabel="Conectar Google Calendar"
              onConnect={async () => {
                setIssue("google", null);
                await connectGoogleCalendar();
              }}
              onExport={async (batch) => onExported("google", await exportEventsToGoogle(batch, boardLink))}
              onImport={async () => onImported("google", await importUpcomingFromGoogle())}
              onForget={() => {
                forgetCalendarToken();
                setIssue("google", null);
                setImported((prev) => (prev?.provider === "google" ? null : prev));
              }}
            />
            <ProviderCard
              provider="microsoft"
              connected={msConnected}
              issue={issues.microsoft}
              issueText={(i) =>
                MICROSOFT_ISSUE_MESSAGES[i as keyof typeof MICROSOFT_ISSUE_MESSAGES] ?? MICROSOFT_ISSUE_MESSAGES.failed
              }
              selected={selected}
              connectHint="Microsoft te pedirá permiso para leer tu perfil y crear y leer eventos de tu calendario (Outlook / Microsoft 365)."
              connectLabel="Conectar cuenta de Microsoft"
              onConnect={async () => {
                setIssue("microsoft", null);
                const problem = await connectMicrosoftCalendar();
                if (problem) setIssue("microsoft", problem);
              }}
              onExport={async (batch) => onExported("microsoft", await exportEventsToMicrosoft(batch, boardLink))}
              onImport={async () => onImported("microsoft", await importUpcomingFromMicrosoft())}
              onForget={() => {
                forgetMicrosoftToken();
                setIssue("microsoft", null);
                setImported((prev) => (prev?.provider === "microsoft" ? null : prev));
              }}
            />
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-andros-muted">
          Opcional. El permiso queda solo en esta pestaña durante menos de una hora y Andros no guarda tu calendario en sus
          servidores.
        </p>

        {imported && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-andros-primary">
              Próximos {IMPORT_WINDOW_DAYS} días · {PROVIDER_NAMES[imported.provider]}
            </h4>
            {imported.events.length === 0 ? (
              <p className="text-xs text-andros-muted">No tienes eventos en los próximos {IMPORT_WINDOW_DAYS} días.</p>
            ) : (
              <>
                <ul className="max-h-52 overflow-y-auto divide-y divide-andros-border rounded-xl border border-andros-border">
                  {imported.events.map((e) => (
                    <li key={e.id} className="px-3 py-2">
                      <p className="text-sm text-andros-primary break-words">{e.title}</p>
                      <p className="text-[11px] text-andros-muted">
                        {formatEventDate(e.date)} · {formatEventTime(e)}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                {canInsert ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        insertImportedEvents(imported.events, "timeline", imported.provider);
                        useCalendarStore.getState().close();
                      }}
                      className={BUTTON_PRIMARY}
                    >
                      Importar como Cronograma
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        insertImportedEvents(imported.events, "sheet", imported.provider);
                        useCalendarStore.getState().close();
                      }}
                      className={BUTTON_SECONDARY}
                    >
                      Importar como Ficha
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-andros-muted">
                    Tu permiso en este espacio no permite crear tarjetas. Pide a su dueño el permiso de Editor.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Tarjeta de un proveedor (Google o Microsoft): conectar, enviar, importar
// ----------------------------------------------------------------------------

interface ProviderCardProps {
  provider: CalendarProvider;
  connected: boolean;
  issue: ProviderIssue;
  issueText: (issue: string) => string;
  selected: CalendarEvent[];
  connectHint: string;
  connectLabel: string;
  onConnect: () => Promise<void>;
  onExport: (batch: CalendarEvent[]) => Promise<void>;
  onImport: () => Promise<void>;
  onForget: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  connected,
  issue,
  issueText,
  selected,
  connectHint,
  connectLabel,
  onConnect,
  onExport,
  onImport,
  onForget,
}) => {
  const connectGuard = useSubmitGuard();
  const exportGuard = useSubmitGuard();
  const importGuard = useSubmitGuard();
  const headingId = `andros-cal-${provider}`;
  const count = Math.min(selected.length, MAX_EXPORT_EVENTS);
  const connect = () => connectGuard.run(onConnect);

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="p-3 rounded-xl border border-andros-border bg-andros-surface space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className="text-xs font-semibold text-andros-primary">
          {PROVIDER_NAMES[provider]}
        </h4>
        <span className={`text-[11px] ${connected ? "text-andros-success" : "text-andros-muted"}`}>
          {connected ? "Conectado" : "Sin conectar"}
        </span>
      </div>

      {!connected ? (
        <>
          <p className="text-[11px] leading-relaxed text-andros-muted">{connectHint}</p>
          <button type="button" disabled={connectGuard.pending} onClick={() => void connect()} className={BUTTON_PRIMARY}>
            {connectGuard.pending ? (
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <CalendarPlus className="w-4 h-4" aria-hidden="true" />
            )}
            {connectLabel}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={count === 0 || exportGuard.pending}
              onClick={() => void exportGuard.run(() => onExport(selected.slice(0, MAX_EXPORT_EVENTS)))}
              className={BUTTON_PRIMARY}
            >
              {exportGuard.pending ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Send className="w-4 h-4" aria-hidden="true" />
              )}
              Enviar al calendario
              <span className="font-mono tabular-nums">({count})</span>
            </button>
            <button
              type="button"
              disabled={importGuard.pending}
              onClick={() => void importGuard.run(onImport)}
              className={BUTTON_SECONDARY}
            >
              {importGuard.pending ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <CalendarDays className="w-4 h-4" aria-hidden="true" />
              )}
              Importar próximos {IMPORT_WINDOW_DAYS} días
            </button>
          </div>
          <button
            type="button"
            onClick={onForget}
            className="min-h-[44px] md:min-h-0 text-[11px] text-andros-muted hover:text-andros-primary underline-offset-4 hover:underline"
          >
            Desconectar en esta pestaña
          </button>
          {selected.length > MAX_EXPORT_EVENTS && (
            <p className="text-[11px] text-andros-muted">
              Se envían como máximo {MAX_EXPORT_EVENTS} hitos por vez: desmarca algunos o repite el envío.
            </p>
          )}
        </>
      )}

      {issue && (
        <div role="alert" className="pt-2 border-t border-andros-border space-y-2">
          <p className="text-xs leading-relaxed text-andros-warning">{issueText(issue)}</p>
          {RECONNECT_ISSUES.has(issue) && (
            <button type="button" disabled={connectGuard.pending} onClick={() => void connect()} className={BUTTON_SECONDARY}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Volver a conectar
            </button>
          )}
        </div>
      )}
    </div>
  );
};
