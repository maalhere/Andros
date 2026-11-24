// ============================================================================
// ANDROS — VERIFICACIÓN DE IMPRESIÓN 3D MULTI-IMPRESORA (sin navegador)
// Ejecuta: npm run verify:printers   (tras `npm run build` para el punto 6)
//
//   1. Registro: ≥ 20 impresoras (21: todas las familias pedidas), Creality
//      K2 SE y FlashForge Adventurer 3 destacadas al inicio, datos válidos y
//      perfiles Rápido / Estándar / Fuerte × PLA / PETG / ABS coherentes.
//   2. Verificación de volumen de cama (incluida la K2 SE 220 × 215 × 245 mm):
//      cabe / no cabe, eje limitante, % exacto de escala y giro de 90°.
//   3. Anti-SSRF del adaptador Klipper: solo IPv4 RFC 1918 + puertos 7125 /
//      4408 / 80; las IPs públicas / loopback / metadatos no hacen NINGUNA
//      petición; la ruta y Electron usan la misma validación.
//   4. ¿El G-code es para esta impresora? (bloqueo FlashForge, coincidencia,
//      desconocido y otra máquina).
//   5. Telemetría: sin variables de entorno no hay ninguna petición de red;
//      las propiedades descartan texto libre.
//   6. Carga diferida: el registro solo vive en fragmentos diferidos (Modo
//      Experto) y nunca en el JS inicial de `/` (lee `.next`).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import {
  K2_SE_ID,
  MATERIALS,
  PRINTERS,
  PROFILES,
  SLICERS,
  checkBedFit,
  getPrinter,
  printerGroups,
  type BedVolume,
  type PrinterModel,
} from "@/lib/printers/registry";
import { isRfc1918IPv4, parseKlipperTarget } from "@/lib/printers/network";
import { readKlipperStatus, safeGcodeFileName, uploadAndPrintKlipper } from "@/lib/printers/moonrakerNet";
import { inspectGcode, matchPrinterModel } from "@/lib/printers/gcodeCheck";
import { TELEMETRY_EVENTS, isTelemetryConfigured, sanitizeProps, track } from "@/lib/analytics/telemetry";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  }
}

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ----------------------------------------------------------------------------
// Sustituto de fetch que cuenta las peticiones (para anti-SSRF y telemetría)
// ----------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init?: RequestInit;
}
const calls: FetchCall[] = [];
let responder: (url: string, init?: RequestInit) => Response = () => new Response("{}", { status: 404 });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push({ url, init });
  return responder(url, init);
}) as typeof fetch;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main(): Promise<void> {
  // --------------------------------------------------------------------------
  console.log("\n1) Registro de impresoras");
  const ids = PRINTERS.map((p) => p.id);
  check(`≥ 20 impresoras en el registro (hay ${PRINTERS.length})`, PRINTERS.length >= 20, PRINTERS.length);
  check("identificadores únicos", new Set(ids).size === ids.length);
  check("Creality K2 SE es la primera y destacada", PRINTERS[0].id === K2_SE_ID && PRINTERS[0].featured);
  check("FlashForge Adventurer 3 es la segunda y destacada", PRINTERS[1].id === "flashforge-adventurer-3" && PRINTERS[1].featured);
  check("el selector agrupa «Destacadas» primero", printerGroups()[0].label === "Destacadas" && printerGroups()[0].printers.length === 2);

  const wanted = [
    "Creality K2 SE", "Creality K1", "Creality K1 Max", "Creality Ender-3 V3 SE", "Creality Ender-3 V3 KE",
    "Bambu Lab A1 Mini", "Bambu Lab A1", "Bambu Lab P1S", "Bambu Lab X1 Carbon",
    "FlashForge Adventurer 3", "FlashForge Adventurer 5M", "FlashForge Adventurer 5M Pro",
    "Prusa MK4S", "Prusa Core One", "Prusa MINI+",
    "Anycubic Kobra 3", "Anycubic Kobra S1",
    "Elegoo Neptune 4 Pro", "Elegoo Centauri Carbon",
    "QIDI Q1 Pro", "QIDI Plus4",
  ];
  const names = new Set(PRINTERS.map((p) => `${p.brand} ${p.model}`));
  const missing = wanted.filter((w) => !names.has(w));
  check("están todas las familias pedidas (Creality, Bambu, FlashForge, Prusa, Anycubic, Elegoo, QIDI)", missing.length === 0, missing);

  const ECOS = ["klipper-moonraker", "flashforge-tcp", "bambu-slicer-handoff", "generic-slicer-download"];
  const bad = PRINTERS.filter(
    (p) =>
      !(p.bed.x >= 100 && p.bed.x <= 400 && p.bed.y >= 100 && p.bed.y <= 400 && p.bed.z >= 100 && p.bed.z <= 400) ||
      !(p.nozzleMm > 0.1 && p.nozzleMm < 1.2) ||
      !["direct", "bowden"].includes(p.extruder) ||
      !ECOS.includes(p.ecosystem) ||
      !SLICERS[p.slicer] ||
      p.altSlicers.some((s) => !SLICERS[s])
  );
  check("cama 100–400 mm, boquilla, extrusor, ecosistema y laminador válidos en todas", bad.length === 0, bad.map((p) => p.id));
  check("los 4 ecosistemas tienen al menos una impresora", ECOS.every((e) => PRINTERS.some((p) => p.ecosystem === e)));
  check(
    "laminadores recomendados cubren Creality Print, OrcaSlicer, Bambu Studio, PrusaSlicer y FlashPrint",
    ["creality-print", "orcaslicer", "bambu-studio", "prusaslicer", "flashprint"].every((s) => PRINTERS.some((p) => p.slicer === s))
  );
  check(
    "las impresoras Klipper ofrecen los puertos 7125 / 4408 / 80",
    PRINTERS.filter((p) => p.ecosystem === "klipper-moonraker").every((p) => [7125, 4408, 80].every((port) => p.networkPorts.includes(port)))
  );

  const k2 = getPrinter(K2_SE_ID) as PrinterModel;
  check(
    "K2 SE: 220 × 215 × 245 mm, boquilla 0.4, directo, Klipper, Creality Print",
    k2.bed.x === 220 && k2.bed.y === 215 && k2.bed.z === 245 && k2.nozzleMm === 0.4 && k2.extruder === "direct" &&
      k2.ecosystem === "klipper-moonraker" && k2.slicer === "creality-print"
  );
  const adv3 = getPrinter("flashforge-adventurer-3") as PrinterModel;
  check("Adventurer 3: 150³ mm y adaptador flashforge-tcp (integración existente)", adv3.bed.x === 150 && adv3.bed.z === 150 && adv3.ecosystem === "flashforge-tcp");
  check("Prusa MINI+ es Bowden", getPrinter("prusa-mini-plus")?.extruder === "bowden");

  let profileProblems: string[] = [];
  for (const p of PRINTERS) {
    for (const m of MATERIALS) {
      for (const pr of PROFILES) {
        const v = p.profiles[m.id]?.[pr.id];
        if (!v) {
          profileProblems.push(`${p.id}:${m.id}:${pr.id} falta`);
          continue;
        }
        if (v.layerHeight <= 0 || v.layerHeight > p.nozzleMm * 0.8) profileProblems.push(`${p.id} capa ${v.layerHeight}`);
        if (v.nozzleTemp > p.maxNozzleC || v.bedTemp > p.maxBedC) profileProblems.push(`${p.id} temp ${v.nozzleTemp}/${v.bedTemp}`);
        if (v.speed < 20 || v.speed > p.practicalSpeed) profileProblems.push(`${p.id} velocidad ${v.speed}`);
      }
    }
  }
  check(`9 perfiles por impresora (${PRINTERS.length * 9}) dentro de los límites de cada máquina`, profileProblems.length === 0, profileProblems.slice(0, 5));
  profileProblems = PRINTERS.filter((p) => {
    const s = p.profiles.pla;
    return !(s.fast.layerHeight >= s.standard.layerHeight && s.strong.wallCount > s.standard.wallCount && s.strong.infillPercent > s.standard.infillPercent && s.fast.speed >= s.standard.speed);
  }).map((p) => p.id);
  check("Rápido = capa gruesa y veloz; Fuerte = más paredes y relleno", profileProblems.length === 0, profileProblems);
  check("ABS en impresora abierta avisa (K2 SE)", Boolean(k2.profiles.abs.standard.warning) && !k2.profiles.pla.standard.warning);
  check("ABS en impresora cerrada no avisa (P1S)", !getPrinter("bambu-p1s")?.profiles.abs.standard.warning);
  check("Adventurer 3 limita ABS a 240 °C", adv3.profiles.abs.standard.nozzleTemp === 240 && Boolean(adv3.profiles.abs.standard.warning));

  // --------------------------------------------------------------------------
  console.log("\n2) Verificación de volumen de cama");
  const cube = (n: number): BedVolume => ({ x: n, y: n, z: n });
  let f = checkBedFit(cube(200), k2.bed);
  check("K2 SE: 200³ mm cabe", f.fits && f.scalePercent === 100 && f.limitingAxis === null);
  f = checkBedFit({ x: 230, y: 100, z: 100 }, k2.bed);
  check("K2 SE: 230 mm de ancho no cabe → escala 95.6 % (eje X)", !f.fits && f.scalePercent === 95.6 && f.limitingAxis === "x", f);
  f = checkBedFit({ x: 214, y: 220, z: 100 }, k2.bed);
  check("K2 SE: 214 × 220 no cabe (fondo 215), pero sí girada 90°", !f.fits && f.fitsRotated, f);
  f = checkBedFit({ x: 100, y: 100, z: 300 }, k2.bed);
  check("K2 SE: 300 mm de alto → escala 81.6 % (eje Z)", !f.fits && f.scalePercent === 81.6 && f.limitingAxis === "z", f);
  f = checkBedFit(cube(150), adv3.bed);
  check("Adventurer 3: 150³ mm cabe justo", f.fits);
  f = checkBedFit(cube(160), adv3.bed);
  check("Adventurer 3: 160³ mm → escala 93.7 %", !f.fits && f.scalePercent === 93.7, f);
  // El % sugerido siempre cabe de verdad (todas las impresoras, piezas variadas).
  const pieces: BedVolume[] = [cube(400), { x: 333, y: 120, z: 90 }, { x: 80, y: 512, z: 40 }, { x: 260, y: 260, z: 290 }, { x: 1000, y: 3, z: 3 }];
  const wrongScale: string[] = [];
  for (const p of PRINTERS) {
    for (const piece of pieces) {
      const r = checkBedFit(piece, p.bed);
      if (r.fits) continue;
      const k = r.scalePercent / 100;
      const after = checkBedFit({ x: piece.x * k, y: piece.y * k, z: piece.z * k }, p.bed);
      if (!after.fits || r.scalePercent <= 0 || r.scalePercent >= 100) wrongScale.push(`${p.id} ${JSON.stringify(piece)} → ${r.scalePercent}`);
    }
  }
  check(`la escala sugerida siempre hace caber la pieza (${PRINTERS.length} impresoras × ${pieces.length} piezas)`, wrongScale.length === 0, wrongScale.slice(0, 3));

  // --------------------------------------------------------------------------
  console.log("\n3) Anti-SSRF del adaptador Klipper");
  const accepted = ["192.168.1.45", "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.0.1"];
  const rejected = [
    "8.8.8.8", "1.1.1.1", "127.0.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "172.32.0.1", "172.15.0.1",
    "192.169.1.1", "192.168.1.0", "192.168.1.255", "192.168.1.256", "192.168.1", "010.0.0.1", "0x0a.0.0.1",
    "192.168.1.45.nip.io", "localhost", "::1", "[::ffff:192.168.1.1]", "::ffff:192.168.1.1", "printer.local",
    " 192.168.1.4", "192.168.1.4/24", "192.168.1.4:7125", "", "203.0.113.7",
  ];
  check("acepta las IPv4 privadas RFC 1918", accepted.every(isRfc1918IPv4), accepted.filter((ip) => !isRfc1918IPv4(ip)));
  const leaked = rejected.filter(isRfc1918IPv4);
  check(`rechaza ${rejected.length} destinos públicos, loopback, metadatos, IPv6, hosts y formatos raros`, leaked.length === 0, leaked);
  check("puertos: 7125 / 4408 / 80 sí", [7125, 4408, 80].every((port) => typeof parseKlipperTarget("192.168.1.45", port) !== "string"));
  check(
    "puertos: 22, 443, 8080, 8899, 6379, 0 y texto no",
    [22, 443, 8080, 8899, 6379, 0, "abc", 7125.5].every((port) => typeof parseKlipperTarget("192.168.1.45", port) === "string")
  );
  check("puerto por defecto 7125", (parseKlipperTarget("192.168.1.45", undefined) as { port: number }).port === 7125);

  calls.length = 0;
  for (const ip of ["8.8.8.8", "169.254.169.254", "127.0.0.1", "metadata.google.internal"]) {
    await rejects(() => readKlipperStatus({ ip, port: 7125 }));
    await rejects(() => uploadAndPrintKlipper({ ip, port: 7125 }, "x.gcode", new Uint8Array([71, 49])));
  }
  await rejects(() => readKlipperStatus({ ip: "192.168.1.45", port: 22 }));
  check("IPs públicas / metadatos / puertos no permitidos: 0 peticiones de red", calls.length === 0, calls.map((c) => c.url));

  calls.length = 0;
  responder = (url) => {
    if (url.endsWith("/printer/info")) return json({ result: { state: "ready", hostname: "K2SE-ejemplo", software_version: "v0.12" } });
    if (url.includes("/printer/objects/query"))
      return json({
        result: {
          status: {
            extruder: { temperature: 219.6, target: 220 },
            heater_bed: { temperature: 59.8, target: 60 },
            print_stats: { state: "printing", filename: "pieza.gcode" },
            virtual_sdcard: { progress: 0.423 },
          },
        },
      });
    if (url.endsWith("/server/files/upload")) return json({ result: { item: { path: "ANDROS_pieza.gcode", root: "gcodes" }, print_started: true } });
    return new Response("", { status: 404 });
  };
  const st = await readKlipperStatus({ ip: "192.168.1.45", port: 4408 });
  check("estado Moonraker: temperaturas, trabajo y 42 %", st.ok && st.temperatures?.extruder?.current === 220 && st.progress?.percent === 42 && st.progress.printing, st);
  check("estado: URL local exacta y sin seguir redirecciones", calls[0]?.url === "http://192.168.1.45:4408/printer/info" && calls.every((c) => c.init?.redirect === "error"), calls.map((c) => c.url));
  calls.length = 0;
  const up = await uploadAndPrintKlipper({ ip: "10.0.0.20", port: 80 }, "Pieza ñandú.gcode", new Uint8Array(new TextEncoder().encode("G28\nG1 X10\n")));
  const form = calls[0]?.init?.body as FormData | undefined;
  check("subida: POST /server/files/upload en el puerto 80", calls[0]?.url === "http://10.0.0.20/server/files/upload" && calls[0]?.init?.method === "POST");
  check("subida: root=gcodes y print=true (empieza a imprimir)", form?.get("root") === "gcodes" && form?.get("print") === "true" && up.ok);
  check("nombre de archivo saneado", safeGcodeFileName("Pieza ñandú/../x.gcode") === "Pieza_nandu_x.gcode", safeGcodeFileName("Pieza ñandú/../x.gcode"));
  responder = () => new Response("", { status: 401 });
  const authMsg = await rejects(() => readKlipperStatus({ ip: "192.168.1.45", port: 7125 }));
  check("401 de Moonraker → mensaje claro de trusted_clients", Boolean(authMsg?.includes("trusted_clients")), authMsg);

  const route = read("src/app/api/printer/klipper/route.ts");
  check("la ruta valida con parseKlipperTarget (GET y POST)", (route.match(/parseKlipperTarget\(/g) ?? []).length >= 2);
  check("la ruta se desactiva en hosting remoto (Vercel)", /IS_REMOTE_HOST\)\s*return remoteRefusal\(\)/.test(route) && (route.match(/remoteRefusal\(\)/g) ?? []).length >= 3);
  check("la ruta no usa la validación laxa de FlashForge (169.254)", !route.includes("isPrivateIPv4"));
  const main = read("electron/main.cjs");
  check(
    "Electron: Klipper con assertTrusted + parseKlipperTarget",
    /andros:klipper:status[\s\S]{0,200}assertTrusted[\s\S]{0,200}parseKlipperTarget/.test(main) &&
      /andros:klipper:print[\s\S]{0,200}assertTrusted[\s\S]{0,200}parseKlipperTarget/.test(main)
  );
  check(
    "Electron: laminadores con lista cerrada, extensión permitida y spawn sin shell",
    main.includes("SLICER_EXTENSIONS") && /spawn\(exe, \[target\], \{[^}]*shell: false/.test(main) && /andros:slicers:open[\s\S]{0,120}assertTrusted/.test(main)
  );

  // --------------------------------------------------------------------------
  console.log("\n4) ¿El G-code es para esta impresora?");
  check("G-code de FlashForge en la K2 SE → bloqueado", inspectGcode(";FLAVOR:FlashForge\nG28", k2).verdict === "blocked");
  check("printer_model = Creality K2 SE → coincide", inspectGcode("; generated by OrcaSlicer\n; printer_model = Creality K2 SE\nG28", k2).verdict === "match");
  check("sin modelo declarado → pide confirmación", inspectGcode("G28\nG1 X1", k2).verdict === "unknown");
  const k1 = getPrinter("creality-k1") as PrinterModel;
  check("G-code de K1 Max enviado a K1 → otra máquina", inspectGcode("; printer_model = Creality K1 Max", k1).verdict === "mismatch");
  check("«Bambu Lab A1 mini» se reconoce como A1 Mini (no Prusa MINI+)", matchPrinterModel("Bambu Lab A1 mini")?.id === "bambu-a1-mini");

  // --------------------------------------------------------------------------
  console.log("\n5) Telemetría sin variables de entorno");
  const store = new Map<string, string>([["andros-cookie-consent", JSON.stringify({ version: 1, choice: "all", decidedAt: new Date().toISOString() })]]);
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    matchMedia: () => ({ matches: true }),
  };
  calls.length = 0;
  check("NEXT_PUBLIC_CLARITY_ID / NEXT_PUBLIC_POSTHOG_KEY no definidas", !isTelemetryConfigured());
  for (const event of TELEMETRY_EVENTS) track(event, {} as never);
  track("deliverable_exported", { type: "pdf", ai: true });
  check("con consentimiento pero sin variables: 0 peticiones y nada guardado", calls.length === 0 && !store.has("andros-telemetry-id"), calls.length);
  check("8 eventos clave definidos", TELEMETRY_EVENTS.length === 8);
  const clean = sanitizeProps("printer_selected", { printer: "creality-k2-se", ecosystem: "klipper-moonraker", nota: "Paciente Juan Pérez" });
  check("propiedades: solo claves permitidas", JSON.stringify(clean) === JSON.stringify({ printer: "creality-k2-se", ecosystem: "klipper-moonraker" }), clean);
  const free = sanitizeProps("deliverable_exported", { type: "Informe de María con diagnóstico", ai: true });
  check("propiedades: el texto libre se descarta", !("type" in free) && free.ai === true, free);
  const gate = read("src/components/legal/AnalyticsGate.tsx");
  check("el proveedor se carga con dynamic() y solo con variables + consentimiento", /dynamic\(\(\) => import\("@\/components\/legal\/TelemetryProvider"\)/.test(gate) && gate.includes("TELEMETRY_ENV && allowed"));
  const masked = ["src/components/shared/EngineeringNode.tsx", "src/components/shared/OracleModal.tsx", "src/components/social/SocialDialog.tsx", "src/components/share/PublicBoardClient.tsx"];
  check("Clarity enmascara tarjetas, Oráculo IA, diálogos de fichas/fórmulas y Vista Invitado", masked.every((f) => read(f).includes('data-clarity-mask="true"')), masked.filter((f) => !read(f).includes('data-clarity-mask="true"')));

  // --------------------------------------------------------------------------
  console.log("\n6) Carga diferida (solo Modo Experto, bajo demanda)");
  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  };
  walk(path.join(ROOT, "src"));
  const LAZY_OK = /^src\/(lib\/printers\/|components\/nodes\/Print3DModal\.tsx$|app\/api\/printer\/klipper\/)/;
  const importers = srcFiles.filter((f) => /from\s+["']@\/lib\/printers\//.test(read(f)) && !LAZY_OK.test(f));
  check("solo Print3DModal (diferido), la ruta Klipper y el propio módulo importan @/lib/printers", importers.length === 0, importers);
  const fileNode = read("src/components/nodes/FileNodeView.tsx");
  check("FileNodeView carga Print3DModal con dynamic(ssr: false)", /dynamic\(\s*\(\) => import\("@\/components\/nodes\/Print3DModal"\)/.test(fileNode));
  check("el botón y el diálogo de impresión exigen Modo Experto", fileNode.includes("useIsExpert()") && fileNode.includes("canPrint3D && expert") && fileNode.includes("isPrintOpen && canOpenPrinter"));

  const nextDir = path.join(ROOT, ".next");
  const manifestPath = path.join(nextDir, "server", "app", "page_client-reference-manifest.js");
  const buildManifestPath = path.join(nextDir, "build-manifest.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(buildManifestPath)) {
    check("existe un build de producción (ejecuta `npm run build` antes)", false);
  } else {
    const initial = new Set<string>();
    const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8")) as Record<string, unknown>;
    for (const key of ["polyfillFiles", "rootMainFiles", "lowPriorityFiles"]) {
      for (const file of (buildManifest[key] as string[] | undefined) ?? []) if (file.endsWith(".js")) initial.add(file);
    }
    const entryJson = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(fs.readFileSync(manifestPath, "utf8"))?.[1];
    if (entryJson) {
      const parsed = JSON.parse(entryJson) as Record<string, { entryJSFiles?: Record<string, string[]> }>;
      for (const value of Object.values(parsed)) {
        for (const files of Object.values(value.entryJSFiles ?? {})) for (const file of files) if (file.endsWith(".js")) initial.add(file);
      }
    }
    const readChunk = (file: string) => {
      const full = path.join(nextDir, file.replace(/^\/?_next\//, ""));
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    };
    const initialFiles = [...initial].filter((file) => readChunk(file));
    const totalKb = Math.round(initialFiles.reduce((n, file) => n + Buffer.byteLength(readChunk(file)), 0) / 1024);
    check(`se localizaron los ${initialFiles.length} archivos JS iniciales de «/» (${totalKb} KB)`, initialFiles.length > 0);
    // Firmas del registro y de los adaptadores (no aparecen en otro código de Andros).
    const SIGNATURE = /creality-k2-se|bambu-slicer-handoff|generic-slicer-download|andros-klipper-targets/;
    const leaking = initialFiles.filter((file) => SIGNATURE.test(readChunk(file)));
    check("ningún archivo inicial contiene el registro de impresoras ni los adaptadores", leaking.length === 0, leaking);
    const chunkDir = path.join(nextDir, "static", "chunks");
    const lazyChunks = fs.existsSync(chunkDir) ? fs.readdirSync(chunkDir).filter((file) => file.endsWith(".js")) : [];
    const lazyRegistry = lazyChunks.filter(
      (file) => !initial.has(`static/chunks/${file}`) && SIGNATURE.test(fs.readFileSync(path.join(chunkDir, file), "utf8"))
    );
    check("el registro vive en un fragmento diferido (se descarga al abrir «Imprimir en 3D»)", lazyRegistry.length > 0);
  }

  console.log(`\n${passed} correctas, ${failed} fallidas.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
