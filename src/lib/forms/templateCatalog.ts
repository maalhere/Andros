// ============================================================================
// ANDROS — CATÁLOGO DE PLANTILLAS DE LA LIBRERÍA DE FICHAS (Sprint 23)
//
// 24 plantillas listas para usar, en 6 categorías de 4. Módulo PURO (sin
// store ni red): lo importan la Librería de fichas, el auto-llenado IA y
// `npm run verify:cde`.
//
//   · Son de SOLO LECTURA y no se guardan en la librería personal: no cuentan
//     para ningún límite de plan, no ocupan la nube del perfil y nunca pisan
//     los formatos propios del usuario.
//   · «Usar en el espacio» crea una ficha con estructura de seguimiento
//     prellenada (guías, listas numeradas y estado inicial) y el área
//     sugerida (`@Diseño`, `@Obra`…). No se inventan datos: solo andamiaje.
//   · «Copiar a mis formatos» crea una copia editable con un id nuevo.
//
// Regla de marcas: ninguna plantilla nombra apps ni marcas de terceros
// (`verify:cde` y `verify:brand` lo comprueban).
// ============================================================================

import type { FormFieldType, FormFieldValue, FormSheetPayload } from "@/types/workspace";
import type { FormFieldDef, FormTemplate } from "@/types/forms";
import { normalizeAreaName } from "@/lib/cde/areas";
import { FORM_MAX_FIELDS, instantiateTemplate, newFormId, toFieldKey, uniqueFieldKeys } from "./formSchema";

// ----------------------------------------------------------------------------
// Categorías
// ----------------------------------------------------------------------------

export type CatalogCategoryId = "planificacion" | "diseno" | "obra" | "negocios" | "marketing" | "estudio";

export interface CatalogCategory {
  id: CatalogCategoryId;
  /** Nombre completo (también es la `category` de la ficha, ≤ 40 caracteres). */
  label: string;
  /** Etiqueta corta para los filtros rápidos. */
  short: string;
}

export const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  { id: "planificacion", label: "Planificación y equipos", short: "Planificación" },
  { id: "diseno", label: "Diseño y producto", short: "Diseño" },
  { id: "obra", label: "Ingeniería, arquitectura y obra", short: "Obra" },
  { id: "negocios", label: "Negocios, ventas y operaciones", short: "Negocios" },
  { id: "marketing", label: "Marketing, contenido y eventos", short: "Marketing" },
  { id: "estudio", label: "Universidad, estudio y personal", short: "Estudio" },
];

const CATEGORY_LABEL: Record<CatalogCategoryId, string> = Object.fromEntries(
  CATALOG_CATEGORIES.map((c) => [c.id, c.label])
) as Record<CatalogCategoryId, string>;

// ----------------------------------------------------------------------------
// Contrato
// ----------------------------------------------------------------------------

export interface CatalogTemplate extends FormTemplate {
  catalogCategory: CatalogCategoryId;
  /** Área sugerida de la ficha (se muestra como `@Área`). */
  area: string;
  /** Valores iniciales por `fieldKey`: guías de seguimiento, nunca datos inventados. */
  prefill: Record<string, FormFieldValue>;
}

/** Prefijo de id: distingue las plantillas del catálogo de los formatos propios. */
export const CATALOG_ID_PREFIX = "cat-";

type Seed = [
  label: string,
  type: FormFieldType,
  extra?: { unit?: string; options?: string[]; value?: FormFieldValue },
];

interface Spec {
  slug: string;
  category: CatalogCategoryId;
  title: string;
  description: string;
  area: string;
  fields: Seed[];
}

function build(spec: Spec): CatalogTemplate {
  const id = `${CATALOG_ID_PREFIX}${spec.slug}`;
  const prefill: Record<string, FormFieldValue> = {};
  const fields: FormFieldDef[] = uniqueFieldKeys(
    spec.fields.map(([label, type, extra], i) => ({
      id: `${id}-f${i + 1}`,
      fieldKey: toFieldKey(label),
      label,
      type,
      ...(extra?.unit ? { unit: extra.unit } : {}),
      ...(extra?.options ? { options: extra.options } : {}),
    }))
  );
  spec.fields.forEach(([, , extra], i) => {
    if (extra?.value !== undefined) prefill[fields[i].fieldKey] = extra.value;
  });
  return {
    id,
    title: spec.title,
    category: CATEGORY_LABEL[spec.category],
    catalogCategory: spec.category,
    description: spec.description,
    area: spec.area,
    builtIn: true,
    updatedAt: 0,
    fields,
    prefill,
  };
}

// Opciones repetidas
const SEMAFORO = ["Rojo · Pendiente", "Verde · Resuelto"];
const NIVEL = ["Baja", "Media", "Alta"];
const DISCIPLINAS = ["Arquitectura", "Estructura", "Eléctrica", "Hidrosanitaria", "Mecánica"];
const LINEAS = "1. \n2. \n3. ";
const VINETAS = "• \n• \n• ";

// ----------------------------------------------------------------------------
// Las 24 plantillas
// ----------------------------------------------------------------------------

const SPECS: Spec[] = [
  // ---- 1 · Planificación y equipos -----------------------------------------
  {
    slug: "kickoff",
    category: "planificacion",
    title: "Arranque de proyecto (Kickoff)",
    description: "Objetivo, alcance, responsables por área e hitos para que todo el equipo arranque con el mismo mapa.",
    area: "Coordinación",
    fields: [
      ["Proyecto", "text"],
      ["Fecha de arranque", "date"],
      ["Líder del proyecto", "text"],
      ["Objetivo principal", "textarea", { value: "Qué queremos lograr y para cuándo:\n" }],
      ["Alcance acordado", "textarea", { value: "Incluye:\n• \n\nNo incluye:\n• " }],
      ["Responsables por área", "textarea", { value: "@Diseño → \n@Obra → \n@Finanzas → " }],
      ["Hitos principales", "textarea", { value: "Hito · Fecha\n1. \n2. \n3. " }],
      ["Presupuesto estimado", "number", { unit: "USD" }],
      ["Riesgos iniciales", "textarea", { value: VINETAS }],
      ["Canal principal del equipo", "select", { options: ["Chat del espacio", "Reunión semanal", "Correo"], value: "Chat del espacio" }],
      ["Todos conocen su rol", "checkbox"],
    ],
  },
  {
    slug: "reunion-semanal",
    category: "planificacion",
    title: "Reunión semanal y acuerdos",
    description: "Avances, temas, acuerdos con responsable y fecha, y bloqueos. El acta queda en el tablero, no en la memoria de nadie.",
    area: "Coordinación",
    fields: [
      ["Fecha de la reunión", "date"],
      ["Asistentes", "textarea", { value: VINETAS }],
      ["Avances desde la última reunión", "textarea", { value: VINETAS }],
      ["Temas tratados", "textarea", { value: LINEAS }],
      ["Acuerdos", "textarea", { value: "Acuerdo · Responsable · Fecha\n• \n• " }],
      ["Bloqueos", "textarea"],
      ["Próxima reunión", "date"],
      ["Estado del acta", "select", { options: ["Borrador", "Compartida con el equipo", "Aprobada"], value: "Borrador" }],
    ],
  },
  {
    slug: "entregables-por-area",
    category: "planificacion",
    title: "Control de entregables por área",
    description: "Qué se entrega, quién lo entrega, cuándo y con qué avance. Ideal para ver de un vistazo qué área va atrasada.",
    area: "Coordinación",
    fields: [
      ["Entregable", "text"],
      ["Área responsable", "select", { options: ["Diseño", "Obra", "Finanzas", "Coordinación", "Compras"] }],
      ["Persona responsable", "text"],
      ["Fecha de entrega", "date"],
      ["Avance", "number", { unit: "%" }],
      ["Estado", "select", { options: ["Sin empezar", "En curso", "Rojo · En riesgo", "Verde · Entregado"], value: "Sin empezar" }],
      ["Aprobado por el cliente", "checkbox"],
      ["Comentarios", "textarea"],
      ["Evidencia", "photo"],
    ],
  },
  {
    slug: "riesgos-incidencias",
    category: "planificacion",
    title: "Bitácora de riesgos e incidencias (Rojo/Verde)",
    description: "Cada riesgo con probabilidad, impacto, plan y responsable. Queda en Rojo hasta que alguien lo cierra en Verde.",
    area: "Coordinación",
    fields: [
      ["Código", "text", { value: "R-001" }],
      ["Descripción", "textarea"],
      ["Fecha detectada", "date"],
      ["Área afectada", "select", { options: ["Diseño", "Obra", "Finanzas", "Compras", "Coordinación"] }],
      ["Probabilidad", "select", { options: NIVEL, value: "Media" }],
      ["Impacto", "select", { options: NIVEL, value: "Media" }],
      ["Plan de mitigación", "textarea", { value: "Acción · Responsable · Fecha límite\n• " }],
      ["Responsable", "text"],
      ["Estado", "select", { options: SEMAFORO, value: "Rojo · Pendiente" }],
      ["Fecha de cierre", "date"],
      ["Evidencia", "photo"],
    ],
  },

  // ---- 2 · Diseño y producto -----------------------------------------------
  {
    slug: "brief-creativo",
    category: "diseno",
    title: "Brief creativo y alcance",
    description: "El problema, para quién es, el mensaje y lo que se va a entregar. Una página para que diseño y cliente hablen de lo mismo.",
    area: "Diseño",
    fields: [
      ["Cliente o proyecto", "text"],
      ["Problema a resolver", "textarea"],
      ["Público objetivo", "textarea"],
      ["Mensaje clave", "text"],
      ["Entregables esperados", "textarea", { value: VINETAS }],
      ["Restricciones", "textarea", { value: "Marca: \nMedidas o formatos: \nNormas: " }],
      ["Presupuesto", "number", { unit: "USD" }],
      ["Fecha de presentación", "date"],
      ["Criterios de aprobación", "textarea", { value: LINEAS }],
      ["Referencias visuales", "photo"],
    ],
  },
  {
    slug: "revision-diseno",
    category: "diseno",
    title: "Revisión de diseño y feedback visual",
    description: "Qué funciona, qué cambia y con qué prioridad, con la captura marcada. Cierra cada ronda con una decisión clara.",
    area: "Diseño",
    fields: [
      ["Pieza revisada", "text"],
      ["Versión", "text", { value: "v1" }],
      ["Fecha de revisión", "date"],
      ["Revisado por", "text"],
      ["Lo que funciona", "textarea", { value: VINETAS }],
      ["Cambios solicitados", "textarea", { value: LINEAS }],
      ["Prioridad", "select", { options: NIVEL, value: "Media" }],
      ["Decisión", "select", { options: ["Aprobado", "Aprobado con cambios", "Rehacer"] }],
      ["Próxima revisión", "date"],
      ["Captura con anotaciones", "photo"],
    ],
  },
  {
    slug: "roadmap-lanzamiento",
    category: "diseno",
    title: "Hoja de ruta de lanzamiento (Roadmap)",
    description: "Ahora, siguiente y después: etapas, dependencias y lo que tiene que estar listo antes de lanzar.",
    area: "Producto",
    fields: [
      ["Producto o versión", "text"],
      ["Fecha objetivo de lanzamiento", "date"],
      ["Responsable", "text"],
      ["Etapa actual", "select", { options: ["Descubrimiento", "Diseño", "Desarrollo", "Pruebas", "Lanzamiento"], value: "Descubrimiento" }],
      ["Hitos", "textarea", { value: "Ahora (este mes):\n• \n\nSiguiente:\n• \n\nDespués:\n• " }],
      ["Dependencias", "textarea", { value: VINETAS }],
      ["Listo para lanzar cuando…", "textarea", { value: "☐ \n☐ \n☐ " }],
      ["Métrica de éxito", "text"],
      ["Riesgos", "textarea"],
    ],
  },
  {
    slug: "investigacion-usuarios",
    category: "diseno",
    title: "Investigación con usuarios y hallazgos",
    description: "Método, preguntas guía, hallazgos y citas textuales de cada sesión, sin datos personales innecesarios.",
    area: "Producto",
    fields: [
      ["Estudio", "text"],
      ["Fecha de la sesión", "date"],
      ["Perfil del participante", "text"],
      ["Método", "select", { options: ["Entrevista", "Prueba de uso", "Encuesta", "Observación en campo"], value: "Entrevista" }],
      ["Preguntas guía", "textarea", { value: LINEAS }],
      ["Hallazgos principales", "textarea", { value: VINETAS }],
      ["Citas textuales", "textarea"],
      ["Nivel de dolor", "select", { options: NIVEL }],
      ["Oportunidades", "textarea"],
      ["Foto o captura", "photo"],
    ],
  },

  // ---- 3 · Ingeniería, arquitectura y obra ---------------------------------
  {
    slug: "revision-planos",
    category: "obra",
    title: "Revisión de planos y observaciones",
    description: "Lámina, disciplina y revisión, con cada observación ubicada por eje. Rojo hasta que se corrige en el plano.",
    area: "Ingeniería",
    fields: [
      ["Proyecto", "text"],
      ["Lámina", "text", { value: "A-101" }],
      ["Disciplina", "select", { options: DISCIPLINAS, value: "Arquitectura" }],
      ["Revisión", "text", { value: "Rev. A" }],
      ["Fecha de revisión", "date"],
      ["Revisor", "text"],
      ["Observaciones", "textarea", { value: "N.º · Eje o ubicación · Observación\n1. \n2. \n3. " }],
      ["Gravedad", "select", { options: ["Menor", "Mayor", "Crítica"], value: "Menor" }],
      ["Estado", "select", { options: ["Rojo · Pendiente", "Verde · Corregido"], value: "Rojo · Pendiente" }],
      ["Plano marcado", "photo"],
    ],
  },
  {
    slug: "rfi",
    category: "obra",
    title: "Solicitud de información técnica (RFI)",
    description: "Pregunta, referencia, propuesta e impacto en costo y plazo. Cada RFI con número, fecha límite y respuesta trazable.",
    area: "Obra",
    fields: [
      ["Número de RFI", "text", { value: "RFI-001" }],
      ["Fecha de emisión", "date"],
      ["Solicitado por", "text"],
      ["Dirigido a", "text", { value: "@" }],
      ["Referencia", "textarea", { value: "Plano: \nEspecificación: " }],
      ["Pregunta", "textarea"],
      ["Propuesta de solución", "textarea"],
      ["Impacta el costo", "checkbox"],
      ["Impacto en plazo", "number", { unit: "días" }],
      ["Fecha límite de respuesta", "date"],
      ["Respuesta", "textarea"],
      ["Estado", "select", { options: ["Rojo · Abierta", "Verde · Respondida"], value: "Rojo · Abierta" }],
    ],
  },
  {
    slug: "inspeccion-campo",
    category: "obra",
    title: "Lista de verificación en campo / inspección",
    description: "Recorrido de obra con casillas de seguridad, orden y conformidad, hallazgos, acciones y fotos de evidencia.",
    area: "Obra",
    fields: [
      ["Obra o ubicación", "text"],
      ["Fecha de inspección", "date"],
      ["Inspector", "text"],
      ["Frente o actividad", "text"],
      ["Clima", "select", { options: ["Soleado", "Nublado", "Lluvia"] }],
      ["Equipo de protección completo", "checkbox"],
      ["Zona señalizada", "checkbox"],
      ["Materiales ordenados y protegidos", "checkbox"],
      ["Trabajo conforme a plano", "checkbox"],
      ["Hallazgos", "textarea", { value: LINEAS }],
      ["Acciones correctivas", "textarea", { value: "Acción · Responsable · Fecha\n• " }],
      ["Resultado", "select", { options: ["Conforme", "Conforme con observaciones", "No conforme"] }],
      ["Fotos de evidencia", "photo"],
    ],
  },
  {
    slug: "presupuesto-materiales",
    category: "obra",
    title: "Control de presupuesto y materiales",
    description: "Cantidades presupuestadas contra usadas, precio unitario y gasto real por partida, con la desviación explicada.",
    area: "Finanzas",
    fields: [
      ["Partida o material", "text"],
      ["Unidad de medida", "text", { value: "m³" }],
      ["Cantidad presupuestada", "number"],
      ["Cantidad usada", "number"],
      ["Precio unitario", "number", { unit: "USD" }],
      ["Presupuesto de la partida", "number", { unit: "USD" }],
      ["Gasto real", "number", { unit: "USD" }],
      ["Proveedor", "text"],
      ["Fecha de compra", "date"],
      ["Desviación explicada", "textarea"],
      ["Estado", "select", { options: ["Dentro del presupuesto", "Rojo · Excedido", "Verde · Cerrado"], value: "Dentro del presupuesto" }],
      ["Factura o comprobante", "photo"],
    ],
  },

  // ---- 4 · Negocios, ventas y operaciones ----------------------------------
  {
    slug: "propuesta-comercial",
    category: "negocios",
    title: "Propuesta comercial para cliente",
    description: "Necesidad del cliente, solución, entregables, inversión y forma de pago. Lista para revisarla en equipo antes de enviarla.",
    area: "Ventas",
    fields: [
      ["Cliente", "text"],
      ["Persona de contacto", "text"],
      ["Fecha", "date"],
      ["Necesidad del cliente", "textarea"],
      ["Solución propuesta", "textarea"],
      ["Entregables incluidos", "textarea", { value: VINETAS }],
      ["Inversión", "number", { unit: "USD" }],
      ["Forma de pago", "select", { options: ["Contado", "50 % anticipo y 50 % contra entrega", "Pagos mensuales"] }],
      ["Vigencia de la oferta", "number", { unit: "días" }],
      ["Próximo paso", "text"],
      ["Estado", "select", { options: ["Borrador", "Enviada", "En negociación", "Aceptada", "No aceptada"], value: "Borrador" }],
    ],
  },
  {
    slug: "proveedores-compras",
    category: "negocios",
    title: "Seguimiento de proveedores y compras",
    description: "Cada orden con proveedor, monto, fecha prometida y estado. Se nota enseguida qué pedido viene con problema.",
    area: "Compras",
    fields: [
      ["Proveedor", "text"],
      ["Producto o servicio", "text"],
      ["Orden de compra", "text", { value: "OC-001" }],
      ["Fecha del pedido", "date"],
      ["Fecha de entrega prometida", "date"],
      ["Monto", "number", { unit: "USD" }],
      ["Estado", "select", { options: ["Cotizando", "Pedido", "En camino", "Recibido", "Rojo · Con problema"], value: "Cotizando" }],
      ["Recibido completo", "checkbox"],
      ["Calificación del proveedor", "select", { options: ["Excelente", "Buena", "Regular", "Mala"] }],
      ["Notas", "textarea"],
      ["Factura o comprobante", "photo"],
    ],
  },
  {
    slug: "plan-operativo-pyme",
    category: "negocios",
    title: "Plan operativo mensual de PyME",
    description: "Meta del mes, prioridades, responsables por área e indicadores para revisar al cierre. Simple y sin hojas sueltas.",
    area: "Operaciones",
    fields: [
      ["Mes", "text"],
      ["Meta principal del mes", "text"],
      ["Meta de ventas", "number", { unit: "USD" }],
      ["Prioridades", "textarea", { value: LINEAS }],
      ["Responsables por área", "textarea", { value: "@Ventas → \n@Operaciones → \n@Finanzas → " }],
      ["Gastos fijos estimados", "number", { unit: "USD" }],
      ["Indicadores a revisar", "textarea", { value: "• Ventas del mes\n• Clientes nuevos\n• Gastos" }],
      ["Fecha de revisión", "date"],
      ["Resultado del mes", "textarea"],
    ],
  },
  {
    slug: "onboarding",
    category: "negocios",
    title: "Incorporación de nuevo integrante (Onboarding)",
    description: "Persona guía, accesos, plan de la primera semana y objetivos a 30 días para que nadie llegue a adivinar.",
    area: "Personas",
    fields: [
      ["Nombre de la persona", "text"],
      ["Puesto", "text"],
      ["Área", "text", { value: "@" }],
      ["Fecha de ingreso", "date"],
      ["Persona guía", "text"],
      ["Accesos entregados", "checkbox"],
      ["Equipo de trabajo entregado", "checkbox"],
      ["Plan de la primera semana", "textarea", { value: "Día 1: \nDía 2: \nDía 3: \nDía 4: \nDía 5: " }],
      ["Objetivos a 30 días", "textarea", { value: LINEAS }],
      ["Reunión de seguimiento", "date"],
      ["Comentarios", "textarea"],
    ],
  },

  // ---- 5 · Marketing, contenido y eventos ----------------------------------
  {
    slug: "evento-feria",
    category: "marketing",
    title: "Planificación de evento o feria",
    description: "Fecha, lugar, presupuesto, cronograma del día, responsables por área, materiales y plan B.",
    area: "Eventos",
    fields: [
      ["Nombre del evento", "text"],
      ["Fecha", "date"],
      ["Lugar", "text"],
      ["Asistentes esperados", "number", { unit: "personas" }],
      ["Presupuesto", "number", { unit: "USD" }],
      ["Objetivo del evento", "text"],
      ["Cronograma del día", "textarea", { value: "08:00 · Montaje\n10:00 · \n12:00 · \n16:00 · Desmontaje" }],
      ["Responsables por área", "textarea", { value: "@Logística → \n@Marketing → \n@Finanzas → " }],
      ["Materiales", "textarea", { value: VINETAS }],
      ["Proveedores confirmados", "checkbox"],
      ["Plan B", "textarea", { value: "Si llueve: \nSi alguien se retrasa: " }],
      ["Estado", "select", { options: ["Planificando", "Confirmado", "Rojo · En riesgo", "Verde · Listo"], value: "Planificando" }],
    ],
  },
  {
    slug: "calendario-editorial",
    category: "marketing",
    title: "Calendario editorial y campañas",
    description: "Campaña, objetivo, canales y cada pieza con fecha y responsable, para publicar con calma y no a última hora.",
    area: "Contenido",
    fields: [
      ["Campaña", "text"],
      ["Periodo", "text"],
      ["Objetivo", "text"],
      ["Público", "text"],
      ["Canales", "textarea", { value: "• Sitio web\n• Correo a clientes\n• Redes sociales" }],
      ["Piezas planificadas", "textarea", { value: "Fecha · Formato · Tema · Responsable\n• \n• " }],
      ["Mensaje principal", "textarea"],
      ["Presupuesto de difusión", "number", { unit: "USD" }],
      ["Estado", "select", { options: ["Idea", "En producción", "Programado", "Publicado"], value: "Idea" }],
      ["Resultados", "textarea"],
    ],
  },
  {
    slug: "produccion-audiovisual",
    category: "marketing",
    title: "Producción audiovisual / pieza creativa",
    description: "Formato, equipo, escaleta, lista de tomas y permisos, de la preproducción a la entrega final.",
    area: "Contenido",
    fields: [
      ["Pieza", "text"],
      ["Formato", "select", { options: ["Video", "Fotografía", "Animación", "Audio", "Gráfico"] }],
      ["Duración o medida", "text"],
      ["Fecha de grabación", "date"],
      ["Locación", "text"],
      ["Equipo de producción", "textarea", { value: "Dirección: \nCámara: \nSonido: \nEdición: " }],
      ["Guion o escaleta", "textarea", { value: "Apertura: \nEscena 1: \nEscena 2: \nCierre: " }],
      ["Lista de tomas", "textarea", { value: LINEAS }],
      ["Permisos de imagen firmados", "checkbox"],
      ["Fecha de entrega final", "date"],
      ["Estado", "select", { options: ["Preproducción", "Rodaje", "Edición", "Revisión", "Entregado"], value: "Preproducción" }],
      ["Referencias", "photo"],
    ],
  },
  {
    slug: "post-evento",
    category: "marketing",
    title: "Resumen post-evento y aprendizajes",
    description: "Lo que salió bien, lo que mejoraríamos, incidencias y pendientes de cierre, mientras todo está fresco.",
    area: "Eventos",
    fields: [
      ["Evento", "text"],
      ["Fecha", "date"],
      ["Asistentes reales", "number", { unit: "personas" }],
      ["Presupuesto ejecutado", "number", { unit: "USD" }],
      ["Lo que salió bien", "textarea", { value: VINETAS }],
      ["Lo que mejoraríamos", "textarea", { value: VINETAS }],
      ["Incidencias del día", "textarea"],
      ["Aprendizajes para el próximo", "textarea", { value: LINEAS }],
      ["Pendientes de cierre", "textarea", { value: "Pendiente · Responsable · Fecha\n• " }],
      ["Satisfacción general", "select", { options: ["Muy buena", "Buena", "Regular", "Mala"] }],
      ["Fotos del evento", "photo"],
    ],
  },

  // ---- 6 · Universidad, estudio y personal ---------------------------------
  {
    slug: "tesis-equipo",
    category: "estudio",
    title: "Proyecto final o tesis en equipo",
    description: "Pregunta, objetivos, capítulos con responsable y las observaciones del asesor en un solo lugar.",
    area: "Investigación",
    fields: [
      ["Título del proyecto", "text"],
      ["Asesor o asesora", "text"],
      ["Integrantes y roles", "textarea", { value: "• Nombre — rol\n• \n• " }],
      ["Pregunta de investigación", "textarea"],
      ["Objetivos", "textarea", { value: "General:\n\nEspecíficos:\n1. \n2. " }],
      [
        "Capítulos y responsables",
        "textarea",
        { value: "1. Introducción — \n2. Marco teórico — \n3. Metodología — \n4. Resultados — \n5. Conclusiones — " },
      ],
      ["Próxima entrega", "date"],
      ["Avance general", "number", { unit: "%" }],
      ["Observaciones del asesor", "textarea"],
      ["Estado", "select", { options: ["En curso", "En revisión", "Rojo · Atrasado", "Verde · Aprobado"], value: "En curso" }],
    ],
  },
  {
    slug: "plan-estudio",
    category: "estudio",
    title: "Plan de estudio y entregas del periodo",
    description: "Materias, entregas y exámenes con fecha, horas por semana y la materia que pide más atención.",
    area: "Estudio",
    fields: [
      ["Periodo", "text"],
      ["Materias", "textarea", { value: VINETAS }],
      ["Entregas y exámenes", "textarea", { value: "Fecha · Materia · Entrega\n• \n• " }],
      ["Horas de estudio por semana", "number", { unit: "h" }],
      ["Meta del periodo", "text"],
      ["Materia que necesita más tiempo", "text"],
      ["Próximo examen", "date"],
      ["Promedio objetivo", "number", { unit: "pts" }],
      ["Notas", "textarea"],
    ],
  },
  {
    slug: "investigacion-academica",
    category: "estudio",
    title: "Investigación académica y fuentes",
    description: "Una ficha por fuente: referencia, idea principal, cita con página y si ya la verificaste.",
    area: "Investigación",
    fields: [
      ["Tema", "text"],
      ["Pregunta guía", "text"],
      ["Referencia", "text", { value: "Autor (año). Título. " }],
      ["Tipo de fuente", "select", { options: ["Libro", "Artículo científico", "Tesis", "Informe", "Sitio web", "Entrevista"] }],
      ["Enlace o ubicación", "text"],
      ["Idea principal", "textarea"],
      ["Cita textual y página", "textarea", { value: "«» (p. )" }],
      ["Relevancia", "select", { options: NIVEL }],
      ["Fuente verificada", "checkbox"],
      ["Notas propias", "textarea"],
    ],
  },
  {
    slug: "semana-personal",
    category: "estudio",
    title: "Planificación semanal personal",
    description: "Tres prioridades, un plan por día, compromisos y una revisión corta al final de la semana.",
    area: "Personal",
    fields: [
      ["Semana del", "date"],
      ["Prioridades de la semana", "textarea", { value: LINEAS }],
      [
        "Plan por día",
        "textarea",
        { value: "Lunes: \nMartes: \nMiércoles: \nJueves: \nViernes: \nFin de semana: " },
      ],
      ["Citas y compromisos", "textarea", { value: VINETAS }],
      ["Hábito a cuidar", "text"],
      ["Horas de enfoque", "number", { unit: "h" }],
      ["Energía de la semana", "select", { options: ["Alta", "Media", "Baja"] }],
      ["Revisión de cierre", "textarea", { value: "Qué salió bien:\n\nQué ajusto:\n" }],
      ["Semana cumplida", "checkbox"],
    ],
  },
];

export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = SPECS.map(build);

const BY_ID = new Map(TEMPLATE_CATALOG.map((t) => [t.id, t]));

export function findCatalogTemplate(id: string): CatalogTemplate | undefined {
  return BY_ID.get(id);
}

export function isCatalogTemplateId(id: string): boolean {
  return id.startsWith(CATALOG_ID_PREFIX) && BY_ID.has(id);
}

export function catalogByCategory(category: CatalogCategoryId | "all"): CatalogTemplate[] {
  return category === "all" ? [...TEMPLATE_CATALOG] : TEMPLATE_CATALOG.filter((t) => t.catalogCategory === category);
}

/** Busca por título, descripción, categoría, área o nombre de campo (sin tildes). */
export function searchCatalog(query: string, category: CatalogCategoryId | "all" = "all"): CatalogTemplate[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const pool = catalogByCategory(category);
  if (words.length === 0) return pool;
  return pool.filter((t) => {
    const haystack = fold([t.title, t.description ?? "", t.category, t.area, ...t.fields.map((f) => f.label)].join(" "));
    return words.every((w) => haystack.includes(w));
  });
}

/** Ficha lista para el lienzo: campos vacíos + guías prellenadas + área sugerida. */
export function instantiateCatalogTemplate(template: CatalogTemplate): { title: string; data: FormSheetPayload } {
  const { title, data } = instantiateTemplate(template);
  const area = normalizeAreaName(template.area);
  return {
    title,
    data: {
      ...data,
      fields: data.fields.map((field) => {
        const value = template.prefill[field.fieldKey];
        if (value === undefined) return field;
        if (field.type === "select" && !(field.options ?? []).includes(String(value))) return field;
        return { ...field, value };
      }),
      ...(area ? { area } : {}),
    },
  };
}

/** Copia editable para «Mis formatos» (id nuevo: nunca choca con el catálogo). */
export function copyCatalogTemplate(template: CatalogTemplate): FormTemplate {
  return {
    id: newFormId("tpl"),
    title: template.title,
    category: template.category,
    ...(template.description ? { description: template.description } : {}),
    fields: template.fields.slice(0, FORM_MAX_FIELDS).map((f) => ({ ...f, id: newFormId("def") })),
    updatedAt: Date.now(),
  };
}

/** Lo que incluye la plantilla, para la vista previa («11 campos · 1 foto · 3 con guía»). */
export function catalogSummary(template: CatalogTemplate): { fields: number; photos: number; guided: number } {
  return {
    fields: template.fields.length,
    photos: template.fields.filter((f) => f.type === "photo").length,
    guided: Object.keys(template.prefill).length,
  };
}
