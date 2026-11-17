// ============================================================================
// ANDROS — PRELOAD DE LA APP DE WINDOWS
// Expone `window.androsDesktop` SOLO a la web de Andros (mismo origen que la
// app cargada). Las páginas del login de Google no reciben nada.
//   · printer.discover() → busca la Adventurer 3 en el Wi-Fi
//   · printer.status(ip, port) → temperaturas / progreso
//   · printer.print(ip, port, fileName, bytes) → envía el .gx e imprime
// Además sincroniza el tema (clase "dark" en <html>) con la barra de título.
// ============================================================================

const { contextBridge, ipcRenderer } = require("electron");

const ORIGIN_FLAG = "--andros-origin=";
const appOrigin = (process.argv.find((arg) => arg.startsWith(ORIGIN_FLAG)) || "").slice(ORIGIN_FLAG.length);

if (appOrigin && window.location.origin === appOrigin) {
  contextBridge.exposeInMainWorld("androsDesktop", {
    isDesktop: true,
    platform: process.platform,
    printer: {
      discover: () => ipcRenderer.invoke("andros:printer:discover"),
      status: (ip, port) => ipcRenderer.invoke("andros:printer:status", String(ip), Number(port)),
      print: (ip, port, fileName, data) =>
        ipcRenderer.invoke("andros:printer:print", String(ip), Number(port), String(fileName), data),
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
