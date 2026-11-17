// ============================================================================
// ANDROS — PUENTE WI-FI DIRECTO PARA FLASHFORGE ADVENTURER 3
//
// Abre un socket TCP al puerto 8899 de la impresora (red local) y le habla con
// los M-codes de FlashForge:
//   GET  → estado:   ~M601 S1 · ~M115 · ~M105 · ~M27 · ~M602
//   POST → imprimir: ~M601 S1 → ~M28 <bytes> 0:/user/<nombre>.gx → datos →
//                    ~M29 → ~M23 0:/user/<nombre>.gx   (empieza a calentar sola)
//
// POST acepta dos formas:
//   · Binario (application/octet-stream) con ?action=print&ip=…&port=…&name=…
//   · JSON { action: "print", ip, port?, fileName, content, encoding?: "base64" | "text" }
//
// Los datos se envían en paquetes de 4096 bytes con cabecera de 16 bytes
// (firma, nº de paquete, longitud y CRC-32), el formato que usa la
// Adventurer 3 por red.
//
// Solo funciona cuando Andros corre en una máquina de la misma red que la
// impresora (npm run dev). En hosting remoto (Vercel) no hay ruta a la LAN, y
// por seguridad solo se aceptan IPs privadas para no usar el servidor como
// puente hacia Internet.
// ============================================================================

import net from "node:net";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_PORT = 8899;
const COMMAND_TIMEOUT_MS = 4000;
const UPLOAD_FINISH_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 30_000;
const PACKET_DATA_BYTES = 4096;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

// ---------------------------------------------------------------------------
// Conexión con la impresora
// ---------------------------------------------------------------------------

class PrinterConnection {
  private readonly socket = new net.Socket();
  private buffer = "";
  private failure: Error | null = null;
  private waiter: {
    done: (text: string) => boolean;
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  static open(host: string, port: number): Promise<PrinterConnection> {
    const conn = new PrinterConnection();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.close();
        reject(new Error("La impresora no respondió a la conexión"));
      }, COMMAND_TIMEOUT_MS);
      conn.socket.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      conn.socket.connect(port, host, () => {
        clearTimeout(timer);
        resolve(conn);
      });
    });
  }

  private constructor() {
    this.socket.setNoDelay(true);
    this.socket.setTimeout(IDLE_TIMEOUT_MS);
    this.socket.on("timeout", () => this.fail(new Error("La conexión con la impresora quedó inactiva")));
    this.socket.on("error", (e) => this.fail(e));
    this.socket.on("close", () => this.fail(new Error("La impresora cerró la conexión")));
    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString("latin1");
      const w = this.waiter;
      if (w && w.done(this.buffer)) {
        clearTimeout(w.timer);
        this.waiter = null;
        w.resolve(this.buffer.trim());
      }
    });
  }

  private fail(err: Error) {
    if (!this.failure) this.failure = err;
    const w = this.waiter;
    if (w) {
      clearTimeout(w.timer);
      this.waiter = null;
      w.reject(err);
    }
  }

  /** Envía `~Mxxx …` y espera "CMD Mxxx Received." seguido de "ok". */
  command(cmd: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const code = /M\d+/.exec(cmd)?.[0] ?? "";
    // Se exige el eco "CMD Mxxx" para no confundir un "ok" tardío de otro comando.
    const marker = new RegExp(`CMD\\s+${code}\\b`, "i");
    const done = (text: string) =>
      marker.test(text) && (/\bok\b\s*$/i.test(text) || /error[^\n]*\n\s*$/i.test(text));
    return new Promise((resolve, reject) => {
      this.buffer = "";
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`La impresora no respondió a ${cmd}`));
      }, timeoutMs);
      this.waiter = { done, resolve, reject, timer };
      this.socket.write(`${cmd}\r\n`);
    });
  }

  /** Escribe bytes crudos respetando el control de flujo del socket. */
  write(data: Buffer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const ok = this.socket.write(data, (err) => {
        if (err) reject(err);
      });
      if (ok) resolve();
      else this.socket.once("drain", () => resolve());
    });
  }

  close() {
    this.waiter = null;
    this.socket.removeAllListeners("close");
    this.socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Estado (GET)
// ---------------------------------------------------------------------------

function field(text: string, label: string): string | null {
  const m = new RegExp(`${label}\\s*:\\s*([^\\r\\n]+)`, "i").exec(text);
  return m ? m[1].trim() : null;
}

function parseTemps(text: string) {
  const t = /T0:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/i.exec(text);
  const b = /B:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/i.exec(text);
  return {
    extruder: t ? { current: Number(t[1]), target: Number(t[2]) } : null,
    bed: b ? { current: Number(b[1]), target: Number(b[2]) } : null,
  };
}

function parseProgress(text: string) {
  const m = /byte\s+(\d+)\s*\/\s*(\d+)/i.exec(text);
  const done = m ? Number(m[1]) : 0;
  const total = m ? Number(m[2]) : 0;
  return {
    printing: total > 0,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    layer: field(text, "Layer"),
  };
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function connectionError(ip: string, port: number, e: unknown) {
  const message = e instanceof Error ? e.message : "Error desconocido";
  return NextResponse.json(
    {
      ok: false,
      error: `No se pudo conectar con ${ip}:${port}. ${message}. Comprueba que la impresora y este equipo están en la misma red Wi-Fi y que Andros corre en local (npm run dev).`,
    },
    { status: 502 }
  );
}

function parseTarget(ipRaw: unknown, portRaw: unknown): { ip: string; port: number } | string {
  const ip = String(ipRaw ?? "").trim();
  const port = Number(portRaw ?? DEFAULT_PORT) || DEFAULT_PORT;
  if (!isPrivateIPv4(ip)) return "Escribe una IP local válida (ej. 192.168.1.45).";
  if (port < 1 || port > 65535) return "Puerto inválido.";
  return { ip, port };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = parseTarget(params.get("ip"), params.get("port"));
  if (typeof target === "string") return badRequest(target);
  const { ip, port } = target;

  let conn: PrinterConnection | null = null;
  try {
    conn = await PrinterConnection.open(ip, port);
    await conn.command("~M601 S1");
    const info = await conn.command("~M115");
    const temps = await conn.command("~M105");
    const progress = await conn.command("~M27");
    await conn.command("~M602").catch(() => "");
    return NextResponse.json({
      ok: true,
      machine: {
        type: field(info, "Machine Type"),
        name: field(info, "Machine Name"),
        firmware: field(info, "Firmware"),
        sn: field(info, "SN"),
      },
      temperatures: parseTemps(temps),
      progress: parseProgress(progress),
    });
  } catch (e) {
    return connectionError(ip, port, e);
  } finally {
    conn?.close();
  }
}

// ---------------------------------------------------------------------------
// Imprimir (POST, action = "print")
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Paquete de red: firma 5A 5A EF BF · nº (BE) · longitud (BE) · CRC-32 (BE) · 4096 bytes. */
function buildPacket(index: number, chunk: Buffer): Buffer {
  const packet = Buffer.alloc(16 + PACKET_DATA_BYTES);
  packet[0] = 0x5a;
  packet[1] = 0x5a;
  packet[2] = 0xef;
  packet[3] = 0xbf;
  packet.writeUInt32BE(index, 4);
  packet.writeUInt32BE(chunk.length, 8);
  packet.writeUInt32BE(crc32(chunk), 12);
  chunk.copy(packet, 16);
  return packet;
}

/** Nombre seguro para la memoria interna: letras, números, - y _. */
function safePrinterFileName(raw: string, data: Buffer): string {
  const isGx = data.subarray(0, 6).toString("latin1") === "xgcode";
  const base = raw
    .replace(/\.(gx|g|gcode)$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${base || "andros"}.${isGx ? "gx" : "g"}`;
}

function assertAccepted(cmd: string, response: string) {
  if (/error|not\s+aviable|not\s+available|fail/i.test(response)) {
    throw new Error(`La impresora rechazó ${cmd}: ${response.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

async function uploadAndPrint(ip: string, port: number, fileName: string, data: Buffer) {
  const path = `0:/user/${fileName}`;
  const conn = await PrinterConnection.open(ip, port);
  try {
    await conn.command("~M601 S1");
    assertAccepted("~M28", await conn.command(`~M28 ${data.length} ${path}`, 10_000));

    for (let offset = 0, index = 0; offset < data.length; offset += PACKET_DATA_BYTES, index += 1) {
      await conn.write(buildPacket(index, data.subarray(offset, offset + PACKET_DATA_BYTES)));
    }
    await conn.write(Buffer.from("\n"));

    assertAccepted("~M29", await conn.command("~M29", UPLOAD_FINISH_TIMEOUT_MS));
    assertAccepted("~M23", await conn.command(`~M23 ${path}`, 20_000));
  } finally {
    conn.close();
  }
}

interface PrintJsonBody {
  action?: string;
  ip?: string;
  port?: number | string;
  fileName?: string;
  content?: string;
  encoding?: "base64" | "text";
}

export async function POST(request: NextRequest) {
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
      ipRaw = body.ip;
      portRaw = body.port;
      nameRaw = body.fileName ?? "andros";
      data = Buffer.from(body.content ?? "", body.encoding === "text" ? "utf8" : "base64");
    } else {
      action = params.get("action");
      ipRaw = params.get("ip");
      portRaw = params.get("port");
      nameRaw = params.get("name") ?? "andros";
      data = Buffer.from(await request.arrayBuffer());
    }
  } catch {
    return badRequest("No se pudo leer el trabajo de impresión.");
  }

  if (action !== "print") return badRequest('Acción no soportada (usa action: "print").');
  const target = parseTarget(ipRaw, portRaw);
  if (typeof target === "string") return badRequest(target);
  if (data.length === 0) return badRequest("El archivo de impresión está vacío.");
  if (data.length > MAX_UPLOAD_BYTES) return badRequest("El archivo supera 128 MB.");

  const fileName = safePrinterFileName(nameRaw, data);
  try {
    await uploadAndPrint(target.ip, target.port, fileName, data);
    return NextResponse.json({ ok: true, fileName, bytes: data.length });
  } catch (e) {
    return connectionError(target.ip, target.port, e);
  }
}
