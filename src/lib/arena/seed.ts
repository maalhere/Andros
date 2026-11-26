// ============================================================================
// ANDROS ARENA — PUBLICACIONES Y SOLUCIONES DE EJEMPLO
// Siempre visibles y marcadas como "Ejemplo": sirven para que cualquier
// visitante vea cómo luce un espacio de Andros usado como portafolio.
// Organizaciones y personas son ficticias; los datos técnicos son realistas.
// ============================================================================

import type { ArenaPost, ArenaSubmission } from "@/types/arena";
import { exampleSnapshot } from "./portfolio";

const approved = (qualityScore: number) => ({ status: "approved" as const, qualityScore, issues: [], suggestions: [] });

export const EXAMPLE_POSTS: ArenaPost[] = [
  {
    id: "example-drone-bracket",
    type: "challenge",
    title: "Reto: soporte de motor de dron impreso en 3D con −30 % de masa",
    organization: "AeroLab Industrial (ejemplo)",
    description:
      "Rediseña el soporte de motor de un cuadricóptero de 450 mm para impresión FDM en PETG. Objetivo: reducir la masa al menos un 30 % manteniendo un factor de seguridad ≥ 2.0 con un empuje de 12 N por motor.\n\nEntregables: modelo CAD (.step + .stl), análisis FEA con cargas y condiciones de contorno, y memoria de cálculo.\nCriterios de evaluación: masa final, factor de seguridad, imprimibilidad sin soportes y claridad de la memoria.",
    stipend: "Premio: 1,500 USD",
    location: "Remoto",
    tags: { type: "challenge", discipline: ["Aeroespacial", "Impresión 3D", "Mecánica"], level: ["Estudiante", "Junior"], skills: ["CAD", "FEA", "FDM", "Topología"] },
    moderation: approved(94),
    engine: "keywords",
    createdAt: "2026-11-10T15:00:00.000Z",
    authorName: "Equipo AeroLab",
    isExample: true,
  },
  {
    id: "example-structural-internship",
    type: "internship",
    title: "Prácticas: CAD estructural Junior (acero y concreto)",
    organization: "Estructuras Norte (ejemplo)",
    description:
      "Buscamos estudiante de Ingeniería Civil de últimos semestres para modelar naves industriales de acero con software BIM y verificar vigas y columnas con un programa de análisis estructural.\n\nResponsabilidades: modelado BIM, planos de taller, revisión de cargas.\nRequisitos: dibujo CAD o modelado BIM, nociones de diseño de acero (AISC 360) y hojas de cálculo. Duración: 6 meses, 30 h/semana.",
    stipend: "Apoyo: 9,000 MXN/mes",
    location: "Monterrey · Híbrido",
    tags: { type: "internship", discipline: ["Civil"], level: ["Prácticas", "Estudiante"], skills: ["CAD", "FEA", "Hoja de cálculo"] },
    moderation: approved(91),
    engine: "keywords",
    createdAt: "2026-11-08T17:30:00.000Z",
    authorName: "RR. HH. Estructuras Norte",
    isExample: true,
  },
  {
    id: "example-thermal-activity",
    type: "activity",
    title: "Actividad: simulación térmica de un disipador de aluminio",
    organization: "Lab. de Transferencia de Calor (ejemplo)",
    description:
      "Actividad de clase: modela un disipador de aletas de aluminio 6063 para un LED de 15 W y estima la temperatura de unión con convección natural.\n\nEntregables: hoja de cálculo con el modelo de resistencias térmicas, gráfica de temperatura vs. número de aletas (CodeLab u otra herramienta de cálculo) y conclusiones. Se evaluará la justificación de las correlaciones usadas. Fecha límite: viernes 28.",
    location: "Presencial · Laboratorio B-204",
    tags: { type: "activity", discipline: ["Mecánica"], level: ["Estudiante"], skills: ["Simulación térmica", "Hoja de cálculo", "LaTeX"] },
    moderation: approved(89),
    engine: "keywords",
    createdAt: "2026-11-12T09:00:00.000Z",
    authorName: "Dra. L. Méndez (ejemplo)",
    isExample: true,
  },
  {
    id: "example-nextjs-job",
    type: "job",
    title: "Ingeniero/a de Software Junior — Next.js para herramientas de ingeniería",
    organization: "Forja Digital (ejemplo)",
    description:
      "Desarrolla interfaces web para visualizar datos de manufactura (piezas, tolerancias, órdenes de impresión 3D).\n\nResponsabilidades: componentes en React/Next.js con TypeScript, integración con APIs y Postgres, pruebas.\nRequisitos: 0–2 años de experiencia, TypeScript, React y SQL. Deseable: interés en CAD o impresión 3D.",
    stipend: "Salario: 1,800–2,400 USD/mes",
    location: "Remoto (LatAm)",
    tags: { type: "job", discipline: ["Software", "Impresión 3D"], level: ["Junior"], skills: ["Next.js", "React", "TypeScript", "SQL"] },
    moderation: approved(92),
    engine: "keywords",
    createdAt: "2026-11-05T13:15:00.000Z",
    authorName: "Forja Digital",
    isExample: true,
  },
  {
    id: "example-print-defects-ai",
    type: "challenge",
    title: "Reto: detecta defectos de impresión 3D con visión artificial",
    organization: "Makers Lab (ejemplo)",
    description:
      "Entrena un modelo que clasifique fotos de impresiones FDM en: correcta, warping, stringing o subextrusión. Dataset de 1,200 imágenes etiquetadas incluido.\n\nEntregables: notebook en Python, matriz de confusión y un informe con las fuentes citadas. Criterio principal: F1 macro sobre el conjunto de prueba oculto.",
    stipend: "Premio: impresora 3D + mentoría",
    location: "Remoto",
    tags: { type: "challenge", discipline: ["IA", "Impresión 3D"], level: ["Estudiante", "Junior"], skills: ["Python", "Machine Learning", "FDM"] },
    moderation: approved(90),
    engine: "keywords",
    createdAt: "2026-11-14T18:45:00.000Z",
    authorName: "Makers Lab",
    isExample: true,
  },
  {
    id: "example-materials-internship",
    type: "internship",
    title: "Prácticas: ensayos de tensión en plásticos impresos (ASTM D638)",
    organization: "Laboratorio de Materiales (ejemplo)",
    description:
      "Apoya la caracterización de probetas impresas en PLA y PETG según ASTM D638: preparación, ensayo en máquina universal y análisis de resultados.\n\nRequisitos: estudiante de Mecánica, Materiales o Química; hojas de cálculo o programación científica; orden y documentación rigurosa. Duración: 4 meses.",
    stipend: "Apoyo económico + constancia",
    location: "Guadalajara · Presencial",
    tags: { type: "internship", discipline: ["Mecánica", "Química", "Impresión 3D"], level: ["Prácticas", "Estudiante"], skills: ["FDM", "Hoja de cálculo"] },
    moderation: approved(88),
    engine: "keywords",
    createdAt: "2026-11-03T11:00:00.000Z",
    authorName: "Coordinación de Laboratorios",
    isExample: true,
  },
];

export const EXAMPLE_SUBMISSIONS: ArenaSubmission[] = [
  {
    id: "example-sub-drone-1",
    postId: "example-drone-bracket",
    applicantName: "Sofía R. (ejemplo)",
    note: "Optimización topológica + nervaduras a 45° para imprimir sin soportes. Masa: 38.2 g → 25.9 g (−32 %), FS mínimo 2.3.",
    isPublic: true,
    isExample: true,
    createdAt: "2026-11-13T10:00:00.000Z",
    snapshot: exampleSnapshot(
      "Soporte de motor — v3 optimizado",
      [
        { t: "soporte_motor_v3.stl", type: "file-node", ext: "stl" },
        { t: "Memoria de cálculo FS", type: "calc-latex-node" },
        { t: "Plan de impresión PETG", type: "sketch-note-node" },
        { t: "Barrido de espesores (CodeLab)", type: "code-lab-node" },
        { t: "Topology optimization for AM (paper)", type: "resource-link-node", cited: true },
        { t: "Revisión con IA", type: "ai-chat-node" },
        { t: "soporte_motor_v1.step", type: "file-node", ext: "step" },
      ],
      [[0, 1], [0, 2], [3, 1], [4, 5], [1, 5], [6, 0]]
    ),
  },
  {
    id: "example-sub-drone-2",
    postId: "example-drone-bracket",
    applicantName: "Diego M. (ejemplo)",
    note: "Versión en celosía con relleno gyroid al 30 %. −29 % de masa; incluyo pruebas de impresión y fotos.",
    isPublic: true,
    isExample: true,
    createdAt: "2026-11-14T16:20:00.000Z",
    snapshot: exampleSnapshot(
      "Bracket celosía gyroid",
      [
        { t: "bracket_lattice.3mf", type: "file-node", ext: "3mf" },
        { t: "Cálculo de empuje y FS", type: "calc-latex-node" },
        { t: "Notas de pruebas de impresión", type: "sketch-note-node" },
        { t: "14 CFR Part 107 (referencia)", type: "resource-link-node", cited: true },
      ],
      [[0, 1], [0, 2], [3, 2]]
    ),
  },
  {
    id: "example-sub-structural-1",
    postId: "example-structural-internship",
    applicantName: "Valeria T. (ejemplo)",
    note: "Portafolio: nave industrial de 24 × 40 m modelada y verificada (vigas IPR, columnas HSS).",
    isPublic: true,
    isExample: true,
    createdAt: "2026-11-09T12:00:00.000Z",
    snapshot: exampleSnapshot(
      "Nave industrial 24×40 m",
      [
        { t: "nave_industrial.step", type: "file-node", ext: "step" },
        { t: "Verificación de viga IPR 12×26", type: "calc-latex-node" },
        { t: "Bajada de cargas", type: "calc-latex-node" },
        { t: "Criterios AISC 360", type: "resource-link-node", cited: true },
        { t: "Bitácora de modelado", type: "sketch-note-node" },
      ],
      [[0, 1], [2, 1], [3, 1], [0, 4]]
    ),
  },
  {
    id: "example-sub-thermal-1",
    postId: "example-thermal-activity",
    applicantName: "Andrés P. (ejemplo)",
    note: "Modelo de resistencias + barrido de 4 a 16 aletas. Óptimo: 11 aletas, Tj = 78 °C.",
    isPublic: true,
    isExample: true,
    createdAt: "2026-11-13T19:40:00.000Z",
    snapshot: exampleSnapshot(
      "Disipador LED 15 W",
      [
        { t: "Modelo de resistencias térmicas", type: "calc-latex-node" },
        { t: "Tj vs. número de aletas", type: "code-lab-node" },
        { t: "disipador_11_aletas.stl", type: "file-node", ext: "stl" },
        { t: "Conclusiones", type: "sketch-note-node" },
        { t: "Correlación de Churchill-Chu", type: "resource-link-node", cited: true },
      ],
      [[4, 0], [0, 1], [1, 3], [2, 3]]
    ),
  },
  {
    id: "example-sub-ai-1",
    postId: "example-print-defects-ai",
    applicantName: "Camila G. (ejemplo)",
    note: "ResNet-18 con fine-tuning: F1 macro 0.91 en validación. Informe con 4 fuentes citadas.",
    isPublic: true,
    isExample: true,
    createdAt: "2026-11-16T08:30:00.000Z",
    snapshot: exampleSnapshot(
      "Clasificador de defectos FDM",
      [
        { t: "Entrenamiento y métricas", type: "code-lab-node" },
        { t: "Deep Residual Learning (He et al.)", type: "resource-link-node", cited: true },
        { t: "Adam optimizer (Kingma & Ba)", type: "resource-link-node", cited: true },
        { t: "Informe técnico", type: "sketch-note-node" },
        { t: "Revisión de errores con IA", type: "ai-chat-node" },
        { t: "muestras_warping.zip", type: "file-node", ext: "zip" },
      ],
      [[1, 0], [2, 0], [0, 3], [3, 4], [5, 0]]
    ),
  },
];
