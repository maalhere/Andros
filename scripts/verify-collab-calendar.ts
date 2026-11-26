// ============================================================================
// ANDROS — VERIFICACIÓN SPRINT 16: ROLES, COMENTARIOS Y GOOGLE CALENDAR
// Ejecuta: npm run verify:collab   (sin navegador, sin red, sin Supabase)
//
//   1. Extractor local de fechas: fichas con campo `date` (+ hora), cronogramas
//      con fecha en el título, fechas ISO / latinas / en español, rangos de
//      hora, año inferido y textos que NO son fechas.
//   2. `.ics` válido (RFC 5545): CRLF, plegado a 75 octetos, escapado, todo el
//      día con DTEND exclusivo, eventos con hora y cruces de medianoche.
//   3. Enlaces oficiales «Añadir a Google Calendar» (action=TEMPLATE).
//   4. Google Calendar API: cuerpo de events.insert, clasificación de errores
//      y normalización de la importación a hora local.
//   5. Matriz de permisos owner / editor / commenter / viewer, el filtro de
//      ediciones en vivo y su coherencia con supabase/schema.sql.
//      (Sprint 17B) Rol desconocido bloqueado por defecto, broadcast remoto
//      aplicado con `persist: false`, sala siempre privada y blindaje SQL.
//   6. Comentarios (saneado y contadores) y correo de «te compartieron» (HTML
//      escapado, asunto en una línea).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import type { EngineeringNodeData, FormField } from "@/types/workspace";
import {
  extractCalendarEvents,
  extractNodeEvents,
  findDate,
  findTimes,
  nodeHasCalendarEvents,
} from "@/lib/calendar/extractEvents";
import { addDays, buildIcs, escapeIcsText, foldIcsLine, googleCalendarLink, icsFilename } from "@/lib/calendar/ics";
import {
  classifyGoogleError,
  isValidTimeZone,
  normalizeGoogleItem,
  sanitizeExportEvent,
  toGoogleEventBody,
} from "@/lib/calendar/googleEvents";
import {
  MEMBER_ROLES,
  canCreateComment,
  canEditCanvas,
  canManageMembers,
  canModerateComment,
  canReadComments,
  canvasModeFor,
  normalizeMemberRole,
  type WorkspaceRole,
} from "@/lib/access/permissions";
import { canSenderEditCanvas, isReadOnlySender, setKnownMemberRole, setKnownMemberRoles } from "@/lib/access/memberRoles";
import {
  REMOTE_APPLY_OPTIONS,
  applyRemoteNodeDelete,
  applyRemoteNodeUpsert,
  isRefreshNotice,
} from "@/lib/collab/canvasSync";
import { isApplyingRemoteCollab, shouldSkipAutosaveForRemote } from "@/lib/collab/remoteFlag";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { COMMENT_MAX_CHARS, openCountsByNode, sanitizeComment, sortComments } from "@/lib/comments/commentModel";
import { buildShareEmail, buildWorkspaceShareLink } from "@/lib/share/shareEmail";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// «Hoy» fijo para que el año inferido sea reproducible.
const NOW = new Date(2026, 10, 24, 12, 0, 0); // 24 nov 2026

// ----------------------------------------------------------------------------
// Tablero de ejemplo
// ----------------------------------------------------------------------------

const base = { codeTag: "NOTA", position: { x: 0, y: 0 }, updatedAt: "ejemplo" };

function note(id: string, title: string, codeTag: string, lines: string[]): EngineeringNodeData {
  return {
    ...base,
    id,
    title,
    codeTag,
    type: "sketch-note-node",
    sketchNoteData: {
      richTextHtml: "",
      textBlocks: lines.map((text, i) => ({
        id: `${id}-b${i}`,
        type: text.startsWith("# ") ? ("heading" as const) : ("bullet" as const),
        text: text.replace(/^#\s+/, "").replace(/^-\s+/, ""),
      })),
      checklistItems: [],
      strokes: [],
      canvasMode: "text",
      canvasSize: { width: 300, height: 200 },
    },
  };
}

function field(id: string, label: string, type: FormField["type"], value: FormField["value"]): FormField {
  return { id, fieldKey: id, label, type, value };
}

const sheet: EngineeringNodeData = {
  ...base,
  id: "ficha-1",
  title: "Paciente A (ejemplo)",
  codeTag: "FICHA",
  type: "form-sheet-node",
  formSheetData: {
    templateId: "custom",
    category: "Salud",
    attachments: [],
    fields: [
      field("f1", "Nombre", "text", "Paciente A"),
      field("f2", "Próxima cita", "date", "2026-12-03"),
      field("f3", "Hora de la cita", "text", "16:30"),
      field("f4", "Fecha límite", "date", ""),
    ],
  },
};

const timeline = note("crono-1", "Cronograma", "CRONOGRAMA", [
  "# Sábado 28 de noviembre de 2026",
  "- 09:00 — Montaje",
  "- 18:30–20:00 Ensayo general",
  "- 2026-12-05 — Entrega final",
  "- 4 semanas antes — definir lugar",
  "- 5 personas confirmadas",
]);

const misc = note("nota-1", "Pendientes", "NOTA", [
  "Reunión 15/01/2027 6 pm con proveedores",
  "El 28 de enero, a las 10:30 am: revisión",
  "Altura 1.75 m y peso 82 kg",
]);

const plain = note("nota-2", "Ideas", "NOTA", ["Llamar a las 18:30.", "Sin fechas aquí"]);

const nodes = [timeline, sheet, misc, plain];

// ----------------------------------------------------------------------------
// 1. Extractor
// ----------------------------------------------------------------------------

section("1. Extractor local de fechas y cronogramas");

const sheetEvents = extractNodeEvents(sheet, NOW);
check("Ficha: 1 hito (campo «Próxima cita»; «Fecha límite» vacía se ignora)", sheetEvents.length === 1, sheetEvents);
check("Ficha: fecha y hora combinadas del campo «Hora de la cita»", sheetEvents[0]?.date === "2026-12-03" && sheetEvents[0]?.startTime === "16:30", sheetEvents[0]);
check("Ficha: título con el campo y la tarjeta", sheetEvents[0]?.title === "Próxima cita · Paciente A (ejemplo)", sheetEvents[0]?.title);
check("Ficha: origen «form-field»", sheetEvents[0]?.source === "form-field");

const timelineEvents = extractNodeEvents(timeline, NOW);
check("Cronograma: 3 hitos (sin el título de sección ni lo relativo)", timelineEvents.length === 3, timelineEvents.map((e) => e.title));
const montaje = timelineEvents.find((e) => e.title === "Montaje");
check("Cronograma: «09:00 — Montaje» hereda la fecha del título", montaje?.date === "2026-11-28" && montaje?.startTime === "09:00", montaje);
const ensayo = timelineEvents.find((e) => e.title === "Ensayo general");
check("Cronograma: rango 18:30–20:00", ensayo?.startTime === "18:30" && ensayo?.endTime === "20:00", ensayo);
const entrega = timelineEvents.find((e) => e.title === "Entrega final");
check("Cronograma: fecha ISO sin hora → todo el día", entrega?.date === "2026-12-05" && entrega?.allDay === true, entrega);
check("Cronograma: origen «timeline» por la etiqueta CRONOGRAMA", timelineEvents.every((e) => e.source === "timeline"));

const miscEvents = extractNodeEvents(misc, NOW);
const reunion = miscEvents.find((e) => e.date === "2027-01-15");
check("Nota: fecha latina 15/01/2027 + «6 pm» → 18:00", reunion?.startTime === "18:00", reunion);
check("Nota: título limpio «Reunión con proveedores»", reunion?.title === "Reunión con proveedores", reunion?.title);
const revision = miscEvents.find((e) => e.title === "revisión");
check("Nota: «28 de enero» sin año → 2027 (próxima ocurrencia)", revision?.date === "2027-01-28", revision);
check("Nota: «10:30 am» → 10:30", revision?.startTime === "10:30", revision);
check("Nota: «1.75 m» y «82 kg» no son fechas ni horas", miscEvents.length === 2, miscEvents.map((e) => e.title));
check("Nota sin fecha: «Llamar a las 18:30.» no crea hito", extractNodeEvents(plain, NOW).length === 0);

check("findDate: 31/02/2026 es inválida", findDate("31/02/2026", NOW) === null);
check("findDate: «2026-11-28» ISO", findDate("Evento 2026-11-28", NOW)?.date.day === 28);
check("findTimes: «18h30» → 18:30", findTimes("Cena 18h30")[0]?.time.hours === 18 && findTimes("Cena 18h30")[0]?.time.minutes === 30);
check("findTimes: «12 am» → 00:00 y «12 pm» → 12:00", findTimes("12 am")[0]?.time.hours === 0 && findTimes("12 pm")[0]?.time.hours === 12);
check("findTimes: «5 personas» no es hora", findTimes("5 personas").length === 0);

const all = extractCalendarEvents(nodes, NOW);
const order = all.map((e) => `${e.date} ${e.startTime ?? ""}`);
check("Espacio: 6 hitos en total", all.length === 6, all.map((e) => e.title));
check("Espacio: orden cronológico", order.every((v, i) => i === 0 || order[i - 1].localeCompare(v) <= 0), order);
check("Espacio: ids únicos", new Set(all.map((e) => e.id)).size === all.length);
check("Espacio: sin duplicados al repetir una tarjeta", extractCalendarEvents([...nodes, timeline], NOW).length === 6);
check("Botón de calendario solo en tarjetas con fechas", nodeHasCalendarEvents(sheet) && nodeHasCalendarEvents(timeline) && !nodeHasCalendarEvents(plain));

// ----------------------------------------------------------------------------
// 2. .ics (RFC 5545)
// ----------------------------------------------------------------------------

section("2. Archivo .ics (RFC 5545)");

const longDescription = { ...montaje!, id: "largo", description: "Descripción larga con acentos y emojis: áéíóú ñ 🎉 ".repeat(6) };
const icsEvents = [...all, longDescription, { ...ensayo!, id: "noche", startTime: "22:00", endTime: "01:00" }];
const BOARD = "https://andros.example/?espacio=00000000-0000-4000-8000-000000000000";
const ics = buildIcs(icsEvents, { calendarName: "Andros · Feria (ejemplo)", boardLink: BOARD, now: new Date(Date.UTC(2026, 10, 24, 15, 4, 5)) });
const rawLines = ics.split("\r\n");

check("Empieza con BEGIN:VCALENDAR y termina con END:VCALENDAR + CRLF", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
check("Todas las líneas terminan en CRLF (sin LF sueltos)", !/[^\r]\n/.test(ics));
check("VERSION:2.0 y PRODID presentes", ics.includes("\r\nVERSION:2.0\r\n") && /\r\nPRODID:[^\r\n]+\r\n/.test(ics));
const tooLong = rawLines.filter((l) => new TextEncoder().encode(l).length > 75);
check("Ninguna línea supera 75 octetos (plegado)", tooLong.length === 0, tooLong[0]);
const unfolded = ics.replace(/\r\n /g, "");
check("El plegado no rompe caracteres UTF-8 (se recupera el texto)", unfolded.includes("🎉") && !unfolded.includes("�"));
const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
check("Un VEVENT por hito", vevents === icsEvents.length && (ics.match(/END:VEVENT/g) ?? []).length === vevents);
check("BEGIN/END balanceados y anidados", unfolded.indexOf("BEGIN:VEVENT") > unfolded.indexOf("BEGIN:VCALENDAR") && unfolded.lastIndexOf("END:VEVENT") < unfolded.lastIndexOf("END:VCALENDAR"));
const uids = [...unfolded.matchAll(/\r\nUID:([^\r\n]+)/g)].map((m) => m[1]);
check("UID único por evento", new Set(uids).size === uids.length && uids.every((u) => u.endsWith("@andros")), uids);
check("DTSTAMP en UTC (YYYYMMDDTHHMMSSZ)", unfolded.includes("DTSTAMP:20261124T150405Z"));
check("Todo el día: DTSTART;VALUE=DATE y DTEND exclusivo (día siguiente)", unfolded.includes("DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261206"));
check("Con hora sin fin: dura 1 h", unfolded.includes("DTSTART:20261128T090000\r\nDTEND:20261128T100000"));
check("Rango 18:30–20:00", unfolded.includes("DTSTART:20261128T183000\r\nDTEND:20261128T200000"));
check("22:00–01:00 termina al día siguiente", unfolded.includes("DTSTART:20261128T220000\r\nDTEND:20261129T010000"));
check("URL del tablero en cada evento", (unfolded.match(/\r\nURL:https:\/\/andros\.example/g) ?? []).length === vevents);
check("Escapado de texto (\\ ; , y saltos)", escapeIcsText("a,b;c\\d\nx") === "a\\,b\\;c\\\\d\\nx");
check("foldIcsLine deja intactas las líneas cortas", foldIcsLine("SUMMARY:Hola") === "SUMMARY:Hola");
check("addDays cruza fin de mes y de año", addDays("2026-12-31", 1) === "2027-01-01" && addDays("2026-02-28", 1) === "2026-03-01");
check("Nombre de archivo seguro", icsFilename("Feria «Ciencia» 2026!") === "andros-feria-ciencia-2026.ics", icsFilename("Feria «Ciencia» 2026!"));

const outDir = path.join(process.cwd(), ".next", "cache", "verify-collab");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "ejemplo.ics"), ics);

// ----------------------------------------------------------------------------
// 3. Enlace «Añadir a Google Calendar»
// ----------------------------------------------------------------------------

section("3. Enlaces oficiales de Google Calendar");

const timedLink = new URL(googleCalendarLink(montaje!, { boardLink: BOARD, timeZone: "America/Tegucigalpa" }));
check("Host y ruta oficiales", timedLink.origin === "https://calendar.google.com" && timedLink.pathname === "/calendar/render");
check("action=TEMPLATE", timedLink.searchParams.get("action") === "TEMPLATE");
check("Título prellenado", timedLink.searchParams.get("text") === "Montaje");
check("Fechas con hora (inicio/fin locales)", timedLink.searchParams.get("dates") === "20261128T090000/20261128T100000", timedLink.searchParams.get("dates"));
check("Zona horaria `ctz` para respetar la hora escrita", timedLink.searchParams.get("ctz") === "America/Tegucigalpa");
check("Descripción con enlace al tablero", (timedLink.searchParams.get("details") ?? "").includes(BOARD));
const allDayLink = new URL(googleCalendarLink(entrega!, {}));
check("Todo el día: fin exclusivo y sin `ctz`", allDayLink.searchParams.get("dates") === "20261205/20261206" && !allDayLink.searchParams.has("ctz"));

// ----------------------------------------------------------------------------
// 4. Google Calendar API
// ----------------------------------------------------------------------------

section("4. Google Calendar API (cuerpos, errores e importación)");

const exportInput = sanitizeExportEvent({ ...ensayo, extra: "ignorado" });
check("sanitizeExportEvent acepta un hito válido", exportInput !== null && exportInput.startTime === "18:30" && exportInput.endTime === "20:00");
check("sanitizeExportEvent rechaza fechas u horas inválidas", sanitizeExportEvent({ id: "x", title: "t", date: "28/11/2026" }) === null && sanitizeExportEvent({ id: "x", title: "t", date: "2026-11-28", startTime: "25:00" })?.allDay === true);
const timedBody = toGoogleEventBody(exportInput!, "America/Tegucigalpa", BOARD) as {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string };
  source: { url: string };
};
check("events.insert con hora: dateTime local + timeZone", timedBody.start.dateTime === "2026-11-28T18:30:00" && timedBody.start.timeZone === "America/Tegucigalpa" && timedBody.end.dateTime === "2026-11-28T20:00:00", timedBody);
check("events.insert incluye la fuente (enlace al tablero)", timedBody.source.url === BOARD);
const allDayBody = toGoogleEventBody(sanitizeExportEvent(entrega)!, "UTC") as { start: { date: string }; end: { date: string } };
check("events.insert de todo el día: date + fin exclusivo", allDayBody.start.date === "2026-12-05" && allDayBody.end.date === "2026-12-06");

check("401 → token_expired", classifyGoogleError(401, {}) === "token_expired");
check("403 accessNotConfigured → api_disabled", classifyGoogleError(403, { error: { errors: [{ reason: "accessNotConfigured" }], message: "Google Calendar API has not been used in project 123" } }) === "api_disabled");
check("403 SERVICE_DISABLED → api_disabled", classifyGoogleError(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }) === "api_disabled");
check("403 insufficientPermissions → scope_missing", classifyGoogleError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }) === "scope_missing");
check("429 → rate_limited", classifyGoogleError(429, null) === "rate_limited");
check("500 → failed", classifyGoogleError(500, null) === "failed");

check("Zonas horarias válidas e inválidas", isValidTimeZone("America/Tegucigalpa") && isValidTimeZone("UTC") && !isValidTimeZone("Mars/Base") && !isValidTimeZone("x; drop"));
const importedTimed = normalizeGoogleItem(
  { id: "g1", summary: "Dentista", start: { dateTime: "2026-11-28T15:00:00Z" }, end: { dateTime: "2026-11-28T16:00:00Z" }, htmlLink: "https://www.google.com/calendar/event?eid=1" },
  "America/Tegucigalpa"
);
check("Importar: hora convertida a la zona local (UTC−6)", importedTimed?.date === "2026-11-28" && importedTimed.startTime === "09:00" && importedTimed.endTime === "10:00", importedTimed);
const importedAllDay = normalizeGoogleItem({ id: "g2", summary: "Feriado", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } }, "UTC");
check("Importar: evento de todo el día", importedAllDay?.allDay === true && importedAllDay.date === "2026-12-25");
check("Importar: cancelados y sin fecha se descartan", normalizeGoogleItem({ id: "g3", status: "cancelled", start: { date: "2026-12-01" } }, "UTC") === null && normalizeGoogleItem({ id: "g4" }, "UTC") === null);
check("Importar: enlaces no https se descartan", normalizeGoogleItem({ id: "g5", start: { date: "2026-12-01" }, htmlLink: "javascript:alert(1)" }, "UTC")?.htmlLink === null);

// ----------------------------------------------------------------------------
// 5. Matriz de permisos
// ----------------------------------------------------------------------------

section("5. Matriz de permisos (owner · editor · commenter · viewer)");

const EXPECTED: Record<WorkspaceRole, { edit: boolean; read: boolean; comment: boolean; moderateOthers: boolean; moderateOwn: boolean; manage: boolean; mode: string }> = {
  owner: { edit: true, read: true, comment: true, moderateOthers: true, moderateOwn: true, manage: true, mode: "edit" },
  editor: { edit: true, read: true, comment: true, moderateOthers: true, moderateOwn: true, manage: false, mode: "edit" },
  commenter: { edit: false, read: true, comment: true, moderateOthers: false, moderateOwn: true, manage: false, mode: "comment" },
  viewer: { edit: false, read: true, comment: false, moderateOthers: false, moderateOwn: true, manage: false, mode: "view" },
};
console.log("    rol        | editar | leer com. | comentar | resolver ajenos | gestionar");
for (const role of Object.keys(EXPECTED) as WorkspaceRole[]) {
  const e = EXPECTED[role];
  const actual = {
    edit: canEditCanvas(role),
    read: canReadComments(role),
    comment: canCreateComment(role),
    moderateOthers: canModerateComment(role, false),
    moderateOwn: canModerateComment(role, true),
    manage: canManageMembers(role),
    mode: canvasModeFor(role),
  };
  const yn = (b: boolean) => (b ? "sí" : "no");
  console.log(
    `    ${role.padEnd(10)} | ${yn(actual.edit).padEnd(6)} | ${yn(actual.read).padEnd(9)} | ${yn(actual.comment).padEnd(8)} | ${yn(actual.moderateOthers).padEnd(15)} | ${yn(actual.manage)}`
  );
  check(`${role}: coincide con la matriz esperada`, JSON.stringify(actual) === JSON.stringify(e), actual);
}
check("Sin acceso (null): no lee ni modera comentarios", !canReadComments(null) && !canModerateComment(null, true));
check("Roles asignables: Editor, Comentarista, Solo lectura", MEMBER_ROLES.join(",") === "editor,commenter,viewer");
check("normalizeMemberRole: 'owner' antiguo → editor; desconocido → editor", normalizeMemberRole("owner") === "editor" && normalizeMemberRole(42) === "editor" && normalizeMemberRole("viewer") === "viewer");

const WS = "11111111-1111-4111-8111-111111111111";
// (Sprint 17B) Denegar por defecto: sin datos verificados nadie edita en vivo.
setKnownMemberRoles(null, []);
check("En vivo (17B): sin roles cargados, nadie edita (ni el dueño)", isReadOnlySender(WS, "u-owner") && isReadOnlySender(WS, "u-editor"));
setKnownMemberRoles(WS, [["u-editor", "editor"]]);
check("En vivo (17B): sin dueño verificado, el dueño también queda en solo lectura", isReadOnlySender(WS, "u-owner") && !isReadOnlySender(WS, "u-editor"));
setKnownMemberRoles(
  WS,
  [
    ["u-editor", "editor"],
    ["u-commenter", "commenter"],
    ["u-viewer", "viewer"],
  ],
  "u-owner"
);
check("En vivo: se ignoran cambios de lienzo de Comentarista y Solo lectura", isReadOnlySender(WS, "u-commenter") && isReadOnlySender(WS, "u-viewer"));
check("En vivo: se aceptan los de Editor y los del dueño verificado", !isReadOnlySender(WS, "u-editor") && !isReadOnlySender(WS, "u-owner"));
check("En vivo (17B): rol desconocido (sin fila) → bloqueado por defecto", isReadOnlySender(WS, "u-desconocido") && !canSenderEditCanvas(WS, "u-desconocido"));
check("En vivo (17B): remitente vacío → bloqueado", isReadOnlySender(WS, ""));
check("En vivo (17B): otro espacio (sin roles verificados) → bloqueado", isReadOnlySender("otro-espacio", "u-editor") && isReadOnlySender("otro-espacio", "u-owner"));
setKnownMemberRole(WS, "u-viewer", "editor");
check("En vivo: el dueño sube a Editor desde «Compartir» → deja de filtrar", !isReadOnlySender(WS, "u-viewer"));
setKnownMemberRole(WS, "u-editor", "viewer");
check("En vivo: el dueño baja a Solo lectura → empieza a filtrar", isReadOnlySender(WS, "u-editor"));
setKnownMemberRole(WS, "u-viewer", null);
check("En vivo (17B): quitado del espacio → bloqueado", isReadOnlySender(WS, "u-viewer"));

// (Sprint 17B) Lo recibido por la sala se aplica SOLO en memoria (persist: false).
setKnownMemberRoles(WS, [["u-editor", "editor"], ["u-viewer", "viewer"]], "u-owner");
useWorkspaceStore.setState({ nodes: [], connections: [] });
const remoteFlags: { applying: boolean; skipAutosave: boolean }[] = [];
const stopSpy = useWorkspaceStore.subscribe((state, prev) => {
  if (state.nodes !== prev.nodes || state.connections !== prev.connections) {
    remoteFlags.push({ applying: isApplyingRemoteCollab(), skipAutosave: shouldSkipAutosaveForRemote() });
  }
});
const remoteNode = note("remoto-1", "Nota remota (ejemplo)", "NOTA", ["Hola"]);
const wire = (senderUserId: string, node: EngineeringNodeData) => ({ senderId: "peer-1", senderUserId, workspaceId: WS, node });
applyRemoteNodeUpsert(wire("u-desconocido", remoteNode));
applyRemoteNodeUpsert(wire("u-viewer", remoteNode));
check("Broadcast de rol desconocido o Solo lectura → NO se aplica", useWorkspaceStore.getState().nodes.length === 0 && remoteFlags.length === 0);
applyRemoteNodeUpsert(wire("u-editor", remoteNode));
check("Broadcast de Editor verificado → se aplica en el lienzo", useWorkspaceStore.getState().nodes.some((n) => n.id === "remoto-1"));
check(
  "Broadcast remoto → persist: false (marca remota activa y autoguardado omitido)",
  remoteFlags.length === 1 && remoteFlags[0].applying && remoteFlags[0].skipAutosave,
  remoteFlags
);
applyRemoteNodeDelete({ senderId: "peer-1", senderUserId: "u-editor", workspaceId: WS, id: "remoto-1" });
check("Borrado remoto → también persist: false", remoteFlags.length === 2 && remoteFlags[1].skipAutosave && useWorkspaceStore.getState().nodes.length === 0);
applyRemoteNodeUpsert({ ...wire("u-editor", remoteNode), workspaceId: "otro-espacio" });
check("Broadcast de otro espacio → no se aplica", useWorkspaceStore.getState().nodes.length === 0);
stopSpy();
check("REMOTE_APPLY_OPTIONS es { persist: false }", REMOTE_APPLY_OPTIONS.persist === false);
check("Aviso de comentario/permiso solo vale para el espacio abierto", isRefreshNotice({ workspaceId: WS, role: "editor" }, WS) && !isRefreshNotice({ workspaceId: "otro" }, WS) && !isRefreshNotice(null, WS));

const canvasSyncSrc = fs.readFileSync(path.join(process.cwd(), "src", "lib", "collab", "canvasSync.ts"), "utf8");
check("canvasSync ya no tiene persistFor ni persist: true", !canvasSyncSrc.includes("persistFor") && !/persist:\s*true/.test(canvasSyncSrc));
check("canvasSync ya no aplica comentarios ni roles del mensaje", !canvasSyncSrc.includes("useCommentsStore") && !canvasSyncSrc.includes("setKnownMemberRole"));
const roomSrc = fs.readFileSync(path.join(process.cwd(), "src", "lib", "collab", "useCollabRoom.ts"), "utf8");
check("Sala SIEMPRE privada, sin vuelta al canal público", /private: true/.test(roomSrc) && !roomSrc.includes("privateChannelsAvailable") && !/private: isPrivate/.test(roomSrc));
check("Sala sin entrega del lienzo completo (canvas:request / canvas:snapshot)", !roomSrc.includes('"canvas:request"') && !roomSrc.includes('"canvas:snapshot"') && !roomSrc.includes("buildSnapshotParts"));
check(
  "access:changed y comment:* → nueva lectura de Supabase (refreshComments / refreshOwnAccess)",
  /scheduleVerifiedRefresh\(true\)/.test(roomSrc) && (roomSrc.match(/scheduleVerifiedRefresh\(false\)/g) ?? []).length === 3 && /refreshComments\(\{ quiet: true \}\)/.test(roomSrc)
);
const cloudSrc = fs.readFileSync(path.join(process.cwd(), "src", "hooks", "useCloudSync.ts"), "utf8");
check("useCloudSync: lo remoto se anota como guardado (absorbRemoteChange), nunca se reescribe", /if \(isApplyingRemoteCollab\(\)\) \{\s*absorbRemoteChange\(state, prev\);\s*return;/.test(cloudSrc));
check("useCloudSync: borrado en Storage confirmado antes de olvidar la ruta", /\.remove\(orphanPaths\)[\s\S]{0,120}\.then\(\(\{ error \}\) => \{[\s\S]{0,80}if \(ep !== epoch \|\| error\) return;/.test(cloudSrc));
check("Google Calendar sin access_type offline", !cloudSrc.includes("access_type"));

// Coherencia con la base de datos: la RLS es la que manda.
const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "schema.sql"), "utf8").replace(/\r\n/g, "\n");
const fnBody = (name: string) => sql.match(new RegExp(`function public\\.${name}\\(ws_id uuid\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))?.[1] ?? "";
const policy = (name: string) => sql.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`))?.[0] ?? "";
check("SQL: workspace_members.role admite solo editor | commenter | viewer", /check \(role in \('editor', 'commenter', 'viewer'\)\)/.test(sql));
check("SQL: can_edit_workspace = owner + editor (igual que canEditCanvas)", /in \('owner', 'editor'\)/.test(fnBody("can_edit_workspace")));
check("SQL: can_comment_workspace = owner + editor + commenter (igual que canCreateComment)", /in \('owner', 'editor', 'commenter'\)/.test(fnBody("can_comment_workspace")));
check("SQL: get_workspace_role es SECURITY DEFINER", /security definer/.test(sql.match(/function public\.get_workspace_role[\s\S]*?\$\$/)?.[0] ?? ""));
const writePolicies = ["nodes_insert_member", "nodes_update_member", "nodes_delete_member", "connections_insert_member", "connections_update_member", "connections_delete_member", "workspaces_update_member"];
const weak = writePolicies.filter((p) => !policy(p).includes("can_edit_workspace") || policy(p).includes("is_workspace_member"));
check("SQL: escribir nodos, cables y tinta exige can_edit_workspace", weak.length === 0, weak);
check("SQL: leer nodos y cables sigue abierto a cualquier miembro", policy("nodes_select_member").includes("is_workspace_member") && policy("connections_select_member").includes("is_workspace_member"));
check("SQL: crear comentarios exige can_comment_workspace y autor = uno mismo", /can_comment_workspace/.test(policy("workspace_comments_insert")) && /author_id = \(select auth\.uid\(\)\)/.test(policy("workspace_comments_insert")));
check("SQL: leer comentarios = miembros (incluye Solo lectura)", policy("workspace_comments_select").includes("is_workspace_member"));
check("SQL: resolver/borrar = can_edit_workspace o el autor", ["workspace_comments_update", "workspace_comments_delete"].every((p) => policy(p).includes("can_edit_workspace") && policy(p).includes("author_id = (select auth.uid())")));
check("SQL: solo el dueño cambia roles", policy("workspace_members_update_owner").includes("workspace_owner_id(workspace_id) = (select auth.uid())"));

// (Sprint 17B) Blindaje SQL.
const realtimeSelect = sql.match(/create policy "andros_collab_receive"[\s\S]*?;/)?.[0] ?? "";
const realtimeInsert = sql.match(/create policy "andros_collab_send"[\s\S]*?;/)?.[0] ?? "";
const topicFn = sql.match(/function public\.can_use_collab_topic[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";
check("SQL (17B): Realtime ya no acepta cualquier tema 'andros-collab:%'", !/like 'andros-collab:%'/.test(realtimeSelect + realtimeInsert));
check("SQL (17B): leer la sala exige ser miembro (can_use_collab_topic → is_workspace_member)", realtimeSelect.includes("can_use_collab_topic") && /is_workspace_member\(ws\)/.test(topicFn));
check("SQL (17B): emitir cambios de lienzo exige can_edit_workspace", realtimeInsert.includes("realtime.messages.event") && /'node:upsert'[\s\S]*can_edit_workspace\(ws\)/.test(topicFn));
check("SQL (17B): access:changed solo lo emite el dueño", /'access:changed'[\s\S]{0,80}workspace_owner_id\(ws\) = auth\.uid\(\)/.test(topicFn));
check("SQL (17B): sala de carpeta = dueño o miembro de un espacio de ese dueño", /can_join_collab_folder\(owner\)/.test(topicFn) && /w\.owner_id = owner and m\.user_id = auth\.uid\(\)/.test(sql));
check(
  "SQL (17B): el id del espacio se extrae del tema w-<uuid> (y el dueño de f-<uuid>-<hash>)",
  /'\^andros-collab:w-\[0-9a-fA-F\]\{8\}/.test(sql) && /substring\(topic from 17\)::uuid/.test(sql) && /substring\(topic from 17 for 36\)::uuid/.test(sql)
);
const revoked = ["workspace_owner_id(uuid)", "is_workspace_member(uuid)", "are_friends(uuid, uuid)", "can_read_workspace_file(text)"].filter(
  (fn) => sql.includes(`revoke execute on function public.${fn} from public, anon;`) && sql.includes(`grant execute on function public.${fn} to authenticated;`)
);
check("SQL (17B): REVOKE de public/anon y GRANT a authenticated en las 4 funciones auxiliares", revoked.length === 4, revoked);
check(
  "SQL (17B): Arena fuerza needs_review + keywords + autor del perfil al insertar",
  /new\.moderation_status := 'needs_review'/.test(sql) && /new\.ai_engine := 'keywords'/.test(sql) && /arena_posts_guard_insert[\s\S]*before insert on public\.arena_posts/.test(sql) && /new\.author_name := public\.profile_display_name\(auth\.uid\(\)\)/.test(sql)
);
check("SQL (17B): comentarios con autor y nombre del perfil (trigger BEFORE INSERT)", /workspace_comments_fill_author[\s\S]*before insert on public\.workspace_comments/.test(sql) && /new\.author_id := auth\.uid\(\)/.test(sql));
const columnGrant = sql.match(/grant select \(([\s\S]*?)\) on public\.workspaces to authenticated;/)?.[1] ?? "";
check(
  "SQL (17B): public_share_token oculto (SELECT por columnas sin el token) y RPC solo para el dueño",
  /revoke select on public\.workspaces from anon, authenticated;/.test(sql) &&
    columnGrant.includes("owner_id") &&
    !columnGrant.includes("public_share_token") &&
    /function public\.get_workspace_public_share[\s\S]*?w\.owner_id = auth\.uid\(\)/.test(sql) &&
    /function public\.set_workspace_public_share[\s\S]*?w\.owner_id = auth\.uid\(\)/.test(sql)
);
const shareSrc = fs.readFileSync(path.join(process.cwd(), "src", "lib", "share", "publicShare.ts"), "utf8");
check("Cliente (17B): el enlace público se lee y cambia por las RPC del dueño", shareSrc.includes('rpc("get_workspace_public_share"') && shareSrc.includes('rpc("set_workspace_public_share"'));

// ----------------------------------------------------------------------------
// 6. Comentarios y correo
// ----------------------------------------------------------------------------

section("6. Comentarios y correo al compartir");

const rawRow = {
  id: "c1",
  workspace_id: WS,
  node_id: "crono-1",
  author_id: "u-commenter",
  author_name: "Ana (ejemplo)",
  body: "  Revisar la hora del montaje  ",
  resolved: false,
  created_at: "2026-11-24T10:00:00Z",
};
const parsed = sanitizeComment(rawRow);
check("Fila de Supabase → comentario (snake_case → camelCase, texto recortado)", parsed?.nodeId === "crono-1" && parsed.body === "Revisar la hora del montaje" && parsed.authorId === "u-commenter");
check("Comentario vacío o sin autor se descarta", sanitizeComment({ ...rawRow, body: "   " }) === null && sanitizeComment({ ...rawRow, author_id: "" }) === null);
check(`Cuerpo limitado a ${COMMENT_MAX_CHARS} caracteres`, sanitizeComment({ ...rawRow, body: "x".repeat(5000) })?.body.length === COMMENT_MAX_CHARS);
const general = sanitizeComment({ ...rawRow, id: "c2", node_id: null, created_at: "2026-11-24T11:00:00Z" })!;
const resolved = sanitizeComment({ ...rawRow, id: "c3", resolved: true, created_at: "2026-11-23T09:00:00Z" })!;
check("Contador por tarjeta: solo abiertos y anclados", JSON.stringify(openCountsByNode([parsed!, general, resolved])) === JSON.stringify({ "crono-1": 1 }));
check("Orden: más recientes primero", sortComments([resolved, parsed!, general]).map((c) => c.id).join(",") === "c2,c1,c3");

const email = buildShareEmail({
  ownerName: "Luis\r\nBcc: spam@example.com",
  recipientName: "Ana",
  workspaceName: "Feria <script>alert(1)</script>",
  role: "commenter",
  link: buildWorkspaceShareLink("https://andros.example", WS),
  reason: "added",
});
check("Asunto en una sola línea (sin inyección de cabeceras)", !/[\r\n]/.test(email.subject), email.subject);
check("HTML escapado (sin <script>)", !email.html.includes("<script>") && email.html.includes("&lt;script&gt;"));
check("Incluye permiso «Comentarista» y enlace ?espacio=", email.html.includes("Comentarista") && email.text.includes(`?espacio=${WS}`));
check("Nombres con saltos de línea quedan en una sola línea del texto", !email.text.includes("\r\nBcc") && !email.text.includes("\nBcc"));
check("El builder no recibe ni imprime correos (solo el servidor conoce la dirección)", !("email" in email) && !email.html.includes("mailto:"));
const changed = buildShareEmail({ ownerName: "Luis", recipientName: "", workspaceName: "Feria", role: "viewer", link: "https://andros.example/?espacio=x", reason: "role_changed" });
check("Cambio de permiso: asunto y texto propios", changed.subject.includes("cambió tu permiso") && changed.subject.includes("Solo lectura"));

// ----------------------------------------------------------------------------

console.log(`\n${passed} correctas · ${failed} fallidas`);
console.log(`Archivo de prueba: ${path.relative(process.cwd(), path.join(outDir, "ejemplo.ics"))}`);
if (failed > 0) process.exit(1);
