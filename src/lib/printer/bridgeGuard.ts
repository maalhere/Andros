// ============================================================================
// ANDROS — GUARDIÁN DE LAS RUTAS HTTP DE IMPRESORA (anti-CSRF, módulo puro)
//
// /api/printer/flashforge y /api/printer/klipper hablan con tu red local. Para
// que ninguna página web ajena las use a través de tu navegador:
//   · APAGADAS por defecto: solo funcionan con ANDROS_LOCAL_PRINTER_BRIDGE=1
//     (npm run dev en tu equipo) y NUNCA en Vercel (process.env.VERCEL).
//   · Exigen la cabecera propia `X-Andros-Bridge: 1`: un sitio ajeno no puede
//     enviarla sin un «preflight» CORS que esta app nunca autoriza (bloquea
//     los formularios y `fetch` text/plain «simples»).
//   · `Origin` (si viene; en POST es obligatorio) debe coincidir EXACTAMENTE
//     con `Host`, y `Host` debe ser este equipo o tu red local (frena el
//     «DNS rebinding» hacia localhost).
// La app de Windows usa el puente IPC nativo: esto no le afecta.
// ============================================================================

export const PRINTER_BRIDGE_HEADER = "X-Andros-Bridge";
export const PRINTER_BRIDGE_HEADER_VALUE = "1";

/** Cabeceras que el cliente web añade a cada petición de impresora. */
export const PRINTER_BRIDGE_HEADERS: Readonly<Record<string, string>> = {
  [PRINTER_BRIDGE_HEADER]: PRINTER_BRIDGE_HEADER_VALUE,
};

export interface BridgeRequestInfo {
  method: string;
  host: string | null;
  origin: string | null;
  bridgeHeader: string | null;
  secFetchSite: string | null;
}

export interface BridgeEnv {
  VERCEL?: string;
  ANDROS_LOCAL_PRINTER_BRIDGE?: string;
}

export type BridgeCheck =
  | { ok: true }
  | { ok: false; status: number; error: string; remote?: true; disabled?: true };

const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/** `true` si `host` (con o sin puerto) es este equipo o un nombre/IP de la red local. */
export function isLocalBridgeHost(host: string | null): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    PRIVATE_V4.test(hostname)
  );
}

export function checkPrinterBridgeRequest(info: BridgeRequestInfo, env: BridgeEnv): BridgeCheck {
  if (env.VERCEL) {
    return {
      ok: false,
      status: 409,
      remote: true,
      error: "La versión web no puede ver tu Wi-Fi. Usa la app de Windows o abre el archivo en tu programa de laminado.",
    };
  }
  if (env.ANDROS_LOCAL_PRINTER_BRIDGE !== "1") {
    return {
      ok: false,
      status: 403,
      disabled: true,
      error:
        "El puente local de impresoras está desactivado. Usa la app de Windows o, en tu equipo, añade ANDROS_LOCAL_PRINTER_BRIDGE=1 a .env.local y reinicia npm run dev.",
    };
  }
  if (info.bridgeHeader !== PRINTER_BRIDGE_HEADER_VALUE) {
    return { ok: false, status: 403, error: "Petición de impresora no autorizada (falta la cabecera de Andros)." };
  }
  if (!isLocalBridgeHost(info.host)) {
    return { ok: false, status: 403, error: "El puente de impresoras solo responde en este equipo o tu red local." };
  }
  if (info.origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(info.origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== info.host) {
      return { ok: false, status: 403, error: "Petición de impresora rechazada: origen distinto." };
    }
  } else {
    // Los navegadores siempre mandan `Origin` en POST y en peticiones entre
    // sitios; sin él solo se acepta un GET del mismo origen.
    const method = info.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return { ok: false, status: 403, error: "Petición de impresora rechazada: falta el origen." };
    }
    if (info.secFetchSite !== null && info.secFetchSite !== "same-origin") {
      return { ok: false, status: 403, error: "Petición de impresora rechazada: origen distinto." };
    }
  }
  return { ok: true };
}

/** Lee lo necesario de una petición de Next.js / Fetch API. */
export function bridgeRequestInfo(request: { method: string; headers: Headers }): BridgeRequestInfo {
  return {
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    bridgeHeader: request.headers.get(PRINTER_BRIDGE_HEADER),
    secFetchSite: request.headers.get("sec-fetch-site"),
  };
}
