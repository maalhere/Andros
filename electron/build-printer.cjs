// ANDROS — Compila los núcleos de red de impresora a CommonJS para la app de
// Windows: un único código para las rutas de Next.js y para electron/main.cjs.
//   · src/lib/printer/flashforgeNet.ts  → electron/generated/flashforge.cjs
//   · src/lib/printers/moonrakerNet.ts  → electron/generated/klipper.cjs
//     (+ parseKlipperTarget: validación RFC 1918 / puertos Moonraker)
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "warning",
  banner: { js: "// Generado por electron/build-printer.cjs — no editar." },
};

esbuild.buildSync({
  ...shared,
  entryPoints: [path.join(root, "src/lib/printer/flashforgeNet.ts")],
  outfile: path.join(__dirname, "generated/flashforge.cjs"),
});

esbuild.buildSync({
  ...shared,
  stdin: {
    contents: [
      'export * from "./src/lib/printers/moonrakerNet";',
      'export { parseKlipperTarget, isRfc1918IPv4 } from "./src/lib/printers/network";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "klipper-entry.ts",
    loader: "ts",
  },
  outfile: path.join(__dirname, "generated/klipper.cjs"),
});

console.log("✓ Núcleos de impresora compilados → electron/generated/flashforge.cjs + klipper.cjs");
