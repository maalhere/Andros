// ============================================================================
// ANDROS — PUENTE WI-FI DIRECTO PARA FLASHFORGE ADVENTURER 3
//
// El protocolo vive en src/lib/printer/flashforgeNet.ts (compartido con la
// app de Windows). Esta ruta solo lo expone por HTTP:
//
//   GET  ?ip=…&port=…          → estado (temperaturas, progreso, modelo)
//   GET  ?action=discover      → busca la impresora en la red local
//   POST { action: "discover" } → igual que el anterior
//   POST action = "print"      → sube el .gx/.g y empieza a imprimir:
//     · Binario (application/octet-stream) con ?action=print&ip=…&port=…&name=…
//     · JSON { action: "print", ip, port?, fileName, content, encoding?: "base64" | "text" }
//
// Solo funciona cuando Andros corre en una máquina de la misma red que la
// impresora (npm run dev o la app de Windows). En hosting remoto (Vercel) no
// hay ruta a la LAN: la búsqueda se desactiva y solo se aceptan IPs privadas
// para no usar el servidor como puente hacia Internet.
//
// (Sprint 17B) Blindaje:
//   · Apagada por defecto: solo con ANDROS_LOCAL_PRINTER_BRIDGE=1 y nunca en
//     Vercel. Exige `X-Andros-Bridge: 1` y `Origin` = `Host` (bridgeGuard).
//   · Destino: IPv4 RFC 1918 estricta (sin 169.254/16) y SOLO el puerto 8899
//     (parseFlashforgeTarget, el mismo validador que la app de Windows).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  FLASHFORGE_DEFAULT_PORT,
  MAX_UPLOAD_BYTES,
  describePrinterError,
  discoverFlashForge,
  isPrinterBusyError,
  isPrinterTransferring,
  parseFlashforgeTarget,
  readPrinterStatus,
  safePrinterFileName,
  uploadAndPrint,
} from "@/lib/printer/flashforgeNet";
import type { DiscoveryResult, PrinterStatus } from "@/lib/printer/flashforgeShared";
import { bridgeRequestInfo, checkPrinterBridgeRequest } from "@/lib/printer/bridgeGuard";

/** Puente apagado, en Vercel o petición de otro sitio: se rechaza sin tocar la red. */
function bridgeRefusal(request: NextRequest) {
  const check = checkPrinterBridgeRequest(bridgeRequestInfo(request), {
    VERCEL: process.env.VERCEL,
    ANDROS_LOCAL_PRINTER_BRIDGE: process.env.ANDROS_LOCAL_PRINTER_BRIDGE,
  });
  if (check.ok) return null;
  const body: DiscoveryResult & { disabled?: true } = {
    ok: false,
    printers: [],
    subnets: [],
    error: check.error,
    ...(check.remote ? { remote: true } : {}),
    ...(check.disabled ? { disabled: true } : {}),
  };
  return NextResponse.json(body, { status: check.status });
}

/** La subida de un .gx grande por Wi-Fi puede tardar minutos. */
export const maxDuration = 300;

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function connectionError(ip: string, port: number, e: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: `No se pudo conectar con ${ip}:${port}. ${describePrinterError(e)}. Comprueba que la impresora y este equipo están en la misma red Wi-Fi y que Andros corre en local (app de Windows o npm run dev).`,
    },
    { status: 502 }
  );
}

/** Respuesta del sondeo de estado mientras se envía un archivo (sondeo en pausa). */
function busyStatus() {
  const body: PrinterStatus = {
    ok: false,
    busy: true,
    error: "Enviando el archivo a la impresora: el estado se reanuda al terminar.",
  };
  return NextResponse.json(body);
}

function parseTarget(ipRaw: unknown, portRaw: unknown): { ip: string; port: number } | string {
  return parseFlashforgeTarget(ipRaw, portRaw ?? FLASHFORGE_DEFAULT_PORT);
}

async function discover() {
  try {
    return NextResponse.json(await discoverFlashForge());
  } catch (e) {
    const body: DiscoveryResult = {
      ok: false,
      printers: [],
      subnets: [],
      error: e instanceof Error ? e.message : "No se pudo buscar la impresora.",
    };
    return NextResponse.json(body, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Estado / búsqueda (GET)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const refusal = bridgeRefusal(request);
  if (refusal) return refusal;
  const params = request.nextUrl.searchParams;
  if (params.get("action") === "discover") return discover();

  const target = parseTarget(params.get("ip"), params.get("port"));
  if (typeof target === "string") return badRequest(target);
  const { ip, port } = target;

  // Un solo socket en el 8899: no se abre otro mientras se transfiere.
  if (isPrinterTransferring(ip)) return busyStatus();
  try {
    return NextResponse.json({ ok: true, ...(await readPrinterStatus(ip, port)) });
  } catch (e) {
    if (isPrinterBusyError(e)) return busyStatus();
    return connectionError(ip, port, e);
  }
}

// ---------------------------------------------------------------------------
// Imprimir / búsqueda (POST)
// ---------------------------------------------------------------------------

interface PrintJsonBody {
  action?: string;
  ip?: string;
  port?: number | string;
  fileName?: string;
  content?: string;
  encoding?: "base64" | "text";
}

export async function POST(request: NextRequest) {
  const refusal = bridgeRefusal(request);
  if (refusal) return refusal;
  const params = request.nextUrl.searchParams;
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");

  let action: string | null;
  let ipRaw: unknown;
  let portRaw: unknown;
  let nameRaw: string;
  let data: Buffer;

  try {
    if (isJson) {
      const body = (await request.json()) as PrintJsonBody;
      action = body.action ?? null;
      if (action === "discover") return discover();
      ipRaw = body.ip;
      portRaw = body.port;
      nameRaw = body.fileName ?? "andros";
      data = Buffer.from(body.content ?? "", body.encoding === "text" ? "utf8" : "base64");
    } else {
      action = params.get("action");
      if (action === "discover") return discover();
      ipRaw = params.get("ip");
      portRaw = params.get("port");
      nameRaw = params.get("name") ?? "andros";
      data = Buffer.from(await request.arrayBuffer());
    }
  } catch {
    return badRequest("No se pudo leer el trabajo de impresión.");
  }

  if (action !== "print") return badRequest('Acción no soportada (usa action: "print" o "discover").');
  const target = parseTarget(ipRaw, portRaw);
  if (typeof target === "string") return badRequest(target);
  if (data.length === 0) return badRequest("El archivo de impresión está vacío.");
  if (data.length > MAX_UPLOAD_BYTES) return badRequest("El archivo supera 128 MB.");

  if (isPrinterTransferring(target.ip)) {
    return NextResponse.json(
      { ok: false, error: "Ya se está enviando un archivo a esta impresora. Espera a que termine." },
      { status: 409 }
    );
  }

  // Nombre remoto corto (≤ 12 caracteres): 0:/user/<nombre>.gx
  const fileName = safePrinterFileName(nameRaw, data);
  try {
    const remoteName = await uploadAndPrint(target.ip, target.port, fileName, data);
    return NextResponse.json({ ok: true, fileName: remoteName, bytes: data.length });
  } catch (e) {
    return connectionError(target.ip, target.port, e);
  }
}
