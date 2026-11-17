// ANDROS — Compila el núcleo de red FlashForge (src/lib/printer/flashforgeNet.ts)
// a CommonJS para la app de Windows: un único código para la ruta de Next.js
// y para electron/main.cjs.
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild.buildSync({
  entryPoints: [path.join(root, "src/lib/printer/flashforgeNet.ts")],
  outfile: path.join(__dirname, "generated/flashforge.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "warning",
  banner: { js: "// Generado por electron/build-printer.cjs — no editar." },
});

console.log("✓ Núcleo FlashForge compilado → electron/generated/flashforge.cjs");
