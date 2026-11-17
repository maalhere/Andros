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
//   imprimir → ~M601 S1 → ~M28 <bytes> 0:/user/<nombre>.gx → datos →
//              ~M29 → ~M23 0:/user/<nombre>.gx   (empieza a calentar sola)
//   buscar   → anuncio UDP (225.0.0.9:19000 y broadcast :19000/:48899) +
//              barrido TCP concurrente de la subred local al puerto 8899,
//              confirmando cada candidata con ~M601 S1 y ~M115.
//
// Los datos se envían en paquetes de 4096 bytes con cabecera de 16 bytes
// (firma, nº de paquete, longitud y CRC-32), el formato de red de la
// Adventurer 3.
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
const UPLOAD_FINISH_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 30_000;
const PACKET_DATA_BYTES = 4096;
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

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
        conn.close();
        reject(new Error("La impresora no respondió a la conexión"));
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

export async function readPrinterStatus(ip: string, port: number): Promise<PrinterStatusData> {
  const conn = await PrinterConnection.open(ip, port);
  try {
    await conn.command("~M601 S1");
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
export function safePrinterFileName(raw: string, data: Buffer): string {
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

export async function uploadAndPrint(ip: string, port: number, fileName: string, data: Buffer) {
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
      hosts.filter((ip) => !found.has(ip) && !pending.has(ip)),
      SWEEP_CONCURRENCY,
      () => stop,
      async (ip) => {
        if (await probeTcp(ip, FLASHFORGE_DEFAULT_PORT, timeoutMs)) consider(ip, "tcp");
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
