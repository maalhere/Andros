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
import {
  ISSUE_MESSAGES,
  browserTimeZone,
  connectGoogleCalendar,
  exportEventsToGoogle,
  forgetCalendarToken,
  importUpcomingFromGoogle,
  insertImportedEvents,
  type ExportOutcome,
} from "@/lib/calendar/googleCalendarClient";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SocialDialog } from "@/components/social/SocialDialog";

// ============================================================================
// ANDROS — GOOGLE CALENDAR (Sprint 16)
//   Nivel 1 (para todos, sin permisos extra):
//     · «Abrir en Google Calendar» por hito (enlace oficial prellenado).
//     · «Descargar .ics» con todos los hitos (Google, Apple Calendar, Outlook).
//   Nivel 2 (opcional, tras «Conectar Google Calendar»):
//     · Enviar los hitos seleccionados al calendario principal.
//     · Importar los próximos 14 días como Cronograma o Ficha.
//   Si Google falla (permiso caducado, API sin habilitar) se muestra un aviso
//   claro y el Nivel 1 sigue a mano en la misma pantalla.
// ============================================================================

const SOURCE_LABELS: Record<CalendarEvent["source"], string> = {
  "form-field": "Ficha",
  timeline: "Cronograma",
  note: "Nota",
};

type Issue = ExportOutcome["issue"];

export const CalendarSyncModal: React.FC = () => {
  const open = useCalendarStore((s) => s.open);
  const close = () => useCalendarStore.getState().close();
  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Google Calendar"
      titleId="andros-calendar-title"
      wide
      icon={<CalendarDays className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Lleva las fechas de tus fichas y cronogramas a tu calendario, o trae tu agenda al tablero."
    >
      {open && <CalendarBody />}
    </SocialDialog>
  );
};

const CalendarBody: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const focusNodeId = useCalendarStore((s) => s.focusNodeId);
  const connected = useCalendarStore((s) => s.connected);
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
  const [created, setCreated] = useState<Record<string, string | null>>({});
  const [issue, setIssue] = useState<Issue>(null);
  const [imported, setImported] = useState<ImportedCalendarEvent[] | null>(null);
  const exportGuard = useSubmitGuard();
  const importGuard = useSubmitGuard();

  const boardLink = workspaceId && typeof window !== "undefined" ? buildWorkspaceLink(workspaceId) : undefined;
  const timeZone = useMemo(() => browserTimeZone(), []);

  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const sendSelected = () =>
    exportGuard.run(async () => {
      const batch = selected.slice(0, MAX_EXPORT_EVENTS);
      if (batch.length === 0) return;
      const outcome = await exportEventsToGoogle(batch, boardLink);
      setIssue(outcome.issue);
      const next: Record<string, string | null> = {};
      for (const r of outcome.results) if (r.ok) next[r.id] = r.htmlLink ?? null;
      setCreated((prev) => ({ ...prev, ...next }));
      const ok = Object.keys(next).length;
      if (ok > 0) {
        toast({
          message: `${ok} ${ok === 1 ? "evento creado" : "eventos creados"} en tu Google Calendar.`,
          tone: "success",
        });
      }
    });

  const loadUpcoming = () =>
    importGuard.run(async () => {
      const result = await importUpcomingFromGoogle();
      setIssue(result.issue);
      if (!result.issue) setImported(result.events);
    });

  const reconnect = issue === "token_expired" || issue === "scope_missing" || issue === "not_connected";

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
          <ul className="divide-y divide-andros-border rounded-xl border border-andros-border">
            {events.map((event) => {
              const isOn = !deselected.has(event.id);
              const done = Object.prototype.hasOwnProperty.call(created, event.id);
              const link = created[event.id];
              return (
                <li key={event.id} className="flex items-start gap-2.5 px-3 py-2">
                  {connected && (
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(event.id)}
                      aria-label={`Enviar «${event.title}» a Google Calendar`}
                      className="mt-1 w-4 h-4 shrink-0 accent-[var(--accent-primary)] max-md:w-5 max-md:h-5"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-andros-primary break-words">{event.title}</p>
                    <p className="text-[11px] text-andros-muted">
                      {formatEventDate(event.date)} · {formatEventTime(event)} · {SOURCE_LABELS[event.source]} «
                      {event.sourceTitle}»
                    </p>
                    {done && (
                      <p className="mt-0.5 text-[11px] text-andros-success flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Creado en tu calendario
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 underline underline-offset-2 text-andros-accent-ink"
                          >
                            Ver evento
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                  <a
                    href={googleCalendarLink(event, { boardLink, timeZone })}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir «${event.title}» en Google Calendar`}
                    title="Abrir en Google Calendar"
                    className="shrink-0 w-11 h-11 md:w-auto md:h-8 md:px-2.5 rounded-lg border border-andros-border bg-andros-surface text-andros-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-andros-border-active active:scale-[0.96] spring-micro"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden md:inline">Abrir en Google Calendar</span>
                  </a>
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
      </section>

      {/* Nivel 2: conexión directa */}
      <section aria-labelledby="andros-cal-direct" className="space-y-2 pt-4 border-t border-andros-border">
        <h3 id="andros-cal-direct" className="text-xs font-semibold text-andros-primary flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
          Conexión directa con Google Calendar
        </h3>

        {!user ? (
          <p className="text-xs text-andros-muted">
            Inicia sesión con Google para enviar hitos a tu calendario o importar tu agenda. El enlace y el .ics de
            arriba funcionan sin iniciar sesión.
          </p>
        ) : !connected ? (
          <>
            <p className="text-[11px] leading-relaxed text-andros-muted">
              Opcional. Google te pedirá permiso solo para crear y leer eventos de tu calendario. El permiso queda en
              esta pestaña durante menos de una hora y Andros no guarda tu calendario en sus servidores.
            </p>
            <button type="button" onClick={() => void connectGoogleCalendar()} className={BUTTON_PRIMARY}>
              <CalendarPlus className="w-4 h-4" aria-hidden="true" />
              Conectar Google Calendar
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={selected.length === 0 || exportGuard.pending}
                onClick={() => void sendSelected()}
                className={BUTTON_PRIMARY}
              >
                {exportGuard.pending ? (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Send className="w-4 h-4" aria-hidden="true" />
                )}
                Enviar al calendario
                <span className="font-mono tabular-nums">({Math.min(selected.length, MAX_EXPORT_EVENTS)})</span>
              </button>
              <button
                type="button"
                disabled={importGuard.pending}
                onClick={() => void loadUpcoming()}
                className={BUTTON_SECONDARY}
              >
                {importGuard.pending ? (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <CalendarDays className="w-4 h-4" aria-hidden="true" />
                )}
                Importar próximos {IMPORT_WINDOW_DAYS} días
              </button>
              <button
                type="button"
                onClick={() => {
                  forgetCalendarToken();
                  setImported(null);
                  setIssue(null);
                }}
                className="min-h-[44px] md:min-h-0 text-[11px] text-andros-muted hover:text-andros-primary underline-offset-4 hover:underline"
              >
                Desconectar en esta pestaña
              </button>
            </div>
            {selected.length > MAX_EXPORT_EVENTS && (
              <p className="text-[11px] text-andros-muted">
                Se envían como máximo {MAX_EXPORT_EVENTS} hitos por vez: desmarca algunos o repite el envío.
              </p>
            )}
          </>
        )}

        {issue && (
          <div role="alert" className="px-3 py-2.5 rounded-xl border border-andros-border bg-andros-surface space-y-2">
            <p className="text-xs leading-relaxed text-andros-warning">{ISSUE_MESSAGES[issue]}</p>
            {reconnect && user && (
              <button type="button" onClick={() => void connectGoogleCalendar()} className={BUTTON_SECONDARY}>
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Volver a conectar
              </button>
            )}
          </div>
        )}

        {imported && (
          <div className="space-y-2">
            {imported.length === 0 ? (
              <p className="text-xs text-andros-muted">No tienes eventos en los próximos {IMPORT_WINDOW_DAYS} días.</p>
            ) : (
              <>
                <ul className="max-h-52 overflow-y-auto divide-y divide-andros-border rounded-xl border border-andros-border">
                  {imported.map((e) => (
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
                        insertImportedEvents(imported, "timeline");
                        useCalendarStore.getState().close();
                      }}
                      className={BUTTON_PRIMARY}
                    >
                      Importar como Cronograma
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        insertImportedEvents(imported, "sheet");
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
