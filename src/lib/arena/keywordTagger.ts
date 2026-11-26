// ============================================================================
// ANDROS ARENA — ETIQUETADOR DETERMINISTA + FILTRO DE SEGURIDAD (sin IA)
//
// Respaldo de `/api/arena/analyze-post` cuando Gemini no responde, y también
// normalizador de lo que devuelve Gemini (solo deja valores del catálogo).
// Funciones puras: corren igual en el servidor y en el navegador.
// ============================================================================

import {
  ARENA_DISCIPLINES,
  ARENA_LEVELS,
  type ArenaAnalyzeResponse,
  type ArenaDiscipline,
  type ArenaLevel,
  type ArenaModeration,
  type ArenaPostDraft,
  type ArenaPostType,
  type ArenaTags,
} from "@/types/arena";

export function normalizeText(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#.&\s/-]/g, " ")
    .replace(/\s+/g, " ")} `;
}

/** Coincidencia por palabra: " ia " no coincide dentro de "materia". */
function has(text: string, pattern: string): boolean {
  if (pattern.startsWith("~")) return text.includes(pattern.slice(1)); // raíz libre
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s/(-])${escaped}(?=$|[\\s/).,;:-])`).test(text);
}

const DISCIPLINE_PATTERNS: Record<ArenaDiscipline, string[]> = {
  "Mecánica": ["~mecanic", "~mechanical", "solidworks", "fea", "elementos finitos", "finite element", "soporte", "bracket", "~termic", "thermal", "maquina", "~transmision", "engranaje", "gear"],
  Software: ["software", "next.js", "nextjs", "react", "typescript", "javascript", "python", "web", "api", "backend", "frontend", "full stack", "fullstack", "app", "programacion", "programming", "developer", "desarrollador"],
  Civil: ["civil", "~estructur", "structural", "concreto", "concrete", "acero estructural", "puente", "bridge", "sap2000", "etabs", "revit", "cimentacion", "viga", "beam"],
  "Eléctrica": ["~electric", "~electron", "pcb", "circuito", "circuit", "arduino", "embedded", "~embebid", "plc", "potencia", "motor electrico"],
  Aeroespacial: ["~aero", "dron", "drones", "drone", "uav", "avion", "aircraft", "cfd", "satelite", "cohete", "rocket"],
  "Impresión 3D": ["impresion 3d", "3d printing", "3d printed", "3d print", "~imprim", "~impreso en 3d", "fdm", "sla", "pla", "petg", "slicer", "manufactura aditiva", "additive manufacturing", "additive"],
  IA: ["ia", "ai", "inteligencia artificial", "machine learning", "ml", "aprendizaje automatico", "deep learning", "llm", "vision artificial", "computer vision", "redes neuronales", "neural network"],
  "Química": ["~quimic", "chemical", "proceso quimico", "polimero", "polymer", "reactor"],
  Industrial: ["industrial", "lean", "six sigma", "produccion", "~logistic", "control de calidad", "quality control", "cadena de suministro", "supply chain"],
  "Biomédica": ["~biomed", "protesis", "prosthe", "medical device", "dispositivo medico", "ortesis"],
};

const LEVEL_PATTERNS: Record<ArenaLevel, string[]> = {
  Estudiante: ["estudiante", "estudiantes", "student", "students", "~universitari", "semestre", "escuela", "alumno", "alumnos", "tesis", "curso"],
  "Prácticas": ["practicas", "practicante", "pasantia", "pasante", "internship", "intern", "becario", "trainee", "residencia profesional"],
  Junior: ["junior", "jr", "jr.", "recien egresado", "egresado", "entry level", "entry-level", "0-2 anos", "1-2 anos", "graduate"],
  Senior: ["senior", "sr", "sr.", "5+ anos", "5 anos", "lider tecnico", "tech lead", "lead", "principal"],
};

/** Habilidad canónica → patrones. */
const SKILL_PATTERNS: Record<string, string[]> = {
  CAD: ["cad", "modelado 3d", "3d modeling", "onshape", "catia", "inventor"],
  SolidWorks: ["solidworks"],
  "Fusion 360": ["fusion 360", "fusion360"],
  AutoCAD: ["autocad"],
  FEA: ["fea", "elementos finitos", "finite element", "analisis estructural"],
  ANSYS: ["ansys"],
  CFD: ["cfd", "dinamica de fluidos computacional"],
  "Simulación térmica": ["simulacion termica", "thermal simulation", "transferencia de calor", "heat transfer", "~termic"],
  MATLAB: ["matlab", "simulink"],
  Python: ["python"],
  "Next.js": ["next.js", "nextjs"],
  React: ["react"],
  TypeScript: ["typescript"],
  "C++": ["c++"],
  Arduino: ["arduino"],
  PCB: ["pcb", "kicad", "altium"],
  FDM: ["fdm", "slicer", "cura", "prusaslicer", "impresion 3d", "3d printing", "3d printed"],
  "GD&T": ["gd&t", "tolerancias geometricas", "tolerancing"],
  Revit: ["revit"],
  SAP2000: ["sap2000"],
  ETABS: ["etabs"],
  "Machine Learning": ["machine learning", "aprendizaje automatico", "deep learning", "redes neuronales"],
  LaTeX: ["latex"],
  "Hoja de cálculo": ["hoja de calculo", "hojas de calculo", "spreadsheet", "excel"],
  SQL: ["sql", "postgres", "postgresql"],
  ROS: ["ros", "ros2"],
  PLC: ["plc"],
  "Topología": ["optimizacion topologica", "topology optimization"],
};

/** Nombres en inglés que Gemini a veces devuelve → catálogo en español. */
const DISCIPLINE_ALIASES: Record<string, ArenaDiscipline> = {
  mechanical: "Mecánica",
  mecanica: "Mecánica",
  software: "Software",
  civil: "Civil",
  electrical: "Eléctrica",
  electrica: "Eléctrica",
  electronics: "Eléctrica",
  aerospace: "Aeroespacial",
  aeroespacial: "Aeroespacial",
  "3d printing": "Impresión 3D",
  "impresion 3d": "Impresión 3D",
  "additive manufacturing": "Impresión 3D",
  ai: "IA",
  ia: "IA",
  "artificial intelligence": "IA",
  chemical: "Química",
  quimica: "Química",
  industrial: "Industrial",
  biomedical: "Biomédica",
  biomedica: "Biomédica",
};

const LEVEL_ALIASES: Record<string, ArenaLevel> = {
  student: "Estudiante",
  estudiante: "Estudiante",
  internship: "Prácticas",
  intern: "Prácticas",
  practicas: "Prácticas",
  junior: "Junior",
  senior: "Senior",
};

const DEFAULT_LEVEL: Record<ArenaPostType, ArenaLevel> = {
  internship: "Prácticas",
  activity: "Estudiante",
  challenge: "Estudiante",
  job: "Junior",
};

// ----------------------------------------------------------------------------
// Etiquetas
// ----------------------------------------------------------------------------

export function keywordTags(draft: ArenaPostDraft): ArenaTags {
  const text = normalizeText(`${draft.title} ${draft.title} ${draft.description}`);
  const discipline = ARENA_DISCIPLINES.filter((d) => DISCIPLINE_PATTERNS[d].some((p) => has(text, p)));
  const level = ARENA_LEVELS.filter((l) => LEVEL_PATTERNS[l].some((p) => has(text, p)));
  const skills = Object.entries(SKILL_PATTERNS)
    .filter(([, patterns]) => patterns.some((p) => has(text, p)))
    .map(([skill]) => skill);
  if (draft.type === "internship" && !level.includes("Prácticas")) level.unshift("Prácticas");
  return {
    type: draft.type,
    discipline: discipline.slice(0, 3),
    level: level.length > 0 ? level.slice(0, 2) : [DEFAULT_LEVEL[draft.type]],
    skills: skills.slice(0, 8),
  };
}

const deaccent = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/**
 * Limpia las etiquetas de la IA: solo valores del catálogo, sin duplicados.
 * Las habilidades se canonicalizan si coinciden con el diccionario.
 */
export function sanitizeTags(raw: unknown, draft: ArenaPostDraft): ArenaTags {
  const fallback = keywordTags(draft);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  const discipline = [
    ...new Set(
      list(r.discipline)
        .map((d) => {
          const key = deaccent(d);
          return ARENA_DISCIPLINES.find((x) => deaccent(x) === key) ?? DISCIPLINE_ALIASES[key];
        })
        .filter((d): d is ArenaDiscipline => Boolean(d))
    ),
  ].slice(0, 3);

  const level = [
    ...new Set(
      list(r.level)
        .map((l) => {
          const key = deaccent(l);
          return ARENA_LEVELS.find((x) => deaccent(x) === key) ?? LEVEL_ALIASES[key];
        })
        .filter((l): l is ArenaLevel => Boolean(l))
    ),
  ].slice(0, 2);

  const canonical = Object.keys(SKILL_PATTERNS);
  const skills = [
    ...new Set(
      list(r.skills)
        .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 28))
        .filter((s) => s.length >= 1)
        .map((s) => canonical.find((c) => deaccent(c) === deaccent(s)) ?? s)
    ),
  ].slice(0, 8);

  return {
    type: draft.type,
    discipline: discipline.length > 0 ? discipline : fallback.discipline,
    level: level.length > 0 ? level : fallback.level,
    skills: skills.length > 0 ? skills : fallback.skills,
  };
}

// ----------------------------------------------------------------------------
// Filtro de seguridad y calidad
// ----------------------------------------------------------------------------

/** Señales de fraude: bloquean la publicación. */
const SCAM_PATTERNS = [
  "gana dinero rapido",
  "dinero facil",
  "earn money fast",
  "make money fast",
  "inversion garantizada",
  "guaranteed return",
  "~bitcoin",
  "~cripto",
  "crypto",
  "multinivel",
  "mlm",
  "cuota de inscripcion",
  "pago por adelantado",
  "paga para postular",
  "application fee",
  "registration fee",
  "deposito inicial",
  "envia tus datos bancarios",
  "datos de tu tarjeta",
  "bank account details",
  "trabaja desde casa y gana",
];

/** Contenido inapropiado para una plataforma profesional. */
const INAPPROPRIATE_PATTERNS = ["porn", "~pornogra", "onlyfans", "xxx", "contenido para adultos", "adult content", "escort", "apuestas", "casino"];

const DELIVERABLE_PATTERNS = ["entrega", "entregable", "entregables", "deliverable", "deliverables", "criterio", "criterios", "evaluacion", "evaluara", "evaluated", "fecha limite", "deadline", "rubrica", "memoria", "reporte", "informe"];

const REQUIREMENT_PATTERNS = ["requisito", "requisitos", "requirements", "experiencia", "experience", "conocimientos", "habilidades", "skills", "perfil", "responsabilidades", "responsibilities", "funciones"];

export function keywordModeration(draft: ArenaPostDraft): ArenaModeration {
  const text = normalizeText(`${draft.title} ${draft.organization} ${draft.description} ${draft.stipend ?? ""}`);
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  let blocked = false;

  if (SCAM_PATTERNS.some((p) => has(text, p))) {
    issues.push("Contiene señales típicas de fraude (pagos por adelantado, inversiones o cripto). Andros nunca permite cobrar por postular.");
    blocked = true;
  }
  if (INAPPROPRIATE_PATTERNS.some((p) => has(text, p))) {
    issues.push("Contiene contenido inapropiado para una comunidad profesional.");
    blocked = true;
  }
  const urls = (draft.description.match(/https?:\/\//g) ?? []).length;
  if (urls > 3) {
    issues.push("Demasiados enlaces externos: parece publicidad.");
    score -= 30;
  }
  const letters = draft.description.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  if (letters.length > 40 && upper / letters.length > 0.6) {
    issues.push("Casi todo el texto está en mayúsculas.");
    score -= 15;
  }
  if (/(.)\1{5,}/.test(draft.description) || /[!?]{4,}/.test(draft.description)) {
    issues.push("Caracteres repetidos o exceso de signos de exclamación.");
    score -= 10;
  }

  const descLen = draft.description.trim().length;
  if (descLen < 80) {
    issues.push("La descripción es muy corta para que alguien sepa qué se espera.");
    score -= 30;
  } else if (descLen < 180) {
    suggestions.push("Amplía la descripción (objetivo, contexto técnico y qué se entrega).");
    score -= 10;
  }
  if (draft.organization.trim().length < 3) {
    issues.push("Falta el nombre real de la organización, laboratorio o profesor/a.");
    score -= 15;
  }
  if (draft.type === "challenge" || draft.type === "activity") {
    if (!DELIVERABLE_PATTERNS.some((p) => has(text, p))) {
      suggestions.push("Indica los entregables y cómo se evaluarán (criterios, fecha límite).");
      score -= 12;
    }
  } else {
    if (!REQUIREMENT_PATTERNS.some((p) => has(text, p))) {
      suggestions.push("Lista requisitos o responsabilidades del puesto.");
      score -= 10;
    }
    if (!draft.location?.trim()) {
      suggestions.push("Agrega la ubicación o indica si es remoto.");
      score -= 6;
    }
    if (!draft.stipend?.trim()) {
      suggestions.push(draft.type === "internship" ? "Indica si la práctica tiene apoyo económico." : "Publicar un rango salarial aumenta las postulaciones.");
      score -= 6;
    }
  }

  const qualityScore = blocked ? Math.min(score, 10) : Math.max(0, Math.min(100, score));
  return {
    status: blocked ? "rejected" : qualityScore < 55 ? "needs_review" : "approved",
    qualityScore,
    issues,
    suggestions: suggestions.slice(0, 4),
  };
}

/** Análisis completo sin IA. */
export function keywordAnalyze(draft: ArenaPostDraft): ArenaAnalyzeResponse {
  return { tags: keywordTags(draft), moderation: keywordModeration(draft), engine: "keywords" };
}

/** Combina el veredicto de la IA con las reglas duras (el fraude siempre bloquea). */
export function mergeModeration(ai: unknown, draft: ArenaPostDraft): ArenaModeration {
  const rules = keywordModeration(draft);
  if (!ai || typeof ai !== "object") return rules;
  const m = ai as Record<string, unknown>;
  const status = m.status === "rejected" || m.status === "needs_review" || m.status === "approved" ? m.status : rules.status;
  const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 220)) : [];
  const aiScore = typeof m.qualityScore === "number" && Number.isFinite(m.qualityScore) ? Math.round(m.qualityScore) : rules.qualityScore;
  const finalStatus = rules.status === "rejected" ? "rejected" : status;
  return {
    status: finalStatus,
    qualityScore: Math.max(0, Math.min(100, finalStatus === "rejected" ? Math.min(aiScore, rules.qualityScore) : aiScore)),
    issues: [...new Set([...rules.issues.filter(() => rules.status === "rejected"), ...strList(m.issues)])].slice(0, 5),
    suggestions: [...new Set(strList(m.suggestions))].slice(0, 4),
  };
}
