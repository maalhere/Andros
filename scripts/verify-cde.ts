// ============================================================================
// ANDROS — VERIFICACIÓN SPRINT 18: CDE (arranque en 3 pasos, chat, alertas
// unificadas y Fichas de Resolución Rojo / Verde)
// Ejecuta: npm run verify:cde   (sin navegador, sin red, sin Supabase)
//
//   1. Parser de menciones @Área / @usuario / @IA, autocompletado y a quién
//      notifica cada mención (bandeja interna).
//   2. Canal de Alerta Unificada: duplicados exactos, agrupación por tarjetas
//      y por área, fichas que ya siguen una alerta y evaluación local sin IA.
//   3. Ciclo de vida de una Ficha de Resolución: Rojo/Pendiente → Verde/
//      Completado → Reabierta, con código correlativo y trazabilidad CDE.
//   4. Respaldo local del arranque en 3 pasos: fichas por tipo pedido, área de
//      cada ficha, validación de la respuesta de la IA y tablero por áreas.
//   5. Coherencia con supabase/schema.sql §18 y la regla 17B.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import type { EngineeringNodeData } from "@/types/workspace";
import type { ImpactAlertEntry } from "@/lib/canvas/impact";
import { areaKey, canonicalArea, countPeopleByArea, normalizeAreaName, sanitizeAreaList } from "@/lib/cde/areas";
import {
  activeMentionQuery,
  applyMentionCompletion,
  mentionsAi,
  mentionsTarget,
  parseMentions,
  recipientsOf,
  sanitizeMentions,
  suggestMentions,
  type MentionDirectory,
} from "@/lib/cde/mentions";
import {
  alertFingerprint,
  evaluateReportLocally,
  sanitizeReportAlert,
  unifyAlerts,
  type ReportAlert,
} from "@/lib/cde/alerts";
import {
  completeResolution,
  countResolutions,
  createResolution,
  listResolutions,
  nextResolutionCode,
  reopenResolution,
  resolutionFields,
  sanitizeResolution,
  trackedAlertIds,
} from "@/lib/cde/resolution";
import { buildLocalSetupPlan, sanitizeSetupTemplates, splitRequestedKinds } from "@/lib/cde/setup";
import { buildSetupBoard } from "@/lib/cde/setupBoard";
import { sanitizeChatMessage } from "@/lib/cde/chatModel";
import {
  BUILT_IN_TEMPLATES,
  BUILT_IN_TEMPLATE_IDS,
  FORM_MAX_FIELDS,
  sanitizeFormSheet,
  sanitizeTemplate,
} from "@/lib/forms/formSchema";
import {
  CATALOG_CATEGORIES,
  CATALOG_ID_PREFIX,
  TEMPLATE_CATALOG,
  catalogByCategory,
  copyCatalogTemplate,
  findCatalogTemplate,
  instantiateCatalogTemplate,
  isCatalogTemplateId,
  searchCatalog,
} from "@/lib/forms/templateCatalog";
import { PLAN_LIMITS } from "@/lib/billing/planLimits";

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

// ----------------------------------------------------------------------------
// Datos de ejemplo
// ----------------------------------------------------------------------------

const AREAS = ["Logística", "Presupuesto", "Diseño", "Diseño gráfico", "Operaciones"];
const DIR: MentionDirectory = {
  areas: AREAS,
  users: [
    { id: "u-ana", username: "ana", name: "Ana (ejemplo)", area: "Logística" },
    { id: "u-luis", username: "luis_p", name: "Luis (ejemplo)", area: "Presupuesto" },
    { id: "u-eva", username: "eva", name: "Eva (ejemplo)", area: "Logística" },
    { id: "u-sin", username: null, name: "Sin usuario (ejemplo)", area: "" },
  ],
};

// ----------------------------------------------------------------------------
section("1. Menciones @Área, @usuario y @IA");
// ----------------------------------------------------------------------------

const text1 = "@Logística revisen la entrega, @ana confirma y @IA evalúa el impacto. @Logística otra vez";
const p1 = parseMentions(text1, DIR);
check(
  "Reconoce área, usuario e IA (sin repetir, en orden)",
  JSON.stringify(p1.mentions) ===
    JSON.stringify([{ kind: "area", value: "Logística" }, { kind: "user", id: "u-ana", value: "ana" }, { kind: "ai", value: "IA" }]),
  p1.mentions
);
check("Los segmentos reconstruyen el texto exacto", p1.segments.map((s) => s.text).join("") === text1);
check("Resalta 4 menciones (la repetida también se pinta)", p1.segments.filter((s) => s.type === "mention").length === 4);
check("Sin tildes ni mayúsculas: «@logistica» = @Logística", parseMentions("avisen a @logistica", DIR).mentions[0]?.kind === "area");
check(
  "Área más larga primero: «@Diseño gráfico» no se corta en @Diseño",
  (parseMentions("pásalo a @Diseño gráfico hoy", DIR).mentions[0] as { value?: string })?.value === "Diseño gráfico"
);
check("@Diseño sola sigue siendo Diseño", (parseMentions("@Diseño, revisa", DIR).mentions[0] as { value?: string })?.value === "Diseño");
check("Un correo (ana@empresa.com) no es mención", parseMentions("escribe a ana@empresa.com", DIR).mentions.length === 0);
check("@desconocido no es mención", parseMentions("@pedro mira esto", DIR).mentions.length === 0);
check("Palabra más larga (@Logísticas) no es mención", parseMentions("@Logísticas", DIR).mentions.length === 0);
check("@ia en minúsculas activa a la IA", mentionsAi(parseMentions("oye @ia, se cayó el proveedor", DIR).mentions));
check("«@IAs» no activa a la IA", !mentionsAi(parseMentions("las @IAs", DIR).mentions));

const meLuis = { userId: "u-luis", area: "Presupuesto" };
check("@Presupuesto notifica a quien está en Presupuesto", mentionsTarget(parseMentions("@Presupuesto ojo", DIR).mentions, meLuis, "u-ana"));
check("@luis_p notifica a Luis aunque no sea su área", mentionsTarget(parseMentions("@luis_p mira", DIR).mentions, { userId: "u-luis", area: null }, "u-ana"));
check("Tu propio mensaje no te notifica", !mentionsTarget(parseMentions("@Presupuesto ojo", DIR).mentions, meLuis, "u-luis"));
check("@Logística no notifica a Presupuesto", !mentionsTarget(parseMentions("@Logística ojo", DIR).mentions, meLuis, "u-ana"));
check(
  "@Logística llega a todas sus personas (Ana y Eva)",
  JSON.stringify(recipientsOf(parseMentions("@Logística", DIR).mentions, DIR.users).sort()) === JSON.stringify(["u-ana", "u-eva"])
);

const q = activeMentionQuery("Hola @Log", 9);
check("Autocompletado: detecta la mención en curso", q?.start === 5 && q.query === "Log", q);
check("Sin «@» antes del cursor no hay sugerencias", activeMentionQuery("Hola equipo", 11) === null);
check("Correo en curso no abre sugerencias", activeMentionQuery("ana@emp", 7) === null);
const counts = countPeopleByArea(DIR.users.map((u) => ({ area: u.area ?? "" })), AREAS);
const sugg = suggestMentions("log", { ...DIR, areaCounts: counts });
check("Sugiere primero el área con su conteo de personas", sugg[0]?.kind === "area" && sugg[0].label === "@Logística" && sugg[0].count === 2, sugg[0]);
check("Sugiere personas por @usuario o nombre", suggestMentions("lu", { ...DIR, areaCounts: counts }).some((s) => s.kind === "user" && s.userId === "u-luis"));
check("Personas sin @usuario no se sugieren", !suggestMentions("sin", { ...DIR, areaCounts: counts }).some((s) => s.kind === "user"));
check("«@i» sugiere @IA", suggestMentions("i", { ...DIR, areaCounts: counts }).some((s) => s.kind === "ai"));
const completed = applyMentionCompletion("Hola @Log mañana", 5, 9, "@Logística ");
check("Inserta la mención y deja el cursor detrás", completed.text === "Hola @Logística mañana" && completed.caret === 16, completed);
check(
  "jsonb `mentions` inválido se descarta",
  JSON.stringify(sanitizeMentions([{ kind: "area", value: "Diseño" }, { kind: "hack" }, "x", { kind: "user", value: "ana" }, { kind: "ai" }])) ===
    JSON.stringify([{ kind: "area", value: "Diseño" }, { kind: "ai", value: "IA" }])
);
check("Nombre de área limpio («  @operaciones!! » → «Operaciones»)", normalizeAreaName("  @operaciones!! ") === "Operaciones");
check("Lista de áreas sin duplicados por tildes", JSON.stringify(sanitizeAreaList(["Logística", "logistica", "", "Diseño"])) === JSON.stringify(["Logística", "Diseño"]));
check("canonicalArea respeta la escritura del espacio", canonicalArea("LOGISTICA", AREAS) === "Logística");

// ----------------------------------------------------------------------------
section("2. Canal de Alerta Unificada de IA (sin duplicados)");
// ----------------------------------------------------------------------------

const impact = (id: string, target: string, severity: "warning" | "info", summary: string, at: number): ImpactAlertEntry => ({
  id,
  targetNodeId: target,
  sourceNodeId: "n1",
  severity,
  summary,
  notifyWho: null,
  suggestedAction: "Ajustar",
  sourceTitle: "Asistentes",
  targetTitle: "Tarjeta",
  createdAt: at,
});
const report = (id: string, summary: string, nodes: string[], areas: string[], at: number, severity: "warning" | "info" = "warning"): ReportAlert => ({
  id,
  summary,
  severity,
  affectedNodeIds: nodes,
  affectedAreas: areas,
  suggestedAction: "Revisar",
  reporterName: "Ana (ejemplo)",
  reporterId: "u-ana",
  message: summary,
  createdAt: at,
  engine: "local",
});

const VALID = new Set(["n1", "n2", "n3"]);
const unified = unifyAlerts({
  impact: [
    impact("a1", "n2", "warning", "Subieron los asistentes: el presupuesto queda corto", 1000),
    impact("a2", "n2", "info", "Revisar el catering", 1100),
    impact("a-gone", "n9", "warning", "Tarjeta borrada", 1200),
  ],
  reports: [
    report("r1", "Se retrasó el proveedor de audio 2 días", ["n3"], ["Logística"], 2000),
    report("r2", "se retrasó el proveedor de audio, 2 días!", ["n3"], ["logística"], 2100),
    report("r3", "El presupuesto de comida ya no alcanza", ["n2"], [], 2200),
    report("r4", "Falta aprobar la factura del sonido", [], ["Presupuesto"], 2300),
    report("r5", "El pago al proveedor sigue pendiente", [], ["presupuesto"], 2400, "info"),
    report("r-tracked", "Ya tiene ficha", ["n1"], [], 2500),
    report("r-dismissed", "Descartada", ["n1"], [], 2600),
  ],
  tracked: new Set(["r-tracked"]),
  dismissed: new Set(["r-dismissed"]),
  validNodeIds: VALID,
});
check("Quedan 3 alertas: n2, n3 y el grupo de Presupuesto", unified.length === 3, unified.map((u) => u.sourceIds));
const groupN2 = unified.find((u) => u.affectedNodeIds.includes("n2"));
check("Descuadres + reporte sobre la MISMA tarjeta → una sola alerta", groupN2?.sourceIds.slice().sort().join(",") === "a1,a2,r3", groupN2?.sourceIds);
check("La alerta consolidada es «warning» si alguna lo es", groupN2?.severity === "warning");
check("Titular = el aviso «warning» más reciente", groupN2?.headline === "El presupuesto de comida ya no alcanza", groupN2?.headline);
const groupN3 = unified.find((u) => u.affectedNodeIds.includes("n3"));
check("Reporte duplicado exacto → 1 motivo, 2 avisos unificados", groupN3?.reasons.length === 1 && groupN3.occurrences === 2, groupN3);
const groupArea = unified.find((u) => u.affectedNodeIds.length === 0);
check(
  "Sin tarjetas: se agrupa por área (sin tildes ni mayúsculas)",
  groupArea?.sourceIds.slice().sort().join(",") === "r4,r5" && groupArea.affectedAreas.length === 1,
  groupArea
);
check("Lo que ya sigue una Ficha de Resolución no se muestra", !unified.some((u) => u.sourceIds.includes("r-tracked")));
check("Lo descartado no se muestra", !unified.some((u) => u.sourceIds.includes("r-dismissed")));
check("Alertas de tarjetas borradas se ignoran", !unified.some((u) => u.sourceIds.includes("a-gone")));
check("Orden: primero las «warning»", unified.every((u, i) => i === 0 || !(u.severity === "warning" && unified[i - 1].severity === "info")));
check("Id estable de la alerta unificada", unifyAlerts({ impact: [], reports: [report("r1", "x", ["n3"], [], 1)] })[0]?.id === "ua-r1");
check(
  "Huella: mismo texto con otra puntuación = duplicado",
  alertFingerprint("¡Se retrasó el audio!", ["b", "a"], ["Logística"]) === alertFingerprint("se retraso el audio", ["a", "b"], ["logistica"])
);

const cards = [
  { id: "crono", title: "Cronograma del evento", area: "Operaciones", text: "Viernes 18:00 prueba de sonido con el proveedor de audio" },
  { id: "pres", title: "Presupuesto base", area: "Presupuesto", text: "Catering 300 · Sillas 120" },
  { id: "log", title: "Logística", area: "Logística", text: "Montaje del escenario y transporte del equipo de audio" },
];
const ev = evaluateReportLocally("@IA se retrasó el proveedor de audio 2 días", cards, AREAS, ["Logística"]);
check("Respaldo sin IA: «se retrasó» es una incidencia «warning»", ev.isIssue && ev.severity === "warning", ev);
check("Respaldo sin IA: encuentra las tarjetas del audio (no el presupuesto)", ev.affectedNodeIds.includes("crono") && !ev.affectedNodeIds.includes("pres"), ev.affectedNodeIds);
check("Respaldo sin IA: avisa al área mencionada y a la de las tarjetas", ev.affectedAreas.includes("Logística") && ev.affectedAreas.includes("Operaciones"), ev.affectedAreas);
check("Respaldo sin IA: sugiere ajustar el cronograma", /cronograma/i.test(ev.suggestedAction));
check("Respaldo sin IA: el resumen no lleva «@IA»", !/@IA/i.test(ev.summary) && ev.summary.startsWith("Se retrasó"));
const evMoney = evaluateReportLocally("@IA subió el costo del catering", cards, AREAS);
check("Respaldo sin IA: dinero → avisa a Presupuesto", evMoney.affectedAreas.includes("Presupuesto") && evMoney.affectedNodeIds.includes("pres"), evMoney);
const evInfo = evaluateReportLocally("@IA el salón tiene buena luz natural", cards, AREAS);
check("Respaldo sin IA: un comentario sin problema queda como «info»", !evInfo.isIssue && evInfo.severity === "info");

const savedAlert = sanitizeReportAlert(
  { summary: "  Audio tarde  ", severity: "boom", affectedNodeIds: ["crono", "crono", 4], affectedAreas: ["logística", "@Logística", "!!"], engine: "ai" },
  { id: "rep-1", createdAt: 5, reporterName: "Ana", reporterId: "u-ana" }
);
check(
  "jsonb `alert` del chat se valida (severidad, ids y áreas sin repetir)",
  savedAlert?.summary === "Audio tarde" && savedAlert.severity === "warning" && savedAlert.affectedNodeIds.length === 1 && savedAlert.affectedAreas.length === 1,
  savedAlert
);
const chatRow = sanitizeChatMessage({
  id: "m1",
  workspace_id: "ws",
  author_id: "u-ana",
  author_name: "Ana",
  author_area: "logística",
  body: "Alerta unificada: Audio tarde",
  mentions: [{ kind: "area", value: "Logística" }],
  kind: "ai-alert",
  alert: { summary: "Audio tarde", affectedNodeIds: ["crono"] },
  created_at: "2026-11-26T10:00:00Z",
});
check("Fila del chat `ai-alert` → reporte con id propio y autor del trigger", chatRow?.kind === "ai-alert" && chatRow.alert?.id === "rep-m1" && chatRow.alert.reporterName === "Ana");
check("`ai-alert` sin alerta válida se trata como mensaje normal", sanitizeChatMessage({ ...chatRow, workspace_id: "ws", author_id: "u", id: "m2", alert: null })?.kind === "message");

// ----------------------------------------------------------------------------
section("3. Ficha de Resolución: Rojo (Pendiente) → Verde (Completado)");
// ----------------------------------------------------------------------------

check("Primer código del espacio: RES-001", nextResolutionCode([]) === "RES-001");
const T0 = "2026-11-26T09:00:00.000Z";
const created = createResolution({
  existingCodes: ["RES-001", "RES-007", "OTRO-3"],
  description: "Proveedor de audio retrasado 2 días",
  area: "logística",
  assigneeName: "Ana (ejemplo)",
  assigneeId: "u-ana",
  affectedNodeIds: ["crono", "crono", "log"],
  sourceAlertIds: ["r1", "r2"],
  by: "Luis (ejemplo)",
  at: T0,
});
check("Código correlativo: RES-008 (uno más que el mayor)", created.code === "RES-008", created.code);
check("Nace en Rojo / Pendiente", created.status === "pending" && created.completedAt === null && created.completedBy === null);
check("Trazabilidad: área, persona, tarjetas sin repetir y alertas de origen", created.area === "Logística" && created.assigneeId === "u-ana" && created.affectedNodeIds.join() === "crono,log" && created.sourceAlertIds.length === 2);
check("Historial: «creada» por quien la abrió", created.history.length === 1 && created.history[0].action === "created" && created.history[0].by === "Luis (ejemplo)");

const T1 = "2026-11-26T15:30:00.000Z";
const done = completeResolution(created, "Ana (ejemplo)", T1);
check("Pasa a Verde / Completado con quién y cuándo", done.status === "done" && done.completedBy === "Ana (ejemplo)" && done.completedAt === T1);
check("Historial registra el paso a Verde", done.history.length === 2 && done.history[1].action === "completed" && done.history[1].at === T1);
check("Completar dos veces no duplica el historial", completeResolution(done, "Otra", T1) === done);
check("La ficha original no se modifica (inmutable)", created.status === "pending" && created.history.length === 1);
const reopened = reopenResolution(done, "Luis (ejemplo)", "2026-11-27T08:00:00.000Z");
check("Reabrir vuelve a Rojo y borra el cierre, pero el historial lo conserva", reopened.status === "pending" && reopened.completedBy === null && reopened.history.map((h) => h.action).join() === "created,completed,reopened");

const fields = resolutionFields(done, (id) => (id === "crono" ? "Cronograma del evento" : null));
const value = (key: string) => fields.find((f) => f.fieldKey === key)?.value;
check("Campos espejo: código, estado Verde y área", value("codigo") === "RES-008" && value("estado") === "Completado" && value("area_responsable") === "@Logística");
check("Campos espejo: tarjetas afectadas legibles (y «eliminada» si falta)", value("tarjetas_afectadas") === "Cronograma del evento\nTarjeta eliminada");
check("Campos espejo: quién la completó", value("completada_por") === "Ana (ejemplo)");

const roundTrip = sanitizeResolution(JSON.parse(JSON.stringify(done)));
check("Ida y vuelta por la nube / sala conserva la trazabilidad", JSON.stringify(roundTrip) === JSON.stringify(done), roundTrip);
check("Código inválido → no es Ficha de Resolución", sanitizeResolution({ ...done, code: "RES-<script>" }) === undefined);
check("Pendiente con datos de cierre falsos → se limpian", sanitizeResolution({ ...done, status: "pending" })?.completedBy === null);
const sheet = sanitizeFormSheet({ templateId: "cde-resolution", category: "Resolución", fields, attachments: [], area: "logistica", resolution: done });
check("sanitizeFormSheet conserva `resolution` y `area`", sheet.resolution?.code === "RES-008" && sheet.area === "Logistica" && sheet.fields.length === fields.length);

const resNode = (id: string, meta: typeof created): EngineeringNodeData => ({
  id,
  type: "form-sheet-node",
  title: meta.code,
  codeTag: meta.code,
  position: { x: 0, y: 0 },
  updatedAt: "ejemplo",
  formSheetData: { templateId: "cde-resolution", category: "Resolución", fields: [], attachments: [], resolution: meta },
});
const canvas = [resNode("res-a", created), resNode("res-b", done), resNode("res-c", { ...created, code: "RES-002", sourceAlertIds: ["a1"] })];
check("Semáforo del lienzo: 2 Rojo · 1 Verde", JSON.stringify(countResolutions(canvas)) === JSON.stringify({ pending: 2, done: 1 }));
check("Listado ordenado por código", listResolutions(canvas).map((r) => r.meta.code).join() === "RES-002,RES-008,RES-008");
check("Alertas seguidas por fichas (se ocultan de la barra)", [...trackedAlertIds(canvas)].sort().join() === "a1,r1,r2");

// ----------------------------------------------------------------------------
section("4. Arranque en 3 pasos: respaldo local sin IA");
// ----------------------------------------------------------------------------

const DESCRIPTION = "Fichas de control de compras, actas de entrega y seguimiento de incidencias";
check(
  "Separa los tipos pedidos",
  JSON.stringify(splitRequestedKinds(DESCRIPTION)) === JSON.stringify(["control de compras", "actas de entrega", "seguimiento de incidencias"]),
  splitRequestedKinds(DESCRIPTION)
);
const SETUP_AREAS = ["Logística", "Presupuesto", "Operaciones"];
const plan = buildLocalSetupPlan(DESCRIPTION, SETUP_AREAS);
check("Una ficha por tipo, motor local", plan.engine === "local" && plan.templates.map((t) => t.title).join(" | ") === "Control de compras | Acta de entrega | Seguimiento de incidencias", plan.templates.map((t) => t.title));
check(
  "Cada ficha va al área que le corresponde",
  plan.templates.map((t) => t.area).join(",") === "Presupuesto,Logística,Operaciones",
  plan.templates.map((t) => t.area)
);
check("Campos útiles (≥ 5) y tipados", plan.templates.every((t) => t.fields.length >= 5) && plan.templates[0].fields.some((f) => f.type === "number"));
check("Estados como lista desplegable con opciones", plan.templates[2].fields.some((f) => f.type === "select" && (f.options?.length ?? 0) >= 2));
check("Sin áreas: las fichas quedan sin área", buildLocalSetupPlan(DESCRIPTION, []).templates.every((t) => t.area === ""));
check("Sin descripción: fichas base de tareas e incidencias", buildLocalSetupPlan("", SETUP_AREAS).templates.length === 2);
const unknownPlan = buildLocalSetupPlan("bitácora de obra y fichas de mantenimiento de vehículos", ["Ingeniería"]);
check("Tipos desconocidos → ficha genérica con su nombre", unknownPlan.templates.some((t) => t.title === "Bitácora de obra") && unknownPlan.templates.every((t) => t.area === "Ingeniería"), unknownPlan.templates.map((t) => t.title));
const balanced = buildLocalSetupPlan("bitácora, informe semanal, permisos", ["Diseño", "Calidad"]);
check("Sin área preferida: se reparten entre las áreas", new Set(balanced.templates.map((t) => t.area)).size === 2, balanced.templates.map((t) => t.area));

const aiTemplates = sanitizeSetupTemplates(
  {
    templates: [
      { title: "Control de compras", area: "presupuesto", fields: [{ label: "Proveedor", type: "text" }, { label: "Estado", type: "select", options: ["Solo una"] }, { label: "Monto", type: "money" }] },
      { title: "control de compras", area: "Logística", fields: [{ label: "X", type: "text" }] },
      { title: "Sin campos", area: "Logística", fields: [] },
      { title: "**Acta**", area: "Área inventada", fields: [{ label: "Fecha", type: "date" }, { label: "Fecha", type: "date" }] },
    ],
  },
  SETUP_AREAS
);
check("IA: títulos repetidos y fichas sin campos se descartan", aiTemplates.length === 2, aiTemplates.map((t) => t.title));
check("IA: área escrita distinto → la del espacio", aiTemplates[0].area === "Presupuesto");
check("IA: tipo desconocido → texto; lista con 1 opción → texto", aiTemplates[0].fields[1].type === "text" && aiTemplates[0].fields[2].type === "text");
check("IA: área inventada → una real del espacio; sin Markdown ni campos repetidos", SETUP_AREAS.includes(aiTemplates[1].area) && aiTemplates[1].title === "Acta" && aiTemplates[1].fields.length === 1);

const board = buildSetupBoard(
  plan,
  SETUP_AREAS,
  [
    { name: "Luis (ejemplo)", username: null, role: "owner", area: "Presupuesto" },
    { name: "Ana (ejemplo)", username: "ana", role: "editor", area: "Logística" },
  ],
  { x: 80, y: 120 },
  "Feria (ejemplo)"
);
const sheets = board.nodes.filter((n) => n.type === "form-sheet-node");
const notes = board.nodes.filter((n) => n.type === "sketch-note-node");
check("Tablero: coordinación + 1 nota por área + 1 ficha por formato", notes.length === 1 + SETUP_AREAS.length && sheets.length === 3, board.nodes.map((n) => n.title));
check("Cables: coordinación → áreas y área → fichas", board.connections.length === SETUP_AREAS.length + 3);
check(
  "Cada ficha lleva su área y su formato guardable",
  sheets.every((s) => s.type === "form-sheet-node" && Boolean(s.formSheetData.area) && board.templates.some((t) => t.id === s.formSheetData.templateId))
);
const columns = new Map<number, number[]>();
for (const n of board.nodes) columns.set(n.position.x, [...(columns.get(n.position.x) ?? []), n.position.y]);
check("Una columna por área, sin tarjetas encimadas", columns.size === 1 + SETUP_AREAS.length && [...columns.values()].every((ys) => new Set(ys).size === ys.length));
const coordText = notes[0].type === "sketch-note-node" ? notes[0].sketchNoteData.textBlocks.map((b) => b.text).join("\n") : "";
check("La coordinación lista equipo con permiso y @Área", coordText.includes("Ana (ejemplo) (@ana) · Editor · @Logística") && coordText.includes("@Presupuesto"));

// ----------------------------------------------------------------------------
section("5. Esquema SQL §18 y regla 17B");
// ----------------------------------------------------------------------------

const root = process.cwd();
const sql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
check("workspace_members.work_area (idempotente)", /alter table public\.workspace_members add column if not exists work_area text/.test(sql));
check("workspaces.work_areas + owner_work_area", sql.includes("add column if not exists work_areas jsonb") && sql.includes("add column if not exists owner_work_area"));
check("Tabla workspace_chat_messages con las columnas pedidas", /create table if not exists public\.workspace_chat_messages[\s\S]*author_area[\s\S]*mentions\s+jsonb[\s\S]*linked_node_id[\s\S]*created_at/.test(sql));
check("RLS activa en el chat", sql.includes("alter table public.workspace_chat_messages enable row level security"));
check("Leer: cualquier miembro (también Solo lectura)", /workspace_chat_select[\s\S]{0,200}is_workspace_member\(workspace_id\)/.test(sql));
check("Escribir: solo dueño, Editor y Comentarista, como uno mismo", /workspace_chat_insert[\s\S]{0,260}can_comment_workspace\(workspace_id\)[\s\S]{0,80}author_id = \(select auth\.uid\(\)\)/.test(sql));
check("Trigger BEFORE INSERT rellena autor y área desde profiles/members", /before insert on public\.workspace_chat_messages/.test(sql) && /workspace_chat_fill_author[\s\S]*profile_display_name\(auth\.uid\(\)\)[\s\S]*work_area/.test(sql));
check("Los mensajes no se editan (trazabilidad)", sql.includes("before update on public.workspace_chat_messages"));
check("Sala: `chat:new` solo de quien puede comentar; `cde:changed` solo el dueño", sql.includes("if event = 'chat:new' then") && sql.includes("('access:changed', 'cde:changed')"));
check("Áreas: solo el dueño las cambia", sql.includes("Solo el dueño puede cambiar las áreas de trabajo del espacio."));

const srcFiles: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(full);
  }
};
walk(path.join(root, "src/lib/cde"));
walk(path.join(root, "src/components/cde"));
const cdeCode = srcFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
check("Sin `persistFor` en el CDE", !cdeCode.includes("persistFor"));
check("El aviso de la sala solo pide releer (no guarda lo recibido)", cdeCode.includes("scheduleCdeRefresh") && !/applyRemote|upsertMessage\(payload/.test(cdeCode));
check("El navegador no manda autor ni área del mensaje", !/author_name:|author_area:|author_id:/.test(fs.readFileSync(path.join(root, "src/lib/cde/repository.ts"), "utf8")));
check("Textos nuevos sin marcas de terceros", !/WhatsApp|Slack|Excel|Google Sheets|Outlook|Teams/.test(cdeCode));
check("areaKey ignora tildes", areaKey("Logística") === areaKey("LOGISTICA"));

// ----------------------------------------------------------------------------
// 6. (Sprint 23) Catálogo de plantillas de la Librería de fichas
// ----------------------------------------------------------------------------

section("6. Librería de fichas: catálogo de plantillas (Sprint 23)");
{
  const VALID_CATEGORY_IDS = new Set(CATALOG_CATEGORIES.map((c) => c.id));
  const VALID_CATEGORY_LABELS = new Set(CATALOG_CATEGORIES.map((c) => c.label));

  check("Al menos 20 plantillas en el catálogo", TEMPLATE_CATALOG.length >= 20, TEMPLATE_CATALOG.length);
  check("Exactamente 24 plantillas (Sprint 23)", TEMPLATE_CATALOG.length === 24, TEMPLATE_CATALOG.length);
  check("6 categorías con nombre y etiqueta corta", CATALOG_CATEGORIES.length === 6 && CATALOG_CATEGORIES.every((c) => c.label.trim() && c.short.trim() && c.label.length <= 40));
  const perCategory = CATALOG_CATEGORIES.map((c) => [c.id, catalogByCategory(c.id).length] as const);
  check("4 plantillas por categoría", perCategory.every(([, n]) => n === 4), perCategory);

  const ids = TEMPLATE_CATALOG.map((t) => t.id);
  check("Ids únicos con prefijo «cat-»", new Set(ids).size === ids.length && ids.every((id) => id.startsWith(CATALOG_ID_PREFIX)));
  check("Ningún id choca con los formatos iniciales", ids.every((id) => !BUILT_IN_TEMPLATE_IDS.has(id)));
  check("Títulos únicos", new Set(TEMPLATE_CATALOG.map((t) => t.title)).size === TEMPLATE_CATALOG.length);

  const bad: string[] = [];
  for (const t of TEMPLATE_CATALOG) {
    const where = t.id;
    if (!t.title.trim() || t.title.length > 80) bad.push(`${where}: título`);
    if (!t.description || t.description.trim().length < 30 || t.description.length > 200) bad.push(`${where}: descripción`);
    if (!VALID_CATEGORY_IDS.has(t.catalogCategory) || !VALID_CATEGORY_LABELS.has(t.category)) bad.push(`${where}: categoría`);
    if (normalizeAreaName(t.area) !== t.area || !t.area) bad.push(`${where}: área sugerida`);
    if (t.fields.length < 6 || t.fields.length > FORM_MAX_FIELDS) bad.push(`${where}: ${t.fields.length} campos`);
    if (new Set(t.fields.map((f) => f.fieldKey)).size !== t.fields.length) bad.push(`${where}: fieldKey repetido`);
    if (t.fields.some((f) => !f.label.trim() || !/^[a-z][a-z0-9_]{0,39}$/.test(f.fieldKey))) bad.push(`${where}: campo sin nombre o clave inválida`);
    if (t.fields.some((f) => f.type === "select" && (f.options?.length ?? 0) < 2)) bad.push(`${where}: lista sin opciones`);
    if (Object.keys(t.prefill).length === 0) bad.push(`${where}: sin estructura prellenada`);
    for (const [key, value] of Object.entries(t.prefill)) {
      const field = t.fields.find((f) => f.fieldKey === key);
      if (!field) bad.push(`${where}: prellenado de un campo inexistente (${key})`);
      else if (field.type === "select" && !(field.options ?? []).includes(String(value))) bad.push(`${where}: opción inicial inválida (${key})`);
    }
    // Validación real: la plantilla sobrevive a la misma sanitización que la nube.
    const clean = sanitizeTemplate(t);
    if (!clean || clean.fields.length !== t.fields.length) bad.push(`${where}: no pasa sanitizeTemplate`);
  }
  check("Cada plantilla: título, descripción, categoría, área y campos útiles", bad.length === 0, bad);

  // «Usar en el espacio» → ficha con guías y área, válida para la nube y la sala.
  const instantiated = TEMPLATE_CATALOG.map((t) => ({ t, sheet: instantiateCatalogTemplate(t) }));
  check(
    "Ficha creada: mismos campos, área sugerida y guías aplicadas",
    instantiated.every(
      ({ t, sheet }) =>
        sheet.data.fields.length === t.fields.length &&
        sheet.data.area === t.area &&
        sheet.data.templateId === t.id &&
        Object.entries(t.prefill).every(([k, v]) => sheet.data.fields.find((f) => f.fieldKey === k)?.value === v),
    ),
  );
  check(
    "Ficha creada: pasa sanitizeFormSheet sin perder datos",
    instantiated.every(({ sheet }) => {
      const round = sanitizeFormSheet(JSON.parse(JSON.stringify(sheet.data)));
      return round.fields.length === sheet.data.fields.length && round.area === sheet.data.area;
    }),
  );
  const rfi = findCatalogTemplate("cat-riesgos-incidencias");
  const riskSheet = rfi ? instantiateCatalogTemplate(rfi).data : null;
  check(
    "Bitácora de riesgos arranca en Rojo · Pendiente",
    riskSheet?.fields.find((f) => f.fieldKey === "estado")?.value === "Rojo · Pendiente",
  );

  // «Copiar a mis formatos»: copia editable, id nuevo, sin tocar el catálogo.
  const source = TEMPLATE_CATALOG[0];
  const copy = copyCatalogTemplate(source);
  check(
    "Copia a Mis formatos: id nuevo y mismos campos",
    copy.id !== source.id && !isCatalogTemplateId(copy.id) && copy.fields.length === source.fields.length && copy.title === source.title,
  );
  check("La copia no modifica el catálogo", findCatalogTemplate(source.id)?.fields[0].id === `${source.id}-f1`);

  // Búsqueda rápida (sin tildes) y filtros.
  check("Buscar «planos» encuentra la revisión de planos", searchCatalog("planos").some((t) => t.id === "cat-revision-planos"));
  check("Buscar sin tildes («revision diseno»)", searchCatalog("revision diseno").some((t) => t.id === "cat-revision-diseno"));
  check("Filtro por categoría + búsqueda", searchCatalog("", "obra").length === 4 && searchCatalog("tesis", "obra").length === 0);
  check("Las 24 plantillas pedidas están presentes", [
    "Arranque de proyecto (Kickoff)", "Reunión semanal y acuerdos", "Control de entregables por área", "Bitácora de riesgos e incidencias (Rojo/Verde)",
    "Brief creativo y alcance", "Revisión de diseño y feedback visual", "Hoja de ruta de lanzamiento (Roadmap)", "Investigación con usuarios y hallazgos",
    "Revisión de planos y observaciones", "Solicitud de información técnica (RFI)", "Lista de verificación en campo / inspección", "Control de presupuesto y materiales",
    "Propuesta comercial para cliente", "Seguimiento de proveedores y compras", "Plan operativo mensual de PyME", "Incorporación de nuevo integrante (Onboarding)",
    "Planificación de evento o feria", "Calendario editorial y campañas", "Producción audiovisual / pieza creativa", "Resumen post-evento y aprendizajes",
    "Proyecto final o tesis en equipo", "Plan de estudio y entregas del periodo", "Investigación académica y fuentes", "Planificación semanal personal",
  ].every((title) => TEMPLATE_CATALOG.some((t) => t.title === title)));

  // Compatibilidad: la librería personal y el límite del Plan Básico no cambian.
  check("Formatos iniciales de la librería personal intactos (4)", BUILT_IN_TEMPLATES.length === 4);
  check("Plan Básico: sigue siendo 1 plantilla propia", PLAN_LIMITS.free.maxCustomTemplates === 1);
  const storeSrc = fs.readFileSync(path.join(root, "src/store/useFormsLibraryStore.ts"), "utf8");
  check("El catálogo no se guarda en la librería personal", !/templateCatalog|TEMPLATE_CATALOG/.test(storeSrc));

  // Marcas de terceros: ni una en las plantillas (todos sus textos).
  const BRANDS =
    /whats\s?app|telegram|slack|discord|\bteams\b|skype|messenger|\bzoom\b|\bexcel\b|\bword\b|power\s?point|keynote|google|microsoft|drive|dropbox|notion|evernote|onenote|trello|\bmiro\b|asana|jira|clickup|airtable|figma|canva|calendly|chat\s?gpt|copilot|autocad|revit|solidworks|sketchup|procore|instagram|facebook|tiktok|twitter|linkedin|youtube/i;
  const texts = TEMPLATE_CATALOG.flatMap((t) => [
    t.title,
    t.description ?? "",
    t.category,
    t.area,
    ...t.fields.flatMap((f) => [f.label, f.unit ?? "", ...(f.options ?? [])]),
    ...Object.values(t.prefill).map((v) => String(v)),
  ]);
  const hits = texts.filter((s) => BRANDS.test(s));
  check("Plantillas: 0 apps o marcas de terceros", hits.length === 0, hits);
  check("Categorías: 0 apps o marcas de terceros", CATALOG_CATEGORIES.every((c) => !BRANDS.test(`${c.label} ${c.short}`)));

  // «WhatsApp» no aparece en NINGÚN archivo fuente (código, comentarios ni metadatos).
  const everyFile: string[] = [];
  const walkAll = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) walkAll(full);
      } else if (/\.(ts|tsx|js|cjs|mjs|css|json|webmanifest)$/.test(e.name)) everyFile.push(full);
    }
  };
  walkAll(path.join(root, "src"));
  walkAll(path.join(root, "electron"));
  walkAll(path.join(root, "public"));
  const whatsapp = everyFile.filter((f) => /whats\s?app/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
  check(`«WhatsApp»: 0 apariciones en src/, electron/ y public/ (${everyFile.length} archivos)`, whatsapp.length === 0, whatsapp);
  const landingDir = path.join(root, "src/components/landing");
  const landingSources = [
    ...fs.readdirSync(landingDir).map((f) => path.join(landingDir, f)),
    path.join(root, "src/app/layout.tsx"),
    path.join(root, "src/app/manifest.ts"),
    path.join(root, "src/app/opengraph-image.tsx"),
    path.join(root, "src/lib/site.ts"),
    path.join(root, "src/lib/forms/templateCatalog.ts"),
  ];
  const landingHits = landingSources.filter((f) => /whats\s?app|telegram|slack|\bexcel\b|notion|revit/i.test(fs.readFileSync(f, "utf8")));
  check("Portada, SEO y catálogo: sin «WhatsApp» ni apps de mensajería u ofimática", landingHits.length === 0, landingHits);
}

console.log(`\n${passed} correctas · ${failed} fallidas`);
if (failed > 0) process.exit(1);
