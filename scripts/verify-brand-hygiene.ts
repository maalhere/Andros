// ============================================================================
// ANDROS — VERIFICACIÓN SPRINT 20: HIGIENE DE MARCAS DE TERCEROS
// Ejecuta: npm run verify:brand   (sin navegador, sin red)
//
// Escanea los TEXTOS VISIBLES de la app (cadenas, plantillas y texto JSX de
// src/ y electron/, con el analizador de TypeScript: los comentarios y los
// identificadores no cuentan) y falla si aparece una marca de terceros donde
// no hace falta.
//
//   Nivel 1 · Prohibidas siempre fuera de lo legal: mensajería, productividad,
//             competidores y comparaciones («mejor que X», «reemplaza a X»).
//   Nivel 2 · Solo por interoperabilidad técnica: Google, Microsoft, Outlook,
//             proveedores de IA con clave propia, plataformas de enlaces y
//             marcas de impresoras. Se permiten en los módulos de integración
//             declarados en INTEROP_ZONES o en una línea marcada con
//             `brand-ok: <motivo>` (en la misma línea o en la anterior).
//
// Excluidos por completo: /privacidad, /cookies, /terminos, /reembolsos y los
// componentes legales (la ley exige nombrar a los encargados reales).
//
// Además comprueba la cláusula de independencia en /terminos y el pie de
// página, y que public/ no sirva logotipos de terceros.
//
// (Sprint 22) Regla ESTRICTA para la portada pública (src/components/landing/):
// cero marcas de terceros, sin zonas de integración, sin «brand-ok» y sin la
// excepción BYOK. También se revisan los textos que la portada importa (planes,
// SEO, avisos legales y `COMPANY_CONTACT`), que no haya botón de tema ni
// controles de tipografía/animación, y que el scroll vertical no se bloquee.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
// `typescript` se carga en tiempo de ejecución (--external:typescript).
import ts from "typescript";
import {
  COMPANY_CONTACT,
  INTEGRATIONS_NOTICE,
  LEGAL_LINKS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  TRADEMARK_NOTICE,
  isPlaceholderLink,
} from "@/lib/site";
import { FREE_PLAN, PLAN_COMPARISON, PRO_PLAN } from "@/lib/plans";
import { CATALOG_CATEGORIES, TEMPLATE_CATALOG } from "@/lib/forms/templateCatalog";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail, null, 1).slice(0, 4000)}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const ROOT = process.cwd();
const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ----------------------------------------------------------------------------
// Catálogo de términos
// ----------------------------------------------------------------------------

interface Term {
  /** Nombre que se informa. */
  name: string;
  pattern: RegExp;
}

/** Sensible a mayúsculas por defecto: los ids de código («gemini», «youtube») no cuentan. */
const t = (name: string, source?: string, flags = ""): Term => ({
  name,
  pattern: new RegExp(`(?<![\\w.-])(?:${source ?? name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w-])`, flags),
});

/** Nivel 1: nunca hacen falta en la UI de Andros. */
export const FORBIDDEN: Term[] = [
  // Mensajería y videollamadas
  t("WhatsApp", "whats\\s?app", "i"),
  t("Telegram"),
  t("Slack"),
  t("Discord"),
  t("Microsoft Teams", "(?:Microsoft\\s)?Teams"),
  t("Skype", "skype", "i"),
  t("Messenger"),
  t("Google Meet", "Google\\sMeet"),
  t("FaceTime", "facetime", "i"),
  t("Zoom (videollamadas)", "Zoom\\s(?:Meetings?|Video|Workplace)"),
  // Ofimática, notas y almacenamiento
  t("Excel"),
  t("Word", "(?:Microsoft\\s)?Word"),
  t("PowerPoint", "power\\s?point", "i"),
  t("Keynote"),
  t("Google Docs", "Google\\sDocs"),
  t("Google Sheets", "Google\\sSheets"),
  t("Google Slides", "Google\\sSlides"),
  t("Google Drive / Drive", "(?:Google\\s)?Drive"),
  t("OneDrive", "onedrive", "i"),
  t("Dropbox", "dropbox", "i"),
  t("Notion"),
  t("Evernote", "evernote", "i"),
  t("OneNote", "onenote", "i"),
  t("Samsung Notes", "samsung\\snotes", "i"),
  t("GoodNotes", "goodnotes", "i"),
  t("Obsidian"),
  // Tableros, gestión y diseño
  t("Trello", "trello", "i"),
  t("Miro"),
  t("Asana"),
  t("Jira"),
  t("monday.com", "monday\\.com", "i"),
  t("ClickUp", "clickup", "i"),
  t("Airtable", "airtable", "i"),
  t("Basecamp", "basecamp", "i"),
  t("Figma", "figma", "i"),
  t("Canva"),
  t("Calendly", "calendly", "i"),
  t("Loom"),
  // Asistentes de IA de consumo (los proveedores con clave propia van en el nivel 2)
  t("ChatGPT", "chat\\s?gpt", "i"),
  t("Copilot"),
  t("Perplexity"),
  // Cálculo y CAD que Andros no integra
  t("MATLAB", "MATLAB|Matlab"),
  t("Mathematica"),
  t("Wolfram"),
  t("Jupyter", "jupyter", "i"),
  t("Colab"),
  t("Overleaf", "overleaf", "i"),
  t("AutoCAD", "autocad", "i"),
  t("Revit"),
  t("SolidWorks", "solidworks", "i"),
  t("Fusion 360", "fusion\\s?360", "i"),
  t("SketchUp", "sketchup", "i"),
  t("Tinkercad", "tinkercad", "i"),
  t("Procore", "procore", "i"),
  t("SAP2000"),
  // Redes sociales sin integración
  t("Instagram"),
  t("Facebook"),
  t("TikTok"),
  t("Twitter"),
];

/** Comparaciones con terceros (marketing): «mejor que X», «reemplaza a X»… */
export const COMPARISONS: Term[] = [
  t("comparación «mejor/más … que X»", "(?:[Mm]ejor|[Mm]ás\\s(?:rápido|fácil|simple|potente|barato|completo))\\sque\\s[A-Z][\\w.]+", ""),
  t(
    "sustitución «reemplaza a X»",
    "(?:[Rr]eemplaza(?:r)?|[Ss]ustituye|[Ss]ustituto\\sde|[Aa]lternativa\\sa|[Aa]diós\\sa|[Oo]lvídate\\sde)\\s(?:a\\s)?[A-Z][\\w.]+",
    "",
  ),
  t("comparación «sin el caos de X»", "[Ss]in\\sel\\scaos\\sde\\s[A-Z][\\w.]+", ""),
  t("comparación «como en / tipo / estilo X»", "(?:como\\sen|tipo|estilo)\\s(?:Google|Microsoft|Apple)\\b", ""),
];

/** Nivel 2: solo por interoperabilidad técnica directa. */
export const INTEROP: Term[] = [
  t("Google"),
  t("Gemini"),
  t("Microsoft"),
  t("Outlook"),
  t("Azure"),
  t("Apple"),
  t("iCloud"),
  t("Claude"),
  t("Anthropic"),
  t("OpenAI"),
  t("GPT", "GPT(?:-[\\w.]+)?"),
  t("YouTube"),
  t("LinkedIn"),
  t("GitHub"),
  t("FlashForge", "flashforge", "i"),
  t("FlashPrint"),
  t("Klipper"),
  t("Moonraker"),
  t("Bambu"),
  t("Creality"),
  t("OrcaSlicer"),
  t("PrusaSlicer"),
  t("Elegoo"),
  t("QIDI"),
  // Alojamiento: no debe aparecer en la UI (los mensajes de despliegue hablan
  // de «tu proveedor de alojamiento»). Los demás encargados propios (Supabase,
  // Resend, PostHog, Clarity) no se vigilan: solo salen en diagnósticos para
  // quien opera la instalación y están declarados en /privacidad y /cookies.
  t("Vercel"),
];

/**
 * Frases de interoperabilidad que valen en cualquier archivo: la clave propia
 * (BYOK) de un proveedor de IA tiene que nombrarlo para que la persona sepa
 * qué clave pegar.
 */
export const ALLOWED_PHRASES: RegExp[] = [
  /(?:tu\s(?:propia\s)?)?clave\s(?:propia\s)?de\s(?:Google\s)?(?:Gemini|Anthropic|OpenAI|Claude)/g,
];

// ----------------------------------------------------------------------------
// Zonas
// ----------------------------------------------------------------------------

/** Avisos legales obligatorios: se omiten (la ley exige nombrar a los encargados). */
export const LEGAL_ZONES = [
  "src/app/privacidad/",
  "src/app/cookies/",
  "src/app/terminos/",
  "src/app/reembolsos/",
  "src/components/legal/",
];

const AI_TERMS = ["Google", "Gemini", "Claude", "Anthropic", "OpenAI", "GPT"];
const CALENDAR_TERMS = ["Google", "Microsoft", "Outlook", "Azure", "Apple", "iCloud"];
const PRINTER_TERMS = ["FlashForge", "FlashPrint", "Klipper", "Moonraker", "Bambu", "Creality", "OrcaSlicer", "PrusaSlicer", "Elegoo", "QIDI", "Microsoft"];
const LINK_TERMS = ["YouTube", "LinkedIn", "GitHub", "Google"];

interface InteropZone {
  prefix: string;
  allow: string[];
  reason: string;
}

/** Módulos de integración técnica: términos permitidos y por qué. */
export const INTEROP_ZONES: InteropZone[] = [
  // Inicio de sesión (OAuth) y vinculación de cuentas
  { prefix: "src/components/auth/", allow: ["Google"], reason: "botón oficial de inicio de sesión OAuth" },
  { prefix: "src/app/auth/", allow: ["Google", "Microsoft", "Azure"], reason: "retorno OAuth" },
  { prefix: "src/hooks/useCloudSync.ts", allow: ["Google", "Microsoft", "Azure", "Supabase"], reason: "OAuth y vinculación de identidades" },
  { prefix: "electron/", allow: ["Google", "Microsoft", "Azure", "Supabase", ...PRINTER_TERMS], reason: "login en el navegador del sistema y laminadores instalados" },
  // Calendarios externos (la persona conecta su propia cuenta)
  { prefix: "src/lib/calendar/", allow: CALENDAR_TERMS, reason: "Google Calendar / Microsoft Graph / .ics" },
  { prefix: "src/app/api/calendar/", allow: CALENDAR_TERMS, reason: "Google Calendar / Microsoft Graph" },
  { prefix: "src/components/calendar/", allow: CALENDAR_TERMS, reason: "botones «Abrir en…» y «Conectar…»" },
  { prefix: "src/store/useCalendarStore.ts", allow: CALENDAR_TERMS, reason: "estado de conexión por proveedor" },
  // Proveedores de IA con clave propia (BYOK) y servidor de IA
  { prefix: "src/lib/ai/chatImport.ts", allow: [...AI_TERMS, "ChatGPT"], reason: "formatos de exportación de chats del usuario" },
  { prefix: "src/app/api/ai/import-chat/", allow: [...AI_TERMS, "ChatGPT"], reason: "enlaces compartidos de chats del usuario" },
  { prefix: "src/lib/ai/", allow: AI_TERMS, reason: "adaptadores de proveedores de IA" },
  { prefix: "src/app/api/ai/", allow: AI_TERMS, reason: "errores de la clave propia del proveedor" },
  { prefix: "src/app/api/oracle/", allow: [...AI_TERMS, ...LINK_TERMS], reason: "errores del proveedor de IA y tipos de nodo de enlace" },
  { prefix: "src/app/api/arena/analyze-post/", allow: AI_TERMS, reason: "errores del proveedor de IA" },
  { prefix: "src/lib/oracle/", allow: [...AI_TERMS, ...LINK_TERMS], reason: "errores del proveedor de IA y contexto de enlaces" },
  { prefix: "src/components/settings/AiKeysModal.tsx", allow: AI_TERMS, reason: "panel de claves propias por proveedor" },
  { prefix: "src/store/useAiProvidersStore.ts", allow: AI_TERMS, reason: "claves propias por proveedor" },
  { prefix: "src/store/useAiQuotaStore.ts", allow: AI_TERMS, reason: "cuota de la IA incluida" },
  // Impresoras en red (Modo Experto)
  { prefix: "src/lib/printer/", allow: PRINTER_TERMS, reason: "protocolos de impresora en red" },
  { prefix: "src/lib/printers/", allow: PRINTER_TERMS, reason: "registro de impresoras y adaptadores" },
  { prefix: "src/lib/slicer/", allow: PRINTER_TERMS, reason: "formato .gx de la impresora" },
  { prefix: "src/app/api/printer/", allow: PRINTER_TERMS, reason: "puente de impresora en red" },
  { prefix: "src/components/nodes/Print3DModal.tsx", allow: PRINTER_TERMS, reason: "elección de impresora y laminador" },
  { prefix: "src/components/nodes/Model3DPreview.tsx", allow: PRINTER_TERMS, reason: "cama de la impresora elegida" },
  { prefix: "src/components/nodes/ModelPrepControls.tsx", allow: PRINTER_TERMS, reason: "perfil de la impresora elegida" },
  // Enlaces y fuentes con API pública de la plataforma
  { prefix: "src/components/library/LibraryDrawer.tsx", allow: LINK_TERMS, reason: "oEmbed de videos y tarjetas de referencia" },
  { prefix: "src/app/api/library/", allow: LINK_TERMS, reason: "oEmbed de videos y tarjetas de referencia" },
  { prefix: "src/app/api/link-preview/", allow: LINK_TERMS, reason: "API pública de la plataforma enlazada" },
  { prefix: "src/lib/library/", allow: LINK_TERMS, reason: "formatos de cita (APA/IEEE) que nombran la plataforma" },
  { prefix: "src/lib/canvas/contextGraph.ts", allow: [...LINK_TERMS, ...AI_TERMS], reason: "contexto para la IA con la plataforma de origen" },
  // Taxonomía de habilidades de Arena: reconoce lo que escribe quien publica
  { prefix: "src/lib/arena/keywordTagger.ts", allow: ["SolidWorks", "Fusion 360", "AutoCAD", "MATLAB", "Revit", "SAP2000"], reason: "etiquetas derivadas del texto del autor" },
];

const SCAN_ROOTS = ["src", "electron"];
const SCAN_EXT = /\.(?:ts|tsx|js|cjs|mjs)$/;

// ----------------------------------------------------------------------------
// Extracción de textos visibles
// ----------------------------------------------------------------------------

interface TextChunk {
  line: number;
  text: string;
}

export function extractTexts(source: string, fileName: string): TextChunk[] {
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.(c|m)?js$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: TextChunk[] = [];
  const push = (node: ts.Node, text: string) => {
    if (!text.trim()) return;
    out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    // Las rutas de import/export, require() y los tipos literales son técnicos.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Ids de código («chatgpt», "whatsapp", "gemini-3-flash") no son texto visible.
      if (!/^[a-z][a-z0-9_.:-]*$/.test(node.text)) push(node, node.text);
    }
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) push(node, node.text);
    else if (ts.isJsxText(node)) push(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface Finding {
  file: string;
  line: number;
  term: string;
  level: "prohibida" | "comparación" | "interoperabilidad";
  excerpt: string;
}

const PRAGMA = /brand-ok\s*:\s*\S/;

export function scanSource(file: string, source: string): Finding[] {
  if (LEGAL_ZONES.some((z) => file.startsWith(z))) return [];
  const zones = INTEROP_ZONES.filter((z) => file.startsWith(z.prefix));
  const allowed = new Set(zones.flatMap((z) => z.allow));
  const lines = source.split(/\r?\n/);
  const findings: Finding[] = [];

  for (const chunk of extractTexts(source, file)) {
    const own = lines[chunk.line - 1] ?? "";
    const prev = lines[chunk.line - 2] ?? "";
    const pragma = PRAGMA.test(own) || PRAGMA.test(prev);
    const text = ALLOWED_PHRASES.reduce((acc, re) => acc.replace(re, "«clave propia»"), chunk.text);
    const report = (term: Term, level: Finding["level"]) => {
      const m = term.pattern.exec(text);
      if (!m) return;
      const at = Math.max(0, m.index - 40);
      findings.push({
        file,
        line: chunk.line,
        term: term.name,
        level,
        excerpt: text.slice(at, m.index + m[0].length + 40).replace(/\s+/g, " ").trim(),
      });
    };
    for (const term of FORBIDDEN) if (!allowed.has(term.name) && !pragma) report(term, "prohibida");
    for (const term of COMPARISONS) report(term, "comparación"); // sin excepciones
    for (const term of INTEROP) if (!allowed.has(term.name) && !pragma) report(term, "interoperabilidad");
  }
  return findings;
}

// ----------------------------------------------------------------------------
// Regla estricta de la portada pública (Sprint 22)
// ----------------------------------------------------------------------------

/** Archivos de la portada: ninguna marca de terceros, sin excepciones. */
export const LANDING_ZONES = ["src/components/landing/"];

/** Términos extra que en la portada tampoco se nombran (acceso, pagos, plataformas). */
export const LANDING_EXTRA: Term[] = [
  t("Supabase"),
  t("Stripe"),
  t("Paddle"),
  t("Lemon Squeezy", "Lemon\\s?Squeezy"),
  t("PostHog", "posthog", "i"),
  t("Gmail", "gmail", "i"),
  t("Hotmail", "hotmail", "i"),
  t("Yahoo"),
  t("Android"),
  t("iPhone"),
  t("iOS"),
  t("Windows"),
  t("macOS"),
  t("Chrome"),
  t("Safari"),
  t("Firefox"),
];

const STRICT_TERMS: Array<[Term, Finding["level"]]> = [
  ...FORBIDDEN.map((term): [Term, Finding["level"]] => [term, "prohibida"]),
  ...COMPARISONS.map((term): [Term, Finding["level"]] => [term, "comparación"]),
  ...INTEROP.map((term): [Term, Finding["level"]] => [term, "interoperabilidad"]),
  ...LANDING_EXTRA.map((term): [Term, Finding["level"]] => [term, "interoperabilidad"]),
];

/** Revisa un texto visible con la regla estricta (sin zonas, pragmas ni BYOK). */
export function strictTextFindings(text: string, file: string, line = 0): Finding[] {
  const out: Finding[] = [];
  for (const [term, level] of STRICT_TERMS) {
    const m = term.pattern.exec(text);
    if (!m) continue;
    const at = Math.max(0, m.index - 40);
    out.push({ file, line, term: term.name, level, excerpt: text.slice(at, m.index + m[0].length + 40).replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function scanLandingStrict(file: string, source: string): Finding[] {
  return extractTexts(source, file).flatMap((chunk) => strictTextFindings(chunk.text, file, chunk.line));
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, acc);
    } else if (SCAN_EXT.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// ----------------------------------------------------------------------------
// 1. Autocomprobación del escáner (sin tocar el repositorio)
// ----------------------------------------------------------------------------

section("1. Autocomprobación del escáner");
{
  const sample = [
    'const a = "Pégalo en tu grupo de WhatsApp";',
    "// Comentario: fluido como Figma (no cuenta)",
    "const Comp = () => <p>Organiza mejor que Trello</p>;",
    'const id = "gemini"; // id de código en minúsculas',
    "const label = `Conecta Google Calendar`;",
    "// brand-ok: interoperabilidad (cuenta propia de calendario)",
    'const ok = "Abrir en Google Calendar";',
    'import x from "@anthropic-ai/sdk";',
    'const word = "Wordle y PowerPointless no son marcas aquí";',
  ].join("\n");
  const found = scanSource("src/components/Demo.tsx", sample);
  const names = found.map((f) => `${f.line}:${f.term}`);
  check("detecta mensajería en una cadena", names.includes("1:WhatsApp"), names);
  check("ignora los comentarios", !names.some((n) => n.startsWith("2:")), names);
  check("detecta marcas en texto JSX", names.includes("3:Trello"), names);
  check("detecta comparaciones «mejor que X»", found.some((f) => f.line === 3 && f.level === "comparación"), names);
  check("ignora ids de código en minúsculas", !names.some((n) => n.startsWith("4:")), names);
  check("marca de interoperabilidad fuera de su zona → aviso", names.includes("5:Google"), names);
  check("`brand-ok:` en la línea anterior la permite", !names.some((n) => n.startsWith("7:")), names);
  check("ignora rutas de import", !names.some((n) => n.startsWith("8:")), names);
  check("respeta los límites de palabra (Wordle, PowerPointless)", !names.some((n) => n.startsWith("9:")), names);

  const inZone = scanSource("src/components/calendar/X.tsx", 'const a = "Abrir en Google Calendar"; const b = "pégalo en WhatsApp";');
  check("zona de calendario: permite Google, sigue prohibiendo WhatsApp", inZone.length === 1 && inZone[0].term === "WhatsApp", inZone);
  check("las páginas legales se omiten", scanSource("src/app/privacidad/page.tsx", 'const s = "Supabase, Vercel, Google y WhatsApp";').length === 0);
  const pragmaNoReason = scanSource("src/components/X.tsx", '// brand-ok\nconst s = "Google";');
  check("`brand-ok` sin motivo no vale", pragmaNoReason.length === 1, pragmaNoReason);

  const byok = scanSource("src/components/X.tsx", 'const a = "Se usa tu propia clave de Gemini"; const b = "Usando el Gemini del servidor";');
  check("BYOK: «tu clave de Gemini» vale, otras menciones no", byok.length === 1 && byok[0].excerpt.includes("del servidor"), byok);
  const verbs = scanSource("src/components/X.tsx", 'const a = "Reemplazar por otro archivo"; const b = "reemplaza texto"; const c = "Andros reemplaza a Notion";');
  check("«Reemplazar por…» no es comparación; «reemplaza a Marca» sí", verbs.filter((f) => f.level === "comparación").length === 1, verbs);
  const types = scanSource("src/types/X.ts", 'type P = "chatgpt" | "claude"; const id = "whatsapp";');
  check("tipos literales e ids en minúsculas no cuentan", types.length === 0, types);

  // Regla estricta de la portada: ni `brand-ok`, ni BYOK, ni proveedores de acceso.
  const strict = scanLandingStrict(
    "src/components/landing/X.tsx",
    [
      "// brand-ok: aquí no vale",
      'const a = "Abrir en Google Calendar";',
      'const b = "Se usa tu propia clave de Gemini";',
      'const c = "Comenzar gratis con tu propia clave de API";',
      "const d = signInWithGoogle; // identificador, no texto",
      'const e = "Sin instalar nada en Windows";',
    ].join("\n"),
  );
  const strictLines = strict.map((f) => `${f.line}:${f.term}`);
  check("portada: `brand-ok` no exime de la regla estricta", strictLines.includes("2:Google"), strictLines);
  check("portada: la excepción BYOK no aplica", strictLines.includes("3:Gemini"), strictLines);
  check("portada: textos genéricos e identificadores no cuentan", !strictLines.some((n) => /^[45]:/.test(n)), strictLines);
  check("portada: plataformas de terceros también se detectan", strictLines.includes("6:Windows"), strictLines);
}

// ----------------------------------------------------------------------------
// 2. Barrido del repositorio
// ----------------------------------------------------------------------------

section("2. Barrido de textos visibles (src/ y electron/)");
const files = SCAN_ROOTS.flatMap((r) => walk(path.join(ROOT, r)));
const all: Finding[] = [];
let pragmas = 0;
for (const abs of files) {
  const file = rel(abs);
  const source = fs.readFileSync(abs, "utf8");
  pragmas += (source.match(/brand-ok\s*:/g) ?? []).length;
  all.push(...scanSource(file, source));
}
console.log(`  · ${files.length} archivos, ${INTEROP_ZONES.length} zonas de integración, ${pragmas} excepciones «brand-ok» justificadas`);

const byLevel = (level: Finding["level"]) => all.filter((f) => f.level === level).map((f) => `${f.file}:${f.line} · ${f.term} · «${f.excerpt}»`);
check("sin marcas de mensajería, productividad ni competidores", byLevel("prohibida").length === 0, byLevel("prohibida"));
check("sin comparaciones con terceros", byLevel("comparación").length === 0, byLevel("comparación"));
check("marcas de interoperabilidad solo en sus módulos o con «brand-ok»", byLevel("interoperabilidad").length === 0, byLevel("interoperabilidad"));

// Cada zona declarada debe existir (evita listas blancas huérfanas).
const missingZones = INTEROP_ZONES.filter((z) => !fs.existsSync(path.join(ROOT, z.prefix))).map((z) => z.prefix);
check("todas las zonas de integración existen", missingZones.length === 0, missingZones);

// ----------------------------------------------------------------------------
// 3. Metadatos SEO y recursos públicos
// ----------------------------------------------------------------------------

section("3. Metadatos SEO y recursos públicos");
{
  const site = read("src/lib/site.ts");
  const seo = scanSource("src/lib/site.ts", site);
  check("descripción, título y tagline sin marcas de terceros", seo.length === 0, seo);
  const manifest = scanSource("src/app/manifest.ts", read("src/app/manifest.ts"));
  check("manifiesto PWA sin marcas de terceros", manifest.length === 0, manifest);
  const publicFiles = fs.readdirSync(path.join(ROOT, "public"));
  const logos = publicFiles.filter((f) => /^(vercel|next|github|google|microsoft|apple|whatsapp)[^/]*\.(svg|png|ico)$/i.test(f));
  check("public/ no sirve logotipos de terceros", logos.length === 0, logos);
}

// ----------------------------------------------------------------------------
// 4. Aviso de marcas e independencia
// ----------------------------------------------------------------------------

section("4. Aviso de marcas e independencia");
{
  check(
    "texto de integraciones (literal del Sprint 20)",
    INTEGRATIONS_NOTICE ===
      "Las integraciones opcionales con servicios externos funcionan mediante sus interfaces públicas y están sujetas a sus propios términos.",
  );
  check(
    "texto de marcas (literal del Sprint 20)",
    TRADEMARK_NOTICE ===
      "Todas las marcas mencionadas por motivos de compatibilidad técnica pertenecen a sus respectivos propietarios; Andros no está afiliado, patrocinado ni respaldado por ellos.",
  );
  const terms = read("src/app/terminos/page.tsx");
  check("/terminos publica ambas frases", /\{INTEGRATIONS_NOTICE\}/.test(terms) && /\{TRADEMARK_NOTICE\}/.test(terms));
  check("/terminos tiene la sección de integraciones y marcas", /Integraciones opcionales y marcas de terceros/.test(terms));
  const headings = [...terms.matchAll(/<h2>(\d+)\./g)].map((m) => Number(m[1]));
  check("/terminos: secciones numeradas sin saltos", headings.every((n, i) => n === i + 1), headings);
  const footer = read("src/components/legal/SiteFooter.tsx");
  check("el pie de página muestra el aviso de marcas", /\{TRADEMARK_NOTICE\}/.test(footer));
  const landing = read("src/components/landing/LandingOverlay.tsx");
  const landingFooter = read("src/components/landing/LandingFooter.tsx");
  check("la portada incluye su pie de página corporativo", /<LandingFooter\b/.test(landing));
  check("el pie de la portada muestra el aviso de marcas", /\{TRADEMARK_NOTICE\}/.test(landingFooter));
  const legalPage = read("src/components/legal/LegalPage.tsx");
  check("las páginas legales incluyen el pie de página", /<SiteFooter\b/.test(legalPage));
}

// ----------------------------------------------------------------------------
// 5. Portada pública: regla estricta (Sprint 22)
// ----------------------------------------------------------------------------

section("5. Portada pública: regla estricta (Sprint 22)");
{
  const landingFiles = LANDING_ZONES.flatMap((z) => walk(path.join(ROOT, z)));
  const strict: Finding[] = [];
  let landingPragmas = 0;
  for (const abs of landingFiles) {
    const file = rel(abs);
    const source = fs.readFileSync(abs, "utf8");
    landingPragmas += (source.match(/brand-ok\s*:/g) ?? []).length;
    strict.push(...scanLandingStrict(file, source));
  }
  const fmt = (f: Finding) => `${f.file}:${f.line} · ${f.term} · «${f.excerpt}»`;
  console.log(`  · ${landingFiles.length} archivos de la portada`);
  check("portada: 0 marcas, apps o proveedores de terceros en sus textos", strict.length === 0, strict.map(fmt));
  check("portada: sin excepciones «brand-ok»", landingPragmas === 0, landingPragmas);

  // Textos que la portada importa de otros módulos.
  const imported: Array<[string, string]> = [
    ["SITE_NAME", SITE_NAME],
    ["SITE_TAGLINE", SITE_TAGLINE],
    ["SITE_DESCRIPTION", SITE_DESCRIPTION],
    ["TRADEMARK_NOTICE", TRADEMARK_NOTICE],
    ...LEGAL_LINKS.map((l): [string, string] => [`LEGAL_LINKS ${l.href}`, l.label]),
    ...[FREE_PLAN, PRO_PLAN].flatMap((p): Array<[string, string]> => [
      [`${p.id}.name`, p.name],
      [`${p.id}.price`, `${p.price} ${p.period} ${p.altPrice ?? ""}`],
      [`${p.id}.tagline`, p.tagline],
      ...p.features.map((f, i): [string, string] => [`${p.id}.features[${i}]`, f]),
    ]),
    ...PLAN_COMPARISON.map((r): [string, string] => [`PLAN_COMPARISON ${r.label}`, `${r.label} ${r.free ?? ""} ${r.pro}`]),
  ];
  const importedFindings = imported.flatMap(([name, text]) => strictTextFindings(text, name));
  check("portada: planes, SEO y avisos que importa sin marcas de terceros", importedFindings.length === 0, importedFindings.map(fmt));

  // SEO de portada: Open Graph y manifiesto con la regla estricta.
  const seoStrict = ["src/app/opengraph-image.tsx", "src/app/manifest.ts"].flatMap((f) => scanLandingStrict(f, read(f)));
  check("portada: imagen Open Graph y manifiesto sin marcas de terceros", seoStrict.length === 0, seoStrict.map(fmt));

  // COMPANY_CONTACT: los únicos nombres de red son los perfiles propios de Andros.
  const SOCIAL_LABELS = new Set(["instagramLabel", "linkedinLabel"]);
  const OFFICIAL_EMAIL = "contacto.androshn@gmail.com";
  const contactFindings = Object.entries(COMPANY_CONTACT)
    .filter(([key, value]) => typeof value === "string" && !SOCIAL_LABELS.has(key))
    .flatMap(([key, value]) =>
      strictTextFindings(String(value), `COMPANY_CONTACT.${key}`).filter(
        // Única excepción: el buzón oficial de Andros, solo en `email` y solo con ese valor.
        (f) => !(key === "email" && value === OFFICIAL_EMAIL && f.term === "Gmail"),
      ),
    );
  check("COMPANY_CONTACT: solo las etiquetas de redes propias nombran una red", contactFindings.length === 0, contactFindings.map(fmt));
  const socialUrls = [COMPANY_CONTACT.instagramUrl, COMPANY_CONTACT.linkedinUrl];
  check(
    "COMPANY_CONTACT: enlaces de redes son placeholders «#…» o https:// reales",
    socialUrls.every((u) => isPlaceholderLink(u) || /^https:\/\/\S+$/.test(u)),
    socialUrls,
  );
  check(
    "COMPANY_CONTACT: todos los campos del Sprint 22 presentes",
    ["email", "instagramHandle", "instagramUrl", "linkedinLabel", "linkedinUrl", "supportChannel", "location", "businessHours", "legalEntity"].every(
      (k) => typeof (COMPANY_CONTACT as Record<string, unknown>)[k] === "string" && String((COMPANY_CONTACT as Record<string, unknown>)[k]).trim() !== "",
    ),
  );

  const landing = read("src/components/landing/LandingOverlay.tsx");
  const footer = read("src/components/landing/LandingFooter.tsx");
  const landingAll = landingFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  // Controles retirados: tema y tipografía/animación de letras.
  check("portada: sin botón de tema / Modo Noche", !/ThemeToggle|toggleTheme|\b(?:Sun|Moon)\b/.test(landingAll));
  check(
    "portada: sin controles para mezclar, pausar o fijar letras",
    !/MutantAndrosLogo|shuffleSignal|\bShuffle\b|BlackHoleCanvas|Mezclar|[Pp]ausar|[Bb]loquear letras/.test(landingAll),
  );
  check(
    "portada: estilo visual fijo (.andros-landing definido en globals.css)",
    /\bandros-landing\b/.test(landing) && /\.andros-landing\s*\{/.test(read("src/app/globals.css")),
  );

  // Scroll vertical libre.
  check("portada: sin h-screen ni overflow-hidden que bloqueen el scroll", !/\bh-screen\b|overflow-(?:y-)?hidden/.test(landingAll));
  check("portada: el contenedor permite scroll vertical", /overflow-y-auto/.test(landing));

  // Recorrido y CTA.
  const sections = ["como-funciona", "capacidades", "planes", "mas-informacion"];
  check("portada: secciones Cómo funciona, Capacidades, Planes y Más información", sections.every((id) => landing.includes(`id="${id}"`)));
  check("portada: CTA «Comenzar gratis» e indicador «Conoce más»", /Comenzar gratis/.test(landing) && /Conoce más/.test(landing));
  const steps = /const STEPS: Step\[\] = \[([\s\S]*?)\n\];/.exec(landing)?.[1] ?? "";
  check("portada: tres pasos en «Cómo funciona»", (steps.match(/\btitle:/g) ?? []).length === 3);

  // Planes: precios y límites solo desde plans.ts ← planLimits.ts.
  check(
    "portada: planes leídos de plans.ts (fuente: planLimits.ts)",
    /from "@\/lib\/plans"/.test(landing) && /PLAN_LIMITS|PRO_PRICING/.test(read("src/lib/plans.ts")),
  );
  check("portada: sin precios escritos a mano", !/\$\d/.test(landingAll));

  // Pie corporativo.
  check("pie corporativo: datos desde COMPANY_CONTACT", /COMPANY_CONTACT\./.test(footer));
  check("pie corporativo: enlaces legales y aviso de independencia", /LEGAL_LINKS/.test(footer) && /\{TRADEMARK_NOTICE\}/.test(footer));
  check("pie corporativo: placeholders sin enlace (isPlaceholderLink)", /isPlaceholderLink\(/.test(footer) && /emailIsPlaceholder/.test(footer));
  check(
    "pie corporativo: enlaces a /privacidad, /terminos, /cookies y /reembolsos",
    ["/privacidad", "/terminos", "/cookies", "/reembolsos"].every((href) => LEGAL_LINKS.some((l) => l.href === href)),
  );
}

// ----------------------------------------------------------------------------
// 6. (Sprint 23) Catálogo de plantillas y portada «mesa de estudio»
// ----------------------------------------------------------------------------

section("6. Librería de fichas y portada rediseñada (Sprint 23)");
{
  const fmt = (f: Finding) => `${f.file}:${f.line} · ${f.term} · «${f.excerpt}»`;
  check("catálogo: al menos 20 plantillas", TEMPLATE_CATALOG.length >= 20, TEMPLATE_CATALOG.length);
  // Regla ESTRICTA (la de la portada) sobre todo texto de las plantillas.
  const catalogTexts: Array<[string, string]> = [
    ...CATALOG_CATEGORIES.map((c): [string, string] => [`categoría ${c.id}`, `${c.label} ${c.short}`]),
    ...TEMPLATE_CATALOG.flatMap((t): Array<[string, string]> => [
      [`${t.id}.title`, t.title],
      [`${t.id}.description`, t.description ?? ""],
      [`${t.id}.area`, t.area],
      ...t.fields.map((f): [string, string] => [`${t.id}.${f.fieldKey}`, [f.label, f.unit ?? "", ...(f.options ?? [])].join(" ")]),
      ...Object.entries(t.prefill).map(([k, v]): [string, string] => [`${t.id}.prefill.${k}`, String(v)]),
    ]),
  ];
  const catalogFindings = catalogTexts.flatMap(([name, text]) => strictTextFindings(text, name));
  check("catálogo: 0 apps o marcas de terceros (regla estricta)", catalogFindings.length === 0, catalogFindings.map(fmt));
  const catalogSource = scanLandingStrict("src/lib/forms/templateCatalog.ts", read("src/lib/forms/templateCatalog.ts"));
  check("catálogo: textos del archivo fuente limpios", catalogSource.length === 0, catalogSource.map(fmt));
  check("catálogo: sin pragmas «brand-ok»", !/brand-ok\s*:/.test(read("src/lib/forms/templateCatalog.ts")));

  // «WhatsApp» en cualquier forma, incluidos comentarios e identificadores.
  const sources = ["src", "electron"].flatMap((r) => walk(path.join(ROOT, r)));
  const whatsapp = sources.filter((abs) => /whats\s?app/i.test(fs.readFileSync(abs, "utf8"))).map(rel);
  check("«WhatsApp»: 0 apariciones en src/ y electron/ (código, comentarios e identificadores)", whatsapp.length === 0, whatsapp);
  const seoFiles = ["src/app/layout.tsx", "src/app/manifest.ts", "src/app/opengraph-image.tsx", "src/lib/site.ts"];
  const seoWhatsapp = seoFiles.filter((f) => /whats\s?app/i.test(read(f)));
  check("layout, manifiesto, Open Graph y site.ts sin «WhatsApp»", seoWhatsapp.length === 0, seoWhatsapp);

  // Portada: pieza visual de planificación, sin canvas pesado.
  const landingAll = LANDING_ZONES.flatMap((z) => walk(path.join(ROOT, z))).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  check("portada: incluye la mesa de estudio (PlanningTable)", /<PlanningTable\b/.test(read("src/components/landing/LandingOverlay.tsx")));
  check("portada: sin <canvas>, WebGL ni bucles de animación", !/<canvas\b|getContext\(|requestAnimationFrame|THREE\./.test(landingAll));
  check("portada: tarjetas con @Diseño, @Obra y @Finanzas", ["Diseño", "Obra", "Finanzas"].every((a) => landingAll.includes(`"${a}"`)));
  check("portada: cambio de estado Rojo → Verde", /Rojo · Pendiente/.test(landingAll) && /Verde · Resuelta/.test(landingAll));
  check("portada: los datos de muestra se rotulan «Ejemplo»", (landingAll.match(/Ejemplo/g) ?? []).length >= 2);
  check("portada: respeta el movimiento reducido", /useReducedMotion/.test(landingAll) && /prefers-reduced-motion[\s\S]{0,120}landing-draw/.test(read("src/app/globals.css")));
}

console.log(`\n${passed} correctas · ${failed} fallidas`);
if (failed > 0) process.exit(1);
