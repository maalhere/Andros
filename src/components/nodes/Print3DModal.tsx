"use client";

import { celebrate } from "@/lib/effects/celebrate";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Gem,
  LoaderCircle,
  Minimize2,
  MonitorDown,
  Printer,
  Radar,
  RefreshCw,
  ShieldCheck,
  Usb,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { getCloudFileLink } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { formatMm, type ModelDimensions } from "@/components/nodes/Model3DPreview";
import { isSliceable, loadTriangleSoup, triangleBounds } from "@/lib/slicer/meshLoader";
import {
  ADV3_BED_MM,
  QUALITY_PRESETS,
  describeSettings,
  generateFlashForgeGx,
  prepareMesh,
  renderMeshImage,
  type QualityId,
  type SliceStats,
} from "@/lib/slicer/flashforgeGxGenerator";
import type { PrinterStatus } from "@/lib/printer/flashforgeShared";
import {
  DESKTOP_DOWNLOAD_URL,
  canReachLocalNetwork,
  discoverPrinters,
  fetchPrinterStatus,
  sendPrintJob,
} from "@/lib/printer/printerClient";
import { requestFileDownload } from "@/lib/downloadWithPermission";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { formatScale, isIdentityScale, scaleKey, type ModelScale } from "@/lib/3d/modelScale";
import { AutoSupportsToggle, PreparedStlButton, type SupportStatus } from "@/components/nodes/ModelPrepControls";

// ============================================================================
// IMPRIMIR EN 3D — TAN FÁCIL COMO IMPRIMIR UN DOCUMENTO
//   · Una sola vista, como el diálogo de impresión de Google Docs:
//     vista previa a la izquierda, opciones a la derecha y un botón gigante.
//   · Destino por defecto: FlashForge Adventurer 3 (Automático). Andros lamina
//     la pieza en el navegador y genera un .gx listo para imprimir.
//   · Autodetección: al abrir el modal, Andros busca sola la Adventurer 3 en
//     el Wi-Fi (app de Windows o npm run dev) y guarda su IP y nombre.
//     "Imprimir Ahora" lamina el .gx y lo envía en 1 clic: la impresora
//     empieza a calentar e imprimir sola.
//   · Web pública (Vercel): no puede ver el Wi-Fi local → descarga del .gx
//     listo + botón para instalar la app de Windows.
//   · Sin Wi-Fi: descarga del .gx (USB / FlashPrint) con instrucciones de 2 pasos.
//   · Bambu Lab, Prusa y Cura como destinos secundarios (abren su programa).
// ============================================================================

const PRINTABLE_EXTENSIONS = ["stl", "obj", "3mf", "step", "stp", "gcode"];

export function isPrintable3D(extension: string): boolean {
  return PRINTABLE_EXTENSIONS.includes(extension.toLowerCase());
}

type Destination = "adv3" | "bambu" | "prusa" | "cura";

const DESTINATIONS: { id: Destination; label: string; program: string; scheme: string }[] = [
  { id: "adv3", label: "FlashForge Adventurer 3 (Automático)", program: "FlashPrint", scheme: "" },
  { id: "bambu", label: "Bambu Lab · abrir en Bambu Studio", program: "Bambu Studio", scheme: "bambustudio://open?file=" },
  { id: "prusa", label: "Prusa · abrir en PrusaSlicer", program: "PrusaSlicer", scheme: "prusaslicer://open?file=" },
  { id: "cura", label: "Otra impresora · abrir en Cura", program: "Cura", scheme: "cura://open?file=" },
];

const QUALITY_ORDER: { id: QualityId; icon: React.ReactNode; recommended?: boolean }[] = [
  { id: "draft", icon: <Zap className="w-5 h-5" /> },
  { id: "standard", icon: <ShieldCheck className="w-5 h-5" />, recommended: true },
  { id: "high", icon: <Gem className="w-5 h-5" /> },
];

const FLASHPRINT_DOWNLOAD_URL = "https://www.flashforge.com/download-center/63";

/** Materiales sugeridos (patrocinios / afiliados): cambia `href` por el enlace real. */
const SPONSORED_MATERIALS: { name: string; note: string; href: string }[] = [
  { name: "PLA estándar 1.75 mm", note: "económico y fácil", href: "https://www.google.com/search?q=filamento+PLA+1.75mm" },
  { name: "PETG 1.75 mm", note: "resistente y flexible", href: "https://www.google.com/search?q=filamento+PETG+1.75mm" },
];

const DESTINATION_KEY = "andros-print-printer";
const LEGACY_SLICER_KEY = "andros-print-program";
const ADV3_IP_KEY = "andros-adv3-ip";
const ADV3_PORT_KEY = "andros-adv3-port";
const ADV3_NAME_KEY = "andros-adv3-name";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sin acceso a localStorage: no pasa nada.
  }
}

function readSavedDestination(): Destination {
  const saved = readStorage(DESTINATION_KEY);
  if (saved === "adv3" || saved === "bambu" || saved === "prusa" || saved === "cura") return saved;
  if (saved === "other") {
    const legacy = readStorage(LEGACY_SLICER_KEY);
    if (legacy === "bambu" || legacy === "prusa" || legacy === "cura") return legacy;
  }
  return "adv3";
}

/** Nombre limpio: ANDROS_[nombre] (sin extensión). */
function cleanBaseName(pieceName: string, fileName: string): string {
  const base = (pieceName || fileName.replace(/\.[^.]+$/, ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `ANDROS_${base || "pieza"}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.max(1, Math.round((seconds % 3600) / 60));
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function accentRgb(): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [201, 90, 59];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function renderPreview(soup: Float32Array): string | null {
  const width = 360;
  const height = 270;
  const rgba = renderMeshImage(prepareMesh(soup), width, height, accentRgb());
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

const GX_DESCRIPTION = "Pieza laminada por Andros, lista para la FlashForge Adventurer 3 (USB o FlashPrint).";

/** Descarga con permiso previo del usuario. `true` si se inició. */
function downloadBytes(bytes: Uint8Array<ArrayBuffer>, name: string, description = GX_DESCRIPTION): Promise<boolean> {
  return requestFileDownload({ filename: name, blobOrUrl: bytes, description });
}

type MeshState =
  | { phase: "loading" }
  | { phase: "ready"; soup: Float32Array; size: { x: number; y: number; z: number }; preview: string | null }
  | { phase: "error" }
  | { phase: "none" };

type WifiState = "none" | "searching" | "checking" | "online" | "offline";
type JobPhase = "idle" | "slicing" | "sending" | "printing" | "file-ready" | "error";

interface PrintJob {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  stats: SliceStats | null;
}

interface Print3DModalProps {
  /** Nombre que el usuario le dio a la pieza (título del nodo). */
  pieceName: string;
  fileName: string;
  extension: string;
  downloadUrl: string;
  storagePath?: string;
  /** Medidas originales del archivo (al 100 %). */
  dimensions: ModelDimensions | null;
  /** Escala guardada en el nodo (se aplica al laminar y al exportar). */
  scale: ModelScale;
  supportsEnabled: boolean;
  onSupportsChange: (enabled: boolean) => void;
  onClose: () => void;
}

type SupportResultState =
  | { key: string; phase: "ready"; soup: Float32Array; count: number; capped: boolean }
  | { key: string; phase: "error" };

/** Pieza escalada + apoyada en la cama, y sus soportes (si se piden). */
async function preparePart(
  soup: Float32Array,
  scale: ModelScale,
  withSupports: boolean,
  cached: Float32Array | null,
  signal?: AbortSignal
): Promise<{ part: Float32Array; supports: Float32Array | null }> {
  const { generateAutoSupports, scaleAndGroundSoup } = await import("@/lib/3d/autoSupports");
  const part = scaleAndGroundSoup(soup, scale);
  if (!withSupports) return { part, supports: null };
  const supports = cached ?? (await generateAutoSupports(part, { signal })).soup;
  return { part, supports };
}

function SettingsList({ settings }: { settings: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-1.5 text-xs">
      {settings.map((setting) => (
        <div key={setting.label} className="flex justify-between gap-3">
          <dt className="text-andros-muted">{setting.label}</dt>
          <dd className="text-andros-primary font-medium text-right">{setting.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3 sm:items-start">
      <span className="text-xs font-semibold text-andros-muted sm:pt-2.5">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const Print3DModal: React.FC<Print3DModalProps> = ({
  pieceName,
  fileName,
  extension,
  downloadUrl,
  storagePath,
  dimensions,
  scale: userScale,
  supportsEnabled,
  onSupportsChange,
  onClose,
}) => {
  const isSignedIn = useCloudStore((s) => s.user !== null);
  const ext = extension.toLowerCase();
  const isGcode = ext === "gcode";
  const sliceable = isSliceable(ext);
  const baseName = cleanBaseName(pieceName, fileName);

  const [destination, setDestination] = useState<Destination>(readSavedDestination);
  const [quality, setQuality] = useState<QualityId>("standard");
  const [autoScale, setAutoScale] = useState(false);
  const [mesh, setMesh] = useState<MeshState>(() => (sliceable ? { phase: "loading" } : { phase: "none" }));

  // Impresión / archivo preparado
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** El último error fue del envío por Wi-Fi (el archivo laminado sigue listo). */
  const [wifiFailed, setWifiFailed] = useState(false);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const jobRef = useRef<{ key: string; job: PrintJob } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Wi-Fi (solo si Andros puede ver la red local: app de Windows o npm run dev)
  const [lanCapable] = useState(canReachLocalNetwork);
  const [ip, setIp] = useState(() => readStorage(ADV3_IP_KEY) ?? "");
  const [port, setPort] = useState(() => readStorage(ADV3_PORT_KEY) ?? "8899");
  const [printerName, setPrinterName] = useState(() => readStorage(ADV3_NAME_KEY));
  const [wifi, setWifi] = useState<WifiState>(() => {
    if (!lanCapable) return "none";
    if (readStorage(ADV3_IP_KEY)) return "checking";
    return readSavedDestination() === "adv3" ? "searching" : "none";
  });
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [editingWifi, setEditingWifi] = useState(false);
  const [searchMissed, setSearchMissed] = useState(false);
  const checkingRef = useRef(false);
  const searchingRef = useRef(false);
  /** true mientras se transfiere el archivo: la Adventurer 3 solo admite 1 socket. */
  const sendingRef = useRef(false);
  const autoConnectRef = useRef(false);
  const wifiRef = useRef<WifiState>(wifi);
  useEffect(() => {
    wifiRef.current = wifi;
  }, [wifi]);

  // Otros programas
  const [cloudLink, setCloudLink] = useState<string | null>(/^https?:/.test(downloadUrl) ? downloadUrl : null);
  const [openHint, setOpenHint] = useState<"none" | "tried" | "needs-cloud">("none");

  const isAdv3 = destination === "adv3";
  const dest = DESTINATIONS.find((d) => d.id === destination) ?? DESTINATIONS[0];
  const preset = QUALITY_PRESETS[quality];

  // --- Medidas y verificación de cabida ---------------------------------------
  // La escala del nodo se aplica primero; el ajuste automático va encima.
  const baseSize =
    mesh.phase === "ready"
      ? mesh.size
      : dimensions
        ? { x: dimensions.widthMm, y: dimensions.depthMm, z: dimensions.heightMm }
        : null;
  const size = baseSize
    ? { x: baseSize.x * userScale[0], y: baseSize.y * userScale[1], z: baseSize.z * userScale[2] }
    : null;
  const biggest = size ? Math.max(size.x, size.y, size.z) : 0;
  const fits = size ? biggest <= ADV3_BED_MM + 0.05 : true;
  const fitPercent = size && biggest > 0 ? Math.floor((ADV3_BED_MM / biggest) * 1000) / 10 : 100;
  const fitScale = !fits && autoScale ? fitPercent / 100 : 1;
  const effectiveScale: ModelScale = [userScale[0] * fitScale, userScale[1] * fitScale, userScale[2] * fitScale];
  const [ex, ey, ez] = effectiveScale;
  const shown = size ? { x: size.x * fitScale, y: size.y * fitScale, z: size.z * fitScale } : null;
  const sizeText = shown ? `${formatMm(shown.x)} × ${formatMm(shown.y)} × ${formatMm(shown.z)} mm` : null;
  const canAutoPrint = isGcode || (sliceable && mesh.phase === "ready" && (fits || autoScale));
  const busy = phase === "slicing" || phase === "sending";

  // --- Cargar la pieza (vista previa + medidas reales) ------------------------
  useEffect(() => {
    if (!sliceable || !downloadUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const soup = await loadTriangleSoup(downloadUrl, ext);
        if (cancelled) return;
        const b = triangleBounds(soup);
        const meshSize = { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
        let preview: string | null = null;
        try {
          preview = renderPreview(soup);
        } catch {
          // Sin vista previa: se imprime igual.
        }
        if (!cancelled) setMesh({ phase: "ready", soup, size: meshSize, preview });
      } catch {
        if (!cancelled) setMesh({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [downloadUrl, ext, sliceable]);

  // --- Soportes automáticos (con la escala efectiva) ---------------------------
  const [supportResult, setSupportResult] = useState<SupportResultState | null>(null);
  const supportKey = supportsEnabled && mesh.phase === "ready" ? `${ex},${ey},${ez}` : null;
  const supportView = supportKey && supportResult?.key === supportKey ? supportResult : null;
  const readySupports = supportView?.phase === "ready" ? supportView.soup : null;

  useEffect(() => {
    if (!supportKey || mesh.phase !== "ready") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { generateAutoSupports, scaleAndGroundSoup } = await import("@/lib/3d/autoSupports");
        const part = scaleAndGroundSoup(mesh.soup, [ex, ey, ez]);
        const result = await generateAutoSupports(part, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSupportResult({
          key: supportKey,
          phase: "ready",
          soup: result.soup,
          count: result.pillars.length,
          capped: result.capped,
        });
      } catch {
        if (!controller.signal.aborted) setSupportResult({ key: supportKey, phase: "error" });
      }
    })();
    return () => controller.abort();
  }, [supportKey, mesh, ex, ey, ez]);

  const supportStatus: SupportStatus = !supportsEnabled
    ? { phase: "off" }
    : !supportView
      ? { phase: "computing" }
      : supportView.phase === "error"
        ? { phase: "error" }
        : { phase: "ready", count: supportView.count, capped: supportView.capped };

  // Enlace temporal de la nube (lo usan Bambu Studio / PrusaSlicer / Cura).
  useEffect(() => {
    if (!storagePath || !isSignedIn) return;
    let cancelled = false;
    void getCloudFileLink(storagePath).then((link) => {
      if (!cancelled && link) setCloudLink(link);
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath, isSignedIn]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // --- Wi-Fi -------------------------------------------------------------------
  /** Comprueba la impresora en `targetIp`. Devuelve true si respondió. */
  const checkPrinter = useCallback(
    async (targetIp: string, targetPort: string, quiet = false): Promise<boolean> => {
      // Sondeo en pausa durante la transferencia (evita ECONNRESET en el 8899).
      if (sendingRef.current) return true;
      if (checkingRef.current || !targetIp.trim()) return false;
      checkingRef.current = true;
      if (!quiet) setWifi("checking");
      try {
        const data = await fetchPrinterStatus(targetIp, targetPort.trim() || "8899");
        if (data.busy) {
          // Ocupada recibiendo un archivo: está en línea, se conserva el último estado.
          if (!quiet) setWifi("online");
          return true;
        }
        setStatus(data);
        if (!quiet || data.ok) setWifi(data.ok ? "online" : "offline");
        return data.ok;
      } catch {
        setStatus({ ok: false, error: "No se pudo contactar con la impresora desde este equipo." });
        if (!quiet) setWifi("offline");
        return false;
      } finally {
        checkingRef.current = false;
      }
    },
    []
  );

  /** Busca la Adventurer 3 en el Wi-Fi, guarda su IP y nombre y la conecta. */
  const findPrinter = useCallback(async () => {
    if (searchingRef.current) return;
    searchingRef.current = true;
    setWifi("searching");
    setSearchMissed(false);
    let foundIp: string | null = null;
    let foundPort = "8899";
    try {
      const result = await discoverPrinters();
      const best = result.printers?.find((p) => p.isAdventurer3) ?? result.printers?.[0];
      if (result.ok && best) {
        foundIp = best.ip;
        foundPort = String(best.port || 8899);
        const label = best.name || best.type || "FlashForge Adventurer 3";
        setIp(foundIp);
        setPort(foundPort);
        setPrinterName(label);
        writeStorage(ADV3_IP_KEY, foundIp);
        writeStorage(ADV3_PORT_KEY, foundPort);
        writeStorage(ADV3_NAME_KEY, label);
      }
    } catch {
      // Sin respuesta del buscador: queda USB / FlashPrint.
    } finally {
      searchingRef.current = false;
    }
    if (foundIp) {
      await checkPrinter(foundIp, foundPort);
    } else {
      setWifi("none");
      setSearchMissed(true);
    }
  }, [checkPrinter]);

  // Al abrir con la Adventurer 3: comprueba la IP guardada y, si no hay (o ya
  // no responde porque el router le dio otra), la busca sola en el Wi-Fi.
  useEffect(() => {
    if (!lanCapable || !isAdv3 || autoConnectRef.current) return;
    autoConnectRef.current = true;
    const savedIp = readStorage(ADV3_IP_KEY);
    void (async () => {
      if (savedIp && (await checkPrinter(savedIp, readStorage(ADV3_PORT_KEY) ?? "8899"))) return;
      await findPrinter();
    })();
  }, [lanCapable, isAdv3, checkPrinter, findPrinter]);

  // Mientras imprime: estado en vivo cada 5 s.
  useEffect(() => {
    if (phase !== "printing" || !ip) return;
    const id = window.setInterval(() => void checkPrinter(ip, port, true), 5000);
    return () => window.clearInterval(id);
  }, [phase, ip, port, checkPrinter]);

  const connectWifi = () => {
    writeStorage(ADV3_IP_KEY, ip.trim());
    writeStorage(ADV3_PORT_KEY, port.trim() || "8899");
    setPrinterName(null);
    setSearchMissed(false);
    setEditingWifi(false);
    void checkPrinter(ip, port);
  };

  const searchAgain = () => {
    setEditingWifi(false);
    void findPrinter();
  };

  // --- Cambios de opciones ------------------------------------------------------
  const resetResult = () => {
    if (phase === "file-ready" || phase === "error") setPhase("idle");
    setError(null);
    setWifiFailed(false);
    setShowSteps(false);
  };

  const chooseDestination = (next: Destination) => {
    setDestination(next);
    setOpenHint("none");
    resetResult();
    writeStorage(DESTINATION_KEY, next);
  };

  const chooseQuality = (next: QualityId) => {
    setQuality(next);
    resetResult();
  };

  const toggleAutoScale = (on: boolean) => {
    setAutoScale(on);
    resetResult();
  };

  const toggleSupports = (on: boolean) => {
    onSupportsChange(on);
    resetResult();
  };

  // --- Preparar el trabajo (.gx laminado, o el .gcode tal cual) ----------------
  const ensureJob = async (): Promise<PrintJob> => {
    const key = `${quality}|${scaleKey(effectiveScale)}|${supportsEnabled ? "soportes" : "sin"}`;
    if (jobRef.current?.key === key) return jobRef.current.job;

    let prepared: PrintJob;
    if (isGcode) {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error("No se pudo leer el archivo G-code.");
      prepared = { bytes: new Uint8Array(await res.arrayBuffer()), fileName: `${baseName}.g`, stats: null };
    } else if (mesh.phase === "ready") {
      setPhase("slicing");
      setProgress(0);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Escala del nodo (+ ajuste a la cama) y soportes fusionados con la pieza.
      const { part, supports } = await preparePart(
        mesh.soup,
        effectiveScale,
        supportsEnabled,
        readySupports,
        controller.signal
      );
      const { mergeSoups } = await import("@/lib/3d/exportStl");
      const result = await generateFlashForgeGx(mergeSoups(part, supports), {
        quality,
        scale: 1,
        baseName,
        signal: controller.signal,
        onProgress: (f) => setProgress(f),
      });
      prepared = { bytes: result.bytes, fileName: result.fileName, stats: result.stats };
    } else {
      throw new Error("La pieza todavía no está lista.");
    }
    jobRef.current = { key, job: prepared };
    setJob(prepared);
    return prepared;
  };

  /** Botón principal "Imprimir Ahora". */
  const printNow = async () => {
    if (busy || !canAutoPrint) return;
    setError(null);
    setWifiFailed(false);
    setShowSteps(false);

    let prepared: PrintJob;
    try {
      prepared = await ensureJob();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "No se pudo preparar la pieza.");
      return;
    }

    // Se lee el estado más reciente: la búsqueda pudo terminar mientras laminaba.
    if (wifiRef.current !== "online") {
      // Web pública: el .gx listo se descarga directamente.
      if (!lanCapable) {
        void downloadBytes(prepared.bytes, prepared.fileName).then((ok) => {
          if (ok) void celebrate();
        });
      }
      setPhase("file-ready");
      return;
    }

    setPhase("sending");
    sendingRef.current = true;
    let sent = false;
    try {
      const data = await sendPrintJob(ip, port.trim() || "8899", prepared.fileName, prepared.bytes);
      if (!data.ok) throw new Error(data.error ?? "La impresora no aceptó el trabajo.");
      sent = true;
      setWifiFailed(false);
      setPhase("printing");
      void celebrate();
    } catch (e) {
      setPhase("error");
      setWifiFailed(true);
      setError(
        `No se pudo enviar por Wi-Fi. ${e instanceof Error ? e.message : ""} El archivo ya está laminado: descárgalo y llévalo por USB o ábrelo en FlashPrint.`
      );
    } finally {
      sendingRef.current = false;
    }
    // Primer estado tras liberar el socket (no durante la transferencia).
    if (sent) void checkPrinter(ip, port, true);
  };

  const downloadJob = async () => {
    if (!job) return;
    if (await downloadBytes(job.bytes, job.fileName)) void celebrate();
  };

  const openInFlashPrint = async () => {
    if (!job) return;
    if (await downloadBytes(job.bytes, job.fileName)) setShowSteps(true);
  };

  /** Descarga el archivo original con nombre limpio (previo permiso). */
  const downloadOriginal = async () => {
    await requestFileDownload({
      filename: `${baseName}.${ext}`,
      blobOrUrl: downloadUrl,
      description: `Modelo original ${ext.toUpperCase()}, tal como se subió a Andros.`,
    });
  };

  /** .stl binario con la escala aplicada y los soportes fusionados (previo permiso). */
  const { pending: exportingStl, run: runStlExport } = useSubmitGuard();
  const downloadPreparedStlFile = () =>
    void runStlExport(async () => {
      if (mesh.phase !== "ready") return;
      const { supports } = await preparePart(mesh.soup, effectiveScale, supportsEnabled, readySupports);
      const { downloadPreparedStl } = await import("@/lib/3d/exportStl");
      await downloadPreparedStl({
        soup: mesh.soup,
        scale: effectiveScale,
        supportsSoup: supports,
        pieceName: pieceName || fileName,
      });
    });

  /** Instalador de la app de Windows (previo permiso). */
  const downloadDesktopApp = () => {
    void requestFileDownload({
      filename: "Andros-Setup.exe",
      blobOrUrl: DESKTOP_DOWNLOAD_URL,
      description: "Instalador oficial de Andros para Windows (impresión Wi-Fi en 1 clic).",
    });
  };

  const openInSlicer = () => {
    if (!cloudLink) {
      setOpenHint("needs-cloud");
      return;
    }
    setOpenHint("tried");
    void celebrate();
    // Protocolo externo del laminador (bambustudio://, prusaslicer://, cura://).
    const slicerUrl = new URL(`${dest.scheme}${encodeURIComponent(cloudLink)}`);
    window.location.assign(slicerUrl.href);
  };

  const today = new Date().toLocaleDateString("es", { year: "numeric", month: "long", day: "numeric" });
  const successBox = "border-andros-success/50 bg-andros-success/10 text-andros-success";
  const technical = describeSettings(preset.settings);

  // --- Texto del botón principal ------------------------------------------------
  let mainLabel = "Imprimir Ahora";
  let mainHint = "";
  if (isAdv3) {
    if (phase === "slicing") mainLabel = `Preparando la pieza… ${Math.round(progress * 100)} %`;
    else if (phase === "sending") mainLabel = "Enviando a la impresora…";
    else if (phase === "printing") mainLabel = "¡Imprimiendo!";
    if (!canAutoPrint) {
      mainHint =
        mesh.phase === "loading"
          ? "Analizando la pieza…"
          : !fits && sliceable && mesh.phase === "ready"
            ? "Activa el ajuste automático de tamaño para poder imprimir."
            : "Este archivo se prepara en FlashPrint: usa la descarga de abajo.";
    } else if (!lanCapable) {
      if (phase === "idle") mainLabel = "Descargar .gx listo para imprimir";
      mainHint = "La impresión por Wi-Fi en 1 clic está en la app de Windows. Aquí descargas el .gx para USB o FlashPrint.";
    } else if (wifi === "online") {
      mainHint = "Se enviará por Wi-Fi: la Adventurer 3 empezará a calentar e imprimir sola.";
    } else if (wifi === "searching" || wifi === "checking") {
      mainHint = "Buscando tu impresora… si no aparece, se preparará el .gx para USB o FlashPrint.";
    } else {
      mainHint = "Se preparará un archivo .gx listo para imprimir por USB o con FlashPrint.";
    }
  }

  const wifiChip = (() => {
    if (!lanCapable) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
          <MonitorDown className="w-3.5 h-3.5 shrink-0" /> El Wi-Fi directo funciona en la app de Windows
        </span>
      );
    }
    if (wifi === "online") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-andros-success min-w-0">
          <span className="w-2 h-2 shrink-0 rounded-full bg-andros-success" />
          <span className="truncate">
            Lista por Wi-Fi · {printerName ? `${printerName} · ` : ""}
            {ip}
          </span>
        </span>
      );
    }
    if (wifi === "searching") {
      return (
        <span role="status" className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
          <Radar className="w-3.5 h-3.5 shrink-0 animate-pulse text-andros-accent-ink" /> Buscando tu FlashForge Adventurer 3
          en el Wi-Fi…
        </span>
      );
    }
    if (wifi === "checking") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
          <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> Conectando con {printerName ?? "la impresora"} ({ip})…
        </span>
      );
    }
    if (searchMissed) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> No la encontramos en tu Wi-Fi · se usará USB / FlashPrint
        </span>
      );
    }
    if (wifi === "offline") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
          <WifiOff className="w-3.5 h-3.5 text-andros-danger" /> Sin respuesta en {ip} · se usará USB / FlashPrint
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-andros-muted">
        <Usb className="w-3.5 h-3.5" /> USB / FlashPrint
      </span>
    );
  })();

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        // La ventana vive fuera del nodo: sus toques no deben arrastrarlo.
        onPointerDown={(e) => e.stopPropagation()}
        onDragOver={(e) => e.stopPropagation()}
        onDrop={(e) => e.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Imprimir en 3D"
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-3xl max-h-[94dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark overflow-hidden"
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-andros-border">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 p-2 rounded-xl bg-andros-accent/10 text-andros-accent-ink">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-andros-primary">Imprimir</h2>
                <p className="text-xs text-andros-muted truncate" title={fileName}>
                  {pieceName || fileName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* ---------------- VISTA PREVIA ---------------- */}
              <div className="px-5 pt-5 md:pb-5 md:border-r border-andros-border space-y-3">
                <div className="aspect-[4/3] rounded-2xl bg-andros-canvas border border-andros-border flex items-center justify-center overflow-hidden">
                  {mesh.phase === "ready" && mesh.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mesh.preview} alt={`Vista previa de ${pieceName || fileName}`} className="w-full h-full object-contain" />
                  ) : mesh.phase === "loading" ? (
                    <span className="flex flex-col items-center gap-2 text-xs text-andros-muted">
                      <LoaderCircle className="w-6 h-6 animate-spin text-andros-accent-ink" />
                      Analizando la pieza…
                    </span>
                  ) : (
                    <Printer className="w-10 h-10 text-andros-muted" />
                  )}
                </div>
                <div className="text-xs text-andros-muted space-y-0.5">
                  <p className="truncate" title={fileName}>{fileName}</p>
                  <p className="text-andros-primary font-medium font-mono tabular-nums">{sizeText ?? "Medidas no disponibles"}</p>
                  {!isIdentityScale(userScale) && (
                    <p>
                      Escala del nodo: <span className="font-mono tabular-nums">{formatScale(userScale)}</span>
                    </p>
                  )}
                  {job?.stats && phase !== "slicing" && (
                    <p>
                      ≈ {formatDuration(job.stats.printTimeSec)} · {job.stats.filamentGrams.toFixed(0)} g de PLA ·{" "}
                      {job.stats.layers} capas
                    </p>
                  )}
                </div>
              </div>

              {/* ---------------- OPCIONES ---------------- */}
              <div className="px-5 py-5 space-y-5">
                <Row label="Destino">
                  <div className="relative">
                    <select
                      value={destination}
                      onChange={(e) => chooseDestination(e.target.value as Destination)}
                      aria-label="Impresora de destino"
                      className="w-full appearance-none min-h-[44px] pl-3 pr-9 rounded-xl border border-andros-border-active bg-andros-canvas text-sm font-medium text-andros-primary focus:outline-none focus:border-andros-accent"
                    >
                      {DESTINATIONS.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-andros-muted" />
                  </div>
                </Row>

                {isAdv3 && (
                  <Row label="Conexión">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 min-h-[28px]">
                        {wifiChip}
                        {lanCapable && (
                          <div className="shrink-0 flex items-center gap-3">
                            {wifi !== "searching" && wifi !== "checking" && wifi !== "online" && (
                              <button
                                type="button"
                                onClick={searchAgain}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-andros-accent-ink hover:underline"
                              >
                                <RefreshCw className="w-3 h-3" /> Buscar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingWifi((v) => !v)}
                              className="text-xs font-semibold text-andros-accent-ink hover:underline"
                            >
                              {editingWifi ? "Cerrar" : wifi === "online" ? "Cambiar" : "IP manual"}
                            </button>
                          </div>
                        )}
                      </div>
                      {lanCapable && editingWifi && (
                        <div className="rounded-2xl border border-andros-border bg-andros-canvas p-3 space-y-2">
                          <p className="text-[11px] leading-relaxed text-andros-muted">
                            Andros busca tu impresora sola. Si no aparece, escribe la IP que muestra la pantalla de tu
                            Adventurer 3 (Ajustes → Wi-Fi).
                          </p>
                          <div className="grid grid-cols-[1fr_76px] gap-2">
                            <input
                              value={ip}
                              onChange={(e) => setIp(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") connectWifi();
                              }}
                              inputMode="decimal"
                              placeholder="192.168.1.XX"
                              aria-label="IP local de la impresora"
                              className="min-h-[40px] px-3 rounded-xl border border-andros-border-active bg-andros-card text-sm text-andros-primary"
                            />
                            <input
                              value={port}
                              onChange={(e) => setPort(e.target.value)}
                              inputMode="numeric"
                              aria-label="Puerto"
                              className="min-h-[40px] px-3 rounded-xl border border-andros-border-active bg-andros-card text-sm text-andros-primary"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!ip.trim() || wifi === "checking"}
                            onClick={connectWifi}
                            className="w-full min-h-[40px] rounded-xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 spring-micro"
                          >
                            <Wifi className="w-4 h-4" /> Conectar
                          </button>
                          {wifi === "offline" && status?.error && (
                            <p role="alert" className="text-[11px] leading-relaxed text-andros-danger">
                              {status.error}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </Row>
                )}

                <Row label="Calidad">
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {QUALITY_ORDER.map((option) => {
                        const p = QUALITY_PRESETS[option.id];
                        const selected = option.id === quality;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => chooseQuality(option.id)}
                            disabled={busy}
                            className={`relative min-h-[92px] px-2 py-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 text-center active:scale-[0.98] spring-micro disabled:opacity-60 ${
                              selected
                                ? "border-andros-accent bg-andros-accent/10 ring-1 ring-andros-accent/40"
                                : "border-andros-border-active bg-andros-canvas hover:border-andros-accent"
                            }`}
                          >
                            <span
                              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                                selected ? "bg-andros-accent-fill text-white" : "bg-andros-accent/10 text-andros-accent-ink"
                              }`}
                            >
                              {selected ? <Check className="w-5 h-5" /> : option.icon}
                            </span>
                            <span className="text-xs font-semibold leading-tight text-andros-primary">{p.title}</span>
                            {option.recommended && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-andros-accent-ink">
                                Recomendado
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-andros-muted">{preset.everyday}</p>
                    <details className="group rounded-2xl border border-andros-border bg-andros-canvas">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-andros-muted flex items-center justify-between">
                        Ver detalles técnicos
                        <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
                      </summary>
                      <div className="px-3 pb-3">
                        <SettingsList
                          settings={
                            isAdv3
                              ? [...technical, { label: "Impresora", value: "Adventurer 3 · 150 × 150 × 150 mm" }]
                              : technical.slice(0, 5)
                          }
                        />
                        {!isAdv3 && (
                          <p className="mt-2 text-[11px] text-andros-muted">Valores sugeridos para aplicar en {dest.program}.</p>
                        )}
                      </div>
                    </details>
                  </div>
                </Row>

                {isAdv3 && (
                  <Row label="Tamaño">
                    {!size ? (
                      <p className="text-xs text-andros-muted pt-2.5">
                        {mesh.phase === "loading"
                          ? "Comprobando si cabe en la cama…"
                          : "No se pueden leer las medidas: comprueba en FlashPrint que no supere 150 × 150 × 150 mm."}
                      </p>
                    ) : fits || autoScale ? (
                      <div role="status" className={`rounded-2xl border px-3 py-2.5 text-xs font-semibold flex items-start gap-2 ${successBox}`}>
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                        <span className="flex-1">
                          {fits
                            ? "Cabe en la Adventurer 3 (150 × 150 × 150 mm)"
                            : `Ajustada al ${fitPercent.toFixed(1)} % para que quepa (${sizeText})`}
                        </span>
                        {!fits && (
                          <button type="button" onClick={() => toggleAutoScale(false)} className="shrink-0 underline font-medium">
                            Deshacer
                          </button>
                        )}
                      </div>
                    ) : (
                      <div role="alert" className="rounded-2xl border border-red-500/60 bg-red-500/10 px-3 py-2.5 space-y-2 text-xs text-andros-primary">
                        <p className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-andros-danger" />
                          <span>
                            <strong>No cabe:</strong> mide {formatMm(biggest)} mm en su lado más largo y la cama es de 150 mm.
                          </span>
                        </p>
                        {sliceable && (
                          <button
                            type="button"
                            onClick={() => toggleAutoScale(true)}
                            className="w-full min-h-[40px] rounded-xl bg-andros-accent-fill text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 spring-micro"
                          >
                            <Minimize2 className="w-4 h-4" /> Ajustar automáticamente ({fitPercent.toFixed(1)} %)
                          </button>
                        )}
                      </div>
                    )}
                  </Row>
                )}

                {sliceable && (
                  <Row label="Soportes">
                    <div className="space-y-1.5">
                      <AutoSupportsToggle
                        enabled={supportsEnabled}
                        onChange={toggleSupports}
                        status={supportStatus}
                        variant="stack"
                        disabled={busy || mesh.phase !== "ready"}
                      />
                      <p className="text-[11px] text-andros-muted">
                        {isAdv3
                          ? "Pilares desprendibles bajo los voladizos de más de 45°. Se incluyen en el .gx y en el .stl preparado."
                          : `Se incluyen en el .stl preparado. ${dest.program} abre el archivo original: actívalos allí si no usas el .stl.`}
                      </p>
                    </div>
                  </Row>
                )}
              </div>
            </div>

            {/* ---------------- RESULTADO / SIGUIENTES PASOS ---------------- */}
            {isAdv3 && (phase === "printing" || phase === "error" || phase === "file-ready") && (
              <div className="px-5 pb-5 space-y-3">
                {phase === "printing" && (
                  <div role="status" className={`rounded-2xl border px-4 py-3 space-y-2 text-xs ${successBox}`}>
                    <p className="font-semibold flex items-center gap-1.5 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> ¡Enviado! La Adventurer 3 está calentando y empezará sola.
                    </p>
                    {status?.ok && (
                      <div className="text-andros-primary">
                        <SettingsList
                          settings={[
                            {
                              label: "Boquilla",
                              value: status.temperatures?.extruder
                                ? `${status.temperatures.extruder.current} / ${status.temperatures.extruder.target} °C`
                                : "—",
                            },
                            {
                              label: "Cama",
                              value: status.temperatures?.bed
                                ? `${status.temperatures.bed.current} / ${status.temperatures.bed.target} °C`
                                : "—",
                            },
                            {
                              label: "Progreso",
                              value: status.progress?.printing
                                ? `${status.progress.percent} %${status.progress.layer ? ` · capa ${status.progress.layer}` : ""}`
                                : "Calentando…",
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                )}

                {phase === "error" && error && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-red-500/60 bg-red-500/10 px-4 py-3 space-y-3 text-xs leading-relaxed text-andros-primary"
                  >
                    <p>{error}</p>
                    {wifiFailed && job && (
                      <button
                        type="button"
                        onClick={downloadJob}
                        className="w-full min-h-[48px] px-3 rounded-2xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] spring-micro"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>
                          Descargar archivo {job.fileName.endsWith(".gx") ? ".GX" : ".G"} ya listo (para USB o FlashPrint)
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {job && (phase === "file-ready" || phase === "error") && (
                  <div className="rounded-2xl border border-andros-border bg-andros-canvas p-4 space-y-3">
                    <p className="text-sm font-semibold text-andros-primary flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-andros-success" /> {job.fileName} está listo para imprimir
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={downloadJob}
                        className="min-h-[48px] px-3 rounded-2xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] spring-micro"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>Descargar {job.fileName.endsWith(".gx") ? ".GX" : ".G"} listo (USB / FlashPrint)</span>
                      </button>
                      <button
                        type="button"
                        onClick={openInFlashPrint}
                        className="min-h-[48px] px-3 rounded-2xl border border-andros-border-active bg-andros-card text-andros-primary text-sm font-semibold flex items-center justify-center gap-2 hover:border-andros-accent active:scale-[0.98] spring-micro"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0 text-andros-accent-ink" />
                        <span>Abrir directo en FlashPrint</span>
                      </button>
                    </div>
                    {showSteps ? (
                      <ol role="status" className="space-y-1.5 text-xs leading-relaxed text-andros-primary">
                        <li>
                          <span className="font-semibold">1.</span> Abre <strong>{job.fileName}</strong> desde tu carpeta
                          de Descargas (doble clic): se abre en FlashPrint 5.
                        </li>
                        <li>
                          <span className="font-semibold">2.</span> Pulsa <strong>Imprimir</strong> y elige tu Adventurer 3.
                          No hace falta cortar: ya va laminado.
                        </li>
                      </ol>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-andros-muted">
                        <strong>Por USB:</strong> copia el archivo a una memoria USB, conéctala a la Adventurer 3 y elige
                        Imprimir → USB. No hace falta ningún otro programa.
                      </p>
                    )}
                    <a
                      href={FLASHPRINT_DOWNLOAD_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-andros-accent-ink hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" /> ¿No tienes FlashPrint 5? Descárgalo gratis (oficial)
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* ---------------- EXTRAS ---------------- */}
            <div className="px-5 pb-5 grid sm:grid-cols-2 gap-3">
              <section className="rounded-2xl border border-dashed border-andros-border px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-andros-primary">Filamentos recomendados</h3>
                  <span className="text-[10px] uppercase tracking-wider text-andros-muted">Publicidad</span>
                </div>
                <ul className="space-y-1.5">
                  {SPONSORED_MATERIALS.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-andros-primary">
                        {item.name}
                        <span className="text-andros-muted"> · {item.note}</span>
                      </span>
                      <a href={item.href} target="_blank" rel="sponsored noopener noreferrer" className="shrink-0 text-andros-accent-ink hover:underline">
                        Ver
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="flex flex-col gap-2">
                {sliceable && (
                  <PreparedStlButton
                    onClick={downloadPreparedStlFile}
                    pending={exportingStl}
                    disabled={mesh.phase !== "ready"}
                    className="min-h-[40px] px-3 rounded-xl border border-andros-border-active text-andros-primary text-xs font-medium flex items-center justify-center gap-2 hover:border-andros-accent spring-micro disabled:opacity-50"
                  />
                )}
                {isAdv3 && (
                  <button
                    type="button"
                    onClick={() => void downloadOriginal()}
                    className="min-h-[40px] px-3 rounded-xl border border-andros-border-active text-andros-primary text-xs font-medium flex items-center justify-center gap-2 hover:border-andros-accent spring-micro"
                  >
                    <Download className="w-3.5 h-3.5 text-andros-accent-ink" /> Descargar archivo original ({ext.toUpperCase()})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[40px] px-3 rounded-xl border border-andros-border-active text-andros-primary text-xs font-medium flex items-center justify-center gap-2 hover:border-andros-accent spring-micro"
                >
                  <Printer className="w-3.5 h-3.5 text-andros-accent-ink" /> Hoja de control (papel / PDF)
                </button>
              </div>
            </div>
          </div>

          {/* ---------------- PIE: BOTÓN PRINCIPAL ---------------- */}
          <div className="border-t border-andros-border px-5 py-4 bg-andros-card space-y-2">
            {isAdv3 ? (
              <>
                {canAutoPrint ? (
                  <button
                    type="button"
                    onClick={() => void printNow()}
                    disabled={busy || phase === "printing"}
                    className="relative w-full min-h-[60px] px-5 rounded-2xl bg-andros-accent-fill text-white text-base font-semibold flex items-center justify-center gap-2.5 overflow-hidden hover:opacity-95 active:scale-[0.99] spring-micro disabled:cursor-default"
                  >
                    {phase === "slicing" && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-300"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    )}
                    <span className="relative flex items-center gap-2.5">
                      {busy ? (
                        <LoaderCircle className="w-5 h-5 animate-spin" />
                      ) : phase === "printing" ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : wifi === "online" ? (
                        <Wifi className="w-5 h-5" />
                      ) : !lanCapable ? (
                        <Download className="w-5 h-5" />
                      ) : (
                        <Printer className="w-5 h-5" />
                      )}
                      {mainLabel}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void downloadOriginal()}
                    disabled={mesh.phase === "loading"}
                    className="w-full min-h-[60px] px-5 rounded-2xl bg-andros-accent-fill text-white text-base font-semibold flex items-center justify-center gap-2.5 disabled:opacity-50 hover:opacity-95 active:scale-[0.99] spring-micro"
                  >
                    {mesh.phase === "loading" ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    {mesh.phase === "loading" ? "Analizando la pieza…" : "Descargar para FlashPrint"}
                  </button>
                )}
                {!lanCapable && (
                  <button
                    type="button"
                    onClick={downloadDesktopApp}
                    className="w-full min-h-[48px] px-4 rounded-2xl border border-andros-border-active bg-andros-canvas text-andros-primary text-sm font-semibold flex items-center justify-center gap-2 hover:border-andros-accent active:scale-[0.99] spring-micro"
                  >
                    <MonitorDown className="w-4 h-4 shrink-0 text-andros-accent-ink" />
                    Descargar App para Windows (Impresión Wi-Fi en 1 clic)
                  </button>
                )}
                {mainHint && <p className="text-[11px] text-center text-andros-muted">{mainHint}</p>}
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <button
                    type="button"
                    onClick={openInSlicer}
                    className="min-h-[60px] px-5 rounded-2xl bg-andros-accent-fill text-white text-base font-semibold flex items-center justify-center gap-2.5 hover:opacity-95 active:scale-[0.99] spring-micro"
                  >
                    <ExternalLink className="w-5 h-5" /> Abrir en {dest.program}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadOriginal()}
                    className="min-h-[60px] px-4 rounded-2xl border border-andros-border-active text-andros-primary text-sm font-semibold flex items-center justify-center gap-2 hover:border-andros-accent spring-micro"
                  >
                    <Download className="w-4 h-4 text-andros-accent-ink" /> Descargar
                  </button>
                </div>
                {openHint === "tried" && (
                  <p role="status" className="text-[11px] text-center text-andros-muted">
                    Si tu navegador pregunta, acepta abrir {dest.program}. ¿No pasó nada? Usa Descargar.
                  </p>
                )}
                {openHint === "needs-cloud" && (
                  <p role="status" className="text-[11px] text-center text-andros-muted">
                    {isSignedIn
                      ? "El archivo todavía se está guardando en tu nube. Espera unos segundos o usa Descargar."
                      : "Para abrirlo directamente, inicia sesión con Google para guardar el archivo en tu nube. Mientras, usa Descargar."}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hoja de control — solo visible al imprimir (ver globals.css) */}
      <div className="andros-print-sheet">
        <header className="aps-header">
          <div>
            <p className="aps-brand">ANDROS · Hoja de control de impresión 3D</p>
            <h1>{pieceName || fileName}</h1>
          </div>
          <p className="aps-date">{today}</p>
        </header>

        <h2>Pieza</h2>
        <table>
          <tbody>
            <tr>
              <th>Nombre de la pieza</th>
              <td>{pieceName || fileName}</td>
            </tr>
            <tr>
              <th>Archivo</th>
              <td>{job?.fileName ?? fileName}</td>
            </tr>
            <tr>
              <th>Dimensiones (Ancho × Profundidad × Alto)</th>
              <td>{sizeText ?? "No disponibles"}</td>
            </tr>
            <tr>
              <th>Escala</th>
              <td>{formatScale(effectiveScale)}</td>
            </tr>
            <tr>
              <th>Soportes automáticos (45°)</th>
              <td>
                {!supportsEnabled
                  ? "Desactivados"
                  : supportStatus.phase === "ready"
                    ? supportStatus.count === 0
                      ? "Sin voladizos detectados"
                      : `${supportStatus.count} pilares`
                    : "Activados"}
              </td>
            </tr>
            <tr>
              <th>Impresora</th>
              <td>{isAdv3 ? "FlashForge Adventurer 3 (150 × 150 × 150 mm)" : dest.label}</td>
            </tr>
          </tbody>
        </table>

        <h2>Configuración — {preset.title}</h2>
        <table>
          <tbody>
            {technical.map((setting) => (
              <tr key={setting.label}>
                <th>{setting.label}</th>
                <td>{setting.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Antes de imprimir</h2>
        <ul className="aps-checklist">
          <li>Filamento PLA de 1.75 mm cargado en la impresora</li>
          <li>Base de impresión limpia y despejada</li>
          <li>Primera capa revisada (se pega bien a la base)</li>
        </ul>

        <h2>Notas</h2>
        <div className="aps-notes" />

        <p className="aps-footer">
          {fitScale !== 1
            ? `La pieza se ajusta al ${fitPercent.toFixed(1)} % adicional para caber en la cama.`
            : !isIdentityScale(userScale)
              ? `Las dimensiones incluyen la escala del nodo (${formatScale(userScale)}).`
              : "Las dimensiones son las reales del archivo."}
        </p>
      </div>
    </>,
    document.body
  );
};
