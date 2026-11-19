// ============================================================================
// ANDROS — CATÁLOGO LOCAL VERIFICADO DE LA BIBLIOTECA
// Solo se usa si TODAS las APIs públicas fallan (sin red, cuota agotada…).
// Son fuentes reales con DOI / enlaces oficiales: nada inventado. La interfaz
// las marca como "Catálogo sin conexión" para no confundirlas con resultados vivos.
// ============================================================================

import type { LibraryScope, LibrarySource } from "@/types/library";

const PAPERS: LibrarySource[] = [
  {
    id: "arxiv:1706.03762",
    kind: "paper",
    provider: "offline",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"],
    year: 2017,
    venue: "Advances in Neural Information Processing Systems 30 (NeurIPS 2017)",
    abstract:
      "Propone el Transformer, una arquitectura basada únicamente en mecanismos de atención, sin recurrencia ni convoluciones, que mejora la calidad de traducción automática y es más paralelizable.",
    url: "https://arxiv.org/abs/1706.03762",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
  },
  {
    id: "doi:10.1109/CVPR.2016.90",
    kind: "paper",
    provider: "offline",
    title: "Deep Residual Learning for Image Recognition",
    authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
    year: 2016,
    venue: "IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
    abstract:
      "Introduce las redes residuales (ResNet), que facilitan el entrenamiento de redes muy profundas mediante conexiones de atajo que aprenden funciones residuales.",
    doi: "10.1109/CVPR.2016.90",
    url: "https://arxiv.org/abs/1512.03385",
    pdfUrl: "https://arxiv.org/pdf/1512.03385",
  },
  {
    id: "arxiv:1412.6980",
    kind: "preprint",
    provider: "offline",
    title: "Adam: A Method for Stochastic Optimization",
    authors: ["Diederik P. Kingma", "Jimmy Ba"],
    year: 2014,
    venue: "arXiv",
    abstract:
      "Presenta Adam, un algoritmo de optimización de primer orden basado en estimaciones adaptativas de momentos de bajo orden, adecuado para problemas con muchos datos o parámetros.",
    url: "https://arxiv.org/abs/1412.6980",
    pdfUrl: "https://arxiv.org/pdf/1412.6980",
  },
  {
    id: "doi:10.1115/1.3656900",
    kind: "paper",
    provider: "offline",
    title: "A Critical Analysis of Crack Propagation Laws",
    authors: ["P. Paris", "F. Erdogan"],
    year: 1963,
    venue: "Journal of Basic Engineering, 85(4), 528–533",
    abstract:
      "Trabajo clásico que relaciona la velocidad de crecimiento de grietas por fatiga con el rango del factor de intensidad de esfuerzos (ley de Paris).",
    doi: "10.1115/1.3656900",
    url: "https://doi.org/10.1115/1.3656900",
  },
  {
    id: "doi:10.1016/j.jcp.2018.10.045",
    kind: "paper",
    provider: "offline",
    title:
      "Physics-informed neural networks: A deep learning framework for solving forward and inverse problems involving nonlinear partial differential equations",
    authors: ["M. Raissi", "P. Perdikaris", "G. E. Karniadakis"],
    year: 2019,
    venue: "Journal of Computational Physics, 378, 686–707",
    abstract:
      "Define las PINN: redes neuronales entrenadas para respetar leyes físicas descritas por ecuaciones diferenciales parciales no lineales, para problemas directos e inversos.",
    doi: "10.1016/j.jcp.2018.10.045",
    url: "https://doi.org/10.1016/j.jcp.2018.10.045",
  },
  {
    id: "doi:10.1016/j.compositesb.2018.02.012",
    kind: "paper",
    provider: "offline",
    title: "Additive manufacturing (3D printing): A review of materials, methods, applications and challenges",
    authors: ["Tuan D. Ngo", "Alireza Kashani", "Gabriele Imbalzano", "Kate T. Q. Nguyen", "David Hui"],
    year: 2018,
    venue: "Composites Part B: Engineering, 143, 172–196",
    abstract:
      "Revisión de los principales métodos de manufactura aditiva, sus materiales, aplicaciones en distintas industrias y los retos pendientes.",
    doi: "10.1016/j.compositesb.2018.02.012",
    url: "https://doi.org/10.1016/j.compositesb.2018.02.012",
  },
];

const CODES: LibrarySource[] = [
  {
    id: "ecfr:29-1910.212",
    kind: "regulation",
    provider: "offline",
    title: "General requirements for all machines",
    authors: [],
    venue: "Occupational Safety and Health Administration (OSHA), Department of Labor",
    designation: "29 CFR 1910.212",
    abstract: "Requisitos de resguardos de máquinas para proteger al operador y a otros empleados de riesgos como puntos de operación, pellizcos, piezas giratorias y proyecciones.",
    url: "https://www.ecfr.gov/current/title-29/section-1910.212",
  },
  {
    id: "ecfr:29-1910.147",
    kind: "regulation",
    provider: "offline",
    title: "The control of hazardous energy (lockout/tagout)",
    authors: [],
    venue: "Occupational Safety and Health Administration (OSHA), Department of Labor",
    designation: "29 CFR 1910.147",
    abstract: "Prácticas y procedimientos para desactivar máquinas y equipos y evitar la liberación de energía peligrosa durante el mantenimiento.",
    url: "https://www.ecfr.gov/current/title-29/section-1910.147",
  },
  {
    id: "ecfr:14-107",
    kind: "regulation",
    provider: "offline",
    title: "Small Unmanned Aircraft Systems",
    authors: [],
    venue: "Federal Aviation Administration (FAA), Department of Transportation",
    designation: "14 CFR Part 107",
    abstract: "Reglas de operación, certificación de pilotos remotos y limitaciones para drones civiles de menos de 55 lb en EE. UU.",
    url: "https://www.ecfr.gov/current/title-14/part-107",
  },
  {
    id: "ecfr:40-60",
    kind: "regulation",
    provider: "offline",
    title: "Standards of Performance for New Stationary Sources",
    authors: [],
    venue: "Environmental Protection Agency (EPA)",
    designation: "40 CFR Part 60",
    abstract: "Normas federales de desempeño de emisiones al aire para fuentes estacionarias nuevas, modificadas o reconstruidas.",
    url: "https://www.ecfr.gov/current/title-40/part-60",
  },
  {
    id: "doi:10.1520/D0638-14",
    kind: "standard",
    provider: "offline",
    title: "Standard Test Method for Tensile Properties of Plastics",
    authors: [],
    year: 2014,
    venue: "ASTM International",
    designation: "ASTM D638-14",
    abstract:
      "Metadatos citables de la norma (el texto completo es de pago y se consulta en la página oficial de ASTM). Método para determinar propiedades de tensión de plásticos con probetas tipo halterio.",
    doi: "10.1520/D0638-14",
    url: "https://doi.org/10.1520/D0638-14",
  },
];

export const OFFLINE_CATALOG: Record<Exclude<LibraryScope, "youtube" | "linkedin">, LibrarySource[]> = {
  papers: PAPERS,
  codes: CODES,
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Fuentes del catálogo que mejor coinciden con la búsqueda (o todas si ninguna). */
export function searchOfflineCatalog(query: string, scope: "papers" | "codes"): LibrarySource[] {
  const terms = normalize(query)
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length > 2);
  const list = OFFLINE_CATALOG[scope];
  const scored = list
    .map((s) => {
      const hay = normalize([s.title, s.abstract, s.venue, s.designation, s.authors.join(" ")].join(" "));
      return { s, score: terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
  return scored.length > 0 ? scored : list;
}
