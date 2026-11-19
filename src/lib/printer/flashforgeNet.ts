// ============================================================================
// ANDROS — NÚCLEO DE RED FLASHFORGE ADVENTURER 3 (Node.js)
//
// Un único código para dos sitios:
//   · La ruta /api/printer/flashforge (Next.js corriendo en local).
//   · La app de Windows (electron/main.cjs), que lo recibe ya compilado por
//     esbuild en electron/generated/flashforge.cjs.
//
// Protocolo (TCP 8899, M-codes de FlashForge):
//   estado   → ~M601 S1 · ~M115 · ~M105 · ~M27 · ~M602
//   imprimir → ~M601 S1 → ~M28 <bytes> 0:/user/<nombre>.gx (espera "ok") →
//              paquete 1 → respuesta → paquete 2 → respuesta → … →
//              ~M29 (espera "ok") → ~M23 0:/user/<nombre>.gx → ~M602
//   buscar   → anuncio UDP (225.0.0.9:19000 y broadcast :19000/:48899) +
//              barrido TCP concurrente de la subred local al puerto 8899,
//              confirmando cada candidata con ~M601 S1 y ~M115.
//
// Reglas del firmware real de la Adventurer 3 (causas de ECONNRESET):
//   1. Solo admite UNA conexión TCP a la vez en el 8899. Todas las sesiones
//      (estado, impresión, búsqueda) pasan por una cola por IP y entre una y
//      otra se deja un respiro para que la impresora libere el socket. El
//      estado no se consulta mientras se transfiere un archivo.
//   2. Los datos van en paquetes de 4096 bytes con cabecera de 16 bytes
//      (firma 5A 5A A5 A5, nº de paquete, longitud y CRC-32, big-endian) y se
//      envían de uno en uno, esperando la respuesta de la impresora antes del
//      siguiente. Si el firmware no confirma paquetes, se pasa a ritmo fijo.
//   3. Nombres remotos cortos: máximo 12 caracteres [a-z0-9_] + extensión.
// ============================================================================

import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import {
  FLASHFORGE_DEFAULT_PORT,
  isAdventurer3Name,
  isPrivateIPv4,
  type DiscoveredPrinter,
  type DiscoveryResult,
  type PrinterStatusData,
} from "./flashforgeShared";

export { FLASHFORGE_DEFAULT_PORT, isPrivateIPv4 };

const COMMAND_TIMEOUT_MS = 4000;
const UPLOAD_FINISH_TIMEOUT_MS = 90_000;
/** Silencio máximo del socket (~M29 puede tardar en archivos grandes). */
const IDLE_TIMEOUT_MS = 120_000;
const PACKET_DATA_BYTES = 4096;
const PACKET_HEADER = [0x5a, 0x5a, 0xa5, 0xa5] as const;
/** Espera de la respuesta a cada paquete y reintentos suaves si tarda. */
const PACKET_ACK_TIMEOUT_MS = 1500;
const PACKET_ACK_RETRIES = 4;
/** Ritmo fijo entre paquetes si el firmware no responde a cada uno. */
const PACED_PACKET_GAP_MS = 25;
/** Respiro entre dos sesiones TCP seguidas a la misma impresora. */
const SESSION_GAP_MS = 400;
/** Espera antes de reintentar una conexión reseteada o rechazada. */
const RECONNECT_DELAY_MS = 400;
const REMOTE_NAME_MAX = 12;
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Un solo socket activo por impresora (cola por IP)
// ---------------------------------------------------------------------------

interface LockState {
  queues: Map<string, Promise<void>>;
  lastClosedAt: Map<string, number>;
  /** Transferencias de impresión en curso (o esperando turno) por IP. */
  transfers: Map<string, number>;
}

// En globalThis: la recarga en caliente de Next.js no debe duplicar las colas.
const lockState: LockState = ((globalThis as { __androsFlashForgeLocks?: LockState }).__androsFlashForgeLocks ??= {
  queues: new Map(),
  lastClosedAt: new Map(),
  transfers: new Map(),
});

/** Ejecuta `fn` cuando no haya otra sesión abierta con `ip` (FIFO). */
function withPrinterLock<T>(ip: string, fn: () => Promise<T>): Promise<T> {
  const previous = lockState.queues.get(ip) ?? Promise.resolve();
  const run = previous.then(async () => {
    const wait = SESSION_GAP_MS - (Date.now() - (lockState.lastClosedAt.get(ip) ?? 0));
    if (wait > 0) await delay(wait);
    try {
      return await fn();
    } finally {
      lockState.lastClosedAt.set(ip, Date.now());
    }
  });
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  lockState.queues.set(ip, tail);
  void tail.then(() => {
    if (lockState.queues.get(ip) === tail) lockState.queues.delete(ip);
  });
  return run;
}

/** true mientras se envía (o espera turno para enviar) un archivo a `ip`. */
export function isPrinterTransferring(ip: string): boolean {
  return (lockState.transfers.get(ip) ?? 0) > 0;
}

export class PrinterBusyError extends Error {
  constructor() {
    super("Enviando un archivo a la impresora: el estado se reanuda al terminar.");
    this.name = "PrinterBusyError";
  }
}

export function isPrinterBusyError(e: unknown): boolean {
  return e instanceof Error && e.name === "PrinterBusyError";
}

function errorCode(e: unknown): string {
  return (e as NodeJS.ErrnoException | null)?.code ?? "";
}

/** Mensaje claro en español para un fallo de red con la impresora. */
export function describePrinterError(e: unknown): string {
  const code = errorCode(e);
  const raw = e instanceof Error ? e.message : "Error desconocido";
  switch (code) {
    case "ECONNRESET":
    case "EPIPE":
      return `La impresora cortó la conexión (${code}). Suele pasar si FlashPrint u otra app la tiene abierta, o si la red bloquea el tráfico entre equipos`;
    case "ECONNREFUSED":
      return "La impresora rechazó la conexión en el puerto 8899 (ECONNREFUSED). Comprueba que el Wi-Fi está activo en su pantalla";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `No hay ruta hasta la impresora (${code}). La red puede tener aislamiento de clientes (habitual en redes de empresa o universidad)`;
    case "ETIMEDOUT":
      return "La impresora no respondió a tiempo (ETIMEDOUT)";
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Conexión con la impresora
// ---------------------------------------------------------------------------

export class PrinterConnection {
  private readonly socket = new net.Socket();
  private buffer = "";
  private failure: Error | null = null;
  private waiter: {
    done: (text: string) => boolean;
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  static open(host: string, port: number, timeoutMs = COMMAND_TIMEOUT_MS): Promise<PrinterConnection> {
    const conn = new PrinterConnection();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.socket.destroy();
        const err = new Error("La impresora no respondió a la conexión") as NodeJS.ErrnoException;
        err.code = "ETIMEDOUT";
        reject(err);
      }, timeoutMs);
      conn.socket.once("error", (e) => {
        clearTimeout(timer);
        conn.close();
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
    this.socket.setKeepAlive(true, 10_000);
    this.socket.setTimeout(IDLE_TIMEOUT_MS);
    this.socket.on("timeout", () => this.fail(new Error("La conexión con la impresora quedó inactiva")));
    this.socket.on("error", (e) => this.fail(e));
    this.socket.on("close", () => {
      const err = new Error("La impresora cerró la conexión") as NodeJS.ErrnoException;
      err.code = "ECONNRESET";
      this.fail(err);
    });
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

  /**
   * Espera a que lo recibido cumpla `done`. Resuelve con el texto, o con null
   * si vence el plazo; rechaza si la conexión falla.
   */
  private wait(done: (text: string) => boolean, timeoutMs: number): Promise<string | null> {
    if (this.failure) return Promise.reject(this.failure);
    if (done(this.buffer)) return Promise.resolve(this.buffer.trim());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve(null);
      }, timeoutMs);
      this.waiter = { done, resolve, reject, timer };
    });
  }

  /** Envía `~Mxxx …` y espera "CMD Mxxx Received." seguido de "ok". */
  async command(cmd: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    if (this.failure) throw this.failure;
    const code = /M\d+/.exec(cmd)?.[0] ?? "";
    // Se exige el eco "CMD Mxxx" para no confundir un "ok" tardío de otro comando.
    const marker = new RegExp(`CMD\\s+${code}\\b`, "i");
    const done = (text: string) =>
      marker.test(text) && (/\bok\b\s*$/i.test(text) || /error[^\n]*\n\s*$/i.test(text));
    this.buffer = "";
    const pending = this.wait(done, timeoutMs);
    await this.write(Buffer.from(`${cmd}\r\n`, "latin1"));
    const reply = await pending;
    if (reply === null) throw new Error(`La impresora no respondió a ${cmd}`);
    return reply;
  }

  /** Descarta lo recibido hasta ahora (antes de enviar un paquete). */
  clearInput() {
    this.buffer = "";
  }

  /** Devuelve y limpia lo recibido sin esperar. */
  takeInput(): string {
    const text = this.buffer;
    this.buffer = "";
    return text;
  }

  /**
   * Espera cualquier respuesta de la impresora durante `timeoutMs`.
   * Devuelve el texto recibido, o null si no llegó nada (sin error).
   */
  async waitForReply(timeoutMs: number): Promise<string | null> {
    const text = await this.wait((t) => t.length > 0, timeoutMs);
    if (text !== null) this.buffer = "";
    return text;
  }

  /** Escribe bytes y resuelve cuando el sistema los ha aceptado. */
  write(data: Buffer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => {
        if (err) reject(this.failure ?? err);
        else if (this.failure) reject(this.failure);
        else resolve();
      });
    });
  }

  close() {
    if (this.waiter) clearTimeout(this.waiter.timer);
    this.waiter = null;
    this.socket.removeAllListeners("close");
    if (this.socket.destroyed) return;
    // Cierre ordenado (FIN) para que la impresora libere su única conexión;
    // si no contesta, se fuerza al segundo.
    this.socket.end();
    const force = setTimeout(() => this.socket.destroy(), 1000);
    force.unref?.();
    this.socket.once("close", () => clearTimeout(force));
  }
}

// ---------------------------------------------------------------------------
// Sesión de control (~M601 S1) con reintento
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ECONNABORTED", "CONTROL_BUSY"]);

/** Libera una sesión de control que se quedó colgada (~M602). */
async function releaseStaleControl(ip: string, port: number) {
  let conn: PrinterConnection | null = null;
  try {
    conn = await PrinterConnection.open(ip, port, 2000);
    await conn.command("~M602", 1500);
  } catch {
    // Si tampoco acepta esto, el siguiente intento lo dirá.
  } finally {
    conn?.close();
  }
}

/**
 * Abre la conexión y toma el control con ~M601 S1. Si la impresora resetea,
 * rechaza o dice "Control failed", libera con ~M602 y reintenta tras 400 ms.
 */
async function openSession(ip: string, port: number, attempts: number, timeoutMs = COMMAND_TIMEOUT_MS) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(RECONNECT_DELAY_MS);
      await releaseStaleControl(ip, port);
      await delay(RECONNECT_DELAY_MS);
    }
    let conn: PrinterConnection | null = null;
    try {
      conn = await PrinterConnection.open(ip, port, timeoutMs);
      const reply = await conn.command("~M601 S1", timeoutMs);
      if (/control\s+fail/i.test(reply)) {
        const err = new Error("Otra aplicación tiene el control de la impresora (FlashPrint)") as NodeJS.ErrnoException;
        err.code = "CONTROL_BUSY";
        throw err;
      }
      return conn;
    } catch (e) {
      conn?.close();
      lastError = e;
      if (!RETRYABLE_CODES.has(errorCode(e))) break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Estado
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

/** Lee el estado. Lanza PrinterBusyError si hay una transferencia en curso. */
export async function readPrinterStatus(ip: string, port: number): Promise<PrinterStatusData> {
  if (isPrinterTransferring(ip)) throw new PrinterBusyError();
  return withPrinterLock(ip, async () => {
    // Pudo empezar una impresión mientras esperaba turno.
    if (isPrinterTransferring(ip)) throw new PrinterBusyError();
    const conn = await openSession(ip, port, 2);
    try {
      const info = await conn.command("~M115");
      const temps = await conn.command("~M105");
      const progress = await conn.command("~M27");
      await conn.command("~M602").catch(() => "");
      return {
        machine: {
          type: field(info, "Machine Type"),
          name: field(info, "Machine Name"),
          firmware: field(info, "Firmware"),
          sn: field(info, "SN"),
        },
        temperatures: parseTemps(temps),
        progress: parseProgress(progress),
      };
    } finally {
      conn.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Imprimir
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

/** Paquete de red: firma 5A 5A A5 A5 · nº (BE) · longitud (BE) · CRC-32 (BE) · 4096 bytes. */
function buildPacket(index: number, chunk: Buffer): Buffer {
  const packet = Buffer.alloc(16 + PACKET_DATA_BYTES);
  PACKET_HEADER.forEach((byte, i) => {
    packet[i] = byte;
  });
  packet.writeUInt32BE(index, 4);
  packet.writeUInt32BE(chunk.length, 8);
  packet.writeUInt32BE(crc32(chunk), 12);
  chunk.copy(packet, 16);
  return packet;
}

/**
 * Nombre corto para la memoria interna (0:/user/): como máximo 12 caracteres
 * [a-z0-9_] + extensión. El firmware falla con nombres largos o especiales.
 */
export function safePrinterFileName(raw: string, data: Buffer): string {
  const isGx = data.subarray(0, 6).toString("latin1") === "xgcode";
  const base = raw
    .replace(/^.*[\\/]/, "")
    .replace(/\.(gx|g|gcode)$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, REMOTE_NAME_MAX)
    .replace(/_+$/g, "");
  return `${base || "andros_job"}.${isGx ? "gx" : "g"}`;
}

function assertAccepted(cmd: string, response: string) {
  if (/error|not\s+aviable|not\s+available|fail/i.test(response)) {
    throw new Error(`La impresora rechazó ${cmd}: ${response.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
}

/**
 * Envía los paquetes de uno en uno: tras cada paquete espera la respuesta de
 * la impresora (con reintentos suaves). Si el firmware no responde ni al
 * primero, continúa a ritmo fijo para no saturar su búfer.
 */
async function sendPackets(conn: PrinterConnection, data: Buffer, onProgress?: (p: UploadProgress) => void) {
  const total = Math.ceil(data.length / PACKET_DATA_BYTES);
  let acknowledged = 0;
  let paced = false;

  for (let index = 0; index < total; index += 1) {
    const offset = index * PACKET_DATA_BYTES;
    const chunk = data.subarray(offset, offset + PACKET_DATA_BYTES);
    conn.clearInput();
    await conn.write(buildPacket(index, chunk));

    if (paced) {
      await delay(PACED_PACKET_GAP_MS);
      const late = conn.takeInput();
      if (late) assertAccepted(`el paquete ${index + 1}/${total}`, late);
    } else {
      let reply = await conn.waitForReply(PACKET_ACK_TIMEOUT_MS);
      for (let retry = 0; reply === null && retry < PACKET_ACK_RETRIES; retry += 1) {
        reply = await conn.waitForReply(PACKET_ACK_TIMEOUT_MS);
      }
      if (reply !== null) {
        acknowledged += 1;
        assertAccepted(`el paquete ${index + 1}/${total}`, reply);
      } else if (acknowledged === 0) {
        // Firmware que no confirma paquetes: ritmo fijo a partir de aquí.
        paced = true;
      } else {
        throw new Error(`La impresora dejó de responder en el paquete ${index + 1} de ${total}`);
      }
    }
    onProgress?.({ sentBytes: Math.min(data.length, offset + chunk.length), totalBytes: data.length });
  }
}

/**
 * Sube el archivo a 0:/user/ y empieza a imprimir. `fileName` debe venir de
 * safePrinterFileName (se vuelve a acortar por seguridad).
 */
export async function uploadAndPrint(
  ip: string,
  port: number,
  fileName: string,
  data: Buffer,
  onProgress?: (p: UploadProgress) => void
): Promise<string> {
  const remoteName = safePrinterFileName(fileName, data);
  const path = `0:/user/${remoteName}`;
  // Se marca antes de esperar turno: el sondeo de estado se pausa ya.
  lockState.transfers.set(ip, (lockState.transfers.get(ip) ?? 0) + 1);
  try {
    return await withPrinterLock(ip, async () => {
      const conn = await openSession(ip, port, 3);
      try {
        // 1. Anuncia el archivo y espera su "ok" antes del primer byte binario.
        assertAccepted("~M28", await conn.command(`~M28 ${data.length} ${path}`, 15_000));
        // 2. Paquete → respuesta → paquete…
        await sendPackets(conn, data, onProgress);
        // 3. Cierra el archivo, espera su "ok" y lanza la impresión.
        assertAccepted("~M29", await conn.command("~M29", UPLOAD_FINISH_TIMEOUT_MS));
        assertAccepted("~M23", await conn.command(`~M23 ${path}`, 20_000));
        await conn.command("~M602", 1500).catch(() => "");
        return remoteName;
      } finally {
        conn.close();
      }
    });
  } finally {
    const left = (lockState.transfers.get(ip) ?? 1) - 1;
    if (left > 0) lockState.transfers.set(ip, left);
    else lockState.transfers.delete(ip);
  }
}

// ---------------------------------------------------------------------------
// Autodetección en la red local
// ---------------------------------------------------------------------------

const UDP_DISCOVERY_PORTS = [19000, 48899];
const UDP_MULTICAST_GROUP = "225.0.0.9";
/** Paquete de anuncio que usa FlashPrint para buscar impresoras. */
const UDP_DISCOVERY_PAYLOAD = Buffer.from([
  0x77, 0x77, 0x77, 0x2e, 0x75, 0x73, 0x72, 0x22, 0x65, 0x36, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
]);
const UDP_LISTEN_MS = 1500;
const SWEEP_CONCURRENCY = 96;
const MAX_SUBNETS = 4;
const VIRTUAL_ADAPTER = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn/i;
const FLASHFORGE_NAME = /adventurer|flashforge|finder|guider|creator|dreamer|inventor/i;

interface LocalNetwork {
  address: string;
  /** Primeros 3 octetos: "192.168.1". */
  prefix: string;
  broadcast: string;
  virtual: boolean;
}

function toInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function toIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function localNetworks(): { networks: LocalNetwork[]; ownAddresses: Set<string> } {
  const ownAddresses = new Set<string>();
  const byPrefix = new Map<string, LocalNetwork>();
  for (const [ifaceName, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      // `family` es "IPv4" (Node ≥ 18.4) o 4 en versiones antiguas.
      if (String(info.family) !== "IPv4" && String(info.family) !== "4") continue;
      ownAddresses.add(info.address);
      if (info.internal || !isPrivateIPv4(info.address) || info.address.startsWith("169.254.")) continue;
      const prefix = info.address.split(".").slice(0, 3).join(".");
      if (byPrefix.has(prefix)) continue;
      const broadcast = toIp((toInt(info.address) | ~toInt(info.netmask || "255.255.255.0")) >>> 0);
      byPrefix.set(prefix, { address: info.address, prefix, broadcast, virtual: VIRTUAL_ADAPTER.test(ifaceName) });
    }
  }
  // Primero el Wi-Fi / Ethernet real; los adaptadores virtuales al final.
  const networks = [...byPrefix.values()].sort((a, b) => Number(a.virtual) - Number(b.virtual)).slice(0, MAX_SUBNETS);
  return { networks, ownAddresses };
}

function parseUdpName(msg: Buffer): string | null {
  const end = msg.indexOf(0);
  const raw = msg.subarray(0, end === -1 ? Math.min(msg.length, 64) : Math.min(end, 64)).toString("latin1");
  const clean = raw.replace(/[^\x20-\x7e]/g, "").trim();
  return clean.length >= 2 ? clean : null;
}

/** Envía el anuncio UDP y escucha respuestas durante `listenMs`. */
function udpAnnounce(
  networks: LocalNetwork[],
  ownAddresses: Set<string>,
  listenMs: number,
  onReply: (ip: string, name: string | null) => void
): Promise<void> {
  return new Promise((resolve) => {
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // Ya cerrado.
      }
      resolve();
    };
    socket.on("error", finish);
    socket.on("message", (msg, rinfo) => {
      if (!isPrivateIPv4(rinfo.address) || ownAddresses.has(rinfo.address)) return;
      onReply(rinfo.address, parseUdpName(msg));
    });
    socket.bind(0, () => {
      const send = (host: string) => {
        for (const port of UDP_DISCOVERY_PORTS) {
          socket.send(UDP_DISCOVERY_PAYLOAD, port, host, () => {
            // Los errores de envío (red sin broadcast, etc.) no detienen la búsqueda.
          });
        }
      };
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch {
        // Sin broadcast: queda el barrido TCP.
      }
      for (const n of networks) {
        try {
          socket.setMulticastInterface(n.address);
          send(UDP_MULTICAST_GROUP);
        } catch {
          // Interfaz sin multicast.
        }
        send(n.broadcast);
      }
      send("255.255.255.255");
      setTimeout(finish, listenMs);
    });
  });
}

/** ¿Acepta conexiones TCP en `port`? (timeout corto). */
function probeTcp(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const end = (open: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => end(false), timeoutMs);
    socket.once("connect", () => end(true));
    socket.once("error", () => end(false));
    socket.connect(port, ip);
  });
}

/** Confirma con ~M601 S1 + ~M115 que es una FlashForge y lee su modelo. */
async function identifyPrinter(ip: string, port: number, via: "udp" | "tcp"): Promise<DiscoveredPrinter | null> {
  if (isPrinterTransferring(ip)) return null;
  return withPrinterLock(ip, async () => {
    let conn: PrinterConnection | null = null;
    try {
      conn = await PrinterConnection.open(ip, port, 1500);
      await conn.command("~M601 S1", 2500).catch(() => "");
      const info = await conn.command("~M115", 2500);
      await conn.command("~M602", 1500).catch(() => "");
      if (!/machine\s+type|machine\s+name|firmware/i.test(info)) return null;
      const type = field(info, "Machine Type");
      const name = field(info, "Machine Name");
      return {
        ip,
        port,
        name,
        type,
        firmware: field(info, "Firmware"),
        serial: field(info, "SN"),
        isAdventurer3: isAdventurer3Name(`${type ?? ""} ${name ?? ""}`),
        verified: true,
        via,
      };
    } catch {
      return null;
    } finally {
      conn?.close();
    }
  });
}

async function runPool<T>(items: T[], limit: number, shouldStop: () => boolean, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface DiscoverOptions {
  /** Timeout de conexión TCP del primer barrido (ms). Por defecto 250. */
  connectTimeoutMs?: number;
  /** Termina en cuanto confirma una Adventurer 3. Por defecto true. */
  stopOnFirstAdventurer3?: boolean;
}

/**
 * Busca impresoras FlashForge en la red local sin pedir la IP al usuario.
 * Devuelve primero las Adventurer 3 confirmadas.
 */
export async function discoverFlashForge(options: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 250;
  const stopOnFirst = options.stopOnFirstAdventurer3 ?? true;
  const { networks, ownAddresses } = localNetworks();
  const subnets = networks.map((n) => `${n.prefix}.0/24`);
  if (networks.length === 0) {
    return { ok: false, printers: [], subnets, error: "Este equipo no está conectado a una red Wi-Fi o local." };
  }

  const found = new Map<string, DiscoveredPrinter>();
  const pending = new Set<string>();
  const udpNames = new Map<string, string | null>();
  const identifications: Promise<void>[] = [];
  let stop = false;

  const consider = (ip: string, via: "udp" | "tcp") => {
    if (found.has(ip) || pending.has(ip)) return;
    pending.add(ip);
    identifications.push(
      identifyPrinter(ip, FLASHFORGE_DEFAULT_PORT, via).then((printer) => {
        pending.delete(ip);
        if (!printer) return;
        if (!printer.name) printer.name = udpNames.get(ip) ?? null;
        found.set(ip, printer);
        if (printer.isAdventurer3 && stopOnFirst) stop = true;
      })
    );
  };

  const drain = async () => {
    for (;;) {
      const count = identifications.length;
      await Promise.all(identifications);
      if (identifications.length === count) return;
    }
  };

  const hosts: string[] = [];
  for (const n of networks) {
    for (let h = 1; h <= 254; h += 1) {
      const ip = `${n.prefix}.${h}`;
      if (!ownAddresses.has(ip)) hosts.push(ip);
    }
  }

  const sweep = (timeoutMs: number) =>
    runPool(
      // Nunca se abre un segundo socket contra una impresora que está recibiendo un archivo.
      hosts.filter((ip) => !found.has(ip) && !pending.has(ip) && !isPrinterTransferring(ip)),
      SWEEP_CONCURRENCY,
      () => stop,
      async (ip) => {
        const open = await withPrinterLock(ip, () => probeTcp(ip, FLASHFORGE_DEFAULT_PORT, timeoutMs));
        if (open) consider(ip, "tcp");
      }
    );

  const udp = udpAnnounce(networks, ownAddresses, UDP_LISTEN_MS, (ip, name) => {
    if (name || !udpNames.has(ip)) udpNames.set(ip, name);
    consider(ip, "udp");
  });

  await sweep(connectTimeoutMs);
  await udp;
  await drain();

  // Wi-Fi lento (impresora en ahorro de energía): segundo barrido más paciente.
  if (!stop && found.size === 0) {
    await sweep(Math.max(800, connectTimeoutMs * 3));
    await drain();
  }

  // Respondió al anuncio UDP pero está ocupada (p. ej. FlashPrint conectado).
  for (const [ip, name] of udpNames) {
    if (found.has(ip) || !name || !FLASHFORGE_NAME.test(name)) continue;
    found.set(ip, {
      ip,
      port: FLASHFORGE_DEFAULT_PORT,
      name,
      type: null,
      firmware: null,
      serial: null,
      isAdventurer3: isAdventurer3Name(name),
      verified: false,
      via: "udp",
    });
  }

  const printers = [...found.values()].sort(
    (a, b) => Number(b.isAdventurer3) - Number(a.isAdventurer3) || Number(b.verified) - Number(a.verified)
  );
  return { ok: true, printers, subnets };
}
