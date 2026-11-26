// ============================================================================
// ANDROS — PLANTILLAS LOCALES (0 ms, $0 de API)
//
// Tres plantillas incluidas + las que cada equipo guarda desde ⋯ → «Guardar
// como plantilla» (localStorage, clave `andros_custom_templates`). Todo se
// aplica sin llamar a ninguna IA, así que nunca gasta cuota ni espera red.
// Las cifras del presupuesto son de ejemplo y así se indica en la tarjeta.
// ============================================================================

import { budgetCalcCard, sanitizeStoredBlueprint, type BoardBlueprint } from "@/lib/templates/blueprint";

export interface LocalTemplate {
  id: string;
  name: string;
  description: string;
  blueprint: BoardBlueprint;
}

const lines = (...parts: string[]) => parts.join("\n");

const FAIR: BoardBlueprint = {
  name: "Feria / Evento presencial",
  description: "Resumen, cronograma, presupuesto, logística y roles.",
  cards: [
    {
      kind: "note",
      title: "Resumen y meta",
      tag: "RESUMEN",
      col: 0,
      row: 0,
      text: lines("# Nombre del evento", "- Fecha tentativa: por definir", "- Asistentes estimados: por definir", "- Objetivo: ¿qué quieren lograr?"),
    },
    {
      kind: "note",
      title: "Cronograma",
      tag: "CRONOGRAMA",
      col: 1,
      row: 0,
      text: lines(
        "- 4 semanas antes — definir lugar, fecha y presupuesto",
        "- 3 semanas antes — confirmar proveedores y permisos",
        "- 2 semanas antes — lanzar la convocatoria",
        "- 1 semana antes — compras y ensayo general",
        "- Día del evento — montaje, evento y cierre",
        "- Después — balance y agradecimientos"
      ),
    },
    budgetCalcCard(
      [
        { item: "Lugar / espacio", amount: 300 },
        { item: "Materiales y decoración", amount: 150 },
        { item: "Comida y bebida", amount: 400 },
        { item: "Difusión", amount: 80 },
        { item: "Imprevistos", amount: 100 },
      ],
      { col: 2, row: 0 }
    ),
    {
      kind: "note",
      title: "Logística y pendientes",
      tag: "LOGÍSTICA",
      col: 1,
      row: 1,
      text: lines(
        "- [ ] Reservar el espacio",
        "- [ ] Pedir permisos",
        "- [ ] Comprar materiales",
        "- [ ] Preparar señalización y registro",
        "- [ ] Confirmar proveedores",
        "- [ ] Plan B por si llueve"
      ),
    },
    {
      kind: "note",
      title: "Responsables y roles",
      tag: "ROLES",
      col: 0,
      row: 1,
      text: lines(
        "- [ ] Coordinación general · Asignar a: ___",
        "- [ ] Logística y compras · Asignar a: ___",
        "- [ ] Comunicación y difusión · Asignar a: ___",
        "- [ ] Finanzas · Asignar a: ___",
        "- [ ] Atención a asistentes · Asignar a: ___"
      ),
    },
  ],
  links: [
    { from: 0, to: 1, label: "Plan" },
    { from: 1, to: 2, label: "Costos" },
    { from: 1, to: 3, label: "Preparativos" },
    { from: 0, to: 4, label: "Equipo" },
  ],
};

const MEETING: BoardBlueprint = {
  name: "Reunión / Taller de equipo",
  description: "Meta, agenda, acuerdos y quién hace qué.",
  cards: [
    {
      kind: "note",
      title: "Objetivo y datos",
      tag: "RESUMEN",
      col: 0,
      row: 0,
      text: lines("# Nombre de la reunión", "- Fecha y hora: por definir", "- Participantes: por definir", "- Resultado esperado: ¿qué debe salir de aquí?"),
    },
    {
      kind: "note",
      title: "Agenda",
      tag: "AGENDA",
      col: 1,
      row: 0,
      text: lines(
        "- 00:00 — bienvenida y objetivo",
        "- 00:10 — revisión de pendientes anteriores",
        "- 00:25 — tema principal",
        "- 00:50 — decisiones y acuerdos",
        "- 01:00 — cierre y próximos pasos"
      ),
    },
    {
      kind: "note",
      title: "Acuerdos y pendientes",
      tag: "ACUERDOS",
      col: 1,
      row: 1,
      text: lines("- [ ] Acuerdo 1 · Responsable: ___ · Fecha: ___", "- [ ] Acuerdo 2 · Responsable: ___ · Fecha: ___", "- [ ] Acuerdo 3 · Responsable: ___ · Fecha: ___"),
    },
    {
      kind: "note",
      title: "Roles de la sesión",
      tag: "ROLES",
      col: 0,
      row: 1,
      text: lines("- [ ] Facilita · Asignar a: ___", "- [ ] Toma notas · Asignar a: ___", "- [ ] Controla el tiempo · Asignar a: ___"),
    },
  ],
  links: [
    { from: 0, to: 1, label: "Agenda" },
    { from: 1, to: 2, label: "Decisiones" },
    { from: 0, to: 3, label: "Equipo" },
  ],
};

const PROJECT: BoardBlueprint = {
  name: "Proyecto con entregables",
  description: "Alcance, hitos, entregables, responsables y riesgos.",
  cards: [
    {
      kind: "note",
      title: "Alcance y meta",
      tag: "ALCANCE",
      col: 0,
      row: 0,
      text: lines("# Nombre del proyecto", "- Objetivo: ¿qué problema resuelve?", "- Fecha límite: por definir", "- Equipo: por definir"),
    },
    {
      kind: "note",
      title: "Hitos",
      tag: "HITOS",
      col: 1,
      row: 0,
      text: lines(
        "- Semana 1 — definición y planificación",
        "- Semana 2 — primer avance",
        "- Semana 3 — revisión con el equipo",
        "- Semana 4 — entrega final"
      ),
    },
    {
      kind: "note",
      title: "Entregables",
      tag: "ENTREGABLES",
      col: 2,
      row: 0,
      text: lines("- [ ] Entregable 1 · Fecha: ___", "- [ ] Entregable 2 · Fecha: ___", "- [ ] Entregable 3 · Fecha: ___", "- [ ] Presentación final · Fecha: ___"),
    },
    {
      kind: "note",
      title: "Responsables",
      tag: "ROLES",
      col: 0,
      row: 1,
      text: lines("- [ ] Líder del proyecto · Asignar a: ___", "- [ ] Responsable de investigación · Asignar a: ___", "- [ ] Responsable de entrega · Asignar a: ___"),
    },
    {
      kind: "note",
      title: "Riesgos",
      tag: "RIESGOS",
      col: 1,
      row: 1,
      text: lines("- [ ] Riesgo 1 → qué haremos si pasa: ___", "- [ ] Riesgo 2 → qué haremos si pasa: ___", "- [ ] Riesgo 3 → qué haremos si pasa: ___"),
    },
  ],
  links: [
    { from: 0, to: 1, label: "Plan" },
    { from: 1, to: 2, label: "Produce" },
    { from: 0, to: 3, label: "Equipo" },
    { from: 1, to: 4, label: "Prevé" },
  ],
};

export const BUILTIN_TEMPLATES: LocalTemplate[] = [
  { id: "builtin-fair", name: FAIR.name, description: "Resumen, cronograma, presupuesto, logística y roles.", blueprint: FAIR },
  { id: "builtin-meeting", name: MEETING.name, description: "Objetivo, agenda, acuerdos y roles de la sesión.", blueprint: MEETING },
  { id: "builtin-project", name: PROJECT.name, description: "Alcance, hitos, entregables, responsables y riesgos.", blueprint: PROJECT },
];

/**
 * Plantilla base sin IA para cuando falla la red o se acaba la cuota: la de
 * evento, con la frase de la persona como objetivo.
 */
export function baseBlueprintFor(phrase: string): BoardBlueprint {
  const goal = phrase.replace(/\s+/g, " ").trim().slice(0, 220);
  if (!goal) return FAIR;
  return {
    ...FAIR,
    name: goal.slice(0, 80),
    cards: FAIR.cards.map((card, index) =>
      index === 0 && card.kind === "note"
        ? {
            ...card,
            text: lines(`# ${goal.slice(0, 80)}`, "- Fecha tentativa: por definir", "- Asistentes estimados: por definir", `- Objetivo: ${goal}`),
          }
        : card
    ),
  };
}

// ----------------------------------------------------------------------------
// Plantillas propias del equipo (localStorage)
// ----------------------------------------------------------------------------

export const CUSTOM_TEMPLATES_KEY = "andros_custom_templates";
/**
 * Tope TÉCNICO del almacenamiento local (no del plan): protege el espacio de
 * localStorage. El tope del plan (1 en Plan Básico, ilimitadas en Pro) se
 * aplica antes de guardar con `canSaveCustomTemplate` / `guardTemplateSave`.
 */
export const MAX_CUSTOM_TEMPLATES = 500;

/** ¿Guardar con este nombre reemplaza una plantilla propia existente? */
export function replacesCustomTemplate(name: string, current: LocalTemplate[] = loadCustomTemplates()): boolean {
  const key = name.trim().slice(0, 80).toLowerCase();
  return Boolean(key) && current.some((t) => t.name.toLowerCase() === key);
}

export function loadCustomTemplates(): LocalTemplate[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: LocalTemplate[] = [];
    for (const entry of parsed.slice(0, MAX_CUSTOM_TEMPLATES)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const blueprint = sanitizeStoredBlueprint(e.blueprint);
      if (!blueprint || typeof e.id !== "string") continue;
      out.push({
        id: e.id,
        name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 80) : blueprint.name,
        description: `${blueprint.cards.length} tarjeta${blueprint.cards.length === 1 ? "" : "s"} guardada${blueprint.cards.length === 1 ? "" : "s"}`,
        blueprint,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Guarda una plantilla propia. Devuelve `false` si el navegador no deja escribir. */
export function saveCustomTemplate(name: string, blueprint: BoardBlueprint): boolean {
  try {
    const current = loadCustomTemplates();
    const entry = {
      id: `custom-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 80) || blueprint.name,
      blueprint: { ...blueprint, name: name.trim().slice(0, 80) || blueprint.name },
    };
    // Si ya existe una con el mismo nombre se reemplaza (no se acumulan copias).
    const rest = current.filter((t) => t.name.toLowerCase() !== entry.name.toLowerCase());
    const next = [entry, ...rest.map((t) => ({ id: t.id, name: t.name, blueprint: t.blueprint }))].slice(0, MAX_CUSTOM_TEMPLATES);
    window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function deleteCustomTemplate(id: string): void {
  try {
    const next = loadCustomTemplates()
      .filter((t) => t.id !== id)
      .map((t) => ({ id: t.id, name: t.name, blueprint: t.blueprint }));
    window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento: no hay nada que borrar.
  }
}
