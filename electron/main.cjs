// ============================================================================
// ANDROS — APP DE ESCRITORIO PARA WINDOWS (Electron, proceso principal)
//
//   · Ventana nativa con barra de título integrada Dual-Engine
//     (Obsidian Monolith #0D0E11 / Paper Modernist #F6F5F2) que sigue el tema
//     de la app en vivo, con los botones nativos de Windows.
//   · Carga: npm run desktop:dev → http://localhost:3000
//            app instalada       → la web de producción (electron/config.cjs)
//   · Login con Google (Supabase OAuth) dentro de la ventana, descargas
//     directas a la carpeta Descargas con aviso al terminar.
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
const fs = require("node:fs");
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
// User-Agent de Chrome estándar: Google bloquea el login en navegadores "Electron".
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

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
// Descargas → carpeta Descargas, con progreso en la barra de tareas
// ---------------------------------------------------------------------------

function uniquePath(dir, fileName) {
  const safe = fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "descarga";
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; fs.existsSync(candidate); i += 1) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
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

  ses.on("will-download", (_event, item) => {
    const target = uniquePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(target);
    item.on("updated", () => {
      const total = item.getTotalBytes();
      if (win && !win.isDestroyed() && total > 0) win.setProgressBar(item.getReceivedBytes() / total);
    });
    item.once("done", (_e, state) => {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      if (state === "completed") {
        notify("Descarga completada", path.basename(target), () => shell.showItemInFolder(target));
      } else if (state === "interrupted") {
        notify("La descarga no se completó", path.basename(target));
      }
    });
  });

  const allowed = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "notifications",
    "fullscreen",
    "media",
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
  const message = e instanceof Error ? e.message : "Error desconocido";
  return `No se pudo conectar con ${target.ip}:${target.port}. ${message}. Comprueba que la impresora está encendida y en el mismo Wi-Fi que este equipo.`;
}

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
    try {
      return { ok: true, ...(await printer.readPrinterStatus(target.ip, target.port)) };
    } catch (e) {
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
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const name = printer.safePrinterFileName(String(fileName ?? "andros"), bytes);
    try {
      await printer.uploadAndPrint(target.ip, target.port, name, bytes);
      return { ok: true, fileName: name, bytes: bytes.length };
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
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
