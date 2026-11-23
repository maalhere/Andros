// ============================================================================
// ANDROS — APP DE ESCRITORIO PARA WINDOWS (Electron, proceso principal)
//
//   · Ventana nativa con barra de título integrada Dual-Engine
//     (Obsidian Monolith #0D0E11 / Paper Modernist #F6F5F2) que sigue el tema
//     de la app en vivo, con los botones nativos de Windows.
//   · Carga: npm run desktop:dev → http://localhost:3000
//            app instalada       → la web de producción (electron/config.cjs)
//   · Login con Google en el NAVEGADOR del sistema (Google bloquea los
//     navegadores embebidos): Andros abre un servidor temporal en 127.0.0.1,
//     el navegador vuelve a él con el código OAuth, la ventana canjea la
//     sesión de Supabase y se trae al frente.
//   · Descargas: siempre con el diálogo nativo "Guardar como…" (el usuario
//     elige carpeta o cancela antes de escribir nada en disco).
//   · Puente nativo de impresora (preload.cjs → window.androsDesktop): busca la
//     FlashForge Adventurer 3 en el Wi-Fi (UDP 19000/48899 + barrido TCP 8899),
//     lee su estado y le envía el .gx — con sockets reales desde este equipo,
//     aunque la web venga de Vercel.
// ============================================================================

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  WebContentsView,
  clipboard,
  ipcMain,
  screen,
  session,
  shell,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const config = require("./config.cjs");
const printer = require("./generated/flashforge.cjs");

const IS_DEV = !app.isPackaged || process.env.ANDROS_DESKTOP_DEV === "1";
const APP_URL = process.env.ANDROS_URL || (app.isPackaged ? config.productionUrl : config.devUrl);
const APP_ORIGIN = new URL(APP_URL).origin;
const ICON = path.join(__dirname, "..", "public", "icons", "icon-512.png");
const TITLE_H = config.titleBarHeight;
const STATE_FILE = () => path.join(app.getPath("userData"), "desktop-state.json");

/** @type {BrowserWindow | null} */
let win = null;
/** @type {WebContentsView | null} */
let view = null;
let theme = "dark";
let pageTitle = config.productName;
let loading = true;

app.setName(config.productName);
if (process.platform === "win32") app.setAppUserModelId(config.appId);
// User-Agent de Chrome estándar de Windows, sin "Electron/x" ni el nombre de
// la app. (Google detecta los navegadores embebidos por más vías que el UA:
// por eso el login va además al navegador del sistema; ver "Login con Google".)
const CHROME_MAJOR = String(process.versions.chrome).split(".")[0];
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// ---------------------------------------------------------------------------
// Estado persistente (tema, tamaño de ventana, última impresora)
// ---------------------------------------------------------------------------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {
    // Sin permisos de escritura: se usan los valores por defecto.
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  writeState({ bounds: win.getNormalBounds(), maximized: win.isMaximized(), theme });
}

function visibleBounds(bounds) {
  if (!bounds || typeof bounds.width !== "number") return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + 40 > a.y;
  });
  return onScreen ? bounds : { width: bounds.width, height: bounds.height };
}

// ---------------------------------------------------------------------------
// Navegación: qué se abre dentro de Andros y qué en el navegador
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_HOST = /^accounts\.google\.[a-z.]+$|^accounts\.youtube\.com$/i;
const SUPABASE_HOST = /(^|\.)supabase\.(co|com|in)$/i;
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:", "bambustudio:", "prusaslicer:", "cura:"]);

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isAppUrl(url) {
  return parseUrl(url)?.origin === APP_ORIGIN;
}

/** Pasos del login con Google vía Supabase (deben quedarse en la ventana). */
function isAuthUrl(url) {
  const u = parseUrl(url);
  if (!u || u.protocol !== "https:") return false;
  return GOOGLE_AUTH_HOST.test(u.hostname) || (SUPABASE_HOST.test(u.hostname) && u.pathname.startsWith("/auth/"));
}

function isAllowedExternal(url) {
  const u = parseUrl(url);
  return Boolean(u && EXTERNAL_SCHEMES.has(u.protocol));
}

function openExternal(url) {
  if (isAllowedExternal(url)) void shell.openExternal(url);
}

function hardenContents(contents) {
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || isAppUrl(url) || isAuthUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAuthUrl(url) || isAppUrl(url) || url === "about:blank" || url.startsWith("blob:")) {
      const c = config.colors[theme];
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: win ?? undefined,
          icon: ICON,
          autoHideMenuBar: true,
          backgroundColor: c.background,
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });

  contents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (items.length) items.push({ type: "separator" });
    }
    if (params.isEditable) {
      items.push(
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { type: "separator" },
        { role: "selectAll", label: "Seleccionar todo" }
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy", label: "Copiar" });
    }
    if (params.linkURL && isAllowedExternal(params.linkURL)) {
      if (items.length) items.push({ type: "separator" });
      items.push(
        { label: "Abrir enlace en el navegador", click: () => openExternal(params.linkURL) },
        { label: "Copiar enlace", click: () => clipboard.writeText(params.linkURL) }
      );
    }
    if (IS_DEV) {
      if (items.length) items.push({ type: "separator" });
      items.push({ label: "Inspeccionar", click: () => contents.inspectElement(params.x, params.y) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win ?? undefined });
  });

  // Atajos de la app de escritorio (sin menú visible, sin pisar los del lienzo).
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key;
    const target = view?.webContents;
    const handled = (() => {
      if (key === "F5" || (input.control && input.shift && key.toLowerCase() === "r")) {
        if (input.shift) target?.reloadIgnoringCache();
        else target?.reload();
        return true;
      }
      if (key === "F11") {
        win?.setFullScreen(!win.isFullScreen());
        return true;
      }
      if (IS_DEV && (key === "F12" || (input.control && input.shift && key.toLowerCase() === "i"))) {
        target?.toggleDevTools();
        return true;
      }
      if (input.alt && key === "ArrowLeft" && target?.navigationHistory.canGoBack()) {
        target.navigationHistory.goBack();
        return true;
      }
      if (input.alt && key === "ArrowRight" && target?.navigationHistory.canGoForward()) {
        target.navigationHistory.goForward();
        return true;
      }
      return false;
    })();
    if (handled) event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Barra de título Dual-Engine
// ---------------------------------------------------------------------------

function syncTitlebar() {
  if (!win || win.isDestroyed()) return;
  const payload = JSON.stringify({ colors: config.colors[theme], title: pageTitle, loading, height: TITLE_H });
  win.webContents.executeJavaScript(`window.androsTitlebar && window.androsTitlebar.update(${payload})`).catch(() => {});
}

function applyTheme(next) {
  if ((next !== "dark" && next !== "light") || next === theme) return;
  theme = next;
  const c = config.colors[theme];
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(c.background);
    try {
      win.setTitleBarOverlay({ color: c.background, symbolColor: c.text, height: TITLE_H });
    } catch {
      // Plataformas sin overlay.
    }
  }
  view?.setBackgroundColor(c.background);
  syncTitlebar();
  writeState({ theme });
}

function layout() {
  if (!win || !view || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const top = win.isFullScreen() ? 0 : TITLE_H;
  view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

// ---------------------------------------------------------------------------
// Sin conexión
// ---------------------------------------------------------------------------

function offlinePage(detail) {
  const c = config.colors[theme];
  const accent = theme === "dark" ? "#3B82F6" : "#C95A3B";
  const hint = IS_DEV
    ? "Arranca el servidor local con <b>npm run dev</b> (o usa <b>npm run desktop:dev</b>)."
    : "Andros necesita internet para abrir tu lienzo. Revisa tu conexión.";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Andros — Sin conexión</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;
font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:${c.background};color:${c.text}}
main{max-width:380px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:${c.muted};margin:0 0 20px}
small{display:block;margin-top:16px;font-size:11px;color:${c.muted}}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:10px;border:0;background:${accent};color:#fff;cursor:pointer}</style>
</head><body><main><h1>Sin conexión</h1><p>${hint}</p>
<button onclick="location.href=${JSON.stringify(APP_URL).replace(/"/g, "&quot;")}">Reintentar</button>
<small>${String(detail).replace(/[<>&]/g, "")} · se reintentará sola</small></main>
<script>setTimeout(function(){location.href=${JSON.stringify(APP_URL)}},5000)</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

function createWindow() {
  const state = readState();
  theme = state.theme === "light" ? "light" : "dark";
  const c = config.colors[theme];
  const bounds = visibleBounds(state.bounds) ?? { width: 1440, height: 900 };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: config.productName,
    icon: ICON,
    backgroundColor: c.background,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: c.background, symbolColor: c.text, height: TITLE_H },
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on("did-finish-load", syncTitlebar);
  void win.loadFile(path.join(__dirname, "titlebar.html"));

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      additionalArguments: [`--andros-origin=${APP_ORIGIN}`],
    },
  });
  view.setBackgroundColor(c.background);
  win.contentView.addChildView(view);
  layout();
  for (const evt of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(evt, layout);
  }

  const wc = view.webContents;
  wc.on("page-title-updated", (_e, title) => {
    pageTitle = title || config.productName;
    win?.setTitle(pageTitle);
    syncTitlebar();
  });
  wc.on("did-start-loading", () => {
    loading = true;
    syncTitlebar();
  });
  wc.on("did-stop-loading", () => {
    loading = false;
    syncTitlebar();
  });
  wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 = navegación cancelada (redirecciones normales del login).
    if (!isMainFrame || code === -3 || !isAppUrl(url)) return;
    void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(description))}`);
  });

  win.once("ready-to-show", () => {
    if (state.maximized) win?.maximize();
    win?.show();
    wc.focus();
  });
  win.on("close", saveWindowState);
  win.on("closed", () => {
    win = null;
    view = null;
  });

  void wc.loadURL(APP_URL);
}

// ---------------------------------------------------------------------------
// Descargas → diálogo nativo "Guardar como…", con progreso en la barra de tareas
// ---------------------------------------------------------------------------

function safeFileName(fileName) {
  return String(fileName || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "descarga";
}

/** Filtros del diálogo: la extensión del archivo primero (".andros.zip" → zip). */
function saveDialogFilters(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const all = { name: "Todos los archivos", extensions: ["*"] };
  return ext ? [{ name: `Archivo .${ext.toUpperCase()}`, extensions: [ext] }, all] : [all];
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  if (onClick) n.on("click", onClick);
  n.show();
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(app.userAgentFallback);

  // Sin setSavePath(): Electron muestra el diálogo "Guardar como…" de Windows
  // y, si el usuario pulsa Cancelar, la descarga se anula sin tocar el disco.
  ses.on("will-download", (_event, item) => {
    const suggested = safeFileName(item.getFilename());
    item.setSaveDialogOptions({
      title: `Guardar "${suggested}" — Andros`,
      defaultPath: path.join(app.getPath("downloads"), suggested),
      buttonLabel: "Guardar",
      filters: saveDialogFilters(suggested),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    item.on("updated", () => {
      const total = item.getTotalBytes();
      if (win && !win.isDestroyed() && total > 0) win.setProgressBar(item.getReceivedBytes() / total);
    });
    item.once("done", (_e, state) => {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      const target = item.getSavePath();
      const name = target ? path.basename(target) : suggested;
      if (state === "completed" && target) {
        notify("Descarga completada", name, () => shell.showItemInFolder(target));
      } else if (state === "interrupted") {
        notify("La descarga no se completó", name);
      }
      // "cancelled": el usuario cerró el diálogo → no se avisa de nada.
    });
  });

  // Sala de voz (Sprint 7.5): micrófono y cámara ("media" / "audioCapture"),
  // compartir pantalla ("display-capture"), elegir audífonos ("speaker-selection")
  // y medios protegidos ("mediaKeySystem"). Solo para el origen de Andros.
  const allowed = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "notifications",
    "fullscreen",
    "media",
    "audioCapture",
    "display-capture",
    "speaker-selection",
    "mediaKeySystem",
    "pointerLock",
  ]);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "openExternal") {
      callback(isAllowedExternal(details.externalURL ?? ""));
      return;
    }
    const origin = parseUrl(details.requestingUrl ?? "")?.origin;
    callback(origin === APP_ORIGIN && allowed.has(permission));
  });
}

// ---------------------------------------------------------------------------
// Puente nativo de impresora (IPC) — solo para la web de Andros
// ---------------------------------------------------------------------------

function assertTrusted(event) {
  if (parseUrl(event.senderFrame?.url ?? "")?.origin !== APP_ORIGIN) {
    throw new Error("Origen no autorizado para usar la impresora.");
  }
}

function parseTarget(ipRaw, portRaw) {
  const ip = String(ipRaw ?? "").trim();
  const port = Number(portRaw) || printer.FLASHFORGE_DEFAULT_PORT;
  if (!printer.isPrivateIPv4(ip)) return "IP local no válida.";
  if (port < 1 || port > 65535) return "Puerto inválido.";
  return { ip, port };
}

function connectionMessage(target, e) {
  return `No se pudo conectar con ${target.ip}:${target.port}. ${printer.describePrinterError(e)}. Comprueba que la impresora está encendida y en el mismo Wi-Fi que este equipo.`;
}

/** Sondeo de estado en pausa mientras se envía un archivo (un solo socket en el 8899). */
const BUSY_STATUS = {
  ok: false,
  busy: true,
  error: "Enviando el archivo a la impresora: el estado se reanuda al terminar.",
};

let discovering = null;

function setupPrinterBridge() {
  ipcMain.handle("andros:printer:discover", async (event) => {
    assertTrusted(event);
    if (!discovering) {
      discovering = printer
        .discoverFlashForge()
        .then((result) => {
          const best = result.printers.find((p) => p.isAdventurer3) ?? result.printers[0];
          if (best) writeState({ printer: { ip: best.ip, port: best.port, name: best.name ?? best.type } });
          return result;
        })
        .catch((e) => ({
          ok: false,
          printers: [],
          subnets: [],
          error: e instanceof Error ? e.message : "No se pudo buscar la impresora.",
        }))
        .finally(() => {
          discovering = null;
        });
    }
    return discovering;
  });

  ipcMain.handle("andros:printer:status", async (event, ip, port) => {
    assertTrusted(event);
    const target = parseTarget(ip, port);
    if (typeof target === "string") return { ok: false, error: target };
    if (printer.isPrinterTransferring(target.ip)) return BUSY_STATUS;
    try {
      return { ok: true, ...(await printer.readPrinterStatus(target.ip, target.port)) };
    } catch (e) {
      if (printer.isPrinterBusyError(e)) return BUSY_STATUS;
      return { ok: false, error: connectionMessage(target, e) };
    }
  });

  ipcMain.handle("andros:printer:print", async (event, ip, port, fileName, data) => {
    assertTrusted(event);
    const target = parseTarget(ip, port);
    if (typeof target === "string") return { ok: false, error: target };
    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      return { ok: false, error: "El archivo de impresión está vacío." };
    }
    if (data.byteLength > printer.MAX_UPLOAD_BYTES) return { ok: false, error: "El archivo supera 128 MB." };
    if (printer.isPrinterTransferring(target.ip)) {
      return { ok: false, error: "Ya se está enviando un archivo a esta impresora. Espera a que termine." };
    }
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    // Nombre remoto corto (≤ 12 caracteres): 0:/user/<nombre>.gx
    const name = printer.safePrinterFileName(String(fileName ?? "andros"), bytes);
    try {
      const remoteName = await printer.uploadAndPrint(target.ip, target.port, name, bytes);
      return { ok: true, fileName: remoteName, bytes: bytes.length };
    } catch (e) {
      return { ok: false, error: connectionMessage(target, e) };
    }
  });

  ipcMain.on("andros:theme", (event, value) => {
    try {
      assertTrusted(event);
      applyTheme(value);
    } catch {
      // Ignorado: mensaje de una página que no es Andros.
    }
  });
}

// ---------------------------------------------------------------------------
// Login con Google en el navegador del sistema (RFC 8252, "loopback")
//
//   1. La web pide `andros:auth:begin` → aquí se abre un servidor temporal en
//      http://127.0.0.1:<puerto libre> con un `state` aleatorio.
//   2. La web genera la URL de Supabase (PKCE: el verificador se queda en las
//      cookies de ESTA ventana) y pide `andros:auth:open` → navegador del sistema.
//   3. Google → Supabase → /auth/callback de Andros, que redirige el código a
//      http://127.0.0.1:<puerto>/auth-callback.
//   4. Se valida el `state` (un solo uso), el código queda pendiente para la
//      ventana (`andros:auth:ready` → `andros:auth:take`), que lo canjea con
//      su verificador PKCE y sale de la portada; la ventana se trae al frente.
//      (Los tokens nunca viajan por la URL del navegador.)
// ---------------------------------------------------------------------------

const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

/** @type {{ server: import("node:http").Server, state: string, port: number, timer: NodeJS.Timeout } | null} */
let authFlow = null;

function stopAuthFlow() {
  if (!authFlow) return;
  const { server, timer } = authFlow;
  authFlow = null;
  clearTimeout(timer);
  server.close();
  server.closeAllConnections?.();
}

/** Pide el foco una vez con el truco "siempre encima" (Windows bloquea robar el foco). */
function raiseWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
  win.moveTop();
  view?.webContents.focus();
}

function bringToFront() {
  if (!win || win.isDestroyed()) return;
  raiseWindow();
  // El navegador acaba de recibir la respuesta y a veces recupera el foco justo
  // después: se reintenta tras un instante y, si Windows aún lo impide, la
  // ventana parpadea en la barra de tareas hasta que el usuario la abre.
  setTimeout(() => {
    if (!win || win.isDestroyed() || win.isFocused()) return;
    raiseWindow();
    if (!win.isFocused()) {
      win.flashFrame(true);
      win.once("focus", () => win?.flashFrame(false));
    }
  }, 350);
}

// ---------------------------------------------------------------------------
// Entrega del resultado del login a la ventana (exactamente una vez)
//
// El resultado se guarda aquí hasta que la web lo recoge (`andros:auth:take`).
// Si la página estaba recargando cuando volvió el navegador, lo recoge al
// terminar de cargar, en vez de perderse.
// ---------------------------------------------------------------------------

const AUTH_RESULT_TTL_MS = 5 * 60 * 1000;
/** @type {{ payload: { code?: string, error?: string }, expires: number } | null} */
let pendingAuthResult = null;

function deliverAuthResult(payload) {
  pendingAuthResult = { payload, expires: Date.now() + AUTH_RESULT_TTL_MS };
  const target = view?.webContents;
  if (target && !target.isDestroyed()) target.send("andros:auth:ready");
}

function takeAuthResult() {
  const pending = pendingAuthResult;
  pendingAuthResult = null;
  return pending && pending.expires > Date.now() ? pending.payload : null;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function authResultPage(ok, message) {
  const c = config.colors[theme];
  const accent = ok ? (theme === "dark" ? "#10B981" : "#4F6B58") : theme === "dark" ? "#3B82F6" : "#C95A3B";
  const title = ok ? "Sesión iniciada — volviendo a Andros" : "No se pudo iniciar sesión";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Andros — ${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;
font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:${c.background};color:${c.text}}
main{max-width:420px;text-align:center}.dot{width:44px;height:44px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;
background:${accent}22;color:${accent};font-size:22px;font-weight:700}h1{font-size:20px;margin:0 0 8px}
p{font-size:14px;line-height:1.5;color:${c.muted};margin:0}</style></head><body><main>
<div class="dot">${ok ? "✓" : "!"}</div><h1>${title}</h1><p>${escapeHtml(message)}</p></main>
${ok ? "<script>setTimeout(function(){window.close()},1500)</script>" : ""}</body></html>`;
}

/** Procesa la vuelta del navegador. Devuelve el texto para la pestaña. */
function handleAuthCallback(params) {
  if (!authFlow || params.get("state") !== authFlow.state) {
    return {
      ok: false,
      message: "Este inicio de sesión caducó o no lo pidió esta app. Vuelve a Andros y pulsa «Continuar con Google» otra vez.",
    };
  }
  // Un solo uso: el servidor se cierra cuando termine de enviar esta respuesta.
  clearTimeout(authFlow.timer);
  authFlow = null;

  const code = params.get("code") ?? "";
  const providerError = params.get("error_description") || params.get("error");
  const validCode = /^[\w.~-]{6,1024}$/.test(code);
  // La ventana canjea el código con su verificador PKCE (supabase.auth
  // .exchangeCodeForSession), lo que deja la sesión activa y cierra la portada.
  deliverAuthResult(validCode ? { code } : { error: providerError || "Google no devolvió un código de acceso." });
  bringToFront();

  return validCode
    ? { ok: true, message: "Ya puedes cerrar esta pestaña: Andros está abriendo tu lienzo." }
    : { ok: false, message: `${providerError || "Se canceló el inicio de sesión."} Vuelve a Andros para reintentarlo.` };
}

function startAuthFlow() {
  stopAuthFlow();
  const state = crypto.randomBytes(24).toString("base64url");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || (url.pathname !== "/auth-callback" && url.pathname !== "/callback")) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
        return;
      }
      const result = handleAuthCallback(url.searchParams);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        Connection: "close",
      });
      res.end(authResultPage(result.ok, result.message));
      if (authFlow?.server !== server) res.once("finish", () => server.close());
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      authFlow = { server, state, port, timer: setTimeout(stopAuthFlow, AUTH_TIMEOUT_MS) };
      resolve({ port, state });
    });
  });
}

/** Solo se abre en el navegador la pantalla de autorización OAuth de Supabase. */
function isOAuthAuthorizeUrl(url) {
  const u = parseUrl(url);
  return Boolean(u && u.protocol === "https:" && u.pathname.endsWith("/auth/v1/authorize"));
}

function setupAuthBridge() {
  ipcMain.handle("andros:auth:begin", async (event) => {
    assertTrusted(event);
    return startAuthFlow();
  });

  ipcMain.handle("andros:auth:open", async (event, url) => {
    assertTrusted(event);
    if (!authFlow) throw new Error("Primero hay que preparar el inicio de sesión.");
    if (!isOAuthAuthorizeUrl(url)) throw new Error("Dirección de inicio de sesión no válida.");
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("andros:auth:cancel", async (event) => {
    assertTrusted(event);
    stopAuthFlow();
    return true;
  });

  // La web recoge el resultado pendiente (una sola vez).
  ipcMain.handle("andros:auth:take", async (event) => {
    assertTrusted(event);
    return takeAuthResult();
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Reglas de navegación, menú contextual y atajos para TODAS las ventanas
  // (incluidas las emergentes del login con Google).
  app.on("web-contents-created", (_event, contents) => hardenContents(contents));

  app.whenReady().then(() => {
    setupSession();
    setupPrinterBridge();
    setupAuthBridge();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", stopAuthFlow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
