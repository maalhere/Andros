// ============================================================================
// ANDROS — PRELOAD DE LA APP DE WINDOWS
// Expone `window.androsDesktop` SOLO a la web de Andros (mismo origen que la
// app cargada). Las páginas del login de Google no reciben nada.
//   · printer.discover() → busca la Adventurer 3 en el Wi-Fi
//   · printer.status(ip, port) → temperaturas / progreso
//   · printer.print(ip, port, fileName, bytes) → envía el .gx e imprime
//   · klipper.status / klipper.print → Moonraker (Creality K2 SE, K1, Elegoo, QIDI)
//   · slicers.detect() / slicers.open(id, fileName, bytes) → laminador instalado
//   · auth.begin() / auth.openInBrowser(url) / auth.onResult(cb) → login con
//     Google en el navegador del sistema con vuelta automática a la app
// Además sincroniza el tema (clase "dark" en <html>) con la barra de título.
// ============================================================================

const { contextBridge, ipcRenderer } = require("electron");

const ORIGIN_FLAG = "--andros-origin=";
const appOrigin = (process.argv.find((arg) => arg.startsWith(ORIGIN_FLAG)) || "").slice(ORIGIN_FLAG.length);

if (appOrigin && window.location.origin === appOrigin) {
  // Resultado del login con Google: el proceso principal lo guarda hasta que
  // esta página lo recoge (`andros:auth:take`). Si llega antes de que React
  // registre su callback (p. ej. durante una recarga), se guarda aquí.
  const authListeners = new Set();
  let bufferedAuthResult = null;
  const pullAuthResult = () => {
    ipcRenderer
      .invoke("andros:auth:take")
      .then((payload) => {
        if (!payload) return;
        if (authListeners.size === 0) {
          bufferedAuthResult = payload;
          return;
        }
        for (const listener of authListeners) listener(payload);
      })
      .catch(() => {});
  };
  ipcRenderer.on("andros:auth:ready", pullAuthResult);
  pullAuthResult();

  contextBridge.exposeInMainWorld("androsDesktop", {
    isDesktop: true,
    platform: process.platform,
    printer: {
      discover: () => ipcRenderer.invoke("andros:printer:discover"),
      status: (ip, port) => ipcRenderer.invoke("andros:printer:status", String(ip), Number(port)),
      print: (ip, port, fileName, data) =>
        ipcRenderer.invoke("andros:printer:print", String(ip), Number(port), String(fileName), data),
    },
    klipper: {
      status: (ip, port) => ipcRenderer.invoke("andros:klipper:status", String(ip), Number(port)),
      print: (ip, port, fileName, data) =>
        ipcRenderer.invoke("andros:klipper:print", String(ip), Number(port), String(fileName), data),
    },
    slicers: {
      detect: () => ipcRenderer.invoke("andros:slicers:detect"),
      open: (slicerId, fileName, data) =>
        ipcRenderer.invoke("andros:slicers:open", String(slicerId), String(fileName), data),
    },
    auth: {
      begin: () => ipcRenderer.invoke("andros:auth:begin"),
      openInBrowser: (url) => ipcRenderer.invoke("andros:auth:open", String(url)),
      cancel: () => ipcRenderer.invoke("andros:auth:cancel"),
      onResult: (callback) => {
        authListeners.add(callback);
        if (bufferedAuthResult) {
          const payload = bufferedAuthResult;
          bufferedAuthResult = null;
          callback(payload);
        }
        return () => authListeners.delete(callback);
      },
    },
  });

  const syncTheme = () =>
    ipcRenderer.send("andros:theme", document.documentElement.classList.contains("dark") ? "dark" : "light");

  const watchTheme = () => {
    syncTheme();
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchTheme, { once: true });
  } else {
    watchTheme();
  }
}
