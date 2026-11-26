// ============================================================================
// ANDROS — VERIFICACIÓN SPRINT 19: MICROSOFT 365 / OUTLOOK + MODO SIMPLE
// Ejecuta: npm run verify:microsoft   (también lo lanza npm run verify:collab)
// Sin navegador, sin red y sin Supabase.
//
//   1. Enlace «Abrir en Calendario de Microsoft» (Outlook en la web): ruta
//      oficial deeplink/compose, fechas con desfase de zona (incluido horario
//      de verano y medias horas), todo el día con fin exclusivo, codificación
//      URL (%20 y %2B, sin «+» crudos) y cuentas de trabajo / personales.
//   2. Microsoft Graph: cuerpo de POST /me/events (`subject`, `body`,
//      `start.dateTime`, `end.dateTime`, `timeZone`, `isAllDay`), lectura de
//      /me/calendarview en UTC → hora local, ida y vuelta sin desfases y
//      clasificación de errores.
//   3. Token efímero y marcador de conexión pendiente por proveedor.
//   4. Seguridad y privacidad: rutas con sesión, sin escribir en base de datos,
//      token solo en sessionStorage, documentación en /privacidad y /cookies.
//   5. Modo Simple: barra superior esencial, menú ⋯ agrupado y sin
//      herramientas técnicas (3D, impresoras, fórmulas LaTeX, CodeLab).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { sanitizeExportEvent, type ExportEventInput } from "@/lib/calendar/googleEvents";
import {
  GRAPH_CALENDAR_VIEW_ENDPOINT,
  GRAPH_EVENTS_ENDPOINT,
  MICROSOFT_CALENDAR_SCOPES,
  OUTLOOK_HOSTS,
  classifyGraphError,
  isOutlookWebLink,
  localToOffsetIso,
  normalizeGraphItem,
  outlookCalendarLink,
  toGraphEventBody,
  zoneOffsetMinutes,
} from "@/lib/calendar/microsoftEvents";
import {
  CALENDAR_RETURN_PARAM,
  isPlausibleProviderToken,
  markCalendarPending,
  takeCalendarPending,
} from "@/lib/calendar/calendarPending";

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

const BOARD = "https://andros.example/?espacio=ejemplo-123";
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

type LinkEvent = Parameters<typeof outlookCalendarLink>[0];
const timed = (date: string, startTime: string, endTime: string | null, title = "Ensayo general"): LinkEvent => ({
  title,
  description: "Llevar vestuario",
  date,
  startTime,
  endTime,
  allDay: false,
});

// ----------------------------------------------------------------------------
section("1. Enlace «Abrir en Calendario de Microsoft» (Outlook en la web)");
// ----------------------------------------------------------------------------

const montaje = timed("2026-11-28", "18:30", "20:00", "Ensayo & montaje #2 — Peña");
const raw = outlookCalendarLink(montaje, { boardLink: BOARD, timeZone: "America/Tegucigalpa" });
const link = new URL(raw);
const q = link.searchParams;
check("Host de trabajo o escuela por defecto (outlook.office.com)", link.origin === OUTLOOK_HOSTS.work, link.origin);
check("Ruta oficial /calendar/0/deeplink/compose", link.pathname === "/calendar/0/deeplink/compose", link.pathname);
check("path=/calendar/action/compose y rru=addevent", q.get("path") === "/calendar/action/compose" && q.get("rru") === "addevent");
check("subject con &, #, — y ñ sin romper la URL", q.get("subject") === "Ensayo & montaje #2 — Peña", q.get("subject"));
check(
  "Inicio con desfase de Tegucigalpa (UTC−6)",
  q.get("startdt") === "2026-11-28T18:30:00-06:00",
  q.get("startdt")
);
check("Fin con desfase de Tegucigalpa", q.get("enddt") === "2026-11-28T20:00:00-06:00", q.get("enddt"));
check("allday=false en eventos con hora", q.get("allday") === "false");
check("body incluye descripción y enlace al tablero", (q.get("body") ?? "").includes("Llevar vestuario") && (q.get("body") ?? "").includes(BOARD));
const query = raw.slice(raw.indexOf("?") + 1);
check("Espacios codificados como %20 (Outlook no traduce «+»)", query.includes("Ensayo%20%26%20montaje") && !query.includes("+"), query.slice(0, 120));

const madridSummer = new URL(outlookCalendarLink(timed("2026-07-15", "10:00", null), { timeZone: "Europe/Madrid" }));
check("Madrid en verano: +02:00 y fin +1 h por defecto", madridSummer.searchParams.get("startdt") === "2026-07-15T10:00:00+02:00" && madridSummer.searchParams.get("enddt") === "2026-07-15T11:00:00+02:00", madridSummer.searchParams.get("startdt"));
const madridRaw = outlookCalendarLink(timed("2026-07-15", "10:00", null), { timeZone: "Europe/Madrid" });
check("El «+» del desfase viaja como %2B", madridRaw.includes("startdt=2026-07-15T10%3A00%3A00%2B02%3A00"), madridRaw.slice(madridRaw.indexOf("startdt"), madridRaw.indexOf("startdt") + 50));
const madridWinter = new URL(outlookCalendarLink(timed("2026-12-15", "10:00", null), { timeZone: "Europe/Madrid" }));
check("Madrid en invierno: +01:00", madridWinter.searchParams.get("startdt") === "2026-12-15T10:00:00+01:00", madridWinter.searchParams.get("startdt"));

check("Nueva York antes del cambio de hora (8 mar 2026, 01:30): −05:00", localToOffsetIso("2026-03-08", "01:30", "America/New_York") === "2026-03-08T01:30:00-05:00", localToOffsetIso("2026-03-08", "01:30", "America/New_York"));
check("Nueva York después del cambio (8 mar 2026, 03:30): −04:00", localToOffsetIso("2026-03-08", "03:30", "America/New_York") === "2026-03-08T03:30:00-04:00", localToOffsetIso("2026-03-08", "03:30", "America/New_York"));
check("Nueva York tras volver al horario de invierno (1 nov 2026, 12:00): −05:00", localToOffsetIso("2026-11-01", "12:00", "America/New_York") === "2026-11-01T12:00:00-05:00");
check("India (+05:30) y Nepal (+05:45): medias horas y cuartos", localToOffsetIso("2026-11-28", "09:00", "Asia/Kolkata").endsWith("+05:30") && localToOffsetIso("2026-11-28", "09:00", "Asia/Kathmandu").endsWith("+05:45"));
check("UTC: +00:00", localToOffsetIso("2026-11-28", "09:00", "UTC") === "2026-11-28T09:00:00+00:00");
check("zoneOffsetMinutes(Ciudad de México) = −360", zoneOffsetMinutes("America/Mexico_City", Date.UTC(2026, 10, 28, 12)) === -360);

const lateNight = new URL(outlookCalendarLink(timed("2026-11-28", "23:30", null), { timeZone: "America/Bogota" }));
check("23:30 sin fin cruza la medianoche (fin 00:30 del día siguiente)", lateNight.searchParams.get("enddt") === "2026-11-29T00:30:00-05:00", lateNight.searchParams.get("enddt"));
const overnight = new URL(outlookCalendarLink(timed("2026-11-28", "22:00", "01:00"), { timeZone: "America/Bogota" }));
check("22:00–01:00 termina al día siguiente", overnight.searchParams.get("enddt") === "2026-11-29T01:00:00-05:00", overnight.searchParams.get("enddt"));

const allDay = new URL(
  outlookCalendarLink({ title: "Entrega", description: "", date: "2026-12-31", startTime: null, endTime: null, allDay: true }, { account: "personal" })
);
check("Cuenta personal → outlook.live.com", allDay.origin === OUTLOOK_HOSTS.personal, allDay.origin);
check("Todo el día: startdt/enddt solo fecha, fin exclusivo y cambio de año", allDay.searchParams.get("startdt") === "2026-12-31" && allDay.searchParams.get("enddt") === "2027-01-01" && allDay.searchParams.get("allday") === "true");
check("Sin descripción ni tablero no se añade body", !allDay.searchParams.has("body"));
const longBody = new URL(outlookCalendarLink({ ...montaje, description: "x".repeat(5000) }, { timeZone: "UTC" }));
check("body limitado a 1500 caracteres", (longBody.searchParams.get("body") ?? "").length === 1500);

// ----------------------------------------------------------------------------
section("2. Microsoft Graph: POST /me/events y GET /me/calendarview");
// ----------------------------------------------------------------------------

check("Endpoints oficiales de Graph v1.0", GRAPH_EVENTS_ENDPOINT === "https://graph.microsoft.com/v1.0/me/events" && GRAPH_CALENDAR_VIEW_ENDPOINT === "https://graph.microsoft.com/v1.0/me/calendarview");
check("Scopes pedidos: email User.Read Calendars.ReadWrite", MICROSOFT_CALENDAR_SCOPES === "email User.Read Calendars.ReadWrite");

const input = sanitizeExportEvent({ id: "n1:f1", title: "  Montaje  ", description: "Escenario", date: "2026-11-28", startTime: "18:30", endTime: "20:00" }) as ExportEventInput;
const body = toGraphEventBody(input, "America/Tegucigalpa", BOARD) as {
  subject: string;
  body: { contentType: string; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
};
check("subject recortado", body.subject === "Montaje", body.subject);
check("body en texto plano con enlace al tablero", body.body.contentType === "text" && body.body.content.includes("Escenario") && body.body.content.includes(`Tablero en Andros: ${BOARD}`));
check("start.dateTime local sin desfase + timeZone IANA", body.start.dateTime === "2026-11-28T18:30:00" && body.start.timeZone === "America/Tegucigalpa", body.start);
check("end.dateTime local", body.end.dateTime === "2026-11-28T20:00:00" && body.end.timeZone === "America/Tegucigalpa", body.end);
check("isAllDay=false", body.isAllDay === false);

const noEnd = toGraphEventBody({ ...input, endTime: null }, "UTC") as typeof body;
check("Sin hora de fin: dura 1 h", noEnd.end.dateTime === "2026-11-28T19:30:00");
const crossing = toGraphEventBody({ ...input, startTime: "22:00", endTime: "01:00" }, "UTC") as typeof body;
check("22:00–01:00 termina el día siguiente", crossing.end.dateTime === "2026-11-29T01:00:00", crossing.end);
const dayBody = toGraphEventBody({ ...input, startTime: null, endTime: null, allDay: true }, "Europe/Madrid") as typeof body & { showAs: string };
check(
  "Todo el día: isAllDay, medianoche a medianoche (fin exclusivo) y showAs=free",
  dayBody.isAllDay === true && dayBody.start.dateTime === "2026-11-28T00:00:00" && dayBody.end.dateTime === "2026-11-29T00:00:00" && dayBody.showAs === "free",
  dayBody
);
check("Sin tablero: el cuerpo no menciona Andros", !(toGraphEventBody(input, "UTC") as typeof body).body.content.includes("Andros"));
check("Evento inválido del navegador se descarta (fecha mal escrita)", sanitizeExportEvent({ id: "x", title: "t", date: "28/11/2026" }) === null);

// Lectura: Graph responde en UTC (Prefer: outlook.timezone="UTC").
const item = normalizeGraphItem(
  {
    id: "AAMkAG-1",
    subject: "Reunión de equipo",
    isAllDay: false,
    isCancelled: false,
    start: { dateTime: "2026-11-28T17:30:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-11-28T18:15:00.0000000", timeZone: "UTC" },
    location: { displayName: "Sala 2" },
    webLink: "https://outlook.office365.com/owa/?itemid=AAMkAG-1&exvsurl=1&path=/calendar/item",
  },
  "Europe/Madrid"
);
check("UTC 17:30 → Madrid 18:30–19:15", item?.date === "2026-11-28" && item.startTime === "18:30" && item.endTime === "19:15", item);
check("subject → title y location.displayName → location", item?.title === "Reunión de equipo" && item.location === "Sala 2");
check("webLink de Outlook aceptado", item?.htmlLink?.startsWith("https://outlook.office365.com/") === true);
const shifted = normalizeGraphItem({ id: "2", subject: "Cena", start: { dateTime: "2026-11-29T03:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-29T04:00:00.0000000", timeZone: "UTC" } }, "America/Tegucigalpa");
check("UTC del día siguiente → día local anterior (Tegucigalpa 21:00 del 28)", shifted?.date === "2026-11-28" && shifted.startTime === "21:00", shifted);
const allDayItem = normalizeGraphItem({ id: "3", subject: "Feriado", isAllDay: true, start: { dateTime: "2026-12-01T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-12-02T00:00:00.0000000", timeZone: "UTC" } }, "America/Tegucigalpa");
check("Todo el día: conserva la fecha sin convertir de zona", allDayItem?.date === "2026-12-01" && allDayItem.allDay && allDayItem.startTime === null, allDayItem);
check("Cancelados se descartan", normalizeGraphItem({ id: "4", isCancelled: true, start: { dateTime: "2026-12-01T10:00:00.0000000" } }, "UTC") === null);
check("Sin id o sin inicio se descartan", normalizeGraphItem({ subject: "x", start: { dateTime: "2026-12-01T10:00:00" } }, "UTC") === null && normalizeGraphItem({ id: "5" }, "UTC") === null);
check("Sin subject → «(Sin título)»", normalizeGraphItem({ id: "6", start: { dateTime: "2026-12-01T10:00:00.0000000" } }, "UTC")?.title === "(Sin título)");
check("Fin en otro día local → sin hora de fin", normalizeGraphItem({ id: "7", start: { dateTime: "2026-12-01T22:00:00.0000000" }, end: { dateTime: "2026-12-02T02:00:00.0000000" } }, "UTC")?.endTime === null);
check("webLink javascript: o de otro dominio se rechaza", !isOutlookWebLink("javascript:alert(1)") && !isOutlookWebLink("https://outlook.office.com.evil.example/x") && !isOutlookWebLink("http://outlook.live.com/x"));
check("webLink de outlook.live.com y outlook.office.com aceptados", isOutlookWebLink("https://outlook.live.com/calendar/item/1") && isOutlookWebLink("https://outlook.office.com/calendar/item/1"));

// Ida y vuelta: lo que se envía como hora local de una zona vuelve igual tras pasar por UTC.
const roundTrip = (zone: string, date: string, time: string) => {
  const sent = toGraphEventBody({ ...input, date, startTime: time, endTime: null }, zone) as typeof body;
  const utc = new Date(localToOffsetIso(date, time, zone)).toISOString().replace(/\.\d{3}Z$/, ".0000000");
  const back = normalizeGraphItem({ id: "rt", subject: "x", start: { dateTime: utc, timeZone: "UTC" } }, zone);
  return { sentStart: sent.start.dateTime, back: back ? `${back.date}T${back.startTime}:00` : null };
};
for (const [zone, date, time] of [
  ["America/Tegucigalpa", "2026-11-28", "18:30"],
  ["Europe/Madrid", "2026-07-15", "23:45"],
  ["Asia/Kolkata", "2026-11-28", "00:15"],
  ["America/New_York", "2026-03-08", "03:30"],
] as const) {
  const rt = roundTrip(zone, date, time);
  check(`Ida y vuelta sin desfase (${zone} ${date} ${time})`, rt.sentStart === rt.back, rt);
}

check("401 → token_expired", classifyGraphError(401, { error: { code: "InvalidAuthenticationToken", message: "CompactToken parsing failed" } }) === "token_expired");
check("403 ErrorAccessDenied → scope_missing", classifyGraphError(403, { error: { code: "ErrorAccessDenied" } }) === "scope_missing");
check("MailboxNotEnabledForRESTAPI → mailbox_unavailable", classifyGraphError(404, { error: { code: "MailboxNotEnabledForRESTAPI" } }) === "mailbox_unavailable");
check("429 → rate_limited", classifyGraphError(429, { error: { code: "ApplicationThrottled" } }) === "rate_limited");
check("500 sin cuerpo → failed", classifyGraphError(500, null) === "failed");

// ----------------------------------------------------------------------------
section("3. Token efímero y conexión pendiente por proveedor");
// ----------------------------------------------------------------------------

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
markCalendarPending("microsoft");
check("El marcador guarda el proveedor (no el token)", (mem.get("andros.calendar.pending") ?? "").includes('"microsoft"') && !(mem.get("andros.calendar.pending") ?? "").includes("ey"));
check("Al volver se asigna a Microsoft", takeCalendarPending() === "microsoft");
check("El marcador se consume una sola vez", takeCalendarPending() === null);
mem.set("andros.calendar.pending", String(Date.now()));
check("Formato anterior (solo hora) → Google", takeCalendarPending() === "google");
mem.set("andros.calendar.pending", JSON.stringify({ provider: "microsoft", at: Date.now() - 11 * 60_000 }));
check("Marcador de más de 10 min caduca", takeCalendarPending() === null);
check("Parámetro de retorno ?calendario", CALENDAR_RETURN_PARAM === "calendario");
check("Token JWT de Microsoft aceptado", isPlausibleProviderToken(`eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.${"a".repeat(600)}.${"b_-".repeat(100)}`));
check("Token de cuenta personal (EwB…!) aceptado", isPlausibleProviderToken(`EwBwA8l6BAAU${"x".repeat(900)}!AQ==`));
check("Token con espacios, saltos o < rechazado", !isPlausibleProviderToken("abc def ghi jkl mno pqr stu") && !isPlausibleProviderToken(`${"a".repeat(30)}\r\nX-Evil: 1`) && !isPlausibleProviderToken(`<script>${"a".repeat(30)}`));
check("Token demasiado corto rechazado", !isPlausibleProviderToken("short"));

// ----------------------------------------------------------------------------
section("4. Seguridad y privacidad");
// ----------------------------------------------------------------------------

const exportRoute = read("src/app/api/calendar/microsoft/export/route.ts");
const importRoute = read("src/app/api/calendar/microsoft/import/route.ts");
for (const [name, src] of [
  ["export", exportRoute],
  ["import", importRoute],
] as const) {
  check(`/api/calendar/microsoft/${name}: exige sesión (getRequestUser → 401)`, src.includes("await getRequestUser(request)") && src.includes(", 401)"));
  check(`/api/calendar/microsoft/${name}: token por cabecera X-Microsoft-Token validada`, src.includes('headers.get("x-microsoft-token")') && src.includes("isPlausibleProviderToken(token)"));
  check(`/api/calendar/microsoft/${name}: no escribe en base de datos ni registra el token`, !/\.from\(|\.insert\(|\.upsert\(|console\.log/.test(src));
  check(`/api/calendar/microsoft/${name}: respuesta no cacheable`, src.includes('"Cache-Control": "no-store"'));
}
check("import pide el calendario en UTC con $select mínimo", importRoute.includes('Prefer: \'outlook.timezone="UTC"\'') && importRoute.includes("$select"));

const msClient = read("src/lib/calendar/microsoftCalendarClient.ts");
check("Token solo en sessionStorage (andros.calendar.ms-token)", msClient.includes('TOKEN_KEY = "andros.calendar.ms-token"') && msClient.includes("sessionStorage.setItem(TOKEN_KEY") && !msClient.includes("localStorage.setItem(TOKEN_KEY"));
check("Comprueba si Azure está activado antes de salir (resiliencia)", msClient.includes("/auth/v1/settings") && msClient.includes('"provider_disabled"'));
const cloudSync = read("src/hooks/useCloudSync.ts");
check("Conexión con linkIdentity({ provider: \"azure\" }) (no cambia de cuenta)", /linkIdentity\(\{\s*provider: "azure"/.test(cloudSync));
const modal = read("src/components/calendar/CalendarSyncModal.tsx");
check("Modal: «Abrir en Calendario de Microsoft», «Conectar cuenta de Microsoft» y .ics", modal.includes("Abrir en Calendario de Microsoft") && modal.includes("Conectar cuenta de Microsoft") && modal.includes("Descargar .ics"));
check("Modal: los avisos no ocultan el Nivel 1 (enlaces y .ics fuera de la tarjeta del proveedor)", modal.indexOf("Abrir en Calendario de Microsoft") < modal.indexOf("Conexión directa"));
const privacy = read("src/app/privacidad/page.tsx");
const cookies = read("src/app/cookies/page.tsx");
check("/privacidad documenta Microsoft Graph, Calendars.ReadWrite y que no se guarda el calendario", privacy.includes("Calendars.ReadWrite") && privacy.includes("andros.calendar.ms-token") && privacy.includes("Microsoft Graph"));
check("/cookies lista andros.calendar.ms-token y andros.calendar.outlook-account", cookies.includes("andros.calendar.ms-token") && cookies.includes("andros.calendar.outlook-account"));
const electron = read("electron/main.cjs");
check("App de Windows: solo abre la autorización de login.microsoftonline.com /oauth2/v2.0/authorize", electron.includes('u.hostname === "login.microsoftonline.com"') && electron.includes("oauth2\\/v2\\.0\\/authorize"));

// ----------------------------------------------------------------------------
section("5. Modo Simple: barra esencial y sin herramientas técnicas");
// ----------------------------------------------------------------------------

const topBar = read("src/components/shared/TopStatusBar.tsx");
const simpleStart = topBar.indexOf(") : (", topBar.indexOf("{expert ? ("));
const simpleBranch = topBar.slice(simpleStart, topBar.indexOf("<GoogleAuthButton", simpleStart));
check("Barra Simple: Rojo/Verde, Calendarios, Compartir y Chat", ["<ResolutionStatusPill", "<ExternalCalendarsButton", "<ShareWorkspaceButton showOnMobile", "<ChatButton"].every((t) => simpleBranch.includes(t)), simpleBranch.slice(0, 200));
check(
  "Barra Simple: sin Buscar, Arena, ?, Simple|Experto, Comentarios, Tema ni Instalar",
  ["Buscar", "Arena", "CircleHelp", "ExperienceModeToggle", "CommentsButton", "ThemeToggle", "InstallAppButton"].every((t) => !simpleBranch.includes(t))
);
check("Barra Simple: la voz solo aparece con una llamada activa", simpleBranch.includes("{voiceActive && <CollabRoomButton />}"));
const menu = read("src/components/shared/MoreMenu.tsx");
check("⋯ en Simple no repite la barra (Chat, Compartir, Calendarios)", /SIMPLE_BAR_IDS = new Set\(\["share", "chat", "calendar"\]\)/.test(menu));
check("⋯ en Simple agrupa Equipo · Herramientas · Configuración", menu.includes('team: "Equipo"') && menu.includes('tools: "Herramientas"') && menu.includes('config: "Configuración"'));
check("⋯ en Simple recibe buscar, voz, tema e instalar", ['id: "search"', 'id: "voice"', 'id: "theme"', 'id: "install"'].every((t) => menu.includes(t)));
check("⋯: la Biblioteca científica sigue solo en Experto", /\.\.\.\(expert\s*\?\s*\[\s*\{\s*id: "library"/.test(menu));
const quickAdd = read("src/lib/canvas/quickAdd.ts");
check("«+ Agregar» en Simple oculta 3D, Cálculo y Fórmula LaTeX", /EXPERT_ONLY_QUICK_ADD[^=]*= new Set<QuickAddKind>\(\["file3d", "calc", "formula"\]\)/.test(quickAdd) && quickAdd.includes("!EXPERT_ONLY_QUICK_ADD.has(o.kind)"));
const palette = read("src/components/shared/CommandPalette.tsx");
check("Paleta ⌘K en Simple sin Biblioteca, CodeLab ni Nueva fórmula", /EXPERT_ONLY_COMMAND_IDS = new Set\(\["library", "codelab", "new-formula"\]\)/.test(palette) && palette.includes("!EXPERT_ONLY_COMMAND_IDS.has(c.id)"));
const stack = read("src/components/mobile/TacticalCardStack.tsx");
check("Teléfono: pestañas Cálculos/Código/Fórmulas solo en Experto (o si ya hay tarjetas)", stack.includes('EXPERT_TABS = new Set<string>(["calc-latex-node", "code-lab-node", "formula-sheet-node"])') && stack.includes("filterTabs.map"));
const fileNode = read("src/components/nodes/FileNodeView.tsx");
check("Impresoras 3D: el asistente exige Modo Experto", fileNode.includes("canPrint3D && expert"));
const shortcuts = read("src/hooks/useGlobalShortcuts.ts");
check("Atajos B (Biblioteca) y M (CodeLab) solo en Experto", (shortcuts.match(/experienceMode === "expert"/g) ?? []).length >= 2);

// ----------------------------------------------------------------------------

console.log(`\n${passed} correctas · ${failed} fallidas`);
if (failed > 0) process.exit(1);
