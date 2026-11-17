// ANDROS — npm run desktop:dev
//   1. Si http://localhost:3000 no responde, arranca `next dev`.
//   2. Espera a que el servidor esté listo.
//   3. Compila el núcleo FlashForge y abre la ventana de escritorio.
// Al cerrar la ventana se detiene también el `next dev` que se arrancó aquí.
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { devUrl } = require("./config.cjs");

const root = path.join(__dirname, "..");
const url = process.env.ANDROS_URL || devUrl;
let nextProcess = null;

async function isUp() {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

function stopNext() {
  if (!nextProcess || nextProcess.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(nextProcess.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    nextProcess.kill("SIGTERM");
  }
}

async function main() {
  if (await isUp()) {
    console.log(`• Usando el servidor que ya está en marcha: ${url}`);
  } else {
    console.log("• Arrancando Next.js (npm run dev)…");
    nextProcess = spawn("npm", ["run", "dev"], { cwd: root, stdio: "inherit", shell: true });
    nextProcess.on("exit", (code) => {
      if (code) console.error(`next dev terminó con código ${code}`);
    });
    const deadline = Date.now() + 180_000;
    while (!(await isUp())) {
      if (Date.now() > deadline) throw new Error(`El servidor no respondió en ${url}`);
      if (nextProcess.exitCode !== null) throw new Error("next dev se detuvo antes de estar listo");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  require("./build-printer.cjs");

  const electronBinary = require("electron");
  console.log("• Abriendo la ventana de Andros…");
  // VS Code (y otras apps Electron) definen ELECTRON_RUN_AS_NODE en sus
  // terminales: con esa variable Electron arranca como Node y no abre ventana.
  const env = { ...process.env, ANDROS_URL: url, ANDROS_DESKTOP_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronBinary, ["."], { cwd: root, stdio: "inherit", env });
  app.on("exit", (code) => {
    stopNext();
    process.exit(code ?? 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopNext();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  stopNext();
  process.exit(1);
});
