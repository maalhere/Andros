// ============================================================================
// ANDROS — PUENTE HTTP LOCAL PARA IMPRESORAS KLIPPER (Moonraker / Fluidd)
// Creality K2 SE / K1 / K1 Max / Ender-3 V3 KE, Elegoo Neptune 4 Pro, QIDI…
//
//   GET  ?ip=…&port=…                       → estado (temperaturas, trabajo, %)
//   POST ?action=print&ip=…&port=…&name=…   → cuerpo binario .gcode: lo sube a
//                                             Moonraker y empieza a imprimir
//
// Anti-SSRF (estricto):
//   · Solo IPv4 literales RFC 1918 (10/8, 172.16/12, 192.168/16) y puertos
//     7125 / 4408 / 80 (parseKlipperTarget). Nada de nombres de host, IPv6,
//     loopback, 169.254.x.x (metadatos de la nube) ni IPs públicas.
//   · Sin redirecciones (moonrakerNet usa redirect: "error").
//   · En hosting remoto (Vercel) la ruta se desactiva por completo: el
//     servidor no está en el Wi-Fi del usuario y no debe tocar redes internas.
//     Allí Andros ofrece abrir el archivo en Creality Print / OrcaSlicer.
//   · (Sprint 17B) Apagada por defecto: solo con ANDROS_LOCAL_PRINTER_BRIDGE=1.
//     Exige `X-Andros-Bridge: 1` y `Origin` = `Host` (bridgeGuard): ninguna
//     web ajena puede usarla a través de tu navegador (CSRF).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { parseKlipperTarget } from "@/lib/printers/network";
import {
  KLIPPER_MAX_UPLOAD_BYTES,
  MoonrakerError,
  describeMoonrakerError,
  readKlipperStatus,
  uploadAndPrintKlipper,
} from "@/lib/printers/moonrakerNet";
import { bridgeRequestInfo, checkPrinterBridgeRequest } from "@/lib/printer/bridgeGuard";

/** La subida de un .gcode grande por Wi-Fi puede tardar minutos. */
export const maxDuration = 300;

/** Transferencias en curso por IP (una a la vez por impresora). */
const transferring = new Set<string>();

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Puente apagado, en Vercel o petición de otro sitio: se rechaza sin tocar la red. */
function bridgeRefusal(request: NextRequest) {
  const check = checkPrinterBridgeRequest(bridgeRequestInfo(request), {
    VERCEL: process.env.VERCEL,
    ANDROS_LOCAL_PRINTER_BRIDGE: process.env.ANDROS_LOCAL_PRINTER_BRIDGE,
  });
  if (check.ok) return null;
  return NextResponse.json(
    {
      ok: false,
      error: check.remote
        ? "La versión web no puede ver tu Wi-Fi. Usa la app de Windows o abre el archivo en Creality Print / OrcaSlicer."
        : check.error,
      ...(check.remote ? { remote: true } : {}),
      ...(check.disabled ? { disabled: true } : {}),
    },
    { status: check.status }
  );
}

function connectionError(ip: string, port: number, e: unknown) {
  const status = e instanceof MoonrakerError && e.status === 400 ? 400 : 502;
  return fail(
    `No se pudo conectar con ${ip}:${port}. ${describeMoonrakerError(e)}. Comprueba que la impresora y este equipo están en la misma red Wi-Fi.`,
    status
  );
}

export async function GET(request: NextRequest) {
  const refusal = bridgeRefusal(request);
  if (refusal) return refusal;
  const params = request.nextUrl.searchParams;
  const target = parseKlipperTarget(params.get("ip"), params.get("port"));
  if (typeof target === "string") return fail(target, 400);
  if (transferring.has(target.ip)) {
    return NextResponse.json({ ok: false, busy: true, error: "Enviando el archivo: el estado se reanuda al terminar." });
  }
  try {
    return NextResponse.json(await readKlipperStatus(target));
  } catch (e) {
    return connectionError(target.ip, target.port, e);
  }
}

export async function POST(request: NextRequest) {
  const refusal = bridgeRefusal(request);
  if (refusal) return refusal;
  const params = request.nextUrl.searchParams;
  if (params.get("action") !== "print") return fail('Acción no soportada (usa action=print).', 400);
  const target = parseKlipperTarget(params.get("ip"), params.get("port"));
  if (typeof target === "string") return fail(target, 400);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > KLIPPER_MAX_UPLOAD_BYTES) return fail("El archivo supera 128 MB.", 413);

  let data: Uint8Array<ArrayBuffer>;
  try {
    data = new Uint8Array(await request.arrayBuffer());
  } catch {
    return fail("No se pudo leer el trabajo de impresión.", 400);
  }
  if (data.byteLength === 0) return fail("El archivo de impresión está vacío.", 400);
  if (data.byteLength > KLIPPER_MAX_UPLOAD_BYTES) return fail("El archivo supera 128 MB.", 413);
  if (transferring.has(target.ip)) {
    return fail("Ya se está enviando un archivo a esta impresora. Espera a que termine.", 409);
  }

  transferring.add(target.ip);
  try {
    return NextResponse.json(await uploadAndPrintKlipper(target, params.get("name") ?? "ANDROS_pieza", data));
  } catch (e) {
    return connectionError(target.ip, target.port, e);
  } finally {
    transferring.delete(target.ip);
  }
}
