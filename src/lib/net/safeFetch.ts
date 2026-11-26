// ============================================================================
// ANDROS — DESCARGA SEGURA DESDE EL SERVIDOR (anti-SSRF, solo Node)
//
// Para /api/link-preview. A diferencia de `fetch`, valida la IP REAL en el
// momento de conectar (hook `lookup`), así que tampoco sirve el truco de
// «DNS rebinding» (un nombre que primero resuelve a una IP pública y luego a
// 127.0.0.1). Además:
//   · Resuelve el DNS ANTES de conectar y rechaza si alguna IP no es pública.
//   · Solo http/https y puertos 80/443 (`checkPreviewUrl`).
//   · Redirecciones MANUALES: como máximo 3 saltos, cada uno revalidado.
//   · Tiempo total y tamaño de respuesta limitados.
// ============================================================================

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import { checkPreviewUrl, isIpLiteral, isPublicIpAddress } from "./publicAddress";

export const SAFE_FETCH_MAX_REDIRECTS = 3;

/** El destino (o una redirección) apunta a una red privada, local o no permitida. */
export class BlockedTargetError extends Error {
  constructor(message = "No se permiten direcciones de redes privadas o locales") {
    super(message);
    this.name = "BlockedTargetError";
  }
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
}

export interface SafeFetchResponse {
  status: number;
  ok: boolean;
  /** URL final tras las redirecciones. */
  url: string;
  contentType: string;
  text: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const stripBrackets = (host: string) => host.replace(/^\[|\]$/g, "");

/** Resuelve `host` y exige que TODAS sus IP sean públicas (o que la IP literal lo sea). */
export async function assertPublicHost(host: string): Promise<void> {
  const bare = stripBrackets(host);
  if (isIpLiteral(bare)) {
    if (!isPublicIpAddress(bare)) throw new BlockedTargetError();
    return;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await dns.promises.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new Error("No se encontró el sitio (DNS)");
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicIpAddress(a.address))) {
    throw new BlockedTargetError();
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` para http/https: vuelve a resolver en el instante de conectar y
 * solo entrega IP públicas (si alguna no lo es, la conexión se aborta).
 */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicIpAddress(a.address))) {
      callback(new BlockedTargetError() as NodeJS.ErrnoException, "", 0);
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer;
}

function requestOnce(url: URL, headers: Record<string, string>, signal: AbortSignal, maxBytes: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { ...headers, "Accept-Encoding": "identity" },
        lookup: guardedLookup as unknown as http.RequestOptions["lookup"],
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = String(res.headers["content-type"] ?? "");
        if (REDIRECT_STATUSES.has(status)) {
          res.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, location, contentType, body: Buffer.concat(chunks) });
        };
        res.on("data", (chunk: Buffer) => {
          if (done) return;
          chunks.push(chunk);
          total += chunk.byteLength;
          // Páginas enormes: con lo leído basta para las etiquetas <meta>.
          if (total >= maxBytes) {
            finish();
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", (error) => (done ? undefined : reject(error)));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** GET seguro con redirecciones revalidadas (máx. 3) y límites de tiempo y tamaño. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  let current = rawUrl;

  for (let hop = 0; ; hop += 1) {
    const check = checkPreviewUrl(current);
    if (!check.ok) throw new BlockedTargetError(check.error);
    await assertPublicHost(check.url.hostname);

    const res = await requestOnce(check.url, options.headers ?? {}, signal, options.maxBytes);
    if (REDIRECT_STATUSES.has(res.status) && res.location) {
      if (hop >= maxRedirects) throw new Error("Demasiadas redirecciones");
      current = new URL(res.location, check.url).toString();
      continue;
    }
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      url: check.url.toString(),
      contentType: res.contentType,
      text: res.body.toString("utf-8"),
    };
  }
}
